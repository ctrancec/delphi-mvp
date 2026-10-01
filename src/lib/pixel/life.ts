/**
 * A life of their own.
 *
 * An agent with nothing to do does not stand at a desk all day. On a
 * schedule seeded from their id they get up and go somewhere: the shelf in
 * their own house to read, the inn for a drink or a nap by the fire, the
 * fountain, the flowerbeds, the yard with the dummy, over to Rimuru to bow,
 * or across the plaza to find someone else at a loose end and talk. What
 * they pick leans to who they are. The moment work arrives they drop it
 * and walk back to their desk; someone working never leaves it.
 *
 * All of it is a pure step function over plain state, driven by the clock
 * the caller passes in, so the same town on the same clock does the same
 * things — which is what lets a test say "she left", "he never did", and
 * "they met".
 */

import type { Floor, FloorAgent } from '@/lib/delphi/floor';
import type { Bubble } from './animate';
import { CEO_SLUG } from './cast/names';
import { hash, random } from './residents';
import type { Pose } from './sprites/body';
import type { Feature, FeatureKind, Place, Point, WorldLayout } from './world-layout';
import { counterTiles, hangouts, routeBetween, walkability, type Walkability } from './world-path';

/** Tiles per second. */
export const SPEED = 3;
/** Seconds at home between outings. */
const WAIT = { min: 8, max: 30 };

export type ActivityKind = 'stroll' | 'fountain' | 'read' | 'drink' | 'nap' | 'garden' | 'train' | 'greet' | 'chat' | 'tinker' | 'speech';

export interface Activity {
    kind: ActivityKind;
    /** In plain words, lower case, for a sentence: "reading at the Global News shelf". */
    label: string;
    pose: Pose;
    bubble: Bubble | null;
    spot: Point;
    facing: 1 | -1;
    /** Seconds it lasts once begun. */
    seconds: number;
    partnerId?: string;
    /** In a chat, the one who started it speaks first. */
    lead?: boolean;
}

export type Phase = 'home' | 'going' | 'doing' | 'returning' | 'moving';

export interface Walker {
    id: string;
    x: number;
    y: number;
    facing: 1 | -1;
    path: Point[];
    /** Index of the point being walked towards. */
    leg: number;
    home: Place;
    activity: Activity | null;
    phase: Phase;
    /** When the next outing may start, or when the current one ends. */
    at: number;
    rng: () => number;
}

export interface Life {
    walkers: Map<string, Walker>;
    walk: Walkability;
    layout: WorldLayout;
}

interface Recipe {
    pose: Pose;
    bubble: Bubble | null;
    min: number;
    max: number;
}

const RECIPES: Record<ActivityKind, Recipe> = {
    stroll: { pose: 'idle', bubble: null, min: 6, max: 12 },
    fountain: { pose: 'idle', bubble: null, min: 8, max: 16 },
    read: { pose: 'think', bubble: null, min: 10, max: 20 },
    drink: { pose: 'idle', bubble: null, min: 10, max: 18 },
    nap: { pose: 'sleep', bubble: 'zzz', min: 15, max: 25 },
    garden: { pose: 'type', bubble: null, min: 8, max: 14 },
    train: { pose: 'stand', bubble: null, min: 10, max: 18 },
    greet: { pose: 'bow', bubble: null, min: 4, max: 7 },
    chat: { pose: 'idle', bubble: 'dots', min: 10, max: 20 },
    tinker: { pose: 'type', bubble: null, min: 8, max: 14 },
    speech: { pose: 'raise', bubble: 'bang', min: 8, max: 14 },
};

/** What each character reaches for; repetition is weight. */
const TASTES: Record<string, ActivityKind[]> = {
    [CEO_SLUG]: ['greet', 'read', 'read'],
    'research-analyst': ['read', 'read', 'fountain', 'garden', 'chat'],
    'global-news-monitor': ['stroll', 'stroll', 'fountain', 'read'],
    'market-analyst': ['train', 'train', 'drink', 'chat'],
    writer: ['drink', 'chat', 'greet', 'stroll'],
    critic: ['train', 'read', 'stroll', 'chat'],
    'data-engineer': ['tinker', 'tinker', 'drink', 'chat'],
    editor: ['greet', 'chat', 'chat', 'stroll'],
    'video-editor': ['tinker', 'train', 'drink'],
    'motion-designer': ['fountain', 'fountain', 'garden', 'chat'],
    'caption-writer': ['garden', 'garden', 'fountain', 'read'],
    'social-strategist': ['speech', 'speech', 'chat', 'train'],
    'social-publisher': ['nap', 'nap', 'drink', 'chat'],
    archivist: ['read', 'read', 'nap', 'drink'],
    'llr-liabilities': ['read', 'chat', 'stroll'],
    'llr-risk': ['chat', 'drink', 'stroll'],
    'llr-legal': ['read', 'read', 'stroll'],
};
const EVERYTHING: ActivityKind[] = ['stroll', 'fountain', 'read', 'drink', 'nap', 'garden', 'train', 'greet', 'chat', 'tinker'];

const between = (rng: () => number, min: number, max: number) => min + rng() * (max - min);
const pick = <T>(rng: () => number, list: readonly T[]): T => list[Math.floor(rng() * list.length)];
const same = (a: Point, b: Point) => Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01;
const tileKey = (p: Point) => `${Math.round(p.x)},${Math.round(p.y)}`;

/** Only the idle have a life of their own; everyone else is spoken for. */
export function freeToRoam(a: FloorAgent): boolean {
    return a.state === 'idle' || a.state === 'available';
}

export function createLife(layout: WorldLayout): Life {
    return { walkers: new Map(), walk: walkability(layout), layout };
}

function spawn(id: string, home: Place, now: number): Walker {
    const rng = random(hash(`life:${id}`));
    return {
        id,
        x: home.x,
        y: home.y,
        facing: 1,
        path: [],
        leg: 0,
        home,
        activity: null,
        phase: 'home',
        // Staggered, so a fresh town does not all get up at once.
        at: now + between(rng, 2, 20) * 1000,
        rng,
    };
}

function head(w: Walker, g: Walkability, to: Point, phase: Phase) {
    w.path = routeBetween(g, { x: w.x, y: w.y }, to);
    w.leg = 1;
    w.phase = phase;
}

/** Advance along the path; true once the end is reached. */
function move(w: Walker, dtMs: number): boolean {
    let budget = (SPEED * dtMs) / 1000;
    while (budget > 0 && w.leg < w.path.length) {
        const target = w.path[w.leg];
        const dx = target.x - w.x;
        const dy = target.y - w.y;
        const dist = Math.hypot(dx, dy);
        if (dx !== 0) w.facing = dx > 0 ? 1 : -1;
        if (dist <= budget) {
            w.x = target.x;
            w.y = target.y;
            budget -= dist;
            w.leg++;
        } else {
            w.x += (dx / dist) * budget;
            w.y += (dy / dist) * budget;
            budget = 0;
        }
    }
    return w.leg >= w.path.length;
}

/** Where to use a feature, if it is in reach: the agent's own house first, then anywhere. */
function usable(layout: WorldLayout, kind: FeatureKind, agent: FloorAgent, taken: Set<string>): Feature | null {
    const all = layout.features.filter((f) => f.kind === kind && f.use && !taken.has(tileKey(f.use)));
    const own = all.filter((f) => f.buildingId && agent.departments.includes(f.buildingId));
    const pool = own.length ? own : all;
    return pool.length ? pool[hash(`${agent.id}:${kind}:${all.length}`) % pool.length] : null;
}

function houseName(layout: WorldLayout, floor: Floor, f: Feature): string {
    const name = f.buildingId ? floor.departments.find((d) => d.id === f.buildingId)?.name : null;
    return name ? `the ${name} ` : 'the ';
}

/** Choose an outing for an idle agent, or null when nothing suits right now. */
function choose(life: Life, floor: Floor, agent: FloorAgent, w: Walker, taken: Set<string>, now: number): Activity | null {
    const { layout, walk } = life;
    const tastes = TASTES[agent.slug] ?? EVERYTHING;
    const recipe = (kind: ActivityKind) => RECIPES[kind];
    const seconds = (kind: ActivityKind) => between(w.rng, recipe(kind).min, recipe(kind).max);
    const make = (kind: ActivityKind, label: string, spot: Point, facing: 1 | -1 = 1): Activity => ({
        kind,
        label,
        pose: recipe(kind).pose,
        bubble: recipe(kind).bubble,
        spot,
        facing,
        seconds: seconds(kind),
    });

    // A few tries, since the first choice may be taken or missing from this town.
    for (let attempt = 0; attempt < 4; attempt++) {
        const kind = pick(w.rng, tastes);
        switch (kind) {
            case 'stroll': {
                const spots = hangouts(layout, walk).filter((h) => !taken.has(tileKey(h)));
                if (spots.length) return make('stroll', 'taking a walk', pick(w.rng, spots));
                break;
            }
            case 'fountain': {
                const f = usable(layout, 'fountain', agent, taken) ?? usable(layout, 'bench', agent, taken) ?? usable(layout, 'well', agent, taken);
                if (f?.use) return make('fountain', f.kind === 'fountain' ? 'sitting by the fountain' : f.kind === 'bench' ? 'resting on a bench' : 'resting by the well', f.use);
                break;
            }
            case 'read': {
                const f = usable(layout, 'bookshelf', agent, taken);
                if (f?.use) return make('read', `reading at ${houseName(layout, floor, f)}shelf`, f.use);
                break;
            }
            case 'drink': {
                const back = layout.inn.rect.y + layout.inn.rect.h - 2;
                const spots = counterTiles(layout.inn.rect).map((x) => ({ x, y: back - 1 })).filter((p) => !taken.has(tileKey(p)));
                if (spots.length) return make('drink', 'having a drink at the inn', pick(w.rng, spots));
                break;
            }
            case 'nap': {
                const f = usable(layout, 'fireplace', agent, taken);
                if (f?.use) return make('nap', 'napping by the fire', f.use);
                break;
            }
            case 'garden': {
                const f = usable(layout, 'flowerbed', agent, taken);
                if (f?.use) return make('garden', 'tending the flowers', f.use);
                break;
            }
            case 'train': {
                const f = usable(layout, 'dummy', agent, taken);
                if (f?.use) return make('train', 'training in the yard', f.use);
                break;
            }
            case 'greet': {
                const spot = { x: layout.centre.seat.x, y: layout.centre.seat.y - 1 };
                if (!taken.has(tileKey(spot))) return make('greet', 'greeting Rimuru-sama', spot);
                break;
            }
            case 'tinker': {
                const f = usable(layout, 'crate', agent, taken) ?? usable(layout, 'barrel', agent, taken);
                if (f?.use) return make('tinker', f.kind === 'crate' ? 'sorting the crates' : 'checking the barrels', f.use);
                break;
            }
            case 'speech': {
                const f = usable(layout, 'fountain', agent, taken) ?? usable(layout, 'well', agent, taken);
                if (f?.use) return make('speech', 'making a speech in the plaza', f.use);
                break;
            }
            case 'chat': {
                const others = floor.agents.filter((o) => o.id !== agent.id && freeToRoam(o));
                const partner = others.map((o) => life.walkers.get(o.id)).find((o) => o && o.phase === 'home');
                if (!partner) break;
                const spots = hangouts(layout, walk).filter((h) => !taken.has(tileKey(h)) && !taken.has(tileKey({ x: h.x + 1, y: h.y })) && !walk.blocked[Math.round(h.y) * walk.w + Math.round(h.x) + 1]);
                if (!spots.length) break;
                const spot = pick(w.rng, spots);
                const partnerName = floor.agents.find((o) => o.id === partner.id)?.name ?? 'someone';
                const seconds = between(w.rng, RECIPES.chat.min, RECIPES.chat.max);
                partner.activity = { kind: 'chat', label: `chatting with ${agent.name}`, pose: 'idle', bubble: 'dots', spot: { x: spot.x + 1, y: spot.y }, facing: -1, seconds, partnerId: agent.id, lead: false };
                head(partner, walk, partner.activity.spot, 'going');
                partner.at = now;
                return { kind: 'chat', label: `chatting with ${partnerName}`, pose: 'idle', bubble: 'dots', spot, facing: 1, seconds, partnerId: partner.id, lead: true };
            }
        }
    }
    return null;
}

/** Tiles spoken for by outings in progress, so no two people stand in one. */
function takenTiles(life: Life): Set<string> {
    const taken = new Set<string>();
    for (const w of life.walkers.values()) if (w.activity) taken.add(tileKey(w.activity.spot));
    return taken;
}

function endActivity(life: Life, w: Walker) {
    const partner = w.activity?.partnerId ? life.walkers.get(w.activity.partnerId) : undefined;
    w.activity = null;
    if (partner?.activity?.partnerId === w.id) {
        partner.activity = null;
        if (partner.phase !== 'home') head(partner, life.walk, partner.home, 'returning');
    }
}

/**
 * One tick. `now` is the clock in milliseconds and `dtMs` how much of it
 * passed since the last tick; the layout is the current one, which may
 * have changed since the life was created.
 */
export function stepLife(life: Life, floor: Floor, layout: WorldLayout, now: number, dtMs: number): void {
    if (layout !== life.layout) {
        life.layout = layout;
        life.walk = walkability(layout);
    }
    const { walk } = life;

    // Everyone on the floor has a walker; nobody else does.
    const present = new Set<string>();
    for (const a of floor.agents) {
        const home = layout.places[a.id];
        if (!home) continue;
        present.add(a.id);
        let w = life.walkers.get(a.id);
        if (!w) {
            w = spawn(a.id, home, now);
            life.walkers.set(a.id, w);
        } else if (!same(w.home, home)) {
            // Hired, moved desk, let go: walk to the new place.
            w.home = home;
            endActivity(life, w);
            head(w, walk, home, 'moving');
        }
    }
    for (const id of [...life.walkers.keys()]) if (!present.has(id)) life.walkers.delete(id);

    const taken = takenTiles(life);

    for (const a of floor.agents) {
        const w = life.walkers.get(a.id);
        if (!w) continue;

        // Work arrived: whatever they were doing, it is over, and home they go.
        if (!freeToRoam(a)) {
            if (w.activity) endActivity(life, w);
            if (w.phase === 'going' || w.phase === 'doing') head(w, walk, w.home, 'returning');
            if (w.phase === 'home' && !same(w, w.home)) head(w, walk, w.home, 'moving');
            if (w.phase !== 'home' && move(w, dtMs)) {
                w.phase = 'home';
                w.at = now + between(w.rng, WAIT.min, WAIT.max) * 1000;
            }
            continue;
        }

        switch (w.phase) {
            case 'home': {
                if (!same(w, w.home)) {
                    head(w, walk, w.home, 'moving');
                    break;
                }
                if (w.activity) {
                    // Invited to a chat while standing at home.
                    head(w, walk, w.activity.spot, 'going');
                    break;
                }
                if (now < w.at) break;
                const activity = choose(life, floor, a, w, taken, now);
                if (!activity) {
                    w.at = now + between(w.rng, 4, 10) * 1000;
                    break;
                }
                w.activity = activity;
                taken.add(tileKey(activity.spot));
                head(w, walk, activity.spot, 'going');
                break;
            }
            case 'going': {
                if (move(w, dtMs)) {
                    if (!w.activity) {
                        head(w, walk, w.home, 'returning');
                        break;
                    }
                    w.phase = 'doing';
                    w.facing = w.activity.facing;
                    w.at = now + w.activity.seconds * 1000;
                }
                break;
            }
            case 'doing': {
                if (!w.activity) {
                    head(w, walk, w.home, 'returning');
                    break;
                }
                const partner = w.activity.partnerId ? life.walkers.get(w.activity.partnerId) : undefined;
                // A chat waits for the other to arrive, then runs its course together.
                if (partner && partner.phase === 'going') break;
                if (now >= w.at) {
                    endActivity(life, w);
                    head(w, walk, w.home, 'returning');
                }
                break;
            }
            case 'returning':
            case 'moving': {
                if (move(w, dtMs)) {
                    w.phase = 'home';
                    w.at = now + between(w.rng, WAIT.min, WAIT.max) * 1000;
                }
                break;
            }
        }
    }
}

/** What to draw for a walker right now. */
export function appearance(w: Walker, now: number): { walking: boolean; pose: Pose | null; bubble: Bubble | null; facing: 1 | -1 } {
    const walking = (w.phase === 'going' || w.phase === 'returning' || w.phase === 'moving') && w.leg < w.path.length;
    if (walking) return { walking: true, pose: 'walk', bubble: null, facing: w.facing };
    if (w.phase === 'doing' && w.activity) {
        let bubble = w.activity.bubble;
        // In a chat the bubble passes back and forth every couple of seconds.
        if (w.activity.kind === 'chat') bubble = Math.floor(now / 2000) % 2 === (w.activity.lead ? 0 : 1) ? 'dots' : null;
        return { walking: false, pose: w.activity.pose, bubble, facing: w.activity.facing };
    }
    return { walking: false, pose: null, bubble: null, facing: w.facing };
}

/** A sentence for the card: what the outing is, if there is one. */
export function outingSentence(w: Walker): string | null {
    if (!w.activity) return w.phase === 'moving' || w.phase === 'returning' ? 'Heading back to their desk.' : null;
    const what = w.activity.label.charAt(0).toUpperCase() + w.activity.label.slice(1);
    if (w.phase === 'going') return `Off to go ${w.activity.label}.`;
    if (w.phase === 'doing') return `${what}.`;
    return null;
}
