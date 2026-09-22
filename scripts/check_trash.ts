/**
 * Prove a deliverable can be removed without quietly poisoning the pipeline.
 *
 * Two halves, and the second is the one that matters.
 *
 * The first is the obvious contract: trashing hides an output from the library
 * without destroying it, restoring brings it back with its verdict intact, and
 * destroying it needs the title typed exactly.
 *
 * The second is the failure that made deletion dangerous in the first place.
 * The runtime hands each step the previous step's output, and its guard used to
 * halt only when the upstream *task* had not finished. A task that finished and
 * whose artifact was later deleted matched neither branch: no artifact, no
 * halt. The next agent was told **"You are first in the pipeline"** and wrote a
 * whole confident report from nothing — which is exactly what the guard exists
 * to prevent, and is invisible in the output. Nothing throws. You get a
 * plausible document that is about nothing.
 *
 * So that case is asserted directly, from both sides: gone means halt, and a
 * trashed v2 falls back to v1 rather than to nothing.
 */

import {
    deletionImpact,
    emptyTrash,
    purgeArtifact,
    restoreArtifact,
    trashArtifact,
    MIGRATION_NEEDED,
} from '../src/lib/delphi/deletion';
import { resolveUpstream } from '../src/lib/delphi/runtime';
import { listOutputs } from '../src/lib/delphi/outputs';

const G = '\x1b[32m', R = '\x1b[31m', D = '\x1b[2m', RS = '\x1b[0m';

let failed = 0;
const ok = (cond: boolean, label: string, note = '') => {
    if (!cond) failed++;
    console.log(`  ${cond ? G + '✓' : R + '✗'}${RS} ${label.padEnd(54)}${note ? D + note + RS : ''}`);
};

const WS = 'ws-1';
const ME = 'user-1';

type Rows = Record<string, Record<string, unknown>[]>;

/**
 * Enough of PostgREST to run the code under test. See check_escalation.ts.
 *
 * `noTrashColumn` simulates a database where migration 0006 has not been
 * applied: filters and payloads naming `deleted_at` fail the way Postgres and
 * PostgREST actually fail, so the degradation paths are exercised rather than
 * asserted about.
 */
function fakeDb(tables: Rows, opts: { noTrashColumn?: boolean } = {}) {
    const removed: string[] = [];

    const builder = (table: string) => {
        const filters: ((r: Record<string, unknown>) => boolean)[] = [];
        let payload: Record<string, unknown> | null = null;
        let mode: 'select' | 'insert' | 'update' | 'delete' = 'select';
        let touchedTrashColumn = false;
        let sort: { col: string; asc: boolean } | null = null;
        let cap: number | null = null;

        const missing = (code: string, message: string) => ({ data: null, error: { code, message } });

        const run = () => {
            if (opts.noTrashColumn && touchedTrashColumn) {
                return mode === 'update'
                    ? missing(
                          'PGRST204',
                          "Could not find the 'deleted_at' column of 'delphi_artifacts' in the schema cache"
                      )
                    : missing('42703', `column ${table}.deleted_at does not exist`);
            }

            const rows = tables[table] ?? [];
            let matched = rows.filter((r) => filters.every((f) => f(r)));

            if (sort) {
                const { col, asc } = sort;
                matched = [...matched].sort((a, b) =>
                    String(a[col]).localeCompare(String(b[col])) * (asc ? 1 : -1)
                );
            }
            if (cap !== null) matched = matched.slice(0, cap);

            if (mode === 'update') for (const r of matched) Object.assign(r, payload);
            if (mode === 'delete') tables[table] = rows.filter((r) => !matched.includes(r));
            return { data: matched, error: null };
        };

        const self: Record<string, unknown> = {
            select: () => self,
            eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), self),
            neq: (k: string, v: unknown) => (filters.push((r) => r[k] !== v), self),
            gte: (k: string, v: unknown) => (filters.push((r) => String(r[k]) >= String(v)), self),
            is: (k: string, v: unknown) => {
                if (k === 'deleted_at') touchedTrashColumn = true;
                filters.push((r) => (r[k] ?? null) === v);
                return self;
            },
            not: (k: string, _op: string, v: unknown) => {
                if (k === 'deleted_at') touchedTrashColumn = true;
                filters.push((r) => (r[k] ?? null) !== v);
                return self;
            },
            in: (k: string, v: unknown[]) => (filters.push((r) => v.includes(r[k])), self),
            order: (col: string, o?: { ascending?: boolean }) => (
                (sort = { col, asc: o?.ascending !== false }), self
            ),
            limit: (n: number) => ((cap = n), self),
            delete: () => ((mode = 'delete'), self),
            insert: (row: Record<string, unknown>) => {
                mode = 'insert';
                (tables[table] ??= []).push({ id: `${table}-x`, ...row });
                return self;
            },
            update: (patch: Record<string, unknown>) => {
                mode = 'update';
                payload = patch;
                if ('deleted_at' in patch || 'deleted_by' in patch) touchedTrashColumn = true;
                return self;
            },
            maybeSingle: async () => {
                const res = run();
                return { data: res.data?.[0] ?? null, error: res.error };
            },
            single: async () => {
                const res = run();
                return { data: res.data?.[0] ?? null, error: res.error };
            },
            then: (resolve: (v: unknown) => unknown) => Promise.resolve(run()).then(resolve),
        };
        return self;
    };

    const db = {
        from: (t: string) => builder(t),
        storage: {
            from: () => ({
                remove: async (paths: string[]) => {
                    removed.push(...paths);
                    return { error: null };
                },
            }),
        },
    };

    return { db: db as never, removed };
}

/** A four-step pipeline that has run, with one deliverable per step. */
function library(): Rows {
    return {
        delphi_tasks: [
            { id: 't1', project_id: 'p1', seq: 1, title: 'Gather', status: 'done', depends_on: null },
            { id: 't2', project_id: 'p1', seq: 2, title: 'Analyse', status: 'done', depends_on: 't1' },
            { id: 't3', project_id: 'p1', seq: 3, title: 'Write', status: 'done', depends_on: 't2' },
            { id: 't4', project_id: 'p1', seq: 4, title: 'Audit', status: 'done', depends_on: 't3' },
        ],
        delphi_artifacts: [
            {
                id: 'a1', workspace_id: WS, project_id: 'p1', task_id: 't1', kind: 'dataset',
                title: 'Rate series, pulled', content_md: '## DGS10\n4.21%', data: {},
                storage_path: null, created_at: '2026-09-18T09:00:00Z',
                review_status: 'approved', review_note: 'Good.', revision: 1, deleted_at: null,
            },
            {
                id: 'a2', workspace_id: WS, project_id: 'p1', task_id: 't2', kind: 'report',
                title: 'What the curve is saying', content_md: '## Analysis', data: {},
                storage_path: 'ws-1/a2.pdf', created_at: '2026-09-18T10:00:00Z',
                review_status: 'pending', review_note: null, revision: 1, deleted_at: null,
            },
            {
                id: 'a3', workspace_id: WS, project_id: 'p1', task_id: 't3', kind: 'brief',
                title: 'Weekly market brief', content_md: '## Brief', data: {},
                storage_path: null, created_at: '2026-09-18T11:00:00Z',
                review_status: 'pending', review_note: null, revision: 1, deleted_at: null,
            },
        ],
        delphi_events: [],
    };
}

const artifactsOf = (t: Rows) => t.delphi_artifacts;
const byId = (t: Rows, id: string) => artifactsOf(t).find((a) => a.id === id);

(async () => {
    console.log('\nTrashing keeps the row and clears the shelf\n' + '─'.repeat(72));

    {
        const t = library();
        const { db } = fakeDb(t);

        const before = await listOutputs(db, { workspaceId: WS });
        const res = await trashArtifact(db, WS, ME, 'a2');
        const after = await listOutputs(db, { workspaceId: WS });

        ok(res.ok, 'the deliverable can be deleted');
        ok(before.length === 3 && after.length === 2, 'it leaves the library', `${before.length} → ${after.length}`);
        ok(Boolean(byId(t, 'a2')), 'but the row is still there', 'deleting is not destroying');
        ok(byId(t, 'a2')?.deleted_by === ME, 'and it records who deleted it');

        const trash = await listOutputs(db, { workspaceId: WS, trashed: true });
        ok(trash.length === 1 && trash[0].artifact.id === 'a2', 'the trash holds exactly it');
        ok(trash[0].deletedAt !== null, 'with the moment it went', String(trash[0].deletedAt).slice(0, 10));
    }

    console.log('\nRestoring puts it back untouched\n' + '─'.repeat(72));

    {
        const t = library();
        const { db } = fakeDb(t);

        await trashArtifact(db, WS, ME, 'a1');
        const res = await restoreArtifact(db, WS, 'a1');
        const after = await listOutputs(db, { workspaceId: WS });

        ok(res.ok, 'it can be restored');
        ok(after.length === 3, 'and the library is whole again');
        ok(
            byId(t, 'a1')?.review_status === 'approved' && byId(t, 'a1')?.review_note === 'Good.',
            'with the verdict it had',
            'a round trip through the trash is not a re-review'
        );
        ok(byId(t, 'a1')?.deleted_by === null, 'and nobody is recorded as having deleted it');
    }

    console.log('\nDestroying it takes more than a tap\n' + '─'.repeat(72));

    {
        const t = library();
        const { db, removed } = fakeDb(t);

        const straight = await purgeArtifact(db, WS, 'a2', 'What the curve is saying');
        ok(!straight.ok, 'not straight from the library', straight.error?.slice(0, 40));

        await trashArtifact(db, WS, ME, 'a2');

        const wrong = await purgeArtifact(db, WS, 'a2', 'What the curve is sayin');
        ok(!wrong.ok, 'not on a near-miss of the title', wrong.error);
        ok(Boolean(byId(t, 'a2')), 'and it is still there after the near-miss');

        const right = await purgeArtifact(db, WS, 'a2', '  What the curve is saying  ');
        ok(right.ok, 'yes on the title, whitespace forgiven');
        ok(!byId(t, 'a2'), 'and the row is gone');
        ok(
            removed.includes('ws-1/a2.pdf'),
            'the stored file goes with it',
            'an orphaned object is a bill nobody can see'
        );
    }

    console.log('\nEmptying it is confirmed against what is actually in it\n' + '─'.repeat(72));

    {
        const t = library();
        const { db } = fakeDb(t);

        const idle = await emptyTrash(db, WS, '0');
        ok(!idle.ok && /already empty/i.test(idle.error ?? ''), 'an empty trash says so');

        await trashArtifact(db, WS, ME, 'a1');
        await trashArtifact(db, WS, ME, 'a3');

        const stale = await emptyTrash(db, WS, '1');
        ok(
            !stale.ok && /Type 2/.test(stale.error ?? ''),
            'a count from a stale page is refused',
            'asked again against the real total'
        );
        ok(artifactsOf(t).length === 3, 'and nothing is destroyed on the refusal');

        const res = await emptyTrash(db, WS, '2');
        ok(res.ok && res.purged === 2, 'the right count empties it');
        ok(artifactsOf(t).length === 1, 'leaving only what was never in the trash', 'a2');
    }

    console.log('\nThe guard: a step whose input is gone must stop\n' + '─'.repeat(72));

    {
        // This is the bug. t2 is `done` and its artifact has been deleted.
        // The old guard halted only on a task that had not finished, so this
        // fell through both branches and the writer was told it was first in
        // the pipeline.
        const t = library();
        const { db } = fakeDb(t);
        await trashArtifact(db, WS, ME, 'a2');

        const res = await resolveUpstream(db, 't2');
        ok(res.upstream === null, 'a trashed input is not handed over');
        ok(Boolean(res.halt), 'and the pipeline halts rather than running on nothing');
        ok(
            /deliverable is gone/i.test(res.halt ?? ''),
            'saying the deliverable is gone, not that the step failed',
            'the two need different answers'
        );
        ok(/Step 2/.test(res.halt ?? ''), 'and naming which step', res.halt?.slice(0, 46));
    }

    {
        const t = library();
        const { db } = fakeDb(t);
        const res = await resolveUpstream(db, 't2');
        ok(res.upstream?.title === 'What the curve is saying', 'a live input is handed over normally');
        ok(!res.halt, 'with nothing to halt for');
    }

    {
        // A step that never produced anything is a different failure, and says
        // so — this is the case the guard always covered.
        const t = library();
        t.delphi_tasks[1].status = 'failed';
        t.delphi_artifacts = t.delphi_artifacts.filter((a) => a.id !== 'a2');
        const { db } = fakeDb(t);

        const res = await resolveUpstream(db, 't2');
        ok(/is failed and produced nothing/i.test(res.halt ?? ''), 'a step that failed reads as a failure');
    }

    console.log('\nA trashed redo falls back to the version it replaced\n' + '─'.repeat(72));

    {
        const t = library();
        t.delphi_artifacts.push({
            id: 'a2b', workspace_id: WS, project_id: 'p1', task_id: 't2', kind: 'report',
            title: 'What the curve is saying (v2)', content_md: '## Analysis, redone', data: {},
            storage_path: null, created_at: '2026-09-19T10:00:00Z',
            review_status: 'pending', review_note: null, revision: 2, deleted_at: null,
        });
        const { db } = fakeDb(t);

        const newest = await resolveUpstream(db, 't2');
        ok(newest.upstream?.title.endsWith('(v2)') === true, 'the newest version is the one handed over');

        await trashArtifact(db, WS, ME, 'a2b');
        const fallback = await resolveUpstream(db, 't2');
        ok(
            fallback.upstream?.title === 'What the curve is saying',
            'trashing it falls back to v1, not to nothing',
            'the same query that picks the newest'
        );
        ok(!fallback.halt, 'so the pipeline keeps running');
    }

    console.log('\nWhat it would affect, counted before it happens\n' + '─'.repeat(72));

    {
        const t = library();
        const { db } = fakeDb(t);

        const impact = await deletionImpact(db, 'a2');
        ok(impact?.title === 'What the curve is saying', 'the impact names the deliverable');
        ok(
            impact?.dependants.map((d) => d.seq).join(',') === '3,4',
            'and every later step built on it',
            'steps 3 and 4, in order'
        );
        ok(impact?.onlyVersion === true, 'saying it is the only version of its step');
        ok(impact?.hasFile === true, 'and that a stored file goes with it');

        const statuses = t.delphi_tasks.map((x) => x.status).join(',');
        await trashArtifact(db, WS, ME, 'a2');
        ok(
            t.delphi_tasks.map((x) => x.status).join(',') === statuses,
            'deleting names the downstream steps and leaves them alone',
            'a re-run halts honestly; a silent re-queue spends real money'
        );
        ok(Boolean(byId(t, 'a3')), 'their own deliverables are untouched');
    }

    {
        const t = library();
        t.delphi_artifacts.push({
            id: 'a2b', workspace_id: WS, project_id: 'p1', task_id: 't2', kind: 'report',
            title: 'What the curve is saying (v2)', content_md: '## Redone', data: {},
            storage_path: null, created_at: '2026-09-19T10:00:00Z',
            review_status: 'pending', review_note: null, revision: 2, deleted_at: null,
        });
        const { db } = fakeDb(t);

        const impact = await deletionImpact(db, 'a2b');
        ok(impact?.onlyVersion === false, 'with a v1 behind it, it says so instead');
    }

    console.log('\nBefore the migration, it names the migration\n' + '─'.repeat(72));

    {
        const t = library();
        const { db } = fakeDb(t, { noTrashColumn: true });

        const res = await trashArtifact(db, WS, ME, 'a2');
        ok(!res.ok, 'deleting refuses');
        ok(res.error === MIGRATION_NEEDED, 'naming the migration, not a PostgREST string', res.error);

        const all = await listOutputs(db, { workspaceId: WS });
        ok(all.length === 3, 'the library still loads', 'nothing can be in a trash that does not exist');

        const trash = await listOutputs(db, { workspaceId: WS, trashed: true });
        ok(trash.length === 0, 'and the trash reads as empty rather than erroring');

        const up = await resolveUpstream(db, 't2');
        ok(
            up.upstream?.title === 'What the curve is saying' && !up.halt,
            'and a working pipeline keeps working',
            'the filter must not halt what it cannot apply'
        );
    }

    console.log(`\n${failed ? R + failed + ' failed' : G + 'all passed'}${RS}\n`);
    process.exit(failed ? 1 : 0);
})().catch((e) => {
    console.error('THREW:', e);
    process.exit(1);
});
