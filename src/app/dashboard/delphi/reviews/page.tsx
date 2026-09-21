/**
 * The boardroom.
 *
 * Every round the L.L.R. board has held, newest first. Opening one shows the
 * findings, the verdicts and the full transcript — the record that makes "why
 * did we approve that?" answerable months later.
 */

import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { Gavel } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { listReviews } from '@/lib/delphi/reviews';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export const VERDICT_STYLES: Record<string, string> = {
    clear: 'text-emerald-400 border-emerald-400/30',
    conditions: 'text-amber-400 border-amber-400/30',
    block: 'text-red-400 border-red-400/30',
};

const VERDICT_LABELS: Record<string, string> = {
    clear: 'cleared',
    conditions: 'conditions',
    block: 'escalated',
};

export default async function ReviewsPage() {
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

    let reviews: Awaited<ReturnType<typeof listReviews>> = [];
    let loadError: string | null = null;
    try {
        reviews = await listReviews(supabase);
    } catch (err) {
        loadError = (err as Error).message;
    }

    return (
        <div className="space-y-6">
            <div>
                <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
                    <Gavel className="h-6 w-6" /> Boardroom
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    Liabilities, Risk and Legal review work before it reaches you, and deliberate with
                    Delphi in the open. They advise; they never approve.
                </p>
            </div>

            {loadError && (
                <Card className="border-amber-400/30 bg-black/40">
                    <CardContent className="py-4 text-sm text-amber-400">
                        Could not load reviews: {loadError}
                    </CardContent>
                </Card>
            )}

            {reviews.length === 0 ? (
                <Card className="border-dashed border-white/10 bg-black/40">
                    <CardContent className="space-y-3 py-14 text-center">
                        <Gavel className="mx-auto h-10 w-10 text-muted-foreground/40" />
                        <h3 className="text-lg font-semibold">No reviews yet</h3>
                        <p className="mx-auto max-w-md text-sm text-muted-foreground">
                            The board convenes when work is about to reach the outside world. Internal
                            drafts go straight to you — a full round costs four model calls, so it is
                            spent where the exposure is.
                        </p>
                    </CardContent>
                </Card>
            ) : (
                <div className="space-y-3">
                    {reviews.map((r) => (
                        <Link key={r.id} href={`/dashboard/delphi/reviews/${r.id}`} className="group block">
                            <Card className="border-white/10 bg-black/40 transition-colors hover:border-white/25">
                                <CardContent className="space-y-2 pt-6">
                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                        <h3 className="min-w-0 text-sm font-semibold leading-snug group-hover:text-white">
                                            {r.approvalSummary ?? r.projectTitle ?? 'Review'}
                                        </h3>
                                        {r.verdict && (
                                            <Badge
                                                variant="outline"
                                                className={cn('shrink-0 text-[10px]', VERDICT_STYLES[r.verdict])}
                                            >
                                                {VERDICT_LABELS[r.verdict] ?? r.verdict}
                                            </Badge>
                                        )}
                                    </div>
                                    {r.recommendation && (
                                        <p className="line-clamp-2 text-xs text-muted-foreground">
                                            {r.recommendation}
                                        </p>
                                    )}
                                    <p className="text-[11px] text-muted-foreground/60">
                                        {r.departmentName && `${r.departmentName} · `}
                                        {r.depth === 'legal' ? 'legal review only' : 'full board'}
                                        {' · '}
                                        {formatDistanceToNow(new Date(r.createdAt), { addSuffix: true })}
                                    </p>
                                </CardContent>
                            </Card>
                        </Link>
                    ))}
                </div>
            )}
        </div>
    );
}
