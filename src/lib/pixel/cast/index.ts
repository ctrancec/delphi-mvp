/**
 * The active cast pack, and how an agent finds its character.
 *
 * Everything that draws or names a character goes through here, never
 * through a pack directly. Swapping the pack — back to original characters
 * before Delphi is opened to anyone else — is then one import.
 *
 * An agent is matched in this order:
 *   1. the CEO, by slug;
 *   2. a seeded agent, by slug;
 *   3. a later hire that took a name from the pool, by that name;
 *   4. anyone else becomes a generated Tempest resident, from their seed.
 *
 * Matching by slug means the live roster gets its characters before any agent
 * is renamed, and keeps them if a name is ever changed by hand.
 */

import type { Look } from '../character';
import { residentFor } from '../residents';
import { APP_NAME, CEO, CHO, MASCOT, MEMBERS, POOL, type CastMember, type PoolMember } from './tensura';

export { APP_NAME, CEO, CHO, MASCOT, MEMBERS, POOL };
export type { CastMember, PoolMember };

export interface AgentLike {
    slug: string;
    name?: string | null;
    avatarSeed?: string | null;
}

export interface Cast {
    /** The character's name — what the agent is called once the cast is applied. */
    name: string;
    look: Look;
    kind: 'ceo' | 'cast' | 'pool' | 'resident';
    /** Stable across renders, and different for every distinct look. */
    key: string;
    /** For residents: "a kobold of Tempest". */
    species?: string;
}

export function castFor(agent: AgentLike): Cast {
    if (agent.slug === CEO.slug) return { name: CEO.name, look: CEO.look, kind: 'ceo', key: 'ceo' };

    const member = MEMBERS.find((m) => m.slug === agent.slug);
    if (member) return { name: member.name, look: member.look, kind: 'cast', key: member.slug };

    const pooled = agent.name ? POOL.find((p) => p.name === agent.name) : undefined;
    if (pooled) return { name: pooled.name, look: pooled.look, kind: 'pool', key: `pool:${pooled.name}` };

    const seed = agent.avatarSeed || agent.slug;
    const r = residentFor(seed);
    return { name: r.name, look: r.look, kind: 'resident', key: `res:${seed}`, species: r.kind };
}

/** The character name a seeded agent should carry, with the name it replaces. */
export function castNameFor(slug: string): { name: string; formerly: string } | null {
    if (slug === CEO.slug) return { name: CEO.name, formerly: CEO.formerly };
    const member = MEMBERS.find((m) => m.slug === slug);
    return member ? { name: member.name, formerly: member.formerly } : null;
}

/**
 * The next name from the pool that nobody on the roster has, or null once the
 * pool is spent — after which a hire is a resident with a generated name.
 */
export function nextPoolName(taken: Iterable<string>): string | null {
    const used = new Set(taken);
    return POOL.find((p) => !used.has(p.name))?.name ?? null;
}
