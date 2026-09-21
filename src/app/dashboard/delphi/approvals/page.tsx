/**
 * The consent queue.
 *
 * Nothing outward-facing or irreversible happens without a decision here. The
 * pending list is the whole point of the page; decided items are kept below it
 * because "why did we publish that?" is a question with a date on it.
 */

import { ShieldCheck } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ReopenApproval } from '@/components/delphi/reopen-approval';
import { ApprovalCard } from '@/components/delphi/approval-card';
import { listApprovals, ACTION_LABELS } from '@/lib/delphi/approvals';
import { formatDistanceToNow } from 'date-fns';

export const dynamic = 'force-dynamic';

export default async function ApprovalsPage() {
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

    let all: Awaited<ReturnType<typeof listApprovals>> = [];
    let loadError: string | null = null;
    try {
        all = await listApprovals(supabase, { status: 'all', limit: 100 });
    } catch (err) {
        loadError = (err as Error).message;
    }

    const pending = all.filter((a) => a.status === 'pending');
    const decided = all.filter((a) => a.status !== 'pending');

    return (
        <div className="space-y-6">
            <div>
                <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
                    <ShieldCheck className="h-6 w-6" /> Approvals
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    Anything that reaches the outside world or cannot be undone waits here. The L.L.R.
                    board advises and Delphi recommends — only you decide.
                </p>
            </div>

            {loadError && (
                <Card className="border-amber-400/30 bg-black/40">
                    <CardContent className="py-4 text-sm text-amber-400">
                        Could not load approvals: {loadError}
                    </CardContent>
                </Card>
            )}

            {pending.length === 0 ? (
                <Card className="border-dashed border-white/10 bg-black/40">
                    <CardContent className="space-y-3 py-14 text-center">
                        <ShieldCheck className="mx-auto h-10 w-10 text-muted-foreground/40" />
                        <h3 className="text-lg font-semibold">Nothing is waiting on you</h3>
                        <p className="mx-auto max-w-md text-sm text-muted-foreground">
                            Agents work freely on anything internal. They stop here only when an action
                            would post, publish, send, spend or delete.
                        </p>
                    </CardContent>
                </Card>
            ) : (
                <div className="space-y-3">
                    {pending.map((a) => (
                        <ApprovalCard key={a.id} approval={a} />
                    ))}
                </div>
            )}

            {decided.length > 0 && (
                <section className="space-y-2">
                    <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                        Decided ({decided.length})
                    </h2>
                    <Card className="border-white/5 bg-black/20">
                        <CardContent className="divide-y divide-white/5 p-0">
                            {decided.map((a) => (
                                <div key={a.id} className="flex flex-wrap items-center gap-2 px-4 py-3 text-xs">
                                    <Badge
                                        variant="outline"
                                        className={
                                            a.status === 'approved'
                                                ? 'border-emerald-400/30 text-[10px] text-emerald-400'
                                                : 'border-red-400/30 text-[10px] text-red-400'
                                        }
                                    >
                                        {a.status}
                                    </Badge>
                                    <span className="min-w-0 flex-1 truncate text-zinc-300">{a.summary}</span>
                                    <span className="text-muted-foreground">
                                        {ACTION_LABELS[a.actionType] ?? a.actionType}
                                    </span>
                                    {a.decidedAt && (
                                        <span className="text-muted-foreground/60">
                                            {formatDistanceToNow(new Date(a.decidedAt), { addSuffix: true })}
                                        </span>
                                    )}
                                    <ReopenApproval approvalId={a.id} />
                                    {a.conditions && (
                                        <span className="w-full text-amber-400/80">
                                            Conditions: {a.conditions}
                                        </span>
                                    )}
                                </div>
                            ))}
                        </CardContent>
                    </Card>
                </section>
            )}

            <p className="text-xs text-muted-foreground/60">
                The board is a structured review that catches obvious exposure and forces a look before
                you publish. For anything with real money or real liability attached, it is a filter in
                front of a professional, not a replacement for one.
            </p>
        </div>
    );
}
