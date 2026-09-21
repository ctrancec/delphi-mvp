'use client';

/**
 * Setting a new password from the emailed link.
 *
 * The auth callback has already exchanged the code for a session by the time
 * anyone arrives here, so this runs authenticated — control of the inbox was
 * the proof. If the link expired, the action says so rather than failing
 * silently into a form that cannot work.
 */

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, Loader2, Triangle, TriangleAlert } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { setNewPasswordAction } from '../actions';

export default function NewPasswordPage() {
    const router = useRouter();
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [done, setDone] = useState(false);
    const [pending, startTransition] = useTransition();

    function submit(e: React.FormEvent) {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
            const res = await setNewPasswordAction(password, confirm);
            if (res.ok) {
                setDone(true);
                // Straight into the app: the reset link already signed them in.
                setTimeout(() => router.push('/dashboard/delphi'), 1200);
            } else {
                setError(res.error ?? 'Could not change the password.');
            }
        });
    }

    return (
        <div className="flex min-h-screen items-center justify-center bg-[#0a0a0a] p-4">
            <Card className="w-full max-w-md border-white/10 bg-black/40 p-8 backdrop-blur-xl">
                <div className="mb-8 text-center">
                    <span className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/20 text-primary">
                        <Triangle className="h-5 w-5 fill-current" />
                    </span>
                    <h1 className="text-2xl font-bold tracking-tight text-white">Choose a new password</h1>
                </div>

                {done ? (
                    <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-400">
                        <Check className="h-4 w-4 shrink-0" />
                        Password changed. Taking you in…
                    </div>
                ) : (
                    <form onSubmit={submit} className="space-y-6">
                        <div className="space-y-2">
                            <Label htmlFor="password">New password</Label>
                            <Input
                                id="password"
                                type="password"
                                autoComplete="new-password"
                                required
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="border-white/10 bg-white/5"
                            />
                            <p className="text-xs text-muted-foreground">
                                At least 10 characters. Length beats complexity — a short phrase you will
                                remember beats a scramble you will write down.
                            </p>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="confirm">Confirm</Label>
                            <Input
                                id="confirm"
                                type="password"
                                autoComplete="new-password"
                                required
                                value={confirm}
                                onChange={(e) => setConfirm(e.target.value)}
                                className="border-white/10 bg-white/5"
                            />
                        </div>

                        {error && (
                            <div className="space-y-2">
                                <p className="flex items-start gap-2 text-sm text-red-400">
                                    <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                                    {error}
                                </p>
                                {/expired|already been used/i.test(error) && (
                                    <Link
                                        href="/account/forgot-password"
                                        className="text-sm text-sky-400 hover:underline"
                                    >
                                        Request a new link
                                    </Link>
                                )}
                            </div>
                        )}

                        <Button type="submit" disabled={pending} className="w-full font-bold">
                            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Set password
                        </Button>
                    </form>
                )}
            </Card>
        </div>
    );
}
