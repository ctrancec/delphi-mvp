"use client"

import React, { useEffect, useState } from 'react'
import { Plug, Check, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Connection, WorldState } from '@/lib/world/types'
import type { CatalogEntry } from '@/lib/world/connections'

interface Props {
    state: WorldState
    companyId: string | null
    onAdd: (provider: string) => void
    onConnect: (connectionId: string, secretRef: string, config: Record<string, string>) => void
    onRemove: (connectionId: string) => void
}

/**
 * Secrets never travel through here. The CHO tells the world *which env var*
 * holds a credential; the value itself stays in the deployment environment.
 */
export function ConnectionsPanel({ state, companyId, onAdd, onConnect, onRemove }: Props) {
    const [catalog, setCatalog] = useState<CatalogEntry[]>([])
    const [adding, setAdding] = useState(false)

    useEffect(() => {
        fetch('/api/world/connections')
            .then((r) => r.json())
            .then((j) => setCatalog(j.catalog ?? []))
            .catch(() => setCatalog([]))
    }, [])

    const conns = state.connections.filter((c) => c.companyId === companyId)

    return (
        <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Connections
                </p>
                <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setAdding((v) => !v)}>
                    <Plug className="mr-1 h-3.5 w-3.5" /> Add
                </Button>
            </div>

            {adding && (
                <div className="grid grid-cols-2 gap-1 border-b border-border bg-secondary/40 p-2">
                    {catalog.map((entry) => (
                        <button
                            key={entry.provider}
                            onClick={() => {
                                onAdd(entry.provider)
                                setAdding(false)
                            }}
                            className="rounded border border-border px-2 py-1 text-left text-[11px] hover:bg-secondary"
                        >
                            {entry.label}
                        </button>
                    ))}
                </div>
            )}

            <div className="flex-1 space-y-2 overflow-y-auto p-3">
                {conns.length === 0 && (
                    <p className="py-6 text-center text-xs text-muted-foreground">
                        This project has nothing wired up yet. Agents will ask when they need something.
                    </p>
                )}
                {conns.map((conn) => (
                    <ConnectionRow key={conn.id} conn={conn} onConnect={onConnect} onRemove={onRemove} />
                ))}
            </div>
        </div>
    )
}

function ConnectionRow({
    conn,
    onConnect,
    onRemove,
}: {
    conn: Connection
    onConnect: (id: string, secretRef: string, config: Record<string, string>) => void
    onRemove: (id: string) => void
}) {
    const [open, setOpen] = useState(false)
    const [secretRef, setSecretRef] = useState(conn.secretRef ?? conn.fields[0] ?? '')

    const connected = conn.status === 'connected'

    return (
        <div className="rounded-md border border-border bg-secondary/30 p-2">
            <button onClick={() => setOpen((v) => !v)} className="flex w-full items-start gap-2 text-left">
                {connected ? (
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                ) : (
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                )}
                <span className="min-w-0 flex-1">
                    <span className="block text-xs font-medium">{conn.label}</span>
                    <span className="block text-[11px] text-muted-foreground">{conn.reason}</span>
                </span>
                <span className="shrink-0 text-[10px] uppercase text-muted-foreground">{conn.status}</span>
            </button>

            {open && (
                <div className="mt-2 space-y-2 border-t border-border pt-2">
                    {conn.fields.length > 0 && (
                        <>
                            <p className="text-[11px] text-muted-foreground">
                                Set these in your environment, then record which one holds the credential:
                            </p>
                            <code className="block rounded bg-background px-2 py-1 text-[11px]">
                                {conn.fields.join('\n')}
                            </code>
                            <Input
                                value={secretRef}
                                onChange={(e) => setSecretRef(e.target.value)}
                                placeholder="Env var name (no secrets here)"
                                className="h-7 text-xs"
                            />
                        </>
                    )}
                    <div className="flex gap-2">
                        {!connected && (
                            <Button
                                size="sm"
                                className="h-7 flex-1 text-xs"
                                onClick={() => onConnect(conn.id, secretRef, {})}
                            >
                                Mark connected
                            </Button>
                        )}
                        <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs"
                            onClick={() => onRemove(conn.id)}
                        >
                            Remove
                        </Button>
                    </div>
                </div>
            )}
        </div>
    )
}
