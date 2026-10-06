/**
 * The studio's production loop, offline.
 *
 * A studio with four channels — one where the CHO approves topics, one where
 * the team picks, one paused, one with no schedule — staffed by an approved
 * plan. Then, on a fixed clock: the playbooks the approval leaves behind,
 * the slots that come due in the studio's own time zone, an episode started
 * once per slot and one per channel per tick, the month's money split and
 * held, a stopped system, "Make it now", topics proposed from the channel's
 * own compartment, and a piece marked published reaching the channel's
 * history.
 *
 *   npm run delphi:scheduler
 */

import { fakeDb, type Row } from './fake_db';
import { channelSteps, playbooksOf, startRun, stepsFromTasks, writePlaybooks, type PlaybookStep } from '../src/lib/delphi/playbooks';
import { channelCaps, spendSince, startDueWork, startEpisodeNow, tickStudio, type TickReport } from '../src/lib/delphi/scheduler';
import { addIdea, listIdeas, markIdeaMade, markPublished, moveIdea, normalTitle, proposeIdeas, validPublishedUrl, type ProposeIdeas } from '../src/lib/delphi/ideas';
import { dueSlots, monthStart, nextSlots, slotsBetween, zonedToUtc } from '../src/lib/delphi/slots';
import { contextFor, renderContext } from '../src/lib/delphi/context';
import { confirmCard, runRoomTool, type CardEffects, type Room } from '../src/lib/delphi/rooms';
import { describeCard, type Card } from '../src/lib/delphi/room-cards';
import { withDefaults } from '../src/lib/studio/accounts';
import type { Db } from '../src/lib/delphi/db';

const G = '\x1b[32m', R = '\x1b[31m', D = '\x1b[2m', RS = '\x1b[0m';
let failed = 0;
const ok = (cond: boolean, label: string, note = '') => {
    if (!cond) failed++;
    console.log(`  ${cond ? G + '✓' : R + '✗'}${RS} ${label.padEnd(74)}${note ? D + note + RS : ''}`);
};

const W = 'ws-1';
const TZ = 'America/Toronto';
// Wednesday 7 October 2026, 03:00 in Toronto — the morning run.
const WED_0700Z = new Date('2026-10-07T07:00:00Z');

const UNIQUE = { delphi_projects: [['playbook_id', 'scheduled_for']] };
const DEFAULTS = { delphi_projects: { spent_usd: 0 }, delphi_ideas: { source: 'team' } };

function account(id: string, name: string, prefs: Row, status = 'active'): Row {
    return { id, workspace_id: W, department_id: 'D1', platform: 'youtube', name, handle: null, url: null, status, preferences: prefs, created_at: `2026-09-0${id.length}T00:00:00Z` };
}

function seed(): Record<string, Row[]> {
    return {
        delphi_departments: [
            { id: 'D1', workspace_id: W, name: 'Studio One', kind: 'studio', status: 'active', charter: 'PURPOSE-D1 short videos for my channels', budget_usd: 9, settings: { timezone: TZ, houseRules: 'HOUSE-D1' } },
            { id: 'D2', workspace_id: W, name: 'Morning Brief', kind: 'research', status: 'active', charter: 'PURPOSE-D2', budget_usd: 5, settings: { timezone: 'UTC' } },
        ],
        delphi_media_accounts: [
            account('A1', 'Markets Minute', { niche: 'NICHE-A1', formats: ['short'], schedule: { days: [1, 3, 5], time: '09:00' }, topics: 'cho' }),
            account('A2', 'Crypto Daily', { niche: 'NICHE-A2', formats: ['carousel'], schedule: { days: [1, 2, 3, 4, 5, 6, 7], time: '18:00' }, topics: 'team' }),
            account('A3', 'Paused Pod', { niche: 'NICHE-A3', formats: ['short'], schedule: { days: [1, 2, 3, 4, 5, 6, 7], time: '08:00' }, topics: 'team' }, 'paused'),
            account('A4', 'On Demand', { niche: 'NICHE-A4', formats: ['post'], topics: 'cho' }),
        ],
        delphi_agents: [
            { id: 'ceo', workspace_id: W, slug: 'delphi-ceo', name: 'Diablo', title: 'CEO', system_prompt: 'CEO PROMPT' },
            { id: 'ag-res', workspace_id: W, slug: 'research-analyst', name: 'Souei', title: 'Research Analyst', system_prompt: 'RESEARCH PROMPT' },
            { id: 'ag-str', workspace_id: W, slug: 'social-strategist', name: 'Shuna', title: 'Social Strategist', system_prompt: 'STRATEGIST PROMPT' },
            { id: 'ag-ed', workspace_id: W, slug: 'video-editor', name: 'Kurobe', title: 'Video Editor', system_prompt: 'EDITOR PROMPT' },
        ],
        delphi_hires: [
            { id: 'h1', department_id: 'D1', agent_id: 'ag-res' },
            { id: 'h2', department_id: 'D1', agent_id: 'ag-str' },
            { id: 'h3', department_id: 'D1', agent_id: 'ag-ed' },
        ],
        // The plan the CHO approved: research for everyone, then a chain per channel.
        delphi_projects: [{ id: 'P0', workspace_id: W, department_id: 'D1', title: 'Pilot', status: 'done', spent_usd: 0, budget_usd: 9, created_at: '2026-09-15T00:00:00Z' }],
        delphi_tasks: [
            { id: 'T1', project_id: 'P0', seq: 1, title: 'Research the week', objective: 'Find what matters this week.', agent_id: 'ag-res', deliverable: 'text', account_id: null, depends_on: null, status: 'done' },
            { id: 'T2', project_id: 'P0', seq: 2, title: 'Script for Markets Minute', objective: 'Write a 40-second script.', agent_id: 'ag-str', deliverable: 'text', account_id: 'A1', depends_on: 'T1', status: 'done' },
            { id: 'T3', project_id: 'P0', seq: 3, title: 'Render the short', objective: 'Render it.', agent_id: 'ag-ed', deliverable: 'short', account_id: 'A1', depends_on: 'T2', status: 'done' },
            { id: 'T4', project_id: 'P0', seq: 4, title: 'Carousel copy for Crypto Daily', objective: 'Write five slides.', agent_id: 'ag-str', deliverable: 'text', account_id: 'A2', depends_on: 'T1', status: 'done' },
            { id: 'T5', project_id: 'P0', seq: 5, title: 'Render the carousel', objective: 'Render it.', agent_id: 'ag-ed', deliverable: 'carousel', account_id: 'A2', depends_on: 'T4', status: 'done' },
        ],
        delphi_ideas: [],
        delphi_playbooks: [],
        delphi_threads: [],
        delphi_messages: [],
        delphi_memories: [],
        delphi_artifacts: [],
        delphi_events: [],
        delphi_system_state: [],
    };
}

/** A strategist that proposes what it is given, and records what it was shown. */
function strategist(titles: string[]) {
    const seen: { system: string; prompt: string; prompts: string[]; calls: number } = { system: '', prompt: '', prompts: [], calls: 0 };
    let i = 0;
    const propose: ProposeIdeas = async ({ system, prompt, count }) => {
        seen.system = system;
        seen.prompt = prompt;
        seen.prompts.push(prompt);
        seen.calls++;
        const ideas = [];
        for (let k = 0; k < count && i < titles.length; k++, i++) ideas.push({ title: titles[i], angle: `ANGLE ${titles[i]}`, format: 'short' });
        return { ideas, costUsd: 0.001 };
    };
    return { propose, seen };
}

async function world(approvedAt = '2026-10-06T00:00:00Z') {
    const tables = seed();
    const db = fakeDb(tables, { unique: UNIQUE, defaults: DEFAULTS, clock: Date.parse('2026-10-06T12:00:00Z') });
    await writePlaybooks(db, { workspaceId: W, departmentId: 'D1', kind: 'studio', projectId: 'P0' });
    for (const p of tables.delphi_playbooks) p.approved_at = approvedAt;
    return { tables, db };
}

const dept = (tables: Record<string, Row[]>, id = 'D1') => tables.delphi_departments.find((d) => d.id === id)!;
const roomMessages = (tables: Record<string, Row[]>, accountId: string) => {
    const room = tables.delphi_threads.find((t) => t.kind === 'room' && t.account_id === accountId);
    return room ? tables.delphi_messages.filter((m) => m.thread_id === room.id).map((m) => String(m.content)) : [];
};
const episodes = (tables: Record<string, Row[]>, accountId: string) => tables.delphi_projects.filter((p) => p.account_id === accountId && p.playbook_id);

async function main() {
    console.log('\nSlots, in the studio\'s own time');
    {
        const s = { days: [1, 3, 5], time: '09:00' };
        const around = slotsBetween(s, TZ, new Date('2026-10-28T00:00:00Z'), new Date('2026-11-05T00:00:00Z')).map((d) => d.toISOString());
        ok(around.join() === '2026-10-28T13:00:00.000Z,2026-10-30T13:00:00.000Z,2026-11-02T14:00:00.000Z,2026-11-04T14:00:00.000Z', '09:00 in Toronto stays 09:00 across the clocks going back', around.length + ' slots');
        const due = dueSlots(s, TZ, WED_0700Z).map((d) => d.toISOString());
        ok(due.join() === '2026-10-05T13:00:00.000Z,2026-10-07T13:00:00.000Z', "due on Wednesday's morning run: Monday's, if missed, and today's", due.join(' '));
        ok(dueSlots(s, TZ, new Date('2026-10-10T07:00:00Z')).every((d) => d.getTime() > Date.parse('2026-10-07T07:00:00Z')), 'a slot more than three days gone is let go');
        ok(dueSlots(null, TZ, WED_0700Z).length === 0 && nextSlots(null, TZ, WED_0700Z, 3).length === 0, 'a channel with no schedule has no slots');
        ok(monthStart(new Date('2026-10-01T03:00:00Z'), TZ).toISOString() === '2026-09-01T04:00:00.000Z', "the month turns at the studio's midnight, not UTC's");
        ok(zonedToUtc({ year: 2026, month: 10, day: 4, hour: 23, minute: 30 }, 'Asia/Tokyo').toISOString() === '2026-10-04T14:30:00.000Z', 'any zone, not only the server\'s');
    }

    console.log('\nWhat approving a team leaves behind');
    {
        const { tables, db } = await world();
        const books = await playbooksOf(db, 'D1');
        const a1 = books.find((b) => b.accountId === 'A1');
        const a2 = books.find((b) => b.accountId === 'A2');
        ok(books.length === 2 && Boolean(a1 && a2), 'a playbook for each channel the plan made a chain for', books.map((b) => b.accountId).join(','));
        ok(a1!.steps.map((s) => s.seq).join() === '1,2,3' && a2!.steps.map((s) => s.seq).join() === '1,4,5', "each is the shared research, then that channel's own steps");
        ok(a2!.steps.find((s) => s.seq === 4)!.after === 1 && a1!.steps.find((s) => s.seq === 3)!.after === 2, 'and each step still works from the one before it');
        ok(!a1!.steps.some((s) => s.accountId === 'A2') && !a2!.steps.some((s) => s.accountId === 'A1'), "no channel's playbook carries another channel's steps");

        await writePlaybooks(db, { workspaceId: W, departmentId: 'D1', kind: 'studio', projectId: 'P0' });
        ok(tables.delphi_playbooks.filter((p) => p.status === 'approved').length === 2 && tables.delphi_playbooks.filter((p) => p.status === 'retired').length === 2, 'approving again retires the old playbooks, keeping one live per channel');

        const research = fakeDb({ ...seed(), delphi_playbooks: [] }, { unique: UNIQUE, defaults: DEFAULTS });
        await writePlaybooks(research, { workspaceId: W, departmentId: 'D2', kind: 'research', projectId: 'P0' });
        const one = await playbooksOf(research, 'D2');
        ok(one.length === 1 && one[0].accountId === null && one[0].steps.length === 5, 'a research department keeps one playbook, every step in it');

        const stray: PlaybookStep[] = [
            { seq: 1, title: 'r', objective: '', agentId: 'a', deliverable: 'text', accountId: null, after: null },
            { seq: 2, title: 'x', objective: '', agentId: 'a', deliverable: 'text', accountId: 'B', after: 1 },
            { seq: 3, title: 'y', objective: '', agentId: 'a', deliverable: 'text', accountId: 'C', after: 2 },
        ];
        ok(channelSteps(stray, 'C').find((s) => s.seq === 3)!.after === 1, "a step that pointed at another channel's step is pointed at the shared one");
        ok(stepsFromTasks([{ id: 't', seq: 1, title: 'x', agent_id: null }]).length === 0, 'a step with nobody to do it is not kept');
    }

    console.log('\nThe morning run');
    let first: TickReport;
    {
        const { tables, db } = await world();
        // The paused channel has a playbook too: being paused, not unstaffed, is what stops it.
        tables.delphi_playbooks.push({ id: 'pb-a3', workspace_id: W, department_id: 'D1', account_id: 'A3', status: 'approved', approved_at: '2026-10-06T00:00:00Z', steps: [{ seq: 1, title: 'Render', objective: 'o', agentId: 'ag-ed', deliverable: 'short', accountId: 'A3', after: null }] });
        tables.delphi_ideas.push({ id: 'i-a3', workspace_id: W, department_id: 'D1', account_id: 'A3', title: 'Waiting while paused', status: 'approved', source: 'cho', created_at: '2026-10-06T01:00:00Z' });
        const { propose, seen } = strategist(['Rates hold again', 'Earnings week', 'Oil and the loonie', 'Bitcoin halving explained', 'Stablecoins, plainly']);
        first = await tickStudio(db, dept(tables), { now: WED_0700Z, propose });

        const a2 = episodes(tables, 'A2');
        ok(a2.length === 1, 'where the team picks, a topic is picked and the episode starts', `${first.started.length} started`);
        ok(a2[0]?.scheduled_for === '2026-10-06T22:00:00.000Z', "…for the oldest slot owed since the playbook was approved (yesterday's)", String(a2[0]?.scheduled_for));
        const tasks = tables.delphi_tasks.filter((t) => t.project_id === a2[0]?.id);
        ok(tasks.length === 3 && tasks.every((t) => String(t.objective).startsWith("THIS EPISODE'S TOPIC: “")), 'its tasks are the playbook\'s steps, each opening with the topic');
        ok(tasks.find((t) => t.seq === 4)!.depends_on === tasks.find((t) => t.seq === 1)!.id && tasks.find((t) => t.seq === 5)!.depends_on === tasks.find((t) => t.seq === 4)!.id, '…in the same order, each working from the one before');
        const idea = tables.delphi_ideas.find((i) => i.id === a2[0]?.idea_id)!;
        ok(idea?.status === 'scheduled' && idea.project_id === a2[0].id && idea.account_id === 'A2', 'the topic is marked in production, with its episode');
        ok(Number(a2[0]?.budget_usd) === 0.25, "the episode may spend its slot's share of the channel's $3 — at least $0.25", String(a2[0]?.budget_usd));

        ok(episodes(tables, 'A1').length === 0 && first.skipped.some((s) => s.accountId === 'A1' && s.reason === 'no_topic'), 'where the CHO approves topics, nothing starts without an approved one');
        ok(roomMessages(tables, 'A1').some((m) => m.startsWith('Nothing was started for Wed 7 Oct')), "…and the channel's room says so");
        ok(tables.delphi_ideas.filter((i) => i.account_id === 'A1' && i.status === 'proposed').length === 3, '…and three topics are proposed for the CHO to choose from');
        ok(seen.system === 'STRATEGIST PROMPT', 'the strategist proposes, in their own role');
        const forA1 = seen.prompts.find((x) => x.includes('NICHE-A1')) ?? '';
        const forA2 = seen.prompts.find((x) => x.includes('NICHE-A2')) ?? '';
        ok(Boolean(forA1 && forA2) && !forA1.includes('NICHE-A2') && !forA1.includes('NICHE-A3') && !forA2.includes('NICHE-A1'), "each from the channel's own compartment, and no other channel's", `${seen.prompts.length} prompts`);

        ok(episodes(tables, 'A3').length === 0 && episodes(tables, 'A4').length === 0, 'a paused channel, and one with no schedule, start nothing');
        ok(roomMessages(tables, 'A3').length === 0 && !first.skipped.some((x) => x.accountId === 'A3'), '…and a paused one is passed over in silence, not told it is over its cap');

        const again = await tickStudio(db, dept(tables), { now: WED_0700Z, propose });
        ok(episodes(tables, 'A2').length === 2 && again.started.length === 1, 'the next tick starts the next slot owed — one per channel per tick');
        const third = await tickStudio(db, dept(tables), { now: WED_0700Z, propose });
        ok(episodes(tables, 'A2').length === 2 && third.started.length === 0, 'and then nothing: every slot owed has started once, and only once');
        ok(roomMessages(tables, 'A1').filter((m) => m.startsWith('Nothing was started for Wed 7 Oct')).length === 1, 'the room is told once, not every tick');
        ok(seen.calls === 3, 'and the CHO\'s queue is topped up at most once a day', `${seen.calls} proposal calls`);
    }

    console.log('\nOnce per slot, whoever gets there first');
    {
        const { tables, db } = await world();
        const book = (await playbooksOf(db, 'D1')).find((b) => b.accountId === 'A1')!;
        const slot = new Date('2026-10-07T13:00:00Z');
        const input = { workspaceId: W, departmentId: 'D1', playbook: book, title: 'x', brief: 'b', budgetUsd: 1, scheduledFor: slot, accountId: 'A1', ideaId: null, topicLine: null };
        const [a, b] = await Promise.all([startRun(db, input), startRun(db, input)]);
        ok([a, b].filter((r) => r.ok).length === 1 && [a, b].some((r) => !r.ok && r.taken), 'two starts of the same slot at once: one runs, one is told it is taken');
        ok(tables.delphi_tasks.filter((t) => t.project_id !== 'P0').length === 3, '…and the one that lost wrote no tasks');
    }

    console.log('\nThe month\'s money');
    {
        const caps = channelCaps(9, [
            { id: 'a', status: 'active', preferences: withDefaults({}) },
            { id: 'b', status: 'active', preferences: withDefaults({ monthlyCapUsd: 5 }) },
            { id: 'c', status: 'active', preferences: withDefaults({}) },
            { id: 'd', status: 'paused', preferences: withDefaults({}) },
        ]);
        ok(caps.get('b') === 5 && caps.get('a') === 2 && caps.get('c') === 2 && !caps.has('d'), 'a channel with its own cap keeps it; the rest split what is left; a paused one gets none');

        const { tables, db } = await world();
        tables.delphi_projects.push({ id: 'old', workspace_id: W, department_id: 'D1', account_id: 'A2', status: 'done', spent_usd: 3, budget_usd: 3, created_at: '2026-10-02T00:00:00Z' });
        const { propose } = strategist(['Topic one', 'Topic two', 'Topic three', 'Topic four']);
        const r = await tickStudio(db, dept(tables), { now: WED_0700Z, propose });
        ok(episodes(tables, 'A2').length === 0 && r.skipped.some((s) => s.accountId === 'A2' && s.reason === 'channel_cap'), "a channel that has spent its share this month starts nothing");
        ok(roomMessages(tables, 'A2').some((m) => m.includes("share of the budget for October 2026")), '…and its room is told why');
        ok(!tables.delphi_ideas.some((i) => i.account_id === 'A2'), '…before any topic is picked for nothing');

        const s = await spendSince(db, 'D1', monthStart(WED_0700Z, TZ));
        ok(s.total === 3 && s.byAccount.get('A2') === 3, "spend is counted from the studio's first of the month", `${s.total}`);
        tables.delphi_projects.push({ id: 'last-month', workspace_id: W, department_id: 'D1', account_id: 'A1', status: 'done', spent_usd: 50, budget_usd: 50, created_at: '2026-09-30T03:00:00Z' });
        ok((await spendSince(db, 'D1', monthStart(WED_0700Z, TZ))).total === 3, "…so last month's spending does not count against this one");

        const { tables: t2, db: db2 } = await world();
        t2.delphi_projects.push({ id: 'big', workspace_id: W, department_id: 'D1', account_id: null, status: 'done', spent_usd: 9, budget_usd: 9, created_at: '2026-10-03T00:00:00Z' });
        const r2 = await tickStudio(db2, dept(t2), { now: WED_0700Z, propose: strategist(['Topic one', 'Topic two']).propose });
        ok(episodes(t2, 'A2').length === 0 && r2.skipped.some((x) => x.reason === 'department_cap'), "when the studio's whole budget is spent, no channel starts anything");

        const { tables: t4, db: db4 } = await world();
        t4.delphi_projects.push({ id: 'pilot-running', workspace_id: W, department_id: 'D1', account_id: null, status: 'running', spent_usd: 0.2, budget_usd: 9, created_at: '2026-10-06T23:00:00Z' });
        const r4 = await tickStudio(db4, dept(t4), { now: WED_0700Z, propose: strategist(['Topic one', 'Topic two']).propose });
        ok(episodes(t4, 'A2').length === 0 && r4.skipped.some((x) => x.reason === 'department_cap'), "while the first run may still spend the studio's whole budget, no episode starts");

        const { tables: t3, db: db3 } = await world();
        t3.delphi_projects.push({ id: 'running', workspace_id: W, department_id: 'D1', account_id: 'A2', status: 'running', spent_usd: 0.5, budget_usd: 3, created_at: '2026-10-06T23:00:00Z' });
        const r3 = await tickStudio(db3, dept(t3), { now: WED_0700Z, propose: strategist(['Topic one', 'Topic two']).propose });
        ok(episodes(t3, 'A2').length === 0 && r3.skipped.some((x) => x.accountId === 'A2' && x.reason === 'channel_cap'), "what running work may still spend is held: a channel can't start past its share");
    }

    console.log('\nThe CHO approves, and the next slot fills');
    {
        const { tables, db } = await world();
        const { propose } = strategist(['Rates hold again', 'Earnings week', 'Oil and the loonie', 'Bitcoin halving explained']);
        await tickStudio(db, dept(tables), { now: WED_0700Z, propose });
        const proposed = await listIdeas(db, 'A1', ['proposed']);
        ok((await moveIdea(db, W, proposed[1].id, 'approved')).ok, 'the CHO approves one of the proposals');
        await tickStudio(db, dept(tables), { now: WED_0700Z, propose });
        const a1 = episodes(tables, 'A1');
        ok(a1.length === 1 && a1[0].idea_id === proposed[1].id && a1[0].scheduled_for === '2026-10-07T13:00:00.000Z', "it fills today's slot — Monday's was before the playbook existed");
        ok((await moveIdea(db, W, proposed[1].id, 'rejected')).ok === false, 'a topic in production cannot then be rejected out from under its episode');
        ok(roomMessages(tables, 'A1').some((m) => m.startsWith('Started the episode for Wed 7 Oct, 09:00')), "the channel's room hears it has started");
    }

    console.log('\nAn episode that came to nothing');
    {
        const { tables, db } = await world();
        const { propose } = strategist(['Bitcoin halving explained', 'Stablecoins, plainly', 'Topic three', 'Topic four', 'Topic five']);
        await tickStudio(db, dept(tables), { now: WED_0700Z, propose });
        const ep = episodes(tables, 'A2')[0];
        const idea = tables.delphi_ideas.find((i) => i.id === ep.idea_id)!;
        ep.status = 'cancelled';
        const later = new Date('2026-10-08T07:00:00Z');
        await tickStudio(db, dept(tables), { now: later, propose });
        const next = episodes(tables, 'A2').filter((p) => p.id !== ep.id);
        ok(next.some((p) => p.idea_id === idea.id), 'a topic whose episode was called off goes back in the queue, and is made next');
        const halted = episodes(tables, 'A2').find((p) => p.idea_id === idea.id && p.id !== ep.id)!;
        halted.status = 'halted_budget';
        await tickStudio(db, dept(tables), { now: new Date('2026-10-09T07:00:00Z'), propose });
        ok(tables.delphi_ideas.find((i) => i.id === idea.id)!.status === 'scheduled', 'one that ran out of budget stays put: raising the budget resumes it');
    }

    console.log('\nNothing starts with the system off');
    {
        const { tables, db } = await world();
        tables.delphi_system_state.push({ workspace_id: W, mode: 'stopped' });
        const r = await startDueWork(db, W, { now: WED_0700Z, propose: strategist(['Topic one', 'Topic two', 'Topic three']).propose });
        ok(r.started.length === 0 && r.skipped.some((s) => s.reason === 'system_off') && episodes(tables, 'A2').length === 0, 'a stopped system starts nothing, and says why');
        tables.delphi_system_state[0].mode = 'running';
        const on = await startDueWork(db, W, { now: WED_0700Z, propose: strategist(['Topic one', 'Topic two', 'Topic three', 'Topic four']).propose });
        ok(on.started.length === 1, 'switched back on, the slot owed starts');
    }

    console.log('\nMake it now');
    {
        const { tables, db } = await world();
        const added = await addIdea(db, { workspaceId: W, departmentId: 'D1', accountId: 'A1', title: 'The Fed, in forty seconds', angle: 'Open on the number', source: 'cho', status: 'approved' });
        ok(added.ok, 'the CHO adds a topic of their own, approved');
        const now = new Date('2026-10-07T15:04:31Z');
        const made = await startEpisodeNow(db, W, added.ok ? added.idea.id : '', now);
        ok(made.ok && episodes(tables, 'A1')[0]?.scheduled_for === '2026-10-07T15:04:00.000Z', 'made now: an episode starts on this minute');
        const twice = await startEpisodeNow(db, W, added.ok ? added.idea.id : '', now);
        ok(!twice.ok && episodes(tables, 'A1').length === 1, 'pressing again does not start it twice', twice.ok ? '' : twice.error);
        const paused = await addIdea(db, { workspaceId: W, departmentId: 'D1', accountId: 'A3', title: 'Something for the paused one', source: 'cho', status: 'approved' });
        const r = await startEpisodeNow(db, W, paused.ok ? paused.idea.id : '', now);
        ok(!r.ok && /paused/i.test(r.error), 'a paused channel cannot be made for', r.ok ? '' : r.error);
        const bare = await addIdea(db, { workspaceId: W, departmentId: 'D1', accountId: 'A4', title: 'A post on demand', source: 'cho', status: 'approved' });
        const r2 = await startEpisodeNow(db, W, bare.ok ? bare.idea.id : '', now);
        ok(!r2.ok && /playbook/i.test(r2.error), 'a channel the approved plan made no chain for has no playbook, and says so', r2.ok ? '' : r2.error);
        tables.delphi_projects.push({ id: 'spent', workspace_id: W, department_id: 'D1', account_id: 'A2', status: 'done', spent_usd: 3, budget_usd: 3, created_at: '2026-10-02T00:00:00Z' });
        const capped = await addIdea(db, { workspaceId: W, departmentId: 'D1', accountId: 'A2', title: 'Over the cap', source: 'cho', status: 'approved' });
        const r3 = await startEpisodeNow(db, W, capped.ok ? capped.idea.id : '', now);
        ok(!r3.ok && /budget/i.test(r3.error), 'made-now keeps to the same caps as the schedule', r3.ok ? '' : r3.error);
        ok(!(await startEpisodeNow(db, 'ws-2', added.ok ? added.idea.id : '', now)).ok, 'and not from another workspace');
    }

    console.log('\nTopics');
    {
        const { tables, db } = await world();
        const a = await addIdea(db, { workspaceId: W, departmentId: 'D1', accountId: 'A1', title: 'Rates hold, again!', source: 'cho', status: 'approved' });
        const dup = await addIdea(db, { workspaceId: W, departmentId: 'D1', accountId: 'A1', title: 'rates hold again', source: 'cho', status: 'approved' });
        ok(a.ok && !dup.ok, 'a channel does not get the same topic twice, however it is typed');
        const other = await addIdea(db, { workspaceId: W, departmentId: 'D1', accountId: 'A2', title: 'Rates hold again', source: 'cho', status: 'approved' });
        ok(other.ok, 'another channel may have it: topics are per channel');
        ok(normalTitle('  Bitcoin: Halving, Explained! ') === 'bitcoin halving explained', 'titles are compared without case or punctuation');
        ok(!(await addIdea(db, { workspaceId: W, departmentId: 'D1', accountId: 'A1', title: 'no', source: 'cho', status: 'approved' })).ok, 'a topic needs a few words');

        tables.delphi_artifacts.push({ id: 'shared', workspace_id: W, project_id: 'P0', account_id: null, title: 'SHARED-RESEARCH the week', content_md: 'x', data: { summary: 'SUMMARY rates and oil' }, created_at: '2026-10-06T10:00:00Z' });
        tables.delphi_artifacts.push({ id: 'a2-piece', workspace_id: W, project_id: 'P0', account_id: 'A2', title: 'A2-PIECE', content_md: 'x', data: {}, created_at: '2026-10-06T11:00:00Z' });
        const { propose, seen } = strategist(['Rates hold again', 'Something fresh', 'Something fresher']);
        const res = await proposeIdeas(db, { workspaceId: W, departmentId: 'D1', accountId: 'A1', count: 3, propose });
        ok(seen.prompt.includes('SUMMARY rates and oil') && !seen.prompt.includes('A2-PIECE'), "proposals draw on research the studio shared, never on another channel's work");
        ok(seen.prompt.includes('Rates hold, again!'), 'the channel\'s existing topics are shown, so they are not repeated');
        ok(res.created.length === 2 && !res.created.some((i) => normalTitle(i.title) === 'rates hold again'), 'and a repeat that comes back anyway is dropped');
    }

    console.log('\nMade, then published');
    {
        const { tables, db } = await world();
        const added = await addIdea(db, { workspaceId: W, departmentId: 'D1', accountId: 'A1', title: 'The Fed, in forty seconds', source: 'cho', status: 'approved' });
        const id = added.ok ? added.idea.id : '';
        await moveIdea(db, W, id, 'scheduled');
        tables.delphi_artifacts.push({ id: 'piece', workspace_id: W, project_id: 'P0', account_id: 'A1', title: 'The Fed, in forty seconds', kind: 'video', content_md: '', data: { studio: { kind: 'video', publish: { title: 'The Fed, in forty seconds' } } }, created_at: '2026-10-07T16:00:00Z', deleted_at: null });
        await markIdeaMade(db, id, 'piece');
        ok(tables.delphi_ideas.find((i) => i.id === id)!.status === 'made' && tables.delphi_ideas.find((i) => i.id === id)!.artifact_id === 'piece', "the episode's piece makes its topic made");
        ok(!(await markPublished(db, W, 'piece', 'javascript:alert(1)')).ok && validPublishedUrl('ftp://x') === null, 'only an http or https link is taken');
        const res = await markPublished(db, W, 'piece', 'https://youtube.com/shorts/abc123');
        ok(res.ok, 'the CHO marks it published, with its link');
        const piece = tables.delphi_artifacts.find((a) => a.id === 'piece')!;
        ok((piece.data as Row & { studio: { published: { url: string } } }).studio.published.url === 'https://youtube.com/shorts/abc123', 'the link goes on the piece');
        ok(tables.delphi_ideas.find((i) => i.id === id)!.status === 'published', '…and on its topic');
        const ctx = renderContext((await contextFor(db, { workspaceId: W, departmentId: 'D1', accountId: 'A1' }))!);
        ok(ctx.includes('(published: https://youtube.com/shorts/abc123)'), "and the channel's history now knows it is live, so it is not made again");
        tables.delphi_artifacts.push({ id: 'report', workspace_id: W, project_id: 'P0', account_id: null, title: 'A report', data: {}, created_at: '2026-10-07T16:00:00Z' });
        ok(!(await markPublished(db, W, 'report', 'https://example.com')).ok, "only a channel's piece is marked published");
        ok(!(await markPublished(db, 'ws-2', 'piece', 'https://example.com')).ok, 'not from another workspace');
    }

    console.log('\nTopics from the room');
    {
        const { tables, db } = await world();
        const room: Room = { id: 'R-A1', workspaceId: W, departmentId: 'D1', accountId: 'A1', title: 'A1' };
        tables.delphi_threads.push({ id: 'R-A1', workspace_id: W, department_id: 'D1', account_id: 'A1', kind: 'room', title: 'A1' });
        const p = await addIdea(db, { workspaceId: W, departmentId: 'D1', accountId: 'A1', title: 'Proposed for A1', source: 'team', status: 'proposed' });
        const other = await addIdea(db, { workspaceId: W, departmentId: 'D1', accountId: 'A2', title: 'Proposed for A2', source: 'team', status: 'proposed' });
        const cards: Card[] = [];
        await runRoomTool(db, room, 'propose_topic', { title: 'A topic from the conversation', angle: 'the angle' }, cards);
        await runRoomTool(db, room, 'propose_approve_topic', { title: 'Proposed for A1' }, cards);
        await runRoomTool(db, room, 'propose_approve_topic', { title: 'Proposed for A2' }, cards);
        await runRoomTool(db, room, 'propose_make_now', { title: 'Proposed for A1' }, cards);
        ok(cards.map((c) => c.type).join() === 'add_idea,approve_idea,start_episode', "Diablo can propose a topic, approving one, or making one now — not another channel's", cards.map((c) => c.type).join());
        ok((await listIdeas(db, 'A1')).length === 1 && (await listIdeas(db, 'A1'))[0].status === 'proposed', 'and nothing has happened yet');

        const started: string[] = [];
        const effects: CardEffects = { sendBack: async () => ({ ok: true }), startNow: async (ideaId) => (started.push(ideaId), { ok: true }) };
        const post = (card: Card) => {
            const id = `m-${tables.delphi_messages.length}`;
            tables.delphi_messages.push({ id, workspace_id: W, thread_id: 'R-A1', role: 'ceo', author_agent_id: 'ceo', author_user_id: null, content: card.title, card, created_at: '2026-10-07T10:00:00Z', artifact_ids: [] });
            return id;
        };
        const results = [];
        for (const c of cards) results.push(await confirmCard(db, W, post(c), effects));
        ok(results.every((r) => r.ok), 'confirmed, each does what it said', results.map((r) => r.error ?? 'ok').join(' / '));
        const a1 = await listIdeas(db, 'A1');
        ok(a1.some((i) => i.title === 'A topic from the conversation' && i.status === 'approved' && i.source === 'chat'), 'the topic from the conversation is queued, approved');
        ok(a1.find((i) => i.id === (p.ok ? p.idea.id : ''))!.status === 'approved' && started.length === 1, 'the proposal is approved, and making it now goes through the scheduler');
        const forged: Card = { type: 'approve_idea', title: 'Approve', args: { ideaId: other.ok ? other.idea.id : '' }, status: 'pending' };
        const r = await confirmCard(db, W, post(forged), effects);
        ok(!r.ok && (await listIdeas(db, 'A2'))[0].status === 'proposed', "a card naming another channel's topic is refused", r.error ?? '');
        ok(describeCard(forged, { ideaTitle: null }).what.includes('no longer in this channel'), 'and the room shows it as a topic this channel does not have');
    }

    console.log(failed ? `\n${R}${failed} check(s) failed${RS}\n` : `\n${G}All scheduler checks passed${RS}\n`);
    process.exit(failed ? 1 : 0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});

export type { Db };
