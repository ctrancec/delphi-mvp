/**
 * The timing page's substance: how work is woken now, and the SQL that
 * wakes it every fifteen minutes from Supabase's own cron.
 *
 * The SQL is built from the engine's address alone. The secret the engine
 * checks never passes through here: the CHO pastes it into Supabase Vault,
 * and the job reads it from there.
 */

import { CheckCircle2, KeyRound, TriangleAlert } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CopyButton } from './copy-button';
import { timingSql } from '@/lib/delphi/timing';


function Block({ label, sql }: { label: string; sql: string }) {
    return (
        <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">{label}</span>
                <CopyButton text={sql} />
            </div>
            <pre className="overflow-x-auto rounded-md border border-white/10 bg-black/40 p-3 font-mono text-[11px] leading-relaxed text-zinc-200">{sql}</pre>
        </div>
    );
}

export function TimingGuide({ isOwner, hasSecret, url }: { isOwner: boolean; hasSecret: boolean; url: string }) {
    const sql = timingSql(url);
    return (
        <>
            <Card className="border-white/10 bg-black/40">
                <CardHeader className="pb-2">
                    <CardTitle className="text-sm">As it is now</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm text-muted-foreground">
                    <p>
                        The engine is woken once a day, at <span className="text-zinc-200">07:00 UTC</span>, by Vercel&rsquo;s cron —
                        on the free tier, once a day is all it allows. Anything due that day starts then. Opening a studio or
                        department with work due also starts it.
                    </p>
                    <p>
                        A run of several steps can need more than one wake-up to finish. Waking every fifteen minutes makes
                        work start close to its time and finish within the hour.
                    </p>
                </CardContent>
            </Card>

            <Card className="border-white/10 bg-black/40">
                <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Exact times, with Supabase&rsquo;s cron (optional)</CardTitle>
                    <p className="text-xs text-muted-foreground">
                        Runs inside your own Supabase database — the pg_cron and pg_net extensions — so there is no new service
                        or account. It calls the engine 96 times a day; a call with nothing to do returns in a moment.
                    </p>
                </CardHeader>
                <CardContent className="space-y-4">
                    {!isOwner ? (
                        <p className="text-sm text-muted-foreground">The workspace owner sets this up.</p>
                    ) : (
                        <>
                            <p className={hasSecret ? 'flex items-start gap-2 text-xs text-emerald-300' : 'flex items-start gap-2 text-xs text-amber-300'}>
                                {hasSecret ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                                {hasSecret
                                    ? 'CRON_SECRET is set in Vercel. The same value goes into Supabase Vault below.'
                                    : 'CRON_SECRET is not set in Vercel. Add it first (Project → Settings → Environment Variables): a long random string. Vercel’s daily cron needs it too.'}
                            </p>
                            <ol className="list-decimal space-y-4 pl-5 text-sm text-zinc-200 marker:text-muted-foreground">
                                <li className="space-y-2">
                                    <p>In Supabase, open the SQL editor and turn on the two extensions.</p>
                                    <Block label="Extensions" sql={sql.enable} />
                                </li>
                                <li className="space-y-2">
                                    <p className="flex items-start gap-1.5">
                                        <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" /> Put the secret in Vault, by your own hand. It is never shown or stored here.
                                    </p>
                                    <Block label="Vault" sql={sql.vault} />
                                </li>
                                <li className="space-y-2">
                                    <p>Schedule the engine every fifteen minutes.</p>
                                    <Block label="Schedule" sql={sql.schedule} />
                                </li>
                                <li className="space-y-2">
                                    <p>Check it after a quarter of an hour.</p>
                                    <Block label="Check" sql={sql.check} />
                                </li>
                                <li className="space-y-2">
                                    <p>To stop it, at any time:</p>
                                    <Block label="Undo" sql={sql.undo} />
                                </li>
                            </ol>
                            <p className="text-[11px] text-muted-foreground/70">
                                The daily Vercel cron stays as a fallback either way. Two wake-ups at once are safe: each slot starts once.
                            </p>
                        </>
                    )}
                </CardContent>
            </Card>
        </>
    );
}
