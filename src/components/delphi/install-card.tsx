'use client';

/**
 * Putting Tempest on the home screen.
 *
 * Chrome and Edge hand over an install prompt, which the button fires. iOS
 * never does, so it gets the two taps spelled out. Already installed means
 * the page is running standalone, and there is nothing to add.
 */

import { useState, useSyncExternalStore } from 'react';
import { Download, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useInstallPrompt } from '@/components/delphi/shell/service-worker';
import { APP_NAME } from '@/lib/pixel/cast/names';

/** Facts about the browser, read after hydration so the server and the client agree on the first paint. */
const onDisplayModeChange = (cb: () => void) => {
    const mq = window.matchMedia('(display-mode: standalone)');
    mq.addEventListener('change', cb);
    return () => mq.removeEventListener('change', cb);
};
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) && !('MSStream' in window);
const never = () => () => {};

export function InstallCard() {
    const { available, install } = useInstallPrompt();
    const standalone = useSyncExternalStore(onDisplayModeChange, isStandalone, () => false);
    const ios = useSyncExternalStore(never, isIos, () => false);
    const [result, setResult] = useState<string | null>(null);

    if (standalone) {
        return (
            <p className="flex items-center gap-2 text-sm text-emerald-400">
                <Smartphone className="h-4 w-4 shrink-0" /> Installed. {APP_NAME} is running from your home screen.
            </p>
        );
    }

    if (available) {
        return (
            <div className="space-y-2">
                <Button
                    size="sm"
                    onClick={async () => {
                        const outcome = await install();
                        setResult(outcome === 'accepted' ? 'Installed. Look for it on your home screen or in your apps.' : outcome === 'dismissed' ? 'Not this time.' : null);
                    }}
                >
                    <Download className="mr-2 h-3.5 w-3.5" /> Install {APP_NAME}
                </Button>
                {result && <p className="text-xs text-muted-foreground">{result}</p>}
            </div>
        );
    }

    if (ios) {
        return (
            <p className="text-sm text-muted-foreground">
                In Safari, tap <span className="text-zinc-200">Share</span>, then{' '}
                <span className="text-zinc-200">Add to Home Screen</span>. {APP_NAME} opens full screen from there, and can show notifications once you turn them on.
            </p>
        );
    }

    return (
        <p className="text-sm text-muted-foreground">
            Your browser installs apps from its own menu: look for <span className="text-zinc-200">Install {APP_NAME}</span> or{' '}
            <span className="text-zinc-200">Add to Home Screen</span>.
        </p>
    );
}
