"use client"

import React, { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Task, WorldState } from '@/lib/world/types'

const COLUMNS: { status: Task['status']; label: string }[] = [
    { status: 'backlog', label: 'Backlog' },
    { status: 'assigned', label: 'Assigned' },
    { status: 'in_progress', label: 'In progress' },
    { status: 'blocked', label: 'Blocked' },
    { status: 'done', label: 'Done' },
]

interface Props {
    state: WorldState
    companyId: string | null
    onCreate: (input: { companyId: string | null; title: string; brief: string }) => void
}

export function TaskBoard({ state, companyId, onCreate }: Props) {
    const [title, setTitle] = useState('')
    const tasks = state.tasks.filter((t) => t.companyId === companyId)

    return (
        <div className="flex h-full flex-col">
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                <Input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && title.trim()) {
                            onCreate({ companyId, title: title.trim(), brief: title.trim() })
                            setTitle('')
                        }
                    }}
                    placeholder="Add a task…"
                    className="h-8 text-sm"
                />
                <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 shrink-0"
                    disabled={!title.trim()}
                    onClick={() => {
                        onCreate({ companyId, title: title.trim(), brief: title.trim() })
                        setTitle('')
                    }}
                >
                    <Plus className="h-4 w-4" />
                </Button>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto p-3">
                {COLUMNS.map((col) => {
                    const items = tasks.filter((t) => t.status === col.status)
                    if (items.length === 0) return null
                    return (
                        <div key={col.status}>
                            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                {col.label} · {items.length}
                            </p>
                            <div className="space-y-1">
                                {items.slice(-12).map((task) => (
                                    <TaskCard key={task.id} task={task} state={state} />
                                ))}
                            </div>
                        </div>
                    )
                })}
                {tasks.length === 0 && (
                    <p className="px-1 py-6 text-center text-xs text-muted-foreground">
                        No work on this board yet.
                    </p>
                )}
            </div>
        </div>
    )
}

function TaskCard({ task, state }: { task: Task; state: WorldState }) {
    const [open, setOpen] = useState(false)
    const assignee = state.agents.find((a) => a.id === task.assigneeId)

    return (
        <button
            onClick={() => setOpen((v) => !v)}
            className="block w-full rounded-md border border-border bg-secondary/40 p-2 text-left transition hover:bg-secondary"
        >
            <div className="flex items-start justify-between gap-2">
                <p className="text-xs leading-snug">{task.title}</p>
                {task.priority !== 'normal' && (
                    <Badge variant="outline" className="shrink-0 text-[10px]">
                        {task.priority}
                    </Badge>
                )}
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
                {assignee ? assignee.name : 'unassigned'}
                {task.turns > 0 ? ` · ${task.turns} turn${task.turns === 1 ? '' : 's'}` : ''}
            </p>
            {open && (
                <div className="mt-2 space-y-1 border-t border-border pt-2 text-[11px] text-muted-foreground">
                    <p className="whitespace-pre-wrap">{task.brief}</p>
                    {task.blockedReason && (
                        <p className="text-red-400">Blocked: {task.blockedReason}</p>
                    )}
                    {task.result && (
                        <div className="rounded bg-background p-2 text-foreground">
                            <p className="mb-1 font-medium">Result</p>
                            <p className="whitespace-pre-wrap">{task.result}</p>
                        </div>
                    )}
                </div>
            )}
        </button>
    )
}
