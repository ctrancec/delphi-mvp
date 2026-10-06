/**
 * Topics, per channel: what the team proposes, what the CHO approves, what
 * gets made, and what went live.
 *
 *   proposed → approved → scheduled (an episode is being made) → made → published
 *          ↘ rejected
 *
 * The team proposes from the channel's own compartment — its pillars, its
 * decisions, what it has already made — and from research the studio shared,
 * and never from another channel. Whether the CHO approves each topic or the
 * team's are taken as they come is the channel's own setting.
 *
 * The model call is a seam (`ProposeIdeas`), so the scheduler's tests run
 * offline.
 */

import { Type, type Schema } from '@google/genai';
import { generateStructured } from '@/lib/llm/gemini';
import { contextFor, renderContext } from './context';
import { DELPHI_SYSTEM_PROMPT } from './delphi';
import { emitEvent, isMissingColumn, type Db } from './db';
import { roleOfAgent } from './kinds';
import { FORMAT_WORD, isFormat } from '@/lib/studio/accounts';
import { CEO_NAME, CHO_NAME } from '@/lib/pixel/cast/names';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

export type IdeaStatus = 'proposed' | 'approved' | 'rejected' | 'scheduled' | 'made' | 'published';
export type IdeaSource = 'team' | 'cho' | 'chat';

export interface Idea {
    id: string;
    workspaceId: string;
    departmentId: string;
    accountId: string;
    title: string;
    angle: string | null;
    format: string | null;
    status: IdeaStatus;
    source: IdeaSource;
    scheduledFor: string | null;
    projectId: string | null;
    artifactId: string | null;
    publishedUrl: string | null;
    publishedAt: string | null;
    createdAt: string;
}

export const IDEA_STATUS_WORDS: Record<IdeaStatus, string> = {
    proposed: 'Proposed',
    approved: 'Approved',
    rejected: 'Rejected',
    scheduled: 'In production',
    made: 'Made',
    published: 'Published',
};

export function toIdea(r: Row): Idea {
    return {
        id: r.id,
        workspaceId: r.workspace_id,
        departmentId: r.department_id,
        accountId: r.account_id,
        title: String(r.title ?? ''),
        angle: r.angle ?? null,
        format: r.format ?? null,
        status: r.status,
        source: r.source ?? 'team',
        scheduledFor: r.scheduled_for ?? null,
        projectId: r.project_id ?? null,
        artifactId: r.artifact_id ?? null,
        publishedUrl: r.published_url ?? null,
        publishedAt: r.published_at ?? null,
        createdAt: r.created_at,
    };
}

/** A title as compared for repeats: case, punctuation and spacing aside. */
export function normalTitle(t: string): string {
    return t
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}

/** One channel's topics, oldest first, in the given states (all of them when none are given). */
export async function listIdeas(db: Db, accountId: string, statuses?: IdeaStatus[], limit = 100): Promise<Idea[]> {
    let q = db.from('delphi_ideas').select('*').eq('account_id', accountId);
    if (statuses?.length) q = q.in('status', statuses);
    const { data, error } = await q.order('created_at', { ascending: true }).limit(limit);
    if (error) return [];
    return ((data ?? []) as Row[]).map(toIdea);
}

/** A studio's topics across its channels. */
export async function listDepartmentIdeas(db: Db, departmentId: string, statuses?: IdeaStatus[], limit = 200): Promise<Idea[]> {
    let q = db.from('delphi_ideas').select('*').eq('department_id', departmentId);
    if (statuses?.length) q = q.in('status', statuses);
    const { data, error } = await q.order('created_at', { ascending: true }).limit(limit);
    if (error) return [];
    return ((data ?? []) as Row[]).map(toIdea);
}

export async function getIdea(db: Db, workspaceId: string, id: string): Promise<Idea | null> {
    const { data, error } = await db.from('delphi_ideas').select('*').eq('id', id).eq('workspace_id', workspaceId).maybeSingle();
    if (error || !data) return null;
    return toIdea(data as Row);
}

export interface NewIdea {
    workspaceId: string;
    departmentId: string;
    accountId: string;
    title: string;
    angle?: string | null;
    format?: string | null;
    source: IdeaSource;
    status: 'proposed' | 'approved';
}

/** Add a topic. Refused when it is empty, too long, or one this channel already has. */
export async function addIdea(db: Db, input: NewIdea): Promise<{ ok: true; idea: Idea } | { ok: false; error: string }> {
    const title = input.title.replace(/\s+/g, ' ').trim();
    if (title.length < 3) return { ok: false, error: 'A topic needs a few words.' };
    if (title.length > 160) return { ok: false, error: 'Keep a topic to a line — under 160 characters.' };
    const angle = input.angle?.replace(/\s+/g, ' ').trim().slice(0, 400) || null;

    const existing = await listIdeas(db, input.accountId);
    if (existing.some((i) => normalTitle(i.title) === normalTitle(title))) {
        return { ok: false, error: 'This channel already has that topic.' };
    }

    const { data, error } = await db
        .from('delphi_ideas')
        .insert({
            workspace_id: input.workspaceId,
            department_id: input.departmentId,
            account_id: input.accountId,
            title,
            angle,
            format: input.format && isFormat(input.format) ? input.format : null,
            status: input.status,
            source: input.source,
        })
        .select('*')
        .single();
    if (error || !data) return { ok: false, error: error?.message ?? 'The topic could not be added.' };
    return { ok: true, idea: toIdea(data as Row) };
}

/**
 * Move a topic on. Only the moves the lifecycle allows: a topic in production
 * or already made is not approved or rejected out from under its episode.
 */
const MOVES: Record<IdeaStatus, IdeaStatus[]> = {
    proposed: ['approved', 'rejected'],
    approved: ['rejected', 'scheduled'],
    rejected: ['approved'],
    scheduled: ['made', 'approved'],
    made: ['published'],
    published: [],
};

export async function moveIdea(db: Db, workspaceId: string, id: string, to: IdeaStatus, extra: Row = {}): Promise<{ ok: boolean; error?: string; idea?: Idea }> {
    const idea = await getIdea(db, workspaceId, id);
    if (!idea) return { ok: false, error: 'That topic is not here.' };
    if (idea.status === to) return { ok: true, idea };
    if (!MOVES[idea.status].includes(to)) {
        return { ok: false, error: `A topic that is ${IDEA_STATUS_WORDS[idea.status].toLowerCase()} cannot become ${IDEA_STATUS_WORDS[to].toLowerCase()}.` };
    }
    const { data, error } = await db
        .from('delphi_ideas')
        .update({ status: to, updated_at: new Date().toISOString(), ...extra })
        .eq('id', id)
        .eq('workspace_id', workspaceId)
        .select('*');
    if (error) return { ok: false, error: error.message };
    const row = ((data ?? []) as Row[])[0];
    return { ok: true, idea: row ? toIdea(row) : { ...idea, status: to } };
}

// ---------------------------------------------------------------------------
// The team proposes
// ---------------------------------------------------------------------------

export type ProposeIdeas = (input: { system: string; prompt: string; count: number }) => Promise<{
    ideas: { title: string; angle: string; format?: string | null }[];
    costUsd: number;
}>;

const IDEAS_SCHEMA: Schema = {
    type: Type.OBJECT,
    properties: {
        ideas: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    title: { type: Type.STRING, description: 'The topic, as a working title. One line.' },
                    angle: { type: Type.STRING, description: 'The specific angle or hook that makes it worth making, in one sentence.' },
                    format: { type: Type.STRING, description: 'One of the channel\'s formats.' },
                },
                required: ['title', 'angle'],
            },
        },
    },
    required: ['ideas'],
};

export const liveProposeIdeas: ProposeIdeas = async ({ system, prompt }) => {
    const result = await generateStructured<{ ideas: { title: string; angle: string; format?: string | null }[] }>(
        prompt,
        IDEAS_SCHEMA,
        (value) => {
            const v = value as { ideas?: unknown };
            if (!Array.isArray(v?.ideas)) throw new Error('No ideas.');
            return {
                ideas: (v.ideas as Row[])
                    .filter((i) => typeof i?.title === 'string')
                    .map((i) => ({ title: String(i.title), angle: String(i.angle ?? ''), format: typeof i.format === 'string' ? i.format : null })),
            };
        },
        { system, temperature: 0.8 }
    );
    return { ideas: result.data.ideas, costUsd: result.costUsd };
};

/** The studio's strategist, when it hired one. */
async function strategistOf(db: Db, departmentId: string): Promise<{ name: string; systemPrompt: string } | null> {
    const { data } = await db.from('delphi_hires').select('agent:delphi_agents(slug, name, title, system_prompt)').eq('department_id', departmentId);
    for (const h of (data ?? []) as Row[]) {
        const a = h.agent as Row | null;
        if (a && roleOfAgent({ slug: a.slug, title: a.title }) === 'strategist') return { name: a.name, systemPrompt: a.system_prompt ?? '' };
    }
    return null;
}

/** What the studio researched lately for everyone: its shared work, not any channel's. */
async function sharedResearch(db: Db, workspaceId: string, departmentId: string): Promise<string[]> {
    const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
    const run = (withAccount: boolean) => {
        let q = db
            .from('delphi_artifacts')
            .select('title, content_md, data, created_at, project:delphi_projects!inner(department_id)')
            .eq('workspace_id', workspaceId)
            .eq('project.department_id', departmentId)
            .gte('created_at', since);
        if (withAccount) q = q.is('account_id', null);
        return q.order('created_at', { ascending: false }).limit(3);
    };
    let { data, error } = await run(true);
    if (error && isMissingColumn(error)) ({ data, error } = await run(false));
    if (error) return [];
    return ((data ?? []) as Row[])
        .filter((r) => r.project?.department_id === departmentId)
        .map((r) => {
            const summary = String(r.data?.summary ?? '').trim() || String(r.content_md ?? '').slice(0, 600);
            return `- ${r.title}: ${summary}`;
        });
}

export interface ProposeInput {
    workspaceId: string;
    departmentId: string;
    accountId: string;
    count?: number;
    /** The team picks for this channel: what it proposes is approved as it comes. */
    autoApprove?: boolean;
    propose?: ProposeIdeas;
}

/**
 * The team proposes new topics for one channel. The strategist does, when
 * the studio has one; otherwise Diablo. Repeats of anything the channel has
 * had — made, queued or turned down — are dropped.
 */
export async function proposeIdeas(db: Db, input: ProposeInput): Promise<{ created: Idea[]; costUsd: number; error?: string }> {
    const count = Math.max(1, Math.min(input.count ?? 3, 6));
    const propose = input.propose ?? liveProposeIdeas;

    const ctx = await contextFor(db, { workspaceId: input.workspaceId, departmentId: input.departmentId, accountId: input.accountId }, { role: 'strategist', historyLimit: 20 });
    if (!ctx?.account) return { created: [], costUsd: 0, error: 'That channel is not part of this studio.' };

    const [strategist, research, existing] = await Promise.all([
        strategistOf(db, input.departmentId),
        sharedResearch(db, input.workspaceId, input.departmentId),
        listIdeas(db, input.accountId),
    ]);
    const formats = ctx.account.preferences.formats;

    const prompt = [
        renderContext(ctx),
        ...(research.length ? ['', 'RESEARCH THE STUDIO SHARED LATELY:', ...research] : []),
        ...(existing.length
            ? ['', 'TOPICS THIS CHANNEL ALREADY HAS (made, queued or turned down). Do not repeat them:', ...existing.map((i) => `- ${i.title} (${IDEA_STATUS_WORDS[i.status].toLowerCase()})`)]
            : []),
        '',
        `Propose ${count} new topic${count === 1 ? '' : 's'} for this channel. Each must fit its niche, pillars and decisions, follow the house rules, and be specific enough to make today: a working title and the angle that makes it worth watching.`,
        `Formats this channel makes: ${formats.map((f) => `${f} (${FORMAT_WORD[f]})`).join(', ')}. Give each topic one of them.`,
    ].join('\n');
    const system = strategist?.systemPrompt || DELPHI_SYSTEM_PROMPT;

    let out;
    try {
        out = await propose({ system, prompt, count });
    } catch (err) {
        return { created: [], costUsd: 0, error: (err as Error).message };
    }

    const seen = new Set(existing.map((i) => normalTitle(i.title)));
    const created: Idea[] = [];
    for (const idea of out.ideas) {
        if (created.length >= count) break;
        const key = normalTitle(idea.title);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const res = await addIdea(db, {
            workspaceId: input.workspaceId,
            departmentId: input.departmentId,
            accountId: input.accountId,
            title: idea.title,
            angle: idea.angle,
            format: idea.format && (formats as string[]).includes(idea.format) ? idea.format : null,
            source: 'team',
            status: input.autoApprove ? 'approved' : 'proposed',
        });
        if (res.ok) created.push(res.idea);
    }
    if (created.length) {
        await emitEvent(db, {
            workspaceId: input.workspaceId,
            departmentId: input.departmentId,
            type: 'ideas_proposed',
            actor: strategist?.name ?? CEO_NAME,
            verb: input.autoApprove ? 'picked topics for' : 'proposed topics for',
            object: ctx.account.name,
            payload: { count: created.length, costUsd: out.costUsd },
        });
    }
    return { created, costUsd: out.costUsd };
}

// ---------------------------------------------------------------------------
// Made, and published
// ---------------------------------------------------------------------------

/** An episode's piece exists: its topic is made. Never throws. */
export async function markIdeaMade(db: Db, ideaId: string, artifactId: string): Promise<void> {
    try {
        await db
            .from('delphi_ideas')
            .update({ status: 'made', artifact_id: artifactId, updated_at: new Date().toISOString() })
            .eq('id', ideaId)
            .in('status', ['approved', 'scheduled']);
    } catch (err) {
        console.warn('[delphi] could not mark the topic made:', (err as Error).message);
    }
}

/** A link a piece went live at: http or https, and nothing else. */
export function validPublishedUrl(raw: string): string | null {
    const t = raw.trim();
    if (!t || t.length > 500) return null;
    try {
        const u = new URL(t);
        return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
    } catch {
        return null;
    }
}

/**
 * The CHO published a channel's piece, by hand, and says where. The link goes
 * on the piece — where its channel's history reads it, so nothing is made
 * twice — and on its topic.
 */
export async function markPublished(db: Db, workspaceId: string, artifactId: string, rawUrl: string, actor: string = CHO_NAME): Promise<{ ok: boolean; error?: string }> {
    const url = validPublishedUrl(rawUrl);
    if (!url) return { ok: false, error: 'Paste the link it went live at, starting with https://.' };

    const { data: artifact, error } = await db.from('delphi_artifacts').select('*').eq('id', artifactId).eq('workspace_id', workspaceId).maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (!artifact) return { ok: false, error: 'That piece is not here.' };
    if (!artifact.account_id) return { ok: false, error: "Only a channel's piece is marked published." };

    const at = new Date().toISOString();
    const data = (artifact.data ?? {}) as Row;
    const studio = (data.studio ?? {}) as Row;
    const { error: upd } = await db
        .from('delphi_artifacts')
        .update({ data: { ...data, studio: { ...studio, published: { url, at } } } })
        .eq('id', artifactId)
        .eq('workspace_id', workspaceId);
    if (upd) return { ok: false, error: upd.message };

    await db
        .from('delphi_ideas')
        .update({ status: 'published', published_url: url, published_at: at, updated_at: at })
        .eq('workspace_id', workspaceId)
        .eq('artifact_id', artifactId);

    await emitEvent(db, {
        workspaceId,
        projectId: (artifact.project_id as string) ?? undefined,
        type: 'output_published',
        actor,
        verb: 'published',
        object: String(artifact.title ?? ''),
        payload: { url },
    });
    return { ok: true };
}
