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

import { cache } from 'react';
import { revalidatePath } from 'next/cache';
import { createClient, currentUser } from '@/lib/supabase/server';
import { proposePlan } from './delphi';
import { ensureWorkspace, provisionWorkspace } from './bootstrap';
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
import type { SystemMode } from './db';

export interface ActionResult<T = void> {
    ok: boolean;
    error?: string;
    data?: T;
}

/**
 * Memoized for the request. A server action and the re-render Next runs after
 * it share one request, so without this every action paid for a second auth
 * round trip and a second workspace lookup on the way back out.
 */
const getDb = cache(async function getDb(): Promise<
    { db: Db; workspaceId: string } | { error: string }
> {
    const db = await createClient();
    if (!db) return { error: 'Supabase is not configured. Check your environment variables.' };

    if (!(await currentUser())) return { error: 'You are not signed in.' };

    const workspaceId = await ensureWorkspace(db);
    if (!workspaceId) {
        return { error: 'Could not create your workspace. Check the database connection.' };
    }

    return { db, workspaceId };
});

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
        // A fresh workspace has no roster, and an empty roster is a dead end the
        // CHO cannot resolve from the UI. Provision rather than failing.
        await provisionWorkspace(db, workspaceId);

        const agents = await listAgents(db, workspaceId);
        if (agents.length === 0) {
            return { ok: false, error: 'The roster could not be seeded. Check the database connection.' };
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

// ---------------------------------------------------------------------------
// The master switch
// ---------------------------------------------------------------------------

/**
 * Turn the whole organisation on or off.
 *
 * The switch lives in the database rather than in any client, so flipping it
 * on the phone stops the engine everywhere — the runtime checks it before
 * every task, and departments keep to their cadence with every app closed.
 */
export async function setSystemModeAction(
    mode: SystemMode,
    reason?: string
): Promise<ActionResult<{ mode: SystemMode }>> {
    const ctx = await getDb();
    if ('error' in ctx) return { ok: false, error: ctx.error };
    const { db, workspaceId } = ctx;

    try {
        const { setSystemMode } = await import('./db');
        await setSystemMode(db, workspaceId, mode, reason);

        await emitEvent(db, {
            workspaceId,
            type: 'system_mode_changed',
            actor: 'CHO',
            verb: mode === 'running' ? 'started the system' : `set the system to ${mode}`,
            object: reason,
        });

        // Every Delphi surface shows the switch, so none of them may go stale.
        revalidatePath('/dashboard/delphi', 'layout');
        return { ok: true, data: { mode } };
    } catch (err) {
        return { ok: false, error: (err as Error).message };
    }
}

// ---------------------------------------------------------------------------
// Approvals — the CHO's consent
// ---------------------------------------------------------------------------

export type Decision = 'approved' | 'rejected';

/**
 * Decide on a pending action.
 *
 * The board advises and Delphi recommends, but this is the only place a
 * decision is actually made. Approving releases the task the runtime parked;
 * rejecting skips it, which leaves the rest of the pipeline free to continue —
 * the CHO refused one act, not necessarily the whole project. To stop
 * everything, there is the master switch.
 */
export async function decideApprovalAction(
    approvalId: string,
    decision: Decision,
    conditions?: string
): Promise<ActionResult<{ decision: Decision }>> {
    const ctx = await getDb();
    if ('error' in ctx) return { ok: false, error: ctx.error };
    const { db, workspaceId } = ctx;

    const {
        data: { user },
    } = await db.auth.getUser();

    const { data: approval, error: readErr } = await db
        .from('delphi_approvals')
        .select('id, task_id, project_id, status, summary, action_type')
        .eq('id', approvalId)
        .maybeSingle();

    if (readErr) return { ok: false, error: readErr.message };
    if (!approval) return { ok: false, error: 'That approval no longer exists.' };
    if (approval.status !== 'pending') {
        return { ok: false, error: `Already ${approval.status}.` };
    }

    const { error: updErr } = await db
        .from('delphi_approvals')
        .update({
            status: decision,
            conditions: conditions?.trim() || null,
            decided_by: user?.id ?? null,
            decided_at: new Date().toISOString(),
        })
        .eq('id', approvalId)
        // Only a still-pending row, so two tabs cannot both decide it.
        .eq('status', 'pending');

    if (updErr) return { ok: false, error: updErr.message };

    // Release the task the runtime parked. `done` on approval because the work
    // itself finished — the gate was on the action, not the output.
    if (approval.task_id) {
        await db
            .from('delphi_tasks')
            .update({ status: decision === 'approved' ? 'done' : 'skipped' })
            .eq('id', approval.task_id);
    }

    await emitEvent(db, {
        workspaceId,
        projectId: approval.project_id ?? undefined,
        taskId: approval.task_id ?? undefined,
        type: 'approval_decided',
        actor: 'CHO',
        verb: decision === 'approved' ? (conditions ? 'approved with conditions' : 'approved') : 'rejected',
        object: approval.summary,
        payload: { actionType: approval.action_type, conditions: conditions?.trim() || null },
    });

    revalidatePath('/dashboard/delphi/approvals');
    revalidatePath('/dashboard/delphi', 'layout');
    return { ok: true, data: { decision } };
}

/** Post into a review thread. Discussions run both ways, not just agent to agent. */
export async function postToThreadAction(
    threadId: string,
    content: string
): Promise<ActionResult> {
    const ctx = await getDb();
    if ('error' in ctx) return { ok: false, error: ctx.error };
    const { db, workspaceId } = ctx;

    const body = content.trim();
    if (!body) return { ok: false, error: 'Write something first.' };

    const {
        data: { user },
    } = await db.auth.getUser();
    if (!user) return { ok: false, error: 'You are not signed in.' };

    const { error } = await db.from('delphi_messages').insert({
        workspace_id: workspaceId,
        thread_id: threadId,
        author_agent_id: null,
        author_user_id: user.id,
        role: 'cho',
        content: body,
        round: 99,
    });

    if (error) return { ok: false, error: error.message };

    revalidatePath('/dashboard/delphi/reviews');
    return { ok: true };
}

// ---------------------------------------------------------------------------
// Talking to the CEO
// ---------------------------------------------------------------------------

export interface ChatReply {
    reply: string;
    actions: string[];
    costUsd: number;
}

/**
 * Send Delphi a message and store both turns.
 *
 * The conversation is one long-lived thread per workspace rather than a new
 * one each time, because a CEO you have to re-brief every session is not one
 * you would keep.
 */
export async function chatWithDelphiAction(message: string): Promise<ActionResult<ChatReply>> {
    const ctx = await getDb();
    if ('error' in ctx) return { ok: false, error: ctx.error };
    const { db, workspaceId } = ctx;

    const body = message.trim();
    if (!body) return { ok: false, error: 'Say something first.' };

    const {
        data: { user },
    } = await db.auth.getUser();
    if (!user) return { ok: false, error: 'You are not signed in.' };

    try {
        const { ensureDelphiAgent } = await import('./db');
        const { chatWithDelphi } = await import('./chat');
        const { getOrCreateChatThread, loadChatHistory } = await import('./chat-store');

        const delphiId = await ensureDelphiAgent(db, workspaceId);
        const threadId = await getOrCreateChatThread(db, workspaceId);
        if (!threadId) return { ok: false, error: 'Could not open the conversation thread.' };

        const history = await loadChatHistory(db, threadId);

        // The question is stored before the answer is attempted, so a failed
        // turn does not lose what was asked.
        await db.from('delphi_messages').insert({
            workspace_id: workspaceId,
            thread_id: threadId,
            author_user_id: user.id,
            author_agent_id: null,
            role: 'cho',
            content: body,
            round: 0,
        });

        const result = await chatWithDelphi(db, workspaceId, history, body);

        await db.from('delphi_messages').insert({
            workspace_id: workspaceId,
            thread_id: threadId,
            author_user_id: null,
            author_agent_id: delphiId,
            role: 'ceo',
            content: result.reply,
            round: 0,
        });

        // Anything Delphi changed shows up in the activity log too, so the
        // conversation is not a side channel that bypasses the record.
        for (const action of result.actions) {
            await emitEvent(db, {
                workspaceId,
                type: 'department_created',
                actor: 'Delphi',
                verb: 'acted on your instruction',
                object: action,
            });
        }

        revalidatePath('/dashboard/delphi', 'layout');
        return {
            ok: true,
            data: { reply: result.reply, actions: result.actions, costUsd: result.costUsd },
        };
    } catch (err) {
        return { ok: false, error: (err as Error).message };
    }
}
