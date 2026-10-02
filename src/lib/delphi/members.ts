/**
 * Who is in the workspace, and what each of them may do.
 *
 * The owner is the CHO: the one person who decides, staffs, spends, switches
 * the system and changes settings. A reviewer reads everything and can post
 * into review threads. A viewer reads. The database says the same thing in
 * its policies; this module is the app's reading of it, so a server action
 * can refuse politely before the database refuses tersely.
 *
 * Invitations are links. A token is minted by the owner, carried to someone,
 * and accepted once, within seven days, by whoever is signed in when it is
 * opened. Nothing here needs more than the database.
 */

import type { Db } from './db';

export type Role = 'owner' | 'reviewer' | 'viewer';

export type Action = 'decide' | 'staff' | 'run' | 'switch' | 'settings' | 'delete' | 'invite' | 'post';

export const OWNER_ONLY = 'Only the workspace owner, the CHO, can do that.';

/** A stored role, read charitably: the base migration's "member" is a reviewer; the owner is whoever owns the workspace. */
export function normalizeRole(raw: unknown, isOwner = false): Role {
    if (isOwner || raw === 'owner') return 'owner';
    if (raw === 'viewer') return 'viewer';
    return 'reviewer';
}

export function can(role: Role, action: Action): boolean {
    if (role === 'owner') return true;
    if (role === 'reviewer') return action === 'post';
    return false;
}

export function roleWords(role: Role): string {
    switch (role) {
        case 'owner':
            return 'the owner, the CHO: you decide, staff, spend and switch the system';
        case 'reviewer':
            return 'a reviewer: you read everything and can post into review threads';
        case 'viewer':
            return 'a viewer: you read everything';
    }
}

type Row = Record<string, unknown>;

/** The role of a person in a workspace, from their membership, else from owning it. */
export async function roleOf(db: Db, workspaceId: string, userId: string): Promise<Role> {
    const { data: member } = await db.from('workspace_members').select('role').eq('workspace_id', workspaceId).eq('user_id', userId).maybeSingle();
    if ((member as Row | null)?.role) {
        if ((member as Row).role === 'owner') return 'owner';
        const { data: ws } = await db.from('workspaces').select('owner_id').eq('id', workspaceId).maybeSingle();
        return normalizeRole((member as Row).role, (ws as Row | null)?.owner_id === userId);
    }
    const { data: ws } = await db.from('workspaces').select('owner_id').eq('id', workspaceId).maybeSingle();
    return (ws as Row | null)?.owner_id === userId ? 'owner' : 'viewer';
}

export interface Member {
    userId: string;
    role: Role;
    email: string | null;
    since: string;
}

export interface Invite {
    id: string;
    email: string | null;
    role: Exclude<Role, 'owner'>;
    token: string;
    createdAt: string;
    expiresAt: string;
    acceptedAt: string | null;
    revokedAt: string | null;
}

export const INVITE_DAYS = 7;

export function inviteState(inv: Pick<Invite, 'expiresAt' | 'acceptedAt' | 'revokedAt'>, nowMs = Date.now()): 'open' | 'used' | 'revoked' | 'expired' {
    if (inv.revokedAt) return 'revoked';
    if (inv.acceptedAt) return 'used';
    if (Date.parse(inv.expiresAt) <= nowMs) return 'expired';
    return 'open';
}

function toInvite(r: Row): Invite {
    return {
        id: String(r.id),
        email: (r.email as string | null) ?? null,
        role: r.role === 'viewer' ? 'viewer' : 'reviewer',
        token: String(r.token),
        createdAt: String(r.created_at ?? ''),
        expiresAt: String(r.expires_at),
        acceptedAt: (r.accepted_at as string | null) ?? null,
        revokedAt: (r.revoked_at as string | null) ?? null,
    };
}

export async function listMembers(db: Db, workspaceId: string, ownerId: string): Promise<Member[]> {
    const { data } = await db.from('workspace_members').select('user_id, role, email, created_at').eq('workspace_id', workspaceId);
    const rows = ((data ?? []) as Row[]).map((r) => ({
        userId: String(r.user_id),
        role: normalizeRole(r.role, String(r.user_id) === ownerId),
        email: (r.email as string | null) ?? null,
        since: String(r.created_at ?? ''),
    }));
    // The owner first, then the others in the order they joined.
    return rows.sort((a, b) => (a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : a.since.localeCompare(b.since)));
}

export async function listInvites(db: Db, workspaceId: string): Promise<Invite[]> {
    const { data } = await db.from('delphi_invites').select('*').eq('workspace_id', workspaceId).order('created_at', { ascending: false });
    return ((data ?? []) as Row[]).map(toInvite);
}

export async function createInvite(db: Db, workspaceId: string, by: string, role: Exclude<Role, 'owner'>, email: string | null, token: string, nowMs = Date.now()): Promise<{ ok: boolean; error?: string; invite?: Invite }> {
    const { data, error } = await db
        .from('delphi_invites')
        .insert({ workspace_id: workspaceId, email, role, token, created_by: by, expires_at: new Date(nowMs + INVITE_DAYS * 86_400_000).toISOString() })
        .select('*')
        .single();
    if (error || !data) return { ok: false, error: error?.message ?? 'Could not create the invitation.' };
    return { ok: true, invite: toInvite(data as Row) };
}

export async function revokeInvite(db: Db, workspaceId: string, inviteId: string): Promise<void> {
    await db.from('delphi_invites').update({ revoked_at: new Date().toISOString() }).eq('workspace_id', workspaceId).eq('id', inviteId);
}

/** Never the owner's: their role is the workspace's, not a row's. */
export async function setMemberRole(db: Db, workspaceId: string, ownerId: string, userId: string, role: Exclude<Role, 'owner'>): Promise<{ ok: boolean; error?: string }> {
    if (userId === ownerId) return { ok: false, error: 'The owner is the owner.' };
    const { error } = await db.from('workspace_members').update({ role }).eq('workspace_id', workspaceId).eq('user_id', userId);
    return error ? { ok: false, error: error.message } : { ok: true };
}

export async function removeMember(db: Db, workspaceId: string, ownerId: string, userId: string): Promise<{ ok: boolean; error?: string }> {
    if (userId === ownerId) return { ok: false, error: 'The owner cannot be removed from their own workspace.' };
    const { error } = await db.from('workspace_members').delete().eq('workspace_id', workspaceId).eq('user_id', userId);
    return error ? { ok: false, error: error.message } : { ok: true };
}

/**
 * Accept an invitation as the signed-in person. Runs with the service role,
 * because they are not a member yet and the policies would show them
 * nothing. One acceptance per token; a second opening says so.
 */
export async function acceptInvite(service: Db, token: string, user: { id: string; email: string | null }, nowMs = Date.now()): Promise<{ ok: true; workspaceId: string; role: Role } | { ok: false; reason: string }> {
    if (!/^[A-Za-z0-9_-]{20,}$/.test(token)) return { ok: false, reason: 'That is not an invitation link.' };
    const { data } = await service.from('delphi_invites').select('*').eq('token', token).maybeSingle();
    if (!data) return { ok: false, reason: 'This invitation does not exist. Ask for a new link.' };
    const inv = toInvite(data as Row);
    const state = inviteState(inv, nowMs);
    if (state === 'used') return { ok: false, reason: 'This invitation has already been used. Ask for a new link.' };
    if (state === 'revoked') return { ok: false, reason: 'This invitation was withdrawn.' };
    if (state === 'expired') return { ok: false, reason: `This invitation expired after ${INVITE_DAYS} days. Ask for a new link.` };
    const workspaceId = String((data as Row).workspace_id);

    const { data: ws } = await service.from('workspaces').select('owner_id').eq('id', workspaceId).maybeSingle();
    if ((ws as Row | null)?.owner_id === user.id) return { ok: false, reason: 'You own this workspace already.' };

    const { error } = await service
        .from('workspace_members')
        .upsert({ workspace_id: workspaceId, user_id: user.id, role: inv.role, email: user.email }, { onConflict: 'workspace_id,user_id' });
    if (error) return { ok: false, reason: error.message };
    await service.from('delphi_invites').update({ accepted_by: user.id, accepted_at: new Date(nowMs).toISOString() }).eq('id', inv.id);
    return { ok: true, workspaceId, role: inv.role };
}
