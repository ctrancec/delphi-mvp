/**
 * What a rendered deliverable needs beside it: the words to publish it with,
 * the files that go with it, and where its pictures came from.
 *
 * Publishing is done by hand — the video, thumbnail and captions download
 * from here, and the title, description and tags copy with one tap.
 */

import Link from 'next/link';
import { Download, Film, Image as ImageIcon, Subtitles } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CopyButton } from './copy-button';

interface Stored {
    path: string;
    mimeType: string;
    sizeBytes: number;
}

export interface StudioData {
    kind: 'video' | 'image';
    format?: string;
    account: { id: string; label: string; platform: string; name: string; handle: string | null } | null;
    publish: {
        title?: string;
        description?: string;
        tags?: string[];
        thumbnailText?: string;
        caption?: string;
        hashtags?: string[];
        altText?: string;
    };
    credits: string[];
    render: {
        seconds?: number;
        width: number;
        height: number;
        narrated?: boolean;
        voice?: string;
        slides?: number;
        stockScenes: number;
        generatedScenes: number;
        ms?: { total?: number };
    };
    files: { thumbnail?: Stored; captions?: Stored; slides?: Stored[] };
}

/** `data.studio`, when the artifact has one and it is shaped as expected. */
export function studioOf(data: Record<string, unknown>): StudioData | null {
    const s = data.studio as StudioData | undefined;
    if (!s || (s.kind !== 'video' && s.kind !== 'image') || !s.publish || !s.render) return null;
    return { ...s, credits: Array.isArray(s.credits) ? s.credits : [], files: s.files ?? {} };
}

function Block({ label, text }: { label: string; text: string }) {
    return (
        <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
                <CopyButton text={text} />
            </div>
            <pre className="whitespace-pre-wrap rounded-md border border-white/10 bg-black/30 p-3 font-sans text-sm text-zinc-200">{text}</pre>
        </div>
    );
}

export function StudioPanel({ artifactId, studio }: { artifactId: string; studio: StudioData }) {
    const { publish, render, files, credits } = studio;
    const dl = (file: string) => `/api/delphi/outputs/${artifactId}/download?file=${file}`;
    const tags = publish.tags?.length ? publish.tags.join(', ') : null;
    const hashtags = publish.hashtags?.length ? publish.hashtags.join(' ') : null;

    return (
        <Card className="bg-black/40 border-white/10">
            <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                    {studio.kind === 'video' ? <Film className="h-4 w-4" /> : <ImageIcon className="h-4 w-4" />}
                    Publish by hand
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                    {studio.account ? <>For <span className="text-zinc-200">{studio.account.label}</span>. </> : null}
                    {render.width}×{render.height}
                    {render.seconds !== undefined && <> · {Math.round(render.seconds)}s</>}
                    {render.narrated !== undefined && <> · {render.narrated ? `narrated by ${render.voice}` : 'silent, captioned'}</>}
                    {render.slides !== undefined && <> · {render.slides} slide{render.slides === 1 ? '' : 's'}</>}
                    {' · '}
                    {render.stockScenes} stock, {render.generatedScenes} painted
                    {render.ms?.total !== undefined && <> · rendered in {Math.round(render.ms.total / 1000)}s</>}
                </p>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2">
                    <Link href={`/api/delphi/outputs/${artifactId}/download`} className="inline-flex items-center gap-1.5 rounded-md border border-white/15 px-3 py-1.5 text-xs text-zinc-200 hover:border-white/30">
                        <Download className="h-3.5 w-3.5" /> {studio.kind === 'video' ? 'Video (.mp4)' : 'Image 1 (.jpg)'}
                    </Link>
                    {files.thumbnail && (
                        <Link href={dl('thumbnail')} className="inline-flex items-center gap-1.5 rounded-md border border-white/15 px-3 py-1.5 text-xs text-zinc-200 hover:border-white/30">
                            <ImageIcon className="h-3.5 w-3.5" /> Thumbnail (.jpg)
                        </Link>
                    )}
                    {files.captions && (
                        <Link href={dl('captions')} className="inline-flex items-center gap-1.5 rounded-md border border-white/15 px-3 py-1.5 text-xs text-zinc-200 hover:border-white/30">
                            <Subtitles className="h-3.5 w-3.5" /> Captions (.srt)
                        </Link>
                    )}
                    {(files.slides ?? []).slice(1).map((_, i) => (
                        <Link key={i} href={dl(`slide-${i + 2}`)} className="inline-flex items-center gap-1.5 rounded-md border border-white/15 px-3 py-1.5 text-xs text-zinc-200 hover:border-white/30">
                            <ImageIcon className="h-3.5 w-3.5" /> Image {i + 2} (.jpg)
                        </Link>
                    ))}
                </div>

                {publish.title && <Block label="Title" text={publish.title} />}
                {publish.description && <Block label="Description" text={publish.description} />}
                {tags && <Block label="Tags" text={tags} />}
                {publish.caption && <Block label="Caption" text={publish.caption} />}
                {hashtags && <Block label="Hashtags" text={hashtags} />}
                {publish.altText && <Block label="Alt text" text={publish.altText} />}

                {credits.length > 0 && (
                    <div className="space-y-1">
                        <span className="text-xs uppercase tracking-wide text-muted-foreground">Visuals</span>
                        <ul className="space-y-0.5 text-xs text-muted-foreground">
                            {credits.map((c) => (
                                <li key={c}>{c}</li>
                            ))}
                        </ul>
                        <p className="text-[11px] text-muted-foreground/60">
                            Pexels photos are free to use; the credits above are already in the description.
                        </p>
                    </div>
                )}

                <p className="text-[11px] text-muted-foreground/60">
                    Nothing is uploaded from here. Download the files, paste the words, and publish on the account yourself.
                </p>
            </CardContent>
        </Card>
    );
}
