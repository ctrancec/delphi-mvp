'use client';

/**
 * Ruling on a deliverable — and removing one.
 *
 * Accepting finalises it. Declining sends the task that produced it back to
 * the agent with the reason, and the reason is mandatory — an agent cannot act
 * on "no", so requiring it is not ceremony, it is the mechanism by which the
 * next attempt differs from this one.
 *
 * **Nothing here is final.** Every verdict can be changed afterwards. Accepting
 * by accident used to be permanent, which quietly made Accept the most
 * dangerous control on the page; declining by accident cost a real run.
 * Withdrawing a verdict clears it, and walking back a decline cancels the redo
 * it started — for exactly as long as the agent has not begun. Once they have,
 * that is said outright rather than offered and then refused.
 *
 * Deleting is the one exception, so it is split in two. **Delete** moves the
 * deliverable to the trash, where it stays readable and can be restored;
 * destroying it is a separate act behind the title typed back. The impact is
 * shown before either, counted rather than warned about, because "this may
 * affect other steps" is not something anyone can weigh.
 *
 * Deliberately below the deliverable rather than above it. A decision made
 * before reading is not a review, and putting the buttons at the top invites
 * exactly that.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { formatDistanceToNow } from 'date-fns';
import {
    Check,
    Loader2,
    RotateCcw,
    Trash2,
    TriangleAlert,
    Undo2,
    X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { reviewOutputAction } from '@/lib/delphi/cho-review';
import {
    deleteOutputAction,
    outputDeletionImpactAction,
    purgeOutputAction,
    restoreOutputAction,
    type DeletionImpact,
} from '@/lib/delphi/trash';

export interface OutputReviewState {
    artifactId: string;
    title: string;
    status: 'pending' | 'approved' | 'declined' | 'superseded';
    note: string | null;
    reviewedAt: string | null;
    revision: number;
    /** False for an artifact with no task behind it — nothing to send back to. */
    canSendBack: boolean;
    agentName: string | null;
    /** Set when it is in the trash. Restorable until it is purged. */
    deletedAt: string | null;
}

/** The counted consequences, shared by both the delete and the purge panel. */
function ImpactList({ impact }: { impact: DeletionImpact }) {
    return (
        <ul className="space-y-0.5 text-xs text-muted-foreground">
            {impact.dependants.length > 0 ? (
                <li className="text-amber-400">
                    {impact.dependants.length} later step
                    {impact.dependants.length === 1 ? ' was' : 's were'} built on this —{' '}
                    {impact.dependants.map((d) => `step ${d.seq}`).join(', ')}. They keep what they
                    already produced; re-run one and it stops rather than working from nothing.
                </li>
            ) : (
                <li>Nothing downstream was built on this.</li>
            )}
            <li className={impact.onlyVersion ? 'text-amber-400' : undefined}>
                {impact.onlyVersion
                    ? 'It is the only version of this step — nothing is left behind it.'
                    : 'An earlier version of this step survives and takes over.'}
            </li>
            {impact.hasFile && <li>The stored file goes with it.</li>}
        </ul>
    );
}

/** Move it to the trash. Two taps, with the cost shown between them. */
function DeleteControl({ artifactId }: { artifactId: string }) {
    const router = useRouter();
    const [impact, setImpact] = useState<DeletionImpact | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [pending, startTransition] = useTransition();

    function load() {
        setError(null);
        startTransition(async () => {
            const res = await outputDeletionImpactAction(artifactId);
            if (res.ok && res.data) setImpact(res.data);
            else setError(res.error ?? 'Could not work out what this would affect.');
        });
    }

    function trash() {
        setError(null);
        startTransition(async () => {
            const res = await deleteOutputAction(artifactId);
            if (res.ok) router.refresh();
            else setError(res.error ?? 'Could not delete it.');
        });
    }

    if (!impact) {
        return (
            <div className="space-y-1.5">
                <Button
                    onClick={load}
                    disabled={pending}
                    size="sm"
                    variant="ghost"
                    className="text-muted-foreground hover:bg-red-400/10 hover:text-red-400"
                >
                    {pending ? (
                        <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                    ) : (
                        <Trash2 className="mr-2 h-3.5 w-3.5" />
                    )}
                    Delete
                </Button>
                {error && (
                    <p className="flex items-start gap-2 text-xs text-red-400">
                        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        {error}
                    </p>
                )}
            </div>
        );
    }

    return (
        <div className="space-y-3 rounded-lg border border-red-400/20 bg-red-400/5 p-4">
            <div>
                <p className="text-sm font-medium text-red-400">Delete this deliverable</p>
                <p className="mt-1 text-xs text-muted-foreground">
                    It moves to the trash. You can restore it from there, and nothing is destroyed
                    until you say so a second time.
                </p>
            </div>

            <ImpactList impact={impact} />

            {error && (
                <p className="flex items-start gap-2 text-xs text-red-400">
                    <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {error}
                </p>
            )}

            <div className="flex flex-wrap gap-2">
                <Button
                    onClick={trash}
                    disabled={pending}
                    size="sm"
                    variant="outline"
                    className="border-red-400/30 text-red-400 hover:bg-red-400/10 hover:text-red-300"
                >
                    {pending ? (
                        <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                    ) : (
                        <Trash2 className="mr-2 h-3.5 w-3.5" />
                    )}
                    Move to trash
                </Button>
                <Button
                    onClick={() => setImpact(null)}
                    disabled={pending}
                    size="sm"
                    variant="outline"
                    className="border-white/10"
                >
                    Cancel
                </Button>
            </div>
        </div>
    );
}

/**
 * What a trashed deliverable shows instead of a verdict.
 *
 * Restoring is one tap, because that is the mis-tap this whole arrangement
 * exists to catch. Destroying it needs the title written out — the only thing
 * that reliably separates "I meant this" from "I hit the wrong row" is having
 * to look at what you are about to lose.
 */
function Trashed({ state }: { state: OutputReviewState }) {
    const router = useRouter();
    const [confirming, setConfirming] = useState(false);
    const [impact, setImpact] = useState<DeletionImpact | null>(null);
    const [typed, setTyped] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [pending, startTransition] = useTransition();

    function restore() {
        setError(null);
        startTransition(async () => {
            const res = await restoreOutputAction(state.artifactId);
            if (res.ok) router.refresh();
            else setError(res.error ?? 'Could not restore it.');
        });
    }

    function beginPurge() {
        setError(null);
        setConfirming(true);
        startTransition(async () => {
            const res = await outputDeletionImpactAction(state.artifactId);
            if (res.ok && res.data) setImpact(res.data);
        });
    }

    function purge() {
        setError(null);
        startTransition(async () => {
            const res = await purgeOutputAction(state.artifactId, typed);
            if (res.ok) router.push('/dashboard/delphi/outputs?view=trash');
            else setError(res.error ?? 'Could not delete it.');
        });
    }

    return (
        <Card className="border-red-400/20 bg-red-400/5">
            <CardContent className="space-y-3 py-4 text-sm">
                <p className="flex items-center gap-2 text-red-400">
                    <Trash2 className="h-4 w-4 shrink-0" />
                    In the trash — deleted{' '}
                    {formatDistanceToNow(new Date(state.deletedAt!), { addSuffix: true })}
                </p>
                <p className="pl-6 text-xs text-muted-foreground">
                    Still here, and still readable. It has left the library, and the pipeline no
                    longer feeds it to the next step — restore it and both go back to how they were.
                </p>

                {error && (
                    <p className="flex items-start gap-2 pl-6 text-xs text-red-400">
                        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        {error}
                    </p>
                )}

                <div className="flex flex-wrap gap-2 pl-6">
                    <Button
                        onClick={restore}
                        disabled={pending}
                        size="sm"
                        variant="outline"
                        className="border-emerald-400/30 text-emerald-400 hover:bg-emerald-400/10 hover:text-emerald-300"
                    >
                        {pending ? (
                            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                        ) : (
                            <Undo2 className="mr-2 h-3.5 w-3.5" />
                        )}
                        Restore
                    </Button>
                    {!confirming && (
                        <Button
                            onClick={beginPurge}
                            disabled={pending}
                            size="sm"
                            variant="ghost"
                            className="text-muted-foreground hover:bg-red-400/10 hover:text-red-400"
                        >
                            Delete for good
                        </Button>
                    )}
                </div>

                {confirming && (
                    <div className="ml-6 space-y-3 rounded-lg border border-red-400/30 bg-black/30 p-4">
                        <p className="text-xs text-muted-foreground">
                            This one cannot be taken back. {impact?.hasFile && 'The stored file goes with it. '}
                            {impact && impact.dependants.length > 0 &&
                                `Steps ${impact.dependants.map((d) => d.seq).join(', ')} were built on it and will have nothing to work from if re-run.`}
                        </p>

                        <div className="space-y-2">
                            <Label htmlFor="confirm-title" className="text-xs">
                                Type{' '}
                                <span className="font-mono break-words text-zinc-200">
                                    {state.title}
                                </span>{' '}
                                to confirm
                            </Label>
                            <Input
                                id="confirm-title"
                                value={typed}
                                onChange={(e) => setTyped(e.target.value)}
                                className="border-red-400/20 bg-white/5"
                            />
                        </div>

                        <div className="flex flex-wrap gap-2">
                            <Button
                                onClick={purge}
                                disabled={pending || typed.trim() !== state.title.trim()}
                                size="sm"
                                variant="outline"
                                className="border-red-400/30 text-red-400 hover:bg-red-400/10 hover:text-red-300"
                            >
                                {pending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                                Delete it for good
                            </Button>
                            <Button
                                onClick={() => {
                                    setConfirming(false);
                                    setTyped('');
                                }}
                                disabled={pending}
                                size="sm"
                                variant="outline"
                                className="border-white/10"
                            >
                                Cancel
                            </Button>
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

function Verdict({ state }: { state: OutputReviewState }) {
    const router = useRouter();
    const [note, setNote] = useState('');
    const [showNote, setShowNote] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [escalatedTo, setEscalatedTo] = useState<string | null>(null);
    const [pending, startTransition] = useTransition();

    function rule(decision: 'approved' | 'declined' | 'pending') {
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
                <CardContent className="space-y-3 py-4 text-sm">
                    <p className="flex items-center gap-2 text-emerald-400">
                        <Check className="h-4 w-4" /> You accepted this
                        {state.revision > 1 && ` — revision ${state.revision}`}
                    </p>
                    {state.note && <p className="pl-6 text-xs text-muted-foreground">{state.note}</p>}

                    {showNote && (
                        <Textarea
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            placeholder="What was wrong with it after all."
                            className="min-h-20 border-white/10 bg-white/5 text-sm"
                        />
                    )}

                    {error && (
                        <p className="flex items-start gap-2 text-xs text-red-400">
                            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            {error}
                        </p>
                    )}

                    {/* Accepting by accident used to be permanent, which made
                        this the most dangerous button on the page. */}
                    <div className="flex flex-wrap gap-2 pl-6">
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={() => rule('pending')}
                            disabled={pending}
                            className="border-white/10"
                        >
                            {pending ? (
                                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                            ) : (
                                <Undo2 className="mr-2 h-3.5 w-3.5" />
                            )}
                            Un-accept
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
                                Send it back after all
                            </Button>
                        )}
                    </div>
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

                    {error && (
                        <p className="flex items-start gap-2 pl-6 text-xs text-red-400">
                            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            {error}
                        </p>
                    )}

                    {/* Until the agent starts, this costs nothing to take back.
                        Once it has, the button says so rather than pretending. */}
                    <div className="flex flex-wrap gap-2 pl-6">
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={() => rule('approved')}
                            disabled={pending}
                            className="border-emerald-400/30 text-emerald-400 hover:bg-emerald-400/10 hover:text-emerald-300"
                        >
                            {pending ? (
                                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                            ) : (
                                <Undo2 className="mr-2 h-3.5 w-3.5" />
                            )}
                            Actually, accept it
                        </Button>
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={() => rule('pending')}
                            disabled={pending}
                            className="border-white/10"
                        >
                            Cancel the redo
                        </Button>
                    </div>
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

export function OutputReview({ state }: { state: OutputReviewState }) {
    // In the trash, there is no verdict to give — only the way back, and the
    // way out. Offering Accept here would record a decision about a document
    // that is not in the library and is feeding nothing.
    if (state.deletedAt) return <Trashed state={state} />;

    return (
        <div className="space-y-2">
            <Verdict state={state} />
            <DeleteControl artifactId={state.artifactId} />
        </div>
    );
}
