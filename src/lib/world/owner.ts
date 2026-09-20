import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { id } from './ids'

const OWNER_COOKIE = 'delphi_world_owner'

/**
 * Which world to load. A signed-in Supabase user owns a world keyed by their
 * user id; otherwise the browser gets a long-lived anonymous key so the world
 * still persists across sessions on that device.
 */
export async function resolveOwnerKey(): Promise<string> {
    try {
        const supabase = await createClient()
        if (supabase) {
            const {
                data: { user },
            } = await supabase.auth.getUser()
            if (user) return `user:${user.id}`
        }
    } catch {
        /* no session — fall through to the cookie */
    }

    const jar = await cookies()
    const existing = jar.get(OWNER_COOKIE)?.value
    if (existing) return existing

    const fresh = id('owner')
    try {
        jar.set(OWNER_COOKIE, fresh, {
            httpOnly: true,
            sameSite: 'lax',
            path: '/',
            maxAge: 60 * 60 * 24 * 365,
        })
    } catch {
        // Called from a Server Component, where cookies are read-only. The
        // route handlers will set it on the next write.
    }
    return fresh
}
