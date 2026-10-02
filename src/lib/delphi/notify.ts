/**
 * Telling the CHO when something needs them, wherever they are.
 *
 * Three things are worth interrupting someone for: a report has landed, an
 * approval is waiting, the system halted on budget. Each goes by push to
 * every device that asked for it and by email to an address they gave, and
 * only to people who switched that kind on. Everything here is best effort
 * with a short clock on it: a push service that does not answer must never
 * hold up a run, and nothing here throws.
 */

import { APP_NAME } from '@/lib/pixel/cast/names';
import { isEmailConfigured, sendEmail } from '@/lib/notify/email';
import { sendPush, type PushKeys, type Subscription } from '@/lib/notify/webpush';
import type { Db } from './db';

export type NoteKind = 'report' | 'approval' | 'halt' | 'test';

export interface Note {
    kind: NoteKind;
    title: string;
    body: string;
    /** Where tapping it goes, as a path. */
    url: string;
}

export interface Prefs {
    email: string | null;
    onReport: boolean;
    onApproval: boolean;
    onHalt: boolean;
}

export const DEFAULT_PREFS: Prefs = { email: null, onReport: true, onApproval: true, onHalt: true };

type Row = Record<string, unknown>;

const SITE = () => (process.env.NEXT_PUBLIC_SITE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'https://delphi-mvp.vercel.app').replace(/\/$/, '');

export function pushKeys(): PushKeys | null {
    const publicKey = (process.env.VAPID_PUBLIC_KEY ?? '').trim();
    const privateKey = (process.env.VAPID_PRIVATE_KEY ?? '').trim();
    const subject = (process.env.VAPID_SUBJECT ?? '').trim();
    return publicKey && privateKey && subject ? { publicKey, privateKey, subject } : null;
}

export function isPushConfigured(): boolean {
    return pushKeys() !== null;
}

export { isEmailConfigured };

function toPrefs(r: Row | null): Prefs {
    if (!r) return DEFAULT_PREFS;
    return {
        email: (r.email as string | null) ?? null,
        onReport: r.on_report !== false,
        onApproval: r.on_approval !== false,
        onHalt: r.on_halt !== false,
    };
}

export async function readPrefs(db: Db, workspaceId: string, userId: string): Promise<Prefs> {
    const { data } = await db.from('delphi_notify_prefs').select('*').eq('workspace_id', workspaceId).eq('user_id', userId).maybeSingle();
    return toPrefs((data as Row | null) ?? null);
}

export async function savePrefs(db: Db, workspaceId: string, userId: string, prefs: Prefs): Promise<{ ok: boolean; error?: string }> {
    const { error } = await db.from('delphi_notify_prefs').upsert(
        {
            workspace_id: workspaceId,
            user_id: userId,
            email: prefs.email?.trim() || null,
            on_report: prefs.onReport,
            on_approval: prefs.onApproval,
            on_halt: prefs.onHalt,
            updated_at: new Date().toISOString(),
        },
        { onConflict: 'workspace_id,user_id' }
    );
    return error ? { ok: false, error: error.message } : { ok: true };
}

export async function addSubscription(db: Db, workspaceId: string, userId: string, sub: Subscription, userAgent: string | null): Promise<{ ok: boolean; error?: string }> {
    if (!/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) return { ok: false, error: 'That is not a push subscription.' };
    const { error } = await db.from('delphi_push_subscriptions').upsert(
        { workspace_id: workspaceId, user_id: userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, user_agent: userAgent?.slice(0, 200) ?? null, failures: 0 },
        { onConflict: 'endpoint' }
    );
    return error ? { ok: false, error: error.message } : { ok: true };
}

export async function removeSubscription(db: Db, userId: string, endpoint: string): Promise<void> {
    await db.from('delphi_push_subscriptions').delete().eq('user_id', userId).eq('endpoint', endpoint);
}

export async function countSubscriptions(db: Db, workspaceId: string, userId: string): Promise<number> {
    const { count } = await db.from('delphi_push_subscriptions').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId).eq('user_id', userId);
    return count ?? 0;
}

function wants(prefs: Prefs, kind: NoteKind): boolean {
    switch (kind) {
        case 'report':
            return prefs.onReport;
        case 'approval':
            return prefs.onApproval;
        case 'halt':
            return prefs.onHalt;
        case 'test':
            return true;
    }
}

function emailBody(note: Note, link: string): { text: string; html: string } {
    const text = `${note.title}\n\n${note.body}\n\n${link}\n\n— ${APP_NAME}`;
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const html = `<div style="font-family:Inter,system-ui,sans-serif;max-width:520px;color:#1a1423"><h2 style="margin:0 0 8px">${esc(note.title)}</h2><p style="margin:0 0 16px;color:#444">${esc(note.body)}</p><p><a href="${link}" style="display:inline-block;background:#4aa7d8;color:#06111a;padding:10px 16px;border-radius:6px;text-decoration:none;font-weight:600">Open ${esc(APP_NAME)}</a></p><p style="color:#888;font-size:12px">${esc(APP_NAME)} sent this because you switched it on in Account settings.</p></div>`;
    return { text, html };
}

export interface NotifyOutcome {
    pushed: number;
    emailed: number;
    /** Devices the push service said were gone, now removed. */
    dropped: number;
    errors: string[];
}

/**
 * Deliver a note to everyone in the workspace who asked for its kind, or to
 * one person (`onlyUserId`) for a test. Reads each person's preferences and
 * devices; sends in parallel; drops devices that are gone; returns counts.
 */
export async function notify(db: Db, workspaceId: string, note: Note, opts: { onlyUserId?: string } = {}): Promise<NotifyOutcome> {
    const outcome: NotifyOutcome = { pushed: 0, emailed: 0, dropped: 0, errors: [] };
    try {
        let prefsQuery = db.from('delphi_notify_prefs').select('*').eq('workspace_id', workspaceId);
        if (opts.onlyUserId) prefsQuery = prefsQuery.eq('user_id', opts.onlyUserId);
        const { data: prefRows } = await prefsQuery;
        let subsQuery = db.from('delphi_push_subscriptions').select('*').eq('workspace_id', workspaceId);
        if (opts.onlyUserId) subsQuery = subsQuery.eq('user_id', opts.onlyUserId);
        const { data: subRows } = await subsQuery;

        const prefsByUser = new Map<string, Prefs>();
        for (const r of (prefRows ?? []) as Row[]) prefsByUser.set(String(r.user_id), toPrefs(r));
        // Devices belong to people who may never have saved preferences: the defaults apply.
        for (const r of (subRows ?? []) as Row[]) if (!prefsByUser.has(String(r.user_id))) prefsByUser.set(String(r.user_id), DEFAULT_PREFS);

        const link = `${SITE()}${note.url}`;
        const keys = pushKeys();
        const jobs: Promise<void>[] = [];

        for (const [userId, prefs] of prefsByUser) {
            if (!wants(prefs, note.kind)) continue;
            if (prefs.email && isEmailConfigured()) {
                const { text, html } = emailBody(note, link);
                jobs.push(
                    sendEmail(prefs.email, `${note.title} · ${APP_NAME}`, text, html).then((r) => {
                        if (r.ok) outcome.emailed++;
                        else outcome.errors.push(`email: ${r.detail ?? r.status}`);
                    })
                );
            }
            if (keys) {
                for (const r of ((subRows ?? []) as Row[]).filter((s) => String(s.user_id) === userId)) {
                    const sub: Subscription = { endpoint: String(r.endpoint), keys: { p256dh: String(r.p256dh), auth: String(r.auth) } };
                    jobs.push(
                        sendPush(sub, { title: note.title, body: note.body, url: note.url, tag: `tempest-${note.kind}` }, keys).then(async (res) => {
                            if (res.ok) {
                                outcome.pushed++;
                                await db.from('delphi_push_subscriptions').update({ last_ok_at: new Date().toISOString(), failures: 0 }).eq('id', r.id);
                            } else if (res.gone) {
                                outcome.dropped++;
                                await db.from('delphi_push_subscriptions').delete().eq('id', r.id);
                            } else {
                                outcome.errors.push(`push: ${res.detail ?? res.status}`);
                                await db.from('delphi_push_subscriptions').update({ failures: Number(r.failures ?? 0) + 1 }).eq('id', r.id);
                            }
                        })
                    );
                }
            }
        }
        await Promise.allSettled(jobs);
    } catch (err) {
        outcome.errors.push((err as Error).message);
    }
    return outcome;
}
