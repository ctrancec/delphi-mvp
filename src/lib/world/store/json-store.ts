import fs from 'fs/promises'
import path from 'path'
import { WORLD_STATE_FILE } from '../config'
import { WorldState } from '../types'
import type { WorldStore } from './index'

/** Disk-backed store — the zero-configuration default for local development. */
export class JsonWorldStore implements WorldStore {
    readonly kind = 'file' as const

    private fileFor(ownerKey: string): string {
        const safe = ownerKey.replace(/[^a-zA-Z0-9._-]/g, '_')
        const base = path.isAbsolute(WORLD_STATE_FILE)
            ? WORLD_STATE_FILE
            : path.join(process.cwd(), WORLD_STATE_FILE)
        return path.join(path.dirname(base), `${safe}.json`)
    }

    async load(ownerKey: string): Promise<WorldState | null> {
        try {
            const raw = await fs.readFile(this.fileFor(ownerKey), 'utf-8')
            return JSON.parse(raw) as WorldState
        } catch {
            return null
        }
    }

    async save(state: WorldState): Promise<void> {
        const file = this.fileFor(state.ownerKey)
        await fs.mkdir(path.dirname(file), { recursive: true })
        // Write-then-rename so a crash mid-write cannot truncate the world.
        const tmp = `${file}.${process.pid}.tmp`
        await fs.writeFile(tmp, JSON.stringify(state), 'utf-8')
        await fs.rename(tmp, file)
    }
}
