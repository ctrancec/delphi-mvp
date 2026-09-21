'use client';

/**
 * The master switch.
 *
 * Delphi runs server-side on a schedule, so it keeps working with every app
 * closed. This is how you stop it. The state lives in the database rather than
 * in any client, which is what makes turning it off on the phone stop the
 * engine everywhere rather than just hiding it on one screen.
 */

import { useState, useTransition } from 'react';
import { Loader2, Pause, Play, Square } from 'lucide-react';
import { setSystemModeAction } from '@/lib/delphi/actions';
import type { SystemMode } from '@/lib/delphi/db';
import { cn } from '@/lib/utils';

const MODES: Record<SystemMode, { label: string; dot: string; text: string }> = {
    running: { label: 'Running', dot: 'bg-emerald-400', text: 'text-emerald-400' },
    paused: { label: 'Paused', dot: 'bg-amber-400', text: 'text-amber-400' },
    stopped: { label: 'Stopped', dot: 'bg-red-400', text: 'text-red-400' },
};

export function SystemSwitch({ mode: initial, compact }: { mode: SystemMode; compact?: boolean }) {
    const [mode, setMode] = useState<SystemMode>(initial);
    const [open, setOpen] = useState(false);
    const [pending, startTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);

    const meta = MODES[mode];

    function change(next: SystemMode) {
        setOpen(false);
        setError(null);
        // Optimistic: the switch is chrome, and chrome that lags feels broken.
        // Reverted below if the write is refused.
        const previous = mode;
        setMode(next);
        startTransition(async () => {
            const res = await setSystemModeAction(next);
            if (!res.ok) {
                setMode(previous);
                setError(res.error ?? 'Could not change the system state.');
            }
        });
    }

    return (
        <div className="relative">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                disabled={pending}
                title={`System is ${meta.label.toLowerCase()} — click to change`}
                className={cn(
                    'inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-xs transition-colors hover:border-white/25 disabled:opacity-60',
                    meta.text
                )}
            >
                {pending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                    <span className={cn('h-1.5 w-1.5 rounded-full', meta.dot)} />
                )}
                {!compact && <span className="font-medium">{meta.label}</span>}
            </button>

            {open && (
                <>
                    {/* Click-away. Rendered behind the menu, above everything else. */}
                    <button
                        type="button"
                        aria-label="Close"
                        className="fixed inset-0 z-40 cursor-default"
                        onClick={() => setOpen(false)}
                    />
                    <div className="absolute right-0 z-50 mt-2 w-60 overflow-hidden rounded-lg border border-white/10 bg-[#111] shadow-xl">
                        <Option
                            icon={<Play className="h-3.5 w-3.5" />}
                            label="Running"
                            hint="Departments work to their cadence"
                            active={mode === 'running'}
                            onClick={() => change('running')}
                        />
                        <Option
                            icon={<Pause className="h-3.5 w-3.5" />}
                            label="Paused"
                            hint="Finish the current task, start nothing new"
                            active={mode === 'paused'}
                            onClick={() => change('paused')}
                        />
                        <Option
                            icon={<Square className="h-3.5 w-3.5" />}
                            label="Stopped"
                            hint="Halt everything now"
                            active={mode === 'stopped'}
                            onClick={() => change('stopped')}
                        />
                    </div>
                </>
            )}

            {error && (
                <p className="absolute right-0 top-full mt-1 w-60 text-right text-[11px] text-red-400">
                    {error}
                </p>
            )}
        </div>
    );
}

function Option({
    icon,
    label,
    hint,
    active,
    onClick,
}: {
    icon: React.ReactNode;
    label: string;
    hint: string;
    active: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                'flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors',
                active ? 'bg-white/10 text-white' : 'text-muted-foreground hover:bg-white/5 hover:text-zinc-200'
            )}
        >
            <span className="mt-0.5 shrink-0">{icon}</span>
            <span className="min-w-0">
                <span className="block text-xs font-medium">{label}</span>
                <span className="block text-[11px] text-muted-foreground">{hint}</span>
            </span>
        </button>
    );
}
