/**
 * Persistent memory.
 *
 * Three scopes: `world` (things true for the whole organisation, including what
 * the CHO prefers), `company` (project context) and `agent` (what one person
 * learned). Memories survive restarts because they live in the world document.
 *
 * Retrieval is keyword-overlap scored rather than embedding-based — no extra
 * service to run, and at this corpus size it is good enough. Swap `score()` for
 * a vector search when a world outgrows it.
 */

import { id } from './ids'
import { LIMITS } from './config'
import { MemoryEntry, MemoryKind, MemoryScope, WorldState } from './types'

const STOPWORDS = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been',
    'to', 'of', 'in', 'on', 'for', 'with', 'that', 'this', 'it', 'as', 'at', 'by',
    'from', 'we', 'i', 'you', 'they', 'he', 'she', 'our', 'your', 'their', 'do',
    'does', 'did', 'have', 'has', 'had', 'will', 'would', 'can', 'could', 'should',
])

function tokens(text: string): string[] {
    return text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length > 2 && !STOPWORDS.has(t))
}

export function remember(
    state: WorldState,
    input: {
        scope: MemoryScope
        ownerId: string
        kind: MemoryKind
        content: string
        importance?: number
    }
): MemoryEntry {
    const content = input.content.trim()
    const existing = state.memories.find(
        (m) => m.scope === input.scope && m.ownerId === input.ownerId && m.content === content
    )
    if (existing) {
        existing.importance = Math.max(existing.importance, input.importance ?? 3)
        return existing
    }

    const entry: MemoryEntry = {
        id: id('mem'),
        scope: input.scope,
        ownerId: input.ownerId,
        kind: input.kind,
        content,
        importance: Math.min(5, Math.max(1, input.importance ?? 3)),
        createdAt: Date.now(),
        lastRecalledAt: null,
        recallCount: 0,
    }
    state.memories.push(entry)
    prune(state)
    return entry
}

function score(entry: MemoryEntry, queryTokens: string[], now: number): number {
    if (queryTokens.length === 0) return entry.importance
    const entryTokens = new Set(tokens(entry.content))
    let overlap = 0
    for (const t of queryTokens) if (entryTokens.has(t)) overlap += 1

    const relevance = overlap / queryTokens.length
    const ageDays = (now - entry.createdAt) / 86_400_000
    const recency = 1 / (1 + ageDays / 14)
    return relevance * 3 + entry.importance * 0.6 + recency + Math.min(entry.recallCount, 5) * 0.1
}

export function recall(
    state: WorldState,
    query: string,
    opts: { agentId?: string; companyId?: string | null; limit?: number } = {}
): MemoryEntry[] {
    const now = Date.now()
    const queryTokens = tokens(query)
    const limit = opts.limit ?? 8

    const visible = state.memories.filter((m) => {
        if (m.scope === 'world') return true
        if (m.scope === 'agent') return m.ownerId === opts.agentId
        if (m.scope === 'company') return opts.companyId != null && m.ownerId === opts.companyId
        return false
    })

    const ranked = visible
        .map((m) => ({ m, s: score(m, queryTokens, now) }))
        .sort((a, b) => b.s - a.s)
        .slice(0, limit)
        .map((r) => r.m)

    for (const m of ranked) {
        m.lastRecalledAt = now
        m.recallCount += 1
    }
    return ranked
}

/** Drops the least useful memories once the world exceeds its budget. */
function prune(state: WorldState) {
    if (state.memories.length <= LIMITS.maxMemories) return
    const now = Date.now()
    state.memories.sort((a, b) => score(b, [], now) - score(a, [], now))
    state.memories.length = LIMITS.maxMemories
}

export function formatMemories(entries: MemoryEntry[]): string {
    if (entries.length === 0) return 'No relevant memories yet.'
    return entries.map((m) => `- (${m.kind}) ${m.content}`).join('\n')
}
