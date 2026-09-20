/**
 * World mutations.
 *
 * Every change to the world goes through one of these functions — whether it
 * came from an agent's tool call, an API route, or the engine itself. They are
 * synchronous and pure with respect to the passed-in state, which makes the
 * whole simulation easy to reason about and to test.
 */

import { id, slugify } from './ids'
import { LIMITS } from './config'
import {
    createFloor,
    ensureDeskCapacity,
    entrance,
    findFreeDesk,
    findPath,
    adjacentFreeTile,
    landmarkByKind,
} from './office'
import { ROLES, appearanceFor, companyPalette } from './roles'
import { remember } from './memory'
import { starterConnections } from './connections'
import { storageProviderId } from './config'
import {
    Agent,
    AgentRole,
    Company,
    Connection,
    Floor,
    Task,
    TaskStatus,
    Vec2,
    WorldEvent,
    WorldEventType,
    WorldState,
} from './types'

export const CEO_CHANNEL = 'ceo'
const BUBBLE_MS = 6000

/* ------------------------------------------------------------------ lookups */

export function agentById(state: WorldState, agentId: string | null): Agent | null {
    if (!agentId) return null
    return state.agents.find((a) => a.id === agentId) ?? null
}

export function companyById(state: WorldState, companyId: string | null): Company | null {
    if (!companyId) return null
    return state.companies.find((c) => c.id === companyId) ?? null
}

export function floorById(state: WorldState, floorId: string): Floor | null {
    return state.floors.find((f) => f.id === floorId) ?? null
}

export function taskById(state: WorldState, taskId: string): Task | null {
    return state.tasks.find((t) => t.id === taskId) ?? null
}

export function ceoOf(state: WorldState): Agent | null {
    return state.agents.find((a) => a.role === 'ceo') ?? null
}

export function teamOf(state: WorldState, companyId: string): Agent[] {
    return state.agents.filter((a) => a.companyId === companyId)
}

/* ------------------------------------------------------------------- events */

export function logEvent(
    state: WorldState,
    event: { type: WorldEventType; actorId?: string | null; companyId?: string | null; text: string; meta?: Record<string, unknown> }
): WorldEvent {
    const entry: WorldEvent = {
        id: id('evt'),
        at: Date.now(),
        type: event.type,
        actorId: event.actorId ?? null,
        companyId: event.companyId ?? null,
        text: event.text,
        meta: event.meta,
    }
    state.events.push(entry)
    if (state.events.length > LIMITS.maxEvents) {
        state.events.splice(0, state.events.length - LIMITS.maxEvents)
    }
    return entry
}

export function pushChat(
    state: WorldState,
    msg: { channel: string; role: 'human' | 'agent' | 'system'; authorId: string; content: string; toolCalls?: string[] }
) {
    state.chat.push({ id: id('msg'), createdAt: Date.now(), ...msg })
    const channelCount = state.chat.filter((m) => m.channel === msg.channel).length
    if (channelCount > LIMITS.maxChatPerChannel) {
        const idx = state.chat.findIndex((m) => m.channel === msg.channel)
        if (idx >= 0) state.chat.splice(idx, 1)
    }
}

export function setBubble(agent: Agent, text: string | null, ms = BUBBLE_MS) {
    agent.bubble = text ? text.slice(0, 160) : null
    agent.bubbleUntil = text ? Date.now() + ms : null
}

/* -------------------------------------------------------------- navigation */

export type Destination = 'desk' | 'whiteboard' | 'server' | 'coffee' | 'door' | string

/** Points an agent at a destination; the engine walks them there one tile per tick. */
export function walkTo(state: WorldState, agent: Agent, destination: Destination): string {
    const floor = floorById(state, agent.floorId)
    if (!floor) return 'You are not on a floor.'

    let target: Vec2 | null = null
    let label = destination

    if (destination === 'desk') {
        const desk = floor.desks.find((d) => d.id === agent.deskId)
        target = desk ? desk.seat : null
        label = 'their desk'
    } else if (['whiteboard', 'server', 'coffee', 'door'].includes(destination)) {
        const lm = landmarkByKind(floor, destination as 'whiteboard')
        target = lm ? lm.seat : null
        label = lm?.label ?? destination
    } else {
        const other = agentById(state, destination)
        if (!other) return `No such destination or agent: ${destination}`
        if (other.floorId !== agent.floorId) {
            return `${other.name} works on a different floor. Send them a message instead.`
        }
        const occupied = state.agents.filter((a) => a.id !== agent.id).map((a) => a.position)
        target = adjacentFreeTile(floor, other.position, occupied)
        label = other.name
    }

    if (!target) return `Could not find a way to ${label}.`

    agent.path = findPath(floor, agent.position, target)
    agent.status = agent.path.length > 0 ? 'walking' : agent.status
    return `Walking to ${label}.`
}

/* -------------------------------------------------------------- companies */

export function createCompany(
    state: WorldState,
    input: { name: string; mission: string; createdBy: string }
): { company: Company; floor: Floor } | { error: string } {
    if (state.companies.length >= LIMITS.maxCompanies) {
        return { error: `The world is at its limit of ${LIMITS.maxCompanies} companies.` }
    }
    const slug = slugify(input.name)
    const clash = state.companies.find((c) => c.slug === slug)
    if (clash) return { error: `A company called "${clash.name}" already exists — use it instead.` }

    const palette = companyPalette(state.companies.length)
    const floor = createFloor(null, `${input.name} — Floor`, palette)
    const company: Company = {
        id: id('co'),
        name: input.name,
        slug,
        mission: input.mission,
        status: 'forming',
        floorId: floor.id,
        createdAt: Date.now(),
        palette,
    }
    floor.companyId = company.id
    state.floors.push(floor)
    state.companies.push(company)

    // Every new project starts with its own connection slots to wire up.
    for (const starter of starterConnections()) {
        const conn = requestConnection(state, {
            companyId: company.id,
            provider: starter.provider,
            label: starter.label,
            reason: starter.reason,
            fields: starter.fields,
            requestedBy: input.createdBy,
        }).connection
        // The drive is live the moment a storage backend is configured.
        if (starter.provider === 'shared-drive') {
            conn.status = 'connected'
            conn.connectedAt = Date.now()
            conn.config = { provider: storageProviderId() }
        }
    }

    remember(state, {
        scope: 'company',
        ownerId: company.id,
        kind: 'fact',
        content: `${company.name} exists to: ${company.mission}`,
        importance: 5,
    })
    logEvent(state, {
        type: 'company.created',
        actorId: input.createdBy,
        companyId: company.id,
        text: `${company.name} founded — ${company.mission.slice(0, 120)}`,
    })
    return { company, floor }
}

/* ------------------------------------------------------------------ hiring */

export function hireAgent(
    state: WorldState,
    input: {
        companyId: string
        role: AgentRole
        name: string
        title?: string
        charter?: string
        managerId: string | null
    }
): { agent: Agent } | { error: string } {
    if (state.agents.length >= LIMITS.maxAgents) {
        return { error: `Headcount is capped at ${LIMITS.maxAgents}. Finish or cancel work before hiring.` }
    }
    const company = companyById(state, input.companyId)
    if (!company) return { error: `No company with id ${input.companyId}.` }

    const floor = floorById(state, company.floorId)
    if (!floor) return { error: 'That company has no floor.' }

    const def = ROLES[input.role]
    if (!def) return { error: `Unknown role "${input.role}".` }

    // Grow the office when the current row of desks is full — this is what
    // makes the world visibly expand as the org does.
    if (!findFreeDesk(floor)) {
        ensureDeskCapacity(floor, floor.desks.length + 1)
    }
    const desk = findFreeDesk(floor)

    const manager = agentById(state, input.managerId)
    const now = Date.now()
    const agent: Agent = {
        id: id('agent'),
        companyId: company.id,
        name: input.name,
        role: input.role,
        title: input.title || def.defaultTitle,
        charter: input.charter || def.brief,
        model: def.model,
        managerId: manager?.id ?? null,
        depth: manager ? manager.depth + 1 : 1,
        appearance: appearanceFor(input.role, state.agents.length * 7 + 3),
        status: 'walking',
        position: entrance(floor),
        path: [],
        floorId: floor.id,
        deskId: desk?.id ?? null,
        currentTaskId: null,
        bubble: null,
        bubbleUntil: null,
        inbox: [],
        hiredAt: now,
        lastActiveAt: now,
        stats: { tasksCompleted: 0, toolCalls: 0, hires: 0, inputTokens: 0, outputTokens: 0 },
    }
    if (desk) {
        desk.agentId = agent.id
        desk.label = `${agent.name}'s desk`
    }
    state.agents.push(agent)

    // New hires walk in through the door and find their seat.
    walkTo(state, agent, 'desk')
    setBubble(agent, `First day at ${company.name}!`)

    if (manager) manager.stats.hires += 1
    if (company.status === 'forming') company.status = 'active'

    remember(state, {
        scope: 'company',
        ownerId: company.id,
        kind: 'fact',
        content: `${agent.name} (${agent.title}) joined ${company.name}. Charter: ${agent.charter}`,
        importance: 4,
    })
    logEvent(state, {
        type: 'agent.hired',
        actorId: manager?.id ?? null,
        companyId: company.id,
        text: `${agent.name} hired as ${agent.title} at ${company.name}.`,
        meta: { agentId: agent.id },
    })
    return { agent }
}

/* ------------------------------------------------------------------- tasks */

export function createTask(
    state: WorldState,
    input: {
        companyId: string | null
        title: string
        brief: string
        creatorId: string
        assigneeId?: string | null
        priority?: Task['priority']
        parentId?: string | null
    }
): { task: Task } | { error: string } {
    if (input.companyId && !companyById(state, input.companyId)) {
        return { error: `No company with id ${input.companyId}.` }
    }
    const assignee = agentById(state, input.assigneeId ?? null)
    if (input.assigneeId && !assignee) return { error: `No agent with id ${input.assigneeId}.` }

    const now = Date.now()
    const task: Task = {
        id: id('task'),
        companyId: input.companyId,
        title: input.title,
        brief: input.brief,
        status: assignee ? 'assigned' : 'backlog',
        priority: input.priority ?? 'normal',
        creatorId: input.creatorId,
        assigneeId: assignee?.id ?? null,
        parentId: input.parentId ?? null,
        createdAt: now,
        updatedAt: now,
        turns: 0,
        result: null,
        artifacts: [],
        blockedReason: null,
    }
    state.tasks.push(task)

    logEvent(state, {
        type: 'task.created',
        actorId: input.creatorId,
        companyId: input.companyId,
        text: assignee ? `"${task.title}" assigned to ${assignee.name}.` : `"${task.title}" added to the backlog.`,
        meta: { taskId: task.id },
    })
    return { task }
}

export function assignTask(state: WorldState, taskId: string, assigneeId: string, actorId: string): string {
    const task = taskById(state, taskId)
    if (!task) return `No task with id ${taskId}.`
    const assignee = agentById(state, assigneeId)
    if (!assignee) return `No agent with id ${assigneeId}.`

    task.assigneeId = assignee.id
    task.status = task.status === 'backlog' ? 'assigned' : task.status
    task.updatedAt = Date.now()

    logEvent(state, {
        type: 'task.assigned',
        actorId,
        companyId: task.companyId,
        text: `"${task.title}" → ${assignee.name}.`,
        meta: { taskId: task.id, assigneeId: assignee.id },
    })
    return `Assigned "${task.title}" to ${assignee.name}.`
}

export function updateTask(
    state: WorldState,
    input: { taskId: string; status: TaskStatus; actorId: string; note?: string; result?: string; reason?: string }
): string {
    const task = taskById(state, input.taskId)
    if (!task) return `No task with id ${input.taskId}.`

    const actor = agentById(state, input.actorId)
    task.status = input.status
    task.updatedAt = Date.now()
    if (input.result) {
        task.result = input.result
        task.artifacts.push({ kind: 'note', title: task.title, body: input.result })
    }
    task.blockedReason = input.status === 'blocked' ? input.reason ?? 'No reason given.' : null

    if (input.status === 'done') {
        if (actor) {
            actor.stats.tasksCompleted += 1
            if (actor.currentTaskId === task.id) actor.currentTaskId = null
            actor.status = 'idle'
        }
        logEvent(state, {
            type: 'task.completed',
            actorId: input.actorId,
            companyId: task.companyId,
            text: `${actor?.name ?? 'Someone'} finished "${task.title}".`,
            meta: { taskId: task.id },
        })
        if (task.companyId && task.result) {
            remember(state, {
                scope: 'company',
                ownerId: task.companyId,
                kind: 'decision',
                content: `Task "${task.title}" completed. Outcome: ${task.result.slice(0, 400)}`,
                importance: 4,
            })
        }
    } else if (input.status === 'blocked') {
        if (actor) {
            actor.status = 'blocked'
            actor.currentTaskId = null
        }
        logEvent(state, {
            type: 'task.blocked',
            actorId: input.actorId,
            companyId: task.companyId,
            text: `"${task.title}" is blocked: ${task.blockedReason}`,
            meta: { taskId: task.id },
        })
    } else {
        logEvent(state, {
            type: 'task.progress',
            actorId: input.actorId,
            companyId: task.companyId,
            text: input.note ? `${actor?.name ?? 'Someone'}: ${input.note}` : `"${task.title}" → ${input.status}.`,
            meta: { taskId: task.id },
        })
    }
    return `Task "${task.title}" is now ${input.status}.`
}

/* ---------------------------------------------------------------- messages */

export function deliverMessage(state: WorldState, from: Agent, toId: string, text: string): string {
    const to = agentById(state, toId)
    if (!to) return `No agent with id ${toId}.`

    to.inbox.push({ id: id('dm'), fromId: from.id, fromName: from.name, text, at: Date.now(), read: false })
    if (to.inbox.length > 20) to.inbox.splice(0, to.inbox.length - 20)

    // If they share a floor, walk over and say it in person.
    if (to.floorId === from.floorId) {
        walkTo(state, from, to.id)
        from.status = 'talking'
    }
    setBubble(from, text.length > 80 ? `${text.slice(0, 77)}…` : text)

    logEvent(state, {
        type: 'agent.spoke',
        actorId: from.id,
        companyId: from.companyId,
        text: `${from.name} → ${to.name}: ${text.slice(0, 140)}`,
        meta: { toId: to.id },
    })
    return `Message delivered to ${to.name}.`
}

/* ------------------------------------------------------------- connections */

export function requestConnection(
    state: WorldState,
    input: {
        companyId: string | null
        provider: string
        label: string
        reason: string
        fields?: string[]
        requestedBy: string
    }
): { connection: Connection } {
    const existing = state.connections.find(
        (c) => c.companyId === input.companyId && c.provider === input.provider
    )
    if (existing) return { connection: existing }

    const connection: Connection = {
        id: id('conn'),
        companyId: input.companyId,
        provider: input.provider,
        label: input.label,
        reason: input.reason,
        status: 'required',
        // An explicit empty list means "no credentials needed" — only guess a
        // field name when the caller said nothing at all.
        fields:
            input.fields ?? [`${input.provider.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_API_KEY`],
        config: {},
        secretRef: null,
        requestedBy: input.requestedBy,
        createdAt: Date.now(),
        connectedAt: null,
        error: null,
    }
    state.connections.push(connection)

    logEvent(state, {
        type: 'connection.requested',
        actorId: input.requestedBy,
        companyId: input.companyId,
        text: `Needs a connection: ${connection.label} — ${connection.reason}`,
        meta: { connectionId: connection.id },
    })
    return { connection }
}

export function connectConnection(
    state: WorldState,
    connectionId: string,
    payload: { secretRef?: string | null; config?: Record<string, string> }
): string {
    const conn = state.connections.find((c) => c.id === connectionId)
    if (!conn) return `No connection with id ${connectionId}.`

    conn.status = 'connected'
    conn.connectedAt = Date.now()
    conn.error = null
    if (payload.secretRef !== undefined) conn.secretRef = payload.secretRef
    if (payload.config) conn.config = { ...conn.config, ...payload.config }

    logEvent(state, {
        type: 'connection.connected',
        actorId: null,
        companyId: conn.companyId,
        text: `${conn.label} connected by the CHO.`,
        meta: { connectionId: conn.id },
    })
    if (conn.companyId) {
        remember(state, {
            scope: 'company',
            ownerId: conn.companyId,
            kind: 'fact',
            content: `${conn.label} (${conn.provider}) is connected and available to this team.`,
            importance: 4,
        })
    }
    return `${conn.label} is connected.`
}

/** Unblocks anyone who was waiting on a connection that just came online. */
export function unblockWaitingOn(state: WorldState, provider: string) {
    for (const task of state.tasks) {
        if (task.status !== 'blocked') continue
        if (!task.blockedReason?.toLowerCase().includes(provider.toLowerCase())) continue
        task.status = task.assigneeId ? 'assigned' : 'backlog'
        task.blockedReason = null
        task.updatedAt = Date.now()
        const assignee = agentById(state, task.assigneeId)
        if (assignee && assignee.status === 'blocked') assignee.status = 'idle'
    }
}
