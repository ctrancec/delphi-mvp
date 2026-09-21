/**
 * FRED — macroeconomic time series from the St. Louis Fed.
 *
 * Ported from delphi-agent's lib/services/fred.ts, with the observation date
 * kept on every point. That date is what makes a `series` source locator
 * checkable: "DGS10 on 2026-09-19" either exists or it does not.
 */

import { ChannelUnavailableError } from './perplexity';

const BASE_URL = 'https://api.stlouisfed.org/fred/series/observations';

export interface FredPoint {
    date: string;
    value: number;
}

export interface FredSeries {
    seriesId: string;
    title: string;
    units?: string;
    points: FredPoint[];
    /** Most recent observation, which is what analysts quote. */
    latest: FredPoint | null;
}

/** Series an analyst reaches for often enough to be worth naming. */
export const COMMON_SERIES: Record<string, string> = {
    DGS10: '10-Year Treasury Constant Maturity Rate',
    DGS2: '2-Year Treasury Constant Maturity Rate',
    FEDFUNDS: 'Effective Federal Funds Rate',
    CPIAUCSL: 'Consumer Price Index (All Urban Consumers)',
    UNRATE: 'Unemployment Rate',
    GDPC1: 'Real Gross Domestic Product',
    SP500: 'S&P 500 Index',
    DEXUSEU: 'US / Euro Foreign Exchange Rate',
    MORTGAGE30US: '30-Year Fixed Rate Mortgage Average',
    T10Y2Y: '10-Year minus 2-Year Treasury Spread',
};

export function isFredConfigured(): boolean {
    return Boolean(process.env.FRED_API_KEY);
}

/**
 * Fetch observations for a series, oldest first.
 *
 * FRED marks missing observations as "." rather than omitting them. Those are
 * dropped rather than coerced to zero — a zero unemployment rate would be a
 * fabricated data point, which is exactly what this system must not produce.
 */
export async function fetchSeries(
    seriesId: string,
    opts: { limit?: number; units?: string } = {}
): Promise<FredSeries> {
    const apiKey = process.env.FRED_API_KEY;
    if (!apiKey) throw new ChannelUnavailableError('fred', 'FRED_API_KEY is not set');

    const params = new URLSearchParams({
        series_id: seriesId,
        api_key: apiKey,
        file_type: 'json',
        limit: String(opts.limit ?? 24),
        sort_order: 'desc',
    });
    if (opts.units) params.set('units', opts.units);

    const response = await fetch(`${BASE_URL}?${params}`);
    if (!response.ok) {
        throw new ChannelUnavailableError('fred', `${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as { observations?: { date: string; value: string }[] };

    const points: FredPoint[] = (data.observations ?? [])
        .filter((o) => o.value !== '.' && o.value !== '')
        .map((o) => ({ date: o.date, value: Number(o.value) }))
        .filter((p) => Number.isFinite(p.value))
        .reverse(); // oldest first, which is how a series reads

    return {
        seriesId,
        title: COMMON_SERIES[seriesId] ?? seriesId,
        units: opts.units,
        points,
        latest: points.length ? points[points.length - 1] : null,
    };
}

export async function checkFredHealth(): Promise<{ ok: boolean; detail?: string }> {
    if (!isFredConfigured()) return { ok: false, detail: 'FRED_API_KEY is not set' };
    try {
        const s = await fetchSeries('DGS10', { limit: 1 });
        return s.latest
            ? { ok: true }
            : { ok: false, detail: 'FRED returned no observations for DGS10' };
    } catch (err) {
        return { ok: false, detail: (err as Error).message };
    }
}
