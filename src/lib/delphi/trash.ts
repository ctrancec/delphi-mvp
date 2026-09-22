'use server';

/**
 * The CHO's controls for removing a deliverable.
 *
 * Thin wrappers over `deletion.ts`, which holds the logic and takes a database
 * so it can be exercised without one. The split is the same one `cho-review.ts`
 * has over `revision.ts`, and for the same reason: an action that resolves its
 * own client is an action nothing can test.
 *
 * Runs under the CHO's own session and RLS. **Delphi cannot delete anything** —
 * removing work is a judgement about whether it was worth having, which is the
 * CHO's alone.
 */

import { cache } from 'react';
import { revalidatePath } from 'next/cache';
import { createClient, currentUser } from '@/lib/supabase/server';
import type { Db } from './db';
import { findWorkspace } from './bootstrap';
import {
    deletionImpact,
    emptyTrash,
    purgeArtifact,
    restoreArtifact,
    trashArtifact,
    type DeletionImpact,
    type TrashResult,
} from './deletion';

export type { DeletionImpact, TrashResult };

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

/** Both views change: the library loses a row, the trash gains one. */
function refreshLibrary() {
    revalidatePath('/dashboard/delphi/outputs');
    revalidatePath('/dashboard/delphi', 'layout');
}

/** What removing this would mean, shown before anyone is asked to confirm. */
export async function outputDeletionImpactAction(
    artifactId: string
): Promise<{ ok: boolean; error?: string; data?: DeletionImpact }> {
    const c = await ctx();
    if ('error' in c) return { ok: false, error: c.error };

    const impact = await deletionImpact(c.db, artifactId);
    if (!impact) return { ok: false, error: 'That deliverable no longer exists.' };
    return { ok: true, data: impact };
}

/** Move it to the trash. Reversible. */
export async function deleteOutputAction(artifactId: string): Promise<TrashResult> {
    const c = await ctx();
    if ('error' in c) return { ok: false, error: c.error };

    const res = await trashArtifact(c.db, c.workspaceId, c.userId, artifactId);
    if (res.ok) refreshLibrary();
    return res;
}

/** Put it back. */
export async function restoreOutputAction(artifactId: string): Promise<TrashResult> {
    const c = await ctx();
    if ('error' in c) return { ok: false, error: c.error };

    const res = await restoreArtifact(c.db, c.workspaceId, artifactId);
    if (res.ok) refreshLibrary();
    return res;
}

/** Destroy it, behind the title typed back. */
export async function purgeOutputAction(
    artifactId: string,
    typedTitle: string
): Promise<TrashResult> {
    const c = await ctx();
    if ('error' in c) return { ok: false, error: c.error };

    const res = await purgeArtifact(c.db, c.workspaceId, artifactId, typedTitle);
    if (res.ok) refreshLibrary();
    return res;
}

/** Destroy everything in it, behind the count typed back. */
export async function emptyTrashAction(
    typedCount: string
): Promise<TrashResult & { purged?: number }> {
    const c = await ctx();
    if ('error' in c) return { ok: false, error: c.error };

    const res = await emptyTrash(c.db, c.workspaceId, typedCount);
    if (res.ok) refreshLibrary();
    return res;
}
