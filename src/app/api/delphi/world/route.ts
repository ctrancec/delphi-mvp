/**
 * The Delphi World pipeline: ingest, cluster, translate.
 *
 * In that order, deliberately. Clustering runs before translation because
 * translation is lazy — only items that found corroboration are worth paying
 * to read in English, and clustering is what establishes that.
 *
 * Same two callers as the engine tick: Vercel Cron with CRON_SECRET acting as
 * the system, or a signed-in CHO whose own client keeps RLS in charge.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { findWorkspace } from '@/lib/delphi/bootstrap';
import { ingestNews, seedWorldSources } from '@/lib/world/ingest';
import { rebuildClusters } from '@/lib/world/corroborate';
import { translatePending } from '@/lib/world/translate';
import type { Db } from '@/lib/delphi/db';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const TIME_BUDGET_MS = 60_000;

export interface WorldRunResult {
    seeded: { sources: number; streams: number };
    ingest: Awaited<ReturnType<typeof ingestNews>>;
    clusters: { clusters: number; corroborated: number };
    translation: Awaited<ReturnType<typeof translatePending>>;
}

async function runWorld(db: Db, workspaceId: string, deadline: number): Promise<WorldRunResult> {
    const seeded = await seedWorldSources(db, workspaceId);
    const ingest = await ingestNews(db, workspaceId, { deadline });

    // Clustering is pure computation over rows already fetched, so it runs even
    // when ingestion ran short of time — yesterday's items still cluster.
    const clusters = await rebuildClusters(db, workspaceId);

    // Translation is the expensive step and the first thing to drop.
    const translation =
        Date.now() < deadline
            ? await translatePending(db, workspaceId)
            : { translated: 0, costUsd: 0, skipped: 0 };

    return { seeded, ingest, clusters, translation };
}

export async function POST(req: NextRequest) {
    const deadline = Date.now() + TIME_BUDGET_MS;
    const secret = process.env.CRON_SECRET;
    const isCron = !!secret && req.headers.get('authorization') === `Bearer ${secret}`;

    if (isCron) {
        const db = createServiceClient();
        if (!db) return NextResponse.json({ error: 'Service client unavailable.' }, { status: 503 });

        const { data: workspaces } = await db.from('workspaces').select('id');
        const results: Record<string, WorldRunResult> = {};

        for (const w of workspaces ?? []) {
            if (Date.now() > deadline) break;
            results[w.id as string] = await runWorld(db, w.id as string, deadline);
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
        const result = await runWorld(db, workspaceId, deadline);
        return NextResponse.json({ ok: true, via: 'user', ...result });
    } catch (err) {
        return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
}

export async function GET(req: NextRequest) {
    return POST(req);
}
