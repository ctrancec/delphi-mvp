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

import { GoogleGenAI, type GenerateContentResponse, type Schema } from '@google/genai';
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
 */
export const MODEL_FALLBACKS: Record<string, string[]> = {
    'gemini-3.8-flash': ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-2.5-flash'],
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

/** Transient upstream conditions worth retrying, as opposed to our own bad request. */
function isTransient(err: unknown): boolean {
    const msg = String((err as Error)?.message ?? err);
    // The SDK surfaces the raw JSON error body, so match on status codes and
    // the canonical status strings rather than on prose that may be localised.
    return (
        /\b(429|500|502|503|504)\b/.test(msg) ||
        /UNAVAILABLE|RESOURCE_EXHAUSTED|INTERNAL|DEADLINE_EXCEEDED/i.test(msg) ||
        /ECONNRESET|ETIMEDOUT|fetch failed/i.test(msg)
    );
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
            if (!isTransient(err) || i === attempts - 1) throw err;
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
 * transiently unavailable. Returns the served model alongside the response so
 * the caller can price and record it accurately.
 */
async function callWithFallback(
    model: string,
    fn: (m: string) => Promise<GenerateContentResponse>
): Promise<{ response: GenerateContentResponse; servedBy: string }> {
    const chain = fallbackChain(model);
    let lastError: unknown;

    for (let i = 0; i < chain.length; i++) {
        const candidate = chain[i];
        try {
            const response = await withRetry(() => fn(candidate));
            if (candidate !== model) {
                console.warn(`[delphi] ${model} unavailable; served by ${candidate}`);
            }
            return { response, servedBy: candidate };
        } catch (err) {
            lastError = err;
            // A bad request is our fault and will fail identically on every
            // model, so only capacity problems are worth walking the chain for.
            if (!isTransient(err) || i === chain.length - 1) throw err;
            console.warn(`[delphi] ${candidate} unavailable, falling back to ${chain[i + 1]}`);
        }
    }
    throw lastError;
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
        );
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
