/**
 * "Are my reports ready?" — answered without having to go and look.
 *
 * Delphi runs server-side on a schedule, so work finishes while nothing is
 * open. Without a count of what has landed since you last looked, the only way
 * to find out is to check the Outputs page on the off-chance, which is exactly
 * the chore an AI CEO is supposed to remove.
 *
 * The marker is `delphi_user_state.updated_at`, which already exists and which
 * nothing else writes. Slightly overloaded — the column is named for general
 * activity — but the alternative is a migration for one timestamp, and the
 * semantics here are the ones that matter: when did this person last see the
 * Outputs library.
 */

import type { Db } from './db';

export interface NewWork {
    /** Deliverables produced since the CHO last opened Outputs. */
    newOutputs: number;
    /** Newest title, for a notification worth reading. */
    latestTitle: string | null;
    latestAt: string | null;
}

async function lastSeenAt(db: Db, workspaceId: string, userId: string): Promise<string | null> {
    const { data } = await db
        .from('delphi_user_state')
        .select('updated_at')
        .eq('workspace_id', workspaceId)
        .eq('user_id', userId)
        .maybeSingle();

    return (data?.updated_at as string) ?? null;
}

export async function countNewOutputs(
    db: Db,
    workspaceId: string,
    userId: string
): Promise<NewWork> {
    const since = await lastSeenAt(db, workspaceId, userId);

    let q = db
        .from('delphi_artifacts')
        .select('title, created_at', { count: 'exact' })
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false })
        .limit(1);

    // No marker means they have never opened Outputs, so everything is new —
    // which is the correct answer for a first visit, not a bug.
    if (since) q = q.gt('created_at', since);

    const { data, count, error } = await q;
    if (error) return { newOutputs: 0, latestTitle: null, latestAt: null };

    return {
        newOutputs: count ?? 0,
        latestTitle: (data?.[0]?.title as string) ?? null,
        latestAt: (data?.[0]?.created_at as string) ?? null,
    };
}

/**
 * Record that the CHO has now seen what was there.
 *
 * Called when the Outputs page renders. Deliberately not called from the
 * badge's own read — a count that clears itself by being displayed would be
 * a count you could miss by glancing at the wrong moment.
 */
export async function markOutputsSeen(
    db: Db,
    workspaceId: string,
    userId: string
): Promise<void> {
    const { error } = await db.from('delphi_user_state').upsert(
        {
            workspace_id: workspaceId,
            user_id: userId,
            updated_at: new Date().toISOString(),
        },
        { onConflict: 'workspace_id,user_id' }
    );
    if (error) console.warn('[delphi] could not record the outputs visit:', error.message);
}
