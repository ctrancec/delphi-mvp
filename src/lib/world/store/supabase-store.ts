import { createClient } from '@/lib/supabase/server'
import { WorldState } from '../types'
import type { WorldStore } from './index'

const TABLE = 'agent_worlds'

/**
 * Stores the world document in Supabase (`agent_worlds.state`), guarded by RLS
 * so each Chief Human Officer only ever sees their own world.
 */
export class SupabaseWorldStore implements WorldStore {
    readonly kind = 'supabase' as const

    private constructor(private client: NonNullable<Awaited<ReturnType<typeof createClient>>>) {}

    static async tryCreate(): Promise<SupabaseWorldStore | null> {
        if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return null
        try {
            const client = await createClient()
            if (!client) return null
            return new SupabaseWorldStore(client)
        } catch {
            // No request context (e.g. a script) — fall back to the file store.
            return null
        }
    }

    async load(ownerKey: string): Promise<WorldState | null> {
        const { data, error } = await this.client
            .from(TABLE)
            .select('state')
            .eq('owner_key', ownerKey)
            .maybeSingle()

        if (error) {
            console.error('[world] supabase load failed:', error.message)
            return null
        }
        return (data?.state as WorldState | undefined) ?? null
    }

    async save(state: WorldState): Promise<void> {
        const { error } = await this.client.from(TABLE).upsert(
            {
                owner_key: state.ownerKey,
                name: state.name,
                state,
                version: state.version,
                updated_at: new Date(state.updatedAt).toISOString(),
            },
            { onConflict: 'owner_key' }
        )
        if (error) throw new Error(`Failed to save world: ${error.message}`)
    }
}
