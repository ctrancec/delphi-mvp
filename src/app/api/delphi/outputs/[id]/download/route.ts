/**
 * Download one deliverable.
 *
 * Text artifacts are served straight from the row as markdown; binaries
 * redirect to a short-lived signed Storage URL. Either way the read goes
 * through the caller's session, so RLS decides whether they may have it — this
 * route never touches the service key.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getOutput, signedUrlFor } from '@/lib/delphi/outputs';

export const dynamic = 'force-dynamic';

/** A title turned into something a filesystem will accept. */
function safeFilename(title: string, extension: string): string {
    const base =
        title
            .normalize('NFKD')
            .replace(/[^\w\s.-]/g, '')
            .trim()
            .replace(/\s+/g, '-')
            .slice(0, 80)
            .replace(/^[.-]+|[.-]+$/g, '') || 'output';
    return `${base}.${extension}`;
}

/**
 * A rendered deliverable carries companions — the thumbnail, the captions,
 * the other slides of a carousel — recorded under `data.studio.files`.
 * `?file=thumbnail`, `?file=captions` or `?file=slide-2` fetches one of them.
 */
function companion(data: Record<string, unknown>, key: string): { path: string } | null {
    const studio = data.studio as { files?: Record<string, unknown> } | undefined;
    const files = studio?.files;
    if (!files) return null;
    const slide = /^slide-(\d+)$/.exec(key);
    if (slide) {
        const slides = files.slides as { path: string }[] | undefined;
        const f = slides?.[Number(slide[1]) - 1];
        return f?.path ? { path: f.path } : null;
    }
    const f = files[key] as { path?: string } | undefined;
    return f?.path ? { path: f.path } : null;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const supabase = await createClient();
    if (!supabase) {
        return NextResponse.json({ error: 'Supabase is not configured.' }, { status: 503 });
    }

    const { id } = await params;

    let record;
    try {
        record = await getOutput(supabase, id);
    } catch (err) {
        return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
    if (!record) {
        return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    }

    const { artifact } = record;

    const wanted = new URL(req.url).searchParams.get('file');
    if (wanted) {
        const f = companion(artifact.data, wanted);
        if (!f) return NextResponse.json({ error: 'This deliverable has no such file.' }, { status: 404 });
        const url = await signedUrlFor(supabase, f.path, 60);
        if (!url) {
            return NextResponse.json({ error: 'The file is recorded but could not be reached in storage.' }, { status: 502 });
        }
        return NextResponse.redirect(url);
    }

    // A rendered file is the deliverable; the markdown beside it is its script.
    if (artifact.storagePath && artifact.contentMd) {
        const url = await signedUrlFor(supabase, artifact.storagePath, 60);
        if (url) return NextResponse.redirect(url);
    }

    if (artifact.contentMd) {
        return new NextResponse(artifact.contentMd, {
            headers: {
                'Content-Type': 'text/markdown; charset=utf-8',
                'Content-Disposition': `attachment; filename="${safeFilename(artifact.title, 'md')}"`,
                // A signed-in user's private document; never let a proxy hold it.
                'Cache-Control': 'private, no-store',
            },
        });
    }

    if (artifact.storagePath) {
        const url = await signedUrlFor(supabase, artifact.storagePath, 60);
        if (!url) {
            return NextResponse.json(
                { error: 'This file is recorded but its storage object could not be reached.' },
                { status: 502 }
            );
        }
        return NextResponse.redirect(url);
    }

    return NextResponse.json({ error: 'This artifact has no downloadable content.' }, { status: 404 });
}
