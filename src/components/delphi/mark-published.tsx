'use client';

/**
 * "Mark as published": where a channel's piece went live, once the CHO has
 * put it up by hand. The link goes on the piece and its topic, and the
 * channel's history reads it, so the same thing is not made twice.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ExternalLink, Loader2, Radio, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { markPublishedAction } from '@/lib/delphi/episode-actions';

export function MarkPublished({ artifactId, publishedUrl, canEdit, compact = false }: { artifactId: string; publishedUrl: string | null; canEdit: boolean; compact?: boolean }) {
    const router = useRouter();
    const [open, setOpen] = useState(false);
    const [url, setUrl] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [pending, start] = useTransition();

    if (publishedUrl) {
        return (
            <a href={publishedUrl} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1.5 text-xs text-emerald-300 hover:underline">
                <Radio className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">Published{compact ? '' : ` — ${publishedUrl}`}</span>
                <ExternalLink className="h-3 w-3 shrink-0" />
            </a>
        );
    }
    if (!canEdit) return null;

    if (!open) {
        return (
            <Button size="sm" variant="outline" className="border-white/10" onClick={() => setOpen(true)}>
                <Radio className="mr-1.5 h-3.5 w-3.5" /> Mark as published
            </Button>
        );
    }

    const save = () => {
        setError(null);
        start(async () => {
            const res = await markPublishedAction(artifactId, url);
            if (!res.ok) setError(res.error ?? 'That did not go through.');
            else {
                setOpen(false);
                router.refresh();
            }
        });
    };

    return (
        <div className="w-full space-y-2">
            <div className="flex gap-2">
                <input
                    type="url"
                    inputMode="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') save();
                    }}
                    placeholder="https://youtube.com/shorts/…"
                    autoFocus
                    className="h-8 min-w-0 flex-1 rounded-md border border-white/10 bg-white/5 px-2.5 text-sm text-zinc-100 placeholder:text-muted-foreground"
                />
                <Button size="sm" onClick={save} disabled={pending || !url.trim()}>
                    {pending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Save
                </Button>
                <Button size="sm" variant="outline" className="border-white/10" onClick={() => setOpen(false)} disabled={pending}>
                    Cancel
                </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">Where it went live. The channel remembers it, so it is not made again.</p>
            {error && (
                <p className="flex items-start gap-1.5 text-xs text-red-400">
                    <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
                </p>
            )}
        </div>
    );
}
