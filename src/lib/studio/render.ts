/**
 * The render: a plan in, files out.
 *
 * A video is built shot by shot. Each scene is one still — a stock photo
 * cropped to the frame by Pexels, or a gradient the studio paints in the
 * brand's colours — panned slowly across the frame with the scene's text
 * drawn on it by libass, encoded to its own short clip. The clips are joined
 * without re-encoding, the narration is muxed in, and the whole thing is
 * written once more with the index at the front so it streams.
 *
 * Scene lengths come from the narration when there is one: it is recorded in
 * one take, so the scenes have to tile its length, and each gets a share in
 * proportion to how much is said in it. Without narration the plan's own hold
 * times stand.
 *
 * Everything that reaches the network — stock search, narration — is a seam,
 * so the whole render runs offline in the test with a real ffmpeg.
 */

import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { TokenUsage } from '@/lib/llm/cost';
import { frameFor, watermarkFor, type AccountPreferences, type ImageFormat, type MediaAccount, type VideoFormat } from './accounts';
import { FONTS_DIR, mediaDuration, runFfmpeg } from './ffmpeg';
import { creditLine, downloadBytes, isPexelsConfigured, pickUnused, searchPhotos, type Visual } from './pexels';
import type { ImagePlan, VideoPlan } from './plan';
import { buildSceneAss, buildSrt, captionCues, distribute, speechWeight, timingsFrom, type Cue, type Frame } from './text';
import { synthesize, type Generate, type Speech } from './tts';

export interface RenderDeps {
    fetchImpl?: typeof fetch;
    /** The narration call. Defaults to Gemini. */
    generate?: Generate;
    /** The stock search. Defaults to Pexels. */
    search?: (query: string, frame: Frame) => Promise<Visual[]>;
    /** Whether to look for stock at all. Defaults to whether Pexels has a key. */
    stock?: boolean;
    /** Override the frame — the tests render small. */
    frame?: Frame;
    /** Wall-clock budget for the whole render. */
    budgetMs?: number;
    /** Progress, one line at a time, for the activity log. */
    log?: (line: string) => void;
}

export interface FileOut {
    path: string;
    mimeType: string;
    sizeBytes: number;
}

export interface VideoRender {
    video: FileOut;
    thumbnail: FileOut;
    captions: FileOut;
    seconds: number;
    sceneSeconds: number[];
    frame: Frame;
    credits: string[];
    narrated: boolean;
    narration: { model: string; usage: TokenUsage; costUsd: number } | null;
    stockScenes: number;
    generatedScenes: number;
    cues: Cue[];
    ms: { visuals: number; narration: number; encode: number; total: number };
}

export interface ImageRender {
    slides: FileOut[];
    frame: Frame;
    credits: string[];
    stockScenes: number;
    generatedScenes: number;
    ms: { visuals: number; encode: number; total: number };
}

const FPS = 24;

/** The most narration is sped up to fit an account's length: a fifth, and it still sounds like speech. */
const MAX_TEMPO = 1.2;

/** Even, because yuv420p chroma is sampled in pairs. */
const even = (n: number) => Math.round(n / 2) * 2;

/**
 * The fonts, copied beside the work so every filter names them relatively.
 *
 * An absolute path in a filter graph is one ':' or ',' away from being parsed
 * as something else, and where the app is installed is not this code's to
 * choose. Run from the work folder with relative names, nothing outside it
 * reaches the graph.
 */
const FONTS = 'fonts';

async function stageFonts(workdir: string): Promise<void> {
    const into = path.join(workdir, FONTS);
    await mkdir(into, { recursive: true });
    for (const f of await readdir(FONTS_DIR)) {
        if (/\.(ttf|otf)$/i.test(f)) await copyFile(path.join(FONTS_DIR, f), path.join(into, f));
    }
}

/** The ass filter for a script in the work folder. */
function assFilter(script: string): string {
    return `ass=${script}:fontsdir=${FONTS}`;
}

async function fileOut(p: string, mimeType: string): Promise<FileOut> {
    const s = await stat(p);
    return { path: p, mimeType, sizeBytes: s.size };
}

function budget(started: number, budgetMs: number, what: string): void {
    if (Date.now() - started > budgetMs) {
        throw new Error(`The render ran out of time ${what} (${Math.round(budgetMs / 1000)}s). Shorter videos or HD quality render faster.`);
    }
}

// ---------------------------------------------------------------------------
// Backgrounds
// ---------------------------------------------------------------------------

function hexArg(hex: string): string {
    return `0x${hex.replace('#', '')}`;
}

function darken(hex: string, by = 0.55): string {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    if (!m) return '#0d1128';
    const c = [m[1], m[2], m[3]].map((h) => Math.round(parseInt(h, 16) * (1 - by)).toString(16).padStart(2, '0'));
    return `#${c.join('')}`;
}

/**
 * A gradient in the brand's colours, a different sweep for each scene so a
 * silent, stock-less video still moves from shot to shot.
 */
async function paintBackground(file: string, frame: Frame, prefs: AccountPreferences, index: number): Promise<void> {
    const { width: w, height: h } = frame;
    const sweeps = [
        [0, 0, w, h],
        [w, 0, 0, h],
        [0, h, w, 0],
        [w / 2, 0, w / 2, h],
    ];
    const [x0, y0, x1, y1] = sweeps[index % sweeps.length].map(Math.round);
    const colours = [prefs.brand.primary, prefs.brand.accent, darken(prefs.brand.primary)];
    const order = index % 2 === 0 ? colours : [colours[2], colours[0], colours[1]];
    const src =
        `gradients=s=${w}x${h}:c0=${hexArg(order[0])}:c1=${hexArg(order[1])}:c2=${hexArg(order[2])}` +
        `:nb_colors=3:x0=${x0}:y0=${y0}:x1=${x1}:y1=${y1}`;
    await runFfmpeg(['-f', 'lavfi', '-i', src, '-frames:v', '1', file], { timeoutMs: 30_000 });
}

interface Background {
    file: string;
    visual: Visual | null;
}

/**
 * One background per scene: stock when it can be had, painted otherwise.
 * Searches run together; nothing here throws for a missing photo.
 */
async function backgrounds(
    queries: string[],
    frame: Frame,
    prefs: AccountPreferences,
    workdir: string,
    deps: RenderDeps
): Promise<Background[]> {
    const useStock = deps.stock ?? isPexelsConfigured();
    const search = deps.search ?? ((q: string, f: Frame) => searchPhotos(q, f, { fetchImpl: deps.fetchImpl }));
    const used = new Set<number>();

    const results = useStock
        ? await Promise.all(queries.map((q) => search(q, frame).catch(() => [] as Visual[])))
        : queries.map(() => [] as Visual[]);

    const out: Background[] = [];
    for (let i = 0; i < queries.length; i++) {
        const file = path.join(workdir, `bg_${i}.jpg`);
        const visual = pickUnused(results[i], used);
        const bytes = visual ? await downloadBytes(visual.url, { fetchImpl: deps.fetchImpl }) : null;
        if (visual && bytes) {
            await writeFile(file, bytes);
            out.push({ file, visual });
            continue;
        }
        const painted = path.join(workdir, `bg_${i}.png`);
        await paintBackground(painted, frame, prefs, i);
        out.push({ file: painted, visual: null });
    }
    return out;
}

// ---------------------------------------------------------------------------
// Scenes
// ---------------------------------------------------------------------------

/** A slow pan, a different direction each scene, over a frame scaled up a little. */
function panFilter(frame: Frame, seconds: number, index: number): string {
    const sw = even(frame.width * 1.12);
    const sh = even(frame.height * 1.12);
    const d = Math.max(0.1, seconds).toFixed(3);
    const p = `min(1\\,t/${d})`;
    const across = `(iw-ow)*${p}`;
    const down = `(ih-oh)*${p}`;
    const backAcross = `(iw-ow)*(1-${p})`;
    const backDown = `(ih-oh)*(1-${p})`;
    const centreX = '(iw-ow)/2';
    const centreY = '(ih-oh)/2';
    const moves = [
        [across, centreY],
        [centreX, down],
        [backAcross, centreY],
        [centreX, backDown],
    ];
    const [x, y] = moves[index % moves.length];
    return `scale=${sw}:${sh},crop=${frame.width}:${frame.height}:x='${x}':y='${y}'`;
}

function encoderArgs(prefs: AccountPreferences): string[] {
    return prefs.quality === 'fhd'
        ? ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '25']
        : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24'];
}

async function encodeScene(
    index: number,
    bg: string,
    seconds: number,
    ass: string,
    frame: Frame,
    prefs: AccountPreferences,
    workdir: string
): Promise<string> {
    const out = path.join(workdir, `scene_${index}.mp4`);
    const vf = `${panFilter(frame, seconds, index)},${assFilter(path.basename(ass))},format=yuv420p`;
    await runFfmpeg(
        [
            '-loop', '1', '-framerate', String(FPS), '-i', bg,
            '-t', seconds.toFixed(3),
            '-vf', vf,
            '-r', String(FPS),
            ...encoderArgs(prefs),
            '-pix_fmt', 'yuv420p', '-an',
            out,
        ],
        { timeoutMs: 120_000, cwd: workdir }
    );
    return out;
}

// ---------------------------------------------------------------------------
// Video
// ---------------------------------------------------------------------------

export async function renderVideo(
    plan: VideoPlan,
    account: MediaAccount,
    format: VideoFormat,
    workdir: string,
    deps: RenderDeps = {}
): Promise<VideoRender> {
    const started = Date.now();
    const budgetMs = deps.budgetMs ?? 240_000;
    const prefs = account.preferences;
    const frame = deps.frame ?? frameFor(format, prefs);
    const log = deps.log ?? (() => {});
    await mkdir(workdir, { recursive: true });
    await stageFonts(workdir);

    // Pictures first, all at once.
    const t0 = Date.now();
    const bgs = await backgrounds(plan.scenes.map((s) => s.visual), frame, prefs, workdir, deps);
    const msVisuals = Date.now() - t0;
    const stockScenes = bgs.filter((b) => b.visual).length;
    log(stockScenes ? `found ${stockScenes} stock photo(s) on Pexels` : 'painted the backgrounds in brand colours');
    budget(started, budgetMs, 'fetching visuals');

    // Then the voice, in one take.
    let speech: Speech | null = null;
    let narrationFile = 'narration.wav';
    const t1 = Date.now();
    if (prefs.narration) {
        const lines = plan.scenes.map((s) => s.narration).filter(Boolean);
        if (lines.length) {
            speech = await synthesize(lines, prefs.voice, prefs.tone, deps.generate);
            await writeFile(path.join(workdir, narrationFile), speech.wav);
            log(`narrated ${Math.round(speech.seconds)}s with ${speech.model} (${prefs.voice})`);

            // A voice reads at its own pace, and a script sized to the
            // account's length can still come back long. Up to a fifth
            // faster is still natural speech; past that, the video runs long
            // rather than sounding rushed.
            const max = prefs.durationSec.max;
            if (speech.seconds > max + 0.5) {
                const tempo = Math.min(MAX_TEMPO, speech.seconds / max);
                await runFfmpeg(['-i', narrationFile, '-filter:a', `atempo=${tempo.toFixed(4)}`, 'narration_fit.wav'], {
                    timeoutMs: 60_000,
                    cwd: workdir,
                });
                narrationFile = 'narration_fit.wav';
                const fitted = (await mediaDuration(path.join(workdir, narrationFile))) ?? speech.seconds / tempo;
                log(`sped the narration up ${Math.round((tempo - 1) * 100)}% to ${Math.round(fitted)}s, for a ${max}s maximum`);
                speech = { ...speech, seconds: fitted };
            }
        }
    }
    const msNarration = Date.now() - t1;

    // Scene lengths: the recording's, shared out by how much each scene says;
    // or the plan's hold times.
    const sceneSeconds = speech
        ? distribute(speech.seconds, plan.scenes.map((s) => speechWeight(s.narration)), 2)
        : plan.scenes.map((s) => s.seconds);
    const timings = timingsFrom(sceneSeconds);
    const total = timings[timings.length - 1]?.end ?? 0;

    // Captions follow the narration; a silent video shows its lines as captions too.
    const cues: Cue[] = [];
    plan.scenes.forEach((s, i) => cues.push(...captionCues(s.narration, timings[i])));
    const watermark = watermarkFor(account);

    const t2 = Date.now();
    const clips: string[] = [];
    for (let i = 0; i < plan.scenes.length; i++) {
        budget(started, budgetMs, `at scene ${i + 1} of ${plan.scenes.length}`);
        const s = plan.scenes[i];
        const local = cues
            .filter((c) => c.start >= timings[i].start - 1e-6 && c.start < timings[i].end)
            .map((c) => ({ ...c, start: c.start - timings[i].start, end: Math.min(c.end, timings[i].end) - timings[i].start }));
        const ass = path.join(workdir, `scene_${i}.ass`);
        await writeFile(
            ass,
            buildSceneAss(frame, prefs.brand, {
                seconds: sceneSeconds[i],
                title: i === 0 && !s.onScreen ? plan.hook : s.onScreen,
                cues: prefs.captions ? local : [],
                watermark,
            })
        );
        clips.push(await encodeScene(i, bgs[i].file, sceneSeconds[i], ass, frame, prefs, workdir));
    }

    const list = path.join(workdir, 'scenes.txt');
    await writeFile(list, clips.map((c) => `file '${path.basename(c)}'`).join('\n') + '\n');
    const joined = path.join(workdir, 'joined.mp4');
    await runFfmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', joined], { timeoutMs: 60_000, cwd: workdir });

    const video = path.join(workdir, 'video.mp4');
    const audioIn = speech
        ? ['-i', path.join(workdir, narrationFile)]
        : ['-f', 'lavfi', '-i', 'anullsrc=channel_layout=mono:sample_rate=48000'];
    await runFfmpeg(
        [
            '-i', joined, ...audioIn,
            '-map', '0:v:0', '-map', '1:a:0',
            '-c:v', 'copy', '-c:a', 'aac', '-b:a', speech ? '128k' : '48k', '-ar', '48000',
            '-shortest', '-movflags', '+faststart',
            video,
        ],
        { timeoutMs: 60_000, cwd: workdir }
    );
    const msEncode = Date.now() - t2;

    // The thumbnail: the first shot with the thumbnail line across it.
    const thumbAss = path.join(workdir, 'thumb.ass');
    await writeFile(thumbAss, buildSceneAss(frame, prefs.brand, { seconds: 1, headline: plan.thumbnailText, watermark }));
    const thumbnail = path.join(workdir, 'thumbnail.jpg');
    await runFfmpeg(
        ['-i', bgs[0].file, '-vf', `${assFilter(path.basename(thumbAss))},format=yuv420p`, '-frames:v', '1', '-q:v', '3', thumbnail],
        { timeoutMs: 30_000, cwd: workdir }
    );

    const captions = path.join(workdir, 'captions.srt');
    await writeFile(captions, buildSrt(cues));

    const credits = bgs.map((b) => b.visual).filter((v): v is Visual => Boolean(v)).map(creditLine);
    log(`rendered ${frame.width}×${frame.height}, ${Math.round(total)}s, in ${Math.round((Date.now() - started) / 1000)}s`);

    return {
        video: await fileOut(video, 'video/mp4'),
        thumbnail: await fileOut(thumbnail, 'image/jpeg'),
        captions: await fileOut(captions, 'application/x-subrip'),
        seconds: total,
        sceneSeconds,
        frame,
        credits: [...new Set(credits)],
        narrated: Boolean(speech),
        narration: speech ? { model: speech.model, usage: speech.usage, costUsd: speech.costUsd } : null,
        stockScenes,
        generatedScenes: bgs.length - stockScenes,
        cues,
        ms: { visuals: msVisuals, narration: msNarration, encode: msEncode, total: Date.now() - started },
    };
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

export async function renderImages(
    plan: ImagePlan,
    account: MediaAccount,
    format: ImageFormat,
    workdir: string,
    deps: RenderDeps = {}
): Promise<ImageRender> {
    const started = Date.now();
    const budgetMs = deps.budgetMs ?? 120_000;
    const prefs = account.preferences;
    const frame = deps.frame ?? frameFor(format, prefs);
    const log = deps.log ?? (() => {});
    await mkdir(workdir, { recursive: true });
    await stageFonts(workdir);

    const t0 = Date.now();
    const bgs = await backgrounds(plan.slides.map((s) => s.visual), frame, prefs, workdir, deps);
    const msVisuals = Date.now() - t0;
    const stockScenes = bgs.filter((b) => b.visual).length;
    log(stockScenes ? `found ${stockScenes} stock photo(s) on Pexels` : 'painted the backgrounds in brand colours');

    const watermark = watermarkFor(account);
    const t1 = Date.now();
    const slides: FileOut[] = [];
    for (let i = 0; i < plan.slides.length; i++) {
        budget(started, budgetMs, `at slide ${i + 1}`);
        const ass = path.join(workdir, `slide_${i}.ass`);
        await writeFile(
            ass,
            buildSceneAss(frame, prefs.brand, {
                seconds: 1,
                headline: plan.slides[i].headline,
                body: plan.slides[i].body || undefined,
                watermark: plan.slides.length > 1 ? `${watermark} · ${i + 1}/${plan.slides.length}` : watermark,
            })
        );
        const out = path.join(workdir, `slide_${i + 1}.jpg`);
        await runFfmpeg(
            ['-i', bgs[i].file, '-vf', `${assFilter(path.basename(ass))},format=yuv420p`, '-frames:v', '1', '-q:v', '2', out],
            { timeoutMs: 30_000, cwd: workdir }
        );
        slides.push(await fileOut(out, 'image/jpeg'));
    }
    const msEncode = Date.now() - t1;

    const credits = bgs.map((b) => b.visual).filter((v): v is Visual => Boolean(v)).map(creditLine);
    log(`rendered ${slides.length} slide(s) at ${frame.width}×${frame.height} in ${Math.round((Date.now() - started) / 1000)}s`);

    return {
        slides,
        frame,
        credits: [...new Set(credits)],
        stockScenes,
        generatedScenes: bgs.length - stockScenes,
        ms: { visuals: msVisuals, encode: msEncode, total: Date.now() - started },
    };
}

/** Bytes of a rendered file, for upload. */
export async function readOut(f: FileOut): Promise<Buffer> {
    return readFile(f.path);
}
