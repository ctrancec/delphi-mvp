/**
 * Prove a wrong tap can be taken back — and that a right one cannot be
 * pretended away.
 *
 * Every control here is one tap, and one tap is how people actually get these
 * wrong: not by reasoning badly, but by hitting Accept on the wrong card.
 * Before this, that was permanent. Declining by mistake was worse — the next
 * tick spent real money redoing work that was fine.
 *
 * The other half matters just as much. An undo offered where it cannot work
 * is worse than no undo, so the cases that genuinely cannot be reversed have
 * to refuse, by name, rather than appear to succeed.
 */

import { sendTaskBack, undoSendBack } from '../src/lib/delphi/revision';
import { undoHire } from '../src/lib/delphi/replacement';

const G = '\x1b[32m', R = '\x1b[31m', D = '\x1b[2m', RS = '\x1b[0m';

let failed = 0;
const ok = (cond: boolean, label: string, note = '') => {
    if (!cond) failed++;
    console.log(`  ${cond ? G + '✓' : R + '✗'}${RS} ${label.padEnd(52)}${note ? D + note + RS : ''}`);
};

const WS = 'ws-1';

/** Enough of PostgREST to run the code under test. See check_escalation.ts. */
function fakeDb(tables: Record<string, Record<string, unknown>[]>) {
    const builder = (table: string) => {
        const filters: ((r: Record<string, unknown>) => boolean)[] = [];
        let payload: Record<string, unknown> | null = null;
        let mode: 'select' | 'insert' | 'update' | 'delete' = 'select';

        const run = () => {
            const rows = tables[table] ?? [];
            const matched = rows.filter((r) => filters.every((f) => f(r)));
            if (mode === 'update') for (const r of matched) Object.assign(r, payload);
            if (mode === 'delete') tables[table] = rows.filter((r) => !matched.includes(r));
            return { data: matched, error: null };
        };

        const self: Record<string, unknown> = {
            select: () => self,
            eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), self),
            neq: (k: string, v: unknown) => (filters.push((r) => r[k] !== v), self),
            is: (k: string, v: unknown) => (filters.push((r) => r[k] === v), self),
            in: (k: string, v: unknown[]) => (filters.push((r) => v.includes(r[k])), self),
            order: () => self,
            limit: () => self,
            delete: () => ((mode = 'delete'), self),
            insert: (row: Record<string, unknown>) => {
                mode = 'insert';
                (tables[table] ??= []).push({ id: `${table}-x`, ...row });
                return self;
            },
            update: (patch: Record<string, unknown>) => ((mode = 'update'), (payload = patch), self),
            maybeSingle: async () => ({ data: run().data[0] ?? null, error: null }),
            single: async () => ({ data: run().data[0] ?? null, error: null }),
            then: (resolve: (v: unknown) => unknown) => Promise.resolve(run()).then(resolve),
        };
        return self;
    };
    return { from: (t: string) => builder(t) } as never;
}

/** A four-step pipeline, all finished, like a project the CHO is reading. */
function pipeline() {
    return {
        delphi_tasks: [
            { id: 't1', project_id: 'p1', title: 'Gather', status: 'done', depends_on: null, agent_id: 'a1', revision_count: 0, replacement_count: 0, cho_note: null },
            { id: 't2', project_id: 'p1', title: 'Analyse', status: 'done', depends_on: 't1', agent_id: 'a2', revision_count: 0, replacement_count: 0, cho_note: null },
            { id: 't3', project_id: 'p1', title: 'Write', status: 'done', depends_on: 't2', agent_id: 'a3', revision_count: 0, replacement_count: 0, cho_note: null },
            { id: 't4', project_id: 'p1', title: 'Audit', status: 'done', depends_on: 't3', agent_id: 'a4', revision_count: 0, replacement_count: 0, cho_note: null },
        ],
        delphi_agents: [
            { id: 'a2', name: 'Nadia Brandt', origin: 'seed', archived_at: null },
            { id: 'a9', name: 'Kaelen Vance', origin: 'invented', archived_at: null },
        ],
        delphi_projects: [{ id: 'p1', status: 'done' }],
        delphi_events: [],
        delphi_handoffs: [],
        delphi_artifacts: [],
    };
}

const NOTE = 'The momentum screen is empty. Populate it from step 1 or say why not.';

(async () => {
    console.log('\nTaking back a send-back\n' + '─'.repeat(68));

    {
        const t = pipeline();
        const db = fakeDb(t);
        await sendTaskBack(db, WS, 't2', NOTE, 'output');

        ok(t.delphi_tasks[1].status === 'pending', 'declining re-queues the step');
        ok(t.delphi_tasks[2].status === 'pending', 'and everything built on it');

        const undo = await undoSendBack(db, WS, 't2');
        ok(undo.undone, 'the decline can be taken back');
        ok(t.delphi_tasks[1].status === 'done', 'the step is finished again');
        ok(t.delphi_tasks[2].status === 'done' && t.delphi_tasks[3].status === 'done',
           'and so is the tail that was only re-queued because of it');
        ok(t.delphi_tasks[1].cho_note === null, 'the note is gone', 'nothing left to act on');
        ok(t.delphi_tasks[1].revision_count === 0, 'and it does not count as an attempt',
           'two mis-clicks must not escalate anyone');
    }

    console.log('\nBut only while there is something to cancel\n' + '─'.repeat(68));

    {
        const t = pipeline();
        const db = fakeDb(t);
        await sendTaskBack(db, WS, 't2', NOTE, 'output');

        t.delphi_tasks[1].status = 'running';
        const mid = await undoSendBack(db, WS, 't2');
        ok(!mid.undone, 'not while the agent is mid-run');
        ok(/finish/i.test(mid.reason ?? ''), 'and it says to let it finish', mid.reason?.slice(0, 44));

        t.delphi_tasks[1].status = 'done';
        const after = await undoSendBack(db, WS, 't2');
        ok(!after.undone, 'not once the work has actually been redone');
        ok(/already/i.test(after.reason ?? ''), 'said plainly rather than failing quietly');
    }

    console.log('\nUn-hiring someone approved by mistake\n' + '─'.repeat(68));

    {
        const t = pipeline();
        t.delphi_tasks[1].agent_id = 'a9';
        t.delphi_tasks[1].replacement_count = 1;
        t.delphi_handoffs.push({ task_id: 't2', from_agent_id: 'a2', to_agent_id: 'a9', created_at: '2026-09-21' } as never);

        const db = fakeDb(t);
        const undo = await undoHire(db, WS, 't2');

        ok(undo.ok, 'the hire can be taken back');
        ok(t.delphi_tasks[1].agent_id === 'a2', 'the task goes back to who held it', 'Nadia Brandt');
        ok(
            Boolean(t.delphi_agents.find((a) => a.id === 'a9')?.archived_at),
            'and the new agent is archived',
            'out of hiring everywhere, without falsifying history'
        );
        ok(t.delphi_tasks[1].replacement_count === 0, 'the attempt no longer counts against anyone');
        ok(t.delphi_handoffs.length === 0, 'and the dossier for a handoff that did not happen is gone');
    }

    {
        // A seed agent who took a task over is somebody else's colleague too.
        const t = pipeline();
        t.delphi_tasks[1].agent_id = 'a2';
        t.delphi_handoffs.push({ task_id: 't2', from_agent_id: 'a1', to_agent_id: 'a2', created_at: '2026-09-21' } as never);
        const db = fakeDb(t);
        await undoHire(db, WS, 't2');
        ok(
            t.delphi_agents.find((a) => a.id === 'a2')?.archived_at === null,
            'a seed agent is never archived by an undo',
            'only ones Delphi invented for this'
        );
    }

    {
        const t = pipeline();
        t.delphi_tasks[1].status = 'running';
        t.delphi_handoffs.push({ task_id: 't2', from_agent_id: 'a2', to_agent_id: 'a9', created_at: '2026-09-21' } as never);
        const db = fakeDb(t);
        const undo = await undoHire(db, WS, 't2');
        ok(!undo.ok, 'not while they are already working', undo.reason?.slice(0, 40));
    }

    console.log(`\n${failed ? R + failed + ' failed' : G + 'all passed'}${RS}\n`);
    process.exit(failed ? 1 : 0);
})().catch((e) => {
    console.error('THREW:', e);
    process.exit(1);
});
