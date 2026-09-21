import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Service-role client — bypasses RLS.
 *
 * Used by the seed script and by the cron-driven runtime, which act as the
 * system rather than as a signed-in user and therefore have no session to key
 * RLS off. Never import this into anything that runs in the browser: the
 * service-role key must stay server-side.
 */
export function createServiceClient(): SupabaseClient | null {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!url || !key) return null

    return createSupabaseClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
    })
}
