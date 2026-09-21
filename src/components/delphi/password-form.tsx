'use client';

/**
 * Changing your password from inside the app.
 *
 * The current password is asked for and actually verified server-side. A live
 * session is not proof that the person at the keyboard is the account holder —
 * an unattended laptop should not be enough to lock the real owner out.
 */

import { useState, useTransition } from 'react';
import { Check, KeyRound, Loader2, Mail, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { changePasswordAction, emailMyselfAResetAction } from '@/app/account/actions';

export function PasswordForm({ email }: { email: string }) {
    const [current, setCurrent] = useState('');
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [done, setDone] = useState<string | null>(null);
    const [pending, startTransition] = useTransition();

    function submit(e: React.FormEvent) {
        e.preventDefault();
        setError(null);
        setDone(null);
        startTransition(async () => {
            const res = await changePasswordAction(current, password, confirm);
            if (res.ok) {
                setDone(res.message ?? 'Password changed.');
                setCurrent('');
                setPassword('');
                setConfirm('');
            } else {
                setError(res.error ?? 'Could not change it.');
            }
        });
    }

    function emailReset() {
        setError(null);
        setDone(null);
        startTransition(async () => {
            const res = await emailMyselfAResetAction();
            if (res.ok) setDone(res.message ?? 'Sent.');
            else setError(res.error ?? 'Could not send it.');
        });
    }

    return (
        <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
                <Label htmlFor="current">Current password</Label>
                <Input
                    id="current"
                    type="password"
                    autoComplete="current-password"
                    value={current}
                    onChange={(e) => setCurrent(e.target.value)}
                    className="border-white/10 bg-white/5"
                />
            </div>

            <div className="grid gap-4 inner:grid-cols-2">
                <div className="space-y-2">
                    <Label htmlFor="new">New password</Label>
                    <Input
                        id="new"
                        type="password"
                        autoComplete="new-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="border-white/10 bg-white/5"
                    />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="confirm">Confirm</Label>
                    <Input
                        id="confirm"
                        type="password"
                        autoComplete="new-password"
                        value={confirm}
                        onChange={(e) => setConfirm(e.target.value)}
                        className="border-white/10 bg-white/5"
                    />
                </div>
            </div>

            <p className="text-xs text-muted-foreground">
                At least 10 characters, mixing two kinds. Length beats complexity.
            </p>

            {error && (
                <p className="flex items-start gap-2 text-sm text-red-400">
                    <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                    {error}
                </p>
            )}
            {done && (
                <p className="flex items-start gap-2 text-sm text-emerald-400">
                    <Check className="mt-0.5 h-4 w-4 shrink-0" />
                    {done}
                </p>
            )}

            <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" disabled={pending}>
                    {pending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                        <KeyRound className="mr-2 h-4 w-4" />
                    )}
                    Change password
                </Button>

                <Button
                    type="button"
                    variant="outline"
                    onClick={emailReset}
                    disabled={pending}
                    className="border-white/10"
                    title={`Send a reset link to ${email}`}
                >
                    <Mail className="mr-2 h-4 w-4" />
                    Email me a link instead
                </Button>
            </div>

            <p className="text-xs text-muted-foreground/60">
                Cannot remember the current one? The link goes to {email} and lets you set a new
                password without it.
            </p>
        </form>
    );
}
