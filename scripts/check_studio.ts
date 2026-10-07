/**
 * The studio, offline.
 *
 * Accounts shape what gets made; plans are checked against them; text is
 * timed, chunked and escaped; narration bytes become a WAV; stock search and
 * download run against a fake fetch. Then the real ffmpeg renders a small
 * video and a slide from a plan, with a fake narrator, and the whole
 * production step runs end to end on a fake database with a fake planner.
 * No network, no model call.
 *
 *   npm run delphi:studio
 */

import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
    accountLabel, aspectFor, describeAccount, frameFor, frameSize, platformDefaults, standInAccount, validateAccountInput, withDefaults,
    type MediaAccount,
} from '../src/lib/studio/accounts';
import { refreshStudioRoles, STUDIO_MARKER, studioPrompt, withProducers } from '../src/lib/studio/roles';
import { storedPathsOf } from '../src/lib/delphi/outputs';
import type { Agent, Candidate } from '../src/lib/delphi/types';
import { assColour, assTime, buildSceneAss, buildSrt, captionCues, chunkText, distribute, escapeAss, srtTime, timingsFrom } from '../src/lib/studio/text';
import { narrationPrompt, pcmToWav, readWavHeader, synthesize, type RawSpeech } from '../src/lib/studio/tts';
import { downloadBytes, framedUrl, pickUnused, searchPhotos, type Visual } from '../src/lib/studio/pexels';
import { buildStudioPrompt, publishDescription, validateImagePlan, validateVideoPlan, videoPlanMarkdown, WORDS_PER_SECOND } from '../src/lib/studio/plan';
import { ffmpegBinary, ffmpegVersion, mediaDuration } from '../src/lib/studio/ffmpeg';
import { renderImages, renderVideo } from '../src/lib/studio/render';
import { produceDeliverable } from '../src/lib/studio/produce';
import { validateStaffingPlan } from '../src/lib/delphi/delphi';
import { MIN_RENDER_MS, runNextTask } from '../src/lib/delphi/runtime';
import type { Db } from '../src/lib/delphi/db';

const G = '\x1b[32m', R = '\x1b[31m', D = '\x1b[2m', RS = '\x1b[0m';
let failed = 0;
const ok = (cond: boolean, label: string, note = '') => {
    if (!cond) failed++;
    console.log(`  ${cond ? G + '✓' : R + '✗'}${RS} ${label.padEnd(68)}${note ? D + note + RS : ''}`);
};
const throws = (fn: () => unknown, re: RegExp): boolean => {
    try {
        fn();
        return false;
    } catch (e) {
        return re.test((e as Error).message);
    }
};

const WS = '11111111-1111-4111-8111-111111111111';

function account(over: Partial<MediaAccount> = {}, prefs: Record<string, unknown> = {}): MediaAccount {
    const a = standInAccount(WS, 'Kitchen Science', ['short']);
    return {
        ...a,
        id: 'acc-yt',
        platform: 'youtube',
        handle: 'kitchensci',
        preferences: withDefaults({ niche: 'one-pan cooking', durationSec: { min: 20, max: 40 }, pillars: ['speed', 'cheap'], ...prefs }, a.preferences),
        ...over,
    };
}

async function main() {
    console.log('\nAccounts');
    {
        const p = withDefaults({ durationSec: { min: 400, max: 10 }, imageAspect: 'nope', voice: 'Nobody', formats: ['carousel', 'bogus', 'short', 'short'], hashtags: ['one pan', '#two'], brand: { primary: 'red', accent: '#ABCDEF' } });
        ok(p.durationSec.max === 180 && p.durationSec.min === 180, 'durations clamp to the three-minute ceiling', `${p.durationSec.min}-${p.durationSec.max}`);
        ok(p.imageAspect === '4:5' && p.voice === 'Kore', 'unknown image shape and voice fall back to the defaults');
        ok(p.formats.join(',') === 'short,carousel', 'formats keep the known ones, once each, in canonical order', p.formats.join(','));
        ok(withDefaults({ formats: [] }).formats.join(',') === 'short' && withDefaults({ formats: ['x'] }).formats.join(',') === 'short', 'an account never makes nothing');
        ok(aspectFor('short', p) === '9:16' && aspectFor('landscape', p) === '16:9' && aspectFor('carousel', withDefaults({ imageAspect: '1:1' })) === '1:1', 'video shapes are fixed by format; images take the account\'s shape');
        ok(frameFor('landscape', withDefaults({ quality: 'hd' })).width === 1280, 'a horizontal video in HD is 1280 wide');
        ok(p.hashtags.join(' ') === '#onepan #two', 'hashtags get their sign and lose their spaces', p.hashtags.join(' '));
        ok(p.brand.primary === '#1a2340' && p.brand.accent === '#abcdef', 'a bad colour keeps the default; a good one is lowercased');
        ok(platformDefaults('instagram').formats?.join(',') === 'short,carousel' && platformDefaults('x').formats?.join(',') === 'post', 'platform defaults differ by platform: a page can make video and images');
        ok(!validateAccountInput({ platform: 'youtube', name: 'Kitchen', preferences: { formats: ['nothing'] } }).ok, 'an account that makes nothing is refused');
        const bad = validateAccountInput({ platform: 'youtube', name: 'K' });
        ok(!bad.ok, 'a one-letter name is refused');
        const good = validateAccountInput({ platform: 'youtube', name: ' Kitchen Science ', handle: '@kitchen sci', url: 'youtube.com/@kitchensci' });
        ok(good.ok && good.value.name === 'Kitchen Science' && good.value.handle === '@kitchensci' && good.value.url === 'https://youtube.com/@kitchensci', 'name, handle and url are tidied', good.ok ? good.value.url! : '');
        const a = account();
        ok(accountLabel(a) === 'YouTube · Kitchen Science (@kitchensci)', 'the label reads platform · name (@handle)', accountLabel(a));
        const d = describeAccount(a);
        ok(d.includes('id: acc-yt') && d.includes('makes: short — Vertical short (9:16)') && d.includes('video length: 20-40s') && d.includes('speed; cheap') && !d.includes('created'), 'the description carries what shapes the work and nothing else');
        const imagesOnly = describeAccount(account({}, { formats: ['post'] }));
        ok(!imagesOnly.includes('video length') && !imagesOnly.includes('narration') && imagesOnly.includes('Image post (4:5)'), 'an images-only account is not told about video length or narration');
        ok(describeAccount({ ...a, status: 'paused' }).includes('PAUSED'), 'a paused account says so to the planner');
        // Test channels: a placeholder for trying the studio before a real account.
        ok(withDefaults({}).test === false && withDefaults({ test: true }).test && withDefaults({ test: 'yes' }).test === false, 'a channel is real unless it says it is a test');
        ok(withDefaults({ niche: 'x' }, withDefaults({ test: true })).test, 'editing a test channel keeps it a test');
        const trial = validateAccountInput({ platform: 'youtube', name: 'Sample channel', handle: '@someone_real', url: 'youtube.com/@someone_real', preferences: { test: true } });
        ok(trial.ok && trial.value.handle === null && trial.value.url === null && trial.value.preferences.test, 'a test channel keeps no handle or link: it belongs to nobody yet');
        const connected = validateAccountInput({ platform: 'youtube', name: 'Kitchen Science', handle: '@kitchensci', preferences: { test: false } }, withDefaults({ test: true }));
        ok(connected.ok && !connected.value.preferences.test && connected.value.handle === '@kitchensci', 'switched off, it becomes the real account, handle and all');
        const t = account({ handle: null }, { test: true });
        ok(accountLabel(t) === 'YouTube · Kitchen Science (test)', 'its label says it is a test', accountLabel(t));
        ok(accountLabel({ platform: 'youtube', name: 'Kitchen Science', handle: '@kitchensci' }) === 'YouTube · Kitchen Science (@kitchensci)', 'a label from a channel without its settings reads as before');
        const td = describeAccount(t);
        ok(td.includes('TEST CHANNEL') && /never invent a handle/i.test(td), 'the team is told it is a placeholder, and not to invent the account');
        ok(!describeAccount(a).includes('TEST CHANNEL'), 'a real channel is not');
        for (const [asp, q, w, h] of [['9:16', 'fhd', 1080, 1920], ['16:9', 'hd', 1280, 720], ['4:5', 'fhd', 1080, 1350], ['1:1', 'hd', 720, 720]] as const) {
            const f = frameSize(asp, q);
            ok(f.width === w && f.height === h && f.width % 2 === 0 && f.height % 2 === 0, `${asp} ${q} renders at ${w}×${h}`);
        }
    }

    console.log('\nText: timing, captions, scripts');
    {
        const d = distribute(10, [1, 1, 2]);
        ok(Math.abs(d.reduce((a, b) => a + b, 0) - 10) < 1e-9 && d[2] > d[0], 'durations share the total by weight and sum to it', d.join(', '));
        const tiny = distribute(3, [1, 1, 1, 1], 1.5);
        ok(tiny.every((x) => Math.abs(x - 0.75) < 1e-9), 'when the total cannot fit the floor, scenes shrink equally', tiny.join(', '));
        const t = timingsFrom([2, 3]);
        ok(t[1].start === 2 && t[1].end === 5, 'timings are consecutive');
        const pieces = chunkText('First, the pan goes on high heat; then the oil, then the onion, and only then the garlic, which burns fast.', 42);
        ok(pieces.length >= 3 && pieces.every((p) => p.length <= 42), 'long narration splits into caption-sized pieces at phrase breaks', pieces.join(' | '));
        ok(pieces.every((p) => !/\b(the|then|and|of|to|a)$/i.test(p)), 'no caption line ends on a word that needs the next one', pieces.map((p) => p.split(' ').pop()).join(', '));
        ok(chunkText('short', 42).length === 1 && chunkText('   ', 42).length === 0, 'short text is one piece; blank is none');
        const nearly = chunkText('Garlic goes in last, because it burns fast.', 42);
        ok(nearly.join(' | ') === 'Garlic goes in last, | because it burns fast.', 'a sentence a word too long splits at its comma, not before its last word', nearly.join(' | '));
        ok(chunkText('Supercalifragilisticexpialidociouslyextraordinarily long', 20)[0].length > 20, 'a word longer than a line stands alone rather than vanishing');
        const cues = captionCues('One. Two words here. Three more words now.', { start: 10, end: 16 });
        ok(cues[0].start === 10 && Math.abs(cues[cues.length - 1].end - 16) < 1e-9, 'cues fill exactly the scene they belong to');
        ok(srtTime(3661.5) === '01:01:01,500' && assTime(61.257) === '0:01:01.26', 'time formats match their formats', `${srtTime(3661.5)} ${assTime(61.257)}`);
        ok(buildSrt(cues).startsWith('1\n00:00:10,000 --> '), 'srt is numbered and timed');
        ok(assColour('#1a2340') === '&H0040231A' && assColour('#ffffff', 0.5) === '&H80FFFFFF', 'colours are &HAABBGGRR', assColour('#ffffff', 0.5));
        ok(escapeAss('a {tag} \\N b\nc') === 'a (tag) /N b\\Nc', 'braces and backslashes cannot pass; newlines become \\N', escapeAss('a {tag} \\N b\nc'));
        const ass = buildSceneAss({ width: 720, height: 1280 }, { primary: '#1a2340', accent: '#d98f3c', watermark: '' }, { seconds: 4, title: 'Why it works', cues, watermark: '@kitchensci' });
        ok(ass.includes('PlayResX: 720') && ass.includes('Style: Title,Poppins,') && ass.includes('Style: Caption,Poppins SemiBold,'), 'the script sizes to the frame and names the bundled fonts');
        ok((ass.match(/^Dialogue:/gm) ?? []).length === 2 + cues.length, 'one event per title, caption and watermark');
        const big = buildSceneAss({ width: 1080, height: 1920 }, { primary: '#1a2340', accent: '#d98f3c', watermark: '' }, { seconds: 1, headline: 'Hi' });
        const small = buildSceneAss({ width: 720, height: 1280 }, { primary: '#1a2340', accent: '#d98f3c', watermark: '' }, { seconds: 1, headline: 'Hi' });
        const size = (s: string) => Number(/Style: Headline,Poppins,(\d+)/.exec(s)![1]);
        ok(size(big) === 88 && size(small) === Math.round(88 * (720 / 1080)), 'type scales with the frame', `${size(big)} vs ${size(small)}`);
    }

    console.log('\nNarration');
    {
        const pcm = Buffer.alloc(24000 * 2 * 3); // three seconds of silence at 24 kHz, 16-bit mono
        const wav = pcmToWav(pcm, 24000);
        const h = readWavHeader(wav);
        ok(wav.length === pcm.length + 44 && h?.rate === 24000 && h.channels === 1 && h.bits === 16 && h.dataBytes === pcm.length, 'raw PCM gets a header that reads back');
        ok(readWavHeader(pcm) === null, 'bytes without RIFF are not a WAV');
        const raw: RawSpeech = { mimeType: 'audio/L16;codec=pcm;rate=24000', pcm, model: 'fake-tts', usage: { promptTokens: 10, completionTokens: 90 } };
        const s1 = await synthesize(['One.', 'Two.'], 'Kore', 'calm', async () => raw);
        ok(Math.abs(s1.seconds - 3) < 1e-6 && s1.wav.length === wav.length && s1.model === 'fake-tts', 'a PCM answer becomes a 3s WAV', `${s1.seconds}s`);
        const s2 = await synthesize(['One.'], 'Kore', 'calm', async () => ({ ...raw, mimeType: 'audio/wav', pcm: pcmToWav(Buffer.alloc(48000 * 2 * 2), 48000, 1, 16) }));
        ok(Math.abs(s2.seconds - 2) < 1e-6, 'a WAV answer is read by its header, not the claimed rate', `${s2.seconds}s`);
        let caught = '';
        try {
            await synthesize(['x'], 'Kore', 'calm', async () => ({ ...raw, pcm: Buffer.alloc(10) }));
        } catch (e) {
            caught = (e as Error).message;
        }
        ok(/nothing to narrate/.test(caught), 'an empty answer is refused rather than muxed');
        const prompt = narrationPrompt(['Line one.', ' ', 'Line two.'], 'warm');
        ok(prompt.startsWith('Read the following as a narrator, warm.') && prompt.includes('Line one.\n\nLine two.'), 'the narrator is directed, and the lines are paragraphs');
    }

    console.log('\nStock');
    {
        const calls: string[] = [];
        const fetchImpl = (async (input: string | URL | Request) => {
            const url = String(input);
            calls.push(url);
            if (url.startsWith('https://api.pexels.com/v1/search')) {
                return new Response(JSON.stringify({ photos: [
                    { id: 1, url: 'https://www.pexels.com/photo/1/', photographer: 'Ana', photographer_url: 'https://www.pexels.com/@ana', alt: 'pan', avg_color: '#333333', src: { original: 'https://images.pexels.com/photos/1/pexels-photo-1.jpeg' } },
                    { id: 2, url: 'https://www.pexels.com/photo/2/', photographer: 'Bo', photographer_url: '', alt: null, avg_color: null, src: { original: 'https://images.pexels.com/photos/2/pexels-photo-2.jpeg?x=1' } },
                ] }), { status: 200 });
            }
            if (url.includes('pexels-photo-1.jpeg')) return new Response(Buffer.alloc(100, 1), { status: 200 });
            if (url.includes('huge')) return new Response(Buffer.alloc(13_000_000), { status: 200 });
            return new Response('', { status: 404 });
        }) as typeof fetch;

        delete process.env.PEXELS_API_KEY;
        ok((await searchPhotos('pan', { width: 1080, height: 1920 }, { fetchImpl })).length === 0 && calls.length === 0, 'without a key, no search is made');

        process.env.PEXELS_API_KEY = 'k';
        const found = await searchPhotos('frying pan', { width: 1080, height: 1920 }, { fetchImpl });
        ok(found.length === 2 && calls[0].includes('orientation=portrait') && calls[0].includes('query=frying+pan'), 'the search carries the query and the frame\'s orientation', calls[0]);
        ok(found[0].url === 'https://images.pexels.com/photos/1/pexels-photo-1.jpeg?auto=compress&cs=tinysrgb&fit=crop&w=1080&h=1920', 'photos are asked for cropped to the frame', found[0].url);
        ok(found[1].url.startsWith('https://images.pexels.com/photos/2/pexels-photo-2.jpeg?auto=') && found[1].photographerUrl === 'https://www.pexels.com', 'an existing query string is dropped; a missing profile links to Pexels');
        ok(framedUrl('https://x/y.jpeg?a=b', 1920, 1080).endsWith('fit=crop&w=1920&h=1080'), 'landscape frames crop landscape');
        const used = new Set<number>();
        const first = pickUnused(found, used);
        const second = pickUnused(found, used);
        const third = pickUnused(found, used);
        ok(first?.id === 1 && second?.id === 2 && third?.id === 1, 'a video does not repeat a photo until it must');
        ok((await downloadBytes(found[0].url, { fetchImpl }))?.length === 100, 'bytes download');
        ok((await downloadBytes('https://images.pexels.com/huge', { fetchImpl })) === null, 'an oversized file is refused');
        ok((await downloadBytes('https://images.pexels.com/missing', { fetchImpl })) === null, 'a 404 is null, not a throw');
        delete process.env.PEXELS_API_KEY;
    }

    console.log('\nPlans');
    {
        const a = account(); // 20-40s, narrated
        const scene = (words: number, i = 0) => ({ narration: Array.from({ length: words }, (_, k) => `word${k}`).join(' ') + '.', onScreen: `Scene ${i}`, visual: 'pan on stove', seconds: 5 });
        const fine = validateVideoPlan({ title: 'One pan, ten minutes', hook: 'Ten minutes', scenes: [scene(30, 1), scene(40, 2)], description: 'd', tags: ['One Pan', 'one pan', 'quick', 'x'], thumbnailText: 'Ten minutes', cta: '' }, a.preferences);
        ok(fine.scenes.length === 2 && fine.tags.join(',') === 'one pan,quick' && fine.cta === a.preferences.cta, 'a plan in range passes; tags are lowercased, deduped, one-letter ones dropped', fine.tags.join(','));
        ok(throws(() => validateVideoPlan({ title: 'title', hook: 'h', scenes: [scene(100), scene(100)], description: '', tags: [], thumbnailText: '', cta: '' }, a.preferences), /at most \d+ words/), 'too many words for the account is sent back with a word budget');
        ok(throws(() => validateVideoPlan({ title: 'title', hook: 'h', scenes: [scene(3), scene(3)], description: '', tags: [], thumbnailText: '', cta: '' }, a.preferences), /at least \d+ words/), 'too few words is sent back too');
        ok(throws(() => validateVideoPlan({ title: 'title', hook: 'h', scenes: [scene(30), { ...scene(30), narration: '' }], description: '', tags: [], thumbnailText: '', cta: '' }, a.preferences), /no narration/), 'a narrated account refuses a silent scene');
        ok(throws(() => validateVideoPlan({ title: 'title', hook: 'h', scenes: [scene(30)], description: '', tags: [], thumbnailText: '', cta: '' }, a.preferences), /at least 2/), 'one scene is not a video');
        const silent = validateVideoPlan({ title: 'title', hook: 'h', scenes: [{ ...scene(0), narration: '', seconds: 3 }, { ...scene(0), narration: '', seconds: 3 }], description: '', tags: [], thumbnailText: '', cta: '' }, withDefaults({ narration: false }, a.preferences));
        ok(Math.abs(silent.scenes.reduce((n, s) => n + s.seconds, 0) - 20) < 0.3, 'a silent plan too short for the account is stretched to its minimum', `${silent.scenes.map((s) => s.seconds).join('+')}`);
        const inRange = validateVideoPlan({ title: 'title', hook: 'h', scenes: [{ ...scene(0), narration: '', seconds: 12 }, { ...scene(0), narration: '', seconds: 12 }], description: '', tags: [], thumbnailText: '', cta: '' }, withDefaults({ narration: false }, a.preferences));
        ok(inRange.scenes.map((x) => x.seconds).join('+') === '12+12', 'a silent plan already in range keeps its hold times');
        ok(Math.round(a.preferences.durationSec.max * WORDS_PER_SECOND) === 80, 'the word budget is seconds times the measured reading speed');

        const ip = validateImagePlan({ slides: [{ headline: 'One pan', body: 'b', visual: 'v' }, { headline: 'Two', body: '', visual: '' }], caption: 'A caption long enough.', hashtags: ['One Pan', '#two'], altText: '' }, a.preferences, 'post');
        ok(ip.slides.length === 1 && ip.hashtags.join(' ') === '#onepan #two' && ip.altText === 'One pan', 'a post keeps one slide; hashtags are normalised; alt text falls back to the headline');
        ok(throws(() => validateImagePlan({ slides: [{ headline: 'One pan', body: '', visual: '' }], caption: 'A caption long enough.', hashtags: [], altText: '' }, a.preferences, 'carousel'), /2-6 slides/), 'a carousel wants more than one slide');
        ok(throws(() => validateImagePlan({ slides: [{ headline: 'One pan', body: '', visual: '' }], caption: 'short', hashtags: [], altText: '' }, a.preferences, 'post'), /caption is required/), 'a post needs its caption');

        const prompt = buildStudioPrompt({ format: 'short', objective: 'Make it', projectBrief: 'brief', upstream: { title: 'Script', contentMd: 'the script' }, account: a, stock: false, choNote: 'Shorter.', revision: 1 });
        ok(prompt.includes('attempt 2') && prompt.includes('Shorter.') && prompt.includes('the script') && prompt.includes('40-80 words') && prompt.includes('no stock library') && prompt.includes('vertical short (9:16)'), 'the studio prompt carries the note, the input, the word budget, the format and the stock situation');
        const carouselPrompt = buildStudioPrompt({ format: 'carousel', objective: 'Make it', projectBrief: 'brief', upstream: null, account: account({}, { formats: ['carousel'], imageAspect: '1:1' }), stock: true });
        ok(carouselPrompt.includes('an image carousel (1:1)') && carouselPrompt.includes('a stock photo') && !carouselPrompt.includes('words a second'), 'an image prompt names its shape and says nothing about narration speed');
        const desc = publishDescription(fine, withDefaults({ descriptionTemplate: 'Footer', hashtags: ['#a'] }, a.preferences), ['Photo by Ana on Pexels (u)']);
        ok(desc.includes('Footer') && desc.includes('#a') && desc.includes('Photo by Ana'), 'the published description ends with the footer, hashtags and credits');
        const md = videoPlanMarkdown(fine, a, { seconds: 31, width: 1080, height: 1920, narrated: true, voice: 'Kore', credits: [], stockScenes: 0, generatedScenes: 2 }, [15, 16]);
        ok(md.startsWith('# One pan, ten minutes') && md.includes('## Script') && md.includes('## Publish by hand') && md.includes('(15.0s)'), 'the deliverable document has the script and the publishing words');
    }

    console.log('\nStaffing with accounts');
    {
        const yt = account();
        const ig = account({ id: 'acc-ig', platform: 'instagram', name: 'Kitchen Science IG', handle: 'ksci' }, { formats: ['short', 'carousel'], imageAspect: '4:5' });
        const slugs = new Set(['research-analyst', 'writer', 'video-editor', 'motion-designer']);
        const t = (seq: number, slug: string, extra: Record<string, unknown> = {}) => ({ seq, title: `t${seq}`, objective: `do ${seq}`, assignedSlug: slug, rationale: 'r', fit: 0.9, ...extra });
        const plan = (tasks: unknown[]) => ({ departmentName: 'YT', summary: 's', estimatedCostUsd: 1, requiredChannels: [], tasks });

        const good = validateStaffingPlan(plan([
            t(1, 'research-analyst'),
            t(2, 'writer', { accountId: 'acc-yt' }),
            t(3, 'video-editor', { accountId: 'acc-yt', deliverable: 'short' }),
            t(4, 'writer', { accountId: 'acc-ig' }),
            t(5, 'motion-designer', { accountId: 'acc-ig', deliverable: 'carousel' }),
            t(6, 'video-editor', { accountId: 'acc-ig', deliverable: 'short' }),
        ]), slugs, [yt, ig]);
        ok(good.tasks.map((x) => `${x.deliverable}:${x.accountId ?? '-'}`).join(' ') === 'text:- text:acc-yt short:acc-yt text:acc-ig carousel:acc-ig short:acc-ig', 'one chain per account passes; a page may get both a short and a carousel');
        ok(throws(() => validateStaffingPlan(plan([t(1, 'research-analyst'), t(2, 'video-editor', { accountId: 'acc-yt', deliverable: 'short' }), t(3, 'motion-designer', { accountId: 'nope', deliverable: 'carousel' })]), slugs, [yt, ig]), /not an account/), 'an invented account id is refused');
        ok(throws(() => validateStaffingPlan(plan([t(1, 'research-analyst'), t(2, 'video-editor', { deliverable: 'short' }), t(3, 'motion-designer', { accountId: 'acc-ig', deliverable: 'carousel' })]), slugs, [yt, ig]), /must name the account/), 'a production step without an account is refused when accounts exist');
        ok(throws(() => validateStaffingPlan(plan([t(1, 'research-analyst'), t(2, 'video-editor', { accountId: 'acc-yt', deliverable: 'short' })]), slugs, [yt, ig]), /no production step for account acc-ig/), 'an account left without its piece fails the plan');
        ok(throws(() => validateStaffingPlan(plan([t(1, 'video-editor', { accountId: 'acc-yt', deliverable: 'landscape' }), t(2, 'motion-designer', { accountId: 'acc-ig', deliverable: 'carousel' })]), slugs, [yt, ig]), /does not make/), 'a format the account does not make is refused');
        ok(throws(() => validateStaffingPlan(plan([t(1, 'video-editor', { accountId: 'acc-yt', deliverable: 'short' }), t(2, 'motion-designer', { accountId: 'acc-ig', deliverable: 'carousel' })]), slugs, [yt, { ...ig, status: 'paused' }]), /paused/), 'work for a paused account is refused');
        ok(throws(() => validateStaffingPlan(plan([t(1, 'motion-designer', { accountId: 'acc-ig', deliverable: 'carousel' })]), slugs, [{ ...yt, status: 'paused' }, { ...ig, status: 'paused' }]), /paused/), 'even when every account is paused');
        const none = validateStaffingPlan(plan([t(1, 'research-analyst'), t(2, 'video-editor', { deliverable: 'short' })]), slugs, []);
        ok(none.tasks[1].deliverable === 'short' && none.tasks[1].accountId === null, 'with no accounts, a production step may stand alone');
        ok(validateStaffingPlan(plan([t(1, 'research-analyst', { deliverable: 'video' })]), slugs, []).tasks[0].deliverable === 'text', 'an unknown deliverable reads as text');

        // Whoever produces each format is on the shortlist, whatever the charter's words.
        const agent = (slug: string): Agent => ({ id: slug, workspaceId: WS, slug, name: slug, title: slug, avatarSeed: null, systemPrompt: '', skills: [], channelIds: [], model: 'm', costTier: 2, origin: 'seed', inventedFor: null, archivedAt: null });
        const roster = ['research-analyst', 'writer', 'video-editor', 'motion-designer'].map(agent);
        const short: Candidate[] = [{ agent: roster[0], stats: null, skillMatch: 1 }];
        ok(withProducers(short, roster, new Map(), [yt, ig]).map((c) => c.agent.slug).join(',') === 'research-analyst,video-editor,motion-designer', 'producers join the shortlist for the formats the accounts make');
        ok(withProducers(short, roster, new Map(), [yt]).map((c) => c.agent.slug).join(',') === 'research-analyst,video-editor', 'only the producers the formats need');
        ok(withProducers(short, roster, new Map(), [{ ...yt, status: 'paused' }]).length === 1, 'paused accounts add nobody');
    }

    const bin = ffmpegBinary();
    console.log(`\nRender ${D}(${bin ? await ffmpegVersion() : 'ffmpeg missing — skipped'})${RS}`);
    if (bin) {
        const a = account({}, { quality: 'hd', captions: true, durationSec: { min: 5, max: 20 } });
        const work = await mkdtemp(path.join(os.tmpdir(), 'studio-check-'));
        const frame = { width: 360, height: 640 };
        const pcm = Buffer.alloc(24000 * 2 * 6); // 6 s of silence
        const generate = async (): Promise<RawSpeech> => ({ mimeType: 'audio/L16;codec=pcm;rate=24000', pcm, model: 'fake-tts', usage: { promptTokens: 1, completionTokens: 2 } });
        const search = async (): Promise<Visual[]> => [];
        const lines: string[] = [];
        const plan = {
            title: 'One pan, ten minutes',
            hook: 'Ten minutes, one pan',
            scenes: [
                { narration: 'Heat the pan first. Then the oil, then the onion.', onScreen: 'Pan first', visual: 'pan', seconds: 2 },
                { narration: 'Garlic goes in last, because it burns fast.', onScreen: '', visual: 'garlic', seconds: 2 },
            ],
            description: 'A quick one.',
            tags: ['cooking'],
            thumbnailText: 'Ten minutes',
            cta: 'Subscribe.',
        };
        const t0 = Date.now();
        const r = await renderVideo(plan, a, 'short', work, { generate, search, stock: true, frame, log: (l) => lines.push(l) });
        ok(existsSync(r.video.path) && r.video.sizeBytes > 10_000, 'a video file is written', `${r.video.sizeBytes} bytes in ${Date.now() - t0}ms`);
        const dur = await mediaDuration(r.video.path);
        ok(dur !== null && Math.abs(dur - 6) < 0.35, 'it runs the length of the narration', `${dur}s`);
        ok(Math.abs(r.sceneSeconds.reduce((x, y) => x + y, 0) - 6) < 1e-6 && r.sceneSeconds[0] > r.sceneSeconds[1], 'scenes tile the narration, the wordier one longer', r.sceneSeconds.join(' + '));
        ok(r.narrated && r.generatedScenes === 2 && r.stockScenes === 0, 'with no stock to be had, the backgrounds are painted', lines.join(' / '));
        ok(existsSync(r.thumbnail.path) && r.thumbnail.sizeBytes > 1000, 'a thumbnail is written');
        const srt = await readFile(r.captions.path, 'utf8');
        ok(srt.includes('1\n00:00:00,000 --> ') && srt.includes('because it burns fast.'), 'captions are written as .srt, split at the phrase', srt.split('\n').filter((l) => /[a-z]/i.test(l)).join(' | '));
        ok(lines.some((l) => /rendered 360×640/.test(l)), 'the log says what was rendered', lines[lines.length - 1]);

        const long: string[] = [];
        const fit = await renderVideo(plan, { ...a, preferences: withDefaults({ durationSec: { min: 3, max: 5 } }, a.preferences) }, 'short', path.join(work, 'fit'), { generate, search, stock: false, frame, log: (l) => long.push(l) });
        const fdur = await mediaDuration(fit.video.path);
        ok(fdur !== null && Math.abs(fdur - 5) < 0.3 && long.some((l) => /sped the narration up 20%/.test(l)), 'narration that runs over the account\'s maximum is sped up to fit', `${fdur}s · ${long.find((l) => l.startsWith('sped')) ?? 'not sped'}`);
        const tooLong: string[] = [];
        const nineSeconds = async (): Promise<RawSpeech> => ({ mimeType: 'audio/L16;codec=pcm;rate=24000', pcm: Buffer.alloc(24000 * 2 * 9), model: 'fake-tts', usage: { promptTokens: 1, completionTokens: 2 } });
        const capped = await renderVideo(plan, { ...a, preferences: withDefaults({ durationSec: { min: 5, max: 5 } }, a.preferences) }, 'short', path.join(work, 'capped'), { generate: nineSeconds, search, stock: false, frame, log: (l) => tooLong.push(l) });
        ok(Math.abs(capped.seconds - 7.5) < 0.3, 'but by no more than a fifth: past that it runs long rather than rushed', `9s read in ${capped.seconds.toFixed(2)}s`);

        const silent = await renderVideo(plan, { ...a, preferences: withDefaults({ narration: false }, a.preferences) }, 'short', path.join(work, 'silent'), { search, stock: false, frame });
        const sdur = await mediaDuration(silent.video.path);
        ok(!silent.narrated && sdur !== null && Math.abs(sdur - 4) < 0.35, 'a silent account renders to the plan\'s hold times, with a silent track', `${sdur}s`);

        const img = await renderImages(
            { slides: [{ headline: 'One pan', body: 'Ten minutes, start to finish.', visual: 'pan' }, { headline: 'Garlic last', body: '', visual: 'garlic' }], caption: 'c', hashtags: [], altText: 'a' },
            { ...a, preferences: withDefaults({ formats: ['carousel'], imageAspect: '4:5' }, a.preferences) },
            'carousel',
            path.join(work, 'img'),
            { search, stock: false, frame: { width: 360, height: 450 } }
        );
        ok(img.slides.length === 2 && img.slides.every((s) => existsSync(s.path) && s.sizeBytes > 1000) && img.slides[0].mimeType === 'image/jpeg', 'a carousel renders one jpeg per slide');

        // The whole production step on a fake database, with a fake planner.
        const uploads: { name: string; type: string; bytes: number }[] = [];
        const events: string[] = [];
        const db = {
            from: (table: string) => ({
                select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: table === 'delphi_media_accounts' ? { ...a, workspace_id: WS, department_id: 'd1', created_at: a.createdAt, updated_at: a.updatedAt } : null, error: null }) }) }),
            }),
            storage: { from: () => ({ upload: async (name: string, blob: Blob, o: { contentType: string }) => { uploads.push({ name, type: o.contentType, bytes: blob.size }); return { error: null }; } }) },
        } as unknown as Db;
        const planner = (async (_prompt: string, _schema: unknown, validate: (v: unknown) => unknown) => ({ data: validate(plan), raw: '', model: 'fake-planner', usage: { promptTokens: 5, completionTokens: 7, cachedTokens: 0 }, costUsd: 0.01, repaired: false })) as unknown as Parameters<typeof produceDeliverable>[0]['planner'];
        const result = await produceDeliverable({
            db, workspaceId: WS, projectId: 'p1', projectBrief: 'brief', departmentName: 'YouTube',
            task: { id: 't3', title: 'Produce the short', objective: 'Make it', format: 'short', accountId: 'acc-yt', choNote: null, revision: 0 },
            agent: { name: 'Kurobe', systemPrompt: 'You edit.' }, model: 'm', upstream: { title: 'Script', contentMd: 'the script' },
            log: (l) => { events.push(l); }, deps: { generate, search, stock: true, frame }, planner, workdir: path.join(work, 'produce'), runStamp: 'r1',
        });
        ok(result.out.kind === 'video' && result.file.path === `${WS}/p1/t3/r1/video.mp4` && result.file.mimeType === 'video/mp4', 'the step files the video under workspace/project/task/run, so a redo keeps the old file', result.file.path);
        ok(uploads.map((u) => u.name.split('/').pop()).join(',') === 'video.mp4,thumbnail.jpg,captions.srt', 'video, thumbnail and captions are uploaded', uploads.map((u) => `${u.type}:${u.bytes}`).join(' '));
        ok(result.accountId === 'acc-yt' && (result.studio.account as { label: string }).label === accountLabel(a), 'the artifact knows its account');
        ok(Math.abs(result.costUsd - 0.01) < 1e-9 || result.costUsd > 0.01, 'the plan\'s cost is carried, plus narration', `$${result.costUsd}`);
        ok(result.usage.promptTokens === 6 && result.usage.completionTokens === 9, 'usage adds the planner and the narrator', JSON.stringify(result.usage));
        ok(result.out.contentMd.includes('## Publish by hand') && (result.studio.publish as { title: string }).title === plan.title, 'the deliverable carries the publishing words');
        ok(events.some((l) => l.startsWith('planned a 2-scene short')) && events.some((l) => l.startsWith('rendered')), 'the activity log gets the steps', events.join(' / '));
        const owned = storedPathsOf({ storage_path: result.file.path, data: { studio: result.studio } });
        ok(owned.length === 3 && owned.every((p) => p.startsWith(`${WS}/p1/t3/r1/`)), 'purging a render removes the video, the thumbnail and the captions', owned.map((p) => p.split('/').pop()).join(', '));
        ok(storedPathsOf({ storage_path: null, data: {} }).length === 0 && storedPathsOf({ storage_path: 'a/b.pdf', data: null }).join() === 'a/b.pdf', 'an ordinary artifact owns just its own file, if any');

        await rm(work, { recursive: true, force: true });
    }

    console.log('\nThe runtime, when the studio cannot render');
    {
        // No binary: the production step fails cleanly and says why, like any
        // other failed task — and the pipeline is left where it stood.
        const saved = process.env.FFMPEG_PATH;
        process.env.FFMPEG_PATH = '/nonexistent/ffmpeg';
        const { forgetFfmpeg } = await import('../src/lib/studio/ffmpeg');
        forgetFfmpeg();

        const tables: Record<string, Record<string, unknown>[]> = {
            delphi_system_state: [{ workspace_id: WS, mode: 'running' }],
            delphi_projects: [{ id: 'p1', workspace_id: WS, department_id: 'd1', title: 'YT', brief: 'b', status: 'running', spent_usd: 0, budget_usd: 5 }],
            delphi_departments: [{ id: 'd1', workspace_id: WS, name: 'YouTube' }],
            delphi_agents: [{ id: 'a1', name: 'Kurobe', title: 'Video Editor', system_prompt: 'x', model: 'm', channel_ids: [] }],
            delphi_tasks: [{ id: 't1', workspace_id: WS, project_id: 'p1', agent_id: 'a1', seq: 1, title: 'Produce', objective: 'o', depends_on: null, status: 'pending', deliverable: 'short', account_id: null }],
            delphi_task_runs: [], delphi_events: [], delphi_channels: [], delphi_handoffs: [], delphi_artifacts: [],
        };
        const fake = (table: string) => {
            const filters: ((r: Record<string, unknown>) => boolean)[] = [];
            let mode: 'select' | 'insert' | 'update' = 'select';
            let patch: Record<string, unknown> = {};
            let embed = false;
            let inserted: Record<string, unknown> | null = null;
            const run = () => {
                if (mode === 'insert') return { data: inserted ? [inserted] : [], error: null };
                const rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
                if (mode === 'update') for (const r of rows) Object.assign(r, patch);
                const out = embed && table === 'delphi_tasks' ? rows.map((r) => ({ ...r, agent: tables.delphi_agents[0] })) : rows;
                return { data: out, error: null };
            };
            const self: Record<string, unknown> = {
                select: (cols?: string) => ((embed = !!cols?.includes('agent:')), self),
                eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), self),
                neq: () => self, in: (k: string, v: unknown[]) => (filters.push((r) => v.includes(r[k])), self), is: () => self, lt: () => self,
                order: () => self, limit: () => self,
                insert: (row: Record<string, unknown>) => { mode = 'insert'; inserted = { id: `${table}-${(tables[table] ??= []).length + 1}`, ...row }; tables[table].push(inserted); return self; },
                update: (p: Record<string, unknown>) => ((mode = 'update'), (patch = p), self),
                maybeSingle: async () => ({ data: run().data?.[0] ?? null, error: null }),
                single: async () => ({ data: run().data?.[0] ?? null, error: null }),
                then: (resolve: (v: unknown) => unknown) => Promise.resolve(run()).then(resolve),
            };
            return self;
        };
        const db = { from: fake } as unknown as Db;

        // Too little time left in this invocation: the step is not even claimed.
        const early = await runNextTask(db, WS, 'p1', { deadline: Date.now() + MIN_RENDER_MS - 1000 });
        ok(early.status === 'idle' && early.reason === 'needs_fresh_run' && tables.delphi_tasks[0].status === 'pending' && tables.delphi_task_runs.length === 0, 'a render with too little time left waits for a fresh run, unclaimed');

        const out = await runNextTask(db, WS, 'p1', { deadline: Date.now() + 280_000 });
        ok(out.status === 'failed' && /ffmpeg is not available/.test((out as { error: string }).error), 'a production step without ffmpeg fails with the reason', out.status === 'failed' ? (out as { error: string }).error.slice(0, 60) : out.status);
        ok(tables.delphi_tasks[0].status === 'failed' && tables.delphi_task_runs[0]?.status === 'failed', 'the task and its run are marked failed, nothing is stuck running');
        ok(tables.delphi_events.some((e) => e.type === 'task_failed'), 'the failure is in the activity log');

        if (saved === undefined) delete process.env.FFMPEG_PATH;
        else process.env.FFMPEG_PATH = saved;
        forgetFfmpeg();
    }

    console.log('\nThe studio roles');
    {
        const p = studioPrompt('video-editor', 'Kurobe');
        ok(!!p && p.includes('You are Kurobe, a Video Editor.') && p.includes(STUDIO_MARKER) && !p.includes('Kit Alvarez') && p.includes('OPERATING RULES'), 'the video editor\'s description is the studio one, in the cast name, with the protocol');
        ok(!!studioPrompt('motion-designer', 'Ramiris')?.includes(STUDIO_MARKER) && studioPrompt('writer', 'Shion') !== null && studioPrompt('nobody', 'X') === null, 'both studio roles describe the studio; an unknown slug has no description');

        const rows: Record<string, unknown>[] = [
            { id: 'a1', workspace_id: WS, slug: 'video-editor', name: 'Kurobe', system_prompt: 'You are Kurobe, a Video Editor.\nYou cut raw footage into something worth watching.', skills: ['video'], cost_tier: 3 },
            { id: 'a2', workspace_id: WS, slug: 'motion-designer', name: 'Ramiris', system_prompt: `already ${STUDIO_MARKER}`, skills: ['x'], cost_tier: 2 },
        ];
        const events: Record<string, unknown>[] = [];
        const updates: string[] = [];
        const db = {
            from: (table: string) => {
                const q: Record<string, unknown> = {};
                let patch: Record<string, unknown> | null = null;
                q.select = () => q;
                q.eq = (k: string, v: unknown) => {
                    if (patch && k === 'id') {
                        const r = rows.find((x) => x.id === v)!;
                        Object.assign(r, patch);
                        updates.push(String(r.name));
                        return Promise.resolve({ error: null });
                    }
                    return q;
                };
                q.in = async () => ({ data: rows.map((r) => ({ ...r })), error: null });
                q.update = (p: Record<string, unknown>) => ((patch = p), q);
                q.insert = async (row: Record<string, unknown>) => {
                    if (table === 'delphi_events') events.push(row);
                    return { error: null };
                };
                return q;
            },
        } as unknown as Db;
        const changed = await refreshStudioRoles(db, WS);
        ok(changed.join() === 'Kurobe' && updates.join() === 'Kurobe', 'only the role still described the old way is updated', changed.join());
        ok(String(rows[0].system_prompt).includes(STUDIO_MARKER) && (rows[0].skills as string[]).includes('shorts') && rows[0].cost_tier === 2, 'it gets the studio description, skills and tier');
        ok(events.length === 1 && events[0].type === 'roles_updated', 'and the change is logged once');
        const again = await refreshStudioRoles(db, WS);
        ok(again.length === 0 && events.length === 1, 'a second run changes nothing');
    }

    console.log(failed ? `\n${R}${failed} check(s) failed${RS}` : `\n${G}all studio checks passed${RS}`);
    process.exit(failed ? 1 : 0);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
