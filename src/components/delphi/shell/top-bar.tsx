'use client';

/**
 * The status strip.
 *
 * Three things the CHO should never have to navigate to find: whether the
 * system is running, what it has spent, and whether anything is waiting on
 * them. Everything else is a page.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ShieldCheck, Triangle, Wallet } from 'lucide-react';
import { SystemSwitch } from './system-switch';
import { titleFor } from './nav';
import type { SystemMode } from '@/lib/delphi/db';
import { formatUsd } from '@/lib/llm/cost';

export interface TopBarProps {
    mode: SystemMode;
    /** Deliverables landed since the CHO last opened Outputs. */
    newOutputs: number;
    spentUsd: number;
    pendingApprovals: number;
    email: string;
}

export function TopBar({ mode, spentUsd, pendingApprovals, email }: TopBarProps) {
    const pathname = usePathname();

    return (
        <header className="flex h-16 shrink-0 items-center gap-3 border-b border-white/10 bg-black/40 px-4 backdrop-blur-xl desk:px-6">
            {/* The mark stands in for the rail, which the cover panel does not show. */}
            <Link href="/dashboard/delphi" className="shrink-0 inner:hidden">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/20 text-primary">
                    <Triangle className="h-4 w-4 fill-current" />
                </span>
            </Link>

            <h1 className="min-w-0 flex-1 truncate text-base font-semibold desk:text-lg">
                {titleFor(pathname)}
            </h1>

            {pendingApprovals > 0 && (
                <span
                    className="hidden items-center gap-1.5 rounded-full border border-amber-400/30 px-3 py-1.5 text-xs font-medium text-amber-400 inner:inline-flex"
                    title={`${pendingApprovals} awaiting your decision`}
                >
                    <ShieldCheck className="h-3 w-3" />
                    {pendingApprovals}
                </span>
            )}

            <span
                className="hidden items-center gap-1.5 rounded-full border border-white/10 px-3 py-1.5 text-xs text-muted-foreground desk:inline-flex"
                title="Spent across all departments"
            >
                <Wallet className="h-3 w-3" />
                {formatUsd(spentUsd)}
            </span>

            <SystemSwitch mode={mode} />

            <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/20 text-xs font-bold text-primary"
                title={email}
            >
                {email.charAt(0).toUpperCase()}
            </span>
        </header>
    );
}
