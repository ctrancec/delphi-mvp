/**
 * A cadence written as cron, read.
 *
 * Departments made before the setup wizard carry their cadence as a cron
 * expression — every six hours, say — rather than days and a time. It is read here,
 * in UTC as it was written, so those departments keep to the rhythm they
 * were given. Five fields — minute, hour, day of month, month, day of week —
 * with `*`, lists, ranges and steps; anything else reads as no cadence at
 * all, never as "every minute".
 */

const FIELDS: [min: number, max: number][] = [
    [0, 59],
    [0, 23],
    [1, 31],
    [1, 12],
    [0, 7],
];

/** The values one field allows, or null when the field cannot be read. */
function field(text: string, [min, max]: [number, number]): Set<number> | null {
    const out = new Set<number>();
    for (const part of text.split(',')) {
        const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part.trim());
        if (!m) return null;
        const step = m[2] ? Number(m[2]) : 1;
        if (!Number.isInteger(step) || step < 1) return null;
        let lo = min;
        let hi = max;
        if (m[1] !== '*') {
            const [a, b] = m[1].split('-').map(Number);
            lo = a;
            hi = b ?? (m[2] ? max : a);
        }
        if (lo < min || hi > max || lo > hi) return null;
        for (let v = lo; v <= hi; v += step) out.add(v);
    }
    return out.size ? out : null;
}

export interface Cron {
    minutes: Set<number>;
    hours: Set<number>;
    days: Set<number>;
    months: Set<number>;
    weekdays: Set<number>;
    /** Both day fields restricted: cron then matches either, not both. */
    eitherDay: boolean;
}

export function parseCron(expr: string | null | undefined): Cron | null {
    if (!expr) return null;
    const parts = expr.trim().split(/\s+/);
    if (parts.length !== 5) return null;
    const sets = parts.map((p, i) => field(p, FIELDS[i]));
    if (sets.some((s) => !s)) return null;
    const [minutes, hours, days, months, weekdaysRaw] = sets as Set<number>[];
    // 7 is Sunday too.
    const weekdays = new Set([...weekdaysRaw].map((d) => (d === 7 ? 0 : d)));
    return { minutes, hours, days, months, weekdays, eitherDay: parts[2] !== '*' && parts[4] !== '*' };
}

export function cronMatches(c: Cron, at: Date): boolean {
    if (!c.minutes.has(at.getUTCMinutes()) || !c.hours.has(at.getUTCHours()) || !c.months.has(at.getUTCMonth() + 1)) return false;
    const day = c.days.has(at.getUTCDate());
    const weekday = c.weekdays.has(at.getUTCDay());
    return c.eitherDay ? day || weekday : day && weekday;
}

/** Every instant a cron names in [from, to), on the minute, oldest first. At most `cap`. */
export function cronSlotsBetween(expr: string | null | undefined, from: Date, to: Date, cap = 500): Date[] {
    const c = parseCron(expr);
    if (!c || to <= from) return [];
    const out: Date[] = [];
    let t = Math.ceil(from.getTime() / 60_000) * 60_000;
    for (; t < to.getTime() && out.length < cap; t += 60_000) {
        const at = new Date(t);
        if (cronMatches(c, at)) out.push(at);
    }
    return out;
}
