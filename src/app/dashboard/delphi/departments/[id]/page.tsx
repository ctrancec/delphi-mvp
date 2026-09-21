import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, Wallet, Clock, ShieldCheck } from 'lucide-react'
import { formatUsd } from '@/lib/llm/cost'
import { HiringPanel, type HiredAgent } from '@/components/delphi/hiring-panel'

export const dynamic = 'force-dynamic'

export default async function DepartmentPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const supabase = await createClient()
    if (!supabase) notFound()

    const { data: dept } = await supabase
        .from('delphi_departments')
        .select('*')
        .eq('id', id)
        .maybeSingle()

    if (!dept) notFound()

    // The proposed team, joined to the tasks that define the handoff chain.
    const [{ data: hires }, { data: project }] = await Promise.all([
        supabase
            .from('delphi_hires')
            .select('*, agent:delphi_agents(id, name, title, slug, skills, cost_tier, origin, is_board)')
            .eq('department_id', id)
            .order('seq'),
        supabase
            .from('delphi_projects')
            .select('id, status, title, spent_usd')
            .eq('department_id', id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
    ])

    const { data: tasks } = project
        ? await supabase.from('delphi_tasks').select('*').eq('project_id', project.id).order('seq')
        : { data: [] }

    // Pair each hire with its task; they share `seq` by construction.
    const team: HiredAgent[] = (hires ?? []).map((h) => {
        const agent = h.agent as unknown as {
            id: string
            name: string
            title: string
            skills: string[]
            cost_tier: number
            origin: string
        }
        const task = (tasks ?? []).find((t) => t.seq === h.seq)
        return {
            seq: h.seq,
            score: Number(h.score),
            rationale: h.rationale,
            name: agent?.name ?? 'Unknown',
            title: agent?.title ?? '',
            skills: agent?.skills ?? [],
            costTier: agent?.cost_tier ?? 1,
            isNewHire: agent?.origin === 'invented',
            taskTitle: task?.title ?? '',
            objective: task?.objective ?? '',
            status: task?.status ?? 'pending',
        }
    })

    const approved = project?.status === 'running' || project?.status === 'done'

    return (
        <div className="space-y-6 max-w-4xl">
            <Link
                href="/dashboard/delphi"
                className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-white"
            >
                <ArrowLeft className="h-4 w-4" /> Delphi
            </Link>

            <div className="flex items-start justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">{dept.name}</h1>
                    <p className="text-sm text-muted-foreground mt-2 max-w-2xl">{dept.charter}</p>
                </div>
                <Badge variant="outline" className="shrink-0">
                    {String(dept.status).replace('_', ' ')}
                </Badge>
            </div>

            <div className="flex flex-wrap gap-4 text-sm">
                <span className="inline-flex items-center gap-2 text-muted-foreground">
                    <Wallet className="h-4 w-4" />
                    {formatUsd(Number(project?.spent_usd ?? dept.spent_usd ?? 0))} of{' '}
                    {formatUsd(Number(dept.budget_usd))}
                </span>
                {dept.cadence_cron && (
                    <span className="inline-flex items-center gap-2 text-muted-foreground">
                        <Clock className="h-4 w-4" />
                        <code className="font-mono text-xs">{dept.cadence_cron}</code>
                    </span>
                )}
                <span className="inline-flex items-center gap-2 text-muted-foreground">
                    <ShieldCheck className="h-4 w-4" />
                    L.L.R. board reviews before anything reaches you
                </span>
            </div>

            <HiringPanel departmentId={id} team={team} status={dept.status} approved={approved} />

            {team.length > 0 && (
                <Card className="bg-black/20 border-white/5">
                    <CardHeader className="pb-3">
                        <CardTitle className="text-sm">How the work flows</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                            {team.map((m, i) => (
                                <span key={m.seq} className="flex items-center gap-2">
                                    <span className="px-2.5 py-1 rounded-md bg-white/5 border border-white/10">
                                        {m.name}
                                    </span>
                                    {i < team.length - 1 && <span className="text-muted-foreground">→</span>}
                                </span>
                            ))}
                        </div>
                        <p className="text-xs text-muted-foreground mt-3">
                            Each agent consumes the previous one&rsquo;s output. One task, one job, handed on.
                        </p>
                    </CardContent>
                </Card>
            )}
        </div>
    )
}
