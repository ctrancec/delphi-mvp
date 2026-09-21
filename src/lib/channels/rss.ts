/**
 * RSS — news ingestion.
 *
 * Uses `rss-parser`, already a dependency. Feeds break constantly: outlets
 * change URLs, rate-limit and geo-block. So a failing feed is skipped rather
 * than failing the whole pull — partial coverage beats no coverage, and the
 * agent is told which sources it actually got.
 */

import Parser from 'rss-parser';

export interface FeedItem {
    title: string;
    url: string;
    source: string;
    publishedAt?: string;
    summary?: string;
}

/**
 * A deliberately global default set, not an Anglophone one. State-affiliated
 * outlets are included on purpose: they are signal about what a state is
 * saying, which is different from, and sometimes more useful than, what is true.
 */
export const DEFAULT_FEEDS: { url: string; source: string }[] = [
    { url: 'https://feeds.reuters.com/reuters/worldNews', source: 'Reuters' },
    { url: 'https://feeds.bbci.co.uk/news/world/rss.xml', source: 'BBC' },
    { url: 'https://www.aljazeera.com/xml/rss/all.xml', source: 'Al Jazeera' },
    { url: 'https://rss.dw.com/rdf/rss-en-world', source: 'DW' },
    { url: 'https://www.france24.com/en/rss', source: 'France 24' },
    { url: 'https://www3.nhk.or.jp/nhkworld/en/news/feeds/', source: 'NHK World' },
    { url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html', source: 'CNBC' },
    { url: 'https://feeds.a.dj.com/rss/RSSWorldNews.xml', source: 'WSJ' },
];

const parser = new Parser({
    timeout: 10_000,
    headers: { 'User-Agent': 'Delphi/1.0 (+https://github.com/ctrancec/delphi-mvp)' },
});

/** RSS needs no credentials, so it is always available. */
export function isRssConfigured(): boolean {
    return true;
}

export async function fetchFeeds(
    opts: { feeds?: string[]; limit?: number } = {}
): Promise<FeedItem[]> {
    const targets = opts.feeds?.length
        ? opts.feeds.map((url) => ({ url, source: hostOf(url) }))
        : DEFAULT_FEEDS;

    const settled = await Promise.allSettled(
        targets.map(async (t): Promise<FeedItem[]> => {
            const feed = await parser.parseURL(t.url);
            return (feed.items ?? []).map((i) => ({
                title: (i.title ?? '').trim(),
                url: (i.link ?? '').trim(),
                source: feed.title?.trim() || t.source,
                publishedAt: i.isoDate ?? i.pubDate,
                summary: (i.contentSnippet ?? '').trim().slice(0, 300) || undefined,
            }));
        })
    );

    const items = settled
        .filter((r): r is PromiseFulfilledResult<FeedItem[]> => r.status === 'fulfilled')
        .flatMap((r) => r.value)
        .filter((i) => i.title && i.url);

    const failed = settled.filter((r) => r.status === 'rejected').length;
    if (failed) console.warn(`[delphi] ${failed}/${targets.length} feeds failed; continuing`);

    // Newest first, dropping duplicates that syndicate across outlets.
    const seen = new Set<string>();
    return items
        .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
        .filter((i) => (seen.has(i.url) ? false : (seen.add(i.url), true)))
        .slice(0, opts.limit ?? 20);
}

function hostOf(url: string): string {
    try {
        return new URL(url).hostname.replace(/^www\./, '');
    } catch {
        return url;
    }
}

export async function checkRssHealth(): Promise<{ ok: boolean; detail?: string }> {
    try {
        const items = await fetchFeeds({ limit: 3 });
        return items.length
            ? { ok: true }
            : { ok: false, detail: 'All default feeds failed or returned nothing' };
    } catch (err) {
        return { ok: false, detail: (err as Error).message };
    }
}
