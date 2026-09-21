/**
 * Data access for Delphi.
 *
 * Everything goes through a Supabase client the caller supplies, so the same
 * functions serve server components, route handlers and scripts. Rows come back
 * mapped into the camelCase domain types in ./types rather than raw snake_case,
 * so the rest of the system never sees the database's naming.
 *
 * RLS does the authorization. These functions never widen scope on their own —
 * a caller holding an anon-key client sees exactly what their workspace
 * membership allows.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { ALL_SEED_AGENTS, composeSystemPrompt, type SeedAgent } from './roster';
import type {
    Agent,
    AgentStats,
    Artifact,
    Channel,
    ChannelKind,
    CostTier,
    Department,
    DelphiEventType,
    Memory,
    Project,
    SourceLocator,
    Task,
} from './types';

export type Db = SupabaseClient;

/** Raw row shape helper — the DB speaks snake_case, the domain speaks camelCase. */
type Row = Record<string, any>;

export class DelphiDbError extends Error {
    constructor(operation: string, cause: { message: string; details?: string } | null) {
        super(`${operation} failed: ${cause?.message ?? 'unknown error'}${cause?.details ? ` (${cause.details})` : ''}`);
        this.name = 'DelphiDbError';
    }
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function toAgent(r: Row): Agent {
    return {
        id: r.id,
        workspaceId: r.workspace_id,
        slug: r.slug,
        name: r.name,
        title: r.title,
        avatarSeed: r.avatar_seed ?? null,
        systemPrompt: r.system_prompt,
        skills: r.skills ?? [],
        channelIds: r.channel_ids ?? [],
        model: r.model,
        costTier: r.cost_tier as CostTier,
        origin: r.origin,
        inventedFor: r.invented_for ?? null,
        archivedAt: r.archived_at ?? null,
    };
}

function toAgentStats(r: Row): AgentStats {
    return {
        agentId: r.agent_id,
        hires: r.hires,
        tasksCompleted: r.tasks_completed,
        tasksFailed: r.tasks_failed,
        avgDurationMs: r.avg_duration_ms,
        totalCostUsd: Number(r.total_cost_usd),
        avgQuality: r.avg_quality === null ? null : Number(r.avg_quality),
        lastHiredAt: r.last_hired_at ?? null,
    };
}

function toChannel(r: Row): Channel {
    return {
        id: r.id,
        workspaceId: r.workspace_id,
        kind: r.kind as ChannelKind,
        label: r.label,
        config: r.config ?? {},
        credentialRef: r.credential_ref ?? null,
        enabled: r.enabled,
        health: r.health,
        healthDetail: r.health_detail ?? null,
        lastOkAt: r.last_ok_at ?? null,
    };
}

function toDepartment(r: Row): Department {
    return {
        id: r.id,
        workspaceId: r.workspace_id,
        name: r.name,
        charter: r.charter,
        status: r.status,
        cadenceCron: r.cadence_cron ?? null,
        channelIds: r.channel_ids ?? [],
        budgetUsd: Number(r.budget_usd),
        spentUsd: Number(r.spent_usd),
        createdAt: r.created_at,
    };
}

function toProject(r: Row): Project {
    return {
        id: r.id,
        workspaceId: r.workspace_id,
        departmentId: r.department_id,
        title: r.title,
        brief: r.brief,
        status: r.status,
        budgetUsd: Number(r.budget_usd),
        spentUsd: Number(r.spent_usd),
        error: r.error ?? null,
        startedAt: r.started_at ?? null,
        finishedAt: r.finished_at ?? null,
        createdAt: r.created_at,
    };
}

function toTask(r: Row): Task {
    return {
        id: r.id,
        projectId: r.project_id,
        agentId: r.agent_id,
        seq: r.seq,
        title: r.title,
        objective: r.objective,
        dependsOn: r.depends_on ?? null,
        status: r.status,
    };
}

function toArtifact(r: Row): Artifact {
    return {
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
    };
}

function toMemory(r: Row): Memory {
    return {
        id: r.id,
        workspaceId: r.workspace_id,
        scope: r.scope,
        departmentId: r.department_id ?? null,
        agentId: r.agent_id ?? null,
        projectId: r.project_id ?? null,
        kind: r.kind,
        title: r.title,
        body: r.body,
        tags: r.tags ?? [],
        importance: r.importance,
        createdAt: r.created_at,
    };
}

// ---------------------------------------------------------------------------
// Agents and roster
// ---------------------------------------------------------------------------

export async function listAgents(
    db: Db,
    workspaceId: string,
    opts: { includeBoard?: boolean; includeArchived?: boolean } = {}
): Promise<Agent[]> {
    let q = db.from('delphi_agents').select('*').eq('workspace_id', workspaceId);
    if (!opts.includeArchived) q = q.is('archived_at', null);
    if (!opts.includeBoard) q = q.eq('is_board', false);

    const { data, error } = await q.order('slug');
    if (error) throw new DelphiDbError('listAgents', error);
    return (data ?? []).map(toAgent);
}

/** The L.L.R. board — attached to every department rather than hired per project. */
export async function listBoardAgents(db: Db, workspaceId: string): Promise<Agent[]> {
    const { data, error } = await db
        .from('delphi_agents')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('is_board', true)
        .is('archived_at', null)
        .order('slug');
    if (error) throw new DelphiDbError('listBoardAgents', error);
    return (data ?? []).map(toAgent);
}

export async function getAgentStats(
    db: Db,
    workspaceId: string
): Promise<Map<string, AgentStats>> {
    const { data, error } = await db
        .from('delphi_agent_stats')
        .select('*')
        .eq('workspace_id', workspaceId);
    if (error) throw new DelphiDbError('getAgentStats', error);

    return new Map((data ?? []).map((r) => [r.agent_id as string, toAgentStats(r)]));
}

/**
 * Seed the roster into a workspace.
 *
 * Idempotent on (workspace_id, slug): re-running adds agents introduced since
 * the last seed without clobbering track records or any edits made to existing
 * personas. Channel bindings are resolved by kind, so an agent only gets wired
 * to channels this workspace has actually connected.
 */
export async function seedRoster(
    db: Db,
    workspaceId: string
): Promise<{ inserted: number; skipped: number }> {
    const { data: existing, error: exErr } = await db
        .from('delphi_agents')
        .select('slug')
        .eq('workspace_id', workspaceId);
    if (exErr) throw new DelphiDbError('seedRoster/read', exErr);

    const have = new Set((existing ?? []).map((r) => r.slug as string));
    const channels = await listChannels(db, workspaceId);
    const channelsByKind = new Map<string, string>();
    for (const c of channels) if (!channelsByKind.has(c.kind)) channelsByKind.set(c.kind, c.id);

    const toInsert = ALL_SEED_AGENTS.filter((a) => !have.has(a.slug)).map((a: SeedAgent) => ({
        workspace_id: workspaceId,
        slug: a.slug,
        name: a.name,
        title: a.title,
        avatar_seed: a.avatarSeed,
        system_prompt: composeSystemPrompt(a),
        skills: a.skills,
        channel_ids: a.requiredChannels
            .map((k) => channelsByKind.get(k))
            .filter((id): id is string => Boolean(id)),
        model: a.model ?? 'gemini-3.8-flash',
        cost_tier: a.costTier,
        origin: 'seed',
        is_board: a.board ?? false,
    }));

    if (toInsert.length === 0) return { inserted: 0, skipped: have.size };

    const { data: inserted, error } = await db
        .from('delphi_agents')
        .insert(toInsert)
        .select('id');
    if (error) throw new DelphiDbError('seedRoster/insert', error);

    // Every agent gets a stats row up front so hiring can left-join without
    // special-casing the never-hired.
    const statRows = (inserted ?? []).map((r) => ({
        agent_id: r.id as string,
        workspace_id: workspaceId,
    }));
    if (statRows.length) {
        const { error: statErr } = await db.from('delphi_agent_stats').insert(statRows);
        if (statErr) throw new DelphiDbError('seedRoster/stats', statErr);
    }

    return { inserted: toInsert.length, skipped: have.size };
}

/** Persist an agent Delphi invented. It joins the roster permanently. */
export async function insertInventedAgent(
    db: Db,
    workspaceId: string,
    spec: {
        slug: string;
        name: string;
        title: string;
        systemPrompt: string;
        skills: string[];
        costTier: CostTier;
        requiredChannels: ChannelKind[];
    },
    departmentId: string | null
): Promise<Agent> {
    const channels = await listChannels(db, workspaceId);
    const channelIds = spec.requiredChannels
        .map((k) => channels.find((c) => c.kind === k)?.id)
        .filter((id): id is string => Boolean(id));

    const { data, error } = await db
        .from('delphi_agents')
        .insert({
            workspace_id: workspaceId,
            slug: spec.slug,
            name: spec.name,
            title: spec.title,
            avatar_seed: spec.slug,
            system_prompt: spec.systemPrompt,
            skills: spec.skills,
            channel_ids: channelIds,
            cost_tier: spec.costTier,
            origin: 'invented',
            invented_for: departmentId,
        })
        .select('*')
        .single();
    if (error) throw new DelphiDbError('insertInventedAgent', error);

    const { error: statErr } = await db
        .from('delphi_agent_stats')
        .insert({ agent_id: data.id, workspace_id: workspaceId });
    if (statErr) throw new DelphiDbError('insertInventedAgent/stats', statErr);

    return toAgent(data);
}

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

export async function listChannels(
    db: Db,
    workspaceId: string,
    onlyEnabled = false
): Promise<Channel[]> {
    let q = db.from('delphi_channels').select('*').eq('workspace_id', workspaceId);
    if (onlyEnabled) q = q.eq('enabled', true);

    const { data, error } = await q.order('label');
    if (error) throw new DelphiDbError('listChannels', error);
    return (data ?? []).map(toChannel);
}

/** Channel kinds an agent may actually be assigned work against. */
export async function availableChannelKinds(
    db: Db,
    workspaceId: string
): Promise<ChannelKind[]> {
    const channels = await listChannels(db, workspaceId, true);
    return Array.from(new Set(channels.map((c) => c.kind)));
}

// ---------------------------------------------------------------------------
// Departments and projects
// ---------------------------------------------------------------------------

export async function createDepartment(
    db: Db,
    workspaceId: string,
    input: { name: string; charter: string; budgetUsd?: number; cadenceCron?: string | null }
): Promise<Department> {
    const { data, error } = await db
        .from('delphi_departments')
        .insert({
            workspace_id: workspaceId,
            name: input.name,
            charter: input.charter,
            budget_usd: input.budgetUsd ?? 5,
            cadence_cron: input.cadenceCron ?? null,
            status: 'draft',
        })
        .select('*')
        .single();
    if (error) throw new DelphiDbError('createDepartment', error);
    return toDepartment(data);
}

export async function listDepartments(db: Db, workspaceId: string): Promise<Department[]> {
    const { data, error } = await db
        .from('delphi_departments')
        .select('*')
        .eq('workspace_id', workspaceId)
        .neq('status', 'archived')
        .order('created_at', { ascending: false });
    if (error) throw new DelphiDbError('listDepartments', error);
    return (data ?? []).map(toDepartment);
}

export async function getProject(db: Db, projectId: string): Promise<Project | null> {
    const { data, error } = await db
        .from('delphi_projects')
        .select('*')
        .eq('id', projectId)
        .maybeSingle();
    if (error) throw new DelphiDbError('getProject', error);
    return data ? toProject(data) : null;
}

export async function listTasks(db: Db, projectId: string): Promise<Task[]> {
    const { data, error } = await db
        .from('delphi_tasks')
        .select('*')
        .eq('project_id', projectId)
        .order('seq');
    if (error) throw new DelphiDbError('listTasks', error);
    return (data ?? []).map(toTask);
}

export async function listArtifacts(
    db: Db,
    where: { workspaceId: string; projectId?: string; kind?: string; limit?: number }
): Promise<Artifact[]> {
    let q = db.from('delphi_artifacts').select('*').eq('workspace_id', where.workspaceId);
    if (where.projectId) q = q.eq('project_id', where.projectId);
    if (where.kind) q = q.eq('kind', where.kind);

    const { data, error } = await q
        .order('created_at', { ascending: false })
        .limit(where.limit ?? 100);
    if (error) throw new DelphiDbError('listArtifacts', error);
    return (data ?? []).map(toArtifact);
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

/**
 * Retrieve organizational memory relevant to a brief.
 *
 * Full-text search over the generated tsvector, filtered by scope. Vectors are
 * reserved on the column but unused: FTS is deterministic, free, and far easier
 * to debug while the engine is new.
 */
export async function recallMemories(
    db: Db,
    workspaceId: string,
    query: string,
    limit = 8
): Promise<Memory[]> {
    // websearch_to_tsquery tolerates arbitrary user prose, where plainto_ can
    // still choke on punctuation-heavy briefs.
    const { data, error } = await db
        .from('delphi_memories')
        .select('*')
        .eq('workspace_id', workspaceId)
        .textSearch('ts', query, { type: 'websearch', config: 'english' })
        .order('importance', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(limit);

    if (error) {
        // A malformed query should degrade to "no memories", never fail hiring.
        console.warn('[delphi] memory recall failed, continuing without:', error.message);
        return [];
    }
    return (data ?? []).map(toMemory);
}

export async function writeMemory(
    db: Db,
    workspaceId: string,
    input: {
        scope: Memory['scope'];
        kind: Memory['kind'];
        title: string;
        body: string;
        tags?: string[];
        importance?: number;
        departmentId?: string | null;
        agentId?: string | null;
        projectId?: string | null;
    }
): Promise<void> {
    const { error } = await db.from('delphi_memories').insert({
        workspace_id: workspaceId,
        scope: input.scope,
        kind: input.kind,
        title: input.title,
        body: input.body,
        tags: input.tags ?? [],
        importance: input.importance ?? 3,
        department_id: input.departmentId ?? null,
        agent_id: input.agentId ?? null,
        project_id: input.projectId ?? null,
    });
    if (error) throw new DelphiDbError('writeMemory', error);
}

// ---------------------------------------------------------------------------
// Events — the activity log
// ---------------------------------------------------------------------------

// Declared in ./types alongside the rest of the domain model.
export type { SourceLocator } from './types';

export interface EmitEventInput {
    workspaceId: string;
    departmentId?: string | null;
    projectId?: string | null;
    taskId?: string | null;
    type: DelphiEventType;
    /** Agent display name, for the quest-log line. */
    actor?: string;
    /** What they did, in plain past tense: "found an important scene". */
    verb?: string;
    /** What it applied to: "clip_03.mp4". */
    object?: string;
    locator?: SourceLocator;
    durationMs?: number;
    payload?: Record<string, unknown>;
}

/**
 * Append to the activity log.
 *
 * Never throws: a logging failure must not take down a task that otherwise
 * succeeded. Failures are surfaced on the console instead.
 */
export async function emitEvent(db: Db, input: EmitEventInput): Promise<void> {
    const { error } = await db.from('delphi_events').insert({
        workspace_id: input.workspaceId,
        department_id: input.departmentId ?? null,
        project_id: input.projectId ?? null,
        task_id: input.taskId ?? null,
        type: input.type,
        payload: {
            ...(input.payload ?? {}),
            ...(input.actor ? { actor: input.actor } : {}),
            ...(input.verb ? { verb: input.verb } : {}),
            ...(input.object ? { object: input.object } : {}),
            ...(input.locator ? { locator: input.locator } : {}),
            ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
        },
    });
    if (error) console.warn('[delphi] emitEvent failed:', error.message);
}

// ---------------------------------------------------------------------------
// System state — the master switch
// ---------------------------------------------------------------------------

export type SystemMode = 'running' | 'paused' | 'stopped';

/**
 * Read the master switch. Defaults to 'running' when no row exists yet so a
 * fresh workspace is not silently halted.
 */
export async function getSystemMode(db: Db, workspaceId: string): Promise<SystemMode> {
    const { data, error } = await db
        .from('delphi_system_state')
        .select('mode')
        .eq('workspace_id', workspaceId)
        .maybeSingle();
    if (error) throw new DelphiDbError('getSystemMode', error);
    return (data?.mode as SystemMode) ?? 'running';
}

export async function setSystemMode(
    db: Db,
    workspaceId: string,
    mode: SystemMode,
    reason?: string
): Promise<void> {
    const { error } = await db.from('delphi_system_state').upsert(
        {
            workspace_id: workspaceId,
            mode,
            reason: reason ?? null,
            changed_at: new Date().toISOString(),
        },
        { onConflict: 'workspace_id' }
    );
    if (error) throw new DelphiDbError('setSystemMode', error);
}
