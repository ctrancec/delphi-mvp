'use client';

/**
 * The left rail — Delphi's navigation on the inner panel and the desktop.
 *
 * Collapsed to icons on the inner panel, where horizontal space is the scarce
 * thing, and labelled on the desktop. The cover panel gets a bottom tab bar
 * instead; it is never shown here.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Plus, Triangle } from 'lucide-react';
import { NAV, activeHref } from './nav';
import { cn } from '@/lib/utils';

export function Rail({ pendingApprovals }: { pendingApprovals: number }) {
    const pathname = usePathname();
    const active = activeHref(pathname);

    return (
        <nav className="hidden h-full w-[68px] shrink-0 flex-col border-r border-white/10 bg-black/40 inner:flex desk:w-[216px]">
            <Link
                href="/dashboard/delphi"
                className="flex h-16 items-center gap-2.5 border-b border-white/10 px-[22px] desk:px-5"
            >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/20 text-primary">
                    <Triangle className="h-4 w-4 fill-current" />
                </span>
                <span className="hidden text-base font-bold tracking-tight text-white desk:inline">
                    Delphi
                </span>
            </Link>

            <div className="flex-1 space-y-0.5 overflow-y-auto p-3">
                {NAV.map((item) => {
                    const Icon = item.icon;
                    const isActive = active === item.href;
                    const badge = item.href.endsWith('/approvals') ? pendingApprovals : 0;

                    const inner = (
                        <>
                            <span className="relative shrink-0">
                                <Icon className="h-4 w-4" />
                                {badge > 0 && (
                                    <span className="absolute -right-1.5 -top-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-amber-400 px-1 text-[9px] font-bold text-black">
                                        {badge > 9 ? '9+' : badge}
                                    </span>
                                )}
                            </span>
                            <span className="hidden truncate desk:inline">{item.label}</span>
                            {!item.live && (
                                <span className="ml-auto hidden text-[9px] uppercase tracking-wide text-muted-foreground/50 desk:inline">
                                    soon
                                </span>
                            )}
                        </>
                    );

                    const shape =
                        'flex items-center gap-3 rounded-lg px-[13px] py-2 text-sm font-medium transition-colors desk:px-3';

                    // Planned surfaces render as text, not links — a nav item
                    // that 404s costs more trust than one that says "soon".
                    return item.live ? (
                        <Link
                            key={item.href}
                            href={item.href}
                            title={item.label}
                            className={cn(
                                shape,
                                isActive
                                    ? 'bg-white/10 text-white'
                                    : 'text-muted-foreground hover:bg-white/5 hover:text-white'
                            )}
                        >
                            {inner}
                        </Link>
                    ) : (
                        <div
                            key={item.href}
                            title={`${item.label} — not built yet`}
                            className={cn(shape, 'cursor-default text-muted-foreground/40')}
                        >
                            {inner}
                        </div>
                    );
                })}
            </div>

            <div className="p-3">
                <Link
                    href="/dashboard/delphi/departments/new"
                    title="New department"
                    className="flex items-center gap-3 rounded-lg border border-white/10 px-[13px] py-2 text-sm font-medium text-muted-foreground transition-colors hover:border-white/25 hover:text-white desk:px-3"
                >
                    <Plus className="h-4 w-4 shrink-0" />
                    <span className="hidden truncate desk:inline">New department</span>
                </Link>
            </div>
        </nav>
    );
}
