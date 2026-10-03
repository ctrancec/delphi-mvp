'use server';

/**
 * Managing media accounts.
 *
 * Accounts change what gets made, so they are the owner's alone, like every
 * other setting that shapes the organisation. The test render lives in its
 * own route (/api/delphi/studio), which carries the ffmpeg binary; these
 * actions run with the department page and do not need it.
 */

import { revalidatePath } from 'next/cache';
import { cache } from 'react';
import { createClient, currentUser } from '@/lib/supabase/server';
import { findWorkspace } from '@/lib/delphi/bootstrap';
import { OWNER_ONLY, roleOf } from '@/lib/delphi/members';
import { emitEvent, type Db } from '@/lib/delphi/db';
import { CHO_NAME } from '@/lib/pixel/cast/names';
import {
    accountLabel,
    getAccount,
    isMissingRelation,
    toAccount,
    validateAccountInput,
    type AccountInput,
    type MediaAccount,
} from './accounts';

export interface StudioResult<T = void> {
    ok: boolean;
    error?: string;
    data?: T;
}

const MIGRATION_HINT = 'The accounts table is not there yet. Run migration 0011 in the Supabase SQL editor, then try again.';

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
    if (isMissingRelation(e)) return MIGRATION_HINT;
    if (/duplicate key/i.test(e.message ?? '')) return 'An account on that platform already has that name.';
    return e.message ?? 'Unknown error.';
}

export async function createAccountAction(departmentId: string, input: AccountInput): Promise<StudioResult<MediaAccount>> {
    const c = await ctx();
    if ('error' in c) return { ok: false, error: c.error };
    const { db, workspaceId } = c;

    const v = validateAccountInput({ ...input, departmentId });
    if (!v.ok) return { ok: false, error: v.error };

    const { data, error } = await db
        .from('delphi_media_accounts')
        .insert({
            workspace_id: workspaceId,
            department_id: departmentId,
            platform: v.value.platform,
            name: v.value.name,
            handle: v.value.handle,
            url: v.value.url,
            status: v.value.status,
            preferences: v.value.preferences,
        })
        .select('*')
        .single();
    if (error) return { ok: false, error: dbError(error) };

    const account = toAccount(data);
    await emitEvent(db, {
        workspaceId,
        departmentId,
        type: 'account_changed',
        actor: CHO_NAME,
        verb: 'added an account',
        object: accountLabel(account),
    });
    revalidatePath(`/dashboard/delphi/departments/${departmentId}`);
    return { ok: true, data: account };
}

export async function updateAccountAction(id: string, input: AccountInput): Promise<StudioResult<MediaAccount>> {
    const c = await ctx();
    if ('error' in c) return { ok: false, error: c.error };
    const { db, workspaceId } = c;

    const existing = await getAccount(db, id);
    if (!existing || existing.workspaceId !== workspaceId) return { ok: false, error: 'That account is not here.' };

    const v = validateAccountInput({ ...input, departmentId: existing.departmentId }, existing.preferences);
    if (!v.ok) return { ok: false, error: v.error };

    const { data, error } = await db
        .from('delphi_media_accounts')
        .update({
            platform: v.value.platform,
            name: v.value.name,
            handle: v.value.handle,
            url: v.value.url,
            status: v.value.status,
            preferences: v.value.preferences,
            updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('workspace_id', workspaceId)
        .select('*')
        .single();
    if (error) return { ok: false, error: dbError(error) };

    const account = toAccount(data);
    await emitEvent(db, {
        workspaceId,
        departmentId: existing.departmentId,
        type: 'account_changed',
        actor: CHO_NAME,
        verb: 'changed the preferences of',
        object: accountLabel(account),
    });
    if (existing.departmentId) revalidatePath(`/dashboard/delphi/departments/${existing.departmentId}`);
    return { ok: true, data: account };
}

export async function deleteAccountAction(id: string): Promise<StudioResult> {
    const c = await ctx();
    if ('error' in c) return { ok: false, error: c.error };
    const { db, workspaceId } = c;

    const existing = await getAccount(db, id);
    if (!existing || existing.workspaceId !== workspaceId) return { ok: false, error: 'That account is not here.' };

    // Tasks and artifacts that pointed at it keep their rows; the reference
    // becomes null (on delete set null), so nothing produced is lost.
    const { error } = await db.from('delphi_media_accounts').delete().eq('id', id).eq('workspace_id', workspaceId);
    if (error) return { ok: false, error: dbError(error) };

    await emitEvent(db, {
        workspaceId,
        departmentId: existing.departmentId,
        type: 'account_changed',
        actor: CHO_NAME,
        verb: 'removed an account',
        object: accountLabel(existing),
    });
    if (existing.departmentId) revalidatePath(`/dashboard/delphi/departments/${existing.departmentId}`);
    return { ok: true };
}
