/**
 * Playbooks: how a department works, approved once, run many times.
 *
 * Approving a team approves its plan: the steps, in order, and who does each.
 * That plan is kept as a playbook. A studio keeps one per channel — the
 * shared steps, such as research, then that channel's own chain — and a
 * research or general department keeps one for itself. A run is one
 * execution of a playbook: a project with its tasks, made fresh from the
 * steps each time, for one report or one episode of one channel.
 *
 * The first run is the one approving the team starts. After that the
 * scheduler starts runs when they are due (scheduler.ts).
 */

import { emitEvent, isMissingColumn, type Db } from './db';
import { isMissingRelation, listAccounts } from '@/lib/studio/accounts';
import type { DepartmentKind } from './kinds';
import { CEO_NAME } from '@/lib/pixel/cast/names';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

export interface PlaybookStep {
    seq: number;
    title: string;
    /** The instruction its agent receives, before any run's own topic. */
    objective: string;
    agentId: string;
    /** `text`, or a format the studio renders. */
    deliverable: string;
    /** The channel the step is for; null for one every channel shares, such as research. */
    accountId: string | null;
    /** The step it works from, by seq. */
    after: number | null;
}

export interface Playbook {
    id: string;
    workspaceId: string;
    departmentId: string;
    accountId: string | null;
    steps: PlaybookStep[];
    approvedAt: string;
}

/** The steps of an approved plan, read off its project's tasks. */
export function stepsFromTasks(tasks: Row[]): PlaybookStep[] {
    const seqOf = new Map(tasks.map((t) => [t.id as string, Number(t.seq)]));
    return [...tasks]
        .filter((t) => t.agent_id && t.status !== 'skipped')
        .sort((a, b) => Number(a.seq) - Number(b.seq))
        .map((t) => ({
            seq: Number(t.seq),
            title: String(t.title ?? ''),
            objective: String(t.objective ?? ''),
            agentId: String(t.agent_id),
            deliverable: String(t.deliverable ?? 'text'),
            accountId: (t.account_id as string | null) ?? null,
            after: t.depends_on ? seqOf.get(t.depends_on as string) ?? null : null,
        }));
}

/**
 * One channel's playbook: the shared steps, then its own chain. Another
 * channel's steps are left out, and anything that pointed at one is pointed
 * at the nearest earlier step that stayed.
 */
export function channelSteps(all: PlaybookStep[], accountId: string): PlaybookStep[] {
    const kept = all.filter((s) => s.accountId === null || s.accountId === accountId);
    const seqs = new Set(kept.map((s) => s.seq));
    return kept.map((s) => {
        if (s.after === null || seqs.has(s.after)) return s;
        const earlier = kept.filter((k) => k.seq < s.seq && k.accountId === null).map((k) => k.seq);
        return { ...s, after: earlier.length ? Math.max(...earlier) : null };
    });
}

function toPlaybook(r: Row): Playbook {
    return {
        id: r.id,
        workspaceId: r.workspace_id,
        departmentId: r.department_id,
        accountId: r.account_id ?? null,
        steps: Array.isArray(r.steps) ? (r.steps as PlaybookStep[]) : [],
        approvedAt: r.approved_at,
    };
}

/** The approved playbooks of a department, the department's own first. */
export async function playbooksOf(db: Db, departmentId: string): Promise<Playbook[]> {
    const { data, error } = await db
        .from('delphi_playbooks')
        .select('*')
        .eq('department_id', departmentId)
        .eq('status', 'approved');
    if (error) return [];
    return ((data ?? []) as Row[]).map(toPlaybook).sort((a, b) => (a.accountId === null ? -1 : b.accountId === null ? 1 : 0));
}

/**
 * Keep the plan just approved as the department's playbooks, retiring the
 * ones it replaces. A studio gets one per channel that has steps of its own;
 * any other department, one. Never throws: a playbook that cannot be written
 * must not undo the approval, and before migration 0012 there is nowhere to
 * write one.
 */
export async function writePlaybooks(
    db: Db,
    input: { workspaceId: string; departmentId: string; kind: DepartmentKind; projectId: string; approvedAt?: Date }
): Promise<{ written: number }> {
    try {
        const { data: tasks } = await db.from('delphi_tasks').select('*').eq('project_id', input.projectId);
        const steps = stepsFromTasks((tasks ?? []) as Row[]);
        if (!steps.length) return { written: 0 };

        const retire = await db
            .from('delphi_playbooks')
            .update({ status: 'retired' })
            .eq('department_id', input.departmentId)
            .eq('status', 'approved');
        if (retire.error) {
            if (!isMissingRelation(retire.error) && !isMissingColumn(retire.error)) console.warn('[delphi] could not retire playbooks:', retire.error.message);
            return { written: 0 };
        }

        const rows: Row[] = [];
        if (input.kind === 'studio') {
            const accounts = await listAccounts(db, input.workspaceId, input.departmentId);
            for (const a of accounts) {
                if (!steps.some((s) => s.accountId === a.id)) continue;
                rows.push({ workspace_id: input.workspaceId, department_id: input.departmentId, account_id: a.id, steps: channelSteps(steps, a.id) });
            }
        } else {
            rows.push({ workspace_id: input.workspaceId, department_id: input.departmentId, account_id: null, steps });
        }

        let written = 0;
        for (const row of rows) {
            const { error } = await db.from('delphi_playbooks').insert({ ...row, status: 'approved', approved_at: (input.approvedAt ?? new Date()).toISOString() });
            if (error) console.warn('[delphi] could not write a playbook:', error.message);
            else written++;
        }
        return { written };
    } catch (err) {
        console.warn('[delphi] could not write playbooks:', (err as Error).message);
        return { written: 0 };
    }
}

export interface RunInput {
    workspaceId: string;
    departmentId: string;
    playbook: Playbook;
    title: string;
    brief: string;
    budgetUsd: number;
    /** The slot this run is for. Two runs for one slot cannot both start. */
    scheduledFor: Date | null;
    /** The channel, for an episode. */
    accountId: string | null;
    ideaId: string | null;
    /** Put before every step's own instruction: this run's topic. */
    topicLine: string | null;
}

export type RunStart = { ok: true; projectId: string } | { ok: false; taken: boolean; error: string };

/** True for the error a second start of the same slot gets. */
function isDuplicate(error: { code?: string; message?: string } | null): boolean {
    return Boolean(error && (error.code === '23505' || /duplicate key/i.test(error.message ?? '')));
}

/**
 * Start one run of a playbook: its project, running, and a task for every
 * step. The slot is claimed by the insert itself — the database refuses a
 * second project for the same playbook and slot — so two ticks reaching the
 * same slot start it once.
 */
export async function startRun(db: Db, input: RunInput): Promise<RunStart> {
    const now = new Date().toISOString();
    const { data: project, error } = await db
        .from('delphi_projects')
        .insert({
            workspace_id: input.workspaceId,
            department_id: input.departmentId,
            title: input.title.slice(0, 200),
            brief: input.brief,
            status: 'running',
            budget_usd: Math.max(0, Math.round(input.budgetUsd * 100) / 100),
            started_at: now,
            playbook_id: input.playbook.id,
            account_id: input.accountId,
            scheduled_for: input.scheduledFor ? input.scheduledFor.toISOString() : null,
            idea_id: input.ideaId,
        })
        .select('id')
        .single();
    if (error || !project) {
        if (isDuplicate(error)) return { ok: false, taken: true, error: 'That slot has already started.' };
        return { ok: false, taken: false, error: error?.message ?? 'Could not start the run.' };
    }

    const idBySeq = new Map<number, string>();
    for (const step of [...input.playbook.steps].sort((a, b) => a.seq - b.seq)) {
        const objective = input.topicLine ? `${input.topicLine}\n\n${step.objective}` : step.objective;
        const { data: task, error: taskErr } = await db
            .from('delphi_tasks')
            .insert({
                workspace_id: input.workspaceId,
                project_id: project.id,
                agent_id: step.agentId,
                seq: step.seq,
                title: step.title,
                objective,
                depends_on: step.after !== null ? idBySeq.get(step.after) ?? null : null,
                status: 'pending',
                deliverable: step.deliverable,
                account_id: step.accountId,
            })
            .select('id')
            .single();
        if (taskErr || !task) {
            // Half a run is worse than none: it would run steps with nothing
            // to hand to the rest. Called off, with the reason on the record.
            await db.from('delphi_projects').update({ status: 'failed', finished_at: now }).eq('id', project.id);
            return { ok: false, taken: false, error: taskErr?.message ?? 'Could not write a step.' };
        }
        idBySeq.set(step.seq, task.id as string);
    }

    await emitEvent(db, {
        workspaceId: input.workspaceId,
        departmentId: input.departmentId,
        projectId: project.id as string,
        type: 'project_started',
        actor: CEO_NAME,
        verb: input.ideaId ? 'started an episode' : 'started a run',
        object: input.title.slice(0, 160),
    });
    return { ok: true, projectId: project.id as string };
}
