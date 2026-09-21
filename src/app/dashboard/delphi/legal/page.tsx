/**
 * The reference library.
 *
 * What the L.L.R. board reads from. Without it, every legal finding is the
 * model's recall of law it saw in training — unverifiable, silently out of
 * date, and stated with identical confidence whether it is right or not.
 *
 * Staleness is the main hazard here and it is shown, not hidden. Platform
 * terms change quarterly; a finding resting on a year-old policy is worse than
 * no finding, because it looks like research.
 */

import { BookOpen, ExternalLink, Scale, ShieldQuestion } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LibraryControls, LibraryQuery } from '@/components/delphi/legal/library-controls';
import { findWorkspace } from '@/lib/delphi/bootstrap';
import { LEGAL_SOURCES, ageInDays, isStale } from '@/lib/legal/sources';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const CATEGORY_TONE: Record<string, string> = {
    statute: 'text-sky-400 border-sky-400/30',
    regulation: 'text-violet-400 border-violet-400/30',
    guidance: 'text-emerald-400 border-emerald-400/30',
    tos: 'text-fuchsia-400 border-fuchsia-400/30',
    case: 'text-amber-400 border-amber-400/30',
    circular: 'text-zinc-300 border-white/20',
    'open-commentary': 'text-zinc-300 border-white/20',
};

export default async function LegalLibraryPage() {
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

    const [{ data: docs }, { count: chunkCount }] = workspaceId
        ? await Promise.all([
              supabase
                  .from('delphi_legal_documents')
                  .select('*')
                  .eq('workspace_id', workspaceId)
                  .order('jurisdiction')
                  .order('title'),
              supabase
                  .from('delphi_legal_chunks')
                  .select('*', { head: true, count: 'exact' })
                  .eq('workspace_id', workspaceId),
          ])
        : [{ data: [] }, { count: 0 }];

    const stored = docs ?? [];
    const storedUrls = new Set(stored.map((d) => d.source_url as string));
    const missing = LEGAL_SOURCES.filter((s) => !storedUrls.has(s.url));
    const staleCount = stored.filter((d) =>
        isStale(d.retrieved_at as string, Number(d.refresh_days ?? 90))
    ).length;

    return (
        <div className="max-w-3xl space-y-6">
            <div>
                <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
                    <Scale className="h-6 w-6" /> Legal library
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    What the L.L.R. board reads from. Free and lawfully redistributable sources only —
                    primary law, regulator guidance and platform terms. Copyrighted textbooks and
                    paywalled databases are deliberately out of scope: a compliance system built on
                    infringing copies defeats itself.
                </p>
            </div>

            <Card className="border-white/10 bg-black/40">
                <CardContent className="space-y-4 pt-6">
                    <div className="flex flex-wrap items-center gap-4 text-sm">
                        <span className="text-zinc-200">
                            {stored.length}/{LEGAL_SOURCES.length} documents
                        </span>
                        <span className="text-muted-foreground">{chunkCount ?? 0} passages</span>
                        {staleCount > 0 && (
                            <span className="text-amber-400">{staleCount} stale</span>
                        )}
                    </div>
                    <LibraryControls />
                </CardContent>
            </Card>

            {stored.length === 0 ? (
                <Card className="border-dashed border-amber-400/30 bg-black/40">
                    <CardContent className="space-y-3 py-12 text-center">
                        <ShieldQuestion className="mx-auto h-10 w-10 text-amber-400/50" />
                        <h3 className="text-lg font-semibold">The library is empty</h3>
                        <p className="mx-auto max-w-md text-sm text-muted-foreground">
                            The board still reviews, but every legal finding rests on the model&rsquo;s
                            recall rather than a stored source — and the boardroom labels each one that
                            way. Fetch the library above to change that.
                        </p>
                    </CardContent>
                </Card>
            ) : (
                <Card className="border-white/10 bg-black/40">
                    <CardHeader className="pb-2">
                        <CardTitle className="flex items-center gap-2 text-sm">
                            <ShieldQuestion className="h-4 w-4" /> What would the board be handed?
                        </CardTitle>
                        <p className="text-xs text-muted-foreground">
                            Ask in plain words. The question is translated into the vocabulary the law
                            actually uses before searching — a clause about synchronisation licensing
                            never contains the word &ldquo;song&rdquo;.
                        </p>
                    </CardHeader>
                    <CardContent>
                        <LibraryQuery />
                    </CardContent>
                </Card>
            )}

            {stored.length > 0 && (
                <section className="space-y-2">
                    <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                        Stored
                    </h2>
                    <Card className="border-white/10 bg-black/40">
                        <CardContent className="divide-y divide-white/5 p-0">
                            {stored.map((d) => {
                                const age = ageInDays(d.retrieved_at as string);
                                const stale = isStale(d.retrieved_at as string, Number(d.refresh_days ?? 90));
                                return (
                                    <div key={d.id as string} className="space-y-1 px-4 py-3">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <a
                                                href={d.source_url as string}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="group flex min-w-0 items-center gap-1.5 text-sm text-zinc-200 hover:text-white"
                                            >
                                                <span className="truncate">{d.title as string}</span>
                                                <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground/40 group-hover:text-white" />
                                            </a>
                                            <Badge
                                                variant="outline"
                                                className={cn('text-[9px]', CATEGORY_TONE[d.category as string])}
                                            >
                                                {d.category as string}
                                            </Badge>
                                            <span className="text-[10px] text-muted-foreground">
                                                {d.jurisdiction as string}
                                            </span>
                                            <span
                                                className={cn(
                                                    'ml-auto shrink-0 text-[10px]',
                                                    stale ? 'text-amber-400' : 'text-muted-foreground/60'
                                                )}
                                                title={`Refreshes every ${d.refresh_days} days`}
                                            >
                                                {stale ? `stale · ${age}d` : `${age}d old`}
                                            </span>
                                        </div>
                                        <p className="text-[11px] text-muted-foreground/60">
                                            {d.licence as string}
                                        </p>
                                    </div>
                                );
                            })}
                        </CardContent>
                    </Card>
                </section>
            )}

            {missing.length > 0 && (
                <section className="space-y-2">
                    <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                        <BookOpen className="h-4 w-4" /> Not yet fetched ({missing.length})
                    </h2>
                    <Card className="border-white/5 bg-black/20">
                        <CardContent className="divide-y divide-white/5 p-0">
                            {missing.map((s) => (
                                <div key={s.url} className="space-y-0.5 px-4 py-3">
                                    <p className="text-sm text-muted-foreground">{s.title}</p>
                                    <p className="text-[11px] text-muted-foreground/60">{s.why}</p>
                                </div>
                            ))}
                        </CardContent>
                    </Card>
                </section>
            )}

            <p className="text-xs text-muted-foreground/60">
                Stale law is worse than no law, which is why age travels with every citation. The board
                is a structured review that catches obvious exposure and forces a look before you
                publish — for anything with real money or real liability attached, it is a filter in
                front of a professional, not a replacement for one.
            </p>
        </div>
    );
}
