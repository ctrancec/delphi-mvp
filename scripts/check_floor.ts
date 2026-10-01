/**
 * Prove the town reads the organisation right.
 *
 * Every agent's pose comes from one derived state, and the derivation has a
 * precedence: a stopped system beats everything, a running task beats the
 * clock, an approval beats a fresh failure, and so on. Get one rung wrong and
 * the town lies — an agent typing away while the system is off, a cheer over
 * a failure. Each rung is asserted here against deriveFloor on plain rows,
 * and readFloor is run once against a small fake database to show the
 * selects compose. No network, no model call.
 */

import { deriveFloor, DONE_WINDOW_MS, readFloor, STUCK_WINDOW_MS, type FloorInput } from '../src/lib/delphi/floor';
import { DELPHI_SLUG, type Db } from '../src/lib/delphi/db';
import { CELL_H, CENTRE_H, columnsFor, DECOR_CAP, layoutWorld } from '../src/lib/pixel/world-layout';
import { doorOf, findPath, hangouts, isBlocked, routeBetween, walkability } from '../src/lib/pixel/world-path';
import { frameCount } from '../src/lib/pixel/character';
import { appearance, createLife, freeToRoam, stepLife, type Life } from '../src/lib/pixel/life';

const G = '\x1b[32m', R = '\x1b[31m', D = '\x1b[2m', RS = '\x1b[0m';

let failed = 0;
const ok = (cond: boolean, label: string, note = '') => {
    if (!cond) failed++;
    console.log(`  ${cond ? G + '✓' : R + '✗'}${RS} ${label.padEnd(64)}${note ? D + note + RS : ''}`);
};

const NOW = new Date('2026-10-01T12:00:00Z');
const ago = (msBack: number) => new Date(NOW.getTime() - msBack).toISOString();
const RUNNING = { mode: 'running' as const, reason: 'switch' as const, detail: 'on' };

/** A workspace with two departments, a shared analyst, and the board. */
function base(): FloorInput {
    return {
        agents: [
            { id: 'ceo', slug: DELPHI_SLUG, name: 'Diablo', title: 'Chief Executive', avatar_seed: null, is_board: false },
            { id: 'shuna', slug: 'research-analyst', name: 'Shuna', title: 'Senior Research Analyst', avatar_seed: 'vera-quinn', is_board: false },
            { id: 'beni', slug: 'market-analyst', name: 'Benimaru', title: 'Market Analyst', avatar_seed: 'nadia-brandt', is_board: false },
            { id: 'gobta', slug: 'social-publisher', name: 'Gobta', title: 'Social Publisher', avatar_seed: 'wren-hollis', is_board: false },
            { id: 'carrera', slug: 'llr-liabilities', name: 'Carrera', title: 'Liabilities Reviewer', avatar_seed: 'adaeze-nwosu', is_board: true },
        ],
        departments: [
            { id: 'news', name: 'Global News', status: 'active', created_at: '2026-09-01T00:00:00Z' },
            { id: 'markets', name: 'Markets', status: 'active', created_at: '2026-09-02T00:00:00Z' },
        ],
        hires: [
            { department_id: 'news', agent_id: 'shuna', seq: 1 },
            { department_id: 'markets', agent_id: 'shuna', seq: 1 },
            { department_id: 'markets', agent_id: 'beni', seq: 2 },
        ],
        projects: [
            { id: 'p1', department_id: 'markets', status: 'running', title: 'Screen value stocks', created_at: '2026-09-30T00:00:00Z' },
            { id: 'p0', department_id: 'markets', status: 'done', title: 'Last week', created_at: '2026-09-20T00:00:00Z' },
        ],
        tasks: [],
        runs: [],
        deliberating: 0,
        pendingApprovals: 0,
        effective: RUNNING,
    };
}

const stateOf = (input: FloorInput, id: string) => deriveFloor(input, NOW).agents.find((a) => a.id === id)!;

console.log('\nPrecedence, rung by rung');
{
    let input = base();
    input.tasks = [{ id: 't1', project_id: 'p1', agent_id: 'shuna', status: 'running', title: 'Gather filings' }];
    input.runs = [{ task_id: 't1', status: 'running', started_at: ago(60_000), finished_at: null }];
    input.effective = { mode: 'stopped', reason: 'stopped', detail: 'off' };
    ok(stateOf(input, 'shuna').state === 'off', '1. the system off beats a running task');

    input = base();
    input.tasks = [{ id: 't1', project_id: 'p1', agent_id: 'shuna', status: 'running', title: 'Gather filings' }];
    input.runs = [{ task_id: 't1', status: 'running', started_at: ago(60_000), finished_at: null }];
    input.effective = { mode: 'paused', reason: 'out_of_hours', detail: 'night' };
    const working = stateOf(input, 'shuna');
    ok(working.state === 'working' && working.task?.title === 'Gather filings' && working.since === ago(60_000), '2. a running task beats paused, and says which and since when');
    ok(working.seat === 'markets' && working.task?.departmentId === 'markets', 'and seats them at the desk they are working for');
    ok(stateOf(input, 'beni').state === 'asleep', '3. everyone else is asleep out of hours');

    input = base();
    input.tasks = [
        { id: 't2', project_id: 'p1', agent_id: 'beni', status: 'awaiting_approval', title: 'Publish the list' },
        { id: 't3', project_id: 'p1', agent_id: 'beni', status: 'failed', title: 'Earlier try' },
    ];
    input.runs = [{ task_id: 't3', status: 'failed', started_at: ago(3_600_000), finished_at: ago(3_500_000) }];
    ok(stateOf(input, 'beni').state === 'waiting_on_you', '4. waiting on the CHO beats a fresh failure');

    input = base();
    input.tasks = [{ id: 't3', project_id: 'p1', agent_id: 'beni', status: 'failed', title: 'Earlier try' }];
    input.runs = [{ task_id: 't3', status: 'failed', started_at: ago(3_600_000), finished_at: ago(3_500_000) }];
    ok(stateOf(input, 'beni').state === 'stuck' && stateOf(input, 'beni').since === ago(3_500_000), '5. a failure in the last day is stuck');
    input.runs = [{ task_id: 't3', status: 'failed', started_at: ago(STUCK_WINDOW_MS + 60_000), finished_at: ago(STUCK_WINDOW_MS + 1) }];
    ok(stateOf(input, 'beni').state === 'idle', 'but an older one has been looked at: idle');
    input.tasks = [{ id: 't3', project_id: 'p1', agent_id: 'beni', status: 'pending', title: 'Retry' }];
    ok(stateOf(input, 'beni').state === 'queued', 'and a retried one is queued, not stuck');

    input = base();
    input.deliberating = 1;
    ok(stateOf(input, 'carrera').state === 'reviewing' && stateOf(input, 'shuna').state === 'idle', '6. a deliberating review puts the board to work, nobody else');
    input.deliberating = 0;
    ok(stateOf(input, 'carrera').state === 'idle', 'the board idles between reviews rather than reading as available');

    input = base();
    input.projects.push({ id: 'p2', department_id: 'news', status: 'planning', title: 'Morning brief', created_at: '2026-10-01T00:00:00Z' });
    ok(stateOf(input, 'ceo').state === 'planning', '7. a project in planning is the CEO planning');
    input = base();
    ok(stateOf(input, 'ceo').state === 'idle', 'and the CEO idles otherwise, never reading as for hire');

    input = base();
    input.tasks = [{ id: 't4', project_id: 'p1', agent_id: 'shuna', status: 'pending', title: 'Next step' }];
    ok(stateOf(input, 'shuna').state === 'queued' && stateOf(input, 'shuna').task?.title === 'Next step', '8. a pending task in a project in flight is queued');
    input.tasks = [{ id: 't4', project_id: 'p0', agent_id: 'shuna', status: 'pending', title: 'Leftover' }];
    ok(stateOf(input, 'shuna').state === 'idle', 'a pending task in a finished project is not');

    input = base();
    input.tasks = [{ id: 't5', project_id: 'p1', agent_id: 'shuna', status: 'done', title: 'Gather filings' }];
    input.runs = [{ task_id: 't5', status: 'done', started_at: ago(600_000), finished_at: ago(300_000) }];
    ok(stateOf(input, 'shuna').state === 'done' && stateOf(input, 'shuna').since === ago(300_000), '9. a finish in the last quarter hour is a cheer');
    input.runs = [{ task_id: 't5', status: 'done', started_at: ago(DONE_WINDOW_MS + 600_000), finished_at: ago(DONE_WINDOW_MS + 1) }];
    ok(stateOf(input, 'shuna').state === 'idle', 'and one older than that is over: idle');

    input = base();
    ok(stateOf(input, 'shuna').state === 'idle', '10. hired with nothing to do is idle');
    ok(stateOf(input, 'gobta').state === 'available', '11. not hired anywhere is available');
}

console.log('\nThe organisation');
{
    const input = base();
    const floor = deriveFloor(input, NOW);
    const shuna = floor.agents.find((a) => a.id === 'shuna')!;
    ok(floor.agents.filter((a) => a.id === 'shuna').length === 1 && shuna.departments.join() === 'news,markets', 'an agent hired twice appears once, listing both departments in order');
    ok(shuna.seat === 'news', 'and sits at the first that hired them when idle');
    const markets = floor.departments.find((d) => d.id === 'markets')!;
    ok(markets.team.join() === 'shuna,beni' && markets.project?.title === 'Screen value stocks' && markets.completed === 1, 'a department knows its team, its project in flight, and what it has finished');
    ok(floor.departments.map((d) => d.id).join() === 'news,markets', 'departments come in creation order');

    input.departments.push({ id: 'old', name: 'Old', status: 'archived', created_at: '2026-08-01T00:00:00Z' });
    input.hires.push({ department_id: 'old', agent_id: 'gobta', seq: 1 });
    const again = deriveFloor(input, NOW);
    ok(again.agents.find((a) => a.id === 'gobta')!.state === 'available', 'a hire in an archived department does not count');
    ok(again.departments[0].id === 'old' && again.departments[0].status === 'archived', 'the archived department is still listed, for its boarded-up house');

    const ceo = floor.agents.find((a) => a.id === 'ceo')!;
    const board = floor.agents.find((a) => a.id === 'carrera')!;
    ok(ceo.isCeo && ceo.seat === null && board.isBoard && board.seat === null, 'the CEO and the board have no desk in a department');
    ok(floor.pendingApprovals === 0 && floor.system.mode === 'running' && floor.at === NOW.toISOString(), 'the summary carries the system and the clock');
}

console.log('\nThe map');
{
    const WIDTHS = [13, 19, 43];
    ok(columnsFor(13) === 1 && columnsFor(19) === 1 && columnsFor(43) === 3 && columnsFor(400) === 4, 'columns follow the width: one on the panels, three on a desk, four at most');

    const dept = (i: number, extra: Partial<FloorInput['departments'][number]> = {}) => ({ id: `d${i}`, name: `Dept ${i}`, status: 'active', created_at: `2026-09-${String(10 + i).padStart(2, '0')}T00:00:00Z`, ...extra });
    const withDepartments = (n: number) => {
        const input = base();
        input.departments = Array.from({ length: n }, (_, i) => dept(i));
        input.hires = input.departments.flatMap((d, i) => [{ department_id: d.id, agent_id: i % 2 ? 'shuna' : 'beni', seq: 1 }]);
        return deriveFloor(input, NOW);
    };

    const rects = (floor: Parameters<typeof layoutWorld>[0], width: number) => layoutWorld(floor, width).buildings.map((b) => `${b.id}:${b.rect.x},${b.rect.y}`);
    let stable = true;
    for (const width of WIDTHS) {
        for (let n = 1; n < 9; n++) {
            const before = rects(withDepartments(n), width);
            const after = rects(withDepartments(n + 1), width);
            if (after.slice(0, n).join('|') !== before.join('|')) stable = false;
        }
    }
    ok(stable, 'adding a department never moves one already built, at every width');

    const one = layoutWorld(withDepartments(1), 13);
    const grown = (() => {
        const input = base();
        input.departments = [dept(0)];
        input.hires = ['shuna', 'beni', 'gobta'].map((id, i) => ({ department_id: 'd0', agent_id: id, seq: i + 1 }));
        return layoutWorld(deriveFloor(input, NOW), 13);
    })();
    ok(grown.buildings[0].rect.x === one.buildings[0].rect.x && grown.buildings[0].rect.y === one.buildings[0].rect.y && grown.buildings[0].desks.length === 3, 'a team that grows gets desks inside the same walls');

    const centreBefore = JSON.stringify(layoutWorld(withDepartments(2), 43).centre);
    const centreAfter = JSON.stringify(layoutWorld(withDepartments(7), 43).centre);
    ok(centreBefore === centreAfter, 'the centre is where it was, however many districts');

    const quiet = layoutWorld(withDepartments(2), 13);
    const crowded = (() => {
        const floor = withDepartments(2);
        floor.agents.push({ ...floor.agents[3], id: 'extra1', slug: 'x1', name: 'Extra', state: 'available', departments: [], seat: null });
        floor.agents.push({ ...floor.agents[3], id: 'extra2', slug: 'x2', name: 'Extra 2', state: 'available', departments: [], seat: null });
        return layoutWorld(floor, 13);
    })();
    ok(JSON.stringify(crowded.buildings.map((b) => b.rect)) === JSON.stringify(quiet.buildings.map((b) => b.rect)) && crowded.inn.rect.y === quiet.inn.rect.y, 'more people at the inn move no building: the inn is at the bottom');
    ok(crowded.h >= quiet.h, 'the town only ever grows');

    const archivedLast = (() => {
        const input = base();
        input.departments = [dept(0, { status: 'archived' }), dept(1), dept(2)];
        return layoutWorld(deriveFloor(input, NOW), 43);
    })();
    ok(archivedLast.buildings.map((b) => b.id).join() === 'd1,d2,d0' && archivedLast.buildings[2].kind === 'boarded', 'an archived department is boarded up at the end');

    const kinds = (() => {
        const input = base();
        input.departments = [dept(0, { status: 'draft' }), dept(1, { status: 'hiring' }), dept(2, { status: 'awaiting_approval' }), dept(3, { status: 'active' }), dept(4, { status: 'paused' })];
        return layoutWorld(deriveFloor(input, NOW), 43).buildings.map((b) => b.kind).join();
    })();
    ok(kinds === 'site,site,site,house,house', 'draft, hiring and awaiting approval are sites; active and paused are houses', kinds);

    const busy = layoutWorld(base() && deriveFloor(base(), NOW), 43);
    const markets = busy.buildings.find((b) => b.id === 'markets')!;
    const news = busy.buildings.find((b) => b.id === 'news')!;
    ok(markets.busy && markets.banner?.text === 'Screen value stocks' && !news.busy && news.banner === null, 'a house with a project in flight is busy and flies its banner');
    ok(markets.decorations.length === 1 && markets.decorations[0].kind === 'lamp', 'one finished project, one ornament');
    const rich = (() => {
        const input = base();
        input.projects = Array.from({ length: 9 }, (_, i) => ({ id: `q${i}`, department_id: 'markets', status: 'done', title: `Q${i}`, created_at: '2026-09-01T00:00:00Z' }));
        return layoutWorld(deriveFloor(input, NOW), 43).buildings.find((b) => b.id === 'markets')!;
    })();
    ok(rich.decorations.length === DECOR_CAP, 'and the ornaments stop at the cap', `${rich.decorations.length}`);

    const floor = deriveFloor(base(), NOW);
    const map = layoutWorld(floor, 43);
    const placed = floor.agents.map((a) => map.places[a.id]);
    ok(placed.every(Boolean), 'everyone has a place');
    const spots = placed.map((p) => `${p.where}:${p.x},${p.y}`);
    ok(new Set(spots).size === spots.length, 'and no two share one');
    ok(map.places['ceo'].where === 'study' && map.places['carrera'].where === 'hall' && map.places['gobta'].where === 'inn', 'the CEO is in the study, the board in the hall, the unhired at the inn');
    ok(map.places['shuna'].where === 'desk' && map.places['shuna'].buildingId === 'news', 'a shared agent sits at one desk');
    const marketsDesks = map.buildings.find((b) => b.id === 'markets')!.desks;
    ok(marketsDesks.find((d) => d.agentId === 'shuna')?.occupied === false && marketsDesks.find((d) => d.agentId === 'beni')?.occupied === true, 'and a nameplate holds their other desk');
    ok(map.buildings[0].rect.y === CENTRE_H + 1 && map.inn.rect.y === CENTRE_H + CELL_H + 1, 'districts start under the centre; the inn a street below the districts');
}

console.log('\nOn foot');
{
    const floor = deriveFloor(base(), NOW);
    for (const width of [13, 43]) {
        const map = layoutWorld(floor, width);
        const g = walkability(map);
        const news = map.buildings.find((b) => b.id === 'news')!;
        const desk = news.desks[0];
        ok(isBlocked(g, desk.x, desk.y) && !isBlocked(g, desk.x, desk.y + 1), `a desk blocks and the tile in front of it does not (${width} wide)`);
        ok(isBlocked(g, news.rect.x, news.rect.y + 3) && isBlocked(g, news.rect.x + 2, news.rect.y), 'walls and roofs block');
        const door = doorOf(news.rect);
        ok(!isBlocked(g, door.x, door.y) && isBlocked(g, door.x - 1, door.y), 'the door is the one open tile in the front wall');

        const places = floor.agents.map((a) => map.places[a.id]);
        let every = true;
        let throughWalls = 0;
        for (const from of places) {
            for (const to of places) {
                if (from === to) continue;
                const path = findPath(g, from, to);
                if (path.length === 0) every = false;
                for (let i = 1; i < path.length; i++) {
                    const step = Math.abs(path[i].x - path[i - 1].x) + Math.abs(path[i].y - path[i - 1].y);
                    if (step !== 1 || isBlocked(g, path[i].x, path[i].y)) throughWalls++;
                }
            }
        }
        ok(every, 'everyone can walk to everyone else');
        ok(throughWalls === 0, 'one tile at a time, never through a wall');

        const shuna = map.places['shuna'];
        const inn = map.inn.spots[0];
        const path = findPath(g, shuna, inn);
        const outDoor = doorOf(news.rect);
        ok(path.some((p) => p.x === outDoor.x && p.y === outDoor.y), 'leaving a house goes through its door');
        const route = routeBetween(g, shuna, inn);
        ok(route[0] === shuna && route[route.length - 1] === inn && route.length < path.length + 2, 'a route keeps the exact ends and only the corners', `${route.length} corners for ${path.length} tiles`);
        ok(hangouts(map, g).length > 3 && hangouts(map, g).every((h) => !isBlocked(g, h.x, h.y)), 'there are places to stroll to, all standable');
    }
    ok(frameCount('walk') === 2, 'a walk has two frames');
}

console.log('\nA life of their own');
{
    const TICK = 100;
    const left = (life: Life, id: string) => { const w = life.walkers.get(id); return !!w && Math.abs(w.x - w.home.x) + Math.abs(w.y - w.home.y) > 0.5; };

    // Everyone idle: people get up.
    let floor = deriveFloor(base(), NOW);
    let map = layoutWorld(floor, 43);
    let life = createLife(map);
    const went: Record<string, boolean> = {};
    const did: Record<string, Set<string>> = {};
    for (let t = 0; t < 240_000; t += TICK) {
        stepLife(life, floor, map, t, TICK);
        for (const [id, w] of life.walkers) {
            if (left(life, id)) went[id] = true;
            if (w.phase === 'doing' && w.activity) (did[id] ??= new Set()).add(w.activity.kind);
        }
    }
    const roamers = floor.agents.filter(freeToRoam).map((a) => a.id);
    ok(roamers.every((id) => went[id]), 'in four minutes every idle agent has been out', roamers.filter((id) => !went[id]).join(', ') || roamers.join(', '));
    ok(Object.values(did).some((s) => s.size > 1), 'and done more than one kind of thing', [...new Set(Object.values(did).flatMap((s) => [...s]))].join(', '));
    ok(Object.values(did).some((s) => s.has('chat')), 'including a chat between two of them');

    // Determinism: the same town on the same clock does the same things.
    const again = createLife(layoutWorld(floor, 43));
    for (let t = 0; t < 120_000; t += TICK) stepLife(again, floor, again.layout, t, TICK);
    const once = createLife(layoutWorld(floor, 43));
    for (let t = 0; t < 120_000; t += TICK) stepLife(once, floor, once.layout, t, TICK);
    ok([...again.walkers.values()].every((w) => { const o = once.walkers.get(w.id)!; return o.x === w.x && o.y === w.y && o.phase === w.phase; }), 'twice over, every position and phase matches');

    // Nobody stands where someone else is doing something.
    let shared = 0;
    for (let t = 0; t < 180_000; t += TICK) {
        stepLife(life, floor, map, 240_000 + t, TICK);
        const spots = [...life.walkers.values()].filter((w) => w.phase === 'doing').map((w) => `${Math.round(w.x)},${Math.round(w.y)}`);
        if (new Set(spots).size !== spots.length) shared++;
    }
    ok(shared === 0, 'no two people use the same spot at once');

    // Work keeps you at your desk, and work arriving brings you back.
    const input = base();
    input.tasks = [{ id: 't1', project_id: 'p1', agent_id: 'shuna', status: 'running', title: 'Gather filings' }];
    input.runs = [{ task_id: 't1', status: 'running', started_at: ago(60_000), finished_at: null }];
    floor = deriveFloor(input, NOW);
    map = layoutWorld(floor, 43);
    life = createLife(map);
    let moved = false;
    for (let t = 0; t < 180_000; t += TICK) { stepLife(life, floor, map, t, TICK); if (left(life, 'shuna')) moved = true; }
    ok(!moved, 'someone working never leaves their desk');

    const idleFloor = deriveFloor(base(), NOW);
    const idleMap = layoutWorld(idleFloor, 43);
    life = createLife(idleMap);
    let t = 0;
    while (t < 240_000 && !left(life, 'shuna')) { stepLife(life, idleFloor, idleMap, t, TICK); t += TICK; }
    ok(left(life, 'shuna'), 'an idle agent goes out', `after ${Math.round(t / 1000)}s`);
    const workFloor = deriveFloor(input, NOW);
    const workMap = layoutWorld(workFloor, 43);
    const start = t;
    const w = life.walkers.get('shuna')!;
    while (t < start + 60_000 && w.phase !== 'home') { stepLife(life, workFloor, workMap, t, TICK); t += TICK; }
    ok(!left(life, 'shuna') && w.activity === null && w.phase === 'home', 'and comes straight back when work arrives', `${Math.round((t - start) / 1000)}s on foot`);
    let stayed = true;
    for (let s = t; s < t + 60_000; s += TICK) { stepLife(life, workFloor, workMap, s, TICK); if (left(life, 'shuna')) stayed = false; }
    ok(stayed, 'and stays put while the work lasts');

    // A new hire walks from the inn to their desk.
    const before = deriveFloor(base(), NOW);
    const beforeMap = layoutWorld(before, 43);
    life = createLife(beforeMap);
    stepLife(life, before, beforeMap, 0, TICK);
    const innSpot = { ...life.walkers.get('gobta')! };
    const hired = base();
    hired.hires.push({ department_id: 'news', agent_id: 'gobta', seq: 2 });
    const afterFloor = deriveFloor(hired, NOW);
    const afterMap = layoutWorld(afterFloor, 43);
    stepLife(life, afterFloor, afterMap, 100, TICK);
    const g = life.walkers.get('gobta')!;
    ok(g.phase === 'moving' && g.path.length > 2 && Math.abs(g.x - innSpot.x) < 1, 'a new hire sets off from the inn for their desk, on foot');
    let arrived = false;
    for (let s = 200; s < 60_000 && !arrived; s += TICK) {
        stepLife(life, afterFloor, afterMap, s, TICK);
        arrived = g.phase === 'home' && Math.abs(g.x - afterMap.places['gobta'].x) < 0.01 && Math.abs(g.y - afterMap.places['gobta'].y) < 0.01;
    }
    ok(arrived, 'and arrives');
    ok(appearance(g, 60_000).walking === false && appearance({ ...g, phase: 'going', leg: 0, path: [{ x: 0, y: 0 }, { x: 1, y: 0 }] }, 0).pose === 'walk', 'appearance says walking only while on the move');
}

console.log('\nReading from a database');
{
    type Row = Record<string, unknown>;
    const tables: Record<string, Row[]> = {
        delphi_agents: base().agents.map((a) => ({ ...a, workspace_id: 'ws', archived_at: null })),
        delphi_departments: base().departments.map((d) => ({ ...d, workspace_id: 'ws' })),
        delphi_hires: base().hires.map((h) => ({ ...h, workspace_id: 'ws' })),
        delphi_projects: base().projects.map((p) => ({ ...p, workspace_id: 'ws' })),
        delphi_tasks: [
            { id: 't1', workspace_id: 'ws', project_id: 'p1', agent_id: 'shuna', status: 'running', title: 'Gather filings' },
            { id: 't9', workspace_id: 'ws', project_id: 'p0', agent_id: 'beni', status: 'done', title: 'Old finish' },
        ],
        delphi_task_runs: [
            { workspace_id: 'ws', task_id: 't1', status: 'running', started_at: ago(60_000), finished_at: null },
            { workspace_id: 'ws', task_id: 't9', status: 'done', started_at: ago(400_000), finished_at: ago(200_000) },
        ],
        delphi_reviews: [{ workspace_id: 'ws', status: 'deliberating' }],
        delphi_approvals: [{ workspace_id: 'ws', status: 'pending' }, { workspace_id: 'ws', status: 'pending' }],
        delphi_system_state: [],
    };
    const queries: string[] = [];
    function builder(table: string) {
        const filters: ((r: Row) => boolean)[] = [];
        let head = false;
        const run = () => {
            const rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
            queries.push(table);
            return head ? { data: null, count: rows.length, error: null } : { data: rows.map((r) => ({ ...r })), error: null, count: rows.length };
        };
        const b: Record<string, unknown> = {
            select: (_c: string, opts?: { head?: boolean }) => ((head = !!opts?.head), b),
            eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), b),
            is: (k: string, v: unknown) => (filters.push((r) => (r[k] ?? null) === v), b),
            in: (k: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[k])), b),
            gte: (k: string, v: string) => (filters.push((r) => String(r[k]) >= v), b),
            maybeSingle: () => ({ then: (res: (v: unknown) => unknown) => Promise.resolve({ data: run().data?.[0] ?? null, error: null }).then(res) }),
            then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
        };
        return b;
    }
    const db = { from: builder } as unknown as Db;

    readFloor(db, 'ws', NOW)
        .then((floor) => {
            ok(floor.agents.find((a) => a.id === 'shuna')?.state === 'working', 'readFloor sees the running task through the project in flight');
            ok(floor.agents.find((a) => a.id === 'beni')?.state === 'done', 'and a finish in a done project through its recent run');
            ok(floor.agents.find((a) => a.id === 'carrera')?.state === 'reviewing' && floor.deliberating === 1, 'and counts the review the board is on');
            ok(floor.pendingApprovals === 2, 'and the approvals waiting on the CHO');
            ok(queries.filter((q) => q === 'delphi_tasks').length === 2 && queries.length === 10, 'in two rounds of lean selects', `${queries.length} queries`);
        })
        .catch((e) => {
            ok(false, 'readFloor threw', String(e));
        })
        .finally(() => {
            console.log(`\n${failed ? R + failed + ' failed' : G + 'all passed'}${RS}\n`);
            process.exit(failed ? 1 : 0);
        });
}
