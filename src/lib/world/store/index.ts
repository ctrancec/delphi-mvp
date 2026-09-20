/**
 * World persistence.
 *
 * The whole world is one JSON document per owner. That keeps the simulation
 * code free of query plumbing and makes a tick an ordinary read-modify-write.
 * Supabase is used when it is configured; otherwise the world lives on disk so
 * the system is runnable with zero setup.
 */

import { WorldState } from '../types'
import { createWorld } from '../seed'
import { JsonWorldStore } from './json-store'
import { SupabaseWorldStore } from './supabase-store'

export interface WorldStore {
    readonly kind: 'supabase' | 'file'
    load(ownerKey: string): Promise<WorldState | null>
    save(state: WorldState): Promise<void>
}

export async function getStore(): Promise<WorldStore> {
    const supa = await SupabaseWorldStore.tryCreate()
    return supa ?? new JsonWorldStore()
}

/**
 * Serializes mutations per owner inside this process. Ticks, chat turns and UI
 * actions all mutate the same document; without this they clobber each other.
 */
const locks = new Map<string, Promise<unknown>>()

export async function withWorld<T>(
    ownerKey: string,
    mutator: (state: WorldState) => Promise<T> | T
): Promise<{ state: WorldState; result: T }> {
    const previous = locks.get(ownerKey) ?? Promise.resolve()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
        release = resolve
    })
    locks.set(ownerKey, previous.then(() => gate))

    try {
        await previous
        const store = await getStore()
        const state = (await store.load(ownerKey)) ?? createWorld(ownerKey)
        const result = await mutator(state)
        state.updatedAt = Date.now()
        state.version += 1
        await store.save(state)
        return { state, result }
    } finally {
        release()
    }
}

/** Read-only access — no lock, no write. */
export async function readWorld(ownerKey: string): Promise<WorldState> {
    const store = await getStore()
    const existing = await store.load(ownerKey)
    if (existing) return existing

    // First read also bootstraps, so the UI has something to render.
    const fresh = createWorld(ownerKey)
    await store.save(fresh)
    return fresh
}
