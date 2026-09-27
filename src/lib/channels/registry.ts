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
import {
    fundamentalsFor,
    isSecConfigured,
    MAX_DEBT_YEARS,
    qualityLeaders,
    recentFilings,
    type Fundamentals,
} from './sec';
import {
    companyNews,
    isFinnhubConfigured,
    MAX_TICKERS_PER_CALL,
    snapshots,
    upcomingEarnings,
    type Snapshot,
} from './finnhub';
import {
    filingsOf,
    money,
    NEAR_LOW,
    pct,
    publishedLists,
    screenMomentum,
    screenValue,
    TOP_N,
    type ListKind,
    type Market,
    type ScreenResult,
} from './screens';

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
// Market data: SEC filings, Finnhub prices, and the screens built on both
// ---------------------------------------------------------------------------

const tickerList = (v: unknown): string[] =>
    (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []).map((x) => String(x).trim()).filter(Boolean);

const urlLocators = (urls: string[]): SourceLocator[] => [...new Set(urls)].map((url) => ({ kind: 'url', url }));

/** One company's fundamentals as the agent reads them, figures first, filings after. */
function describeFundamentals(f: Fundamentals): string {
    const cur = f.currency;
    const lines = [
        `${f.ticker} — ${f.name} (${f.taxonomy === 'ifrs-full' ? 'IFRS' : 'US GAAP'}, ${cur})${f.revenue ? ` — fiscal year to ${f.revenue.end}` : ''}`,
    ];
    const rev = f.revenue ? `revenue ${money(f.revenue.value, cur)}${f.revenueGrowth !== undefined ? ` (${pct(f.revenueGrowth)} y/y)` : ''}` : null;
    const ni = f.netIncome ? `net income ${money(f.netIncome.value, cur)}${f.earningsGrowth !== undefined ? ` (${pct(f.earningsGrowth)} y/y)` : ''}` : null;
    if (rev || ni) lines.push(`  ${[rev, ni].filter(Boolean).join(' · ')}`);
    if (f.freeCashFlow !== undefined) {
        lines.push(
            `  operating cash flow ${money(f.operatingCashFlow?.value, cur)} − capex ${money(Math.abs(f.capex?.value ?? 0), cur)} = free cash flow ${money(f.freeCashFlow, cur)}${f.fcfMargin !== undefined ? ` (margin ${pct(f.fcfMargin)})` : ''}`
        );
    }
    if (f.debt) {
        lines.push(
            `  debt ${money(f.debt.value, cur)} · cash ${money(f.cash?.value, cur)} · net debt ${money(f.netDebt, cur)}${f.netDebtToFcf !== undefined ? ` = ${f.netDebtToFcf.toFixed(1)} years of free cash flow` : ''}${f.debtToEquity !== undefined ? ` · debt/equity ${f.debtToEquity.toFixed(2)}` : ''}`
        );
    }
    if (f.quarterlyGrowth) {
        const q = f.quarterlyGrowth;
        lines.push(`  latest quarter sales ${pct(q.latest)} y/y, previous quarter ${pct(q.previous)} — ${q.accelerating ? 'accelerating' : 'not accelerating'}`);
    }
    const filings = filingsOf(f);
    if (filings.length) lines.push(`  from: ${filings.join(' , ')}`);
    return lines.join('\n');
}

function describeSnapshot(s: Snapshot): string {
    const lines = [`${s.symbol}${s.asked.toUpperCase() !== s.symbol ? ` (asked as ${s.asked})` : ''} — as of ${s.asOf}${s.note ? ` — ${s.note}` : ''}`];
    lines.push(
        `  price ${s.price.toFixed(2)} (day ${s.dayChangePct !== undefined ? `${s.dayChangePct >= 0 ? '+' : '−'}${Math.abs(s.dayChangePct).toFixed(2)}%` : '—'}) · 5-day ${fmtPts(s.ret5d)} · 13-week ${fmtPts(s.ret13w)} · 26-week ${fmtPts(s.ret26w)} · 52-week ${fmtPts(s.ret52w)}`
    );
    if (s.low52 !== undefined && s.high52 !== undefined) {
        lines.push(
            `  52-week range ${s.low52.toFixed(2)}${s.low52Date ? ` (${s.low52Date})` : ''} – ${s.high52.toFixed(2)}${s.high52Date ? ` (${s.high52Date})` : ''} → ${pct(s.aboveLow)} above the low, ${pct(s.belowHigh !== undefined ? -s.belowHigh : undefined)} from the high`
        );
    }
    const ratios = [
        s.pe !== undefined ? `P/E ${s.pe.toFixed(1)}` : null,
        s.fcfYield !== undefined ? `FCF yield ${s.fcfYield.toFixed(1)}%` : null,
        s.debtToEquity !== undefined ? `debt/equity ${s.debtToEquity.toFixed(2)}` : null,
        s.dividendYield !== undefined ? `dividend yield ${s.dividendYield.toFixed(2)}%` : null,
        s.beta !== undefined ? `beta ${s.beta.toFixed(2)}` : null,
        s.marketCapM !== undefined ? `market value ${money(s.marketCapM * 1e6)}` : null,
    ].filter(Boolean);
    if (ratios.length) lines.push(`  ${ratios.join(' · ')}`);
    if (s.volumeRatio !== undefined) {
        // The ratio only: it holds whatever unit the averages come in.
        lines.push(`  volume: 10-day average ${s.volumeRatio.toFixed(2)}× the 3-month average`);
    }
    const rs = [
        s.rs4w !== undefined ? `4-week ${fmtPts(s.rs4w)}` : null,
        s.rs13w !== undefined ? `13-week ${fmtPts(s.rs13w)}` : null,
        s.rs26w !== undefined ? `26-week ${fmtPts(s.rs26w)}` : null,
    ].filter(Boolean);
    if (rs.length) lines.push(`  relative to the S&P 500: ${rs.join(' · ')}`);
    if (s.missing.length) lines.push(`  not reported: ${s.missing.join(', ')}`);
    return lines.join('\n');
}

const fmtPts = (v: number | undefined) =>
    v === undefined || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`;

const snapshotLocator = (s: Snapshot): SourceLocator => ({ kind: 'series', seriesId: `FINNHUB:${s.symbol}`, date: s.asOf });

/** The method note first: a screen that hid how it was built would read as a full-market scan. */
function describeScreen(r: ScreenResult): { content: string; locators: SourceLocator[] } {
    const origins = new Map<string, number>();
    for (const row of r.rows) for (const o of row.origins) origins.set(o, (origins.get(o) ?? 0) + 1);

    const head = [
        `HOW THIS ${r.kind.toUpperCase()} SCREEN WAS BUILT — emulated from free sources, not a scan of every listed stock.`,
        `Stages: ${r.stages.map((st) => `${st.count} ${st.label}`).join(' → ')}.`,
        `Data: SEC filings (latest fiscal year and quarters)${r.priced ? '; Finnhub prices, 52-week ranges and returns' : ''}.`,
        `Not checked: ${r.notChecked.join('; ')}.`,
        '',
    ];

    const locators: SourceLocator[] = [];
    const body = r.rows.map((row, i) => {
        const f = row.fundamentals;
        const s = row.snapshot;
        const bits = [
            s ? `price ${s.price.toFixed(2)} (${s.asOf})` : null,
            s?.aboveLow !== undefined ? `${pct(s.aboveLow)} above the 52-week low` : null,
            s?.ret13w !== undefined ? `13-week ${fmtPts(s.ret13w)}` : null,
            s?.ret26w !== undefined ? `26-week ${fmtPts(s.ret26w)}` : null,
            f?.freeCashFlow !== undefined ? `FCF ${money(f.freeCashFlow, f.currency)}` : null,
            f?.fcfMargin !== undefined ? `FCF margin ${pct(f.fcfMargin)}` : null,
            f?.netDebtToFcf !== undefined ? `net debt ${f.netDebtToFcf.toFixed(1)} yrs of FCF` : null,
            f?.quarterlyGrowth ? `latest-quarter sales ${pct(f.quarterlyGrowth.latest)}` : null,
            s?.pe !== undefined ? `P/E ${s.pe.toFixed(1)}` : null,
            s?.volumeRatio !== undefined ? `volume ${s.volumeRatio.toFixed(2)}× normal` : null,
        ].filter(Boolean);
        if (s) locators.push(snapshotLocator(s));
        const filings = filingsOf(f);
        locators.push(...urlLocators(filings));
        return [
            `${i + 1}. ${row.symbol} — ${row.name} (${row.origins.join('; ') || 'candidate'})`,
            `   ${bits.join(' · ') || 'no figures'}`,
            ...(row.flags.length ? [`   flags: ${row.flags.join('; ')}`] : []),
            ...(filings.length ? [`   filings: ${filings.join(' , ')}`] : []),
        ].join('\n');
    });

    const tail = r.unscreened.length
        ? [
              '',
              `NOT SCREENED BY THE NUMBERS (${r.unscreened.length}) — no free data; report these only from web-sourced facts, and say so:`,
              ...r.unscreened.map((u) => `- ${u.symbol}: ${u.why}`),
          ]
        : [];

    return {
        content: [
            ...head,
            r.rows.length ? `Top ${Math.min(r.rows.length, TOP_N)}:` : 'Nothing passed every test. Say so plainly rather than loosening the tests.',
            ...body,
            ...tail,
            '',
            'Cite a price figure as {kind:"series", seriesId:"FINNHUB:<SYMBOL>", date} and a fundamental as the filing URL shown with it.',
        ].join('\n'),
        locators,
    };
}

const secFundamentalsTool: ChannelTool = {
    declaration: {
        name: 'sec_fundamentals',
        description:
            'Official fundamentals from SEC filings for US-listed companies (and Canadian or foreign companies that file with the SEC): revenue and growth, net income, operating cash flow, capex, free cash flow and margin, debt, cash, leverage, and whether sales growth is accelerating. Every figure comes with the filing it was reported in. No share prices.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                tickers: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                    description: 'US ticker symbols, e.g. AAPL, CNI, CCJ. For a Toronto listing use its US ticker if it has one.',
                },
            },
            required: ['tickers'],
        },
    },
    async execute(args) {
        const { found, unknown, noData } = await fundamentalsFor(tickerList(args.tickers).slice(0, 40));
        const blocks = found.map(describeFundamentals);
        if (unknown.length) blocks.push(`SEC has no company with the ticker ${unknown.join(', ')}. Do not assert fundamentals for ${unknown.length === 1 ? 'it' : 'them'} from this tool.`);
        if (noData.length) blocks.push(`SEC knows ${noData.join(', ')} but has no usable financial data for ${noData.length === 1 ? 'it' : 'them'}.`);
        return {
            content: [...blocks, 'Cite a figure as the filing URL shown with it.'].join('\n\n'),
            locators: urlLocators(found.flatMap(filingsOf)),
        };
    },
};

const secFilingsTool: ChannelTool = {
    declaration: {
        name: 'sec_filings',
        description:
            'Recent SEC filings for companies — earnings releases, material events, leadership changes, annual and quarterly reports — each with a plain description and a link. Use for catalysts and corporate events.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                tickers: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'US ticker symbols.' },
                days: { type: Type.INTEGER, description: 'How far back, in days (default 30).' },
            },
            required: ['tickers'],
        },
    },
    async execute(args) {
        const days = args.days ? Number(args.days) : 30;
        const { filings, unknown } = await recentFilings(tickerList(args.tickers).slice(0, 40), days);
        const lines = filings.map((f) => `- ${f.filed} ${f.ticker} ${f.form}: ${f.what}\n  ${f.url}`);
        return {
            content: [
                filings.length ? `${filings.length} filings in the last ${days} days:\n${lines.join('\n')}` : `No filings in the last ${days} days.`,
                ...(unknown.length ? [`SEC has no company with the ticker ${unknown.join(', ')}.`] : []),
                'Cite the exact filing URLs above.',
            ].join('\n\n'),
            locators: urlLocators(filings.map((f) => f.url)),
        };
    },
};

const secLeadersTool: ChannelTool = {
    declaration: {
        name: 'sec_quality_leaders',
        description:
            'Rank the whole US market on fundamentals alone, from SEC filings. "value": profitable, cash-generative companies whose net debt is at most four years of free cash flow. "momentum": companies whose sales are growing and accelerating. Revenue of at least $500M stands in for size. No prices — pair with market_snapshot or a screen.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                style: { type: Type.STRING, enum: ['value', 'momentum'], description: 'Which kind of strength to rank on.' },
                limit: { type: Type.INTEGER, description: 'How many to return (default 25, max 100).' },
            },
            required: ['style'],
        },
    },
    async execute(args) {
        const style = args.style === 'momentum' ? 'momentum' : 'value';
        const leaders = await qualityLeaders(style, args.limit ? Number(args.limit) : 25);
        return {
            content: [
                `The ${leaders.length} strongest US companies on ${style === 'value' ? 'cash generation, profit and manageable debt' : 'accelerating sales growth'}, from SEC filings${style === 'value' ? ` (net debt ≤ ${MAX_DEBT_YEARS} years of free cash flow)` : ''}:`,
                '',
                leaders.map((l, i) => `${i + 1}. ${describeFundamentals(l.fundamentals)}`).join('\n\n'),
            ].join('\n'),
            locators: urlLocators(leaders.flatMap((l) => filingsOf(l.fundamentals))),
        };
    },
};

const publishedListsTool: ChannelTool = {
    declaration: {
        name: 'published_stock_lists',
        description:
            'Collect the stock lists finance sites and the TSX publish — stocks near their 52-week lows, or momentum leaders — for the US or Canada, through web search. Returns each source with its link and date, the symbols it names, and how many independent sources named each. These are candidates to screen, not conclusions: pass the symbols to screen_value or screen_momentum.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                list: { type: Type.STRING, enum: ['near_52_week_lows', 'momentum_leaders'], description: 'Which kind of list.' },
                market: { type: Type.STRING, enum: ['us', 'canada'], description: 'US exchanges or the Toronto Stock Exchange.' },
            },
            required: ['list', 'market'],
        },
    },
    async execute(args) {
        if (!isPerplexityConfigured()) {
            return { content: 'Web search is not configured, so published lists cannot be read. Assert nothing from this call.', locators: [] };
        }
        const list = (args.list === 'momentum_leaders' ? 'momentum_leaders' : 'near_52_week_lows') as ListKind;
        const market = (args.market === 'canada' ? 'canada' : 'us') as Market;
        const r = await publishedLists(list, market);

        if (!r.sources.length) {
            return {
                content: `No list could be traced to a page the search actually read${r.dropped.uncited ? ` (${r.dropped.uncited} symbols came from sources it could not cite, and were dropped)` : ''}. Assert nothing from this call.`,
                locators: [],
                searchRequests: 1,
            };
        }

        return {
            content: [
                `${r.sources.length} published ${list === 'near_52_week_lows' ? '52-week-low' : 'momentum'} list(s) for ${market === 'us' ? 'US exchanges' : 'the TSX'}:`,
                ...r.sources.map((s) => `- ${s.name}${s.asOf ? ` (as of ${s.asOf})` : ''}: ${s.symbols.join(', ')}\n  ${s.url}`),
                '',
                `Named by more than one source: ${r.symbols.filter((x) => x.sources > 1).map((x) => `${x.symbol} (${x.sources})`).join(', ') || 'none'}.`,
                ...(r.dropped.uncited ? [`Dropped ${r.dropped.uncited} symbols from sources the search could not cite.`] : []),
                ...(r.dropped.unknown.length ? [`Dropped symbols SEC has never heard of: ${r.dropped.unknown.join(', ')}.`] : []),
                '',
                'These lists skew towards small, distressed companies. They are candidates, not findings: screen them before naming any. Cite the list URLs above.',
            ].join('\n'),
            locators: urlLocators(r.sources.map((s) => s.url)),
            searchRequests: 1,
        };
    },
};

const screenValueTool: ChannelTool = {
    declaration: {
        name: 'screen_value',
        description: `Value screen: stocks within ${NEAR_LOW * 100}% of their 52-week low with positive free cash flow, profit (or a clear recovery) and net debt of at most ${MAX_DEBT_YEARS} years of free cash flow, ranked. Candidates are the ones you pass (e.g. from published_stock_lists, or a watchlist) plus the strongest US companies from SEC filings. Returns the top ${TOP_N} with a note on exactly how the screen was built.`,
        parameters: {
            type: Type.OBJECT,
            properties: {
                candidates: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                    description: 'Ticker symbols to include, US or Toronto (e.g. CNR.TO).',
                },
            },
        },
    },
    async execute(args) {
        return describeScreen(await screenValue(tickerList(args.candidates)));
    },
};

const screenMomentumTool: ChannelTool = {
    declaration: {
        name: 'screen_momentum',
        description: `Momentum screen: stocks up over both 13 and 26 weeks, ranked on strength relative to the S&P 500, volume confirmation and accelerating sales, with over-extended runs flagged. Candidates are the ones you pass (e.g. from published_stock_lists) plus the US companies whose sales growth is accelerating in SEC filings. Returns the top ${TOP_N} with a note on exactly how the screen was built.`,
        parameters: {
            type: Type.OBJECT,
            properties: {
                candidates: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                    description: 'Ticker symbols to include, US or Toronto (e.g. SHOP.TO).',
                },
            },
        },
    },
    async execute(args) {
        return describeScreen(await screenMomentum(tickerList(args.candidates)));
    },
};

const marketSnapshotTool: ChannelTool = {
    declaration: {
        name: 'market_snapshot',
        description: `Current price, day and 5-day moves, 13-, 26- and 52-week returns, the 52-week range and how far the price sits from each end, P/E, free-cash-flow yield, dividend yield, market value, volume against its norm, and strength relative to the S&P 500 — for up to ${MAX_TICKERS_PER_CALL} US-listed stocks. Toronto listings are covered only through a verified US listing (e.g. CNR.TO via CNI, in USD).`,
        parameters: {
            type: Type.OBJECT,
            properties: {
                tickers: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                    description: 'Ticker symbols, US or Toronto (e.g. NVDA, CNR.TO).',
                },
            },
            required: ['tickers'],
        },
    },
    async execute(args) {
        const { found, unavailable } = await snapshots(tickerList(args.tickers));
        const blocks = found.map(describeSnapshot);
        if (unavailable.length) {
            blocks.push(
                `No free price data for:\n${unavailable.map((u) => `- ${u.symbol}: ${u.why}`).join('\n')}\nDo not assert prices for these from this tool.`
            );
        }
        return {
            content: [
                ...blocks,
                found.length ? 'Cite any of these as {kind:"series", seriesId:"FINNHUB:<SYMBOL>", date} with the as-of date shown.' : 'NOTHING CITABLE RETURNED.',
            ].join('\n\n'),
            locators: found.map(snapshotLocator),
        };
    },
};

const companyNewsTool: ChannelTool = {
    declaration: {
        name: 'company_news',
        description: `Recent news headlines for up to ${MAX_TICKERS_PER_CALL} US-listed companies, with links. Toronto listings only through a verified US listing.`,
        parameters: {
            type: Type.OBJECT,
            properties: {
                tickers: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Ticker symbols.' },
                days: { type: Type.INTEGER, description: 'How far back, in days (default 7).' },
            },
            required: ['tickers'],
        },
    },
    async execute(args) {
        const days = args.days ? Number(args.days) : 7;
        const items = await companyNews(tickerList(args.tickers), days);
        return {
            content: items.length
                ? [`${items.length} headlines, last ${days} days:`, ...items.map((n) => `- [${n.symbol}] ${n.published} ${n.source}: ${n.headline}\n  ${n.url}`), '', 'Cite the exact URLs above.'].join('\n')
                : `No headlines in the last ${days} days.`,
            locators: urlLocators(items.map((n) => n.url)),
        };
    },
};

const upcomingEarningsTool: ChannelTool = {
    declaration: {
        name: 'upcoming_earnings',
        description: `Scheduled earnings dates in the next weeks for up to ${MAX_TICKERS_PER_CALL} US-listed companies, with the consensus EPS estimate where there is one.`,
        parameters: {
            type: Type.OBJECT,
            properties: {
                tickers: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Ticker symbols.' },
                days: { type: Type.INTEGER, description: 'How far ahead, in days (default 30).' },
            },
            required: ['tickers'],
        },
    },
    async execute(args) {
        const days = args.days ? Number(args.days) : 30;
        const events = await upcomingEarnings(tickerList(args.tickers), days);
        return {
            content: events.length
                ? [
                      `Earnings in the next ${days} days:`,
                      ...events.map((e) => `- ${e.date} ${e.symbol}, ${e.hour}${e.epsEstimate !== undefined ? ` — EPS estimate ${e.epsEstimate}` : ''}`),
                      '',
                      'Cite a date as {kind:"series", seriesId:"FINNHUB:<SYMBOL>:earnings", date}.',
                  ].join('\n')
                : `No earnings scheduled in the next ${days} days for these companies.`,
            locators: events.map((e) => ({ kind: 'series' as const, seriesId: `FINNHUB:${e.symbol}:earnings`, date: e.date })),
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
    sec: [
        secFundamentalsTool,
        secFilingsTool,
        secLeadersTool,
        publishedListsTool,
        screenValueTool,
        screenMomentumTool,
    ],
    finnhub: [marketSnapshotTool, companyNewsTool, upcomingEarningsTool],
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
    sec: 'Official US company fundamentals and filings from the SEC — revenue, profit, free cash flow, debt, growth, recent events — plus Delphi\'s value and momentum stock screens, built from those filings, published stock lists and (with Finnhub) prices. No share prices on its own; no Toronto-only companies.',
    finnhub: 'US stock prices, 52-week ranges, returns over several windows, relative strength, volume, valuation ratios, company news and earnings dates (free tier). No price history, and no Toronto-only companies except through a verified US listing.',
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
        case 'sec':
            return isSecConfigured();
        case 'finnhub':
            return isFinnhubConfigured();
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
    sec: async () => (await import('./sec')).checkSecHealth,
    finnhub: async () => (await import('./finnhub')).checkFinnhubHealth,
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
