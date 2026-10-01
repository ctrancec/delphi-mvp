/**
 * The smallest drawing surface that pixel art needs, with no DOM.
 *
 * Sprites are authored as text grids — one character per pixel, each standing
 * for a *slot* ("outline", "hair", "outfit") rather than a colour — and painted
 * here with a palette chosen per character. One grid then serves every look:
 * Benimaru's hair and Shuna's are the same slot in different colours.
 *
 * Kept free of the DOM on purpose. The same code paints into a browser canvas,
 * a node test, and the contact sheet the CHO reviews, and an RGBA buffer is
 * what all three can take.
 */

export type Rgba = readonly [number, number, number, number];

/** A grid of slot characters. `.` is always transparent. */
export interface Grid {
    readonly w: number;
    readonly h: number;
    readonly rows: readonly string[];
}

/** Slot character → colour. A slot missing from the palette is not painted. */
export type Palette = Readonly<Record<string, Rgba | undefined>>;

export function hex(value: string): Rgba {
    const v = value.replace('#', '');
    if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(v)) throw new Error(`Not a colour: ${value}`);
    return [
        parseInt(v.slice(0, 2), 16),
        parseInt(v.slice(2, 4), 16),
        parseInt(v.slice(4, 6), 16),
        v.length === 8 ? parseInt(v.slice(6, 8), 16) : 255,
    ];
}

/** Hex strings → a palette, so sprite files can stay readable. */
export function palette(colours: Readonly<Record<string, string | undefined>>): Palette {
    const out: Record<string, Rgba | undefined> = {};
    for (const [slot, value] of Object.entries(colours)) out[slot] = value ? hex(value) : undefined;
    return out;
}

/**
 * Parse a template literal into a grid.
 *
 * Leading and trailing blank lines and common indentation are dropped, so a
 * sprite can sit indented in its source file. Every row must be the same width:
 * a ragged row is a drawing mistake, and failing here is far cheaper than a
 * character with a sheared face.
 */
export function grid(source: string): Grid {
    const lines = source.replace(/\t/g, '    ').split('\n');
    while (lines.length && !lines[0].trim()) lines.shift();
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    const indent = Math.min(...lines.map((l) => l.match(/^ */)![0].length));
    const rows = lines.map((l) => l.slice(indent).replace(/\s+$/, ''));
    const w = Math.max(...rows.map((r) => r.length));
    const ragged = rows.findIndex((r) => r.length !== w);
    if (ragged !== -1) {
        throw new Error(`Grid row ${ragged} is ${rows[ragged].length} wide, expected ${w}: "${rows[ragged]}"`);
    }
    return { w, h: rows.length, rows };
}

export class PixelCanvas {
    readonly data: Uint8ClampedArray;

    /**
     * Painted pixels that fell outside the canvas. A sprite that composes
     * cleanly leaves this at zero; a head too tall for its pose does not.
     */
    clipped = 0;

    constructor(
        readonly w: number,
        readonly h: number
    ) {
        this.data = new Uint8ClampedArray(w * h * 4);
    }

    get(x: number, y: number): Rgba | null {
        if (x < 0 || y < 0 || x >= this.w || y >= this.h) return null;
        const i = (y * this.w + x) * 4;
        return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]];
    }

    /** Paint one pixel. Translucent colours blend over what is there. */
    set(x: number, y: number, c: Rgba): void {
        if (c[3] === 0) return;
        if (x < 0 || y < 0 || x >= this.w || y >= this.h) {
            this.clipped++;
            return;
        }
        const i = (y * this.w + x) * 4;
        const a = c[3] / 255;
        if (a >= 1 || this.data[i + 3] === 0) {
            this.data[i] = c[0];
            this.data[i + 1] = c[1];
            this.data[i + 2] = c[2];
            this.data[i + 3] = a >= 1 ? 255 : c[3];
            return;
        }
        this.data[i] = Math.round(c[0] * a + this.data[i] * (1 - a));
        this.data[i + 1] = Math.round(c[1] * a + this.data[i + 1] * (1 - a));
        this.data[i + 2] = Math.round(c[2] * a + this.data[i + 2] * (1 - a));
        this.data[i + 3] = Math.max(this.data[i + 3], c[3]);
    }

    /** Clear one pixel back to transparent. */
    erase(x: number, y: number): void {
        if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
        this.data.fill(0, (y * this.w + x) * 4, (y * this.w + x) * 4 + 4);
    }

    fill(x: number, y: number, w: number, h: number, c: Rgba): void {
        for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, c);
    }

    /** Paint a grid with its top-left at (x, y). `.` and unknown slots are skipped. */
    draw(g: Grid, x: number, y: number, colours: Palette, opts: { flip?: boolean } = {}): void {
        for (let row = 0; row < g.h; row++) {
            const line = g.rows[row];
            for (let col = 0; col < g.w; col++) {
                const slot = line[opts.flip ? g.w - 1 - col : col];
                if (slot === '.' || slot === ' ') continue;
                const c = colours[slot];
                if (c) this.set(x + col, y + row, c);
            }
        }
    }

    /** Copy another canvas onto this one, optionally scaled by an integer. */
    blit(src: PixelCanvas, x: number, y: number, scale = 1): void {
        for (let sy = 0; sy < src.h; sy++) {
            for (let sx = 0; sx < src.w; sx++) {
                const c = src.get(sx, sy);
                if (!c || c[3] === 0) continue;
                for (let dy = 0; dy < scale; dy++) {
                    for (let dx = 0; dx < scale; dx++) this.set(x + sx * scale + dx, y + sy * scale + dy, c);
                }
            }
        }
    }

    /** True if any pixel is painted — a cheap check that a sprite drew at all. */
    isBlank(): boolean {
        for (let i = 3; i < this.data.length; i += 4) if (this.data[i] !== 0) return false;
        return true;
    }
}
