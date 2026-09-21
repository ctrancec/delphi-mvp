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
import { sendTaskBack } from './revision';

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

export async function reviewOutputAction(
    artifactId: string,
    decision: 'approved' | 'declined',
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

    const { error: updErr } = await db
        .from('delphi_artifacts')
        .update({
            review_status: decision,
            review_note: trimmed || null,
            reviewed_by: userId,
            reviewed_at: new Date().toISOString(),
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
        verb: decision === 'approved' ? 'accepted' : 'declined',
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
