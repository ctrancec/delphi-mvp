/**
 * Who is doing what, right now, for the town.
 *
 * The town draws every agent at a desk in a pose, so this answers one
 * question per agent — what are they doing? — from the same tables the
 * pipeline writes. The answer is derived in a pure function from plain rows,
 * which is what makes the precedence testable: a stopped system beats a
 * running task, a running task beats the clock, and so on down.
 *
 * Reading is two short rounds of lean selects. Tasks are fetched only for
 * projects still in flight and for the handful touched in the last day, so
 * a workspace with a year of finished work costs the same as a new one.
 */

import type { AgentState } from '@/lib/pixel/animate';
import { DELPHI_SLUG, getSystemState, type Db, type SystemMode } from './db';
import { effectiveState, type EffectiveReason } from './schedule';

/** A finish this recent is still worth a cheer. */
export const DONE_WINDOW_MS = 15 * 60_000;
/** A failure older than this has been looked at, or is in a project nobody is coming back to. */
export const STUCK_WINDOW_MS = 24 * 3_600_000;

const IN_FLIGHT = new Set(['planning', 'awaiting_approval', 'running', 'paused']);

export type DepartmentStatus = 'draft' | 'hiring' | 'awaiting_approval' | 'active' | 'paused' | 'archived';

export interface FloorTask {
    id: string;
    title: string;
    projectId: string;
    departmentId: string | null;
}

export interface FloorAgent {
    id: string;
    slug: string;
    name: string;
    title: string;
    avatarSeed: string | null;
    isBoard: boolean;
    isCeo: boolean;
    state: AgentState;
    /** The task the state is about, when there is one. */
    task: FloorTask | null;
    /** When the state began, when known: a run's start, a finish. */
    since: string | null;
    /** Departments this agent is hired into, archived ones left out, in creation order. */
    departments: string[];
    /** Whose desk they sit at: the department they work for now, else the first that hired them. */
    seat: string | null;
}

export interface FloorDepartment {
    id: string;
    name: string;
    status: DepartmentStatus;
    createdAt: string;
    /** Agent ids, in hire order. */
    team: string[];
    /** The project in flight, if one is. */
    project: { id: string; title: string; status: string } | null;
    /** Projects finished here, which is what the town's prosperity grows with. */
    completed: number;
}

export interface Floor {
    at: string;
    system: { mode: SystemMode; reason: EffectiveReason; detail: string };
    pendingApprovals: number;
    /** Reviews the board is deliberating. */
    deliberating: number;
    agents: FloorAgent[];
    departments: FloorDepartment[];
}

// ---------------------------------------------------------------------------
// The plain rows the derivation reads.
// ---------------------------------------------------------------------------

export interface FloorInput {
    agents: { id: string; slug: string; name: string; title: string; avatar_seed: string | null; is_board: boolean }[];
    departments: { id: string; name: string; status: string; created_at: string }[];
    hires: { department_id: string; agent_id: string; seq: number }[];
    projects: { id: string; department_id: string; status: string; title: string; created_at: string }[];
    tasks: { id: string; project_id: string; agent_id: string; status: string; title: string }[];
    runs: { task_id: string; status: string; started_at: string; finished_at: string | null }[];
    deliberating: number;
    pendingApprovals: number;
    effective: { mode: SystemMode; reason: EffectiveReason; detail: string };
}

type Run = FloorInput['runs'][number];
type Task = FloorInput['tasks'][number];

const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);

export function deriveFloor(input: FloorInput, now: Date): Floor {
    const t = now.getTime();

    const departments = [...input.departments].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const live = new Set(departments.filter((d) => d.status !== 'archived').map((d) => d.id));
    const order = new Map(departments.map((d, i) => [d.id, i]));

    const projectDept = new Map(input.projects.map((p) => [p.id, p.department_id]));
    const inFlight = new Set(input.projects.filter((p) => IN_FLIGHT.has(p.status)).map((p) => p.id));
    const planning = input.projects.some((p) => p.status === 'planning');

    // The newest run per task decides whether a failure is fresh and a finish is recent.
    const latestRun = new Map<string, Run>();
    for (const r of input.runs) {
        const cur = latestRun.get(r.task_id);
        if (!cur || r.started_at > cur.started_at) latestRun.set(r.task_id, r);
    }

    const tasksOf = new Map<string, Task[]>();
    for (const task of input.tasks) {
        const list = tasksOf.get(task.agent_id) ?? [];
        list.push(task);
        tasksOf.set(task.agent_id, list);
    }

    const hiredIn = new Map<string, string[]>();
    for (const h of [...input.hires].sort((a, b) => (order.get(a.department_id) ?? 0) - (order.get(b.department_id) ?? 0) || a.seq - b.seq)) {
        if (!live.has(h.department_id)) continue;
        const list = hiredIn.get(h.agent_id) ?? [];
        if (!list.includes(h.department_id)) list.push(h.department_id);
        hiredIn.set(h.agent_id, list);
    }

    const off = input.effective.mode === 'stopped';
    const asleep = input.effective.mode === 'paused';

    const floorTask = (task: Task): FloorTask => ({
        id: task.id,
        title: task.title,
        projectId: task.project_id,
        departmentId: projectDept.get(task.project_id) ?? null,
    });

    const agents: FloorAgent[] = input.agents.map((a) => {
        const isCeo = a.slug === DELPHI_SLUG;
        const tasks = tasksOf.get(a.id) ?? [];
        const hired = hiredIn.get(a.id) ?? [];

        const running = tasks.find((x) => x.status === 'running');
        const awaiting = tasks.find((x) => x.status === 'awaiting_approval');
        const stuck = tasks.find((x) => {
            if (x.status !== 'failed') return false;
            const run = latestRun.get(x.id);
            return !!run && t - ms(run.finished_at ?? run.started_at) < STUCK_WINDOW_MS;
        });
        const queued = tasks.find((x) => x.status === 'pending' && inFlight.has(x.project_id));
        const done = tasks
            .filter((x) => x.status === 'done')
            .map((x) => ({ task: x, run: latestRun.get(x.id) }))
            .filter((x) => x.run?.finished_at && t - ms(x.run.finished_at) < DONE_WINDOW_MS)
            .sort((p, q) => ms(q.run!.finished_at) - ms(p.run!.finished_at))[0];

        let state: AgentState;
        let task: FloorTask | null = null;
        let since: string | null = null;

        if (off) state = 'off';
        else if (running) {
            state = 'working';
            task = floorTask(running);
            since = latestRun.get(running.id)?.started_at ?? null;
        } else if (asleep) state = 'asleep';
        else if (awaiting) {
            state = 'waiting_on_you';
            task = floorTask(awaiting);
        } else if (stuck) {
            state = 'stuck';
            task = floorTask(stuck);
            since = latestRun.get(stuck.id)?.finished_at ?? null;
        } else if (a.is_board && input.deliberating > 0) state = 'reviewing';
        else if (isCeo && planning) state = 'planning';
        else if (queued) {
            state = 'queued';
            task = floorTask(queued);
        } else if (done) {
            state = 'done';
            task = floorTask(done.task);
            since = done.run!.finished_at;
        } else if (isCeo || a.is_board || hired.length > 0) state = 'idle';
        else state = 'available';

        const seat = isCeo || a.is_board ? null : (task?.departmentId && live.has(task.departmentId) ? task.departmentId : null) ?? hired[0] ?? null;

        return {
            id: a.id,
            slug: a.slug,
            name: a.name,
            title: a.title,
            avatarSeed: a.avatar_seed,
            isBoard: a.is_board,
            isCeo,
            state,
            task,
            since,
            departments: hired,
            seat,
        };
    });

    const floorDepartments: FloorDepartment[] = departments.map((d) => {
        const team = input.hires
            .filter((h) => h.department_id === d.id)
            .sort((a, b) => a.seq - b.seq)
            .map((h) => h.agent_id)
            .filter((id, i, all) => all.indexOf(id) === i);
        const projects = input.projects.filter((p) => p.department_id === d.id);
        const current = projects.filter((p) => IN_FLIGHT.has(p.status)).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
        return {
            id: d.id,
            name: d.name,
            status: d.status as DepartmentStatus,
            createdAt: d.created_at,
            team,
            project: current ? { id: current.id, title: current.title, status: current.status } : null,
            completed: projects.filter((p) => p.status === 'done').length,
        };
    });

    return {
        at: now.toISOString(),
        system: input.effective,
        pendingApprovals: input.pendingApprovals,
        deliberating: input.deliberating,
        agents,
        departments: floorDepartments,
    };
}

// ---------------------------------------------------------------------------
// Reading the rows.
// ---------------------------------------------------------------------------

export async function readFloor(db: Db, workspaceId: string, now = new Date()): Promise<Floor> {
    const recent = new Date(now.getTime() - STUCK_WINDOW_MS).toISOString();

    const [agents, departments, hires, projects, runs, reviews, approvals, state] = await Promise.all([
        db.from('delphi_agents').select('id, slug, name, title, avatar_seed, is_board').eq('workspace_id', workspaceId).is('archived_at', null),
        db.from('delphi_departments').select('id, name, status, created_at').eq('workspace_id', workspaceId),
        db.from('delphi_hires').select('department_id, agent_id, seq').eq('workspace_id', workspaceId),
        db.from('delphi_projects').select('id, department_id, status, title, created_at').eq('workspace_id', workspaceId),
        db.from('delphi_task_runs').select('task_id, status, started_at, finished_at').eq('workspace_id', workspaceId).gte('started_at', recent),
        db.from('delphi_reviews').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId).eq('status', 'deliberating'),
        db.from('delphi_approvals').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId).eq('status', 'pending'),
        getSystemState(db, workspaceId),
    ]);

    const projectRows = (projects.data ?? []) as FloorInput['projects'];
    const runRows = (runs.data ?? []) as FloorInput['runs'];

    // Only the tasks that can still change a pose: those in projects in
    // flight, and those a run touched in the last day.
    const inFlight = projectRows.filter((p) => IN_FLIGHT.has(p.status)).map((p) => p.id);
    const touched = [...new Set(runRows.map((r) => r.task_id))];
    const [byProject, byRun] = await Promise.all([
        inFlight.length
            ? db.from('delphi_tasks').select('id, project_id, agent_id, status, title').in('project_id', inFlight)
            : Promise.resolve({ data: [] as unknown[] }),
        touched.length
            ? db.from('delphi_tasks').select('id, project_id, agent_id, status, title').in('id', touched)
            : Promise.resolve({ data: [] as unknown[] }),
    ]);
    const tasks = new Map<string, FloorInput['tasks'][number]>();
    for (const row of [...(byProject.data ?? []), ...(byRun.data ?? [])] as FloorInput['tasks']) tasks.set(row.id, row);

    const effective = effectiveState(state, now);

    return deriveFloor(
        {
            agents: (agents.data ?? []) as FloorInput['agents'],
            departments: (departments.data ?? []) as FloorInput['departments'],
            hires: (hires.data ?? []) as FloorInput['hires'],
            projects: projectRows,
            tasks: [...tasks.values()],
            runs: runRows,
            deliberating: reviews.count ?? 0,
            pendingApprovals: approvals.count ?? 0,
            effective: { mode: effective.mode, reason: effective.reason, detail: effective.detail },
        },
        now
    );
}
