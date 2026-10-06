/**
 * Rooms: talking inside a department.
 *
 * Every department has a room, and every channel of a studio has its own.
 * The CHO talks to Diablo there, or to one member of the team by @name. What
 * anyone in a room knows comes from that room's compartment (context.ts) and
 * its own conversation — never another room's, never another channel's work.
 * A studio's own room sees each channel's standing, not its conversation.
 *
 * Talk is free; change is not. When Diablo would change something — send a
 * piece back, change a channel's settings, pause it, record a decision — it
 * posts an action card, and nothing happens until the owner taps Confirm.
 * Reviewers can post; only the owner confirms; Diablo never confirms anything.
 *
 * The model call is a seam (`Converse`), so every rule here is asserted
 * offline in scripts/check_rooms.ts.
 */

import { Type, type FunctionDeclaration, type Schema } from '@google/genai';
import { DEFAULT_MODEL, generateWithTools } from '@/lib/llm/gemini';
import { contextFor, renderContext, type Compartment } from './context';
import { DELPHI_SYSTEM_PROMPT } from './delphi';
import { persona } from './chat';
import { DELPHI_SLUG, emitEvent, isMissingColumn, writeMemory, type Db } from './db';
import { roleOfAgent } from './kinds';
import { choNameOf, hasOwnName } from './cho';
import { can, OWNER_ONLY, type Role } from './members';
import { signedUrlsFor } from './outputs';
import {
    CARD_STATUS_WORDS,
    isPreferenceField,
    mentioned,
    PREFERENCE_FIELDS,
    validCard,
    type Card,
    type MessageRole,
    type RoomMessage,
} from './room-cards';
import { accountLabel, getAccount, listAccounts, withDefaults, type AccountPreferences } from '@/lib/studio/accounts';
import { CEO_NAME, CHO_NAME } from '@/lib/pixel/cast/names';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

export interface Room {
    id: string;
    workspaceId: string;
    departmentId: string;
    accountId: string | null;
    title: string;
}

/** Who the people in a room are, for naming what they wrote. */
export interface People {
    /** What the CHO goes by. */
    cho: string;
    /** The workspace owner. A person's message by anyone else is a reviewer's. */
    ownerId: string | null;
    /** Display names for the other members, by user id. */
    names?: Record<string, string>;
}

const DEFAULT_PEOPLE: People = { cho: CHO_NAME, ownerId: null };

/**
 * Who is who, as the person signed in sees it. The owner's name rides on the
 * owner's own sign-in, so a reviewer sees them by the cast's name for the
 * role, and sees themselves by the name they gave.
 */
export function peopleFor(
    role: 'owner' | 'reviewer' | 'viewer',
    user: { id: string; user_metadata?: Record<string, unknown> | null },
    ownerId: string | null
): { people: People; me: string } {
    const me = role === 'owner' || hasOwnName(user) ? choNameOf(user) : 'A reviewer';
    const people: People = role === 'owner' ? { cho: me, ownerId } : { cho: CHO_NAME, ownerId, names: { [user.id]: me } };
    return { people, me };
}

/** What someone does in a room: talk, act on a card, or keep the decisions. */
export type RoomAct = 'post' | 'confirm' | 'decide';

/**
 * Who may do what in a room. Null when they may; otherwise the refusal to
 * give them. Posting is for the owner and reviewers; confirming a card and
 * keeping the decisions are the owner's alone. The database agrees: members
 * may add a message, and only the owner may change one or write a memory.
 */
export function refusal(role: Role, act: RoomAct): string | null {
    if (act === 'post') return can(role, 'post') ? null : 'A viewer reads the room; a reviewer or the owner can post in it.';
    return role === 'owner' ? null : OWNER_ONLY;
}

// ---------------------------------------------------------------------------
// Finding and reading rooms
// ---------------------------------------------------------------------------

/**
 * The room for a department, or for one of its channels. Created when it is
 * missing and `create` is set — the owner's session or the engine can; a
 * reviewer arriving first finds the one the migration made.
 *
 * Null when rooms are not available yet: migration 0012 has not been run.
 */
export async function roomFor(
    db: Db,
    workspaceId: string,
    departmentId: string,
    accountId: string | null,
    opts: { create?: boolean; title?: string } = {}
): Promise<Room | null> {
    let q = db
        .from('delphi_threads')
        .select('id, workspace_id, department_id, account_id, title')
        .eq('workspace_id', workspaceId)
        .eq('kind', 'room')
        .eq('department_id', departmentId);
    q = accountId ? q.eq('account_id', accountId) : q.is('account_id', null);
    const { data, error } = await q.limit(1).maybeSingle();
    if (error) {
        if (!isMissingColumn(error)) console.warn('[delphi] could not read the room:', error.message);
        return null;
    }
    if (data) return toRoom(data);
    if (!opts.create) return null;

    const { data: made, error: insertErr } = await db
        .from('delphi_threads')
        .insert({
            workspace_id: workspaceId,
            department_id: departmentId,
            account_id: accountId,
            kind: 'room',
            title: opts.title ?? 'Room',
            status: 'open',
        })
        .select('id, workspace_id, department_id, account_id, title')
        .single();
    if (insertErr || !made) {
        // Two first visits at once: the unique index let one through. Read it.
        if (insertErr && /duplicate key/i.test(insertErr.message ?? '')) return roomFor(db, workspaceId, departmentId, accountId);
        return null;
    }
    return toRoom(made);
}

function toRoom(r: Row): Room {
    return {
        id: r.id,
        workspaceId: r.workspace_id,
        departmentId: r.department_id,
        accountId: r.account_id ?? null,
        title: r.title,
    };
}

export async function getRoom(db: Db, roomId: string): Promise<Room | null> {
    const { data, error } = await db
        .from('delphi_threads')
        .select('id, workspace_id, department_id, account_id, title, kind')
        .eq('id', roomId)
        .maybeSingle();
    if (error || !data || data.kind !== 'room' || !data.department_id) return null;
    return toRoom(data);
}

/** The last `limit` messages, oldest first, with who wrote each. */
export async function loadRoom(db: Db, roomId: string, people: People = DEFAULT_PEOPLE, limit = 60): Promise<RoomMessage[]> {
    const { data } = await db
        .from('delphi_messages')
        .select('*, author:delphi_agents(name, slug, avatar_seed)')
        .eq('thread_id', roomId)
        .order('created_at', { ascending: false })
        .limit(limit);
    return ((data ?? []) as Row[]).reverse().map((m) => toMessage(m, people));
}

const ROLES: MessageRole[] = ['cho', 'ceo', 'worker', 'system', 'reviewer'];

function toMessage(m: Row, people: People): RoomMessage {
    const author = m.author as { name?: string; slug?: string; avatar_seed?: string | null } | null;
    const role = (ROLES.includes(m.role) ? m.role : 'system') as MessageRole;
    const userId = (m.author_user_id as string | null) ?? null;
    // A person's message is the CHO's when the owner wrote it; anyone else
    // in the workspace who can post is a reviewer, and is named as one.
    const byOwner = Boolean(userId) && (!people.ownerId || userId === people.ownerId);
    const authorName = userId
        ? byOwner
            ? people.cho
            : people.names?.[userId] ?? 'A reviewer'
        : author?.name ?? (role === 'ceo' ? CEO_NAME : 'The team');
    return {
        id: m.id,
        role,
        authorName,
        authorSlug: author?.slug ?? null,
        avatarSeed: author?.avatar_seed ?? null,
        authorUserId: userId,
        byOwner,
        content: String(m.content ?? ''),
        card: validCard(m.card),
        artifactIds: Array.isArray(m.artifact_ids) ? m.artifact_ids : [],
        createdAt: m.created_at,
    };
}

// ---------------------------------------------------------------------------
// What a room shows: its messages, and the work they carry
// ---------------------------------------------------------------------------

export interface WorkPreview {
    id: string;
    title: string;
    kind: string;
    reviewStatus: 'pending' | 'approved' | 'declined' | 'superseded';
    /** A video's thumbnail, or the image itself. */
    picture: string | null;
    /** The video, for playing in place. */
    video: string | null;
    trashed: boolean;
}

export interface RoomView {
    messages: RoomMessage[];
    /** The work the messages carry or name, keyed by id — this room's only. */
    work: Record<string, WorkPreview>;
}

/**
 * A room as the panel shows it. Work a message names is looked up within the
 * room's own scope, so a card or a post pointing elsewhere shows nothing.
 */
export async function roomView(db: Db, room: Room, people: People = DEFAULT_PEOPLE, limit = 60): Promise<RoomView> {
    const messages = await loadRoom(db, room.id, people, limit);
    const ids = new Set<string>();
    for (const m of messages) {
        for (const id of m.artifactIds) ids.add(id);
        if (m.card?.type === 'send_back' && typeof m.card.args.artifactId === 'string') ids.add(m.card.args.artifactId);
    }
    if (ids.size === 0) return { messages, work: {} };

    const rows = await scoped(db, room, 'id, title, kind, review_status, storage_path, data, account_id', (q) => q.in('id', [...ids]));
    const pictureOf = (r: Row): string | null => {
        const studio = (r.data ?? {}).studio;
        if (studio?.kind === 'video' && typeof studio.files?.thumbnail?.path === 'string') return studio.files.thumbnail.path;
        return r.kind === 'image' && r.storage_path ? r.storage_path : null;
    };
    const paths = rows.flatMap((r) => [pictureOf(r), r.kind === 'video' ? r.storage_path : null]).filter((p): p is string => Boolean(p));
    const urls = await signedUrlsFor(db, paths);

    const work: Record<string, WorkPreview> = {};
    for (const r of rows) {
        const picture = pictureOf(r);
        work[r.id] = {
            id: r.id,
            title: String(r.title),
            kind: String(r.kind),
            reviewStatus: (['approved', 'declined', 'superseded'].includes(r.review_status) ? r.review_status : 'pending') as WorkPreview['reviewStatus'],
            picture: picture ? urls.get(picture) ?? null : null,
            video: r.kind === 'video' && r.storage_path ? urls.get(r.storage_path) ?? null : null,
            trashed: Boolean(r.deleted_at),
        };
    }
    return { messages, work };
}

/**
 * Artifacts within a room's scope: its department's, and for a channel's room
 * only that channel's. `deleted_at` is read when the database has it.
 */
async function scoped(
    db: Db,
    room: Room,
    columns: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    narrow: (q: any) => any,
    limit = 200
): Promise<Row[]> {
    const run = (withTrash: boolean) => {
        let q = db
            .from('delphi_artifacts')
            .select(`${columns}${withTrash ? ', deleted_at' : ''}, project:delphi_projects!inner(department_id)`)
            .eq('workspace_id', room.workspaceId)
            .eq('project.department_id', room.departmentId);
        if (room.accountId) q = q.eq('account_id', room.accountId);
        return narrow(q).order('created_at', { ascending: false }).limit(limit);
    };
    let { data, error } = await run(true);
    if (error && isMissingColumn(error)) ({ data, error } = await run(false));
    if (error) return [];
    return ((data ?? []) as Row[]).filter(
        (r) => r.project?.department_id === room.departmentId && (!room.accountId || r.account_id === room.accountId)
    );
}

// ---------------------------------------------------------------------------
// Who answers
// ---------------------------------------------------------------------------

export interface TeamMember {
    id: string;
    slug: string;
    name: string;
    title: string;
    avatarSeed: string | null;
    systemPrompt: string;
}

/** The department's team: the agents hired into it, the CEO aside. */
export async function teamOf(db: Db, departmentId: string): Promise<TeamMember[]> {
    const { data } = await db
        .from('delphi_hires')
        .select('agent:delphi_agents(id, slug, name, title, avatar_seed, system_prompt)')
        .eq('department_id', departmentId);
    const seen = new Set<string>();
    const out: TeamMember[] = [];
    for (const h of (data ?? []) as Row[]) {
        const a = h.agent as Row | null;
        if (!a || seen.has(a.id) || a.slug === DELPHI_SLUG) continue;
        seen.add(a.id);
        out.push({ id: a.id, slug: a.slug, name: a.name, title: a.title, avatarSeed: a.avatar_seed ?? null, systemPrompt: a.system_prompt ?? '' });
    }
    return out;
}

// ---------------------------------------------------------------------------
// The conversation
// ---------------------------------------------------------------------------

/** One model turn with tools: the seam the tests replace. */
export type Converse = (input: {
    system: string;
    prompt: string;
    tools: FunctionDeclaration[];
    execute: (name: string, args: Record<string, unknown>) => Promise<{ content: string }>;
    model: string;
}) => Promise<{ reply: string; costUsd: number; model: string }>;

const REPLY_SCHEMA: Schema = {
    type: Type.OBJECT,
    properties: {
        reply: {
            type: Type.STRING,
            description: 'Your answer in this room. Plain prose, no markdown headings. Brief: this is a conversation.',
        },
    },
    required: ['reply'],
};

export const liveConverse: Converse = async ({ system, prompt, tools, execute, model }) => {
    const result = await generateWithTools<{ reply: string }>(
        prompt,
        tools,
        execute,
        REPLY_SCHEMA,
        (value) => {
            const v = value as { reply?: unknown };
            if (typeof v?.reply !== 'string' || !v.reply.trim()) throw new Error('No reply.');
            return { reply: v.reply.trim() };
        },
        { system, model, temperature: 0.6, maxToolTurns: 5 }
    );
    return { reply: result.data.reply, costUsd: result.costUsd, model: result.model };
};

export const READ_TOOLS: FunctionDeclaration[] = [
    {
        name: 'list_work',
        description: "This room's deliverables, newest first: what was made for this department (or this channel), by whom, and where it stands with the CHO.",
        parameters: { type: Type.OBJECT, properties: { limit: { type: Type.NUMBER } } },
    },
    {
        name: 'read_work',
        description: 'The full text of one deliverable from this room, by its title or a fragment of it.',
        parameters: { type: Type.OBJECT, properties: { title: { type: Type.STRING } }, required: ['title'] },
    },
];

export const CARD_TOOLS: FunctionDeclaration[] = [
    {
        name: 'propose_send_back',
        description: "Propose sending one of this room's deliverables back to be redone, with the note its agent will work from. The CHO confirms; nothing happens until then.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                title: { type: Type.STRING, description: 'The deliverable, by its title or a fragment.' },
                note: { type: Type.STRING, description: "What must change, specifically, in the CHO's words." },
            },
            required: ['title', 'note'],
        },
    },
    {
        name: 'propose_decision',
        description: 'Propose recording a decision the CHO has made, so every future piece of work in this room follows it. Use it when the CHO says to remember something, or settles how things are done here.',
        parameters: {
            type: Type.OBJECT,
            properties: { text: { type: Type.STRING, description: 'The decision, as one plain sentence.' } },
            required: ['text'],
        },
    },
];

export const CHANNEL_CARD_TOOLS: FunctionDeclaration[] = [
    {
        name: 'propose_setting',
        description: `Propose changing one of this channel's settings. Fields: ${PREFERENCE_FIELDS.join(', ')}. Lists (pillars, avoid, hashtags, formats) take every item; schedule takes {"days":[1..7],"time":"HH:MM"} with 1 for Monday, or null; durationSec takes {"min":n,"max":n}; topics is "cho" or "team"; monthlyCapUsd is dollars or null.`,
        parameters: {
            type: Type.OBJECT,
            properties: {
                field: { type: Type.STRING },
                value: { type: Type.STRING, description: 'The new value, as JSON text for anything but a plain string.' },
                why: { type: Type.STRING },
            },
            required: ['field', 'value'],
        },
    },
    {
        name: 'propose_pause',
        description: 'Propose pausing this channel (nothing new is made for it) or resuming it.',
        parameters: {
            type: Type.OBJECT,
            properties: { pause: { type: Type.BOOLEAN } },
            required: ['pause'],
        },
    },
];

/** What this room's tools may read: its department's work, or only its channel's. */
async function workOf(db: Db, room: Room, limit: number): Promise<Row[]> {
    const rows = await scoped(
        db,
        room,
        'id, title, kind, created_at, review_status, account_id, task:delphi_tasks(agent:delphi_agents(name))',
        (q) => q,
        limit
    );
    return rows.filter((r) => !r.deleted_at);
}

/**
 * For a studio's own room: where each channel stands — its state, how much
 * it has made lately and its latest piece. Never what was said in its room.
 */
async function channelStandings(db: Db, room: Room): Promise<string | null> {
    if (room.accountId) return null;
    let accounts;
    try {
        accounts = await listAccounts(db, room.workspaceId, room.departmentId);
    } catch {
        return null;
    }
    if (!accounts.length) return null;
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const recent = await scoped(db, room, 'id, title, account_id, review_status, created_at', (q) => q.gte('created_at', since));
    const lines = accounts.map((a) => {
        const mine = recent.filter((r) => r.account_id === a.id && !r.deleted_at);
        const latest = mine[0];
        return `- ${accountLabel(a)}: ${a.status}; ${mine.length} piece${mine.length === 1 ? '' : 's'} in the last 30 days${
            latest ? `; latest "${latest.title}" (${latest.review_status ?? 'pending'})` : ''
        }`;
    });
    return ['--- THE CHANNELS (their standing only; each has its own room) ---', ...lines].join('\n');
}

export interface Speaker {
    userId: string;
    /** What they go by in this workspace. */
    name: string;
    /** The owner is the CHO. Anyone else posting is a reviewer. */
    isOwner: boolean;
}

export interface ReplyInput {
    room: Room;
    speaker: Speaker;
    message: string;
    people: People;
    converse?: Converse;
}

export interface ReplyResult {
    /** What was stored: the message, then the reply and any cards. */
    posted: RoomMessage[];
    costUsd: number;
    /** Set when the message was stored but no answer came. */
    error?: string;
}

/** The prompt and the instructions for one answer: separate, so the tests can read them. */
export async function roomPrompt(
    db: Db,
    input: { room: Room; speaker: Speaker; message: string; people: People; agent: TeamMember | null; history: RoomMessage[]; team: TeamMember[] }
): Promise<{ system: string; prompt: string } | null> {
    const { room, speaker, people, agent, team } = input;
    const compartment: Compartment = { workspaceId: room.workspaceId, departmentId: room.departmentId, accountId: room.accountId };
    const ctx = await contextFor(db, compartment, { role: agent ? roleOfAgent(agent) : null });
    if (!ctx) return null;
    const where = ctx.account ? `the room for ${accountLabel(ctx.account)}, a channel of ${ctx.department.name}` : `the room for ${ctx.department.name}`;

    const label = (m: RoomMessage) =>
        m.authorUserId ? (m.byOwner ? `${people.cho} (the CHO)` : `${m.authorName} (a reviewer)`) : m.authorName;
    const transcript = input.history
        .slice(-12)
        .map((m) =>
            m.card
                ? `[${CEO_NAME} proposed: ${m.card.title} — ${CARD_STATUS_WORDS[m.card.status].toLowerCase()}]`
                : `${label(m)}: ${m.content}${m.artifactIds.length ? ' [work attached]' : ''}`
        )
        .join('\n');
    const who = speaker.isOwner ? `${people.cho} (the CHO)` : `${speaker.name} (a reviewer)`;
    const standings = await channelStandings(db, room);

    const prompt = [
        renderContext(ctx),
        ...(standings ? ['', standings] : []),
        '',
        `--- ${where.toUpperCase()} ---`,
        transcript || '(The conversation starts here.)',
        '',
        `${who}: ${input.message}`,
    ].join('\n');

    const speaking = speaker.isOwner
        ? `${people.cho}, the CHO, is speaking.`
        : `${speaker.name}, a reviewer, is speaking — not the CHO. Reviewers discuss and suggest; only ${people.cho}, the CHO, confirms a change.`;

    const system = agent
        ? [
              agent.systemPrompt,
              '',
              `You are ${agent.name}, answering in ${where}. ${speaking} Speak as yourself, in your role, briefly.`,
              `You can read this room's work. You cannot change anything: if something should change, say so and suggest asking ${CEO_NAME}.`,
              'Everything you know about this department and channel is above. Do not bring in anything from elsewhere.',
          ].join('\n')
        : [
              DELPHI_SYSTEM_PROMPT,
              '',
              persona(people.cho),
              '',
              `You are in ${where}, with the team. ${speaking}`,
              "Keep to this room's work: everything you know about it is above, and nothing from any other department or channel belongs here.",
              'Reading and discussing are free. To change anything, use a propose_ tool: it posts a card that does nothing until the CHO confirms it. Never say a change is made until it is confirmed.',
              `The team here: ${team.map((t) => `${t.name} (${t.title})`).join(', ') || 'not staffed yet'}. Anyone can ask one of them directly with @name.`,
          ].join('\n');

    return { system, prompt };
}

/**
 * Post a message and answer it: Diablo, or the team member named. The
 * message is stored before the answer is attempted, so a failed answer does
 * not lose what was said; the failure comes back in `error`.
 */
export async function replyInRoom(db: Db, input: ReplyInput): Promise<ReplyResult> {
    const { room, speaker, people } = input;
    const converse = input.converse ?? liveConverse;
    const text = input.message.trim().slice(0, 4000);
    if (!text) throw new Error('Write something first.');

    const [team, ceo, history] = await Promise.all([
        teamOf(db, room.departmentId),
        db.from('delphi_agents').select('id').eq('workspace_id', room.workspaceId).eq('slug', DELPHI_SLUG).maybeSingle(),
        loadRoom(db, room.id, people, 16),
    ]);
    const ceoId = (ceo.data?.id as string | undefined) ?? null;

    const posted: RoomMessage[] = [];
    const mine = await insertMessage(db, room, { role: 'cho', authorUserId: speaker.userId, content: text }, people);
    if (!mine) throw new Error('Your message could not be posted.');
    posted.push(mine);

    const who = mentioned(text, team);
    const agent = who >= 0 ? team[who] : null;

    try {
        const built = await roomPrompt(db, { room, speaker, message: text, people, agent, history, team });
        if (!built) throw new Error("This room's department is not here.");

        const cards: Card[] = [];
        const tools = agent ? READ_TOOLS : [...READ_TOOLS, ...CARD_TOOLS, ...(room.accountId ? CHANNEL_CARD_TOOLS : [])];
        const execute = (name: string, args: Record<string, unknown>) =>
            runRoomTool(db, room, name, args, cards, { canPropose: !agent });

        const out = await converse({ system: built.system, prompt: built.prompt, tools, execute, model: DEFAULT_MODEL });

        const reply = agent
            ? await insertMessage(db, room, { role: 'worker', authorAgentId: agent.id, content: out.reply }, people)
            : await insertMessage(db, room, { role: 'ceo', authorAgentId: ceoId, content: out.reply }, people);
        if (reply) posted.push(reply);
        // Only Diablo proposes, and only as Diablo: a card with no CEO to sign it is not posted.
        for (const card of cards) {
            const m = await insertMessage(db, room, { role: 'ceo', authorAgentId: ceoId, content: card.title, card }, people);
            if (m) posted.push(m);
        }
        return { posted, costUsd: out.costUsd };
    } catch (err) {
        return { posted, costUsd: 0, error: (err as Error).message };
    }
}

export async function runRoomTool(
    db: Db,
    room: Room,
    name: string,
    args: Record<string, unknown>,
    cards: Card[],
    opts: { canPropose: boolean } = { canPropose: true }
): Promise<{ content: string }> {
    if (name.startsWith('propose_') && !opts.canPropose) return { content: `Only ${CEO_NAME} proposes changes here.` };
    switch (name) {
        case 'list_work': {
            const rows = await workOf(db, room, Math.min(Number(args.limit ?? 10) || 10, 25));
            if (!rows.length) return { content: 'Nothing has been made in this room yet.' };
            return {
                content: JSON.stringify(
                    rows.map((r) => ({
                        title: r.title,
                        kind: r.kind,
                        by: r.task?.agent?.name ?? 'unknown',
                        at: r.created_at,
                        cho: r.review_status ?? 'pending',
                    }))
                ),
            };
        }
        case 'read_work': {
            const found = await findWork(db, room, String(args.title ?? ''));
            if (!found) return { content: `Nothing in this room matches "${String(args.title ?? '')}".` };
            const { data } = await db.from('delphi_artifacts').select('content_md').eq('id', found.id).maybeSingle();
            return { content: `${found.title}\n\n${String(data?.content_md ?? '').slice(0, 8000)}` };
        }
        case 'propose_send_back': {
            const found = await findWork(db, room, String(args.title ?? ''));
            const note = String(args.note ?? '').trim().slice(0, 1000);
            if (!found) return { content: `Nothing in this room matches "${String(args.title ?? '')}". No card was posted.` };
            if (note.length < 10) return { content: 'A send-back needs a note the agent can act on — what must change. No card was posted.' };
            cards.push({ type: 'send_back', title: `Send "${found.title}" back: ${note}`, args: { artifactId: found.id, note }, status: 'pending' });
            return { content: 'Card posted. It does nothing until the CHO confirms it.' };
        }
        case 'propose_decision': {
            const text = String(args.text ?? '').trim().slice(0, 500);
            if (text.length < 5) return { content: 'A decision needs a sentence. No card was posted.' };
            cards.push({ type: 'decision', title: `Remember for this ${room.accountId ? 'channel' : 'department'}: ${text}`, args: { text }, status: 'pending' });
            return { content: 'Card posted. It is recorded only when the CHO confirms it.' };
        }
        case 'propose_setting': {
            if (!room.accountId) return { content: 'Settings belong to a channel; this is the department room. No card was posted.' };
            const field = String(args.field ?? '');
            if (!isPreferenceField(field)) return { content: `"${field}" is not a channel setting a card can change. No card was posted.` };
            const value = parseValue(args.value);
            cards.push({
                type: 'set_preference',
                title: `Set this channel's ${field} to ${typeof value === 'string' ? value : JSON.stringify(value)}${args.why ? ` — ${String(args.why)}` : ''}`,
                args: { field, value },
                status: 'pending',
            });
            return { content: 'Card posted. The setting changes only when the CHO confirms it.' };
        }
        case 'propose_pause': {
            if (!room.accountId) return { content: 'Only a channel can be paused from its room. No card was posted.' };
            const pause = Boolean(args.pause);
            cards.push({ type: pause ? 'pause_account' : 'resume_account', title: pause ? 'Pause this channel: nothing new is made for it' : 'Resume this channel', args: {}, status: 'pending' });
            return { content: 'Card posted. It takes effect only when the CHO confirms it.' };
        }
        default:
            return { content: `No such capability: ${name}.` };
    }
}

function parseValue(raw: unknown): unknown {
    if (typeof raw !== 'string') return raw;
    const t = raw.trim();
    if (/^[[{]/.test(t) || t === 'true' || t === 'false' || t === 'null' || /^-?\d+(\.\d+)?$/.test(t)) {
        try {
            return JSON.parse(t);
        } catch {
            return t;
        }
    }
    return t;
}

async function findWork(db: Db, room: Room, title: string): Promise<Row | null> {
    const needle = title.trim().toLowerCase();
    if (!needle) return null;
    const rows = await workOf(db, room, 50);
    return rows.find((r) => String(r.title).toLowerCase() === needle) ?? rows.find((r) => String(r.title).toLowerCase().includes(needle)) ?? null;
}

async function insertMessage(
    db: Db,
    room: Room,
    m: { role: MessageRole; authorUserId?: string; authorAgentId?: string | null; content: string; card?: Card; artifactIds?: string[] },
    people: People = DEFAULT_PEOPLE
): Promise<RoomMessage | null> {
    // Every message has exactly one author. A reply with no CEO row to sign it
    // cannot be stored, so it is not pretended to be.
    if (!m.authorUserId && !m.authorAgentId) return null;
    const { data, error } = await db
        .from('delphi_messages')
        .insert({
            workspace_id: room.workspaceId,
            thread_id: room.id,
            author_user_id: m.authorUserId ?? null,
            author_agent_id: m.authorUserId ? null : m.authorAgentId,
            role: m.role,
            content: m.content.slice(0, 8000),
            round: 99,
            ...(m.card ? { card: m.card } : {}),
            ...(m.artifactIds?.length ? { artifact_ids: m.artifactIds } : {}),
        })
        .select('*, author:delphi_agents(name, slug, avatar_seed)')
        .single();
    if (error || !data) {
        console.warn('[delphi] could not post into the room:', error?.message);
        return null;
    }
    return toMessage(data as Row, people);
}

// ---------------------------------------------------------------------------
// Cards: nothing happens until the owner confirms
// ---------------------------------------------------------------------------

export interface CardOutcome {
    ok: boolean;
    error?: string;
    result?: string;
}

/** What a confirmed card does. Injected so the tests can see it was (or was not) called. */
export interface CardEffects {
    sendBack: (artifactId: string, note: string) => Promise<{ ok: boolean; error?: string }>;
}

/** A card, read back with its room — only if it is a pending card Diablo posted, in this workspace. */
async function pendingCard(db: Db, workspaceId: string, messageId: string): Promise<{ card: Card; room: Room } | { error: string }> {
    const { data: msg } = await db.from('delphi_messages').select('*').eq('id', messageId).eq('workspace_id', workspaceId).maybeSingle();
    if (!msg) return { error: 'That card is not here.' };
    const card = validCard(msg.card);
    // A card is Diablo's proposal. One under anyone else's name is not acted on.
    if (!card || msg.role !== 'ceo' || !msg.author_agent_id) return { error: 'That message has no card.' };
    if (card.status !== 'pending') return { error: `That card was already ${card.status}.` };
    const room = await getRoom(db, msg.thread_id as string);
    if (!room || room.workspaceId !== workspaceId) return { error: "That card's room is not here." };
    return { card, room };
}

/**
 * Carry out a card. The caller has already established that this is the
 * owner; this re-checks that the card is pending, that Diablo posted it, that
 * it belongs to this workspace, and that what it acts on belongs to its room.
 */
export async function confirmCard(db: Db, workspaceId: string, messageId: string, effects: CardEffects, actor: string = CHO_NAME): Promise<CardOutcome> {
    const found = await pendingCard(db, workspaceId, messageId);
    if ('error' in found) return { ok: false, error: found.error };
    const { card, room } = found;

    let outcome: CardOutcome;
    try {
        outcome = await applyCard(db, room, card, effects);
    } catch (err) {
        outcome = { ok: false, error: (err as Error).message };
    }

    const settled: Card = {
        ...card,
        status: outcome.ok ? 'done' : 'failed',
        result: outcome.ok ? outcome.result : outcome.error,
        decidedAt: new Date().toISOString(),
    };
    await db.from('delphi_messages').update({ card: settled }).eq('id', messageId).eq('workspace_id', workspaceId);
    if (outcome.ok) {
        await emitEvent(db, {
            workspaceId,
            departmentId: room.departmentId,
            type: 'card_confirmed',
            actor,
            verb: 'confirmed',
            object: card.title.slice(0, 160),
        });
    }
    return outcome;
}

async function applyCard(db: Db, room: Room, card: Card, effects: CardEffects): Promise<CardOutcome> {
    switch (card.type) {
        case 'send_back': {
            const artifactId = String(card.args.artifactId ?? '');
            const note = String(card.args.note ?? '');
            // It must still be this room's work.
            const work = await workOf(db, room, 200);
            if (!work.some((w) => w.id === artifactId)) return { ok: false, error: "That deliverable is not this room's." };
            const r = await effects.sendBack(artifactId, note);
            return r.ok ? { ok: true, result: 'Sent back. The agent redoes it with your note.' } : { ok: false, error: r.error ?? 'Could not send it back.' };
        }
        case 'decision': {
            const text = String(card.args.text ?? '').trim().slice(0, 500);
            if (!text) return { ok: false, error: 'The decision is empty.' };
            await recordDecision(db, room, text);
            return { ok: true, result: 'Recorded. Every future piece of work here follows it.' };
        }
        case 'set_preference':
        case 'pause_account':
        case 'resume_account': {
            if (!room.accountId) return { ok: false, error: 'Only a channel has settings.' };
            const account = await getAccount(db, room.accountId);
            if (!account || account.departmentId !== room.departmentId || account.workspaceId !== room.workspaceId) {
                return { ok: false, error: "That channel is not this room's." };
            }
            if (card.type === 'set_preference') {
                const field = String(card.args.field ?? '');
                if (!isPreferenceField(field)) return { ok: false, error: `"${field}" is not a channel setting a card can change.` };
                const next: AccountPreferences = withDefaults({ [field]: card.args.value }, account.preferences);
                if (JSON.stringify(next[field]) === JSON.stringify(account.preferences[field])) {
                    return { ok: false, error: `Nothing changed: the ${field} is already that, or that is not a value it takes.` };
                }
                const { error } = await db
                    .from('delphi_media_accounts')
                    .update({ preferences: next, updated_at: new Date().toISOString() })
                    .eq('id', account.id)
                    .eq('workspace_id', room.workspaceId);
                if (error) return { ok: false, error: error.message };
                return { ok: true, result: `Changed: ${field}.` };
            }
            const status = card.type === 'pause_account' ? 'paused' : 'active';
            const { error } = await db
                .from('delphi_media_accounts')
                .update({ status, updated_at: new Date().toISOString() })
                .eq('id', account.id)
                .eq('workspace_id', room.workspaceId);
            if (error) return { ok: false, error: error.message };
            return { ok: true, result: status === 'paused' ? 'Paused.' : 'Resumed.' };
        }
    }
}

export async function dismissCard(db: Db, workspaceId: string, messageId: string): Promise<CardOutcome> {
    const found = await pendingCard(db, workspaceId, messageId);
    if ('error' in found) return { ok: false, error: found.error };
    const { error } = await db
        .from('delphi_messages')
        .update({ card: { ...found.card, status: 'dismissed', decidedAt: new Date().toISOString() } })
        .eq('id', messageId)
        .eq('workspace_id', workspaceId);
    return error ? { ok: false, error: error.message } : { ok: true };
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

export interface Decision {
    id: string;
    text: string;
    createdAt: string;
}

/** A decision filed to the room's compartment: its channel, or its department. */
export async function recordDecision(db: Db, room: Room, text: string): Promise<void> {
    await writeMemory(db, room.workspaceId, {
        scope: room.accountId ? 'account' : 'department',
        kind: 'decision',
        title: text.slice(0, 200),
        body: text,
        importance: 5,
        departmentId: room.departmentId,
        accountId: room.accountId,
    });
}

export async function listDecisions(db: Db, workspaceId: string, departmentId: string, accountId: string | null): Promise<Decision[]> {
    let q = db
        .from('delphi_memories')
        .select('id, title, body, created_at')
        .eq('workspace_id', workspaceId)
        .eq('department_id', departmentId)
        .eq('kind', 'decision');
    q = accountId ? q.eq('account_id', accountId) : q.is('account_id', null);
    const { data, error } = await q.order('created_at', { ascending: false }).limit(50);
    if (error) return [];
    return ((data ?? []) as Row[]).map((d) => ({ id: d.id, text: String(d.body || d.title), createdAt: d.created_at }));
}

/** Change a decision's words. Only a decision; only in this workspace. */
export async function updateDecision(db: Db, workspaceId: string, id: string, text: string): Promise<CardOutcome> {
    const t = text.trim().slice(0, 500);
    if (t.length < 5) return { ok: false, error: 'A decision needs a sentence.' };
    const { data, error } = await db
        .from('delphi_memories')
        .update({ title: t.slice(0, 200), body: t })
        .eq('id', id)
        .eq('workspace_id', workspaceId)
        .eq('kind', 'decision')
        .select('id');
    if (error) return { ok: false, error: error.message };
    return (data ?? []).length ? { ok: true } : { ok: false, error: 'That decision is not here.' };
}

export async function deleteDecision(db: Db, workspaceId: string, id: string): Promise<CardOutcome> {
    const { data, error } = await db
        .from('delphi_memories')
        .delete()
        .eq('id', id)
        .eq('workspace_id', workspaceId)
        .eq('kind', 'decision')
        .select('id');
    if (error) return { ok: false, error: error.message };
    return (data ?? []).length ? { ok: true } : { ok: false, error: 'That decision is not here.' };
}

// ---------------------------------------------------------------------------
// Work announcing itself
// ---------------------------------------------------------------------------

/**
 * New work posts itself into its room: the channel's, for a channel's piece;
 * the department's otherwise. Never throws — a room that cannot be written to
 * must not cost a finished task its result.
 */
export async function postWorkToRoom(
    db: Db,
    input: { workspaceId: string; departmentId: string; accountId: string | null; agentId: string; artifactId: string; text: string }
): Promise<void> {
    try {
        const room = await roomFor(db, input.workspaceId, input.departmentId, input.accountId, { create: true, title: 'Room' });
        if (!room) return;
        await insertMessage(db, room, { role: 'worker', authorAgentId: input.agentId, content: input.text, artifactIds: [input.artifactId] });
    } catch (err) {
        console.warn('[delphi] could not post the work into its room:', (err as Error).message);
    }
}

export { accountLabel };
export { mentioned };
export type { Compartment, Card, RoomMessage };
