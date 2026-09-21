'use client';

/**
 * Asking for a reset link.
 *
 * Unauthenticated, so the response is deliberately identical whether or not
 * the address has an account. A form that says "no such user" is a form that
 * enumerates your users.
 */

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, MailCheck, Triangle, TriangleAlert } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { requestPasswordResetAction } from '../actions';

export default function ForgotPasswordPage() {
    const [email, setEmail] = useState('');
    const [sent, setSent] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [pending, startTransition] = useTransition();

    function submit(e: React.FormEvent) {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
            const res = await requestPasswordResetAction(email);
            if (res.ok) setSent(res.message ?? 'Check your email.');
            else setError(res.error ?? 'Could not send the link.');
        });
    }

    return (
        <div className="flex min-h-screen items-center justify-center bg-[#0a0a0a] p-4">
            <Card className="w-full max-w-md border-white/10 bg-black/40 p-8 backdrop-blur-xl">
                <div className="mb-8 text-center">
                    <span className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/20 text-primary">
                        <Triangle className="h-5 w-5 fill-current" />
                    </span>
                    <h1 className="mb-2 text-2xl font-bold tracking-tight text-white">
                        Reset your password
                    </h1>
                    <p className="text-sm text-muted-foreground">
                        We will email you a link to set a new one.
                    </p>
                </div>

                {sent ? (
                    <div className="space-y-6">
                        <div className="flex items-start gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-400">
                            <MailCheck className="mt-0.5 h-4 w-4 shrink-0" />
                            {sent}
                        </div>
                        <p className="text-xs text-muted-foreground">
                            Nothing arrived? Check spam, and confirm you used the address you signed up
                            with. For safety this page says the same thing either way.
                        </p>
                        <Button asChild variant="outline" className="w-full border-white/10">
                            <Link href="/login">Back to sign in</Link>
                        </Button>
                    </div>
                ) : (
                    <form onSubmit={submit} className="space-y-6">
                        <div className="space-y-2">
                            <Label htmlFor="email">Email</Label>
                            <Input
                                id="email"
                                type="email"
                                autoComplete="email"
                                required
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="name@example.com"
                                className="border-white/10 bg-white/5"
                            />
                        </div>

                        {error && (
                            <p className="flex items-center gap-2 text-sm text-red-400">
                                <TriangleAlert className="h-4 w-4 shrink-0" />
                                {error}
                            </p>
                        )}

                        <Button type="submit" disabled={pending} className="w-full font-bold">
                            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Send reset link
                        </Button>

                        <Link
                            href="/login"
                            className="flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-white"
                        >
                            <ArrowLeft className="h-4 w-4" /> Back to sign in
                        </Link>
                    </form>
                )}
            </Card>
        </div>
    );
}
