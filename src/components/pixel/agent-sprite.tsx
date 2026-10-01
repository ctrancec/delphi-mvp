'use client';

/**
 * An agent, drawn as their character, animated by state.
 *
 * The frame is painted into a canvas at its native 16×26 and scaled up by
 * CSS with `image-rendering: pixelated`, so every pixel stays a crisp square
 * at any device pixel ratio. On the server the canvas renders empty at its
 * final size, so nothing shifts when the picture arrives.
 *
 * Frames are rendered once per look, pose and frame and kept, so an office
 * of thirty sprites costs thirty `putImageData` calls a second, not thirty
 * compositions.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { frameAt, STATES, type AgentState } from '@/lib/pixel/animate';
import { castFor, CHO, type AgentLike } from '@/lib/pixel/cast';
import { renderCharacter, renderSlime, type Look } from '@/lib/pixel/character';
import { SPRITE_H, SPRITE_W, type Pose } from '@/lib/pixel/sprites/body';
import { useFrameClock } from './use-frame-clock';

const frames = new Map<string, ImageData>();

function frameImage(key: string, look: Look, pose: Pose, frame: number): ImageData {
    const k = `${key}|${pose}|${frame}`;
    let img = frames.get(k);
    if (!img) {
        const c = renderCharacter(look, pose, frame);
        // Copied: ImageData wants its own ArrayBuffer, not a view over one.
        img = new ImageData(new Uint8ClampedArray(c.data), c.w, c.h);
        frames.set(k, img);
    }
    return img;
}

/** Honour the system setting: a still frame, with the pose still carrying the state. */
export function useReducedMotion(): boolean {
    const [reduced, setReduced] = useState(false);
    useEffect(() => {
        const media = window.matchMedia('(prefers-reduced-motion: reduce)');
        const sync = () => setReduced(media.matches);
        sync();
        media.addEventListener('change', sync);
        return () => media.removeEventListener('change', sync);
    }, []);
    return reduced;
}

export interface AgentSpriteProps {
    agent: AgentLike;
    state?: AgentState;
    /** Integer. 2 on a map, 3 for a portrait, 4 for a hero. */
    scale?: number;
    className?: string;
    /** Overrides the accessible name, which is otherwise "<name>, <state>". */
    label?: string;
}

export function AgentSprite({ agent, state = 'idle', scale = 3, className, label }: AgentSpriteProps) {
    const { slug, name, avatarSeed } = agent;
    const cast = useMemo(() => castFor({ slug, name, avatarSeed }), [slug, name, avatarSeed]);
    const ref = useRef<HTMLCanvasElement>(null);
    const painted = useRef('');
    const reduced = useReducedMotion();

    const paint = useCallback(
        (now: number) => {
            const { pose, frame } = frameAt(state, cast.look, now, cast.key, reduced);
            const key = `${cast.key}|${pose}|${frame}`;
            if (key === painted.current) return;
            const ctx = ref.current?.getContext('2d');
            if (!ctx) return;
            ctx.putImageData(frameImage(cast.key, cast.look, pose, frame), 0, 0);
            painted.current = key;
        },
        [cast, state, reduced]
    );

    // The first frame straight away; the clock takes it from there.
    useEffect(() => {
        painted.current = '';
        paint(performance.now());
    }, [paint]);
    useFrameClock(paint, !reduced && STATES[state].fps > 0);

    const text = label ?? `${cast.name}, ${STATES[state].label}`;
    return (
        <canvas
            ref={ref}
            width={SPRITE_W}
            height={SPRITE_H}
            role="img"
            aria-label={text}
            title={text}
            className={className}
            style={{ width: SPRITE_W * scale, height: SPRITE_H * scale, imageRendering: 'pixelated' }}
        />
    );
}

const SLIME_W = 16;
const SLIME_H = 13;
const slimeFrames = new Map<string, ImageData>();

/** The CHO, as Rimuru. */
export function SlimeSprite({ asleep = false, scale = 3, className }: { asleep?: boolean; scale?: number; className?: string }) {
    const ref = useRef<HTMLCanvasElement>(null);
    const painted = useRef(-1);
    const reduced = useReducedMotion();

    const paint = useCallback(
        (now: number) => {
            const frame = reduced || asleep ? 0 : Math.floor((now / 1000) * 1.5) % 2;
            if (frame === painted.current) return;
            const ctx = ref.current?.getContext('2d');
            if (!ctx) return;
            const k = `${asleep}|${frame}`;
            let img = slimeFrames.get(k);
            if (!img) {
                const c = renderSlime(CHO.colours, frame, asleep);
                img = new ImageData(new Uint8ClampedArray(c.data), c.w, c.h);
                slimeFrames.set(k, img);
            }
            ctx.clearRect(0, 0, SLIME_W, SLIME_H);
            ctx.putImageData(img, 0, 0);
            painted.current = frame;
        },
        [asleep, reduced]
    );

    useEffect(() => {
        painted.current = -1;
        paint(performance.now());
    }, [paint]);
    useFrameClock(paint, !reduced && !asleep);

    const text = `${CHO.name}${asleep ? ', asleep' : ''}`;
    return (
        <canvas
            ref={ref}
            width={SLIME_W}
            height={SLIME_H}
            role="img"
            aria-label={text}
            title={text}
            className={className}
            style={{ width: SLIME_W * scale, height: SLIME_H * scale, imageRendering: 'pixelated' }}
        />
    );
}
