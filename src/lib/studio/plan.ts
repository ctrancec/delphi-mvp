/**
 * What an agent hands the studio.
 *
 * A production agent does not render anything. It plans: for a video, the
 * scenes — what is said, what is on screen, what the picture should be — and
 * the words that go with it on the platform; for an image post, the slides
 * and the caption. The studio takes the plan from there.
 *
 * The plan is structured output, validated here against what the account
 * wants and what the renderer can do. A plan that would make a ninety-second
 * short for a channel that wants thirty is sent back for repair, not rendered.
 */

import { Type, type Schema } from '@google/genai';
import { accountLabel, aspectFor, describeAccount, FORMAT_LABEL, isVideoFormat, type AccountPreferences, type Format, type ImageFormat, type MediaAccount } from './accounts';
import type { Upstream } from '@/lib/delphi/runtime';

export interface VideoScene {
    /** Spoken, by the narrator. Plain speech. */
    narration: string;
    /** Shown large at the top for the scene. May be empty. */
    onScreen: string;
    /** A stock-photo search, concrete and generic. */
    visual: string;
    /** How long the scene should hold, when there is no narration to time it. */
    seconds: number;
}

export interface VideoPlan {
    title: string;
    hook: string;
    scenes: VideoScene[];
    description: string;
    tags: string[];
    thumbnailText: string;
    cta: string;
}

export interface Slide {
    headline: string;
    body: string;
    visual: string;
}

export interface ImagePlan {
    caption: string;
    hashtags: string[];
    altText: string;
    slides: Slide[];
}

/**
 * How fast the narrator reads, in words a second. Sizes the script.
 *
 * Measured, not assumed: a 78-word script read by the Kore voice, with the
 * pauses between paragraphs the narration prompt asks for, ran 39.7 seconds.
 * 2.5 — the usual figure for speech — wrote scripts a third too long.
 */
export const WORDS_PER_SECOND = 2.0;

export const MAX_SCENES = 16;
export const MAX_SLIDES = 6;

export const VIDEO_PLAN_SCHEMA: Schema = {
    type: Type.OBJECT,
    properties: {
        title: { type: Type.STRING, description: 'The title as it will be published. Under 100 characters.' },
        hook: { type: Type.STRING, description: 'The first line on screen — the reason to keep watching, in under 8 words.' },
        scenes: {
            type: Type.ARRAY,
            description: 'In order. Each is one shot.',
            items: {
                type: Type.OBJECT,
                properties: {
                    narration: {
                        type: Type.STRING,
                        description: 'What the narrator says over this shot. Spoken language, 1-3 short sentences, no markdown, no emoji, no URLs.',
                    },
                    onScreen: {
                        type: Type.STRING,
                        description: 'Large text at the top of the frame for this shot: a few words, or empty.',
                    },
                    visual: {
                        type: Type.STRING,
                        description: 'A stock-photo search for the shot, 2-5 concrete words: "rain on a city window at night". Generic scenes only — no named people, logos, screenshots or charts.',
                    },
                    seconds: { type: Type.NUMBER, description: 'How long the shot holds, 3-10 seconds.' },
                },
                required: ['narration', 'onScreen', 'visual', 'seconds'],
            },
        },
        description: {
            type: Type.STRING,
            description: 'The published description: what the video covers, in the account\'s voice. Plain text, line breaks allowed.',
        },
        tags: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Up to 15 search tags, lowercase.' },
        thumbnailText: { type: Type.STRING, description: 'Up to 5 words, written large on the thumbnail.' },
        cta: { type: Type.STRING, description: 'The closing line. Use the account\'s own call to action when it has one.' },
    },
    required: ['title', 'hook', 'scenes', 'description', 'tags', 'thumbnailText', 'cta'],
};

export const IMAGE_PLAN_SCHEMA: Schema = {
    type: Type.OBJECT,
    properties: {
        slides: {
            type: Type.ARRAY,
            description: 'One slide for a single post; 2-6 for a carousel, in order.',
            items: {
                type: Type.OBJECT,
                properties: {
                    headline: { type: Type.STRING, description: 'Large, centred. Up to 8 words.' },
                    body: { type: Type.STRING, description: 'Under the headline. Up to 25 words, or empty.' },
                    visual: {
                        type: Type.STRING,
                        description: 'A stock-photo search for the background, 2-5 concrete words. Generic scenes only.',
                    },
                },
                required: ['headline', 'body', 'visual'],
            },
        },
        caption: { type: Type.STRING, description: 'The post text for this platform, in the account\'s voice. No hashtags here.' },
        hashtags: { type: Type.ARRAY, items: { type: Type.STRING }, description: '3-10 hashtags, without the # sign or with it.' },
        altText: { type: Type.STRING, description: 'What the image shows, for people who cannot see it. One sentence.' },
    },
    required: ['slides', 'caption', 'hashtags', 'altText'],
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function asRecord(value: unknown, what: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${what} must be an object`);
    return value as Record<string, unknown>;
}

function text(v: unknown, max: number): string {
    return String(v ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, max);
}

function multiline(v: unknown, max: number): string {
    return String(v ?? '')
        .replace(/\r\n?/g, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .slice(0, max);
}

function tagList(v: unknown, max: number, hash: boolean): string[] {
    const items = Array.isArray(v) ? v : [];
    const out: string[] = [];
    for (const raw of items) {
        let t = String(raw).trim().toLowerCase().replace(/^#+/, '').replace(/\s+/g, hash ? '' : ' ').slice(0, 40);
        if (!t) continue;
        if (hash) t = `#${t.replace(/[^\p{L}\p{N}_]/gu, '')}`;
        if (t.length < 2 || out.includes(t)) continue;
        out.push(t);
        if (out.length >= max) break;
    }
    return out;
}

export function wordCount(s: string): number {
    return s.trim() ? s.trim().split(/\s+/).length : 0;
}

/**
 * The plan, checked against the account.
 *
 * Length is enforced on the script rather than on the seconds the model
 * claims, because narration decides the real length: words divided by the
 * reading speed is what the video will run, whatever `seconds` says.
 */
export function validateVideoPlan(value: unknown, prefs: AccountPreferences): VideoPlan {
    const o = asRecord(value, 'plan');

    const title = text(o.title, 100);
    if (title.length < 3) throw new Error('title is required (3-100 characters)');

    const rawScenes = Array.isArray(o.scenes) ? o.scenes : [];
    if (rawScenes.length < 2) throw new Error('scenes needs at least 2 entries');
    if (rawScenes.length > MAX_SCENES) throw new Error(`scenes has ${rawScenes.length} entries; the most the studio renders is ${MAX_SCENES}`);

    const scenes: VideoScene[] = rawScenes.map((raw, i) => {
        const s = asRecord(raw, `scenes[${i}]`);
        const narration = multiline(s.narration, 600).replace(/\n+/g, ' ');
        const visual = text(s.visual, 80) || text(o.title, 60);
        const secs = Number(s.seconds);
        return {
            narration,
            onScreen: text(s.onScreen, 80),
            visual,
            seconds: Number.isFinite(secs) ? Math.min(12, Math.max(2, secs)) : 5,
        };
    });

    const spoken = scenes.reduce((n, s) => n + wordCount(s.narration), 0);
    if (prefs.narration) {
        const silent = scenes.filter((s) => !s.narration).length;
        if (silent > 0) {
            throw new Error(`${silent} scene(s) have no narration, and this account is narrated: every scene needs a line to be read`);
        }
        const seconds = spoken / WORDS_PER_SECOND;
        const { min, max } = prefs.durationSec;
        if (seconds > max * 1.25) {
            throw new Error(
                `the narration is about ${spoken} words, which reads in roughly ${Math.round(seconds)}s; this account wants ${min}-${max}s, so cut it to at most ${Math.round(max * WORDS_PER_SECOND)} words`
            );
        }
        if (seconds < min * 0.5) {
            throw new Error(
                `the narration is only about ${spoken} words (${Math.round(seconds)}s); this account wants ${min}-${max}s, so write at least ${Math.round(min * WORDS_PER_SECOND)} words`
            );
        }
    } else {
        // Silent: the hold times are the length, so scale them into range.
        const total = scenes.reduce((n, s) => n + s.seconds, 0);
        const { min, max } = prefs.durationSec;
        if (total > max || total < min) {
            const target = Math.min(max, Math.max(min, total));
            const k = target / total;
            for (const s of scenes) s.seconds = Math.round(s.seconds * k * 10) / 10;
        }
    }

    return {
        title,
        hook: text(o.hook, 80) || title,
        scenes,
        description: multiline(o.description, 2500),
        tags: tagList(o.tags, 15, false),
        thumbnailText: text(o.thumbnailText, 40) || title.slice(0, 40),
        cta: text(o.cta, 200) || prefs.cta,
    };
}

export function validateImagePlan(value: unknown, prefs: AccountPreferences, format: ImageFormat): ImagePlan {
    const o = asRecord(value, 'plan');

    const rawSlides = Array.isArray(o.slides) ? o.slides : [];
    if (rawSlides.length < 1) throw new Error('slides needs at least 1 entry');

    let slides: Slide[] = rawSlides.slice(0, MAX_SLIDES).map((raw, i) => {
        const s = asRecord(raw, `slides[${i}]`);
        const headline = text(s.headline, 90);
        if (headline.length < 2) throw new Error(`slides[${i}].headline is required`);
        return { headline, body: text(s.body, 180), visual: text(s.visual, 80) || headline };
    });

    if (format === 'post') slides = slides.slice(0, 1);
    if (format === 'carousel' && slides.length < 2) {
        throw new Error('this is a carousel: give it 2-6 slides');
    }

    const caption = multiline(o.caption, 2200);
    if (caption.length < 10) throw new Error('caption is required: the post text');

    return {
        slides,
        caption,
        hashtags: tagList(o.hashtags, 30, true),
        altText: text(o.altText, 250) || slides[0].headline,
    };
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

export interface StudioPromptInput {
    format: Format;
    objective: string;
    projectBrief: string;
    upstream: Upstream | null;
    account: MediaAccount;
    choNote?: string | null;
    revision?: number;
    stock: boolean;
}

/** What the agent is told, in place of the ordinary task prompt. */
export function buildStudioPrompt(input: StudioPromptInput): string {
    const p = input.account.preferences;
    const parts: string[] = [];

    if (input.choNote) {
        parts.push(
            '--- THE CHO SENT YOUR LAST ATTEMPT BACK ---',
            `This is attempt ${(input.revision ?? 1) + 1}. They said:`,
            '',
            input.choNote,
            '',
            'Address that specifically. The same plan with different wording is not a revision.',
            ''
        );
    }

    parts.push('PROJECT BRIEF (context, not your task):', input.projectBrief, '');

    if (input.upstream) {
        parts.push('--- INPUT FROM THE PREVIOUS AGENT ---', `Title: ${input.upstream.title}`, input.upstream.contentMd, '');
        if (input.upstream.handoffNote) parts.push('They left you this note:', input.upstream.handoffNote, '');
    } else {
        parts.push('You are first in the pipeline. There is no upstream input.', '');
    }

    parts.push('--- THE ACCOUNT THIS IS FOR ---', describeAccount(input.account), '');

    const visuals = input.stock
        ? 'a stock photo found with your `visual` query'
        : 'a background in the account\'s brand colours (no stock library is connected, so the words carry the picture)';

    const aspect = aspectFor(input.format, p);

    if (isVideoFormat(input.format)) {
        const words = {
            min: Math.round(p.durationSec.min * WORDS_PER_SECOND),
            max: Math.round(p.durationSec.max * WORDS_PER_SECOND),
        };
        parts.push(
            '--- THE STUDIO ---',
            `You are planning a ${FORMAT_LABEL[input.format].toLowerCase()} for this account. You do not render it; the studio does, from your plan:`,
            `- each scene becomes one shot: ${visuals}, your onScreen text large at the top, and your narration ${p.narration ? `read by a ${p.voice} voice with captions` : 'shown as captions (this account is silent, so the words on screen carry it)'}.`,
            '- the studio cannot show named people, logos, screenshots, charts or products. Ask for generic, concrete scenes: "hands kneading dough", "a commuter train at dusk".',
            `- the whole video must run ${p.durationSec.min}-${p.durationSec.max} seconds. Narration reads at about ${WORDS_PER_SECOND} words a second, so write ${words.min}-${words.max} words in total across all scenes. Count them.`,
            '- narration is spoken language: short sentences, no markdown, no emoji, no URLs, no "in this video". Open on the hook; close on the call to action.',
            '- every fact in the narration comes from the input above. Do not add facts, figures or names it does not contain.',
            `- write the title, description and tags for ${accountLabel(input.account)} in its tone. The description must not promise anything the scenes do not deliver.`,
            ''
        );
    } else {
        parts.push(
            '--- THE STUDIO ---',
            `You are planning ${input.format === 'carousel' ? 'an image carousel' : 'a single image post'} (${aspect}). You do not render it; the studio does, from your plan:`,
            `- each slide becomes one image: ${visuals}, with your headline large in the middle and the body text beneath it.`,
            '- headlines are at most 8 words; body text at most 25. A phone screen is the size of the page.',
            '- the studio cannot show named people, logos, screenshots, charts or products. Ask for generic, concrete scenes.',
            '- every fact on a slide or in the caption comes from the input above. Do not add any.',
            `- write the caption for ${accountLabel(input.account)} in its tone and this platform's conventions. Hashtags go in the hashtags list, not in the caption.`,
            ''
        );
    }

    parts.push('--- YOUR TASK ---', input.objective, '', 'Return the plan.');
    return parts.join('\n');
}

// ---------------------------------------------------------------------------
// What gets published, and what the library shows
// ---------------------------------------------------------------------------

/** The description as it should be pasted: the plan's, then the account's standing lines, then credits. */
export function publishDescription(plan: VideoPlan, prefs: AccountPreferences, credits: string[]): string {
    const blocks = [plan.description.trim()];
    if (plan.cta && !plan.description.includes(plan.cta)) blocks.push(plan.cta);
    if (prefs.descriptionTemplate) blocks.push(prefs.descriptionTemplate);
    if (prefs.hashtags.length) blocks.push(prefs.hashtags.join(' '));
    if (credits.length) blocks.push(['Visuals:', ...credits.map((c) => `- ${c}`)].join('\n'));
    return blocks.filter(Boolean).join('\n\n');
}

export function publishCaption(plan: ImagePlan, prefs: AccountPreferences, credits: string[]): string {
    const tags = [...new Set([...plan.hashtags, ...prefs.hashtags])];
    const blocks = [plan.caption.trim()];
    if (prefs.cta && !plan.caption.includes(prefs.cta)) blocks.push(prefs.cta);
    if (prefs.descriptionTemplate) blocks.push(prefs.descriptionTemplate);
    if (tags.length) blocks.push(tags.join(' '));
    if (credits.length) blocks.push(credits.map((c) => `📷 ${c}`).join('\n'));
    return blocks.filter(Boolean).join('\n\n');
}

export interface RenderFacts {
    seconds: number;
    width: number;
    height: number;
    narrated: boolean;
    voice: string;
    credits: string[];
    stockScenes: number;
    generatedScenes: number;
}

function fence(s: string): string {
    return ['```', s.replace(/```/g, "'''"), '```'].join('\n');
}

/** The video, as a document: the script with its shots, then what to paste when publishing. */
export function videoPlanMarkdown(plan: VideoPlan, account: MediaAccount, facts: RenderFacts, sceneSeconds: number[]): string {
    const lines: string[] = [];
    lines.push(`# ${plan.title}`, '');
    lines.push(
        `${accountLabel(account)} · ${facts.width}×${facts.height} · ${Math.round(facts.seconds)}s · ${facts.narrated ? `narrated (${facts.voice})` : 'silent, captioned'} · ${facts.stockScenes} stock shot(s), ${facts.generatedScenes} generated`,
        ''
    );
    lines.push(`**Hook:** ${plan.hook}`, '');
    lines.push('## Script', '');
    plan.scenes.forEach((s, i) => {
        const dur = sceneSeconds[i] !== undefined ? ` _(${sceneSeconds[i].toFixed(1)}s)_` : '';
        lines.push(`### ${i + 1}. ${s.onScreen || '—'}${dur}`, '');
        if (s.narration) lines.push(`> ${s.narration}`, '');
        lines.push(`_Visual: ${s.visual}_`, '');
    });
    lines.push('## Publish by hand', '');
    lines.push(`**Title:** ${plan.title}`, '');
    lines.push('**Description:**', '', fence(publishDescription(plan, account.preferences, facts.credits)), '');
    if (plan.tags.length) lines.push(`**Tags:** ${plan.tags.join(', ')}`, '');
    lines.push(`**Thumbnail text:** ${plan.thumbnailText}`, '');
    if (facts.credits.length) {
        lines.push('## Credits', '', ...facts.credits.map((c) => `- ${c}`), '');
    }
    return lines.join('\n');
}

export function imagePlanMarkdown(plan: ImagePlan, account: MediaAccount, facts: Omit<RenderFacts, 'seconds' | 'narrated' | 'voice'>): string {
    const lines: string[] = [];
    lines.push(`# ${plan.slides[0].headline}`, '');
    lines.push(`${accountLabel(account)} · ${facts.width}×${facts.height} · ${plan.slides.length} slide(s) · ${facts.stockScenes} stock, ${facts.generatedScenes} generated`, '');
    lines.push('## Slides', '');
    plan.slides.forEach((s, i) => {
        lines.push(`### ${i + 1}. ${s.headline}`, '');
        if (s.body) lines.push(s.body, '');
        lines.push(`_Visual: ${s.visual}_`, '');
    });
    lines.push('## Publish by hand', '');
    lines.push('**Caption:**', '', fence(publishCaption(plan, account.preferences, facts.credits)), '');
    lines.push(`**Alt text:** ${plan.altText}`, '');
    if (facts.credits.length) lines.push('## Credits', '', ...facts.credits.map((c) => `- ${c}`), '');
    return lines.join('\n');
}
