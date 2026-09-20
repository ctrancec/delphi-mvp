import type { ListedObject, PutInput, PutResult, StorageProvider } from './index'

/**
 * Google Drive backing store.
 *
 * Uses an offline OAuth refresh token for a single account — the CHO's — so
 * uploaded files land in a real Drive folder the human already owns and can
 * open outside the app. Per-company subfolders are created on demand.
 *
 * Required env:
 *   GOOGLE_DRIVE_CLIENT_ID
 *   GOOGLE_DRIVE_CLIENT_SECRET
 *   GOOGLE_DRIVE_REFRESH_TOKEN   (scope: https://www.googleapis.com/auth/drive.file)
 *   GOOGLE_DRIVE_ROOT_FOLDER_ID  (optional; defaults to Drive root)
 */
export class GoogleDriveStorage implements StorageProvider {
    readonly id = 'google-drive' as const
    readonly label = 'Google Drive'

    private token: { value: string; expiresAt: number } | null = null
    private folderCache = new Map<string, string>()

    isConfigured() {
        return Boolean(
            process.env.GOOGLE_DRIVE_CLIENT_ID &&
                process.env.GOOGLE_DRIVE_CLIENT_SECRET &&
                process.env.GOOGLE_DRIVE_REFRESH_TOKEN
        )
    }

    missingConfig() {
        if (this.isConfigured()) return null
        const missing = [
            'GOOGLE_DRIVE_CLIENT_ID',
            'GOOGLE_DRIVE_CLIENT_SECRET',
            'GOOGLE_DRIVE_REFRESH_TOKEN',
        ].filter((k) => !process.env[k])
        return `missing ${missing.join(', ')}`
    }

    private async accessToken(): Promise<string> {
        if (this.token && this.token.expiresAt > Date.now() + 30_000) return this.token.value

        const res = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: process.env.GOOGLE_DRIVE_CLIENT_ID!,
                client_secret: process.env.GOOGLE_DRIVE_CLIENT_SECRET!,
                refresh_token: process.env.GOOGLE_DRIVE_REFRESH_TOKEN!,
                grant_type: 'refresh_token',
            }),
        })
        if (!res.ok) throw new Error(`Google token refresh failed (${res.status}): ${await res.text()}`)

        const json = (await res.json()) as { access_token: string; expires_in: number }
        this.token = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 }
        return this.token.value
    }

    private async api(path: string, init: RequestInit = {}): Promise<Response> {
        const token = await this.accessToken()
        return fetch(`https://www.googleapis.com${path}`, {
            ...init,
            headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
        })
    }

    /** Finds or creates the per-company subfolder, caching the id. */
    private async folderFor(companyId: string | null): Promise<string> {
        const name = companyId ?? 'hq'
        const cached = this.folderCache.get(name)
        if (cached) return cached

        const parent = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || 'root'
        const q = encodeURIComponent(
            `name='${name}' and mimeType='application/vnd.google-apps.folder' and '${parent}' in parents and trashed=false`
        )
        const found = await this.api(`/drive/v3/files?q=${q}&fields=files(id)`)
        if (found.ok) {
            const json = (await found.json()) as { files: { id: string }[] }
            if (json.files?.[0]) {
                this.folderCache.set(name, json.files[0].id)
                return json.files[0].id
            }
        }

        const created = await this.api('/drive/v3/files?fields=id', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name,
                mimeType: 'application/vnd.google-apps.folder',
                parents: [parent],
            }),
        })
        if (!created.ok) throw new Error(`Drive folder create failed: ${await created.text()}`)
        const { id } = (await created.json()) as { id: string }
        this.folderCache.set(name, id)
        return id
    }

    async put(input: PutInput): Promise<PutResult> {
        const folderId = await this.folderFor(input.companyId)
        const boundary = `delphi${Math.random().toString(36).slice(2)}`
        const metadata = JSON.stringify({ name: input.name, parents: [folderId] })

        const body = Buffer.concat([
            Buffer.from(
                `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
                    `--${boundary}\r\nContent-Type: ${input.mime}\r\n\r\n`
            ),
            input.data,
            Buffer.from(`\r\n--${boundary}--\r\n`),
        ])

        const res = await this.api('/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
            method: 'POST',
            headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
            body: new Uint8Array(body),
        })
        if (!res.ok) throw new Error(`Drive upload failed (${res.status}): ${await res.text()}`)

        const json = (await res.json()) as { id: string; webViewLink?: string }
        return { key: json.id, url: json.webViewLink ?? `https://drive.google.com/file/d/${json.id}/view` }
    }

    async get(key: string) {
        const res = await this.api(`/drive/v3/files/${encodeURIComponent(key)}?alt=media`)
        if (!res.ok) return null
        const mime = res.headers.get('content-type') ?? 'application/octet-stream'
        return { data: Buffer.from(await res.arrayBuffer()), mime }
    }

    async list(companyId: string | null): Promise<ListedObject[]> {
        const folderId = await this.folderFor(companyId)
        const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`)
        const res = await this.api(
            `/drive/v3/files?q=${q}&fields=files(id,name,size,mimeType,modifiedTime)&orderBy=modifiedTime desc&pageSize=200`
        )
        if (!res.ok) return []
        const json = (await res.json()) as {
            files: { id: string; name: string; size?: string; mimeType: string; modifiedTime: string }[]
        }
        return (json.files ?? []).map((f) => ({
            key: f.id,
            name: f.name,
            size: Number(f.size ?? 0),
            mime: f.mimeType,
            updatedAt: Date.parse(f.modifiedTime),
        }))
    }

    async remove(key: string): Promise<void> {
        await this.api(`/drive/v3/files/${encodeURIComponent(key)}`, { method: 'DELETE' })
    }
}
