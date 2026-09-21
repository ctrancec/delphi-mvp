/**
 * Pulling the world in.
 *
 * Feeds break constantly — outlets change URLs, rate-limit, and geo-block — so
 * this degrades to partial coverage rather than failing the run. Every source
 * carries its own health, which is what makes "why is there nothing from
 * Japan?" answerable instead of mysterious.
 */

import Parser from 'rss-parser';
import { FEED_USER_AGENT, SEED_SOURCES, SEED_STREAMS, type SeedSource } from './sources';
import type { Db } from '@/lib/delphi/db';

const parser = new Parser({
    timeout: 12_000,
    headers: { 'User-Agent': FEED_USER_AGENT },
});

export interface SourceRow {
    id: string;
    name: string;
    country: string;
    language: string;
    category: string;
    lean: string | null;
    reliability_tier: number;
    rss_url: string | null;
    health: string;
}

/** Idempotent on (workspace_id, name), matching how the agent roster seeds. */
export async function seedWorldSources(
    db: Db,
    workspaceId: string
): Promise<{ sources: number; streams: number }> {
    const { data: existing } = await db
        .from('delphi_news_sources')
        .select('name')
        .eq('workspace_id', workspaceId);

    const have = new Set((existing ?? []).map((s) => s.name as string));
    const missing = SEED_SOURCES.filter((s) => !have.has(s.name));

    if (missing.length) {
        const { error } = await db.from('delphi_news_sources').insert(
            missing.map((s: SeedSource) => ({
                workspace_id: workspaceId,
                name: s.name,
                country: s.country,
                language: s.language,
                category: s.category,
                lean: s.lean,
                reliability_tier: s.reliabilityTier,
                rss_url: s.rssUrl,
                site_url: s.siteUrl,
                enabled: true,
            }))
        );
        if (error) console.error('[world] source seed failed:', error.message);
    }

    const { data: haveStreams } = await db
        .from('delphi_streams')
        .select('external_id')
        .eq('workspace_id', workspaceId);

    const haveIds = new Set((haveStreams ?? []).map((s) => s.external_id as string));
    const missingStreams = SEED_STREAMS.filter((s) => !haveIds.has(s.externalId));

    if (missingStreams.length) {
        const { error } = await db.from('delphi_streams').insert(
            missingStreams.map((s) => ({
                workspace_id: workspaceId,
                label: s.label,
                provider: s.provider,
                external_id: s.externalId,
                category: s.category,
                language: s.language,
                sort_order: s.sortOrder,
                enabled: true,
            }))
        );
        if (error) console.error('[world] stream seed failed:', error.message);
    }

    return { sources: missing.length, streams: missingStreams.length };
}

export interface IngestResult {
    sourcesTried: number;
    /** Responded at all, empty ones included. */
    sourcesOk: number;
    /** Responded but carried nothing — counted separately from healthy. */
    sourcesEmpty: number;
    itemsInserted: number;
    failures: { source: string; error: string }[];
}

/**
 * Fetch every enabled source once and store what is new.
 *
 * Sources are fetched in parallel but bounded, because a serverless invocation
 * has a wall clock and thirty sequential HTTP round trips would spend it.
 */
export async function ingestNews(
    db: Db,
    workspaceId: string,
    opts: { limitPerSource?: number; deadline?: number } = {}
): Promise<IngestResult> {
    const limitPerSource = opts.limitPerSource ?? 12;

    const { data: sources } = await db
        .from('delphi_news_sources')
        .select('id, name, country, language, category, lean, reliability_tier, rss_url, health')
        .eq('workspace_id', workspaceId)
        .eq('enabled', true);

    const list = (sources ?? []) as SourceRow[];
    const result: IngestResult = {
        sourcesTried: list.length,
        sourcesOk: 0,
        sourcesEmpty: 0,
        itemsInserted: 0,
        failures: [],
    };

    const CONCURRENCY = 6;
    for (let i = 0; i < list.length; i += CONCURRENCY) {
        if (opts.deadline && Date.now() > opts.deadline) break;

        const batch = list.slice(i, i + CONCURRENCY);
        const settled = await Promise.allSettled(
            batch.map(async (source) => {
                if (!source.rss_url) throw new Error('No RSS URL configured.');
                const feed = await parser.parseURL(source.rss_url);

                const rows = (feed.items ?? [])
                    .slice(0, limitPerSource)
                    .filter((item) => item.link && item.title)
                    .map((item) => ({
                        workspace_id: workspaceId,
                        source_id: source.id,
                        url: item.link!,
                        language: source.language,
                        title_original: item.title!.slice(0, 500),
                        summary_original:
                            (item.contentSnippet ?? item.content ?? '').slice(0, 1200) || null,
                        // English-language sources need no translation pass, so
                        // they are marked done on arrival and never queued.
                        title_en: source.language === 'en' ? item.title!.slice(0, 500) : null,
                        summary_en:
                            source.language === 'en'
                                ? (item.contentSnippet ?? item.content ?? '').slice(0, 1200) || null
                                : null,
                        translated_at: source.language === 'en' ? new Date().toISOString() : null,
                        published_at: item.isoDate ?? item.pubDate ?? null,
                    }));

                if (rows.length) {
                    // Ignoring conflicts on (workspace_id, url) is what makes a
                    // re-run cheap: a feed republishing the same 12 links costs
                    // one upsert, not twelve duplicates.
                    const { error } = await db
                        .from('delphi_news_items')
                        .upsert(rows, { onConflict: 'workspace_id,url', ignoreDuplicates: true });
                    if (error) throw new Error(error.message);
                }

                return { source, count: rows.length };
            })
        );

        for (let j = 0; j < settled.length; j++) {
            const outcome = settled[j];
            const source = batch[j];

            if (outcome.status === 'fulfilled') {
                result.sourcesOk++;
                result.itemsInserted += outcome.value.count;

                // A feed that parses to nothing is a blind spot wearing a green
                // badge: it contributes no items, but counted as healthy it
                // makes coverage look wider than it is, and coverage is what
                // the corroboration score is computed over.
                const empty = outcome.value.count === 0;
                if (empty) result.sourcesEmpty++;

                await db
                    .from('delphi_news_sources')
                    .update({
                        health: empty ? 'degraded' : 'ok',
                        last_ok_at: new Date().toISOString(),
                        last_error: empty ? 'Feed resolved but contained no items.' : null,
                    })
                    .eq('id', source.id);
            } else {
                const message = (outcome.reason as Error)?.message ?? 'unknown error';
                result.failures.push({ source: source.name, error: message });
                await db
                    .from('delphi_news_sources')
                    .update({ health: 'error', last_error: message.slice(0, 500) })
                    .eq('id', source.id);
            }
        }
    }

    return result;
}
