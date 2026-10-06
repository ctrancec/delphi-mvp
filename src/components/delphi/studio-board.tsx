/**
 * A studio's week at a glance, across its channels: the topics waiting, the
 * episodes being made, the pieces waiting for the CHO, and what went live.
 * Every item says which channel it is for and leads to where it is handled.
 */

import Link from 'next/link';
import { CheckCircle2, Clapperboard, Inbox, Lightbulb, Radio } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface BoardItem {
    key: string;
    title: string;
    channel: string;
    href: string;
    /** Opens elsewhere: a published piece's link. */
    external?: boolean;
    note?: string;
}

export interface StudioBoardProps {
    ideas: BoardItem[];
    production: BoardItem[];
    review: BoardItem[];
    published: BoardItem[];
}

const COLUMNS = [
    { key: 'ideas', title: 'Topics', empty: 'Nothing proposed or queued.', icon: Lightbulb, tone: 'text-amber-300' },
    { key: 'production', title: 'In production', empty: 'Nothing being made.', icon: Clapperboard, tone: 'text-sky-300' },
    { key: 'review', title: 'Ready for you', empty: 'Nothing waiting for review.', icon: Inbox, tone: 'text-rose-300' },
    { key: 'published', title: 'Published this week', empty: 'Nothing marked published yet.', icon: Radio, tone: 'text-emerald-300' },
] as const;

export function StudioBoard(props: StudioBoardProps) {
    return (
        <section aria-label="This week across the channels" className="grid gap-3 inner:grid-cols-2">
            {COLUMNS.map((c) => {
                const items = props[c.key];
                const Icon = c.icon;
                return (
                    <div key={c.key} className="min-w-0 space-y-2 rounded-xl border border-white/10 bg-black/40 p-3">
                        <p className="flex items-center gap-2 text-xs font-medium text-zinc-200">
                            <Icon className={cn('h-3.5 w-3.5', c.tone)} /> {c.title}
                            <span className="text-muted-foreground">{items.length}</span>
                        </p>
                        {items.length === 0 ? (
                            <p className="text-xs text-muted-foreground">{c.empty}</p>
                        ) : (
                            <ul className="space-y-1.5">
                                {items.slice(0, 6).map((i) => (
                                    <li key={i.key} className="min-w-0">
                                        <Link
                                            href={i.href}
                                            {...(i.external ? { target: '_blank', rel: 'noopener noreferrer' } : { scroll: false })}
                                            className="block rounded-md px-1.5 py-1 hover:bg-white/5"
                                        >
                                            <span className="block truncate text-sm text-zinc-200">{i.title}</span>
                                            <span className="block truncate text-[11px] text-muted-foreground">
                                                {i.channel}
                                                {i.note && <> · {i.note}</>}
                                            </span>
                                        </Link>
                                    </li>
                                ))}
                                {items.length > 6 && <li className="px-1.5 text-[11px] text-muted-foreground">and {items.length - 6} more</li>}
                            </ul>
                        )}
                    </div>
                );
            })}
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground inner:col-span-2">
                <CheckCircle2 className="h-3 w-3" /> Each channel&rsquo;s own tab has its queue, its room and its work.
            </p>
        </section>
    );
}
