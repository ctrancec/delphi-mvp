'use server';

/**
 * Managing departments, projects and the tasks inside them.
 *
 * Two principles run through all of it.
 *
 * **Archiving is the default; deleting is a decision.** A department cascades
 * further than it looks: removing one takes its projects, every deliverable
 * they produced, the activity log that made those deliverables traceable, and
 * the lessons Delphi learned from running it. Archiving stops it dead and
 * hides it while keeping all of that, which is what "I don't need this any
 * more" almost always means.
 *
 * **Editing a task can change what an agent is about to do**, so the shape of
 * the pipeline is protected even while its contents are editable. Deleting a
 * step relinks the chain around it rather than leaving the next agent
 * depending on something that no longer exists.
 */

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { emitEvent, type Db } from './db';
import { findWorkspace } from './bootstrap';

export interface ManageResult<T = void> {
    ok: boolean;
    error?: string;
    data?: T;
}

async function ctx(): Promise<{ db: Db; workspaceId: string } | { error: string }> {
    const db = await createClient();
    if (!db) return { error: 'Supabase is not configured.' };

    const {
        data: { user },
    } = await db.auth.getUser();
    if (!user) return { error: 'You are not signed in.' };

    const workspaceId = await findWorkspace(db);
    if (!workspaceId) return { error: 'No workspace yet.' };

    return { db, workspaceId };
}

// ---------------------------------------------------------------------------
// Departments
// ---------------------------------------------------------------------------

export async function updateDepartmentAction(
    departmentId: string,
    input: { name?: string; charter?: string; budgetUsd?: number; cadenceCron?: string | null }
): Promise<ManageResult> {
    const c = await ctx();
    if ('error' in c) return { ok: false, error: c.error };
    const { db, workspaceId } = c;

    const patch: Record<string, unknown> = {};

    if (input.name !== undefined) {
        const name = input.name.trim();
        if (!name) return { ok: false, error: 'A department needs a name.' };
        patch.name = name;
    }

    if (input.charter !== undefined) {
        const charter = input.charter.trim();
        if (charter.length < 20) {
            return {
                ok: false,
                error: 'The charter needs to be specific enough for Delphi to staff from — a sentence or two.',
            };
        }
        patch.charter = charter;
    }

    if (input.budgetUsd !== undefined) {
        if (!Number.isFinite(input.budgetUsd) || input.budgetUsd < 0) {
            return { ok: false, error: 'Budget must be a positive number.' };
        }
        patch.budget_usd = input.budgetUsd;
    }

    if (input.cadenceCron !== undefined) {
        const cron = input.cadenceCron?.trim() || null;
        // Five fields, or nothing. A malformed cron that silently never fires
        // is worse than one refused at the point of typing it.
        if (cron && cron.split(/\s+/).length !== 5) {
            return { ok: false, error: 'A cadence is five fields, e.g. "0 7 * * 1-5". Leave it empty for none.' };
        }
        patch.cadence_cron = cron;
    }

    if (Object.keys(patch).length === 0) return { ok: true };

    const { error } = await db
        .from('delphi_departments')
        .update(patch)
        .eq('id', departmentId)
        .eq('workspace_id', workspaceId);

    if (error) {
        return {
            ok: false,
            error: /duplicate key/i.test(error.message)
                ? 'A department already has that name.'
                : error.message,
        };
    }

    // A changed charter does not restaff on its own — the team was hired
    // against the old one, and silently re-hiring would spend money the CHO
    // did not ask to spend.
    await emitEvent(db, {
        workspaceId,
        departmentId,
        type: 'department_created',
        actor: 'CHO',
        verb: 'edited the department',
        object: Object.keys(patch).join(', '),
    });

    revalidatePath(`/dashboard/delphi/departments/${departmentId}`);
    revalidatePath('/dashboard/delphi');
    return { ok: true };
}

/**
 * Stop a department without losing anything it produced.
 *
 * Reversible, and what "I don't need this any more" almost always means.
 */
export async function setDepartmentArchivedAction(
    departmentId: string,
    archived: boolean
): Promise<ManageResult> {
    const c = await ctx();
    if ('error' in c) return { ok: false, error: c.error };
    const { db, workspaceId } = c;

    const { error } = await db
        .from('delphi_departments')
        .update({ status: archived ? 'archived' : 'paused' })
        .eq('id', departmentId)
        .eq('workspace_id', workspaceId);

    if (error) return { ok: false, error: error.message };

    // Any run still in flight stops too, or an archived department carries on
    // spending in the background.
    if (archived) {
        await db
            .from('delphi_projects')
            .update({ status: 'cancelled' })
            .eq('department_id', departmentId)
            .in('status', ['running', 'planning', 'awaiting_approval']);
    }

    await emitEvent(db, {
        workspaceId,
        departmentId,
        type: 'department_created',
        actor: 'CHO',
        verb: archived ? 'archived the department' : 'restored the department',
    });

    revalidatePath('/dashboard/delphi');
    revalidatePath(`/dashboard/delphi/departments/${departmentId}`);
    return { ok: true };
}

export interface DeletionImpact {
    name: string;
    projects: number;
    tasks: number;
    artifacts: number;
    memories: number;
    events: number;
}

/** What deleting would destroy, counted before anyone is asked to confirm. */
export async function departmentDeletionImpactAction(
    departmentId: string
): Promise<ManageResult<DeletionImpact>> {
    const c = await ctx();
    if ('error' in c) return { ok: false, error: c.error };
    const { db, workspaceId } = c;

    const { data: dept } = await db
        .from('delphi_departments')
        .select('name')
        .eq('id', departmentId)
        .eq('workspace_id', workspaceId)
        .maybeSingle();
    if (!dept) return { ok: false, error: 'That department no longer exists.' };

    const { data: projects } = await db
        .from('delphi_projects')
        .select('id')
        .eq('department_id', departmentId);
    const projectIds = (projects ?? []).map((p) => p.id as string);

    const [tasks, artifacts, memories, events] = await Promise.all([
        projectIds.length
            ? db.from('delphi_tasks').select('*', { head: true, count: 'exact' }).in('project_id', projectIds)
            : Promise.resolve({ count: 0 }),
        projectIds.length
            ? db.from('delphi_artifacts').select('*', { head: true, count: 'exact' }).in('project_id', projectIds)
            : Promise.resolve({ count: 0 }),
        db.from('delphi_memories').select('*', { head: true, count: 'exact' }).eq('department_id', departmentId),
        db.from('delphi_events').select('*', { head: true, count: 'exact' }).eq('department_id', departmentId),
    ]);

    return {
        ok: true,
        data: {
            name: dept.name as string,
            projects: projectIds.length,
            tasks: tasks.count ?? 0,
            artifacts: artifacts.count ?? 0,
            memories: memories.count ?? 0,
            events: events.count ?? 0,
        },
    };
}

/**
 * Delete a department and everything under it.
 *
 * Guarded by typing the name, because the cascade reaches further than the
 * button suggests — deliverables, the activity log that made them traceable,
 * and the lessons learned all go with it.
 */
export async function deleteDepartmentAction(
    departmentId: string,
    confirmName: string
): Promise<ManageResult> {
    const c = await ctx();
    if ('error' in c) return { ok: false, error: c.error };
    const { db, workspaceId } = c;

    const { data: dept } = await db
        .from('delphi_departments')
        .select('name')
        .eq('id', departmentId)
        .eq('workspace_id', workspaceId)
        .maybeSingle();
    if (!dept) return { ok: false, error: 'That department no longer exists.' };

    if (confirmName.trim() !== (dept.name as string)) {
        return { ok: false, error: `Type "${dept.name}" exactly to confirm.` };
    }

    const { error } = await db
        .from('delphi_departments')
        .delete()
        .eq('id', departmentId)
        .eq('workspace_id', workspaceId);

    if (error) return { ok: false, error: error.message };

    revalidatePath('/dashboard/delphi');
    return { ok: true };
}

// ---------------------------------------------------------------------------
// Projects — a single run inside a department
// ---------------------------------------------------------------------------

/**
 * Remove one run without touching the department.
 *
 * For a run that failed or went wrong, where the department itself is fine.
 */
export async function deleteProjectAction(projectId: string): Promise<ManageResult> {
    const c = await ctx();
    if ('error' in c) return { ok: false, error: c.error };
    const { db, workspaceId } = c;

    const { data: project } = await db
        .from('delphi_projects')
        .select('id, title, department_id, status')
        .eq('id', projectId)
        .eq('workspace_id', workspaceId)
        .maybeSingle();
    if (!project) return { ok: false, error: 'That run no longer exists.' };

    if (project.status === 'running') {
        return {
            ok: false,
            error: 'That run is still going. Pause the system or wait for it to stop first.',
        };
    }

    const { error } = await db.from('delphi_projects').delete().eq('id', projectId);
    if (error) return { ok: false, error: error.message };

    await emitEvent(db, {
        workspaceId,
        departmentId: (project.department_id as string) ?? undefined,
        type: 'project_failed',
        actor: 'CHO',
        verb: 'deleted the run',
        object: project.title as string,
    });

    revalidatePath(`/dashboard/delphi/departments/${project.department_id}`);
    return { ok: true };
}

// ---------------------------------------------------------------------------
// Tasks — what each agent is actually asked to do
// ---------------------------------------------------------------------------

export async function updateTaskAction(
    taskId: string,
    input: { title?: string; objective?: string; agentId?: string; rerun?: boolean }
): Promise<ManageResult> {
    const c = await ctx();
    if ('error' in c) return { ok: false, error: c.error };
    const { db, workspaceId } = c;

    const { data: task } = await db
        .from('delphi_tasks')
        .select('id, title, project_id, status, seq')
        .eq('id', taskId)
        .eq('workspace_id', workspaceId)
        .maybeSingle();
    if (!task) return { ok: false, error: 'That step no longer exists.' };

    if (task.status === 'running') {
        return { ok: false, error: 'That step is running right now. Pause the system first.' };
    }

    const patch: Record<string, unknown> = {};

    if (input.title !== undefined) {
        const title = input.title.trim();
        if (!title) return { ok: false, error: 'A step needs a title.' };
        patch.title = title;
    }

    if (input.objective !== undefined) {
        const objective = input.objective.trim();
        if (objective.length < 15) {
            return { ok: false, error: 'The objective is what the agent is told to do — be specific.' };
        }
        patch.objective = objective;
    }

    if (input.agentId) patch.agent_id = input.agentId;

    // Re-running is what makes editing useful: a changed objective that the
    // agent never sees again has changed nothing. Clearing replacement_count
    // gives the new instruction a fresh pair of attempts rather than inheriting
    // strikes earned against the old one.
    if (input.rerun) {
        patch.status = 'pending';
        patch.replacement_count = 0;
    }

    if (Object.keys(patch).length === 0) return { ok: true };

    const { error } = await db.from('delphi_tasks').update(patch).eq('id', taskId);
    if (error) return { ok: false, error: error.message };

    if (input.rerun) {
        // The project has to be runnable again, or a re-queued step sits there.
        await db
            .from('delphi_projects')
            .update({ status: 'running', error: null, finished_at: null })
            .eq('id', task.project_id)
            .in('status', ['done', 'failed', 'halted_budget']);
    }

    await emitEvent(db, {
        workspaceId,
        projectId: (task.project_id as string) ?? undefined,
        taskId,
        type: 'task_started',
        actor: 'CHO',
        verb: input.rerun ? 'edited and re-queued step' : 'edited step',
        object: `${task.seq} — ${(patch.title as string) ?? task.title}`,
    });

    revalidatePath('/dashboard/delphi', 'layout');
    return { ok: true };
}

/**
 * Remove a step, relinking the chain around it.
 *
 * Without the relink the next agent would depend on a task that no longer
 * exists, which the runtime reads as a broken handoff and stops on — turning
 * "remove a step I don't need" into "break the pipeline".
 */
export async function deleteTaskAction(taskId: string): Promise<ManageResult> {
    const c = await ctx();
    if ('error' in c) return { ok: false, error: c.error };
    const { db, workspaceId } = c;

    const { data: task } = await db
        .from('delphi_tasks')
        .select('id, title, seq, project_id, depends_on, status')
        .eq('id', taskId)
        .eq('workspace_id', workspaceId)
        .maybeSingle();
    if (!task) return { ok: false, error: 'That step no longer exists.' };

    if (task.status === 'running') {
        return { ok: false, error: 'That step is running right now. Pause the system first.' };
    }

    // Whoever depended on this now depends on what it depended on.
    await db
        .from('delphi_tasks')
        .update({ depends_on: task.depends_on })
        .eq('depends_on', taskId);

    const { error } = await db.from('delphi_tasks').delete().eq('id', taskId);
    if (error) return { ok: false, error: error.message };

    await emitEvent(db, {
        workspaceId,
        projectId: (task.project_id as string) ?? undefined,
        type: 'task_failed',
        actor: 'CHO',
        verb: 'removed step',
        object: `${task.seq} — ${task.title}`,
    });

    revalidatePath('/dashboard/delphi', 'layout');
    return { ok: true };
}
