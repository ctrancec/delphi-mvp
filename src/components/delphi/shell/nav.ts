import {
    Building2,
    FolderOpen,
    Gavel,
    Globe2,
    Brain,
    ShieldCheck,
    Users,
    type LucideIcon,
} from 'lucide-react';

export interface NavItem {
    href: string;
    label: string;
    /** Shown on the cover panel's tab bar, where space is tight. */
    short: string;
    icon: LucideIcon;
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
    { href: '/dashboard/delphi', label: 'Mission control', short: 'HQ', icon: Building2, live: true, onCover: true },
    { href: '/dashboard/delphi/outputs', label: 'Outputs', short: 'Outputs', icon: FolderOpen, live: true, onCover: true },
    { href: '/dashboard/delphi/approvals', label: 'Approvals', short: 'Approve', icon: ShieldCheck, live: true, onCover: true },
    { href: '/dashboard/delphi/reviews', label: 'Boardroom', short: 'Board', icon: Gavel, live: true },
    { href: '/dashboard/delphi/roster', label: 'Roster', short: 'Roster', icon: Users, live: true, onCover: true },
    { href: '/dashboard/delphi/world', label: 'World', short: 'World', icon: Globe2, live: false },
    { href: '/dashboard/delphi/memory', label: 'Memory', short: 'Memory', icon: Brain, live: false },
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
    return NAV.find((n) => n.href === href)?.label ?? 'Delphi';
}
