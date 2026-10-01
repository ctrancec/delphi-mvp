/**
 * The mark of Tempest: Rimuru, the slime, as the icon of the app.
 *
 * Drawn from the same sprite the town uses, centred on a square of base
 * pixels and scaled up by whole numbers, so every size of the icon is the
 * same picture. A maskable icon keeps the slime inside the middle 80% of the
 * square, which is all a launcher promises to show.
 */

import { hex, PixelCanvas } from './canvas';
import { CHO } from './cast';
import { renderSlime } from './character';

/** The night sky behind the icon, and the theme colour of the app. */
export const SKY = '#0d1128';

export function brandIcon(size: number, opts: { solid?: boolean } = {}): PixelCanvas {
    const slime = renderSlime(CHO.colours, 0);
    const c = new PixelCanvas(size, size);
    if (opts.solid) c.fill(0, 0, size, size, hex(SKY));
    c.blit(slime, Math.floor((size - slime.w) / 2), Math.floor((size - slime.h) / 2), 1);
    return c;
}

/** Whole-number scaling: a base square of `base` pixels drawn `scale` times larger. */
export function scaledIcon(base: number, scale: number, opts: { solid?: boolean } = {}): PixelCanvas {
    const small = brandIcon(base, opts);
    const c = new PixelCanvas(base * scale, base * scale);
    c.blit(small, 0, 0, scale);
    return c;
}
