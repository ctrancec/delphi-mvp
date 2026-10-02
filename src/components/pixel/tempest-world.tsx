'use client';

/**
 * Tempest, live.
 *
 * The town is a canvas at native pixel size, scaled up by CSS so every
 * pixel stays square. The still town is painted once per layout; each frame
 * copies it and lays the living layer over: the agents in the pose their
 * state calls for, a bubble over a head that has something to say, smoke
 * from a house with work going on, fire and water moving, Rimuru on the
 * cushion with the approvals piling up beside them. The light follows the
 * CHO's own clock: dusk and night tint the frame, and lanterns, windows,
 * the inn fire and the desk screens glow after dark.
 *
 * Between frames the idle have a life of their own (see life.ts): they get
 * up, walk through doors and down lanes to the shelf, the inn, the fountain,
 * the yard, to Rimuru or to each other, and come back when work arrives.
 * The clock drives all of it, so a hidden tab costs nothing and the town
 * picks up where the clock is when it returns.
 *
 * Over the canvas sits a transparent layer of real buttons, one per agent,
 * that follow their agent about, so a screen reader hears "Souei, Global
 * News Monitor — working on …" and a tap opens the same card a click does.
 * Department names and quest banners are text in that layer too, because
 * text on a canvas is text you cannot read.
 *
 * Fresh state arrives on a Realtime nudge — any change to a task, a run, a
 * project or an approval — with a slow poll behind it, both only while the
 * town is on screen. The town only shows; running the pipeline stays where
 * it is.
 */

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import type { Floor, FloorAgent, FloorDepartment } from '@/lib/delphi/floor';
import { frameAt, phaseFor, STATES, type AgentState, type Bubble } from '@/lib/pixel/animate';
import { PixelCanvas, type Grid } from '@/lib/pixel/canvas';
import { castFor, CEO, CHO, MASCOT } from '@/lib/pixel/cast';
import { ceremoniesFrom, newestEvent, type Ceremony } from '@/lib/pixel/ceremonies';
import { frameCount, renderCharacter, renderRanga, renderSlime, type Look } from '@/lib/pixel/character';
import { clockWords, daylight, isNight, localHour } from '@/lib/pixel/daylight';
import { appearance, createLife, freeToRoam, outingSentence, startCeremony, stepLife, type Life } from '@/lib/pixel/life';
import { SPRITE_H, SPRITE_W, type Pose } from '@/lib/pixel/sprites/body';
import { BUBBLE_COLOURS, BUBBLES, TILES, TOWN } from '@/lib/pixel/sprites/tiles';
import { animatedTile, deskTile, drawScene } from '@/lib/pixel/world-scene';
import { layoutWorld, TILE, type Building, type Point, type WorldLayout } from '@/lib/pixel/world-layout';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { useReducedMotion } from './agent-sprite';
import { useFrameClock } from './use-frame-clock';

const SCALE = 2;
const FRAME_MS = 125;
const POLL_MS = 60_000;
const NUDGE_TABLES = ['delphi_tasks', 'delphi_task_runs', 'delphi_projects', 'delphi_approvals', 'delphi_events', 'delphi_artifacts'];
const FLOOR_URL = '/api/delphi/floor';

// ---------------------------------------------------------------------------
// Pixels → canvases, once each.
// ---------------------------------------------------------------------------

const canvases = new Map<string, HTMLCanvasElement>();

function toCanvas(key: string, make: () => PixelCanvas): HTMLCanvasElement {
    let el = canvases.get(key);
    if (!el) {
        const px = make();
        el = document.createElement('canvas');
        el.width = px.w;
        el.height = px.h;
        el.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(px.data), px.w, px.h), 0, 0);
        canvases.set(key, el);
    }
    return el;
}

const spriteCanvas = (key: string, look: Look, pose: Pose, frame: number) =>
    toCanvas(`agent|${key}|${pose}|${frame}`, () => renderCharacter(look, pose, frame));

const gridCanvas = (key: string, g: Grid) =>
    toCanvas(key, () => {
        const c = new PixelCanvas(g.w, g.h);
        c.draw(g, 0, 0, TOWN);
        return c;
    });

const tileCanvas = (id: keyof typeof TILES) => gridCanvas(`tile|${id}`, TILES[id]);

const bubbleCanvas = (id: Bubble) =>
    toCanvas(`bubble|${id}`, () => {
        const g = BUBBLES[id];
        const c = new PixelCanvas(g.w, g.h);
        c.draw(g, 0, 0, BUBBLE_COLOURS);
        return c;
    });

const slimeCanvas = (frame: number, asleep: boolean) => toCanvas(`slime|${frame}|${asleep}`, () => renderSlime(CHO.colours, frame, asleep));
const rangaCanvas = (frame: number) => toCanvas(`ranga|${frame}`, () => renderRanga(MASCOT.colours, frame));

/** Every light in town: where, how far it reaches, and its colour. */
function lights(layout: WorldLayout, floor: Floor): { x: number; y: number; r: number; colour: string }[] {
    const out: { x: number; y: number; r: number; colour: string }[] = [];
    const warm = 'rgba(255, 200, 110, A)';
    const cool = 'rgba(150, 220, 255, A)';
    const fire = 'rgba(255, 150, 60, A)';
    const { centre } = layout;
    const lantern = (x: number, y: number) => out.push({ x: x + 0.5, y: y + 0.35, r: 2.6, colour: warm });
    lantern(centre.study.x + centre.study.w, centre.rect.h - 2);
    lantern(centre.hall.x - 1, centre.rect.h - 2);
    const teams = new Map(floor.departments.map((d) => [d.id, d.team.length]));
    const windows = (rect: { x: number; y: number; w: number; h: number }, front: number, strong: boolean) => {
        for (let i = 1; i < rect.w - 1; i++) if (i % 3 === 1) out.push({ x: rect.x + i + 0.5, y: front + 0.5, r: strong ? 2 : 1.4, colour: warm });
    };
    windows(centre.study, centre.study.y + centre.study.h - 1, true);
    windows(centre.hall, centre.hall.y + centre.hall.h - 1, true);
    for (const b of layout.buildings) {
        if (b.kind !== 'house') continue;
        if (b.busy || (teams.get(b.id) ?? 0) > 0) windows(b.rect, b.rect.y + b.rect.h - 1, b.busy);
    }
    windows(layout.inn.rect, layout.inn.rect.y, true);
    for (const f of layout.features) {
        if (f.kind === 'fireplace') out.push({ x: f.x + 0.5, y: f.y + 0.5, r: 3.2, colour: fire });
        if (f.kind === 'fountain') out.push({ x: f.x + 0.5, y: f.y + 0.5, r: 1.6, colour: cool });
    }
    out.push({ x: centre.studyDesk.x + 0.5, y: centre.studyDesk.y + 0.3, r: 1.6, colour: cool });
    return out;
}

/** A frame of a pose from the clock alone: a walk is quick, everything else unhurried. */
function poseFrame(pose: Pose, now: number, seed: string): number {
    const n = frameCount(pose);
    if (n < 2) return 0;
    const fps = pose === 'walk' ? 6 : pose === 'type' ? 5 : 1.5;
    return Math.floor((now / 1000) * fps + phaseFor(seed) * n) % n;
}

// ---------------------------------------------------------------------------
// Words.
// ---------------------------------------------------------------------------

function sinceWords(iso: string | null): string {
    if (!iso) return '';
    try {
        return ` for ${formatDistanceToNow(new Date(iso))}`;
    } catch {
        return '';
    }
}

/** "Working on Gather filings for 12 minutes." */
export function stateSentence(a: FloorAgent): string {
    const task = a.task?.title;
    switch (a.state) {
        case 'working':
            return `Working on ${task ?? 'a task'}${sinceWords(a.since)}.`;
        case 'waiting_on_you':
            return `Waiting on you: ${task ?? 'a step'} needs your approval.`;
        case 'stuck':
            return `Stuck: ${task ?? 'a task'} failed${sinceWords(a.since) ? sinceWords(a.since).replace(' for ', ' ') + ' ago' : ''}.`;
        case 'reviewing':
            return 'Reviewing a deliverable with the board.';
        case 'planning':
            return 'Planning a project.';
        case 'queued':
            return `Queued: ${task ?? 'a task'} is next.`;
        case 'done':
            return `Just finished ${task ?? 'a task'}.`;
        case 'idle':
            return a.isCeo ? 'Nothing to plan right now.' : a.isBoard ? 'Nothing to review right now.' : 'Hired, with nothing to do right now.';
        case 'asleep':
            return 'Asleep: outside working hours.';
        case 'off':
            return 'The system is switched off.';
        case 'available':
            return 'Available to hire.';
    }
}

/** What a house is up to, for its card and its label. */
export function houseSentence(b: Building, d: FloorDepartment | undefined): string {
    if (b.kind === 'boarded') return 'Archived.';
    if (b.kind === 'site') {
        if (d?.status === 'awaiting_approval') return 'The team is waiting on your approval.';
        if (d?.status === 'hiring') return `Being set up: ${CEO.name} is hiring.`;
        return 'A draft, not staffed yet.';
    }
    if (d?.status === 'paused') return 'Paused.';
    return d?.project ? `Working on ${d.project.title}.` : 'Quiet: nothing in flight.';
}

/** A question for Diablo about an agent, as they are right now. */
export function questionAbout(a: FloorAgent): string {
    const t = a.task?.title ? `"${a.task.title}"` : 'their task';
    if (a.isCeo) return 'What are you working on right now, and what comes next?';
    if (a.isBoard) return `What is ${a.name} reviewing for the board?`;
    switch (a.state) {
        case 'working':
            return `What is ${a.name} doing on ${t} right now?`;
        case 'stuck':
            return `Why did ${a.name}'s step ${t} fail, and what do you suggest?`;
        case 'waiting_on_you':
            return `What does ${t} need from me before ${a.name} can continue?`;
        case 'queued':
            return `When will ${a.name} start on ${t}?`;
        case 'done':
            return `What did ${a.name} just finish on ${t}?`;
        case 'available':
            return `Should we hire ${a.name}, and for what?`;
        default:
            return `What should ${a.name} work on next?`;
    }
}

/** A question for Diablo about a house. */
export function questionAboutHouse(b: Building, d: FloorDepartment | undefined): string {
    if (b.kind === 'site') return `When will ${b.name} be ready to start?`;
    if (b.kind === 'boarded') return `What did ${b.name} achieve before it was archived?`;
    return d?.project ? `How is ${b.name} getting on with ${d.project.title}?` : `What should ${b.name} take on next?`;
}

const askHref = (question: string) => `/dashboard/delphi/chat?ask=${encodeURIComponent(question)}`;

function summary(floor: Floor): string {
    const n = (s: AgentState) => floor.agents.filter((a) => a.state === s).length;
    const parts: string[] = [];
    if (n('working')) parts.push(`${n('working')} working`);
    if (n('waiting_on_you')) parts.push(`${n('waiting_on_you')} waiting on you`);
    if (n('stuck')) parts.push(`${n('stuck')} stuck`);
    if (n('queued')) parts.push(`${n('queued')} queued`);
    if (n('reviewing')) parts.push('board reviewing');
    if (!parts.length) parts.push('nothing running');
    parts.push(floor.system.mode === 'running' ? 'system on' : floor.system.mode === 'paused' ? `paused: ${floor.system.detail}` : 'system off');
    return parts.join(' · ');
}

// ---------------------------------------------------------------------------
// The component.
// ---------------------------------------------------------------------------

/** `source` is where fresh readings come from and `pollMs` how often; a preview or a test points them elsewhere. */
export function TempestWorld({ initial, className, source = FLOOR_URL, pollMs = POLL_MS }: { initial: Floor; className?: string; source?: string; pollMs?: number }) {
    const [floor, setFloor] = useState(initial);
    const [tiles, setTiles] = useState(13);
    const [visible, setVisible] = useState(true);
    const [open, setOpen] = useState<string | null>(null);
    const [house, setHouse] = useState<string | null>(null);
    const wrap = useRef<HTMLDivElement>(null);
    const canvas = useRef<HTMLCanvasElement>(null);
    const still = useRef<HTMLCanvasElement | null>(null);
    const painted = useRef(-1);
    const life = useRef<Life | null>(null);
    const lastTick = useRef(0);
    const buttons = useRef(new Map<string, HTMLButtonElement>());
    const clock = useRef<HTMLSpanElement>(null);
    // The log as far as the town has seen it, and what is owed from what came after.
    const seen = useRef(newestEvent(initial));
    const owed = useRef<Ceremony[]>([]);
    const reduced = useReducedMotion();

    const layout = useMemo(() => layoutWorld(floor, tiles), [floor, tiles]);
    const agents = useMemo(() => new Map(floor.agents.map((a) => [a.id, a])), [floor]);
    const lit = useMemo(() => lights(layout, floor), [layout, floor]);

    // Width → tiles, so the districts take as many columns as fit.
    useEffect(() => {
        const el = wrap.current;
        if (!el) return;
        const measure = () => setTiles(Math.max(11, Math.floor(el.clientWidth / (TILE * SCALE))));
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    // Off screen means off: no frames and no fetching.
    useEffect(() => {
        const el = wrap.current;
        if (!el) return;
        const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.05 });
        io.observe(el);
        return () => io.disconnect();
    }, []);

    // The still town, once per layout.
    useEffect(() => {
        const px = drawScene(layout);
        const el = document.createElement('canvas');
        el.width = px.w;
        el.height = px.h;
        el.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(px.data), px.w, px.h), 0, 0);
        still.current = el;
        painted.current = -1;
    }, [layout]);

    /** Where an agent is right now: on their walk, or at their place. */
    const whereIs = useCallback(
        (id: string): Point | null => {
            const w = life.current?.walkers.get(id);
            if (w && !reduced) return { x: w.x, y: w.y };
            return layout.places[id] ?? null;
        },
        [layout, reduced]
    );

    const paint = useCallback(
        (now: number) => {
            const frame = reduced ? 0 : Math.floor(now / FRAME_MS);
            if (frame === painted.current) return;
            const ctx = canvas.current?.getContext('2d');
            if (!ctx || !still.current) return;
            painted.current = frame;
            ctx.drawImage(still.current, 0, 0);

            // The hour where the CHO is: the browser's own clock and zone.
            const hour = localHour(Date.now());
            const light = daylight(hour);
            if (clock.current) clock.current.textContent = clockWords(hour);

            // The idle live between frames. Under reduced motion nobody moves.
            if (!reduced) {
                life.current ??= createLife(layout);
                const dt = lastTick.current ? Math.min(now - lastTick.current, 250) : 0;
                lastTick.current = now;
                stepLife(life.current, floor, layout, now, dt, { night: isNight(hour) });
                // The news, acted on: whoever is not here yet is tried again next frame.
                if (owed.current.length) owed.current = owed.current.filter((c) => !startCeremony(life.current!, floor, c, now));
            }

            // Screens in use, and smoke from a busy house.
            for (const b of layout.buildings) {
                for (const d of b.desks) {
                    const a = agents.get(d.agentId);
                    if (d.occupied && a?.state === 'working') ctx.drawImage(gridCanvas(`desk|${frame % 2}`, deskTile(frame)), d.x * TILE, d.y * TILE);
                }
                if (b.busy && b.kind === 'house') {
                    ctx.drawImage(tileCanvas(Math.floor(frame / 3) % 2 ? 'smokeA' : 'smokeB'), (b.rect.x + b.rect.w - 2) * TILE, (b.rect.y - 1) * TILE);
                }
            }

            // Fire and water.
            for (const f of layout.features) {
                if (f.kind === 'fireplace' || f.kind === 'fountain') {
                    const g = animatedTile(f.kind, frame);
                    ctx.drawImage(gridCanvas(`anim|${f.kind}|${frame % 4}`, g), f.x * TILE, f.y * TILE);
                }
            }

            // The pile beside the seat grows with what is waiting.
            const n = floor.pendingApprovals;
            if (n > 0) ctx.drawImage(tileCanvas(n >= 6 ? 'scrolls3' : n >= 3 ? 'scrolls2' : 'scrolls1'), layout.centre.scrolls.x * TILE, layout.centre.scrolls.y * TILE);

            // New outputs are pinned to the notice board.
            if (floor.newOutputs > 0) ctx.drawImage(tileCanvas('boardPapers'), layout.centre.board.x * TILE, layout.centre.board.y * TILE);

            // Rimuru and Ranga.
            const asleep = floor.system.mode !== 'running';
            ctx.drawImage(rangaCanvas(Math.floor(frame / 6) % 2), layout.centre.ranga.x * TILE, layout.centre.ranga.y * TILE + 7);
            ctx.drawImage(slimeCanvas(asleep ? 0 : Math.floor(frame / 4) % 2, asleep), layout.centre.seat.x * TILE, layout.centre.seat.y * TILE - 3);

            const bubbles: { bubble: Bubble; x: number; top: number }[] = [];

            // Everyone, back to front, wherever they have got to.
            const placed = floor.agents
                .map((a) => ({ a, p: whereIs(a.id), w: reduced ? undefined : life.current?.walkers.get(a.id) }))
                .filter((x): x is { a: FloorAgent; p: Point; w: ReturnType<Life['walkers']['get']> } => !!x.p)
                .sort((u, v) => u.p.y - v.p.y);
            for (const { a, p, w } of placed) {
                const cast = castFor({ slug: a.slug, name: a.name, avatarSeed: a.avatarSeed });
                // The walk and the ceremony are the life's to draw; at the desk the state decides the pose.
                const look = w && (freeToRoam(a) || w.phase !== 'home' || w.activity?.ceremony) ? appearance(w, now) : null;
                let pose: Pose;
                let f: number;
                if (look?.walking) {
                    pose = 'walk';
                    f = poseFrame('walk', now, cast.key);
                } else if (look?.pose) {
                    pose = look.pose;
                    f = poseFrame(pose, now, cast.key);
                } else {
                    ({ pose, frame: f } = frameAt(a.state, cast.look, now, cast.key, reduced));
                }
                const x = Math.round(p.x * TILE);
                const top = Math.round((p.y + 1) * TILE) - SPRITE_H;
                const sprite = spriteCanvas(cast.key, cast.look, pose, f);
                if ((look?.facing ?? w?.facing ?? 1) === -1) {
                    ctx.save();
                    ctx.translate(x + SPRITE_W, top);
                    ctx.scale(-1, 1);
                    ctx.drawImage(sprite, 0, 0);
                    ctx.restore();
                } else {
                    ctx.drawImage(sprite, x, top);
                }

                const bubble = look?.walking ? null : look?.pose ? look.bubble : STATES[a.state].bubble;
                if (bubble && (bubble !== 'bang' || Math.floor(frame / 4) % 2 === 0)) bubbles.push({ bubble, x: x + SPRITE_W - 4, top });

                // The button follows, so the label and the tap are where the person is.
                const btn = buttons.current.get(a.id);
                if (btn) {
                    btn.style.left = `${x * SCALE}px`;
                    btn.style.top = `${top * SCALE}px`;
                }
            }

            // The light of the hour over everything, then whatever burns against it.
            if (light.a > 0) {
                ctx.save();
                ctx.globalCompositeOperation = 'multiply';
                ctx.fillStyle = `rgba(${light.r}, ${light.g}, ${light.b}, ${light.a})`;
                ctx.fillRect(0, 0, layout.w * TILE, layout.h * TILE);
                ctx.restore();
            }
            if (light.glow > 0) {
                ctx.save();
                ctx.globalCompositeOperation = 'lighter';
                const flicker = 0.9 + 0.1 * Math.sin(frame / 2);
                for (const l of lit) {
                    const r = l.r * TILE;
                    const g = ctx.createRadialGradient(l.x * TILE, l.y * TILE, 0, l.x * TILE, l.y * TILE, r);
                    g.addColorStop(0, l.colour.replace('A', String(0.55 * light.glow * flicker)));
                    g.addColorStop(1, l.colour.replace('A', '0'));
                    ctx.fillStyle = g;
                    ctx.fillRect(l.x * TILE - r, l.y * TILE - r, r * 2, r * 2);
                }
                ctx.restore();
            }
            // Speech stays readable whatever the hour.
            for (const b of bubbles) {
                const bc = bubbleCanvas(b.bubble);
                ctx.drawImage(bc, b.x, b.top - bc.height + 2);
            }
        },
        [layout, agents, floor, reduced, whereIs, lit]
    );

    useEffect(() => {
        painted.current = -1;
        paint(performance.now());
    }, [paint]);
    useFrameClock(paint, visible && !reduced);

    // Fresh state: a Realtime nudge, or the slow poll behind it.
    useEffect(() => {
        let alive = true;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const refetch = () => {
            clearTimeout(timer);
            timer = setTimeout(async () => {
                if (!alive || document.visibilityState !== 'visible') return;
                try {
                    const res = await fetch(source, { cache: 'no-store' });
                    if (!res.ok || !alive) return;
                    const next = (await res.json()) as Floor;
                    const news = ceremoniesFrom(seen.current, next);
                    seen.current = news.seenUpTo;
                    owed.current.push(...news.ceremonies);
                    setFloor(next);
                } catch {
                    // The poll will try again.
                }
            }, 400);
        };
        const supabase = createClient();
        let channel = supabase?.channel('tempest-town');
        for (const table of NUDGE_TABLES) {
            channel = channel?.on('postgres_changes', { event: '*', schema: 'public', table }, refetch);
        }
        channel?.subscribe();
        const poll = setInterval(() => {
            if (visible) refetch();
        }, pollMs);
        return () => {
            alive = false;
            clearTimeout(timer);
            clearInterval(poll);
            channel?.unsubscribe();
        };
    }, [visible, source, pollMs]);

    // A card closes on Escape and on a click anywhere else.
    useEffect(() => {
        if (!open && !house) return;
        const close = () => {
            setOpen(null);
            setHouse(null);
        };
        const key = (e: KeyboardEvent) => e.key === 'Escape' && close();
        const click = (e: MouseEvent) => {
            if (!(e.target as HTMLElement).closest('[data-town-card]')) close();
        };
        window.addEventListener('keydown', key);
        window.addEventListener('mousedown', click);
        return () => {
            window.removeEventListener('keydown', key);
            window.removeEventListener('mousedown', click);
        };
    }, [open, house]);

    const px = (v: number) => Math.round(v * TILE * SCALE);
    const card = open ? agents.get(open) : undefined;
    const cardAt = card ? whereIs(card.id) : null;
    const cardWalker = card && !reduced ? life.current?.walkers.get(card.id) : undefined;
    const outing = card && cardWalker && (freeToRoam(card) || cardWalker.activity?.ceremony) ? outingSentence(cardWalker) : null;
    const deptName = (id: string | null | undefined) => floor.departments.find((d) => d.id === id)?.name ?? null;
    const houseCard = house ? layout.buildings.find((b) => b.id === house) : undefined;
    const houseDept = houseCard ? floor.departments.find((d) => d.id === houseCard.id) : undefined;
    const notices = floor.newOutputs;
    const noticeWords = notices > 0 ? `${notices} new output${notices === 1 ? '' : 's'} to read` : 'nothing new pinned';

    return (
        <div ref={wrap} className={cn('w-full', className)}>
            {/* On a phone the town is taller than the screen; it scrolls inside its card so the rest of the page stays in reach. */}
            <div className="max-h-[70vh] overflow-y-auto overscroll-contain desk:max-h-none">
                <div className="relative mx-auto" style={{ width: px(layout.w), height: px(layout.h) }}>
                    <canvas
                        ref={canvas}
                        width={layout.w * TILE}
                        height={layout.h * TILE}
                        aria-hidden="true"
                        style={{ width: px(layout.w), height: px(layout.h), imageRendering: 'pixelated', display: 'block' }}
                    />

                    {/* Department names and quest banners, as text. */}
                    {layout.buildings.map((b) => (
                        <Link
                            key={b.id}
                            href={`/dashboard/delphi/departments/${b.id}`}
                            className="absolute flex items-center truncate text-[11px] font-semibold leading-none text-zinc-100 drop-shadow-[0_1px_0_rgba(0,0,0,0.9)] hover:underline"
                            style={{ left: px(b.sign.x) + 2, top: px(b.sign.y) + 4, width: px(b.rect.w) - 4, height: px(1) - 8 }}
                            title={b.kind === 'site' ? `${b.name} — being set up` : b.kind === 'boarded' ? `${b.name} — archived` : b.name}
                        >
                            {b.name}
                        </Link>
                    ))}
                    {layout.buildings.map((b) =>
                        b.banner ? (
                            <span
                                key={`${b.id}-banner`}
                                className="absolute truncate rounded-sm bg-sky-700/90 px-1 text-[10px] leading-4 text-white"
                                style={{ left: px(b.rect.x) + 2, top: px(b.rect.y) + 2, maxWidth: px(b.rect.w) - 4 }}
                                title={`Running: ${b.banner.text}`}
                            >
                                {b.banner.text}
                            </span>
                        ) : null
                    )}

                    {/* Each house opens its card; the agents' own buttons sit over this. */}
                    {layout.buildings.map((b) => (
                        <button
                            key={`house-${b.id}`}
                            type="button"
                            data-town-card
                            onClick={() => {
                                setOpen(null);
                                setHouse(house === b.id ? null : b.id);
                            }}
                            className={cn(
                                'absolute rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300',
                                house === b.id && 'outline outline-2 outline-amber-300/70'
                            )}
                            style={{ left: px(b.rect.x), top: px(b.rect.y), width: px(b.rect.w), height: px(b.rect.h) }}
                            aria-label={`${b.name}. ${houseSentence(b, floor.departments.find((d) => d.id === b.id))}`}
                            title={b.name}
                        />
                    ))}

                    {/* The notice board: what has landed in Outputs since you last looked. */}
                    <Link
                        href="/dashboard/delphi/outputs"
                        className="absolute rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300"
                        style={{ left: px(layout.centre.board.x), top: px(layout.centre.board.y), width: px(1), height: px(1) }}
                        aria-label={`Notice board: ${noticeWords}.`}
                        title={`Notice board: ${noticeWords}`}
                    >
                        {notices > 0 && (
                            <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-400 px-1 text-[10px] font-bold leading-none text-black">
                                {notices > 9 ? '9+' : notices}
                            </span>
                        )}
                    </Link>

                    {/* Rimuru's seat: the approvals pile links to the queue. */}
                    <Link
                        href="/dashboard/delphi/approvals"
                        className="absolute rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300"
                        style={{ left: px(layout.centre.seat.x) - 4, top: px(layout.centre.seat.y) - 8, width: px(2) + 8, height: px(1) + 12 }}
                        aria-label={`${floor.cho} (you). ${floor.pendingApprovals ? `${floor.pendingApprovals} waiting for your decision` : 'Nothing waiting for you'}.`}
                        title={floor.pendingApprovals ? `${floor.pendingApprovals} waiting for your decision` : 'Nothing waiting for you'}
                    />

                    {/* One real button per agent; the frame loop moves it with them. */}
                    {floor.agents.map((a) => {
                        const p = layout.places[a.id];
                        if (!p) return null;
                        return (
                            <button
                                key={a.id}
                                type="button"
                                data-town-card
                                ref={(el) => {
                                    if (el) buttons.current.set(a.id, el);
                                    else buttons.current.delete(a.id);
                                }}
                                onClick={() => {
                                    setHouse(null);
                                    setOpen(open === a.id ? null : a.id);
                                }}
                                className={cn(
                                    'absolute rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300',
                                    open === a.id && 'outline outline-2 outline-amber-300/70'
                                )}
                                style={{ left: px(p.x), top: px(p.y + 1) - SPRITE_H * SCALE, width: SPRITE_W * SCALE, height: SPRITE_H * SCALE }}
                                aria-label={`${a.name}, ${a.title} — ${stateSentence(a)}`}
                                title={`${a.name} — ${STATES[a.state].label}`}
                            />
                        );
                    })}

                    {card && cardAt && (
                        <div
                            data-town-card
                            role="dialog"
                            aria-label={card.name}
                            className="absolute z-10 w-56 rounded-md border border-white/15 bg-zinc-950/95 p-3 text-xs shadow-xl backdrop-blur"
                            style={{
                                left: Math.min(px(cardAt.x) + SPRITE_W * SCALE + 6, px(layout.w) - 230),
                                top: Math.max(0, Math.min(px(cardAt.y + 1) - SPRITE_H * SCALE, px(layout.h) - 140)),
                            }}
                        >
                            <p className="text-sm font-semibold leading-tight">{card.name}</p>
                            <p className="text-muted-foreground">{card.title}</p>
                            <p className="mt-2 text-zinc-200">{stateSentence(card)}</p>
                            {outing && <p className="mt-1 text-zinc-300">{outing}</p>}
                            {card.task?.departmentId && deptName(card.task.departmentId) && (
                                <Link href={`/dashboard/delphi/departments/${card.task.departmentId}`} className="mt-2 inline-block text-sky-300 hover:underline">
                                    {deptName(card.task.departmentId)} →
                                </Link>
                            )}
                            {!card.task && card.departments.length > 0 && (
                                <p className="mt-2 text-muted-foreground">Hired in {card.departments.map(deptName).filter(Boolean).join(', ')}.</p>
                            )}
                            {card.state === 'waiting_on_you' && (
                                <Link href="/dashboard/delphi/approvals" className="mt-2 inline-block text-amber-300 hover:underline">
                                    Open approvals →
                                </Link>
                            )}
                            {!card.isCeo && (
                                <Link href={askHref(questionAbout(card))} className="mt-2 block text-sky-300 hover:underline">
                                    Ask {CEO.name} about this →
                                </Link>
                            )}
                            {card.isCeo && (
                                <Link href={askHref(questionAbout(card))} className="mt-2 block text-sky-300 hover:underline">
                                    Talk to {CEO.name} →
                                </Link>
                            )}
                        </div>
                    )}

                    {houseCard && (
                        <div
                            data-town-card
                            role="dialog"
                            aria-label={houseCard.name}
                            className="absolute z-10 w-60 rounded-md border border-white/15 bg-zinc-950/95 p-3 text-xs shadow-xl backdrop-blur"
                            style={{
                                left: Math.min(px(houseCard.rect.x) + 12, px(layout.w) - 246),
                                top: Math.max(0, Math.min(px(houseCard.rect.y) + 12, px(layout.h) - 200)),
                            }}
                        >
                            <p className="text-sm font-semibold leading-tight">{houseCard.name}</p>
                            <p className="mt-1 text-zinc-200">{houseSentence(houseCard, houseDept)}</p>
                            {houseDept && houseDept.team.length > 0 && (
                                <ul className="mt-2 space-y-0.5">
                                    {houseDept.team.slice(0, 8).map((id) => {
                                        const a = agents.get(id);
                                        return a ? (
                                            <li key={id} className="flex items-baseline gap-1.5">
                                                <span>{a.name}</span>
                                                <span className="text-muted-foreground">{STATES[a.state].label}</span>
                                            </li>
                                        ) : null;
                                    })}
                                    {houseDept.team.length > 8 && <li className="text-muted-foreground">and {houseDept.team.length - 8} more</li>}
                                </ul>
                            )}
                            {houseDept && houseDept.completed > 0 && (
                                <p className="mt-2 text-muted-foreground">
                                    {houseDept.completed} project{houseDept.completed === 1 ? '' : 's'} completed.
                                </p>
                            )}
                            <Link href={`/dashboard/delphi/departments/${houseCard.id}`} className="mt-2 block text-sky-300 hover:underline">
                                Open department →
                            </Link>
                            <Link href={askHref(questionAboutHouse(houseCard, houseDept))} className="mt-1 block text-sky-300 hover:underline">
                                Ask {CEO.name} about this →
                            </Link>
                        </div>
                    )}
                </div>
            </div>

            <p className="mt-2 text-center text-xs text-muted-foreground" aria-live="polite">
                {summary(floor)}
                <span ref={clock} className="before:content-['_·_']" />
            </p>
        </div>
    );
}
