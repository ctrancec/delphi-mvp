/**
 * The studio, checked from the dashboard.
 *
 *   GET   what this deployment can render with: ffmpeg's version, stock
 *         photos, narration, for members. Signed out, only whether ffmpeg
 *         is present — enough to check a deploy, and nothing else.
 *   POST  a test render, to an account's preferences when one is named: a
 *         ten-second sample video, or one image for an account that makes
 *         only images. Stored under the workspace and returned as a link
 *         that plays for ten minutes. The owner's alone — it spends a little
 *         compute and storage.
 *
 * Its own route rather than a server action because it carries the ffmpeg
 * binary (see next.config.js), which the department page should not.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NextResponse, type NextRequest } from 'next/server';
import { createClient, currentUser } from '@/lib/supabase/server';
import { findWorkspace } from '@/lib/delphi/bootstrap';
import { OWNER_ONLY, roleOf } from '@/lib/delphi/members';
import { signedUrlFor } from '@/lib/delphi/outputs';
import { getGeminiClient } from '@/lib/llm/gemini';
import {
    getAccount,
    isImageFormat,
    isVideoFormat,
    standInAccount,
    withDefaults,
    type MediaAccount,
} from '@/lib/studio/accounts';
import { ffmpegBinary, ffmpegVersion } from '@/lib/studio/ffmpeg';
import { isPexelsConfigured } from '@/lib/studio/pexels';
import { renderImages, renderVideo } from '@/lib/studio/render';
import { objectPath, stamp, uploadObject } from '@/lib/studio/storage';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function who() {
    const db = await createClient();
    if (!db) return { error: NextResponse.json({ error: 'Supabase is not configured.' }, { status: 503 }) };
    const user = await currentUser();
    if (!user) return { error: NextResponse.json({ error: 'Not signed in.' }, { status: 401 }) };
    const workspaceId = await findWorkspace(db);
    if (!workspaceId) return { error: NextResponse.json({ error: 'No workspace yet.' }, { status: 404 }) };
    const role = await roleOf(db, workspaceId, user.id);
    if (!role) return { error: NextResponse.json({ error: 'Not a member of this workspace.' }, { status: 403 }) };
    return { db, workspaceId, role };
}

export async function GET() {
    const w = await who();
    // Signed out: whether this function can render, yes or no, so a deploy
    // can be checked from outside. Nothing more — not even the version.
    if ('error' in w) {
        return NextResponse.json({ ffmpeg: Boolean(ffmpegBinary()) }, { headers: { 'Cache-Control': 'no-store' } });
    }
    return NextResponse.json(
        {
            ffmpeg: await ffmpegVersion(),
            stockPhotos: isPexelsConfigured(),
            narration: Boolean(getGeminiClient()),
        },
        { headers: { 'Cache-Control': 'no-store' } }
    );
}

export async function POST(req: NextRequest) {
    const w = await who();
    if ('error' in w) return w.error;
    if (w.role !== 'owner') return NextResponse.json({ error: OWNER_ONLY }, { status: 403 });
    const { db, workspaceId } = w;

    if (!ffmpegBinary()) {
        return NextResponse.json(
            { error: 'ffmpeg is not available in this deployment, so nothing can be rendered. The ffmpeg-static package has to be installed and traced into this function.' },
            { status: 503 }
        );
    }

    const body = (await req.json().catch(() => ({}))) as { accountId?: string | null };
    let account: MediaAccount | null = body.accountId ? await getAccount(db, body.accountId) : null;
    if (body.accountId && (!account || account.workspaceId !== workspaceId)) {
        return NextResponse.json({ error: 'That account is not here.' }, { status: 404 });
    }
    account ??= standInAccount(workspaceId, 'Tempest');

    // A sample, not a production: ten seconds is enough to see the voice, the
    // captions and the brand, and short enough to come back quickly.
    const prefs = withDefaults({ durationSec: { min: 6, max: 12 } }, account.preferences);
    const sample: MediaAccount = { ...account, preferences: prefs };
    const videoFormat = prefs.formats.find(isVideoFormat);
    const imageFormat = prefs.formats.find(isImageFormat);

    const workdir = await mkdtemp(path.join(os.tmpdir(), 'studio-test-'));
    const started = Date.now();
    try {
        if (videoFormat) {
            const r = await renderVideo(
                {
                    title: `${account.name}: a test render`,
                    hook: 'This is a test render',
                    scenes: [
                        { narration: `This is a test render for ${account.name}. The studio is working.`, onScreen: 'The studio works', visual: 'sunrise over calm water', seconds: 4 },
                        { narration: 'Pictures, voice and captions come from here, made to your preferences.', onScreen: 'Your preferences, applied', visual: 'hands typing on a laptop', seconds: 4 },
                    ],
                    description: 'A test render from the Tempest studio.',
                    tags: ['test'],
                    thumbnailText: 'Test render',
                    cta: '',
                },
                sample,
                videoFormat,
                workdir,
                { budgetMs: 150_000 }
            );
            const name = objectPath(workspaceId, 'samples', stamp(), 'sample.mp4');
            await uploadObject(db, name, await readFile(r.video.path), 'video/mp4');
            return NextResponse.json({
                kind: 'video',
                url: await signedUrlFor(db, name, 600),
                seconds: r.seconds,
                width: r.frame.width,
                height: r.frame.height,
                narrated: r.narrated,
                stock: r.stockScenes > 0,
                sizeBytes: r.video.sizeBytes,
                renderMs: Date.now() - started,
            });
        }

        const r = await renderImages(
            {
                slides: [{ headline: 'The studio works', body: `A test image for ${account.name}, in its brand.`, visual: 'sunrise over calm water' }],
                caption: 'A test render from the Tempest studio.',
                hashtags: [],
                altText: 'A test image.',
            },
            sample,
            imageFormat ?? 'post',
            workdir,
            { budgetMs: 60_000 }
        );
        const name = objectPath(workspaceId, 'samples', stamp(), 'sample.jpg');
        await uploadObject(db, name, await readFile(r.slides[0].path), 'image/jpeg');
        return NextResponse.json({
            kind: 'image',
            url: await signedUrlFor(db, name, 600),
            width: r.frame.width,
            height: r.frame.height,
            narrated: false,
            stock: r.stockScenes > 0,
            sizeBytes: r.slides[0].sizeBytes,
            renderMs: Date.now() - started,
        });
    } catch (err) {
        const e = err as Error & { remedy?: string };
        return NextResponse.json({ error: e.remedy ? `${e.message} ${e.remedy}` : e.message }, { status: 500 });
    } finally {
        await rm(workdir, { recursive: true, force: true });
    }
}
