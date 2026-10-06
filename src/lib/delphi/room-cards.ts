/**
 * Action cards and room messages: the shapes a room shows, shared by the
 * server and the browser. Nothing here touches the database or a model.
 *
 * A card is described from what it would do — its arguments — and never from
 * the line stored beside it. What the owner reads before tapping Confirm is
 * therefore exactly what confirming does, whoever wrote the message.
 */

import { scheduleWords, type DeliverySchedule } from './kinds/settings';

export type CardType =
    | 'send_back'
    | 'set_preference'
    | 'pause_account'
    | 'resume_account'
    | 'decision'
    | 'add_idea'
    | 'approve_idea'
    | 'start_episode';

export const CARD_TYPES: readonly CardType[] = [
    'send_back',
    'set_preference',
    'pause_account',
    'resume_account',
    'decision',
    'add_idea',
    'approve_idea',
    'start_episode',
];

export type CardStatus = 'pending' | 'done' | 'dismissed' | 'failed';

export interface Card {
    type: CardType;
    /** A line for the transcript and the activity log. Not what the panel shows. */
    title: string;
    args: Record<string, unknown>;
    status: CardStatus;
    /** What confirming did, or why it could not. */
    result?: string;
    decidedAt?: string;
}

export type MessageRole = 'cho' | 'ceo' | 'worker' | 'system' | 'reviewer';

export interface RoomMessage {
    id: string;
    role: MessageRole;
    authorName: string;
    authorSlug: string | null;
    avatarSeed: string | null;
    /** Set for a person's message; null for an agent's. */
    authorUserId: string | null;
    /** True when the person who wrote it is the workspace owner, the CHO. */
    byOwner: boolean;
    content: string;
    card: Card | null;
    artifactIds: string[];
    createdAt: string;
}

/** Settings a card may change on a channel. Everything else is set in its form. */
export const PREFERENCE_FIELDS = [
    'niche', 'audience', 'tone', 'language', 'cadence', 'pillars', 'avoid', 'hashtags', 'cta',
    'descriptionTemplate', 'voice', 'narration', 'captions', 'durationSec', 'formats', 'imageAspect',
    'schedule', 'topics', 'monthlyCapUsd', 'notes',
] as const;

export type PreferenceField = (typeof PREFERENCE_FIELDS)[number];

export function isPreferenceField(v: unknown): v is PreferenceField {
    return typeof v === 'string' && (PREFERENCE_FIELDS as readonly string[]).includes(v);
}

const FIELD_WORDS: Record<PreferenceField, string> = {
    niche: 'niche',
    audience: 'audience',
    tone: 'tone',
    language: 'language',
    cadence: 'cadence',
    pillars: 'content pillars',
    avoid: 'what to avoid',
    hashtags: 'hashtags',
    cta: 'call to action',
    descriptionTemplate: 'description template',
    voice: 'narration voice',
    narration: 'narration',
    captions: 'captions',
    durationSec: 'length',
    formats: 'formats',
    imageAspect: 'image shape',
    schedule: 'production schedule',
    topics: 'who picks topics',
    monthlyCapUsd: 'monthly cap',
    notes: 'notes',
};

export function fieldWords(field: string): string {
    return isPreferenceField(field) ? FIELD_WORDS[field] : field;
}

/** A setting's value in words: lists joined, a schedule spelled out, a cap in dollars. */
export function valueWords(field: string, value: unknown, timezone = 'UTC'): string {
    if (value === null || value === undefined || value === '') {
        return field === 'schedule' ? 'on demand' : field === 'monthlyCapUsd' ? 'no cap of its own' : 'nothing';
    }
    if (field === 'topics') return value === 'team' ? 'the team picks' : value === 'cho' ? 'the CHO approves each one' : String(value);
    if (field === 'monthlyCapUsd' && Number.isFinite(Number(value))) return `$${Number(value).toFixed(2)} a month`;
    if (field === 'durationSec' && typeof value === 'object') {
        const d = value as { min?: unknown; max?: unknown };
        return `${Number(d.min)}–${Number(d.max)} seconds`;
    }
    if (field === 'schedule' && typeof value === 'object') {
        const s = value as Partial<DeliverySchedule>;
        if (Array.isArray(s.days) && typeof s.time === 'string') return scheduleWords({ days: s.days.map(Number), time: s.time }, timezone);
    }
    if (typeof value === 'boolean') return value ? 'on' : 'off';
    if (Array.isArray(value)) return value.map(String).join(', ') || 'nothing';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
}

/** A stored card, checked; anything malformed is no card at all. */
export function validCard(raw: unknown): Card | null {
    if (!raw || typeof raw !== 'object') return null;
    const c = raw as Record<string, unknown>;
    if (!CARD_TYPES.includes(c.type as CardType) || typeof c.title !== 'string') return null;
    const status = (['pending', 'done', 'dismissed', 'failed'] as const).includes(c.status as CardStatus) ? (c.status as CardStatus) : 'pending';
    return {
        type: c.type as CardType,
        title: c.title,
        args: c.args && typeof c.args === 'object' && !Array.isArray(c.args) ? (c.args as Record<string, unknown>) : {},
        status,
        result: typeof c.result === 'string' ? c.result : undefined,
        decidedAt: typeof c.decidedAt === 'string' ? c.decidedAt : undefined,
    };
}

/**
 * What confirming a card would do, in words, from its arguments. `work` names
 * the deliverable a send-back is for, as the room knows it; without it the
 * card says so rather than trusting a title it was handed.
 */
export function describeCard(
    card: Card,
    opts: { workTitle?: string | null; ideaTitle?: string | null; timezone?: string } = {}
): { what: string; detail: string | null } {
    const a = card.args;
    switch (card.type) {
        case 'send_back':
            return {
                what: opts.workTitle ? `Send back “${opts.workTitle}”` : 'Send back a piece that is no longer in this room',
                detail: typeof a.note === 'string' ? a.note : null,
            };
        case 'decision':
            return { what: 'Remember this', detail: typeof a.text === 'string' ? a.text : null };
        case 'set_preference': {
            const field = String(a.field ?? '');
            return { what: `Change the ${fieldWords(field)}`, detail: `to ${valueWords(field, a.value, opts.timezone)}` };
        }
        case 'pause_account':
            return { what: 'Pause this channel', detail: 'Nothing new is made for it until it is resumed.' };
        case 'resume_account':
            return { what: 'Resume this channel', detail: null };
        case 'add_idea': {
            const title = typeof a.title === 'string' ? a.title : '';
            const angle = typeof a.angle === 'string' && a.angle ? ` — ${a.angle}` : '';
            return { what: 'Add a topic to the queue, approved', detail: `“${title}”${angle}` };
        }
        case 'approve_idea':
            return {
                what: opts.ideaTitle ? `Approve the topic “${opts.ideaTitle}”` : 'Approve a topic that is no longer in this channel',
                detail: 'It joins the queue and takes the next free slot.',
            };
        case 'start_episode':
            return {
                what: opts.ideaTitle ? `Make “${opts.ideaTitle}” now` : 'Make a topic that is no longer in this channel',
                detail: "Starts an episode now, outside the schedule. It spends from this month's budget.",
            };
    }
}

/**
 * Who a message is addressed to, by "@Name": the index of the first team
 * member named, matching a whole name or a first name. -1 means Diablo answers.
 */
export function mentioned(message: string, team: { name: string }[]): number {
    const names = [...message.matchAll(/@([\p{L}][\p{L}\p{N}_-]*)/gu)].map((m) => m[1].toLowerCase());
    for (const n of names) {
        const i = team.findIndex((t) => t.name.toLowerCase() === n || t.name.toLowerCase().split(/\s+/)[0] === n);
        if (i >= 0) return i;
    }
    return -1;
}

export const CARD_STATUS_WORDS: Record<CardStatus, string> = {
    pending: 'Waiting on you',
    done: 'Done',
    dismissed: 'Dismissed',
    failed: 'Could not be done',
};
