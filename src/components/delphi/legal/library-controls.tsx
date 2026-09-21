'use client';

/**
 * Fetching the library, and asking it a question.
 *
 * The query box is not a search feature — it is a way to check what the board
 * would actually be handed for a given question, before trusting a finding
 * that came out of it. Retrieval you cannot inspect is retrieval you cannot
 * audit.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Download, Loader2, Search, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface IngestSummary {
    stored?: number;
    failed?: number;
    totalChunks?: number;
    results?: { title: string; status: string; chunks: number; error?: string }[];
    error?: string;
}

export function LibraryControls() {
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    const [summary, setSummary] = useState<IngestSummary | null>(null);

    function refresh(force: boolean) {
        setSummary(null);
        startTransition(async () => {
            try {
                const res = await fetch(`/api/delphi/legal${force ? '?force=1' : ''}`, { method: 'POST' });
                const body: IngestSummary = await res.json();
                if (!res.ok) throw new Error(body.error ?? `Returned ${res.status}`);
                setSummary(body);
                router.refresh();
            } catch (err) {
                setSummary({ error: (err as Error).message });
            }
        });
    }

    const failures = summary?.results?.filter((r) => r.status === 'failed') ?? [];

    return (
        <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
                <Button
                    size="sm"
                    variant="outline"
                    onClick={() => refresh(false)}
                    disabled={pending}
                    className="border-white/10"
                >
                    {pending ? (
                        <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                    ) : (
                        <Download className="mr-2 h-3.5 w-3.5" />
                    )}
                    {pending ? 'Fetching…' : 'Fetch what is stale'}
                </Button>
                <button
                    type="button"
                    onClick={() => refresh(true)}
                    disabled={pending}
                    className="text-xs text-muted-foreground underline-offset-2 hover:text-zinc-200 hover:underline disabled:opacity-50"
                >
                    re-fetch everything
                </button>

                {summary && !summary.error && (
                    <span className="text-xs text-muted-foreground">
                        {summary.stored ?? 0} updated · {summary.totalChunks ?? 0} passages
                        {failures.length > 0 && (
                            <span className="text-amber-400/80"> · {failures.length} failed</span>
                        )}
                    </span>
                )}
                {summary?.error && (
                    <span className="flex items-center gap-1.5 text-xs text-red-400">
                        <TriangleAlert className="h-3.5 w-3.5" />
                        {summary.error}
                    </span>
                )}
            </div>

            {failures.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                    {failures.map((f) => (
                        <span
                            key={f.title}
                            className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                            title={f.error}
                        >
                            {f.title}
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}

export interface PassagePreview {
    documentTitle: string;
    section: string | null;
    jurisdiction: string;
    sourceUrl: string;
    ageDays: number;
    stale: boolean;
    text: string;
}

export function LibraryQuery() {
    const [question, setQuestion] = useState('');
    const [pending, startTransition] = useTransition();
    const [result, setResult] = useState<{ terms: string[]; passages: PassagePreview[]; error?: string } | null>(null);

    function ask() {
        if (!question.trim()) return;
        setResult(null);
        startTransition(async () => {
            try {
                const res = await fetch('/api/delphi/legal/query', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ question }),
                });
                const body = await res.json();
                if (!res.ok) throw new Error(body.error ?? `Returned ${res.status}`);
                setResult(body);
            } catch (err) {
                setResult({ terms: [], passages: [], error: (err as Error).message });
            }
        });
    }

    return (
        <div className="space-y-3">
            <div className="flex gap-2">
                <Input
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && ask()}
                    placeholder="Can I put a licensed track over my gameplay clip?"
                    className="border-white/10 bg-white/5"
                />
                <Button
                    size="sm"
                    variant="outline"
                    onClick={ask}
                    disabled={pending || !question.trim()}
                    className="shrink-0 border-white/10"
                >
                    {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                </Button>
            </div>

            {result?.error && (
                <p className="flex items-center gap-2 text-xs text-red-400">
                    <TriangleAlert className="h-3.5 w-3.5" />
                    {result.error}
                </p>
            )}

            {result && !result.error && (
                <div className="space-y-3">
                    {result.terms.length > 0 && (
                        <div className="space-y-1">
                            <p className="text-[11px] text-muted-foreground">
                                Searched for the law&rsquo;s own vocabulary, not your words:
                            </p>
                            <div className="flex flex-wrap gap-1">
                                {result.terms.map((t) => (
                                    <span
                                        key={t}
                                        className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-sky-400/80"
                                    >
                                        {t}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}

                    {result.passages.length === 0 ? (
                        <p className="text-xs text-amber-400/80">
                            Nothing in the library covers this. A board finding on this question would rest
                            on the model&rsquo;s recall rather than a stored source.
                        </p>
                    ) : (
                        result.passages.map((p, i) => (
                            <div key={i} className="space-y-1 rounded-lg border border-white/10 bg-black/40 p-3">
                                <div className="flex flex-wrap items-center gap-2">
                                    <a
                                        href={p.sourceUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-xs font-medium text-sky-400 hover:underline"
                                    >
                                        {p.documentTitle}
                                    </a>
                                    {p.section && (
                                        <span className="font-mono text-[10px] text-muted-foreground">
                                            {p.section}
                                        </span>
                                    )}
                                    <Badge variant="outline" className="text-[9px] text-muted-foreground border-white/15">
                                        {p.jurisdiction}
                                    </Badge>
                                    <span
                                        className={cn(
                                            'ml-auto text-[10px]',
                                            p.stale ? 'text-amber-400' : 'text-muted-foreground/60'
                                        )}
                                    >
                                        {p.stale ? `stale — ${p.ageDays}d old` : `${p.ageDays}d old`}
                                    </span>
                                </div>
                                <p className="line-clamp-4 text-xs leading-relaxed text-muted-foreground">
                                    {p.text}
                                </p>
                            </div>
                        ))
                    )}
                </div>
            )}
        </div>
    );
}
