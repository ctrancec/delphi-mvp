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

    const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
            ...(options.system ? { systemInstruction: options.system } : {}),
            ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
            ...(options.maxOutputTokens ? { maxOutputTokens: options.maxOutputTokens } : {}),
        },
    });

    const usage = readUsage(response);
    return {
        text: response.text ?? '',
        model,
        usage,
        costUsd: computeCost(model, usage),
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

    const first = await ai.models.generateContent({ model, contents: prompt, config });
    addUsage(readUsage(first));
    const firstRaw = first.text ?? '';

    try {
        return {
            data: validate(extractJson(firstRaw)),
            raw: firstRaw,
            model,
            usage,
            costUsd: computeCost(model, usage),
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

        const second = await ai.models.generateContent({
            model,
            contents: repairPrompt,
            config,
        });
        addUsage(readUsage(second));
        const secondRaw = second.text ?? '';

        try {
            return {
                data: validate(extractJson(secondRaw)),
                raw: secondRaw,
                model,
                usage,
                costUsd: computeCost(model, usage),
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
