/**
 * Where rendered files go: the artifacts bucket, under the workspace.
 *
 * Paths are `<workspace>/<project>/<task>/<file>`. The first segment is what
 * the storage policies check membership against, so a file is readable by
 * exactly the people who can read the artifact row that points at it.
 */

import { ARTIFACT_BUCKET } from '@/lib/delphi/outputs';
import type { Db } from '@/lib/delphi/db';

export function objectPath(workspaceId: string, projectId: string, taskId: string, file: string): string {
    return `${workspaceId}/${projectId}/${taskId}/${file}`;
}

/** The moment, as a path segment, for files that belong to no task. */
export function stamp(now = new Date()): string {
    return now.toISOString().replace(/[:.]/g, '-');
}

export class StorageError extends Error {
    constructor(message: string, readonly remedy: string) {
        super(message);
        this.name = 'StorageError';
    }
}

/**
 * Upload one file. Overwrites, so a re-render of the same task replaces its
 * files rather than failing on them.
 */
export async function uploadObject(db: Db, objectName: string, bytes: Buffer, contentType: string): Promise<void> {
    const { error } = await db.storage
        .from(ARTIFACT_BUCKET)
        .upload(objectName, new Blob([new Uint8Array(bytes)], { type: contentType }), { contentType, upsert: true });

    if (!error) return;

    const msg = error.message ?? 'unknown error';
    if (/bucket not found/i.test(msg)) {
        throw new StorageError(
            `The storage bucket "${ARTIFACT_BUCKET}" does not exist.`,
            'Run migration 0011 in the Supabase SQL editor: it creates the bucket and the policies that let members read rendered files.'
        );
    }
    if (/row-level security|not authorized|403/i.test(msg)) {
        throw new StorageError(
            `Storage refused the upload to ${objectName}: ${msg}`,
            'The storage policies from migration 0011 are missing, or this is not the workspace owner. Run the migration, then run the step again.'
        );
    }
    if (/exceeded|too large|maximum size/i.test(msg)) {
        throw new StorageError(`The file is too large for the bucket: ${msg}`, 'Shorten the video or switch the account to HD quality.');
    }
    throw new StorageError(`Upload of ${objectName} failed: ${msg}`, 'Check Supabase Storage is reachable, then run the step again.');
}
