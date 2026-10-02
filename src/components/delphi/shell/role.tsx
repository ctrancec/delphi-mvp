'use client';

/**
 * What the signed-in person may do, for the chrome.
 *
 * Resolved once by the server layout and handed down, so a control the
 * owner alone may use can hide or explain itself without each page asking
 * who is looking.
 */

import { createContext, useContext } from 'react';
import type { Role } from '@/lib/delphi/members';

const RoleContext = createContext<Role>('owner');

export function RoleProvider({ role, children }: { role: Role; children: React.ReactNode }) {
    return <RoleContext.Provider value={role}>{children}</RoleContext.Provider>;
}

export function useRole(): Role {
    return useContext(RoleContext);
}
