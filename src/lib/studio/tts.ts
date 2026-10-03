/**
 * Narration — Gemini's text-to-speech, as a WAV file.
 *
 * The TTS models answer with raw 16-bit PCM at 24 kHz; the header is written
 * here so ffmpeg can take the file as it is. The free tier counts these
 * requests per model per day, so the call walks a chain of TTS models the
 * same way every other model call does, and reports a day's allowance being
 * gone as the same ModelQuotaError the runtime already understands.
 */

import { callWithFallback, getGeminiClient, GeminiNotConfiguredError } from '@/lib/llm/gemini';
import { computeCost, type TokenUsage } from '@/lib/llm/cost';

export const TTS_MODEL = 'gemini-3.8-flash-tts';

export interface Speech {
    wav: Buffer;
    seconds: number;
    model: string;
    usage: TokenUsage;
    costUsd: number;
}

/** "audio/L16;codec=pcm;rate=24000" → the numbers in it. */
export function parseAudioMime(mime: string | undefined): { rate: number; bits: number } {
    const rate = Number(/rate=(\d+)/.exec(mime ?? '')?.[1] ?? 24000);
    const bits = Number(/L(\d+)/.exec(mime ?? '')?.[1] ?? 16);
    return { rate: Number.isFinite(rate) && rate > 0 ? rate : 24000, bits: bits === 8 || bits === 24 ? bits : 16 };
}

/**
 * The format of a WAV file, read from its header, or null when the bytes are
 * not one. The newer TTS models answer with a complete WAV rather than raw
 * PCM, and the one thing the renderer needs from either is how long it plays.
 */
export function readWavHeader(bytes: Buffer): { rate: number; channels: number; bits: number; dataBytes: number } | null {
    if (bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') {
        return null;
    }
    let at = 12;
    let fmt: { rate: number; channels: number; bits: number } | null = null;
    let dataBytes: number | null = null;
    while (at + 8 <= bytes.length) {
        const id = bytes.toString('ascii', at, at + 4);
        const size = bytes.readUInt32LE(at + 4);
        if (id === 'fmt ' && at + 24 <= bytes.length) {
            fmt = { channels: bytes.readUInt16LE(at + 10), rate: bytes.readUInt32LE(at + 12), bits: bytes.readUInt16LE(at + 22) };
        } else if (id === 'data') {
            // A streamed header may claim more than was written; what is there is what plays.
            dataBytes = Math.min(size, bytes.length - at - 8);
            break;
        }
        at += 8 + size + (size % 2);
    }
    if (!fmt || dataBytes === null || fmt.rate <= 0 || fmt.channels <= 0 || fmt.bits <= 0) return null;
    return { ...fmt, dataBytes };
}

/** A RIFF/WAVE header in front of raw PCM. */
export function pcmToWav(pcm: Buffer, rate = 24000, channels = 1, bits = 16): Buffer {
    const blockAlign = (channels * bits) / 8;
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + pcm.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20); // PCM
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(rate, 24);
    header.writeUInt32LE(rate * blockAlign, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bits, 34);
    header.write('data', 36);
    header.writeUInt32LE(pcm.length, 40);
    return Buffer.concat([header, pcm]);
}

export function pcmSeconds(bytes: number, rate = 24000, channels = 1, bits = 16): number {
    return bytes / (rate * channels * (bits / 8));
}

/** What a TTS model returns, before it is a WAV. */
export interface RawSpeech {
    mimeType: string | undefined;
    pcm: Buffer;
    model: string;
    usage: TokenUsage;
}

export type Generate = (text: string, voice: string) => Promise<RawSpeech>;

/**
 * The live call. Separate so tests can hand in their own and the rest of the
 * pipeline runs with no network.
 */
export const generateSpeech: Generate = async (text, voice) => {
    const ai = getGeminiClient();
    if (!ai) throw new GeminiNotConfiguredError();

    const { response, servedBy } = await callWithFallback(TTS_MODEL, (m) =>
        ai.models.generateContent({
            model: m,
            contents: [{ role: 'user', parts: [{ text }] }],
            config: {
                responseModalities: ['AUDIO'],
                speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
            },
        })
    );

    const part = response.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
    const data = part?.inlineData?.data;
    if (!data) throw new Error(`${servedBy} returned no audio.`);

    const meta = response.usageMetadata ?? {};
    return {
        mimeType: part?.inlineData?.mimeType,
        pcm: Buffer.from(data, 'base64'),
        model: servedBy,
        usage: {
            promptTokens: meta.promptTokenCount ?? 0,
            completionTokens: meta.candidatesTokenCount ?? 0,
            cachedTokens: meta.cachedContentTokenCount ?? 0,
        },
    };
};

/** Narration as the model should read it: a direction, then the lines. */
export function narrationPrompt(lines: string[], tone: string): string {
    return [
        `Read the following as a narrator, ${tone || 'plain-spoken and warm'}. Pause briefly between paragraphs. Do not add anything.`,
        '',
        ...lines.map((l) => l.trim()).filter(Boolean).join('\n\n').split('\n'),
    ].join('\n');
}

/**
 * Narrate the lines in one take. One request, not one per scene: the free
 * tier allows a handful of these a day, and one recording keeps the pacing
 * natural across scene breaks.
 */
export async function synthesize(
    lines: string[],
    voice: string,
    tone: string,
    generate: Generate = generateSpeech
): Promise<Speech> {
    const raw = await generate(narrationPrompt(lines, tone), voice);

    // Either a finished WAV or raw PCM, by what the bytes say rather than by
    // what the model claims: the mime type has been both right and wrong.
    const header = readWavHeader(raw.pcm);
    const wav = header ? raw.pcm : pcmToWav(raw.pcm, parseAudioMime(raw.mimeType).rate, 1, parseAudioMime(raw.mimeType).bits);
    const seconds = header
        ? pcmSeconds(header.dataBytes, header.rate, header.channels, header.bits)
        : pcmSeconds(raw.pcm.length, parseAudioMime(raw.mimeType).rate, 1, parseAudioMime(raw.mimeType).bits);

    if (!(seconds > 0.2)) throw new Error(`${raw.model} returned ${raw.pcm.length} bytes of audio, which is nothing to narrate with.`);

    return {
        wav,
        seconds,
        model: raw.model,
        usage: raw.usage,
        costUsd: computeCost(raw.model, raw.usage),
    };
}
