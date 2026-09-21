import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'
import { readServiceEnv } from './env'

/**
 * Service-role client — bypasses RLS.
 *
 * Used by the seed script and by the cron-driven runtime, which act as the
 * system rather than as a signed-in user and therefore have no session to key
 * RLS off. Never import this into anything that runs in the browser: the
 * service-role key must stay server-side.
 */
export function createServiceClient(): SupabaseClient | null {
    const env = readServiceEnv()
    if (!env) return null

    return createSupabaseClient(env.url, env.key, {
        auth: { persistSession: false, autoRefreshToken: false },
    })
}
