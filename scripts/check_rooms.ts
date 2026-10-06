/**
 * Rooms, offline.
 *
 * A studio with two channels and a research department beside it, each with
 * its own work, decisions and conversation. Then every rule the rooms make:
 * what a room's tools can read, what a room's prompt carries, that a card
 * does nothing until the owner confirms it and then does exactly what it
 * says, who may post and who may confirm, that a decision lands in its own
 * compartment, that @name brings in one member of the team, and that new work
 * posts itself into the right room without ever failing the task.
 *
 *   npm run delphi:rooms
 */

import { readFileSync } from 'node:fs';
import {
    confirmCard,
    deleteDecision,
    dismissCard,
    listDecisions,
    peopleFor,
    postWorkToRoom,
    recordDecision,
    refusal,
    replyInRoom,
    roomFor,
    roomPrompt,
    roomView,
    runRoomTool,
    teamOf,
    updateDecision,
    type CardEffects,
    type Converse,
    type People,
    type Room,
} from '../src/lib/delphi/rooms';
import { describeCard, mentioned, validCard, type Card } from '../src/lib/delphi/room-cards';
import { contextFor, renderContext } from '../src/lib/delphi/context';
import type { Db } from '../src/lib/delphi/db';

const G = '\x1b[32m', R = '\x1b[31m', D = '\x1b[2m', RS = '\x1b[0m';
let failed = 0;
const ok = (cond: boolean, label: string, note = '') => {
    if (!cond) failed++;
    console.log(`  ${cond ? G + '✓' : R + '✗'}${RS} ${label.padEnd(72)}${note ? D + note + RS : ''}`);
};

type Row = Record<string, unknown>;

// ---------------------------------------------------------------------------
// A small PostgREST: filters (dotted ones on embeds too), ordering, limits,
// the embeds the rooms use, inserts and updates and deletes that return rows.
// ---------------------------------------------------------------------------

function fakeDb(tables: Record<string, Row[]>, opts: { failInserts?: boolean } = {}) {
    let n = 1;
    let clock = Date.parse('2026-10-06T09:00:00Z');
    const byId = (table: string, id: unknown) => (tables[table] ?? []).find((r) => r.id === id) ?? null;

    function embed(table: string, r: Row, cols: string): Row {
        const out: Row = { ...r };
        if (table === 'delphi_messages' && cols.includes('author:')) out.author = byId('delphi_agents', r.author_agent_id);
        if (table === 'delphi_artifacts' && cols.includes('project:')) out.project = byId('delphi_projects', r.project_id);
        if (table === 'delphi_artifacts' && cols.includes('task:')) {
            const t = byId('delphi_tasks', r.task_id);
            out.task = t ? { ...t, agent: byId('delphi_agents', t.agent_id) } : null;
        }
        if (table === 'delphi_hires' && cols.includes('agent:')) out.agent = byId('delphi_agents', r.agent_id);
        return out;
    }

    const get = (r: Row, k: string): unknown => k.split('.').reduce<unknown>((v, p) => (v && typeof v === 'object' ? (v as Row)[p] : undefined), r);

    const from = (table: string) => {
        const st = {
            op: 'select' as 'select' | 'insert' | 'update' | 'delete',
            cols: '*',
            filters: [] as ((r: Row) => boolean)[],
            payload: null as Row | null,
            order: null as { col: string; asc: boolean } | null,
            cap: null as number | null,
            inner: false,
        };
        const run = () => {
            const rows = (tables[table] ??= []);
            if (st.op === 'insert') {
                if (opts.failInserts) return { data: null, error: { message: 'insert refused' } };
                clock += 1000;
                const row = { id: `${table}-${n++}`, created_at: new Date(clock).toISOString(), ...st.payload };
                rows.push(row);
                return { data: [embed(table, row, st.cols)], error: null };
            }
            let hit = rows.map((r) => embed(table, r, st.cols));
            if (st.inner) hit = hit.filter((r) => r.project);
            hit = hit.filter((r) => st.filters.every((f) => f(r)));
            if (st.op === 'update') {
                for (const r of hit) Object.assign(rows.find((x) => x.id === r.id)!, st.payload);
                return { data: hit.map((r) => ({ ...rows.find((x) => x.id === r.id) })), error: null };
            }
            if (st.op === 'delete') {
                for (const r of hit) rows.splice(rows.findIndex((x) => x.id === r.id), 1);
                return { data: hit, error: null };
            }
            if (st.order) {
                const { col, asc } = st.order;
                hit = [...hit].sort((a, b) => String(a[col] ?? '').localeCompare(String(b[col] ?? '')) * (asc ? 1 : -1));
            }
            if (st.cap !== null) hit = hit.slice(0, st.cap);
            return { data: hit, error: null };
        };
        const self: Record<string, unknown> = {
            select: (cols?: string) => {
                if (cols) st.cols = cols;
                if (cols?.includes('!inner')) st.inner = true;
                return self;
            },
            eq: (k: string, v: unknown) => (st.filters.push((r) => get(r, k) === v), self),
            neq: (k: string, v: unknown) => (st.filters.push((r) => get(r, k) !== v), self),
            is: (k: string, v: unknown) => (st.filters.push((r) => (get(r, k) ?? null) === v), self),
            in: (k: string, v: unknown[]) => (st.filters.push((r) => v.includes(get(r, k))), self),
            gte: (k: string, v: string) => (st.filters.push((r) => String(get(r, k) ?? '') >= v), self),
            order: (col: string, o?: { ascending?: boolean }) => ((st.order ??= { col, asc: o?.ascending !== false }), self),
            limit: (k: number) => ((st.cap = k), self),
            insert: (row: Row) => ((st.op = 'insert'), (st.payload = row), self),
            update: (p: Row) => ((st.op = 'update'), (st.payload = p), self),
            delete: () => ((st.op = 'delete'), self),
            maybeSingle: async () => {
                const r = run();
                return { data: (r.data as Row[] | null)?.[0] ?? null, error: r.error };
            },
            single: async () => {
                const r = run();
                return { data: (r.data as Row[] | null)?.[0] ?? null, error: r.error };
            },
            then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject),
        };
        return self;
    };
    const storage = {
        from: () => ({
            createSignedUrls: async (paths: string[]) => ({ data: paths.map((p) => ({ path: p, signedUrl: `signed:${p}`, error: null })), error: null }),
        }),
    };
    return { from, storage } as unknown as Db;
}

// ---------------------------------------------------------------------------
// The world
// ---------------------------------------------------------------------------

const W = 'ws-1';
const OTHER_W = 'ws-2';
const OWNER = 'user-owner';
const REVIEWER = 'user-reviewer';

function account(id: string, department: string, niche: string, name: string, status = 'active'): Row {
    return {
        id,
        workspace_id: W,
        department_id: department,
        platform: 'youtube',
        name,
        handle: null,
        url: null,
        status,
        preferences: { niche, formats: ['short'], tone: 'warm' },
        created_at: `2026-10-01T00:00:0${id.length}Z`,
    };
}

function seed(): Record<string, Row[]> {
    return {
        delphi_departments: [
            { id: 'D1', workspace_id: W, name: 'Studio One', kind: 'studio', charter: 'PURPOSE-D1 shorts for my channels', settings: { houseRules: 'HOUSE-D1' } },
            { id: 'D2', workspace_id: W, name: 'Morning Brief', kind: 'research', charter: 'PURPOSE-D2 brief me', settings: { houseRules: 'HOUSE-D2' } },
        ],
        delphi_media_accounts: [account('A1', 'D1', 'NICHE-A1', 'Channel One'), account('A2', 'D1', 'NICHE-A2', 'Channel Two'), account('B1', 'D2', 'NICHE-B1', 'Stray')],
        delphi_agents: [
            { id: 'ceo', workspace_id: W, slug: 'delphi-ceo', name: 'Diablo', title: 'CEO', avatar_seed: null, system_prompt: 'CEO PROMPT' },
            { id: 'ag-shion', workspace_id: W, slug: 'script-writer', name: 'Shion', title: 'Script Writer', avatar_seed: null, system_prompt: 'SHION PROMPT' },
            { id: 'ag-kurobe', workspace_id: W, slug: 'video-editor', name: 'Kurobe', title: 'Video Editor', avatar_seed: null, system_prompt: 'KUROBE PROMPT' },
            { id: 'ag-souei', workspace_id: W, slug: 'research-analyst', name: 'Souei', title: 'Research Analyst', avatar_seed: null, system_prompt: 'SOUEI PROMPT' },
        ],
        delphi_hires: [
            { id: 'h1', department_id: 'D1', agent_id: 'ag-shion' },
            { id: 'h2', department_id: 'D1', agent_id: 'ag-kurobe' },
            { id: 'h3', department_id: 'D1', agent_id: 'ceo' },
            { id: 'h4', department_id: 'D2', agent_id: 'ag-souei' },
        ],
        delphi_projects: [
            { id: 'P1', workspace_id: W, department_id: 'D1' },
            { id: 'P2', workspace_id: W, department_id: 'D2' },
        ],
        delphi_tasks: [
            { id: 'T1', project_id: 'P1', agent_id: 'ag-kurobe' },
            { id: 'T2', project_id: 'P2', agent_id: 'ag-souei' },
        ],
        delphi_artifacts: [
            { id: 'X-A1', workspace_id: W, project_id: 'P1', task_id: 'T1', account_id: 'A1', title: 'WORK-A1 the first short', kind: 'video', content_md: 'BODY-A1', review_status: 'pending', storage_path: 'ws/a1.mp4', data: { studio: { kind: 'video', files: { thumbnail: { path: 'ws/a1.jpg' } } } }, created_at: '2026-10-05T00:00:00Z', deleted_at: null },
            { id: 'X-A2', workspace_id: W, project_id: 'P1', task_id: 'T1', account_id: 'A2', title: 'WORK-A2 the second short', kind: 'video', content_md: 'BODY-A2', review_status: 'pending', storage_path: 'ws/a2.mp4', data: {}, created_at: '2026-10-05T01:00:00Z', deleted_at: null },
            { id: 'X-D2', workspace_id: W, project_id: 'P2', task_id: 'T2', account_id: null, title: 'WORK-D2 the morning brief', kind: 'report', content_md: 'BODY-D2', review_status: 'pending', storage_path: null, data: {}, created_at: '2026-10-05T02:00:00Z', deleted_at: null },
            { id: 'X-A1-OLD', workspace_id: W, project_id: 'P1', task_id: 'T1', account_id: 'A1', title: 'TRASHED-A1', kind: 'video', content_md: '', review_status: 'pending', storage_path: null, data: {}, created_at: '2026-10-04T00:00:00Z', deleted_at: '2026-10-05T00:00:00Z' },
        ],
        delphi_memories: [
            { id: 'm1', workspace_id: W, scope: 'account', department_id: 'D1', account_id: 'A2', kind: 'decision', title: 'DEC-A2', body: 'DEC-A2', importance: 5, created_at: '2026-10-01T00:00:00Z' },
        ],
        delphi_threads: [
            { id: 'R-D1', workspace_id: W, department_id: 'D1', account_id: null, kind: 'room', title: 'Studio One' },
            { id: 'R-A1', workspace_id: W, department_id: 'D1', account_id: 'A1', kind: 'room', title: 'Channel One' },
            { id: 'R-A2', workspace_id: W, department_id: 'D1', account_id: 'A2', kind: 'room', title: 'Channel Two' },
            { id: 'R-D2', workspace_id: W, department_id: 'D2', account_id: null, kind: 'room', title: 'Morning Brief' },
            { id: 'CEO', workspace_id: W, department_id: null, account_id: null, kind: 'ceo', title: 'Conversation with Delphi' },
        ],
        delphi_messages: [
            { id: 'msg-a2', workspace_id: W, thread_id: 'R-A2', author_user_id: OWNER, author_agent_id: null, role: 'cho', content: 'TALK-A2 keep it moody', created_at: '2026-10-05T10:00:00Z', artifact_ids: [] },
            { id: 'msg-d2', workspace_id: W, thread_id: 'R-D2', author_user_id: OWNER, author_agent_id: null, role: 'cho', content: 'TALK-D2 more charts', created_at: '2026-10-05T10:00:00Z', artifact_ids: [] },
        ],
        delphi_events: [],
    };
}

const PEOPLE: People = { cho: 'Curtis', ownerId: OWNER };
const OWNER_SPEAKS = { userId: OWNER, name: 'Curtis', isOwner: true };
const room = (id: string, departmentId: string, accountId: string | null): Room => ({ id, workspaceId: W, departmentId, accountId, title: id });
const ROOM_A1 = room('R-A1', 'D1', 'A1');
const ROOM_A2 = room('R-A2', 'D1', 'A2');
const ROOM_D1 = room('R-D1', 'D1', null);
const ROOM_D2 = room('R-D2', 'D2', null);

/** A model that runs the tool calls it is given, then answers. It records what it was shown. */
function scripted(calls: { name: string; args: Record<string, unknown> }[], reply = 'Understood.') {
    const seen: { system: string; prompt: string; tools: string[]; results: string[] } = { system: '', prompt: '', tools: [], results: [] };
    const converse: Converse = async ({ system, prompt, tools, execute }) => {
        seen.system = system;
        seen.prompt = prompt;
        seen.tools = tools.map((t) => t.name!);
        for (const c of calls) seen.results.push((await execute(c.name, c.args)).content);
        return { reply, costUsd: 0.001, model: 'fake' };
    };
    return { converse, seen };
}

function effects() {
    const calls: { artifactId: string; note: string }[] = [];
    const e: CardEffects = {
        sendBack: async (artifactId, note) => {
            calls.push({ artifactId, note });
            return { ok: true };
        },
    };
    return { e, calls };
}

const cardsIn = (tables: Record<string, Row[]>, roomId: string) => (tables.delphi_messages ?? []).filter((m) => m.thread_id === roomId && m.card);
const prefs = (tables: Record<string, Row[]>, id: string) => (tables.delphi_media_accounts.find((a) => a.id === id)!.preferences as Row);

async function main() {
    console.log('\nWhat a room can read');
    {
        const tables = seed();
        const db = fakeDb(tables);
        const list = (r: Room) => runRoomTool(db, r, 'list_work', {}, []).then((x) => x.content);
        const a1 = await list(ROOM_A1);
        ok(a1.includes('WORK-A1') && !a1.includes('WORK-A2') && !a1.includes('WORK-D2'), "a channel's room lists its own work only");
        ok(!a1.includes('TRASHED-A1'), '…and not what is in the trash');
        const d1 = await list(ROOM_D1);
        ok(d1.includes('WORK-A1') && d1.includes('WORK-A2') && !d1.includes('WORK-D2'), "the studio's room lists every channel's work, and no other department's");
        const read = await runRoomTool(db, ROOM_A1, 'read_work', { title: 'WORK-A2' }, []);
        ok(!read.content.includes('BODY-A2') && read.content.startsWith('Nothing in this room'), "channel A1's room cannot read channel A2's work by name");
        const own = await runRoomTool(db, ROOM_A1, 'read_work', { title: 'first short' }, []);
        ok(own.content.includes('BODY-A1'), '…and reads its own by a fragment of the title');
        const cross = await runRoomTool(db, ROOM_D2, 'read_work', { title: 'WORK-A1' }, []);
        ok(cross.content.startsWith('Nothing in this room'), "a research department's room cannot read the studio's work");
    }

    console.log('\nWhat a room\'s prompt carries');
    {
        const tables = seed();
        const db = fakeDb(tables);
        const team = await teamOf(db, 'D1');
        ok(team.map((t) => t.name).join(',') === 'Shion,Kurobe', "the team is the department's hires, Diablo aside");
        const history = (id: string) => import('../src/lib/delphi/rooms').then((m) => m.loadRoom(db, id, PEOPLE));
        const a1 = await roomPrompt(db, { room: ROOM_A1, speaker: OWNER_SPEAKS, message: 'How is it going?', people: PEOPLE, agent: null, history: await history('R-A1'), team });
        const p = a1!.prompt + a1!.system;
        ok(p.includes('NICHE-A1') && p.includes('HOUSE-D1') && p.includes('PURPOSE-D1'), "channel A1's prompt has its channel and its department");
        ok(!p.includes('NICHE-A2') && !p.includes('DEC-A2') && !p.includes('TALK-A2'), "…and nothing of channel A2: not its settings, decisions or conversation");
        ok(!p.includes('HOUSE-D2') && !p.includes('TALK-D2') && !p.includes('NICHE-B1'), '…and nothing of the other department');
        const a2 = await roomPrompt(db, { room: ROOM_A2, speaker: OWNER_SPEAKS, message: 'And here?', people: PEOPLE, agent: null, history: await history('R-A2'), team });
        ok(a2!.prompt.includes('NICHE-A2') && a2!.prompt.includes('DEC-A2') && a2!.prompt.includes('TALK-A2'), "channel A2's own room does carry its settings, decisions and conversation");

        const d1 = await roomPrompt(db, { room: ROOM_D1, speaker: OWNER_SPEAKS, message: 'Overview?', people: PEOPLE, agent: null, history: await history('R-D1'), team });
        const q = d1!.prompt;
        ok(q.includes('Channel One') && q.includes('Channel Two') && q.includes('THE CHANNELS'), "the studio's room sees where each channel stands");
        ok(!q.includes('DEC-A2') && !q.includes('TALK-A2') && !q.includes('NICHE-A2'), "…but not a channel's decisions, settings or conversation");

        const asReviewer = await roomPrompt(db, {
            room: ROOM_A1,
            speaker: { userId: REVIEWER, name: 'Benimaru', isOwner: false },
            message: 'Can we change the tone?',
            people: PEOPLE,
            agent: null,
            history: [],
            team,
        });
        ok(asReviewer!.prompt.includes('Benimaru (a reviewer): Can we change the tone?') && asReviewer!.system.includes('a reviewer, is speaking — not the CHO'), 'a reviewer speaking is named as one, not as the CHO');
    }

    console.log('\nCards do nothing until the owner confirms');
    {
        const tables = seed();
        const db = fakeDb(tables);
        const before = JSON.stringify(prefs(tables, 'A1'));
        const { converse, seen } = scripted([
            { name: 'propose_setting', args: { field: 'tone', value: 'dry and fast', why: 'the CHO asked' } },
            { name: 'propose_pause', args: { pause: true } },
            { name: 'propose_decision', args: { text: 'DECIDED-A1 never use music' } },
            { name: 'propose_send_back', args: { title: 'first short', note: 'The hook is too slow; open on the result.' } },
        ]);
        const { e, calls } = effects();
        const res = await replyInRoom(db, { room: ROOM_A1, speaker: OWNER_SPEAKS, message: 'Make it drier, pause it, no music, and redo the first short.', people: PEOPLE, converse });
        ok(!res.error && res.posted.length === 6, 'the message, the reply and four cards are posted', `${res.posted.length} posted`);
        ok(seen.tools.includes('propose_setting') && seen.tools.includes('propose_pause'), "a channel's room offers the channel's cards");
        const cards = cardsIn(tables, 'R-A1');
        ok(cards.length === 4 && cards.every((m) => (m.card as Card).status === 'pending' && m.role === 'ceo' && m.author_agent_id === 'ceo'), 'every card is pending, and posted by Diablo');
        ok(JSON.stringify(prefs(tables, 'A1')) === before, 'the setting has not changed');
        ok(tables.delphi_media_accounts.find((a) => a.id === 'A1')!.status === 'active', 'the channel is not paused');
        ok(!tables.delphi_memories.some((m) => String(m.body).includes('DECIDED-A1')), 'no decision is recorded');
        ok(calls.length === 0, 'nothing is sent back');

        const byType = (t: string) => cards.find((m) => (m.card as Card).type === t)!.id as string;
        const set = await confirmCard(db, W, byType('set_preference'), e);
        ok(set.ok && (prefs(tables, 'A1').tone as string) === 'dry and fast', 'confirming the setting card changes that setting', set.error ?? '');
        ok((prefs(tables, 'A1').niche as string) === 'NICHE-A1', '…and nothing else about the channel');
        const pause = await confirmCard(db, W, byType('pause_account'), e);
        ok(pause.ok && tables.delphi_media_accounts.find((a) => a.id === 'A1')!.status === 'paused', 'confirming the pause card pauses the channel');
        ok(tables.delphi_media_accounts.find((a) => a.id === 'A2')!.status === 'active', '…and only that channel');
        const back = await confirmCard(db, W, byType('send_back'), e);
        ok(back.ok && calls.length === 1 && calls[0].artifactId === 'X-A1' && calls[0].note.includes('hook'), 'confirming the send-back sends that piece back with the note');
        const again = await confirmCard(db, W, byType('send_back'), e);
        ok(!again.ok && calls.length === 1, 'a card is done once: confirming again does nothing', again.error ?? '');
        ok(tables.delphi_events.some((ev) => ev.type === 'card_confirmed'), 'what was confirmed is in the activity log');
    }

    console.log('\nA decision lands in its own compartment');
    {
        const tables = seed();
        const db = fakeDb(tables);
        const { converse } = scripted([{ name: 'propose_decision', args: { text: 'DECIDED-A1 always captions in yellow' } }]);
        await replyInRoom(db, { room: ROOM_A1, speaker: OWNER_SPEAKS, message: 'Remember: captions in yellow.', people: PEOPLE, converse });
        const card = cardsIn(tables, 'R-A1')[0];
        const { e } = effects();
        ok((await confirmCard(db, W, card.id as string, e)).ok, 'the decision card is confirmed');
        const ctx = async (accountId: string | null, dept = 'D1') => renderContext((await contextFor(db, { workspaceId: W, departmentId: dept, accountId }))!);
        ok((await ctx('A1')).includes('DECIDED-A1'), "it is in every future prompt for channel A1");
        ok(!(await ctx('A2')).includes('DECIDED-A1') && !(await ctx(null)).includes('DECIDED-A1') && !(await ctx(null, 'D2')).includes('DECIDED-A1'), '…and in no other channel, the studio or the other department');
        ok((await listDecisions(db, W, 'D1', 'A1')).some((d) => d.text.includes('DECIDED-A1')) && !(await listDecisions(db, W, 'D1', 'A2')).some((d) => d.text.includes('DECIDED-A1')), "it is on A1's Decisions list only");

        await recordDecision(db, ROOM_D1, 'DECIDED-D1 every short ends on the logo');
        ok((await ctx('A1')).includes('DECIDED-D1') && (await ctx('A2')).includes('DECIDED-D1') && !(await ctx(null, 'D2')).includes('DECIDED-D1'), "a studio decision reaches both its channels and not the other department");

        const id = (await listDecisions(db, W, 'D1', 'A1'))[0].id;
        ok((await updateDecision(db, W, id, 'DECIDED-A1 captions in white')).ok && (await ctx('A1')).includes('captions in white'), 'a decision can be reworded, and the prompts follow');
        ok(!(await updateDecision(db, OTHER_W, id, 'hijacked from elsewhere')).ok, '…but not from another workspace');
        ok(!(await deleteDecision(db, W, 'm-none')).ok, 'deleting a decision that is not there says so');
        ok((await deleteDecision(db, W, id)).ok && !(await ctx('A1')).includes('captions in white'), 'a deleted decision leaves the prompts');
        const lesson = { id: 'lesson-1', workspace_id: W, scope: 'department', department_id: 'D1', account_id: null, kind: 'lesson', title: 'LESSON', body: 'kept' };
        tables.delphi_memories.push(lesson);
        ok(!(await deleteDecision(db, W, 'lesson-1')).ok && tables.delphi_memories.includes(lesson), 'only decisions can be deleted from the list, not lessons');
    }

    console.log('\nWhat a card may touch');
    {
        const tables = seed();
        const db = fakeDb(tables);
        const results: string[] = [];
        const cards: Card[] = [];
        for (const field of ['quality', 'brand', 'status', 'department_id']) {
            results.push((await runRoomTool(db, ROOM_A1, 'propose_setting', { field, value: 'x' }, cards)).content);
        }
        ok(cards.length === 0 && results.every((r) => r.includes('No card was posted')), 'settings outside the list cannot be proposed', results.length + ' refused');
        const deptRoom: Card[] = [];
        await runRoomTool(db, ROOM_D1, 'propose_setting', { field: 'tone', value: 'x' }, deptRoom);
        await runRoomTool(db, ROOM_D1, 'propose_pause', { pause: true }, deptRoom);
        ok(deptRoom.length === 0, "the studio's own room proposes no channel setting or pause");
        const tooShort: Card[] = [];
        await runRoomTool(db, ROOM_A1, 'propose_send_back', { title: 'first short', note: 'no' }, tooShort);
        ok(tooShort.length === 0, 'a send-back with no usable note is not proposed');
        const elsewhere: Card[] = [];
        await runRoomTool(db, ROOM_A1, 'propose_send_back', { title: 'WORK-A2', note: 'redo the whole thing please' }, elsewhere);
        ok(elsewhere.length === 0, "another channel's piece cannot be proposed for sending back");

        // Cards written into the table directly, as a member with database access could.
        const forge = (threadId: string, card: Card, as: Row = { role: 'ceo', author_agent_id: 'ceo', author_user_id: null }) => {
            const id = `forged-${tables.delphi_messages.length}`;
            tables.delphi_messages.push({ id, workspace_id: W, thread_id: threadId, content: card.title, card, created_at: '2026-10-06T00:00:00Z', artifact_ids: [], ...as });
            return id;
        };
        const { e, calls } = effects();
        const crossChannel = forge('R-A1', { type: 'send_back', title: 'Send back A2', args: { artifactId: 'X-A2', note: 'redo it entirely please' }, status: 'pending' });
        const r1 = await confirmCard(db, W, crossChannel, e);
        ok(!r1.ok && calls.length === 0, "a send-back for another channel's piece is refused at confirm", r1.error ?? '');
        const badField = forge('R-A1', { type: 'set_preference', title: 'Set quality', args: { field: 'quality', value: 'hd' }, status: 'pending' });
        const r2 = await confirmCard(db, W, badField, e);
        ok(!r2.ok && (prefs(tables, 'A1').quality ?? 'fhd') !== 'hd', 'a setting outside the list is refused at confirm', r2.error ?? '');
        const byPerson = forge('R-A1', { type: 'pause_account', title: 'Pause', args: {}, status: 'pending' }, { role: 'cho', author_user_id: REVIEWER, author_agent_id: null });
        const r3 = await confirmCard(db, W, byPerson, e);
        ok(!r3.ok && tables.delphi_media_accounts.find((a) => a.id === 'A1')!.status === 'active', 'a "card" posted under a person\'s name is not acted on', r3.error ?? '');
        const invalid = forge('R-A1', { type: 'set_preference', title: 'Set voice', args: { field: 'voice', value: 'NotAVoice' }, status: 'pending' });
        const r4 = await confirmCard(db, W, invalid, e);
        ok(!r4.ok && r4.error!.startsWith('Nothing changed'), 'a value the setting does not take changes nothing, and says so', r4.error ?? '');
        const foreign = forge('R-A1', { type: 'pause_account', title: 'Pause', args: {}, status: 'pending' });
        const r5 = await confirmCard(db, OTHER_W, foreign, e);
        ok(!r5.ok && tables.delphi_media_accounts.find((a) => a.id === 'A1')!.status === 'active', 'a card is not confirmed from another workspace', r5.error ?? '');
        const dismissed = forge('R-A1', { type: 'pause_account', title: 'Pause', args: {}, status: 'pending' });
        ok((await dismissCard(db, W, dismissed)).ok, 'a card can be dismissed');
        const r6 = await confirmCard(db, W, dismissed, e);
        ok(!r6.ok && tables.delphi_media_accounts.find((a) => a.id === 'A1')!.status === 'active', '…and a dismissed card cannot then be confirmed', r6.error ?? '');

        const misleading: Card = { type: 'set_preference', title: 'Make it a little warmer', args: { field: 'monthlyCapUsd', value: 900 }, status: 'pending' };
        const words = describeCard(misleading);
        ok(words.what === 'Change the monthly cap' && words.detail === 'to $900.00 a month', 'a card is shown from what it does, not from its title', `${words.what} ${words.detail}`);
        ok(describeCard({ type: 'send_back', title: 'x', args: { artifactId: 'gone', note: 'n' }, status: 'pending' }).what.includes('no longer in this room'), 'a send-back for work the room cannot see says so');
        ok(validCard({ type: 'drop_tables', title: 'x' }) === null && validCard({ type: 'decision' }) === null, 'anything that is not a known, well-formed card is no card');
    }

    console.log('\nWho may do what');
    {
        ok(refusal('owner', 'post') === null && refusal('reviewer', 'post') === null, 'the owner and reviewers can post');
        ok(refusal('viewer', 'post') !== null, 'a viewer cannot post');
        ok(refusal('owner', 'confirm') === null && refusal('reviewer', 'confirm') !== null && refusal('viewer', 'confirm') !== null, 'only the owner confirms a card');
        ok(refusal('owner', 'decide') === null && refusal('reviewer', 'decide') !== null && refusal('viewer', 'decide') !== null, 'only the owner keeps the decisions');

        // Every action in the room's server file asks the gate, for the right act.
        const src = readFileSync(new URL('../src/lib/delphi/room-actions.ts', import.meta.url), 'utf8');
        const expected: Record<string, string> = {
            sendRoomMessageAction: 'post',
            confirmCardAction: 'confirm',
            dismissCardAction: 'confirm',
            addDecisionAction: 'decide',
            updateDecisionAction: 'decide',
            deleteDecisionAction: 'decide',
        };
        const bodies = src.split(/export async function /).slice(1);
        const found = Object.fromEntries(bodies.map((b) => [b.slice(0, b.indexOf('(')), /refusal\(c\.role, '(\w+)'\)/.exec(b)?.[1] ?? null]));
        const wrong = Object.entries(expected).filter(([fn, act]) => found[fn] !== act);
        ok(wrong.length === 0 && Object.keys(found).length === Object.keys(expected).length, 'every room action checks the gate first, for its own act', wrong.map(([f]) => f).join(',') || `${Object.keys(found).length} actions`);

        const tables = seed();
        const db = fakeDb(tables);
        const { converse } = scripted([{ name: 'propose_pause', args: { pause: true } }]);
        const viewer = peopleFor('reviewer', { id: REVIEWER, user_metadata: { full_name: 'Benimaru' } }, OWNER);
        const res = await replyInRoom(db, { room: ROOM_A1, speaker: { userId: REVIEWER, name: viewer.me, isOwner: false }, message: 'Should we pause?', people: viewer.people, converse });
        const card = cardsIn(tables, 'R-A1')[0];
        ok(res.posted[0].authorName === 'Benimaru' && !res.posted[0].byOwner, "a reviewer's message is theirs, not the CHO's");
        ok(card && (card.card as Card).status === 'pending' && tables.delphi_media_accounts.find((a) => a.id === 'A1')!.status === 'active', "a reviewer can prompt a card; it waits for the owner");
    }

    console.log('\n@name brings in one member of the team');
    {
        const team = [{ name: 'Shion' }, { name: 'Kurobe' }, { name: 'Gobta Jr' }];
        ok(mentioned('@Shion can you tighten the script?', team) === 0, 'by name');
        ok(mentioned('what do you think, @kurobe?', team) === 1, 'in any case, anywhere in the message');
        ok(mentioned('@Gobta any notes?', team) === 2, 'by first name');
        ok(mentioned('@Diablo status?', team) === -1 && mentioned('no mention here', team) === -1 && mentioned('mail me at a@b.com', team) === -1, 'otherwise Diablo answers');
        ok(mentioned('@Nobody and @Kurobe', team) === 1, 'the first one named who is on the team');

        const tables = seed();
        const db = fakeDb(tables);
        const { converse, seen } = scripted([{ name: 'propose_pause', args: { pause: true } }], 'I would cut the intro.');
        const res = await replyInRoom(db, { room: ROOM_A1, speaker: OWNER_SPEAKS, message: '@Kurobe how is the edit?', people: PEOPLE, converse });
        const reply = res.posted[1];
        ok(reply.role === 'worker' && reply.authorName === 'Kurobe', 'Kurobe answers, as Kurobe');
        ok(seen.system.startsWith('KUROBE PROMPT') && !seen.system.includes('CEO PROMPT'), 'in his own role');
        ok(!seen.tools.some((t) => t.startsWith('propose_')), 'with tools to read, and none to propose');
        ok(seen.results[0].startsWith('Only Diablo proposes') && cardsIn(tables, 'R-A1').length === 0, 'a proposal from him is refused, and no card is posted');
        const other = await replyInRoom(db, { room: ROOM_D2, speaker: OWNER_SPEAKS, message: '@Kurobe hello?', people: PEOPLE, converse: scripted([]).converse });
        ok(other.posted[1].role === 'ceo', "someone not on this department's team is not brought in; Diablo answers");
    }

    console.log('\nWhen the answer fails');
    {
        const tables = seed();
        const db = fakeDb(tables);
        const failing: Converse = async ({ execute }) => {
            await execute('propose_pause', { pause: true });
            throw new Error('The model quota is used up for today.');
        };
        const res = await replyInRoom(db, { room: ROOM_A1, speaker: OWNER_SPEAKS, message: 'Pause it.', people: PEOPLE, converse: failing });
        ok(res.error === 'The model quota is used up for today.' && res.posted.length === 1, 'the failure comes back, and what was said is kept');
        ok(cardsIn(tables, 'R-A1').length === 0, 'a proposal made before the failure is not posted');
    }

    console.log('\nNew work posts itself into its room');
    {
        const tables = seed();
        const db = fakeDb(tables);
        await postWorkToRoom(db, { workspaceId: W, departmentId: 'D1', accountId: 'A1', agentId: 'ag-kurobe', artifactId: 'X-A1', text: 'Rendered a short.' });
        const posted = tables.delphi_messages.filter((m) => m.thread_id === 'R-A1');
        ok(posted.length === 1 && JSON.stringify(posted[0].artifact_ids) === '["X-A1"]' && posted[0].author_agent_id === 'ag-kurobe', "a channel's piece goes to that channel's room, from its agent");
        await postWorkToRoom(db, { workspaceId: W, departmentId: 'D2', accountId: null, agentId: 'ag-souei', artifactId: 'X-D2', text: 'Finished the brief.' });
        ok(tables.delphi_messages.filter((m) => m.thread_id === 'R-D2').length === 2, "a department's deliverable goes to the department's room");
        tables.delphi_threads = tables.delphi_threads.filter((t) => t.id !== 'R-A2');
        await postWorkToRoom(db, { workspaceId: W, departmentId: 'D1', accountId: 'A2', agentId: 'ag-kurobe', artifactId: 'X-A2', text: 'Rendered a short.' });
        const made = tables.delphi_threads.find((t) => t.kind === 'room' && t.account_id === 'A2');
        ok(Boolean(made) && tables.delphi_messages.some((m) => m.thread_id === made!.id), 'a channel with no room yet gets one, and the piece lands in it');

        const view = await roomView(db, ROOM_A1, PEOPLE);
        ok(view.work['X-A1']?.video === 'signed:ws/a1.mp4' && view.work['X-A1']?.picture === 'signed:ws/a1.jpg', 'the room shows the video in place, with its thumbnail');
        tables.delphi_messages.push({ id: 'peek', workspace_id: W, thread_id: 'R-A1', role: 'ceo', author_agent_id: 'ceo', author_user_id: null, content: 'x', card: { type: 'send_back', title: 'x', args: { artifactId: 'X-A2', note: 'n' }, status: 'pending' }, created_at: '2026-10-06T23:00:00Z', artifact_ids: ['X-D2'] });
        const peek = await roomView(db, ROOM_A1, PEOPLE);
        ok(!peek.work['X-A2'] && !peek.work['X-D2'], "work from another channel or department is not shown, even when a message names it");

        let threw = false;
        try {
            await postWorkToRoom(fakeDb(seed(), { failInserts: true }), { workspaceId: W, departmentId: 'D1', accountId: 'A1', agentId: 'ag-kurobe', artifactId: 'X-A1', text: 'x' });
            const broken = { from: () => { throw new Error('database down'); } } as unknown as Db;
            await postWorkToRoom(broken, { workspaceId: W, departmentId: 'D1', accountId: 'A1', agentId: 'ag-kurobe', artifactId: 'X-A1', text: 'x' });
        } catch {
            threw = true;
        }
        ok(!threw, 'a room that cannot be written to never fails the task that made the work');

        const runtime = readFileSync(new URL('../src/lib/delphi/runtime.ts', import.meta.url), 'utf8');
        ok(/if \(format \|\| !downstream\)[\s\S]{0,400}postWorkToRoom\(/.test(runtime), 'the runtime posts rendered pieces and final deliverables, not middle steps');
    }

    console.log('\nFinding rooms');
    {
        const tables = seed();
        const db = fakeDb(tables);
        ok((await roomFor(db, W, 'D1', 'A1'))?.id === 'R-A1' && (await roomFor(db, W, 'D1', null))?.id === 'R-D1', "a department's room and a channel's room are different rooms");
        ok((await roomFor(db, OTHER_W, 'D1', null)) === null, 'a room is not found from another workspace');
        ok((await roomFor(db, W, 'D9', null)) === null && !tables.delphi_threads.some((t) => t.department_id === 'D9'), 'a missing room is not made unless asked');
    }

    console.log(failed ? `\n${R}${failed} check(s) failed${RS}\n` : `\n${G}All room checks passed${RS}\n`);
    process.exit(failed ? 1 : 0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
