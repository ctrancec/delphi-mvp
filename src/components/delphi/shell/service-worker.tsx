'use client';

/**
 * Installs the service worker and keeps hold of the browser's install prompt.
 *
 * Registered only in production: in development the worker would serve the
 * offline page over a dev server that is merely restarting. The install
 * prompt arrives once, before anyone asks for it, so it is kept here for the
 * Account page's Install button to fire later.
 */

import { useEffect, useSyncExternalStore } from 'react';

interface BeforeInstallPromptEvent extends Event {
    prompt(): Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** Whether the browser has offered to install, for a button to use. */
export function useInstallPrompt(): { available: boolean; install: () => Promise<'accepted' | 'dismissed' | 'unavailable'> } {
    const available = useSyncExternalStore(
        (cb) => {
            listeners.add(cb);
            return () => listeners.delete(cb);
        },
        () => deferred !== null,
        () => false
    );
    return {
        available,
        install: async () => {
            const ev = deferred;
            if (!ev) return 'unavailable';
            await ev.prompt();
            const { outcome } = await ev.userChoice;
            if (outcome === 'accepted') {
                deferred = null;
                notify();
            }
            return outcome;
        },
    };
}

export function ServiceWorker() {
    useEffect(() => {
        const onPrompt = (e: Event) => {
            e.preventDefault();
            deferred = e as BeforeInstallPromptEvent;
            notify();
        };
        window.addEventListener('beforeinstallprompt', onPrompt);
        if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
            navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
                // Without a worker the app is a website, which is how it was yesterday.
            });
        }
        return () => window.removeEventListener('beforeinstallprompt', onPrompt);
    }, []);
    return null;
}
