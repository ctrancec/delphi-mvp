/**
 * The Outputs library — everything the agents have made, in one place.
 *
 * Filters live in the URL rather than in client state, so a filtered view is a
 * link the CHO can bookmark or send to themselves, and the whole page stays a
 * server component with no hydration cost.
 */

import Link from 'next/link';
import { FolderOpen, Inbox, Trash2 } from 'lucide-react';
import { createClient, currentUser } from '@/lib/supabase/server';
import { Card, CardContent } from '@/components/ui/card';
import { OutputCard, KIND_META } from '@/components/delphi/output-card';
import { facetsFrom, listOutputs, type OutputRecord } from '@/lib/delphi/outputs';
import type { ArtifactKind } from '@/lib/delphi/types';
import { cn } from '@/lib/utils';
import { findWorkspace } from '@/lib/delphi/bootstrap';
import { markOutputsSeen } from '@/lib/delphi/unread';
import { EmptyTrash, TrashRow } from '@/components/delphi/trash-panel';

export const dynamic = 'force-dynamic';

type Params = { kind?: string; department?: string; project?: string; view?: string };

/** Build an href that changes one filter and leaves the rest alone. */
function filterHref(current: Params, patch: Partial<Params>): string {
    const next = { ...current, ...patch };
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) {
        if (v) qs.set(k, v);
    }
    const s = qs.toString();
    return s ? `/dashboard/delphi/outputs?${s}` : '/dashboard/delphi/outputs';
}

function Pill({
    href,
    active,
    children,
}: {
    href: string;
    active: boolean;
    children: React.ReactNode;
}) {
    return (
        <Link
            href={href}
            className={cn(
                'rounded-full border px-3 py-1 text-xs whitespace-nowrap transition-colors',
                active
                    ? 'border-white/40 bg-white/10 text-white'
                    : 'border-white/10 text-muted-foreground hover:border-white/25 hover:text-zinc-200'
            )}
        >
            {children}
        </Link>
    );
}

function Empty({ filtered }: { filtered: boolean }) {
    return (
        <Card className="bg-black/40 border-white/10 border-dashed">
            <CardContent className="py-14 text-center space-y-3">
                <Inbox className="h-10 w-10 mx-auto text-muted-foreground/40" />
                {filtered ? (
                    <>
                        <h3 className="text-lg font-semibold">Nothing matches that filter</h3>
                        <Link
                            href="/dashboard/delphi/outputs"
                            className="text-sm text-sky-400 hover:underline"
                        >
                            Clear filters
                        </Link>
                    </>
                ) : (
                    <>
                        <h3 className="text-lg font-semibold">No outputs yet</h3>
                        <p className="text-sm text-muted-foreground max-w-md mx-auto">
                            Everything your agents produce lands here — reports, briefs, datasets, images
                            and video. Approve a department&rsquo;s team and the first deliverables will
                            appear as the pipeline runs.
                        </p>
                    </>
                )}
            </CardContent>
        </Card>
    );
}

export default async function OutputsPage({
    searchParams,
}: {
    searchParams: Promise<Params>;
}) {
    const supabase = await createClient();
    if (!supabase) {
        return (
            <Card className="bg-black/40 border-white/10">
                <CardContent className="py-10 text-center text-muted-foreground">
                    Supabase is not configured.
                </CardContent>
            </Card>
        );
    }

    const params = await searchParams;

    // Seeing the page is what clears the badge — not rendering the badge
    // itself, which would let a count vanish on a glance at the wrong moment.
    const [user, workspaceId] = await Promise.all([
        currentUser(),
        findWorkspace(supabase),
    ]);
    if (user && workspaceId) await markOutputsSeen(supabase, workspaceId, user.id);

    // One query, unfiltered, then narrowed in memory. Facet counts have to be
    // computed over everything the CHO can see — counting a filtered set would
    // make every pill read as the number already on screen.
    let all: OutputRecord[] = [];
    let trashed: OutputRecord[] = [];
    let loadError: string | null = null;
    try {
        // Two reads, in parallel. The trash count has to come from the trash:
        // a badge computed from the library would always read zero, since the
        // library is defined as what is not in it.
        [all, trashed] = await Promise.all([
            listOutputs(supabase, { limit: 500 }),
            listOutputs(supabase, { trashed: true, limit: 200 }),
        ]);
    } catch (err) {
        loadError = (err as Error).message;
    }

    const inTrash = params.view === 'trash';

    const facets = facetsFrom(all);

    const visible = all.filter((r) => {
        if (params.kind && r.artifact.kind !== params.kind) return false;
        if (params.department && r.department?.id !== params.department) return false;
        if (params.project && r.project?.id !== params.project) return false;
        return true;
    });

    const isFiltered = !!(params.kind || params.department || params.project);

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                    {inTrash ? <Trash2 className="h-6 w-6" /> : <FolderOpen className="h-6 w-6" />}
                    {inTrash ? 'Trash' : 'Outputs'}
                </h1>
                <p className="text-sm text-muted-foreground mt-1">
                    {inTrash
                        ? 'Deleted deliverables, kept until you say otherwise. They are out of the library and the pipeline no longer feeds them to the next step — restore one and both go back to how they were.'
                        : 'Every report, document, dataset and clip your agents have made. Each one traces back to the agent that produced it and the sources it used.'}
                </p>
            </div>

            {loadError && (
                <Card className="bg-black/40 border-amber-400/30">
                    <CardContent className="py-4 text-sm text-amber-400">
                        Could not load outputs: {loadError}
                    </CardContent>
                </Card>
            )}

            {(all.length > 0 || trashed.length > 0) && !inTrash && (
                <div className="space-y-2">
                    <div className="flex flex-wrap gap-1.5">
                        <Pill href={filterHref(params, { kind: undefined })} active={!params.kind}>
                            All {facets.total}
                        </Pill>
                        {facets.kinds.map(({ kind, count }) => (
                            <Pill
                                key={kind}
                                href={filterHref(params, { kind })}
                                active={params.kind === kind}
                            >
                                {(KIND_META[kind as ArtifactKind] ?? KIND_META.other).label} {count}
                            </Pill>
                        ))}
                        {trashed.length > 0 && (
                            <Pill href="/dashboard/delphi/outputs?view=trash" active={false}>
                                Trash {trashed.length}
                            </Pill>
                        )}
                    </div>

                    {facets.departments.length > 1 && (
                        <div className="flex flex-wrap gap-1.5">
                            <Pill
                                href={filterHref(params, { department: undefined, project: undefined })}
                                active={!params.department}
                            >
                                All departments
                            </Pill>
                            {facets.departments.map((d) => (
                                <Pill
                                    key={d.id}
                                    href={filterHref(params, { department: d.id, project: undefined })}
                                    active={params.department === d.id}
                                >
                                    {d.title}
                                </Pill>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {inTrash ? (
                <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                        <Link
                            href="/dashboard/delphi/outputs"
                            className="text-sm text-sky-400 hover:underline"
                        >
                            ← Back to the library
                        </Link>
                        {trashed.length > 0 && (
                            <span className="ml-auto">
                                <EmptyTrash count={trashed.length} />
                            </span>
                        )}
                    </div>

                    {trashed.length === 0 ? (
                        <Card className="bg-black/40 border-white/10 border-dashed">
                            <CardContent className="py-14 text-center space-y-3">
                                <Trash2 className="h-10 w-10 mx-auto text-muted-foreground/40" />
                                <h3 className="text-lg font-semibold">The trash is empty</h3>
                                <p className="text-sm text-muted-foreground max-w-md mx-auto">
                                    Deleted deliverables come here first and stay until you destroy
                                    them, so a mis-tap costs nothing.
                                </p>
                            </CardContent>
                        </Card>
                    ) : (
                        trashed.map((r) => (
                            <TrashRow
                                key={r.artifact.id}
                                item={{
                                    id: r.artifact.id,
                                    title: r.artifact.title,
                                    kindLabel: (
                                        KIND_META[r.artifact.kind as ArtifactKind] ?? KIND_META.other
                                    ).label,
                                    department: r.department?.title ?? null,
                                    agent: r.agent?.title ?? null,
                                    step: r.task?.seq ?? null,
                                    deletedAt: r.deletedAt,
                                }}
                            />
                        ))
                    )}
                </div>
            ) : visible.length === 0 ? (
                <Empty filtered={isFiltered && all.length > 0} />
            ) : (
                <>
                    <div className="grid gap-3 inner:grid-cols-2 desk:grid-cols-3">
                        {visible.map((r) => (
                            <OutputCard key={r.artifact.id} record={r} />
                        ))}
                    </div>
                    {all.length >= 500 && (
                        <p className="text-xs text-muted-foreground text-center">
                            Showing the most recent 500 outputs.
                        </p>
                    )}
                </>
            )}
        </div>
    );
}
