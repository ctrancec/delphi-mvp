/**
 * Delphi World.
 *
 * Global outlets, translated to English, ranked by how well corroborated each
 * story is rather than by how recent it is. A story one outlet carries is a
 * claim; the same story across Reuters, Al Jazeera and Nikkei is a fact, and
 * the feed says which is which instead of leaving it to the reader.
 */

import { formatDistanceToNow } from 'date-fns';
import { AlertTriangle, ExternalLink, Globe2, Newspaper, ShieldCheck } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StreamWall, type StreamTile } from '@/components/delphi/world/stream-wall';
import { WorldRefreshButton } from '@/components/delphi/world/refresh-button';
import { findWorkspace } from '@/lib/delphi/bootstrap';
import { regionOf } from '@/lib/world/sources';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

interface ClusterRow {
    id: string;
    title_en: string;
    corroboration_score: number;
    outlet_count: number;
    country_count: number;
    has_wire: boolean;
    corroborated_at: string | null;
    regions: string[];
}

interface ItemRow {
    id: string;
    cluster_id: string | null;
    url: string;
    language: string;
    title_original: string;
    title_en: string | null;
    published_at: string | null;
    source: { name: string; country: string; lean: string | null; category: string } | null;
}

function confidenceOf(score: number): { label: string; tone: string } {
    if (score >= 0.7) return { label: 'well corroborated', tone: 'text-emerald-400 border-emerald-400/30' };
    if (score >= 0.45) return { label: 'corroborated', tone: 'text-sky-400 border-sky-400/30' };
    return { label: 'thin', tone: 'text-amber-400 border-amber-400/30' };
}

export default async function WorldPage() {
    const supabase = await createClient();
    if (!supabase) {
        return (
            <Card className="border-white/10 bg-black/40">
                <CardContent className="py-10 text-center text-muted-foreground">
                    Supabase is not configured.
                </CardContent>
            </Card>
        );
    }

    const workspaceId = await findWorkspace(supabase);

    const [{ data: clusters }, { data: items }, { data: streams }, { data: sources }] =
        workspaceId
            ? await Promise.all([
                  supabase
                      .from('delphi_news_clusters')
                      .select('*')
                      .eq('workspace_id', workspaceId)
                      .order('corroboration_score', { ascending: false })
                      .order('corroborated_at', { ascending: false })
                      .limit(30),
                  supabase
                      .from('delphi_news_items')
                      .select(
                          'id, cluster_id, url, language, title_original, title_en, published_at, source:delphi_news_sources ( name, country, lean, category )'
                      )
                      .eq('workspace_id', workspaceId)
                      .not('cluster_id', 'is', null)
                      .order('published_at', { ascending: false })
                      .limit(400),
                  supabase
                      .from('delphi_streams')
                      .select('id, label, external_id, category')
                      .eq('workspace_id', workspaceId)
                      .eq('enabled', true)
                      .order('sort_order'),
                  supabase
                      .from('delphi_news_sources')
                      .select('name, country, health, last_error')
                      .eq('workspace_id', workspaceId),
              ])
            : [{ data: null }, { data: null }, { data: null }, { data: null }];

    const clusterList = (clusters ?? []) as ClusterRow[];
    const itemList = (items ?? []) as unknown as ItemRow[];

    const byCluster = new Map<string, ItemRow[]>();
    for (const item of itemList) {
        if (!item.cluster_id) continue;
        const list = byCluster.get(item.cluster_id) ?? [];
        list.push(item);
        byCluster.set(item.cluster_id, list);
    }

    const sourceList = (sources ?? []) as { name: string; country: string; health: string; last_error: string | null }[];
    const healthy = sourceList.filter((s) => s.health === 'ok').length;
    const broken = sourceList.filter((s) => s.health === 'error');

    const streamTiles: StreamTile[] = (streams ?? []).map((s) => ({
        id: s.id as string,
        label: s.label as string,
        externalId: s.external_id as string,
        category: s.category as string,
    }));

    return (
        <div className="space-y-6">
            <div>
                <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
                    <Globe2 className="h-6 w-6" /> World
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    Outlets from around the world, translated to English and ranked by corroboration
                    rather than recency. State-affiliated outlets are included deliberately — what a
                    state is saying is signal — and labelled so nothing reads as neutral when it is not.
                </p>
            </div>

            <div className="flex flex-wrap items-center gap-4">
                <WorldRefreshButton />
                {sourceList.length > 0 && (
                    <span className="text-xs text-muted-foreground">
                        {healthy}/{sourceList.length} sources healthy
                        {broken.length > 0 && (
                            <span
                                className="text-amber-400/80"
                                title={broken.map((b) => `${b.name}: ${b.last_error ?? 'error'}`).join('\n')}
                            >
                                {' '}
                                · {broken.length} down
                            </span>
                        )}
                    </span>
                )}
            </div>

            {clusterList.length === 0 ? (
                <Card className="border-dashed border-white/10 bg-black/40">
                    <CardContent className="space-y-3 py-14 text-center">
                        <Newspaper className="mx-auto h-10 w-10 text-muted-foreground/40" />
                        <h3 className="text-lg font-semibold">Nothing gathered yet</h3>
                        <p className="mx-auto max-w-md text-sm text-muted-foreground">
                            Hit refresh to pull around thirty outlets across a dozen countries. Stories
                            carried by more than one independent outlet get clustered and scored; a
                            single-source story stays a single-source story.
                        </p>
                    </CardContent>
                </Card>
            ) : (
                <section className="space-y-3">
                    <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                        Corroborated stories
                    </h2>
                    <div className="space-y-3">
                        {clusterList.map((c) => {
                            const confidence = confidenceOf(Number(c.corroboration_score));
                            const members = byCluster.get(c.id) ?? [];
                            const regions = [...new Set(c.regions.map(regionOf))];

                            return (
                                <Card key={c.id} className="border-white/10 bg-black/40">
                                    <CardContent className="space-y-3 pt-5">
                                        <div className="flex flex-wrap items-start justify-between gap-3">
                                            <h3 className="min-w-0 text-sm font-semibold leading-snug">
                                                {c.title_en}
                                            </h3>
                                            <Badge
                                                variant="outline"
                                                className={cn('shrink-0 text-[10px]', confidence.tone)}
                                                title={`Corroboration ${Number(c.corroboration_score).toFixed(2)}`}
                                            >
                                                {confidence.label}
                                            </Badge>
                                        </div>

                                        <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                                            <span>
                                                {c.outlet_count} outlet{c.outlet_count === 1 ? '' : 's'}
                                            </span>
                                            <span>
                                                {c.country_count} countr{c.country_count === 1 ? 'y' : 'ies'}
                                            </span>
                                            {c.has_wire && (
                                                <span className="flex items-center gap-1 text-emerald-400/80">
                                                    <ShieldCheck className="h-3 w-3" /> on the wire
                                                </span>
                                            )}
                                            {regions.length > 0 && <span>{regions.join(' · ')}</span>}
                                            {c.corroborated_at && (
                                                <span className="text-muted-foreground/60">
                                                    {formatDistanceToNow(new Date(c.corroborated_at), {
                                                        addSuffix: true,
                                                    })}
                                                </span>
                                            )}
                                        </div>

                                        <div className="space-y-1.5 border-t border-white/5 pt-2">
                                            {members.slice(0, 6).map((m) => (
                                                <a
                                                    key={m.id}
                                                    href={m.url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="group flex items-start gap-2 text-xs"
                                                >
                                                    <span className="mt-0.5 w-28 shrink-0 truncate text-muted-foreground">
                                                        {m.source?.name ?? 'unknown'}
                                                    </span>
                                                    {m.source?.lean === 'state' && (
                                                        <Badge
                                                            variant="outline"
                                                            className="shrink-0 border-amber-400/30 px-1 py-0 text-[9px] text-amber-400"
                                                        >
                                                            state
                                                        </Badge>
                                                    )}
                                                    <span className="min-w-0 flex-1 text-zinc-300 group-hover:text-white">
                                                        {m.title_en ?? m.title_original}
                                                        {m.language !== 'en' && (
                                                            <span
                                                                className="ml-1.5 text-[10px] text-muted-foreground/60"
                                                                title={m.title_original}
                                                            >
                                                                ({m.language}
                                                                {m.title_en ? ', translated' : ', untranslated'})
                                                            </span>
                                                        )}
                                                    </span>
                                                    <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/40 group-hover:text-white" />
                                                </a>
                                            ))}
                                            {members.length > 6 && (
                                                <p className="text-[11px] text-muted-foreground/60">
                                                    + {members.length - 6} more
                                                </p>
                                            )}
                                        </div>
                                    </CardContent>
                                </Card>
                            );
                        })}
                    </div>
                </section>
            )}

            <StreamWall streams={streamTiles} />

            {broken.length > 0 && (
                <Card className="border-amber-400/20 bg-black/20">
                    <CardContent className="space-y-1.5 py-4">
                        <p className="flex items-center gap-2 text-xs font-medium text-amber-400">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            {broken.length} feed{broken.length === 1 ? '' : 's'} unreachable
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                            Outlets change URLs, rate-limit and geo-block constantly. Coverage degrades
                            rather than failing — but a source that stays down is a blind spot, and a
                            corroboration score computed without it is measuring a smaller world.
                        </p>
                        <div className="flex flex-wrap gap-1.5 pt-1">
                            {broken.map((b) => (
                                <span
                                    key={b.name}
                                    className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                                    title={b.last_error ?? undefined}
                                >
                                    {b.name}
                                </span>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
