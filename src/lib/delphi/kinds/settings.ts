/**
 * What the CHO sets for a department, and the roles it is set per.
 *
 * Stored loosely (`delphi_departments.settings`, jsonb) and shaped here, the
 * same way media accounts are: `withSettings` fills whatever a stored row
 * lacks, so adding a setting never needs a migration and nothing downstream
 * null-checks a field.
 *
 * Role notes live on the department, not on the agent. The same Shion can
 * write for two departments; the notes she follows are the department's,
 * added to her task when she works for it, and never carried across.
 */

export type DepartmentKind = 'research' | 'studio' | 'general';

export const DEPARTMENT_KINDS: DepartmentKind[] = ['research', 'studio', 'general'];

export function isDepartmentKind(v: unknown): v is DepartmentKind {
    return v === 'research' || v === 'studio' || v === 'general';
}

export type RoleKey = 'researcher' | 'writer' | 'editor' | 'video_editor' | 'designer' | 'strategist';

export interface RoleInfo {
    key: RoleKey;
    label: string;
    /** Seeded roster slugs that fill this role. */
    slugs: string[];
    /** What a note for this role is for, shown under the field. */
    hint: string;
    /** The kinds this role is offered in. */
    kinds: DepartmentKind[];
}

export const ROLES: RoleInfo[] = [
    {
        key: 'researcher',
        label: 'Researcher',
        slugs: ['research-analyst', 'market-analyst', 'global-news-monitor', 'data-engineer'],
        hint: 'Which sources to trust, what to ignore, how far back to look.',
        kinds: ['research', 'studio', 'general'],
    },
    {
        key: 'writer',
        label: 'Writer',
        slugs: ['writer', 'caption-writer'],
        hint: 'Voice, length, structure, words to avoid.',
        kinds: ['research', 'studio', 'general'],
    },
    {
        key: 'editor',
        label: 'Editor',
        slugs: ['editor', 'critic'],
        hint: 'What to cut, what to check before it reaches you.',
        kinds: ['research', 'studio', 'general'],
    },
    {
        key: 'video_editor',
        label: 'Video editor',
        slugs: ['video-editor'],
        hint: 'Hooks, pacing, shots, how a video ends.',
        kinds: ['studio', 'general'],
    },
    {
        key: 'designer',
        label: 'Designer',
        slugs: ['motion-designer'],
        hint: 'Layout, how much text goes on an image.',
        kinds: ['studio', 'general'],
    },
    {
        key: 'strategist',
        label: 'Strategist',
        slugs: ['social-strategist', 'social-publisher'],
        hint: 'Which topics, which angles, what to stay away from.',
        kinds: ['studio', 'general'],
    },
];

export const ROLE_KEYS: RoleKey[] = ROLES.map((r) => r.key);

export function roleInfo(key: RoleKey): RoleInfo {
    return ROLES.find((r) => r.key === key)!;
}

export function rolesFor(kind: DepartmentKind): RoleInfo[] {
    return ROLES.filter((r) => r.kinds.includes(kind));
}

/**
 * The role an agent fills, by its seeded slug, or — for a hire the CEO
 * invented — by its title. Null when nothing fits: such an agent gets the
 * house rules and no role note, which is the safe direction to be wrong in.
 */
export function roleOfAgent(agent: { slug: string; title?: string | null }): RoleKey | null {
    for (const r of ROLES) if (r.slugs.includes(agent.slug)) return r.key;
    const t = (agent.title ?? '').toLowerCase();
    if (/video/.test(t)) return 'video_editor';
    if (/design|motion|animat|graphic|illustrat|thumbnail/.test(t)) return 'designer';
    if (/strateg|social|growth|community|publish/.test(t)) return 'strategist';
    if (/edit|critic|review|fact.?check|proof/.test(t)) return 'editor';
    if (/writ|script|copy|caption|author/.test(t)) return 'writer';
    if (/research|analyst|monitor|data|engineer|scout/.test(t)) return 'researcher';
    return null;
}

export type Autonomy = 'ask' | 'scheduled';

export interface DeliverySchedule {
    /** ISO weekdays, 1 Monday through 7 Sunday. */
    days: number[];
    /** HH:MM, in the department's timezone. */
    time: string;
}

export type ReportLength = 'brief' | 'standard' | 'deep';

export interface ResearchSetup {
    topics: string[];
    /** Channel kinds this department's agents may use. Empty: every connected one. */
    sources: string[];
    report: { length: ReportLength; sections: string; tone: string };
}

export interface DepartmentSettings {
    /** Where the setup wizard is, and whether it has been finished. */
    setup: { step: number; complete: boolean };
    houseRules: string;
    roleNotes: Partial<Record<RoleKey, string>>;
    /** A named agent (by slug) the CHO wants in a role. */
    pinned: Partial<Record<RoleKey, string>>;
    /** ask: every run waits for the CHO's go. scheduled: runs start on their own. */
    autonomy: Autonomy;
    /**
     * An IANA zone. Schedules mean nothing without one. It is the CHO's own,
     * found on their device and kept for the whole workspace, unless this
     * department was deliberately given another (`timezonePinned`).
     */
    timezone: string;
    /** True when the CHO chose this department's zone themselves. */
    timezonePinned: boolean;
    /** When a research department delivers. A studio schedules per channel. */
    schedule: DeliverySchedule | null;
    research: ResearchSetup;
}

export const SETUP_STEPS = 5;

export const DEFAULT_SETTINGS: DepartmentSettings = {
    // A department that predates the wizard is set up already.
    setup: { step: SETUP_STEPS, complete: true },
    houseRules: '',
    roleNotes: {},
    pinned: {},
    autonomy: 'scheduled',
    timezone: 'UTC',
    timezonePinned: false,
    schedule: null,
    research: { topics: [], sources: [], report: { length: 'standard', sections: '', tone: '' } },
};

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const SLUG = /^[a-z0-9-]{2,60}$/;

function str(v: unknown, fallback: string, max: number): string {
    return typeof v === 'string' ? v.trim().slice(0, max) : fallback;
}

function list(v: unknown, max = 30, each = 160): string[] {
    const items = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,\n]/) : [];
    const out: string[] = [];
    for (const raw of items) {
        const s = String(raw).trim().slice(0, each);
        if (s && !out.includes(s)) out.push(s);
        if (out.length >= max) break;
    }
    return out;
}

export function isTimezone(tz: unknown): tz is string {
    if (typeof tz !== 'string' || !tz.trim()) return false;
    try {
        new Intl.DateTimeFormat('en-GB', { timeZone: tz });
        return true;
    } catch {
        return false;
    }
}

export function withSchedule(raw: unknown): DeliverySchedule | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    const days = Array.isArray(r.days)
        ? [...new Set(r.days.map(Number).filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))].sort()
        : [];
    const time = typeof r.time === 'string' && HHMM.test(r.time.trim()) ? r.time.trim() : '09:00';
    return days.length ? { days, time } : null;
}

/** Shape whatever is stored into complete settings. Never throws. */
export function withSettings(raw: unknown, base: DepartmentSettings = DEFAULT_SETTINGS): DepartmentSettings {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const setupRaw = (r.setup && typeof r.setup === 'object' ? r.setup : null) as Record<string, unknown> | null;
    const research = (r.research && typeof r.research === 'object' ? r.research : {}) as Record<string, unknown>;
    const report = (research.report && typeof research.report === 'object' ? research.report : {}) as Record<string, unknown>;

    const notes: Partial<Record<RoleKey, string>> = { ...base.roleNotes };
    if (r.roleNotes && typeof r.roleNotes === 'object') {
        for (const k of ROLE_KEYS) {
            const v = (r.roleNotes as Record<string, unknown>)[k];
            if (typeof v === 'string') {
                const t = v.trim().slice(0, 1200);
                if (t) notes[k] = t;
                else delete notes[k];
            }
        }
    }

    const pinned: Partial<Record<RoleKey, string>> = { ...base.pinned };
    if (r.pinned && typeof r.pinned === 'object') {
        for (const k of ROLE_KEYS) {
            const v = (r.pinned as Record<string, unknown>)[k];
            if (v === null || v === '') delete pinned[k];
            else if (typeof v === 'string' && SLUG.test(v.trim())) pinned[k] = v.trim();
        }
    }

    const step = Number(setupRaw?.step);
    const length = report.length;

    return {
        setup: setupRaw
            ? {
                  step: Number.isInteger(step) ? Math.min(SETUP_STEPS, Math.max(1, step)) : base.setup.step,
                  complete: typeof setupRaw.complete === 'boolean' ? setupRaw.complete : base.setup.complete,
              }
            : base.setup,
        houseRules: str(r.houseRules, base.houseRules, 3000),
        roleNotes: notes,
        pinned,
        autonomy: r.autonomy === 'ask' || r.autonomy === 'scheduled' ? r.autonomy : base.autonomy,
        timezone: isTimezone(r.timezone) ? (r.timezone as string).trim() : base.timezone,
        timezonePinned: typeof r.timezonePinned === 'boolean' ? r.timezonePinned : base.timezonePinned,
        schedule: r.schedule === undefined ? base.schedule : withSchedule(r.schedule),
        research: {
            topics: research.topics === undefined ? base.research.topics : list(research.topics, 20, 200),
            sources: research.sources === undefined ? base.research.sources : list(research.sources, 20, 30),
            report: {
                length: length === 'brief' || length === 'standard' || length === 'deep' ? length : base.research.report.length,
                sections: str(report.sections, base.research.report.sections, 1000),
                tone: str(report.tone, base.research.report.tone, 300),
            },
        },
    };
}

const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** "Mon, Wed, Fri at 09:00 (Europe/London)" */
export function scheduleWords(s: DeliverySchedule | null, timezone: string): string {
    if (!s || !s.days.length) return 'On demand';
    const days =
        s.days.length === 7
            ? 'Every day'
            : s.days.join(',') === '1,2,3,4,5'
              ? 'Weekdays'
              : s.days.map((d) => DAY_SHORT[d - 1]).join(', ');
    return `${days} at ${s.time} (${timezone})`;
}

/** The cron a schedule amounts to, for the column older code reads. */
export function scheduleCron(s: DeliverySchedule | null): string | null {
    if (!s || !s.days.length) return null;
    const [h, m] = s.time.split(':').map(Number);
    // cron weekdays: 0 or 7 is Sunday.
    const dow = s.days.map((d) => (d === 7 ? 0 : d)).sort((a, b) => a - b).join(',');
    return `${m} ${h} * * ${dow}`;
}

export const REPORT_LENGTH_LABEL: Record<ReportLength, string> = {
    brief: 'Brief — a page or less',
    standard: 'Standard — two to three pages',
    deep: 'Deep — as long as it needs',
};
