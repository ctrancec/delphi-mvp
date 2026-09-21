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
            generatedAt: report.generatedAt,
        },
        { status: 200, headers: { 'Cache-Control': 'no-store' } }
    );
}
