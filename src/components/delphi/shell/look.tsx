'use client';

/**
 * Pixel or Classic.
 *
 * One cookie decides the look, read by the server layout so the very first
 * paint is already right, and flipped here without a reload. The characters
 * and the town are the same in both; the look is the chrome around them.
 */

import { createContext, useCallback, useContext, useState } from 'react';
import { cn } from '@/lib/utils';
import { LOOK_COOKIE, type Look } from './look-cookie';

export type { Look };

const LookContext = createContext<{ look: Look; setLook: (look: Look) => void }>({ look: 'pixel', setLook: () => {} });

export function LookProvider({ initial, children }: { initial: Look; children: React.ReactNode }) {
    const [look, set] = useState<Look>(initial);
    const setLook = useCallback((next: Look) => {
        set(next);
        document.cookie = `${LOOK_COOKIE}=${next}; path=/; max-age=31536000; SameSite=Lax`;
    }, []);
    return <LookContext.Provider value={{ look, setLook }}>{children}</LookContext.Provider>;
}

export function useLook() {
    return useContext(LookContext);
}

export function LookSwitch({ className }: { className?: string }) {
    const { look, setLook } = useLook();
    const choice = (value: Look, label: string) => (
        <button
            type="button"
            onClick={() => setLook(value)}
            aria-pressed={look === value}
            className={cn(
                'px-2 py-1 text-[11px] font-medium transition-colors',
                look === value ? 'bg-white/15 text-white' : 'text-muted-foreground hover:text-white'
            )}
        >
            {label}
        </button>
    );
    return (
        <div
            role="group"
            aria-label="Look"
            title="Pixel or Classic look"
            className={cn('hidden overflow-hidden rounded-full border border-white/10 inner:flex', className)}
        >
            {choice('pixel', 'Pixel')}
            {choice('classic', 'Classic')}
        </div>
    );
}
