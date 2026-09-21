/**
 * Configuration check, readable from a browser.
 *
 * The same probes the Diagnostics page runs, as JSON. It exists separately
 * because it needs no session: when the environment is broken enough that
 * signing in fails, this is still reachable, which is exactly when you need it.
 *
 * Presence and validity only. No secret, and no fragment of one, is ever
 * included in the response.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { findWorkspace } from '@/lib/delphi/bootstrap';
import { runDiagnostics } from '@/lib/delphi/diagnostics';

export const dynamic = 'force-dynamic';

export async function GET() {
    const supabase = await createClient();

    // Best-effort: a broken environment is the case this endpoint is for, so
    // failing to resolve a workspace must not stop it reporting why.
    let workspaceId: string | null = null;
    if (supabase) {
        try {
            workspaceId = await findWorkspace(supabase);
        } catch {
            workspaceId = null;
        }
    }

    // What a single database round trip actually costs from wherever this
    // function is running. It is the number that explains a slow dashboard
    // better than any other: a page is a handful of these, so ~15ms and ~80ms
    // are a different application to use. A large figure here usually means
    // the function region and the Supabase region are on opposite sides of the
    // country, which is a project setting, not a code problem.
    let databaseMs: number | null = null;
    if (supabase) {
        const started = Date.now();
        try {
            await supabase.from('workspaces').select('id').limit(1);
            databaseMs = Date.now() - started;
        } catch {
            databaseMs = null;
        }
    }

    const report = await runDiagnostics(supabase, workspaceId);

    const blocking = [...report.environment, ...report.channels, ...report.database].filter(
        (c) => c.level === 'error'
    );

    return NextResponse.json(
        {
            ready: report.verdict === 'ok' || report.verdict === 'degraded',
            verdict: report.verdict,
            summary: blocking.length
                ? `${blocking.length} problem(s): ${blocking.map((c) => c.name).join(', ')}`
                : report.canReachSources
                  ? 'Configuration looks good and agents can reach live sources.'
                  : 'Configured, but no channel is reachable — agent output would be unsourced.',
            canReachSources: report.canReachSources,
            environment: report.environment,
            channels: report.channels,
            database: report.database,
            models: report.models,
            build: {
                // Which commit is actually serving this, so "did my change
                // deploy?" is answerable without reading a build log.
                commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'local',
                branch: process.env.VERCEL_GIT_COMMIT_REF ?? 'local',
                region: process.env.VERCEL_REGION ?? 'local',
            },
            latency: { databaseMs },
            generatedAt: report.generatedAt,
        },
        { status: 200, headers: { 'Cache-Control': 'no-store' } }
    );
}
