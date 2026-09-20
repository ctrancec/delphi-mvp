import { createClient as createServerClient } from '@/lib/supabase/server'
import { STORAGE_BUCKET } from '../config'
import type { ListedObject, PutInput, PutResult, StorageProvider } from './index'
import { objectKey } from './index'

/**
 * Supabase Storage — the default "large storage base". Objects live under
 * `<bucket>/<companyId>/<file>`; the bucket is expected to be private, so reads
 * go through signed URLs rather than public links.
 */
export class SupabaseStorage implements StorageProvider {
    readonly id = 'supabase' as const
    readonly label = 'Supabase Storage'

    isConfigured() {
        return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
    }

    missingConfig() {
        if (this.isConfigured()) return null
        return 'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set'
    }

    private async bucket() {
        const client = await createServerClient()
        if (!client) throw new Error('Supabase is not configured')
        return client.storage.from(STORAGE_BUCKET)
    }

    async put(input: PutInput): Promise<PutResult> {
        const key = objectKey(input.companyId, input.name)
        const bucket = await this.bucket()
        const { error } = await bucket.upload(key, input.data, {
            contentType: input.mime,
            upsert: false,
        })
        if (error) throw new Error(`Supabase upload failed: ${error.message}`)

        const { data: signed } = await bucket.createSignedUrl(key, 60 * 60 * 24 * 7)
        return { key, url: signed?.signedUrl ?? null }
    }

    async get(key: string) {
        const bucket = await this.bucket()
        const { data, error } = await bucket.download(key)
        if (error || !data) return null
        return { data: Buffer.from(await data.arrayBuffer()), mime: data.type || 'application/octet-stream' }
    }

    async list(companyId: string | null): Promise<ListedObject[]> {
        const bucket = await this.bucket()
        const prefix = companyId ?? 'hq'
        const { data, error } = await bucket.list(prefix, { limit: 200, sortBy: { column: 'created_at', order: 'desc' } })
        if (error || !data) return []
        return data.map((item) => ({
            key: `${prefix}/${item.name}`,
            name: item.name,
            size: (item.metadata?.size as number | undefined) ?? 0,
            mime: (item.metadata?.mimetype as string | undefined) ?? 'application/octet-stream',
            updatedAt: item.updated_at ? Date.parse(item.updated_at) : Date.now(),
        }))
    }

    async remove(key: string): Promise<void> {
        const bucket = await this.bucket()
        await bucket.remove([key])
    }
}
