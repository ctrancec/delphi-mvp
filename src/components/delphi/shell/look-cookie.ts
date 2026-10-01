/**
 * The look cookie, readable on either side.
 *
 * Kept out of look.tsx on purpose: that file is a client module, and a
 * function exported from one cannot be called by a server layout — Next
 * refuses at render time, not at build time. The server reads the cookie
 * through this; the client writes it through look.tsx.
 */

export type Look = 'pixel' | 'classic';

export const LOOK_COOKIE = 'delphi_look';

/** What the cookie says, or the default. */
export function lookFrom(value: string | undefined | null): Look {
    return value === 'classic' ? 'classic' : 'pixel';
}
