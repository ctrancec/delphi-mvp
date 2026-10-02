/**
 * Who an event's actor is.
 *
 * Events carry the actor as plain text — the name the agent had when the
 * line was written. Agents renamed since (the cast took its Tempest names)
 * still match through the name they had before, so an old line gets the
 * same face as a new one. The CHO is a role, not an agent row, and matches
 * by their name or the role's old label.
 */

import type { FloorAgent } from './floor';
import { CAST_NAMES, CEO_FORMERLY, CEO_NAME, CHO_NAME } from '@/lib/pixel/cast/names';

export function agentForActor(actor: string, agents: readonly FloorAgent[]): FloorAgent | null {
    const named = agents.find((a) => a.name === actor);
    if (named) return named;
    if (actor === CEO_NAME || actor === CEO_FORMERLY) return agents.find((a) => a.isCeo) ?? null;
    const slug = Object.keys(CAST_NAMES).find((s) => CAST_NAMES[s].formerly === actor || CAST_NAMES[s].name === actor);
    return slug ? (agents.find((a) => a.slug === slug) ?? null) : null;
}

/**
 * The CHO: by the name they go by now, by the cast's name for the role, or
 * by the role's old label on the oldest lines.
 */
export function isCho(actor: string, cho: string = CHO_NAME): boolean {
    return actor === cho || actor === CHO_NAME || actor === 'CHO';
}
