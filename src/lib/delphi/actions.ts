'use server';

/**
 * Server actions for Delphi.
 *
 * These are the writes the mission control UI makes. Reads go straight through
 * the server client in the page components; anything that mutates comes here so
 * the authorization story stays in one place.
 *
 * Every action runs as the signed-in CHO, so RLS is doing the access control —
 * never the service-role client, which would bypass it.
 */

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { proposePlan } from './delphi';
import {
    availableChannelKinds,
    emitEvent,
    getAgentStats,
    insertInventedAgent,
    listAgents,
    recallMemories,
    type Db,
} from './db';
import { hiringScore, shortlistCandidates } from './delphi';
import type { CostTier } from './types';

export interface ActionResult<T = void> {
    ok: boolean;
    error?: string;
    data?: T;
}

/** Resolve the caller's active workspace. */
async function resolveWorkspace(db: Db): Promise<string | null> {
    const { data } = await db
        .from('workspaces')
        .select('id')
        .order('created_at', { ascending: true })
        .limit(1);
    return data?.[0]?.id ?? null;
}

async function getDb(): Promise<{ db: Db; workspaceId: string } | { error: string }> {
    const db = await createClient();
    if (!db) return { error: 'Supabase is not configured. Check your environment variables.' };

    const {
        data: { user },
    } = await db.auth.getUser();
    if (!user) return { error: 'You are not signed in.' };

    const workspaceId = await resolveWorkspace(db);
    if (!workspaceId) {
        return {
            error: 'No workspace found. Run  select public.bootstrap_workspace(\'Delphi\');  in the SQL editor.',
        };
    }

    return { db, workspaceId };
}

// ---------------------------------------------------------------------------
// Departments
// ---------------------------------------------------------------------------

export async function createDepartmentAction(input: {
    name: string;
    charter: string;
    budgetUsd: number;
    cadenceCron?: string;
}): Promise<ActionResult<{ id: string }>> {
    const ctx = await getDb();
    if ('error' in ctx) return { ok: false, error: ctx.error };
    const { db, workspaceId } = ctx;

    if (!input.name.trim()) return { ok: false, error: 'Give the department a name.' };
    if (input.charter.trim().length < 20) {
        return {
            ok: false,
            error: 'The charter needs to be specific enough for Delphi to staff it — a sentence or two about what this department is for.',
        };
    }

    const { data, error } = await db
        .from('delphi_departments')
        .insert({
            workspace_id: workspaceId,
            name: input.name.trim(),
            charter: input.charter.trim(),
            budget_usd: input.budgetUsd,
            cadence_cron: input.cadenceCron || null,
            status: 'draft',
        })
        .select('id')
        .single();

    if (error) return { ok: false, error: error.message };

    await emitEvent(db, {
        workspaceId,
        departmentId: data.id,
        type: 'department_created',
        actor: 'CHO',
        verb: 'created a department',
        object: input.name.trim(),
    });

    revalidatePath('/dashboard/delphi');
    return { ok: true, data: { id: data.id } };
}

// ---------------------------------------------------------------------------
// Hiring
// ---------------------------------------------------------------------------

/**
 * Ask Delphi to staff a department, and persist the proposal.
 *
 * Nothing runs as a result of this — the department moves to
 * `awaiting_approval` and waits for the CHO. Delphi never staffs itself into
 * spending without consent.
 */
export async function proposeHiringAction(
    departmentId: string
): Promise<ActionResult<{ taskCount: number; estimatedCostUsd: number }>> {
    const ctx = await getDb();
    if ('error' in ctx) return { ok: false, error: ctx.error };
    const { db, workspaceId } = ctx;

    const { data: dept, error: deptErr } = await db
        .from('delphi_departments')
        .select('*')
        .eq('id', departmentId)
        .single();
    if (deptErr || !dept) return { ok: false, error: deptErr?.message ?? 'Department not found.' };

    await db.from('delphi_departments').update({ status: 'hiring' }).eq('id', departmentId);
    await emitEvent(db, {
        workspaceId,
        departmentId,
        type: 'hiring_started',
        actor: 'Delphi',
        verb: 'started staffing',
        object: dept.name,
    });

    try {
        const agents = await listAgents(db, workspaceId);
        if (agents.length === 0) {
            return {
                ok: false,
                error: 'The roster is empty. Run  npm run delphi:seed  before staffing a department.',
            };
        }

        const stats = await getAgentStats(db, workspaceId);
        const channels = await availableChannelKinds(db, workspaceId);
        const memories = await recallMemories(db, workspaceId, dept.charter);
        const shortlist = shortlistCandidates(agents, stats, dept.charter);

        const result = await proposePlan({
            brief: dept.charter,
            candidates: shortlist,
            availableChannels: channels,
            memories,
            departmentName: dept.name,
        });
        const plan = result.data;

        // Clear any previous proposal so re-staffing replaces rather than stacks.
        await db.from('delphi_hires').delete().eq('department_id', departmentId);

        const bySlug = new Map(agents.map((a) => [a.slug, a]));
        let previousTaskId: string | null = null;
        const projectTitle = plan.departmentName || dept.name;

        const { data: project, error: projErr } = await db
            .from('delphi_projects')
            .insert({
                workspace_id: workspaceId,
                department_id: departmentId,
                title: projectTitle,
                brief: dept.charter,
                status: 'awaiting_approval',
                budget_usd: dept.budget_usd,
            })
            .select('id')
            .single();
        if (projErr) return { ok: false, error: projErr.message };

        for (const task of plan.tasks) {
            let agent = task.assignedSlug ? bySlug.get(task.assignedSlug) : undefined;

            // Delphi drafted someone new — they join the roster permanently.
            if (!agent && task.newAgent) {
                agent = await insertInventedAgent(db, workspaceId, task.newAgent, departmentId);
                bySlug.set(agent.slug, agent);
                await emitEvent(db, {
                    workspaceId,
                    departmentId,
                    type: 'agent_invented',
                    actor: 'Delphi',
                    verb: 'drafted a new agent',
                    object: `${agent.name} — ${agent.title}`,
                    payload: { reason: task.newAgent.reason },
                });
            }
            if (!agent) continue;

            const score = hiringScore(task.fit, stats.get(agent.id) ?? null, agent.costTier as CostTier);

            await db.from('delphi_hires').insert({
                workspace_id: workspaceId,
                department_id: departmentId,
                agent_id: agent.id,
                score,
                rationale: task.rationale,
                seq: task.seq,
            });

            // Annotated because `row` feeds `previousTaskId`, which is read by the
            // very insert that produces it — TypeScript cannot infer through that loop.
            const { data: row } = (await db
                .from('delphi_tasks')
                .insert({
                    workspace_id: workspaceId,
                    project_id: project.id,
                    agent_id: agent.id,
                    seq: task.seq,
                    title: task.title,
                    objective: task.objective,
                    depends_on: previousTaskId,
                    status: 'pending',
                })
                .select('id')
                .single()) as { data: { id: string } | null };

            previousTaskId = row?.id ?? null;

            await emitEvent(db, {
                workspaceId,
                departmentId,
                projectId: project.id,
                type: 'agent_hired',
                actor: 'Delphi',
                verb: `hired for step ${task.seq}`,
                object: `${agent.name} — ${task.title}`,
                payload: { score, rationale: task.rationale },
            });
        }

        await db
            .from('delphi_departments')
            .update({ status: 'awaiting_approval' })
            .eq('id', departmentId);

        await emitEvent(db, {
            workspaceId,
            departmentId,
            projectId: project.id,
            type: 'plan_proposed',
            actor: 'Delphi',
            verb: 'proposed a team',
            object: `${plan.tasks.length} agents`,
            durationMs: 0,
            payload: {
                estimatedCostUsd: plan.estimatedCostUsd,
                decisionCostUsd: result.costUsd,
                model: result.model,
            },
        });

        revalidatePath(`/dashboard/delphi/departments/${departmentId}`);
        return {
            ok: true,
            data: { taskCount: plan.tasks.length, estimatedCostUsd: plan.estimatedCostUsd },
        };
    } catch (err) {
        // Leave the department somewhere the CHO can retry from rather than
        // stranding it in `hiring` forever.
        await db.from('delphi_departments').update({ status: 'draft' }).eq('id', departmentId);
        return { ok: false, error: (err as Error).message };
    }
}

/** The CHO approves the proposed team. This is what lets work actually start. */
export async function approvePlanAction(departmentId: string): Promise<ActionResult> {
    const ctx = await getDb();
    if ('error' in ctx) return { ok: false, error: ctx.error };
    const { db, workspaceId } = ctx;

    const { data: project } = await db
        .from('delphi_projects')
        .select('id')
        .eq('department_id', departmentId)
        .eq('status', 'awaiting_approval')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (!project) return { ok: false, error: 'Nothing is awaiting approval for this department.' };

    await db.from('delphi_projects').update({ status: 'running', started_at: new Date().toISOString() }).eq('id', project.id);
    await db.from('delphi_departments').update({ status: 'active' }).eq('id', departmentId);

    await emitEvent(db, {
        workspaceId,
        departmentId,
        projectId: project.id,
        type: 'plan_approved',
        actor: 'CHO',
        verb: 'approved the team',
    });

    revalidatePath(`/dashboard/delphi/departments/${departmentId}`);
    return { ok: true };
}

/** Seed the roster from the UI, for a workspace that has never been seeded. */
export async function seedRosterAction(): Promise<ActionResult<{ inserted: number }>> {
    const ctx = await getDb();
    if ('error' in ctx) return { ok: false, error: ctx.error };
    const { db, workspaceId } = ctx;

    const { seedRoster } = await import('./db');
    try {
        const { inserted } = await seedRoster(db, workspaceId);
        revalidatePath('/dashboard/delphi/roster');
        return { ok: true, data: { inserted } };
    } catch (err) {
        return { ok: false, error: (err as Error).message };
    }
}
