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
import { BOC_PREFIX, COMMON_BOC_SERIES, fetchBocSeries, isBocConfigured } from './boc';
import { COMMON_SERIES, fetchSeries, isFredConfigured } from './fred';
import { corroborate, isGdeltConfigured, searchGdelt } from './gdelt';
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

const bocTool: ChannelTool = {
    declaration: {
        name: 'boc_series',
        description:
            'Fetch official Bank of Canada data: USD/CAD, the overnight policy rate, Government of Canada bond yields, core CPI. Returns dated observations. Cite as a series locator with the BOC: id and the exact date.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                seriesIds: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                    description: `Valet series ids. Common ones: ${Object.entries(COMMON_BOC_SERIES)
                        .map(([id, label]) => `${id} (${label})`)
                        .join('; ')}`,
                },
                recent: {
                    type: Type.INTEGER,
                    description: 'How many recent observations per series (default 10).',
                },
            },
            required: ['seriesIds'],
        },
    },
    async execute(args) {
        const ids = Array.isArray(args.seriesIds)
            ? args.seriesIds.map(String)
            : [String(args.seriesIds ?? '')];
        const { series, unknown } = await fetchBocSeries(ids, {
            recent: args.recent ? Number(args.recent) : 10,
        });

        // Every observation is citable, so a claim about any point is checkable.
        const locators: SourceLocator[] = series.flatMap((s) =>
            s.points.map((p) => ({
                kind: 'series' as const,
                seriesId: `${BOC_PREFIX}${s.seriesId}`,
                date: p.date,
            }))
        );

        const blocks = series.map((s) =>
            s.latest
                ? [
                      `${s.label} (${BOC_PREFIX}${s.seriesId})`,
                      `Latest: ${s.latest.value} on ${s.latest.date}`,
                      'Observations (oldest first):',
                      s.points.map((p) => `  ${p.date}  ${p.value}`).join('\n'),
                  ].join('\n')
                : `${BOC_PREFIX}${s.seriesId}: Valet returned no observations. Do not assert a value for it.`
        );

        if (unknown.length) {
            blocks.push(
                `Valet has no series named ${unknown.join(', ')}. Do not assert anything for ${unknown.length === 1 ? 'it' : 'them'}.`
            );
        }

        return {
            content: [
                ...blocks,
                locators.length
                    ? 'Cite any of these as {kind:"series", seriesId:"BOC:<id>", date} using the exact date shown.'
                    : 'NOTHING CITABLE RETURNED — do not assert any Bank of Canada figure from this call.',
            ].join('\n\n'),
            locators,
        };
    },
};

/** How many reports, and outlets per report, to spell out. The count covers all of them. */
const GDELT_REPORTS_SHOWN = 15;
const GDELT_OUTLETS_PER_REPORT = 5;

const gdeltTool: ChannelTool = {
    declaration: {
        name: 'global_news_search',
        description:
            'Search world news in 65+ languages (GDELT). Every article carries its source country and language, and results are grouped by report, so you can tell real corroboration — distinct reports from unrelated outlets — from one wire story republished many times. Cite the exact URLs it returns.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                query: {
                    type: Type.STRING,
                    description: 'Keywords or a "quoted phrase". Be specific; very short or very common terms are rejected.',
                },
                languages: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                    description: 'Only articles in these languages, named in English: french, spanish, arabic, chinese, russian. Omit for all.',
                },
                countries: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                    description: 'Only outlets in these countries, named in English without spaces: france, unitedkingdom, china. Omit for all.',
                },
                days: { type: Type.INTEGER, description: 'How far back, in days (default 3, max 90).' },
                max: { type: Type.INTEGER, description: 'Articles to consider (default 50, max 100).' },
            },
            required: ['query'],
        },
    },
    async execute(args) {
        const days = args.days ? Number(args.days) : 3;
        const outcome = await searchGdelt({
            query: String(args.query ?? ''),
            languages: Array.isArray(args.languages) ? args.languages.map(String) : undefined,
            countries: Array.isArray(args.countries) ? args.countries.map(String) : undefined,
            days,
            max: args.max ? Number(args.max) : 50,
        });

        if (outcome.kind === 'unavailable') {
            const why =
                outcome.reason === 'throttled'
                    ? 'GDELT is rate-limiting requests from this server right now'
                    : `GDELT is not answering right now (${outcome.detail})`;
            return {
                content: `${why}, so it returned nothing. Use rss_headlines or web_search instead. Assert nothing from this call.`,
                locators: [],
            };
        }
        if (outcome.kind === 'refused') {
            return {
                content: `GDELT rejected the query "${outcome.query}": ${outcome.message}\nRephrase it with longer, more specific terms, or use another source. Assert nothing from this call.`,
                locators: [],
            };
        }
        if (!outcome.articles.length) {
            return {
                content: `GDELT found no coverage of "${outcome.query}" in the last ${days} day(s). Absence here is not evidence either way — say only that this search found nothing.`,
                locators: [],
            };
        }

        const c = corroborate(outcome.articles);
        const shown = c.reports.slice(0, GDELT_REPORTS_SHOWN);

        // Only what is shown is citable: a URL the agent never saw cannot be
        // the source of anything it wrote.
        const locators: SourceLocator[] = shown.flatMap((r) =>
            r.articles.slice(0, GDELT_OUTLETS_PER_REPORT).map((a) => ({ kind: 'url' as const, url: a.url }))
        );

        const reportLines = shown.map((r, i) => {
            const carried =
                r.outlets.length > 1
                    ? `${r.outlets.length} outlets — ONE report, republished; not ${r.outlets.length} confirmations`
                    : '1 outlet';
            return [
                `${i + 1}. "${r.headline}"`,
                `   ${carried} · ${r.countries.join(', ') || 'country unknown'} · ${r.languages.join(', ') || 'language unknown'} · first seen ${r.firstSeen}`,
                ...r.articles
                    .slice(0, GDELT_OUTLETS_PER_REPORT)
                    .map((a) => `   - ${a.domain} (${a.country || '?'}, ${a.language || '?'}) ${a.url}`),
            ].join('\n');
        });

        return {
            content: [
                `GDELT, last ${days} day(s): ${c.articles} articles from ${c.outlets} outlets in ${c.countries.length} countr${c.countries.length === 1 ? 'y' : 'ies'} (${c.countries.join(', ')}), in ${c.languages.join(', ')}.`,
                `Distinct reports: ${c.reports.length}. Syndicated copies: ${c.syndicatedCopies} — outlets carrying a headline another outlet already ran.`,
                'Corroboration means distinct reports from unrelated outlets, ideally in different countries. A headline carried verbatim by several outlets is a single source.',
                '',
                `Reports, most widely carried first${c.reports.length > shown.length ? ` (top ${shown.length} of ${c.reports.length})` : ''}:`,
                reportLines.join('\n'),
                '',
                'Titles are in the original language; translate what you rely on. Cite the exact URLs above.',
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
    boc: [bocTool],
    gdelt: [gdeltTool],
};

/** Every kind the registry can actually run, in a stable order. */
export function implementedChannelKinds(): ChannelKind[] {
    return Object.keys(BY_KIND) as ChannelKind[];
}

/**
 * What each channel can do — and, as much to the point, what it cannot.
 *
 * Delphi reads these when it staffs a department. Before this it saw bare
 * names ("- perplexity"), which is how it came to hand equity screening to an
 * analyst whose only tool was web search: nothing told it that web search
 * cannot screen stocks. The "cannot" half of each line is what prevents that,
 * and it is also what the health page shows beside each channel.
 */
export const CHANNEL_CAPABILITIES: Partial<Record<ChannelKind, string>> = {
    perplexity:
        'Live web search with cited answers — current events and general research. Not a data feed: it cannot screen stocks or return reliable prices, ratios or time series.',
    fred: 'US macro and market time series from the St. Louis Fed — rates, yields, CPI, jobs, GDP, the S&P 500 level, some FX. Dated observations. No per-company or per-ticker data.',
    rss: 'Recent headlines from a fixed set of major English-language outlets. Headlines and links only.',
    boc: 'Official Bank of Canada data — USD/CAD, the overnight policy rate, Government of Canada 2/5/10-year and long bond yields, core CPI. Dated observations. Canada only; no company data.',
    gdelt: 'World news in 65+ languages, each article tagged with its source country and language, grouped so syndicated copies are not mistaken for independent confirmation. Headlines and links, not full text.',
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
        case 'boc':
            return isBocConfigured();
        case 'gdelt':
            return isGdeltConfigured();
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

type HealthCheck = () => Promise<{ ok: boolean; detail?: string }>;

/** Loaded on demand, so a probe that is not asked for is never even imported. */
const HEALTH_CHECKS: Partial<Record<ChannelKind, () => Promise<HealthCheck>>> = {
    perplexity: async () => (await import('./perplexity')).checkPerplexityHealth,
    fred: async () => (await import('./fred')).checkFredHealth,
    rss: async () => (await import('./rss')).checkRssHealth,
    boc: async () => (await import('./boc')).checkBocHealth,
    gdelt: async () => (await import('./gdelt')).checkGdeltHealth,
};

/**
 * Live health for the channels the registry can run — or just the ones named.
 *
 * `only` exists for channels the CHO has switched off: probing one of those
 * spends a request on a service Delphi has stopped using, and GDELT's probe
 * alone can hold the diagnostics page for eight seconds.
 */
export async function channelHealth(
    only?: ChannelKind[]
): Promise<Record<string, { ok: boolean; detail?: string }>> {
    const kinds = (only ?? implementedChannelKinds()).filter((k) => HEALTH_CHECKS[k]);
    const results = await Promise.all(
        kinds.map(async (k) => [k, await (await HEALTH_CHECKS[k]!())()] as const)
    );
    return Object.fromEntries(results);
}
