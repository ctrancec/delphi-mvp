/**
 * Giving a roster its cast names.
 *
 * A workspace seeded before the cast arrived still calls its agents by the
 * seed names, and every prompt introduces itself that way. This brings such a
 * roster into line with the active pack: the name, and every mention of the
 * old one inside the prompt — nothing else in the prompt moves, so what an
 * agent knows and how it works are untouched.
 *
 * It runs from provisioning on every load and costs nothing once applied:
 * the probe provisioning already makes carries the names, and a roster that
 * matches is left alone. Only seeded agents and the CEO are touched; a hire
 * the CEO invented keeps the name it was given.
 */

import { APP_NAME, castNameFor, CEO_FORMERLY, CEO_NAME, renameInPrompt } from '@/lib/pixel/cast/names';
import { emitEvent, type Db } from './db';

export interface NamedRow {
    id: string;
    slug: string;
    name: string;
}

export interface Drift<T extends NamedRow> {
    row: T;
    /** The character's name. */
    name: string;
    /** What the row says now. */
    current: string;
    /** The seed name, which is what the prompt introduces even if the row was renamed by hand. */
    seed: string;
}

/** The rows whose name is not the one the cast gives them. */
export function castDrift<T extends NamedRow>(rows: readonly T[]): Drift<T>[] {
    const out: Drift<T>[] = [];
    for (const row of rows) {
        const cast = castNameFor(row.slug);
        if (cast && row.name !== cast.name) out.push({ row, name: cast.name, current: row.name, seed: cast.formerly });
    }
    return out;
}

/** The prompt an agent should carry once renamed: the same words, introducing the character. */
export function castedPrompt(prompt: string, drift: { name: string; current: string; seed: string }): string {
    let out = renameInPrompt(prompt, drift.seed, drift.name);
    out = renameInPrompt(out, drift.current, drift.name);
    // The shared protocol names the CEO; an agent graded by the old name
    // would be reading about someone who no longer exists.
    return renameInPrompt(out, CEO_FORMERLY, CEO_NAME);
}

export async function applyCast(db: Db, workspaceId: string, rows: readonly NamedRow[]): Promise<{ renamed: string[] }> {
    const drift = castDrift(rows);
    if (drift.length === 0) return { renamed: [] };

    const { data, error } = await db
        .from('delphi_agents')
        .select('id, system_prompt')
        .in('id', drift.map((d) => d.row.id));
    if (error) {
        console.error('[delphi] could not read prompts to apply the cast:', error.message);
        return { renamed: [] };
    }
    const prompts = new Map((data ?? []).map((r) => [r.id as string, (r.system_prompt as string) ?? '']));

    const renamed: string[] = [];
    for (const d of drift) {
        const { error: upErr } = await db
            .from('delphi_agents')
            .update({ name: d.name, system_prompt: castedPrompt(prompts.get(d.row.id) ?? '', d) })
            .eq('id', d.row.id);
        if (upErr) {
            console.error(`[delphi] could not rename ${d.current}:`, upErr.message);
            continue;
        }
        renamed.push(`${d.current} → ${d.name}`);
    }

    if (renamed.length > 0) {
        await emitEvent(db, {
            workspaceId,
            type: 'cast_applied',
            actor: 'The roster',
            verb: `took its ${APP_NAME} names`,
            object: `${renamed.length} ${renamed.length === 1 ? 'agent' : 'agents'}`,
            payload: { renamed },
        });
    }
    return { renamed };
}
