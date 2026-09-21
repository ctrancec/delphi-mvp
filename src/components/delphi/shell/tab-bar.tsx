'use client';

/**
 * The cover panel's navigation.
 *
 * Folded, Delphi is a glance-and-approve surface: see what is waiting, decide,
 * put the phone away. So this carries only the destinations that serve that —
 * not the whole organisation.
 *
 * It also sits above the home indicator via `env(safe-area-inset-bottom)`,
 * which the viewport-fit=cover meta in the root layout makes available.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV, activeHref } from './nav';
import { cn } from '@/lib/utils';

export function TabBar({
    pendingApprovals,
    newOutputs,
}: {
    pendingApprovals: number;
    newOutputs: number;
}) {
    const pathname = usePathname();
    const active = activeHref(pathname);
    const items = NAV.filter((n) => n.onCover);

    return (
        <nav
            className="z-40 flex shrink-0 border-t border-white/10 bg-black/80 backdrop-blur-xl inner:hidden"
            style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        >
            {items.map((item) => {
                const Icon = item.icon;
                const isActive = active === item.href;
                const badge = item.href.endsWith('/approvals')
                    ? pendingApprovals
                    : item.href.endsWith('/outputs')
                      ? newOutputs
                      : 0;

                const inner = (
                    <>
                        <span className="relative">
                            <Icon className="h-[18px] w-[18px]" />
                            {badge > 0 && (
                                <span className="absolute -right-2 -top-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-amber-400 px-1 text-[9px] font-bold text-black">
                                    {badge > 9 ? '9+' : badge}
                                </span>
                            )}
                        </span>
                        <span className="text-[10px] font-medium">{item.short}</span>
                    </>
                );

                const shape = 'flex flex-1 flex-col items-center gap-1 py-2.5 transition-colors';

                return item.live ? (
                    <Link
                        key={item.href}
                        href={item.href}
                        className={cn(shape, isActive ? 'text-white' : 'text-muted-foreground')}
                    >
                        {inner}
                    </Link>
                ) : (
                    <div key={item.href} className={cn(shape, 'text-muted-foreground/35')}>
                        {inner}
                    </div>
                );
            })}
        </nav>
    );
}
