/**
 * Bank of Canada — the Valet API.
 *
 * The Canadian half of the macro picture. FRED carries some Canadian data, but
 * monthly and by way of the OECD, so the policy rate it reports can trail a
 * decision by weeks. Valet is the Bank's own publication: USD/CAD and the
 * overnight target daily, benchmark bond yields daily, core CPI monthly.
 *
 * Every observation keeps its date, which is what makes a `series` locator
 * checkable — the same contract as FRED. Ids are cited with a `BOC:` prefix so
 * a claim says which institution the number came from, and so nobody goes
 * looking for FXUSDCAD on FRED.
 *
 * No key. Public, official, and rate-limited only by courtesy.
 */

import { ChannelUnavailableError } from './perplexity';

const BASE_URL = 'https://www.bankofcanada.ca/valet/observations';

/** How a Bank of Canada series is cited: `BOC:FXUSDCAD`. */
export const BOC_PREFIX = 'BOC:';

/** What an analyst covering Canada reaches for. Each one verified against Valet. */
export const COMMON_BOC_SERIES: Record<string, string> = {
    FXUSDCAD: 'USD/CAD — Canadian dollars per US dollar, daily',
    V39079: 'Target for the overnight rate (the policy rate), %',
    'BD.CDN.2YR.DQ.YLD': 'Government of Canada 2-year benchmark bond yield, %',
    'BD.CDN.5YR.DQ.YLD': 'Government of Canada 5-year benchmark bond yield, %',
    'BD.CDN.10YR.DQ.YLD': 'Government of Canada 10-year benchmark bond yield, %',
    'BD.CDN.LONG.DQ.YLD': 'Government of Canada long-term benchmark bond yield, %',
    CPI_TRIM: 'CPI-trim, year-over-year % (core inflation, monthly)',
    CPI_MEDIAN: 'CPI-median, year-over-year % (core inflation, monthly)',
    CPI_COMMON: 'CPI-common, year-over-year % (core inflation, monthly)',
};

export interface BocPoint {
    date: string;
    value: number;
}

export interface BocSeries {
    /** The Valet id, without the citation prefix. */
    seriesId: string;
    label: string;
    /** Oldest first, which is how a series reads. */
    points: BocPoint[];
    latest: BocPoint | null;
}

export interface BocResult {
    series: BocSeries[];
    /** Ids Valet does not have. Named, so nothing is asserted for them. */
    unknown: string[];
}

interface ValetResponse {
    seriesDetail?: Record<string, { label?: string; description?: string }>;
    observations?: ({ d?: string } & Record<string, unknown>)[];
}

/** Valet needs no credentials, so it is always available. */
export function isBocConfigured(): boolean {
    return true;
}

/** `BOC:fxusdcad` → `FXUSDCAD`. Agents send both forms, and either case. */
export function bareBocId(id: string): string {
    const trimmed = id.trim().toUpperCase();
    return trimmed.startsWith(BOC_PREFIX) ? trimmed.slice(BOC_PREFIX.length) : trimmed;
}

/**
 * One series out of a Valet response.
 *
 * The observations are sparse: a request mixing daily and monthly series
 * returns one row per date, carrying only the series observed that day. So
 * each series is read out on its own, and a blank is dropped rather than
 * coerced — a zero policy rate would be a fabricated data point.
 */
function toSeries(id: string, data: ValetResponse): BocSeries {
    const points: BocPoint[] = [];
    for (const o of data.observations ?? []) {
        const raw = (o[id] as { v?: unknown } | undefined)?.v;
        if (typeof o.d !== 'string' || raw === undefined || raw === null || raw === '') continue;
        const value = Number(raw);
        if (Number.isFinite(value)) points.push({ date: o.d, value });
    }

    // Valet does not promise an order; a series read backwards misleads.
    points.sort((a, b) => a.date.localeCompare(b.date));

    const detail = data.seriesDetail?.[id];
    return {
        seriesId: id,
        label: COMMON_BOC_SERIES[id] ?? detail?.label ?? id,
        points,
        latest: points.length ? points[points.length - 1] : null,
    };
}

/**
 * Fetch several series in one request.
 *
 * Valet fails the whole request when any one id is unknown. So the id it names
 * is set aside and the rest are asked for again: one bad guess from an agent
 * should not cost it the series that do exist.
 */
export async function fetchBocSeries(
    ids: string[],
    opts: { recent?: number } = {}
): Promise<BocResult> {
    let wanted = [...new Set(ids.map(bareBocId).filter(Boolean))];
    const unknown: string[] = [];
    const recent = Math.min(Math.max(Math.trunc(opts.recent ?? 10), 1), 100);

    while (wanted.length) {
        const url = `${BASE_URL}/${wanted.map(encodeURIComponent).join(',')}/json?recent=${recent}`;
        const response = await fetch(url);

        if (response.status === 404) {
            const body = (await response.json().catch(() => null)) as { message?: string } | null;
            const missing = body?.message?.match(/Series (\S+) not found/i)?.[1]?.toUpperCase();
            if (!missing || !wanted.includes(missing)) {
                throw new ChannelUnavailableError('boc', body?.message ?? '404 Not Found');
            }
            unknown.push(missing);
            wanted = wanted.filter((w) => w !== missing);
            continue;
        }

        if (!response.ok) {
            throw new ChannelUnavailableError('boc', `${response.status} ${response.statusText}`);
        }

        const data = (await response.json()) as ValetResponse;
        return { series: wanted.map((id) => toSeries(id, data)), unknown };
    }

    return { series: [], unknown };
}

export async function checkBocHealth(): Promise<{ ok: boolean; detail?: string }> {
    try {
        const { series } = await fetchBocSeries(['FXUSDCAD'], { recent: 1 });
        return series[0]?.latest
            ? { ok: true }
            : { ok: false, detail: 'Valet returned no observation for USD/CAD' };
    } catch (err) {
        return { ok: false, detail: (err as Error).message };
    }
}
