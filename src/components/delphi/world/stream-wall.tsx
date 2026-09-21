'use client';

/**
 * The stream wall.
 *
 * One focused, the rest as thumbnails. Only official, publicly embeddable
 * streams appear here, played through YouTube's own IFrame player — nothing is
 * scraped, re-streamed, or lifted past a paywall or a geo-restriction.
 *
 * Nothing loads until you pick one. Eight autoplaying embeds would be eight
 * video streams the moment the page opens, which is a real cost on a phone.
 */

import { useState } from 'react';
import { Play, Radio } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface StreamTile {
    id: string;
    label: string;
    externalId: string;
    category: string;
}

export function StreamWall({ streams }: { streams: StreamTile[] }) {
    const [focused, setFocused] = useState<StreamTile | null>(null);

    if (streams.length === 0) return null;

    return (
        <section className="space-y-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                <Radio className="h-4 w-4" /> Live
            </h2>

            {focused ? (
                <div className="space-y-2">
                    <div className="aspect-video w-full overflow-hidden rounded-lg border border-white/10 bg-black">
                        <iframe
                            // `key` forces a fresh element when switching, so the
                            // previous stream stops rather than playing on in a
                            // recycled iframe.
                            key={focused.externalId}
                            src={`https://www.youtube-nocookie.com/embed/${focused.externalId}?autoplay=1&mute=1`}
                            title={focused.label}
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture"
                            allowFullScreen
                            className="h-full w-full"
                        />
                    </div>
                    <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-medium">{focused.label}</span>
                        <button
                            type="button"
                            onClick={() => setFocused(null)}
                            className="text-xs text-muted-foreground hover:text-white"
                        >
                            Close
                        </button>
                    </div>
                </div>
            ) : null}

            <div className="grid grid-cols-2 gap-2 inner:grid-cols-3 desk:grid-cols-4">
                {streams.map((s) => (
                    <button
                        key={s.id}
                        type="button"
                        onClick={() => setFocused(s)}
                        className={cn(
                            'group flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left transition-colors',
                            focused?.id === s.id
                                ? 'border-white/40 bg-white/10'
                                : 'border-white/10 hover:border-white/25 hover:bg-white/5'
                        )}
                    >
                        <Play className="h-3 w-3 shrink-0 text-muted-foreground group-hover:text-white" />
                        <span className="min-w-0 truncate text-xs">{s.label}</span>
                    </button>
                ))}
            </div>

            <p className="text-[11px] text-muted-foreground/60">
                Official outlet streams only. A tile that will not load is usually a stream the outlet
                restarted under a new id.
            </p>
        </section>
    );
}
