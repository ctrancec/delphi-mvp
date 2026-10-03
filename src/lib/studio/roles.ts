/**
 * The two roles that produce through the studio.
 *
 * The video editor plans videos and the motion designer plans images; the
 * studio renders both. A roster seeded before the studio existed still
 * describes those two jobs the old way — cutting footage nobody supplied,
 * generating media on credits nobody bought — so the first staffing after
 * the studio arrived brings their job descriptions into line. Only these two
 * seeded roles are touched, once each; a hire the CEO invented keeps exactly
 * what it was given.
 */

import type { Db } from '@/lib/delphi/db';
import { emitEvent } from '@/lib/delphi/db';
import { composeSystemPrompt, seedAgentBySlug } from '@/lib/delphi/roster';
import type { Agent, AgentStats, Candidate } from '@/lib/delphi/types';
import { CEO_FORMERLY, CEO_NAME, renameInPrompt } from '@/lib/pixel/cast/names';
import { producerFor, type MediaAccount } from './accounts';

export const STUDIO_ROLES = ['video-editor', 'motion-designer'] as const;

/** Present in both roles' current descriptions, and in neither old one. */
export const STUDIO_MARKER = 'through the studio';

/** The seed's description, in this agent's own name. */
export function studioPrompt(slug: string, name: string): string | null {
    const seed = seedAgentBySlug(slug);
    if (!seed) return null;
    const prompt = renameInPrompt(composeSystemPrompt(seed), seed.name, name);
    return renameInPrompt(prompt, CEO_FORMERLY, CEO_NAME);
}

/** Bring the two studio roles' job descriptions up to date. Returns who changed. */
export async function refreshStudioRoles(db: Db, workspaceId: string): Promise<string[]> {
    const { data, error } = await db
        .from('delphi_agents')
        .select('id, slug, name, system_prompt')
        .eq('workspace_id', workspaceId)
        .in('slug', [...STUDIO_ROLES]);
    if (error || !data) return [];

    const updated: string[] = [];
    for (const r of data as { id: string; slug: string; name: string; system_prompt: string | null }[]) {
        if ((r.system_prompt ?? '').includes(STUDIO_MARKER)) continue;
        const seed = seedAgentBySlug(r.slug);
        const prompt = studioPrompt(r.slug, r.name);
        if (!seed || !prompt) continue;

        const { error: upErr } = await db
            .from('delphi_agents')
            .update({ system_prompt: prompt, skills: seed.skills, cost_tier: seed.costTier })
            .eq('id', r.id);
        if (upErr) {
            console.error(`[delphi] could not update ${r.name} for the studio:`, upErr.message);
            continue;
        }
        updated.push(r.name);
    }

    if (updated.length) {
        await emitEvent(db, {
            workspaceId,
            type: 'roles_updated',
            actor: 'The roster',
            verb: 'moved into the studio',
            object: updated.join(' and '),
        });
    }
    return updated;
}

/**
 * The shortlist, with whoever produces each format the department's active
 * accounts make. The keyword prefilter ranks by the charter's words, and a
 * charter that says "Instagram" never mentions a motion designer.
 */
export function withProducers(
    shortlist: Candidate[],
    agents: Agent[],
    stats: Map<string, AgentStats>,
    accounts: MediaAccount[]
): Candidate[] {
    const needed = new Set<string>();
    for (const a of accounts) {
        if (a.status !== 'active') continue;
        for (const f of a.preferences.formats) needed.add(producerFor(f));
    }
    const out = [...shortlist];
    for (const slug of needed) {
        if (out.some((c) => c.agent.slug === slug)) continue;
        const agent = agents.find((a) => a.slug === slug && !a.archivedAt);
        if (agent) out.push({ agent, stats: stats.get(agent.id) ?? null, skillMatch: 0 });
    }
    return out;
}
