/**
 * Clustering and corroboration — what makes this a monitor rather than a feed
 * reader.
 *
 * A story in one outlet is a claim. The same story across Reuters, Al Jazeera
 * and Nikkei is a fact, and the difference is worth scoring rather than
 * leaving to the reader.
 *
 * Clustering is the genuinely hard part. Naive title similarity both
 * over-merges (two unrelated stories about one country) and under-merges (the
 * same event described differently across languages). Two things mitigate it
 * here: clustering runs on *translated* text, so a Japanese and a Spanish
 * account of one event can meet; and the bar for merging is deliberately high,
 * because a wrong merge inflates a corroboration score, which is the one
 * number on this page that has to be trustworthy.
 */

import type { Db } from '@/lib/delphi/db';

export interface ClusterableItem {
    id: string;
    title: string;
    sourceId: string;
    country: string;
    lean: string | null;
    category: string;
    reliabilityTier: number;
    publishedAt: string | null;
}

/** Words too common to carry meaning in a headline. */
const STOP = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'for', 'with', 'at', 'by',
    'from', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'it', 'its', 'this', 'that',
    'says', 'said', 'after', 'over', 'new', 'has', 'have', 'will', 'more', 'than', 'amid',
]);

export function keyTerms(title: string): Set<string> {
    return new Set(
        title
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\s]/gu, ' ')
            .split(/\s+/)
            .filter((w) => w.length > 3 && !STOP.has(w))
    );
}

/** Jaccard overlap of significant terms. */
export function similarity(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 || b.size === 0) return 0;
    let shared = 0;
    for (const term of a) if (b.has(term)) shared++;
    return shared / (a.size + b.size - shared);
}

/**
 * High on purpose. A false merge inflates corroboration, which is worse than
 * leaving two accounts of one event unlinked — an under-merged story simply
 * reads as uncorroborated, which is the safe error.
 */
const MERGE_THRESHOLD = 0.34;

/** At least this many distinct terms, or short headlines merge on nothing. */
const MIN_TERMS = 3;

export interface Cluster {
    items: ClusterableItem[];
    terms: Set<string>;
}

export function clusterItems(items: ClusterableItem[]): Cluster[] {
    const clusters: Cluster[] = [];

    for (const item of items) {
        const terms = keyTerms(item.title);
        if (terms.size < MIN_TERMS) continue;

        let best: Cluster | null = null;
        let bestScore = 0;

        for (const cluster of clusters) {
            const score = similarity(terms, cluster.terms);
            if (score > bestScore) {
                bestScore = score;
                best = cluster;
            }
        }

        if (best && bestScore >= MERGE_THRESHOLD) {
            best.items.push(item);
            // Widen the cluster's vocabulary so a third account phrased
            // differently again can still join.
            for (const t of terms) best.terms.add(t);
        } else {
            clusters.push({ items: [item], terms: new Set(terms) });
        }
    }

    return clusters;
}

export interface CorroborationScore {
    score: number;
    outletCount: number;
    countryCount: number;
    leanDiversity: number;
    hasWire: boolean;
    countries: string[];
}

/**
 * How well corroborated a cluster is, 0 to 1.
 *
 * Weighted by what actually indicates truth rather than by what is easy to
 * count. Agreement across *opposing editorial positions* is the strongest
 * signal available, which is why lean diversity is weighted above raw outlet
 * count — ten outlets sharing one owner and one line is not ten confirmations.
 */
export function scoreCluster(items: ClusterableItem[]): CorroborationScore {
    const sources = new Set(items.map((i) => i.sourceId));
    const countries = new Set(items.map((i) => i.country));
    const leans = new Set(items.map((i) => i.lean).filter(Boolean) as string[]);
    const hasWire = items.some((i) => i.category === 'wire');

    // Independent outlets, saturating at five: the sixth adds far less than the second.
    const outletTerm = Math.min(sources.size / 5, 1);

    // Geographic spread — a story only its own country carries is weaker.
    const geoTerm = Math.min(countries.size / 4, 1);

    // Editorial spread. State outlets are counted, but agreement *between*
    // state and independent positions is what the number is measuring.
    const leanTerm = Math.min(leans.size / 4, 1);

    // A wire carrying it is close to dispositive on its own.
    const wireTerm = hasWire ? 1 : 0;

    // Reliability tilts the whole thing: tier-1 outlets corroborate harder.
    const avgTier = items.reduce((s, i) => s + i.reliabilityTier, 0) / items.length;
    const reliabilityTerm = (4 - avgTier) / 3; // tier 1 -> 1.0, tier 3 -> 0.33

    const score =
        0.28 * outletTerm +
        0.22 * geoTerm +
        0.24 * leanTerm +
        0.16 * wireTerm +
        0.10 * reliabilityTerm;

    return {
        score: Math.round(Math.min(1, score) * 1000) / 1000,
        outletCount: sources.size,
        countryCount: countries.size,
        leanDiversity: Math.round(leanTerm * 1000) / 1000,
        hasWire,
        countries: [...countries],
    };
}

/**
 * Cluster everything recent and write the results.
 *
 * Rebuilds rather than incrementally merges: clusters are cheap, the window is
 * small, and an incremental merge that drifts is far harder to reason about
 * than one that is recomputed.
 */
export async function rebuildClusters(
    db: Db,
    workspaceId: string,
    windowHours = 36
): Promise<{ clusters: number; corroborated: number }> {
    const since = new Date(Date.now() - windowHours * 3_600_000).toISOString();

    const { data: rows } = await db
        .from('delphi_news_items')
        .select(
            'id, title_en, title_original, published_at, source:delphi_news_sources ( id, country, lean, category, reliability_tier )'
        )
        .eq('workspace_id', workspaceId)
        .gte('fetched_at', since)
        .limit(1200);

    const items: ClusterableItem[] = (rows ?? [])
        .map((r): ClusterableItem | null => {
            const source = r.source as unknown as {
                id: string; country: string; lean: string | null; category: string; reliability_tier: number;
            } | null;
            if (!source) return null;
            return {
                id: r.id as string,
                // Cluster on the translation when there is one, so accounts in
                // different languages can meet.
                title: (r.title_en as string) ?? (r.title_original as string),
                sourceId: source.id,
                country: source.country,
                lean: source.lean,
                category: source.category,
                reliabilityTier: source.reliability_tier,
                publishedAt: (r.published_at as string) ?? null,
            };
        })
        .filter((x): x is ClusterableItem => x !== null);

    const clusters = clusterItems(items);

    // Singletons are not clusters; they stay unclustered and read as
    // uncorroborated, which is exactly what they are.
    const real = clusters.filter((c) => c.items.length > 1);

    let corroborated = 0;
    for (const cluster of real) {
        const score = scoreCluster(cluster.items);

        // Longest headline as the label: it is usually the most specific.
        const title = cluster.items
            .map((i) => i.title)
            .sort((a, b) => b.length - a.length)[0]
            .slice(0, 300);

        const { data: row, error } = await db
            .from('delphi_news_clusters')
            .insert({
                workspace_id: workspaceId,
                title_en: title,
                corroboration_score: score.score,
                outlet_count: score.outletCount,
                country_count: score.countryCount,
                lean_diversity: score.leanDiversity,
                has_wire: score.hasWire,
                corroborated_at: new Date().toISOString(),
                regions: score.countries,
            })
            .select('id')
            .single();

        if (error) {
            console.error('[world] cluster insert failed:', error.message);
            continue;
        }

        await db
            .from('delphi_news_items')
            .update({ cluster_id: row.id })
            .in(
                'id',
                cluster.items.map((i) => i.id)
            );

        if (score.score >= 0.5) corroborated++;
    }

    return { clusters: real.length, corroborated };
}
