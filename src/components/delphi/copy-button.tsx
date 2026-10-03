'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

/** Copies a block of text and says so for a moment. */
export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
    const [done, setDone] = useState(false);
    return (
        <button
            type="button"
            onClick={async () => {
                try {
                    await navigator.clipboard.writeText(text);
                    setDone(true);
                    setTimeout(() => setDone(false), 1500);
                } catch {
                    // The clipboard is denied in some contexts; the text is on screen to select.
                }
            }}
            className="inline-flex items-center gap-1 rounded border border-white/10 px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-white/25 hover:text-white"
        >
            {done ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
            {done ? 'Copied' : label}
        </button>
    );
}
