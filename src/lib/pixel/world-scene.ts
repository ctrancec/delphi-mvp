/**
 * The town with nobody in it.
 *
 * Everything that does not move is painted once from the layout: ground,
 * paths, the centre, each department's house, the inn. The living layer —
 * people, bubbles, smoke, the glow of a screen in use — goes over this every
 * frame, so the frame costs a copy and a few dozen sprites, not a town.
 *
 * Pure, so a test can draw the whole thing and look at the pixels.
 */

import { PixelCanvas, type Grid } from './canvas';
import { hash } from './residents';
import { TILES, TOWN, type TileId } from './sprites/tiles';
import { TILE, type Building, type Rect, type WorldLayout } from './world-layout';

const at = (c: PixelCanvas, id: TileId, x: number, y: number) => c.draw(TILES[id], Math.round(x * TILE), Math.round(y * TILE), TOWN);

/** A cut-away house: a roof strip, a floor you can see into, walls at the sides and front. */
function house(c: PixelCanvas, r: Rect, opts: { kind: Building['kind']; lit: boolean; door?: boolean; floor?: TileId }) {
    const floor: TileId = opts.floor ?? 'floor';
    if (opts.kind === 'site') {
        for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) at(c, 'path', x, y);
        for (let x = r.x; x < r.x + r.w; x++) {
            at(c, 'scaffold', x, r.y);
            at(c, 'scaffold', x, r.y + r.h - 1);
        }
        for (let y = r.y; y < r.y + r.h; y++) {
            at(c, 'scaffold', r.x, y);
            at(c, 'scaffold', r.x + r.w - 1, y);
        }
        return;
    }
    const boarded = opts.kind === 'boarded';
    for (let y = r.y + 1; y < r.y + r.h - 1; y++) for (let x = r.x + 1; x < r.x + r.w - 1; x++) at(c, floor, x, y);
    for (let y = r.y + 1; y < r.y + r.h - 1; y++) {
        at(c, 'wallSide', r.x, y);
        at(c, 'wallSide', r.x + r.w - 1, y);
    }
    for (let x = r.x; x < r.x + r.w; x++) at(c, boarded ? 'roofDark' : 'roof', x, r.y);
    const front = r.y + r.h - 1;
    for (let x = r.x; x < r.x + r.w; x++) {
        const i = x - r.x;
        const window = i > 0 && i < r.w - 1 && i % 3 === 1;
        at(c, window ? (boarded ? 'boarded' : opts.lit ? 'windowLit' : 'windowDark') : 'wall', x, front);
    }
    if (opts.door !== false) at(c, boarded ? 'boarded' : 'door', r.x + Math.floor(r.w / 2), front);
}

export function drawScene(layout: WorldLayout): PixelCanvas {
    const c = new PixelCanvas(layout.w * TILE, layout.h * TILE);

    // Ground: grass, with tufts where the hash says.
    for (let y = 0; y < layout.h; y++) {
        for (let x = 0; x < layout.w; x++) at(c, hash(`${x},${y}`) % 7 === 0 ? 'grassTuft' : 'grass', x, y);
    }

    // Lanes between the cells, so the districts read as streets.
    for (const b of layout.buildings) {
        for (let y = b.rect.y - 1; y <= b.rect.y + b.rect.h; y++) at(c, 'path', b.rect.x + b.rect.w, y);
        for (let x = b.rect.x; x <= b.rect.x + b.rect.w; x++) at(c, 'path', x, b.rect.y + b.rect.h);
    }

    // The centre: a stone plaza between the study and the hall.
    const { centre } = layout;
    for (let y = 1; y < centre.rect.h; y++) {
        for (let x = centre.study.x + centre.study.w; x < centre.hall.x; x++) at(c, 'stoneFloor', x, y);
    }
    for (let x = 0; x < layout.w; x++) at(c, 'path', x, centre.rect.h - 1);
    house(c, centre.study, { kind: 'house', lit: true });
    at(c, 'deskOn', centre.studyDesk.x, centre.studyDesk.y);
    house(c, centre.hall, { kind: 'house', lit: true, floor: 'stoneFloor' });
    at(c, 'banner', centre.hall.x, centre.hall.y - 1 < 0 ? centre.hall.y : centre.hall.y);
    at(c, 'banner', centre.hall.x + centre.hall.w - 1, centre.hall.y);
    at(c, 'cushion', centre.seat.x, centre.seat.y);
    at(c, 'lantern', centre.study.x + centre.study.w, centre.rect.h - 2);
    at(c, 'lantern', centre.hall.x - 1, centre.rect.h - 2);

    // The districts.
    for (const b of layout.buildings) {
        house(c, b.rect, { kind: b.kind, lit: b.busy });
        if (b.kind !== 'site') at(c, 'chimney', b.rect.x + b.rect.w - 2, b.rect.y);
        at(c, 'sign', b.sign.x, b.sign.y);
        for (const d of b.desks) at(c, d.occupied ? 'deskOff' : 'nameplate', d.x, d.y);
        for (const deco of b.decorations) at(c, deco.kind, deco.x, deco.y);
    }

    // The inn: a long low house with a bar along the back.
    house(c, layout.inn.rect, { kind: 'house', lit: true, door: true });
    for (let x = layout.inn.rect.x + 1; x < layout.inn.rect.x + layout.inn.rect.w - 1; x += 2) at(c, 'counter', x, layout.inn.rect.y + 1);

    return c;
}

/** The desk tiles to repaint each frame for a screen in use: the one of the agent at it. */
export function deskTile(frame: number): Grid {
    return frame % 2 ? TILES.deskOn : TILES.deskOn2;
}
