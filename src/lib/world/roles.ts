/**
 * Role definitions: what each kind of agent is for, which model it runs on,
 * and which capabilities it is allowed to use.
 *
 * Capabilities gate the Anthropic server tools. `web_search_20260209` performs
 * its own filtering via a hidden code-execution environment, so an agent may
 * hold `search` or `code`, never both — declaring two execution environments in
 * one request confuses the model.
 */

import { MODELS } from './config'
import { AgentRole } from './types'

export type Capability = 'search' | 'code'

export interface RoleDefinition {
    role: AgentRole
    defaultTitle: string
    model: string
    capability: Capability | null
    /** Can this role hire and create sub-teams? */
    canHire: boolean
    canCreateCompany: boolean
    /** Appended to the agent's system prompt. */
    brief: string
    palette: { outfit: string; accent: string }
}

export const ROLES: Record<AgentRole, RoleDefinition> = {
    ceo: {
        role: 'ceo',
        defaultTitle: 'Chief Executive Agent',
        model: MODELS.executive,
        capability: 'search',
        canHire: true,
        canCreateCompany: true,
        brief:
            'You run the whole organisation on behalf of the Chief Human Officer. You do not do the detailed work yourself — you decide what should exist, spin up companies for each project, hire the right people, split work into concrete tasks and delegate. You are the only agent who talks to the CHO directly.',
        palette: { outfit: '#1e293b', accent: '#f4c430' },
    },
    manager: {
        role: 'manager',
        defaultTitle: 'Project Lead',
        model: MODELS.executive,
        capability: 'search',
        canHire: true,
        canCreateCompany: false,
        brief:
            'You own delivery for one company. You break your mission into tasks, assign them to your team, hire interns or specialists when the team is short-handed, unblock people and report progress upward.',
        palette: { outfit: '#334155', accent: '#38bdf8' },
    },
    engineer: {
        role: 'engineer',
        defaultTitle: 'Engineer',
        model: MODELS.worker,
        capability: 'code',
        canHire: false,
        canCreateCompany: false,
        brief:
            'You build and verify things. Write and actually run code to check your work before you report it done. Ship concrete artifacts, not plans.',
        palette: { outfit: '#0f766e', accent: '#5eead4' },
    },
    researcher: {
        role: 'researcher',
        defaultTitle: 'Researcher',
        model: MODELS.worker,
        capability: 'search',
        canHire: false,
        canCreateCompany: false,
        brief:
            'You find out what is actually true. Search the web, read carefully, and report findings with sources. Say plainly when the evidence is thin.',
        palette: { outfit: '#4c1d95', accent: '#c4b5fd' },
    },
    analyst: {
        role: 'analyst',
        defaultTitle: 'Analyst',
        model: MODELS.worker,
        capability: 'code',
        canHire: false,
        canCreateCompany: false,
        brief:
            'You turn data into decisions. Compute rather than estimate — run the numbers, then state the conclusion and what would change it.',
        palette: { outfit: '#7c2d12', accent: '#fdba74' },
    },
    designer: {
        role: 'designer',
        defaultTitle: 'Designer',
        model: MODELS.worker,
        capability: null,
        canHire: false,
        canCreateCompany: false,
        brief:
            'You design what the thing looks like and how it feels to use. Deliver specific, buildable direction: layout, hierarchy, copy, states.',
        palette: { outfit: '#9d174d', accent: '#fbcfe8' },
    },
    ops: {
        role: 'ops',
        defaultTitle: 'Operations',
        model: MODELS.worker,
        capability: null,
        canHire: false,
        canCreateCompany: false,
        brief:
            'You keep the machine running: connections, files, scheduling, follow-ups. You notice what is missing before anyone is blocked by it.',
        palette: { outfit: '#365314', accent: '#bef264' },
    },
    intern: {
        role: 'intern',
        defaultTitle: 'Intern',
        model: MODELS.intern,
        capability: null,
        canHire: false,
        canCreateCompany: false,
        brief:
            'You take narrow, well-specified tasks and finish them quickly. If the task is ambiguous, ask your manager rather than guessing.',
        palette: { outfit: '#a16207', accent: '#fde68a' },
    },
}

export const HIREABLE_ROLES: AgentRole[] = [
    'manager',
    'engineer',
    'researcher',
    'analyst',
    'designer',
    'ops',
    'intern',
]

const SKINS = ['#f2c8a0', '#d9a066', '#a56b43', '#6f4527', '#f7dcc0', '#8d5524']
const HAIRS = ['#2b1b0e', '#7b3f00', '#d4a017', '#1f2937', '#9ca3af', '#7f1d1d']

export function appearanceFor(role: AgentRole, seed: number) {
    const def = ROLES[role]
    return {
        seed,
        skin: SKINS[seed % SKINS.length],
        hair: HAIRS[(seed >> 3) % HAIRS.length],
        outfit: def.palette.outfit,
        accent: def.palette.accent,
    }
}

const COMPANY_PALETTES = [
    '#8b5cf6',
    '#0ea5e9',
    '#10b981',
    '#f59e0b',
    '#ef4444',
    '#ec4899',
    '#14b8a6',
    '#6366f1',
]

export function companyPalette(index: number): string {
    return COMPANY_PALETTES[index % COMPANY_PALETTES.length]
}
