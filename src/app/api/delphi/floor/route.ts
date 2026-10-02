/**
 * The town's state, as JSON, for the browser to refresh with.
 *
 * Runs under the CHO's own session and RLS, like the pages do: a visitor
 * without a session gets 401 and no rows. A route rather than a server
 * action because it is read on a schedule, not pressed, and because what a
 * 'use server' file exports has to stay an action.
 */

import { NextResponse } from 'next/server';
import { findWorkspace } from '@/lib/delphi/bootstrap';
import { readFloor } from '@/lib/delphi/floor';
import { createClient, currentUser } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET() {
    const db = await createClient();
    if (!db) return NextResponse.json({ error: 'Supabase is not configured.' }, { status: 503 });

    const user = await currentUser();
    if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

    const workspaceId = await findWorkspace(db);
    if (!workspaceId) return NextResponse.json({ error: 'No workspace yet.' }, { status: 404 });

    try {
        const floor = await readFloor(db, workspaceId, new Date(), user.id);
        return NextResponse.json(floor, { headers: { 'Cache-Control': 'no-store' } });
    } catch (err) {
        console.error('[delphi] could not read the floor:', (err as Error).message);
        return NextResponse.json({ error: 'The town could not be read.' }, { status: 500 });
    }
}
