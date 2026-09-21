/**
 * Connection diagnostics.
 *
 * The page to open when something looks wrong, and the page to open when
 * nothing looks wrong but you want to know whether the agents are actually
 * touching the world — because an agent with no reachable channel still
 * produces confident, well-formatted output, just from memory rather than from
 * a source. That is the failure this page is built to make loud.
 */

import { Activity, AlertTriangle, CheckCircle2, CircleSlash, Stethoscope, XCircle } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { findWorkspace } from '@/lib/delphi/bootstrap';
import { getSystemState } from '@/lib/delphi/db';
import { DEFAULT_SCHEDULE, effectiveState } from '@/lib/delphi/schedule';
import { WorkHours } from '@/components/delphi/work-hours';
import { runDiagnostics, type Check, type Level } from '@/lib/delphi/diagnostics';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const LEVELS: Record<Level, { icon: typeof CheckCircle2; tone: string; label: string }> = {
    ok: { icon: CheckCircle2, tone: 'text-emerald-400', label: 'ok' },
    degraded: { icon: AlertTriangle, tone: 'text-amber-400', label: 'degraded' },
    absent: { icon: CircleSlash, tone: 'text-muted-foreground', label: 'not configured' },
    error: { icon: XCircle, tone: 'text-red-400', label: 'error' },
};

function CheckRow({ check }: { check: Check }) {
    const meta = LEVELS[check.level];
    const Icon = meta.icon;

    return (
        <div className="flex items-start gap-3 border-t border-white/5 px-4 py-3 first:border-t-0">
            <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', meta.tone)} />
            <div className="min-w-0 flex-1 space-y-1">
                <p className="font-mono text-xs text-zinc-200">{check.name}</p>
                <p className="text-xs text-muted-foreground">{check.detail}</p>
                {check.remedy && (
                    <p className={cn('text-xs', check.level === 'error' ? 'text-red-400/80' : 'text-amber-400/80')}>
                        {check.remedy}
                    </p>
                )}
            </div>
            <span className={cn('shrink-0 text-[10px] uppercase tracking-wide', meta.tone)}>
                {meta.label}
            </span>
        </div>
    );
}

function Section({ title, hint, checks }: { title: string; hint?: string; checks: Check[] }) {
    if (checks.length === 0) return null;
    return (
        <Card className="border-white/10 bg-black/40">
            <CardHeader className="pb-2">
                <CardTitle className="text-sm">{title}</CardTitle>
                {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
            </CardHeader>
            <CardContent className="px-0 pb-0">
                {checks.map((c) => (
                    <CheckRow key={c.name} check={c} />
                ))}
            </CardContent>
        </Card>
    );
}

export default async function DiagnosticsPage() {
    const supabase = await createClient();
    const workspaceId = supabase ? await findWorkspace(supabase) : null;
    const report = await runDiagnostics(supabase, workspaceId);

    // "Why isn't anything running" is the question this page exists to answer,
    // and once hours are set the answer is often "because you told it not to".
    // So it belongs here rather than behind a settings screen nobody opens
    // while something looks broken.
    const state =
        supabase && workspaceId
            ? await getSystemState(supabase, workspaceId)
            : { mode: 'running' as const, schedule: DEFAULT_SCHEDULE, override: null };
    const now = effectiveState(state);

    const verdict = LEVELS[report.verdict];
    const VerdictIcon = verdict.icon;

    return (
        <div className="max-w-3xl space-y-6">
            <div>
                <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
                    <Stethoscope className="h-6 w-6" /> Diagnostics
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    Everything below is probed live, not read from a stored status. A cached &ldquo;ok&rdquo;
                    from six hours ago is exactly the reassurance you do not want when something is
                    broken now.
                </p>
            </div>

            <WorkHours schedule={state.schedule} detail={now.detail} />

            <Card
                className={cn(
                    'border bg-black/40',
                    report.verdict === 'ok' ? 'border-emerald-400/30' : 'border-amber-400/30'
                )}
            >
                <CardContent className="flex items-start gap-3 py-5">
                    <VerdictIcon className={cn('mt-0.5 h-5 w-5 shrink-0', verdict.tone)} />
                    <div className="space-y-1">
                        <p className={cn('text-sm font-semibold', verdict.tone)}>
                            {report.verdict === 'ok'
                                ? 'Everything is connected.'
                                : report.verdict === 'degraded'
                                  ? 'Working, with something worth knowing.'
                                  : 'Something is broken.'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                            {report.canReachSources ? (
                                'Agents can reach live sources, so their claims can be grounded in something real.'
                            ) : (
                                <span className="text-red-400">
                                    No channel is reachable. Agents will still produce polished output — from
                                    the model&rsquo;s memory rather than from any source. Treat anything they
                                    write as unverified until this is fixed.
                                </span>
                            )}
                        </p>
                    </div>
                </CardContent>
            </Card>

            <Section
                title="Channels"
                hint="Whether agents can touch the world. The most consequential section on this page."
                checks={report.channels}
            />
            <Section
                title="Environment"
                hint="Present and usable are different things — a masked key is very much present."
                checks={report.environment}
            />
            <Section title="Database" checks={report.database} />
            <Section
                title="Models"
                hint="Gemini returns 503 under load; the chain is what stops that failing a task."
                checks={report.models}
            />

            <p className="flex items-center gap-2 text-[11px] text-muted-foreground/60">
                <Activity className="h-3 w-3" />
                Probed {new Date(report.generatedAt).toLocaleTimeString()}. Reload to re-run. The same
                report is available as JSON at <code className="font-mono">/api/delphi/health</code>.
            </p>
        </div>
    );
}
