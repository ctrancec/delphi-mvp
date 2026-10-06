/**
 * When a channel's pieces are due, in its studio's own time zone.
 *
 * A schedule is days of the week and a time of day, local to the studio:
 * "Mon, Wed and Fri at 09:00, Toronto". A slot is one of those, as an
 * instant. Everything here is pure: the scheduler and the pages ask the same
 * questions and get the same answers, and the tests can ask about any moment,
 * across a daylight-saving change, without waiting for one.
 */

import type { DeliverySchedule } from './kinds/settings';

export interface ZonedParts {
    year: number;
    /** 1 to 12. */
    month: number;
    day: number;
    hour: number;
    minute: number;
    /** ISO weekday: 1 Monday through 7 Sunday. */
    isoDay: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
const ISO_DAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

function formatter(tz: string): Intl.DateTimeFormat {
    let f = formatters.get(tz);
    if (!f) {
        try {
            f = new Intl.DateTimeFormat('en-US', {
                timeZone: tz,
                hourCycle: 'h23',
                year: 'numeric',
                month: 'numeric',
                day: 'numeric',
                hour: 'numeric',
                minute: 'numeric',
                weekday: 'short',
            });
        } catch {
            // An unknown zone is read as UTC rather than failing the schedule.
            f = formatter('UTC');
        }
        formatters.set(tz, f);
    }
    return f;
}

/** The wall-clock reading of an instant in a zone. */
export function zonedParts(at: Date, tz: string): ZonedParts {
    const parts: Record<string, string> = {};
    for (const p of formatter(tz).formatToParts(at)) parts[p.type] = p.value;
    return {
        year: Number(parts.year),
        month: Number(parts.month),
        day: Number(parts.day),
        hour: Number(parts.hour) % 24,
        minute: Number(parts.minute),
        isoDay: ISO_DAY[parts.weekday] ?? 1,
    };
}

/**
 * The instant a wall-clock time in a zone names. Corrected twice for the
 * zone's offset, which settles every ordinary time and either side of a
 * daylight-saving change; a time that does not exist (the hour skipped in
 * spring) lands just after the gap.
 */
export function zonedToUtc(p: Pick<ZonedParts, 'year' | 'month' | 'day' | 'hour' | 'minute'>, tz: string): Date {
    const wanted = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    let guess = wanted;
    for (let i = 0; i < 3; i++) {
        const q = zonedParts(new Date(guess), tz);
        const diff = Date.UTC(q.year, q.month - 1, q.day, q.hour, q.minute) - wanted;
        if (diff === 0) break;
        guess -= diff;
    }
    return new Date(guess);
}

/** The local calendar date of an instant, as YYYY-MM-DD. */
export function localDate(at: Date, tz: string): string {
    const p = zonedParts(at, tz);
    return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Midnight on the first of the local month an instant falls in. */
export function monthStart(at: Date, tz: string): Date {
    const p = zonedParts(at, tz);
    return zonedToUtc({ year: p.year, month: p.month, day: 1, hour: 0, minute: 0 }, tz);
}

const DAY_MS = 86_400_000;

/** Every slot of a schedule in [from, to), oldest first. */
export function slotsBetween(schedule: DeliverySchedule | null, tz: string, from: Date, to: Date): Date[] {
    if (!schedule || !schedule.days.length || to <= from) return [];
    const [hh, mm] = schedule.time.split(':').map(Number);
    const out: Date[] = [];
    // Walk local calendar dates, a day either side, at noon UTC so that no
    // offset can tip a step into the wrong date.
    const start = zonedParts(new Date(from.getTime() - DAY_MS), tz);
    const end = zonedParts(new Date(to.getTime() + DAY_MS), tz);
    let cursor = Date.UTC(start.year, start.month - 1, start.day, 12);
    const last = Date.UTC(end.year, end.month - 1, end.day, 12);
    for (; cursor <= last; cursor += DAY_MS) {
        const d = new Date(cursor);
        const isoDay = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
        if (!schedule.days.includes(isoDay)) continue;
        const slot = zonedToUtc({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: hh || 0, minute: mm || 0 }, tz);
        if (slot >= from && slot < to) out.push(slot);
    }
    return out;
}

/** The next `count` slots from a moment on. */
export function nextSlots(schedule: DeliverySchedule | null, tz: string, from: Date, count: number, horizonDays = 60): Date[] {
    return slotsBetween(schedule, tz, from, new Date(from.getTime() + horizonDays * DAY_MS)).slice(0, count);
}

/** How long a missed slot stays worth making. Older ones are let go. */
export const STALE_AFTER_MS = 3 * DAY_MS;

/**
 * The slots due now: any from the last three days that have not been made,
 * and every one later today, local time. Work for a slot starts at the first
 * run on its day, so the piece is ready by the time it names — on the free
 * tier that run is the morning one.
 */
export function dueSlots(schedule: DeliverySchedule | null, tz: string, now: Date): Date[] {
    const p = zonedParts(now, tz);
    // Midnight at the start of tomorrow, local: the end of "today".
    const tomorrow = new Date(Date.UTC(p.year, p.month - 1, p.day, 12) + DAY_MS);
    const endOfToday = zonedToUtc({ year: tomorrow.getUTCFullYear(), month: tomorrow.getUTCMonth() + 1, day: tomorrow.getUTCDate(), hour: 0, minute: 0 }, tz);
    return slotsBetween(schedule, tz, new Date(now.getTime() - STALE_AFTER_MS), endOfToday);
}

/** A slot as a person reads it, in the studio's zone: "Wed 8 Oct, 09:00". */
export function slotWords(slot: Date, tz: string): string {
    try {
        return new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
            .format(slot)
            .replace(/,(?= \d{2}:)/, ',');
    } catch {
        return slot.toISOString().slice(0, 16).replace('T', ' ');
    }
}
