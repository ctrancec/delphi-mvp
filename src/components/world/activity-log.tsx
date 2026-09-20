"use client"

import React, { useEffect, useRef } from 'react'
import { WorldState, WorldEventType } from '@/lib/world/types'

const TONE: Partial<Record<WorldEventType, string>> = {
    'company.created': 'text-violet-300',
    'agent.hired': 'text-emerald-300',
    'task.completed': 'text-emerald-300',
    'task.blocked': 'text-red-300',
    'connection.requested': 'text-amber-300',
    'connection.connected': 'text-emerald-300',
    'system.error': 'text-red-400',
    'file.uploaded': 'text-sky-300',
}

export function ActivityLog({ state, companyId }: { state: WorldState; companyId: string | null }) {
    const scroller = useRef<HTMLDivElement | null>(null)
    const events = state.events.filter((e) => companyId === null || e.companyId === companyId).slice(-80)

    useEffect(() => {
        scroller.current?.scrollTo({ top: scroller.current.scrollHeight })
    }, [events.length])

    return (
        <div className="flex h-full flex-col">
            <div className="border-b border-border px-3 py-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Activity</p>
            </div>
            <div ref={scroller} className="flex-1 space-y-1 overflow-y-auto px-3 py-2 font-mono text-[11px]">
                {events.map((e) => (
                    <p key={e.id} className={TONE[e.type] ?? 'text-muted-foreground'}>
                        <span className="opacity-50">
                            {new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </span>{' '}
                        {e.text}
                    </p>
                ))}
                {events.length === 0 && <p className="text-muted-foreground">Quiet so far.</p>}
            </div>
        </div>
    )
}
