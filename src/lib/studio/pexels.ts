/**
 * Stock visuals from Pexels.
 *
 * Free, with a key: 200 requests an hour and 20,000 a month, which is far
 * more than a few videos a day need. Every photo is free to use, including
 * commercially, and the API guidelines ask that the photographer and Pexels
 * be credited — so every visual carries its credit line and the studio puts
 * them in the description.
 *
 * Without a key, the studio paints its own backgrounds from the brand's
 * colours instead. Nothing here is required for a video to exist.
 *
 * Docs: https://www.pexels.com/api/documentation/
 */

export const PEXELS_ENV = 'PEXELS_API_KEY';

export function isPexelsConfigured(): boolean {
    return Boolean(process.env[PEXELS_ENV]?.trim());
}

export type Orientation = 'portrait' | 'landscape' | 'square';

export interface Visual {
    id: number;
    /** The photo, cropped to exactly the frame by Pexels' own image service. */
    url: string;
    pageUrl: string;
    photographer: string;
    photographerUrl: string;
    alt: string;
    /** Average colour of the photo, as Pexels reports it. */
    avgColor: string | null;
}

export function orientationFor(width: number, height: number): Orientation {
    if (width === height) return 'square';
    return width > height ? 'landscape' : 'portrait';
}

/**
 * Pexels serves every photo through an image service that resizes and crops
 * by query string — the same mechanism its own `src` variants use. Asking
 * for the frame size with `fit=crop` gets a centred crop at exactly the
 * pixels the render needs, and nothing has to be scaled afterwards.
 */
export function framedUrl(original: string, width: number, height: number): string {
    const base = original.split('?')[0];
    return `${base}?auto=compress&cs=tinysrgb&fit=crop&w=${width}&h=${height}`;
}

export function creditLine(v: Visual): string {
    return `Photo by ${v.photographer} on Pexels (${v.pageUrl})`;
}

interface PexelsPhoto {
    id: number;
    url: string;
    photographer: string;
    photographer_url: string;
    alt: string | null;
    avg_color: string | null;
    src: { original: string };
}

/**
 * Search photos. Returns an empty list when the key is missing or the
 * service refuses, so a render never fails for want of a stock photo.
 */
export async function searchPhotos(
    query: string,
    frame: { width: number; height: number },
    opts: { perPage?: number; fetchImpl?: typeof fetch } = {}
): Promise<Visual[]> {
    const key = process.env[PEXELS_ENV]?.trim();
    if (!key) return [];
    const q = query.trim();
    if (!q) return [];

    const url = new URL('https://api.pexels.com/v1/search');
    url.searchParams.set('query', q);
    url.searchParams.set('orientation', orientationFor(frame.width, frame.height));
    url.searchParams.set('per_page', String(opts.perPage ?? 6));
    url.searchParams.set('size', 'large');

    const doFetch = opts.fetchImpl ?? fetch;
    let res: Response;
    try {
        res = await doFetch(url.toString(), {
            headers: { Authorization: key, 'User-Agent': 'Tempest studio (delphi-mvp)' },
            signal: AbortSignal.timeout(15_000),
        });
    } catch {
        return [];
    }
    if (!res.ok) return [];

    let body: { photos?: PexelsPhoto[] };
    try {
        body = (await res.json()) as { photos?: PexelsPhoto[] };
    } catch {
        return [];
    }

    return (body.photos ?? [])
        .filter((p) => p && p.src?.original && p.url)
        .map((p) => ({
            id: p.id,
            url: framedUrl(p.src.original, frame.width, frame.height),
            pageUrl: p.url,
            photographer: p.photographer || 'Unknown',
            photographerUrl: p.photographer_url || 'https://www.pexels.com',
            alt: p.alt ?? '',
            avgColor: p.avg_color ?? null,
        }));
}

/** The first result not used yet; a video of six scenes should not show one photo six times. */
export function pickUnused(results: Visual[], used: Set<number>): Visual | null {
    const fresh = results.find((v) => !used.has(v.id)) ?? results[0] ?? null;
    if (fresh) used.add(fresh.id);
    return fresh;
}

/** Fetch bytes to a buffer, with a cap so a wrong URL cannot fill the disk. */
export async function downloadBytes(
    url: string,
    opts: { maxBytes?: number; fetchImpl?: typeof fetch } = {}
): Promise<Buffer | null> {
    const doFetch = opts.fetchImpl ?? fetch;
    try {
        const res = await doFetch(url, { signal: AbortSignal.timeout(20_000) });
        if (!res.ok) return null;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length === 0 || buf.length > (opts.maxBytes ?? 12_000_000)) return null;
        return buf;
    } catch {
        return null;
    }
}
