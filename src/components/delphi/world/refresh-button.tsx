'use client';

/**
 * Pull the world in, on demand.
 *
 * The scheduled tick is coarse on most hosting tiers, and waiting a day to see
 * whether ingestion works at all is not a debugging loop anyone would accept.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, RefreshCw, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Summary {
    ingest?: { sourcesOk: number; sourcesTried: number; itemsInserted: number; failures: { source: string }[] };
    clusters?: { clusters: number; corroborated: number };
    translation?: { translated: number; costUsd: number };
    error?: string;
}

export function WorldRefreshButton() {
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    const [result, setResult] = useState<Summary | null>(null);

    function refresh() {
        setResult(null);
        startTransition(async () => {
            try {
                const res = await fetch('/api/delphi/world', { method: 'POST' });
                const body: Summary = await res.json();
                if (!res.ok) throw new Error(body.error ?? `Returned ${res.status}`);
                setResult(body);
                router.refresh();
            } catch (err) {
                setResult({ error: (err as Error).message });
            }
        });
    }

    return (
        <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" variant="outline" onClick={refresh} disabled={pending} className="border-white/10">
                {pending ? (
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                ) : (
                    <RefreshCw className="mr-2 h-3.5 w-3.5" />
                )}
                {pending ? 'Pulling feeds…' : 'Refresh'}
            </Button>

            {result?.error && (
                <span className="flex items-center gap-1.5 text-xs text-red-400">
                    <TriangleAlert className="h-3.5 w-3.5" />
                    {result.error}
                </span>
            )}

            {result?.ingest && (
                <span className="text-xs text-muted-foreground">
                    {result.ingest.sourcesOk}/{result.ingest.sourcesTried} sources ·{' '}
                    {result.ingest.itemsInserted} new · {result.clusters?.clusters ?? 0} clusters
                    {result.translation?.translated
                        ? ` · ${result.translation.translated} translated ($${result.translation.costUsd.toFixed(4)})`
                        : ''}
                    {result.ingest.failures.length > 0 && (
                        <span className="text-amber-400/80">
                            {' '}
                            · {result.ingest.failures.length} feed
                            {result.ingest.failures.length === 1 ? '' : 's'} down
                        </span>
                    )}
                </span>
            )}
        </div>
    );
}
