/**
 * Finnhub, free tier — US stock prices, 52-week ranges, returns and ratios.
 *
 * The price half of Delphi's screening. SEC filings say whether a company is
 * sound; they cannot say whether its shares are near a 52-week low or have
 * been running for six months. Finnhub's free tier can, for US listings: a
 * quote, and "basic financials" carrying the 52-week range, returns over
 * several windows, relative strength against the S&P 500, volume averages and
 * valuation ratios. Price history and price targets are premium, and so is
 * everything outside the US.
 *
 * The free tier allows 60 calls a minute and a stock costs two — basic
 * financials carry no current price. So calls are counted in a sliding
 * minute, results are cached so a run never pays twice for one stock, and
 * each tool takes at most 30 stocks.
 *
 * Toronto listings are reached through their US listing where one exists, and
 * only where that is provably the same company: every mapping is checked
 * against the company name SEC has on file. AC on the NYSE is not Air Canada.
 *
 * Personal, non-commercial use, per Finnhub's free terms — which is what
 * Delphi is.
 */

import { ChannelUnavailableError } from './perplexity';
import { isSecConfigured, normalizeUsTicker, secCompanies } from './sec';

const BASE = 'https://finnhub.io/api/v1';

const WINDOW_MS = 60_000;
/** Finnhub allows 60 a minute; 55 leaves room for a health check. */
const WINDOW_MAX = 55;
const REQUEST_TIMEOUT_MS = 20_000;
/** Quotes move, but a weekly report does not need them fresher than this. */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export const MAX_TICKERS_PER_CALL = 30;

export function isFinnhubConfigured(): boolean {
    return Boolean(process.env.FINNHUB_API_KEY?.trim());
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

const clock = {
    now: () => Date.now(),
    sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
};

let starts: number[] = [];
const cache = new Map<string, { at: number; value: unknown }>();

/** Test seam: a fake clock, an empty window and a cold cache. */
export function setFinnhubClock(fake?: Partial<typeof clock>): void {
    clock.now = fake?.now ?? (() => Date.now());
    clock.sleep = fake?.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    starts = [];
    cache.clear();
}

/**
 * Wait until a call fits in the last minute's budget. A sliding window rather
 * than an even spacing, so a watchlist of twenty goes out at once instead of
 * trickling for forty seconds — the limit is per minute, not per second.
 */
async function slot(): Promise<void> {
    for (;;) {
        const now = clock.now();
        starts = starts.filter((t) => now - t < WINDOW_MS);
        if (starts.length < WINDOW_MAX) {
            starts.push(now);
            return;
        }
        await clock.sleep(starts[0] + WINDOW_MS - now + 10);
    }
}

async function finnhubGet<T>(path: string, params: Record<string, string>): Promise<T> {
    const key = process.env.FINNHUB_API_KEY?.trim();
    if (!key) throw new ChannelUnavailableError('finnhub', 'FINNHUB_API_KEY is not set');

    // The cache key leaves the token out: it identifies the question, not who asked.
    const query = new URLSearchParams(params).toString();
    const cacheKey = `${path}?${query}`;
    const hit = cache.get(cacheKey);
    if (hit && clock.now() - hit.at < CACHE_TTL_MS) return hit.value as T;

    await slot();
    let response: Response;
    try {
        response = await fetch(`${BASE}${path}?${query}&token=${encodeURIComponent(key)}`, {
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
    } catch (err) {
        throw new ChannelUnavailableError('finnhub', (err as Error).message || 'the request failed');
    }

    if (response.status === 401) throw new ChannelUnavailableError('finnhub', 'the key was rejected (401)');
    if (response.status === 403) {
        throw new ChannelUnavailableError('finnhub', `${path} is not on the free plan (403)`);
    }
    if (response.status === 429) throw new ChannelUnavailableError('finnhub', 'rate-limited (429)');
    if (!response.ok) throw new ChannelUnavailableError('finnhub', `${response.status} ${response.statusText}`);

    const value = (await response.json()) as T;
    cache.set(cacheKey, { at: clock.now(), value });
    return value;
}

// ---------------------------------------------------------------------------
// Toronto listings, reached through the US
// ---------------------------------------------------------------------------

/**
 * TSX companies that also list in the US under their own SEC filings. Each is
 * confirmed against SEC's company name before use, so a stale or mistaken
 * entry is rejected, never silently applied.
 */
export const DUAL_LISTED: Record<string, { us: string; name: RegExp }> = {
    CNR: { us: 'CNI', name: /canadian national/i },
    CCO: { us: 'CCJ', name: /cameco/i },
    OTEX: { us: 'OTEX', name: /open ?text/i },
    BB: { us: 'BB', name: /blackberry/i },
    NXE: { us: 'NXE', name: /nexgen/i },
    BIR: { us: 'BIREF', name: /birchcliff/i },
    RY: { us: 'RY', name: /royal bank of canada/i },
    TD: { us: 'TD', name: /toronto.dominion/i },
    BMO: { us: 'BMO', name: /bank of montreal/i },
    BNS: { us: 'BNS', name: /bank of nova scotia/i },
    CM: { us: 'CM', name: /canadian imperial/i },
    ENB: { us: 'ENB', name: /enbridge/i },
    TRP: { us: 'TRP', name: /tc energy/i },
    CNQ: { us: 'CNQ', name: /canadian natural/i },
    SU: { us: 'SU', name: /suncor/i },
    CVE: { us: 'CVE', name: /cenovus/i },
    IMO: { us: 'IMO', name: /imperial oil/i },
    CP: { us: 'CP', name: /canadian pacific/i },
    SHOP: { us: 'SHOP', name: /shopify/i },
    MFC: { us: 'MFC', name: /manulife/i },
    SLF: { us: 'SLF', name: /sun life/i },
    BCE: { us: 'BCE', name: /\bbce\b/i },
    T: { us: 'TU', name: /telus/i },
    NTR: { us: 'NTR', name: /nutrien/i },
    WCN: { us: 'WCN', name: /waste connections/i },
    BN: { us: 'BN', name: /brookfield corp/i },
    BAM: { us: 'BAM', name: /brookfield asset/i },
    FNV: { us: 'FNV', name: /franco.nevada/i },
    WPM: { us: 'WPM', name: /wheaton/i },
    AEM: { us: 'AEM', name: /agnico/i },
    K: { us: 'KGC', name: /kinross/i },
    MG: { us: 'MGA', name: /magna/i },
    QSR: { us: 'QSR', name: /restaurant brands/i },
    'GIB.A': { us: 'GIB', name: /\bcgi\b/i },
    'TECK.B': { us: 'TECK', name: /teck/i },
    TFII: { us: 'TFII', name: /tfi international/i },
    CLS: { us: 'CLS', name: /celestica/i },
    GFL: { us: 'GFL', name: /gfl/i },
    TRI: { us: 'TRI', name: /thomson reuters/i },
    FTS: { us: 'FTS', name: /fortis/i },
    PPL: { us: 'PBA', name: /pembina/i },
    CAE: { us: 'CAE', name: /\bcae\b/i },
    GIL: { us: 'GIL', name: /gildan/i },
};

/** `CNR.TO`, `TSX:CNR`, `cnr:ca` → `CNR`, or null for a US-looking symbol. */
export function tsxBase(symbol: string): string | null {
    const s = symbol.trim().toUpperCase();
    const m = s.match(/^(?:TSX:)?([A-Z][A-Z0-9.\-]*?)(?:\.TO|\.TSX|:CA|\.V|:CN)$/) ?? s.match(/^TSX:([A-Z][A-Z0-9.\-]*)$/);
    return m ? m[1].replace(/-/g, '.') : null;
}

export interface Resolution {
    asked: string;
    /** The US symbol data is fetched for, or null when there is no free route. */
    us: string | null;
    note?: string;
}

/** Where a symbol's free data lives, said plainly when it lives nowhere. */
export async function resolveListing(symbol: string): Promise<Resolution> {
    const base = tsxBase(symbol);
    if (!base) return { asked: symbol, us: normalizeUsTicker(symbol) };

    const entry = DUAL_LISTED[base];
    if (!entry) {
        return { asked: symbol, us: null, note: 'Toronto-only as far as Delphi knows; no free data. Use web search.' };
    }
    if (!isSecConfigured()) {
        return { asked: symbol, us: null, note: `its US listing ${entry.us} cannot be confirmed without SEC access; use web search` };
    }

    const { byTicker } = await secCompanies();
    const company = byTicker.get(entry.us);
    if (!company || !entry.name.test(company.name)) {
        // The whole point of checking: a wrong mapping would present another
        // company's numbers under this one's name.
        return {
            asked: symbol,
            us: null,
            note: `expected ${entry.us} to be the same company, but SEC has ${company ? `"${company.name}"` : 'no such ticker'}; not used`,
        };
    }
    return {
        asked: symbol,
        us: entry.us,
        note: `Toronto listing; figures are for its US listing ${entry.us} (${company.name}), prices in USD`,
    };
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

interface Quote {
    c: number;
    d: number | null;
    dp: number | null;
    t: number;
}

type Metric = Record<string, number | string | null | undefined>;

/** The first of several names a field has gone by that carries a number. */
function num(m: Metric, keys: string[]): number | undefined {
    for (const k of keys) {
        const v = m[k];
        if (typeof v === 'number' && Number.isFinite(v)) return v;
    }
    return undefined;
}

function str(m: Metric, keys: string[]): string | undefined {
    for (const k of keys) {
        const v = m[k];
        if (typeof v === 'string' && v) return v;
    }
    return undefined;
}

/** The fields the screens depend on, and every name each has been seen under. */
export const METRIC_FIELDS = {
    high52: ['52WeekHigh'],
    low52: ['52WeekLow'],
    ret5d: ['5DayPriceReturnDaily'],
    ret13w: ['13WeekPriceReturnDaily'],
    ret26w: ['26WeekPriceReturnDaily'],
    ret52w: ['52WeekPriceReturnDaily'],
    vol10d: ['10DayAverageTradingVolume'],
    vol3m: ['3MonthAverageTradingVolume'],
    pe: ['peTTM', 'peBasicExclExtraTTM', 'peExclExtraTTM'],
    marketCapM: ['marketCapitalization'],
    rs4w: ['priceRelativeToS&P5004Week'],
    rs13w: ['priceRelativeToS&P50013Week'],
    rs26w: ['priceRelativeToS&P50026Week'],
} as const;

export interface Snapshot {
    symbol: string;
    asked: string;
    note?: string;
    asOf: string;
    price: number;
    dayChangePct?: number;
    ret5d?: number;
    ret13w?: number;
    ret26w?: number;
    ret52w?: number;
    high52?: number;
    low52?: number;
    high52Date?: string;
    low52Date?: string;
    /** Computed here: how far above the 52-week low, as a fraction. */
    aboveLow?: number;
    /** Computed here: how far below the 52-week high, as a fraction. */
    belowHigh?: number;
    pe?: number;
    debtToEquity?: number;
    dividendYield?: number;
    beta?: number;
    marketCapM?: number;
    vol10d?: number;
    vol3m?: number;
    /** Computed here: recent volume against its three-month norm. */
    volumeRatio?: number;
    rs4w?: number;
    rs13w?: number;
    rs26w?: number;
    fcfYield?: number;
    /** Screen fields this response did not carry, named rather than guessed. */
    missing: string[];
}

export function buildSnapshot(res: Resolution, quote: Quote, metric: Metric): Snapshot | null {
    if (!res.us || !quote || !Number.isFinite(quote.c) || quote.c <= 0 || !quote.t) return null;

    const m = metric ?? {};
    const pick = (k: keyof typeof METRIC_FIELDS) => num(m, [...METRIC_FIELDS[k]]);
    const missing = (Object.keys(METRIC_FIELDS) as (keyof typeof METRIC_FIELDS)[]).filter((k) => pick(k) === undefined);

    const high52 = pick('high52');
    const low52 = pick('low52');
    const vol10d = pick('vol10d');
    const vol3m = pick('vol3m');
    const pfcf = num(m, ['pfcfShareTTM']);

    return {
        symbol: res.us,
        asked: res.asked,
        note: res.note,
        asOf: new Date(quote.t * 1000).toISOString().slice(0, 10),
        price: quote.c,
        dayChangePct: quote.dp ?? undefined,
        ret5d: pick('ret5d'),
        ret13w: pick('ret13w'),
        ret26w: pick('ret26w'),
        ret52w: pick('ret52w'),
        high52,
        low52,
        high52Date: str(m, ['52WeekHighDate']),
        low52Date: str(m, ['52WeekLowDate']),
        aboveLow: low52 && low52 > 0 ? quote.c / low52 - 1 : undefined,
        belowHigh: high52 && high52 > 0 ? 1 - quote.c / high52 : undefined,
        pe: pick('pe'),
        debtToEquity: num(m, ['totalDebt/totalEquityQuarterly', 'totalDebt/totalEquityAnnual']),
        dividendYield: num(m, ['dividendYieldIndicatedAnnual', 'currentDividendYieldTTM']),
        beta: num(m, ['beta']),
        marketCapM: pick('marketCapM'),
        vol10d,
        vol3m,
        volumeRatio: vol10d && vol3m && vol3m > 0 ? vol10d / vol3m : undefined,
        rs4w: pick('rs4w'),
        rs13w: pick('rs13w'),
        rs26w: pick('rs26w'),
        fcfYield: pfcf && pfcf > 0 ? 100 / pfcf : undefined,
        missing,
    };
}

export async function snapshots(
    symbols: string[]
): Promise<{ found: Snapshot[]; unavailable: { symbol: string; why: string }[] }> {
    const found: Snapshot[] = [];
    const unavailable: { symbol: string; why: string }[] = [];

    for (const symbol of [...new Set(symbols.map((s) => s.trim()).filter(Boolean))].slice(0, MAX_TICKERS_PER_CALL)) {
        const res = await resolveListing(symbol);
        if (!res.us) {
            unavailable.push({ symbol, why: res.note ?? 'no free data' });
            continue;
        }
        try {
            // One after the other. It costs a fraction of a second per stock,
            // and each request then leaves exactly when its slot is granted,
            // which keeps the rate simple to reason about and to test.
            const quote = await finnhubGet<Quote>('/quote', { symbol: res.us });
            const metric = await finnhubGet<{ metric?: Metric }>('/stock/metric', { symbol: res.us, metric: 'all' });
            const snap = buildSnapshot(res, quote, metric?.metric ?? {});
            if (snap) found.push(snap);
            else unavailable.push({ symbol, why: `Finnhub has no current quote for ${res.us}` });
        } catch (err) {
            unavailable.push({ symbol, why: (err as Error).message });
        }
    }
    return { found, unavailable };
}

// ---------------------------------------------------------------------------
// News and the earnings calendar
// ---------------------------------------------------------------------------

export interface NewsItem {
    symbol: string;
    headline: string;
    source: string;
    url: string;
    published: string;
}

const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export async function companyNews(symbols: string[], days = 7, perSymbol = 5): Promise<NewsItem[]> {
    const to = isoDate(clock.now());
    const from = isoDate(clock.now() - days * 86_400_000);
    const out: NewsItem[] = [];

    for (const symbol of [...new Set(symbols)].slice(0, MAX_TICKERS_PER_CALL)) {
        const res = await resolveListing(symbol);
        if (!res.us) continue;
        const items = await finnhubGet<
            { headline?: string; source?: string; url?: string; datetime?: number }[]
        >('/company-news', { symbol: res.us, from, to });
        for (const n of (items ?? []).slice(0, perSymbol)) {
            if (!n.url || !n.headline) continue;
            out.push({
                symbol: res.us,
                headline: n.headline,
                source: n.source ?? '',
                url: n.url,
                published: n.datetime ? isoDate(n.datetime * 1000) : '',
            });
        }
    }
    return out;
}

export interface EarningsEvent {
    symbol: string;
    date: string;
    hour: string;
    epsEstimate?: number;
}

export async function upcomingEarnings(symbols: string[], days = 30): Promise<EarningsEvent[]> {
    const from = isoDate(clock.now());
    const to = isoDate(clock.now() + days * 86_400_000);
    const out: EarningsEvent[] = [];

    for (const symbol of [...new Set(symbols)].slice(0, MAX_TICKERS_PER_CALL)) {
        const res = await resolveListing(symbol);
        if (!res.us) continue;
        const cal = await finnhubGet<{
            earningsCalendar?: { symbol: string; date: string; hour?: string; epsEstimate?: number | null }[];
        }>('/calendar/earnings', { symbol: res.us, from, to });
        for (const e of cal?.earningsCalendar ?? []) {
            out.push({
                symbol: e.symbol,
                date: e.date,
                hour: e.hour === 'bmo' ? 'before the open' : e.hour === 'amc' ? 'after the close' : 'time not given',
                epsEstimate: e.epsEstimate ?? undefined,
            });
        }
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * A live probe that also checks the field names the screens rely on — names
 * assumed from Finnhub's documentation until a real response confirms them.
 */
export async function checkFinnhubHealth(): Promise<{ ok: boolean; detail?: string }> {
    if (!isFinnhubConfigured()) return { ok: false, detail: 'FINNHUB_API_KEY is not set' };
    try {
        const quote = await finnhubGet<Quote>('/quote', { symbol: 'AAPL' });
        const metric = await finnhubGet<{ metric?: Metric }>('/stock/metric', { symbol: 'AAPL', metric: 'all' });
        if (!quote?.c) return { ok: false, detail: 'Finnhub answered without a quote for AAPL' };
        const snap = buildSnapshot({ asked: 'AAPL', us: 'AAPL' }, quote, metric?.metric ?? {});
        const missing = snap?.missing ?? Object.keys(METRIC_FIELDS);
        return missing.length
            ? { ok: true, detail: `Answering, but these screen fields did not come back: ${missing.join(', ')}.` }
            : { ok: true };
    } catch (err) {
        return { ok: false, detail: (err as Error).message };
    }
}
