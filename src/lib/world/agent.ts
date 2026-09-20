/**
 * Turning world state into an agent turn.
 *
 * The system prompt gives an agent three things: who they are, who else exists
 * (with ids, so delegation is possible), and what they already know. The user
 * message gives them the situation right now. Everything else they discover
 * through tools.
 */

import { LIMITS } from './config'
import { ROLES } from './roles'
import { formatMemories, recall } from './memory'
import { toolsForAgent } from './tools/definitions'
import { executeTool } from './tools/execute'
import { runTurn, ScriptedPlan, TurnResult } from './llm'
import {
    CEO_CHANNEL,
    agentById,
    companyById,
    logEvent,
    pushChat,
    setBubble,
    teamOf,
} from './actions'
import { Agent, Task, WorldState } from './types'

const WORLD_RULES = `HOW THIS WORLD WORKS
- You are a persistent agent in a simulated office. You have a desk, a position on a floor, and memory that survives restarts.
- Other agents are real participants with their own turns. Reach them with message_agent using their agent id — never assume they already know something.
- Work is tracked as tasks. A task is finished only when you call update_task with status "done" and a result someone could actually use.
- You cannot connect external services yourself. If you need an API key, a database or an account, call request_connection and plan around not having it yet.
- speak() is a speech bubble in the room: one short line. Your final message is the real report and is not shown as a bubble.
- Do the work, do not describe the work you would do. If a task is genuinely impossible, mark it blocked and say exactly what is missing.`

function orgChart(state: WorldState, viewer: Agent): string {
    const lines: string[] = []
    for (const company of state.companies) {
        const team = teamOf(state, company.id)
        lines.push(`\n[${company.name}] id: ${company.id} — ${company.status}`)
        lines.push(`  mission: ${company.mission}`)
        if (team.length === 0) {
            lines.push('  (no one hired yet)')
            continue
        }
        for (const member of team) {
            const marker = member.id === viewer.id ? ' ← you' : ''
            lines.push(
                `  - ${member.name}, ${member.title} (${member.role}) id: ${member.id} [${member.status}]${marker}`
            )
        }
    }
    if (lines.length === 0) return '\n(no companies yet — nothing has been started)'
    return lines.join('\n')
}

function openBoard(state: WorldState, companyId: string | null): string {
    const tasks = state.tasks.filter(
        (t) => t.companyId === companyId && !['done', 'cancelled'].includes(t.status)
    )
    if (tasks.length === 0) return '(nothing open)'
    return tasks
        .slice(-20)
        .map((t) => {
            const who = agentById(state, t.assigneeId)
            return `- [${t.status}] "${t.title}" id: ${t.id} → ${who ? who.name : 'unassigned'}${
                t.blockedReason ? ` (blocked: ${t.blockedReason})` : ''
            }`
        })
        .join('\n')
}

function connectionsSummary(state: WorldState, companyId: string | null): string {
    const conns = state.connections.filter((c) => c.companyId === companyId || c.companyId === null)
    if (conns.length === 0) return '(none requested)'
    return conns.map((c) => `- ${c.label} (${c.provider}): ${c.status}`).join('\n')
}

function filesSummary(state: WorldState, companyId: string | null): string {
    const files = state.files.filter((f) => f.companyId === companyId)
    if (files.length === 0) return '(drive is empty)'
    return files.slice(-15).map((f) => `- ${f.name} (id: ${f.id})`).join('\n')
}

function buildSystemPrompt(state: WorldState, agent: Agent): string {
    const def = ROLES[agent.role]
    const company = companyById(state, agent.companyId)
    const manager = agentById(state, agent.managerId)
    const memories = recall(state, `${agent.title} ${company?.mission ?? ''}`, {
        agentId: agent.id,
        companyId: agent.companyId,
        limit: 10,
    })

    return `You are ${agent.name}, ${agent.title} in a live agent organisation run for a human called the Chief Human Officer (CHO).

YOUR ROLE
${def.brief}

YOUR CHARTER
${agent.charter}

${company ? `YOUR COMPANY\n${company.name} — ${company.mission}` : 'You work out of Headquarters and are not attached to a single company.'}
${manager ? `You report to ${manager.name} (${manager.title}), agent id ${manager.id}.` : ''}

THE ORGANISATION${orgChart(state, agent)}

OPEN WORK ON YOUR BOARD
${openBoard(state, agent.companyId)}

CONNECTIONS
${connectionsSummary(state, agent.companyId)}

SHARED DRIVE
${filesSummary(state, agent.companyId)}

WHAT YOU REMEMBER
${formatMemories(memories)}

${WORLD_RULES}`
}

function situationFor(state: WorldState, agent: Agent, task: Task | null): string {
    const parts: string[] = []

    const unread = agent.inbox.filter((m) => !m.read)
    if (unread.length) {
        parts.push(
            `Messages waiting for you:\n${unread
                .map((m) => `- from ${m.fromName} (id ${m.fromId}): ${m.text}`)
                .join('\n')}`
        )
        for (const m of unread) m.read = true
    }

    if (task) {
        parts.push(
            `Your current task (id ${task.id}, priority ${task.priority}):\nTitle: ${task.title}\nBrief: ${task.brief}` +
                (task.turns > 0 ? `\nYou have already spent ${task.turns} turn(s) on this.` : '')
        )
        parts.push(
            'Work it now. Use your tools, then call update_task — "done" with a usable result, or "blocked" with exactly what is missing.'
        )
    } else if (unread.length) {
        parts.push('Deal with your messages. Create or take on tasks if that is what they call for.')
    } else {
        parts.push(
            'You have no assigned task. Look at the board above: pick up something unassigned that fits you (assign_task to yourself), or if there is genuinely nothing, say so briefly and go idle.'
        )
    }

    return parts.join('\n\n')
}

async function toolRunner(state: WorldState, agent: Agent) {
    return (name: string, input: unknown) => executeTool(state, agent, name, input)
}

/* --------------------------------------------------------- the CEO channel */

export async function runCeoTurn(state: WorldState, humanMessage: string): Promise<TurnResult> {
    const ceo = state.agents.find((a) => a.role === 'ceo')
    if (!ceo) throw new Error('This world has no CEO.')

    ceo.status = 'thinking'
    ceo.lastActiveAt = Date.now()
    setBubble(ceo, 'Thinking…', 8000)

    const history = state.chat
        .filter((m) => m.channel === CEO_CHANNEL && m.role !== 'system')
        .slice(-16)
        .map((m) => ({
            role: (m.role === 'human' ? 'user' : 'assistant') as 'user' | 'assistant',
            content: m.content,
        }))

    const system = `${buildSystemPrompt(state, ceo)}

TALKING TO THE CHO
This is the CHO's direct line. They set direction; you run the organisation.
- When they describe a project, create a company for it, hire the people it needs, and open real tasks. Do not ask a round of clarifying questions when a sensible reading exists — start, and say what you assumed.
- Keep replies short and concrete: what you did, who is on it, what you need from them.
- Anything you need from them — a connection, a file, a decision — say it plainly in your reply.
Your final message is what the CHO reads. Do not also call report_to_cho for the same content.`

    const result = await runTurn({
        model: ceo.model,
        system,
        messages: [...history, { role: 'user', content: humanMessage }],
        tools: toolsForAgent(ceo),
        capability: ROLES.ceo.capability,
        effort: 'high',
        maxIterations: LIMITS.maxToolIterationsPerTurn,
        onToolCall: await toolRunner(state, ceo),
        fallbackPlan: scriptedCeoPlan(state, ceo, humanMessage),
    })

    ceo.stats.inputTokens += result.usage.input
    ceo.stats.outputTokens += result.usage.output
    ceo.status = 'idle'
    setBubble(ceo, null)

    const reply =
        result.text ||
        (result.error
            ? `I hit a problem running that: ${result.error}`
            : 'Done — check the activity log for what changed.')

    pushChat(state, {
        channel: CEO_CHANNEL,
        role: 'agent',
        authorId: ceo.id,
        content: reply,
        toolCalls: result.toolCalls,
    })
    return result
}

/* ------------------------------------------------------------- worker turn */

export async function runWorkerTurn(state: WorldState, agent: Agent): Promise<TurnResult> {
    const task = agent.currentTaskId
        ? state.tasks.find((t) => t.id === agent.currentTaskId) ?? null
        : null

    agent.status = 'thinking'
    agent.lastActiveAt = Date.now()
    if (task) task.turns += 1

    const result = await runTurn({
        model: agent.model,
        system: buildSystemPrompt(state, agent),
        messages: [{ role: 'user', content: situationFor(state, agent, task) }],
        tools: toolsForAgent(agent),
        capability: ROLES[agent.role].capability,
        effort: agent.role === 'intern' ? 'low' : 'high',
        maxIterations: LIMITS.maxToolIterationsPerTurn,
        onToolCall: await toolRunner(state, agent),
        fallbackPlan: scriptedWorkerPlan(state, agent, task),
    })

    agent.stats.inputTokens += result.usage.input
    agent.stats.outputTokens += result.usage.output

    if (result.error) {
        logEvent(state, {
            type: 'system.error',
            actorId: agent.id,
            companyId: agent.companyId,
            text: `${agent.name} could not finish a turn: ${result.error}`,
        })
        agent.status = 'blocked'
        return result
    }

    if (result.text) {
        logEvent(state, {
            type: 'agent.thought',
            actorId: agent.id,
            companyId: agent.companyId,
            text: `${agent.name}: ${result.text.slice(0, 400)}`,
        })
    }
    if (agent.status === 'thinking') agent.status = agent.currentTaskId ? 'working' : 'idle'
    return result
}

/* ------------------------------------------- scripted plans (no API key) */

const SIM_NAMES = ['Mira', 'Devon', 'Priya', 'Kai', 'Noor', 'Theo', 'Isla', 'Ravi', 'June', 'Otto']

function simName(state: WorldState): string {
    const taken = new Set(state.agents.map((a) => a.name))
    return SIM_NAMES.find((n) => !taken.has(n)) ?? `Agent ${state.agents.length + 1}`
}

/**
 * What the CEO does when there is no model behind them. Deliberately mechanical
 * — it exercises every moving part (company, hires, board, reporting) so the
 * world is inspectable before anyone spends a token.
 */
function scriptedCeoPlan(state: WorldState, ceo: Agent, message: string): ScriptedPlan {
    const calls: ScriptedPlan['calls'] = []
    const title = message.split(/[.\n!?]/)[0].slice(0, 70) || 'New initiative'

    const existing = state.companies[state.companies.length - 1]
    if (!existing) {
        // The scripted CEO has no judgement, so it does not pretend to name
        // things — a real turn picks something meaningful.
        const name = `Project ${state.companies.length + 1}`
        calls.push({ name: 'create_company', input: { name, mission: message.slice(0, 400) } })
        return {
            text: `[simulation mode — no ANTHROPIC_API_KEY set]\nI've stood up "${name}" for this and put a floor on the map. Set ANTHROPIC_API_KEY to have me actually reason about it, hire deliberately and do the work.`,
            calls,
        }
    }

    if (teamOf(state, existing.id).length < 3) {
        const role = teamOf(state, existing.id).length === 0 ? 'manager' : 'engineer'
        calls.push({
            name: 'hire',
            input: {
                company_id: existing.id,
                role,
                name: simName(state),
                title: role === 'manager' ? 'Project Lead' : 'Engineer',
                charter: `Deliver on: ${existing.mission.slice(0, 160)}`,
            },
        })
    }
    calls.push({
        name: 'create_task',
        input: {
            company_id: existing.id,
            title: title,
            brief: message.slice(0, 600),
            priority: 'normal',
        },
    })

    return {
        text: `[simulation mode — no ANTHROPIC_API_KEY set]\nAdded "${title}" to ${existing.name}'s board and staffed the floor. Everything here is scripted until an API key is set.`,
        calls,
    }
}

function scriptedWorkerPlan(state: WorldState, agent: Agent, task: Task | null): ScriptedPlan {
    if (!task) {
        const open = state.tasks.find(
            (t) => t.companyId === agent.companyId && t.status === 'backlog'
        )
        if (open) {
            return {
                text: 'Picking this up.',
                calls: [{ name: 'assign_task', input: { task_id: open.id, assignee_id: agent.id } }],
            }
        }
        return { text: '', calls: [{ name: 'go_to', input: { destination: 'coffee' } }] }
    }

    if (task.status === 'assigned') {
        return {
            text: `Starting "${task.title}".`,
            calls: [
                { name: 'go_to', input: { destination: 'desk' } },
                { name: 'speak', input: { text: `On "${task.title}".` } },
                { name: 'update_task', input: { task_id: task.id, status: 'in_progress', note: 'Started.' } },
            ],
        }
    }

    return {
        text: `Finished "${task.title}" (simulated).`,
        calls: [
            {
                name: 'update_task',
                input: {
                    task_id: task.id,
                    status: 'done',
                    result: `[simulation mode] "${task.title}" was marked done by the scripted runner. Set ANTHROPIC_API_KEY for ${agent.name} to actually do this work.`,
                },
            },
        ],
    }
}
