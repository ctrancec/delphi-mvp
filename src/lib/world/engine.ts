/**
 * The simulation loop, split into two halves that run at different rates.
 *
 * `stepWorld` is cheap — movement, bubbles, ambient behaviour — and runs
 * several times a second so the office looks alive.
 * `runAgentTurns` is expensive — it calls the model — and runs on its own
 * slower cadence under a hard per-tick and per-day budget.
 */

import { LIMITS } from './config'
import { findPath, landmarkByKind } from './office'
import { runWorkerTurn } from './agent'
import { agentById, floorById, logEvent, updateTask } from './actions'
import { Agent, Task, WorldState } from './types'

const AMBIENT_CHANCE = 0.015

/** One animation step. Pure, cheap, no network. */
export function stepWorld(state: WorldState): void {
    const now = Date.now()
    state.tick += 1

    for (const agent of state.agents) {
        if (agent.bubbleUntil && agent.bubbleUntil < now) {
            agent.bubble = null
            agent.bubbleUntil = null
        }

        if (agent.path.length > 0) {
            agent.position = agent.path.shift()!
            agent.status = agent.path.length === 0 ? arrivalStatus(agent) : 'walking'
            continue
        }

        // Idle agents drift to the coffee machine or the whiteboard now and then.
        if (agent.status === 'idle' && Math.random() < AMBIENT_CHANCE) {
            const floor = floorById(state, agent.floorId)
            if (!floor) continue
            const spot = Math.random() < 0.5 ? 'coffee' : 'whiteboard'
            const lm = landmarkByKind(floor, spot)
            if (lm) {
                agent.path = findPath(floor, agent.position, lm.seat)
                if (agent.path.length) agent.status = 'walking'
            }
        }
    }
}

function arrivalStatus(agent: Agent): Agent['status'] {
    if (agent.status === 'talking') return 'talking'
    return agent.currentTaskId ? 'working' : 'idle'
}

/* ----------------------------------------------------------- scheduling */

interface Candidate {
    agent: Agent
    priority: number
    reason: string
}

/**
 * Decides who gets a model turn this round. Cheap bookkeeping (claiming an
 * assigned task, auto-blocking a task that has run too long) happens here too,
 * so the expensive turn starts from a sane state.
 */
function selectCandidates(state: WorldState): Candidate[] {
    const candidates: Candidate[] = []

    for (const agent of state.agents) {
        if (agent.status === 'offline') continue
        // Let people finish walking before they start thinking.
        if (agent.path.length > 0) continue
        // The CEO answers the CHO on the chat channel, not on the work loop.
        if (agent.role === 'ceo') continue

        const unread = agent.inbox.filter((m) => !m.read).length

        if (!agent.currentTaskId) {
            const mine = state.tasks.find(
                (t) => t.assigneeId === agent.id && (t.status === 'assigned' || t.status === 'in_progress')
            )
            if (mine) agent.currentTaskId = mine.id
        }

        const task = agent.currentTaskId
            ? state.tasks.find((t) => t.id === agent.currentTaskId) ?? null
            : null

        if (task && task.turns >= LIMITS.maxTaskTurns && task.status !== 'blocked') {
            updateTask(state, {
                taskId: task.id,
                status: 'blocked',
                actorId: agent.id,
                reason: `Ran for ${task.turns} turns without finishing. Needs the task split up or a decision from a human.`,
            })
            continue
        }

        if (unread > 0) {
            candidates.push({ agent, priority: 100 + unread, reason: 'has unread messages' })
            continue
        }
        if (task && task.status !== 'blocked') {
            const urgency = { urgent: 40, high: 30, normal: 20, low: 10 }[task.priority]
            candidates.push({ agent, priority: urgency, reason: `working on ${task.title}` })
            continue
        }
        if (agent.status === 'idle') {
            const backlog = state.tasks.find(
                (t) => t.companyId === agent.companyId && t.status === 'backlog'
            )
            if (backlog) candidates.push({ agent, priority: 5, reason: 'backlog available' })
        }
    }

    return candidates.sort((a, b) => b.priority - a.priority)
}

export interface WorkResult {
    ran: number
    skipped: string | null
}

export async function runAgentTurns(state: WorldState, max?: number): Promise<WorkResult> {
    const now = Date.now()

    if (now > state.settings.budgetResetAt) {
        state.settings.turnsUsedToday = 0
        state.settings.budgetResetAt = now + 24 * 60 * 60 * 1000
    }
    if (state.settings.paused) return { ran: 0, skipped: 'World is paused.' }
    if (state.settings.turnsUsedToday >= state.settings.dailyTurnBudget) {
        return { ran: 0, skipped: 'Daily turn budget spent.' }
    }

    const limit = Math.min(max ?? state.settings.maxTurnsPerTick, state.settings.maxTurnsPerTick)
    const candidates = selectCandidates(state).slice(0, limit)
    if (candidates.length === 0) return { ran: 0, skipped: null }

    let ran = 0
    for (const candidate of candidates) {
        if (state.settings.turnsUsedToday >= state.settings.dailyTurnBudget) break
        try {
            await runWorkerTurn(state, candidate.agent)
            state.settings.turnsUsedToday += 1
            ran += 1
        } catch (err) {
            logEvent(state, {
                type: 'system.error',
                actorId: candidate.agent.id,
                companyId: candidate.agent.companyId,
                text: `Turn failed for ${candidate.agent.name}: ${(err as Error).message}`,
            })
        }
    }
    return { ran, skipped: null }
}

/** What the UI shows as "what is happening right now". */
export function worldPulse(state: WorldState): {
    busy: number
    idle: number
    blocked: number
    openTasks: number
    doneTasks: number
} {
    const busy = state.agents.filter((a) => ['working', 'thinking', 'walking', 'talking'].includes(a.status)).length
    const idle = state.agents.filter((a) => a.status === 'idle').length
    const blocked = state.agents.filter((a) => a.status === 'blocked').length
    const openTasks = state.tasks.filter((t: Task) => !['done', 'cancelled'].includes(t.status)).length
    const doneTasks = state.tasks.filter((t: Task) => t.status === 'done').length
    return { busy, idle, blocked, openTasks, doneTasks }
}

export { agentById }
