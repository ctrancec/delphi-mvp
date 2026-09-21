'use client';

/**
 * The hours the agents work.
 *
 * Sits beside the master switch rather than replacing it. The schedule is the
 * ordinary rhythm; the switch is what you reach for right now. Whichever one
 * you use last wins, and only until the next boundary — which is the property
 * that lets both exist without either quietly becoming the real control.
 *
 * The current verdict is shown in plain words above the form, because "is it
 * working at the moment" is the only question anyone actually brings here, and
 * a day-and-time grid does not answer it at a glance.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Clock, Loader2, TriangleAlert } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { setWorkScheduleAction } from '@/lib/delphi/actions';
import type { WorkSchedule } from '@/lib/delphi/schedule';
import { cn } from '@/lib/utils';

const DAYS: { iso: number; label: string }[] = [
    { iso: 1, label: 'Mon' },
    { iso: 2, label: 'Tue' },
    { iso: 3, label: 'Wed' },
    { iso: 4, label: 'Thu' },
    { iso: 5, label: 'Fri' },
    { iso: 6, label: 'Sat' },
    { iso: 7, label: 'Sun' },
];

export function WorkHours({
    schedule: initial,
    detail,
}: {
    schedule: WorkSchedule;
    /** What the system is doing right now, in words. */
    detail: string;
}) {
    const router = useRouter();
    const [form, setForm] = useState<WorkSchedule>(initial);
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState(false);
    const [pending, startTransition] = useTransition();

    const dirty = JSON.stringify(form) !== JSON.stringify(initial);
    const overnight = form.end <= form.start;

    function save(next: WorkSchedule) {
        setError(null);
        setSaved(false);
        startTransition(async () => {
            const res = await setWorkScheduleAction(next);
            if (res.ok) {
                setSaved(true);
                router.refresh();
            } else {
                setError(res.error ?? 'Could not save that.');
            }
        });
    }

    function toggleDay(iso: number) {
        setForm((f) => ({
            ...f,
            days: f.days.includes(iso) ? f.days.filter((d) => d !== iso) : [...f.days, iso].sort(),
        }));
    }

    return (
        <Card className="border-white/10 bg-black/40">
            <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                    <Clock className="h-4 w-4" /> Working hours
                </CardTitle>
                <p className="text-xs text-muted-foreground">{detail}</p>
            </CardHeader>

            <CardContent className="space-y-4">
                <label className="flex cursor-pointer items-start gap-3">
                    <input
                        type="checkbox"
                        checked={form.enabled}
                        onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                        className="mt-0.5 h-4 w-4 accent-emerald-400"
                    />
                    <span className="text-sm">
                        Only work during set hours
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                            Off means the switch decides alone, which is how it worked before.
                        </span>
                    </span>
                </label>

                <div
                    className={cn(
                        'space-y-4 transition-opacity',
                        !form.enabled && 'pointer-events-none opacity-40'
                    )}
                >
                    <div className="grid gap-3 inner:grid-cols-3">
                        <div className="space-y-1.5">
                            <Label htmlFor="work-start" className="text-xs">
                                From
                            </Label>
                            <Input
                                id="work-start"
                                type="time"
                                value={form.start}
                                onChange={(e) => setForm({ ...form, start: e.target.value })}
                                className="border-white/10 bg-white/5"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="work-end" className="text-xs">
                                Until
                            </Label>
                            <Input
                                id="work-end"
                                type="time"
                                value={form.end}
                                onChange={(e) => setForm({ ...form, end: e.target.value })}
                                className="border-white/10 bg-white/5"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="work-tz" className="text-xs">
                                Timezone
                            </Label>
                            <Input
                                id="work-tz"
                                value={form.timezone}
                                onChange={(e) => setForm({ ...form, timezone: e.target.value })}
                                placeholder="America/Vancouver"
                                className="border-white/10 bg-white/5 text-xs"
                            />
                        </div>
                    </div>

                    {overnight && (
                        <p className="text-[11px] text-sky-400">
                            This window runs through midnight — {form.start} to {form.end} the next
                            morning. The day it belongs to is the day it opened.
                        </p>
                    )}

                    <div className="space-y-1.5">
                        <Label className="text-xs">Days</Label>
                        <div className="flex flex-wrap gap-1.5">
                            {DAYS.map((d) => (
                                <button
                                    key={d.iso}
                                    type="button"
                                    onClick={() => toggleDay(d.iso)}
                                    className={cn(
                                        'rounded-md border px-2.5 py-1 text-xs transition-colors',
                                        form.days.includes(d.iso)
                                            ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-400'
                                            : 'border-white/10 text-muted-foreground hover:border-white/25'
                                    )}
                                >
                                    {d.label}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {error && (
                    <p className="flex items-start gap-2 text-xs text-red-400">
                        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        {error}
                    </p>
                )}

                <div className="flex flex-wrap items-center gap-3">
                    <Button size="sm" onClick={() => save(form)} disabled={pending || !dirty}>
                        {pending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                        Save hours
                    </Button>
                    {saved && !dirty && (
                        <span className="flex items-center gap-1.5 text-xs text-emerald-400">
                            <Check className="h-3.5 w-3.5" /> Saved
                        </span>
                    )}
                </div>

                <p className="text-[11px] leading-relaxed text-muted-foreground/60">
                    The switch still wins for now: turn it on outside these hours and the agents
                    work anyway until the window would have opened; turn it off inside them and
                    they hold until it would have closed. Either way it lapses on its own — you
                    cannot leave them switched off by accident for a week. Saving new hours clears
                    any override, because it was an argument with a schedule that no longer exists.
                </p>
            </CardContent>
        </Card>
    );
}
