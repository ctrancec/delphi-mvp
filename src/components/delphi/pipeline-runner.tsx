'use client';

/**
 * Drives a running project from the browser.
 *
 * The engine is server-side and resumable — this is not where the work
 * happens. It is what keeps a pipeline moving while the CHO is watching it,
 * because the scheduled tick is coarse on most hosting tiers and nobody wants
 * to wait for it after pressing approve.
 *
 * Each poke runs as many tasks as fit in one invocation and reports whether
 * more remain. Between pokes it refreshes the page, so the pipeline, the
 * activity log and the spend all advance in front of you.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Pause, TriangleAlert } from 'lucide-react';

/** A stop is a stop. Without a cap, a misbehaving pipeline pokes forever. */
const MAX_ROUNDS = 40;
const PAUSE_BETWEEN_MS = 1_500;

type State =
    | { kind: 'working'; round: number }
    | { kind: 'stopped'; reason: string }
    | { kind: 'error'; message: string };

export function PipelineRunner({ active }: { active: boolean }) {
    const router = useRouter();
    const [state, setState] = useState<State>({ kind: 'working', round: 0 });

    // A ref, not state: the loop reads it to decide whether to keep going, and
    // it must not restart the effect when it changes.
    const cancelled = useRef(false);

    const describe = useCallback((outcomes: { status: string; reason?: string }[]): string | null => {
        const last = outcomes[outcomes.length - 1];
        if (!last) return null;
        switch (last.status) {
            case 'awaiting_approval':
                return 'Waiting on your approval.';
            case 'halted':
                return last.reason === 'budget'
                    ? 'Stopped: the budget cap was reached.'
                    : 'Stopped: the system is switched off.';
            case 'failed':
                return 'A task failed. See the activity log.';
            case 'idle':
                return 'Nothing left to run.';
            default:
                return null;
        }
    }, []);

    useEffect(() => {
        if (!active) return;
        cancelled.current = false;

        (async () => {
            for (let round = 1; round <= MAX_ROUNDS; round++) {
                if (cancelled.current) return;
                setState({ kind: 'working', round });

                let body: { ok?: boolean; more?: boolean; outcomes?: { status: string; reason?: string }[]; error?: string };
                try {
                    const res = await fetch('/api/delphi/run', { method: 'POST' });
                    body = await res.json();
                    if (!res.ok) throw new Error(body.error ?? `Engine returned ${res.status}`);
                } catch (err) {
                    if (cancelled.current) return;
                    setState({ kind: 'error', message: (err as Error).message });
                    return;
                }

                if (cancelled.current) return;
                router.refresh();

                const reason = describe(body.outcomes ?? []);
                if (reason) {
                    setState({ kind: 'stopped', reason });
                    return;
                }
                if (!body.more) {
                    setState({ kind: 'stopped', reason: 'Run complete.' });
                    return;
                }

                await new Promise((r) => setTimeout(r, PAUSE_BETWEEN_MS));
            }

            setState({
                kind: 'stopped',
                reason: `Paused after ${MAX_ROUNDS} rounds. Reload to continue.`,
            });
        })();

        return () => {
            cancelled.current = true;
        };
    }, [active, router, describe]);

    if (!active) return null;

    if (state.kind === 'error') {
        return (
            <p className="flex items-center gap-2 text-xs text-red-400">
                <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
                {state.message}
            </p>
        );
    }

    if (state.kind === 'stopped') {
        return (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Pause className="h-3.5 w-3.5 shrink-0" />
                {state.reason}
            </p>
        );
    }

    return (
        <p className="flex items-center gap-2 text-xs text-emerald-400">
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
            Agents are working — step {state.round}. You can close this; it keeps running.
        </p>
    );
}
