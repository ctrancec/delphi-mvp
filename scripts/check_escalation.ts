/**
 * Prove Delphi cannot hire itself a colleague.
 *
 * When the CHO refuses a task twice and nobody on the roster fits, Delphi
 * drafts a specialist for that objective. Drafting is cheap and reversible;
 * hiring is neither — an invented agent is permanent and available to every
 * department afterwards, so it spends money on runs that have not happened
 * yet. The rule this whole design turns on is that the proposal waits in the
 * CHO's queue and **no agent row exists until they approve**.
 *
 * That rule is invisible when it works and expensive when it does not, which
 * is exactly the kind that needs a test rather than a comment.
 *
 * Runs against a fake database and one real Gemini call (~$0.004), because a
 * drafted persona that does not satisfy the schema is a draft nobody can act
 * on, and only the live model can tell us that.
 */

import { escalateTask, hireProposedAgent } from '../src/lib/delphi/replacement';
import { ESCALATION_MODEL } from '../src/lib/llm/gemini';

const G = '\x1b[32m', R = '\x1b[31m', D = '\x1b[2m', RS = '\x1b[0m';

let failed = 0;
const ok = (cond: boolean, label: string, note = '') => {
    if (!cond) failed++;
    console.log(`  ${cond ? G + '✓' : R + '✗'}${RS} ${label.padEnd(50)}${note ? D + note + RS : ''}`);
};

const WS = 'ws-1';
const TASK = 'task-1';

/** A roster agent, in the shape the database stores one. */
function agent(id: string, name: string, title: string, skills: string[], tier = 2) {
    return {
        id,
        workspace_id: WS,
        slug: id,
        name,
        title,
        system_prompt: 'x',
        skills,
        channel_ids: [],
        model: 'gemini-3.8-flash',
        cost_tier: tier,
        origin: 'seed',
        is_board: false,
        archived_at: null,
    };
}

/**
 * Enough of PostgREST to run the code under test.
 *
 * Filters accumulate and apply on await; inserts and updates are recorded so
 * the assertions can ask what actually happened rather than what was returned.
 */
function fakeDb(tables: Record<string, Record<string, unknown>[]>) {
    const inserted: Record<string, Record<string, unknown>[]> = {};
    const updated: Record<string, Record<string, unknown>[]> = {};

    const builder = (table: string) => {
        const rows = () => tables[table] ?? [];
        const filters: ((r: Record<string, unknown>) => boolean)[] = [];
        let payload: Record<string, unknown> | null = null;
        let mode: 'select' | 'insert' | 'update' = 'select';

        const result = () => {
            const matched = rows().filter((r) => filters.every((f) => f(r)));
            if (mode === 'update') {
                for (const r of matched) Object.assign(r, payload);
                (updated[table] ??= []).push({ ...payload, matched: matched.length });
                return { data: matched, error: null };
            }
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
            insert: (row: Record<string, unknown> | Record<string, unknown>[]) => {
                mode = 'insert';
                const list = Array.isArray(row) ? row : [row];
                for (const r of list) {
                    const withId = { id: `${table}-${(inserted[table]?.length ?? 0) + 1}`, ...r };
                    (inserted[table] ??= []).push(withId);
                    (tables[table] ??= []).push(withId);
                }
                return self;
            },
            update: (patch: Record<string, unknown>) => {
                mode = 'update';
                payload = patch;
                return self;
            },
            maybeSingle: async () => {
                const { data } = result();
                return { data: data[0] ?? null, error: null };
            },
            single: async () => {
                if (mode === 'insert') {
                    const list = inserted[table] ?? [];
                    return { data: list[list.length - 1] ?? null, error: null };
                }
                const { data } = result();
                return { data: data[0] ?? null, error: null };
            },
            then: (resolve: (v: unknown) => unknown) => {
                if (mode === 'insert') return Promise.resolve({ data: null, error: null }).then(resolve);
                return Promise.resolve(result()).then(resolve);
            },
        };
        return self;
    };

    return {
        db: { from: (t: string) => builder(t) } as never,
        inserted,
        updated,
    };
}

function world(roster: ReturnType<typeof agent>[]) {
    return {
        delphi_tasks: [
            {
                id: TASK,
                workspace_id: WS,
                project_id: 'proj-1',
                department_id: 'dept-1',
                title: 'Rank the top 20 momentum equities',
                objective:
                    'Compute valuation metrics, assess technical trends and rank the top 20 momentum equities from the screening data.',
                agent_id: 'incumbent',
                seq: 2,
                replacement_count: 0,
                model_override: null,
                status: 'pending',
            },
        ],
        delphi_agents: [
            agent('incumbent', 'Nadia Brandt', 'Market Analyst', ['markets', 'equities'], 2),
            ...roster,
        ],
        delphi_agent_stats: [],
        delphi_channels: [
            { id: 'ch-1', workspace_id: WS, kind: 'fred', label: 'FRED', enabled: true, config: {}, health: 'ok' },
            { id: 'ch-2', workspace_id: WS, kind: 'perplexity', label: 'Perplexity', enabled: true, config: {}, health: 'ok' },
        ],
        delphi_approvals: [],
        delphi_events: [],
        delphi_handoffs: [],
        delphi_task_runs: [],
        delphi_artifacts: [],
    };
}

const REASON = 'The CHO sent this back 2 times. Most recently: the momentum screen is empty.';

(async () => {
    console.log('\nEscalating when the roster fits\n' + '─'.repeat(68));

    // A genuine market specialist is on the bench. Escalation should simply
    // hand the task over — drafting a new persona would be waste.
    {
        const t = world([
            agent('vera', 'Vera Quinn', 'Senior Research Analyst', ['research', 'equities', 'valuation', 'markets']),
        ]);
        const { db, inserted } = fakeDb(t);
        const out = await escalateTask(db, WS, TASK, REASON);

        ok(out.replaced === true, 'hands the task to the agent who fits', String(out.toAgent));
        ok(!inserted.delphi_approvals?.length, 'and does not ask to hire anyone');
        ok(
            (inserted.delphi_agents?.length ?? 0) === 0,
            'no agent row is created',
            'a reshuffle is not a hire'
        );
        ok(
            t.delphi_tasks[0].model_override === ESCALATION_MODEL,
            'the task still moves to the stronger model',
            ESCALATION_MODEL
        );
    }

    console.log('\nEscalating when it does not\n' + '─'.repeat(68));

    // Only a video editor and a motion designer are free — the exact situation
    // on the live roster, and the one the cost-tier heuristic got wrong.
    const barren = world([
        agent('kit', 'Kit Alvarez', 'Video Editor', ['video', 'editing', 'clips'], 3),
        agent('rune', 'Rune Sato', 'Motion & Animation Designer', ['animation', 'vfx', 'titles'], 3),
    ]);
    const { db, inserted } = fakeDb(barren);
    const out = await escalateTask(db, WS, TASK, REASON);

    ok(out.replaced === false, 'does not hand market analysis to a video editor');
    ok(Boolean(out.proposedHire), 'drafts a specialist instead', out.proposedHire ?? '—');

    const approval = inserted.delphi_approvals?.[0] as
        | { action_type: string; payload: { kind: string; spec: { skills: string[]; title: string } } }
        | undefined;

    ok(Boolean(approval), 'and parks it for the CHO');
    ok(approval?.payload?.kind === 'staffing', 'marked as a staffing decision');
    ok(approval?.action_type === 'other', 'filed under an existing action type', 'no migration needed');
    ok(
        (inserted.delphi_agents?.length ?? 0) === 0,
        'NO AGENT IS HIRED',
        'the rule the whole design turns on'
    );
    ok(
        barren.delphi_tasks[0].status === 'awaiting_approval',
        'the task waits rather than running again'
    );

    const spec = approval?.payload?.spec;
    ok(Boolean(spec?.title && spec.skills?.length), 'the draft is usable', spec?.title ?? '—');

    // Asked once. A second proposal for the same task is Delphi pestering the
    // CHO about a decision they have not made yet.
    const again = await escalateTask(db, WS, TASK, REASON);
    ok(!again.proposedHire, 'does not ask twice about the same task');
    ok((inserted.delphi_approvals?.length ?? 0) === 1, 'still exactly one proposal');

    console.log('\nOnly the CHO hires\n' + '─'.repeat(68));

    const hired = await hireProposedAgent(db, WS, {
        task_id: TASK,
        project_id: 'proj-1',
        payload: approval!.payload,
    });

    ok(hired.replaced === true, 'approving the proposal hires them', String(hired.toAgent));
    ok((inserted.delphi_agents?.length ?? 0) === 1, 'exactly one agent row, and only now');
    ok(
        (inserted.delphi_agents?.[0] as { origin?: string })?.origin === 'invented',
        'recorded as invented, not seeded'
    );
    ok(Boolean(inserted.delphi_handoffs?.length), 'with a dossier so they resume, not restart');
    ok(barren.delphi_tasks[0].status === 'pending', 'and the task is runnable again');
    ok(
        barren.delphi_tasks[0].model_override === ESCALATION_MODEL,
        'on the stronger model'
    );

    console.log(`\n${failed ? R + failed + ' failed' : G + 'all passed'}${RS}\n`);
    process.exit(failed ? 1 : 0);
})().catch((e) => {
    console.error('THREW:', e);
    process.exit(1);
});
