'use client';

/**
 * Ruling on a deliverable.
 *
 * Accepting finalises it. Declining sends the task that produced it back to
 * the agent with the reason, and the reason is mandatory — an agent cannot act
 * on "no", so requiring it is not ceremony, it is the mechanism by which the
 * next attempt differs from this one.
 *
 * Deliberately below the deliverable rather than above it. A decision made
 * before reading is not a review, and putting the buttons at the top invites
 * exactly that.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Loader2, RotateCcw, TriangleAlert, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { reviewOutputAction } from '@/lib/delphi/cho-review';

export interface OutputReviewState {
    artifactId: string;
    status: 'pending' | 'approved' | 'declined' | 'superseded';
    note: string | null;
    reviewedAt: string | null;
    revision: number;
    /** False for an artifact with no task behind it — nothing to send back to. */
    canSendBack: boolean;
    agentName: string | null;
}

export function OutputReview({ state }: { state: OutputReviewState }) {
    const router = useRouter();
    const [note, setNote] = useState('');
    const [showNote, setShowNote] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [escalatedTo, setEscalatedTo] = useState<string | null>(null);
    const [pending, startTransition] = useTransition();

    function rule(decision: 'approved' | 'declined') {
        setError(null);
        if (decision === 'declined' && note.trim().length < 10) {
            setShowNote(true);
            setError('Say what needs to change — the agent works from this.');
            return;
        }
        startTransition(async () => {
            const res = await reviewOutputAction(state.artifactId, decision, note);
            if (res.ok) {
                setEscalatedTo(res.escalatedTo ?? null);
                router.refresh();
            } else {
                setError(res.error ?? 'Could not record that.');
            }
        });
    }

    if (state.status === 'superseded') {
        return (
            <Card className="border-white/5 bg-black/20">
                <CardContent className="py-4 text-sm text-muted-foreground">
                    You sent this back, and a later version replaced it. Kept so you can see what
                    changed.
                </CardContent>
            </Card>
        );
    }

    if (state.status === 'approved') {
        return (
            <Card className="border-emerald-400/20 bg-emerald-400/5">
                <CardContent className="space-y-1 py-4 text-sm">
                    <p className="flex items-center gap-2 text-emerald-400">
                        <Check className="h-4 w-4" /> You accepted this
                        {state.revision > 1 && ` — revision ${state.revision}`}
                    </p>
                    {state.note && <p className="pl-6 text-xs text-muted-foreground">{state.note}</p>}
                </CardContent>
            </Card>
        );
    }

    if (state.status === 'declined') {
        return (
            <Card className="border-amber-400/20 bg-amber-400/5">
                <CardContent className="space-y-1 py-4 text-sm">
                    <p className="flex items-center gap-2 text-amber-400">
                        <RotateCcw className="h-4 w-4 shrink-0" />
                        {escalatedTo
                            ? `Sent back — Delphi handed it to ${escalatedTo}, who is redoing it now.`
                            : `Sent back to ${state.agentName ?? 'the agent'} to be redone.`}
                    </p>
                    {state.note && (
                        <p className="pl-6 text-xs text-muted-foreground">You said: {state.note}</p>
                    )}
                    <p className="pl-6 text-xs text-muted-foreground/60">
                        The new version appears here when it is ready. This draft stays, so you can
                        compare.
                    </p>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card className="border-white/10 bg-black/40">
            <CardContent className="space-y-3 pt-6">
                <div>
                    <p className="text-sm font-medium">Your verdict</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                        {state.canSendBack
                            ? 'Accepting finalises it. Sending it back returns the work to the agent with your reason, and they try again.'
                            : 'Nothing produced this, so there is no one to send it back to — you can still mark it accepted.'}
                    </p>
                </div>

                {showNote && (
                    <div className="space-y-1.5">
                        <Textarea
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            placeholder="What is wrong with it, and what would make it right. e.g. the momentum screen is empty — populate it from the data in step 1, or say why it cannot be."
                            className="min-h-24 border-white/10 bg-white/5 text-sm"
                        />
                        <p className="text-[11px] text-muted-foreground/60">
                            This is the entire brief for the next attempt. Vague feedback gets a vague
                            rewrite.
                        </p>
                    </div>
                )}

                {error && (
                    <p className="flex items-start gap-2 text-xs text-red-400">
                        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        {error}
                    </p>
                )}

                <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => rule('approved')} disabled={pending}>
                        {pending ? (
                            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                        ) : (
                            <Check className="mr-2 h-3.5 w-3.5" />
                        )}
                        Accept
                    </Button>

                    {state.canSendBack && (
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={() => rule('declined')}
                            disabled={pending}
                            className="border-amber-400/30 text-amber-400 hover:bg-amber-400/10 hover:text-amber-300"
                        >
                            <RotateCcw className="mr-2 h-3.5 w-3.5" />
                            Send it back
                        </Button>
                    )}

                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setShowNote((v) => !v)}
                        disabled={pending}
                        className="border-white/10"
                    >
                        <X className={`mr-2 h-3.5 w-3.5 transition-transform ${showNote ? 'rotate-45' : 'rotate-0'}`} />
                        {showNote ? 'Hide note' : 'Add a note'}
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}
