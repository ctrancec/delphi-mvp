/**
 * The light over Tempest, from the clock on the wall.
 *
 * The town keeps the CHO's hours: dawn, day, dusk and night follow their
 * real local time, so the lanterns come on when it is dark where they are.
 * The light is a tint laid over the whole frame and a glow around whatever
 * gives light, both read off a few keyframes a day and blended between, so
 * nothing jumps at the hour.
 *
 * Pure. The hour comes in; the browser decides which time zone it is in.
 */

export type DayPhase = 'night' | 'dawn' | 'day' | 'dusk';

export interface Daylight {
    /** The tint, as RGB and how strongly to lay it over the frame. */
    r: number;
    g: number;
    b: number;
    a: number;
    /** 0 by day, 1 at full night: how bright the lanterns and windows are. */
    glow: number;
    phase: DayPhase;
}

/** Hour of the day (0 ≤ h < 24, fractional) → tint and glow. */
const KEYFRAMES: readonly { h: number; r: number; g: number; b: number; a: number; glow: number }[] = [
    { h: 0, r: 18, g: 24, b: 72, a: 0.55, glow: 1 },
    { h: 5, r: 18, g: 24, b: 72, a: 0.55, glow: 1 },
    { h: 6.5, r: 255, g: 150, b: 90, a: 0.22, glow: 0.35 },
    { h: 8, r: 255, g: 240, b: 200, a: 0, glow: 0 },
    { h: 17.5, r: 255, g: 240, b: 200, a: 0, glow: 0 },
    { h: 19, r: 255, g: 120, b: 60, a: 0.28, glow: 0.45 },
    { h: 20.5, r: 18, g: 24, b: 72, a: 0.55, glow: 1 },
    { h: 24, r: 18, g: 24, b: 72, a: 0.55, glow: 1 },
];

export function phaseOf(hour: number): DayPhase {
    const h = ((hour % 24) + 24) % 24;
    if (h < 5 || h >= 20.5) return 'night';
    if (h < 8) return 'dawn';
    if (h < 17.5) return 'day';
    return 'dusk';
}

export function daylight(hour: number): Daylight {
    const h = ((hour % 24) + 24) % 24;
    let i = 0;
    while (i < KEYFRAMES.length - 2 && KEYFRAMES[i + 1].h <= h) i++;
    const a = KEYFRAMES[i];
    const b = KEYFRAMES[i + 1];
    const t = b.h === a.h ? 0 : (h - a.h) / (b.h - a.h);
    const mix = (x: number, y: number) => x + (y - x) * t;
    return {
        r: Math.round(mix(a.r, b.r)),
        g: Math.round(mix(a.g, b.g)),
        b: Math.round(mix(a.b, b.b)),
        a: Math.round(mix(a.a, b.a) * 1000) / 1000,
        glow: Math.round(mix(a.glow, b.glow) * 1000) / 1000,
        phase: phaseOf(h),
    };
}

/**
 * The fractional local hour at an instant, in a time zone — the browser's
 * when none is given. An unknown zone falls back to the machine's.
 */
export function localHour(atMs: number, timeZone?: string): number {
    const date = new Date(atMs);
    try {
        const parts = new Intl.DateTimeFormat('en-GB', {
            timeZone: timeZone || undefined,
            hour: 'numeric',
            minute: 'numeric',
            second: 'numeric',
            hourCycle: 'h23',
        }).formatToParts(date);
        const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
        return (get('hour') % 24) + get('minute') / 60 + get('second') / 3600;
    } catch {
        return date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
    }
}

/** "22:53, night" — for the line under the town. */
export function clockWords(hour: number): string {
    const h = ((hour % 24) + 24) % 24;
    // Whole minutes, rounded, so 22.9 reads 22:54 and not 22:53.999.
    const minutes = Math.round(h * 60) % (24 * 60);
    const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
    const mm = String(minutes % 60).padStart(2, '0');
    return `${hh}:${mm}, ${phaseOf(h)}`;
}

/** After dark the idle would rather be indoors. */
export function isNight(hour: number): boolean {
    return phaseOf(hour) === 'night';
}
