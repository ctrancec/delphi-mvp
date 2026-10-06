'use client';

import { cn } from '@/lib/utils';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** ISO weekdays, 1 Monday through 7 Sunday, as toggles. */
export function DayPicker({ days, onChange, disabled = false }: { days: number[]; onChange: (days: number[]) => void; disabled?: boolean }) {
    return (
        <div className="flex flex-wrap gap-1.5">
            {DAYS.map((d, i) => {
                const n = i + 1;
                const on = days.includes(n);
                return (
                    <button
                        key={d}
                        type="button"
                        aria-pressed={on}
                        disabled={disabled}
                        onClick={() => onChange(on ? days.filter((x) => x !== n) : [...days, n].sort())}
                        className={cn(
                            'rounded-md border px-2.5 py-1 text-xs disabled:opacity-40',
                            on ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300' : 'border-white/10 text-muted-foreground hover:border-white/25'
                        )}
                    >
                        {d}
                    </button>
                );
            })}
        </div>
    );
}
