/**
 * SEC EDGAR — US company fundamentals and filings.
 *
 * The free backbone of Delphi's stock screening. EDGAR publishes every
 * financial statement filed with the SEC as structured data, and its "frames"
 * API returns one figure for every filer in a single call: operating cash flow
 * for 5,760 companies in under a second, measured while this was being built.
 * That is what makes a whole-market fundamentals screen possible without a
 * paid feed.
 *
 * Three things here are deliberate.
 *
 * **Every figure keeps the filing it came from.** Frames carry each value's
 * accession number, so "free cash flow was $1.2B" can cite the exact 10-K, and
 * the CHO can open it. A number that cannot say where it came from is not
 * shown.
 *
 * **Numbers are computed here, not by the model.** Free cash flow, margins,
 * growth, leverage: arithmetic an agent can get subtly wrong and still sound
 * right. The agent receives the result.
 *
 * **Fair access.** SEC asks every caller to identify itself with a contact
 * address and to stay under ten requests a second. It refuses anonymous
 * requests outright (403 — verified). So the channel only runs when
 * SEC_CONTACT is set, and paces itself at eight a second.
 */

import { ChannelUnavailableError } from './perplexity';

const DATA = 'https://data.sec.gov';
const WWW = 'https://www.sec.gov';

/** SEC's ceiling is ten a second; eight leaves room. */
const MIN_GAP_MS = 125;
const REQUEST_TIMEOUT_MS = 20_000;
/** Filings land quarterly; half a day of staleness costs nothing. */
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

export function isSecConfigured(): boolean {
    return Boolean(process.env.SEC_CONTACT?.trim());
}

// ---------------------------------------------------------------------------
// Transport: paced, identified, cached
// ---------------------------------------------------------------------------

const clock = {
    now: () => Date.now(),
    sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
};

let nextSlot = 0;
const cache = new Map<string, { at: number; value: unknown }>();

/** Test seam: a fake clock, and every cache cold — requests, frames, fact sets and the ticker map. */
export function setSecClock(fake?: Partial<typeof clock>): void {
    clock.now = fake?.now ?? (() => Date.now());
    clock.sleep = fake?.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    nextSlot = 0;
    cache.clear();
    frameSet = null;
    factsRead.clear();
    industries.clear();
    tickerIndex = null;
    tickerIndexAt = 0;
}

/**
 * Wait for this request's turn. Requests are spaced by their *start*, so many
 * can be in flight at once while the rate stays under SEC's limit — sequential
 * requests would spend most of their time waiting on transfers.
 */
async function slot(): Promise<void> {
    const now = clock.now();
    const at = Math.max(now, nextSlot);
    nextSlot = at + MIN_GAP_MS;
    if (at > now) await clock.sleep(at - now);
}

/**
 * GET a JSON document from SEC. Null when it does not exist. `keep: false`
 * leaves a large document out of the cache, for callers that keep what they
 * read from it instead.
 */
async function secGet<T>(url: string, keep = true): Promise<T | null> {
    const hit = cache.get(url);
    if (hit && clock.now() - hit.at < CACHE_TTL_MS) return hit.value as T | null;

    const contact = process.env.SEC_CONTACT?.trim();
    if (!contact) throw new ChannelUnavailableError('sec', 'SEC_CONTACT is not set');

    await slot();
    let response: Response;
    try {
        response = await fetch(url, {
            headers: { 'User-Agent': `Delphi ${contact}`, Accept: 'application/json' },
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
    } catch (err) {
        throw new ChannelUnavailableError('sec', (err as Error).message || 'the request failed');
    }

    if (response.status === 404) {
        cache.set(url, { at: clock.now(), value: null });
        return null;
    }
    if (response.status === 403) {
        throw new ChannelUnavailableError(
            'sec',
            'SEC refused the request (403). It requires a real contact address in SEC_CONTACT.'
        );
    }
    if (response.status === 429) {
        throw new ChannelUnavailableError('sec', 'SEC is rate-limiting this address (429).');
    }
    if (!response.ok) {
        throw new ChannelUnavailableError('sec', `${response.status} ${response.statusText}`);
    }

    const value = (await response.json()) as T;
    if (keep) cache.set(url, { at: clock.now(), value });
    return value;
}

// ---------------------------------------------------------------------------
// Companies
// ---------------------------------------------------------------------------

export interface SecCompany {
    cik: number;
    ticker: string;
    name: string;
}

let tickerIndex: { byTicker: Map<string, SecCompany>; byCik: Map<number, SecCompany> } | null = null;
let tickerIndexAt = 0;

/** Every ticker SEC knows, both ways round. The first ticker per CIK is its primary. */
export async function secCompanies(): Promise<{
    byTicker: Map<string, SecCompany>;
    byCik: Map<number, SecCompany>;
}> {
    if (tickerIndex && clock.now() - tickerIndexAt < CACHE_TTL_MS) return tickerIndex;

    const raw = await secGet<Record<string, { cik_str: number; ticker: string; title: string }>>(
        `${WWW}/files/company_tickers.json`
    );
    const byTicker = new Map<string, SecCompany>();
    const byCik = new Map<number, SecCompany>();
    for (const r of Object.values(raw ?? {})) {
        const c = { cik: r.cik_str, ticker: r.ticker.toUpperCase(), name: r.title };
        byTicker.set(c.ticker, c);
        if (!byCik.has(c.cik)) byCik.set(c.cik, c);
    }
    tickerIndex = { byTicker, byCik };
    tickerIndexAt = clock.now();
    return tickerIndex;
}

/** `BRK.B`, `brk-b` → `BRK-B`, the form SEC's map uses. */
export function normalizeUsTicker(t: string): string {
    return t.trim().toUpperCase().replace(/\./g, '-');
}

// ---------------------------------------------------------------------------
// Frames: one concept, one period, every filer
// ---------------------------------------------------------------------------

interface FrameRow {
    val: number;
    end: string;
    start?: string;
    accn: string;
}

type Frame = Map<number, FrameRow>;

async function frame(taxonomy: string, tag: string, unit: string, period: string): Promise<Frame> {
    const raw = await secGet<{ data?: (FrameRow & { cik: number })[] }>(
        `${DATA}/api/xbrl/frames/${taxonomy}/${tag}/${unit}/${period}.json`
    );
    const out: Frame = new Map();
    for (const r of raw?.data ?? []) {
        if (Number.isFinite(r.val)) out.set(r.cik, { val: r.val, end: r.end, start: r.start, accn: r.accn });
    }
    return out;
}

/** A value, and the filing that reported it. */
export interface Figure {
    value: number;
    /** Period end, YYYY-MM-DD. */
    end: string;
    accn: string;
    /** The XBRL concept, e.g. `us-gaap:Revenues`. */
    concept: string;
}

/** The index page of the filing a figure came from. */
export function filingUrl(cik: number, accn: string): string {
    return `${WWW}/Archives/edgar/data/${cik}/${accn.replace(/-/g, '')}/${accn}-index.htm`;
}

/** Calendar years whose annual frames are read: the newest two complete, and the one in progress. */
function annualPeriods(now = new Date(clock.now())): string[] {
    const y = now.getUTCFullYear();
    return [`CY${y}`, `CY${y - 1}`, `CY${y - 2}`];
}

/** The last two completed calendar quarters and the same quarters a year earlier. */
function quarterPeriods(now = new Date(clock.now())): { latest: [string, string]; previous: [string, string] } {
    // A quarter's 10-Qs are mostly in by six weeks after it ends.
    const d = new Date(now.getTime() - 45 * 86_400_000);
    let y = d.getUTCFullYear();
    let q = Math.floor(d.getUTCMonth() / 3); // 0-based; the quarter *before* this one is complete
    if (q === 0) {
        y -= 1;
        q = 4;
    }
    const prev = q === 1 ? { y: y - 1, q: 4 } : { y, q: q - 1 };
    return {
        latest: [`CY${y}Q${q}`, `CY${y - 1}Q${q}`],
        previous: [`CY${prev.y}Q${prev.q}`, `CY${prev.y - 1}Q${prev.q}`],
    };
}

/** The last two quarter-end instants. */
function instantPeriods(now = new Date(clock.now())): string[] {
    const { latest, previous } = quarterPeriods(now);
    return [`${latest[0]}I`, `${previous[0]}I`];
}

const REVENUE_TAGS = ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax'];

/**
 * Capital spending, as most filers tag it, and as Nvidia, Amazon, Ford and
 * PepsiCo do instead: without the second, their free cash flow is unknown.
 */
const CAPEX_TAGS = ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets'];

/**
 * Everything the screens read, for every US-GAAP filer at once.
 *
 * About three dozen requests, run concurrently under the rate limit and cached
 * for twelve hours — so the watchlist, the value screen and the momentum
 * screen of one run all share a single load.
 */
export interface FrameSet {
    annual: Record<string, Frame[]>; // concept -> frames, newest period first
    instant: Record<string, Frame[]>;
    quarterly: Record<string, { latest: [Frame, Frame]; previous: [Frame, Frame] }>;
}

let frameSet: { at: number; value: FrameSet } | null = null;

export async function loadFrames(): Promise<FrameSet> {
    if (frameSet && clock.now() - frameSet.at < CACHE_TTL_MS) return frameSet.value;

    const years = annualPeriods();
    const instants = instantPeriods();
    const quarters = quarterPeriods();

    const annualConcepts = ['NetCashProvidedByUsedInOperatingActivities', ...CAPEX_TAGS, 'NetIncomeLoss', ...REVENUE_TAGS];
    const instantConcepts = [
        'LongTermDebtNoncurrent',
        'LongTermDebt',
        'LongTermDebtCurrent',
        'CashAndCashEquivalentsAtCarryingValue',
        'StockholdersEquity',
    ];

    const [annual, instant, quarterly] = await Promise.all([
        Promise.all(
            annualConcepts.map(async (c) => [c, await Promise.all(years.map((p) => frame('us-gaap', c, 'USD', p)))] as const)
        ),
        Promise.all(
            instantConcepts.map(async (c) => [c, await Promise.all(instants.map((p) => frame('us-gaap', c, 'USD', p)))] as const)
        ),
        Promise.all(
            REVENUE_TAGS.map(async (c) => {
                const [a, b, x, y] = await Promise.all([
                    frame('us-gaap', c, 'USD', quarters.latest[0]),
                    frame('us-gaap', c, 'USD', quarters.latest[1]),
                    frame('us-gaap', c, 'USD', quarters.previous[0]),
                    frame('us-gaap', c, 'USD', quarters.previous[1]),
                ]);
                return [c, { latest: [a, b] as [Frame, Frame], previous: [x, y] as [Frame, Frame] }] as const;
            })
        ),
    ]);

    const value: FrameSet = {
        annual: Object.fromEntries(annual),
        instant: Object.fromEntries(instant),
        quarterly: Object.fromEntries(quarterly),
    };
    frameSet = { at: clock.now(), value };
    return value;
}

// ---------------------------------------------------------------------------
// Fundamentals
// ---------------------------------------------------------------------------

export interface Fundamentals {
    cik: number;
    ticker: string;
    name: string;
    currency: string;
    taxonomy: 'us-gaap' | 'ifrs-full';
    revenue?: Figure;
    revenuePrior?: Figure;
    netIncome?: Figure;
    netIncomePrior?: Figure;
    operatingCashFlow?: Figure;
    capex?: Figure;
    debt?: { value: number; figures: Figure[] };
    cash?: Figure;
    equity?: Figure;
    // Computed here, never by the model:
    freeCashFlow?: number;
    fcfMargin?: number;
    revenueGrowth?: number;
    earningsGrowth?: number;
    debtToEquity?: number;
    netDebt?: number;
    /**
     * Years of free cash flow to pay off net debt. The leverage test the screens
     * use: unlike debt/equity it still means something when buybacks have
     * pushed equity negative, as at many mature, cash-rich companies.
     */
    netDebtToFcf?: number;
    quarterlyGrowth?: { latest: number; previous: number; accelerating: boolean; figures: Figure[] };
    /** What the company does, as SEC files it — a bank's "free cash flow" is not a factory's. */
    industry?: Industry;
}

/** Latest annual value, and the one a year before it, from frames newest-first. */
function annualPair(frames: Frame[] | undefined, cik: number, concept: string): [Figure?, Figure?] {
    const rows = (frames ?? [])
        .map((f) => f.get(cik))
        .filter((r): r is FrameRow => Boolean(r))
        .sort((a, b) => b.end.localeCompare(a.end));
    if (!rows.length) return [];

    const latest = rows[0];
    const days = (a: string, b: string) => (Date.parse(a) - Date.parse(b)) / 86_400_000;
    const prior = rows.find((r) => {
        const gap = days(latest.end, r.end);
        return gap > 300 && gap < 430;
    });
    const fig = (r: FrameRow): Figure => ({ value: r.val, end: r.end, accn: r.accn, concept });
    return [fig(latest), prior ? fig(prior) : undefined];
}

/** The annual figure for exactly this period, if the filer reported one under this concept. */
function annualAt(frames: Frame[] | undefined, cik: number, concept: string, end: string): Figure | undefined {
    for (const f of frames ?? []) {
        const r = f.get(cik);
        if (r?.end === end) return { value: r.val, end: r.end, accn: r.accn, concept };
    }
    return undefined;
}

function latestInstant(frames: Frame[] | undefined, cik: number, concept: string): Figure | undefined {
    const r = (frames ?? []).map((f) => f.get(cik)).find(Boolean);
    return r ? { value: r.val, end: r.end, accn: r.accn, concept } : undefined;
}

/** The arithmetic, in one place, on whatever figures were found. */
export function derive(f: Fundamentals): Fundamentals {
    const out = { ...f };
    // Both halves of free cash flow from the same year: one year's cash flow
    // less another year's capex is a number no filing supports.
    if (f.operatingCashFlow && f.capex && f.capex.end === f.operatingCashFlow.end) {
        // Capex is reported as a positive outflow; free cash flow subtracts it.
        out.freeCashFlow = f.operatingCashFlow.value - Math.abs(f.capex.value);
        out.fcfMargin =
            f.revenue && f.revenue.value > 0 && f.revenue.end === f.operatingCashFlow.end
                ? out.freeCashFlow / f.revenue.value
                : undefined;
    }
    if (f.revenue && f.revenuePrior && f.revenuePrior.value > 0) {
        out.revenueGrowth = f.revenue.value / f.revenuePrior.value - 1;
    }
    if (f.netIncome && f.netIncomePrior && f.netIncomePrior.value > 0) {
        out.earningsGrowth = f.netIncome.value / f.netIncomePrior.value - 1;
    }
    if (f.debt && f.equity && f.equity.value > 0) out.debtToEquity = f.debt.value / f.equity.value;
    if (f.debt) out.netDebt = f.debt.value - (f.cash?.value ?? 0);
    if (out.netDebt !== undefined && out.freeCashFlow !== undefined && out.freeCashFlow > 0) {
        out.netDebtToFcf = out.netDebt / out.freeCashFlow;
    }
    return out;
}

/** Fundamentals for one US-GAAP filer, read out of the frames. */
export function fromFrames(fs: FrameSet, company: SecCompany): Fundamentals | null {
    const { cik } = company;

    // One revenue concept, used for both years: mixing two would compare
    // different definitions of revenue and call the difference growth.
    let revenue: Figure | undefined;
    let revenuePrior: Figure | undefined;
    let revenueTag: string | undefined;
    for (const tag of REVENUE_TAGS) {
        const [a, b] = annualPair(fs.annual[tag], cik, `us-gaap:${tag}`);
        if (a && (!revenue || a.end > revenue.end)) {
            revenue = a;
            revenuePrior = b;
            revenueTag = tag;
        }
    }

    const [operatingCashFlow] = annualPair(
        fs.annual.NetCashProvidedByUsedInOperatingActivities,
        cik,
        'us-gaap:NetCashProvidedByUsedInOperatingActivities'
    );
    // Capital spending for exactly the cash flow's year, under whichever
    // concept the filer used.
    const capex = operatingCashFlow
        ? CAPEX_TAGS.map((tag) => annualAt(fs.annual[tag], cik, `us-gaap:${tag}`, operatingCashFlow.end)).find(Boolean)
        : undefined;
    const [netIncome, netIncomePrior] = annualPair(fs.annual.NetIncomeLoss, cik, 'us-gaap:NetIncomeLoss');

    if (!revenue && !operatingCashFlow && !netIncome) return null;

    // Debt, from whichever way the company reports it. Noncurrent plus
    // current is total borrowing; `LongTermDebt` alone usually already is.
    const nonCurrent = latestInstant(fs.instant.LongTermDebtNoncurrent, cik, 'us-gaap:LongTermDebtNoncurrent');
    const current = latestInstant(fs.instant.LongTermDebtCurrent, cik, 'us-gaap:LongTermDebtCurrent');
    const total = latestInstant(fs.instant.LongTermDebt, cik, 'us-gaap:LongTermDebt');
    const debt = nonCurrent
        ? {
              value: nonCurrent.value + (current && current.end === nonCurrent.end ? current.value : 0),
              figures: [nonCurrent, ...(current && current.end === nonCurrent.end ? [current] : [])],
          }
        : total
          ? { value: total.value, figures: [total] }
          : undefined;

    let quarterlyGrowth: Fundamentals['quarterlyGrowth'];
    const q = revenueTag ? fs.quarterly[revenueTag] : undefined;
    if (q) {
        const [a, b] = q.latest.map((f) => f.get(cik));
        const [x, y] = q.previous.map((f) => f.get(cik));
        if (a && b && x && y && b.val > 0 && y.val > 0) {
            const latest = a.val / b.val - 1;
            const previous = x.val / y.val - 1;
            const fig = (r: FrameRow): Figure => ({
                value: r.val,
                end: r.end,
                accn: r.accn,
                concept: `us-gaap:${revenueTag} (quarter)`,
            });
            quarterlyGrowth = {
                latest,
                previous,
                accelerating: latest > previous,
                figures: [fig(a), fig(b), fig(x), fig(y)],
            };
        }
    }

    return derive({
        cik,
        ticker: company.ticker,
        name: company.name,
        currency: 'USD',
        taxonomy: 'us-gaap',
        revenue,
        revenuePrior,
        netIncome,
        netIncomePrior,
        operatingCashFlow,
        capex,
        debt,
        cash: latestInstant(
            fs.instant.CashAndCashEquivalentsAtCarryingValue,
            cik,
            'us-gaap:CashAndCashEquivalentsAtCarryingValue'
        ),
        equity: latestInstant(fs.instant.StockholdersEquity, cik, 'us-gaap:StockholdersEquity'),
        quarterlyGrowth,
    });
}

// ---------------------------------------------------------------------------
// Filers the frames miss: IFRS reporters and odd fiscal calendars
// ---------------------------------------------------------------------------

interface FactPoint {
    start?: string;
    end: string;
    val: number;
    accn: string;
    form?: string;
    fp?: string;
}

type CompanyFacts = {
    facts?: Record<string, Record<string, { units?: Record<string, FactPoint[]> }>>;
};

type Taxonomy = 'us-gaap' | 'ifrs-full';
type Metric = 'revenue' | 'netIncome' | 'operatingCashFlow' | 'capex' | 'debt' | 'cash' | 'equity';

const TAXONOMIES: Taxonomy[] = ['us-gaap', 'ifrs-full'];

/**
 * The concepts each figure may be filed under.
 *
 * The newest series wins, whatever taxonomy or name it is under. Companies
 * change how they file — Honda moved from US GAAP to IFRS, Nokia from
 * `Revenue` to `RevenueFromContractsWithCustomers` — and the old series stays
 * in their fact set, years out of date. Reading the first name that has any
 * data quoted Honda's 2014 accounts as its latest. The order here only
 * settles ties: US GAAP first, then as listed.
 */
const FALLBACK_CONCEPTS: Record<Taxonomy, Record<Metric, string[]>> = {
    'us-gaap': {
        revenue: [...REVENUE_TAGS, 'RevenueFromContractWithCustomerIncludingAssessedTax', 'SalesRevenueNet'],
        netIncome: ['NetIncomeLoss', 'ProfitLoss'],
        operatingCashFlow: [
            'NetCashProvidedByUsedInOperatingActivities',
            'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations',
        ],
        capex: CAPEX_TAGS,
        // A total first; a noncurrent figure is completed from CURRENT_PORTION.
        debt: ['LongTermDebt', 'LongTermDebtNoncurrent'],
        cash: ['CashAndCashEquivalentsAtCarryingValue'],
        equity: ['StockholdersEquity'],
    },
    'ifrs-full': {
        revenue: ['Revenue', 'RevenueFromContractsWithCustomers'],
        netIncome: ['ProfitLossAttributableToOwnersOfParent', 'ProfitLoss'],
        operatingCashFlow: ['CashFlowsFromUsedInOperatingActivities'],
        capex: [
            'PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities',
            'PurchaseOfPropertyPlantAndEquipment',
            // Nokia's: plant and equipment together with other long-lived assets.
            'PurchaseOfPropertyPlantAndEquipmentIntangibleAssetsOtherThanGoodwillInvestmentPropertyAndOtherNoncurrentAssets',
        ],
        debt: ['Borrowings', 'LongtermBorrowings', 'NoncurrentPortionOfNoncurrentBorrowings'],
        cash: ['CashAndCashEquivalents'],
        equity: ['EquityAttributableToOwnersOfParent', 'Equity'],
    },
};

/**
 * The current portion that completes a noncurrent debt figure, as the frames
 * add them. Honda, Toyota and Nokia file `LongtermBorrowings` as the
 * noncurrent line only (with all their current borrowings it sums to their
 * `Borrowings`), so on its own it would understate debt.
 */
const CURRENT_PORTION: Record<string, string> = {
    LongTermDebtNoncurrent: 'LongTermDebtCurrent',
    LongtermBorrowings: 'CurrentPortionOfLongtermBorrowings',
    NoncurrentPortionOfNoncurrentBorrowings: 'CurrentPortionOfNoncurrentBorrowings',
};

const isAnnual = (p: FactPoint) =>
    p.start
        ? (() => {
              const d = (Date.parse(p.end) - Date.parse(p.start)) / 86_400_000;
              return d > 330 && d < 400;
          })()
        : false;

/** One concept in one currency, newest point first. */
interface Series {
    taxonomy: Taxonomy;
    name: string;
    unit: string;
    points: FactPoint[];
}

/** Every series a figure was filed under, in either taxonomy and any currency, in tie-break order. */
function seriesFor(facts: CompanyFacts, metric: Metric, kind: 'annual' | 'instant'): Series[] {
    const out: Series[] = [];
    for (const taxonomy of TAXONOMIES) {
        for (const name of FALLBACK_CONCEPTS[taxonomy][metric]) {
            for (const [unit, pts] of Object.entries(facts.facts?.[taxonomy]?.[name]?.units ?? {})) {
                if (!/^[A-Z]{3}$/.test(unit)) continue; // currencies only
                const points = pts
                    .filter((p) => (kind === 'annual' ? isAnnual(p) : !p.start))
                    .sort((a, b) => b.end.localeCompare(a.end));
                if (points.length) out.push({ taxonomy, name, unit, points });
            }
        }
    }
    return out;
}

/** The series that reaches the latest period. The earlier-listed wins a tie. */
function freshest(series: Series[]): Series | undefined {
    let best: Series | undefined;
    for (const s of series) if (!best || s.points[0].end > best.points[0].end) best = s;
    return best;
}

const figureOf = (s: Series, p: FactPoint): Figure => ({
    value: p.val,
    end: p.end,
    accn: p.accn,
    concept: `${s.taxonomy}:${s.name}`,
});

/**
 * Fundamentals from a company's full fact set, for filers the frames do not
 * cover — foreign filers reporting under IFRS in their own currency (Toyota,
 * Cameco), or US-GAAP filers whose fiscal year does not line up.
 */
export function fromCompanyFacts(company: SecCompany, facts: CompanyFacts): Fundamentals | null {
    const revenueSeries = seriesFor(facts, 'revenue', 'annual');
    const niSeries = seriesFor(facts, 'netIncome', 'annual');
    const ocfSeries = seriesFor(facts, 'operatingCashFlow', 'annual');

    // The newest headline figure sets the currency, and every other figure
    // must be in it: yen of cash flow less dollars of capex means nothing.
    const anchor = freshest([...revenueSeries, ...niSeries, ...ocfSeries]);
    if (!anchor) return null;
    const currency = anchor.unit;
    const inCurrency = (series: Series[]) => series.filter((s) => s.unit === currency);

    const pair = (s: Series | undefined): [Figure?, Figure?] => {
        if (!s) return [];
        const [latest, ...rest] = s.points;
        const prior = rest.find((p) => {
            const gap = (Date.parse(latest.end) - Date.parse(p.end)) / 86_400_000;
            return gap > 300 && gap < 430;
        });
        return [figureOf(s, latest), prior ? figureOf(s, prior) : undefined];
    };

    const [revenue, revenuePrior] = pair(freshest(inCurrency(revenueSeries)));
    const [netIncome, netIncomePrior] = pair(freshest(inCurrency(niSeries)));
    const [operatingCashFlow] = pair(freshest(inCurrency(ocfSeries)));

    // Capital spending for exactly the cash flow's year, under whichever
    // concept has it — never another year's.
    let capex: Figure | undefined;
    if (operatingCashFlow) {
        for (const s of inCurrency(seriesFor(facts, 'capex', 'annual'))) {
            const p = s.points.find((x) => x.end === operatingCashFlow.end);
            if (p) {
                capex = figureOf(s, p);
                break;
            }
        }
    }

    // Balance-sheet figures: the newest, and no older than a year before the
    // headline figures. Debt from 2014 set against cash flow from 2025 would
    // be a leverage ratio of two different companies.
    const floor = new Date(Date.parse(anchor.points[0].end) - 365 * 86_400_000).toISOString().slice(0, 10);
    const balance = (metric: Metric): Series | undefined => {
        const s = freshest(inCurrency(seriesFor(facts, metric, 'instant')));
        return s && s.points[0].end >= floor ? s : undefined;
    };
    const newest = (s: Series | undefined) => (s ? figureOf(s, s.points[0]) : undefined);

    let debt: Fundamentals['debt'];
    const debtSeries = balance('debt');
    if (debtSeries) {
        const main = figureOf(debtSeries, debtSeries.points[0]);
        const currentName = CURRENT_PORTION[debtSeries.name];
        const cp = currentName
            ? facts.facts?.[debtSeries.taxonomy]?.[currentName]?.units?.[currency]?.find(
                  (p) => !p.start && p.end === main.end
              )
            : undefined;
        const current = cp ? figureOf({ ...debtSeries, name: currentName }, cp) : undefined;
        debt = { value: main.value + (current?.value ?? 0), figures: current ? [main, current] : [main] };
    }

    return derive({
        cik: company.cik,
        ticker: company.ticker,
        name: company.name,
        currency,
        taxonomy: anchor.taxonomy,
        revenue,
        revenuePrior,
        netIncome,
        netIncomePrior,
        operatingCashFlow,
        capex,
        debt,
        cash: newest(balance('cash')),
        equity: newest(balance('equity')),
    });
}

/**
 * What was read from each company's fact set, kept instead of the document:
 * a large filer's runs to several megabytes, and a screen can need dozens.
 */
const factsRead = new Map<number, { at: number; value: Fundamentals | null }>();

async function fundamentalsFromFacts(company: SecCompany): Promise<Fundamentals | null> {
    let hit = factsRead.get(company.cik);
    if (!hit || clock.now() - hit.at >= CACHE_TTL_MS) {
        const facts = await secGet<CompanyFacts>(
            `${DATA}/api/xbrl/companyfacts/CIK${String(company.cik).padStart(10, '0')}.json`,
            false
        );
        hit = { at: clock.now(), value: facts ? fromCompanyFacts(company, facts) : null };
        factsRead.set(company.cik, hit);
    }
    // Share classes share a fact set: answer under the ticker that was asked.
    return hit.value && { ...hit.value, ticker: company.ticker, name: company.name };
}

/**
 * Figures older than this are history, not fundamentals: the company has
 * stopped filing, or no longer files under anything read here. Two years,
 * because a March year-end filer's newest annual figures can be eighteen
 * months old and still be the latest there are.
 */
export const STALE_AFTER_DAYS = 730;

/** The newest period any headline figure covers. */
export function latestEnd(f: Fundamentals): string | undefined {
    let end: string | undefined;
    for (const x of [f.revenue, f.netIncome, f.operatingCashFlow]) if (x && (!end || x.end > end)) end = x.end;
    return end;
}

function isStale(f: Fundamentals): boolean {
    const end = latestEnd(f);
    return end !== undefined && clock.now() - Date.parse(end) > STALE_AFTER_DAYS * 86_400_000;
}

/**
 * The better of two readings of one company: the fresher, then the more
 * complete — free cash flow counting most, since it is usually what the fact
 * set was fetched for. The frames win a tie: only they carry quarterly growth.
 */
function better(frames: Fundamentals | null, facts: Fundamentals | null): Fundamentals | null {
    if (!facts) return frames;
    if (!frames) return facts;
    const completeness = (f: Fundamentals) =>
        (f.freeCashFlow !== undefined ? 8 : 0) + (f.revenue ? 4 : 0) + (f.netIncome ? 2 : 0) + (f.debt ? 1 : 0);
    const a = latestEnd(frames) ?? '';
    const b = latestEnd(facts) ?? '';
    if (b < a || (b === a && completeness(facts) <= completeness(frames))) return frames;
    // Quarterly growth comes only from the frames; it still holds in the same currency.
    return frames.quarterlyGrowth && facts.currency === frames.currency
        ? { ...facts, quarterlyGrowth: frames.quarterlyGrowth }
        : facts;
}

/**
 * Fundamentals for named companies.
 *
 * Frames first — one shared load covers most US filers. A company they leave
 * short, with no revenue or no free cash flow, costs one more request for its
 * own fact set, and the better reading is kept. A company whose newest figures
 * are over two years old is reported as out of date, never as current.
 */
export async function fundamentalsFor(tickers: string[]): Promise<{
    found: Fundamentals[];
    unknown: string[];
    noData: string[];
    stale: { ticker: string; latestEnd: string }[];
}> {
    const { byTicker } = await secCompanies();
    const fs = await loadFrames();

    const found: Fundamentals[] = [];
    const unknown: string[] = [];
    const noData: string[] = [];
    const stale: { ticker: string; latestEnd: string }[] = [];

    for (const raw of [...new Set(tickers.map(normalizeUsTicker).filter(Boolean))]) {
        const company = byTicker.get(raw);
        if (!company) {
            unknown.push(raw);
            continue;
        }

        let f = fromFrames(fs, company);
        if (!f || !f.revenue || f.freeCashFlow === undefined) {
            try {
                f = better(f, await fundamentalsFromFacts(company));
            } catch (err) {
                // An improvement on a reading already in hand is not worth the whole call.
                if (!f) throw err;
            }
        }

        if (!f) noData.push(raw);
        else if (isStale(f)) stale.push({ ticker: f.ticker, latestEnd: latestEnd(f)! });
        else found.push(f);
    }

    return { found: await withIndustries(found), unknown, noData, stale };
}

// ---------------------------------------------------------------------------
// Industries: where free cash flow does not apply
// ---------------------------------------------------------------------------

/** A company's industry as SEC files it: its Standard Industrial Classification. */
export interface Industry {
    sic: number;
    description: string;
}

/**
 * Industries whose operating cash flow is mostly other people's money —
 * deposits, loans, client balances, insurance float — so free cash flow does
 * not measure them, and a value screen built on it must not rank them. Seen
 * live: Capital One, Futu and Palomar near the top of the value ranking, Futu
 * on a "free-cash-flow margin" of 178%.
 *
 * Coarse by nature: BlackRock, an asset manager, files as a broker-dealer
 * (6211) and is left out with them. Exchanges (6200), asset managers (6282),
 * insurance brokers (64xx) and real-estate services (65xx) are kept: their
 * cash flow is their own.
 */
export function financialKind(sic: number | undefined): string | null {
    if (sic === undefined || !Number.isFinite(sic)) return null;
    if (sic >= 6000 && sic <= 6199) return 'a bank or lender';
    if (sic === 6211 || sic === 6221) return 'a broker-dealer';
    if (sic >= 6300 && sic <= 6399) return 'an insurer';
    if (sic === 6798) return 'a REIT';
    if (sic === 6770) return 'a blank-check company';
    return null;
}

/** "National Commercial Banks (SIC 6021)". */
export function industryLabel(i: Industry): string {
    return i.description ? `${i.description} (SIC ${i.sic})` : `SIC ${i.sic}`;
}

/**
 * Why free cash flow does not measure this company, or null when it does.
 *
 * Either its industry is financial, or its free cash flow is larger than its
 * sales — which no business earns: it is customer money passing through
 * operating cash flow, or a one-off. Seen live at Wise, a money transmitter
 * filed under business services, at 398% of sales.
 */
export function fcfDoesNotApply(f: Fundamentals): string | null {
    const kind = financialKind(f.industry?.sic);
    if (kind && f.industry) return `${kind}, ${industryLabel(f.industry)}: free cash flow does not measure it`;
    if (f.fcfMargin !== undefined && f.fcfMargin > 1) {
        return `free cash flow of ${Math.round(f.fcfMargin * 100)}% of sales: customer money or one-offs, not the business's own`;
    }
    return null;
}

/** Each company's industry, kept rather than the filing history it arrives with. */
const industries = new Map<number, { at: number; value: Industry | null }>();

/**
 * A company's industry, from its SEC submissions record. Null when SEC gives
 * none or the request fails: no company is left out for lack of data.
 */
export async function industryOf(cik: number): Promise<Industry | null> {
    const hit = industries.get(cik);
    if (hit && clock.now() - hit.at < CACHE_TTL_MS) return hit.value;

    let sub: { sic?: string; sicDescription?: string } | null;
    try {
        sub = await secGet(`${DATA}/submissions/CIK${String(cik).padStart(10, '0')}.json`, false);
    } catch {
        // Unknown, so kept; and not remembered, so the next run asks again.
        return null;
    }
    const sic = Number(sub?.sic);
    const value = sub?.sic && Number.isFinite(sic) ? { sic, description: sub.sicDescription ?? '' } : null;
    industries.set(cik, { at: clock.now(), value });
    return value;
}

/** The same companies, each with its industry where SEC gives one. */
async function withIndustries(list: Fundamentals[]): Promise<Fundamentals[]> {
    const kinds = await Promise.all(list.map((f) => industryOf(f.cik)));
    return list.map((f, i) => {
        const industry = kinds[i];
        return industry ? { ...f, industry } : f;
    });
}

// ---------------------------------------------------------------------------
// Whole-market leaders
// ---------------------------------------------------------------------------

/** Below this annual revenue a company is too small to screen without a market cap. */
const MIN_REVENUE_USD = 500_000_000;

/** "Manageable debt": net debt no more than four years of free cash flow. */
export const MAX_DEBT_YEARS = 4;

export interface Leader {
    fundamentals: Fundamentals;
    score: number;
}

/**
 * The strongest companies in the US market on fundamentals alone.
 *
 * Revenue stands in for size, because without prices there is no market
 * capitalisation — and a screen that surfaces shell companies is worse than
 * none. Scores are simple and stated in the output, so a reader can see why a
 * name ranked where it did.
 */
export async function qualityLeaders(style: 'value' | 'momentum', limit = 30): Promise<Leader[]> {
    const { byCik } = await secCompanies();
    const fs = await loadFrames();

    const ciks = new Set<number>();
    for (const frames of Object.values(fs.annual)) for (const f of frames) for (const cik of f.keys()) ciks.add(cik);

    const leaders: Leader[] = [];
    for (const cik of ciks) {
        const company = byCik.get(cik);
        if (!company) continue; // no ticker: nothing a reader could act on
        const f = fromFrames(fs, company);
        // The oldest frames read still hold companies that have since stopped filing.
        if (!f?.revenue || f.revenue.value < MIN_REVENUE_USD || isStale(f)) continue;

        if (style === 'value') {
            // Profitable, cash-generative, and able to clear its debt from
            // cash flow in four years or less.
            if (f.freeCashFlow === undefined || f.freeCashFlow <= 0) continue;
            if (!f.netIncome || f.netIncome.value <= 0) continue;
            if (f.netDebtToFcf !== undefined && f.netDebtToFcf > MAX_DEBT_YEARS) continue;
            const margin = Math.min(f.fcfMargin ?? 0, 0.4);
            const leverage = Math.min(Math.max(f.netDebtToFcf ?? 0, 0), MAX_DEBT_YEARS) / MAX_DEBT_YEARS;
            leaders.push({
                fundamentals: f,
                score: margin * 2 + (1 - leverage) * 0.3 + Math.min(Math.max(f.revenueGrowth ?? 0, -0.2), 0.3),
            });
        } else {
            // Sales growing, and growing faster than they were.
            const q = f.quarterlyGrowth;
            if (!q || q.latest <= 0) continue;
            leaders.push({
                fundamentals: f,
                score:
                    Math.min(q.latest, 1) +
                    (q.accelerating ? Math.min(q.latest - q.previous, 0.5) : 0) +
                    Math.min(Math.max(f.earningsGrowth ?? 0, -0.5), 1) * 0.3,
            });
        }
    }

    const ranked = leaders.sort((a, b) => b.score - a.score);
    const n = Math.max(1, Math.min(limit, 100));
    return style === 'value' ? withoutFinancials(ranked, n) : ranked.slice(0, n);
}

/**
 * The top `n` of a value ranking, less the companies free cash flow does not
 * measure (see fcfDoesNotApply). Industries are looked up down the ranking
 * in batches — a few dozen requests, not one for every company in the market.
 */
async function withoutFinancials(ranked: Leader[], n: number): Promise<Leader[]> {
    const out: Leader[] = [];
    const cap = Math.min(ranked.length, n + 60);
    for (let i = 0; out.length < n && i < cap; ) {
        const batch = ranked.slice(i, Math.min(cap, i + n - out.length + 10));
        i += batch.length;
        const kinds = await Promise.all(batch.map((l) => industryOf(l.fundamentals.cik)));
        batch.forEach((l, k) => {
            const industry = kinds[k];
            const fundamentals = industry ? { ...l.fundamentals, industry } : l.fundamentals;
            if (out.length >= n || fcfDoesNotApply(fundamentals)) return;
            out.push({ ...l, fundamentals });
        });
    }
    return out;
}

// ---------------------------------------------------------------------------
// Filings
// ---------------------------------------------------------------------------

/** What an 8-K item number means, in words a reader does not have to look up. */
export const EIGHT_K_ITEMS: Record<string, string> = {
    '1.01': 'entered a material agreement',
    '1.02': 'ended a material agreement',
    '1.03': 'bankruptcy or receivership',
    '2.01': 'completed an acquisition or disposal',
    '2.02': 'results of operations (earnings)',
    '2.03': 'took on a material financial obligation',
    '2.05': 'exit or restructuring costs',
    '2.06': 'material impairment',
    '3.01': 'delisting notice or listing transfer',
    '3.02': 'unregistered sale of shares',
    '4.01': 'changed auditor',
    '4.02': 'earlier financial statements no longer reliable',
    '5.01': 'change in control',
    '5.02': 'director or officer change',
    '5.03': 'amended articles or bylaws',
    '5.07': 'shareholder vote results',
    '7.01': 'Regulation FD disclosure',
    '8.01': 'other material event',
    '9.01': 'financial statements and exhibits',
};

const FILING_FORMS = new Set(['8-K', '6-K', '10-Q', '10-K', '40-F', '20-F', '8-K/A', '10-K/A', '10-Q/A']);

export interface Filing {
    ticker: string;
    form: string;
    filed: string;
    what: string;
    url: string;
}

interface Submissions {
    filings?: {
        recent?: {
            accessionNumber: string[];
            filingDate: string[];
            form: string[];
            primaryDocument: string[];
            items?: string[];
        };
    };
}

export function describeFiling(form: string, items: string | undefined): string {
    if (form.startsWith('8-K') && items) {
        const words = items
            .split(',')
            .map((i) => i.trim())
            .filter((i) => i && i !== '9.01')
            .map((i) => EIGHT_K_ITEMS[i] ?? `item ${i}`);
        if (words.length) return words.join('; ');
    }
    const plain: Record<string, string> = {
        '10-Q': 'quarterly report',
        '10-K': 'annual report',
        '40-F': 'annual report (Canadian filer)',
        '20-F': 'annual report (foreign filer)',
        '6-K': 'report of a foreign issuer',
        '8-K': 'current report',
    };
    return plain[form.replace('/A', '')] ?? form;
}

export async function recentFilings(
    tickers: string[],
    days = 30
): Promise<{ filings: Filing[]; unknown: string[] }> {
    const { byTicker } = await secCompanies();
    const since = new Date(clock.now() - days * 86_400_000).toISOString().slice(0, 10);

    const filings: Filing[] = [];
    const unknown: string[] = [];
    for (const raw of [...new Set(tickers.map(normalizeUsTicker).filter(Boolean))]) {
        const company = byTicker.get(raw);
        if (!company) {
            unknown.push(raw);
            continue;
        }
        const sub = await secGet<Submissions>(
            `${DATA}/submissions/CIK${String(company.cik).padStart(10, '0')}.json`
        );
        const r = sub?.filings?.recent;
        if (!r) continue;
        for (let i = 0; i < r.form.length; i++) {
            if (r.filingDate[i] < since || !FILING_FORMS.has(r.form[i])) continue;
            const accn = r.accessionNumber[i];
            filings.push({
                ticker: company.ticker,
                form: r.form[i],
                filed: r.filingDate[i],
                what: describeFiling(r.form[i], r.items?.[i]),
                url: `${WWW}/Archives/edgar/data/${company.cik}/${accn.replace(/-/g, '')}/${r.primaryDocument[i]}`,
            });
        }
    }
    filings.sort((a, b) => b.filed.localeCompare(a.filed));
    return { filings, unknown };
}

export async function checkSecHealth(): Promise<{ ok: boolean; detail?: string }> {
    if (!isSecConfigured()) {
        return { ok: false, detail: 'SEC_CONTACT is not set — SEC refuses requests without a contact address.' };
    }
    try {
        const { byTicker } = await secCompanies();
        return byTicker.size > 1000
            ? { ok: true }
            : { ok: false, detail: `SEC returned only ${byTicker.size} tickers` };
    } catch (err) {
        return { ok: false, detail: (err as Error).message };
    }
}
