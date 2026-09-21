'use client';

/**
 * Editing what an agent is told to do.
 *
 * The objective is the actual instruction — everything else about a step is
 * framing. So this is where a pipeline gets tuned: "also check the bond
 * market", "skip anything older than 24 hours", "cite the primary source, not
 * a summary of it".
 *
 * Saving alone changes the record. **Re-queueing is what changes the work** —
 * an edited objective the agent never sees again has changed nothing, so that
 * distinction is made explicit rather than guessed at.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Loader2, Pencil, Play, Trash2, TriangleAlert, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { deleteTaskAction, updateTaskAction } from '@/lib/delphi/manage';
import { cn } from '@/lib/utils';

export interface EditableTask {
    id: string;
    seq: number;
    title: string;
    objective: string;
    status: string;
    agentName: string | null;
}

const STATUS_TONE: Record<string, string> = {
    done: 'text-emerald-400 border-emerald-400/30',
    failed: 'text-red-400 border-red-400/30',
    running: 'text-sky-400 border-sky-400/30',
    awaiting_approval: 'text-amber-400 border-amber-400/30',
    skipped: 'text-muted-foreground border-white/15',
    pending: 'text-muted-foreground border-white/15',
};

export function TaskEditor({ task }: { task: EditableTask }) {
    const router = useRouter();
    const [editing, setEditing] = useState(false);
    const [title, setTitle] = useState(task.title);
    const [objective, setObjective] = useState(task.objective);
    const [error, setError] = useState<string | null>(null);
    const [pending, startTransition] = useTransition();
    const [confirmDelete, setConfirmDelete] = useState(false);

    const dirty = title !== task.title || objective !== task.objective;
    const running = task.status === 'running';

    function save(rerun: boolean) {
        setError(null);
        startTransition(async () => {
            const res = await updateTaskAction(task.id, { title, objective, rerun });
            if (res.ok) {
                setEditing(false);
                router.refresh();
            } else {
                setError(res.error ?? 'Could not save.');
            }
        });
    }

    function remove() {
        setError(null);
        startTransition(async () => {
            const res = await deleteTaskAction(task.id);
            if (res.ok) {
                setConfirmDelete(false);
                router.refresh();
            } else {
                setError(res.error ?? 'Could not remove it.');
            }
        });
    }

    return (
        <div className="space-y-2 rounded-lg border border-white/10 bg-black/40 p-3">
            <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">{task.seq}</span>
                <Badge variant="outline" className={cn('text-[10px]', STATUS_TONE[task.status])}>
                    {task.status.replace('_', ' ')}
                </Badge>
                {task.agentName && (
                    <span className="text-xs text-muted-foreground">{task.agentName}</span>
                )}

                {!editing && (
                    <div className="ml-auto flex items-center gap-1">
                        <button
                            type="button"
                            onClick={() => setEditing(true)}
                            disabled={running}
                            title={running ? 'Running right now — pause the system first' : 'Edit this step'}
                            className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-white/5 hover:text-white disabled:opacity-40"
                        >
                            <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                            type="button"
                            onClick={() => setConfirmDelete(true)}
                            disabled={running}
                            title={running ? 'Running right now' : 'Remove this step'}
                            className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-red-400/10 hover:text-red-400 disabled:opacity-40"
                        >
                            <Trash2 className="h-3.5 w-3.5" />
                        </button>
                    </div>
                )}
            </div>

            {editing ? (
                <div className="space-y-2">
                    <Input
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="What this step is called"
                        className="border-white/10 bg-white/5 text-sm"
                    />
                    <Textarea
                        value={objective}
                        onChange={(e) => setObjective(e.target.value)}
                        rows={4}
                        placeholder="What the agent is actually told to do"
                        className="border-white/10 bg-white/5 text-sm"
                    />
                    <p className="text-[11px] text-muted-foreground/60">
                        Saving records the change. Re-queueing is what makes the agent act on it.
                    </p>

                    {error && (
                        <p className="flex items-start gap-1.5 text-xs text-red-400">
                            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            {error}
                        </p>
                    )}

                    <div className="flex flex-wrap gap-2">
                        <Button size="sm" onClick={() => save(false)} disabled={pending || !dirty}>
                            {pending ? (
                                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                            ) : (
                                <Check className="mr-2 h-3.5 w-3.5" />
                            )}
                            Save
                        </Button>
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={() => save(true)}
                            disabled={pending}
                            className="border-emerald-400/30 text-emerald-400 hover:bg-emerald-400/10 hover:text-emerald-300"
                            title="Save and run this step again with the new objective"
                        >
                            <Play className="mr-2 h-3.5 w-3.5" />
                            Save &amp; re-run
                        </Button>
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                                setTitle(task.title);
                                setObjective(task.objective);
                                setEditing(false);
                                setError(null);
                            }}
                            disabled={pending}
                            className="border-white/10"
                        >
                            <X className="mr-2 h-3.5 w-3.5" />
                            Cancel
                        </Button>
                    </div>
                </div>
            ) : (
                <>
                    <p className="text-sm font-medium text-zinc-200">{task.title}</p>
                    <p className="text-xs leading-relaxed text-muted-foreground">{task.objective}</p>

                    {task.status !== 'pending' && task.status !== 'running' && (
                        <button
                            type="button"
                            onClick={() => save(true)}
                            disabled={pending}
                            className="text-xs text-sky-400 hover:underline disabled:opacity-50"
                        >
                            {pending ? 'Re-queueing…' : 'Run this step again'}
                        </button>
                    )}
                </>
            )}

            {confirmDelete && (
                <div className="space-y-2 rounded border border-red-400/20 bg-red-400/5 p-2.5">
                    <p className="text-xs text-red-400">
                        Remove step {task.seq}? Whatever depended on it will depend on what it depended
                        on, so the chain stays intact.
                    </p>
                    <div className="flex gap-2">
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={remove}
                            disabled={pending}
                            className="border-red-400/30 text-red-400 hover:bg-red-400/10 hover:text-red-300"
                        >
                            {pending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                            Remove
                        </Button>
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setConfirmDelete(false)}
                            disabled={pending}
                            className="border-white/10"
                        >
                            Keep it
                        </Button>
                    </div>
                </div>
            )}

            {error && !editing && (
                <p className="flex items-start gap-1.5 text-xs text-red-400">
                    <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {error}
                </p>
            )}
        </div>
    );
}
