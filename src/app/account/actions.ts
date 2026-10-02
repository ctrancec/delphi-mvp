'use server';

/**
 * Password management.
 *
 * Three flows, and they have genuinely different threat models:
 *
 * - **Requesting a reset** is unauthenticated, so it must never reveal whether
 *   an address has an account. Enumeration is the whole attack here.
 * - **Setting a new password from a link** runs inside the short-lived session
 *   the email code granted. Possession of the inbox is the authentication.
 * - **Changing it while signed in** is the one place a current password is
 *   demanded, because a live session is not proof that the person at the
 *   keyboard is the account holder. A borrowed laptop should not be a takeover.
 */

import { createClient, currentUser } from '@/lib/supabase/server';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { cleanName, NAME_MAX } from '@/lib/delphi/cho';
import { findWorkspace } from '@/lib/delphi/bootstrap';
import { addSubscription, notify, removeSubscription, savePrefs, type Prefs } from '@/lib/delphi/notify';
import { APP_NAME } from '@/lib/pixel/cast/names';

export interface AuthResult {
    ok: boolean;
    error?: string;
    message?: string;
}

/** Long enough to matter, short enough that people do not paste it into a note. */
const MIN_PASSWORD = 10;

function checkPassword(password: string, confirm: string): string | null {
    if (password.length < MIN_PASSWORD) {
        return `Use at least ${MIN_PASSWORD} characters. Length beats complexity.`;
    }
    if (password !== confirm) return 'The two passwords do not match.';
    // A password made only of one character class is weak however long it is.
    const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z0-9]/].filter((re) => re.test(password)).length;
    if (classes < 2) return 'Mix at least two of: lower case, upper case, digits, symbols.';
    return null;
}

/**
 * Send a reset link.
 *
 * Always reports success, whatever happened. Telling an anonymous caller that
 * an address has no account hands them a list of the ones that do, and the
 * cost of that is far higher than the mild confusion of a typo'd email
 * appearing to work.
 */
export async function requestPasswordResetAction(email: string): Promise<AuthResult> {
    const address = email.trim().toLowerCase();
    if (!address || !address.includes('@')) {
        return { ok: false, error: 'Enter the email address on the account.' };
    }

    const supabase = await createClient();
    if (!supabase) return { ok: false, error: 'Authentication is not configured.' };

    // The deployment's own origin, so a reset link works on preview builds and
    // on a custom domain without either being hardcoded.
    const host = (await headers()).get('host') ?? 'localhost:3000';
    const proto = host.startsWith('localhost') ? 'http' : 'https';

    const { error } = await supabase.auth.resetPasswordForEmail(address, {
        redirectTo: `${proto}://${host}/auth/callback?next=/account/new-password`,
    });

    if (error) {
        // Logged, not surfaced — see the enumeration note above.
        console.error('[auth] reset request failed:', error.message);
    }

    return {
        ok: true,
        message: `If ${address} has an account, a reset link is on its way. It expires in an hour.`,
    };
}

/**
 * Set a new password using the session the emailed link granted.
 *
 * No current password is asked for, and none exists to ask for — the point of
 * this flow is that the old one is lost. Control of the inbox is the proof.
 */
export async function setNewPasswordAction(
    password: string,
    confirm: string
): Promise<AuthResult> {
    const problem = checkPassword(password, confirm);
    if (problem) return { ok: false, error: problem };

    const supabase = await createClient();
    if (!supabase) return { ok: false, error: 'Authentication is not configured.' };

    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return {
            ok: false,
            error: 'This reset link has expired or was already used. Request a new one.',
        };
    }

    const { error } = await supabase.auth.updateUser({ password });
    if (error) return { ok: false, error: error.message };

    return { ok: true, message: 'Password changed. You are signed in.' };
}

/**
 * Change the password of a signed-in account.
 *
 * The current password is verified first by actually signing in with it.
 * Supabase does not require this, which is precisely why it is done here: an
 * unattended open session would otherwise be enough to lock the real owner out.
 */
export async function changePasswordAction(
    currentPassword: string,
    password: string,
    confirm: string
): Promise<AuthResult> {
    const problem = checkPassword(password, confirm);
    if (problem) return { ok: false, error: problem };

    const supabase = await createClient();
    if (!supabase) return { ok: false, error: 'Authentication is not configured.' };

    const {
        data: { user },
    } = await supabase.auth.getUser();
    if (!user?.email) return { ok: false, error: 'You are not signed in.' };

    if (!currentPassword) {
        return { ok: false, error: 'Enter your current password.' };
    }
    if (currentPassword === password) {
        return { ok: false, error: 'The new password is the same as the current one.' };
    }

    const { error: reauthError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPassword,
    });
    if (reauthError) {
        return { ok: false, error: 'That is not your current password.' };
    }

    const { error } = await supabase.auth.updateUser({ password });
    if (error) return { ok: false, error: error.message };

    return { ok: true, message: 'Password changed.' };
}

/**
 * Send a reset link to the signed-in account's own address.
 *
 * For the case where someone is signed in on one device and cannot recall the
 * password to type into the change form. Safe to be specific here — the
 * address is already known to whoever is holding the session.
 */
export async function emailMyselfAResetAction(): Promise<AuthResult> {
    const supabase = await createClient();
    if (!supabase) return { ok: false, error: 'Authentication is not configured.' };

    const {
        data: { user },
    } = await supabase.auth.getUser();
    if (!user?.email) return { ok: false, error: 'You are not signed in.' };

    const host = (await headers()).get('host') ?? 'localhost:3000';
    const proto = host.startsWith('localhost') ? 'http' : 'https';

    const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
        redirectTo: `${proto}://${host}/auth/callback?next=/account/new-password`,
    });
    if (error) return { ok: false, error: error.message };

    return { ok: true, message: `Reset link sent to ${user.email}.` };
}

/**
 * Set the name the CHO goes by. Kept on the auth user, where a sign-up or a
 * Google account puts it too, so one place answers "what do we call you".
 * Blank clears it, and the cast's name for the role takes over.
 */
export async function setNameAction(name: string): Promise<AuthResult> {
    const clean = cleanName(name);
    if (typeof name === 'string' && name.trim().length > NAME_MAX) {
        return { ok: false, error: `Keep it to ${NAME_MAX} characters.` };
    }

    const supabase = await createClient();
    if (!supabase) return { ok: false, error: 'Authentication is not configured.' };

    const { error } = await supabase.auth.updateUser({ data: { full_name: clean || null } });
    if (error) return { ok: false, error: error.message };

    revalidatePath('/dashboard', 'layout');
    return { ok: true, message: clean ? `From now on the town calls you ${clean}.` : 'Cleared. The town calls you by the role again.' };
}

// ---------------------------------------------------------------------------
// Notifications: what reaches you outside the app, and on which devices.
// ---------------------------------------------------------------------------

async function whoAndWhere(): Promise<{ db: NonNullable<Awaited<ReturnType<typeof createClient>>>; userId: string; workspaceId: string } | { error: string }> {
    const db = await createClient();
    if (!db) return { error: 'Authentication is not configured.' };
    const user = await currentUser();
    if (!user) return { error: 'You are not signed in.' };
    const workspaceId = await findWorkspace(db);
    if (!workspaceId) return { error: 'There is no workspace yet. Open Mission control once first.' };
    return { db, userId: user.id, workspaceId };
}

const looksLikeEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

export async function saveNotifyPrefsAction(prefs: Prefs): Promise<AuthResult> {
    const ctx = await whoAndWhere();
    if ('error' in ctx) return { ok: false, error: ctx.error };
    const email = (prefs.email ?? '').trim();
    if (email && !looksLikeEmail(email)) return { ok: false, error: 'That does not look like an email address.' };
    const saved = await savePrefs(ctx.db, ctx.workspaceId, ctx.userId, { email: email || null, onReport: !!prefs.onReport, onApproval: !!prefs.onApproval, onHalt: !!prefs.onHalt });
    if (!saved.ok) return { ok: false, error: saved.error?.includes('delphi_notify_prefs') ? 'The notifications tables are not in the database yet: run migration 0009 in the Supabase SQL editor.' : saved.error };
    revalidatePath('/dashboard/account');
    return { ok: true, message: 'Saved.' };
}

export async function subscribePushAction(sub: { endpoint: string; keys: { p256dh: string; auth: string } }): Promise<AuthResult> {
    const ctx = await whoAndWhere();
    if ('error' in ctx) return { ok: false, error: ctx.error };
    const agent = (await headers()).get('user-agent');
    const added = await addSubscription(ctx.db, ctx.workspaceId, ctx.userId, sub, agent);
    if (!added.ok) return { ok: false, error: added.error };
    revalidatePath('/dashboard/account');
    return { ok: true, message: 'This device will be notified.' };
}

export async function unsubscribePushAction(endpoint: string): Promise<AuthResult> {
    const ctx = await whoAndWhere();
    if ('error' in ctx) return { ok: false, error: ctx.error };
    await removeSubscription(ctx.db, ctx.userId, endpoint);
    revalidatePath('/dashboard/account');
    return { ok: true, message: 'This device will not be notified.' };
}

/** A note to yourself, to see that the channels work before relying on them. */
export async function sendTestNotificationAction(): Promise<AuthResult> {
    const ctx = await whoAndWhere();
    if ('error' in ctx) return { ok: false, error: ctx.error };
    const out = await notify(
        ctx.db,
        ctx.workspaceId,
        { kind: 'test', title: `${APP_NAME} can reach you`, body: 'This is the test you asked for from Account settings.', url: '/dashboard/delphi' },
        { onlyUserId: ctx.userId }
    );
    const parts: string[] = [];
    if (out.pushed) parts.push(`${out.pushed} device${out.pushed === 1 ? '' : 's'}`);
    if (out.emailed) parts.push('your email');
    if (!parts.length) {
        return { ok: false, error: out.errors[0] ? `Nothing arrived: ${out.errors[0]}` : 'Nothing is switched on yet: add an email address or turn on push on this device.' };
    }
    return { ok: true, message: `Sent to ${parts.join(' and ')}.${out.errors.length ? ` Some failed: ${out.errors[0]}` : ''}` };
}
