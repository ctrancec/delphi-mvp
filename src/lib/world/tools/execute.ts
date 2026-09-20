/**
 * Applies a tool call to the world and returns the string the agent sees back.
 *
 * Tool results are written for the model: short, concrete, and explicit about
 * failure so the agent can correct rather than repeat itself.
 */

import { id } from './../ids'
import {
    agentById,
    assignTask,
    companyById,
    createCompany,
    createTask,
    deliverMessage,
    hireAgent,
    logEvent,
    pushChat,
    requestConnection,
    setBubble,
    updateTask,
    walkTo,
    CEO_CHANNEL,
} from '../actions'
import { formatMemories, recall, remember } from '../memory'
import { getStorageProvider } from '../storage'
import { Agent, AgentRole, FileRef, TaskStatus, WorldState } from '../types'

const MAX_FILE_CHARS = 12_000

function str(input: Record<string, unknown>, key: string): string | undefined {
    const v = input[key]
    return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

export async function executeTool(
    state: WorldState,
    agent: Agent,
    name: string,
    rawInput: unknown
): Promise<string> {
    const input = (rawInput ?? {}) as Record<string, unknown>
    agent.stats.toolCalls += 1
    agent.lastActiveAt = Date.now()

    switch (name) {
        case 'speak': {
            const text = str(input, 'text')
            if (!text) return 'Nothing to say — `text` was empty.'
            setBubble(agent, text)
            agent.status = agent.status === 'walking' ? 'walking' : 'talking'
            logEvent(state, {
                type: 'agent.spoke',
                actorId: agent.id,
                companyId: agent.companyId,
                text: `${agent.name}: ${text}`,
            })
            return 'Said.'
        }

        case 'go_to': {
            const destination = str(input, 'destination')
            if (!destination) return '`destination` is required.'
            return walkTo(state, agent, destination)
        }

        case 'create_company': {
            const name_ = str(input, 'name')
            const mission = str(input, 'mission')
            if (!name_ || !mission) return '`name` and `mission` are both required.'

            const result = createCompany(state, { name: name_, mission, createdBy: agent.id })
            if ('error' in result) return result.error
            setBubble(agent, `Standing up ${result.company.name}.`)
            return `Created company "${result.company.name}" (id: ${result.company.id}) with its own floor. Hire into it with that id.`
        }

        case 'hire': {
            const companyId = str(input, 'company_id')
            const role = str(input, 'role') as AgentRole | undefined
            const hireName = str(input, 'name')
            if (!companyId || !role || !hireName) return '`company_id`, `role` and `name` are required.'

            const result = hireAgent(state, {
                companyId,
                role,
                name: hireName,
                title: str(input, 'title'),
                charter: str(input, 'charter'),
                managerId: agent.id,
            })
            if ('error' in result) return result.error
            setBubble(agent, `Welcome aboard, ${result.agent.name}.`)
            return `Hired ${result.agent.name} as ${result.agent.title} (agent id: ${result.agent.id}). They are walking to their desk now — assign them work with create_task or assign_task.`
        }

        case 'create_task': {
            const title = str(input, 'title')
            const brief = str(input, 'brief')
            if (!title || !brief) return '`title` and `brief` are required.'

            const result = createTask(state, {
                companyId: str(input, 'company_id') ?? agent.companyId,
                title,
                brief,
                creatorId: agent.id,
                assigneeId: str(input, 'assignee_id') ?? null,
                priority: (str(input, 'priority') as never) ?? 'normal',
            })
            if ('error' in result) return result.error
            return `Task created (id: ${result.task.id}, status: ${result.task.status}).`
        }

        case 'assign_task': {
            const taskId = str(input, 'task_id')
            const assigneeId = str(input, 'assignee_id')
            if (!taskId || !assigneeId) return '`task_id` and `assignee_id` are required.'
            return assignTask(state, taskId, assigneeId, agent.id)
        }

        case 'update_task': {
            const taskId = str(input, 'task_id')
            const status = str(input, 'status') as TaskStatus | undefined
            if (!taskId || !status) return '`task_id` and `status` are required.'
            return updateTask(state, {
                taskId,
                status,
                actorId: agent.id,
                note: str(input, 'note'),
                result: str(input, 'result'),
                reason: str(input, 'reason'),
            })
        }

        case 'message_agent': {
            const agentId = str(input, 'agent_id')
            const text = str(input, 'text')
            if (!agentId || !text) return '`agent_id` and `text` are required.'
            return deliverMessage(state, agent, agentId, text)
        }

        case 'remember': {
            const content = str(input, 'content')
            const scope = (str(input, 'scope') ?? 'agent') as 'agent' | 'company' | 'world'
            if (!content) return '`content` is required.'
            if (scope === 'company' && !agent.companyId) {
                return 'You are not attached to a company — use scope "world" or "agent".'
            }
            const ownerId = scope === 'agent' ? agent.id : scope === 'company' ? agent.companyId! : 'world'
            const entry = remember(state, {
                scope,
                ownerId,
                kind: 'fact',
                content,
                importance: Number(input.importance) || 3,
            })
            return `Remembered (${entry.scope}, importance ${entry.importance}).`
        }

        case 'recall': {
            const query = str(input, 'query')
            if (!query) return '`query` is required.'
            const hits = recall(state, query, { agentId: agent.id, companyId: agent.companyId, limit: 8 })
            return formatMemories(hits)
        }

        case 'request_connection': {
            const provider = str(input, 'provider')
            const label = str(input, 'label')
            const reason = str(input, 'reason')
            if (!provider || !label || !reason) return '`provider`, `label` and `reason` are required.'

            const { connection } = requestConnection(state, {
                companyId: str(input, 'company_id') ?? agent.companyId,
                provider,
                label,
                reason,
                fields: Array.isArray(input.fields) ? (input.fields as string[]) : undefined,
                requestedBy: agent.id,
            })
            // The human is the only one who can act on this, so surface it.
            pushChat(state, {
                channel: CEO_CHANNEL,
                role: 'system',
                authorId: agent.id,
                content: `🔌 ${agent.name} needs a connection: **${connection.label}** (${connection.provider}). ${connection.reason}\nRequired: ${connection.fields.join(', ')}`,
            })
            return `Connection request raised with the CHO (id: ${connection.id}). It is not usable until they connect it — plan around that.`
        }

        case 'list_files': {
            const companyId = str(input, 'company_id') ?? agent.companyId
            const files = state.files.filter((f) => f.companyId === companyId)
            if (files.length === 0) return 'No files in this drive yet.'
            return files
                .map((f) => `- ${f.name} (id: ${f.id}, ${f.mime}, ${Math.round(f.size / 102.4) / 10}KB)${f.summary ? ` — ${f.summary}` : ''}`)
                .join('\n')
        }

        case 'read_file': {
            const fileId = str(input, 'file_id')
            if (!fileId) return '`file_id` is required.'
            const ref = state.files.find((f) => f.id === fileId)
            if (!ref) return `No file with id ${fileId}.`

            try {
                const provider = getStorageProvider(ref.provider)
                const blob = await provider.get(ref.key)
                if (!blob) return `Could not read ${ref.name} from ${provider.label}.`
                const text = blob.data.toString('utf-8')
                return text.length > MAX_FILE_CHARS
                    ? `${text.slice(0, MAX_FILE_CHARS)}\n\n[truncated — file is ${text.length} characters]`
                    : text
            } catch (err) {
                return `Read failed: ${(err as Error).message}`
            }
        }

        case 'write_file': {
            const fileName = str(input, 'name')
            const content = str(input, 'content')
            if (!fileName || content === undefined) return '`name` and `content` are required.'

            const companyId = str(input, 'company_id') ?? agent.companyId
            try {
                const provider = getStorageProvider(state.settings.storageProvider)
                const data = Buffer.from(content, 'utf-8')
                const stored = await provider.put({
                    companyId,
                    name: fileName,
                    mime: guessMime(fileName),
                    data,
                })
                const ref: FileRef = {
                    id: id('file'),
                    companyId,
                    name: fileName,
                    mime: guessMime(fileName),
                    size: data.byteLength,
                    provider: provider.id,
                    key: stored.key,
                    url: stored.url,
                    uploadedBy: agent.id,
                    createdAt: Date.now(),
                    summary: content.slice(0, 160).replace(/\s+/g, ' '),
                }
                state.files.push(ref)
                logEvent(state, {
                    type: 'file.uploaded',
                    actorId: agent.id,
                    companyId,
                    text: `${agent.name} saved ${fileName} to the ${provider.label} drive.`,
                    meta: { fileId: ref.id },
                })
                return `Saved ${fileName} to ${provider.label} (file id: ${ref.id}).`
            } catch (err) {
                return `Write failed: ${(err as Error).message}`
            }
        }

        case 'report_to_cho': {
            const text = str(input, 'text')
            if (!text) return '`text` is required.'
            if (agent.role !== 'ceo') return 'Only the CEO reports to the CHO. Message the CEO instead.'
            pushChat(state, { channel: CEO_CHANNEL, role: 'agent', authorId: agent.id, content: text })
            return 'Posted to the CHO chat.'
        }

        default:
            return `Unknown tool "${name}".`
    }
}

function guessMime(name: string): string {
    const ext = name.split('.').pop()?.toLowerCase() ?? ''
    const map: Record<string, string> = {
        md: 'text/markdown',
        txt: 'text/plain',
        json: 'application/json',
        csv: 'text/csv',
        ts: 'text/typescript',
        tsx: 'text/typescript',
        js: 'text/javascript',
        py: 'text/x-python',
        sql: 'application/sql',
        html: 'text/html',
        css: 'text/css',
        yml: 'application/yaml',
        yaml: 'application/yaml',
    }
    return map[ext] ?? 'text/plain'
}

export { companyById, agentById }
