/**
 * Prove the middleware's fast path cannot be talked into skipping a refresh
 * it should have made.
 *
 * The middleware asks Supabase to verify a token only when the cookie says
 * the session is running out. Getting that wrong in one direction is free —
 * an unreadable cookie just costs a round trip. Getting it wrong in the other
 * means an expired session is left un-refreshed, so every case that must
 * answer "ask Supabase" is asserted here by name.
 */

import { createChunks, stringToBase64URL } from '@supabase/ssr/dist/main/utils';
import { canSkipRefresh, readSessionCookie, storageKeyFor } from '../src/lib/supabase/session-cookie';

const G = '\x1b[32m', R = '\x1b[31m', D = '\x1b[2m', RS = '\x1b[0m';

const KEY = 'sb-imxhgmcnbqvolylzwkhm-auth-token';
const NOW = Date.UTC(2026, 8, 21, 12, 0, 0);
const HOUR = 3600;

/** A cookie jar built the way @supabase/ssr builds one, chunking included. */
function jar(session: unknown, { plain = false } = {}): (name: string) => string | undefined {
    const raw = JSON.stringify(session);
    const encoded = plain ? raw : 'base64-' + stringToBase64URL(raw);
    const cookies = new Map(createChunks(KEY, encoded).map((c) => [c.name, c.value]));
    return (name) => cookies.get(name);
}

/** A user record big enough to push the cookie past one chunk. */
const bulky = {
    id: '7dc1f507-c321-4644-be4d-acceafa25e97',
    email: 'chö@example.com',
    user_metadata: { note: 'ü'.repeat(2000) },
};

const cases: { name: string; get: (n: string) => string | undefined; skip: boolean }[] = [
    {
        name: 'fresh session (50 minutes left)',
        get: jar({ expires_at: NOW / 1000 + 50 * 60, user: { id: 'x' } }),
        skip: true,
    },
    {
        name: 'chunked across cookies, still fresh',
        get: jar({ expires_at: NOW / 1000 + HOUR, user: bulky }),
        skip: true,
    },
    {
        name: 'unencoded JSON (older cookieEncoding)',
        get: jar({ expires_at: NOW / 1000 + HOUR, user: { id: 'x' } }, { plain: true }),
        skip: true,
    },
    {
        name: 'inside the refresh margin (2 minutes left)',
        get: jar({ expires_at: NOW / 1000 + 120, user: { id: 'x' } }),
        skip: false,
    },
    { name: 'expired an hour ago', get: jar({ expires_at: NOW / 1000 - HOUR }), skip: false },
    { name: 'no expires_at at all', get: jar({ user: { id: 'x' } }), skip: false },
    { name: 'expires_at as a string', get: jar({ expires_at: String(NOW / 1000 + HOUR) }), skip: false },
    { name: 'no cookie', get: () => undefined, skip: false },
    { name: 'not JSON', get: () => 'base64-' + stringToBase64URL('hello'), skip: false },
    { name: 'not base64 either', get: () => 'base64-@@@@@@', skip: false },
    { name: 'empty string', get: () => '', skip: false },
];

let failed = 0;
console.log('\nSession cookie fast path\n' + '─'.repeat(58));

for (const c of cases) {
    const got = canSkipRefresh(readSessionCookie(KEY, c.get), NOW);
    const ok = got === c.skip;
    if (!ok) failed++;
    console.log(
        `  ${ok ? G + '✓' : R + '✗'}${RS} ${c.name.padEnd(40)}` +
            `${D}${got ? 'skips' : 'asks Supabase'}${RS}`
    );
}

// The key has to match what supabase-js derives, or nothing is ever read.
const derived = storageKeyFor('https://imxhgmcnbqvolylzwkhm.supabase.co');
const keyOk = derived === KEY;
if (!keyOk) failed++;
console.log(`  ${keyOk ? G + '✓' : R + '✗'}${RS} ${'storage key matches supabase-js'.padEnd(40)}${D}${derived}${RS}`);

const badUrl = storageKeyFor('not a url');
if (badUrl !== null) failed++;
console.log(`  ${badUrl === null ? G + '✓' : R + '✗'}${RS} ${'unusable url yields no key'.padEnd(40)}${D}${badUrl}${RS}`);

console.log(`\n${cases.length + 2 - failed}/${cases.length + 2} passed\n`);
process.exit(failed ? 1 : 0);
