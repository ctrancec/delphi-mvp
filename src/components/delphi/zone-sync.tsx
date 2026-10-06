'use client';

/**
 * Tells the server the time zone this device is in, once a visit. Nobody is
 * asked for it: the workspace keeps it when it has none yet, and every
 * department's schedule follows. Renders nothing.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { syncDeviceZoneAction } from '@/lib/delphi/setup';

const KEY = 'tempest-zone-synced';

export function ZoneSync() {
    const router = useRouter();
    useEffect(() => {
        let done = false;
        try {
            done = sessionStorage.getItem(KEY) === '1';
        } catch {
            // Storage refused: report anyway; the server only acts when it has something to do.
        }
        if (done) return;
        const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (!zone) return;
        void syncDeviceZoneAction(zone)
            .then((res) => {
                try {
                    sessionStorage.setItem(KEY, '1');
                } catch {
                    // Nothing to keep it in; the next visit asks again, harmlessly.
                }
                if (res.ok && res.data?.adopted) router.refresh();
            })
            .catch(() => {
                // A missed report is retried on the next visit.
            });
    }, [router]);
    return null;
}
