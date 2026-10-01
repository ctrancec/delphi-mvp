/**
 * Getting around Tempest on foot.
 *
 * A walkability grid is read off the layout — walls, roofs, desks, counters
 * and ornaments block; floors, doors, lanes and grass do not — and a
 * breadth-first search finds the shortest way between two tiles. So a
 * character leaving a desk goes out through the door and along the lane,
 * and never through a wall, whatever the town looks like that day.
 *
 * Pure, and small: a town of thirty by sixty tiles is eighteen hundred
 * cells, which a search crosses in well under a millisecond.
 */

import { CENTRE_H, type Building, type Place, type Point, type Rect, type WorldLayout } from './world-layout';

export interface Walkability {
    w: number;
    h: number;
    /** 1 where nobody can stand. */
    blocked: Uint8Array;
}

const key = (w: number, x: number, y: number) => y * w + x;

function block(g: Walkability, x: number, y: number) {
    if (x < 0 || y < 0 || x >= g.w || y >= g.h) return;
    g.blocked[key(g.w, x, y)] = 1;
}

/** Which way a house faces: its front wall, with the door, is at the bottom or the top. */
export type Facing = 'down' | 'up';

/** The front-wall tile that is the door. Shared with the scene so they agree. */
export function doorOf(r: Rect, facing: Facing = 'down'): Point {
    return { x: r.x + Math.floor(r.w / 2), y: facing === 'down' ? r.y + r.h - 1 : r.y };
}

/** The inn sits at the bottom of town and faces up into it. */
export const INN_FACING: Facing = 'up';

function blockHouse(g: Walkability, r: Rect, opts: { door: boolean; facing?: Facing }) {
    const door = doorOf(r, opts.facing ?? 'down');
    for (let x = r.x; x < r.x + r.w; x++) {
        for (const y of [r.y, r.y + r.h - 1]) {
            if (!(opts.door && x === door.x && y === door.y)) block(g, x, y);
        }
    }
    for (let y = r.y + 1; y < r.y + r.h - 1; y++) {
        block(g, r.x, y);
        block(g, r.x + r.w - 1, y);
    }
}

export function walkability(layout: WorldLayout): Walkability {
    const g: Walkability = { w: layout.w, h: layout.h, blocked: new Uint8Array(layout.w * layout.h) };
    const { centre } = layout;

    blockHouse(g, centre.study, { door: true });
    block(g, centre.studyDesk.x, centre.studyDesk.y);
    blockHouse(g, centre.hall, { door: true });
    block(g, centre.seat.x, centre.seat.y);
    block(g, centre.scrolls.x, centre.scrolls.y);
    // The lanterns at the plaza's corners.
    block(g, centre.study.x + centre.study.w, centre.rect.h - 2);
    block(g, centre.hall.x - 1, centre.rect.h - 2);

    for (const b of layout.buildings) {
        blockHouse(g, b.rect, { door: b.kind !== 'boarded' });
        for (const d of b.desks) block(g, d.x, d.y);
        for (const deco of b.decorations) block(g, deco.x, deco.y);
    }

    for (const feat of layout.features) if (feat.solid) block(g, feat.x, feat.y);

    blockHouse(g, layout.inn.rect, { door: true, facing: INN_FACING });
    // The bar runs along the back wall, which for a house facing up is the bottom.
    for (const x of counterTiles(layout.inn.rect)) block(g, x, layout.inn.rect.y + layout.inn.rect.h - 2);

    return g;
}

/** The columns the inn's counters stand in, shared with the scene. */
export function counterTiles(inn: Rect): number[] {
    const xs: number[] = [];
    for (let x = inn.x + 1; x < inn.x + inn.w - 1; x += 2) xs.push(x);
    return xs;
}

export function isBlocked(g: Walkability, x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= g.w || y >= g.h) return true;
    return g.blocked[key(g.w, x, y)] === 1;
}

/** The nearest tile someone can stand on, searching outward a little. */
function nearestOpen(g: Walkability, p: Point): Point | null {
    const x0 = Math.round(p.x);
    const y0 = Math.round(p.y);
    for (let r = 0; r <= 2; r++) {
        for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
                if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
                if (!isBlocked(g, x0 + dx, y0 + dy)) return { x: x0 + dx, y: y0 + dy };
            }
        }
    }
    return null;
}

/**
 * The shortest walk between two tiles, as the tiles stepped on, both ends
 * included. Empty when there is no way through.
 */
export function findPath(g: Walkability, from: Point, to: Point): Point[] {
    const a = nearestOpen(g, from);
    const b = nearestOpen(g, to);
    if (!a || !b) return [];
    if (a.x === b.x && a.y === b.y) return [a];

    const prev = new Int32Array(g.w * g.h).fill(-1);
    const seen = new Uint8Array(g.w * g.h);
    const queue: number[] = [key(g.w, a.x, a.y)];
    seen[queue[0]] = 1;
    const target = key(g.w, b.x, b.y);
    let head = 0;
    while (head < queue.length) {
        const cur = queue[head++];
        if (cur === target) break;
        const cx = cur % g.w;
        const cy = Math.floor(cur / g.w);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (isBlocked(g, nx, ny)) continue;
            const k = key(g.w, nx, ny);
            if (seen[k]) continue;
            seen[k] = 1;
            prev[k] = cur;
            queue.push(k);
        }
    }
    if (!seen[target]) return [];

    const path: Point[] = [];
    for (let k = target; k !== -1; k = prev[k]) path.push({ x: k % g.w, y: Math.floor(k / g.w) });
    return path.reverse();
}

/**
 * The walk from one place to another: the path through doors and lanes,
 * with the exact (possibly fractional) endpoints at either end so the
 * walker leaves from and arrives at precisely where they stand.
 */
export function routeBetween(g: Walkability, from: Point, to: Point): Point[] {
    const path = findPath(g, from, to);
    if (path.length === 0) return [from, to];
    const route: Point[] = [from, ...path];
    route.push(to);
    // Drop interior points that sit on a straight line, so motion is linear per segment.
    const out: Point[] = [route[0]];
    for (let i = 1; i < route.length - 1; i++) {
        const p = route[i - 1], c = route[i], n = route[i + 1];
        const straight = (c.x - p.x) * (n.y - c.y) === (c.y - p.y) * (n.x - c.x);
        if (!straight) out.push(c);
    }
    out.push(route[route.length - 1]);
    return out;
}

/** Spots worth strolling to: the plaza, and the lane in front of the inn. */
export function hangouts(layout: WorldLayout, g: Walkability): Point[] {
    const spots: Point[] = [];
    const { centre } = layout;
    for (let y = 2; y < CENTRE_H - 1; y++) {
        for (let x = centre.study.x + centre.study.w + 1; x < centre.hall.x - 1; x++) {
            if (!isBlocked(g, x, y)) spots.push({ x, y });
        }
    }
    const laneY = layout.inn.rect.y - 1;
    for (let x = 1; x < layout.w - 1; x += 2) if (!isBlocked(g, x, laneY)) spots.push({ x, y: laneY });
    return spots;
}

/** The desk tile a seated character stands in front of, which is what to leave from. */
export function standingTile(place: Place): Point {
    return { x: Math.round(place.x), y: Math.round(place.y) };
}

export type { Building };
