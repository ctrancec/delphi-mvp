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
    const centre: Centre = { rect: { x: 0, y: 0, w, h: CENTRE_H }, study, studyDesk, seat, scrolls, ranga, hall, seats };

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
    const innY = CENTRE_H + rowsOfCells * CELL_H;
    const waiting = floor.agents.filter((a) => !places[a.id]);
    const perRow = Math.max(1, Math.floor((w - 2) / 1.5));
    const innRows = Math.max(1, Math.ceil(waiting.length / perRow));
    const inn = { rect: { x: 0, y: innY, w, h: 2 + innRows * 2 }, spots: [] as Point[] };
    waiting.forEach((a, i) => {
        const spot = { x: 1 + (i % perRow) * 1.5, y: innY + 1 + Math.floor(i / perRow) * 2 };
        inn.spots.push(spot);
        places[a.id] = { ...spot, where: 'inn' };
    });

    return { cols, w, h: inn.rect.y + inn.rect.h, centre, buildings, inn, places };
}
