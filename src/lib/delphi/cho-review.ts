'use server';

/**
 * The CHO's verdict on a finished deliverable.
 *
 * Approving finalises it. Declining sends the task that produced it back to
 * the agent with the reason attached, and keeps the declined draft rather than
 * deleting it — the trail from a refused version to the one that satisfied is
 * the record of what the feedback actually changed.
 *
 * **Delphi still cannot approve anything.** This runs under the CHO's own
 * session and RLS. The CEO's only part in it is deciding who tries next.
 */

import { cache } from 'react';
import { revalidatePath } from 'next/cache';
import { createClient, currentUser } from '@/lib/supabase/server';
import { emitEvent, isMissingColumn, type Db } from './db';
import { findWorkspace } from './bootstrap';
import { sendTaskBack, undoSendBack } from './revision';

export interface ReviewResult {
    ok: boolean;
    error?: string;
    /** Set when the decision handed the task to a different agent. */
    escalatedTo?: string;
}

const ctx = cache(async function ctx(): Promise<
    { db: Db; workspaceId: string; userId: string } | { error: string }
> {
    const db = await createClient();
    if (!db) return { error: 'Supabase is not configured.' };

    const user = await currentUser();
    if (!user) return { error: 'You are not signed in.' };

    const workspaceId = await findWorkspace(db);
    if (!workspaceId) return { error: 'No workspace yet.' };

    return { db, workspaceId, userId: user.id };
});

/**
 * Rule on a deliverable, or change your mind about one.
 *
 * Every verdict is reversible. Accepting something by accident used to be
 * permanent, which made the Accept button quietly the most dangerous control
 * on the page — and declining by accident cost a real run. Neither is now:
 * `pending` withdraws a verdict outright, and moving off `declined` cancels
 * the redo it started, for exactly as long as the agent has not begun it.
 *
 * What cannot be taken back is said plainly rather than hidden. Once the work
 * has been redone there is nothing left to cancel, and pretending otherwise
 * would be worse than the honest refusal.
 */
export async function reviewOutputAction(
    artifactId: string,
    decision: 'approved' | 'declined' | 'pending',
    note?: string
): Promise<ReviewResult> {
    const c = await ctx();
    if ('error' in c) return { ok: false, error: c.error };
    const { db, workspaceId, userId } = c;

    const trimmed = note?.trim() ?? '';
    if (decision === 'declined' && trimmed.length < 10) {
        // An agent cannot act on "no". Requiring a reason is not ceremony — it
        // is the entire mechanism by which the next attempt is different.
        return { ok: false, error: 'Say what needs to change — the agent works from this.' };
    }

    const { data: artifact, error: readErr } = await db
        .from('delphi_artifacts')
        .select('id, title, task_id, project_id, review_status')
        .eq('id', artifactId)
        .maybeSingle();

    if (readErr) return { ok: false, error: readErr.message };
    if (!artifact) return { ok: false, error: 'That deliverable no longer exists.' };

    if (artifact.review_status === 'superseded') {
        return {
            ok: false,
            error: 'A later version replaced this one. Rule on that instead.',
        };
    }

    // Walking back a decline means cancelling the redo it started — which is
    // only possible while the agent has not started. Done first, so a failure
    // to cancel does not leave the verdict changed and the queue still moving.
    if (artifact.review_status === 'declined' && decision !== 'declined' && artifact.task_id) {
        const undo = await undoSendBack(db, workspaceId, artifact.task_id as string);
        if (!undo.undone) return { ok: false, error: undo.reason ?? 'That can no longer be undone.' };
    }

    const { error: updErr } = await db
        .from('delphi_artifacts')
        .update({
            review_status: decision,
            review_note: trimmed || null,
            // Cleared on withdrawal rather than left behind: a timestamp for a
            // verdict nobody holds any more is a record of nothing.
            reviewed_by: decision === 'pending' ? null : userId,
            reviewed_at: decision === 'pending' ? null : new Date().toISOString(),
        })
        .eq('id', artifactId);

    if (updErr) {
        // Said plainly rather than as a PostgREST error string: the CHO is the
        // one who runs the migration, so the remedy belongs in front of them.
        return {
            ok: false,
            error: isMissingColumn(updErr)
                ? 'Reviewing needs migration 0004 applied to the database first.'
                : updErr.message,
        };
    }

    await emitEvent(db, {
        workspaceId,
        projectId: (artifact.project_id as string) ?? undefined,
        taskId: (artifact.task_id as string) ?? undefined,
        type: 'output_reviewed',
        actor: 'CHO',
        verb:
            decision === 'approved'
                ? artifact.review_status === 'declined'
                    ? 'took back sending it back, and accepted'
                    : 'accepted'
                : decision === 'pending'
                  ? 'withdrew their verdict on'
                  : 'declined',
        object: artifact.title as string,
        payload: { decision, note: trimmed || null },
    });

    let escalatedTo: string | undefined;
    if (decision === 'declined' && artifact.task_id) {
        const out = await sendTaskBack(db, workspaceId, artifact.task_id as string, trimmed, 'output');
        escalatedTo = out.escalatedTo;
    }

    revalidatePath('/dashboard/delphi/outputs');
    revalidatePath('/dashboard/delphi', 'layout');
    return { ok: true, escalatedTo };
}
