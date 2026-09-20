/**
 * Token accounting.
 *
 * Every model call records what it cost so departments can carry real budgets
 * and the dashboard can show a live spend meter. Prices are USD per 1M tokens,
 * checked against provider pricing pages on 2026-09-20.
 *
 * Perplexity additionally charges a per-request search fee, which is a large
 * share of the cost of a short research call — ignoring it would understate
 * research spend by roughly half.
 */

export interface TokenUsage {
    promptTokens: number;
    completionTokens: number;
    /** Tokens served from Gemini's implicit context cache (billed at a discount). */
    cachedTokens?: number;
    /** Billable Perplexity searches performed during the call. */
    searchRequests?: number;
}

export interface ModelPrice {
    /** USD per 1M input tokens. */
    input: number;
    /** USD per 1M output tokens. */
    output: number;
    /** USD per 1M cached input tokens, when the provider discounts them. */
    cachedInput?: number;
    /** USD per request, for providers that bill searches separately. */
    perRequest?: number;
}

export const MODEL_PRICES: Record<string, ModelPrice> = {
    // Google Gemini — ai.google.dev/gemini-api/docs/pricing
    'gemini-3.8-flash': { input: 0.75, output: 3.75, cachedInput: 0.1875 },
    'gemini-3.7-flash': { input: 0.75, output: 3.75, cachedInput: 0.1875 },
    'gemini-3.5-flash': { input: 1.5, output: 9.0, cachedInput: 0.375 },
    'gemini-3.5-flash-lite': { input: 0.3, output: 2.5, cachedInput: 0.075 },
    'gemini-2.5-flash': { input: 0.3, output: 2.5, cachedInput: 0.075 },

    // Perplexity — docs.perplexity.ai/getting-started/pricing
    // perRequest uses the medium search-context tier.
    sonar: { input: 1.0, output: 1.0, perRequest: 0.008 },
    'sonar-pro': { input: 3.0, output: 15.0, perRequest: 0.01 },
    'sonar-reasoning-pro': { input: 2.0, output: 8.0, perRequest: 0.01 },
    'sonar-deep-research': { input: 2.0, output: 8.0, perRequest: 0.005 },
};

/** Fallback for an unknown model: price it as our default worker so spend is never silently zero. */
const FALLBACK_PRICE: ModelPrice = MODEL_PRICES['gemini-3.8-flash'];

export function priceFor(model: string): ModelPrice {
    return MODEL_PRICES[model] ?? FALLBACK_PRICE;
}

/** Cost of one model call in USD. */
export function computeCost(model: string, usage: TokenUsage): number {
    const price = priceFor(model);

    const cached = usage.cachedTokens ?? 0;
    // Gemini reports cached tokens as a subset of promptTokenCount, so bill the
    // remainder at full rate and the cached portion at the discounted rate.
    const uncachedPrompt = Math.max(0, usage.promptTokens - cached);
    const cachedRate = price.cachedInput ?? price.input;

    const inputCost = (uncachedPrompt / 1_000_000) * price.input;
    const cachedCost = (cached / 1_000_000) * cachedRate;
    const outputCost = (usage.completionTokens / 1_000_000) * price.output;
    const requestCost = (usage.searchRequests ?? 0) * (price.perRequest ?? 0);

    return inputCost + cachedCost + outputCost + requestCost;
}

/** Format a USD amount for display; sub-cent costs still need to be legible. */
export function formatUsd(amount: number): string {
    if (amount === 0) return '$0.00';
    if (amount < 0.01) return `$${amount.toFixed(4)}`;
    if (amount < 1) return `$${amount.toFixed(3)}`;
    return `$${amount.toFixed(2)}`;
}
