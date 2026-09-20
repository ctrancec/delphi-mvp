import fs from 'fs/promises'
import path from 'path'
import { LOCAL_STORAGE_DIR } from '../config'
import type { ListedObject, PutInput, PutResult, StorageProvider } from './index'
import { objectKey } from './index'

/** Development backing store: plain files under `.delphi/files`. */
export class LocalDiskStorage implements StorageProvider {
    readonly id = 'local' as const
    readonly label = 'Local disk'

    private root(): string {
        return path.isAbsolute(LOCAL_STORAGE_DIR)
            ? LOCAL_STORAGE_DIR
            : path.join(process.cwd(), LOCAL_STORAGE_DIR)
    }

    isConfigured() {
        return true
    }

    missingConfig() {
        return null
    }

    async put(input: PutInput): Promise<PutResult> {
        const key = objectKey(input.companyId, input.name)
        const file = path.join(this.root(), key)
        await fs.mkdir(path.dirname(file), { recursive: true })
        await fs.writeFile(file, input.data)
        await fs.writeFile(`${file}.meta.json`, JSON.stringify({ mime: input.mime, name: input.name }))
        return { key, url: null }
    }

    async get(key: string) {
        try {
            const file = path.join(this.root(), key)
            const data = await fs.readFile(file)
            let mime = 'application/octet-stream'
            try {
                mime = JSON.parse(await fs.readFile(`${file}.meta.json`, 'utf-8')).mime ?? mime
            } catch {
                /* no sidecar — fall back to octet-stream */
            }
            return { data, mime }
        } catch {
            return null
        }
    }

    async list(companyId: string | null): Promise<ListedObject[]> {
        const dir = path.join(this.root(), companyId ?? 'hq')
        try {
            const names = await fs.readdir(dir)
            const out: ListedObject[] = []
            for (const name of names) {
                if (name.endsWith('.meta.json')) continue
                const stat = await fs.stat(path.join(dir, name))
                out.push({
                    key: `${companyId ?? 'hq'}/${name}`,
                    name,
                    size: stat.size,
                    mime: 'application/octet-stream',
                    updatedAt: stat.mtimeMs,
                })
            }
            return out
        } catch {
            return []
        }
    }

    async remove(key: string): Promise<void> {
        const file = path.join(this.root(), key)
        await fs.rm(file, { force: true })
        await fs.rm(`${file}.meta.json`, { force: true })
    }
}
