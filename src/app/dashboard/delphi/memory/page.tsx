/**
 * What Delphi remembers.
 *
 * Organizational memory is not a log — it is the set of things that change a
 * future decision. Every entry here is retrieved into staffing when a brief
 * touches it, so this page is also the place to check *why* Delphi made a call
 * it made.
 *
 * Search goes through the same full-text path the hiring prompt uses, so what
 * you see here is what Delphi would have recalled.
 */

import { Brain, Search } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { recallMemories, type Db } from '@/lib/delphi/db';
import { findWorkspace } from '@/lib/delphi/bootstrap';
import type { Memory } from '@/lib/delphi/types';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const KIND_STYLES: Record<string, string> = {
    lesson: 'text-sky-400 border-sky-400/30',
    preference: 'text-fuchsia-400 border-fuchsia-400/30',
    fact: 'text-emerald-400 border-emerald-400/30',
    outcome: 'text-amber-400 border-amber-400/30',
};

const KIND_HINTS: Record<string, string> = {
    lesson: 'Something to do differently next time',
    preference: 'Something you want, that Delphi should not have to be told twice',
    fact: 'A durable truth about a source or a domain',
    outcome: 'What a project actually produced',
};

async function loadAll(db: Db, workspaceId: string): Promise<Memory[]> {
    const { data } = await db
        .from('delphi_memories')
        .select('*')
        .eq('workspace_id', workspaceId)
        .order('importance', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(200);

    return (data ?? []).map((r) => ({
        id: r.id,
        workspaceId: r.workspace_id,
        scope: r.scope,
        departmentId: r.department_id ?? null,
        agentId: r.agent_id ?? null,
        projectId: r.project_id ?? null,
        kind: r.kind,
        title: r.title,
        body: r.body,
        tags: r.tags ?? [],
        importance: r.importance,
        createdAt: r.created_at,
    })) as Memory[];
}

export default async function MemoryPage({
    searchParams,
}: {
    searchParams: Promise<{ q?: string }>;
}) {
    const supabase = await createClient();
    if (!supabase) {
        return (
            <Card className="border-white/10 bg-black/40">
                <CardContent className="py-10 text-center text-muted-foreground">
                    Supabase is not configured.
                </CardContent>
            </Card>
        );
    }

    const { q } = await searchParams;
    const query = q?.trim() ?? '';
    const workspaceId = await findWorkspace(supabase);

    let memories: Memory[] = [];
    if (workspaceId) {
        memories = query
            ? await recallMemories(supabase, workspaceId, query, 50)
            : await loadAll(supabase, workspaceId);
    }

    return (
        <div className="max-w-3xl space-y-6">
            <div>
                <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
                    <Brain className="h-6 w-6" /> Memory
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    What Delphi carries between projects. Every entry is retrieved into staffing when a
                    brief touches it, so this is also where to look when you want to know why a decision
                    went the way it did.
                </p>
            </div>

            <form className="flex gap-2" action="/dashboard/delphi/memory">
                <Input
                    name="q"
                    defaultValue={query}
                    placeholder="Search the way Delphi does — try a phrase from a brief"
                    className="border-white/10 bg-white/5"
                />
                <Button type="submit" variant="outline" className="shrink-0 border-white/10">
                    <Search className="h-4 w-4" />
                </Button>
            </form>

            {memories.length === 0 ? (
                <Card className="border-dashed border-white/10 bg-black/40">
                    <CardContent className="space-y-3 py-14 text-center">
                        <Brain className="mx-auto h-10 w-10 text-muted-foreground/40" />
                        <h3 className="text-lg font-semibold">
                            {query ? 'Nothing matches that' : 'Nothing remembered yet'}
                        </h3>
                        <p className="mx-auto max-w-md text-sm text-muted-foreground">
                            {query
                                ? 'Delphi would recall nothing for this brief either — which is worth knowing.'
                                : 'Delphi writes a retrospective when a project finishes, keeping the few lessons that would change a future decision. Run a department and this fills itself.'}
                        </p>
                    </CardContent>
                </Card>
            ) : (
                <>
                    {query && (
                        <p className="text-xs text-muted-foreground">
                            {memories.length} recalled — ranked exactly as they would be during staffing.
                        </p>
                    )}
                    <div className="space-y-3">
                        {memories.map((m) => (
                            <Card key={m.id} className="border-white/10 bg-black/40">
                                <CardContent className="space-y-2 pt-5">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <Badge
                                            variant="outline"
                                            className={cn('text-[10px]', KIND_STYLES[m.kind])}
                                            title={KIND_HINTS[m.kind]}
                                        >
                                            {m.kind}
                                        </Badge>
                                        <span
                                            className="text-[11px] text-muted-foreground"
                                            title={`Importance ${m.importance} of 5`}
                                        >
                                            {'●'.repeat(m.importance)}
                                            <span className="text-muted-foreground/30">
                                                {'●'.repeat(5 - m.importance)}
                                            </span>
                                        </span>
                                        <span className="ml-auto text-[11px] text-muted-foreground/60">
                                            {formatDistanceToNow(new Date(m.createdAt), { addSuffix: true })}
                                        </span>
                                    </div>
                                    <h3 className="text-sm font-semibold leading-snug">{m.title}</h3>
                                    <p className="text-sm leading-relaxed text-muted-foreground">{m.body}</p>
                                    {m.tags.length > 0 && (
                                        <div className="flex flex-wrap gap-1 pt-1">
                                            {m.tags.map((t) => (
                                                <span
                                                    key={t}
                                                    className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                                                >
                                                    {t}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}
