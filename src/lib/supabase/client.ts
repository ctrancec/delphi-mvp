import { createBrowserClient } from '@supabase/ssr'
import { readAnonEnv } from './env'

export function createClient() {
    const env = readAnonEnv()
    if (!env) return null

    return createBrowserClient(env.url, env.key)
}
