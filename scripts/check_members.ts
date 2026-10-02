/**
 * Members, roles and invitations, offline.
 *
 *   npm run delphi:members
 */

import { acceptInvite, can, inviteState, INVITE_DAYS, normalizeRole, roleOf, createInvite, listMembers, setMemberRole, removeMember } from '../src/lib/delphi/members';
import type { Db } from '../src/lib/delphi/db';

const G = '\x1b[32m', R = '\x1b[31m', D = '\x1b[2m', RS = '\x1b[0m';
let failed = 0;
const ok = (cond: boolean, label: string, note = '') => {
    if (!cond) failed++;
    console.log(`  ${cond ? G + '✓' : R + '✗'}${RS} ${label.padEnd(66)}${note ? D + note + RS : ''}`);
};

type Row = Record<string, unknown>;
function fakeDb(tables: Record<string, Row[]>) {
    let nextId = 1;
    function builder(table: string) {
        const st = { op: 'select' as 'select' | 'insert' | 'update' | 'delete' | 'upsert', filters: [] as ((r: Row) => boolean)[], payload: null as unknown, single: false, conflict: '' };
        const run = () => {
            const rows = (tables[table] ??= []);
            let out: Row[];
            if (st.op === 'insert' || st.op === 'upsert') {
                const ins = (Array.isArray(st.payload) ? st.payload : [st.payload]) as Row[];
                out = [];
                for (const r of ins) {
                    const keys = st.conflict ? st.conflict.split(',') : [];
                    const hit = keys.length ? rows.find((e) => keys.every((k) => e[k] === r[k])) : undefined;
                    if (hit && st.op === 'upsert') {
                        Object.assign(hit, r);
                        out.push(hit);
                    } else {
                        const row = { id: `${table}-${nextId++}`, created_at: new Date().toISOString(), ...r };
                        rows.push(row);
                        out.push(row);
                    }
                }
            } else if (st.op === 'update') {
                out = rows.filter((r) => st.filters.every((f) => f(r)));
                for (const r of out) Object.assign(r, st.payload as Row);
            } else if (st.op === 'delete') {
                out = rows.filter((r) => st.filters.every((f) => f(r)));
                for (const r of out) rows.splice(rows.indexOf(r), 1);
            } else {
                out = rows.filter((r) => st.filters.every((f) => f(r))).map((r) => ({ ...r }));
            }
            return st.single ? { data: out[0] ?? null, error: null } : { data: out, error: null };
        };
        const b: Record<string, unknown> = {
            select: () => b,
            order: () => b,
            eq: (k: string, v: unknown) => (st.filters.push((r) => r[k] === v), b),
            insert: (p: unknown) => ((st.op = 'insert'), (st.payload = p), b),
            upsert: (p: unknown, o?: { onConflict?: string }) => ((st.op = 'upsert'), (st.payload = p), (st.conflict = o?.onConflict ?? ''), b),
            update: (p: unknown) => ((st.op = 'update'), (st.payload = p), b),
            delete: () => ((st.op = 'delete'), b),
            single: () => ((st.single = true), b),
            maybeSingle: () => ((st.single = true), b),
            then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
        };
        return b;
    }
    return { db: { from: builder } as unknown as Db, tables };
}

(async () => {
    console.log('\nRoles');
    {
        ok(normalizeRole('owner') === 'owner' && normalizeRole('viewer') === 'viewer' && normalizeRole('reviewer') === 'reviewer', 'the three roles read as themselves');
        ok(normalizeRole('member') === 'reviewer' && normalizeRole(undefined) === 'reviewer', 'the base migration\'s "member" is a reviewer');
        ok(normalizeRole('viewer', true) === 'owner', 'whoever owns the workspace is the owner whatever the row says');
        const acts = ['decide', 'staff', 'run', 'switch', 'settings', 'delete', 'invite', 'post'] as const;
        ok(acts.every((a) => can('owner', a)), 'the owner may do everything');
        ok(acts.every((a) => can('reviewer', a) === (a === 'post')), 'a reviewer may post, and nothing else');
        ok(acts.every((a) => !can('viewer', a)), 'a viewer may do nothing');
    }

    console.log('\nWho someone is');
    {
        const { db } = fakeDb({
            workspaces: [{ id: 'ws', owner_id: 'curtis' }],
            workspace_members: [
                { workspace_id: 'ws', user_id: 'curtis', role: 'owner' },
                { workspace_id: 'ws', user_id: 'ada', role: 'member' },
                { workspace_id: 'ws', user_id: 'bo', role: 'viewer' },
            ],
        });
        ok((await roleOf(db, 'ws', 'curtis')) === 'owner', 'the owner, by their row');
        ok((await roleOf(db, 'ws', 'ada')) === 'reviewer', 'a legacy member, as a reviewer');
        ok((await roleOf(db, 'ws', 'bo')) === 'viewer', 'a viewer, as a viewer');
        ok((await roleOf(db, 'ws', 'stranger')) === 'viewer', 'nobody in particular can at most look');
        const { db: noRow } = fakeDb({ workspaces: [{ id: 'ws', owner_id: 'curtis' }], workspace_members: [] });
        ok((await roleOf(noRow, 'ws', 'curtis')) === 'owner', 'an owner without a membership row is still the owner');
        const members = await listMembers(db, 'ws', 'curtis');
        ok(members[0].role === 'owner' && members.length === 3, 'the team lists the owner first', members.map((m) => m.role).join(','));
        ok(!(await setMemberRole(db, 'ws', 'curtis', 'curtis', 'viewer')).ok && !(await removeMember(db, 'ws', 'curtis', 'curtis')).ok, 'the owner can be neither demoted nor removed');
        ok((await setMemberRole(db, 'ws', 'curtis', 'ada', 'viewer')).ok && (await roleOf(db, 'ws', 'ada')) === 'viewer', 'a reviewer can be made a viewer');
        ok((await removeMember(db, 'ws', 'curtis', 'bo')).ok && (await roleOf(db, 'ws', 'bo')) === 'viewer' && (await listMembers(db, 'ws', 'curtis')).length === 2, 'and a member removed');
    }

    console.log('\nInvitations');
    {
        const NOW = Date.parse('2026-10-02T12:00:00Z');
        const { db, tables } = fakeDb({ workspaces: [{ id: 'ws', owner_id: 'curtis' }], workspace_members: [{ workspace_id: 'ws', user_id: 'curtis', role: 'owner' }], delphi_invites: [] });
        const made = await createInvite(db, 'ws', 'curtis', 'reviewer', null, 'tok_abcdefghijklmnopqrstuvwxyz', NOW);
        ok(made.ok && made.invite?.role === 'reviewer' && Date.parse(made.invite.expiresAt) === NOW + INVITE_DAYS * 86_400_000, 'an invitation is minted for a role, good for seven days');
        const inv = made.invite!;
        ok(inviteState(inv, NOW) === 'open' && inviteState(inv, NOW + 8 * 86_400_000) === 'expired', 'open now, expired after a week');
        ok(inviteState({ ...inv, acceptedAt: 'x' }, NOW) === 'used' && inviteState({ ...inv, revokedAt: 'x' }, NOW) === 'revoked', 'used once used, withdrawn once withdrawn');

        ok(!(await acceptInvite(db, 'short', { id: 'ada', email: 'ada@example.com' }, NOW)).ok, 'a token that is not a token is refused');
        ok(!(await acceptInvite(db, 'tok_nobody_knows_this_one_at_all', { id: 'ada', email: null }, NOW)).ok, 'as is one nobody minted');
        const owner = await acceptInvite(db, inv.token, { id: 'curtis', email: 'c@example.com' }, NOW);
        ok(!owner.ok && /own this workspace/.test(owner.reason), 'the owner cannot join their own workspace as a guest');

        const joined = await acceptInvite(db, inv.token, { id: 'ada', email: 'ada@example.com' }, NOW + 1000);
        ok(joined.ok && joined.workspaceId === 'ws' && joined.role === 'reviewer', 'whoever opens it signed in joins in that role');
        const row = tables.workspace_members.find((m) => m.user_id === 'ada');
        ok(row?.role === 'reviewer' && row.email === 'ada@example.com' && (await roleOf(db, 'ws', 'ada')) === 'reviewer', 'with their email kept for the team list');
        ok(tables.delphi_invites[0].accepted_by === 'ada' && !!tables.delphi_invites[0].accepted_at, 'and the invitation marked used');
        const again = await acceptInvite(db, inv.token, { id: 'bo', email: null }, NOW + 2000);
        ok(!again.ok && /already been used/.test(again.reason), 'a second person opening it is told it was used');

        const late = await createInvite(db, 'ws', 'curtis', 'viewer', null, 'tok_late_late_late_late_late_late', NOW);
        const expired = await acceptInvite(db, late.invite!.token, { id: 'bo', email: null }, NOW + 8 * 86_400_000);
        ok(!expired.ok && /expired/.test(expired.reason), 'an old link says it expired');
        const rejoin = await acceptInvite(db, late.invite!.token, { id: 'ada', email: 'ada@example.com' }, NOW + 5000);
        ok(rejoin.ok && (await roleOf(db, 'ws', 'ada')) === 'viewer' && tables.workspace_members.filter((m) => m.user_id === 'ada').length === 1, 'an existing member opening a new link takes its role, once');
    }

    console.log(`\n${failed ? R + failed + ' failed' : G + 'all passed'}${RS}\n`);
    process.exit(failed ? 1 : 0);
})().catch((e) => {
    console.error('THREW:', e);
    process.exit(1);
});
