/**
 * Ask the library what the board would be handed.
 *
 * Exists so retrieval is inspectable. A finding that cites a clause is only
 * trustworthy if you can check that the clause was actually in front of the
 * reviewer, and this is how you check.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { findWorkspace } from '@/lib/delphi/bootstrap';
import { retrieveLegalContext } from '@/lib/legal/retrieve';
import { DEFAULT_JURISDICTIONS } from '@/lib/legal/sources';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
    const db = await createClient();
    if (!db) return NextResponse.json({ error: 'Supabase is not configured.' }, { status: 503 });

    const {
        data: { user },
    } = await db.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

    let question: string;
    try {
        const body = (await req.json()) as { question?: unknown };
        question = typeof body.question === 'string' ? body.question.trim() : '';
    } catch {
        return NextResponse.json({ error: 'Expected a JSON body with a question.' }, { status: 400 });
    }
    if (!question) return NextResponse.json({ error: 'Ask something.' }, { status: 400 });

    const workspaceId = await findWorkspace(db);
    if (!workspaceId) return NextResponse.json({ error: 'No workspace.' }, { status: 400 });

    try {
        const { passages, terms } = await retrieveLegalContext(db, workspaceId, question, {
            jurisdictions: [...DEFAULT_JURISDICTIONS],
        });

        return NextResponse.json({
            terms,
            passages: passages.map((p) => ({
                documentTitle: p.documentTitle,
                section: p.section,
                jurisdiction: p.jurisdiction,
                sourceUrl: p.sourceUrl,
                ageDays: p.ageDays,
                stale: p.stale,
                // Trimmed: this is a preview of what the board sees, not the
                // full passage it reasons over.
                text: p.text.replace(/\s+/g, ' ').slice(0, 600),
            })),
        });
    } catch (err) {
        return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
}
