'use server';

/**
 * Setting a department up, step by step.
 *
 * The wizard saves as it goes. The department exists as a draft from the
 * moment it has a name and a purpose, so the CHO can leave halfway and come
 * back; each later step merges its part into the department's settings.
 * Finishing marks the setup complete and asks the CEO to staff it — or to
 * re-staff it, for a department that already had a team.
 *
 * Everything here shapes the organisation, so it is the owner's alone.
 */

import { revalidatePath } from 'next/cache';
import { cache } from 'react';
import { createClient, currentUser } from '@/lib/supabase/server';
import { findWorkspace } from './bootstrap';
import { OWNER_ONLY, roleOf } from './members';
import { emitEvent, isMissingColumn, type Db } from './db';
import { proposeHiringAction, restaffDepartmentAction } from './actions';
import { listAccounts } from '@/lib/studio/accounts';
import { isDepartmentKind, nextSetup, scheduleCron, setupBlocker, validateBasics, withSettings, type DepartmentKind, type DepartmentSettings } from './kinds';
import { CHO_NAME, CEO_NAME } from '@/lib/pixel/cast/names';

export interface SetupResult<T = void> {
    ok: boolean;
    error?: string;
    data?: T;
}

const NEEDS_0012 = 'This needs migration 0012. Run it in the Supabase SQL editor (after 0009, 0010 and 0011), then try again.';

const ctx = cache(async function ctx(): Promise<{ db: Db; workspaceId: string } | { error: string }> {
    const db = await createClient();
    if (!db) return { error: 'Supabase is not configured.' };
    const user = await currentUser();
    if (!user) return { error: 'You are not signed in.' };
    const workspaceId = await findWorkspace(db);
    if (!workspaceId) return { error: 'No workspace yet.' };
    if ((await roleOf(db, workspaceId, user.id)) !== 'owner') return { error: OWNER_ONLY };
    return { db, workspaceId };
});

function dbError(e: { code?: string; message?: string } | null): string {
    if (!e) return 'Unknown error.';
    if (isMissingColumn(e)) return NEEDS_0012;
    if (/duplicate key/i.test(e.message ?? '')) return 'A department already has that name.';
    return e.message ?? 'Unknown error.';
}

export interface Basics {
    /** Set when the draft already exists. */
    id?: string | null;
    kind: DepartmentKind;
    name: string;
    charter: string;
    budgetUsd: number;
    timezone?: string;
}

/** Step 2: the department exists from here, as a draft. */
export async function saveDepartmentBasicsAction(input: Basics): Promise<SetupResult<{ id: string }>> {
    const c = await ctx();
    if ('error' in c) return { ok: false, error: c.error };
    const { db, workspaceId } = c;

    const v = validateBasics(input, CEO_NAME);
    if (!v.ok) return { ok: false, error: v.error };
    const { name, charter, budgetUsd: budget } = v.value;

    if (input.id) {
        const { data: existing } = await db
            .from('delphi_departments')
            .select('id, settings')
            .eq('id', input.id)
            .eq('workspace_id', workspaceId)
            .maybeSingle();
        if (!existing) return { ok: false, error: 'That draft is not here any more.' };

        const settings = withSettings(existing.settings);
        if (input.timezone) settings.timezone = withSettings({ timezone: input.timezone }, settings).timezone;
        const { error } = await db
            .from('delphi_departments')
            .update({ kind: input.kind, name, charter, budget_usd: budget, settings })
            .eq('id', input.id)
            .eq('workspace_id', workspaceId);
        if (error) return { ok: false, error: dbError(error) };
        revalidatePath(`/dashboard/delphi/departments/${input.id}`);
        return { ok: true, data: { id: input.id } };
    }

    const settings: DepartmentSettings = withSettings({
        setup: { step: 3, complete: false },
        timezone: input.timezone,
    });
    const { data, error } = await db
        .from('delphi_departments')
        .insert({
            workspace_id: workspaceId,
            kind: input.kind,
            name,
            charter,
            budget_usd: budget,
            status: 'draft',
            settings,
        })
        .select('id')
        .single();
    if (error) return { ok: false, error: dbError(error) };

    await emitEvent(db, {
        workspaceId,
        departmentId: data.id,
        type: 'department_created',
        actor: CHO_NAME,
        verb: 'started setting up a department',
        object: name,
    });
    revalidatePath('/dashboard/delphi');
    return { ok: true, data: { id: data.id as string } };
}

/**
 * Steps 3 and 4: merge part of the settings in. `kind` converts a
 * department — a research department that was really a studio, say.
 */
export async function saveDepartmentSettingsAction(
    id: string,
    patch: Partial<DepartmentSettings>,
    step: number,
    kind?: DepartmentKind
): Promise<SetupResult<{ settings: DepartmentSettings }>> {
    const c = await ctx();
    if ('error' in c) return { ok: false, error: c.error };
    const { db, workspaceId } = c;

    const { data: dept, error: readErr } = await db
        .from('delphi_departments')
        .select('*')
        .eq('id', id)
        .eq('workspace_id', workspaceId)
        .maybeSingle();
    if (readErr) return { ok: false, error: dbError(readErr) };
    if (!dept) return { ok: false, error: 'That department is not here.' };

    const current = withSettings(dept.settings);
    const merged = withSettings(
        {
            ...current,
            ...patch,
            research: patch.research ? { ...current.research, ...patch.research } : current.research,
            setup: nextSetup(current.setup, step),
        },
        current
    );

    const update: Record<string, unknown> = { settings: merged };
    if (kind) {
        if (!isDepartmentKind(kind)) return { ok: false, error: 'Unknown kind.' };
        update.kind = kind;
    }
    // Older code reads the cron column; keep it saying what the schedule says.
    if ((kind ?? dept.kind) === 'research') update.cadence_cron = scheduleCron(merged.schedule);

    const { error } = await db.from('delphi_departments').update(update).eq('id', id).eq('workspace_id', workspaceId);
    if (error) return { ok: false, error: dbError(error) };

    revalidatePath(`/dashboard/delphi/departments/${id}`);
    return { ok: true, data: { settings: merged } };
}

/**
 * Step 5: finish, and staff it. A department that already has a team — one
 * being converted, or set up again — is re-staffed: its finished work stays,
 * and what was still to come is set aside.
 */
export async function finishSetupAction(
    id: string
): Promise<SetupResult<{ taskCount: number; estimatedCostUsd: number }>> {
    const c = await ctx();
    if ('error' in c) return { ok: false, error: c.error };
    const { db, workspaceId } = c;

    const { data: dept, error: readErr } = await db
        .from('delphi_departments')
        .select('*')
        .eq('id', id)
        .eq('workspace_id', workspaceId)
        .maybeSingle();
    if (readErr) return { ok: false, error: dbError(readErr) };
    if (!dept) return { ok: false, error: 'That department is not here.' };

    const problem = await setupProblem(db, workspaceId, dept);
    if (problem) return { ok: false, error: problem };

    const settings = withSettings(dept.settings);
    settings.setup = { step: 5, complete: true };
    const { error } = await db.from('delphi_departments').update({ settings }).eq('id', id).eq('workspace_id', workspaceId);
    if (error) return { ok: false, error: dbError(error) };

    const { data: hires } = await db.from('delphi_hires').select('id').eq('department_id', id).limit(1);
    const staffed = (hires ?? []).length > 0;

    const result = staffed ? await restaffDepartmentAction(id) : await proposeHiringAction(id);
    revalidatePath(`/dashboard/delphi/departments/${id}`);
    revalidatePath('/dashboard/delphi');
    return result;
}

/** What still stops this department from being staffed, or null. */
async function setupProblem(db: Db, workspaceId: string, dept: Record<string, unknown>): Promise<string | null> {
    const kind = isDepartmentKind(dept.kind) ? dept.kind : 'research';
    const accounts = kind === 'studio' ? await listAccounts(db, workspaceId, String(dept.id)) : [];
    return setupBlocker(kind, String(dept.charter ?? ''), accounts);
}
