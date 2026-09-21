/**
 * One deliverable in the Outputs library.
 *
 * The card leads with what the thing *is* and who made it, because "which of
 * my agents wrote this, and from what" is the question the library exists to
 * answer. Everything else is secondary.
 */

import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import {
    AudioLines,
    Database,
    FileText,
    File as FileIcon,
    Image as ImageIcon,
    MessageSquare,
    Newspaper,
    Video,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { ArtifactKind } from '@/lib/delphi/types';
import { formatBytes, readingTime, type OutputRecord } from '@/lib/delphi/outputs';

export const KIND_META: Record<ArtifactKind, { label: string; icon: typeof FileText; tone: string }> = {
    report: { label: 'Report', icon: FileText, tone: 'text-sky-400 border-sky-400/30' },
    brief: { label: 'Brief', icon: Newspaper, tone: 'text-emerald-400 border-emerald-400/30' },
    doc: { label: 'Document', icon: FileText, tone: 'text-zinc-300 border-white/20' },
    dataset: { label: 'Dataset', icon: Database, tone: 'text-violet-400 border-violet-400/30' },
    image: { label: 'Image', icon: ImageIcon, tone: 'text-amber-400 border-amber-400/30' },
    video: { label: 'Video', icon: Video, tone: 'text-rose-400 border-rose-400/30' },
    audio: { label: 'Audio', icon: AudioLines, tone: 'text-teal-400 border-teal-400/30' },
    social_draft: { label: 'Social draft', icon: MessageSquare, tone: 'text-fuchsia-400 border-fuchsia-400/30' },
    other: { label: 'Other', icon: FileIcon, tone: 'text-muted-foreground border-white/15' },
};

/** First line of prose, for a one-glance sense of what is inside. */
function excerpt(markdown: string | null): string | null {
    if (!markdown) return null;
    for (const raw of markdown.split('\n')) {
        const line = raw.trim();
        // Skip headings, bullets, rules and front-matter fences — none of them
        // tell you what the document says.
        if (!line || /^[#>\-*|`=_]/.test(line)) continue;
        return line.length > 180 ? `${line.slice(0, 177)}…` : line;
    }
    return null;
}

export function OutputCard({ record }: { record: OutputRecord }) {
    const { artifact, department, project, agent, task } = record;
    const meta = KIND_META[artifact.kind] ?? KIND_META.other;
    const Icon = meta.icon;
    const preview = excerpt(artifact.contentMd);
    const size = formatBytes(artifact.sizeBytes);
    const reading = readingTime(artifact.contentMd);

    return (
        <Link href={`/dashboard/delphi/outputs/${artifact.id}`} className="group">
            <Card className="bg-black/40 border-white/10 hover:border-white/25 transition-colors h-full">
                <CardContent className="pt-6 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 space-y-1">
                            <h3 className="font-semibold leading-tight text-sm group-hover:text-white transition-colors line-clamp-2">
                                {artifact.title}
                            </h3>
                            {department && (
                                <p className="text-xs text-muted-foreground truncate">
                                    {department.title}
                                    {project && project.title !== department.title && ` · ${project.title}`}
                                </p>
                            )}
                        </div>
                        <Badge variant="outline" className={`${meta.tone} gap-1 text-[10px] shrink-0`}>
                            <Icon className="h-2.5 w-2.5" />
                            {meta.label}
                        </Badge>
                    </div>

                    {preview && <p className="text-xs text-muted-foreground line-clamp-3">{preview}</p>}

                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground pt-1 border-t border-white/5">
                        {agent ? (
                            <span className="truncate" title={`${agent.title} — ${agent.role}`}>
                                {agent.title}
                                {task && <span className="text-muted-foreground/60"> · step {task.seq}</span>}
                            </span>
                        ) : (
                            <span className="text-muted-foreground/60">unattributed</span>
                        )}
                        <span className="ml-auto shrink-0 whitespace-nowrap">
                            {reading ?? size ?? ''}
                        </span>
                    </div>

                    <p className="text-[11px] text-muted-foreground/60">
                        {formatDistanceToNow(new Date(artifact.createdAt), { addSuffix: true })}
                    </p>
                </CardContent>
            </Card>
        </Link>
    );
}
