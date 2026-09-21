/**
 * Gemini client for Delphi.
 *
 * Every agent call in the system funnels through here so that token usage and
 * cost are captured in one place and can be written to delphi_task_runs.
 *
 * Structured output: `responseSchema` makes Gemini emit syntactically valid
 * JSON, but not necessarily the shape we asked for. Callers pass a `validate`
 * function; on a shape failure we make exactly one repair attempt (handing the
 * bad output back and demanding conformance) before giving up. Failing loudly
 * is deliberate — a task that produced nothing usable must show as failed.
 */

import {
    GoogleGenAI,
    type FunctionDeclaration,
    type GenerateContentResponse,
    type Schema,
} from '@google/genai';
import { computeCost, type TokenUsage } from './cost';
import { extractJson, JsonExtractionError } from './json';

export const DEFAULT_MODEL = 'gemini-3.8-flash';

/**
 * Ordered fallback chain.
 *
 * Flash capacity genuinely runs out — the first live run of the hiring harness
 * hit `503 UNAVAILABLE` on 3.8 through four backoff attempts. For a system that
 * runs departments unattended on a cron, a saturated primary must degrade to an
 * older Flash rather than fail the run. Cost accounting stays correct because
 * pricing is keyed on whichever model actually served.
 *
 * The free tier counts its daily allowance **per model**, so this chain is also
 * how a day's work gets done at all: each entry carries its own bucket.
 *
 * `gemini-2.5-flash` used to sit at the end of this list and was the single
 * worst thing in it. Google has retired it for accounts that did not already
 * use it, so it answered `404` — which is not a capacity problem, so the chain
 * aborted on it and reported "model not found" as the cause of a failure that
 * was really the daily quota running out. Every entry below was verified to
 * answer `generateContent` on this key.
 */
export const MODEL_FALLBACKS: Record<string, string[]> = {
    'gemini-3.8-flash': [
        'gemini-3.7-flash',
        'gemini-3.6-flash',
        'gemini-3.5-flash',
        'gemini-3.5-flash-lite',
        'gemini-3.1-flash-lite',
    ],
};

function fallbackChain(model: string): string[] {
    return [model, ...(MODEL_FALLBACKS[model] ?? [])];
}

let client: GoogleGenAI | null = null;

/**
 * Lazily construct the shared client.
 * Returns null when no key is configured, matching how src/lib/supabase/*
 * degrades rather than throwing at import time.
 */
export function getGeminiClient(): GoogleGenAI | null {
    if (client) return client;

    const apiKey =
        process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
        process.env.GEMINI_API_KEY ||
        process.env.GOOGLE_API_KEY;

    if (!apiKey) return null;

    client = new GoogleGenAI({ apiKey });
    return client;
}

export class GeminiNotConfiguredError extends Error {
    constructor() {
        super(
            'No Gemini API key found. Set GOOGLE_GENERATIVE_AI_API_KEY (or GEMINI_API_KEY) in the environment.'
        );
        this.name = 'GeminiNotConfiguredError';
    }
}

/**
 * Every model Delphi can reach has spent its allowance for the day.
 *
 * Worth its own type because it is the one failure no retry, no fallback and
 * no better prompt can fix, and because the message it replaces was actively
 * misleading: the chain used to end on a model that answered 404, so a run
 * that ran out of quota reported "model not found".
 */
export class ModelQuotaError extends Error {
    readonly models: string[];

    constructor(models: string[], cause?: unknown) {
        super(
            `Out of Gemini quota for today on every available model ` +
                `(${models.join(', ')}). The free tier counts requests per model per day, ` +
                `so the whole chain empties within a few hours of real work. ` +
                `Enable billing on the Google AI Studio project to lift the limit, ` +
                `or wait for the daily reset.`
        );
        this.name = 'ModelQuotaError';
        this.models = models;
        this.cause = cause;
    }
}

export class SchemaValidationError extends Error {
    readonly raw: string;

    constructor(message: string, raw: string) {
        super(message);
        this.name = 'SchemaValidationError';
        this.raw = raw;
    }
}

export interface GenerateOptions {
    /** The agent's persona and operating instructions. Kept first and byte-stable for implicit caching. */
    system?: string;
    model?: string;
    temperature?: number;
    maxOutputTokens?: number;
}

export interface GenerateResult<T> {
    data: T;
    raw: string;
    model: string;
    usage: TokenUsage;
    costUsd: number;
    /** True when the first response failed validation and a repair round was needed. */
    repaired: boolean;
}

export interface TextResult {
    text: string;
    model: string;
    usage: TokenUsage;
    costUsd: number;
}

/**
 * What kind of refusal this was, which decides whether to wait, move on, or stop.
 *
 * The distinction that matters most is between a spike and an allowance. Both
 * arrive as `429 RESOURCE_EXHAUSTED`, and treating them alike is what turned a
 * quota problem into a three-minute death march: four backoff attempts against
 * each of five models, every one of them a request the API had already said it
 * would refuse for the rest of the day, and every one of them spending more of
 * the very thing that had run out.
 *
 * The SDK surfaces the raw JSON error body, so this matches on status codes and
 * canonical status strings rather than prose that may be localised. Google puts
 * the quota's identity in `details[].violations[].quotaId`, e.g.
 * `GenerateRequestsPerDayPerProjectPerModel-FreeTier`.
 */
export type Refusal =
    /** The day's allowance for this model is gone. Nothing to wait for. */
    | 'quota'
    /** Busy, throttled per-minute, or a network blip. Worth waiting for. */
    | 'unavailable'
    /** This key cannot call this model at all — but the others may be fine. */
    | 'model_gone'
    /** Our own bad request. It will fail identically everywhere. */
    | 'fatal';

export function classifyRefusal(err: unknown): Refusal {
    const msg = String((err as Error)?.message ?? err);

    if (/\b429\b|RESOURCE_EXHAUSTED/i.test(msg)) {
        // Per-day is an allowance; per-minute is a speed limit, and waiting
        // does clear that one.
        return /PerDay|per[ _-]?day/i.test(msg) ? 'quota' : 'unavailable';
    }

    if (/\b404\b|NOT_FOUND/.test(msg)) return 'model_gone';

    if (
        /\b(500|502|503|504)\b/.test(msg) ||
        /UNAVAILABLE|INTERNAL|DEADLINE_EXCEEDED/i.test(msg) ||
        /ECONNRESET|ETIMEDOUT|fetch failed/i.test(msg)
    ) {
        return 'unavailable';
    }

    return 'fatal';
}

/**
 * Models known to be unusable, for the life of this process.
 *
 * One serverless invocation runs several tasks, and each was rediscovering the
 * same exhausted model by calling it again — so the deeper the hole, the more
 * requests were spent digging. Deliberately not persisted: the quota window
 * rolls over, and a fresh process should find out for itself rather than
 * inherit yesterday's verdict.
 */
const unusable = new Set<string>();

/** What the runtime observed, so diagnostics can report it rather than guess. */
export function exhaustedModels(): string[] {
    return [...unusable];
}

/** Test seam. Nothing in the app forgets a refusal; a process restart does. */
export function forgetExhaustedModels(): void {
    unusable.clear();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Retry with exponential backoff and jitter.
 *
 * Delphi runs unattended on a cron, so a transient 503 must not fail a whole
 * department run. Non-transient errors (bad key, malformed request) throw
 * immediately — retrying those just burns time and money.
 */
async function withRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
    let lastError: unknown;
    for (let i = 0; i < attempts; i++) {
        try {
            return await fn();
        } catch (err) {
            lastError = err;
            if (classifyRefusal(err) !== 'unavailable' || i === attempts - 1) throw err;
            // 1s, 2s, 4s, plus up to 500ms jitter so parallel agents do not
            // retry in lockstep and re-create the spike.
            const delay = 1000 * 2 ** i + Math.random() * 500;
            console.warn(
                `[delphi] Gemini transient failure (attempt ${i + 1}/${attempts}), retrying in ${Math.round(delay)}ms`
            );
            await sleep(delay);
        }
    }
    throw lastError;
}

/**
 * Run `fn` against each model in the chain, moving on only when a model is
 * transiently unavailable or finished for the day. Returns the served model alongside the response so
 * the caller can price and record it accurately.
 */
export async function callWithFallback(
    model: string,
    fn: (m: string) => Promise<GenerateContentResponse>
): Promise<{ response: GenerateContentResponse; servedBy: string }> {
    const chain = fallbackChain(model);
    // Skip what this process has already watched refuse. Re-asking a model
    // that is out of allowance costs another request from the allowance.
    const candidates = chain.filter((m) => !unusable.has(m));
    let lastError: unknown;
    let sawQuota = false;

    for (const candidate of candidates) {
        try {
            const response = await withRetry(() => fn(candidate));
            if (candidate !== model) {
                console.warn(`[delphi] ${model} unavailable; served by ${candidate}`);
            }
            return { response, servedBy: candidate };
        } catch (err) {
            lastError = err;
            const refusal = classifyRefusal(err);

            // Our own bad request. It fails identically on every model, so
            // walking the chain would just repeat the mistake five times.
            if (refusal === 'fatal') throw err;

            if (refusal === 'quota') {
                sawQuota = true;
                unusable.add(candidate);
                console.warn(`[delphi] ${candidate} is out of quota for the day`);
            } else if (refusal === 'model_gone') {
                // Specific to this model, not to the request — the rest of the
                // chain is still worth trying, and this one never will be again.
                unusable.add(candidate);
                console.warn(`[delphi] ${candidate} is not available to this key`);
            } else {
                console.warn(`[delphi] ${candidate} unavailable, trying the next model`);
            }
        }
    }

    // Report what is actually wrong. Falling through used to surface whatever
    // the last model in the chain happened to say, which is how a day's quota
    // running out got reported as a missing model.
    if (sawQuota || chain.every((m) => unusable.has(m))) {
        throw new ModelQuotaError(chain, lastError);
    }
    throw lastError ?? new Error(`No Gemini model was reachable (tried ${chain.join(', ')}).`);
}

function readUsage(response: GenerateContentResponse): TokenUsage {
    const meta = response.usageMetadata ?? {};
    return {
        promptTokens: meta.promptTokenCount ?? 0,
        completionTokens: meta.candidatesTokenCount ?? 0,
        cachedTokens: meta.cachedContentTokenCount ?? 0,
    };
}

/** Plain text generation. Used for narrative sections where no schema applies. */
export async function generateText(
    prompt: string,
    options: GenerateOptions = {}
): Promise<TextResult> {
    const ai = getGeminiClient();
    if (!ai) throw new GeminiNotConfiguredError();

    const model = options.model ?? DEFAULT_MODEL;

    const { response, servedBy } = await callWithFallback(model, (m) =>
        ai.models.generateContent({
            model: m,
            contents: prompt,
            config: {
                ...(options.system ? { systemInstruction: options.system } : {}),
                ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
                ...(options.maxOutputTokens ? { maxOutputTokens: options.maxOutputTokens } : {}),
            },
        })
    );

    const usage = readUsage(response);
    return {
        text: response.text ?? '',
        model: servedBy,
        usage,
        costUsd: computeCost(servedBy, usage),
    };
}

/**
 * Structured generation with a single repair round.
 *
 * `validate` should throw (or return null) when the parsed value is the wrong
 * shape. It runs on the parsed object, not the raw string.
 */
export async function generateStructured<T>(
    prompt: string,
    schema: Schema,
    validate: (value: unknown) => T,
    options: GenerateOptions = {}
): Promise<GenerateResult<T>> {
    const ai = getGeminiClient();
    if (!ai) throw new GeminiNotConfiguredError();

    const model = options.model ?? DEFAULT_MODEL;

    const config = {
        ...(options.system ? { systemInstruction: options.system } : {}),
        ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
        ...(options.maxOutputTokens ? { maxOutputTokens: options.maxOutputTokens } : {}),
        responseMimeType: 'application/json',
        responseSchema: schema,
    };

    // Usage accumulates across the initial call and any repair round, so the
    // recorded cost reflects everything the task actually spent.
    const usage: TokenUsage = { promptTokens: 0, completionTokens: 0, cachedTokens: 0 };
    const addUsage = (u: TokenUsage) => {
        usage.promptTokens += u.promptTokens;
        usage.completionTokens += u.completionTokens;
        usage.cachedTokens = (usage.cachedTokens ?? 0) + (u.cachedTokens ?? 0);
    };

    const firstCall = await callWithFallback(model, (m) =>
        ai.models.generateContent({ model: m, contents: prompt, config })
    );
    // Whichever model answered is the one we price, record, and repair against.
    const servedBy = firstCall.servedBy;
    addUsage(readUsage(firstCall.response));
    const firstRaw = firstCall.response.text ?? '';

    try {
        return {
            data: validate(extractJson(firstRaw)),
            raw: firstRaw,
            model: servedBy,
            usage,
            costUsd: computeCost(servedBy, usage),
            repaired: false,
        };
    } catch (initialError) {
        // Fall through to one repair attempt.
        const reason =
            initialError instanceof JsonExtractionError
                ? 'the output was not parseable JSON'
                : `the output did not match the required shape (${(initialError as Error).message})`;

        const repairPrompt = [
            'Your previous response was rejected because ' + reason + '.',
            '',
            'Previous response:',
            '"""',
            firstRaw.slice(0, 6000),
            '"""',
            '',
            'Return ONLY a JSON value conforming exactly to the required schema.',
            'Do not include explanations, markdown fences, or any text outside the JSON.',
            '',
            'Original request:',
            prompt,
        ].join('\n');

        const second = await withRetry(() =>
            ai.models.generateContent({ model: servedBy, contents: repairPrompt, config })
        ).catch((err) => {
            // Deliberately stays on the model that answered first, so the usage
            // this call adds is priced as that model. But if its allowance ran
            // out between the two calls, say so rather than leaking a raw body.
            if (classifyRefusal(err) === 'quota') {
                unusable.add(servedBy);
                throw new ModelQuotaError([servedBy], err);
            }
            throw err;
        });
        addUsage(readUsage(second));
        const secondRaw = second.text ?? '';

        try {
            return {
                data: validate(extractJson(secondRaw)),
                raw: secondRaw,
                model: servedBy,
                usage,
                costUsd: computeCost(servedBy, usage),
                repaired: true,
            };
        } catch (repairError) {
            throw new SchemaValidationError(
                `Gemini output failed validation after one repair attempt: ${(repairError as Error).message}`,
                secondRaw || firstRaw
            );
        }
    }
}

// ---------------------------------------------------------------------------
// Tool-calling
// ---------------------------------------------------------------------------

export interface ToolLoopResult<T> extends GenerateResult<T> {
    /** How many tool calls were executed across the loop. */
    toolCalls: number;
    /** Billable third-party searches, for cost accounting. */
    searchRequests: number;
}

/**
 * Structured generation with tool use.
 *
 * Gemini cannot combine `responseSchema` with function declarations, so this
 * runs in two phases: a tool-use loop where the model gathers evidence, then a
 * final schema-constrained call over the transcript. That split is also what
 * lets the caller capture every tool result — which is how citations get
 * checked against what the channels actually returned.
 */
export async function generateWithTools<T>(
    prompt: string,
    tools: FunctionDeclaration[],
    execute: (name: string, args: Record<string, unknown>) => Promise<{ content: string; searchRequests?: number }>,
    schema: Schema,
    validate: (value: unknown) => T,
    options: GenerateOptions & { maxToolTurns?: number } = {}
): Promise<ToolLoopResult<T>> {
    const ai = getGeminiClient();
    if (!ai) throw new GeminiNotConfiguredError();

    const model = options.model ?? DEFAULT_MODEL;
    const maxTurns = options.maxToolTurns ?? 6;

    const usage: TokenUsage = { promptTokens: 0, completionTokens: 0, cachedTokens: 0 };
    const addUsage = (u: TokenUsage) => {
        usage.promptTokens += u.promptTokens;
        usage.completionTokens += u.completionTokens;
        usage.cachedTokens = (usage.cachedTokens ?? 0) + (u.cachedTokens ?? 0);
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const contents: any[] = [{ role: 'user', parts: [{ text: prompt }] }];
    let toolCalls = 0;
    let searchRequests = 0;
    let servedBy = model;

    if (tools.length > 0) {
        for (let turn = 0; turn < maxTurns; turn++) {
            const { response, servedBy: by } = await callWithFallback(model, (m) =>
                ai.models.generateContent({
                    model: m,
                    contents,
                    config: {
                        ...(options.system ? { systemInstruction: options.system } : {}),
                        ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
                        tools: [{ functionDeclarations: tools }],
                    },
                })
            );
            servedBy = by;
            addUsage(readUsage(response));

            const calls = response.functionCalls ?? [];

            // The model's turn goes back verbatim.
            //
            // Gemini 3 attaches a `thoughtSignature` to each functionCall part
            // and requires it echoed when the function response is sent. This
            // used to rebuild the turn from `response.functionCalls`, which
            // carries the name and args but not the signature — so every agent
            // holding a tool died on the second turn with
            //
            //   400 Function call is missing a thought_signature in
            //   functionCall parts
            //
            // and only the one agent with no channels ever completed. Passing
            // the candidate's own parts through keeps the signature, and any
            // interleaved text, exactly as sent.
            const modelParts = response.candidates?.[0]?.content?.parts;

            if (calls.length === 0) {
                // Nothing more to gather; keep the model's own words as context.
                if (modelParts?.length) {
                    contents.push({ role: 'model', parts: modelParts });
                } else if (response.text) {
                    contents.push({ role: 'model', parts: [{ text: response.text }] });
                }
                break;
            }

            contents.push({
                role: 'model',
                parts: modelParts?.length
                    ? modelParts
                    : // Only reachable if a model returns calls with no parts,
                      // which should not happen — but losing the turn entirely
                      // would be worse than losing the signature.
                      calls.map((c) => ({ functionCall: { name: c.name, args: c.args } })),
            });

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const responseParts: any[] = [];
            for (const call of calls) {
                toolCalls++;
                try {
                    const out = await execute(call.name ?? '', (call.args ?? {}) as Record<string, unknown>);
                    searchRequests += out.searchRequests ?? 0;
                    responseParts.push({
                        functionResponse: { name: call.name, response: { result: out.content } },
                    });
                } catch (err) {
                    // A failed tool is reported back rather than thrown, so the
                    // model can try a different approach instead of the whole
                    // task dying on one bad call.
                    responseParts.push({
                        functionResponse: {
                            name: call.name,
                            response: { error: (err as Error).message },
                        },
                    });
                }
            }
            contents.push({ role: 'user', parts: responseParts });
        }
    }

    // Final pass: same transcript, now constrained to the output schema.
    contents.push({
        role: 'user',
        parts: [
            {
                text: 'Now produce your deliverable, conforming exactly to the required schema. Cite only sources the tools actually returned.',
            },
        ],
    });

    const config = {
        ...(options.system ? { systemInstruction: options.system } : {}),
        ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
        responseMimeType: 'application/json',
        responseSchema: schema,
    };

    const final = await callWithFallback(servedBy, (m) =>
        ai.models.generateContent({ model: m, contents, config })
    );
    addUsage(readUsage(final.response));
    const raw = final.response.text ?? '';

    try {
        return {
            data: validate(extractJson(raw)),
            raw,
            model: final.servedBy,
            usage,
            costUsd: computeCost(final.servedBy, usage),
            repaired: false,
            toolCalls,
            searchRequests,
        };
    } catch (initialError) {
        const repairPrompt = [
            `Your response was rejected: ${(initialError as Error).message}`,
            '',
            'Previous response:',
            raw.slice(0, 4000),
            '',
            'Return ONLY schema-conformant JSON. Cite only sources the tools returned.',
        ].join('\n');

        contents.push({ role: 'user', parts: [{ text: repairPrompt }] });
        const second = await callWithFallback(final.servedBy, (m) =>
            ai.models.generateContent({ model: m, contents, config })
        );
        addUsage(readUsage(second.response));
        const secondRaw = second.response.text ?? '';

        try {
            return {
                data: validate(extractJson(secondRaw)),
                raw: secondRaw,
                model: second.servedBy,
                usage,
                costUsd: computeCost(second.servedBy, usage),
                repaired: true,
                toolCalls,
                searchRequests,
            };
        } catch (repairError) {
            throw new SchemaValidationError(
                `Output failed validation after one repair attempt: ${(repairError as Error).message}`,
                secondRaw || raw
            );
        }
    }
}
