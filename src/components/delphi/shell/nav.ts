import {
    Brain,
    Building2,
    FolderOpen,
    Gavel,
    MessageSquare,
    Globe2,
    Scale,
    ShieldCheck,
    Stethoscope,
    Users,
    type LucideIcon,
} from 'lucide-react';
import type { IconId } from '@/lib/pixel/icons';

import { APP_NAME, CEO_NAME } from '@/lib/pixel/cast/names'
export interface NavItem {
    href: string;
    label: string;
    /** Shown on the cover panel's tab bar, where space is tight. */
    short: string;
    icon: LucideIcon;
    /** The same item, drawn in pixels, for the Pixel look. */
    pixel: IconId;
    /**
     * False for surfaces that are designed but not built. They are rendered
     * dimmed rather than hidden: the shape of the organisation is part of what
     * mission control is telling you, and a nav that grows items unannounced
     * reads as less trustworthy than one that shows what is coming.
     */
    live: boolean;
    /** Only these appear on the cover panel — the glance-and-approve surface. */
    onCover?: boolean;
}

export const NAV: NavItem[] = [
    { href: '/dashboard/delphi', label: 'Mission control', short: 'HQ', icon: Building2, pixel: 'hq', live: true, onCover: true },
    { href: '/dashboard/delphi/chat', label: `Talk to ${CEO_NAME}`, short: 'Chat', icon: MessageSquare, pixel: 'chat', live: true, onCover: true },
    { href: '/dashboard/delphi/outputs', label: 'Outputs', short: 'Outputs', icon: FolderOpen, pixel: 'outputs', live: true, onCover: true },
    { href: '/dashboard/delphi/approvals', label: 'Approvals', short: 'Approve', icon: ShieldCheck, pixel: 'approvals', live: true, onCover: true },
    { href: '/dashboard/delphi/reviews', label: 'Boardroom', short: 'Board', icon: Gavel, pixel: 'boardroom', live: true },
    { href: '/dashboard/delphi/legal', label: 'Legal library', short: 'Legal', icon: Scale, pixel: 'legal', live: true },
    { href: '/dashboard/delphi/roster', label: 'Roster', short: 'Roster', icon: Users, pixel: 'roster', live: true, onCover: true },
    { href: '/dashboard/delphi/world', label: 'World', short: 'World', icon: Globe2, pixel: 'world', live: true },
    { href: '/dashboard/delphi/memory', label: 'Memory', short: 'Memory', icon: Brain, pixel: 'memory', live: true },
    { href: '/dashboard/delphi/diagnostics', label: 'Diagnostics', short: 'Health', icon: Stethoscope, pixel: 'diagnostics', live: true },
];

/**
 * Which nav entry owns a path.
 *
 * Longest match wins, so `/dashboard/delphi/outputs/abc` highlights Outputs
 * rather than mission control, which would otherwise match on its prefix.
 */
export function activeHref(pathname: string): string | null {
    let best: string | null = null;
    for (const item of NAV) {
        if (pathname === item.href || pathname.startsWith(`${item.href}/`)) {
            if (!best || item.href.length > best.length) best = item.href;
        }
    }
    return best;
}

export function titleFor(pathname: string): string {
    if (pathname.startsWith('/dashboard/delphi/departments/new')) return 'New department';
    if (pathname.startsWith('/dashboard/delphi/departments/')) return 'Department';
    const href = activeHref(pathname);
    return NAV.find((n) => n.href === href)?.label ?? APP_NAME;
}
