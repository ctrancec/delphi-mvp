/**
 * Compartments: what a prompt may know.
 *
 * Every piece of work belongs to a department, and in a studio to one of its
 * channels. What an agent, the planner or Diablo is told about that work comes
 * from here and only here: the department's purpose and the CHO's rules for
 * it, the channel's settings, its decisions and what it has already made, and
 * the lessons learned there. Nothing from another channel, nothing from
 * another department.
 *
 * The separation is in the queries, not in a promise. Every read below is
 * filtered by the compartment it is for — a channel must belong to the
 * department it is asked for under, or it is not read at all — and the leak
 * tests in scripts/check_context.ts plant marker text in every compartment and
 * fail if any of it surfaces in another's prompt.
 */

import { isMissingColumn, type Db } from './db';
import { kindInfo, roleInfo, withSettings, type DepartmentKind, type DepartmentSettings, type RoleKey, REPORT_LENGTH_LABEL, scheduleWords } from './kinds';
import { accountLabel, describeAccount, toAccount, type MediaAccount } from '@/lib/studio/accounts';

export interface Compartment {
    workspaceId: string;
    departmentId: string;
    /** A channel of a studio. Null for the department itself. */
    accountId?: string | null;
}

export interface CompartmentContext {
    department: {
        id: string;
        name: string;
        kind: DepartmentKind;
        purpose: string;
        settings: DepartmentSettings;
    };
    /** The CHO's note for the role asked about, when there is one. */
    roleNote: { role: RoleKey; note: string } | null;
    account: MediaAccount | null;
    /** Department decisions, then the channel's. What the CHO has settled. */
    decisions: { scope: 'department' | 'account'; text: string }[];
    lessons: { title: string; body: string }[];
    /** What this channel has already made, newest first. */
    history: { title: string; kind: string; at: string; publishedUrl: string | null }[];
    /** Facts the CHO pinned for the whole organisation. */
    pinned: { title: string; body: string }[];
}

export interface ContextOptions {
    /** The role of whoever the prompt is for, so they get their note. */
    role?: RoleKey | null;
    /** How many past pieces to show. */
    historyLimit?: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const MAX_DECISIONS = 30;
const MAX_LESSONS = 8;

/**
 * Everything a prompt for this compartment may draw on. Null when the
 * department is not there, or is not in this workspace.
 */
export async function contextFor(db: Db, c: Compartment, opts: ContextOptions = {}): Promise<CompartmentContext | null> {
    const { data: dept } = await db
        .from('delphi_departments')
        .select('*')
        .eq('id', c.departmentId)
        .eq('workspace_id', c.workspaceId)
        .maybeSingle();
    if (!dept) return null;

    const settings = withSettings((dept as Row).settings);
    const kind = (['research', 'studio', 'general'].includes((dept as Row).kind) ? (dept as Row).kind : 'research') as DepartmentKind;

    // The channel, only if it is this department's. An id from elsewhere is
    // not followed — that would be exactly the leak this file prevents.
    let account: MediaAccount | null = null;
    if (c.accountId) {
        const { data, error } = await db
            .from('delphi_media_accounts')
            .select('*')
            .eq('id', c.accountId)
            .eq('department_id', c.departmentId)
            .eq('workspace_id', c.workspaceId)
            .maybeSingle();
        if (!error && data) account = toAccount(data);
    }

    const [deptMemories, accountMemories, pinned, history] = await Promise.all([
        departmentMemories(db, c),
        account ? accountMemoriesOf(db, c, account.id) : Promise.resolve([] as Row[]),
        pinnedFacts(db, c.workspaceId),
        account ? historyOf(db, c.workspaceId, account.id, opts.historyLimit ?? 12) : Promise.resolve([]),
    ]);

    const decisions: CompartmentContext['decisions'] = [
        ...deptMemories.filter((m) => m.kind === 'decision').map((m) => ({ scope: 'department' as const, text: memoryText(m) })),
        ...accountMemories.filter((m) => m.kind === 'decision').map((m) => ({ scope: 'account' as const, text: memoryText(m) })),
    ].slice(0, MAX_DECISIONS);

    const lessons = [...accountMemories, ...deptMemories]
        .filter((m) => m.kind !== 'decision')
        .slice(0, MAX_LESSONS)
        .map((m) => ({ title: String(m.title), body: String(m.body) }));

    const note = opts.role ? settings.roleNotes[opts.role] : undefined;

    return {
        department: {
            id: (dept as Row).id,
            name: (dept as Row).name,
            kind,
            purpose: String((dept as Row).charter ?? ''),
            settings,
        },
        roleNote: opts.role && note ? { role: opts.role, note } : null,
        account,
        decisions,
        lessons,
        history,
        pinned: pinned.map((m) => ({ title: String(m.title), body: String(m.body) })),
    };
}

function memoryText(m: Row): string {
    const title = String(m.title ?? '').trim();
    const body = String(m.body ?? '').trim();
    if (!body || body === title) return title;
    if (!title) return body;
    return `${title}: ${body}`;
}

/** The department's own memories: those filed to it and to no channel. */
async function departmentMemories(db: Db, c: Compartment): Promise<Row[]> {
    const run = (withAccountColumn: boolean) => {
        let q = db
            .from('delphi_memories')
            .select('*')
            .eq('workspace_id', c.workspaceId)
            .eq('department_id', c.departmentId);
        if (withAccountColumn) q = q.is('account_id', null);
        return q.order('importance', { ascending: false }).order('created_at', { ascending: false }).limit(40);
    };
    let { data, error } = await run(true);
    if (error && isMissingColumn(error)) {
        // Before migration 0012 there are no channel memories to keep out.
        ({ data, error } = await run(false));
    }
    if (error) return [];
    return (data ?? []) as Row[];
}

/** One channel's memories, and only if they are filed under this department too. */
async function accountMemoriesOf(db: Db, c: Compartment, accountId: string): Promise<Row[]> {
    const { data, error } = await db
        .from('delphi_memories')
        .select('*')
        .eq('workspace_id', c.workspaceId)
        .eq('department_id', c.departmentId)
        .eq('account_id', accountId)
        .order('importance', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(40);
    if (error) return [];
    return (data ?? []) as Row[];
}

/** Facts the CHO pinned for every department: organisation scope, filed to none. */
async function pinnedFacts(db: Db, workspaceId: string): Promise<Row[]> {
    const { data, error } = await db
        .from('delphi_memories')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('scope', 'org')
        .is('department_id', null)
        .in('kind', ['fact', 'preference'])
        .order('importance', { ascending: false })
        .limit(10);
    if (error) return [];
    return (data ?? []) as Row[];
}

/** What one channel has already made, so it does not make it again. */
async function historyOf(db: Db, workspaceId: string, accountId: string, limit: number): Promise<CompartmentContext['history']> {
    const run = (withTrash: boolean) => {
        let q = db
            .from('delphi_artifacts')
            .select('*')
            .eq('workspace_id', workspaceId)
            .eq('account_id', accountId);
        if (withTrash) q = q.is('deleted_at', null);
        return q.order('created_at', { ascending: false }).limit(limit);
    };
    let { data, error } = await run(true);
    if (error && isMissingColumn(error)) ({ data, error } = await run(false));
    if (error) return [];
    return ((data ?? []) as Row[]).map((r) => {
        const studio = (r.data ?? {}).studio ?? {};
        return {
            title: String(studio.publish?.title ?? studio.plan?.slides?.[0]?.headline ?? r.title),
            kind: String(studio.format ?? r.kind),
            at: String(r.created_at),
            publishedUrl: typeof studio.published?.url === 'string' ? studio.published.url : null,
        };
    });
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export interface RenderOptions {
    /** For the planner: every role's note, not just one. */
    allRoleNotes?: boolean;
    /** Leave the channel's description out, when the prompt already carries it. */
    omitAccountDescription?: boolean;
}

/** The compartment as prompt text. Sections with nothing in them are left out. */
export function renderContext(ctx: CompartmentContext, opts: RenderOptions = {}): string {
    const { department: d } = ctx;
    const s = d.settings;
    const out: string[] = [];

    out.push('--- THIS DEPARTMENT ---', `${d.name} (${kindInfo(d.kind).label.toLowerCase()})`);
    if (d.purpose) out.push(`Purpose: ${d.purpose}`);

    if (d.kind === 'research') {
        const r = s.research;
        if (r.topics.length) out.push(`Topics: ${r.topics.join('; ')}`);
        out.push(`Report: ${REPORT_LENGTH_LABEL[r.report.length]}.`);
        if (r.report.sections) out.push(`Report sections: ${r.report.sections}`);
        if (r.report.tone) out.push(`Report tone: ${r.report.tone}`);
        if (s.schedule) out.push(`Delivered: ${scheduleWords(s.schedule, s.timezone)}`);
    }

    if (s.houseRules) out.push('', 'HOUSE RULES, from the CHO. Follow them:', s.houseRules);

    if (opts.allRoleNotes) {
        const notes = Object.entries(s.roleNotes).filter(([, v]) => v);
        if (notes.length) {
            out.push('', 'NOTES PER ROLE, from the CHO:');
            for (const [k, v] of notes) out.push(`- ${roleInfo(k as RoleKey).label}: ${v}`);
        }
    } else if (ctx.roleNote) {
        out.push('', `NOTES FOR YOUR ROLE (${roleInfo(ctx.roleNote.role).label.toLowerCase()}), from the CHO:`, ctx.roleNote.note);
    }

    const deptDecisions = ctx.decisions.filter((x) => x.scope === 'department');
    if (deptDecisions.length) {
        out.push('', 'DECIDED FOR THIS DEPARTMENT:', ...deptDecisions.map((x) => `- ${x.text}`));
    }

    if (ctx.account) {
        out.push('', '--- THIS CHANNEL ---');
        if (!opts.omitAccountDescription) out.push(describeAccount(ctx.account, s.timezone));
        else out.push(accountLabel(ctx.account));
        const own = ctx.decisions.filter((x) => x.scope === 'account');
        if (own.length) out.push('', 'DECIDED FOR THIS CHANNEL. Follow these:', ...own.map((x) => `- ${x.text}`));
        if (ctx.history.length) {
            out.push('', 'ALREADY MADE FOR THIS CHANNEL. Do not repeat these:');
            for (const h of ctx.history) {
                out.push(`- ${h.at.slice(0, 10)} ${h.kind}: "${h.title}"${h.publishedUrl ? ` (published: ${h.publishedUrl})` : ''}`);
            }
        }
    }

    if (ctx.pinned.length) {
        out.push('', 'ABOUT THE CHO (true everywhere):', ...ctx.pinned.map((p) => `- ${p.title}: ${p.body}`));
    }

    if (ctx.lessons.length) {
        out.push('', 'LESSONS FROM PAST WORK HERE:', ...ctx.lessons.map((l) => `- ${l.title}: ${l.body}`));
    }

    return out.join('\n');
}

/** Channel kinds this department may use; empty means every connected one. */
export function allowedSources(ctx: CompartmentContext | null): string[] {
    if (!ctx || ctx.department.kind !== 'research') return [];
    return ctx.department.settings.research.sources;
}
