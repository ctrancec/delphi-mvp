/**
 * Account settings.
 *
 * Deliberately separate from the old app's workspace settings, which are about
 * a product this is no longer. This is about the person: who you are signed in
 * as, and the password that protects an organisation that spends money and
 * publishes on your behalf.
 */

import { redirect } from 'next/navigation';
import { Bell, KeyRound, ShieldCheck, Smartphone, UserCircle, Users } from 'lucide-react';
import { createClient, currentUser } from '@/lib/supabase/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PasswordForm } from '@/components/delphi/password-form';
import { NameForm } from '@/components/delphi/name-form';
import { InstallCard } from '@/components/delphi/install-card';
import { NotificationsCard } from '@/components/delphi/notifications-card';
import { TeamCard } from '@/components/delphi/team-card';
import { listInvites, listMembers, roleOf, roleWords, type Invite, type Member, type Role } from '@/lib/delphi/members';
import { headers } from 'next/headers';
import { findWorkspace } from '@/lib/delphi/bootstrap';
import { countSubscriptions, DEFAULT_PREFS, isEmailConfigured, isPushConfigured, readPrefs, type Prefs } from '@/lib/delphi/notify';
import { SlimeSprite } from '@/components/pixel/agent-sprite';
import { choNameOf, hasOwnName } from '@/lib/delphi/cho';
import { CEO_NAME } from '@/lib/pixel/cast/names';

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

    // The layout above already resolved this; `currentUser()` is memoized for
    // the request, so asking again costs nothing rather than another round trip
    // to Supabase's auth server.
    const user = await currentUser();
    if (!user) redirect('/login');

    // Google sign-in means there may be no password to change at all.
    const providers = (user.app_metadata?.providers as string[] | undefined) ?? [
        user.app_metadata?.provider as string,
    ].filter(Boolean);
    const hasPassword = providers.includes('email');
    const cho = choNameOf(user);

    // Notification settings, tolerating a database the migration has not reached.
    let prefs: Prefs = DEFAULT_PREFS;
    let devices = 0;
    let migrated = true;
    const workspaceId = await findWorkspace(supabase);
    try {
        if (workspaceId) {
            prefs = await readPrefs(supabase, workspaceId, user.id);
            devices = await countSubscriptions(supabase, workspaceId, user.id);
        }
    } catch {
        migrated = false;
    }

    // The team: who is in the workspace, and the links to bring more in.
    let role: Role = 'owner';
    let members: Member[] = [];
    let invites: Invite[] = [];
    let teamReady = true;
    try {
        if (workspaceId) {
            role = await roleOf(supabase, workspaceId, user.id);
            if (role === 'owner') {
                members = await listMembers(supabase, workspaceId, user.id);
                invites = await listInvites(supabase, workspaceId);
            }
        }
    } catch {
        teamReady = false;
    }
    const host = (await headers()).get('host') ?? 'localhost:3000';
    const origin = `${host.startsWith('localhost') ? 'http' : 'https'}://${host}`;

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
                        <SlimeSprite scale={2} name={cho} /> Your name
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">
                        The town calls you {cho}, and {CEO_NAME} addresses you as {cho}-sama.
                        {!hasOwnName(user) && ' Set your own name here, or it stays the role\u2019s.'}
                    </p>
                </CardHeader>
                <CardContent>
                    <NameForm initial={hasOwnName(user) ? cho : ''} />
                </CardContent>
            </Card>

            <Card className="border-white/10 bg-black/40">
                <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                        <Users className="h-4 w-4" /> Team
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">
                        {role === 'owner'
                            ? 'Others can read everything you see. A reviewer can also post into review threads. Only you decide, staff, spend or switch the system.'
                            : `You are ${roleWords(role)}.`}
                    </p>
                </CardHeader>
                <CardContent>
                    {role === 'owner' ? (
                        teamReady ? (
                            <TeamCard members={members} invites={invites} origin={origin} you={user.id} />
                        ) : (
                            <p className="text-xs text-amber-400">The members tables are not in the database yet. Run migration 0010 in the Supabase SQL editor.</p>
                        )
                    ) : (
                        <p className="text-sm text-muted-foreground">The owner manages the team.</p>
                    )}
                </CardContent>
            </Card>

            <Card className="border-white/10 bg-black/40">
                <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                        <Bell className="h-4 w-4" /> Notifications
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">
                        What reaches you when the app is closed. Nothing is sent until you switch it on here.
                    </p>
                </CardHeader>
                <CardContent>
                    <NotificationsCard
                        prefs={prefs}
                        signInEmail={user.email ?? ''}
                        pushConfigured={isPushConfigured()}
                        emailConfigured={isEmailConfigured()}
                        vapidPublicKey={isPushConfigured() ? (process.env.VAPID_PUBLIC_KEY ?? '').trim() : null}
                        devices={devices}
                        migrated={migrated}
                    />
                </CardContent>
            </Card>

            <Card className="border-white/10 bg-black/40">
                <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                        <Smartphone className="h-4 w-4" /> On your phone
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">
                        Installed, it opens full screen from the home screen, shows the offline page instead of
                        an error when there is no signal, and can carry notifications.
                    </p>
                </CardHeader>
                <CardContent>
                    <InstallCard />
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
