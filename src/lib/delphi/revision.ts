/**
 * Sending work back.
 *
 * The board advises and Delphi recommends, but until now the CHO's answer was
 * binary — approve the action or refuse it — and refusing skipped the task. A
 * deliverable that was nearly right had nowhere to go: no way to say "close,
 * do it again knowing this", and no way for the reason to reach the agent that
 * wrote it.
 *
 * This is the third answer. The task returns to the queue carrying the CHO's
 * words, the agent reads them as part of its brief, and the loop repeats until
 * the work is accepted — or until asking the same agent again stops being a
 * sensible thing to do, at which point the task is handed to someone stronger.
 *
 * Not a server action: the actions in cho-review.ts call in here, and this
 * takes a database client, which cannot cross that boundary.
 */

import { emitEvent, type Db } from './db';
import { escalateTask } from './replacement';

/**
 * Send it back this many times before the agent, rather than the work, is
 * treated as the problem.
 *
 * Two, because the second refusal is the first evidence of a pattern. One is
 * a miss; asking a third time is asking the same question a third time.
 */
export const REVISIONS_BEFORE_ESCALATION = 2;

/**
 * Everything downstream of a refused task, in pipeline order.
 *
 * Refusing step 2 and leaving steps 3 and 4 alone is how you fix the analysis
 * and still read the same stale report: the writer consumed what has just been
 * replaced, and the auditor audited the writer. So the whole tail goes back in
 * the queue. It re-runs in `seq` order behind the step being redone, which is
 * what `depends_on` already guarantees.
 */
async function dependantsOf(db: Db, projectId: string, taskId: string): Promise<string[]> {
    const { data } = await db
        .from('delphi_tasks')
        .select('id, depends_on')
        .eq('project_id', projectId);

    const rows = (data ?? []) as { id: string; depends_on: string | null }[];
    const downstream: string[] = [];
    const frontier = [taskId];

    // Breadth-first rather than assuming a straight line: the schema allows a
    // task to be depended on by more than one.
    while (frontier.length) {
        const current = frontier.shift()!;
        for (const r of rows) {
            if (r.depends_on === current && !downstream.includes(r.id)) {
                downstream.push(r.id);
                frontier.push(r.id);
            }
        }
    }

    return downstream;
}

export interface SendBackOutcome {
    /** Set when this decision changed who is working on the task. */
    escalatedTo?: string;
    /** Which attempt the CHO has just refused. */
    revision: number;
    /** How many later steps were re-queued because they were built on this. */
    invalidated: number;
}

/**
 * Return a task to the queue carrying what the CHO asked to be different.
 *
 * Shared by both surfaces, because a declined deliverable and a refused action
 * are the same instruction — do it again, better — arriving through different
 * doors. The note is the load-bearing part: a rejection the agent never reads
 * changes nothing about what it produces next.
 */
export async function sendTaskBack(
    db: Db,
    workspaceId: string,
    taskId: string,
    note: string,
    source: 'output' | 'approval'
): Promise<SendBackOutcome> {
    const { data: task } = await db
        .from('delphi_tasks')
        .select('id, title, project_id, revision_count, agent_id')
        .eq('id', taskId)
        .maybeSingle();
    if (!task) return { revision: 0, invalidated: 0 };

    const revision = Number(task.revision_count ?? 0) + 1;

    const { data: agent } = await db
        .from('delphi_agents')
        .select('name')
        .eq('id', task.agent_id)
        .maybeSingle();

    await db
        .from('delphi_tasks')
        .update({ status: 'pending', cho_note: note, revision_count: revision })
        .eq('id', taskId);

    // The project has to be running again for the engine to pick it up — a
    // finished project would simply ignore a task that just went back in.
    if (task.project_id) {
        await db
            .from('delphi_projects')
            .update({ status: 'running' })
            .eq('id', task.project_id)
            .in('status', ['done', 'failed', 'halted_budget']);
    }

    // Whatever was built on this was built on what was just refused.
    const downstream = task.project_id
        ? await dependantsOf(db, task.project_id as string, taskId)
        : [];

    if (downstream.length) {
        await db
            .from('delphi_tasks')
            .update({ status: 'pending' })
            .in('id', downstream)
            .neq('status', 'running');
    }

    await emitEvent(db, {
        workspaceId,
        projectId: (task.project_id as string) ?? undefined,
        taskId,
        type: 'revision_requested',
        actor: 'CHO',
        verb: `sent ${source === 'output' ? 'the deliverable' : 'the proposed action'} back to`,
        object: `${(agent?.name as string) ?? 'the agent'} — ${note.slice(0, 120)}`,
        payload: { source, revision, note, invalidated: downstream.length },
    });

    // The CHO has now said twice that this is not good enough. That is a
    // judgement about the work, not a grade we inferred from it, so it is the
    // stronger signal of the two — and it is the one the CHO asked to act on.
    if (revision >= REVISIONS_BEFORE_ESCALATION) {
        const outcome = await escalateTask(
            db,
            workspaceId,
            taskId,
            `The CHO sent this back ${revision} times. Most recently: ${note}`
        );
        if (outcome.replaced) {
            return { revision, escalatedTo: outcome.toAgent, invalidated: downstream.length };
        }
    }

    return { revision, invalidated: downstream.length };
}

/**
 * Clear a task's outstanding note.
 *
 * Called once the work that answered it is accepted, so a later unrelated run
 * does not inherit feedback about something already fixed.
 */
export async function clearRevisionNote(db: Db, taskId: string): Promise<void> {
    await db.from('delphi_tasks').update({ cho_note: null }).eq('id', taskId);
}

/**
 * Take back a decision to send something back.
 *
 * Declining is cheap to do and, until now, impossible to undo — the task was
 * already in the queue and the next tick would spend real money redoing work
 * that was fine. A mis-click cost a run.
 *
 * So the refusal is reversible for exactly as long as it has not taken effect:
 * once the agent has produced a new version, there is nothing to cancel and
 * the honest answer is that it already happened. Everything the decline
 * changed is put back — the note, the attempt count, and the later steps that
 * were re-queued only because they were built on this one.
 */
export async function undoSendBack(
    db: Db,
    workspaceId: string,
    taskId: string
): Promise<{ undone: boolean; reason?: string }> {
    const { data: task } = await db
        .from('delphi_tasks')
        .select('id, title, project_id, status, revision_count')
        .eq('id', taskId)
        .maybeSingle();
    if (!task) return { undone: false, reason: 'That step no longer exists.' };

    if (task.status === 'running') {
        return { undone: false, reason: 'It is being redone right now. Let it finish, then rule on what comes back.' };
    }
    if (task.status !== 'pending') {
        return { undone: false, reason: 'It has already been redone.' };
    }

    // Whatever was re-queued because it depended on this goes back too — but
    // only what has not since re-run. A step that has already produced a new
    // version is not ours to reverse.
    const downstream = task.project_id
        ? await dependantsOf(db, task.project_id as string, taskId)
        : [];

    const restorable = [taskId, ...downstream];
    await db
        .from('delphi_tasks')
        .update({ status: 'done', cho_note: null })
        .in('id', restorable)
        .eq('status', 'pending');

    await db
        .from('delphi_tasks')
        .update({ revision_count: Math.max(0, Number(task.revision_count ?? 1) - 1) })
        .eq('id', taskId);

    await emitEvent(db, {
        workspaceId,
        projectId: (task.project_id as string) ?? undefined,
        taskId,
        type: 'revision_requested',
        actor: 'CHO',
        verb: 'took back sending it to be redone —',
        object: task.title as string,
        payload: { undo: true, restored: restorable.length },
    });

    return { undone: true };
}
