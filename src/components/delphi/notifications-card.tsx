'use client';

/**
 * What reaches you outside the app.
 *
 * Three kinds of news, each a switch; an email address, which is yours to
 * give; and push on this device, which the browser has to be asked for.
 * A test button, because a notification channel nobody has tried is a
 * channel nobody can rely on.
 */

import { useEffect, useState, useTransition } from 'react';
import { Bell, BellOff, Check, Loader2, Send, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { saveNotifyPrefsAction, sendTestNotificationAction, subscribePushAction, unsubscribePushAction } from '@/app/account/actions';
import type { Prefs } from '@/lib/delphi/notify';
import { APP_NAME } from '@/lib/pixel/cast/names';

type PushState = 'checking' | 'unsupported' | 'no-worker' | 'denied' | 'off' | 'on';

function serverKey(base64url: string): Uint8Array {
    const padded = base64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (base64url.length % 4)) % 4);
    const raw = atob(padded);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
}

export function NotificationsCard({
    prefs: initial,
    signInEmail,
    pushConfigured,
    emailConfigured,
    vapidPublicKey,
    devices,
    migrated,
}: {
    prefs: Prefs;
    signInEmail: string;
    pushConfigured: boolean;
    emailConfigured: boolean;
    vapidPublicKey: string | null;
    /** Devices of yours already subscribed. */
    devices: number;
    /** False when the notifications tables are not in the database yet. */
    migrated: boolean;
}) {
    const [prefs, setPrefs] = useState<Prefs>(initial);
    const [email, setEmail] = useState(initial.email ?? '');
    const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
    const [push, setPush] = useState<PushState>('checking');
    const [pending, startTransition] = useTransition();

    useEffect(() => {
        (async () => {
            if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return setPush('unsupported');
            const reg = await navigator.serviceWorker.getRegistration();
            if (!reg) return setPush('no-worker');
            if (Notification.permission === 'denied') return setPush('denied');
            const sub = await reg.pushManager.getSubscription();
            setPush(sub ? 'on' : 'off');
        })().catch(() => setPush('unsupported'));
    }, []);

    const dirty = email.trim() !== (initial.email ?? '') || prefs.onReport !== initial.onReport || prefs.onApproval !== initial.onApproval || prefs.onHalt !== initial.onHalt;

    const save = () =>
        startTransition(async () => {
            const res = await saveNotifyPrefsAction({ ...prefs, email: email.trim() || null });
            setNote({ ok: res.ok, text: res.ok ? (res.message ?? 'Saved.') : (res.error ?? 'Could not save.') });
        });

    const turnOn = () =>
        startTransition(async () => {
            try {
                if (!vapidPublicKey) throw new Error('Push is not set up on the server yet.');
                const permission = await Notification.requestPermission();
                if (permission !== 'granted') {
                    setPush(permission === 'denied' ? 'denied' : 'off');
                    setNote({ ok: false, text: 'The browser did not allow notifications.' });
                    return;
                }
                const reg = await navigator.serviceWorker.getRegistration();
                if (!reg) throw new Error('The app is not installed as a service worker here.');
                const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: serverKey(vapidPublicKey) as BufferSource }));
                const json = sub.toJSON();
                const res = await subscribePushAction({ endpoint: sub.endpoint, keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' } });
                if (!res.ok) throw new Error(res.error ?? 'Could not save this device.');
                setPush('on');
                setNote({ ok: true, text: res.message ?? 'On.' });
            } catch (err) {
                setNote({ ok: false, text: (err as Error).message });
            }
        });

    const turnOff = () =>
        startTransition(async () => {
            const reg = await navigator.serviceWorker.getRegistration();
            const sub = await reg?.pushManager.getSubscription();
            if (sub) {
                await unsubscribePushAction(sub.endpoint);
                await sub.unsubscribe();
            }
            setPush('off');
            setNote({ ok: true, text: 'This device will not be notified.' });
        });

    const test = () =>
        startTransition(async () => {
            const res = await sendTestNotificationAction();
            setNote({ ok: res.ok, text: res.ok ? (res.message ?? 'Sent.') : (res.error ?? 'Nothing arrived.') });
        });

    const Toggle = ({ k, label, hint }: { k: 'onReport' | 'onApproval' | 'onHalt'; label: string; hint: string }) => (
        <label className="flex cursor-pointer items-start gap-3 text-sm">
            <input type="checkbox" checked={prefs[k]} onChange={(e) => setPrefs({ ...prefs, [k]: e.target.checked })} className="mt-1 h-4 w-4 accent-[#4aa7d8]" />
            <span>
                <span className="text-zinc-100">{label}</span>
                <span className="block text-xs text-muted-foreground">{hint}</span>
            </span>
        </label>
    );

    return (
        <div className="space-y-5">
            {!migrated && (
                <p className="flex items-start gap-2 text-xs text-amber-400">
                    <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    The notifications tables are not in the database yet. Run migration 0009 in the Supabase SQL editor, then come back here.
                </p>
            )}

            <div className="space-y-2">
                <Toggle k="onReport" label="A report lands" hint="When a project finishes and its deliverables are in Outputs." />
                <Toggle k="onApproval" label="An approval is waiting" hint="When an agent, or Diablo, needs your decision." />
                <Toggle k="onHalt" label="The system halts on budget" hint="When a project stops because its budget is spent." />
            </div>

            <div className="space-y-2">
                <Label htmlFor="notify-email">Email</Label>
                <div className="flex flex-wrap gap-2">
                    <Input id="notify-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Leave blank for no email" className="max-w-xs border-white/10 bg-white/5" />
                    {signInEmail && email.trim() !== signInEmail && (
                        <Button type="button" size="sm" variant="outline" onClick={() => setEmail(signInEmail)} className="border-white/10">
                            Use my sign-in address
                        </Button>
                    )}
                </div>
                <p className="text-xs text-muted-foreground">
                    {emailConfigured ? `Sent by ${APP_NAME} through Resend, only to the address you give here.` : 'Email is not set up on the server yet: add RESEND_API_KEY in Vercel. The address is kept for when it is.'}
                </p>
            </div>

            <div className="space-y-2">
                <Label>Push on this device</Label>
                {push === 'checking' && <p className="text-xs text-muted-foreground">Checking this browser…</p>}
                {push === 'unsupported' && <p className="text-xs text-muted-foreground">This browser cannot receive push notifications. On iPhone, install {APP_NAME} to the home screen first.</p>}
                {push === 'no-worker' && <p className="text-xs text-muted-foreground">Push works once {APP_NAME} is running from its deployed site, where its service worker is installed.</p>}
                {push === 'denied' && <p className="text-xs text-amber-400">Notifications are blocked for this site in the browser&apos;s settings. Allow them there, then try again.</p>}
                {(push === 'off' || push === 'on') && (
                    <div className="flex flex-wrap items-center gap-2">
                        {push === 'off' ? (
                            <Button type="button" size="sm" onClick={turnOn} disabled={pending || !pushConfigured}>
                                <Bell className="mr-2 h-3.5 w-3.5" /> Turn on
                            </Button>
                        ) : (
                            <Button type="button" size="sm" variant="outline" onClick={turnOff} disabled={pending} className="border-white/10">
                                <BellOff className="mr-2 h-3.5 w-3.5" /> Turn off on this device
                            </Button>
                        )}
                        <span className="text-xs text-muted-foreground">
                            {!pushConfigured ? 'Push is not set up on the server yet: run npm run delphi:vapid and add the three values in Vercel.' : devices > 0 ? `${devices} device${devices === 1 ? '' : 's'} of yours will be notified.` : 'No device of yours is subscribed yet.'}
                        </span>
                    </div>
                )}
            </div>

            {note && (
                <p className={`flex items-center gap-2 text-sm ${note.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                    {note.ok ? <Check className="h-4 w-4 shrink-0" /> : <TriangleAlert className="h-4 w-4 shrink-0" />} {note.text}
                </p>
            )}

            <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" onClick={save} disabled={pending || !dirty}>
                    {pending ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                    Save
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={test} disabled={pending} className="border-white/10">
                    <Send className="mr-2 h-3.5 w-3.5" /> Send me a test
                </Button>
            </div>
        </div>
    );
}
