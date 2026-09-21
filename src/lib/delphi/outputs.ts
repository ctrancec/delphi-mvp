/**
 * The Outputs library — every deliverable the agents produce, in one place.
 *
 * An artifact on its own is an orphan: a report with no answer to "who wrote
 * this, from what brief, for which department?". So everything here returns
 * artifacts *with their provenance* attached, because that chain is the point
 * of the library rather than a decoration on it.
 *
 * Reads go through the caller's client, so RLS decides what comes back.
 */

import type { Artifact, ArtifactKind } from './types';
import { DelphiDbError, type Db, type Row } from './db';

/** Binaries live here. Text deliverables stay inline in `content_md`. */
export const ARTIFACT_BUCKET = 'delphi-artifacts';

export interface ArtifactRef {
    id: string;
    title: string;
}

/** An artifact plus the chain that explains where it came from. */
export interface OutputRecord {
    artifact: Artifact;
    department: ArtifactRef | null;
    project: ArtifactRef | null;
    task: (ArtifactRef & { seq: number }) | null;
    agent: (ArtifactRef & { role: string }) | null;
}

export interface OutputsFilter {
    /**
     * Optional. RLS already scopes reads to the caller's workspaces, so the UI
     * omits it; scripts running on the service key must pass it, because that
     * key bypasses RLS and would otherwise see every tenant.
     */
    workspaceId?: string;
    departmentId?: string;
    projectId?: string;
    kind?: ArtifactKind;
    /** ISO timestamp — artifacts created at or after this moment. */
    since?: string;
    limit?: number;
}

/**
 * Artifacts whose bytes live in Storage rather than in the row.
 * `content_md` is meaningless for these; they need a signed URL to be seen.
 */
const BINARY_KINDS: ReadonlySet<ArtifactKind> = new Set(['image', 'video', 'audio', 'dataset']);

export function isBinaryKind(kind: ArtifactKind): boolean {
    return BINARY_KINDS.has(kind);
}

/**
 * The embed that carries provenance.
 *
 * `!inner` on the project is what makes a department filter work: PostgREST
 * filters on an embedded resource prune the embed, not the parent row, so
 * without it a department filter would return every artifact with most of them
 * simply missing their project.
 */
const SELECT_WITH_PROVENANCE = `
    *,
    project:delphi_projects!inner (
        id, title,
        department:delphi_departments!inner ( id, name )
    ),
    task:delphi_tasks (
        id, seq, title,
        agent:delphi_agents ( id, name, title )
    )
`;

function toOutput(r: Row): OutputRecord {
    const project = r.project ?? null;
    const department = project?.department ?? null;
    const task = r.task ?? null;
    const agent = task?.agent ?? null;

    return {
        artifact: {
            id: r.id,
            workspaceId: r.workspace_id,
            projectId: r.project_id,
            taskId: r.task_id ?? null,
            kind: r.kind,
            title: r.title,
            contentMd: r.content_md ?? null,
            storagePath: r.storage_path ?? null,
            mimeType: r.mime_type ?? null,
            sizeBytes: r.size_bytes ?? null,
            data: r.data ?? {},
            createdAt: r.created_at,
        },
        department: department ? { id: department.id, title: department.name } : null,
        project: project ? { id: project.id, title: project.title } : null,
        task: task ? { id: task.id, title: task.title, seq: task.seq } : null,
        agent: agent ? { id: agent.id, title: agent.name, role: agent.title } : null,
    };
}

export async function listOutputs(db: Db, filter: OutputsFilter = {}): Promise<OutputRecord[]> {
    let q = db.from('delphi_artifacts').select(SELECT_WITH_PROVENANCE);

    if (filter.workspaceId) q = q.eq('workspace_id', filter.workspaceId);
    if (filter.departmentId) q = q.eq('project.department_id', filter.departmentId);
    if (filter.projectId) q = q.eq('project_id', filter.projectId);
    if (filter.kind) q = q.eq('kind', filter.kind);
    if (filter.since) q = q.gte('created_at', filter.since);

    const { data, error } = await q
        .order('created_at', { ascending: false })
        .limit(filter.limit ?? 200);

    if (error) throw new DelphiDbError('listOutputs', error);
    return (data ?? []).map(toOutput);
}

export async function getOutput(db: Db, id: string): Promise<OutputRecord | null> {
    const { data, error } = await db
        .from('delphi_artifacts')
        .select(SELECT_WITH_PROVENANCE)
        .eq('id', id)
        .maybeSingle();

    if (error) throw new DelphiDbError('getOutput', error);
    return data ? toOutput(data) : null;
}

/**
 * A short-lived URL for a stored binary.
 *
 * Returns null rather than throwing when the bucket does not exist yet — no
 * media agent has ever written one, so an empty library should render cleanly
 * instead of erroring on a facility nothing uses.
 */
export async function signedUrlFor(
    db: Db,
    storagePath: string,
    expiresInSeconds = 60 * 10
): Promise<string | null> {
    const { data, error } = await db.storage
        .from(ARTIFACT_BUCKET)
        .createSignedUrl(storagePath, expiresInSeconds);

    if (error) {
        console.warn(`[delphi] could not sign ${storagePath}: ${error.message}`);
        return null;
    }
    return data?.signedUrl ?? null;
}

/**
 * The filter options that actually have artifacts behind them.
 *
 * Built from the artifacts themselves rather than from the full department and
 * project lists, so the filter bar never offers a choice that returns nothing.
 */
export interface OutputsFacets {
    departments: ArtifactRef[];
    projects: (ArtifactRef & { departmentId: string | null })[];
    kinds: { kind: ArtifactKind; count: number }[];
    total: number;
}

export function facetsFrom(records: OutputRecord[]): OutputsFacets {
    const departments = new Map<string, ArtifactRef>();
    const projects = new Map<string, ArtifactRef & { departmentId: string | null }>();
    const kinds = new Map<ArtifactKind, number>();

    for (const r of records) {
        if (r.department) departments.set(r.department.id, r.department);
        if (r.project) {
            projects.set(r.project.id, {
                ...r.project,
                departmentId: r.department?.id ?? null,
            });
        }
        kinds.set(r.artifact.kind, (kinds.get(r.artifact.kind) ?? 0) + 1);
    }

    return {
        departments: [...departments.values()].sort((a, b) => a.title.localeCompare(b.title)),
        projects: [...projects.values()].sort((a, b) => a.title.localeCompare(b.title)),
        kinds: [...kinds.entries()]
            .map(([kind, count]) => ({ kind, count }))
            .sort((a, b) => b.count - a.count),
        total: records.length,
    };
}

/** Human-readable file size. Returns null when the size is unknown. */
export function formatBytes(bytes: number | null): string | null {
    if (bytes === null || bytes < 0) return null;
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let value = bytes / 1024;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit++;
    }
    return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** Roughly how long a report takes to read. Agents write dense prose; 200wpm. */
export function readingTime(markdown: string | null): string | null {
    if (!markdown) return null;
    const words = markdown.trim().split(/\s+/).filter(Boolean).length;
    if (words === 0) return null;
    const minutes = Math.max(1, Math.round(words / 200));
    return `${words.toLocaleString()} words · ${minutes} min read`;
}
