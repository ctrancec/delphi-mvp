"use client"

import React, { useState } from 'react'
import { UserPlus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { HIREABLE_ROLES, ROLES } from '@/lib/world/roles'
import { Agent, AgentRole, WorldState } from '@/lib/world/types'

interface Props {
    state: WorldState
    companyId: string | null
    selectedId: string | null
    onSelect: (agentId: string | null) => void
    onHire: (input: { companyId: string; role: AgentRole; name: string; title: string }) => void
    onFire: (agentId: string) => void
}

const STATUS_COLOR: Record<string, string> = {
    thinking: 'bg-yellow-400',
    working: 'bg-emerald-400',
    walking: 'bg-sky-400',
    talking: 'bg-pink-400',
    blocked: 'bg-red-500',
    idle: 'bg-zinc-500',
    offline: 'bg-zinc-700',
}

export function OrgPanel({ state, companyId, selectedId, onSelect, onHire, onFire }: Props) {
    const [hiring, setHiring] = useState(false)
    const [name, setName] = useState('')
    const [role, setRole] = useState<AgentRole>('engineer')

    const roster = state.agents.filter((a) =>
        companyId ? a.companyId === companyId : a.companyId === null
    )
    const selected = state.agents.find((a) => a.id === selectedId) ?? null

    return (
        <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Team · {roster.length}
                </p>
                {companyId && (
                    <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setHiring((v) => !v)}>
                        <UserPlus className="mr-1 h-3.5 w-3.5" /> Hire
                    </Button>
                )}
            </div>

            {hiring && companyId && (
                <div className="space-y-2 border-b border-border bg-secondary/40 p-3">
                    <Input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Name"
                        className="h-8 text-sm"
                    />
                    <select
                        value={role}
                        onChange={(e) => setRole(e.target.value as AgentRole)}
                        className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
                    >
                        {HIREABLE_ROLES.map((r) => (
                            <option key={r} value={r}>
                                {ROLES[r].defaultTitle}
                            </option>
                        ))}
                    </select>
                    <Button
                        size="sm"
                        className="w-full"
                        disabled={!name.trim()}
                        onClick={() => {
                            onHire({
                                companyId,
                                role,
                                name: name.trim(),
                                title: ROLES[role].defaultTitle,
                            })
                            setName('')
                            setHiring(false)
                        }}
                    >
                        Add to the floor
                    </Button>
                </div>
            )}

            <div className="flex-1 overflow-y-auto">
                {roster.length === 0 && (
                    <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                        Nobody here yet. Ask your CEO to staff this floor.
                    </p>
                )}
                {roster.map((agent) => (
                    <button
                        key={agent.id}
                        onClick={() => onSelect(agent.id === selectedId ? null : agent.id)}
                        className={`flex w-full items-center gap-2 border-b border-border/50 px-3 py-2 text-left transition hover:bg-secondary/60 ${
                            agent.id === selectedId ? 'bg-secondary' : ''
                        }`}
                    >
                        <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_COLOR[agent.status]}`} />
                        <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm">{agent.name}</span>
                            <span className="block truncate text-[11px] text-muted-foreground">
                                {agent.title}
                            </span>
                        </span>
                        <Badge variant="outline" className="shrink-0 text-[10px]">
                            {agent.status}
                        </Badge>
                    </button>
                ))}
            </div>

            {selected && <AgentDetail state={state} agent={selected} onFire={onFire} />}
        </div>
    )
}

function AgentDetail({
    state,
    agent,
    onFire,
}: {
    state: WorldState
    agent: Agent
    onFire: (agentId: string) => void
}) {
    const task = state.tasks.find((t) => t.id === agent.currentTaskId)
    const manager = state.agents.find((a) => a.id === agent.managerId)
    const memories = state.memories.filter((m) => m.scope === 'agent' && m.ownerId === agent.id)

    return (
        <div className="max-h-[45%] overflow-y-auto border-t border-border bg-secondary/30 p-3 text-xs">
            <div className="mb-2 flex items-start justify-between gap-2">
                <div>
                    <p className="text-sm font-medium">{agent.name}</p>
                    <p className="text-muted-foreground">
                        {agent.title} · {agent.model}
                    </p>
                </div>
                {agent.role !== 'ceo' && (
                    <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => onFire(agent.id)}>
                        <X className="h-3 w-3" />
                    </Button>
                )}
            </div>

            <p className="mb-2 text-muted-foreground">{agent.charter}</p>

            <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
                <dt className="text-muted-foreground">Reports to</dt>
                <dd>{manager ? manager.name : 'the CHO'}</dd>
                <dt className="text-muted-foreground">Tasks done</dt>
                <dd>{agent.stats.tasksCompleted}</dd>
                <dt className="text-muted-foreground">Tool calls</dt>
                <dd>{agent.stats.toolCalls}</dd>
                <dt className="text-muted-foreground">Tokens</dt>
                <dd>
                    {agent.stats.inputTokens.toLocaleString()} in /{' '}
                    {agent.stats.outputTokens.toLocaleString()} out
                </dd>
            </dl>

            {task && (
                <div className="mt-3 rounded-md border border-border bg-background p-2">
                    <p className="font-medium">Now: {task.title}</p>
                    <p className="mt-1 text-muted-foreground">{task.brief}</p>
                </div>
            )}

            {memories.length > 0 && (
                <div className="mt-3">
                    <p className="mb-1 font-medium">Remembers</p>
                    <ul className="space-y-1 text-muted-foreground">
                        {memories.slice(-5).map((m) => (
                            <li key={m.id}>· {m.content}</li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    )
}
