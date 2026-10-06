/**
 * A room on a department page: loads it, and hands the panel what it shows.
 *
 * The owner's first visit opens a room that does not exist yet; anyone else
 * finds the one the migration (or the owner) made. Before migration 0012
 * there are no rooms, and the page says so rather than failing.
 */

import { MessagesSquare } from 'lucide-react';
import { can, type Role } from '@/lib/delphi/members';
import { isMissingColumn, type Db } from '@/lib/delphi/db';
import { listDecisions, peopleFor, roomFor, roomView, teamOf } from '@/lib/delphi/rooms';
import { accountLabel, type MediaAccount } from '@/lib/studio/accounts';
import type { DepartmentKind } from '@/lib/delphi/kinds';
import { RoomPanel } from './room-panel';

import { CEO_NAME } from '@/lib/pixel/cast/names';

export async function DepartmentRoom({
    db,
    workspaceId,
    department,
    account = null,
    role,
    user,
    ownerId,
    timezone,
}: {
    db: Db;
    workspaceId: string;
    department: { id: string; name: string; kind: DepartmentKind };
    /** A channel's room; the department's own when null. */
    account?: MediaAccount | null;
    role: Role;
    user: { id: string; user_metadata?: Record<string, unknown> | null };
    ownerId: string | null;
    timezone: string;
}) {
    const isOwner = role === 'owner';
    const room = await roomFor(db, workspaceId, department.id, account?.id ?? null, {
        create: isOwner,
        title: account ? account.name : department.name,
    });

    if (!room) {
        // No room: either the database does not know rooms yet, or nobody who
        // may open one has been here.
        const { error } = await db.from('delphi_threads').select('kind').limit(1);
        const needsMigration = Boolean(error && isMissingColumn(error));
        return (
            <section className="flex items-start gap-3 rounded-xl border border-white/10 bg-black/30 px-4 py-3">
                <MessagesSquare className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">
                    {needsMigration
                        ? isOwner
                            ? 'Rooms open once migration 0012 is run: in Supabase, SQL Editor, paste supabase/migrations/0012_departments_by_kind.sql and run it (after 0009, 0010 and 0011).'
                            : 'Rooms open once the CHO has updated the database.'
                        : 'This room opens the first time the CHO visits it.'}
                </p>
            </section>
        );
    }

    const { people } = peopleFor(role, user, ownerId);
    const [view, team, decisions] = await Promise.all([
        roomView(db, room, people),
        teamOf(db, department.id),
        listDecisions(db, workspaceId, department.id, account?.id ?? null),
    ]);

    const blurb = account
        ? `Talk about ${accountLabel(account)} with ${CEO_NAME} and the team. Only this channel's settings, decisions and work are in here — nothing from your other channels.`
        : department.kind === 'studio'
          ? `Talk about the whole studio. ${CEO_NAME} sees where each channel stands, not what was said in its room.`
          : `Talk about this department's work with ${CEO_NAME} and the team.`;

    return (
        <RoomPanel
            roomId={room.id}
            title={account ? `${account.name} — room` : 'Room'}
            blurb={blurb}
            messages={view.messages}
            work={view.work}
            team={team.map((t) => ({ name: t.name, title: t.title, slug: t.slug, avatarSeed: t.avatarSeed }))}
            decisions={decisions}
            canPost={can(role, 'post')}
            isOwner={isOwner}
            meId={user.id}
            timezone={timezone}
            scopeWord={account ? 'this channel' : 'this department'}
        />
    );
}
