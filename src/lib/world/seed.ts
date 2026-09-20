/** Creates a brand new world: an HQ floor, a CEO at their desk, nothing else. */

import { id } from './ids'
import { createFloor } from './office'
import { ROLES, appearanceFor } from './roles'
import { storageProviderId } from './config'
import { Agent, WorldEvent, WorldState } from './types'

export const CEO_CHANNEL = 'ceo'

export function createCeo(floorId: string, seat: { x: number; y: number }, deskId: string | null, name = 'Atlas'): Agent {
    const def = ROLES.ceo
    const now = Date.now()
    return {
        id: id('agent'),
        companyId: null,
        name,
        role: 'ceo',
        title: def.defaultTitle,
        charter:
            'Serve the Chief Human Officer. Turn their intent into companies, teams and finished work. Ask for the connections and files you need; never pretend work is done that is not.',
        model: def.model,
        managerId: null,
        depth: 0,
        appearance: appearanceFor('ceo', 7),
        status: 'idle',
        position: { ...seat },
        path: [],
        floorId,
        deskId,
        currentTaskId: null,
        bubble: null,
        bubbleUntil: null,
        inbox: [],
        hiredAt: now,
        lastActiveAt: now,
        stats: { tasksCompleted: 0, toolCalls: 0, hires: 0, inputTokens: 0, outputTokens: 0 },
    }
}

export function createWorld(ownerKey: string, ownerName = 'Chief Human Officer'): WorldState {
    const now = Date.now()
    const hq = createFloor(null, 'Headquarters', '#8b5cf6')
    const ceoDesk = hq.desks[0]
    const ceo = createCeo(hq.id, ceoDesk.seat, ceoDesk.id)
    ceoDesk.agentId = ceo.id
    ceoDesk.label = 'Corner office'

    const bootEvent: WorldEvent = {
        id: id('evt'),
        at: now,
        type: 'world.created',
        actorId: null,
        companyId: null,
        text: `${ownerName} founded the world. ${ceo.name} reported for duty.`,
    }

    return {
        id: id('world'),
        ownerKey,
        name: 'Delphi World',
        createdAt: now,
        updatedAt: now,
        tick: 0,
        version: 1,
        settings: {
            tickHz: 2,
            maxTurnsPerTick: 2,
            dailyTurnBudget: 400,
            turnsUsedToday: 0,
            budgetResetAt: now + 24 * 60 * 60 * 1000,
            storageProvider: storageProviderId(),
            autoHire: true,
            paused: false,
        },
        companies: [],
        floors: [hq],
        agents: [ceo],
        tasks: [],
        memories: [
            {
                id: id('mem'),
                scope: 'world',
                ownerId: 'world',
                kind: 'preference',
                content: `The human in charge is the Chief Human Officer (${ownerName}). They set direction; the CEO agent runs the organisation.`,
                importance: 5,
                createdAt: now,
                lastRecalledAt: null,
                recallCount: 0,
            },
        ],
        connections: [],
        files: [],
        events: [bootEvent],
        chat: [
            {
                id: id('msg'),
                channel: CEO_CHANNEL,
                role: 'agent',
                authorId: ceo.id,
                content:
                    "Morning. I'm Atlas, your CEO. Tell me what you're trying to build or figure out and I'll stand up a company for it — floor, team, task board, the lot. What's first?",
                createdAt: now,
            },
        ],
    }
}
