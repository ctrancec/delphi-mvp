/**
 * Compose a character: one look, one pose, one frame → a 16×26 sprite.
 *
 * Paint order is what makes the layers read:
 *   behind (wings, a cape) → torso → held item → arms → head → raised arms
 * The item goes under the arms so the hand closes over the grip; a raised arm
 * goes over the head because it passes in front of the face.
 */

import { PixelCanvas, type Grid, type Palette } from './canvas';
import { BODY_Y, HAND, POSES, SPRITE_H, SPRITE_W, TORSOS, type Outfit, type Pose } from './sprites/body';
import { closedEyes } from './sprites/heads';
import { BACKS, ITEMS, RANGA, SLIME, type BackId, type ItemId } from './sprites/items';

export interface Look {
    head: Grid;
    outfit: Outfit;
    /** Every slot the head, torso, arms and item use. */
    colours: Palette;
    item?: ItemId;
    back?: readonly BackId[];
    /** Hovers a row off the ground: Ramiris. */
    floats?: boolean;
    /** Eyes drawn as lines whatever the pose: Hakurou. */
    squint?: boolean;
    /** How this character idles, when not the default: Diablo bows. */
    idlePose?: Pose;
}

export function frameCount(pose: Pose): number {
    return POSES[pose].length;
}

export function renderCharacter(look: Look, pose: Pose, frame = 0): PixelCanvas {
    const frames = POSES[pose];
    const f = frames[((frame % frames.length) + frames.length) % frames.length];
    const c = new PixelCanvas(SPRITE_W, SPRITE_H);
    const dy = f.bodyDy + (look.floats ? -1 : 0);

    for (const id of look.back ?? []) c.draw(BACKS[id].grid, 0, BACKS[id].y + dy, look.colours);

    c.draw(TORSOS[look.outfit], 0, BODY_Y + dy, look.colours);

    if (f.holdsItem && look.item) {
        const it = ITEMS[look.item];
        c.draw(it.grid, HAND.x - it.grip.x, HAND.y - it.grip.y + dy, look.colours);
    }

    if (!f.arms.over) c.draw(f.arms.grid, 0, f.arms.y + dy, look.colours);

    const head = f.eyes === 'closed' && !look.squint ? closedEyes(look.head) : look.head;
    c.draw(head, 0, f.headDy + dy, look.colours);

    if (f.arms.over) c.draw(f.arms.grid, 0, f.arms.y + dy, look.colours);

    return c;
}

/** Rimuru: frame 0 up, frame 1 squashed; `asleep` shuts the eyes. */
export function renderSlime(colours: Palette, frame = 0, asleep = false): PixelCanvas {
    const g = SLIME[((frame % SLIME.length) + SLIME.length) % SLIME.length];
    const c = new PixelCanvas(g.w, g.h);
    c.draw(asleep ? closedEyes(g) : g, 0, 0, colours);
    return c;
}

export function renderRanga(colours: Palette, frame = 0): PixelCanvas {
    const g = RANGA[((frame % RANGA.length) + RANGA.length) % RANGA.length];
    const c = new PixelCanvas(g.w, g.h);
    c.draw(g, 0, 0, colours);
    return c;
}
