/**
 * When work starts, and how to make it start on time.
 *
 * By default the engine is woken once a day by Vercel's own cron, which on
 * the free tier is all it allows: work due on a day starts at that morning
 * run. For exact times, Supabase's cron — the pg_cron and pg_net extensions,
 * inside the project's own database — can wake it every fifteen minutes.
 * This page is the SQL to paste for that, and how to check and undo it.
 *
 * The secret the engine checks is never shown here and never stored in the
 * code: the CHO pastes it into Supabase Vault themselves, and the job reads
 * it from there.
 */

import Link from 'next/link';
import { headers } from 'next/headers';
import { ArrowLeft, Clock } from 'lucide-react';
import { createClient, currentUser } from '@/lib/supabase/server';
import { findWorkspace } from '@/lib/delphi/bootstrap';
import { roleOf } from '@/lib/delphi/members';
import { TimingGuide } from '@/components/delphi/timing-guide';

export const dynamic = 'force-dynamic';

/** The address Supabase should call: the production deployment's, or this one's. */
async function engineUrl(): Promise<string> {
    const production = process.env.VERCEL_PROJECT_PRODUCTION_URL;
    if (production) return `https://${production.replace(/^https?:\/\//, '')}/api/delphi/run`;
    const h = await headers();
    const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'your-app.vercel.app';
    const proto = h.get('x-forwarded-proto') ?? 'https';
    return `${proto}://${host}/api/delphi/run`;
}

export default async function TimingPage() {
    const supabase = await createClient();
    const user = await currentUser();
    const workspaceId = supabase ? await findWorkspace(supabase) : null;
    const isOwner = Boolean(supabase && workspaceId && user && (await roleOf(supabase, workspaceId, user.id)) === 'owner');

    return (
        <div className="max-w-3xl space-y-6">
            <Link href="/dashboard/delphi/diagnostics" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-white">
                <ArrowLeft className="h-4 w-4" /> Diagnostics
            </Link>

            <div>
                <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
                    <Clock className="h-6 w-6" /> Timing
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    When scheduled work actually starts — episodes for each channel, and every department&rsquo;s runs.
                </p>
            </div>

            {/* Whether the secret is set, never what it is. */}
            <TimingGuide isOwner={isOwner} hasSecret={Boolean(process.env.CRON_SECRET)} url={await engineUrl()} />
        </div>
    );
}
