'use client';

/**
 * One animation loop for every sprite on the page.
 *
 * Each sprite could run its own requestAnimationFrame, and a roster of
 * twenty would then schedule twenty callbacks a frame for the same clock.
 * Instead there is one loop, started by the first subscriber and stopped by
 * the last, that hands the time to everyone. A sprite does its own cheap
 * arithmetic on it and repaints only when its frame number changes.
 *
 * The browser pauses requestAnimationFrame in a hidden tab, so nothing here
 * burns while nobody is looking.
 */

import { useEffect } from 'react';

type Listener = (nowMs: number) => void;

const listeners = new Set<Listener>();
let handle = 0;

function tick(now: number) {
    for (const l of listeners) l(now);
    handle = listeners.size ? requestAnimationFrame(tick) : 0;
}

export function useFrameClock(listener: Listener, active = true): void {
    useEffect(() => {
        if (!active) return;
        listeners.add(listener);
        if (!handle) handle = requestAnimationFrame(tick);
        return () => {
            listeners.delete(listener);
            if (!listeners.size && handle) {
                cancelAnimationFrame(handle);
                handle = 0;
            }
        };
    }, [listener, active]);
}
