import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, ShieldCheck, UserPlus } from 'lucide-react'
import { formatUsd } from '@/lib/llm/cost'
import { bootstrapDelphi } from '@/lib/delphi/bootstrap'

export const dynamic = 'force-dynamic'

const TIER_LABEL: Record<number, string> = { 1: '$', 2: '$$', 3: '$$$' }

interface AgentRow {
    id: string
    name: string
    title: string
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

function AgentCard({ agent, stats }: { agent: AgentRow; stats?: StatsRow }) {
    const done = stats?.tasks_completed ?? 0
    const failed = stats?.tasks_failed ?? 0
    const total = done + failed
    const quality = stats?.avg_quality

    return (
        <Card className="bg-black/40 border-white/10">
            <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <CardTitle className="text-base leading-tight truncate">{agent.name}</CardTitle>
                        <p className="text-xs text-muted-foreground mt-0.5">{agent.title}</p>
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
                            <span>quality {Number(quality).toFixed(2)}</span>
                        )}
                        <span>{formatUsd(Number(stats?.total_cost_usd ?? 0))}</span>
                    </div>
                )}
            </CardContent>
        </Card>
    )
}

export default async function RosterPage() {
    const supabase = await createClient()
    if (!supabase) {
        return <p className="text-muted-foreground">Supabase is not configured.</p>
    }

    await bootstrapDelphi(supabase)

    const [{ data: agents }, { data: stats }] = await Promise.all([
        supabase.from('delphi_agents').select('*').is('archived_at', null).order('slug'),
        supabase.from('delphi_agent_stats').select('*'),
    ])

    const statsById = new Map((stats ?? []).map((s) => [s.agent_id as string, s as StatsRow]))
    const all = (agents ?? []) as unknown as AgentRow[]
    const workers = all.filter((a) => !a.is_board)
    const board = all.filter((a) => a.is_board)

    return (
        <div className="space-y-6">
            <Link
                href="/dashboard/delphi"
                className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-white"
            >
                <ArrowLeft className="h-4 w-4" /> Delphi
            </Link>

            <div>
                <h1 className="text-2xl font-bold tracking-tight">Roster</h1>
                <p className="text-sm text-muted-foreground mt-1">
                    Who Delphi can hire. Track records feed the hiring score, so performance compounds.
                </p>
            </div>

            {all.length === 0 ? (
                <Card className="bg-black/40 border-white/10 border-dashed">
                    <CardContent className="py-12 text-center text-sm text-muted-foreground">
                        The roster could not be provisioned. Open Delphi and it will try again.
                    </CardContent>
                </Card>
            ) : (
                <>
                    <section className="space-y-3">
                        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                            Specialists ({workers.length})
                        </h2>
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            {workers.map((a) => (
                                <AgentCard key={a.id} agent={a} stats={statsById.get(a.id)} />
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
                            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                {board.map((a) => (
                                    <AgentCard key={a.id} agent={a} stats={statsById.get(a.id)} />
                                ))}
                            </div>
                        </section>
                    )}
                </>
            )}
        </div>
    )
}
