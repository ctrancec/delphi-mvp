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
    purgeArtifacts,
    restoreArtifact,
    trashArtifact,
} from './deletion';
import type { DeletionImpact, TrashResult } from './deletion';
import { checkBatch, combineImpact, eachLimited } from './bulk';
import type { BulkResult, BulkSkip, CombinedImpact } from './bulk';

// Nothing but the actions is exported from here — callers take the types from
// deletion.ts and bulk.ts. The server-action compiler registers every export
// of a 'use server' file as an action, and a re-exported type becomes a
// runtime reference to a name that does not exist: the module throws as it
// loads and every action in it fails. That took Outputs down once; see
// scripts/check_server_actions.ts.

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

// ---------------------------------------------------------------------------
// Several at once. Each item goes through the same function as a single one,
// so a bulk action refuses exactly what a single one would.
// ---------------------------------------------------------------------------

/** Titles for the selected ids, so a skipped item can be named. */
async function titlesOf(db: Db, ids: string[]): Promise<Map<string, string>> {
    const { data } = await db.from('delphi_artifacts').select('id, title').in('id', ids);
    return new Map((data ?? []).map((r) => [r.id as string, r.title as string]));
}

/** Run one item's action for each, and account for every one that did not go. */
async function forEach(
    db: Db,
    ids: string[],
    act: (id: string) => Promise<TrashResult>
): Promise<BulkResult> {
    const titles = await titlesOf(db, ids);
    const results = await eachLimited(ids, async (id) => ({ id, res: await act(id) }));
    const skipped: BulkSkip[] = results
        .filter((r) => !r.res.ok)
        .map((r) => ({ id: r.id, title: titles.get(r.id) ?? 'A deliverable', reason: r.res.error ?? 'it could not be changed' }));
    return { ok: true, done: results.length - skipped.length, skipped };
}

/** What deleting the selected would touch, counted together. */
export async function bulkDeletionImpactAction(
    ids: string[]
): Promise<{ ok: boolean; error?: string; data?: CombinedImpact }> {
    const c = await ctx();
    if ('error' in c) return { ok: false, error: c.error };
    const batch = checkBatch(ids);
    if ('error' in batch) return { ok: false, error: batch.error };

    const impacts = await eachLimited(batch.ids, (id) => deletionImpact(c.db, id));
    return { ok: true, data: combineImpact(impacts.filter((i): i is DeletionImpact => Boolean(i))) };
}

/** Move the selected to the trash. Reversible, one by one or together. */
export async function bulkDeleteOutputsAction(ids: string[]): Promise<BulkResult> {
    const c = await ctx();
    if ('error' in c) return { ok: false, error: c.error, done: 0, skipped: [] };
    const batch = checkBatch(ids);
    if ('error' in batch) return { ok: false, error: batch.error, done: 0, skipped: [] };

    const res = await forEach(c.db, batch.ids, (id) => trashArtifact(c.db, c.workspaceId, c.userId, id));
    if (res.done) refreshLibrary();
    return res;
}

/** Put the selected back. */
export async function bulkRestoreOutputsAction(ids: string[]): Promise<BulkResult> {
    const c = await ctx();
    if ('error' in c) return { ok: false, error: c.error, done: 0, skipped: [] };
    const batch = checkBatch(ids);
    if ('error' in batch) return { ok: false, error: batch.error, done: 0, skipped: [] };

    const res = await forEach(c.db, batch.ids, (id) => restoreArtifact(c.db, c.workspaceId, id));
    if (res.done) refreshLibrary();
    return res;
}

/** Destroy the selected, behind their count typed back. */
export async function bulkPurgeOutputsAction(
    ids: string[],
    typedCount: string
): Promise<TrashResult & { purged?: number }> {
    const c = await ctx();
    if ('error' in c) return { ok: false, error: c.error };
    const batch = checkBatch(ids);
    if ('error' in batch) return { ok: false, error: batch.error };

    const res = await purgeArtifacts(c.db, c.workspaceId, batch.ids, typedCount);
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
