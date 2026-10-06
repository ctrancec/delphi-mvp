import { notFound } from 'next/navigation'
import { createClient, currentUser } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Wallet, Clock, ShieldCheck } from 'lucide-react'
import { formatUsd } from '@/lib/llm/cost'
import { HiringPanel, type HiredAgent } from '@/components/delphi/hiring-panel'
import { PipelineRunner } from '@/components/delphi/pipeline-runner'
import { GradeCard, type GradeRow } from '@/components/delphi/grade-badge'
import { TaskEditor } from '@/components/delphi/task-editor'
import { DepartmentSettings } from '@/components/delphi/department-settings'
import { AccountsCard } from '@/components/delphi/accounts-card'
import { accountLabel, listAccounts } from '@/lib/studio/accounts'
import { findWorkspace } from '@/lib/delphi/bootstrap'
import { roleOf } from '@/lib/delphi/members'
import { isDepartmentKind, KINDS, scheduleWords, withSettings, type DepartmentKind } from '@/lib/delphi/kinds'
import { DepartmentSetupCard } from '@/components/delphi/department-setup-card'
import { DepartmentRoom } from '@/components/delphi/department-room'
import { DepartmentTabs, type DepartmentTab } from '@/components/delphi/department-tabs'
import { OutputCard } from '@/components/delphi/output-card'
import { listOutputs, previewPathOf, signedUrlsFor } from '@/lib/delphi/outputs'
import { PLATFORM_LABEL } from '@/lib/studio/accounts'
import Link from 'next/link'

import { CEO_NAME } from '@/lib/pixel/cast/names'
export const dynamic = 'force-dynamic'

export default async function DepartmentPage({
    params,
    searchParams,
}: {
    params: Promise<{ id: string }>
    searchParams: Promise<{ tab?: string }>
}) {
    const [{ id }, { tab: tabParam }] = await Promise.all([params, searchParams])
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
            .select('*, agent:delphi_agents(id, name, title, slug, avatar_seed, skills, cost_tier, origin, is_board)')
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

    // The accounts this department produces for, and whether the viewer may
    // change them. Both are cheap, and the card is on every department page.
    const [workspaceId, user] = await Promise.all([findWorkspace(supabase), currentUser()])
    const [accounts, role, ownerId] = await Promise.all([
        workspaceId ? listAccounts(supabase, workspaceId, id) : Promise.resolve([]),
        workspaceId && user ? roleOf(supabase, workspaceId, user.id) : Promise.resolve(null),
        workspaceId
            ? supabase
                  .from('workspaces')
                  .select('owner_id')
                  .eq('id', workspaceId)
                  .maybeSingle()
                  .then(({ data }) => ((data as { owner_id?: string } | null)?.owner_id as string | undefined) ?? null)
            : Promise.resolve(null),
    ])
    const accountById = new Map(accounts.map((a) => [a.id, a]))

    // Grades and handoffs for this project's tasks, so a replacement is
    // visible as something that happened rather than inferred from a name
    // silently changing.
    const taskIds = (tasks ?? []).map((t) => t.id as string)
    const [{ data: grades }, { data: handoffs }] = taskIds.length
        ? await Promise.all([
              supabase
                  .from('delphi_performance_reviews')
                  .select('*')
                  .in('task_id', taskIds)
                  .order('created_at', { ascending: false }),
              supabase
                  .from('delphi_handoffs')
                  .select('task_id, reason, from:from_agent_id(name), to:to_agent_id(name)')
                  .in('task_id', taskIds)
                  .order('created_at', { ascending: false }),
          ])
        : [{ data: [] }, { data: [] }]

    // Pair each hire with its task; they share `seq` by construction.
    const team: HiredAgent[] = (hires ?? []).map((h) => {
        const agent = h.agent as unknown as {
            id: string
            slug: string
            avatar_seed: string | null
            name: string
            title: string
            skills: string[]
            cost_tier: number
            origin: string
        }
        const task = (tasks ?? []).find((t) => t.seq === h.seq)
        return {
            seq: h.seq,
            slug: agent?.slug ?? 'unknown',
            avatarSeed: agent?.avatar_seed ?? null,
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
    const kind: DepartmentKind = isDepartmentKind(dept.kind) ? (dept.kind as DepartmentKind) : 'research'
    const settings = withSettings(dept.settings)
    const canEdit = role === 'owner'

    // A studio has a tab per channel; anything else on the address is the overview.
    const studio = kind === 'studio'
    const channel = studio && tabParam ? accounts.find((a) => a.id === tabParam) ?? null : null
    const tab = !studio ? 'all' : channel ? channel.id : tabParam === 'team' || tabParam === 'settings' ? tabParam : 'overview'
    const tabs: DepartmentTab[] = [
        { key: 'overview', label: 'Overview' },
        ...accounts.map((a) => ({
            key: a.id,
            label: `${PLATFORM_LABEL[a.platform] ?? a.platform} · ${a.name}`,
            note: a.status === 'paused' ? 'paused' : undefined,
        })),
        { key: 'team', label: 'Team' },
        { key: 'settings', label: 'Settings' },
    ]
    const show = (...keys: string[]) => tab === 'all' || keys.includes(tab)

    // The channel's own work, on its tab: newest first, with its pictures.
    let channelWork: { records: Awaited<ReturnType<typeof listOutputs>>; pictures: Map<string, string> } | null = null
    if (channel) {
        const records = await listOutputs(supabase, { departmentId: id, accountId: channel.id, limit: 12 }).catch(() => [])
        const paths = records.map(previewPathOf).filter((p): p is string => Boolean(p))
        channelWork = { records, pictures: await signedUrlsFor(supabase, paths) }
    }

    const room =
        workspaceId && user && role ? (
            <DepartmentRoom
                db={supabase}
                workspaceId={workspaceId}
                department={{ id, name: dept.name as string, kind }}
                account={channel}
                role={role}
                user={user}
                ownerId={ownerId}
                timezone={settings.timezone}
            />
        ) : null

    return (
        <div className="space-y-6 max-w-4xl">
            <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                    <h1 className="text-2xl font-bold tracking-tight [overflow-wrap:anywhere]">{dept.name}</h1>
                    <p className="text-sm text-muted-foreground mt-2 max-w-2xl">{dept.charter}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge variant="outline">{String(dept.status).replace('_', ' ')}</Badge>
                    <Badge variant="outline" className="border-sky-400/30 text-sky-300">{KINDS[kind].label}</Badge>
                </div>
            </div>

            <div className="flex flex-wrap gap-4 text-sm">
                <span className="inline-flex items-center gap-2 text-muted-foreground">
                    <Wallet className="h-4 w-4" />
                    {formatUsd(Number(project?.spent_usd ?? dept.spent_usd ?? 0))} of{' '}
                    {formatUsd(Number(dept.budget_usd))}
                </span>
                {settings.schedule ? (
                    <span className="inline-flex items-center gap-2 text-muted-foreground">
                        <Clock className="h-4 w-4" />
                        {scheduleWords(settings.schedule, settings.timezone)}
                    </span>
                ) : (
                    dept.cadence_cron && (
                        <span className="inline-flex items-center gap-2 text-muted-foreground">
                            <Clock className="h-4 w-4" />
                            <code className="font-mono text-xs">{dept.cadence_cron}</code>
                        </span>
                    )
                )}
                <span className="inline-flex items-center gap-2 text-muted-foreground">
                    <ShieldCheck className="h-4 w-4" />
                    L.L.R. board reviews before anything reaches you
                </span>
            </div>

            {studio && <DepartmentTabs departmentId={id} tabs={tabs} current={tab} />}

            {/* The team is on its own tab; a plan waiting on the CHO is not left there unseen. */}
            {studio && tab !== 'team' && dept.status === 'awaiting_approval' && canEdit && (
                <Link
                    href={`/dashboard/delphi/departments/${id}?tab=team`}
                    scroll={false}
                    className="flex items-center justify-between gap-3 rounded-xl border border-amber-400/30 bg-amber-400/5 px-4 py-3 text-sm text-amber-200 hover:border-amber-400/50"
                >
                    <span>{CEO_NAME} has proposed a team for this studio. It does nothing until you approve it.</span>
                    <span className="shrink-0 underline-offset-4 hover:underline">Review the team</span>
                </Link>
            )}

            {show('overview') && (
                <DepartmentSetupCard
                    departmentId={id}
                    kind={kind}
                    name={dept.name as string}
                    charter={dept.charter as string}
                    settings={settings}
                    canEdit={canEdit}
                    show={studio ? 'prompts' : 'all'}
                />
            )}

            {(show('overview') || channel) && room}

            {channel && channelWork && (
                <Card className="border-white/10 bg-black/40">
                    <CardHeader className="pb-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <CardTitle className="text-sm">Made for {channel.name}</CardTitle>
                            <Link href={`/dashboard/delphi/outputs?account=${channel.id}`} className="text-xs text-sky-400 hover:underline">
                                All of it in Outputs
                            </Link>
                        </div>
                    </CardHeader>
                    <CardContent>
                        {channelWork.records.length === 0 ? (
                            <p className="text-sm text-muted-foreground">Nothing yet. Work for this channel shows here, and posts itself into its room.</p>
                        ) : (
                            <div className="grid gap-3 inner:grid-cols-2">
                                {channelWork.records.map((r) => {
                                    const path = previewPathOf(r)
                                    return <OutputCard key={r.artifact.id} record={r} picture={path ? channelWork!.pictures.get(path) ?? null : null} />
                                })}
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}

            {channel && (
                <AccountsCard departmentId={id} accounts={[channel]} canEdit={canEdit} hasTeam={team.length > 0} timezone={settings.timezone} single />
            )}

            {show('overview') && (studio || accounts.length > 0) && (
                <AccountsCard departmentId={id} accounts={accounts} canEdit={canEdit} hasTeam={team.length > 0} timezone={settings.timezone} />
            )}

            {show('team') && <HiringPanel departmentId={id} team={team} status={dept.status} approved={approved} />}

            {/* Running means work is outstanding; the runner keeps poking the
                engine so the pipeline advances while the CHO watches — on
                whichever tab they are looking at. */}
            <PipelineRunner active={project?.status === 'running'} />

            {show('team') && (tasks ?? []).length > 0 && (
                <Card className="border-white/10 bg-black/40">
                    <CardHeader className="pb-3">
                        <CardTitle className="text-sm">The pipeline</CardTitle>
                        <p className="text-xs text-muted-foreground">
                            Each step&rsquo;s objective is the instruction its agent actually receives.
                            Edit one to change what gets done — &ldquo;also check the bond market&rdquo;,
                            &ldquo;cite the primary source rather than a summary&rdquo;.
                        </p>
                    </CardHeader>
                    <CardContent className="space-y-2">
                        {(tasks ?? []).map((t) => {
                            const member = team.find((m) => m.seq === (t.seq as number))
                            return (
                                <TaskEditor
                                    key={t.id as string}
                                    task={{
                                        id: t.id as string,
                                        seq: t.seq as number,
                                        title: t.title as string,
                                        objective: t.objective as string,
                                        status: t.status as string,
                                        agentName: member?.name ?? null,
                                        agent: member ? { slug: member.slug, name: member.name, avatarSeed: member.avatarSeed } : null,
                                        deliverable: (t.deliverable as string) ?? 'text',
                                        accountLabel: t.account_id && accountById.get(t.account_id as string)
                                            ? accountLabel(accountById.get(t.account_id as string)!)
                                            : null,
                                    }}
                                />
                            )
                        })}
                    </CardContent>
                </Card>
            )}

            {studio && show('settings') && (
                <DepartmentSetupCard
                    departmentId={id}
                    kind={kind}
                    name={dept.name as string}
                    charter={dept.charter as string}
                    settings={settings}
                    canEdit={canEdit}
                    show="summary"
                />
            )}

            {show('settings') && (
                <DepartmentSettings
                    departmentId={id}
                    name={dept.name as string}
                    charter={dept.charter as string}
                    budgetUsd={Number(dept.budget_usd ?? 0)}
                    cadenceCron={(dept.cadence_cron as string) ?? null}
                    archived={dept.status === 'archived'}
                />
            )}

            {show('team') && (grades ?? []).length > 0 && (
                <Card className="border-white/10 bg-black/40">
                    <CardHeader className="pb-3">
                        <CardTitle className="text-sm">How the work was graded</CardTitle>
                        <p className="text-xs text-muted-foreground">
                            {CEO_NAME} grades every task. The score feeds the hiring rank, so an agent that
                            performs badly here gets picked less often — automatically. A grade is an
                            opinion; the unsourced-claim count is not.
                        </p>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {(grades ?? []).map((g) => {
                            const task = (tasks ?? []).find((t) => t.id === g.task_id)
                            const handoff = (handoffs ?? []).find((h) => h.task_id === g.task_id)
                            return (
                                <div key={g.id as string} className="space-y-1.5">
                                    {task && (
                                        <p className="text-xs text-muted-foreground">
                                            Step {task.seq as number} — {task.title as string}
                                        </p>
                                    )}
                                    <GradeCard grade={g as unknown as GradeRow} />
                                    {handoff && (
                                        <p className="pl-1 text-[11px] text-amber-400/80">
                                            Handed from{' '}
                                            {(handoff.from as unknown as { name: string })?.name ?? 'the previous agent'} to{' '}
                                            {(handoff.to as unknown as { name: string })?.name ?? 'a replacement'} — they
                                            resumed from the dossier rather than starting over.
                                        </p>
                                    )}
                                </div>
                            )
                        })}
                    </CardContent>
                </Card>
            )}

            {show('team') && team.length > 0 && (
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
