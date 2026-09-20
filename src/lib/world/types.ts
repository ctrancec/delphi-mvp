/**
 * Delphi World — domain model for the agent organization.
 *
 * The world is a single persisted document per human owner (the C.H.O.).
 * Everything the simulation needs lives in `WorldState`: the org chart, the
 * office floors the agents walk around, the task graph, long-term memory,
 * per-project connections and the file index.
 */

export type Vec2 = { x: number; y: number }

/** Roles map to capability loadouts — see `role-capabilities.ts`. */
export type AgentRole =
    | 'ceo'
    | 'manager'
    | 'engineer'
    | 'researcher'
    | 'analyst'
    | 'designer'
    | 'ops'
    | 'intern'

export type AgentStatus =
    | 'idle'
    | 'walking'
    | 'thinking'
    | 'working'
    | 'talking'
    | 'blocked'
    | 'offline'

export interface AgentAppearance {
    /** Deterministic seed used by the renderer to draw the pixel sprite. */
    seed: number
    skin: string
    hair: string
    outfit: string
    accent: string
}

/** A direct message sitting in an agent's inbox until their next turn. */
export interface AgentMessage {
    id: string
    fromId: string
    fromName: string
    text: string
    at: number
    read: boolean
}

export interface Agent {
    id: string
    companyId: string | null
    name: string
    role: AgentRole
    title: string
    /** One-line personality/charter injected into the agent's system prompt. */
    charter: string
    model: string
    managerId: string | null
    /** 0 = CEO, 1 = their direct reports, ... Used for org chart layout. */
    depth: number
    appearance: AgentAppearance
    status: AgentStatus
    /** Logical tile position on the agent's floor. */
    position: Vec2
    /** Remaining tiles of the current walk, in order. */
    path: Vec2[]
    floorId: string
    deskId: string | null
    currentTaskId: string | null
    /** Short text rendered as a speech/thought bubble above the sprite. */
    bubble: string | null
    bubbleUntil: number | null
    inbox: AgentMessage[]
    hiredAt: number
    lastActiveAt: number
    stats: {
        tasksCompleted: number
        toolCalls: number
        hires: number
        inputTokens: number
        outputTokens: number
    }
}

export type CompanyStatus = 'forming' | 'active' | 'paused' | 'archived'

export interface Company {
    id: string
    name: string
    slug: string
    /** What the CHO asked for, in the CEO's words. */
    mission: string
    status: CompanyStatus
    floorId: string
    createdAt: number
    /** Colour used for the floor's walls/carpet so projects read apart visually. */
    palette: string
}

export type TileKind =
    | 'void'
    | 'floor'
    | 'wall'
    | 'desk'
    | 'plant'
    | 'whiteboard'
    | 'server'
    | 'coffee'
    | 'door'
    | 'rug'

export interface Desk {
    id: string
    floorId: string
    position: Vec2
    /** The tile an agent stands on to use the desk. */
    seat: Vec2
    agentId: string | null
    label: string
}

export interface Landmark {
    id: string
    kind: Extract<TileKind, 'whiteboard' | 'server' | 'coffee' | 'plant' | 'door'>
    position: Vec2
    /** Walkable tile adjacent to the landmark. */
    seat: Vec2
    label: string
}

export interface Floor {
    id: string
    companyId: string | null
    name: string
    width: number
    height: number
    /** Row-major grid, `tiles[y][x]`. */
    tiles: TileKind[]
    desks: Desk[]
    landmarks: Landmark[]
    palette: string
}

export type TaskStatus =
    | 'backlog'
    | 'assigned'
    | 'in_progress'
    | 'blocked'
    | 'review'
    | 'done'
    | 'cancelled'

export interface TaskArtifact {
    kind: 'note' | 'code' | 'file' | 'link' | 'search'
    title: string
    body: string
}

export interface Task {
    id: string
    companyId: string | null
    title: string
    brief: string
    status: TaskStatus
    priority: 'low' | 'normal' | 'high' | 'urgent'
    creatorId: string
    assigneeId: string | null
    parentId: string | null
    createdAt: number
    updatedAt: number
    /** Guard against an agent looping forever on one task. */
    turns: number
    result: string | null
    artifacts: TaskArtifact[]
    blockedReason: string | null
}

export type MemoryScope = 'agent' | 'company' | 'world'
export type MemoryKind = 'fact' | 'decision' | 'reflection' | 'preference' | 'event'

export interface MemoryEntry {
    id: string
    scope: MemoryScope
    /** Agent id, company id, or `world` depending on scope. */
    ownerId: string
    kind: MemoryKind
    content: string
    /** 1–5. Low-importance memories are pruned first. */
    importance: number
    createdAt: number
    lastRecalledAt: number | null
    recallCount: number
}

export type WorldEventType =
    | 'world.created'
    | 'company.created'
    | 'agent.hired'
    | 'agent.spoke'
    | 'agent.moved'
    | 'agent.thought'
    | 'task.created'
    | 'task.assigned'
    | 'task.progress'
    | 'task.completed'
    | 'task.blocked'
    | 'tool.called'
    | 'connection.requested'
    | 'connection.connected'
    | 'file.uploaded'
    | 'system.error'

export interface WorldEvent {
    id: string
    at: number
    type: WorldEventType
    actorId: string | null
    companyId: string | null
    text: string
    meta?: Record<string, unknown>
}

export type ConnectionStatus = 'required' | 'pending' | 'connected' | 'error'

/**
 * A per-project integration the CHO has to wire up (an API key, an OAuth
 * grant, a database URL). Agents can *request* one; only the human connects it.
 */
export interface Connection {
    id: string
    companyId: string | null
    provider: string
    label: string
    reason: string
    status: ConnectionStatus
    /** Names of the env vars / fields this connection needs. Never values. */
    fields: string[]
    /** Non-secret config (base URLs, folder ids, spreadsheet ids…). */
    config: Record<string, string>
    /** Where the secret actually lives — an env var name, never the secret. */
    secretRef: string | null
    requestedBy: string | null
    createdAt: number
    connectedAt: number | null
    error: string | null
}

export type StorageProviderId = 'supabase' | 'google-drive' | 'local'

export interface FileRef {
    id: string
    companyId: string | null
    name: string
    mime: string
    size: number
    provider: StorageProviderId
    /** Provider-native locator: storage key, Drive file id, or disk path. */
    key: string
    url: string | null
    uploadedBy: string
    createdAt: number
    /** Extracted text preview agents can read without a tool round-trip. */
    summary: string | null
}

export interface ChatMessage {
    id: string
    /** `ceo` for the main channel, otherwise an agent id for a direct line. */
    channel: string
    role: 'human' | 'agent' | 'system'
    authorId: string
    content: string
    createdAt: number
    /** Names of tools the agent used producing this message. */
    toolCalls?: string[]
}

export interface WorldSettings {
    /** Ticks per real second the client asks the server to run. */
    tickHz: number
    /** Hard cap on agent LLM turns per tick, to bound spend. */
    maxTurnsPerTick: number
    /** Stop the whole world when the day's turn budget is spent. */
    dailyTurnBudget: number
    turnsUsedToday: number
    budgetResetAt: number
    storageProvider: StorageProviderId
    autoHire: boolean
    paused: boolean
}

export interface WorldState {
    id: string
    ownerKey: string
    name: string
    createdAt: number
    updatedAt: number
    tick: number
    version: number
    settings: WorldSettings
    companies: Company[]
    floors: Floor[]
    agents: Agent[]
    tasks: Task[]
    memories: MemoryEntry[]
    connections: Connection[]
    files: FileRef[]
    events: WorldEvent[]
    chat: ChatMessage[]
}

/** Helpers for the row-major tile grid. */
export function tileAt(floor: Floor, x: number, y: number): TileKind {
    if (x < 0 || y < 0 || x >= floor.width || y >= floor.height) return 'void'
    return floor.tiles[y * floor.width + x]
}

export function setTile(floor: Floor, x: number, y: number, kind: TileKind) {
    if (x < 0 || y < 0 || x >= floor.width || y >= floor.height) return
    floor.tiles[y * floor.width + x] = kind
}

const WALKABLE: ReadonlySet<TileKind> = new Set<TileKind>(['floor', 'rug', 'door'])

export function isWalkable(floor: Floor, x: number, y: number): boolean {
    return WALKABLE.has(tileAt(floor, x, y))
}
