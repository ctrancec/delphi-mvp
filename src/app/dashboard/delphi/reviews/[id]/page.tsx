/**
 * One review round, in full.
 *
 * Delphi's consolidated recommendation at the top, because that is what the
 * CHO is being asked to act on; then the findings ranked by severity; then the
 * transcript underneath, for when the recommendation is not enough.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { format } from 'date-fns';
import { ArrowLeft, Gavel, MessageSquare, Quote, ShieldCheck } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ThreadComposer } from '@/components/delphi/thread-composer';
import { getReview, listThreadMessages } from '@/lib/delphi/reviews';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const VERDICT_STYLES: Record<string, string> = {
    clear: 'text-emerald-400 border-emerald-400/30',
    conditions: 'text-amber-400 border-amber-400/30',
    block: 'text-red-400 border-red-400/30',
};

const SEVERITY_STYLES: Record<string, string> = {
    critical: 'text-red-400 border-red-400/30',
    high: 'text-red-400/80 border-red-400/20',
    medium: 'text-amber-400 border-amber-400/30',
    low: 'text-muted-foreground border-white/15',
};

const ROLE_STYLES: Record<string, string> = {
    reviewer: 'border-l-white/20',
    ceo: 'border-l-primary/50',
    cho: 'border-l-sky-400/50',
    system: 'border-l-white/10',
};

export default async function ReviewDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const supabase = await createClient();
    if (!supabase) notFound();

    const { id } = await params;
    const review = await getReview(supabase, id);
    if (!review) notFound();

    const messages = review.threadId ? await listThreadMessages(supabase, review.threadId) : [];

    return (
        <div className="max-w-3xl space-y-6">
            <Link
                href="/dashboard/delphi/reviews"
                className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-white"
            >
                <ArrowLeft className="h-4 w-4" /> Boardroom
            </Link>

            <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                    {review.verdict && (
                        <Badge variant="outline" className={cn('text-[10px]', VERDICT_STYLES[review.verdict])}>
                            <Gavel className="mr-1 h-2.5 w-2.5" />
                            {review.verdict}
                        </Badge>
                    )}
                    <span className="text-xs text-muted-foreground">
                        {review.depth === 'legal' ? 'Legal review only' : 'Full board'}
                        {' · '}
                        {format(new Date(review.createdAt), 'd MMM yyyy, HH:mm')}
                    </span>
                </div>
                <h1 className="text-2xl font-bold tracking-tight">
                    {review.approvalSummary ?? review.projectTitle ?? 'Review'}
                </h1>
                {review.departmentName && (
                    <p className="text-xs text-muted-foreground">{review.departmentName}</p>
                )}
            </div>

            {review.recommendation && (
                <Card className="border-white/10 bg-black/40">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm">Delphi&rsquo;s recommendation</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-sm leading-relaxed text-zinc-200">{review.recommendation}</p>
                    </CardContent>
                </Card>
            )}

            {review.approvalId && (
                <Card className="border-white/10 bg-black/20">
                    <CardContent className="flex flex-wrap items-center gap-3 py-4 text-sm">
                        <ShieldCheck className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 text-muted-foreground">
                            This review was for an action awaiting your decision.
                        </span>
                        <Link
                            href="/dashboard/delphi/approvals"
                            className="shrink-0 text-sky-400 hover:underline"
                        >
                            {review.approvalStatus === 'pending' ? 'Decide now' : `Already ${review.approvalStatus}`}
                        </Link>
                    </CardContent>
                </Card>
            )}

            {review.findings.length > 0 && (
                <section className="space-y-2">
                    <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                        Findings ({review.findings.length})
                    </h2>
                    <div className="space-y-2">
                        {review.findings.map((f) => (
                            <Card key={f.id} className="border-white/10 bg-black/40">
                                <CardContent className="space-y-2 pt-5">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <Badge
                                            variant="outline"
                                            className={cn('text-[10px]', SEVERITY_STYLES[f.severity])}
                                        >
                                            {f.severity}
                                        </Badge>
                                        <span className="text-xs text-muted-foreground">{f.category}</span>
                                        {f.reviewerName && (
                                            <span className="text-xs text-muted-foreground/60">
                                                — {f.reviewerName}
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-sm leading-relaxed text-zinc-200">{f.finding}</p>
                                    {f.remedy && (
                                        <p className="text-xs text-muted-foreground">
                                            <span className="text-zinc-400">Remedy:</span> {f.remedy}
                                        </p>
                                    )}
                                    {f.citation ? (
                                        <p className="flex items-start gap-1.5 text-[11px] text-sky-400/80">
                                            <Quote className="mt-0.5 h-3 w-3 shrink-0" />
                                            {f.citation}
                                        </p>
                                    ) : (
                                        <p className="text-[11px] text-amber-400/70">
                                            No citation — this rests on the model&rsquo;s recall rather than a
                                            stored source.
                                        </p>
                                    )}
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                </section>
            )}

            <section className="space-y-3">
                <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    <MessageSquare className="h-4 w-4" /> Transcript
                </h2>

                {messages.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No transcript was recorded for this round.</p>
                ) : (
                    <div className="space-y-3">
                        {messages.map((m) => (
                            <div
                                key={m.id}
                                className={cn('border-l-2 pl-4', ROLE_STYLES[m.role] ?? 'border-l-white/10')}
                            >
                                <p className="text-xs font-medium text-zinc-300">
                                    {m.authorName}
                                    <span className="ml-2 font-normal text-muted-foreground/60">
                                        {m.role === 'cho' ? 'you' : m.role === 'ceo' ? 'CEO' : m.role}
                                    </span>
                                </p>
                                <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">
                                    {m.content}
                                </p>
                            </div>
                        ))}
                    </div>
                )}

                {review.threadId && <ThreadComposer threadId={review.threadId} />}
            </section>

            <p className="text-xs text-muted-foreground/60">
                The board is a structured review, not legal advice. For anything with real money or real
                liability attached, treat it as a filter in front of a professional.
            </p>
        </div>
    );
}
