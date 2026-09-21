/**
 * Configuration check, readable from a browser.
 *
 * The CHO has no terminal, so "it 500s and the log is in Vercel somewhere" is
 * not a diagnosis they can act on. This answers the question that actually
 * matters on a fresh deploy — *which* variable is wrong, and why — in a form
 * you can read by visiting a URL.
 *
 * It reports presence and validity only. No secret, and no fragment of one,
 * is ever included in the response.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { readSupabaseKey, readSupabaseUrl } from '@/lib/supabase/env';
import { isChannelConfigured } from '@/lib/channels/registry';
import type { ChannelKind } from '@/lib/delphi/types';

export const dynamic = 'force-dynamic';

type Status = 'ok' | 'missing' | 'invalid';

interface Check {
    status: Status;
    detail?: string;
}

function checkKey(name: string, raw: string | undefined): Check {
    if (!raw?.trim()) return { status: 'missing', detail: `${name} is not set.` };
    const parsed = readSupabaseKey(name, raw);
    if (parsed) return { status: 'ok' };

    // Repeat the most common cause in the response rather than only the log —
    // a masked value looks correct in the hosting dashboard.
    const masked = /[•·*•·]/.test(raw);
    return {
        status: 'invalid',
        detail: masked
            ? `${name} contains masked characters (•). The hidden form of the key was copied instead of the key itself. Reveal it, or use the copy button, and paste again.`
            : `${name} is set but is not a usable Supabase key. Check the server log for the reason.`,
    };
}

export async function GET() {
    const checks: Record<string, Check> = {};

    const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    checks.NEXT_PUBLIC_SUPABASE_URL = !rawUrl?.trim()
        ? { status: 'missing', detail: 'NEXT_PUBLIC_SUPABASE_URL is not set.' }
        : readSupabaseUrl(rawUrl)
          ? { status: 'ok' }
          : { status: 'invalid', detail: 'Not a valid https URL. Expected https://<project-ref>.supabase.co' };

    checks.NEXT_PUBLIC_SUPABASE_ANON_KEY = checkKey(
        'NEXT_PUBLIC_SUPABASE_ANON_KEY',
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );
    checks.SUPABASE_SERVICE_ROLE_KEY = checkKey(
        'SUPABASE_SERVICE_ROLE_KEY',
        process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const geminiKey =
        process.env.GOOGLE_GENERATIVE_AI_API_KEY ??
        process.env.GOOGLE_API_KEY ??
        process.env.GEMINI_API_KEY;
    checks.GOOGLE_GENERATIVE_AI_API_KEY = geminiKey?.trim()
        ? { status: 'ok' }
        : { status: 'missing', detail: 'Delphi cannot hire without it — this is the one that has to be right.' };

    // Optional: each absent key simply means one fewer source agents can reach.
    const channels: Record<string, boolean> = {};
    for (const kind of ['perplexity', 'fred', 'rss'] as ChannelKind[]) {
        channels[kind] = isChannelConfigured(kind);
    }

    // Does the database actually answer, and is the schema there?
    let database: Check = { status: 'missing', detail: 'Not checked — Supabase is not configured.' };
    let signupReady = false;

    const supabase = await createClient();
    if (supabase) {
        const { error } = await supabase.from('delphi_agents').select('id').limit(1);
        if (!error) {
            database = { status: 'ok' };
            signupReady = true;
        } else if (error.code === 'PGRST205' || /does not exist/i.test(error.message)) {
            database = {
                status: 'invalid',
                detail: 'Connected, but the Delphi tables are missing. Run supabase/DELPHI_SCHEMA.sql in the Supabase SQL editor.',
            };
        } else {
            // An RLS denial means the connection and schema are both fine — the
            // caller simply is not a member of any workspace yet, which is the
            // expected state before the first signup.
            database = { status: 'ok', detail: `Reachable (${error.code ?? 'no rows'}).` };
            signupReady = true;
        }
    }

    const blocking = Object.entries(checks).filter(
        ([name, c]) => c.status !== 'ok' && name !== 'SUPABASE_SERVICE_ROLE_KEY'
    );

    return NextResponse.json(
        {
            ready: blocking.length === 0 && database.status === 'ok',
            summary: blocking.length
                ? `${blocking.length} setting(s) need fixing: ${blocking.map(([n]) => n).join(', ')}`
                : database.status === 'ok'
                  ? signupReady
                      ? 'Configuration looks good. Create an account to begin.'
                      : 'Configuration looks good.'
                  : 'Environment is fine, but the database is not ready.',
            environment: checks,
            database,
            channels,
        },
        { status: 200, headers: { 'Cache-Control': 'no-store' } }
    );
}
