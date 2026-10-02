/**
 * Accepting an invitation.
 *
 * The link carries a token; whoever is signed in when they open it joins
 * the workspace in the role the owner chose. Not signed in, they are sent
 * to sign in or sign up and brought straight back here. The acceptance
 * runs with the service role, since the person is not a member yet and
 * the policies would show them nothing.
 */

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { acceptInvite } from '@/lib/delphi/members';
import { APP_NAME } from '@/lib/pixel/cast/names';
import { currentUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import type { Db } from '@/lib/delphi/db';

export const dynamic = 'force-dynamic';

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;
    const user = await currentUser();
    if (!user) redirect(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);

    const service = createServiceClient();
    let reason: string;
    if (!service) {
        reason = 'Invitations need the server to be fully configured (SUPABASE_SERVICE_ROLE_KEY). Ask the owner.';
    } else {
        const result = await acceptInvite(service as unknown as Db, token, { id: user.id, email: user.email ?? null });
        if (result.ok) redirect('/dashboard/delphi');
        reason = result.reason;
    }

    return (
        <main className="flex min-h-screen items-center justify-center bg-[#0d1128] p-6 text-[#f2e8cf]">
            <Card className="w-full max-w-md border-white/10 bg-black/40">
                <CardContent className="space-y-3 py-8 text-center">
                    <h1 className="text-xl font-bold">This invitation cannot be used</h1>
                    <p className="text-sm text-muted-foreground">{reason}</p>
                    <Link href="/dashboard/delphi" className="inline-block text-sm text-sky-300 hover:underline">
                        Go to {APP_NAME} →
                    </Link>
                </CardContent>
            </Card>
        </main>
    );
}
