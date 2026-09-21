'use client';

/**
 * Picks the shell for the route.
 *
 * Delphi gets mission control; the pages left over from what this codebase
 * used to be keep the shell they were built for, so they neither break nor
 * bleed their navigation into Delphi. A client component because the choice
 * turns on the pathname, which a server layout does not have.
 */

import { usePathname } from 'next/navigation';
import { Rail } from './rail';
import { TabBar } from './tab-bar';
import { TopBar, type TopBarProps } from './top-bar';

export function DashboardChrome({
    children,
    legacy,
    ...status
}: TopBarProps & {
    children: React.ReactNode;
    /** The old app's shell, rendered by the server layout and passed through. */
    legacy: React.ReactNode;
}) {
    const pathname = usePathname();

    if (!pathname.startsWith('/dashboard/delphi')) {
        return <>{legacy}</>;
    }

    return (
        <div className="flex h-screen overflow-hidden bg-[#0a0a0a] text-white">
            <Rail pendingApprovals={status.pendingApprovals} newOutputs={status.newOutputs} />

            <div className="flex min-w-0 flex-1 flex-col">
                <TopBar {...status} />

                <main className="flex-1 overflow-y-auto p-4 desk:p-6">
                    {/*
                     * Capped so reading a report on the inner panel unfolded in
                     * landscape does not run to a 2448px measure, and centred so
                     * the content sits away from the hinge rather than across it.
                     */}
                    <div className="mx-auto w-full max-w-[1400px]">{children}</div>
                </main>

                <TabBar pendingApprovals={status.pendingApprovals} newOutputs={status.newOutputs} />
            </div>
        </div>
    );
}
