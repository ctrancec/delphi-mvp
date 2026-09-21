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
 *
 * ## Why nothing here reads back what it just wrote
 *
 * React memoizes `fetch` by URL within a single render, and a PostgREST query
 * *is* a `fetch`. So a write followed by **the same** read hands back the
 * answer from before the write — no error, no warning, just the earlier body
 * again.
 *
 * That is not theoretical. This module used to create the workspace and then
 * re-read it to learn its id, and that re-read was byte-identical to the read
 * that had just come back empty. So it came back empty too, provisioning was
 * skipped, and a brand new account's first screen said the roster could not be
 * provisioned. Everything downstream looked fine because everything downstream
 * *was* fine — it simply never ran.
 *
 * So: use what the write returned. Do not read it back in the same render.
 */

import { cache } from 'react';
import { ALL_SEED_AGENTS } from './roster';
import { DELPHI_SLUG, ensureDelphiAgent, seedChannels, seedRoster, type Db } from './db';

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
    const { data, error } = await db
        .from('workspaces')
        .select('id')
        .order('created_at', { ascending: true })
        .limit(1);

    // Said out loud rather than folded into the null. "No workspace" and
    // "could not ask" lead somewhere completely different, and a silent null
    // here is what hid the provisioning bug described above.
    if (error) console.error('[delphi] could not read the workspace:', error.message);

    return (data?.[0]?.id as string) ?? null;
}

/**
 * Memoized per request, because a layout and the page inside it both want it
 * and neither should wait on its own copy of the same select. `cache()` is
 * keyed on the client instance, which is itself one per request — so this is a
 * single query however many callers ask.
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
    const existing = await findWorkspace(db);
    if (existing) return existing;

    const { data, error } = await db.rpc('bootstrap_workspace', {
        workspace_name: 'Delphi',
    });
    if (error) {
        console.error('[delphi] bootstrap_workspace failed:', error.message);
        return null;
    }

    // The function returns the id, and it reuses an existing workspace of the
    // same name rather than piling up copies — so this is both the answer and
    // a convergent one. Reading it back instead returns the memoized empty
    // list from a moment ago; see the note at the top of this file.
    return (data as string | null) ?? null;
}

/**
 * Is this workspace already staffed?
 *
 * One select answers both questions the provisioner asks — whether the CEO has
 * a row, and whether anyone was hired — where it used to ask them separately.
 * On an already-provisioned workspace, which is every load after the first,
 * that is the entire cost of this module.
 */
async function rosterProbe(db: Db, workspaceId: string) {
    const { data, error } = await db
        .from('delphi_agents')
        .select('slug, is_board')
        .eq('workspace_id', workspaceId)
        .is('archived_at', null);

    if (error) console.error('[delphi] could not read the roster:', error.message);

    const rows = data ?? [];
    return {
        hasCeo: rows.some((r) => r.slug === DELPHI_SLUG),
        // The count callers mean by "roster": workers, not the board and not
        // the CEO, matching listAgents()'s defaults.
        workers: rows.filter((r) => !r.is_board && r.slug !== DELPHI_SLUG).length,
    };
}

/** How many workers a freshly seeded roster has. */
const SEED_WORKER_COUNT = ALL_SEED_AGENTS.filter((a) => !a.board).length;

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
    const { inserted } = await seedRoster(db, workspaceId);

    // Counted from what was seeded rather than read back: the roster is now
    // exactly the seed set, and re-probing would return the empty list from
    // the probe above.
    return { workspaceId, seeded: inserted > 0, agentCount: SEED_WORKER_COUNT };
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
