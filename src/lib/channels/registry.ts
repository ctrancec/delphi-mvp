/**
 * Channel registry — turns an agent's bound channels into callable tools.
 *
 * An agent's tool surface is exactly the union of the channels it was hired
 * with. An agent with no channels gets no tools, and cannot cite live sources;
 * that is a real constraint, and Delphi's hiring prompt is told not to assign
 * work that needs a channel this workspace has not connected.
 *
 * Every tool result carries the locators the agent should cite, so the path
 * from "what the tool returned" to "what the claim cites" is short enough that
 * fabricating a citation is harder than using the real one.
 */

import { Type, type FunctionDeclaration } from '@google/genai';
import type { ChannelKind, SourceLocator } from '@/lib/delphi/types';
import { COMMON_SERIES, fetchSeries, isFredConfigured } from './fred';
import { isPerplexityConfigured, webSearch } from './perplexity';
import { fetchFeeds, isRssConfigured } from './rss';

export interface ToolCallResult {
    /** Shown to the model. */
    content: string;
    /** Locators the model may legitimately cite from this result. */
    locators: SourceLocator[];
    /** Billable searches, folded into the run's cost. */
    searchRequests?: number;
}

export interface ChannelTool {
    declaration: FunctionDeclaration;
    execute: (args: Record<string, unknown>) => Promise<ToolCallResult>;
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const webSearchTool: ChannelTool = {
    declaration: {
        name: 'web_search',
        description:
            'Search the live web and get an answer with real citations. Use this for anything current, and cite the URLs it returns.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                query: { type: Type.STRING, description: 'What you want to know. Be specific.' },
                recencyDays: {
                    type: Type.INTEGER,
                    description: 'Restrict to the last N days. Use 1-7 for news.',
                },
            },
            required: ['query'],
        },
    },
    async execute(args) {
        const result = await webSearch(String(args.query ?? ''), {
            recencyDays: args.recencyDays ? Number(args.recencyDays) : undefined,
        });

        const locators: SourceLocator[] = result.citations.map((url) => ({ kind: 'url', url }));

        return {
            content: [
                result.answer,
                '',
                locators.length
                    ? `SOURCES YOU MAY CITE (use these exact URLs):\n${result.citations.map((c) => `- ${c}`).join('\n')}`
                    : 'NO SOURCES RETURNED — do not assert anything from this result as fact.',
            ].join('\n'),
            locators,
            searchRequests: result.searchRequests,
        };
    },
};

const fredTool: ChannelTool = {
    declaration: {
        name: 'fred_series',
        description:
            'Fetch an economic or market time series from FRED. Returns real observations with dates. Cite as a series locator with the exact observation date.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                seriesId: {
                    type: Type.STRING,
                    description: `FRED series id. Common ones: ${Object.keys(COMMON_SERIES).join(', ')}`,
                },
                limit: { type: Type.INTEGER, description: 'How many recent observations (default 24).' },
            },
            required: ['seriesId'],
        },
    },
    async execute(args) {
        const seriesId = String(args.seriesId ?? '').toUpperCase();
        const series = await fetchSeries(seriesId, {
            limit: args.limit ? Number(args.limit) : 24,
        });

        if (!series.points.length) {
            return {
                content: `FRED returned no observations for ${seriesId}. Do not assert a value for it.`,
                locators: [],
            };
        }

        // Every observation is citable, so a claim about any point is checkable.
        const locators: SourceLocator[] = series.points.map((p) => ({
            kind: 'series',
            seriesId: series.seriesId,
            date: p.date,
        }));

        return {
            content: [
                `${series.title} (${series.seriesId})`,
                `Latest: ${series.latest!.value} on ${series.latest!.date}`,
                '',
                'Observations (oldest first):',
                series.points.map((p) => `  ${p.date}  ${p.value}`).join('\n'),
                '',
                'Cite any of these as {kind:"series", seriesId, date} using the exact date shown.',
            ].join('\n'),
            locators,
        };
    },
};

const rssTool: ChannelTool = {
    declaration: {
        name: 'rss_headlines',
        description:
            'Pull recent headlines from news feeds. Returns article URLs you can cite directly.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                feeds: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                    description: 'Feed URLs, or omit for the default global set.',
                },
                limit: { type: Type.INTEGER, description: 'Max items (default 20).' },
            },
        },
    },
    async execute(args) {
        const items = await fetchFeeds({
            feeds: Array.isArray(args.feeds) ? args.feeds.map(String) : undefined,
            limit: args.limit ? Number(args.limit) : 20,
        });

        if (!items.length) {
            return { content: 'No feed items returned.', locators: [] };
        }

        const locators: SourceLocator[] = items.map((i) => ({ kind: 'url', url: i.url }));

        return {
            content: [
                `${items.length} items:`,
                items
                    .map(
                        (i) =>
                            `- [${i.source}] ${i.title}\n  ${i.url}${i.publishedAt ? `\n  published ${i.publishedAt}` : ''}`
                    )
                    .join('\n'),
                '',
                'Cite the exact URLs above.',
            ].join('\n'),
            locators,
        };
    },
};

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

const BY_KIND: Partial<Record<ChannelKind, ChannelTool[]>> = {
    perplexity: [webSearchTool],
    fred: [fredTool],
    rss: [rssTool],
};

/** Whether a channel kind has credentials to actually run. */
export function isChannelConfigured(kind: ChannelKind): boolean {
    switch (kind) {
        case 'perplexity':
            return isPerplexityConfigured();
        case 'fred':
            return isFredConfigured();
        case 'rss':
            return isRssConfigured();
        default:
            // Not implemented yet: worldmonitor, higgsfield, gdrive, telegram,
            // local_fs, mcp, http.
            return false;
    }
}

/**
 * Tools for an agent, given the channel kinds it was hired with.
 *
 * Unconfigured channels are dropped rather than handed over as tools that
 * throw — an agent that calls a dead tool wastes a turn and often hallucinates
 * around the failure.
 */
export function toolsForChannels(kinds: ChannelKind[]): ChannelTool[] {
    const seen = new Set<string>();
    const tools: ChannelTool[] = [];

    for (const kind of kinds) {
        if (!isChannelConfigured(kind)) continue;
        for (const tool of BY_KIND[kind] ?? []) {
            if (seen.has(tool.declaration.name!)) continue;
            seen.add(tool.declaration.name!);
            tools.push(tool);
        }
    }
    return tools;
}

/** Health across every channel kind the registry knows how to run. */
export async function channelHealth(): Promise<
    Record<string, { ok: boolean; detail?: string }>
> {
    const { checkPerplexityHealth } = await import('./perplexity');
    const { checkFredHealth } = await import('./fred');
    const { checkRssHealth } = await import('./rss');

    const [perplexity, fred, rss] = await Promise.all([
        checkPerplexityHealth(),
        checkFredHealth(),
        checkRssHealth(),
    ]);

    return { perplexity, fred, rss };
}
