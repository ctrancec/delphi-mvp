/**
 * Refreshing the reference library.
 *
 * Runs on a schedule and on demand. Documents still inside their refresh
 * window are skipped entirely, so a routine pass is a handful of requests
 * rather than fourteen — platform terms come round monthly, statutes far less
 * often.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { findWorkspace } from '@/lib/delphi/bootstrap';
import { ingestLegalLibrary } from '@/lib/legal/ingest';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const TIME_BUDGET_MS = 90_000;

export async function POST(req: NextRequest) {
    const deadline = Date.now() + TIME_BUDGET_MS;
    const force = req.nextUrl.searchParams.get('force') === '1';
    const secret = process.env.CRON_SECRET;
    const isCron = !!secret && req.headers.get('authorization') === `Bearer ${secret}`;

    if (isCron) {
        const db = createServiceClient();
        if (!db) return NextResponse.json({ error: 'Service client unavailable.' }, { status: 503 });

        const { data: workspaces } = await db.from('workspaces').select('id');
        const results: Record<string, unknown> = {};

        for (const w of workspaces ?? []) {
            if (Date.now() > deadline) break;
            results[w.id as string] = await ingestLegalLibrary(db, w.id as string, { deadline });
        }
        return NextResponse.json({ ok: true, via: 'cron', results });
    }

    const db = await createClient();
    if (!db) return NextResponse.json({ error: 'Supabase is not configured.' }, { status: 503 });

    const {
        data: { user },
    } = await db.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

    const workspaceId = await findWorkspace(db);
    if (!workspaceId) return NextResponse.json({ error: 'No workspace.' }, { status: 400 });

    try {
        const result = await ingestLegalLibrary(db, workspaceId, { force, deadline });
        return NextResponse.json({ ok: true, via: 'user', ...result });
    } catch (err) {
        return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
}

export async function GET(req: NextRequest) {
    return POST(req);
}
