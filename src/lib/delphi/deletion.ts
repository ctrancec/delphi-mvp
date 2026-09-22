/**
 * Removing a deliverable from the library.
 *
 * Deletion is the only thing in Delphi that cannot be taken back, which sits
 * badly beside everything else: a verdict can be withdrawn, a hire un-hired, a
 * refusal cancelled. So it is two acts, not one. **Trashing** moves an output
 * out of the library, where it stays readable and can be restored.
 * **Purging** destroys it, behind the title typed back — the same discipline
 * department deletion uses, for the same reason: the cost is invisible until
 * it is paid.
 *
 * What trashing does *not* do is tidy up after itself in the pipeline. If a
 * later step was built on this, that step keeps the work it already produced;
 * it is named in the impact readout rather than silently re-queued, because
 * spending a run to fix something the CHO may not care about is its own kind
 * of wrong. Re-run it later and the runtime halts honestly — see
 * `resolveUpstream`, which until this landed told the next agent it was first
 * in the pipeline and let it write a confident report from nothing.
 *
 * Takes a `Db` rather than resolving one, so the whole of it can be exercised
 * against a fake database with no network. `trash.ts` wraps it as the CHO's
 * server actions.
 */

import { emitEvent, isMissingColumn, type Db } from './db';
import { dependantsOf } from './revision';
import { ARTIFACT_BUCKET } from './outputs';

export interface TrashResult {
    ok: boolean;
    error?: string;
}

export interface DeletionImpact {
    title: string;
    /** Which later steps consumed this. Named, not touched. */
    dependants: { seq: number; title: string }[];
    /** True when nothing else survives for the task that made this. */
    onlyVersion: boolean;
    /** A stored binary goes with it. */
    hasFile: boolean;
    reviewStatus: string;
}

export const MIGRATION_NEEDED =
    'Deleting outputs needs migration 0006 applied to the database first.';

/**
 * What removing this would mean, in the concrete.
 *
 * Counts rather than warnings, because "this may affect other steps" is not
 * something anyone can weigh. Mirrors `departmentDeletionImpactAction`.
 */
export async function deletionImpact(db: Db, artifactId: string): Promise<DeletionImpact | null> {
    const { data: artifact } = await db
        .from('delphi_artifacts')
        .select('id, title, task_id, project_id, storage_path, review_status')
        .eq('id', artifactId)
        .maybeSingle();

    if (!artifact) return null;

    let dependants: { seq: number; title: string }[] = [];
    let onlyVersion = true;

    if (artifact.task_id && artifact.project_id) {
        const ids = await dependantsOf(db, artifact.project_id as string, artifact.task_id as string);
        if (ids.length) {
            const { data: rows } = await db
                .from('delphi_tasks')
                .select('seq, title')
                .in('id', ids)
                .order('seq');
            dependants = (rows ?? []) as { seq: number; title: string }[];
        }

        // Other living versions of the same step. A trashed v2 leaves v1 to
        // feed the pipeline, which is why this is worth saying out loud.
        //
        // Before migration 0006 this query errors on the missing column and
        // `siblings` comes back null, which reads as "the only version" — the
        // cautious answer, and the delete that follows names the migration.
        const { data: siblings } = await db
            .from('delphi_artifacts')
            .select('id')
            .eq('task_id', artifact.task_id)
            .neq('id', artifactId)
            .is('deleted_at', null);
        onlyVersion = (siblings ?? []).length === 0;
    }

    return {
        title: artifact.title as string,
        dependants,
        onlyVersion,
        hasFile: Boolean(artifact.storage_path),
        reviewStatus: (artifact.review_status as string) ?? 'pending',
    };
}

/** Move it to the trash. Reversible. */
export async function trashArtifact(
    db: Db,
    workspaceId: string,
    userId: string,
    artifactId: string
): Promise<TrashResult> {
    const { data: artifact } = await db
        .from('delphi_artifacts')
        .select('id, title, task_id, project_id')
        .eq('id', artifactId)
        .maybeSingle();
    if (!artifact) return { ok: false, error: 'That deliverable no longer exists.' };

    const { error } = await db
        .from('delphi_artifacts')
        .update({ deleted_at: new Date().toISOString(), deleted_by: userId })
        .eq('id', artifactId);

    if (error) {
        // Said plainly rather than as a PostgREST string: the CHO is the one
        // who runs the migration, so the remedy belongs in front of them.
        return { ok: false, error: isMissingColumn(error) ? MIGRATION_NEEDED : error.message };
    }

    await emitEvent(db, {
        workspaceId,
        projectId: (artifact.project_id as string) ?? undefined,
        taskId: (artifact.task_id as string) ?? undefined,
        type: 'output_reviewed',
        actor: 'CHO',
        verb: 'moved to the trash',
        object: artifact.title as string,
        payload: { deleted: true },
    });

    return { ok: true };
}

/** Put it back. */
export async function restoreArtifact(
    db: Db,
    workspaceId: string,
    artifactId: string
): Promise<TrashResult> {
    const { data: artifact } = await db
        .from('delphi_artifacts')
        .select('id, title, task_id, project_id')
        .eq('id', artifactId)
        .maybeSingle();
    if (!artifact) return { ok: false, error: 'That deliverable no longer exists.' };

    const { error } = await db
        .from('delphi_artifacts')
        .update({ deleted_at: null, deleted_by: null })
        .eq('id', artifactId);

    if (error) {
        return { ok: false, error: isMissingColumn(error) ? MIGRATION_NEEDED : error.message };
    }

    await emitEvent(db, {
        workspaceId,
        projectId: (artifact.project_id as string) ?? undefined,
        taskId: (artifact.task_id as string) ?? undefined,
        type: 'output_reviewed',
        actor: 'CHO',
        verb: 'restored from the trash',
        object: artifact.title as string,
        payload: { restored: true },
    });

    return { ok: true };
}

/**
 * Destroy it.
 *
 * The title has to be typed back. Not friction for its own sake: this is the
 * only control in the system with no way back, and the one thing that reliably
 * separates "I meant this" from "I tapped the wrong row" is having to look at
 * what you are about to lose and write it out.
 */
export async function purgeArtifact(
    db: Db,
    workspaceId: string,
    artifactId: string,
    typedTitle: string
): Promise<TrashResult> {
    // `*` rather than naming `deleted_at`: before migration 0006 the column is
    // not there, and a select that names it errors instead of telling the CHO
    // what to do about it. Absent, it reads as falsy, and the guard below says
    // to trash it first — which is true, and is the right next step.
    const { data: artifact } = await db
        .from('delphi_artifacts')
        .select('*')
        .eq('id', artifactId)
        .maybeSingle();
    if (!artifact) return { ok: false, error: 'That deliverable no longer exists.' };

    if (!artifact.deleted_at) {
        // Two acts, in order. Purging straight from the library would collapse
        // them back into one.
        return { ok: false, error: 'Move it to the trash first, then delete it for good.' };
    }
    if (typedTitle.trim() !== String(artifact.title).trim()) {
        return { ok: false, error: 'The title does not match.' };
    }

    // The file first. A purged row with an orphaned object left behind is a
    // bill nobody can see and nothing can find.
    if (artifact.storage_path) {
        const { error: rmErr } = await db.storage
            .from(ARTIFACT_BUCKET)
            .remove([artifact.storage_path as string]);
        if (rmErr) {
            console.warn(`[delphi] could not remove ${artifact.storage_path}: ${rmErr.message}`);
        }
    }

    const { error } = await db.from('delphi_artifacts').delete().eq('id', artifactId);
    if (error) return { ok: false, error: error.message };

    await emitEvent(db, {
        workspaceId,
        projectId: (artifact.project_id as string) ?? undefined,
        taskId: (artifact.task_id as string) ?? undefined,
        type: 'output_reviewed',
        actor: 'CHO',
        verb: 'permanently deleted',
        object: artifact.title as string,
        payload: { purged: true },
    });

    return { ok: true };
}

/**
 * Destroy everything in the trash.
 *
 * Confirmed by the count rather than a name, since there is no single title to
 * type — but still confirmed, because this is the one control that can lose
 * more in a tap than any other.
 */
export async function emptyTrash(
    db: Db,
    workspaceId: string,
    typedCount: string
): Promise<TrashResult & { purged?: number }> {
    const { data: trashed, error: readErr } = await db
        .from('delphi_artifacts')
        .select('id, title, storage_path')
        .eq('workspace_id', workspaceId)
        .not('deleted_at', 'is', null);

    if (readErr) {
        return { ok: false, error: isMissingColumn(readErr) ? MIGRATION_NEEDED : readErr.message };
    }

    const rows = (trashed ?? []) as { id: string; storage_path: string | null }[];
    if (rows.length === 0) return { ok: false, error: 'The trash is already empty.' };

    // The count is read now, and confirmed against now. If something landed in
    // the trash since the page rendered, the typed number no longer matches
    // and the CHO is asked again against the real total rather than silently
    // destroying more than they agreed to.
    if (typedCount.trim() !== String(rows.length)) {
        return { ok: false, error: `Type ${rows.length} to confirm.` };
    }

    const paths = rows.map((r) => r.storage_path).filter((p): p is string => Boolean(p));
    if (paths.length) {
        const { error: rmErr } = await db.storage.from(ARTIFACT_BUCKET).remove(paths);
        if (rmErr) console.warn(`[delphi] could not remove ${paths.length} file(s): ${rmErr.message}`);
    }

    const { error } = await db
        .from('delphi_artifacts')
        .delete()
        .in(
            'id',
            rows.map((r) => r.id)
        );
    if (error) return { ok: false, error: error.message };

    await emitEvent(db, {
        workspaceId,
        type: 'output_reviewed',
        actor: 'CHO',
        verb: 'emptied the trash —',
        object: `${rows.length} deliverable${rows.length === 1 ? '' : 's'} permanently deleted`,
        payload: { purged: rows.length },
    });

    return { ok: true, purged: rows.length };
}
