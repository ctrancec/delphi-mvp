/**
 * One deliverable, with the trail that produced it.
 *
 * The document is the top half; the bottom half is the activity log for the
 * task that wrote it. That pairing is the whole accuracy story — a claim in the
 * report and the source locator it came from, on the same screen.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { format } from 'date-fns';
import { ArrowLeft, Download, FileWarning, Footprints } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArtifactMarkdown } from '@/components/delphi/markdown';
import { KIND_META } from '@/components/delphi/output-card';
import { ActivityLine, type ActivityEvent } from '@/components/delphi/activity-line';
import { OutputReview } from '@/components/delphi/output-review';
import { formatBytes, getOutput, isBinaryKind, readingTime, signedUrlFor } from '@/lib/delphi/outputs';

export const dynamic = 'force-dynamic';

function MediaPreview({
    kind,
    url,
    mimeType,
    title,
}: {
    kind: string;
    url: string;
    mimeType: string | null;
    title: string;
}) {
    if (kind === 'image') {
        // Not next/image: the source is a short-lived signed URL on a Supabase
        // host, which the optimizer would have to be configured to allow.
        // eslint-disable-next-line @next/next/no-img-element
        return <img src={url} alt={title} className="max-h-[70vh] w-full rounded-lg object-contain" />;
    }
    if (kind === 'video') {
        return (
            <video controls preload="metadata" className="max-h-[70vh] w-full rounded-lg bg-black">
                <source src={url} type={mimeType ?? undefined} />
            </video>
        );
    }
    if (kind === 'audio') {
        return <audio controls src={url} className="w-full" />;
    }
    return (
        <a href={url} className="text-sm text-sky-400 hover:underline" download>
            Download this file
        </a>
    );
}

export default async function OutputDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const supabase = await createClient();
    if (!supabase) {
        return (
            <Card className="bg-black/40 border-white/10">
                <CardContent className="py-10 text-center text-muted-foreground">
                    Supabase is not configured.
                </CardContent>
            </Card>
        );
    }

    const { id } = await params;
    const record = await getOutput(supabase, id);
    if (!record) notFound();

    const { artifact, review, department, project, task, agent } = record;
    const meta = KIND_META[artifact.kind] ?? KIND_META.other;
    const Icon = meta.icon;

    // The trail belongs to the task that produced this, so an artifact written
    // outside a task simply has none to show.
    const { data: events } = task
        ? await supabase
              .from('delphi_events')
              .select('*')
              .eq('task_id', task.id)
              .order('id', { ascending: true })
              .limit(100)
        : { data: null };

    const mediaUrl =
        artifact.storagePath && isBinaryKind(artifact.kind)
            ? await signedUrlFor(supabase, artifact.storagePath)
            : null;

    const size = formatBytes(artifact.sizeBytes);
    const reading = readingTime(artifact.contentMd);

    return (
        <div className="space-y-6">
            <Link
                href={
                    department
                        ? `/dashboard/delphi/outputs?department=${department.id}`
                        : '/dashboard/delphi/outputs'
                }
                className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-white"
            >
                <ArrowLeft className="h-4 w-4" /> Outputs
            </Link>

            <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 space-y-2">
                    <div className="flex items-center gap-2">
                        <Badge variant="outline" className={`${meta.tone} gap-1 text-[10px]`}>
                            <Icon className="h-2.5 w-2.5" />
                            {meta.label}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                            {format(new Date(artifact.createdAt), 'd MMM yyyy, HH:mm')}
                        </span>
                    </div>
                    <h1 className="text-2xl font-bold tracking-tight">{artifact.title}</h1>
                    <p className="text-sm text-muted-foreground">
                        {agent ? (
                            <>
                                Written by <span className="text-zinc-200">{agent.title}</span>, {agent.role}
                                {task && <> — step {task.seq}, &ldquo;{task.title}&rdquo;</>}
                            </>
                        ) : (
                            'No agent attributed to this artifact.'
                        )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                        {department && (
                            <Link
                                href={`/dashboard/delphi/departments/${department.id}`}
                                className="hover:text-zinc-200"
                            >
                                {department.title}
                            </Link>
                        )}
                        {project && project.title !== department?.title && <> · {project.title}</>}
                        {(reading || size) && <> · {reading ?? size}</>}
                    </p>
                </div>

                <Button asChild variant="outline" size="sm" className="shrink-0">
                    <a href={`/api/delphi/outputs/${artifact.id}/download`}>
                        <Download className="h-4 w-4 mr-2" /> Download
                    </a>
                </Button>
            </div>

            <Card className="bg-black/40 border-white/10">
                <CardContent className="pt-6">
                    {artifact.contentMd ? (
                        <ArtifactMarkdown content={artifact.contentMd} />
                    ) : mediaUrl ? (
                        <MediaPreview
                            kind={artifact.kind}
                            url={mediaUrl}
                            mimeType={artifact.mimeType}
                            title={artifact.title}
                        />
                    ) : (
                        <div className="py-8 text-center space-y-2">
                            <FileWarning className="h-8 w-8 mx-auto text-muted-foreground/40" />
                            <p className="text-sm text-muted-foreground">
                                {artifact.storagePath
                                    ? 'This file is stored but could not be loaded. The storage bucket may not exist yet.'
                                    : 'This artifact has no content.'}
                            </p>
                        </div>
                    )}
                </CardContent>
            </Card>

            <OutputReview
                state={{
                    artifactId: artifact.id,
                    title: artifact.title,
                    status: review.status,
                    note: review.note,
                    reviewedAt: review.reviewedAt,
                    revision: review.revision,
                    // Nothing to send back to when no task produced it.
                    canSendBack: Boolean(artifact.taskId),
                    agentName: agent?.title ?? null,
                    deletedAt: record.deletedAt,
                }}
            />

            {events && events.length > 0 && (
                <Card className="bg-black/40 border-white/10">
                    <CardHeader className="pb-3">
                        <CardTitle className="text-base flex items-center gap-2">
                            <Footprints className="h-4 w-4" /> How this was made
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-1 font-mono text-xs">
                            {events.map((e) => (
                                <ActivityLine key={e.id} event={e as unknown as ActivityEvent} />
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
