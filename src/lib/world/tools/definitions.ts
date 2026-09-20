/**
 * The verbs an agent can use. These are custom (client-executed) tools — the
 * runtime applies each call to the world document and hands back the result.
 *
 * Which tools an agent actually gets depends on its role: only the CEO can
 * create companies, only the CEO and managers can hire.
 */

import { HIREABLE_ROLES } from '../roles'
import { Agent } from '../types'
import { ROLES } from '../roles'

export interface ToolSchema {
    name: string
    description: string
    input_schema: {
        type: 'object'
        properties: Record<string, unknown>
        required: string[]
        additionalProperties: false
    }
}

const speak: ToolSchema = {
    name: 'speak',
    description:
        'Say something out loud in the office. Shows as a speech bubble above your head and goes into the activity log. Keep it under 120 characters — it is a bubble, not a report.',
    input_schema: {
        type: 'object',
        properties: { text: { type: 'string', description: 'What you say out loud.' } },
        required: ['text'],
        additionalProperties: false,
    },
}

const goTo: ToolSchema = {
    name: 'go_to',
    description:
        'Walk somewhere on your floor. Use "desk" to sit down and work, "whiteboard" to plan, "server" to check systems, "coffee" for a break, or an agent id to go talk to that person.',
    input_schema: {
        type: 'object',
        properties: {
            destination: {
                type: 'string',
                description: 'One of: desk, whiteboard, server, coffee, door — or an agent id.',
            },
        },
        required: ['destination'],
        additionalProperties: false,
    },
}

const createCompany: ToolSchema = {
    name: 'create_company',
    description:
        'Stand up a new company for a project the CHO has asked for. This creates a dedicated office floor and a task board. One company per distinct project — do not create a second company for work that belongs to an existing one.',
    input_schema: {
        type: 'object',
        properties: {
            name: { type: 'string', description: 'Short company name, e.g. "Harbour Labs".' },
            mission: {
                type: 'string',
                description: 'What this company exists to deliver, in two or three sentences.',
            },
        },
        required: ['name', 'mission'],
        additionalProperties: false,
    },
}

const hire: ToolSchema = {
    name: 'hire',
    description:
        'Hire a new agent into a company. They get a desk, persistent memory and their own task queue. Hire only when there is work waiting that nobody on the team can take.',
    input_schema: {
        type: 'object',
        properties: {
            company_id: { type: 'string', description: 'Company to hire into.' },
            role: { type: 'string', enum: HIREABLE_ROLES, description: 'Their function.' },
            name: { type: 'string', description: 'A human first name.' },
            title: { type: 'string', description: 'Job title, e.g. "Backend Engineer".' },
            charter: {
                type: 'string',
                description: 'One or two sentences telling them what they own and how to behave.',
            },
        },
        required: ['company_id', 'role', 'name', 'title', 'charter'],
        additionalProperties: false,
    },
}

const createTask: ToolSchema = {
    name: 'create_task',
    description:
        'Put a concrete piece of work on a company task board. A good task is something one agent can finish in one sitting and hand back a result for.',
    input_schema: {
        type: 'object',
        properties: {
            company_id: { type: 'string' },
            title: { type: 'string', description: 'Imperative, specific, under 80 characters.' },
            brief: {
                type: 'string',
                description: 'What done looks like, plus any context the assignee needs.',
            },
            assignee_id: {
                type: 'string',
                description: 'Agent id to assign it to. Omit to leave it in the backlog.',
            },
            priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
        },
        required: ['company_id', 'title', 'brief'],
        additionalProperties: false,
    },
}

const updateTask: ToolSchema = {
    name: 'update_task',
    description:
        'Move a task you own along. Use status "done" with a result when the work is actually finished, "blocked" with a reason when you genuinely cannot proceed.',
    input_schema: {
        type: 'object',
        properties: {
            task_id: { type: 'string' },
            status: {
                type: 'string',
                enum: ['in_progress', 'blocked', 'review', 'done', 'cancelled'],
            },
            note: { type: 'string', description: 'Progress note for the log.' },
            result: { type: 'string', description: 'The deliverable, when status is done or review.' },
            reason: { type: 'string', description: 'Why you are blocked, when status is blocked.' },
        },
        required: ['task_id', 'status'],
        additionalProperties: false,
    },
}

const assignTask: ToolSchema = {
    name: 'assign_task',
    description: 'Hand an existing task to someone (or to yourself).',
    input_schema: {
        type: 'object',
        properties: { task_id: { type: 'string' }, assignee_id: { type: 'string' } },
        required: ['task_id', 'assignee_id'],
        additionalProperties: false,
    },
}

const messageAgent: ToolSchema = {
    name: 'message_agent',
    description:
        'Send a direct message to another agent. They will read it on their next turn. Use it to delegate context, ask a question or unblock someone.',
    input_schema: {
        type: 'object',
        properties: { agent_id: { type: 'string' }, text: { type: 'string' } },
        required: ['agent_id', 'text'],
        additionalProperties: false,
    },
}

const rememberTool: ToolSchema = {
    name: 'remember',
    description:
        'Write something to long-term memory so it survives across sessions. Store decisions, constraints and preferences — not transient chatter.',
    input_schema: {
        type: 'object',
        properties: {
            content: { type: 'string' },
            scope: {
                type: 'string',
                enum: ['agent', 'company', 'world'],
                description: 'agent = only you recall it; company = your project team; world = everyone.',
            },
            importance: { type: 'integer', minimum: 1, maximum: 5 },
        },
        required: ['content', 'scope'],
        additionalProperties: false,
    },
}

const recallTool: ToolSchema = {
    name: 'recall',
    description: 'Search long-term memory for anything relevant to a question.',
    input_schema: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
        additionalProperties: false,
    },
}

const requestConnection: ToolSchema = {
    name: 'request_connection',
    description:
        'Ask the Chief Human Officer to connect an external service this project needs (an API key, a database, an OAuth grant). You cannot connect it yourself — only the human can. Say plainly what it unlocks.',
    input_schema: {
        type: 'object',
        properties: {
            company_id: { type: 'string' },
            provider: {
                type: 'string',
                description: 'Service identifier, e.g. "stripe", "github", "postgres".',
            },
            label: { type: 'string', description: 'Human-readable name for the connection.' },
            reason: { type: 'string', description: 'What becomes possible once it is connected.' },
            fields: {
                type: 'array',
                items: { type: 'string' },
                description: 'Names of the credentials needed, e.g. ["STRIPE_SECRET_KEY"].',
            },
        },
        required: ['company_id', 'provider', 'label', 'reason'],
        additionalProperties: false,
    },
}

const listFiles: ToolSchema = {
    name: 'list_files',
    description: "List files in the company's shared drive, including anything the CHO uploaded.",
    input_schema: {
        type: 'object',
        properties: { company_id: { type: 'string' } },
        required: [],
        additionalProperties: false,
    },
}

const readFile: ToolSchema = {
    name: 'read_file',
    description: 'Read a text file from the shared drive by its id.',
    input_schema: {
        type: 'object',
        properties: { file_id: { type: 'string' } },
        required: ['file_id'],
        additionalProperties: false,
    },
}

const writeFile: ToolSchema = {
    name: 'write_file',
    description:
        'Save a text artifact (a report, a spec, a script) to the shared drive so the CHO and the rest of the team can open it.',
    input_schema: {
        type: 'object',
        properties: {
            company_id: { type: 'string' },
            name: { type: 'string', description: 'Filename including extension.' },
            content: { type: 'string' },
        },
        required: ['name', 'content'],
        additionalProperties: false,
    },
}

const reportToCho: ToolSchema = {
    name: 'report_to_cho',
    description:
        'Post a message into the CHO chat. Only the CEO can do this. Use it for decisions that need a human, finished work worth surfacing, and connection requests.',
    input_schema: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
        additionalProperties: false,
    },
}

const BASE_TOOLS = [
    speak,
    goTo,
    createTask,
    updateTask,
    assignTask,
    messageAgent,
    rememberTool,
    recallTool,
    listFiles,
    readFile,
    writeFile,
    requestConnection,
]

/** The tool surface for one agent, narrowed by role. */
export function toolsForAgent(agent: Agent): ToolSchema[] {
    const def = ROLES[agent.role]
    const tools = [...BASE_TOOLS]
    if (def.canHire) tools.push(hire)
    if (def.canCreateCompany) tools.push(createCompany)
    if (agent.role === 'ceo') tools.push(reportToCho)
    return tools
}

export const ALL_TOOL_NAMES = [
    ...BASE_TOOLS,
    hire,
    createCompany,
    reportToCho,
].map((t) => t.name)
