/**
 * A studio's sections: its overview, one tab per channel, its team and its
 * settings. Links rather than client state, so every tab has an address and
 * renders only what it shows. On a phone the row scrolls sideways.
 */

import Link from 'next/link';
import { cn } from '@/lib/utils';

export interface DepartmentTab {
    /** `overview`, `team`, `settings`, or a channel's id. */
    key: string;
    label: string;
    /** A small note after the label, such as "paused". */
    note?: string;
}

export function DepartmentTabs({ departmentId, tabs, current }: { departmentId: string; tabs: DepartmentTab[]; current: string }) {
    const base = `/dashboard/delphi/departments/${departmentId}`;
    return (
        <nav aria-label="Department sections" className="overflow-x-auto">
            <div className="flex min-w-max gap-1 border-b border-white/10">
                {tabs.map((t) => {
                    const active = t.key === current;
                    return (
                        <Link
                            key={t.key}
                            href={t.key === 'overview' ? base : `${base}?tab=${encodeURIComponent(t.key)}`}
                            scroll={false}
                            aria-current={active ? 'page' : undefined}
                            className={cn(
                                '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors',
                                active ? 'border-sky-400 text-zinc-100' : 'border-transparent text-muted-foreground hover:text-zinc-200'
                            )}
                        >
                            {t.label}
                            {t.note && <span className="ml-1.5 text-[10px] text-amber-400">{t.note}</span>}
                        </Link>
                    );
                })}
            </div>
        </nav>
    );
}
