'use client';

/**
 * Taking back a decision.
 *
 * The way people get these wrong is by tapping the wrong one, not by reasoning
 * badly — so a decision made in one tap should be undoable in one. Everything
 * it changed goes back: a refused task stops being skipped, and an approved
 * hire is un-hired with the agent archived and the task returned to whoever
 * held it before.
 *
 * Work that has already left the building is refused by name. An undo that
 * cannot work is worse than no undo at all, so this says which action it was
 * and that nothing here will unsend it.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Undo2 } from 'lucide-react';
import { reopenApprovalAction } from '@/lib/delphi/actions';

export function ReopenApproval({ approvalId }: { approvalId: string }) {
    const router = useRouter();
    const [error, setError] = useState<string | null>(null);
    const [pending, startTransition] = useTransition();

    function reopen() {
        setError(null);
        startTransition(async () => {
            const res = await reopenApprovalAction(approvalId);
            if (res.ok) router.refresh();
            else setError(res.error ?? 'Could not take that back.');
        });
    }

    return (
        <>
            <button
                type="button"
                onClick={reopen}
                disabled={pending}
                title="Put this back in the queue and undo what it changed"
                className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-white/5 hover:text-zinc-200 disabled:opacity-50"
            >
                {pending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                    <Undo2 className="h-3 w-3" />
                )}
                Take it back
            </button>
            {error && <span className="w-full text-[11px] text-red-400">{error}</span>}
        </>
    );
}
