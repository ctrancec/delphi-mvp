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

export interface SendBackOutcome {
    /** Set when this decision changed who is working on the task. */
    escalatedTo?: string;
    /** Which attempt the CHO has just refused. */
    revision: number;
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
    if (!task) return { revision: 0 };

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

    await emitEvent(db, {
        workspaceId,
        projectId: (task.project_id as string) ?? undefined,
        taskId,
        type: 'revision_requested',
        actor: 'CHO',
        verb: `sent ${source === 'output' ? 'the deliverable' : 'the proposed action'} back to`,
        object: `${(agent?.name as string) ?? 'the agent'} — ${note.slice(0, 120)}`,
        payload: { source, revision, note },
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
        if (outcome.replaced) return { revision, escalatedTo: outcome.toAgent };
    }

    return { revision };
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
