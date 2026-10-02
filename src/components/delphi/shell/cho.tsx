'use client';

/**
 * What the CHO goes by, for the chrome.
 *
 * Resolved once by the server layout from the signed-in user and handed down
 * here, so the avatar's label, the log and anything else that names the CHO
 * agree without each asking who is signed in.
 */

import { createContext, useContext } from 'react';
import { CHO_NAME } from '@/lib/pixel/cast/names';

const ChoContext = createContext<string>(CHO_NAME);

export function ChoProvider({ name, children }: { name: string; children: React.ReactNode }) {
    return <ChoContext.Provider value={name}>{children}</ChoContext.Provider>;
}

export function useCho(): string {
    return useContext(ChoContext);
}
