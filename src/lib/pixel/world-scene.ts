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

import { palette, PixelCanvas, type Grid, type Palette, type Rgba } from './canvas';
import { hash } from './residents';
import { TILES, TOWN, type TileId } from './sprites/tiles';
import { TILE, type Building, type FeatureKind, type Rect, type WorldLayout } from './world-layout';
import { counterTiles, doorOf, INN_FACING, type Facing } from './world-path';

const at = (c: PixelCanvas, id: TileId, x: number, y: number, colours: Palette = TOWN) => c.draw(TILES[id], Math.round(x * TILE), Math.round(y * TILE), colours);

/** Roofs come in a few colours, so a street is not one blue line. */
export const ROOFS: readonly Palette[] = [
    TOWN,
    palette({ ...roofSlots('#3f8f8a', '#2f6b67') }),
    palette({ ...roofSlots('#7a5aa8', '#5a4080') }),
    palette({ ...roofSlots('#a8553f', '#80402f') }),
];
function roofSlots(r: string, R: string): Record<string, string> {
    return { o: '#1a1423', r, R, S: '#6c7280' };
}

const css = (c: Rgba | undefined): string => (c ? `#${[c[0], c[1], c[2]].map((n) => n.toString(16).padStart(2, '0')).join('')}` : '#000000');

/** A house's roof, as CSS colours, for a plaque off the canvas that wants to match it. */
export function roofFor(id: string): { tile: string; shade: string } {
    const p = ROOFS[hash(id) % ROOFS.length];
    return { tile: css(p.r), shade: css(p.R) };
}

/** A house's walls, as CSS colours: the base and what is drawn over it. */
export function wallFor(id: string): { material: Material; base: string; detail: string } {
    const material = materialFor(id);
    switch (material) {
        case 'timber':
            return { material, base: css(TOWN.d), detail: css(TOWN.t) };
        case 'brick':
            return { material, base: css(TOWN.e), detail: css(TOWN.E) };
        default:
            return { material, base: css(TOWN.s), detail: css(TOWN.S) };
    }
}

/** A cut-away house: a roof strip, a floor you can see into, walls at the sides and front. */
/** What a house is built of: stone, timber or brick, by the hash of its id. */
export type Material = 'stone' | 'timber' | 'brick';
const MATERIALS: Material[] = ['stone', 'timber', 'brick'];
export const materialFor = (id: string): Material => MATERIALS[hash(`wall:${id}`) % MATERIALS.length];
const FRONT: Record<Material, TileId> = { stone: 'wall', timber: 'wallTimber', brick: 'wallBrick' };
const SIDE: Record<Material, TileId> = { stone: 'wallSide', timber: 'wallSideTimber', brick: 'wallSideBrick' };

function house(c: PixelCanvas, r: Rect, opts: { kind: Building['kind']; lit: boolean; door?: boolean; floor?: TileId; facing?: Facing; roof?: Palette; material?: Material }) {
    const floor: TileId = opts.floor ?? 'floor';
    const facing: Facing = opts.facing ?? 'down';
    const roofY = facing === 'down' ? r.y : r.y + r.h - 1;
    const front = facing === 'down' ? r.y + r.h - 1 : r.y;
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
    const material = opts.material ?? 'stone';
    for (let y = r.y + 1; y < r.y + r.h - 1; y++) {
        at(c, SIDE[material], r.x, y);
        at(c, SIDE[material], r.x + r.w - 1, y);
    }
    for (let x = r.x; x < r.x + r.w; x++) at(c, boarded ? 'roofDark' : 'roof', x, roofY, boarded ? TOWN : opts.roof);
    for (let x = r.x; x < r.x + r.w; x++) {
        const i = x - r.x;
        const window = i > 0 && i < r.w - 1 && i % 3 === 1;
        at(c, window ? (boarded ? 'boarded' : opts.lit ? 'windowLit' : 'windowDark') : FRONT[material], x, front);
    }
    if (opts.door !== false) at(c, boarded ? 'boarded' : 'door', doorOf(r, facing).x, front);
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
    house(c, centre.hall, { kind: 'house', lit: true, floor: 'stoneFloor', roof: ROOFS[2] });
    at(c, 'banner', centre.hall.x, centre.hall.y - 1 < 0 ? centre.hall.y : centre.hall.y);
    at(c, 'banner', centre.hall.x + centre.hall.w - 1, centre.hall.y);
    at(c, 'cushion', centre.seat.x, centre.seat.y);
    at(c, 'lantern', centre.study.x + centre.study.w, centre.rect.h - 2);
    at(c, 'lantern', centre.hall.x - 1, centre.rect.h - 2);

    // The districts.
    for (const b of layout.buildings) {
        house(c, b.rect, { kind: b.kind, lit: b.busy, roof: ROOFS[hash(b.id) % ROOFS.length], material: materialFor(b.id) });
        if (b.kind !== 'site') at(c, 'chimney', b.rect.x + b.rect.w - 2, b.rect.y);
        at(c, 'sign', b.sign.x, b.sign.y);
        for (const d of b.desks) at(c, d.occupied ? 'deskOff' : 'nameplate', d.x, d.y);
        for (const deco of b.decorations) at(c, deco.kind, deco.x, deco.y);
    }

    // The inn: a long low house facing the town, with a bar along the back.
    house(c, layout.inn.rect, { kind: 'house', lit: true, door: true, facing: INN_FACING, roof: ROOFS[3], material: 'timber' });
    for (const x of counterTiles(layout.inn.rect)) at(c, 'counter', x, layout.inn.rect.y + layout.inn.rect.h - 2);

    // What the town is dressed with: soft things first, so a rug sits under a chair.
    for (const feat of layout.features.filter((x) => !x.solid)) at(c, tileFor(feat.kind), feat.x, feat.y);
    for (const feat of layout.features.filter((x) => x.solid)) at(c, tileFor(feat.kind), feat.x, feat.y);

    return c;
}

/** A feature's still tile; the fire and the water get their first frame. */
export function tileFor(kind: FeatureKind): TileId {
    if (kind === 'fireplace') return 'fireplaceA';
    if (kind === 'fountain') return 'fountainA';
    return kind;
}

/** The animated tiles, by frame: fire and water move. */
export function animatedTile(kind: 'fireplace' | 'fountain', frame: number): Grid {
    if (kind === 'fireplace') return frame % 2 ? TILES.fireplaceA : TILES.fireplaceB;
    return Math.floor(frame / 2) % 2 ? TILES.fountainA : TILES.fountainB;
}

/** The desk tiles to repaint each frame for a screen in use: the one of the agent at it. */
export function deskTile(frame: number): Grid {
    return frame % 2 ? TILES.deskOn : TILES.deskOn2;
}
