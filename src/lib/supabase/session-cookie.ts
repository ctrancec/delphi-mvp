/**
 * Reading the session cookie without asking Supabase about it.
 *
 * `getUser()` is a network round trip to Supabase's auth server, by design —
 * it revalidates the token rather than trusting what the browser sent. That is
 * the right thing to do before showing someone their data, and the wrong thing
 * to do on every request just to find out whether a token that expires in
 * fifty minutes needs refreshing yet.
 *
 * So this reads the expiry out of the cookie locally, and the middleware uses
 * it to decide whether a refresh is worth a round trip.
 *
 * **This is not an authorization check and must never become one.** A cookie
 * is whatever the browser chose to send: anyone can write `expires_at` far
 * into the future. What stops that mattering is that the dashboard layout
 * still calls `getUser()` for real and redirects when it comes back empty, and
 * that every query runs under RLS keyed on a token Postgres verifies itself. A
 * forged cookie buys one extra hop before the door closes, and no data.
 */

/** The cookie name `@supabase/ssr` stores the session under. */
export function storageKeyFor(supabaseUrl: string): string | null {
    try {
        return `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;
    } catch {
        return null;
    }
}

function decodeBase64Url(value: string): string | null {
    try {
        const padded = value.replace(/-/g, '+').replace(/_/g, '/');
        const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
        // The session carries a user record, which can hold any UTF-8 — a name
        // with an accent in it decodes to mojibake without this step.
        return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
    } catch {
        return null;
    }
}

/**
 * Reassemble the stored value, mirroring `@supabase/ssr`'s own chunker: the
 * whole thing under the bare key when it fits in a cookie, otherwise `key.0`,
 * `key.1`, ... until one is missing.
 */
function readStored(key: string, get: (name: string) => string | undefined): string | null {
    const whole = get(key);
    if (whole) return whole;

    const parts: string[] = [];
    for (let i = 0; ; i++) {
        const chunk = get(`${key}.${i}`);
        if (!chunk) break;
        parts.push(chunk);
    }
    return parts.length ? parts.join('') : null;
}

export interface CookieSession {
    /** Unix seconds, as Supabase stores it. Null when the cookie does not say. */
    expiresAt: number | null;
}

/** The session the browser sent, as it claims to be. Null when there is none. */
export function readSessionCookie(
    key: string,
    get: (name: string) => string | undefined
): CookieSession | null {
    const stored = readStored(key, get);
    if (!stored) return null;

    const json = stored.startsWith('base64-') ? decodeBase64Url(stored.slice(7)) : stored;
    if (!json) return null;

    try {
        const parsed = JSON.parse(json) as { expires_at?: unknown };
        return {
            expiresAt: typeof parsed.expires_at === 'number' ? parsed.expires_at : null,
        };
    } catch {
        // A cookie we cannot parse is one we know nothing about, which is the
        // same answer as no cookie: ask Supabase.
        return null;
    }
}

/** Refresh this far ahead of expiry, so a token never expires mid-render. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/**
 * Can this request skip the auth round trip?
 *
 * True only when the browser sent a session that says it is good for a while
 * yet. Anything else — no cookie, an unreadable one, one without an expiry,
 * one close to or past expiry — returns false, and the caller asks Supabase.
 */
export function canSkipRefresh(session: CookieSession | null, now = Date.now()): boolean {
    if (!session || session.expiresAt === null) return false;
    return session.expiresAt * 1000 - now > REFRESH_MARGIN_MS;
}
