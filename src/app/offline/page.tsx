/**
 * Shown by the service worker when a page cannot be fetched.
 *
 * Nothing here needs the network or a session: it is cached when the worker
 * installs and served in place of the browser's error page.
 */

import Image from 'next/image';
import { APP_NAME } from '@/lib/pixel/cast/names';
import { RetryButton } from './retry';

export const dynamic = 'force-static';

export const metadata = { title: `${APP_NAME} is out of reach` };

export default function OfflinePage() {
    return (
        <main className="flex min-h-screen flex-col items-center justify-center gap-5 bg-[#0d1128] p-6 text-center text-[#f2e8cf]">
            <Image src="/icons/icon-192x192.png" alt="" width={96} height={96} style={{ imageRendering: 'pixelated' }} priority />
            <h1 className="text-2xl font-bold tracking-tight">{APP_NAME} is out of reach</h1>
            <p className="max-w-sm text-sm text-[#a9a596]">
                There is no connection right now. The agents keep working on the server; what they
                did will be here when you are back online.
            </p>
            <RetryButton />
        </main>
    );
}
