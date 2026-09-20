import { NextResponse } from 'next/server'
import { withWorld } from '@/lib/world/store'
import { resolveOwnerKey } from '@/lib/world/owner'
import { createWorld } from '@/lib/world/seed'
import {
    agentById,
    assignTask,
    createCompany,
    createTask,
    hireAgent,
    logEvent,
    updateTask,
} from '@/lib/world/actions'
import { AgentRole } from '@/lib/world/types'

export const dynamic = 'force-dynamic'

/**
 * Direct CHO controls — the levers a human wants without going through the CEO:
 * pause the world, tune the budget, hire someone yourself, file a task, reset.
 */
export async function POST(req: Request) {
    try {
        const body = await req.json()
        const ownerKey = await resolveOwnerKey()

        const { state, result } = await withWorld(ownerKey, (world) => {
            switch (body.action) {
                case 'pause':
                    world.settings.paused = true
                    return { message: 'World paused.' }

                case 'resume':
                    world.settings.paused = false
                    return { message: 'World resumed.' }

                case 'settings': {
                    const s = world.settings
                    if (typeof body.tickHz === 'number') s.tickHz = Math.min(8, Math.max(1, body.tickHz))
                    if (typeof body.maxTurnsPerTick === 'number') {
                        s.maxTurnsPerTick = Math.min(6, Math.max(1, body.maxTurnsPerTick))
                    }
                    if (typeof body.dailyTurnBudget === 'number') {
                        s.dailyTurnBudget = Math.max(0, body.dailyTurnBudget)
                    }
                    if (typeof body.autoHire === 'boolean') s.autoHire = body.autoHire
                    if (body.storageProvider) s.storageProvider = body.storageProvider
                    return { message: 'Settings updated.' }
                }

                case 'create_company': {
                    const ceo = world.agents.find((a) => a.role === 'ceo')
                    const res = createCompany(world, {
                        name: body.name,
                        mission: body.mission ?? '',
                        createdBy: ceo?.id ?? 'cho',
                    })
                    return 'error' in res ? { error: res.error } : { company: res.company }
                }

                case 'hire': {
                    const res = hireAgent(world, {
                        companyId: body.companyId,
                        role: body.role as AgentRole,
                        name: body.name,
                        title: body.title,
                        charter: body.charter,
                        managerId: body.managerId ?? world.agents.find((a) => a.role === 'ceo')?.id ?? null,
                    })
                    return 'error' in res ? { error: res.error } : { agent: res.agent }
                }

                case 'create_task': {
                    const ceo = world.agents.find((a) => a.role === 'ceo')
                    const res = createTask(world, {
                        companyId: body.companyId ?? null,
                        title: body.title,
                        brief: body.brief ?? '',
                        creatorId: ceo?.id ?? 'cho',
                        assigneeId: body.assigneeId ?? null,
                        priority: body.priority,
                    })
                    return 'error' in res ? { error: res.error } : { task: res.task }
                }

                case 'assign_task':
                    return { message: assignTask(world, body.taskId, body.assigneeId, 'cho') }

                case 'update_task':
                    return {
                        message: updateTask(world, {
                            taskId: body.taskId,
                            status: body.status,
                            actorId: body.actorId ?? 'cho',
                            note: body.note,
                            result: body.result,
                            reason: body.reason,
                        }),
                    }

                case 'fire': {
                    const agent = agentById(world, body.agentId)
                    if (!agent) return { error: 'No such agent.' }
                    if (agent.role === 'ceo') return { error: 'You cannot fire your CEO.' }

                    const floor = world.floors.find((f) => f.id === agent.floorId)
                    const desk = floor?.desks.find((d) => d.id === agent.deskId)
                    if (desk) {
                        desk.agentId = null
                        desk.label = 'Empty desk'
                    }
                    world.agents = world.agents.filter((a) => a.id !== agent.id)
                    for (const t of world.tasks) {
                        if (t.assigneeId === agent.id) {
                            t.assigneeId = null
                            t.status = 'backlog'
                        }
                    }
                    logEvent(world, {
                        type: 'agent.hired',
                        actorId: null,
                        companyId: agent.companyId,
                        text: `${agent.name} left the organisation.`,
                    })
                    return { message: `${agent.name} has left.` }
                }

                case 'reset': {
                    const fresh = createWorld(ownerKey)
                    Object.assign(world, fresh, { id: world.id, version: world.version })
                    return { message: 'World reset.' }
                }

                default:
                    return { error: `Unknown action "${body.action}".` }
            }
        })

        return NextResponse.json({ state, ...result })
    } catch (err) {
        console.error('[world] control failed:', err)
        return NextResponse.json({ error: (err as Error).message }, { status: 500 })
    }
}
