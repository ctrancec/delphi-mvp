/**
 * The workspace's time zone: the CHO's own, found on their device.
 *
 * There is one. Work hours, every department's schedule and every channel's,
 * and the month a budget belongs to are all read in it. Nobody is asked for
 * it: the first time the CHO opens the dashboard with none known, their
 * device's zone is kept. A zone already known is never replaced from a
 * device — travelling for a week does not move a channel's 09:00 — and the
 * CHO can change it themselves in Account settings.
 *
 * Departments follow it, unless one was deliberately given its own (a
 * channel aimed at another country, say), which then stays as chosen.
 *
 * Stored where the scheduler already reads the work hours: the
 * `delphi_system_state.timezone` column (migration 0005). UTC there means
 * "not known yet": it is the column's default, and no person's device
 * reports it.
 */

import { isMissingColumn, type Db } from './db';
import { isTimezone, withSettings } from './kinds';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

export const UNKNOWN_ZONE = 'UTC';

/**
 * The workspace's zone, or null while it is not known. Hours the CHO switched
 * on count as known, whatever zone they are in: those were set deliberately.
 */
export async function workspaceZone(db: Db, workspaceId: string): Promise<string | null> {
    const { data, error } = await db.from('delphi_system_state').select('*').eq('workspace_id', workspaceId).maybeSingle();
    if (error || !data) return null;
    const tz = (data as Row).timezone;
    if (!isTimezone(tz)) return null;
    if (tz === UNKNOWN_ZONE && !(data as Row).schedule_enabled) return null;
    return tz;
}

/** Every department that follows the workspace's zone takes it; one given its own keeps it. Returns how many changed. */
export async function followZone(db: Db, workspaceId: string, zone: string): Promise<number> {
    if (!isTimezone(zone)) return 0;
    const { data, error } = await db.from('delphi_departments').select('id, settings').eq('workspace_id', workspaceId);
    // Before migration 0012 departments have no settings, and nothing to follow.
    if (error) return 0;
    let changed = 0;
    for (const d of (data ?? []) as Row[]) {
        const s = withSettings(d.settings);
        if (s.timezonePinned || s.timezone === zone) continue;
        const raw = d.settings && typeof d.settings === 'object' ? (d.settings as Row) : {};
        const { error: upd } = await db
            .from('delphi_departments')
            .update({ settings: { ...raw, timezone: zone } })
            .eq('id', d.id)
            .eq('workspace_id', workspaceId);
        if (!upd) changed++;
    }
    return changed;
}

/** Make `zone` the workspace's, and bring the departments that follow it along. */
export async function setWorkspaceZone(db: Db, workspaceId: string, zone: string): Promise<{ ok: boolean; error?: string; departments?: number }> {
    if (!isTimezone(zone)) return { ok: false, error: `${zone} is not a time zone I recognise.` };
    const { data: row } = await db.from('delphi_system_state').select('workspace_id').eq('workspace_id', workspaceId).maybeSingle();
    const { error } = row
        ? await db.from('delphi_system_state').update({ timezone: zone }).eq('workspace_id', workspaceId)
        : await db.from('delphi_system_state').insert({ workspace_id: workspaceId, timezone: zone });
    if (error) {
        return { ok: false, error: isMissingColumn(error) ? 'The time zone needs migration 0005 applied to the database first.' : error.message };
    }
    return { ok: true, departments: await followZone(db, workspaceId, zone) };
}

/**
 * What the CHO's device says, on opening the dashboard. Kept only while the
 * workspace has no zone; either way, departments still on the default are
 * brought in line with the workspace's.
 */
export async function adoptDeviceZone(db: Db, workspaceId: string, deviceZone: string): Promise<{ zone: string | null; adopted: boolean; departments: number }> {
    const known = await workspaceZone(db, workspaceId);
    if (known) return { zone: known, adopted: false, departments: await followZone(db, workspaceId, known) };
    if (!isTimezone(deviceZone) || deviceZone === UNKNOWN_ZONE) return { zone: null, adopted: false, departments: 0 };
    const res = await setWorkspaceZone(db, workspaceId, deviceZone);
    return res.ok ? { zone: deviceZone, adopted: true, departments: res.departments ?? 0 } : { zone: null, adopted: false, departments: 0 };
}
