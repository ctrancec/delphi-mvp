/**
 * A production step, end to end.
 *
 * The runtime hands over a task whose deliverable is one of the four
 * formats. The agent plans it — one structured call, in the account's voice,
 * from the upstream material — and the studio renders, uploads and describes
 * it. What comes back is shaped like any other agent output, with the file
 * attached, so the runtime records, grades and hands it on the same way.
 *
 * Nothing here publishes. The file lands in the Outputs library with the
 * title, description and tags beside it, ready to be uploaded by hand.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Schema } from '@google/genai';
import { generateStructured, type GenerateOptions, type GenerateResult } from '@/lib/llm/gemini';
import type { TokenUsage } from '@/lib/llm/cost';
import type { Db } from '@/lib/delphi/db';
import type { AgentOutput, Upstream } from '@/lib/delphi/runtime';
import {
    accountLabel,
    FORMAT_WORD,
    getAccount,
    isVideoFormat,
    standInAccount,
    type Format,
    type MediaAccount,
} from './accounts';
import { ffmpegBinary } from './ffmpeg';
import { isPexelsConfigured } from './pexels';
import {
    buildStudioPrompt,
    IMAGE_PLAN_SCHEMA,
    imagePlanMarkdown,
    publishCaption,
    publishDescription,
    validateImagePlan,
    validateVideoPlan,
    VIDEO_PLAN_SCHEMA,
    videoPlanMarkdown,
    type ImagePlan,
    type VideoPlan,
} from './plan';
import { readOut, renderImages, renderVideo, type FileOut, type RenderDeps } from './render';
import { objectPath, stamp, uploadObject } from './storage';

export type Planner = <T>(
    prompt: string,
    schema: Schema,
    validate: (value: unknown) => T,
    options: GenerateOptions
) => Promise<GenerateResult<T>>;

export interface StudioTask {
    id: string;
    title: string;
    objective: string;
    format: Format;
    accountId: string | null;
    choNote: string | null;
    revision: number;
}

export interface StudioContext {
    db: Db;
    workspaceId: string;
    projectId: string;
    projectBrief: string;
    /** The department's name, for a stand-in account when the task names none. */
    departmentName: string;
    task: StudioTask;
    agent: { name: string; systemPrompt: string };
    model: string;
    upstream: Upstream | null;
    /** The compartment's context (context.ts): department rules, channel decisions, history. */
    context?: string | null;
    /** The channel, already checked to belong to this department. Wins over accountId. */
    account?: MediaAccount | null;
    /** One line at a time, as the activity log wants it. */
    log?: (line: string) => void | Promise<void>;
    /** How long the render may take, all in. */
    budgetMs?: number;
    /** Seams for the test. */
    deps?: RenderDeps;
    /** The structured call that plans the piece. Defaults to Gemini. */
    planner?: Planner;
    /** Where to render. Defaults to a fresh temp directory, removed afterwards. */
    workdir?: string;
    /** Names the folder this run's files go in. Defaults to now. */
    runStamp?: string;
}

export interface StoredFile {
    path: string;
    mimeType: string;
    sizeBytes: number;
}

/** What the runtime records. Shaped like a text task's result, plus the file. */
export interface StudioResult {
    out: AgentOutput;
    usage: TokenUsage;
    costUsd: number;
    model: string;
    file: StoredFile;
    accountId: string | null;
    /** Goes into the artifact's `data.studio`. */
    studio: Record<string, unknown>;
}

function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
    return {
        promptTokens: a.promptTokens + b.promptTokens,
        completionTokens: a.completionTokens + b.completionTokens,
        cachedTokens: (a.cachedTokens ?? 0) + (b.cachedTokens ?? 0),
    };
}

/** The account a task is for, or a stand-in with the defaults. */
export async function resolveAccount(ctx: StudioContext): Promise<MediaAccount> {
    if (ctx.account) return ctx.account;
    if (ctx.task.accountId) {
        const a = await getAccount(ctx.db, ctx.task.accountId);
        if (a) return a;
    }
    return standInAccount(ctx.workspaceId, ctx.departmentName, [ctx.task.format]);
}

function accountRef(a: MediaAccount) {
    return a.id ? { id: a.id, label: accountLabel(a), platform: a.platform, name: a.name, handle: a.handle, test: a.preferences.test } : null;
}

export async function produceDeliverable(ctx: StudioContext): Promise<StudioResult> {
    if (!ffmpegBinary()) {
        throw new Error(
            'The studio cannot render: ffmpeg is not available in this deployment. The ffmpeg-static package must be installed and traced into the function (see next.config.js).'
        );
    }

    const account = await resolveAccount(ctx);
    const prefs = account.preferences;
    const format = ctx.task.format;
    const log = ctx.log ?? (() => {});
    const stock = ctx.deps?.stock ?? isPexelsConfigured();
    const plan$ = ctx.planner ?? generateStructured;
    const deps: RenderDeps = { ...ctx.deps, budgetMs: ctx.budgetMs ?? ctx.deps?.budgetMs, log: (l) => void log(l) };

    // Every run files its output in its own folder. A redo writes a new
    // artifact and keeps the one it replaces, so it must not overwrite that
    // one's video either.
    const folder = ctx.runStamp ?? stamp();
    const store = async (f: FileOut, name: string): Promise<StoredFile> => {
        const objectName = objectPath(ctx.workspaceId, ctx.projectId, ctx.task.id, `${folder}/${name}`);
        await uploadObject(ctx.db, objectName, await readOut(f), f.mimeType);
        return { path: objectName, mimeType: f.mimeType, sizeBytes: f.sizeBytes };
    };

    const prompt = buildStudioPrompt({
        format,
        objective: ctx.task.objective,
        projectBrief: ctx.projectBrief,
        upstream: ctx.upstream,
        account,
        choNote: ctx.task.choNote,
        revision: ctx.task.revision,
        stock,
        context: ctx.context ?? null,
    });

    const workdir = ctx.workdir ?? (await mkdtemp(path.join(os.tmpdir(), 'studio-')));
    const cleanup = ctx.workdir ? async () => {} : () => rm(workdir, { recursive: true, force: true });

    try {
        if (isVideoFormat(format)) {
            const planned = await plan$<VideoPlan>(
                prompt,
                VIDEO_PLAN_SCHEMA,
                (v) => validateVideoPlan(v, prefs),
                { system: ctx.agent.systemPrompt, model: ctx.model, temperature: 0.6 }
            );
            const plan = planned.data;
            await log(`planned a ${plan.scenes.length}-scene ${FORMAT_WORD[format]} for ${accountLabel(account)}`);

            const r = await renderVideo(plan, account, format, workdir, deps);

            const file = await store(r.video, 'video.mp4');
            const thumbnail = await store(r.thumbnail, 'thumbnail.jpg');
            const captions = await store(r.captions, 'captions.srt');

            const facts = {
                seconds: r.seconds,
                width: r.frame.width,
                height: r.frame.height,
                narrated: r.narrated,
                voice: prefs.voice,
                credits: r.credits,
                stockScenes: r.stockScenes,
                generatedScenes: r.generatedScenes,
            };
            const usage = r.narration ? addUsage(planned.usage, r.narration.usage) : planned.usage;
            const costUsd = planned.costUsd + (r.narration?.costUsd ?? 0);

            return {
                out: {
                    summary: `${plan.title} — a ${Math.round(r.seconds)}s ${FORMAT_WORD[format]} for ${accountLabel(account)}, ${r.narrated ? `narrated by ${prefs.voice}` : 'silent with captions'}.`,
                    contentMd: videoPlanMarkdown(plan, account, facts, r.sceneSeconds),
                    kind: 'video',
                    steps: [],
                    claims: [],
                    handoffNote: `The ${FORMAT_WORD[format]} is rendered. Title, description and tags are in the deliverable under "Publish by hand"; the thumbnail and .srt captions are attached.`,
                },
                usage,
                costUsd,
                model: planned.model,
                file,
                accountId: account.id || null,
                studio: {
                    kind: 'video',
                    format,
                    account: accountRef(account),
                    plan,
                    publish: {
                        title: plan.title,
                        description: publishDescription(plan, prefs, r.credits),
                        tags: plan.tags,
                        thumbnailText: plan.thumbnailText,
                    },
                    credits: r.credits,
                    render: {
                        seconds: r.seconds,
                        sceneSeconds: r.sceneSeconds,
                        width: r.frame.width,
                        height: r.frame.height,
                        narrated: r.narrated,
                        voice: prefs.voice,
                        narrationModel: r.narration?.model ?? null,
                        stockScenes: r.stockScenes,
                        generatedScenes: r.generatedScenes,
                        ms: r.ms,
                        planModel: planned.model,
                        repaired: planned.repaired,
                    },
                    files: { thumbnail, captions },
                },
            };
        }

        const planned = await plan$<ImagePlan>(
            prompt,
            IMAGE_PLAN_SCHEMA,
            (v) => validateImagePlan(v, prefs, format),
            { system: ctx.agent.systemPrompt, model: ctx.model, temperature: 0.6 }
        );
        const plan = planned.data;
        await log(`planned a ${plan.slides.length}-slide ${FORMAT_WORD[format]} for ${accountLabel(account)}`);

        const r = await renderImages(plan, account, format, workdir, deps);

        const slides: StoredFile[] = [];
        for (let i = 0; i < r.slides.length; i++) slides.push(await store(r.slides[i], `slide_${i + 1}.jpg`));

        const facts = {
            width: r.frame.width,
            height: r.frame.height,
            credits: r.credits,
            stockScenes: r.stockScenes,
            generatedScenes: r.generatedScenes,
        };

        return {
            out: {
                summary: `${plan.slides[0].headline} — ${plan.slides.length > 1 ? `a ${plan.slides.length}-slide carousel` : 'an image post'} for ${accountLabel(account)}.`,
                contentMd: imagePlanMarkdown(plan, account, facts),
                kind: 'image',
                steps: [],
                claims: [],
                handoffNote: `${plan.slides.length} image(s) rendered. The caption and hashtags are in the deliverable under "Publish by hand".`,
            },
            usage: planned.usage,
            costUsd: planned.costUsd,
            model: planned.model,
            file: slides[0],
            accountId: account.id || null,
            studio: {
                kind: 'image',
                format,
                account: accountRef(account),
                plan,
                publish: {
                    caption: publishCaption(plan, prefs, r.credits),
                    hashtags: plan.hashtags,
                    altText: plan.altText,
                },
                credits: r.credits,
                render: {
                    width: r.frame.width,
                    height: r.frame.height,
                    slides: r.slides.length,
                    stockScenes: r.stockScenes,
                    generatedScenes: r.generatedScenes,
                    ms: r.ms,
                    planModel: planned.model,
                    repaired: planned.repaired,
                },
                files: { slides },
            },
        };
    } finally {
        await cleanup();
    }
}
