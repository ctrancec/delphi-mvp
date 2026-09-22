'use client';

/**
 * The trash.
 *
 * A compact list rather than the library's grid of cards, on purpose: this is
 * a holding area to scan and empty, not a shelf to browse. What matters per
 * row is what it was, whose it was, and when it went — everything else is a
 * click away on the deliverable itself, which is still readable.
 *
 * Restore is one tap, because a mis-tap is the thing this whole arrangement
 * exists to catch and a remedy that takes work is a remedy people skip.
 * Destroying is not: the title has to be written out, and emptying the whole
 * trash needs the count typed, since there is no single name to ask for.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { Loader2, Trash2, TriangleAlert, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import {
    emptyTrashAction,
    purgeOutputAction,
    restoreOutputAction,
} from '@/lib/delphi/trash';

export interface TrashedItem {
    id: string;
    title: string;
    kindLabel: string;
    department: string | null;
    agent: string | null;
    step: number | null;
    deletedAt: string | null;
}

export function TrashRow({ item }: { item: TrashedItem }) {
    const router = useRouter();
    const [confirming, setConfirming] = useState(false);
    const [typed, setTyped] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [pending, startTransition] = useTransition();

    function act(fn: () => Promise<{ ok: boolean; error?: string }>, fallback: string) {
        setError(null);
        startTransition(async () => {
            const res = await fn();
            if (res.ok) router.refresh();
            else setError(res.error ?? fallback);
        });
    }

    return (
        <Card className="border-white/10 bg-black/40">
            <CardContent className="space-y-3 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-0.5">
                        <Link
                            href={`/dashboard/delphi/outputs/${item.id}`}
                            className="text-sm font-medium hover:text-white"
                        >
                            {item.title}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                            {item.kindLabel}
                            {item.department && ` · ${item.department}`}
                            {item.agent && ` · ${item.agent}`}
                            {item.step !== null && ` · step ${item.step}`}
                        </p>
                        {item.deletedAt && (
                            <p className="text-[11px] text-muted-foreground/60">
                                deleted {formatDistanceToNow(new Date(item.deletedAt), { addSuffix: true })}
                            </p>
                        )}
                    </div>

                    <div className="flex shrink-0 flex-wrap gap-2">
                        <Button
                            size="sm"
                            variant="outline"
                            disabled={pending}
                            onClick={() => act(() => restoreOutputAction(item.id), 'Could not restore it.')}
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
                                size="sm"
                                variant="ghost"
                                disabled={pending}
                                onClick={() => setConfirming(true)}
                                className="text-muted-foreground hover:bg-red-400/10 hover:text-red-400"
                            >
                                Delete for good
                            </Button>
                        )}
                    </div>
                </div>

                {error && (
                    <p className="flex items-start gap-2 text-xs text-red-400">
                        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        {error}
                    </p>
                )}

                {confirming && (
                    <div className="space-y-3 rounded-lg border border-red-400/30 bg-red-400/5 p-4">
                        <p className="text-xs text-muted-foreground">
                            This cannot be taken back. Any stored file goes with it, and a later step
                            built on it will have nothing to work from if you re-run it.
                        </p>
                        <div className="space-y-2">
                            <Label htmlFor={`confirm-${item.id}`} className="text-xs">
                                Type{' '}
                                <span className="font-mono break-words text-zinc-200">{item.title}</span>{' '}
                                to confirm
                            </Label>
                            <Input
                                id={`confirm-${item.id}`}
                                value={typed}
                                onChange={(e) => setTyped(e.target.value)}
                                className="border-red-400/20 bg-white/5"
                            />
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <Button
                                size="sm"
                                variant="outline"
                                disabled={pending || typed.trim() !== item.title.trim()}
                                onClick={() =>
                                    act(() => purgeOutputAction(item.id, typed), 'Could not delete it.')
                                }
                                className="border-red-400/30 text-red-400 hover:bg-red-400/10 hover:text-red-300"
                            >
                                {pending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                                Delete it for good
                            </Button>
                            <Button
                                size="sm"
                                variant="outline"
                                disabled={pending}
                                onClick={() => {
                                    setConfirming(false);
                                    setTyped('');
                                }}
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

/**
 * Emptying it.
 *
 * Confirmed by the count rather than a name, since there is no single title to
 * ask for — but still confirmed, because this is the one control that can lose
 * more in a tap than any other on the page.
 */
export function EmptyTrash({ count }: { count: number }) {
    const router = useRouter();
    const [confirming, setConfirming] = useState(false);
    const [typed, setTyped] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [pending, startTransition] = useTransition();

    function empty() {
        setError(null);
        startTransition(async () => {
            const res = await emptyTrashAction(typed);
            if (res.ok) {
                setConfirming(false);
                setTyped('');
                router.refresh();
            } else {
                setError(res.error ?? 'Could not empty it.');
            }
        });
    }

    if (!confirming) {
        return (
            <Button
                size="sm"
                variant="outline"
                onClick={() => setConfirming(true)}
                className="border-red-400/30 text-red-400 hover:bg-red-400/10 hover:text-red-300"
            >
                <Trash2 className="mr-2 h-3.5 w-3.5" />
                Empty the trash
            </Button>
        );
    }

    return (
        <div className="w-full space-y-3 rounded-lg border border-red-400/30 bg-red-400/5 p-4">
            <p className="text-sm font-medium text-red-400">
                Destroy {count} deliverable{count === 1 ? '' : 's'}
            </p>
            <p className="text-xs text-muted-foreground">
                Every one of them, permanently, along with any stored files. There is no way back
                from this.
            </p>

            {error && (
                <p className="flex items-start gap-2 text-xs text-red-400">
                    <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {error}
                </p>
            )}

            <div className="space-y-2">
                <Label htmlFor="confirm-count" className="text-xs">
                    Type <span className="font-mono text-zinc-200">{count}</span> to confirm
                </Label>
                <Input
                    id="confirm-count"
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    className="max-w-32 border-red-400/20 bg-white/5"
                />
            </div>

            <div className="flex flex-wrap gap-2">
                <Button
                    size="sm"
                    variant="outline"
                    disabled={pending || typed.trim() !== String(count)}
                    onClick={empty}
                    className="border-red-400/30 text-red-400 hover:bg-red-400/10 hover:text-red-300"
                >
                    {pending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                    Empty it
                </Button>
                <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => {
                        setConfirming(false);
                        setTyped('');
                    }}
                    className="border-white/10"
                >
                    Cancel
                </Button>
            </div>
        </div>
    );
}
