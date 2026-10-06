'use server';

/**
 * Rooms, from the browser: post a message, confirm or dismiss a card, keep
 * the Decisions list.
 *
 * Posting is for the owner and reviewers; a viewer reads. Everything that
 * changes something — a card, a decision — is the owner's alone, and is
 * checked here before the database is asked, and again by it.
 */

import { cache } from 'react';
import { revalidatePath } from 'next/cache';
import { createClient, currentUser } from '@/lib/supabase/server';
import { findWorkspace } from './bootstrap';
import { roleOf, type Role } from './members';
import { reviewOutputAction } from './cho-review';
import {
    confirmCard,
    deleteDecision,
    dismissCard,
    getRoom,
    peopleFor,
    recordDecision,
    refusal,
    replyInRoom,
    updateDecision,
    type People,
} from './rooms';
import type { RoomMessage } from './room-cards';
import type { Db } from './db';

export interface RoomResult {
    ok: boolean;
    error?: string;
    /** What was stored, for the panel to show before the page refreshes. */
    posted?: RoomMessage[];
    /** What confirming a card did. */
    result?: string;
}

interface Ctx {
    db: Db;
    workspaceId: string;
    role: Role;
    userId: string;
    /** What the person signed in goes by here. */
    me: string;
    people: People;
}

const ctx = cache(async function ctx(): Promise<Ctx | { error: string }> {
    const db = await createClient();
    if (!db) return { error: 'Supabase is not configured.' };
    const user = await currentUser();
    if (!user) return { error: 'You are not signed in.' };
    const workspaceId = await findWorkspace(db);
    if (!workspaceId) return { error: 'No workspace yet.' };

    const role = await roleOf(db, workspaceId, user.id);
    const { data: ws } = await db.from('workspaces').select('owner_id').eq('id', workspaceId).maybeSingle();
    const ownerId = ((ws as { owner_id?: string } | null)?.owner_id as string | undefined) ?? null;
    const { people, me } = peopleFor(role, user, ownerId);
    return { db, workspaceId, role, userId: user.id, me, people };
});

/** Say something in a room. Diablo answers, or the team member @named. */
export async function sendRoomMessageAction(roomId: string, text: string): Promise<RoomResult> {
    const c = await ctx();
    if ('error' in c) return { ok: false, error: c.error };
    const no = refusal(c.role, 'post');
    if (no) return { ok: false, error: no };
    if (!text.trim()) return { ok: false, error: 'Write something first.' };

    const room = await getRoom(c.db, roomId);
    if (!room || room.workspaceId !== c.workspaceId) return { ok: false, error: 'That room is not here.' };

    try {
        const res = await replyInRoom(c.db, {
            room,
            speaker: { userId: c.userId, name: c.me, isOwner: c.role === 'owner' },
            message: text,
            people: c.people,
        });
        return res.error ? { ok: false, error: res.error, posted: res.posted } : { ok: true, posted: res.posted };
    } catch (err) {
        return { ok: false, error: (err as Error).message };
    }
}

/** Do what a card proposes. The owner's alone. */
export async function confirmCardAction(messageId: string): Promise<RoomResult> {
    const c = await ctx();
    if ('error' in c) return { ok: false, error: c.error };
    const no = refusal(c.role, 'confirm');
    if (no) return { ok: false, error: no };

    const out = await confirmCard(
        c.db,
        c.workspaceId,
        messageId,
        {
            // The same path as Send back on the deliverable itself: the note
            // goes to the agent, and the redo is queued.
            sendBack: async (artifactId, note) => {
                const r = await reviewOutputAction(artifactId, 'declined', note);
                return { ok: r.ok, error: r.error };
            },
            // The scheduler's own path, so a piece made from a card keeps to
            // the same caps and the same once-only start as a scheduled one.
            startNow: async (ideaId) => {
                const { startEpisodeNow } = await import('./scheduler');
                const r = await startEpisodeNow(c.db, c.workspaceId, ideaId);
                return r.ok ? { ok: true } : { ok: false, error: r.error };
            },
            startRun: async (departmentId, slot) => {
                const { startRunNow } = await import('./scheduler');
                const r = await startRunNow(c.db, c.workspaceId, departmentId, slot ? new Date(slot) : null);
                return r.ok ? { ok: true } : { ok: false, error: r.error };
            },
        },
        c.people.cho
    );
    if (out.ok) revalidatePath('/dashboard/delphi', 'layout');
    return { ok: out.ok, error: out.error, result: out.result };
}

/** Set a card aside without doing it. The owner's alone. */
export async function dismissCardAction(messageId: string): Promise<RoomResult> {
    const c = await ctx();
    if ('error' in c) return { ok: false, error: c.error };
    const no = refusal(c.role, 'confirm');
    if (no) return { ok: false, error: no };
    const out = await dismissCard(c.db, c.workspaceId, messageId);
    return { ok: out.ok, error: out.error };
}

/** Add a decision to a room's list directly. */
export async function addDecisionAction(roomId: string, text: string): Promise<RoomResult> {
    const c = await ctx();
    if ('error' in c) return { ok: false, error: c.error };
    const no = refusal(c.role, 'decide');
    if (no) return { ok: false, error: no };
    const t = text.trim().slice(0, 500);
    if (t.length < 5) return { ok: false, error: 'A decision needs a sentence.' };

    const room = await getRoom(c.db, roomId);
    if (!room || room.workspaceId !== c.workspaceId) return { ok: false, error: 'That room is not here.' };
    try {
        await recordDecision(c.db, room, t);
    } catch (err) {
        return { ok: false, error: (err as Error).message };
    }
    revalidatePath(`/dashboard/delphi/departments/${room.departmentId}`);
    return { ok: true };
}

export async function updateDecisionAction(id: string, text: string): Promise<RoomResult> {
    const c = await ctx();
    if ('error' in c) return { ok: false, error: c.error };
    const no = refusal(c.role, 'decide');
    if (no) return { ok: false, error: no };
    const out = await updateDecision(c.db, c.workspaceId, id, text);
    return { ok: out.ok, error: out.error };
}

export async function deleteDecisionAction(id: string): Promise<RoomResult> {
    const c = await ctx();
    if ('error' in c) return { ok: false, error: c.error };
    const no = refusal(c.role, 'decide');
    if (no) return { ok: false, error: no };
    const out = await deleteDecision(c.db, c.workspaceId, id);
    return { ok: out.ok, error: out.error };
}
