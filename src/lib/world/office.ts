/**
 * Office generation and navigation.
 *
 * Floors are deterministic grids: a walled room with rows of desks, aisles
 * between them and landmarks (whiteboard, server rack, coffee machine) on the
 * top wall. Floors grow a row at a time as the CEO hires, which is what makes
 * the world visibly expand.
 */

import { Desk, Floor, Landmark, TileKind, Vec2, isWalkable, tileAt } from './types'
import { id } from './ids'

export const FLOOR_WIDTH = 24
/** x positions that hold desks, in facing pairs with aisles between them. */
const DESK_COLUMNS = [3, 4, 7, 8, 11, 12, 15, 16, 19, 20]
export const DESKS_PER_ROW = DESK_COLUMNS.length
/** Rows above the first desk row (wall + corridor). */
const TOP_MARGIN = 3
/** Rows below the last seat row (corridor + wall). */
const BOTTOM_MARGIN = 3
/** desk row + seat row + aisle row. */
const ROW_PITCH = 3

export function floorHeightForRows(rows: number): number {
    return TOP_MARGIN + Math.max(rows, 1) * ROW_PITCH + BOTTOM_MARGIN
}

export function rowsForDeskCount(deskCount: number): number {
    return Math.max(1, Math.ceil(deskCount / DESKS_PER_ROW))
}

function blankGrid(width: number, height: number): TileKind[] {
    const tiles: TileKind[] = new Array(width * height)
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const edge = x === 0 || y === 0 || x === width - 1 || y === height - 1
            tiles[y * width + x] = edge ? 'wall' : 'floor'
        }
    }
    return tiles
}

function put(tiles: TileKind[], width: number, x: number, y: number, kind: TileKind) {
    tiles[y * width + x] = kind
}

function deskRowY(row: number): number {
    return TOP_MARGIN + row * ROW_PITCH
}

/**
 * Rebuilds the tile grid for `rows` desk rows and returns the desk slots in a
 * stable order, so an existing floor can be regrown without agents losing
 * their seats.
 */
function layout(rows: number): { width: number; height: number; tiles: TileKind[]; slots: { position: Vec2; seat: Vec2 }[]; landmarks: Omit<Landmark, 'id'>[] } {
    const width = FLOOR_WIDTH
    const height = floorHeightForRows(rows)
    const tiles = blankGrid(width, height)
    const slots: { position: Vec2; seat: Vec2 }[] = []

    for (let row = 0; row < rows; row++) {
        const y = deskRowY(row)
        for (const x of DESK_COLUMNS) {
            put(tiles, width, x, y, 'desk')
            slots.push({ position: { x, y }, seat: { x, y: y + 1 } })
        }
    }

    // A rug down the central aisle so the room reads as a room, not a grid.
    for (let y = TOP_MARGIN - 1; y < height - BOTTOM_MARGIN + 1; y++) {
        put(tiles, width, 9, y, 'rug')
        put(tiles, width, 10, y, 'rug')
    }

    const doorX = Math.floor(width / 2)
    put(tiles, width, doorX, height - 1, 'door')

    const landmarks: Omit<Landmark, 'id'>[] = [
        { kind: 'whiteboard', position: { x: 5, y: 0 }, seat: { x: 5, y: 1 }, label: 'Whiteboard' },
        { kind: 'server', position: { x: 13, y: 0 }, seat: { x: 13, y: 1 }, label: 'Server rack' },
        { kind: 'coffee', position: { x: 19, y: 0 }, seat: { x: 19, y: 1 }, label: 'Coffee machine' },
        { kind: 'plant', position: { x: 1, y: height - 2 }, seat: { x: 2, y: height - 2 }, label: 'Ficus' },
        { kind: 'plant', position: { x: width - 2, y: height - 2 }, seat: { x: width - 3, y: height - 2 }, label: 'Ficus' },
        { kind: 'door', position: { x: doorX, y: height - 1 }, seat: { x: doorX, y: height - 2 }, label: 'Lobby door' },
    ]
    for (const lm of landmarks) {
        if (lm.kind !== 'door') put(tiles, width, lm.position.x, lm.position.y, lm.kind)
    }

    return { width, height, tiles, slots, landmarks }
}

export function createFloor(companyId: string | null, name: string, palette: string, deskCount = DESKS_PER_ROW): Floor {
    const rows = rowsForDeskCount(deskCount)
    const { width, height, tiles, slots, landmarks } = layout(rows)
    const floorId = id('floor')

    return {
        id: floorId,
        companyId,
        name,
        width,
        height,
        tiles,
        palette,
        desks: slots.map((slot, i) => ({
            id: id('desk'),
            floorId,
            position: slot.position,
            seat: slot.seat,
            agentId: null,
            label: `Desk ${i + 1}`,
        })),
        landmarks: landmarks.map((lm) => ({ ...lm, id: id('lm') })),
    }
}

/**
 * Makes sure the floor has at least `deskCount` desks, adding rows (and
 * height) as needed. Existing desks keep their ids and occupants.
 */
export function ensureDeskCapacity(floor: Floor, deskCount: number): boolean {
    if (floor.desks.length >= deskCount) return false

    const rows = rowsForDeskCount(deskCount)
    const { width, height, tiles, slots, landmarks } = layout(rows)

    floor.width = width
    floor.height = height
    floor.tiles = tiles
    floor.landmarks = landmarks.map((lm, i) => ({ ...lm, id: floor.landmarks[i]?.id ?? id('lm') }))

    floor.desks = slots.map((slot, i) => {
        const existing = floor.desks[i]
        if (existing) {
            existing.position = slot.position
            existing.seat = slot.seat
            return existing
        }
        return {
            id: id('desk'),
            floorId: floor.id,
            position: slot.position,
            seat: slot.seat,
            agentId: null,
            label: `Desk ${i + 1}`,
        }
    })
    return true
}

export function findFreeDesk(floor: Floor): Desk | null {
    return floor.desks.find((d) => d.agentId === null) ?? null
}

export function deskById(floor: Floor, deskId: string | null): Desk | null {
    if (!deskId) return null
    return floor.desks.find((d) => d.id === deskId) ?? null
}

export function landmarkByKind(floor: Floor, kind: Landmark['kind']): Landmark | null {
    return floor.landmarks.find((l) => l.kind === kind) ?? null
}

/** The tile just inside the door — where new hires appear. */
export function entrance(floor: Floor): Vec2 {
    const door = floor.landmarks.find((l) => l.kind === 'door')
    return door ? { ...door.seat } : { x: Math.floor(floor.width / 2), y: floor.height - 2 }
}

const NEIGHBOURS: Vec2[] = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
]

/**
 * Breadth-first path from `from` to `to` over walkable tiles. Returns the tiles
 * to step through, excluding the start. Empty when already there or unreachable.
 */
export function findPath(floor: Floor, from: Vec2, to: Vec2): Vec2[] {
    if (from.x === to.x && from.y === to.y) return []
    if (!isWalkable(floor, to.x, to.y)) {
        const fallback = NEIGHBOURS.map((n) => ({ x: to.x + n.x, y: to.y + n.y })).find((p) =>
            isWalkable(floor, p.x, p.y)
        )
        if (!fallback) return []
        to = fallback
    }

    const key = (p: Vec2) => p.y * floor.width + p.x
    const cameFrom = new Map<number, number>()
    const seen = new Set<number>([key(from)])
    let frontier: Vec2[] = [from]

    while (frontier.length) {
        const next: Vec2[] = []
        for (const cur of frontier) {
            for (const n of NEIGHBOURS) {
                const p = { x: cur.x + n.x, y: cur.y + n.y }
                const k = key(p)
                if (seen.has(k) || !isWalkable(floor, p.x, p.y)) continue
                seen.add(k)
                cameFrom.set(k, key(cur))
                if (p.x === to.x && p.y === to.y) {
                    const path: Vec2[] = []
                    let node = k
                    while (node !== key(from)) {
                        path.push({ x: node % floor.width, y: Math.floor(node / floor.width) })
                        node = cameFrom.get(node)!
                    }
                    return path.reverse()
                }
                next.push(p)
            }
        }
        frontier = next
    }
    return []
}

/** A walkable tile next to `target`, used when two agents talk face to face. */
export function adjacentFreeTile(floor: Floor, target: Vec2, occupied: Vec2[]): Vec2 | null {
    for (const n of NEIGHBOURS) {
        const p = { x: target.x + n.x, y: target.y + n.y }
        if (!isWalkable(floor, p.x, p.y)) continue
        if (occupied.some((o) => o.x === p.x && o.y === p.y)) continue
        return p
    }
    return null
}

export { tileAt, isWalkable }
