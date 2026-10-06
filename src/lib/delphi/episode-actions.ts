'use server';

/**
 * A channel's topics and episodes, from the browser: approve or reject what
 * the team proposed, add a topic, ask for more, make one now, and record
 * where a finished piece went live. All of it is the owner's.
 */

import { cache } from 'react';
import { revalidatePath } from 'next/cache';
import { createClient, currentUser } from '@/lib/supabase/server';
import { findWorkspace } from './bootstrap';
import { OWNER_ONLY, roleOf } from './members';
import { choNameOf } from './cho';
import { addIdea, getIdea, markPublished, moveIdea, proposeIdeas } from './ideas';
import { startEpisodeNow } from './scheduler';
import { getAccount } from '@/lib/studio/accounts';
import type { Db } from './db';

export interface EpisodeResult {
    ok: boolean;
    error?: string;
    /** How many topics were added, for "Suggest topics". */
    count?: number;
}

const ctx = cache(async function ctx(): Promise<{ db: Db; workspaceId: string; actor: string } | { error: string }> {
    const db = await createClient();
    if (!db) return { error: 'Supabase is not configured.' };
    const user = await currentUser();
    if (!user) return { error: 'You are not signed in.' };
    const workspaceId = await findWorkspace(db);
    if (!workspaceId) return { error: 'No workspace yet.' };
    if ((await roleOf(db, workspaceId, user.id)) !== 'owner') return { error: OWNER_ONLY };
    return { db, workspaceId, actor: choNameOf(user) };
});

const refresh = (departmentId?: string) => revalidatePath(departmentId ? `/dashboard/delphi/departments/${departmentId}` : '/dashboard/delphi', departmentId ? 'page' : 'layout');

/** Approve a topic the team proposed — or one turned down earlier. */
export async function approveIdeaAction(id: string): Promise<EpisodeResult> {
    const c = await ctx();
    if ('error' in c) return { ok: false, error: c.error };
    const res = await moveIdea(c.db, c.workspaceId, id, 'approved');
    if (res.ok) refresh(res.idea?.departmentId);
    return { ok: res.ok, error: res.error };
}

export async function rejectIdeaAction(id: string): Promise<EpisodeResult> {
    const c = await ctx();
    if ('error' in c) return { ok: false, error: c.error };
    const res = await moveIdea(c.db, c.workspaceId, id, 'rejected');
    if (res.ok) refresh(res.idea?.departmentId);
    return { ok: res.ok, error: res.error };
}

/** The CHO's own topic, approved as it is added. */
export async function addIdeaAction(accountId: string, title: string, angle?: string): Promise<EpisodeResult> {
    const c = await ctx();
    if ('error' in c) return { ok: false, error: c.error };
    const account = await getAccount(c.db, accountId);
    if (!account || account.workspaceId !== c.workspaceId || !account.departmentId) return { ok: false, error: 'That channel is not here.' };
    const res = await addIdea(c.db, {
        workspaceId: c.workspaceId,
        departmentId: account.departmentId,
        accountId,
        title,
        angle: angle ?? null,
        source: 'cho',
        status: 'approved',
    });
    if (!res.ok) return { ok: false, error: res.error };
    refresh(account.departmentId);
    return { ok: true };
}

/** Ask the team for more topics for one channel. */
export async function suggestIdeasAction(accountId: string): Promise<EpisodeResult> {
    const c = await ctx();
    if ('error' in c) return { ok: false, error: c.error };
    const account = await getAccount(c.db, accountId);
    if (!account || account.workspaceId !== c.workspaceId || !account.departmentId) return { ok: false, error: 'That channel is not here.' };
    const res = await proposeIdeas(c.db, {
        workspaceId: c.workspaceId,
        departmentId: account.departmentId,
        accountId,
        count: 3,
        autoApprove: account.preferences.topics === 'team',
    });
    if (res.error && !res.created.length) return { ok: false, error: res.error };
    refresh(account.departmentId);
    return { ok: true, count: res.created.length };
}

/** Make a waiting topic now, outside the schedule, within the month's money. */
export async function makeNowAction(ideaId: string): Promise<EpisodeResult> {
    const c = await ctx();
    if ('error' in c) return { ok: false, error: c.error };
    const idea = await getIdea(c.db, c.workspaceId, ideaId);
    if (!idea) return { ok: false, error: 'That topic is not here.' };
    const res = await startEpisodeNow(c.db, c.workspaceId, ideaId);
    if (!res.ok) return { ok: false, error: res.error };
    refresh(idea.departmentId);
    return { ok: true };
}

/** Where a channel's piece went live, once the CHO has published it by hand. */
export async function markPublishedAction(artifactId: string, url: string): Promise<EpisodeResult> {
    const c = await ctx();
    if ('error' in c) return { ok: false, error: c.error };
    const res = await markPublished(c.db, c.workspaceId, artifactId, url, c.actor);
    if (res.ok) {
        refresh();
        revalidatePath(`/dashboard/delphi/outputs/${artifactId}`);
    }
    return res;
}
