/**
 * GDELT — the world's news, in the languages it was written in.
 *
 * RSS gives Delphi a handful of English-language outlets. GDELT indexes news
 * from nearly every country in 65+ languages and tags each article with where
 * it was published and in what language, which is what "monitor across regions
 * and languages" actually requires.
 *
 * Two things here are deliberate.
 *
 * **Syndication is not corroboration, so corroboration is counted in code.** A
 * wire story republished by four local sites under the same headline is one
 * report, not four confirmations — observed live, with a Bank of Canada story
 * carried verbatim by four Quebec outlets. Counting outlets would have called
 * that well corroborated. So articles are grouped by headline, and the tool
 * says how many distinct reports there are separately from how many places
 * printed them. Left to the model, that count is exactly the kind of number
 * that comes out plausible and wrong.
 *
 * **GDELT rate-limits per outbound address, not per caller**: one request
 * every five seconds. Cloud servers share their addresses with many other
 * tenants, so GDELT often refuses them outright — seen here from both the
 * build sandbox and Vercel, with the throttle reply itself taking 11–14s. And
 * retrying is worse than useless: a block that has started is prolonged by
 * further requests. So there is one attempt per search, spaced from the last;
 * if GDELT will not answer, the agent is told plainly, handed no citations,
 * and pointed at RSS and web search — and GDELT is left alone for a while.
 */

const BASE_URL = 'https://api.gdeltproject.org/api/v2/doc/doc';

/** GDELT asks for one request every five seconds; a margin keeps us honest. */
const MIN_GAP_MS = 5_500;


/**
 * GDELT is slow under load: live, even its throttle replies took 11–14s. An
 * agent's call waits long enough for a slow success; a health probe does not,
 * because the diagnostics page waits on it and should not take half a minute
 * to say "slow".
 */
const REQUEST_TIMEOUT_MS = 25_000;
const PROBE_TIMEOUT_MS = 8_000;

/**
 * After GDELT turns out to be unavailable, stop asking for a while. A refusal
 * can last a quarter of an hour, asking again only extends it, and an agent
 * told to fall back may still try another query — each paying the full wait
 * for the same answer, out of a run with six tool turns and a clock.
 */
const COOLDOWN_MS = 10 * 60_000;

export interface GdeltArticle {
    url: string;
    title: string;
    domain: string;
    language: string;
    country: string;
    /** ISO-ish: `2026-09-24 14:30Z`. */
    seenAt: string;
}

export type GdeltOutcome =
    | { kind: 'ok'; query: string; articles: GdeltArticle[] }
    /**
     * Nothing was learned: GDELT is throttling this address, or not answering
     * at all (5xx, timeout, network). The agent is told to use another source.
     */
    | { kind: 'unavailable'; query: string; reason: 'throttled' | 'down'; detail: string }
    /** GDELT rejected the query itself — too short, too common, malformed. */
    | { kind: 'refused'; query: string; message: string };

export interface SearchOptions {
    query: string;
    /** Source languages, in English: `french`, `arabic`, `chinese`. */
    languages?: string[];
    /** Source countries, in English, spaces dropped: `france`, `unitedkingdom`. */
    countries?: string[];
    /** How far back, in days. */
    days?: number;
    /** Articles to consider. More gives a truer corroboration count. */
    max?: number;
    /**
     * A health check: a shorter wait, and it neither honours nor starts a
     * cooldown — a probe exists to find out, not to wait.
     */
    probe?: boolean;
}

// ---------------------------------------------------------------------------
// Pacing
// ---------------------------------------------------------------------------

/** Swappable so the pacing can be tested without waiting for real. */
const clock = {
    now: () => Date.now(),
    sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
};

let lastCallAt = 0;
let unavailableUntil = 0;
let lastUnavailable: { reason: 'throttled' | 'down'; detail: string } | null = null;

/** Test seam: run the pacing on a fake clock, and forget all history. */
export function useGdeltClock(fake?: Partial<typeof clock>): void {
    clock.now = fake?.now ?? (() => Date.now());
    clock.sleep = fake?.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    lastCallAt = 0;
    unavailableUntil = 0;
    lastUnavailable = null;
}

/** The body GDELT sends instead of results when this address is over its limit. */
function isThrottled(body: string): boolean {
    return /please limit requests/i.test(body.slice(0, 200));
}

type Reply = { status: number; body: string } | { failed: string };

/**
 * One request, spaced from the last. Never throws: every way of not getting
 * an answer comes back as a value, because every one of them means the same
 * thing to the agent — use another source.
 */
async function politely(url: string, timeoutMs: number): Promise<Reply> {
    const wait = lastCallAt + MIN_GAP_MS - clock.now();
    if (wait > 0) await clock.sleep(wait);
    lastCallAt = clock.now();

    try {
        const response = await fetch(url, {
            headers: { 'User-Agent': 'Delphi/1.0 (+https://github.com/ctrancec/delphi-mvp)' },
            signal: AbortSignal.timeout(timeoutMs),
        });
        return { status: response.status, body: await response.text() };
    } catch (err) {
        const e = err as Error;
        return {
            failed:
                e.name === 'TimeoutError'
                    ? `no answer within ${timeoutMs / 1000}s`
                    : e.message || 'the request failed',
        };
    }
}

/** Why a reply is not a result, or null when it is one (or a refusal). */
function unavailability(reply: Reply): { reason: 'throttled' | 'down'; detail: string } | null {
    if ('failed' in reply) return { reason: 'down', detail: reply.failed };
    // GDELT signals overload three ways, seen live: the throttle text (with a
    // 200 or a 429), a bare 429, and a 503. Only the text is reliable alone.
    if (isThrottled(reply.body) || reply.status === 429) {
        return { reason: 'throttled', detail: 'rate-limiting this address' };
    }
    if (reply.status >= 500) return { reason: 'down', detail: `HTTP ${reply.status}` };
    return null;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/** Letters only — these become query operators, so nothing else gets in. */
function operatorValue(raw: string): string {
    return raw.toLowerCase().replace(/[^a-z]/g, '');
}

function anyOf(operator: string, values: string[] | undefined): string | null {
    const clean = [...new Set((values ?? []).map(operatorValue).filter(Boolean))].slice(0, 10);
    if (!clean.length) return null;
    const terms = clean.map((v) => `${operator}:${v}`);
    return terms.length === 1 ? terms[0] : `(${terms.join(' OR ')})`;
}

export function buildQuery(opts: Pick<SearchOptions, 'query' | 'languages' | 'countries'>): string {
    return [opts.query.trim(), anyOf('sourcelang', opts.languages), anyOf('sourcecountry', opts.countries)]
        .filter(Boolean)
        .join(' ');
}

/** `20260924T143000Z` → `2026-09-24 14:30Z`. */
function readableDate(seen: string): string {
    const m = seen.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/);
    return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}Z` : seen;
}

export async function searchGdelt(opts: SearchOptions): Promise<GdeltOutcome> {
    const query = buildQuery(opts);
    const days = Math.min(Math.max(Math.trunc(opts.days ?? 3), 1), 90);
    const max = Math.min(Math.max(Math.trunc(opts.max ?? 50), 1), 100);

    const params = new URLSearchParams({
        query,
        mode: 'artlist',
        format: 'json',
        sort: 'datedesc',
        maxrecords: String(max),
        timespan: `${days}d`,
    });
    const url = `${BASE_URL}?${params}`;

    // Recently found unavailable: say so without asking again. A probe always
    // asks, since finding out is its whole job.
    if (!opts.probe && lastUnavailable && clock.now() < unavailableUntil) {
        return {
            kind: 'unavailable',
            query,
            ...lastUnavailable,
            detail: `${lastUnavailable.detail}; not retried, still cooling off`,
        };
    }

    // One attempt. Retrying a refusal only prolongs it.
    const reply = await politely(url, opts.probe ? PROBE_TIMEOUT_MS : REQUEST_TIMEOUT_MS);
    const down = unavailability(reply);

    if (down) {
        if (!opts.probe) {
            lastUnavailable = down;
            unavailableUntil = clock.now() + COOLDOWN_MS;
        }
        return { kind: 'unavailable', query, ...down };
    }
    lastUnavailable = null;

    const body = 'body' in reply ? reply.body : '';
    let data: { articles?: Record<string, unknown>[] };
    try {
        data = JSON.parse(body);
    } catch {
        // GDELT explains a rejected query in plain text. Pass it on verbatim:
        // the agent can only rephrase if it knows what was wrong.
        return { kind: 'refused', query, message: body.trim().slice(0, 300) || 'No reason given.' };
    }

    const articles: GdeltArticle[] = (data.articles ?? [])
        .map((a) => ({
            url: String(a.url ?? '').trim(),
            title: String(a.title ?? '').trim(),
            domain: String(a.domain ?? '').trim().toLowerCase(),
            language: String(a.language ?? '').trim(),
            country: String(a.sourcecountry ?? '').trim(),
            seenAt: readableDate(String(a.seendate ?? '')),
        }))
        .filter((a) => /^https?:\/\//.test(a.url) && a.title);

    return { kind: 'ok', query, articles };
}

// ---------------------------------------------------------------------------
// Corroboration
// ---------------------------------------------------------------------------

/** Words compared when deciding two headlines are the same report. */
const HEADLINE_KEY_WORDS = 12;

/**
 * The part of a headline that identifies the report.
 *
 * Accents, case and punctuation go, so "Grève à la Banque du Canada" matches
 * "GREVE A LA BANQUE DU CANADA". A trailing `| Outlet` goes, since that is the
 * site naming itself rather than the story. And only the opening words are
 * compared, because syndicated copies agree on how a story starts even where
 * one site trims or extends the end.
 */
export function headlineKey(title: string): string {
    return title
        .replace(/\s+\|\s+[^|]*$/, '')
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim()
        .split(' ')
        .slice(0, HEADLINE_KEY_WORDS)
        .join(' ');
}

export interface GdeltReport {
    headline: string;
    articles: GdeltArticle[];
    outlets: string[];
    countries: string[];
    languages: string[];
    firstSeen: string;
}

export interface Corroboration {
    articles: number;
    outlets: number;
    countries: string[];
    languages: string[];
    /** One per distinct headline, most widely carried first. */
    reports: GdeltReport[];
    /** Outlets that ran a headline another outlet had already run. */
    syndicatedCopies: number;
}

const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))];

export function corroborate(articles: GdeltArticle[]): Corroboration {
    const groups = new Map<string, GdeltArticle[]>();
    for (const a of articles) {
        const key = headlineKey(a.title) || a.url;
        const group = groups.get(key);
        if (group) group.push(a);
        else groups.set(key, [a]);
    }

    const reports: GdeltReport[] = [...groups.values()].map((group) => {
        const byTime = [...group].sort((x, y) => x.seenAt.localeCompare(y.seenAt));
        return {
            headline: byTime[0].title,
            articles: byTime,
            outlets: uniq(group.map((a) => a.domain)),
            countries: uniq(group.map((a) => a.country)),
            languages: uniq(group.map((a) => a.language)),
            firstSeen: byTime[0].seenAt,
        };
    });

    reports.sort(
        (a, b) => b.outlets.length - a.outlets.length || a.firstSeen.localeCompare(b.firstSeen)
    );

    return {
        articles: articles.length,
        outlets: uniq(articles.map((a) => a.domain)).length,
        countries: uniq(articles.map((a) => a.country)),
        languages: uniq(articles.map((a) => a.language)),
        reports,
        syndicatedCopies: reports.reduce((n, r) => n + Math.max(0, r.outlets.length - 1), 0),
    };
}

export function isGdeltConfigured(): boolean {
    return true;
}

export async function checkGdeltHealth(): Promise<{ ok: boolean; detail?: string }> {
    const r = await searchGdelt({ query: 'economy', days: 1, max: 1, probe: true });
    if (r.kind === 'ok') return { ok: true };
    if (r.kind === 'unavailable' && r.reason === 'throttled') {
        // Reachable, which is what a probe asks. The throttle is shared with
        // everyone on this address and passes in seconds.
        return {
            ok: true,
            detail: 'Reachable, but rate-limiting this address right now. Agents fall back to RSS until it clears.',
        };
    }
    if (r.kind === 'unavailable') {
        return {
            ok: false,
            detail: `Not answering (${r.detail}). Agents wait longer than this probe, and fall back to RSS if it still does not answer.`,
        };
    }
    return { ok: false, detail: r.message };
}
