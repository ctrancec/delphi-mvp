/**
 * File storage for the world.
 *
 * Anything the CHO uploads, and anything an agent writes, goes through a
 * `StorageProvider`. Three are shipped: Google Drive (so files land in a folder
 * the human already owns), Supabase Storage (the large default backing store),
 * and local disk (for development). Which one is live is decided by env —
 * see `storageProviderId()`.
 */

import { StorageProviderId } from '../types'
import { storageProviderId } from '../config'
import { LocalDiskStorage } from './local-disk'
import { SupabaseStorage } from './supabase-storage'
import { GoogleDriveStorage } from './google-drive'

export interface PutInput {
    companyId: string | null
    name: string
    mime: string
    data: Buffer
}

export interface PutResult {
    key: string
    url: string | null
}

export interface ListedObject {
    key: string
    name: string
    size: number
    mime: string
    updatedAt: number
}

export interface StorageProvider {
    readonly id: StorageProviderId
    readonly label: string
    isConfigured(): boolean
    /** Human-readable reason the provider cannot be used, when it cannot. */
    missingConfig(): string | null
    put(input: PutInput): Promise<PutResult>
    get(key: string): Promise<{ data: Buffer; mime: string } | null>
    list(companyId: string | null): Promise<ListedObject[]>
    remove(key: string): Promise<void>
}

const PROVIDERS: Record<StorageProviderId, () => StorageProvider> = {
    local: () => new LocalDiskStorage(),
    supabase: () => new SupabaseStorage(),
    'google-drive': () => new GoogleDriveStorage(),
}

export function getStorageProvider(preferred?: StorageProviderId): StorageProvider {
    const wanted = preferred ?? storageProviderId()
    const provider = PROVIDERS[wanted]()
    if (provider.isConfigured()) return provider

    // Never fail an upload because the preferred backend is half-configured.
    const fallback = new LocalDiskStorage()
    console.warn(
        `[world] storage provider "${wanted}" unavailable (${provider.missingConfig()}), falling back to local disk`
    )
    return fallback
}

export function describeProviders(): {
    id: StorageProviderId
    label: string
    configured: boolean
    missing: string | null
}[] {
    return (Object.keys(PROVIDERS) as StorageProviderId[]).map((key) => {
        const p = PROVIDERS[key]()
        return { id: p.id, label: p.label, configured: p.isConfigured(), missing: p.missingConfig() }
    })
}

/** Safe object key: `<company>/<timestamp>-<slug>`. */
export function objectKey(companyId: string | null, name: string): string {
    const safe = name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120)
    return `${companyId ?? 'hq'}/${Date.now()}-${safe}`
}
