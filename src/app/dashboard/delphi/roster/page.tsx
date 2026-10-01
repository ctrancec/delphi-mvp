import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ShieldCheck, UserPlus } from 'lucide-react'
import { formatUsd } from '@/lib/llm/cost'
import { toneFor } from '@/components/delphi/grade-badge'
import { AgentSprite } from '@/components/pixel/agent-sprite'
import { bootstrapDelphi } from '@/lib/delphi/bootstrap'
import { DELPHI_SLUG } from '@/lib/delphi/db'

import { APP_NAME, CEO_NAME } from '@/lib/pixel/cast/names'
export const dynamic = 'force-dynamic'

const TIER_LABEL: Record<number, string> = { 1: '$', 2: '$$', 3: '$$$' }

interface AgentRow {
    id: string
    slug: string
    name: string
    title: string
    avatar_seed: string | null
    skills: string[]
    cost_tier: number
    origin: string
    is_board: boolean
}

interface StatsRow {
    agent_id: string
    hires: number
    tasks_completed: number
    tasks_failed: number
    total_cost_usd: number
    avg_quality: number | null
}

interface HireRow {
    agent_id: string
    department: { name: string; status: string } | { name: string; status: string }[] | null
}

function AgentCard({ agent, stats, hiredIn }: { agent: AgentRow; stats?: StatsRow; hiredIn: string[] }) {
    const done = stats?.tasks_completed ?? 0
    const failed = stats?.tasks_failed ?? 0
    const total = done + failed
    const quality = stats?.avg_quality
    const hired = hiredIn.length > 0

    return (
        <Card className="bg-black/40 border-white/10">
            <CardHeader className="pb-3">
                <div className="flex items-start gap-3">
                    {/* The character stands in for a headshot; board members always have a seat, so they idle rather than wait. */}
                    <AgentSprite
                        agent={{ slug: agent.slug, name: agent.name, avatarSeed: agent.avatar_seed }}
                        state={hired || agent.is_board ? 'idle' : 'available'}
                        scale={3}
                        className="shrink-0 -mt-1"
                    />
                    <div className="min-w-0 flex-1">
                        <CardTitle className="text-base leading-tight truncate">{agent.name}</CardTitle>
                        <p className="text-xs text-muted-foreground mt-0.5">{agent.title}</p>
                        <p className="text-xs mt-1.5 text-muted-foreground">
                            {agent.is_board ? (
                                'On every department’s board.'
                            ) : hired ? (
                                <>
                                    Hired in <span className="text-zinc-300">{hiredIn.join(', ')}</span>
                                </>
                            ) : (
                                'Available to hire.'
                            )}
                        </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                        {agent.origin === 'invented' && (
                            <Badge variant="outline" className="text-amber-400 border-amber-400/30 gap-1 text-[10px]">
                                <UserPlus className="h-2.5 w-2.5" /> invented
                            </Badge>
                        )}
                        <span className="text-xs text-muted-foreground font-mono" title={`Cost tier ${agent.cost_tier}`}>
                            {TIER_LABEL[agent.cost_tier] ?? '$'}
                        </span>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-1">
                    {agent.skills.slice(0, 5).map((s) => (
                        <span
                            key={s}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-muted-foreground"
                        >
                            {s}
                        </span>
                    ))}
                </div>

                {/* An agent with no history is unproven, not bad — say so rather than showing zeroes. */}
                {total === 0 ? (
                    <p className="text-xs text-muted-foreground">No track record yet — unproven.</p>
                ) : (
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span className="text-emerald-400">{done} done</span>
                        {failed > 0 && <span className="text-red-400">{failed} failed</span>}
                        {quality !== null && quality !== undefined && (
                            <span
                                className={toneFor(Number(quality)).split(' ')[0]}
                                title={`${CEO_NAME}'s average grade over this agent's last 20 tasks. Feeds the hiring rank directly.`}
                            >
                                {(Number(quality) * 100).toFixed(0)}% graded
                            </span>
                        )}
                        <span>{formatUsd(Number(stats?.total_cost_usd ?? 0))}</span>
                    </div>
                )}
            </CardContent>
        </Card>
    )
}

/** The departments each agent is hired into, by agent id, archived ones left out. */
function hiredDepartments(hires: HireRow[]): Map<string, string[]> {
    const out = new Map<string, string[]>()
    for (const h of hires) {
        const dept = Array.isArray(h.department) ? h.department[0] : h.department
        if (!dept || dept.status === 'archived') continue
        const list = out.get(h.agent_id) ?? []
        if (!list.includes(dept.name)) list.push(dept.name)
        out.set(h.agent_id, list)
    }
    return out
}

export default async function RosterPage() {
    const supabase = await createClient()
    if (!supabase) {
        return <p className="text-muted-foreground">Supabase is not configured.</p>
    }

    await bootstrapDelphi(supabase)

    const [{ data: agents }, { data: stats }, { data: hires }] = await Promise.all([
        supabase.from('delphi_agents').select('*').is('archived_at', null).order('slug'),
        supabase.from('delphi_agent_stats').select('*'),
        supabase.from('delphi_hires').select('agent_id, department:delphi_departments(name, status)'),
    ])

    const statsById = new Map((stats ?? []).map((s) => [s.agent_id as string, s as StatsRow]))
    const hiredIn = hiredDepartments((hires ?? []) as unknown as HireRow[])
    const all = (agents ?? []) as unknown as AgentRow[]
    // The CEO has a row of its own so it can speak and act, but it is not for
    // hire, so it heads the page rather than standing among the specialists.
    const ceo = all.find((a) => a.slug === DELPHI_SLUG)
    const workers = all.filter((a) => !a.is_board && a.slug !== DELPHI_SLUG)
    const board = all.filter((a) => a.is_board)

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold tracking-tight">Roster</h1>
                <p className="text-sm text-muted-foreground mt-1">
                    Who {CEO_NAME} can hire. Track records feed the hiring score, so performance compounds.
                </p>
            </div>

            {all.length === 0 ? (
                <Card className="bg-black/40 border-white/10 border-dashed">
                    <CardContent className="py-12 text-center text-sm text-muted-foreground">
                        The roster could not be provisioned. Open {APP_NAME} and it will try again.
                    </CardContent>
                </Card>
            ) : (
                <>
                    {ceo && (
                        <Card className="bg-black/40 border-white/10">
                            <CardContent className="flex items-center gap-4 py-4">
                                <AgentSprite
                                    agent={{ slug: ceo.slug, name: ceo.name, avatarSeed: ceo.avatar_seed }}
                                    state="idle"
                                    scale={4}
                                    className="shrink-0"
                                />
                                <div className="min-w-0">
                                    <p className="text-base font-semibold leading-tight">{ceo.name}</p>
                                    <p className="text-xs text-muted-foreground mt-0.5">{ceo.title}</p>
                                    <p className="text-xs text-muted-foreground mt-1.5">
                                        Staffs every department and reports to you. Never approves anything.
                                    </p>
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    <section className="space-y-3">
                        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                            Specialists ({workers.length})
                        </h2>
                        <div className="grid grid-cols-1 gap-3 inner:grid-cols-2 desk:grid-cols-3">
                            {workers.map((a) => (
                                <AgentCard key={a.id} agent={a} stats={statsById.get(a.id)} hiredIn={hiredIn.get(a.id) ?? []} />
                            ))}
                        </div>
                    </section>

                    {board.length > 0 && (
                        <section className="space-y-3">
                            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
                                <ShieldCheck className="h-4 w-4" /> L.L.R. Board ({board.length})
                            </h2>
                            <p className="text-xs text-muted-foreground -mt-1">
                                Attached to every department. They review and advise; only you approve.
                            </p>
                            <div className="grid grid-cols-1 gap-3 inner:grid-cols-2 desk:grid-cols-3">
                                {board.map((a) => (
                                    <AgentCard key={a.id} agent={a} stats={statsById.get(a.id)} hiredIn={hiredIn.get(a.id) ?? []} />
                                ))}
                            </div>
                        </section>
                    )}
                </>
            )}
        </div>
    )
}
