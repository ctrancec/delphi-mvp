/**
 * Media accounts — one YouTube channel or social page each.
 *
 * A department that produces video or posts needs to know *which* channel
 * or page a piece is for, because two channels are two audiences: different
 * niche, different tone, different length, different brand. So an account
 * carries the preferences that shape everything made for it, and the planner
 * and the studio both read them from here.
 *
 * An account may make several formats — an Instagram page posts reels and
 * carousels — and each production step makes exactly one of them.
 *
 * Preferences are stored loosely (jsonb) and shaped here: `withDefaults`
 * fills whatever a stored row lacks, so adding a preference never needs a
 * migration, and nothing downstream has to null-check a field.
 */

import type { Db } from '@/lib/delphi/db';

export type Platform =
    | 'youtube'
    | 'instagram'
    | 'tiktok'
    | 'facebook'
    | 'x'
    | 'linkedin'
    | 'threads'
    | 'other';

export const PLATFORMS: Platform[] = [
    'youtube', 'instagram', 'tiktok', 'facebook', 'x', 'linkedin', 'threads', 'other',
];

export const PLATFORM_LABEL: Record<Platform, string> = {
    youtube: 'YouTube',
    instagram: 'Instagram',
    tiktok: 'TikTok',
    facebook: 'Facebook',
    x: 'X',
    linkedin: 'LinkedIn',
    threads: 'Threads',
    other: 'Other',
};

/** Frame shape. The studio renders to exactly one of these. */
export type Aspect = '9:16' | '16:9' | '1:1' | '4:5';

export const ASPECTS: Aspect[] = ['9:16', '16:9', '1:1', '4:5'];

/**
 * What an account makes. Each production step makes exactly one of these.
 */
export type Format = 'short' | 'landscape' | 'post' | 'carousel';

export const FORMATS: Format[] = ['short', 'landscape', 'post', 'carousel'];

export const FORMAT_LABEL: Record<Format, string> = {
    short: 'Vertical short (9:16)',
    landscape: 'Horizontal video (16:9)',
    post: 'Image post',
    carousel: 'Image carousel',
};

/** A word or two, for chips and log lines. */
export const FORMAT_WORD: Record<Format, string> = {
    short: 'short',
    landscape: 'video',
    post: 'image post',
    carousel: 'carousel',
};

export type VideoFormat = 'short' | 'landscape';
export type ImageFormat = 'post' | 'carousel';

export function isFormat(v: unknown): v is Format {
    return typeof v === 'string' && (FORMATS as string[]).includes(v);
}

export function isVideoFormat(v: unknown): v is VideoFormat {
    return v === 'short' || v === 'landscape';
}

export function isImageFormat(v: unknown): v is ImageFormat {
    return v === 'post' || v === 'carousel';
}

/** The artifact kind a format produces. */
export function kindOfFormat(f: Format): 'video' | 'image' {
    return isVideoFormat(f) ? 'video' : 'image';
}

/** Who on the roster plans each format. */
export function producerFor(f: Format): 'video-editor' | 'motion-designer' {
    return isVideoFormat(f) ? 'video-editor' : 'motion-designer';
}

/** Full HD renders about twice as slowly as HD. */
export type Quality = 'hd' | 'fhd';

/**
 * Gemini's prebuilt narration voices, a readable subset with a word on each.
 * Names are the API's own; the descriptions are Google's characterisations.
 */
export const VOICES: { name: string; note: string }[] = [
    { name: 'Kore', note: 'firm, clear' },
    { name: 'Charon', note: 'informative, even' },
    { name: 'Puck', note: 'upbeat' },
    { name: 'Zephyr', note: 'bright' },
    { name: 'Aoede', note: 'breezy' },
    { name: 'Leda', note: 'youthful' },
    { name: 'Orus', note: 'firm, deeper' },
    { name: 'Fenrir', note: 'excitable' },
    { name: 'Enceladus', note: 'breathy, soft' },
    { name: 'Iapetus', note: 'clear, measured' },
];

export interface Brand {
    /** Hex colours, e.g. #1a2340. Used for generated backgrounds and caption boxes. */
    primary: string;
    accent: string;
    /** Shown small in a corner of every frame. Defaults to the handle. */
    watermark: string;
}

export interface AccountPreferences {
    /** The subject the account is about, in one line. */
    niche: string;
    /** Who watches, and what they want from it. */
    audience: string;
    /** How it should sound. */
    tone: string;
    language: string;
    /** What this account makes. Never empty. */
    formats: Format[];
    /** The shape of image posts and carousels. Videos take their format's shape. */
    imageAspect: Aspect;
    /** Target length of a video, in seconds. */
    durationSec: { min: number; max: number };
    /** How often this account expects new work, in words. */
    cadence: string;
    /** Recurring themes the content rotates through. */
    pillars: string[];
    /** Things never to do or say on this account. */
    avoid: string[];
    /** Appended to every description or caption. */
    hashtags: string[];
    /** The closing line, e.g. "Subscribe for a new one every Tuesday". */
    cta: string;
    /** Appended to every description — links, disclaimers, credits. */
    descriptionTemplate: string;
    /** Narration voice, one of VOICES. */
    voice: string;
    /** Narrate videos with text-to-speech. Off makes a silent, captioned video. */
    narration: boolean;
    /** Burn captions into the frame. The .srt is produced either way. */
    captions: boolean;
    quality: Quality;
    brand: Brand;
    /** Anything else the agents should know. */
    notes: string;
}

export const DEFAULT_PREFERENCES: AccountPreferences = {
    niche: '',
    audience: '',
    tone: 'plain-spoken and warm; no hype, no clickbait',
    language: 'English',
    formats: ['short'],
    imageAspect: '4:5',
    durationSec: { min: 30, max: 60 },
    cadence: '',
    pillars: [],
    avoid: [],
    hashtags: [],
    cta: '',
    descriptionTemplate: '',
    voice: 'Kore',
    narration: true,
    captions: true,
    quality: 'fhd',
    brand: { primary: '#1a2340', accent: '#d98f3c', watermark: '' },
    notes: '',
};

/** What a platform usually wants, applied when an account is created. */
export function platformDefaults(platform: Platform): Partial<AccountPreferences> {
    switch (platform) {
        case 'youtube':
            return { formats: ['short'], imageAspect: '16:9', durationSec: { min: 30, max: 60 } };
        case 'tiktok':
            return { formats: ['short'], imageAspect: '9:16', durationSec: { min: 15, max: 45 } };
        case 'instagram':
            return { formats: ['short', 'carousel'], imageAspect: '4:5', durationSec: { min: 15, max: 60 } };
        case 'facebook':
            return { formats: ['short', 'post'], imageAspect: '4:5', durationSec: { min: 20, max: 60 } };
        case 'x':
            return { formats: ['post'], imageAspect: '16:9', durationSec: { min: 15, max: 45 } };
        case 'linkedin':
            return { formats: ['post', 'carousel'], imageAspect: '4:5', durationSec: { min: 30, max: 90 } };
        case 'threads':
            return { formats: ['post'], imageAspect: '4:5', durationSec: { min: 15, max: 45 } };
        default:
            return {};
    }
}

const HEX = /^#[0-9a-f]{6}$/i;

function str(v: unknown, fallback: string, max = 2000): string {
    return typeof v === 'string' ? v.trim().slice(0, max) : fallback;
}

function list(v: unknown, max = 30): string[] {
    const items = Array.isArray(v)
        ? v
        : typeof v === 'string'
          ? v.split(/[,\n]/)
          : [];
    const out: string[] = [];
    for (const raw of items) {
        const s = String(raw).trim().slice(0, 120);
        if (s && !out.includes(s)) out.push(s);
        if (out.length >= max) break;
    }
    return out;
}

/** Known formats, in their canonical order, deduplicated; never empty. */
function formatList(v: unknown, fallback: Format[]): Format[] {
    if (!Array.isArray(v)) return fallback;
    const out = FORMATS.filter((f) => v.includes(f));
    return out.length ? out : fallback;
}

function hex(v: unknown, fallback: string): string {
    return typeof v === 'string' && HEX.test(v.trim()) ? v.trim().toLowerCase() : fallback;
}

/** Shape whatever is stored into complete preferences. Never throws. */
export function withDefaults(raw: unknown, base: AccountPreferences = DEFAULT_PREFERENCES): AccountPreferences {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const d = (r.durationSec && typeof r.durationSec === 'object' ? r.durationSec : {}) as Record<string, unknown>;
    const b = (r.brand && typeof r.brand === 'object' ? r.brand : {}) as Record<string, unknown>;

    let min = Number(d.min);
    let max = Number(d.max);
    if (!Number.isFinite(min) || min < 5) min = base.durationSec.min;
    if (!Number.isFinite(max) || max < min) max = Math.max(min, base.durationSec.max);
    // Three minutes is where a serverless render stops fitting its budget.
    max = Math.min(max, 180);
    min = Math.min(min, max);

    const voice = str(r.voice, base.voice, 40);

    return {
        niche: str(r.niche, base.niche, 300),
        audience: str(r.audience, base.audience, 400),
        tone: str(r.tone, base.tone, 300),
        language: str(r.language, base.language, 60),
        formats: formatList(r.formats, base.formats),
        imageAspect: ASPECTS.includes(r.imageAspect as Aspect) ? (r.imageAspect as Aspect) : base.imageAspect,
        durationSec: { min: Math.round(min), max: Math.round(max) },
        cadence: str(r.cadence, base.cadence, 120),
        pillars: r.pillars === undefined ? base.pillars : list(r.pillars),
        avoid: r.avoid === undefined ? base.avoid : list(r.avoid),
        hashtags: r.hashtags === undefined
            ? base.hashtags
            : list(r.hashtags).map((h) => (h.startsWith('#') ? h : `#${h}`).replace(/\s+/g, '')),
        cta: str(r.cta, base.cta, 200),
        descriptionTemplate: str(r.descriptionTemplate, base.descriptionTemplate, 1500),
        voice: VOICES.some((v) => v.name === voice) ? voice : base.voice,
        narration: typeof r.narration === 'boolean' ? r.narration : base.narration,
        captions: typeof r.captions === 'boolean' ? r.captions : base.captions,
        quality: r.quality === 'hd' || r.quality === 'fhd' ? r.quality : base.quality,
        brand: {
            primary: hex(b.primary, base.brand.primary),
            accent: hex(b.accent, base.brand.accent),
            watermark: str(b.watermark, base.brand.watermark, 40),
        },
        notes: str(r.notes, base.notes, 1500),
    };
}

export interface MediaAccount {
    id: string;
    workspaceId: string;
    departmentId: string | null;
    platform: Platform;
    name: string;
    handle: string | null;
    url: string | null;
    status: 'active' | 'paused';
    preferences: AccountPreferences;
    createdAt: string;
    updatedAt: string;
}

/** "YouTube · Kitchen Science (@kitchensci)" */
export function accountLabel(a: Pick<MediaAccount, 'platform' | 'name' | 'handle'>): string {
    const handle = a.handle ? ` (${a.handle.startsWith('@') ? a.handle : `@${a.handle}`})` : '';
    return `${PLATFORM_LABEL[a.platform] ?? a.platform} · ${a.name}${handle}`;
}

/** The watermark the frame carries: the brand's, else the handle, else the name. */
export function watermarkFor(a: Pick<MediaAccount, 'name' | 'handle' | 'preferences'>): string {
    if (a.preferences.brand.watermark) return a.preferences.brand.watermark;
    if (a.handle) return a.handle.startsWith('@') ? a.handle : `@${a.handle}`;
    return a.name;
}

/** Frame size for an aspect and quality. Even numbers only — encoders insist. */
export function frameSize(aspect: Aspect, quality: Quality): { width: number; height: number } {
    const full = quality === 'fhd';
    switch (aspect) {
        case '9:16':
            return full ? { width: 1080, height: 1920 } : { width: 720, height: 1280 };
        case '16:9':
            return full ? { width: 1920, height: 1080 } : { width: 1280, height: 720 };
        case '1:1':
            return full ? { width: 1080, height: 1080 } : { width: 720, height: 720 };
        case '4:5':
            return full ? { width: 1080, height: 1350 } : { width: 720, height: 900 };
    }
}

/**
 * The shape a format renders at. Video shapes are fixed by the format —
 * shorts are vertical everywhere, full videos horizontal — and images take
 * the account's own shape.
 */
export function aspectFor(f: Format, prefs: Pick<AccountPreferences, 'imageAspect'>): Aspect {
    if (f === 'short') return '9:16';
    if (f === 'landscape') return '16:9';
    return prefs.imageAspect;
}

/** The frame one format renders at for this account. */
export function frameFor(f: Format, prefs: Pick<AccountPreferences, 'imageAspect' | 'quality'>): { width: number; height: number } {
    return frameSize(aspectFor(f, prefs), prefs.quality);
}

/** "Vertical short (9:16), Image carousel (4:5)" */
export function formatsLine(prefs: Pick<AccountPreferences, 'formats' | 'imageAspect'>): string {
    return prefs.formats
        .map((f) => (isImageFormat(f) ? `${FORMAT_LABEL[f]} (${prefs.imageAspect})` : FORMAT_LABEL[f]))
        .join(', ');
}

/**
 * The account as the planner and the production agents read it.
 *
 * Everything that should change what gets made is here; nothing that should
 * not (ids aside, timestamps and settings the studio applies on its own) is.
 */
export function describeAccount(a: MediaAccount): string {
    const p = a.preferences;
    const video = p.formats.some(isVideoFormat);
    const lines = [
        `${accountLabel(a)}${a.status === 'paused' ? ' — PAUSED, do not plan work for it' : ''}`,
        `  id: ${a.id}`,
        `  makes: ${p.formats.join(', ')} — ${formatsLine(p)}`,
    ];
    if (video) lines.push(`  video length: ${p.durationSec.min}-${p.durationSec.max}s`);
    if (p.niche) lines.push(`  niche: ${p.niche}`);
    if (p.audience) lines.push(`  audience: ${p.audience}`);
    lines.push(`  tone: ${p.tone}`, `  language: ${p.language}`);
    if (p.cadence) lines.push(`  cadence: ${p.cadence}`);
    if (p.pillars.length) lines.push(`  content pillars: ${p.pillars.join('; ')}`);
    if (p.avoid.length) lines.push(`  never: ${p.avoid.join('; ')}`);
    if (p.cta) lines.push(`  call to action: ${p.cta}`);
    if (p.hashtags.length) lines.push(`  hashtags: ${p.hashtags.join(' ')}`);
    if (video) lines.push(`  narration: ${p.narration ? `yes, voice ${p.voice}` : 'no — silent, text on screen carries it'}`);
    if (p.notes) lines.push(`  notes: ${p.notes}`);
    return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Input validation — what the owner types in
// ---------------------------------------------------------------------------

export interface AccountInput {
    platform: Platform;
    name: string;
    handle?: string | null;
    url?: string | null;
    departmentId?: string | null;
    status?: 'active' | 'paused';
    preferences?: unknown;
}

export type ValidAccount = {
    platform: Platform;
    name: string;
    handle: string | null;
    url: string | null;
    departmentId: string | null;
    status: 'active' | 'paused';
    preferences: AccountPreferences;
};

export function validateAccountInput(
    input: AccountInput,
    existing?: AccountPreferences
): { ok: true; value: ValidAccount } | { ok: false; error: string } {
    if (!PLATFORMS.includes(input.platform)) return { ok: false, error: 'Pick a platform.' };

    const name = String(input.name ?? '').trim().slice(0, 80);
    if (name.length < 2) return { ok: false, error: 'An account needs a name — the channel or page name.' };

    const handle = String(input.handle ?? '').trim().replace(/\s+/g, '').slice(0, 60) || null;

    let url: string | null = String(input.url ?? '').trim().slice(0, 300) || null;
    if (url) {
        if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
        try {
            new URL(url);
        } catch {
            return { ok: false, error: 'That URL does not look right.' };
        }
    }

    const raw = (input.preferences && typeof input.preferences === 'object' ? input.preferences : {}) as Record<string, unknown>;
    if (Array.isArray(raw.formats) && !raw.formats.some(isFormat)) {
        return { ok: false, error: 'Pick at least one thing this account makes.' };
    }

    const base = existing ?? withDefaults(platformDefaults(input.platform));
    const preferences = withDefaults(raw, base);

    return {
        ok: true,
        value: {
            platform: input.platform,
            name,
            handle,
            url,
            departmentId: input.departmentId ?? null,
            status: input.status === 'paused' ? 'paused' : 'active',
            preferences,
        },
    };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** The table is not there: migration 0011 has not been run. */
export function isMissingRelation(error: { code?: string; message?: string } | null): boolean {
    if (!error) return false;
    return (
        error.code === '42P01' ||
        error.code === 'PGRST205' ||
        /relation .* does not exist|could not find the table/i.test(error.message ?? '')
    );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

export function toAccount(r: Row): MediaAccount {
    return {
        id: r.id,
        workspaceId: r.workspace_id,
        departmentId: r.department_id ?? null,
        platform: (PLATFORMS.includes(r.platform) ? r.platform : 'other') as Platform,
        name: r.name,
        handle: r.handle ?? null,
        url: r.url ?? null,
        status: r.status === 'paused' ? 'paused' : 'active',
        preferences: withDefaults(r.preferences),
        createdAt: r.created_at,
        updatedAt: r.updated_at ?? r.created_at,
    };
}

/**
 * Accounts in a workspace, optionally one department's.
 *
 * An empty list when the table does not exist yet, so every page that shows
 * accounts renders before the migration as it would with none.
 */
export async function listAccounts(db: Db, workspaceId: string, departmentId?: string): Promise<MediaAccount[]> {
    let q = db.from('delphi_media_accounts').select('*').eq('workspace_id', workspaceId);
    if (departmentId) q = q.eq('department_id', departmentId);
    const { data, error } = await q.order('created_at', { ascending: true });
    if (error) {
        if (isMissingRelation(error)) return [];
        throw new Error(`listAccounts failed: ${error.message}`);
    }
    return (data ?? []).map(toAccount);
}

export async function getAccount(db: Db, id: string): Promise<MediaAccount | null> {
    const { data, error } = await db.from('delphi_media_accounts').select('*').eq('id', id).maybeSingle();
    if (error) {
        if (isMissingRelation(error)) return null;
        throw new Error(`getAccount failed: ${error.message}`);
    }
    return data ? toAccount(data) : null;
}

/** An account for a task with none: the defaults, named after the department. */
export function standInAccount(workspaceId: string, name: string, formats: Format[] = ['short']): MediaAccount {
    const now = new Date().toISOString();
    return {
        id: '',
        workspaceId,
        departmentId: null,
        platform: 'other',
        name,
        handle: null,
        url: null,
        status: 'active',
        preferences: withDefaults({ formats }),
        createdAt: now,
        updatedAt: now,
    };
}
