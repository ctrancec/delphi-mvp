'use client';

/**
 * One decision, with everything needed to make it.
 *
 * The preview is the actual payload, not a description of it — a caption the
 * CHO did not read is not a caption they approved. The board's position is
 * shown as advice: a `block` verdict escalates and explains itself, it does not
 * refuse on the CHO's behalf.
 */

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { Check, ChevronDown, Gavel, Loader2, ShieldAlert, TriangleAlert, X } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { decideApprovalAction } from '@/lib/delphi/actions';
import { ACTION_LABELS, RISK_STYLES, previewOf, type PendingApproval } from '@/lib/delphi/approvals';
import { cn } from '@/lib/utils';

const VERDICT_STYLES: Record<string, { label: string; tone: string }> = {
    clear: { label: 'Board cleared it', tone: 'text-emerald-400 border-emerald-400/30' },
    conditions: { label: 'Board: conditions apply', tone: 'text-amber-400 border-amber-400/30' },
    block: { label: 'Board escalated it to you', tone: 'text-red-400 border-red-400/30' },
};

export function ApprovalCard({ approval }: { approval: PendingApproval }) {
    const [pending, startTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);
    const [showConditions, setShowConditions] = useState(false);
    const [conditions, setConditions] = useState('');
    const [decided, setDecided] = useState<'approved' | 'rejected' | null>(null);

    const preview = previewOf(approval);
    const verdict = approval.review?.verdict ? VERDICT_STYLES[approval.review.verdict] : null;

    function decide(decision: 'approved' | 'rejected') {
        setError(null);
        startTransition(async () => {
            const res = await decideApprovalAction(
                approval.id,
                decision,
                decision === 'approved' ? conditions : undefined
            );
            if (res.ok) setDecided(decision);
            else setError(res.error ?? 'Could not record that decision.');
        });
    }

    if (decided) {
        return (
            <Card className="border-white/5 bg-black/20">
                <CardContent className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                    {decided === 'approved' ? (
                        <Check className="h-4 w-4 text-emerald-400" />
                    ) : (
                        <X className="h-4 w-4 text-red-400" />
                    )}
                    {decided === 'approved' ? 'Approved' : 'Rejected'} — {approval.summary}
                </CardContent>
            </Card>
        );
    }

    return (
        <Card className="border-white/10 bg-black/40">
            <CardContent className="space-y-4 pt-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline" className={cn('text-[10px]', RISK_STYLES[approval.risk])}>
                                {approval.risk} risk
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                                {ACTION_LABELS[approval.actionType] ?? approval.actionType}
                            </span>
                        </div>
                        <h3 className="text-sm font-semibold leading-snug">{approval.summary}</h3>
                        <p className="text-xs text-muted-foreground">
                            {approval.agentName ? (
                                <>
                                    Requested by <span className="text-zinc-300">{approval.agentName}</span>
                                    {approval.taskTitle && ` — ${approval.taskTitle}`}
                                </>
                            ) : (
                                'Requested by an agent'
                            )}
                            {approval.departmentName && (
                                <>
                                    {' · '}
                                    {approval.departmentId ? (
                                        <Link
                                            href={`/dashboard/delphi/departments/${approval.departmentId}`}
                                            className="hover:text-zinc-200"
                                        >
                                            {approval.departmentName}
                                        </Link>
                                    ) : (
                                        approval.departmentName
                                    )}
                                </>
                            )}
                            {' · '}
                            {formatDistanceToNow(new Date(approval.createdAt), { addSuffix: true })}
                        </p>
                    </div>
                </div>

                {verdict ? (
                    <Link
                        href={`/dashboard/delphi/reviews/${approval.review!.id}`}
                        className={cn(
                            'flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs transition-colors hover:bg-white/5',
                            verdict.tone
                        )}
                    >
                        <Gavel className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span className="min-w-0">
                            <span className="font-medium">{verdict.label}</span>
                            {approval.review!.findingCount > 0 && (
                                <span className="text-muted-foreground">
                                    {' '}
                                    · {approval.review!.findingCount} finding
                                    {approval.review!.findingCount === 1 ? '' : 's'}
                                </span>
                            )}
                            {approval.review!.recommendation && (
                                <span className="mt-1 block text-muted-foreground">
                                    {approval.review!.recommendation}
                                </span>
                            )}
                        </span>
                    </Link>
                ) : (
                    <p className="flex items-center gap-2 text-xs text-muted-foreground">
                        <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
                        No board review ran for this one.
                    </p>
                )}

                {preview && (
                    <div className="space-y-1.5">
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                            What would happen
                        </p>
                        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-white/10 bg-black/60 p-3 font-mono text-xs text-zinc-200">
                            {preview}
                        </pre>
                    </div>
                )}

                {showConditions && (
                    <Textarea
                        value={conditions}
                        onChange={(e) => setConditions(e.target.value)}
                        placeholder="Conditions this approval depends on — e.g. remove the third claim, credit the footage."
                        className="min-h-20 border-white/10 bg-white/5 text-sm"
                    />
                )}

                {error && (
                    <p className="flex items-center gap-2 text-xs text-red-400">
                        <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
                        {error}
                    </p>
                )}

                <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => decide('approved')} disabled={pending}>
                        {pending ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-2 h-3.5 w-3.5" />}
                        {showConditions && conditions.trim() ? 'Approve with conditions' : 'Approve'}
                    </Button>
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setShowConditions((v) => !v)}
                        disabled={pending}
                        className="border-white/10"
                    >
                        <ChevronDown className={cn('mr-2 h-3.5 w-3.5 transition-transform', showConditions && 'rotate-180')} />
                        Conditions
                    </Button>
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => decide('rejected')}
                        disabled={pending}
                        className="border-red-400/30 text-red-400 hover:bg-red-400/10 hover:text-red-300"
                    >
                        <X className="mr-2 h-3.5 w-3.5" />
                        Reject
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}
