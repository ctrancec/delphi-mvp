/**
 * Stock screens built from free sources — emulated, and said to be.
 *
 * A real screen scans every listed stock against price and fundamental rules
 * at once. Without a paid feed Delphi cannot, so it assembles a bounded set of
 * candidates from three free places, checks each against the numbers, and
 * ranks what survives:
 *
 *   - SEC filings, for the strongest companies in the whole US market on
 *     fundamentals alone;
 *   - lists that exchanges and finance sites publish (52-week lows, top
 *     performers), read through web search;
 *   - whatever the agent was asked about, such as the CHO's watchlist.
 *
 * Every screen says exactly that at the top — where its candidates came
 * from, how many survived each stage, and what could not be checked. A
 * screen that looked like a full-market scan but was not one would be a
 * polished misstatement, which is the one thing Delphi must not produce.
 *
 * All ranking arithmetic happens here. The agent receives the result.
 */

import { webSearch } from './perplexity';
import {
    fcfDoesNotApply,
    filingUrl,
    fundamentalsFor,
    isSecConfigured,
    MAX_DEBT_YEARS,
    normalizeUsTicker,
    qualityLeaders,
    secCompanies,
    type Figure,
    type Fundamentals,
} from './sec';
import { isFinnhubConfigured, resolveListing, snapshots, type Resolution, type Snapshot } from './finnhub';

/** Most candidates a screen will price — two Finnhub calls each, 55 a minute. */
export const MAX_CANDIDATES = 40;
export const TOP_N = 20;
/** "Near the 52-week low", per the charter: within roughly ten percent. */
export const NEAR_LOW = 0.1;

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function money(v: number | undefined, currency = 'USD'): string {
    if (v === undefined || !Number.isFinite(v)) return '—';
    const sign = v < 0 ? '−' : '';
    const a = Math.abs(v);
    const unit = a >= 1e12 ? [1e12, 'T'] : a >= 1e9 ? [1e9, 'B'] : a >= 1e6 ? [1e6, 'M'] : [1, ''];
    const prefix = currency === 'USD' ? '$' : `${currency} `;
    return `${sign}${prefix}${(a / (unit[0] as number)).toFixed(a >= 1e9 ? 2 : 1)}${unit[1]}`;
}

export const pct = (v: number | undefined, digits = 1) =>
    v === undefined || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(digits)}%`;

// ---------------------------------------------------------------------------
// Published lists
// ---------------------------------------------------------------------------

export type ListKind = 'near_52_week_lows' | 'momentum_leaders';
export type Market = 'us' | 'canada';

const LIST_PROMPTS: Record<ListKind, Record<Market, string>> = {
    near_52_week_lows: {
        us: 'Which US-listed stocks are currently at or near their 52-week lows? Use published lists such as MarketBeat\'s 52-week lows, Barchart\'s new lows, TradingView\'s 52-week-low movers, and articles naming quality stocks near their lows. Leave out companies worth less than about $1 billion. For each source, give its name, its exact URL, the date the list is as of, and the ticker symbols it names.',
        canada: 'Which Toronto Stock Exchange stocks are currently at or near their 52-week lows? Use published lists such as TMX Money\'s 52-week-low stock list, MarketBeat Canada\'s 52-week lows, Barchart Canada\'s new lows, TradingView Canada\'s 52-week-low movers, and articles naming quality TSX stocks near their lows. Leave out companies worth less than about C$500 million. For each source, give its name, its exact URL, the date the list is as of, and the ticker symbols it names.',
    },
    momentum_leaders: {
        us: 'Which US-listed stocks have the strongest price momentum over the last three to six months? Use published lists such as Barchart\'s Top 100 stocks, TradingView\'s top performers, IBD 50 and similar momentum rankings. Only include stocks a source names for strength — leave out oversold, laggard or worst-performer lists, even when they appear in the same article. Leave out companies worth less than about $1 billion. For each source, give its name, its exact URL, the date the list is as of, and the ticker symbols it names.',
        canada: 'Which Toronto Stock Exchange stocks have the strongest price momentum over the last three to six months? Use published lists such as TMX Money stock lists, TradingView Canada\'s top performers and Globe and Mail momentum rankings. Only include stocks a source names for strength — leave out oversold, laggard or worst-performer lists, even when they appear in the same article. Leave out companies worth less than about C$500 million. For each source, give its name, its exact URL, the date the list is as of, and the ticker symbols it names.',
    },
};

const LIST_SCHEMA = {
    name: 'stock_lists',
    schema: {
        type: 'object',
        properties: {
            sources: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        name: { type: 'string' },
                        url: { type: 'string' },
                        asOf: { type: 'string' },
                        symbols: { type: 'array', items: { type: 'string' } },
                    },
                    required: ['name', 'url', 'symbols'],
                },
            },
        },
        required: ['sources'],
    },
};

export interface ListSource {
    name: string;
    url: string;
    asOf?: string;
    symbols: string[];
}

export interface PublishedLists {
    list: ListKind;
    market: Market;
    sources: ListSource[];
    /** Each symbol, and how many independent sources named it. */
    symbols: { symbol: string; sources: number }[];
    dropped: { uncited: number; unknown: string[] };
}

const host = (u: string) => {
    try {
        return new URL(u).hostname.replace(/^www\./, '');
    } catch {
        return '';
    }
};

/**
 * Keep only what can be traced. A source whose URL is not among the pages the
 * search actually returned is dropped with everything it named — a list the
 * model remembered rather than read is not a source. US symbols SEC has never
 * heard of are dropped too.
 */
/**
 * A Toronto symbol in one form, however a site writes it: `KNT-T` (Globe and
 * Mail), `AP-UN-T` (a trust unit there), `AP-UN.TO` (Yahoo), `TSX:ENB`, or
 * bare. TSX Venture names (`-X`, `.V`) keep their own suffix.
 */
export function normalizeTsxSymbol(raw: string): string | null {
    let s = raw.trim().toUpperCase().replace(/^(TSXV|TSX|TSE|CVE)[:\s]+/, '');
    let venture = false;
    const main = s.match(/^(.+?)(?:\.TO|\.TSX|:CA|-T|\.T)$/);
    const junior = s.match(/^(.+?)(?:\.V|-X|\.CN)$/);
    if (main) s = main[1];
    else if (junior) {
        s = junior[1];
        venture = true;
    }
    s = s.replace(/-/g, '.');
    if (!/^[A-Z][A-Z0-9.]{0,9}$/.test(s)) return null;
    return `${s}${venture ? '.V' : '.TO'}`;
}

/** A page, ignoring query strings, fragments and a trailing slash. */
const pageKey = (u: string) => {
    try {
        const x = new URL(u);
        return `${x.origin}${x.pathname.replace(/\/$/, '')}`;
    } catch {
        return u;
    }
};

/**
 * The returned page a source's URL refers to, or nothing.
 *
 * An exact page match, or — when the model's version of the URL is slightly
 * off — the site's only returned page. Never a guess between several pages on
 * one site: seen live, that picked a site's unrelated "Monday pick" page as the
 * source for a list of 52-week lows. A citation that points somewhere else is
 * worse than none.
 */
export function citedPage(url: string | undefined, citations: string[]): string | undefined {
    if (!url) return undefined;
    const exact = citations.find((c) => pageKey(c) === pageKey(url));
    if (exact) return exact;
    const sameSite = citations.filter((c) => host(c) === host(url));
    return sameSite.length === 1 ? sameSite[0] : undefined;
}

export function vetLists(
    parsed: { sources?: Partial<ListSource>[] },
    citations: string[],
    market: Market,
    knownUs: Set<string> | null
): { sources: ListSource[]; uncited: number; unknown: string[] } {
    const sources: ListSource[] = [];
    let uncited = 0;
    const unknown = new Set<string>();

    for (const s of parsed.sources ?? []) {
        const symbols = (s.symbols ?? []).map(String);
        const citedUrl = citedPage(s.url, citations);
        if (!citedUrl) {
            uncited += symbols.length;
            continue;
        }

        const clean: string[] = [];
        for (const raw of symbols) {
            if (market === 'canada') {
                const tsx = normalizeTsxSymbol(raw);
                if (tsx) clean.push(tsx);
                continue;
            }
            const sym = raw.trim().toUpperCase().replace(/^(NYSE|NASDAQ|AMEX)[:\s]+/, '');
            if (!/^[A-Z][A-Z0-9.\-]{0,7}$/.test(sym)) continue;
            const us = normalizeUsTicker(sym);
            if (knownUs && !knownUs.has(us)) unknown.add(us);
            else clean.push(us);
        }
        if (clean.length) {
            sources.push({ name: s.name ?? host(citedUrl), url: citedUrl, asOf: s.asOf, symbols: [...new Set(clean)] });
        }
    }
    return { sources, uncited, unknown: [...unknown] };
}

export async function publishedLists(list: ListKind, market: Market): Promise<PublishedLists> {
    const result = await webSearch(LIST_PROMPTS[list][market], { recencyDays: 7, jsonSchema: LIST_SCHEMA });

    let parsed: { sources?: Partial<ListSource>[] } = {};
    try {
        parsed = JSON.parse(result.answer);
    } catch {
        parsed = {};
    }

    const knownUs = market === 'us' && isSecConfigured() ? new Set((await secCompanies()).byTicker.keys()) : null;
    const vetted = vetLists(parsed, result.citations, market, knownUs);

    return {
        list,
        market,
        sources: vetted.sources,
        symbols: tally(vetted.sources),
        dropped: { uncited: vetted.uncited, unknown: vetted.unknown },
    };
}

/** How many independent sources named each symbol, most-agreed first. */
export function tally(sources: ListSource[]): { symbol: string; sources: number }[] {
    const counts = new Map<string, number>();
    for (const s of sources) for (const sym of new Set(s.symbols)) counts.set(sym, (counts.get(sym) ?? 0) + 1);
    return [...counts.entries()]
        .map(([symbol, n]) => ({ symbol, sources: n }))
        .sort((a, b) => b.sources - a.sources || a.symbol.localeCompare(b.symbol));
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

export interface ScreenRow {
    symbol: string;
    name: string;
    score: number;
    fundamentals?: Fundamentals;
    snapshot?: Snapshot;
    flags: string[];
    origins: string[];
}

export interface ScreenResult {
    kind: 'value' | 'momentum';
    rows: ScreenRow[];
    /** Candidates with no free route to their numbers, listed rather than ranked. */
    unscreened: { symbol: string; why: string; origins: string[] }[];
    stages: { label: string; count: number }[];
    notChecked: string[];
    priced: boolean;
}

/** Where each candidate came from, so the method note can say. */
function pool(
    provided: string[],
    leaders: string[],
    kind: 'value' | 'momentum'
): { symbols: string[]; origins: Map<string, string[]> } {
    const origins = new Map<string, string[]>();
    const add = (s: string, o: string) => {
        const key = s.trim().toUpperCase();
        if (!key) return;
        origins.set(key, [...(origins.get(key) ?? []), o]);
    };
    for (const s of provided) add(s, 'named by the agent');
    for (const s of leaders) add(s, kind === 'value' ? 'SEC quality leader' : 'SEC growth leader');
    return { symbols: [...origins.keys()].slice(0, MAX_CANDIDATES), origins };
}

/**
 * Only a free-cash-flow yield whose two halves are in the same currency.
 * Toyota reports in yen; dividing yen of cash flow by a dollar market value
 * would be a number with no meaning that still looks like one.
 */
export function fcfYieldOf(f: Fundamentals | undefined, s: Snapshot | undefined): number | undefined {
    if (s?.fcfYield !== undefined) return s.fcfYield / 100;
    if (!f?.freeCashFlow || !s?.marketCapM || f.currency !== 'USD') return undefined;
    return f.freeCashFlow / (s.marketCapM * 1e6);
}

async function gather(symbols: string[]) {
    const resolved = await Promise.all(symbols.map((s) => resolveListing(s)));
    const usSymbols = resolved.filter((r) => r.us).map((r) => r.us!) as string[];

    const funds = isSecConfigured()
        ? await fundamentalsFor(usSymbols)
        : { found: [], unknown: [], noData: [], stale: [] };
    const bySym = new Map(funds.found.map((f) => [f.ticker, f]));
    // US tickers whose newest SEC figures are too old to screen on, and how old.
    const staleBy = new Map(funds.stale.map((s) => [s.ticker, s.latestEnd]));

    const priced = isFinnhubConfigured();
    const snaps = priced ? await snapshots(symbols) : { found: [], unavailable: [] };
    const snapBy = new Map(snaps.found.map((s) => [s.asked.toUpperCase(), s]));

    return { resolved, bySym, staleBy, snapBy, priced };
}

/** Why a candidate could not be screened, as precisely as the data allows. */
function whyUnscreened(r: Resolution, staleBy: Map<string, string>): string {
    const old = r.us ? staleBy.get(r.us) : undefined;
    return old ? `SEC's newest figures are for the fiscal year to ${old}, too old to screen on` : (r.note ?? 'no free data found');
}

export async function screenValue(candidates: string[] = []): Promise<ScreenResult> {
    const leaders = isSecConfigured() ? (await qualityLeaders('value', 25)).map((l) => l.fundamentals.ticker) : [];
    const { symbols, origins } = pool(candidates, leaders, 'value');
    const { resolved, bySym, staleBy, snapBy, priced } = await gather(symbols);

    const rows: ScreenRow[] = [];
    const unscreened: ScreenResult['unscreened'] = [];
    let withNumbers = 0;
    let nearLow = 0;
    let sound = 0;

    for (const r of resolved) {
        const key = r.asked.toUpperCase();
        const f = r.us ? bySym.get(r.us) : undefined;
        const s = snapBy.get(key);
        if (!r.us || (!f && !s)) {
            unscreened.push({ symbol: r.asked, why: whyUnscreened(r, staleBy), origins: origins.get(key) ?? [] });
            continue;
        }
        // A bank, an insurer, or cash flow larger than sales: listed, never ranked.
        const notMeasured = f ? fcfDoesNotApply(f) : null;
        if (notMeasured) {
            unscreened.push({ symbol: r.asked, why: notMeasured, origins: origins.get(key) ?? [] });
            continue;
        }
        withNumbers++;

        // Price position: the charter's first test. Unknown without prices.
        if (priced) {
            if (s?.aboveLow === undefined || s.aboveLow > NEAR_LOW) continue;
            nearLow++;
        }

        // Fundamentals: free cash flow, profit or a recovery, debt it can carry.
        const flags: string[] = [];
        if (f) {
            if (f.freeCashFlow === undefined || f.freeCashFlow <= 0) continue;
            const profitable = f.netIncome && f.netIncome.value > 0;
            const recovering =
                f.netIncome && f.netIncomePrior && f.netIncome.value > f.netIncomePrior.value;
            if (!profitable && !recovering) continue;
            if (f.netDebtToFcf !== undefined && f.netDebtToFcf > MAX_DEBT_YEARS) continue;
            if (!profitable) flags.push('loss-making but improving — speculative');
            // Unknown debt passes the leverage test only because it cannot be failed; say so.
            if (!f.debt) flags.push('no debt figure in SEC data — leverage not checked');
            if (f.revenueGrowth !== undefined && f.revenueGrowth < -0.1) flags.push('revenue shrinking over 10% — possible value trap');
        } else {
            const old = staleBy.get(r.us);
            flags.push(old ? `SEC figures out of date (fiscal year to ${old}) — price test only` : 'no SEC fundamentals — price test only');
        }
        sound++;

        const yieldFcf = fcfYieldOf(f, s);
        const closeness = s?.aboveLow !== undefined ? 1 - s.aboveLow / NEAR_LOW : 0;
        const margin = Math.min(Math.max(f?.fcfMargin ?? 0, 0), 0.4);
        const score = (yieldFcf !== undefined ? Math.min(yieldFcf, 0.15) * 4 : 0) + margin + closeness * 0.3;

        rows.push({
            symbol: r.us!,
            name: f?.name ?? r.asked,
            score,
            fundamentals: f,
            snapshot: s,
            flags,
            origins: origins.get(key) ?? [],
        });
    }

    rows.sort((a, b) => b.score - a.score);

    return {
        kind: 'value',
        rows: rows.slice(0, TOP_N),
        unscreened,
        priced,
        stages: [
            { label: 'candidates considered', count: symbols.length },
            { label: 'with free data to check', count: withNumbers },
            ...(priced ? [{ label: `within ${NEAR_LOW * 100}% of the 52-week low`, count: nearLow }] : []),
            { label: 'passing the fundamentals tests', count: sound },
            { label: 'ranked and shown', count: Math.min(rows.length, TOP_N) },
        ],
        notChecked: [
            ...(priced ? [] : ['distance from the 52-week low — no Finnhub key, so prices were not checked']),
            'banks, brokers, insurers, REITs, and companies whose free cash flow exceeds their sales — free cash flow does not measure them, so they are listed, not ranked',
            'EV/EBITDA and valuation against sector history — not available from free sources',
            'Toronto-only companies — no free price or fundamentals source; listed separately if named',
        ],
    };
}

export async function screenMomentum(candidates: string[] = []): Promise<ScreenResult> {
    const leaders = isSecConfigured() ? (await qualityLeaders('momentum', 25)).map((l) => l.fundamentals.ticker) : [];
    const { symbols, origins } = pool(candidates, leaders, 'momentum');
    const { resolved, bySym, staleBy, snapBy, priced } = await gather(symbols);

    const rows: ScreenRow[] = [];
    const unscreened: ScreenResult['unscreened'] = [];
    let withNumbers = 0;
    let rising = 0;

    for (const r of resolved) {
        const key = r.asked.toUpperCase();
        const f = r.us ? bySym.get(r.us) : undefined;
        const s = snapBy.get(key);
        if (!r.us || (!f && !s)) {
            unscreened.push({ symbol: r.asked, why: whyUnscreened(r, staleBy), origins: origins.get(key) ?? [] });
            continue;
        }
        withNumbers++;

        const flags: string[] = [];
        let priceScore = 0;
        if (priced && s) {
            // Strength across windows, relative to the S&P 500 where given.
            const windows = [s.rs4w, s.rs13w, s.rs26w].filter((v): v is number => v !== undefined);
            const returns = [s.ret13w, s.ret26w].filter((v): v is number => v !== undefined);
            if (!returns.length || returns.some((v) => v <= 0)) continue;
            rising++;
            const rel = windows.length ? windows.reduce((a, b) => a + b, 0) / windows.length : 0;
            priceScore = Math.min(returns.reduce((a, b) => a + b, 0) / returns.length, 100) / 100 + Math.min(rel, 50) / 100;
            if (s.volumeRatio !== undefined && s.volumeRatio >= 1.1) priceScore += 0.1;
            else if (s.volumeRatio !== undefined && s.volumeRatio < 0.8) flags.push('rising on thinning volume');
            if ((s.ret26w ?? 0) > 60 || ((s.belowHigh ?? 1) < 0.03 && (s.ret13w ?? 0) > 30)) {
                flags.push('extended — vulnerable to a pullback');
            }
        } else if (priced) {
            continue;
        }

        const q = f?.quarterlyGrowth;
        const fundScore = q ? Math.min(Math.max(q.latest, -0.5), 1) * 0.5 + (q.accelerating ? 0.2 : 0) : 0;
        if (q?.accelerating) flags.push('sales growth accelerating');
        if (!priced && !q) continue;

        rows.push({
            symbol: r.us!,
            name: f?.name ?? r.asked,
            score: priceScore + fundScore,
            fundamentals: f,
            snapshot: s,
            flags,
            origins: origins.get(key) ?? [],
        });
    }

    rows.sort((a, b) => b.score - a.score);

    return {
        kind: 'momentum',
        rows: rows.slice(0, TOP_N),
        unscreened,
        priced,
        stages: [
            { label: 'candidates considered', count: symbols.length },
            { label: 'with free data to check', count: withNumbers },
            ...(priced ? [{ label: 'up over both 13 and 26 weeks', count: rising }] : []),
            { label: 'ranked and shown', count: Math.min(rows.length, TOP_N) },
        ],
        notChecked: [
            ...(priced ? [] : ['price momentum, relative strength and volume — no Finnhub key, so ranked on sales growth alone']),
            'earnings-estimate revisions — not available from free sources',
            'Toronto-only companies — no free price or fundamentals source; listed separately if named',
        ],
    };
}

/** Every filing a set of fundamentals rests on, once each. */
export function filingsOf(f: Fundamentals | undefined): string[] {
    if (!f) return [];
    const figs: (Figure | undefined)[] = [
        f.revenue,
        f.revenuePrior,
        f.netIncome,
        f.netIncomePrior,
        f.operatingCashFlow,
        f.capex,
        f.cash,
        f.equity,
        ...(f.debt?.figures ?? []),
        ...(f.quarterlyGrowth?.figures ?? []),
    ];
    return [...new Set(figs.filter((x): x is Figure => Boolean(x)).map((x) => filingUrl(f.cik, x.accn)))];
}
