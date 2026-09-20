/** Environment-derived configuration for the agent world. */

import { StorageProviderId } from './types'

/**
 * Model defaults. Opus 5 for the CEO and anyone doing real judgement work,
 * Sonnet 5 for high-volume workers, Haiku for interns doing grunt work.
 * Override per deployment without touching code.
 */
export const MODELS = {
    executive: process.env.DELPHI_MODEL_EXECUTIVE || 'claude-opus-5',
    worker: process.env.DELPHI_MODEL_WORKER || 'claude-sonnet-5',
    intern: process.env.DELPHI_MODEL_INTERN || 'claude-haiku-4-5',
} as const

export function anthropicApiKey(): string | null {
    return process.env.ANTHROPIC_API_KEY || null
}

/** When false the world runs on the deterministic simulator instead of the API. */
export function isLiveMode(): boolean {
    return Boolean(anthropicApiKey()) && process.env.DELPHI_WORLD_SIMULATE !== '1'
}

export function storageProviderId(): StorageProviderId {
    const raw = (process.env.DELPHI_STORAGE_PROVIDER || '').toLowerCase()
    if (raw === 'google-drive' || raw === 'gdrive' || raw === 'drive') return 'google-drive'
    if (raw === 'local') return 'local'
    if (raw === 'supabase') return 'supabase'
    // Default to whichever backend is actually configured.
    if (process.env.GOOGLE_DRIVE_REFRESH_TOKEN) return 'google-drive'
    if (process.env.NEXT_PUBLIC_SUPABASE_URL) return 'supabase'
    return 'local'
}

export const STORAGE_BUCKET = process.env.DELPHI_STORAGE_BUCKET || 'delphi-world'
export const LOCAL_STORAGE_DIR =
    process.env.DELPHI_LOCAL_STORAGE_DIR || '.delphi/files'
export const WORLD_STATE_FILE =
    process.env.DELPHI_WORLD_STATE_FILE || '.delphi/world.json'

/** Hard ceilings so a runaway loop cannot burn the account. */
export const LIMITS = {
    maxAgents: Number(process.env.DELPHI_MAX_AGENTS || 40),
    maxCompanies: Number(process.env.DELPHI_MAX_COMPANIES || 12),
    maxToolIterationsPerTurn: Number(process.env.DELPHI_MAX_TOOL_ITERATIONS || 8),
    maxTaskTurns: Number(process.env.DELPHI_MAX_TASK_TURNS || 12),
    maxEvents: 600,
    maxChatPerChannel: 200,
    maxMemories: 800,
    maxOutputTokens: 8000,
}
