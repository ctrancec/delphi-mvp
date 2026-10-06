'use client';

/**
 * The workspace's time zone, as found on the CHO's device — and the one
 * place to change it, for the rare time it should be something else. Every
 * department and channel that follows it moves with it.
 */

import { useState, useSyncExternalStore, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { setWorkspaceZoneAction } from '@/lib/delphi/setup';

const FALLBACK = ['UTC', 'Europe/London', 'Europe/Paris', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Toronto', 'America/Vancouver', 'Asia/Tokyo', 'Asia/Singapore', 'Australia/Sydney'];

function zones(): string[] {
    try {
        const all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone');
        return all?.length ? all : FALLBACK;
    } catch {
        return FALLBACK;
    }
}

/** This device's zone; null while rendering on the server. */
function useDeviceZone(): string | null {
    return useSyncExternalStore(
        () => () => {},
        () => Intl.DateTimeFormat().resolvedOptions().timeZone || null,
        () => null
    );
}

export function TimeZoneCard({ zone, canEdit }: { zone: string | null; canEdit: boolean }) {
    const router = useRouter();
    const device = useDeviceZone();
    const [editing, setEditing] = useState(false);
    const [choice, setChoice] = useState(zone ?? device ?? 'UTC');
    const [error, setError] = useState<string | null>(null);
    const [note, setNote] = useState<string | null>(null);
    const [pending, start] = useTransition();
    const shown = zone ?? device;

    const save = () => {
        setError(null);
        start(async () => {
            const res = await setWorkspaceZoneAction(choice);
            if (!res.ok) setError(res.error ?? 'That did not go through.');
            else {
                setEditing(false);
                setNote(res.data?.departments ? `Saved. ${res.data.departments} department${res.data.departments === 1 ? '' : 's'} moved with it.` : 'Saved.');
                router.refresh();
            }
        });
    };

    return (
        <div className="space-y-3 text-sm">
            <p className="text-zinc-200">
                {shown ?? 'Finding it…'}
                <span className="ml-2 text-xs text-muted-foreground">
                    {zone ? (device && device !== zone ? `this device is in ${device}` : 'found on your device') : 'from this device; kept the next time the dashboard opens'}
                </span>
            </p>
            {canEdit && !editing && (
                <Button size="sm" variant="outline" className="border-white/10" onClick={() => { setChoice(zone ?? device ?? 'UTC'); setEditing(true); }}>
                    Change
                </Button>
            )}
            {canEdit && editing && (
                <div className="flex flex-col gap-2 inner:flex-row">
                    <select
                        value={choice}
                        onChange={(e) => setChoice(e.target.value)}
                        className="h-9 min-w-0 rounded-md border border-white/10 bg-white/5 px-2 text-sm text-zinc-200 inner:flex-1"
                        aria-label="Time zone"
                    >
                        {[...new Set([choice, ...zones()])].map((z) => (
                            <option key={z} value={z}>{z}</option>
                        ))}
                    </select>
                    <div className="flex gap-2">
                        <Button size="sm" onClick={save} disabled={pending}>
                            {pending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Save
                        </Button>
                        <Button size="sm" variant="outline" className="border-white/10" onClick={() => setEditing(false)} disabled={pending}>
                            Cancel
                        </Button>
                    </div>
                </div>
            )}
            {note && <p className="text-xs text-emerald-300">{note}</p>}
            {error && (
                <p className="flex items-start gap-1.5 text-xs text-red-400">
                    <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
                </p>
            )}
        </div>
    );
}
