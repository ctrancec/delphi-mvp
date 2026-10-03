/**
 * Text on the frame, and text beside it — pure.
 *
 * Titles, captions and the watermark are drawn by libass from an ASS script
 * the studio writes per scene. Captions are also written out as an .srt, so
 * a video can be uploaded with real subtitles rather than only burned-in
 * ones. Both come from the same timings, which come from here.
 *
 * Nothing in this file touches a file or a process, so every rule about how
 * a caption is split, timed and escaped is asserted offline.
 */

import type { Brand } from './accounts';

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

export interface Timing {
    /** Seconds. */
    start: number;
    end: number;
}

/**
 * Share `total` seconds across scenes in proportion to `weights`, with a
 * floor for each so a one-word scene still stays on screen long enough to
 * read. The result always sums to `total` (to the millisecond), because the
 * narration is one continuous recording and the scenes have to tile it.
 */
export function distribute(total: number, weights: number[], minEach = 1.5): number[] {
    const n = weights.length;
    if (n === 0) return [];
    if (total <= 0) return weights.map(() => 0);

    const floor = Math.min(minEach, total / n);
    const spare = total - floor * n;
    const sum = weights.reduce((a, w) => a + Math.max(0, w), 0);

    const out = weights.map((w) => floor + (sum > 0 ? (Math.max(0, w) / sum) * spare : spare / n));

    // Round to milliseconds and put any drift on the last scene.
    const rounded = out.map((s) => Math.round(s * 1000) / 1000);
    const drift = Math.round((total - rounded.reduce((a, s) => a + s, 0)) * 1000) / 1000;
    rounded[n - 1] = Math.round((rounded[n - 1] + drift) * 1000) / 1000;
    return rounded;
}

/** Consecutive timings from a list of durations. */
export function timingsFrom(durations: number[]): Timing[] {
    let t = 0;
    return durations.map((d) => {
        const start = t;
        t = Math.round((t + d) * 1000) / 1000;
        return { start, end: t };
    });
}

/** How much speaking a line is: letters and digits, not punctuation. */
export function speechWeight(text: string): number {
    return Math.max(1, text.replace(/[^\p{L}\p{N}]/gu, '').length);
}

// ---------------------------------------------------------------------------
// Captions
// ---------------------------------------------------------------------------

export interface Cue extends Timing {
    text: string;
}

/**
 * Break narration into caption-sized pieces at phrase boundaries.
 *
 * Two lines of about twenty characters is what reads on a phone; a caption
 * longer than that is a paragraph. Breaks are chosen together rather than
 * greedily — the split that leaves the lines most even, preferring to end on
 * a comma or a full stop — so a sentence one word too long becomes two
 * halves, not a full line and an orphaned "fast."
 */
/**
 * Words a caption line should not end on: articles, prepositions,
 * conjunctions — the ones that only mean something with the word after them.
 * Subtitling guidelines ask for exactly this, and "and only then the |
 * garlic" shows why.
 */
const WEAK_ENDINGS = new Set([
    'a', 'an', 'the', 'and', 'or', 'but', 'nor', 'so', 'yet', 'to', 'of', 'in', 'on', 'at', 'by', 'for',
    'with', 'from', 'into', 'onto', 'as', 'if', 'than', 'then', 'that', 'which', 'who', 'whose', 'is', 'are',
    'was', 'were', 'be', 'my', 'your', 'its', "it's", 'our', 'their', 'his', 'her', 'this', 'these', 'those',
    'not', 'no', 'very', 'just',
]);

export function chunkText(text: string, maxChars = 42): string[] {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (!clean) return [];
    if (clean.length <= maxChars) return [clean];

    const words = clean.split(' ');
    const n = words.length;
    const orphan = Math.round(maxChars * 0.35);

    // best[i]: the least cost of laying out words[i..]; next[i]: where the
    // first line of that layout ends.
    const best = new Array<number>(n + 1).fill(Infinity);
    const next = new Array<number>(n + 1).fill(n);
    best[n] = 0;

    for (let i = n - 1; i >= 0; i--) {
        let len = -1;
        for (let j = i; j < n; j++) {
            len += words[j].length + 1;
            // A single word longer than a line stands alone rather than vanishing.
            if (len > maxChars && j > i) break;

            const last = j === n - 1;
            const slack = Math.max(0, maxChars - len);
            let cost: number;
            if (last) {
                // The last line may be short, but not so short it is an orphan.
                cost = len < orphan ? (orphan - len) ** 2 * 4 : 0;
            } else {
                cost = slack * slack;
                if (/[.!?;:,—–-]$/.test(words[j])) cost *= 0.35;
                else if (WEAK_ENDINGS.has(words[j].toLowerCase())) cost += (maxChars / 2) ** 2;
            }

            const total = cost + best[j + 1];
            if (total < best[i]) {
                best[i] = total;
                next[i] = j + 1;
            }
        }
    }

    const out: string[] = [];
    for (let i = 0; i < n; i = next[i]) out.push(words.slice(i, next[i]).join(' '));
    return out;
}

/** Captions for one scene: its narration, chunked, spread over its timing by weight. */
export function captionCues(narration: string, timing: Timing, maxChars = 42): Cue[] {
    const pieces = chunkText(narration, maxChars);
    if (pieces.length === 0) return [];
    const durations = distribute(timing.end - timing.start, pieces.map(speechWeight), 0.8);
    let t = timing.start;
    return pieces.map((text, i) => {
        const start = t;
        t = Math.round((t + durations[i]) * 1000) / 1000;
        return { start, end: t, text };
    });
}

// ---------------------------------------------------------------------------
// SRT
// ---------------------------------------------------------------------------

export function srtTime(seconds: number): string {
    const ms = Math.max(0, Math.round(seconds * 1000));
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    const s = Math.floor((ms % 60_000) / 1000);
    const rest = ms % 1000;
    const pad = (n: number, w = 2) => String(n).padStart(w, '0');
    return `${pad(h)}:${pad(m)}:${pad(s)},${pad(rest, 3)}`;
}

export function buildSrt(cues: Cue[]): string {
    return cues
        .map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`)
        .join('\n');
}

// ---------------------------------------------------------------------------
// ASS
// ---------------------------------------------------------------------------

/** h:mm:ss.cc — centiseconds, as the format has it. */
export function assTime(seconds: number): string {
    const cs = Math.max(0, Math.round(seconds * 100));
    const h = Math.floor(cs / 360_000);
    const m = Math.floor((cs % 360_000) / 6000);
    const s = Math.floor((cs % 6000) / 100);
    const rest = cs % 100;
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(rest).padStart(2, '0')}`;
}

/** &HAABBGGRR from #rrggbb and an opacity in 0..1. */
export function assColour(hex: string, opacity = 1): string {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
    const [r, g, b] = m ? [m[1], m[2], m[3]] : ['ff', 'ff', 'ff'];
    const alpha = Math.round((1 - Math.min(1, Math.max(0, opacity))) * 255);
    return `&H${alpha.toString(16).padStart(2, '0')}${b}${g}${r}`.toUpperCase();
}

/**
 * Text as ASS dialogue can carry it.
 *
 * Braces open override tags and a backslash starts one, so neither may pass
 * through from content; line breaks become the format's own `\N`.
 */
export function escapeAss(text: string): string {
    return text
        .replace(/\r\n?/g, '\n')
        .replace(/[{]/g, '(')
        .replace(/[}]/g, ')')
        .replace(/\\/g, '/')
        .replace(/\n/g, '\\N')
        .trim();
}

export interface Frame {
    width: number;
    height: number;
}

export interface SceneText {
    /** Scene length, seconds. Events are timed from zero within the scene. */
    seconds: number;
    /** Large text at the top, shown for the whole scene. */
    title?: string;
    /** Captions, timed within the scene. */
    cues?: Cue[];
    /** Small text bottom-right. */
    watermark?: string;
    /** One big line in the middle, for thumbnails and image posts. */
    headline?: string;
    /** Smaller text under the headline. */
    body?: string;
}

/**
 * Sizes scale with the frame's shorter side, so a 1080×1920 short and a
 * 1920×1080 long-form get the same type at the same apparent size, and HD
 * gets two thirds of it.
 */
function scale(frame: Frame): number {
    return Math.min(frame.width, frame.height) / 1080;
}

/**
 * An ASS script for one scene: styles sized to the frame, in the brand's
 * colours, and the events placed on it. Fonts are named, not located — the
 * filter is given the fonts directory separately, so this needs no fontconfig
 * and renders the same on a laptop and in a function with no system fonts.
 */
export function buildSceneAss(frame: Frame, brand: Brand, text: SceneText): string {
    const s = scale(frame);
    const px = (n: number) => Math.round(n * s);

    const white = assColour('#ffffff');
    const outline = assColour('#000000');
    const box = assColour(brand.primary, 0.72);
    const dim = assColour('#ffffff', 0.8);

    const marginX = Math.round(frame.width * 0.07);

    const styles = [
        // Name, Fontname, Fontsize, Primary, Secondary, Outline, Back, Bold,
        // Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle,
        // BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
        `Style: Title,Poppins,${px(76)},${white},${white},${outline},${assColour('#000000', 0.5)},-1,0,0,0,100,100,0,0,1,${px(4)},${px(2)},8,${marginX},${marginX},${Math.round(frame.height * 0.12)},1`,
        `Style: Caption,Poppins SemiBold,${px(54)},${white},${white},${box},${box},0,0,0,0,100,100,0,0,3,${px(16)},0,2,${marginX},${marginX},${Math.round(frame.height * 0.14)},1`,
        `Style: Brand,Poppins,${px(26)},${dim},${dim},${outline},${outline},-1,0,0,0,100,100,0,0,1,${px(1)},0,3,${marginX},${Math.round(frame.width * 0.05)},${Math.round(frame.height * 0.035)},1`,
        `Style: Headline,Poppins,${px(88)},${white},${white},${outline},${assColour('#000000', 0.5)},-1,0,0,0,100,100,0,0,1,${px(5)},${px(3)},5,${marginX},${marginX},0,1`,
        `Style: Body,Poppins SemiBold,${px(46)},${white},${white},${outline},${box},0,0,0,0,100,100,0,0,3,${px(14)},0,2,${marginX},${marginX},${Math.round(frame.height * 0.16)},1`,
    ];

    const events: string[] = [];
    const whole = `${assTime(0)},${assTime(text.seconds)}`;

    if (text.title) {
        events.push(`Dialogue: 0,${whole},Title,,0,0,0,,{\\fad(250,250)}${escapeAss(text.title)}`);
    }
    if (text.headline) {
        events.push(`Dialogue: 0,${whole},Headline,,0,0,0,,${escapeAss(text.headline)}`);
    }
    if (text.body) {
        events.push(`Dialogue: 0,${whole},Body,,0,0,0,,${escapeAss(text.body)}`);
    }
    for (const c of text.cues ?? []) {
        events.push(`Dialogue: 1,${assTime(c.start)},${assTime(c.end)},Caption,,0,0,0,,${escapeAss(c.text)}`);
    }
    if (text.watermark) {
        events.push(`Dialogue: 2,${whole},Brand,,0,0,0,,${escapeAss(text.watermark)}`);
    }

    return [
        '[Script Info]',
        'ScriptType: v4.00+',
        `PlayResX: ${frame.width}`,
        `PlayResY: ${frame.height}`,
        'WrapStyle: 0',
        'ScaledBorderAndShadow: yes',
        '',
        '[V4+ Styles]',
        'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
        ...styles,
        '',
        '[Events]',
        'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
        ...events,
        '',
    ].join('\n');
}
