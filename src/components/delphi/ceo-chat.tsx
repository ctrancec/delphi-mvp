'use client';

/**
 * The conversation with Delphi.
 *
 * Delphi can act from here — stand up a department, change a budget, pause the
 * system — and anything it does is called out under the reply rather than left
 * implicit in prose. A CEO that quietly changes things while telling you about
 * them is not one you can supervise.
 */

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUp, Check, Loader2, Triangle, TriangleAlert } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { chatWithDelphiAction } from '@/lib/delphi/actions';
import { formatUsd } from '@/lib/llm/cost';
import { cn } from '@/lib/utils';

export interface ChatMessage {
    role: 'cho' | 'ceo';
    content: string;
    actions?: string[];
}

const SUGGESTIONS = [
    'How is everything going?',
    'What is waiting on me?',
    'Set up a stock market research department that briefs me before the open',
    'Pause everything',
];

export function CeoChat({ initial }: { initial: ChatMessage[] }) {
    const router = useRouter();
    const [messages, setMessages] = useState<ChatMessage[]>(initial);
    const [draft, setDraft] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [spend, setSpend] = useState(0);
    const [pending, startTransition] = useTransition();
    const endRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, [messages, pending]);

    function send(text: string) {
        const body = text.trim();
        if (!body || pending) return;

        setError(null);
        setDraft('');
        setMessages((m) => [...m, { role: 'cho', content: body }]);

        startTransition(async () => {
            const res = await chatWithDelphiAction(body);
            if (!res.ok || !res.data) {
                setError(res.error ?? 'Delphi did not answer.');
                return;
            }
            setMessages((m) => [
                ...m,
                { role: 'ceo', content: res.data!.reply, actions: res.data!.actions },
            ]);
            setSpend((s) => s + res.data!.costUsd);
            // Delphi may have changed something the rest of the page shows.
            if (res.data.actions.length > 0) router.refresh();
        });
    }

    return (
        <div className="flex h-[calc(100vh-11rem)] flex-col">
            <div className="flex-1 space-y-4 overflow-y-auto pb-4">
                {messages.length === 0 && (
                    <div className="space-y-4 py-8">
                        <div className="space-y-2 text-center">
                            <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-primary/20 text-primary">
                                <Triangle className="h-5 w-5 fill-current" />
                            </span>
                            <p className="text-sm text-muted-foreground">
                                Ask Delphi anything about the organisation, or tell it what you want set up.
                            </p>
                        </div>
                        <div className="mx-auto flex max-w-lg flex-wrap justify-center gap-1.5">
                            {SUGGESTIONS.map((s) => (
                                <button
                                    key={s}
                                    type="button"
                                    onClick={() => send(s)}
                                    className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-white/25 hover:text-zinc-200"
                                >
                                    {s}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {messages.map((m, i) => (
                    <div
                        key={i}
                        className={cn('flex', m.role === 'cho' ? 'justify-end' : 'justify-start')}
                    >
                        <div
                            className={cn(
                                'max-w-[85%] space-y-2 rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
                                m.role === 'cho'
                                    ? 'bg-primary/20 text-zinc-100'
                                    : 'border border-white/10 bg-black/40 text-zinc-200'
                            )}
                        >
                            <p className="whitespace-pre-wrap">{m.content}</p>

                            {m.actions && m.actions.length > 0 && (
                                <div className="space-y-1 border-t border-white/10 pt-2">
                                    {m.actions.map((a) => (
                                        <p key={a} className="flex items-center gap-1.5 text-xs text-emerald-400">
                                            <Check className="h-3 w-3 shrink-0" />
                                            {a}
                                        </p>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                ))}

                {pending && (
                    <div className="flex justify-start">
                        <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-black/40 px-4 py-2.5 text-sm text-muted-foreground">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            Delphi is looking…
                        </div>
                    </div>
                )}

                {error && (
                    <p className="flex items-center gap-2 text-xs text-red-400">
                        <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
                        {error}
                    </p>
                )}

                <div ref={endRef} />
            </div>

            <div className="space-y-2 border-t border-white/10 pt-3">
                <div className="flex gap-2">
                    <Textarea
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                send(draft);
                            }
                        }}
                        placeholder="Ask Delphi, or tell it what to set up…"
                        rows={2}
                        className="min-h-0 resize-none border-white/10 bg-white/5 text-sm"
                    />
                    <button
                        type="button"
                        onClick={() => send(draft)}
                        disabled={pending || !draft.trim()}
                        className="flex h-10 w-10 shrink-0 items-center justify-center self-end rounded-lg bg-primary text-white transition-opacity disabled:opacity-40"
                    >
                        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
                    </button>
                </div>
                <p className="flex flex-wrap items-center gap-x-3 text-[11px] text-muted-foreground/60">
                    <span>Delphi can create departments, set budgets and stop the system.</span>
                    <span className="text-amber-400/70">
                        It cannot approve anything — staffing plans and outward-facing actions are yours.
                    </span>
                    {spend > 0 && <span className="ml-auto">{formatUsd(spend)} this session</span>}
                </p>
            </div>
        </div>
    );
}
