/**
 * The scheduler: what is due, started once.
 *
 * Every tick of the engine asks it first. For each studio, for each active
 * channel with a playbook, it finds the slots due — the channel's schedule,
 * in the studio's time zone — and starts an episode for the oldest one not
 * yet started: the channel's next approved topic, run through its playbook.
 *
 *   - **Once.** A slot is claimed by the project's insert; the database
 *     refuses a second project for the same playbook and slot, so two ticks
 *     reaching it start it once.
 *   - **One at a time.** At most one new episode per channel per tick, so a
 *     channel that was switched off for days catches up gently.
 *   - **Within the month's money.** The studio's monthly budget is split
 *     across its active channels, unless a channel sets its own cap. A
 *     channel at its cap, or a studio at its budget, starts nothing, and
 *     says so in the room once.
 *   - **Only what the CHO allowed.** A channel where the CHO approves topics
 *     waits for an approved one, and says so; where the team picks, the team
 *     proposes one and it is taken. A paused channel, a stopped system and a
 *     channel with no playbook start nothing.
 *
 * It also keeps a short queue of proposed topics in front of the CHO, at
 * most one proposal a day per channel.
 */

import { dueSlots, monthStart, slotsBetween, slotWords } from './slots';
import { playbooksOf, startRun, type Playbook } from './playbooks';
import { listIdeas, moveIdea, proposeIdeas, type Idea, type ProposeIdeas } from './ideas';
import { postNote } from './rooms';
import { withSettings } from './kinds';
import { getSystemState, type Db } from './db';
import { effectiveState } from './schedule';
import { accountLabel, listAccounts, type MediaAccount } from '@/lib/studio/accounts';
import { CEO_NAME } from '@/lib/pixel/cast/names';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

/** Less than this left, and a run would halt before it had made anything. */
export const MIN_RUN_USD = 0.01;
/** The least an episode is given to spend, however many slots share the month. */
export const EPISODE_FLOOR_USD = 0.25;
/** How many topics a channel keeps waiting for the CHO. */
export const QUEUE_TARGET = 3;
/** The least time between two proposals for one channel. */
export const PROPOSE_EVERY_MS = 20 * 3_600_000;

export type SkipReason = 'no_topic' | 'channel_cap' | 'department_cap' | 'taken' | 'no_playbook' | 'system_off' | 'error';

export interface TickReport {
    started: { departmentId: string; accountId: string | null; slot: string; projectId: string; ideaId: string | null }[];
    skipped: { departmentId: string; accountId: string | null; slot: string | null; reason: SkipReason; detail?: string }[];
    proposed: number;
}

export interface TickOptions {
    now?: Date;
    propose?: ProposeIdeas;
}

const emptyReport = (): TickReport => ({ started: [], skipped: [], proposed: 0 });

function merge(into: TickReport, from: TickReport): TickReport {
    into.started.push(...from.started);
    into.skipped.push(...from.skipped);
    into.proposed += from.proposed;
    return into;
}

export interface Spend {
    /** Spent this month, in all and per channel. */
    total: number;
    byAccount: Map<string, number>;
    /**
     * Held for work still running: what its budget allows it to spend yet.
     * Counted as gone, so two channels starting on the same morning cannot
     * between them go past the month.
     */
    held: number;
    heldByAccount: Map<string, number>;
}

/** What a department has spent since a moment, and what its running work may still spend. */
export async function spendSince(db: Db, departmentId: string, since: Date): Promise<Spend> {
    const { data } = await db
        .from('delphi_projects')
        .select('spent_usd, budget_usd, status, account_id, created_at')
        .eq('department_id', departmentId)
        .gte('created_at', since.toISOString());
    const out: Spend = { total: 0, byAccount: new Map(), held: 0, heldByAccount: new Map() };
    for (const p of (data ?? []) as Row[]) {
        const spent = Number(p.spent_usd ?? 0) || 0;
        const held = p.status === 'running' ? Math.max(0, (Number(p.budget_usd ?? 0) || 0) - spent) : 0;
        out.total += spent;
        out.held += held;
        if (p.account_id) {
            out.byAccount.set(p.account_id, (out.byAccount.get(p.account_id) ?? 0) + spent);
            out.heldByAccount.set(p.account_id, (out.heldByAccount.get(p.account_id) ?? 0) + held);
        }
    }
    return out;
}

/**
 * Each active channel's share of the studio's monthly budget: its own cap
 * when it has one, and an even split of what is left otherwise.
 */
export function channelCaps(departmentBudget: number, accounts: Pick<MediaAccount, 'id' | 'status' | 'preferences'>[]): Map<string, number> {
    const active = accounts.filter((a) => a.status === 'active');
    const own = active.filter((a) => a.preferences.monthlyCapUsd !== null);
    const rest = active.filter((a) => a.preferences.monthlyCapUsd === null);
    const left = Math.max(0, departmentBudget - own.reduce((sum, a) => sum + (a.preferences.monthlyCapUsd ?? 0), 0));
    const caps = new Map<string, number>();
    for (const a of own) caps.set(a.id, a.preferences.monthlyCapUsd ?? 0);
    for (const a of rest) caps.set(a.id, rest.length ? Math.round((left / rest.length) * 100) / 100 : 0);
    return caps;
}

/** The slots of a playbook that already have a run, as instants. */
async function startedSlots(db: Db, playbookId: string, slots: Date[]): Promise<Set<number>> {
    if (!slots.length) return new Set();
    const { data } = await db
        .from('delphi_projects')
        .select('scheduled_for')
        .eq('playbook_id', playbookId)
        .gte('scheduled_for', slots[0].toISOString())
        .lte('scheduled_for', slots[slots.length - 1].toISOString());
    return new Set(((data ?? []) as Row[]).map((p) => Date.parse(p.scheduled_for)).filter((t) => Number.isFinite(t)));
}

/**
 * Topics whose episode ended without making anything — it failed, or was
 * called off when the studio was re-staffed — go back in the queue, first in
 * line, rather than sitting "in production" for ever. One that ran out of
 * budget stays where it is: raising the budget resumes it.
 */
export async function requeueStalled(db: Db, departmentId: string): Promise<number> {
    const { data } = await db
        .from('delphi_ideas')
        .select('id, workspace_id, project_id, project:delphi_projects(status)')
        .eq('department_id', departmentId)
        .eq('status', 'scheduled');
    let moved = 0;
    for (const i of (data ?? []) as Row[]) {
        const status = i.project?.status;
        if (status !== 'failed' && status !== 'cancelled') continue;
        const res = await moveIdea(db, i.workspace_id, i.id, 'approved', { project_id: null, scheduled_for: null });
        if (res.ok) moved++;
    }
    return moved;
}

/** One studio's tick. */
export async function tickStudio(db: Db, dept: Row, opts: TickOptions = {}): Promise<TickReport> {
    const report = emptyReport();
    const now = opts.now ?? new Date();
    const workspaceId = dept.workspace_id as string;
    const departmentId = dept.id as string;
    const settings = withSettings(dept.settings);
    const tz = settings.timezone;

    await requeueStalled(db, departmentId);

    const [accounts, playbooks, spend] = await Promise.all([
        listAccounts(db, workspaceId, departmentId).catch(() => [] as MediaAccount[]),
        playbooksOf(db, departmentId),
        spendSince(db, departmentId, monthStart(now, tz)),
    ]);
    const byAccount = new Map(playbooks.filter((p) => p.accountId).map((p) => [p.accountId as string, p]));
    const budget = Number(dept.budget_usd ?? 0) || 0;
    const caps = channelCaps(budget, accounts);
    const month = new Intl.DateTimeFormat('en-GB', { timeZone: tz, month: 'long', year: 'numeric' }).format(now);

    for (const account of accounts) {
        if (account.status !== 'active') continue;
        const playbook = byAccount.get(account.id) ?? null;
        // Nothing is owed for slots before the playbook was approved.
        const due = dueSlots(account.preferences.schedule, tz, now).filter((slot) => !playbook || slot.getTime() >= Date.parse(playbook.approvedAt));

        if (due.length) {
            if (!playbook) {
                report.skipped.push({ departmentId, accountId: account.id, slot: due[0].toISOString(), reason: 'no_playbook' });
            } else {
                const taken = await startedSlots(db, playbook.id, due);
                const open = due.filter((s) => !taken.has(s.getTime()));
                if (open.length) {
                    merge(report, await fillSlot(db, { dept, account, playbook, slot: open[0], spend, budget, caps, tz, month, now, opts }));
                }
            }
        }

        // A short queue of proposals in front of the CHO, for a channel on a
        // schedule where the CHO approves topics. Once a day at most.
        if (playbook && account.preferences.topics === 'cho' && account.preferences.schedule) {
            const ideas = await listIdeas(db, account.id);
            const waiting = ideas.filter((i) => i.status === 'proposed' || i.status === 'approved').length;
            const recent = ideas.some((i) => i.source === 'team' && now.getTime() - Date.parse(i.createdAt) < PROPOSE_EVERY_MS);
            if (waiting < QUEUE_TARGET && !recent) {
                const res = await proposeIdeas(db, { workspaceId, departmentId, accountId: account.id, count: QUEUE_TARGET - waiting, propose: opts.propose });
                report.proposed += res.created.length;
                if (res.created.length) {
                    await postNote(db, {
                        workspaceId,
                        departmentId,
                        accountId: account.id,
                        text: `${res.created.length} new topic${res.created.length === 1 ? '' : 's'} proposed for this channel: ${res.created.map((i) => `“${i.title}”`).join(', ')}. Approve the ones you want in the queue.`,
                    });
                }
            }
        }
    }
    return report;
}

/** What a channel may still spend this month: the studio's and its own, whichever is less. */
export function moneyLeft(c: { budget: number; caps: Map<string, number>; spend: Spend }, accountId: string): { studio: number; channel: number; cap: number } {
    const cap = c.caps.get(accountId) ?? 0;
    return {
        studio: c.budget - c.spend.total - c.spend.held,
        channel: cap - (c.spend.byAccount.get(accountId) ?? 0) - (c.spend.heldByAccount.get(accountId) ?? 0),
        cap,
    };
}

/**
 * What one episode may spend: the channel's cap shared across the month's
 * slots (four, for a channel made on request), never less than the floor and
 * never more than is left. A ceiling, not a price: an episode usually spends
 * far less, and only what it spends counts against the month.
 */
export function episodeBudget(account: Pick<MediaAccount, 'preferences'>, cap: number, left: { studio: number; channel: number }, tz: string, now: Date): number {
    const from = monthStart(now, tz);
    const next = monthStart(new Date(from.getTime() + 32 * 86_400_000), tz);
    const slots = account.preferences.schedule ? slotsBetween(account.preferences.schedule, tz, from, next).length : 4;
    const share = Math.max(EPISODE_FLOOR_USD, cap / Math.max(1, slots));
    return Math.round(Math.min(share, left.studio, left.channel) * 100) / 100;
}

/** Which cap, if any, stops a new run. */
function capReason(left: { studio: number; channel: number }): 'department_cap' | 'channel_cap' | null {
    if (left.studio < MIN_RUN_USD) return 'department_cap';
    if (left.channel < MIN_RUN_USD) return 'channel_cap';
    return null;
}

function capWords(month: string, reason: 'department_cap' | 'channel_cap'): string {
    return reason === 'department_cap'
        ? `The studio's budget for ${month} is spent or held by work still running.`
        : `This channel's share of the budget for ${month} is spent or held by work still running.`;
}

/** Said in the channel's room once a month, in the same words: the amounts are on the channel's tab. */
async function noteCap(db: Db, c: { dept: Row; account: MediaAccount; month: string }, reason: 'department_cap' | 'channel_cap'): Promise<void> {
    await postNote(db, {
        workspaceId: c.dept.workspace_id as string,
        departmentId: c.dept.id as string,
        accountId: c.account.id,
        text: `${capWords(c.month, reason)} Nothing new is started for ${reason === 'department_cap' ? 'any channel' : 'it'} until it frees up or the month turns, unless you raise ${reason === 'department_cap' ? "the studio's budget" : 'its cap'}.`,
        dedupeDays: 31,
    });
}

interface EpisodeContext {
    dept: Row;
    account: MediaAccount;
    playbook: Playbook;
    spend: Spend;
    budget: number;
    caps: Map<string, number>;
    tz: string;
    month: string;
    now: Date;
}

type EpisodeStart = { ok: true; projectId: string } | { ok: false; reason: SkipReason; error: string };

/**
 * Start one episode of a channel, on one topic, for one slot — if the month's
 * money allows. Shared by the scheduler and by "Make it now", so a piece made
 * on request keeps to the same caps as one made on schedule.
 */
async function startEpisode(db: Db, c: EpisodeContext, idea: Idea, slot: Date, why: 'schedule' | 'request'): Promise<EpisodeStart> {
    const { dept, account, playbook, spend, tz } = c;
    const workspaceId = dept.workspace_id as string;
    const departmentId = dept.id as string;

    const left = moneyLeft(c, account.id);
    const capped = capReason(left);
    if (capped) {
        if (why === 'schedule') await noteCap(db, c, capped);
        return { ok: false, reason: capped, error: capWords(c.month, capped) };
    }

    const when = slotWords(slot, tz);
    const topic = `“${idea.title}”${idea.angle ? ` — ${idea.angle}` : ''}`;
    const budgetUsd = episodeBudget(account, left.cap, left, tz, c.now);
    const run = await startRun(db, {
        workspaceId,
        departmentId,
        playbook,
        title: `${account.name}: ${idea.title}`,
        brief: `${String(dept.charter ?? '')}\n\nTHIS EPISODE, for ${accountLabel(account)}: ${topic}. ${why === 'schedule' ? `Due ${when} (${tz}).` : 'Made now, at the CHO\'s request.'}`,
        budgetUsd,
        scheduledFor: slot,
        accountId: account.id,
        ideaId: idea.id,
        topicLine: `THIS EPISODE'S TOPIC: ${topic}. Everything this step makes is about this topic, for this channel.`,
    });
    if (!run.ok) return { ok: false, reason: run.taken ? 'taken' : 'error', error: run.error };

    // Its budget is held from here on, for the rest of this tick too.
    spend.held += budgetUsd;
    spend.heldByAccount.set(account.id, (spend.heldByAccount.get(account.id) ?? 0) + budgetUsd);

    if (idea.status === 'proposed') await moveIdea(db, workspaceId, idea.id, 'approved');
    await moveIdea(db, workspaceId, idea.id, 'scheduled', { project_id: run.projectId, scheduled_for: slot.toISOString() });
    await postNote(db, {
        workspaceId,
        departmentId,
        accountId: account.id,
        text: why === 'schedule' ? `Started the episode for ${when}: ${topic}. It posts here when it is made.` : `Started now, as you asked: ${topic}. It posts here when it is made.`,
    });
    return { ok: true, projectId: run.projectId };
}

/** Start one slot, if a topic and the money allow. */
async function fillSlot(db: Db, c: EpisodeContext & { slot: Date; opts: TickOptions }): Promise<TickReport> {
    const report = emptyReport();
    const { dept, account, slot } = c;
    const workspaceId = dept.workspace_id as string;
    const departmentId = dept.id as string;
    const at = slot.toISOString();

    // The money first, before a topic is picked or proposed for nothing.
    const capped = capReason(moneyLeft(c, account.id));
    if (capped) {
        report.skipped.push({ departmentId, accountId: account.id, slot: at, reason: capped });
        await noteCap(db, c, capped);
        return report;
    }

    // The oldest approved topic; or, where the team picks, one it picks now.
    let idea: Idea | null = (await listIdeas(db, account.id, ['approved']))[0] ?? null;
    if (!idea && account.preferences.topics === 'team') {
        const res = await proposeIdeas(db, { workspaceId, departmentId, accountId: account.id, count: 1, autoApprove: true, propose: c.opts.propose });
        report.proposed += res.created.length;
        idea = res.created[0] ?? null;
    }
    if (!idea) {
        report.skipped.push({ departmentId, accountId: account.id, slot: at, reason: 'no_topic' });
        await postNote(db, {
            workspaceId,
            departmentId,
            accountId: account.id,
            text: `Nothing was started for ${slotWords(slot, c.tz)}: this channel has no approved topic. Approve one in the queue and it takes the next slot.`,
            dedupeDays: 7,
        });
        return report;
    }

    const r = await startEpisode(db, c, idea, slot, 'schedule');
    if (r.ok) report.started.push({ departmentId, accountId: account.id, slot: at, projectId: r.projectId, ideaId: idea.id });
    else report.skipped.push({ departmentId, accountId: account.id, slot: at, reason: r.reason, detail: r.error });
    return report;
}

/**
 * "Make it now": one topic, started at once, outside the schedule. The same
 * checks as a scheduled slot — the channel active, a playbook, the system on,
 * the month's money — and the same once-only claim, on this minute.
 */
export async function startEpisodeNow(db: Db, workspaceId: string, ideaId: string, now: Date = new Date()): Promise<{ ok: true; projectId: string } | { ok: false; error: string }> {
    const { getIdea } = await import('./ideas');
    const { getAccount } = await import('@/lib/studio/accounts');
    const idea = await getIdea(db, workspaceId, ideaId);
    if (!idea) return { ok: false, error: 'That topic is not here.' };
    if (idea.status !== 'approved' && idea.status !== 'proposed') return { ok: false, error: 'Only a topic waiting to be made can be made now.' };

    const account = await getAccount(db, idea.accountId);
    if (!account || account.workspaceId !== workspaceId || account.departmentId !== idea.departmentId) return { ok: false, error: "That topic's channel is not here." };
    if (account.status !== 'active') return { ok: false, error: 'This channel is paused. Resume it first.' };

    const { data: dept } = await db.from('delphi_departments').select('*').eq('id', idea.departmentId).eq('workspace_id', workspaceId).maybeSingle();
    if (!dept) return { ok: false, error: "That topic's studio is not here." };
    if (await systemOff(db, workspaceId, now)) return { ok: false, error: 'The system is switched off. Switch it on, then try again.' };

    const playbook = (await playbooksOf(db, dept.id as string)).find((p) => p.accountId === account.id);
    if (!playbook) return { ok: false, error: 'This channel has no playbook yet. Approve a team for the studio first.' };

    const settings = withSettings(dept.settings);
    const tz = settings.timezone;
    const [accounts, spend] = await Promise.all([listAccounts(db, workspaceId, dept.id as string), spendSince(db, dept.id as string, monthStart(now, tz))]);
    const budget = Number(dept.budget_usd ?? 0) || 0;
    const month = new Intl.DateTimeFormat('en-GB', { timeZone: tz, month: 'long', year: 'numeric' }).format(now);
    // On the minute: pressing twice in the same minute starts it once.
    const slot = new Date(Math.floor(now.getTime() / 60_000) * 60_000);

    const r = await startEpisode(db, { dept, account, playbook, spend, budget, caps: channelCaps(budget, accounts), tz, month, now }, idea, slot, 'request');
    if (!r.ok) return { ok: false, error: r.reason === 'taken' ? 'It has just been started.' : r.error };
    return { ok: true, projectId: r.projectId };
}

/** True when the CHO has switched the system off or is holding it: nothing new is started. */
async function systemOff(db: Db, workspaceId: string, now: Date): Promise<boolean> {
    const state = await getSystemState(db, workspaceId);
    if (state.mode !== 'running') return true;
    return effectiveState(state, now).reason === 'override_hold';
}

/**
 * Everything due in a workspace, started. Never throws: a tick that cannot
 * schedule must still drive the work already running.
 */
export async function startDueWork(db: Db, workspaceId: string, opts: TickOptions = {}): Promise<TickReport> {
    const report = emptyReport();
    const now = opts.now ?? new Date();
    try {
        const { data: depts, error } = await db
            .from('delphi_departments')
            .select('*')
            .eq('workspace_id', workspaceId)
            .eq('status', 'active')
            .eq('kind', 'studio');
        // Before migration 0012 there are no kinds, and nothing to schedule.
        if (error || !depts?.length) return report;
        if (await systemOff(db, workspaceId, now)) {
            report.skipped.push({ departmentId: '', accountId: null, slot: null, reason: 'system_off' });
            return report;
        }
        for (const dept of depts as Row[]) {
            try {
                merge(report, await tickStudio(db, dept, { ...opts, now }));
            } catch (err) {
                report.skipped.push({ departmentId: dept.id, accountId: null, slot: null, reason: 'error', detail: (err as Error).message });
            }
        }
    } catch (err) {
        console.warn(`[delphi] ${CEO_NAME}'s scheduler could not run:`, (err as Error).message);
    }
    return report;
}

/** Workspaces with a playbook to keep to: the ones the cron visits even with nothing running. */
export async function scheduledWorkspaces(db: Db): Promise<string[]> {
    const { data, error } = await db.from('delphi_playbooks').select('workspace_id').eq('status', 'approved');
    if (error) return [];
    return [...new Set(((data ?? []) as Row[]).map((r) => r.workspace_id as string))];
}
