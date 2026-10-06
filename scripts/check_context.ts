/**
 * Compartments, proven.
 *
 * Two departments; two channels in one of them and one in the other. Every
 * compartment is seeded with marker text — house rules, role notes, decisions,
 * lessons, settings, what each channel has made — and every prompt builder is
 * run for every compartment. Each must carry its own markers and none of
 * anyone else's. Then the paths that enforce it: a channel from another
 * department is not followed, the runtime refuses to run for one, recall is
 * filtered by department, and lessons are filed where they were learned.
 *
 *   npm run delphi:context
 */

import { contextFor, renderContext, allowedSources } from '../src/lib/delphi/context';
import { buildPrompt, runNextTask } from '../src/lib/delphi/runtime';
import { buildStudioPrompt } from '../src/lib/studio/plan';
import { buildPlanPrompt, validateStaffingPlan, withPinned } from '../src/lib/delphi/delphi';
import { recallMemories, writeMemory, type Db } from '../src/lib/delphi/db';
import { withDefaults, type MediaAccount } from '../src/lib/studio/accounts';
import type { Agent, Candidate } from '../src/lib/delphi/types';

const G = '\x1b[32m', R = '\x1b[31m', D = '\x1b[2m', RS = '\x1b[0m';
let failed = 0;
const ok = (cond: boolean, label: string, note = '') => {
    if (!cond) failed++;
    console.log(`  ${cond ? G + '✓' : R + '✗'}${RS} ${label.padEnd(70)}${note ? D + note + RS : ''}`);
};

type Row = Record<string, unknown>;

/** A small PostgREST: filters, ordering, limits, embeds for tasks, inserts that return the row. */
function fakeDb(tables: Record<string, Row[]>) {
    let n = 1;
    const from = (table: string) => {
        const filters: ((r: Row) => boolean)[] = [];
        let mode: 'select' | 'insert' | 'update' = 'select';
        let patch: Row = {};
        let inserted: Row | null = null;
        let embedAgent = false;
        let cap: number | null = null;
        const run = () => {
            if (mode === 'insert') return { data: inserted ? [inserted] : [], error: null };
            let rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
            if (mode === 'update') for (const r of rows) Object.assign(r, patch);
            if (cap !== null) rows = rows.slice(0, cap);
            if (embedAgent) rows = rows.map((r) => ({ ...r, agent: (tables.delphi_agents ?? []).find((a) => a.id === r.agent_id) }));
            return { data: rows, error: null };
        };
        const self: Record<string, unknown> = {
            select: (cols?: string) => ((embedAgent = !!cols?.includes('agent:')), self),
            eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), self),
            neq: (k: string, v: unknown) => (filters.push((r) => r[k] !== v), self),
            is: (k: string, v: unknown) => (filters.push((r) => (r[k] ?? null) === v), self),
            in: (k: string, v: unknown[]) => (filters.push((r) => v.includes(r[k])), self),
            lt: () => self,
            not: () => self,
            textSearch: (_col: string, q: string) => (filters.push((r) => `${r.title} ${r.body}`.toLowerCase().includes(q.toLowerCase().split(' ')[0])), self),
            order: () => self,
            limit: (k: number) => ((cap = k), self),
            insert: (row: Row) => {
                mode = 'insert';
                inserted = { id: `${table}-${n++}`, ...row };
                (tables[table] ??= []).push(inserted);
                return self;
            },
            update: (p: Row) => ((mode = 'update'), (patch = p), self),
            maybeSingle: async () => ({ data: run().data[0] ?? null, error: null }),
            single: async () => ({ data: run().data[0] ?? null, error: null }),
            then: (resolve: (v: unknown) => unknown) => Promise.resolve(run()).then(resolve),
        };
        return self;
    };
    return { from } as unknown as Db;
}

const W = 'ws-1';
const OTHER_W = 'ws-2';

function account(id: string, department: string, niche: string, name: string): Row {
    return {
        id,
        workspace_id: W,
        department_id: department,
        platform: 'youtube',
        name,
        handle: null,
        url: null,
        status: 'active',
        preferences: { niche, formats: ['short'] },
        created_at: '2026-10-01T00:00:00Z',
    };
}

function seed(): Record<string, Row[]> {
    return {
        delphi_departments: [
            {
                id: 'D1', workspace_id: W, name: 'Studio One', kind: 'studio', charter: 'PURPOSE-D1 make shorts for my channels',
                settings: { houseRules: 'HOUSE-D1', roleNotes: { writer: 'NOTE-D1-WRITER', designer: 'NOTE-D1-DESIGNER' }, timezone: 'Europe/London' },
            },
            {
                id: 'D2', workspace_id: W, name: 'Morning Brief', kind: 'research', charter: 'PURPOSE-D2 brief me every morning',
                settings: { houseRules: 'HOUSE-D2', roleNotes: { writer: 'NOTE-D2-WRITER' }, research: { topics: ['TOPIC-D2'], sources: ['fred', 'rss'] } },
            },
        ],
        delphi_media_accounts: [
            account('A1', 'D1', 'NICHE-A1', 'Channel One'),
            account('A2', 'D1', 'NICHE-A2', 'Channel Two'),
            account('B1', 'D2', 'NICHE-B1', 'Stray Channel'),
        ],
        delphi_memories: [
            { id: 'm1', workspace_id: W, scope: 'department', department_id: 'D1', account_id: null, kind: 'decision', title: 'DEC-D1', body: 'applies to the whole studio' },
            { id: 'm2', workspace_id: W, scope: 'department', department_id: 'D1', account_id: null, kind: 'lesson', title: 'LESSON-D1', body: 'hooks work' },
            { id: 'm3', workspace_id: W, scope: 'account', department_id: 'D1', account_id: 'A1', kind: 'decision', title: 'DEC-A1', body: 'no music' },
            { id: 'm4', workspace_id: W, scope: 'account', department_id: 'D1', account_id: 'A2', kind: 'decision', title: 'DEC-A2', body: 'always music' },
            { id: 'm5', workspace_id: W, scope: 'department', department_id: 'D2', account_id: null, kind: 'lesson', title: 'LESSON-D2', body: 'cite FRED' },
            // Filed organisation-wide by the old retrospective, but learned in D2.
            { id: 'm6', workspace_id: W, scope: 'org', department_id: 'D2', account_id: null, kind: 'lesson', title: 'LEGACY-D2', body: 'old lesson' },
            { id: 'm7', workspace_id: W, scope: 'org', department_id: null, account_id: null, kind: 'fact', title: 'PIN-ORG', body: 'the CHO is in London' },
            // Another workspace entirely.
            { id: 'm8', workspace_id: OTHER_W, scope: 'department', department_id: 'D1', account_id: null, kind: 'decision', title: 'FOREIGN', body: 'not ours' },
        ],
        delphi_artifacts: [
            { id: 'x1', workspace_id: W, account_id: 'A1', title: 'HIST-A1', kind: 'video', created_at: '2026-10-02T00:00:00Z', deleted_at: null, data: { studio: { publish: { title: 'HIST-A1' }, format: 'short', published: { url: 'https://youtu.be/a1' } } } },
            { id: 'x2', workspace_id: W, account_id: 'A2', title: 'HIST-A2', kind: 'video', created_at: '2026-10-02T00:00:00Z', deleted_at: null, data: {} },
            { id: 'x3', workspace_id: W, account_id: 'B1', title: 'HIST-B1', kind: 'video', created_at: '2026-10-02T00:00:00Z', deleted_at: null, data: {} },
            { id: 'x4', workspace_id: W, account_id: 'A1', title: 'TRASHED-A1', kind: 'video', created_at: '2026-10-03T00:00:00Z', deleted_at: '2026-10-04T00:00:00Z', data: {} },
        ],
    };
}

const MARKERS = ['PURPOSE-D1', 'PURPOSE-D2', 'HOUSE-D1', 'HOUSE-D2', 'NOTE-D1-WRITER', 'NOTE-D1-DESIGNER', 'NOTE-D2-WRITER', 'TOPIC-D2', 'NICHE-A1', 'NICHE-A2', 'NICHE-B1', 'DEC-D1', 'DEC-A1', 'DEC-A2', 'LESSON-D1', 'LESSON-D2', 'LEGACY-D2', 'HIST-A1', 'HIST-A2', 'HIST-B1', 'TRASHED-A1', 'FOREIGN', 'PIN-ORG'];

function check(label: string, text: string, expect: string[]) {
    const present = MARKERS.filter((m) => text.includes(m));
    const missing = expect.filter((m) => !present.includes(m));
    const leaked = present.filter((m) => !expect.includes(m));
    ok(missing.length === 0 && leaked.length === 0, label, missing.length || leaked.length ? `missing ${missing.join(',') || '-'} · leaked ${leaked.join(',') || '-'}` : `${present.length} markers, all its own`);
}

async function main() {
    console.log('\nWhat each compartment sees');
    {
        const db = fakeDb(seed());
        const a1 = await contextFor(db, { workspaceId: W, departmentId: 'D1', accountId: 'A1' }, { role: 'writer' });
        check('channel A1, as the writer', renderContext(a1!), ['PURPOSE-D1', 'HOUSE-D1', 'NOTE-D1-WRITER', 'NICHE-A1', 'DEC-D1', 'DEC-A1', 'LESSON-D1', 'HIST-A1', 'PIN-ORG']);
        const a2 = await contextFor(db, { workspaceId: W, departmentId: 'D1', accountId: 'A2' }, { role: 'designer' });
        check('channel A2, as the designer', renderContext(a2!), ['PURPOSE-D1', 'HOUSE-D1', 'NOTE-D1-DESIGNER', 'NICHE-A2', 'DEC-D1', 'DEC-A2', 'LESSON-D1', 'HIST-A2', 'PIN-ORG']);
        const d1 = await contextFor(db, { workspaceId: W, departmentId: 'D1' });
        check('the studio itself, no role', renderContext(d1!), ['PURPOSE-D1', 'HOUSE-D1', 'DEC-D1', 'LESSON-D1', 'PIN-ORG']);
        check('the studio, for the planner (every role note)', renderContext(d1!, { allRoleNotes: true }), ['PURPOSE-D1', 'HOUSE-D1', 'NOTE-D1-WRITER', 'NOTE-D1-DESIGNER', 'DEC-D1', 'LESSON-D1', 'PIN-ORG']);
        const d2 = await contextFor(db, { workspaceId: W, departmentId: 'D2' }, { role: 'writer' });
        check('the research department, as the writer', renderContext(d2!), ['PURPOSE-D2', 'HOUSE-D2', 'NOTE-D2-WRITER', 'TOPIC-D2', 'LESSON-D2', 'LEGACY-D2', 'PIN-ORG']);
        ok(a1!.history.length === 1 && a1!.history[0].publishedUrl === 'https://youtu.be/a1', 'a channel\'s history leaves out the trash and keeps the published link');
        ok(JSON.stringify(allowedSources(d2)) === '["fred","rss"]' && allowedSources(d1).length === 0, 'a research department\'s chosen sources are what its agents may use');
    }

    console.log('\nWhat is not followed');
    {
        const db = fakeDb(seed());
        const stray = await contextFor(db, { workspaceId: W, departmentId: 'D1', accountId: 'B1' });
        ok(stray !== null && stray.account === null, 'a channel from another department is not read under this one');
        check('…and none of its material appears', renderContext(stray!), ['PURPOSE-D1', 'HOUSE-D1', 'DEC-D1', 'LESSON-D1', 'PIN-ORG']);
        ok((await contextFor(db, { workspaceId: OTHER_W, departmentId: 'D1' })) === null, 'a department is not read from another workspace');
        ok((await contextFor(db, { workspaceId: W, departmentId: 'NOPE' })) === null, 'a department that does not exist gives nothing');
    }

    console.log('\nEvery prompt builder carries its compartment');
    {
        const db = fakeDb(seed());
        const a1 = renderContext((await contextFor(db, { workspaceId: W, departmentId: 'D1', accountId: 'A1' }, { role: 'writer' }))!);
        const task = buildPrompt({ objective: 'Write the script', projectBrief: 'brief', upstream: null, handoffDossier: null, context: a1 });
        check('a text task for A1', task, ['PURPOSE-D1', 'HOUSE-D1', 'NOTE-D1-WRITER', 'NICHE-A1', 'DEC-D1', 'DEC-A1', 'LESSON-D1', 'HIST-A1', 'PIN-ORG']);
        ok(task.indexOf('HOUSE-D1') < task.indexOf('PROJECT BRIEF'), 'the compartment comes before the brief');

        const acc = { id: 'A1', workspaceId: W, departmentId: 'D1', platform: 'youtube', name: 'Channel One', handle: null, url: null, status: 'active', preferences: withDefaults({ niche: 'NICHE-A1' }), createdAt: '', updatedAt: '' } as MediaAccount;
        const studio = buildStudioPrompt({ format: 'short', objective: 'Make it', projectBrief: 'brief', upstream: null, account: acc, stock: false, context: a1 });
        check('a render for A1', studio, ['PURPOSE-D1', 'HOUSE-D1', 'NOTE-D1-WRITER', 'NICHE-A1', 'DEC-D1', 'DEC-A1', 'LESSON-D1', 'HIST-A1', 'PIN-ORG']);
        ok(!studio.includes('--- THE ACCOUNT THIS IS FOR ---'), 'with a compartment, the render prompt does not repeat the bare description');

        const d1 = renderContext((await contextFor(db, { workspaceId: W, departmentId: 'D1' }))!, { allRoleNotes: true });
        const plan = buildPlanPrompt({ brief: 'PURPOSE-D1 make shorts', candidates: [], availableChannels: [], departmentContext: d1, kindRules: 'KIND-RULES', pinned: { writer: 'writer' } });
        check('the staffing prompt for the studio', plan, ['PURPOSE-D1', 'HOUSE-D1', 'NOTE-D1-WRITER', 'NOTE-D1-DESIGNER', 'DEC-D1', 'LESSON-D1', 'PIN-ORG']);
        ok(plan.includes('KIND-RULES') && plan.includes('PINNED BY THE CHO') && plan.includes('- Writer: writer'), 'it carries the kind\'s rules and the pins');
    }

    console.log('\nPins are kept');
    {
        const agent = (slug: string, title: string): Agent => ({ id: slug, workspaceId: W, slug, name: slug, title, avatarSeed: null, systemPrompt: '', skills: [], channelIds: [], model: 'm', costTier: 2, origin: 'seed', inventedFor: null, archivedAt: null });
        const roster = [agent('writer', 'Staff Writer'), agent('caption-writer', 'Caption Writer'), agent('research-analyst', 'Research Analyst')];
        const titles = new Map(roster.map((a) => [a.slug, a.title]));
        const slugs = new Set(roster.map((a) => a.slug));
        const plan = (slug: string) => ({ departmentName: 'x', summary: 's', estimatedCostUsd: 1, requiredChannels: [], tasks: [{ seq: 1, title: 't', objective: 'o', assignedSlug: 'research-analyst', rationale: 'r', fit: 0.9 }, { seq: 2, title: 't', objective: 'o', assignedSlug: slug, rationale: 'r', fit: 0.9 }] });
        ok(validateStaffingPlan(plan('caption-writer'), slugs, [], { pinned: {}, titles }).tasks.length === 2, 'without a pin, any writer will do');
        let message = '';
        try {
            validateStaffingPlan(plan('caption-writer'), slugs, [], { pinned: { writer: 'writer' }, titles });
        } catch (e) {
            message = (e as Error).message;
        }
        ok(/pinned "writer"/.test(message), 'writing work given to someone other than the pinned writer is sent back', message.slice(0, 80));
        ok(validateStaffingPlan(plan('writer'), slugs, [], { pinned: { writer: 'writer' }, titles }).tasks.length === 2, 'the pinned writer passes');
        const shortlist: Candidate[] = [{ agent: roster[2], stats: null, skillMatch: 1 }];
        ok(withPinned(shortlist, roster, new Map(), { writer: 'writer' }).map((c) => c.agent.slug).join(',') === 'research-analyst,writer', 'a pinned agent joins the shortlist');
    }

    console.log('\nThe runtime refuses work for a channel outside its department');
    {
        const t = seed();
        Object.assign(t, {
            delphi_system_state: [{ workspace_id: W, mode: 'running' }],
            delphi_projects: [{ id: 'p1', workspace_id: W, department_id: 'D1', title: 'P', brief: 'b', status: 'running', spent_usd: 0, budget_usd: 5 }],
            delphi_agents: [{ id: 'ag', slug: 'writer', name: 'Shion', title: 'Staff Writer', system_prompt: 'x', model: 'm', channel_ids: [] }],
            delphi_tasks: [{ id: 't1', workspace_id: W, project_id: 'p1', agent_id: 'ag', seq: 1, title: 'Write', objective: 'o', depends_on: null, status: 'pending', deliverable: 'text', account_id: 'B1' }],
            delphi_task_runs: [], delphi_events: [], delphi_channels: [], delphi_handoffs: [],
        });
        const out = await runNextTask(fakeDb(t), W, 'p1');
        ok(out.status === 'failed' && /not part of this department/.test((out as { error: string }).error), 'it fails the step with the reason, before any model call', out.status === 'failed' ? (out as { error: string }).error.slice(0, 70) : out.status);
    }

    console.log('\nRecall and writing are scoped');
    {
        const t = seed();
        const db = fakeDb(t);
        const d1 = await recallMemories(db, W, 'lesson', 'D1');
        ok(d1.every((m) => m.departmentId === 'D1') && d1.some((m) => m.title === 'LESSON-D1'), 'recall needs a department and returns only its memories', d1.map((m) => m.title).join(','));
        await writeMemory(db, W, { scope: 'department', kind: 'lesson', title: 'NEW', body: 'b', departmentId: 'D2' });
        const plain = t.delphi_memories[t.delphi_memories.length - 1];
        ok(!('account_id' in plain), 'a department\'s lesson is written without naming the channel column');
        await writeMemory(db, W, { scope: 'account', kind: 'lesson', title: 'NEW2', body: 'b', departmentId: 'D1', accountId: 'A1' });
        const filed = t.delphi_memories[t.delphi_memories.length - 1];
        ok(filed.account_id === 'A1' && filed.scope === 'account', 'a channel\'s lesson is filed to the channel');
    }

    console.log(failed ? `\n${R}${failed} check(s) failed${RS}` : `\n${G}all compartment checks passed${RS}`);
    process.exit(failed ? 1 : 0);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
