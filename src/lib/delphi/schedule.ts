/**
 * When the agents are allowed to work.
 *
 * Two controls that have to coexist. The **schedule** is the ordinary rhythm —
 * weekday mornings, say — and the **switch** is what you reach for right now.
 * Neither replaces the other:
 *
 *   - Inside working hours, the switch decides. Turning it off holds the
 *     agents until the window closes on its own.
 *   - Outside them, the schedule decides. Turning the switch on works through
 *     the closed window, until it would have opened anyway.
 *   - `stopped` beats everything. An emergency stop that a schedule could
 *     undo at 9am would not be a stop.
 *
 * Every temporary win expires at the **next boundary** rather than after some
 * arbitrary duration. That is what keeps the two controls honest together: an
 * override can never outlive the window it was made against, so "just this
 * once" cannot quietly become the new schedule.
 */

import type { SystemMode } from './db';

export interface WorkSchedule {
    enabled: boolean;
    /** HH:MM, in `timezone`. */
    start: string;
    end: string;
    /** ISO weekdays, 1 Monday through 7 Sunday. */
    days: number[];
    /** An IANA zone. Hours are meaningless without one. */
    timezone: string;
}

export interface SystemState {
    mode: SystemMode;
    schedule: WorkSchedule;
    override: { mode: 'run' | 'hold'; until: string } | null;
}

export type EffectiveReason =
    | 'switch'
    | 'out_of_hours'
    | 'override_run'
    | 'override_hold'
    | 'stopped';

export interface Effective {
    /** What the runtime should actually do. */
    mode: SystemMode;
    reason: EffectiveReason;
    /** When this answer changes on its own, if it does. */
    until: Date | null;
    /** One line, for the switch to say why it looks the way it does. */
    detail: string;
}

export const DEFAULT_SCHEDULE: WorkSchedule = {
    enabled: false,
    start: '09:00',
    end: '17:00',
    days: [1, 2, 3, 4, 5],
    timezone: 'UTC',
};

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function toMinutes(hhmm: string): number {
    const [h, m] = hhmm.split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
    return Math.max(0, Math.min(24 * 60 - 1, h * 60 + m));
}

/**
 * The wall clock where the CHO is, not where the function happens to run.
 *
 * The formatter is passed in so a scan over several days builds one rather
 * than thousands — `Intl.DateTimeFormat` is expensive to construct and cheap
 * to reuse.
 */
function localParts(fmt: Intl.DateTimeFormat, at: Date): { minutes: number; isoDay: number } {
    const parts = Object.fromEntries(fmt.formatToParts(at).map((p) => [p.type, p.value]));
    const index = DAY_NAMES.indexOf(String(parts.weekday));
    // `24` appears in some locales for midnight; normalise it to 0.
    const hour = Number(parts.hour) % 24;
    return {
        minutes: hour * 60 + Number(parts.minute),
        isoDay: index >= 0 ? index + 1 : 1,
    };
}

function formatterFor(timezone: string): Intl.DateTimeFormat {
    try {
        return new Intl.DateTimeFormat('en-GB', {
            timeZone: timezone,
            hour12: false,
            weekday: 'short',
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch {
        // An unknown zone must not take the engine down. UTC is wrong but
        // legible, and the diagnostics surface says which zone is set.
        return new Intl.DateTimeFormat('en-GB', {
            timeZone: 'UTC',
            hour12: false,
            weekday: 'short',
            hour: '2-digit',
            minute: '2-digit',
        });
    }
}

function isOpenAt(schedule: WorkSchedule, fmt: Intl.DateTimeFormat, at: Date): boolean {
    const { minutes, isoDay } = localParts(fmt, at);
    const start = toMinutes(schedule.start);
    const end = toMinutes(schedule.end);

    // A window that ends at or before it starts runs through midnight — a
    // night desk watching Asian markets is a real thing to want.
    const overnight = end <= start;
    const inTime = overnight ? minutes >= start || minutes < end : minutes >= start && minutes < end;
    if (!inTime) return false;

    // For the small hours of an overnight window, the day that counts is the
    // day it opened. A Friday-night shift is Friday's, not Saturday's.
    const day = overnight && minutes < end ? ((isoDay + 5) % 7) + 1 : isoDay;
    return schedule.days.includes(day);
}

/** Is the window open right now? */
export function isWithinHours(schedule: WorkSchedule, now = new Date()): boolean {
    if (!schedule.enabled) return true;
    return isOpenAt(schedule, formatterFor(schedule.timezone), now);
}

const STEP_MS = 60_000;
const HORIZON_MINUTES = 8 * 24 * 60;

/**
 * When the window next opens or closes.
 *
 * Walked a minute at a time rather than computed, deliberately. The arithmetic
 * looks easy until it meets an overnight window on the Sunday of a daylight
 * saving change, and this is not on any hot path — it runs when an override is
 * written, and to tell the CHO when the agents come back.
 *
 * Null when the schedule never changes state: no days selected, or every day
 * selected with a window covering the whole day.
 */
export function nextBoundary(schedule: WorkSchedule, now = new Date()): Date | null {
    if (!schedule.enabled || schedule.days.length === 0) return null;

    const fmt = formatterFor(schedule.timezone);
    const current = isOpenAt(schedule, fmt, now);

    for (let i = 1; i <= HORIZON_MINUTES; i++) {
        const at = new Date(now.getTime() + i * STEP_MS);
        if (isOpenAt(schedule, fmt, at) !== current) return at;
    }
    return null;
}

/** HH:MM in the schedule's own timezone, for saying when work resumes. */
export function formatInZone(at: Date, timezone: string): string {
    try {
        return new Intl.DateTimeFormat('en-GB', {
            timeZone: timezone,
            hour12: false,
            weekday: 'short',
            hour: '2-digit',
            minute: '2-digit',
        }).format(at);
    } catch {
        return at.toISOString().slice(0, 16).replace('T', ' ');
    }
}

/**
 * What the system is actually doing, from the switch, the schedule and any
 * override, in that order of authority.
 */
export function effectiveState(state: SystemState, now = new Date()): Effective {
    // An emergency stop a schedule could undo at 9am would not be a stop.
    if (state.mode === 'stopped') {
        return {
            mode: 'stopped',
            reason: 'stopped',
            until: null,
            detail: 'Stopped. Nothing runs until you start it again.',
        };
    }

    const { schedule, override } = state;
    const live = override && new Date(override.until) > now ? override : null;

    if (live) {
        const until = new Date(live.until);
        const when = formatInZone(until, schedule.timezone);
        return live.mode === 'run'
            ? {
                  mode: 'running',
                  reason: 'override_run',
                  until,
                  detail: `Working outside hours at your request, until ${when}.`,
              }
            : {
                  mode: 'paused',
                  reason: 'override_hold',
                  until,
                  detail: `Held by you during working hours, until ${when}.`,
              };
    }

    if (!schedule.enabled) {
        return {
            mode: state.mode,
            reason: 'switch',
            until: null,
            detail:
                state.mode === 'running'
                    ? 'Running. No working hours set, so the switch alone decides.'
                    : 'Paused by you.',
        };
    }

    if (!isWithinHours(schedule, now)) {
        const boundary = nextBoundary(schedule, now);
        return {
            mode: 'paused',
            reason: 'out_of_hours',
            until: boundary,
            detail: boundary
                ? `Outside working hours. Work resumes ${formatInZone(boundary, schedule.timezone)}.`
                : 'Outside working hours, and no day is selected — nothing will run.',
        };
    }

    // Inside the window, the switch has the last word.
    const boundary = nextBoundary(schedule, now);
    return {
        mode: state.mode,
        reason: 'switch',
        until: boundary,
        detail:
            state.mode === 'running'
                ? boundary
                    ? `Working. Hours end ${formatInZone(boundary, schedule.timezone)}.`
                    : 'Working.'
                : 'Paused by you, inside working hours.',
    };
}

/**
 * What flipping the switch should write.
 *
 * The switch means "right now", so its effect depends on what the schedule is
 * currently saying. Asking for work while the window is shut, or for quiet
 * while it is open, is an override; anything else is just the mode, and
 * clearing the override is part of that — a stale override outliving the
 * intent that created it is the failure this whole design is avoiding.
 */
export function switchIntent(
    state: SystemState,
    next: SystemMode,
    now = new Date()
): { mode: SystemMode; override: { mode: 'run' | 'hold'; until: string } | null } {
    if (next === 'stopped' || !state.schedule.enabled) {
        return { mode: next, override: null };
    }

    const open = isWithinHours(state.schedule, now);
    const boundary = nextBoundary(state.schedule, now);

    if (next === 'running' && !open && boundary) {
        return { mode: next, override: { mode: 'run', until: boundary.toISOString() } };
    }
    if (next === 'paused' && open && boundary) {
        return { mode: next, override: { mode: 'hold', until: boundary.toISOString() } };
    }

    return { mode: next, override: null };
}
