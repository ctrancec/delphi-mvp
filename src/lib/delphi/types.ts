/**
 * Domain types for Delphi, the AI CEO.
 *
 *   CHO (you) -> Delphi (CEO) -> Departments -> Agents -> Tasks
 *
 * Departments are standing organizations with a charter, a hired team, bound
 * channels and a budget. Projects are bounded runs through a department's
 * pipeline. A task is one agent doing one thing and handing off to the next.
 *
 * Names mirror the G.H.O. City spec in ctrancec/ai-worlds (Company -> Department)
 * so this core stays portable to the pixel-city shell.
 */

export type ChannelKind =
    | 'mcp'
    | 'perplexity'
    | 'worldmonitor'
    | 'higgsfield'
    | 'gdrive'
    | 'fred'
    | 'rss'
    | 'telegram'
    | 'local_fs'
    | 'http';

export type ChannelHealth = 'unknown' | 'ok' | 'degraded' | 'error';

export interface Channel {
    id: string;
    workspaceId: string;
    kind: ChannelKind;
    label: string;
    config: Record<string, unknown>;
    credentialRef: string | null;
    enabled: boolean;
    health: ChannelHealth;
    healthDetail: string | null;
    lastOkAt: string | null;
}

/** 1 = cheap/fast, 2 = standard, 3 = expensive/deep. An agent's "salary". */
export type CostTier = 1 | 2 | 3;

export interface Agent {
    id: string;
    workspaceId: string;
    slug: string;
    name: string;
    title: string;
    avatarSeed: string | null;
    systemPrompt: string;
    skills: string[];
    channelIds: string[];
    model: string;
    costTier: CostTier;
    origin: 'seed' | 'invented';
    inventedFor: string | null;
    archivedAt: string | null;
}

export interface AgentStats {
    agentId: string;
    hires: number;
    tasksCompleted: number;
    tasksFailed: number;
    avgDurationMs: number;
    totalCostUsd: number;
    avgQuality: number | null;
    lastHiredAt: string | null;
}

export type DepartmentStatus =
    | 'draft'
    | 'hiring'
    | 'awaiting_approval'
    | 'active'
    | 'paused'
    | 'archived';

export interface Department {
    id: string;
    workspaceId: string;
    name: string;
    charter: string;
    status: DepartmentStatus;
    cadenceCron: string | null;
    channelIds: string[];
    budgetUsd: number;
    spentUsd: number;
    createdAt: string;
}

export interface Hire {
    id: string;
    departmentId: string;
    agentId: string;
    score: number;
    rationale: string;
    seq: number;
}

export type ProjectStatus =
    | 'draft'
    | 'planning'
    | 'awaiting_approval'
    | 'running'
    | 'paused'
    | 'done'
    | 'failed'
    | 'halted_budget'
    | 'cancelled';

export interface Project {
    id: string;
    workspaceId: string;
    departmentId: string;
    title: string;
    brief: string;
    status: ProjectStatus;
    budgetUsd: number;
    spentUsd: number;
    error: string | null;
    startedAt: string | null;
    finishedAt: string | null;
    createdAt: string;
}

export type TaskStatus =
    | 'pending'
    | 'running'
    | 'awaiting_approval'
    | 'done'
    | 'failed'
    | 'skipped';

export interface Task {
    id: string;
    projectId: string;
    agentId: string;
    seq: number;
    title: string;
    objective: string;
    /** The handoff edge: the task whose artifact feeds this one. */
    dependsOn: string | null;
    status: TaskStatus;
}

export interface TaskRun {
    id: string;
    taskId: string;
    attempt: number;
    status: 'running' | 'done' | 'failed' | 'cancelled';
    model: string | null;
    promptTokens: number;
    completionTokens: number;
    cachedTokens: number;
    costUsd: number;
    output: unknown;
    error: string | null;
    startedAt: string;
    finishedAt: string | null;
}

export type ArtifactKind =
    | 'report'
    | 'doc'
    | 'dataset'
    | 'image'
    | 'video'
    | 'audio'
    | 'social_draft'
    | 'brief'
    | 'other';

export interface Artifact {
    id: string;
    workspaceId: string;
    projectId: string;
    taskId: string | null;
    kind: ArtifactKind;
    title: string;
    contentMd: string | null;
    storagePath: string | null;
    mimeType: string | null;
    sizeBytes: number | null;
    data: Record<string, unknown>;
    createdAt: string;
}

/**
 * Actions that reach the outside world or cannot be undone.
 * Every one of these blocks its task until the CHO decides.
 */
export type ApprovalAction =
    | 'social_post'
    | 'publish'
    | 'send_email'
    | 'send_message'
    | 'spend'
    | 'file_write'
    | 'file_delete'
    | 'external_api'
    | 'other';

export interface Approval {
    id: string;
    workspaceId: string;
    projectId: string | null;
    taskId: string | null;
    actionType: ApprovalAction;
    summary: string;
    payload: Record<string, unknown>;
    risk: 'low' | 'medium' | 'high';
    status: 'pending' | 'approved' | 'rejected' | 'expired' | 'cancelled';
    conditions: string | null;
    decidedBy: string | null;
    decidedAt: string | null;
    createdAt: string;
}

export type MemoryScope = 'org' | 'department' | 'agent' | 'project';
export type MemoryKind = 'fact' | 'preference' | 'lesson' | 'outcome';

export interface Memory {
    id: string;
    workspaceId: string;
    scope: MemoryScope;
    departmentId: string | null;
    agentId: string | null;
    projectId: string | null;
    kind: MemoryKind;
    title: string;
    body: string;
    tags: string[];
    importance: number;
    createdAt: string;
}

/** Event types written to delphi_events; the UI renders these as the live feed. */
export type DelphiEventType =
    | 'department_created'
    | 'hiring_started'
    | 'agent_hired'
    | 'agent_invented'
    | 'plan_proposed'
    | 'plan_approved'
    | 'project_started'
    | 'task_started'
    | 'task_done'
    | 'task_failed'
    | 'handoff'
    | 'artifact_created'
    | 'approval_requested'
    | 'approval_decided'
    | 'cost_recorded'
    | 'budget_halted'
    | 'agent_rehired'
    | 'project_done'
    | 'project_failed'
    | 'memory_written';

export interface DelphiEvent {
    id: number;
    workspaceId: string;
    departmentId: string | null;
    projectId: string | null;
    taskId: string | null;
    type: DelphiEventType;
    payload: Record<string, unknown>;
    createdAt: string;
}

// ---------------------------------------------------------------------------
// Hiring
// ---------------------------------------------------------------------------

/** A brand-new agent Delphi drafts when nothing in the roster fits. */
export interface InventedAgentSpec {
    slug: string;
    name: string;
    title: string;
    systemPrompt: string;
    skills: string[];
    costTier: CostTier;
    /** Channel kinds this agent needs, resolved to ids at insert time. */
    requiredChannels: ChannelKind[];
    reason: string;
}

export interface PlannedTask {
    seq: number;
    title: string;
    objective: string;
    /** Slug of a roster agent, when Delphi hires an existing specialist. */
    assignedSlug?: string;
    /** A new hire, when no roster agent fits. */
    newAgent?: InventedAgentSpec;
    rationale: string;
    /** Delphi's own judgement of how well this agent fits this task, 0..1. */
    fit: number;
}

export interface StaffingPlan {
    departmentName: string;
    summary: string;
    tasks: PlannedTask[];
    estimatedCostUsd: number;
    requiredChannels: ChannelKind[];
}

/** A roster agent scored against a brief, before the LLM sees it. */
export interface Candidate {
    agent: Agent;
    stats: AgentStats | null;
    /** Deterministic skill-overlap score, 0..1. Used to shortlist. */
    skillMatch: number;
}
