/**
 * Where everything in Tempest stands, in tiles.
 *
 * The town is laid out top to bottom so it can only ever grow downward:
 *
 *   the centre     Diablo's study, Rimuru's seat, the council hall — fixed
 *   the districts  one building per department, in cells, creation order
 *   the inn        whoever is not placed anywhere else
 *
 * A building lives in a cell whose position depends only on the department's
 * index and the column count, so adding a department appends a cell and
 * moves nothing that was already built. A team that grows gets more desks
 * inside the same walls. The inn comes last because it is the one thing
 * that changes size with hiring, and nothing is below it to be pushed.
 *
 * Archiving is the one move: a boarded-up house goes to the end of the
 * districts, where it is out of the way of the work.
 *
 * Pure. Coordinates are in tiles and may be fractional for people; the
 * renderer multiplies by the tile size.
 */

import type { Floor } from '@/lib/delphi/floor';
import { hash } from './residents';

export const TILE = 16;
/** A department's cell: a sign row, the house, a row for what it has earned. */
export const CELL_W = 11;
export const CELL_H = 10;
export const CENTRE_H = 7;
/** Desks per house before the rest of the team waits outside. */
export const DESKS_PER_HOUSE = 8;
/** Projects worth of ornaments a plot can show. */
export const DECOR_CAP = 5;

export const DECOR = ['lamp', 'garden', 'banner', 'statue', 'tree'] as const;
export type DecorKind = (typeof DECOR)[number];

export interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface Point {
    x: number;
    y: number;
}

export interface Desk extends Point {
    agentId: string;
    /** False when the agent is at a desk elsewhere: a nameplate stands in. */
    occupied: boolean;
}

export type BuildingKind = 'site' | 'house' | 'boarded';

export interface Building {
    id: string;
    name: string;
    kind: BuildingKind;
    /** A house with a project in flight: windows lit, chimney going. */
    busy: boolean;
    rect: Rect;
    desks: Desk[];
    /** Where the department's name goes, over the house. */
    sign: Point;
    /** The quest banner, naming the project in flight. */
    banner: (Point & { text: string }) | null;
    decorations: (Point & { kind: DecorKind })[];
    /** Team members past the last desk, who wait at the inn. */
    overflow: string[];
}

export type Where = 'study' | 'hall' | 'desk' | 'inn';

/** Furniture and ornament: what the town is dressed with, and what idle agents go and use. */
export type FeatureKind =
    | 'bookshelf'
    | 'rugRed'
    | 'rugBlue'
    | 'plant'
    | 'crate'
    | 'barrel'
    | 'fireplace'
    | 'fountain'
    | 'flowerbed'
    | 'well'
    | 'bench'
    | 'carpet'
    | 'longTable'
    | 'tree'
    | 'tree2'
    | 'dummy'
    | 'board';

export interface Feature extends Point {
    kind: FeatureKind;
    /** The house it is in, for a label like "the Global News bookshelf". */
    buildingId?: string;
    /** Where someone stands to use it, when it is something to use. */
    use?: Point;
    /** True when nobody can stand on it. */
    solid: boolean;
}

export interface Place extends Point {
    where: Where;
    /** The building, for a desk. */
    buildingId?: string;
}

export interface Centre {
    rect: Rect;
    study: Rect;
    studyDesk: Point;
    seat: Point;
    scrolls: Point;
    ranga: Point;
    hall: Rect;
    seats: Point[];
    /** The notice board in the plaza, where new outputs are pinned. */
    board: Point;
}

export interface WorldLayout {
    cols: number;
    /** Size in tiles. */
    w: number;
    h: number;
    centre: Centre;
    buildings: Building[];
    inn: { rect: Rect; spots: Point[] };
    /** Where each agent stands, by id. */
    places: Record<string, Place>;
    features: Feature[];
}

export function columnsFor(widthTiles: number): number {
    return Math.max(1, Math.min(4, Math.floor(widthTiles / CELL_W)));
}

export function buildingKind(status: string): BuildingKind {
    if (status === 'archived') return 'boarded';
    if (status === 'active' || status === 'paused') return 'house';
    return 'site';
}

export function layoutWorld(floor: Floor, widthTiles: number): WorldLayout {
    const cols = columnsFor(widthTiles);
    const w = cols * CELL_W;
    const places: Record<string, Place> = {};

    // --- the centre -------------------------------------------------------
    const study: Rect = { x: 0, y: 1, w: 4, h: 5 };
    const studyDesk: Point = { x: study.x + 1, y: study.y + 2 };
    const hall: Rect = { x: w - 5, y: 1, w: 5, h: 5 };
    const seats: Point[] = [0, 1, 2].map((i) => ({ x: hall.x + 0.6 + i * 1.3, y: hall.y + 2 }));
    const plazaLeft = study.x + study.w;
    const plazaRight = hall.x;
    const mid = Math.floor((plazaLeft + plazaRight) / 2);
    const seat: Point = { x: mid, y: 4 };
    const scrolls: Point = { x: mid + 1, y: 4 };
    const ranga: Point = { x: mid - 2, y: 5 };
    const board: Point = { x: plazaLeft, y: 1 };
    const centre: Centre = { rect: { x: 0, y: 0, w, h: CENTRE_H }, study, studyDesk, seat, scrolls, ranga, hall, seats, board };

    const agentsById = new Map(floor.agents.map((a) => [a.id, a]));
    for (const a of floor.agents) {
        if (a.isCeo) places[a.id] = { x: studyDesk.x, y: studyDesk.y + 1, where: 'study' };
    }
    floor.agents
        .filter((a) => a.isBoard)
        .forEach((a, i) => {
            if (i < seats.length) places[a.id] = { x: seats[i].x, y: seats[i].y, where: 'hall' };
        });

    // --- the districts ------------------------------------------------------
    const ordered = [
        ...floor.departments.filter((d) => d.status !== 'archived'),
        ...floor.departments.filter((d) => d.status === 'archived'),
    ];
    const buildings: Building[] = ordered.map((d, i) => {
        const cx = (i % cols) * CELL_W;
        const cy = CENTRE_H + Math.floor(i / cols) * CELL_H;
        const rect: Rect = { x: cx, y: cy + 1, w: 10, h: 8 };
        const kind = buildingKind(d.status);
        const desks: Desk[] = [];
        const overflow: string[] = [];
        d.team.forEach((agentId, k) => {
            if (k >= DESKS_PER_HOUSE) {
                overflow.push(agentId);
                return;
            }
            const x = rect.x + 1 + (k % 4) * 2;
            const y = rect.y + 2 + Math.floor(k / 4) * 3;
            const agent = agentsById.get(agentId);
            const occupied = !!agent && agent.seat === d.id && kind !== 'boarded';
            desks.push({ x, y, agentId, occupied });
            // Standing in front of the desk, so the screen shows over their head.
            if (occupied) places[agentId] = { x, y: y + 1, where: 'desk', buildingId: d.id };
        });
        const decorations = Array.from({ length: Math.min(d.completed, DECOR_CAP) }, (_, k) => ({
            x: rect.x + 1 + k * 2,
            y: rect.y + rect.h,
            kind: DECOR[k % DECOR.length],
        }));
        return {
            id: d.id,
            name: d.name,
            kind,
            busy: kind === 'house' && d.project !== null,
            rect,
            desks,
            sign: { x: rect.x, y: cy },
            banner: kind === 'house' && d.project ? { x: rect.x + rect.w - 1, y: cy, text: d.project.title } : null,
            decorations,
            overflow,
        };
    });

    // --- the inn --------------------------------------------------------------
    const rowsOfCells = Math.ceil(ordered.length / cols);
    // One free row before the inn, so the street under the last houses leads somewhere.
    const innY = CENTRE_H + rowsOfCells * CELL_H + 1;
    const waiting = floor.agents.filter((a) => !places[a.id]);
    const perRow = Math.max(1, Math.floor((w - 2) / 1.5));
    const innRows = Math.max(1, Math.ceil(waiting.length / perRow));
    const inn = { rect: { x: 0, y: innY, w, h: 2 + innRows * 2 }, spots: [] as Point[] };
    waiting.forEach((a, i) => {
        const spot = { x: 1 + (i % perRow) * 1.5, y: innY + 1 + Math.floor(i / perRow) * 2 };
        inn.spots.push(spot);
        places[a.id] = { ...spot, where: 'inn' };
    });

    const features = dress({ cols, w, h: inn.rect.y + inn.rect.h, centre, buildings, inn, places, features: [] }, ordered.length);
    return { cols, w, h: inn.rect.y + inn.rect.h, centre, buildings, inn, places, features };
}

/**
 * Furniture inside and ornament outside, placed by rule and by the hash of
 * what it belongs to, so a house keeps its own rug and plant from one load
 * to the next and no two houses are quite alike.
 */
function dress(l: Omit<WorldLayout, 'features'> & { features: Feature[] }, districts: number): Feature[] {
    const f: Feature[] = [];
    const solid = (kind: FeatureKind, x: number, y: number, use?: Point, buildingId?: string) => f.push({ kind, x, y, use, solid: true, buildingId });
    const soft = (kind: FeatureKind, x: number, y: number, buildingId?: string) => f.push({ kind, x, y, solid: false, buildingId });
    const { centre } = l;

    // The study: a shelf behind the desk.
    solid('bookshelf', centre.study.x + 2, centre.study.y + 1, { x: centre.study.x + 2, y: centre.study.y + 2 });

    // The hall: the council table along the back, carpet where the board stands.
    for (let x = centre.hall.x + 1; x < centre.hall.x + centre.hall.w - 1; x++) solid('longTable', x, centre.hall.y + 1);
    for (let x = centre.hall.x + 1; x < centre.hall.x + centre.hall.w - 1; x++) soft('carpet', x, centre.hall.y + 2);

    // The notice board, against the study's wall, read from the tile below it.
    solid('board', centre.board.x, centre.board.y, { x: centre.board.x, y: centre.board.y + 1 });

    // The plaza: a fountain when there is room for one, benches beside it, a well when there is not.
    const plazaLeft = centre.study.x + centre.study.w;
    const plazaRight = centre.hall.x;
    const mid = Math.floor((plazaLeft + plazaRight) / 2);
    if (plazaRight - plazaLeft >= 9) {
        solid('fountain', mid, 2, { x: mid, y: 3 });
        solid('bench', plazaLeft + 1, 2, { x: plazaLeft + 1, y: 3 });
        solid('bench', plazaRight - 2, 2, { x: plazaRight - 2, y: 3 });
    } else if (plazaRight - plazaLeft >= 3) {
        solid('well', mid, 2, { x: mid, y: 3 });
    }
    // The yard: a training dummy on the plaza's edge, by the hall.
    solid('dummy', l.w - 1, CENTRE_H - 1, { x: l.w - 2, y: CENTRE_H - 1 });

    // Each house: a shelf and a plant along the back, a rug between the desk rows,
    // a crate or a barrel in a corner, flowerbeds either side of the door.
    for (const b of l.buildings) {
        if (b.kind !== 'house') continue;
        const r = b.rect;
        const h = hash(b.id);
        // Read standing between the shelf and the first desk, not on the desk.
        solid('bookshelf', r.x + 1, r.y + 1, { x: r.x + 2, y: r.y + 2 }, b.id);
        solid('plant', r.x + r.w - 2, r.y + 1, undefined, b.id);
        for (let x = r.x + 2; x < r.x + r.w - 2; x++) soft(h % 2 ? 'rugRed' : 'rugBlue', x, r.y + 4, b.id);
        solid(h % 3 === 0 ? 'barrel' : 'crate', r.x + r.w - 2, r.y + r.h - 2, { x: r.x + r.w - 2, y: r.y + r.h - 3 }, b.id);
        const door = r.x + Math.floor(r.w / 2);
        solid('flowerbed', door - 1, r.y + r.h, { x: door - 1, y: r.y + r.h + 1 }, b.id);
        solid('flowerbed', door + 1, r.y + r.h, { x: door + 1, y: r.y + r.h + 1 }, b.id);
    }

    // The inn: a barrel at one end of the bar, the fire at the other.
    const inn = l.inn.rect;
    const back = inn.y + inn.h - 2;
    solid('barrel', inn.x + 1, back, { x: inn.x + 1, y: back - 1 });
    solid('fireplace', inn.x + inn.w - 2, back, { x: inn.x + inn.w - 3, y: back - 1 });

    // Trees fill the cells no department has taken yet.
    const rows = Math.ceil(districts / l.cols);
    for (let i = districts; i < rows * l.cols; i++) {
        const cx = (i % l.cols) * CELL_W;
        const cy = CENTRE_H + Math.floor(i / l.cols) * CELL_H;
        solid('tree', cx + 2, cy + 2);
        solid('tree2', cx + 6, cy + 4);
        solid('tree', cx + 4, cy + 7);
        solid('tree2', cx + 8, cy + 1);
    }
    return f;
}
