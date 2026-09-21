'use client';

/**
 * Speaking into a review thread.
 *
 * "Discussions before approval" runs both directions. The board and Delphi
 * deliberate, and the CHO can put a question into the same transcript rather
 * than only reading the outcome.
 */

import { useState, useTransition } from 'react';
import { Loader2, Send, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { postToThreadAction } from '@/lib/delphi/actions';

export function ThreadComposer({ threadId }: { threadId: string }) {
    const [content, setContent] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [pending, startTransition] = useTransition();

    function post() {
        setError(null);
        startTransition(async () => {
            const res = await postToThreadAction(threadId, content);
            if (res.ok) setContent('');
            else setError(res.error ?? 'Could not post that.');
        });
    }

    return (
        <div className="space-y-2">
            <Textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Ask the board a question, or state a condition…"
                className="min-h-20 border-white/10 bg-white/5 text-sm"
            />
            {error && (
                <p className="flex items-center gap-2 text-xs text-red-400">
                    <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
                    {error}
                </p>
            )}
            <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] text-muted-foreground/60">
                    Posted as the CHO, into the permanent record.
                </p>
                <Button size="sm" onClick={post} disabled={pending || !content.trim()}>
                    {pending ? (
                        <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                    ) : (
                        <Send className="mr-2 h-3.5 w-3.5" />
                    )}
                    Post
                </Button>
            </div>
        </div>
    );
}
