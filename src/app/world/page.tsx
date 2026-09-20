"use client"

import React, { useMemo, useState } from 'react'
import Link from 'next/link'
import { Pause, Play, RotateCcw, ZoomIn, ZoomOut, AlertTriangle, Building2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useWorld } from '@/lib/world/client'
import { WorldCanvas } from '@/components/world/world-canvas'
import { CeoChat } from '@/components/world/ceo-chat'
import { OrgPanel } from '@/components/world/org-panel'
import { TaskBoard } from '@/components/world/task-board'
import { ConnectionsPanel } from '@/components/world/connections-panel'
import { FilesPanel } from '@/components/world/files-panel'
import { ActivityLog } from '@/components/world/activity-log'

type SidePanel = 'team' | 'tasks' | 'connections' | 'drive'

export default function WorldPage() {
    const world = useWorld()
    const { state, pulse, live, storage, error, thinking } = world

    const [companyId, setCompanyId] = useState<string | null>(null)
    const [selectedAgent, setSelectedAgent] = useState<string | null>(null)
    const [panel, setPanel] = useState<SidePanel>('team')
    const [zoom, setZoom] = useState(1)

    const floor = useMemo(() => {
        if (!state) return null
        return state.floors.find((f) => f.companyId === companyId) ?? state.floors[0] ?? null
    }, [state, companyId])

    const agentsHere = useMemo(() => {
        if (!state || !floor) return []
        return state.agents.filter((a) => a.floorId === floor.id)
    }, [state, floor])

    if (!state || !floor) {
        return (
            <div className="flex h-screen items-center justify-center bg-background text-sm text-muted-foreground">
                {error ? `Could not load the world: ${error}` : 'Opening the office…'}
            </div>
        )
    }

    const company = state.companies.find((c) => c.id === companyId) ?? null

    return (
        <div className="flex h-screen flex-col bg-background text-foreground">
            {/* Header */}
            <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2">
                <Link href="/" className="text-sm font-semibold tracking-tight">
                    Delphi <span className="text-primary">World</span>
                </Link>

                <Badge variant={live ? 'default' : 'outline'} className="text-[10px]">
                    {live ? 'LIVE — agents are thinking' : 'SIMULATED — set ANTHROPIC_API_KEY'}
                </Badge>

                {pulse && (
                    <p className="hidden text-xs text-muted-foreground sm:block">
                        {state.agents.length} agents · {pulse.busy} busy · {pulse.openTasks} open ·{' '}
                        {pulse.doneTasks} done · tick {state.tick}
                    </p>
                )}

                <div className="ml-auto flex items-center gap-1">
                    <span className="mr-2 text-[11px] text-muted-foreground">
                        {state.settings.turnsUsedToday}/{state.settings.dailyTurnBudget} turns today
                    </span>
                    <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
                    >
                        <ZoomOut className="h-4 w-4" />
                    </Button>
                    <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        onClick={() => setZoom((z) => Math.min(2.5, z + 0.25))}
                    >
                        <ZoomIn className="h-4 w-4" />
                    </Button>
                    <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        onClick={() => world.control({ action: state.settings.paused ? 'resume' : 'pause' })}
                    >
                        {state.settings.paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                    </Button>
                    <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        title="Reset the world"
                        onClick={() => {
                            if (confirm('Reset the world? Every company, agent and memory is deleted.')) {
                                world.control({ action: 'reset' })
                                setCompanyId(null)
                                setSelectedAgent(null)
                            }
                        }}
                    >
                        <RotateCcw className="h-4 w-4" />
                    </Button>
                </div>
            </header>

            {error && (
                <div className="flex items-center gap-2 border-b border-red-500/30 bg-red-500/10 px-4 py-1.5 text-xs text-red-200">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {error}
                    <button className="ml-auto opacity-70 hover:opacity-100" onClick={world.clearError}>
                        dismiss
                    </button>
                </div>
            )}

            <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[340px_minmax(0,1fr)_320px]">
                {/* Left: the CEO and the log */}
                <aside className="flex min-h-0 flex-col border-b border-border lg:border-b-0 lg:border-r">
                    <div className="min-h-0 flex-1">
                        <CeoChat state={state} thinking={thinking} onSend={world.sendToCeo} />
                    </div>
                    <div className="h-52 shrink-0 border-t border-border">
                        <ActivityLog state={state} companyId={companyId} />
                    </div>
                </aside>

                {/* Centre: the office */}
                <main className="flex min-h-0 flex-col">
                    <div className="flex items-center gap-1 overflow-x-auto border-b border-border px-3 py-2">
                        <FloorTab
                            active={companyId === null}
                            label="Headquarters"
                            onClick={() => setCompanyId(null)}
                        />
                        {state.companies.map((c) => (
                            <FloorTab
                                key={c.id}
                                active={companyId === c.id}
                                label={c.name}
                                color={c.palette}
                                onClick={() => setCompanyId(c.id)}
                            />
                        ))}
                        {state.companies.length === 0 && (
                            <span className="ml-2 text-[11px] text-muted-foreground">
                                Ask the CEO for a project and a new floor appears here.
                            </span>
                        )}
                    </div>

                    {company && (
                        <div className="border-b border-border px-4 py-2">
                            <p className="flex items-center gap-2 text-sm font-medium">
                                <Building2 className="h-3.5 w-3.5" style={{ color: company.palette }} />
                                {company.name}
                            </p>
                            <p className="text-xs text-muted-foreground">{company.mission}</p>
                        </div>
                    )}

                    <div className="min-h-0 flex-1 overflow-auto bg-[#0a0a0c] p-4">
                        <WorldCanvas
                            floor={floor}
                            agents={agentsHere}
                            selectedId={selectedAgent}
                            onSelect={setSelectedAgent}
                            zoom={zoom}
                        />
                    </div>
                </main>

                {/* Right: the org */}
                <aside className="flex min-h-0 flex-col border-t border-border lg:border-l lg:border-t-0">
                    <div className="grid shrink-0 grid-cols-4 border-b border-border">
                        {(['team', 'tasks', 'connections', 'drive'] as SidePanel[]).map((key) => (
                            <button
                                key={key}
                                onClick={() => setPanel(key)}
                                className={`py-2 text-[11px] capitalize transition ${
                                    panel === key
                                        ? 'border-b-2 border-primary text-foreground'
                                        : 'text-muted-foreground hover:text-foreground'
                                }`}
                            >
                                {key}
                            </button>
                        ))}
                    </div>

                    <div className="min-h-0 flex-1">
                        {panel === 'team' && (
                            <OrgPanel
                                state={state}
                                companyId={companyId}
                                selectedId={selectedAgent}
                                onSelect={setSelectedAgent}
                                onHire={(input) => world.control({ action: 'hire', ...input })}
                                onFire={(agentId) => {
                                    world.control({ action: 'fire', agentId })
                                    setSelectedAgent(null)
                                }}
                            />
                        )}
                        {panel === 'tasks' && (
                            <TaskBoard
                                state={state}
                                companyId={companyId}
                                onCreate={(input) => world.control({ action: 'create_task', ...input })}
                            />
                        )}
                        {panel === 'connections' && (
                            <ConnectionsPanel
                                state={state}
                                companyId={companyId}
                                onAdd={(provider) => world.connections({ action: 'add', provider, companyId })}
                                onConnect={(connectionId, secretRef, config) =>
                                    world.connections({ action: 'connect', connectionId, secretRef, config })
                                }
                                onRemove={(connectionId) =>
                                    world.connections({ action: 'remove', connectionId })
                                }
                            />
                        )}
                        {panel === 'drive' && (
                            <FilesPanel
                                state={state}
                                companyId={companyId}
                                storage={storage}
                                onUpload={(file) => world.upload(file, companyId)}
                            />
                        )}
                    </div>
                </aside>
            </div>
        </div>
    )
}

function FloorTab({
    active,
    label,
    color,
    onClick,
}: {
    active: boolean
    label: string
    color?: string
    onClick: () => void
}) {
    return (
        <button
            onClick={onClick}
            className={`flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs transition ${
                active ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/50'
            }`}
        >
            <span
                className="h-2 w-2 rounded-sm"
                style={{ background: color ?? '#8b5cf6' }}
            />
            {label}
        </button>
    )
}
