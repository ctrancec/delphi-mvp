/**
 * Account settings.
 *
 * Deliberately separate from the old app's workspace settings, which are about
 * a product this is no longer. This is about the person: who you are signed in
 * as, and the password that protects an organisation that spends money and
 * publishes on your behalf.
 */

import { redirect } from 'next/navigation';
import { KeyRound, ShieldCheck, UserCircle } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PasswordForm } from '@/components/delphi/password-form';

export const dynamic = 'force-dynamic';

export default async function AccountPage() {
    const supabase = await createClient();
    if (!supabase) {
        return (
            <Card className="border-white/10 bg-black/40">
                <CardContent className="py-10 text-center text-muted-foreground">
                    Supabase is not configured.
                </CardContent>
            </Card>
        );
    }

    const {
        data: { user },
    } = await supabase.auth.getUser();
    if (!user) redirect('/login');

    // Google sign-in means there may be no password to change at all.
    const providers = (user.app_metadata?.providers as string[] | undefined) ?? [
        user.app_metadata?.provider as string,
    ].filter(Boolean);
    const hasPassword = providers.includes('email');

    return (
        <div className="max-w-2xl space-y-6">
            <div>
                <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
                    <UserCircle className="h-6 w-6" /> Account
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    Who you are signed in as, and the password protecting it.
                </p>
            </div>

            <Card className="border-white/10 bg-black/40">
                <CardContent className="space-y-3 pt-6">
                    <div className="flex flex-wrap items-center gap-3">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/20 text-sm font-bold text-primary">
                            {(user.email ?? '?').charAt(0).toUpperCase()}
                        </span>
                        <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-zinc-100">{user.email}</p>
                            <p className="text-xs text-muted-foreground">
                                The CHO — the only account that can approve anything.
                            </p>
                        </div>
                        {user.email_confirmed_at && (
                            <Badge
                                variant="outline"
                                className="ml-auto gap-1 border-emerald-400/30 text-[10px] text-emerald-400"
                            >
                                <ShieldCheck className="h-2.5 w-2.5" /> verified
                            </Badge>
                        )}
                    </div>
                    <div className="flex flex-wrap gap-1.5 border-t border-white/5 pt-3">
                        {providers.map((p) => (
                            <span
                                key={p}
                                className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                            >
                                signs in with {p}
                            </span>
                        ))}
                    </div>
                </CardContent>
            </Card>

            <Card className="border-white/10 bg-black/40">
                <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                        <KeyRound className="h-4 w-4" /> Password
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">
                        This account approves spending and anything that reaches the outside world, so
                        the password is worth more than it looks.
                    </p>
                </CardHeader>
                <CardContent>
                    {hasPassword ? (
                        <PasswordForm email={user.email ?? ''} />
                    ) : (
                        <p className="text-sm text-muted-foreground">
                            This account signs in with {providers.join(' and ') || 'a provider'} rather
                            than a password, so there is nothing to change here. Security is managed
                            wherever that account lives.
                        </p>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
