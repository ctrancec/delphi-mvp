/**
 * Perplexity — the web research channel.
 *
 * Reuses the pattern already proven in src/app/api/intelligence/route.ts: the
 * OpenAI SDK pointed at Perplexity's compatible endpoint.
 *
 * Perplexity returns real citations alongside its answer, which is the point.
 * An agent with this channel can produce source locators that actually resolve;
 * an agent without it can only invent them.
 */

import OpenAI from 'openai';

export interface SearchResult {
    answer: string;
    /** Real URLs Perplexity consulted. These become the agent's locators. */
    citations: string[];
    model: string;
    searchRequests: number;
    usage: { promptTokens: number; completionTokens: number };
}

let client: OpenAI | null = null;

function getClient(): OpenAI | null {
    if (client) return client;
    const apiKey = process.env.PERPLEXITY_API_KEY;
    if (!apiKey) return null;

    client = new OpenAI({ apiKey, baseURL: 'https://api.perplexity.ai' });
    return client;
}

export function isPerplexityConfigured(): boolean {
    return Boolean(process.env.PERPLEXITY_API_KEY);
}

export class ChannelUnavailableError extends Error {
    constructor(channel: string, detail: string) {
        super(`Channel "${channel}" is unavailable: ${detail}`);
        this.name = 'ChannelUnavailableError';
    }
}

/**
 * Search the live web.
 *
 * `recencyDays` maps to Perplexity's recency filter — worth setting for news
 * work, where a six-month-old result is worse than none.
 */
export async function webSearch(
    query: string,
    opts: { model?: string; recencyDays?: number } = {}
): Promise<SearchResult> {
    const ai = getClient();
    if (!ai) throw new ChannelUnavailableError('perplexity', 'PERPLEXITY_API_KEY is not set');

    const model = opts.model ?? 'sonar';

    const recency =
        opts.recencyDays === undefined
            ? undefined
            : opts.recencyDays <= 1
              ? 'day'
              : opts.recencyDays <= 7
                ? 'week'
                : opts.recencyDays <= 31
                  ? 'month'
                  : 'year';

    const response = await ai.chat.completions.create({
        model,
        messages: [
            {
                role: 'system',
                content:
                    'Answer from current sources. Be specific and include concrete figures, names and dates. State plainly when something is uncertain or single-sourced.',
            },
            { role: 'user', content: query },
        ],
        temperature: 0.2,
        // Not in the OpenAI types, but Perplexity honours it.
        ...(recency ? ({ search_recency_filter: recency } as Record<string, unknown>) : {}),
    });

    const choice = response.choices[0];
    let answer = choice?.message?.content ?? '';

    // Reasoning models wrap their trace in <think>; it is not part of the answer.
    if (model.includes('reasoning')) {
        answer = answer.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    }

    // Citations live outside the typed surface.
    const raw = response as unknown as { citations?: unknown; search_results?: unknown };
    const citations = Array.isArray(raw.citations)
        ? raw.citations.filter((c): c is string => typeof c === 'string')
        : Array.isArray(raw.search_results)
          ? (raw.search_results as { url?: string }[])
                .map((r) => r.url)
                .filter((u): u is string => typeof u === 'string')
          : [];

    return {
        answer,
        citations,
        model,
        searchRequests: 1,
        usage: {
            promptTokens: response.usage?.prompt_tokens ?? 0,
            completionTokens: response.usage?.completion_tokens ?? 0,
        },
    };
}

/** Cheap reachability probe for the channel health indicator. */
export async function checkPerplexityHealth(): Promise<{ ok: boolean; detail?: string }> {
    if (!isPerplexityConfigured()) return { ok: false, detail: 'PERPLEXITY_API_KEY is not set' };
    try {
        await webSearch('What is today\'s date?', { model: 'sonar' });
        return { ok: true };
    } catch (err) {
        return { ok: false, detail: (err as Error).message };
    }
}
