'use client';

/**
 * A room: the conversation inside a department, or inside one of its
 * channels.
 *
 * Diablo answers unless someone on the team is @named. Work made for this
 * room arrives in it with its video or pictures, and Accept and Send back
 * beside them. When Diablo proposes a change it arrives as a card that does
 * nothing until the CHO taps Confirm, and the card says what confirming
 * does from what it would do, not from what it is called.
 *
 * New messages arrive live, and on a phone the room folds into a bar.
 */

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
    ArrowUp,
    Check,
    ChevronDown,
    Loader2,
    MessagesSquare,
    Pencil,
    Plus,
    ScrollText,
    Trash2,
    TriangleAlert,
    Undo2,
    X,
} from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { AgentSprite, SlimeSprite } from '@/components/pixel/agent-sprite';
import { createClient } from '@/lib/supabase/client';
import {
    addDecisionAction,
    confirmCardAction,
    deleteDecisionAction,
    dismissCardAction,
    sendRoomMessageAction,
    updateDecisionAction,
} from '@/lib/delphi/room-actions';
import { reviewOutputAction } from '@/lib/delphi/cho-review';
import { CARD_STATUS_WORDS, describeCard, mentioned, type RoomMessage } from '@/lib/delphi/room-cards';
import type { Decision, WorkPreview } from '@/lib/delphi/rooms';
import { cn } from '@/lib/utils';
import { CEO_NAME } from '@/lib/pixel/cast/names';

export interface RoomMember {
    name: string;
    title: string;
    slug: string;
    avatarSeed: string | null;
}

export interface RoomPanelProps {
    roomId: string;
    title: string;
    /** What this room is for, in a line. */
    blurb: string;
    messages: RoomMessage[];
    work: Record<string, WorkPreview>;
    team: RoomMember[];
    decisions: Decision[];
    /** The owner and reviewers post; a viewer reads. */
    canPost: boolean;
    /** Only the owner confirms cards, rules on work and keeps decisions. */
    isOwner: boolean;
    meId: string;
    timezone: string;
    /** "this channel" or "this department". */
    scopeWord: string;
}

/** A time, in the reader's own clock; the server's guess is replaced on arrival. */
function When({ iso }: { iso: string }) {
    const d = new Date(iso);
    const today = new Date().toDateString() === d.toDateString();
    const text = today
        ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : d.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    return (
        <time dateTime={iso} suppressHydrationWarning className="text-[10px] text-muted-foreground/70">
            {text}
        </time>
    );
}

function Avatar({ m }: { m: RoomMessage }) {
    if (m.authorUserId) {
        if (m.byOwner) return <SlimeSprite scale={2} name={m.authorName} />;
        return (
            <span className="flex h-7 w-7 items-center justify-center rounded-full border border-white/15 bg-white/5 text-[11px] font-medium text-zinc-300" aria-hidden>
                {m.authorName.slice(0, 1).toUpperCase()}
            </span>
        );
    }
    return <AgentSprite agent={{ slug: m.authorSlug ?? m.authorName, name: m.authorName, avatarSeed: m.avatarSeed }} crop="head" scale={2} label={m.authorName} />;
}

const VERDICT: Record<WorkPreview['reviewStatus'], { label: string; tone: string }> = {
    pending: { label: 'Waiting on you', tone: 'border-amber-400/30 text-amber-300' },
    approved: { label: 'Accepted', tone: 'border-emerald-400/30 text-emerald-300' },
    declined: { label: 'Sent back', tone: 'border-amber-400/30 text-amber-300' },
    superseded: { label: 'Replaced by a newer version', tone: 'border-white/10 text-muted-foreground' },
};

function WorkTile({ id, preview, isOwner }: { id: string; preview: WorkPreview | undefined; isOwner: boolean }) {
    const router = useRouter();
    const [pending, start] = useTransition();
    const [sending, setSending] = useState(false);
    const [note, setNote] = useState('');
    const [error, setError] = useState<string | null>(null);

    if (!preview) {
        return <p className="rounded-md border border-white/10 bg-black/20 px-3 py-2 text-xs text-muted-foreground">This piece is no longer in this room.</p>;
    }

    const verdict = preview.trashed
        ? { label: 'In the trash', tone: 'border-white/10 text-muted-foreground' }
        : preview.reviewStatus === 'pending' && !isOwner
          ? { label: 'Waiting on the CHO', tone: VERDICT.pending.tone }
          : VERDICT[preview.reviewStatus];
    const canRule = isOwner && !preview.trashed && preview.reviewStatus === 'pending';

    const rule = (decision: 'approved' | 'declined') => {
        setError(null);
        start(async () => {
            const res = await reviewOutputAction(id, decision, decision === 'declined' ? note : undefined);
            if (!res.ok) setError(res.error ?? 'That did not go through.');
            else {
                setSending(false);
                setNote('');
                router.refresh();
            }
        });
    };

    return (
        <div className="flex flex-col gap-2.5 rounded-lg border border-white/10 bg-black/30 p-2.5 inner:flex-row inner:items-start">
            {/* The piece beside its controls on a wide screen, above them on a phone. */}
            {preview.video ? (
                // Sized to the piece's own shape, so a vertical short is not a sliver in a wide black box.
                <video controls preload="none" playsInline poster={preview.picture ?? undefined} src={preview.video} className="block h-auto max-h-80 w-auto min-w-48 max-w-full shrink-0 rounded-md bg-black inner:max-h-96 inner:max-w-[60%]" />
            ) : preview.picture ? (
                // Not next/image: a short-lived signed URL on the Supabase host.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview.picture} alt="" loading="lazy" className="block h-auto max-h-80 w-auto max-w-full shrink-0 rounded-md bg-black inner:max-h-96 inner:max-w-[60%]" />
            ) : null}
            <div className="min-w-0 flex-1 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/dashboard/delphi/outputs/${id}`} className="min-w-0 flex-1 text-sm font-medium text-zinc-200 [overflow-wrap:anywhere] hover:underline">
                        {preview.title}
                    </Link>
                    <span className={cn('rounded border px-1.5 py-0.5 text-[10px]', verdict.tone)}>{verdict.label}</span>
                </div>
                {canRule && !sending && (
                    <div className="flex flex-wrap gap-2">
                        <Button size="sm" onClick={() => rule('approved')} disabled={pending}>
                            {pending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />} Accept
                        </Button>
                        <Button size="sm" variant="outline" className="border-white/10" onClick={() => setSending(true)} disabled={pending}>
                            <Undo2 className="mr-1.5 h-3.5 w-3.5" /> Send back
                        </Button>
                    </div>
                )}
                {canRule && sending && (
                    <div className="space-y-2">
                        <Textarea
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            rows={2}
                            placeholder="What must change? The agent works from this."
                            className="min-h-0 resize-none border-white/10 bg-white/5 text-sm"
                            autoFocus
                        />
                        <div className="flex flex-wrap gap-2">
                            <Button size="sm" onClick={() => rule('declined')} disabled={pending || note.trim().length < 10}>
                                {pending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Send it back
                            </Button>
                            <Button size="sm" variant="outline" className="border-white/10" onClick={() => setSending(false)} disabled={pending}>
                                Cancel
                            </Button>
                        </div>
                    </div>
                )}
                {error && (
                    <p className="flex items-start gap-1.5 text-xs text-red-400">
                        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
                    </p>
                )}
            </div>
        </div>
    );
}

const CARD_TONE: Record<string, string> = {
    pending: 'border-amber-400/40 bg-amber-400/5',
    done: 'border-emerald-400/30 bg-emerald-400/5',
    dismissed: 'border-white/10 bg-black/20 opacity-70',
    failed: 'border-red-400/30 bg-red-400/5',
};

function CardView({ m, work, isOwner, timezone }: { m: RoomMessage; work: Record<string, WorkPreview>; isOwner: boolean; timezone: string }) {
    const router = useRouter();
    const [pending, start] = useTransition();
    const [error, setError] = useState<string | null>(null);
    const card = m.card!;
    const artifactId = typeof card.args.artifactId === 'string' ? card.args.artifactId : null;
    const { what, detail } = describeCard(card, { workTitle: artifactId ? work[artifactId]?.title ?? null : null, timezone });

    const act = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
        setError(null);
        start(async () => {
            const res = await fn();
            if (!res.ok) setError(res.error ?? 'That did not go through.');
            router.refresh();
        });
    };

    return (
        <div className={cn('space-y-2 rounded-lg border p-3', CARD_TONE[card.status])}>
            <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Proposed by {CEO_NAME}</span>
                <span className="text-[10px] text-muted-foreground">
                    {card.status === 'pending' && !isOwner ? 'Waiting on the CHO' : CARD_STATUS_WORDS[card.status]}
                </span>
            </div>
            <p className="text-sm font-medium text-zinc-100 [overflow-wrap:anywhere]">{what}</p>
            {detail && <p className="whitespace-pre-wrap text-sm text-zinc-300 [overflow-wrap:anywhere]">{detail}</p>}
            {card.result && card.status !== 'pending' && (
                <p className={cn('text-xs', card.status === 'failed' ? 'text-red-400' : 'text-emerald-300')}>{card.result}</p>
            )}
            {card.status === 'pending' && isOwner && (
                <div className="flex flex-wrap gap-2 pt-1">
                    <Button size="sm" onClick={() => act(() => confirmCardAction(m.id))} disabled={pending}>
                        {pending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />} Confirm
                    </Button>
                    <Button size="sm" variant="outline" className="border-white/10" onClick={() => act(() => dismissCardAction(m.id))} disabled={pending}>
                        <X className="mr-1.5 h-3.5 w-3.5" /> Dismiss
                    </Button>
                </div>
            )}
            {error && (
                <p className="flex items-start gap-1.5 text-xs text-red-400">
                    <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
                </p>
            )}
        </div>
    );
}

function Decisions({ roomId, decisions, isOwner, scopeWord }: { roomId: string; decisions: Decision[]; isOwner: boolean; scopeWord: string }) {
    const router = useRouter();
    const [open, setOpen] = useState(false);
    const [pending, start] = useTransition();
    const [error, setError] = useState<string | null>(null);
    const [adding, setAdding] = useState('');
    const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
    const [confirming, setConfirming] = useState<string | null>(null);

    const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) => {
        setError(null);
        start(async () => {
            const res = await fn();
            if (!res.ok) setError(res.error ?? 'That did not go through.');
            else {
                after?.();
                router.refresh();
            }
        });
    };

    return (
        <div className="rounded-lg border border-white/10 bg-black/20">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                aria-expanded={open}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-zinc-300"
            >
                <ScrollText className="h-3.5 w-3.5 shrink-0" />
                <span className="font-medium">Decisions</span>
                <span className="text-muted-foreground">{decisions.length || 'none yet'}</span>
                <ChevronDown className={cn('ml-auto h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
            </button>
            {open && (
                <div className="space-y-2 border-t border-white/10 px-3 py-2.5">
                    <p className="text-[11px] text-muted-foreground">
                        What has been settled for {scopeWord}. Every piece of work here follows these, and nothing outside {scopeWord} sees them.
                    </p>
                    {decisions.map((d) =>
                        editing?.id === d.id ? (
                            <div key={d.id} className="space-y-2">
                                <Textarea
                                    value={editing.text}
                                    onChange={(e) => setEditing({ id: d.id, text: e.target.value })}
                                    rows={2}
                                    className="min-h-0 resize-none border-white/10 bg-white/5 text-sm"
                                />
                                <div className="flex gap-2">
                                    <Button size="sm" onClick={() => run(() => updateDecisionAction(d.id, editing.text), () => setEditing(null))} disabled={pending || editing.text.trim().length < 5}>
                                        Save
                                    </Button>
                                    <Button size="sm" variant="outline" className="border-white/10" onClick={() => setEditing(null)} disabled={pending}>
                                        Cancel
                                    </Button>
                                </div>
                            </div>
                        ) : (
                            <div key={d.id} className="flex items-start gap-2 text-sm text-zinc-200">
                                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-zinc-400" />
                                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{d.text}</span>
                                {isOwner &&
                                    (confirming === d.id ? (
                                        <span className="flex shrink-0 items-center gap-1 text-[11px]">
                                            <button type="button" onClick={() => run(() => deleteDecisionAction(d.id), () => setConfirming(null))} disabled={pending} className="rounded px-1.5 py-0.5 text-red-400 hover:bg-red-400/10">
                                                Delete
                                            </button>
                                            <button type="button" onClick={() => setConfirming(null)} className="rounded px-1.5 py-0.5 text-muted-foreground hover:bg-white/5">
                                                Keep
                                            </button>
                                        </span>
                                    ) : (
                                        <span className="flex shrink-0 items-center">
                                            <button type="button" onClick={() => setEditing({ id: d.id, text: d.text })} aria-label="Edit this decision" className="rounded p-1 text-muted-foreground hover:bg-white/5 hover:text-white">
                                                <Pencil className="h-3 w-3" />
                                            </button>
                                            <button type="button" onClick={() => setConfirming(d.id)} aria-label="Delete this decision" className="rounded p-1 text-muted-foreground hover:bg-red-400/10 hover:text-red-400">
                                                <Trash2 className="h-3 w-3" />
                                            </button>
                                        </span>
                                    ))}
                            </div>
                        )
                    )}
                    {isOwner && (
                        <div className="flex gap-2 pt-1">
                            <input
                                value={adding}
                                onChange={(e) => setAdding(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && adding.trim().length >= 5) run(() => addDecisionAction(roomId, adding), () => setAdding(''));
                                }}
                                placeholder={`Add one for ${scopeWord}…`}
                                className="h-8 min-w-0 flex-1 rounded-md border border-white/10 bg-white/5 px-2.5 text-sm text-zinc-100 placeholder:text-muted-foreground"
                            />
                            <Button size="sm" variant="outline" className="border-white/10" onClick={() => run(() => addDecisionAction(roomId, adding), () => setAdding(''))} disabled={pending || adding.trim().length < 5}>
                                <Plus className="h-3.5 w-3.5" />
                                <span className="sr-only">Add</span>
                            </Button>
                        </div>
                    )}
                    {error && (
                        <p className="flex items-start gap-1.5 text-xs text-red-400">
                            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}

export function RoomPanel(props: RoomPanelProps) {
    const { roomId, title, blurb, messages, work, team, decisions, canPost, isOwner, meId, timezone, scopeWord } = props;
    const router = useRouter();
    const [draft, setDraft] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [pending, start] = useTransition();
    const [open, setOpen] = useState(false);
    // What this panel has posted and been handed back, until the page has it too.
    const [local, setLocal] = useState<RoomMessage[]>([]);
    // The message on its way, shown at once; `before` is what was here when it left.
    const [sending, setSending] = useState<{ text: string; before: Set<string>; at: string } | null>(null);
    const listRef = useRef<HTMLDivElement>(null);

    const shown = useMemo(() => {
        const ids = new Set(messages.map((m) => m.id));
        const out = [...messages, ...local.filter((m) => !ids.has(m.id))];
        if (sending) {
            // Once the stored copy has arrived, the stand-in goes.
            const arrived = out.some((m) => !sending.before.has(m.id) && m.authorUserId === meId && m.content === sending.text);
            if (!arrived) {
                out.push({
                    id: 'sending',
                    role: 'cho',
                    authorName: 'You',
                    authorSlug: null,
                    avatarSeed: null,
                    authorUserId: meId,
                    byOwner: isOwner,
                    content: sending.text,
                    card: null,
                    artifactIds: [],
                    createdAt: sending.at,
                });
            }
        }
        return out;
    }, [messages, local, sending, meId, isOwner]);

    // Keep the newest in view, inside the room rather than scrolling the page.
    useEffect(() => {
        const el = listRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [shown.length, pending, open]);

    // Live: anything said or posted here, by anyone, refreshes the room.
    useEffect(() => {
        const supabase = createClient();
        if (!supabase) return;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const nudge = () => {
            clearTimeout(timer);
            timer = setTimeout(() => router.refresh(), 400);
        };
        const channel = supabase
            .channel(`room:${roomId}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'delphi_messages', filter: `thread_id=eq.${roomId}` }, nudge)
            .subscribe();
        return () => {
            clearTimeout(timer);
            void supabase.removeChannel(channel);
        };
    }, [roomId, router]);

    const addressed = mentioned(sending?.text ?? draft, team);
    const answering = addressed >= 0 ? team[addressed].name : CEO_NAME;

    const send = () => {
        const text = draft.trim();
        if (!text || pending || !canPost) return;
        setError(null);
        setDraft('');
        setSending({ text, before: new Set(shown.map((m) => m.id)), at: new Date().toISOString() });
        start(async () => {
            const res = await sendRoomMessageAction(roomId, text);
            if (res.posted?.length) setLocal((l) => [...l, ...res.posted!]);
            setSending(null);
            if (!res.ok) {
                setError(res.error ?? `${CEO_NAME} did not answer.`);
                // Nothing stored: the words go back in the box rather than being lost.
                if (!res.posted?.length) setDraft(text);
            }
            router.refresh();
        });
    };

    /** Address the next message to one person, replacing whoever was named first. */
    const address = (name: string | null) => {
        const rest = draft.replace(/^@[\p{L}][\p{L}\p{N}_-]*\s*/u, '');
        setDraft(name ? `@${name} ${rest}` : rest);
    };

    const last = messages[messages.length - 1];

    return (
        <section className="rounded-xl border border-white/10 bg-black/40" aria-label={title}>
            {/* On a phone the room is a bar until it is opened. */}
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                aria-expanded={open}
                className="flex w-full items-center gap-2 px-4 py-3 text-left inner:hidden"
            >
                <MessagesSquare className="h-4 w-4 shrink-0 text-sky-300" />
                <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-zinc-100">{title}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                        {last ? `${last.authorName}: ${last.card ? describeCard(last.card).what : last.content}` : 'Nothing said yet'}
                    </span>
                </span>
                <ChevronDown className={cn('h-4 w-4 shrink-0 transition-transform', open && 'rotate-180')} />
            </button>

            <div className={cn(open ? 'block' : 'hidden', 'inner:block')}>
                <div className="hidden space-y-1 px-4 pt-4 inner:block">
                    <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
                        <MessagesSquare className="h-4 w-4 text-sky-300" /> {title}
                    </h2>
                    <p className="text-xs text-muted-foreground">{blurb}</p>
                </div>

                <div className="space-y-3 px-4 pt-3">
                    <Decisions roomId={roomId} decisions={decisions} isOwner={isOwner} scopeWord={scopeWord} />
                </div>

                <div ref={listRef} className="max-h-[60vh] space-y-4 overflow-y-auto px-4 py-4 inner:max-h-[28rem]">
                    {shown.length === 0 && (
                        <p className="py-6 text-center text-xs text-muted-foreground">
                            Nothing said here yet. Ask {CEO_NAME} how {scopeWord} is doing, or @name someone on the team.
                        </p>
                    )}
                    {shown.map((m) => {
                        const mine = m.authorUserId === meId;
                        return (
                            <div key={m.id} className={cn('flex gap-2.5', m.id === 'sending' && 'opacity-60')}>
                                <div className="flex w-8 shrink-0 justify-center pt-0.5">
                                    <Avatar m={m} />
                                </div>
                                <div className="min-w-0 flex-1 space-y-1.5">
                                    <div className="flex flex-wrap items-baseline gap-x-2">
                                        <span className={cn('text-xs font-medium', mine ? 'text-sky-300' : 'text-zinc-200')}>
                                            {mine ? 'You' : m.authorName}
                                        </span>
                                        <When iso={m.createdAt} />
                                    </div>
                                    {m.card ? (
                                        <CardView m={m} work={work} isOwner={isOwner} timezone={timezone} />
                                    ) : (
                                        m.content && <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-200 [overflow-wrap:anywhere]">{m.content}</p>
                                    )}
                                    {m.artifactIds.map((id) => (
                                        <WorkTile key={id} id={id} preview={work[id]} isOwner={isOwner} />
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                    {pending && (
                        <p className="flex items-center gap-2 pl-10 text-xs text-muted-foreground">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" /> {answering} is thinking…
                        </p>
                    )}
                </div>

                <div className="space-y-2 border-t border-white/10 px-4 py-3">
                    {error && (
                        <p className="flex items-start gap-1.5 text-xs text-red-400">
                            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
                        </p>
                    )}
                    {canPost ? (
                        <>
                            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                                <span className="text-muted-foreground">Ask</span>
                                <button
                                    type="button"
                                    onClick={() => address(null)}
                                    className={cn(
                                        'rounded-full border px-2 py-0.5 transition-colors',
                                        addressed < 0 ? 'border-sky-400/50 text-sky-200' : 'border-white/10 text-muted-foreground hover:text-zinc-200'
                                    )}
                                >
                                    {CEO_NAME}
                                </button>
                                {team.map((t, i) => (
                                    <button
                                        key={t.slug}
                                        type="button"
                                        title={t.title}
                                        onClick={() => address(t.name)}
                                        className={cn(
                                            'rounded-full border px-2 py-0.5 transition-colors',
                                            addressed === i ? 'border-sky-400/50 text-sky-200' : 'border-white/10 text-muted-foreground hover:text-zinc-200'
                                        )}
                                    >
                                        @{t.name}
                                    </button>
                                ))}
                            </div>
                            <div className="flex gap-2">
                                <Textarea
                                    value={draft}
                                    onChange={(e) => setDraft(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && !e.shiftKey) {
                                            e.preventDefault();
                                            send();
                                        }
                                    }}
                                    placeholder={`Talk to ${CEO_NAME} about ${scopeWord}, or @name someone on the team…`}
                                    rows={2}
                                    maxLength={4000}
                                    className="min-h-0 resize-none border-white/10 bg-white/5 text-sm"
                                />
                                <button
                                    type="button"
                                    onClick={send}
                                    disabled={pending || !draft.trim()}
                                    aria-label="Send"
                                    className="flex h-10 w-10 shrink-0 items-center justify-center self-end rounded-lg bg-primary text-white transition-opacity disabled:opacity-40"
                                >
                                    {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
                                </button>
                            </div>
                            <p className="text-[11px] text-muted-foreground/70">
                                Talking is free. {CEO_NAME} proposes changes as cards, and nothing changes until{' '}
                                {isOwner ? 'you confirm' : 'the CHO confirms'}.
                            </p>
                        </>
                    ) : (
                        <p className="text-xs text-muted-foreground">You can read this room. The CHO and reviewers post in it.</p>
                    )}
                </div>
            </div>
        </section>
    );
}
