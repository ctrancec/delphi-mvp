/**
 * What a studio's page shows of its production loop: the board across its
 * channels, one channel's queue, and whether anything is due right now.
 *
 * Read through the viewer's own client, so RLS decides what comes back. Each
 * piece reads only what it shows: a channel's tab never reads another
 * channel's topics.
 */

import type { Db } from './db';
import { listDepartmentIdeas, listIdeas } from './ideas';
import { playbooksOf, type Playbook } from './playbooks';
import { channelCaps, departmentDue, departmentSlots, spendSince } from './scheduler';
import { dueSlots, monthStart, nextSlots, slotWords } from './slots';
import { scheduleWords } from './kinds';
import { accountOf, listOutputs } from './outputs';
import { FORMAT_WORD, isFormat, PLATFORM_LABEL, type MediaAccount } from '@/lib/studio/accounts';
import type { BoardItem, StudioBoardProps } from '@/components/delphi/studio-board';
import type { ChannelQueueProps } from '@/components/delphi/channel-queue';
import type { RunScheduleProps } from '@/components/delphi/run-schedule';
import type { DepartmentSettings } from './kinds';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const DAY_MS = 86_400_000;

export interface StudioViewInput {
    departmentId: string;
    budgetUsd: number;
    timezone: string;
    accounts: MediaAccount[];
    /** The channel whose tab is open; null for the overview. */
    channel: MediaAccount | null;
    /** Agent names by id, for the playbook's steps. */
    agentNames: Map<string, string>;
    canEdit: boolean;
    now?: Date;
}

export interface StudioView {
    board: StudioBoardProps | null;
    queue: ChannelQueueProps | null;
    /** A slot is due and not yet started: the page pokes the engine, which starts it. */
    dueNow: boolean;
}

const short = (a: MediaAccount) => `${PLATFORM_LABEL[a.platform] ?? a.platform} · ${a.name}`;

/** Slots a playbook has already started, as instants, from a moment on. */
async function startedSince(db: Db, departmentId: string, since: Date): Promise<Set<string>> {
    const { data, error } = await db
        .from('delphi_projects')
        .select('playbook_id, scheduled_for')
        .eq('department_id', departmentId)
        .gte('scheduled_for', since.toISOString());
    if (error) return new Set();
    return new Set(((data ?? []) as Row[]).map((p) => `${p.playbook_id}|${Date.parse(p.scheduled_for)}`));
}

export async function studioView(db: Db, input: StudioViewInput): Promise<StudioView> {
    const now = input.now ?? new Date();
    const tz = input.timezone;
    const byId = new Map(input.accounts.map((a) => [a.id, a]));
    const playbooks = await playbooksOf(db, input.departmentId);
    const playbookOf = new Map(playbooks.filter((p) => p.accountId).map((p) => [p.accountId as string, p]));
    const started = await startedSince(db, input.departmentId, new Date(now.getTime() - 4 * DAY_MS));

    const open = (p: Playbook, slots: Date[]) => slots.filter((s) => s.getTime() >= Date.parse(p.approvedAt) && !started.has(`${p.id}|${s.getTime()}`));
    // Due, and fillable: a topic is approved, or the team picks one. A slot
    // waiting on the CHO's approval is not a reason to wake the engine.
    const approved = new Set((await listDepartmentIdeas(db, input.departmentId, ['approved'])).map((i) => i.accountId));
    const dueNow = input.accounts.some((a) => {
        const p = playbookOf.get(a.id);
        const fillable = a.preferences.topics === 'team' || approved.has(a.id);
        return a.status === 'active' && p && fillable && open(p, dueSlots(a.preferences.schedule, tz, now)).length > 0;
    });

    if (!input.channel) return { board: await board(db, input, byId, now, tz), queue: null, dueNow };

    const a = input.channel;
    const playbook = playbookOf.get(a.id) ?? null;
    const [ideas, spend] = await Promise.all([listIdeas(db, a.id), spendSince(db, input.departmentId, monthStart(now, tz))]);
    const caps = channelCaps(input.budgetUsd, input.accounts);
    const upcoming = playbook ? open(playbook, nextSlots(a.preferences.schedule, tz, now, 12)) : nextSlots(a.preferences.schedule, tz, now, 12);

    const queue: ChannelQueueProps = {
        accountId: a.id,
        canEdit: input.canEdit,
        topics: a.preferences.topics,
        paused: a.status !== 'active',
        schedule: scheduleWords(a.preferences.schedule, tz),
        nextSlots: upcoming.map((s) => slotWords(s, tz)),
        money: a.status === 'active' ? {
            spent: spend.byAccount.get(a.id) ?? 0,
            held: spend.heldByAccount.get(a.id) ?? 0,
            cap: caps.get(a.id) ?? 0,
            own: a.preferences.monthlyCapUsd !== null,
        } : null,
        hasPlaybook: Boolean(playbook),
        playbook: (playbook?.steps ?? []).map((s) => ({
            seq: s.seq,
            title: s.title,
            agent: input.agentNames.get(s.agentId) ?? 'an agent',
            deliverable: isFormat(s.deliverable) ? FORMAT_WORD[s.deliverable] : 'text',
        })),
        ideas: ideas
            .filter((i) => i.status !== 'rejected')
            .map((i) => ({
                id: i.id,
                title: i.title,
                angle: i.angle,
                status: i.status,
                source: i.source,
                slot: i.scheduledFor ? slotWords(new Date(i.scheduledFor), tz) : null,
                artifactId: i.artifactId,
                publishedUrl: i.publishedUrl,
            })),
    };
    return { board: null, queue, dueNow };
}

/** The week across channels. */
async function board(db: Db, input: StudioViewInput, byId: Map<string, MediaAccount>, now: Date, tz: string): Promise<StudioBoardProps> {
    const base = `/dashboard/delphi/departments/${input.departmentId}`;
    const channelOf = (id: string | null | undefined) => (id && byId.get(id) ? short(byId.get(id)!) : 'A channel no longer here');
    const tab = (id: string) => `${base}?tab=${encodeURIComponent(id)}`;

    const [ideas, running, outputs] = await Promise.all([
        listDepartmentIdeas(db, input.departmentId, ['proposed', 'approved']),
        db
            .from('delphi_projects')
            .select('id, title, account_id, scheduled_for')
            .eq('department_id', input.departmentId)
            .eq('status', 'running')
            .not('account_id', 'is', null)
            .order('created_at', { ascending: true })
            .then(({ data, error }) => (error ? [] : ((data ?? []) as Row[]))),
        listOutputs(db, { departmentId: input.departmentId, since: new Date(now.getTime() - 30 * DAY_MS).toISOString(), limit: 120 }).catch(() => []),
    ]);

    const weekAgo = now.getTime() - 7 * DAY_MS;
    const review: BoardItem[] = [];
    const published: BoardItem[] = [];
    for (const r of outputs) {
        const account = accountOf(r);
        if (!account) continue;
        const pub = (r.artifact.data as { studio?: { published?: { url?: string; at?: string } } }).studio?.published;
        if (pub?.url && pub.at && Date.parse(pub.at) >= weekAgo) {
            published.push({ key: `p-${r.artifact.id}`, title: r.artifact.title, channel: channelOf(account.id), href: pub.url, external: true });
        } else if (r.review.status === 'pending') {
            review.push({ key: `r-${r.artifact.id}`, title: r.artifact.title, channel: channelOf(account.id), href: `/dashboard/delphi/outputs/${r.artifact.id}` });
        }
    }

    return {
        ideas: ideas
            .filter((i) => byId.has(i.accountId))
            .map((i) => ({ key: `i-${i.id}`, title: i.title, channel: channelOf(i.accountId), href: tab(i.accountId), note: i.status === 'proposed' ? 'waiting for you' : 'queued' })),
        production: running.map((p) => ({
            key: `w-${p.id}`,
            title: String(p.title ?? '').replace(/^[^:]+:\s*/, ''),
            channel: channelOf(p.account_id),
            href: tab(p.account_id),
            note: p.scheduled_for ? `for ${slotWords(new Date(p.scheduled_for), tz)}` : 'running',
        })),
        review,
        published,
    };
}

const RUN_STATUS: Record<string, string> = {
    running: 'running',
    done: 'done',
    failed: 'failed',
    cancelled: 'called off',
    halted_budget: 'stopped at its budget',
    paused: 'paused',
};

/** What a research or general department's page shows of its schedule: when it runs next, how its last runs went, the month's money. */
export async function departmentRunView(
    db: Db,
    input: { departmentId: string; status: string; budgetUsd: number; settings: DepartmentSettings; cadenceCron: string | null; canEdit: boolean; now?: Date }
): Promise<{ props: RunScheduleProps; dueNow: boolean }> {
    const now = input.now ?? new Date();
    const { settings } = input;
    const tz = settings.schedule ? settings.timezone : input.cadenceCron ? 'UTC' : settings.timezone;
    const [playbooks, spend, runs] = await Promise.all([
        playbooksOf(db, input.departmentId),
        spendSince(db, input.departmentId, monthStart(now, tz)),
        db
            .from('delphi_projects')
            .select('id, title, status, created_at, scheduled_for, playbook_id')
            .eq('department_id', input.departmentId)
            .not('playbook_id', 'is', null)
            .order('created_at', { ascending: false })
            .limit(5)
            .then(({ data, error }) => (error ? [] : ((data ?? []) as Row[]))),
    ]);
    const hasSchedule = Boolean(settings.schedule || input.cadenceCron);
    // A run owed and not started, on its own: the page pokes the engine, which starts it.
    const own = playbooks.find((p) => !p.accountId);
    const slot = departmentDue(settings, input.cadenceCron, now);
    const started = own && slot ? await startedSince(db, input.departmentId, slot) : new Set<string>();
    const dueNow = Boolean(input.status === 'active' && own && slot && settings.autonomy !== 'ask' && slot.getTime() >= Date.parse(own.approvedAt) && !started.has(`${own.id}|${slot.getTime()}`));
    const props: RunScheduleProps = {
        departmentId: input.departmentId,
        canEdit: input.canEdit,
        active: input.status === 'active',
        schedule: settings.schedule ? scheduleWords(settings.schedule, tz) : input.cadenceCron ? `cron ${input.cadenceCron} (UTC)` : 'On demand',
        hasSchedule,
        asks: settings.autonomy === 'ask',
        hasPlaybook: playbooks.some((p) => !p.accountId),
        next: hasSchedule ? departmentSlots(settings, input.cadenceCron, now, new Date(now.getTime() + 60 * DAY_MS)).slice(0, 3).map((d) => slotWords(d, tz)) : [],
        runs: runs.map((r) => ({
            id: String(r.id),
            title: String(r.title ?? ''),
            status: RUN_STATUS[String(r.status)] ?? String(r.status),
            when: slotWords(new Date(String(r.scheduled_for ?? r.created_at)), tz),
        })),
        money: { spent: spend.total, held: spend.held, budget: input.budgetUsd },
    };
    return { props, dueNow };
}
