/**
 * Prove a step never runs ahead of the one it depends on.
 *
 * The engine takes "the next pending step". Unchecked, that is wrong in two
 * quiet ways, and neither throws:
 *
 *  - the step before is still running — say the dashboard and the morning
 *    cron tick at once. The next step finds nothing to work from, and a
 *    healthy project is marked failed;
 *  - the step before is parked for the CHO's approval. Its deliverable
 *    already exists, so the next step goes ahead and builds on work the CHO
 *    has not approved.
 *
 * Both are asserted here, against the real runNextTask on a small fake
 * database, along with the race where two ticks grab the same step, and a
 * re-opened project that still read as failed. No network, no model call.
 */

import { firstRunnable, runNextTask } from '../src/lib/delphi/runtime';
import { sendTaskBack } from '../src/lib/delphi/revision';

const G = '\x1b[32m', R = '\x1b[31m', D = '\x1b[2m', RS = '\x1b[0m';

let failed = 0;
const ok = (cond: boolean, label: string, note = '') => {
    if (!cond) failed++;
    console.log(`  ${cond ? G + '✓' : R + '✗'}${RS} ${label.padEnd(60)}${note ? D + note + RS : ''}`);
};

const WS = 'ws-1';

// ---------------------------------------------------------------------------
// A small Supabase: filters, ordering, update-then-select, and a hook that
// lets a test act as a second tick between two queries.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
type Rows = Record<string, Row[]>;

function fakeDb(tables: Rows, onQuery?: (table: string) => void) {
    const builder = (table: string) => {
        onQuery?.(table);
        const filters: ((r: Row) => boolean)[] = [];
        let mode: 'select' | 'insert' | 'update' = 'select';
        let patch: Row = {};
        let sort: { col: string; asc: boolean } | null = null;
        let cap: number | null = null;

        const run = () => {
            if (mode === 'insert') return { data: null, error: null };
            let matched = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
            if (sort) {
                const { col, asc } = sort;
                matched = [...matched].sort((a, b) => (Number(a[col]) - Number(b[col])) * (asc ? 1 : -1));
            }
            if (cap !== null) matched = matched.slice(0, cap);
            if (mode === 'update') for (const r of matched) Object.assign(r, patch);
            return { data: matched, error: null };
        };

        const self: Record<string, unknown> = {
            select: () => self,
            eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), self),
            neq: (k: string, v: unknown) => (filters.push((r) => r[k] !== v), self),
            in: (k: string, v: unknown[]) => (filters.push((r) => v.includes(r[k])), self),
            is: (k: string, v: unknown) => (filters.push((r) => (r[k] ?? null) === v), self),
            order: (col: string, o?: { ascending?: boolean }) => ((sort = { col, asc: o?.ascending !== false }), self),
            limit: (n: number) => ((cap = n), self),
            insert: (row: Row) => {
                mode = 'insert';
                (tables[table] ??= []).push({ id: `${table}-${(tables[table]?.length ?? 0) + 1}`, ...row });
                return self;
            },
            update: (p: Row) => ((mode = 'update'), (patch = p), self),
            maybeSingle: async () => ({ data: run().data?.[0] ?? null, error: null }),
            single: async () => ({ data: run().data?.[0] ?? null, error: null }),
            then: (resolve: (v: unknown) => unknown) => Promise.resolve(run()).then(resolve),
        };
        return self;
    };
    return { from: (t: string) => builder(t) } as never;
}

const agent = { id: 'ag-1', name: 'Nadia Brandt', title: 'Market analyst', system_prompt: 'x', model: 'test-model' };
const project = (status = 'running', error: string | null = null): Row => ({
    id: 'p1', workspace_id: WS, title: 'Financial market research', brief: 'b', status, error,
    spent_usd: 0, budget_usd: 5, finished_at: null,
});
const task = (id: string, seq: number, status: string, depends_on: string | null): Row => ({
    id, project_id: 'p1', seq, title: `Step ${seq}`, status, depends_on, agent_id: agent.id, agent,
    objective: 'o', revision_count: 0,
});
const statusOf = (t: Rows, id: string) => t.delphi_tasks.find((r) => r.id === id)?.status;

(async () => {
    console.log('\nThe rule: a step waits until the one it depends on has settled\n' + '─'.repeat(78));

    {
        const s = (pairs: [string, string][]) => new Map(pairs);
        const t = (id: string, dep: string | null) => ({ id, depends_on: dep });

        ok(firstRunnable([t('t3', 't2')], s([['t2', 'awaiting_approval']])) === null, 'waits while the step before awaits approval', 'its output is not yet approved');
        ok(firstRunnable([t('t2', 't1')], s([['t1', 'running']])) === null, 'waits while the step before is still running');
        ok(firstRunnable([t('t3', 't2')], s([['t2', 'pending']])) === null, 'waits while the step before is queued again', 'e.g. sent back');
        ok(firstRunnable([t('t3', 't2')], s([['t2', 'done']]))?.id === 't3', 'goes once the step before is done');
        ok(firstRunnable([t('t3', 't2')], s([['t2', 'skipped']]))?.id === 't3', 'and when the CHO declined its action', 'the work itself finished');
        ok(firstRunnable([t('t3', 't2')], s([['t2', 'failed']]))?.id === 't3', 'and when it failed', 'so the broken chain is named, as before');
        ok(firstRunnable([t('t2', 't1'), t('t4', null)], s([['t1', 'running']]))?.id === 't4', 'an independent step goes while another waits');
        ok(firstRunnable([t('t2', 'gone')], s([]))?.id === 't2', 'a missing upstream is left to name the hole', 'resolveUpstream reports it');
    }

    console.log('\nThe engine: waiting is neither failing nor running early\n' + '─'.repeat(78));

    {
        // Step 2 is parked for the CHO, and its deliverable already exists.
        const t: Rows = {
            delphi_projects: [project()],
            delphi_tasks: [task('t1', 1, 'done', null), task('t2', 2, 'awaiting_approval', 't1'), task('t3', 3, 'pending', 't2')],
            delphi_artifacts: [{ id: 'a2', task_id: 't2', title: 'Unapproved screen', content_md: '...', data: {}, deleted_at: null }],
            delphi_task_runs: [],
            delphi_events: [],
        };
        const out = await runNextTask(fakeDb(t), WS, 'p1');
        ok(out.status === 'idle' && 'reason' in out && out.reason === 'waiting_on_upstream', 'the next step waits for the CHO\'s decision', 'not built on unapproved work');
        ok(statusOf(t, 't3') === 'pending' && t.delphi_task_runs.length === 0, 'and nothing was run or spent');
        ok(t.delphi_projects[0].status === 'running' && !t.delphi_projects[0].error, 'the project stays running, not failed');
    }
    {
        // Another tick is part-way through step 1.
        const t: Rows = {
            delphi_projects: [project()],
            delphi_tasks: [task('t1', 1, 'running', null), task('t2', 2, 'pending', 't1')],
            delphi_artifacts: [],
            delphi_task_runs: [],
            delphi_events: [],
        };
        const out = await runNextTask(fakeDb(t), WS, 'p1');
        ok(out.status === 'idle' && 'reason' in out && out.reason === 'waiting_on_upstream', 'a step whose upstream is running waits too');
        ok(t.delphi_projects[0].status === 'running' && !t.delphi_projects[0].error, 'and a healthy project is not marked failed', 'it was, before this check');
    }
    {
        // Two ticks reach the same step. The other one claims it first.
        const t: Rows = {
            delphi_projects: [project()],
            delphi_tasks: [task('t1', 1, 'pending', null)],
            delphi_artifacts: [],
            delphi_task_runs: [],
            delphi_events: [],
        };
        const db = fakeDb(t, (table) => {
            if (table === 'delphi_handoffs') t.delphi_tasks[0].status = 'running';
        });
        const out = await runNextTask(db, WS, 'p1');
        ok(out.status === 'idle' && 'reason' in out && out.reason === 'claimed_elsewhere', 'a step another tick claimed is left to it');
        ok(t.delphi_task_runs.length === 0, 'so it is never run twice', 'no second run, no second bill');
    }
    {
        const t: Rows = {
            delphi_projects: [project()],
            delphi_tasks: [task('t1', 1, 'done', null), task('t2', 2, 'done', 't1')],
            delphi_artifacts: [],
            delphi_task_runs: [],
            delphi_events: [],
        };
        const out = await runNextTask(fakeDb(t), WS, 'p1');
        ok(out.status === 'idle' && 'reason' in out && out.reason === 'no_pending_tasks' && t.delphi_projects[0].status === 'done', 'a project with nothing left still finishes');
    }

    console.log('\nSending work back re-opens a project cleanly\n' + '─'.repeat(78));

    {
        const t: Rows = {
            delphi_projects: [{ ...project('failed', 'Step 2 (Screen) is running and produced nothing to work from.'), finished_at: '2026-09-30T10:00:00Z' }],
            delphi_tasks: [task('t1', 1, 'done', null), task('t2', 2, 'failed', 't1')],
            delphi_agents: [agent],
            delphi_events: [],
        };
        await sendTaskBack(fakeDb(t), WS, 't1', 'Use this week\'s data.', 'output');
        const p = t.delphi_projects[0];
        ok(p.status === 'running' && p.error === null && p.finished_at === null, 'its old failure is cleared', 'it no longer reads as failed');
        ok(statusOf(t, 't1') === 'pending' && statusOf(t, 't2') === 'pending', 'and the step and what was built on it are queued again');
    }

    console.log(`\n${failed ? R + failed + ' failed' : G + 'all passed'}${RS}\n`);
    process.exit(failed ? 1 : 0);
})().catch((e) => {
    console.error('THREW:', e);
    process.exit(1);
});
