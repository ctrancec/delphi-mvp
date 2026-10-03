/**
 * ffmpeg, as a process.
 *
 * The binary comes from `ffmpeg-static`, which ships a build for the platform
 * it is installed on; on Vercel it is traced into the function bundle (see
 * next.config.js). It is run as a child process with its arguments as an
 * array — never through a shell — so a title with a quote in it is a title,
 * not a command.
 *
 * This build carries libass and libfreetype but not `drawtext`, so all text
 * goes through ASS scripts (see ./text.ts) with the fonts directory passed in.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

/** Bundled fonts, OFL-licensed. Traced into the function alongside the binary. */
export const FONTS_DIR = path.join(process.cwd(), 'src', 'lib', 'studio', 'fonts');

let resolved: string | null | undefined;

/**
 * Where ffmpeg is, or null when it is not.
 *
 * `FFMPEG_PATH` wins when set, so a machine with its own ffmpeg can use it
 * and a test can point at a stub. The package is required lazily and inside
 * a try, because its postinstall downloads the binary and a failed download
 * leaves the module present and the file missing.
 */
export function ffmpegBinary(): string | null {
    if (resolved !== undefined) return resolved;

    const fromEnv = process.env.FFMPEG_PATH?.trim();
    if (fromEnv) {
        resolved = existsSync(fromEnv) ? fromEnv : null;
        return resolved;
    }

    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const p = require('ffmpeg-static') as string | null;
        resolved = p && existsSync(p) ? p : null;
    } catch {
        resolved = null;
    }
    return resolved;
}

/** Test seam: forget the cached location. */
export function forgetFfmpeg(): void {
    resolved = undefined;
}

export class FfmpegError extends Error {
    constructor(message: string, readonly args: string[], readonly stderr: string) {
        super(message);
        this.name = 'FfmpegError';
    }
}

export interface RunOptions {
    timeoutMs?: number;
    cwd?: string;
}

/**
 * Run one ffmpeg command. Resolves with the time it took; rejects with the
 * tail of stderr, which is where ffmpeg explains itself.
 */
export function runFfmpeg(args: string[], opts: RunOptions = {}): Promise<{ ms: number; stderr: string }> {
    const bin = ffmpegBinary();
    if (!bin) {
        return Promise.reject(
            new FfmpegError('ffmpeg is not available: the ffmpeg-static binary was not found in this deployment.', args, '')
        );
    }

    const full = ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', ...args];
    const started = Date.now();

    return new Promise((resolve, reject) => {
        const child = spawn(bin, full, { cwd: opts.cwd, stdio: ['ignore', 'ignore', 'pipe'] });
        let stderr = '';
        child.stderr.on('data', (d: Buffer) => {
            stderr += d.toString();
            if (stderr.length > 20_000) stderr = stderr.slice(-20_000);
        });

        const timer = setTimeout(() => {
            child.kill('SIGKILL');
            reject(new FfmpegError(`ffmpeg exceeded ${Math.round((opts.timeoutMs ?? 0) / 1000)}s and was stopped.`, full, stderr));
        }, opts.timeoutMs ?? 120_000);

        child.on('error', (err) => {
            clearTimeout(timer);
            reject(new FfmpegError(`ffmpeg could not start: ${err.message}`, full, stderr));
        });
        child.on('close', (code) => {
            clearTimeout(timer);
            if (code === 0) resolve({ ms: Date.now() - started, stderr });
            else reject(new FfmpegError(`ffmpeg exited with ${code}: ${stderr.trim().split('\n').slice(-3).join(' ') || 'no output'}`, full, stderr));
        });
    });
}

/** The first line of `ffmpeg -version`, or null when it cannot run. */
export async function ffmpegVersion(): Promise<string | null> {
    const bin = ffmpegBinary();
    if (!bin) return null;
    return new Promise((resolve) => {
        const child = spawn(bin, ['-version'], { stdio: ['ignore', 'pipe', 'ignore'] });
        let out = '';
        child.stdout.on('data', (d: Buffer) => (out += d.toString()));
        child.on('error', () => resolve(null));
        child.on('close', (code) => resolve(code === 0 ? out.split('\n')[0]?.trim() || null : null));
    });
}

/**
 * How long a media file plays, in seconds — from ffmpeg's own report of it,
 * since ffmpeg-static ships no ffprobe.
 */
export async function mediaDuration(file: string): Promise<number | null> {
    const bin = ffmpegBinary();
    if (!bin) return null;
    return new Promise((resolve) => {
        const child = spawn(bin, ['-hide_banner', '-nostdin', '-i', file, '-f', 'null', '-'], {
            stdio: ['ignore', 'ignore', 'pipe'],
        });
        let err = '';
        child.stderr.on('data', (d: Buffer) => (err += d.toString()));
        child.on('error', () => resolve(null));
        child.on('close', () => {
            const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(err);
            if (!m) return resolve(null);
            resolve(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]));
        });
    });
}
