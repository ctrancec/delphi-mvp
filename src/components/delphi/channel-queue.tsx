'use client';

/**
 * A channel's topics and schedule: what the team proposed, what is queued
 * for which slot, what is being made, what is made and what went live —
 * with this month's money beside it, and how an episode is made below.
 */

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CalendarClock, Check, ChevronDown, Loader2, Play, Plus, Sparkles, TriangleAlert, X } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { addIdeaAction, approveIdeaAction, makeNowAction, rejectIdeaAction, suggestIdeasAction } from '@/lib/delphi/episode-actions';
import { MarkPublished } from './mark-published';
import { cn } from '@/lib/utils';

import { CEO_NAME } from '@/lib/pixel/cast/names';

export interface QueueIdea {
    id: string;
    title: string;
    angle: string | null;
    status: 'proposed' | 'approved' | 'rejected' | 'scheduled' | 'made' | 'published';
    source: 'team' | 'cho' | 'chat';
    /** For one in production: the slot it was started for, in words. */
    slot: string | null;
    artifactId: string | null;
    publishedUrl: string | null;
}

export interface ChannelQueueProps {
    accountId: string;
    canEdit: boolean;
    topics: 'cho' | 'team';
    paused: boolean;
    /** "Mon, Wed, Fri at 09:00 (America/Toronto)", or "On demand". */
    schedule: string;
    /** The next free slots, in words, in order: the queue takes them one each. */
    nextSlots: string[];
    money: { spent: number; held: number; cap: number; own: boolean } | null;
    hasPlaybook: boolean;
    playbook: { seq: number; title: string; agent: string; deliverable: string }[];
    ideas: QueueIdea[];
}

const usd = (n: number) => `$${n.toFixed(2)}`;

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
    if (!count) return null;
    return (
        <div className="space-y-2">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {title} <span className="text-muted-foreground/60">{count}</span>
            </p>
            <div className="space-y-2">{children}</div>
        </div>
    );
}

function Row({ idea, aside, children }: { idea: QueueIdea; aside?: React.ReactNode; children?: React.ReactNode }) {
    return (
        <div className="space-y-2 rounded-lg border border-white/10 bg-black/30 p-2.5">
            <div className="flex flex-wrap items-start gap-2">
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-zinc-100 [overflow-wrap:anywhere]">{idea.title}</p>
                    {idea.angle && <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{idea.angle}</p>}
                </div>
                {aside}
            </div>
            {children}
        </div>
    );
}

export function ChannelQueue(p: ChannelQueueProps) {
    const router = useRouter();
    const [pending, start] = useTransition();
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [note, setNote] = useState<string | null>(null);
    const [title, setTitle] = useState('');
    const [angle, setAngle] = useState('');
    const [showSteps, setShowSteps] = useState(false);

    const run = (key: string, fn: () => Promise<{ ok: boolean; error?: string; count?: number }>, done?: (r: { count?: number }) => void) => {
        setError(null);
        setNote(null);
        setBusy(key);
        start(async () => {
            const res = await fn();
            setBusy(null);
            if (!res.ok) setError(res.error ?? 'That did not go through.');
            else {
                done?.(res);
                router.refresh();
            }
        });
    };

    const by = (s: QueueIdea['status']) => p.ideas.filter((i) => i.status === s);
    const proposed = by('proposed');
    const queued = by('approved');
    const making = by('scheduled');
    const made = by('made');
    const published = by('published').slice(-5).reverse();
    const spin = (key: string) => (busy === key && pending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null);

    return (
        <Card className="border-white/10 bg-black/40">
            <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                    <CalendarClock className="h-4 w-4" /> Topics and schedule
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                    {p.schedule}
                    {' · '}
                    {p.topics === 'cho' ? 'you approve each topic' : 'the team picks topics'}
                    {p.money && (
                        <>
                            {' · '}
                            this month: {usd(p.money.spent)} spent
                            {p.money.held > 0 && <> and {usd(p.money.held)} held for work in progress</>}, of {usd(p.money.cap)}{' '}
                            {p.money.own ? '(its own cap)' : "(its share of the studio's budget)"}
                        </>
                    )}
                </p>
            </CardHeader>
            <CardContent className="space-y-4">
                {!p.hasPlaybook && (
                    <p className="rounded-md border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-xs text-amber-200">
                        Episodes start once a team is approved for this studio. Topics can be queued now.
                    </p>
                )}
                {p.paused && (
                    <p className="rounded-md border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-xs text-amber-200">
                        This channel is paused: nothing new starts until it is resumed.
                    </p>
                )}

                <Section title="Proposed — waiting for you" count={proposed.length}>
                    {proposed.map((i) => (
                        <Row
                            key={i.id}
                            idea={i}
                            aside={
                                p.canEdit && (
                                    <div className="flex shrink-0 gap-1.5">
                                        <Button size="sm" onClick={() => run(`a-${i.id}`, () => approveIdeaAction(i.id))} disabled={pending}>
                                            {spin(`a-${i.id}`) ?? <Check className="mr-1.5 h-3.5 w-3.5" />} Approve
                                        </Button>
                                        <Button size="sm" variant="outline" className="border-white/10" onClick={() => run(`r-${i.id}`, () => rejectIdeaAction(i.id))} disabled={pending} aria-label={`Reject ${i.title}`}>
                                            {spin(`r-${i.id}`) ?? <X className="h-3.5 w-3.5" />}
                                        </Button>
                                    </div>
                                )
                            }
                        />
                    ))}
                </Section>

                <Section title="Queue" count={queued.length}>
                    {queued.map((i, n) => (
                        <Row
                            key={i.id}
                            idea={i}
                            aside={<span className="shrink-0 text-[11px] text-sky-300">{p.nextSlots[n] ? `next: ${p.nextSlots[n]}` : p.schedule === 'On demand' ? 'on request' : 'after the slots shown'}</span>}
                        >
                            {p.canEdit && (
                                <div className="flex flex-wrap gap-1.5">
                                    <Button size="sm" variant="outline" className="border-white/10" onClick={() => run(`m-${i.id}`, () => makeNowAction(i.id))} disabled={pending || !p.hasPlaybook || p.paused}>
                                        {spin(`m-${i.id}`) ?? <Play className="mr-1.5 h-3.5 w-3.5" />} Make it now
                                    </Button>
                                    <Button size="sm" variant="outline" className="border-white/10" onClick={() => run(`d-${i.id}`, () => rejectIdeaAction(i.id))} disabled={pending}>
                                        {spin(`d-${i.id}`)} Drop
                                    </Button>
                                </div>
                            )}
                        </Row>
                    ))}
                </Section>

                <Section title="In production" count={making.length}>
                    {making.map((i) => (
                        <Row key={i.id} idea={i} aside={<span className="shrink-0 text-[11px] text-emerald-300">{i.slot ? `for ${i.slot}` : 'started'}</span>} />
                    ))}
                </Section>

                <Section title="Made — publish by hand, then mark it" count={made.length}>
                    {made.map((i) => (
                        <Row
                            key={i.id}
                            idea={i}
                            aside={
                                i.artifactId && (
                                    <Link href={`/dashboard/delphi/outputs/${i.artifactId}`} className="shrink-0 text-xs text-sky-400 hover:underline">
                                        Open
                                    </Link>
                                )
                            }
                        >
                            {i.artifactId && <MarkPublished artifactId={i.artifactId} publishedUrl={i.publishedUrl} canEdit={p.canEdit} />}
                        </Row>
                    ))}
                </Section>

                <Section title="Published lately" count={published.length}>
                    {published.map((i) => (
                        <Row key={i.id} idea={i}>
                            {i.artifactId && <MarkPublished artifactId={i.artifactId} publishedUrl={i.publishedUrl} canEdit={false} compact />}
                        </Row>
                    ))}
                </Section>

                {p.ideas.filter((i) => i.status !== 'rejected').length === 0 && (
                    <p className="text-sm text-muted-foreground">
                        No topics yet. {p.canEdit ? `Add one, or ask the team to suggest some.` : ''} {CEO_NAME} can also add one from the room.
                    </p>
                )}

                {p.canEdit && (
                    <div className="space-y-2 border-t border-white/10 pt-3">
                        <div className="flex flex-col gap-2 inner:flex-row">
                            <input
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                placeholder="A topic of your own — a working title"
                                maxLength={160}
                                className="h-8 min-w-0 rounded-md border border-white/10 bg-white/5 px-2.5 text-sm text-zinc-100 placeholder:text-muted-foreground inner:flex-1"
                            />
                            <input
                                value={angle}
                                onChange={(e) => setAngle(e.target.value)}
                                placeholder="The angle (optional)"
                                maxLength={400}
                                className="h-8 min-w-0 rounded-md border border-white/10 bg-white/5 px-2.5 text-sm text-zinc-100 placeholder:text-muted-foreground inner:flex-1"
                            />
                            <Button size="sm" variant="outline" className="border-white/10" onClick={() => run('add', () => addIdeaAction(p.accountId, title, angle), () => { setTitle(''); setAngle(''); })} disabled={pending || title.trim().length < 3}>
                                {spin('add') ?? <Plus className="mr-1.5 h-3.5 w-3.5" />} Add to the queue
                            </Button>
                        </div>
                        <Button
                            size="sm"
                            variant="outline"
                            className="border-white/10"
                            onClick={() => run('suggest', () => suggestIdeasAction(p.accountId), (r) => setNote(r.count ? `${r.count} new topic${r.count === 1 ? '' : 's'} ${p.topics === 'team' ? 'picked' : 'proposed'}.` : 'Nothing new came back — the team only proposes what this channel has not had.'))}
                            disabled={pending}
                        >
                            {spin('suggest') ?? <Sparkles className="mr-1.5 h-3.5 w-3.5" />} Suggest topics
                        </Button>
                    </div>
                )}

                {note && <p className="text-xs text-emerald-300">{note}</p>}
                {error && (
                    <p className="flex items-start gap-1.5 text-xs text-red-400">
                        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
                    </p>
                )}

                {p.playbook.length > 0 && (
                    <div className="rounded-lg border border-white/10 bg-black/20">
                        <button type="button" onClick={() => setShowSteps((v) => !v)} aria-expanded={showSteps} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-zinc-300">
                            How an episode is made <span className="text-muted-foreground">{p.playbook.length} steps</span>
                            <ChevronDown className={cn('ml-auto h-3.5 w-3.5 transition-transform', showSteps && 'rotate-180')} />
                        </button>
                        {showSteps && (
                            <ol className="space-y-1 border-t border-white/10 px-3 py-2.5 text-xs text-muted-foreground">
                                {p.playbook.map((s, n) => (
                                    <li key={s.seq} className="[overflow-wrap:anywhere]">
                                        {n + 1}. <span className="text-zinc-200">{s.title}</span> — {s.agent}
                                        {s.deliverable !== 'text' && <span className="text-rose-300/80"> · renders a {s.deliverable}</span>}
                                    </li>
                                ))}
                            </ol>
                        )}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
