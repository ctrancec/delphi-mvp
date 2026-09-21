import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { cache } from 'react'
import { readAnonEnv } from './env'

/**
 * The Supabase client for this request.
 *
 * Memoized with React's `cache()`, which is request-scoped on the server: a
 * layout and the page inside it render concurrently and each used to build
 * their own client, re-reading cookies and re-constructing the auth machinery
 * every time. One instance per request also lets everything downstream that is
 * keyed on the client — the workspace lookup, the user — collapse to a single
 * query instead of one per caller.
 *
 * Outside a request (a script, a test) `cache()` has no store and simply calls
 * through, so this is a no-op there rather than a cross-request leak.
 */
export const createClient = cache(async () => {
    const cookieStore = await cookies()

    const env = readAnonEnv()
    if (!env) return null

    return createServerClient(
        env.url,
        env.key,
        {
            cookies: {
                getAll() {
                    return cookieStore.getAll()
                },
                setAll(cookiesToSet) {
                    try {
                        cookiesToSet.forEach(({ name, value, options }) =>
                            cookieStore.set(name, value, options)
                        )
                    } catch {
                        // The `setAll` method was called from a Server Component.
                        // This can be ignored if you have middleware refreshing
                        // user sessions.
                    }
                },
            },
        }
    )
})

/**
 * Who is signed in, resolved once per request.
 *
 * `getUser()` revalidates the token against Supabase's auth server rather than
 * trusting the cookie, so it is a network round trip — and the dashboard used
 * to make it in the layout and again in the page. Same answer, twice the wait.
 */
export const currentUser = cache(async () => {
    const supabase = await createClient()
    if (!supabase) return null

    const { data } = await supabase.auth.getUser()
    return data.user ?? null
})
