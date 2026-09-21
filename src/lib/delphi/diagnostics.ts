/**
 * Connection diagnostics.
 *
 * This page exists to answer one question that is otherwise miserable to
 * answer: *why did my agent not search?* An agent with no reachable channel
 * still produces confident, well-formatted output — it simply produces it from
 * the model's memory rather than from the world. That failure is silent by
 * construction, so it needs a surface that is loud.
 *
 * Everything here is **probed live**, not read from a stored health column.
 * A cached "ok" from six hours ago is exactly the reassurance you do not want
 * when something is broken right now.
 */

import { channelHealth, isChannelConfigured } from '@/lib/channels/registry';
import { exhaustedModels, MODEL_FALLBACKS } from '@/lib/llm/gemini';
import { readSupabaseKey, readSupabaseUrl } from '@/lib/supabase/env';
import type { ChannelKind } from './types';
import type { Db } from './db';

export type Level = 'ok' | 'degraded' | 'error' | 'absent';

export interface Check {
    name: string;
    level: Level;
    detail: string;
    /** What the CHO can actually do about it. Omitted when nothing is wrong. */
    remedy?: string;
}

export interface DiagnosticsReport {
    /** The worst level anywhere, so the page can lead with a verdict. */
    verdict: Level;
    /** Can agents reach the outside world at all? The question that matters most. */
    canReachSources: boolean;
    environment: Check[];
    channels: Check[];
    database: Check[];
    models: Check[];
    generatedAt: string;
}

const WORST: Record<Level, number> = { ok: 0, degraded: 1, absent: 2, error: 3 };

function worst(checks: Check[]): Level {
    return checks.reduce<Level>(
        (acc, c) => (WORST[c.level] > WORST[acc] ? c.level : acc),
        'ok'
    );
}

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

function envChecks(): Check[] {
    const checks: Check[] = [];

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    checks.push({
        name: 'NEXT_PUBLIC_SUPABASE_URL',
        level: !url?.trim() ? 'absent' : readSupabaseUrl(url) ? 'ok' : 'error',
        detail: !url?.trim()
            ? 'Not set.'
            : readSupabaseUrl(url)
              ? 'Valid project URL.'
              : 'Set, but not a valid https URL.',
        remedy: readSupabaseUrl(url) ? undefined : 'Expected https://<project-ref>.supabase.co',
    });

    for (const [name, value, why] of [
        ['NEXT_PUBLIC_SUPABASE_ANON_KEY', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, 'Nothing can read the database without it.'],
        ['SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY, 'The scheduled tick cannot act as the system without it.'],
    ] as const) {
        const parsed = readSupabaseKey(name, value);
        const masked = !!value && /[•·•]/.test(value);
        checks.push({
            name,
            level: !value?.trim() ? 'absent' : parsed ? 'ok' : 'error',
            detail: !value?.trim() ? `Not set. ${why}` : parsed ? 'Valid key.' : 'Set, but unusable.',
            remedy: parsed
                ? undefined
                : masked
                  ? 'The value holds masked characters (•) — a hidden key was copied instead of the key. Re-paste it and redeploy.'
                  : !value?.trim()
                    ? 'Add it in Vercel → Settings → Environment Variables, then redeploy.'
                    : 'Expected a JWT starting "ey", or an sb_publishable_/sb_secret_ key.',
        });
    }

    const gemini =
        process.env.GOOGLE_GENERATIVE_AI_API_KEY ??
        process.env.GOOGLE_API_KEY ??
        process.env.GEMINI_API_KEY;
    checks.push({
        name: 'GOOGLE_GENERATIVE_AI_API_KEY',
        level: gemini?.trim() ? 'ok' : 'error',
        detail: gemini?.trim()
            ? 'Present. Delphi can hire and agents can think.'
            : 'Missing. Delphi cannot hire, and no agent can run.',
        remedy: gemini?.trim() ? undefined : 'This is the one key nothing works without.',
    });

    const cron = process.env.CRON_SECRET;
    checks.push({
        name: 'CRON_SECRET',
        level: cron?.trim() ? 'ok' : 'degraded',
        detail: cron?.trim()
            ? 'Present. The scheduled tick can authenticate.'
            : 'Missing. Delphi runs only while a browser tab is open.',
        remedy: cron?.trim()
            ? undefined
            : 'Add any long random string in Vercel, then redeploy. Without it departments will not keep to a cadence.',
    });

    return checks;
}

// ---------------------------------------------------------------------------
// Channels — the part that decides whether agents touch reality
// ---------------------------------------------------------------------------

const CHANNEL_PURPOSE: Partial<Record<ChannelKind, string>> = {
    perplexity: 'Live web search. Most research agents depend on it.',
    fred: 'US macro and market series. The market analyst depends on it.',
    rss: 'News ingestion. Feeds both the news agents and Delphi World.',
};

async function channelChecks(db: Db | null, workspaceId: string | null): Promise<Check[]> {
    const health = await channelHealth();
    const checks: Check[] = [];

    // What is bound in the database, as opposed to merely configured in the
    // environment. A channel with no row is unreachable no matter how valid
    // its API key is — which is a failure that looks exactly like success.
    let bound = new Set<string>();
    if (db && workspaceId) {
        const { data } = await db
            .from('delphi_channels')
            .select('kind')
            .eq('workspace_id', workspaceId)
            .eq('enabled', true);
        bound = new Set((data ?? []).map((c) => c.kind as string));
    }

    for (const kind of ['perplexity', 'fred', 'rss'] as ChannelKind[]) {
        const configured = isChannelConfigured(kind);
        const probe = health[kind];
        const isBound = bound.has(kind);

        let level: Level;
        let detail: string;
        let remedy: string | undefined;

        if (!configured) {
            level = 'absent';
            detail = 'No API key configured.';
            remedy = `Agents will never call ${kind}. Add its key and redeploy.`;
        } else if (!probe?.ok) {
            level = 'error';
            detail = probe?.detail ?? 'The live probe failed.';
            remedy = 'The key is present but the service did not answer. Check the key is still valid.';
        } else if (!isBound) {
            level = 'degraded';
            detail = 'Reachable, but not bound to this workspace.';
            remedy =
                'No agent has this channel in its tool set, so none will use it. It binds itself when Delphi next staffs a department.';
        } else {
            level = 'ok';
            detail = probe.detail ?? 'Answering, and bound to agents.';
        }

        checks.push({ name: kind, level, detail: `${detail} ${CHANNEL_PURPOSE[kind] ?? ''}`.trim(), remedy });
    }

    return checks;
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

/** Tables the app genuinely cannot run without, one probe each. */
const CRITICAL_TABLES = [
    'workspaces',
    'delphi_agents',
    'delphi_channels',
    'delphi_departments',
    'delphi_tasks',
    'delphi_artifacts',
    'delphi_approvals',
    'delphi_reviews',
    'delphi_memories',
    'delphi_news_sources',
] as const;

async function databaseChecks(db: Db | null, workspaceId: string | null): Promise<Check[]> {
    if (!db) {
        return [
            {
                name: 'connection',
                level: 'error',
                detail: 'No Supabase client. The environment is not configured.',
                remedy: 'Fix the environment variables above first.',
            },
        ];
    }

    const checks: Check[] = [];

    const missing: string[] = [];
    await Promise.all(
        CRITICAL_TABLES.map(async (t) => {
            const { error } = await db.from(t).select('*', { head: true, count: 'exact' }).limit(0);
            // An RLS denial proves the table exists, which is what this checks.
            if (error && (error.code === 'PGRST205' || /does not exist/i.test(error.message))) {
                missing.push(t);
            }
        })
    );

    checks.push({
        name: 'schema',
        level: missing.length === 0 ? 'ok' : 'error',
        detail:
            missing.length === 0
                ? `All ${CRITICAL_TABLES.length} critical tables present.`
                : `${missing.length} missing: ${missing.join(', ')}`,
        remedy:
            missing.length === 0
                ? undefined
                : 'Run supabase/DELPHI_SCHEMA.sql in the Supabase SQL editor.',
    });

    checks.push({
        name: 'workspace',
        level: workspaceId ? 'ok' : 'degraded',
        detail: workspaceId
            ? 'Provisioned.'
            : 'None yet. It creates itself when you open mission control.',
    });

    if (workspaceId) {
        const [{ count: agents }, { count: channels }] = await Promise.all([
            db
                .from('delphi_agents')
                .select('*', { head: true, count: 'exact' })
                .eq('workspace_id', workspaceId)
                .is('archived_at', null),
            db
                .from('delphi_channels')
                .select('*', { head: true, count: 'exact' })
                .eq('workspace_id', workspaceId),
        ]);

        checks.push({
            name: 'roster',
            level: (agents ?? 0) >= 16 ? 'ok' : (agents ?? 0) > 0 ? 'degraded' : 'error',
            detail: `${agents ?? 0} agents (13 specialists + 3 board expected).`,
            remedy: (agents ?? 0) >= 16 ? undefined : 'Open mission control; the roster seeds itself.',
        });

        checks.push({
            name: 'channel bindings',
            level: (channels ?? 0) > 0 ? 'ok' : 'error',
            detail: `${channels ?? 0} channel rows.`,
            remedy:
                (channels ?? 0) > 0
                    ? undefined
                    : 'With none, every agent runs blind — it will still produce output, from memory rather than sources.',
        });
    }

    return checks;
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

/** Roughly how long ago, in words a person reads rather than parses. */
function ago(iso: string): string {
    const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
    const hours = Math.round(mins / 60);
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
}

/**
 * What the models are actually doing, not what the chain is configured to do.
 *
 * This used to report a flat "ok" describing the fallback list, which meant
 * the health endpoint said agents could think on a day when every model in the
 * chain had spent its allowance. A check that cannot fail is not a check.
 *
 * Probing the models directly would be the obvious fix and is the wrong one:
 * the free tier counts requests per model per day, so a diagnostics page that
 * asked each model whether it was out of quota would be spending the very
 * thing it reports on. This reads what the runtime already observed instead —
 * free, and evidence of real work rather than of a synthetic probe.
 */
async function modelChecks(db: Db | null, workspaceId: string | null): Promise<Check[]> {
    // This process's own observations, plus what the database remembers: the
    // health endpoint is usually a cold invocation, where the in-process set is
    // empty and the event log is the only witness.
    const spent = new Set(exhaustedModels());
    let blockedAt: string | null = null;

    if (db && workspaceId) {
        const { data } = await db
            .from('delphi_events')
            .select('payload, created_at')
            .eq('workspace_id', workspaceId)
            .eq('type', 'task_blocked')
            .order('id', { ascending: false })
            .limit(1);

        const row = data?.[0];
        const payload = row?.payload as { reason?: string; models?: string[] } | undefined;
        if (payload?.reason === 'model_quota') {
            blockedAt = row?.created_at as string;
            for (const m of payload.models ?? []) spent.add(m);
        }
    }

    // A quota window rolls over daily, so an old sighting is history rather
    // than a fault. The level decays on its own instead of needing clearing.
    const minutesSince = blockedAt
        ? (Date.now() - new Date(blockedAt).getTime()) / 60000
        : Number.POSITIVE_INFINITY;

    return Object.entries(MODEL_FALLBACKS).map(([model, chain]) => {
        const all = [model, ...chain];
        const out = all.filter((m) => spent.has(m));

        if (out.length === all.length && minutesSince < 60) {
            return {
                name: model,
                level: 'error' as Level,
                detail: `Out of quota on all ${all.length} models (last seen ${ago(blockedAt!)}). Agents cannot think.`,
                remedy:
                    'The free tier counts requests per model per day. Enable billing on the Google AI Studio project to lift the limit, or wait for the daily reset — queued steps resume on their own.',
            };
        }

        if (out.length > 0 && minutesSince < 24 * 60) {
            return {
                name: model,
                level: 'degraded' as Level,
                detail: `${out.length} of ${all.length} models were out of quota ${ago(blockedAt!)}: ${out.join(', ')}.`,
                remedy:
                    'Work still gets through on the rest of the chain, more slowly and on smaller models. Enable billing on the Gemini key to stop it happening.',
            };
        }

        return {
            name: model,
            level: 'ok' as Level,
            detail:
                chain.length > 0
                    ? `Falls back through ${chain.join(' → ')} when saturated.`
                    : 'No fallback configured; a 503 fails the task.',
        };
    });
}

// ---------------------------------------------------------------------------

export async function runDiagnostics(
    db: Db | null,
    workspaceId: string | null
): Promise<DiagnosticsReport> {
    const [environment, channels, database] = await Promise.all([
        Promise.resolve(envChecks()),
        channelChecks(db, workspaceId),
        databaseChecks(db, workspaceId),
    ]);
    const models = await modelChecks(db, workspaceId);

    const all = [...environment, ...channels, ...database, ...models];

    return {
        verdict: worst(all),
        // Degraded still counts: a reachable-but-unbound channel becomes usable
        // as soon as a department is staffed.
        canReachSources: channels.some((c) => c.level === 'ok' || c.level === 'degraded'),
        environment,
        channels,
        database,
        models,
        generatedAt: new Date().toISOString(),
    };
}
