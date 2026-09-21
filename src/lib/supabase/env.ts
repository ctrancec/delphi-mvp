/**
 * Reads and sanity-checks the Supabase environment.
 *
 * The check exists because of a failure that is genuinely hard to diagnose from
 * the symptom. Supabase keys ride in the `apikey` and `Authorization` headers,
 * and HTTP header values must be ISO-8859-1 — so a key holding any character
 * above U+00FF makes `fetch` throw deep inside undici:
 *
 *   TypeError: Cannot convert argument to a ByteString because the character
 *   at index 8 has a value of 8226 which is greater than 255
 *
 * 8226 is `•`. That is what you get when a masked key is copied out of a
 * dashboard instead of the real one — the value *looks* present in the hosting
 * provider's settings, every check for "is it set?" passes, and the app then
 * 500s on its first database call with a stack trace that names neither
 * Supabase nor the variable at fault.
 *
 * So: fail here, by name, with the reason.
 */

export interface SupabaseEnv {
    url: string;
    key: string;
}

/** Header values are ISO-8859-1; anything above this cannot be sent at all. */
function hasUnsendableCharacters(value: string): boolean {
    for (const char of value) {
        if (char.codePointAt(0)! > 0xff) return true;
    }
    return false;
}

/** Masked values are the common case, and worth naming specifically. */
function looksMasked(value: string): boolean {
    return /[•·*•·]/.test(value) || /^\.{4,}/.test(value);
}

/**
 * Validate one key. Returns null and explains itself on the server log when the
 * value cannot work, so the caller can fall back to its "not configured" path
 * rather than throwing from inside a fetch.
 */
export function readSupabaseKey(name: string, value: string | undefined): string | null {
    if (!value) return null;

    const trimmed = value.trim();
    if (!trimmed) {
        console.error(`[supabase] ${name} is empty.`);
        return null;
    }

    if (hasUnsendableCharacters(trimmed)) {
        console.error(
            looksMasked(trimmed)
                ? `[supabase] ${name} contains masked characters (•). The hidden form of the key was copied rather than the key itself — reveal it first, or use the copy button.`
                : `[supabase] ${name} contains characters that cannot be sent in an HTTP header. It is not a valid key.`
        );
        return null;
    }

    // Supabase keys are JWTs: three base64url segments. Publishable keys
    // (sb_publishable_…) and secret keys (sb_secret_…) are the newer format.
    const isJwt = trimmed.split('.').length === 3 && trimmed.startsWith('ey');
    const isNewFormat = /^sb_(publishable|secret)_/.test(trimmed);
    if (!isJwt && !isNewFormat) {
        console.error(
            `[supabase] ${name} does not look like a Supabase key. Expected a JWT starting "ey" with two dots, or an "sb_publishable_"/"sb_secret_" key.`
        );
        return null;
    }

    return trimmed;
}

/** The project URL, validated enough to be usable as a base URL. */
export function readSupabaseUrl(value: string | undefined): string | null {
    if (!value?.trim()) return null;
    const trimmed = value.trim();
    try {
        const parsed = new URL(trimmed);
        if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') {
            console.error(`[supabase] NEXT_PUBLIC_SUPABASE_URL must be https. Got ${parsed.protocol}//`);
            return null;
        }
        return trimmed.replace(/\/+$/, '');
    } catch {
        console.error(
            `[supabase] NEXT_PUBLIC_SUPABASE_URL is not a valid URL. Expected something like https://<project-ref>.supabase.co`
        );
        return null;
    }
}

/** URL + anon key, or null with the reason already logged. */
export function readAnonEnv(): SupabaseEnv | null {
    const url = readSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
    const key = readSupabaseKey('NEXT_PUBLIC_SUPABASE_ANON_KEY', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    if (!url || !key) return null;
    return { url, key };
}

/** URL + service-role key, or null with the reason already logged. */
export function readServiceEnv(): SupabaseEnv | null {
    const url = readSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
    const key = readSupabaseKey('SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY);
    if (!url || !key) return null;
    return { url, key };
}
