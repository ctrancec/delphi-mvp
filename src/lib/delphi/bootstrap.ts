/**
 * First-run provisioning.
 *
 * A new CHO signs up and arrives at an empty mission control. The workspace,
 * the roster and the channel bindings all have to exist before anything can be
 * done — and the CHO has no terminal, so a seed script is not a path they can
 * take. This runs on first view instead.
 *
 * Every step is idempotent and the whole thing short-circuits on one cheap
 * query once provisioned, so calling it on each page load costs a single
 * select in the steady state.
 */

import { cache } from 'react';
import {
    DELPHI_SLUG,
    ensureDelphiAgent,
    seedChannels,
    seedRoster,
    type Db,
} from './db';

export interface Provisioned {
    workspaceId: string;
    /** True only on the run that actually created something. */
    seeded: boolean;
    agentCount: number;
}

/**
 * The caller's workspace, or null. Never creates one.
 *
 * Always the oldest, so every caller agrees on which workspace is "the" one
 * even if a duplicate ever gets through.
 */
async function readWorkspace(db: Db): Promise<string | null> {
    const { data } = await db
        .from('workspaces')
        .select('id')
        .order('created_at', { ascending: true })
        .limit(1);

    return (data?.[0]?.id as string) ?? null;
}

/**
 * Memoized per request, because a layout and the page inside it both want it
 * and neither should wait on its own copy of the same select. `cache()` is
 * keyed on the client instance, which is itself now one per request — so this
 * is a single query however many callers ask.
 */
export const findWorkspace = cache(readWorkspace);

/**
 * The caller's workspace, created on first use.
 *
 * `bootstrap_workspace()` depends on `auth.uid()`, which is null in the
 * Supabase SQL editor — so it cannot usefully be run by hand there. The app is
 * the only place with a real session.
 *
 * Only one place may call this. A layout and its page render concurrently, so
 * when both created, both saw an empty table and both inserted — which is
 * exactly what happened on the first run: two workspaces 0.4ms apart, one of
 * them empty. Read-only callers use findWorkspace().
 */
export async function ensureWorkspace(db: Db): Promise<string | null> {
    const existing = await readWorkspace(db);
    if (existing) return existing;

    const { error } = await db.rpc('bootstrap_workspace', {
        workspace_name: 'Delphi',
    });
    if (error) {
        console.error('[delphi] bootstrap_workspace failed:', error.message);
        return null;
    }

    // Re-read rather than trusting the returned id: if a concurrent request
    // also inserted, this converges on the oldest, which is what every other
    // caller will pick too.
    return readWorkspace(db);
}

/**
 * Is this workspace already staffed?
 *
 * One select answers both questions the provisioner asks — whether the CEO has
 * a row and whether anyone was hired — where it used to ask them separately.
 * On an already-provisioned workspace, which is every load after the first,
 * that is the entire cost of this module.
 */
async function rosterProbe(db: Db, workspaceId: string) {
    const { data } = await db
        .from('delphi_agents')
        .select('slug, is_board')
        .eq('workspace_id', workspaceId)
        .is('archived_at', null);

    const rows = data ?? [];
    return {
        hasCeo: rows.some((r) => r.slug === DELPHI_SLUG),
        // The count the callers mean by "roster": workers, not the board and
        // not the CEO, matching listAgents()'s defaults.
        workers: rows.filter((r) => !r.is_board && r.slug !== DELPHI_SLUG).length,
    };
}

/**
 * Bring a workspace up to a usable state: channels, then roster.
 *
 * Order matters. `seedRoster` resolves each agent's required channels to ids
 * at insert time, so seeding the roster first leaves every agent bound to
 * nothing and the runtime hands out no tools — the agents would then produce
 * confident, well-formatted work having never touched a live source.
 */
export async function provisionWorkspace(db: Db, workspaceId: string): Promise<Provisioned> {
    const probe = await rosterProbe(db, workspaceId);

    // The steady state, and the only path that matters for page load speed.
    if (probe.hasCeo && probe.workers > 0) {
        return { workspaceId, seeded: false, agentCount: probe.workers };
    }

    // Needed even on an already-seeded workspace that predates the CEO having
    // a row of its own.
    if (!probe.hasCeo) await ensureDelphiAgent(db, workspaceId);

    if (probe.workers > 0) {
        return { workspaceId, seeded: false, agentCount: probe.workers };
    }

    await seedChannels(db, workspaceId);
    await seedRoster(db, workspaceId);

    const after = await rosterProbe(db, workspaceId);
    return { workspaceId, seeded: true, agentCount: after.workers };
}

/**
 * Everything a signed-in CHO needs before mission control can show them
 * anything. Returns null when there is no session or the workspace could not
 * be created; callers render their own "not configured" state from that.
 *
 * Memoized per request for the same reason findWorkspace is: several pages
 * call it, and a page that also renders a component calling it should not
 * provision twice.
 */
export const bootstrapDelphi = cache(async (db: Db): Promise<Provisioned | null> => {
    const workspaceId = await ensureWorkspace(db);
    if (!workspaceId) return null;

    try {
        return await provisionWorkspace(db, workspaceId);
    } catch (err) {
        // A failed seed must not blank the dashboard — the workspace exists, so
        // render what we have and let the CHO retry from the UI.
        console.error('[delphi] provisioning failed:', (err as Error).message);
        return { workspaceId, seeded: false, agentCount: 0 };
    }
});
