'use client';

/**
 * When a research or general department runs: its schedule, its next runs,
 * how the last ones went and the month's money — with "Run it now" for the
 * owner, and the way to exact timing.
 */

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CalendarClock, Loader2, Play, TriangleAlert } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { runNowAction } from '@/lib/delphi/episode-actions';

import { CEO_NAME } from '@/lib/pixel/cast/names';

export interface RunScheduleProps {
    departmentId: string;
    canEdit: boolean;
    active: boolean;
    /** "Weekdays at 07:00 (America/Toronto)", "cron 0 *\/6 * * * (UTC)", or "On demand". */
    schedule: string;
    hasSchedule: boolean;
    /** The CHO asked to be asked before each run. */
    asks: boolean;
    hasPlaybook: boolean;
    next: string[];
    runs: { id: string; title: string; status: string; when: string }[];
    money: { spent: number; held: number; budget: number };
}

const usd = (n: number) => `$${n.toFixed(2)}`;

export function RunSchedule(p: RunScheduleProps) {
    const router = useRouter();
    const [pending, start] = useTransition();
    const [error, setError] = useState<string | null>(null);
    const [note, setNote] = useState<string | null>(null);

    const runNow = () => {
        setError(null);
        setNote(null);
        start(async () => {
            const res = await runNowAction(p.departmentId);
            if (!res.ok) setError(res.error ?? 'It could not be started.');
            else {
                setNote('Started. It posts in the room when it is done.');
                router.refresh();
            }
        });
    };

    return (
        <Card className="border-white/10 bg-black/40">
            <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="flex items-center gap-2 text-sm">
                        <CalendarClock className="h-4 w-4" /> When it runs
                    </CardTitle>
                    {p.canEdit && p.active && (
                        <Button size="sm" variant="outline" className="border-white/10" onClick={runNow} disabled={pending}>
                            {pending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1.5 h-3.5 w-3.5" />} Run it now
                        </Button>
                    )}
                </div>
                <p className="text-xs text-muted-foreground">
                    {p.schedule}
                    {p.hasSchedule && (p.asks ? ` · ${CEO_NAME} asks you in the room before each run` : ' · runs on its own')}
                    {' · '}this month {usd(p.money.spent)} spent
                    {p.money.held > 0 && <> and {usd(p.money.held)} held for work in progress</>}, of {usd(p.money.budget)}
                </p>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
                {!p.active ? (
                    <p className="text-xs text-muted-foreground">Runs start once its team is approved.</p>
                ) : !p.hasSchedule ? (
                    <p className="text-xs text-muted-foreground">No schedule: it runs when you ask. Set one in its setup to have it run on its own.</p>
                ) : (
                    <>
                        {!p.hasPlaybook && (
                            <p className="rounded-md border border-sky-400/20 bg-sky-400/5 px-3 py-2 text-xs text-sky-200">
                                It starts keeping to this schedule at the engine&rsquo;s next run, from the plan you approved.
                            </p>
                        )}
                        {p.next.length > 0 && (
                            <p className="text-xs text-muted-foreground">
                                Next: <span className="text-zinc-200">{p.next.join(' · ')}</span>
                            </p>
                        )}
                    </>
                )}
                {p.runs.length > 0 && (
                    <ul className="space-y-1">
                        {p.runs.map((r) => (
                            <li key={r.id} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                                <span className="text-zinc-300">{r.when}</span>
                                <span className="text-muted-foreground">{r.status}</span>
                            </li>
                        ))}
                    </ul>
                )}
                <p className="text-[11px] text-muted-foreground/70">
                    On the free tier, work due on a day starts at the morning run.{' '}
                    <Link href="/dashboard/delphi/diagnostics/timing" className="text-sky-400 hover:underline">
                        Exact times
                    </Link>
                </p>
                {note && <p className="text-xs text-emerald-300">{note}</p>}
                {error && (
                    <p className="flex items-start gap-1.5 text-xs text-red-400">
                        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
                    </p>
                )}
            </CardContent>
        </Card>
    );
}
