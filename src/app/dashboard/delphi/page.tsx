import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
    Activity,
    AlertTriangle,
    Building2,
    Plus,
    ShieldCheck,
    Users,
    Wallet,
} from 'lucide-react'
import { formatUsd } from '@/lib/llm/cost'
import { ActivityLine, type ActivityEvent } from '@/components/delphi/activity-line'
import { bootstrapDelphi } from '@/lib/delphi/bootstrap'

export const dynamic = 'force-dynamic'

const STATUS_STYLES: Record<string, string> = {
    draft: 'text-muted-foreground border-white/15',
    hiring: 'text-amber-400 border-amber-400/30',
    awaiting_approval: 'text-amber-400 border-amber-400/30',
    active: 'text-emerald-400 border-emerald-400/30',
    paused: 'text-muted-foreground border-white/15',
    archived: 'text-muted-foreground border-white/10',
}

function Empty({ hasRoster }: { hasRoster: boolean }) {
    return (
        <Card className="bg-black/40 border-white/10 border-dashed">
            <CardContent className="py-14 text-center space-y-4">
                <Building2 className="h-10 w-10 mx-auto text-muted-foreground/40" />
                <div className="space-y-1">
                    <h3 className="text-lg font-semibold">No departments yet</h3>
                    <p className="text-sm text-muted-foreground max-w-md mx-auto">
                        Write a charter and Delphi will hire the agents to deliver it. Start with something
                        standing, like a morning brief on global events and market moves.
                    </p>
                </div>
                <Button asChild>
                    <Link href="/dashboard/delphi/departments/new">
                        <Plus className="h-4 w-4 mr-2" /> Create a department
                    </Link>
                </Button>
                {!hasRoster && (
                    <p className="text-xs text-amber-400 flex items-center justify-center gap-2">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        The roster could not be provisioned — Delphi will retry when you create this.
                    </p>
                )}
            </CardContent>
        </Card>
    )
}

export default async function DelphiHqPage() {
    const supabase = await createClient()

    if (!supabase) {
        return (
            <Card className="bg-black/40 border-white/10">
                <CardContent className="py-10 text-center text-muted-foreground">
                    Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and
                    NEXT_PUBLIC_SUPABASE_ANON_KEY.
                </CardContent>
            </Card>
        )
    }

    // First view of a new account: create the workspace, connect the channels
    // and seed the roster. Idempotent, and short-circuits on one query once
    // done, so this is a no-op on every subsequent load.
    await bootstrapDelphi(supabase)

    // RLS scopes all of this to the signed-in CHO's workspaces.
    const [{ data: departments }, { data: agents }, { data: events }, { data: approvals }] =
        await Promise.all([
            supabase.from('delphi_departments').select('*').order('created_at', { ascending: false }),
            supabase.from('delphi_agents').select('id, is_board').is('archived_at', null),
            supabase.from('delphi_events').select('*').order('id', { ascending: false }).limit(12),
            supabase.from('delphi_approvals').select('id').eq('status', 'pending'),
        ])

    const all = departments ?? []
    // Archived departments stay reachable but out of the way — otherwise
    // archiving one changes nothing you can see, which is not archiving.
    const depts = all.filter((d) => d.status !== 'archived')
    const archived = all.filter((d) => d.status === 'archived')
    const workerCount = (agents ?? []).filter((a) => !a.is_board).length
    const boardCount = (agents ?? []).filter((a) => a.is_board).length
    const pendingApprovals = approvals?.length ?? 0
    const totalSpend = depts.reduce((sum, d) => sum + Number(d.spent_usd ?? 0), 0)
    const totalBudget = depts.reduce((sum, d) => sum + Number(d.budget_usd ?? 0), 0)

    return (
        <div className="space-y-6">
            <div className="flex items-start justify-between gap-4">
                <p className="text-sm text-muted-foreground">
                    Your AI CEO. Departments are standing teams; Delphi hires into them and reports to you.
                </p>
                <Button asChild className="shrink-0">
                    <Link href="/dashboard/delphi/departments/new">
                        <Plus className="h-4 w-4 mr-2" /> <span className="hidden inner:inline">New department</span><span className="inner:hidden">New</span>
                    </Link>
                </Button>
            </div>

            <div className="grid grid-cols-2 gap-3 desk:grid-cols-4 desk:gap-4">
                <Stat icon={<Building2 className="h-4 w-4" />} label="Departments" value={String(depts.length)} />
                <Stat
                    icon={<Users className="h-4 w-4" />}
                    label="Roster"
                    value={String(workerCount)}
                    hint={`+ ${boardCount} on the L.L.R. board`}
                />
                <Stat
                    icon={<Wallet className="h-4 w-4" />}
                    label="Spend"
                    value={formatUsd(totalSpend)}
                    hint={totalBudget ? `of ${formatUsd(totalBudget)} budgeted` : undefined}
                />
                <Stat
                    icon={<ShieldCheck className="h-4 w-4" />}
                    label="Awaiting you"
                    value={String(pendingApprovals)}
                    hint={pendingApprovals ? 'approvals pending' : 'nothing blocked'}
                    alert={pendingApprovals > 0}
                />
            </div>

            {depts.length === 0 ? (
                <Empty hasRoster={workerCount > 0} />
            ) : (
                <div className="grid gap-3 inner:grid-cols-2 desk:gap-4">
                    {depts.map((d) => (
                        <Link key={d.id} href={`/dashboard/delphi/departments/${d.id}`}>
                            <Card className="bg-black/40 border-white/10 hover:border-white/25 transition-colors h-full">
                                <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
                                    <CardTitle className="text-base leading-tight">{d.name}</CardTitle>
                                    <Badge variant="outline" className={STATUS_STYLES[d.status] ?? ''}>
                                        {String(d.status).replace('_', ' ')}
                                    </Badge>
                                </CardHeader>
                                <CardContent className="space-y-3">
                                    <p className="text-sm text-muted-foreground line-clamp-2">{d.charter}</p>
                                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                                        <span>
                                            {formatUsd(Number(d.spent_usd ?? 0))} / {formatUsd(Number(d.budget_usd ?? 0))}
                                        </span>
                                        {d.cadence_cron && <span className="font-mono">{d.cadence_cron}</span>}
                                    </div>
                                </CardContent>
                            </Card>
                        </Link>
                    ))}
                </div>
            )}

            {archived.length > 0 && (
                <details className="group">
                    <summary className="cursor-pointer list-none text-sm text-muted-foreground hover:text-zinc-200">
                        Archived ({archived.length}) — kept, not running
                    </summary>
                    <div className="mt-3 grid gap-2 inner:grid-cols-2">
                        {archived.map((d) => (
                            <Link key={d.id} href={`/dashboard/delphi/departments/${d.id}`}>
                                <Card className="border-white/5 bg-black/20 transition-colors hover:border-white/15">
                                    <CardContent className="flex items-center gap-3 py-3">
                                        <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                                            {d.name}
                                        </span>
                                        <span className="shrink-0 text-xs text-muted-foreground/60">
                                            {formatUsd(Number(d.spent_usd ?? 0))} spent
                                        </span>
                                    </CardContent>
                                </Card>
                            </Link>
                        ))}
                    </div>
                </details>
            )}

            <Card className="bg-black/40 border-white/10">
                <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                        <Activity className="h-4 w-4" /> Activity
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {events?.length ? (
                        <div className="space-y-1 font-mono text-xs">
                            {events.map((e) => (
                                <ActivityLine key={e.id} event={e as unknown as ActivityEvent} />
                            ))}
                        </div>
                    ) : (
                        <p className="text-sm text-muted-foreground">
                            Nothing yet. Activity appears here as agents work, with a clickable source for
                            every claim.
                        </p>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}

function Stat({
    icon,
    label,
    value,
    hint,
    alert,
}: {
    icon: React.ReactNode
    label: string
    value: string
    hint?: string
    alert?: boolean
}) {
    return (
        <Card className="bg-black/40 border-white/10">
            <CardContent className="pt-6">
                <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
                    {icon}
                    {label}
                </div>
                <div className={`text-2xl font-bold mt-2 ${alert ? 'text-amber-400' : ''}`}>{value}</div>
                {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
            </CardContent>
        </Card>
    )
}
