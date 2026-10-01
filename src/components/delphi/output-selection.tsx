'use client';

/**
 * Choosing several deliverables, and acting on them together.
 *
 * The cards stay server-rendered — this layer adds only a checkbox per item,
 * the selection, and a bar of actions — so selecting costs the page nothing
 * but ids, not every report's text.
 *
 * Once anything is selected, tapping a card selects it rather than opening
 * it: that is what makes picking ten quick. Clear the selection and cards
 * open again.
 *
 * Every action keeps the rules its single version has. Sending back needs the
 * reason, and goes once per step. Deleting moves things to the trash, with the
 * combined cost shown first. Destroying needs the count typed back.
 */

import { createContext, useContext, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Check, Loader2, RotateCcw, Trash2, TriangleAlert, Undo2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { bulkReviewOutputsAction } from '@/lib/delphi/cho-review';
import {
    bulkDeleteOutputsAction,
    bulkDeletionImpactAction,
    bulkPurgeOutputsAction,
    bulkRestoreOutputsAction,
} from '@/lib/delphi/trash';
import type { BulkResult, CombinedImpact } from '@/lib/delphi/bulk';

/** Mirrors MAX_BULK on the server; kept here so the bar can say so before a round trip. */
const MAX_AT_ONCE = 100;

interface Selection {
    selected: Set<string>;
    selecting: boolean;
    toggle: (id: string) => void;
}

const SelectionContext = createContext<Selection | null>(null);

function useSelection(): Selection {
    const s = useContext(SelectionContext);
    if (!s) throw new Error('SelectableItem must be inside SelectionProvider');
    return s;
}

/**
 * One card or row that can be selected.
 *
 * The checkbox sits beside the item rather than inside it: the library card
 * is a link, and a control inside a link is both invalid and a mis-tap
 * waiting to happen. `intercept` makes a tap anywhere on the item select it
 * while a selection is open — right for a card that is all link, wrong for a
 * trash row whose own buttons must keep working.
 */
export function SelectableItem({
    id,
    label,
    intercept = false,
    children,
}: {
    id: string;
    label: string;
    intercept?: boolean;
    children: React.ReactNode;
}) {
    const { selected, selecting, toggle } = useSelection();
    const isSelected = selected.has(id);

    return (
        <div
            className={cn(
                'relative h-full rounded-xl transition-shadow',
                isSelected && 'ring-2 ring-sky-400/70'
            )}
            onClickCapture={
                intercept && selecting
                    ? (e) => {
                          if ((e.target as HTMLElement).closest('[data-select-box]')) return;
                          e.preventDefault();
                          e.stopPropagation();
                          toggle(id);
                      }
                    : undefined
            }
        >
            {children}
            <label
                data-select-box
                className="absolute left-2.5 top-4 flex h-8 w-8 cursor-pointer items-center justify-center rounded-md hover:bg-white/5"
            >
                <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggle(id)}
                    aria-label={`Select ${label}`}
                    className="h-4 w-4 cursor-pointer accent-sky-400"
                />
            </label>
        </div>
    );
}

type Outcome = { tone: 'ok' | 'warn' | 'error'; text: string; skipped: BulkResult['skipped']; trashLink?: boolean };

/** What just happened, including everything that did not. */
function OutcomeNote({ outcome, onDismiss }: { outcome: Outcome; onDismiss: () => void }) {
    const shown = outcome.skipped.slice(0, 6);
    return (
        <div
            className={cn(
                'space-y-1.5 rounded-lg border p-3 text-xs',
                outcome.tone === 'ok' && 'border-emerald-400/30 bg-emerald-400/5 text-emerald-300',
                outcome.tone === 'warn' && 'border-amber-400/30 bg-amber-400/5 text-amber-300',
                outcome.tone === 'error' && 'border-red-400/30 bg-red-400/5 text-red-300'
            )}
        >
            <div className="flex items-start gap-2">
                <p className="flex-1">
                    {outcome.text}
                    {outcome.trashLink && (
                        <>
                            {' '}
                            <Link href="/dashboard/delphi/outputs?view=trash" className="underline">
                                Open the trash
                            </Link>
                        </>
                    )}
                </p>
                <button onClick={onDismiss} aria-label="Dismiss" className="opacity-70 hover:opacity-100">
                    <X className="h-3.5 w-3.5" />
                </button>
            </div>
            {shown.length > 0 && (
                <ul className="space-y-0.5 text-muted-foreground">
                    {shown.map((s) => (
                        <li key={s.id}>
                            <span className="text-zinc-300">{s.title}</span> — {s.reason}
                        </li>
                    ))}
                    {outcome.skipped.length > shown.length && (
                        <li>…and {outcome.skipped.length - shown.length} more.</li>
                    )}
                </ul>
            )}
        </div>
    );
}

/** "Accepted 4." — or "Accepted 3. 1 left as it was:" with the reasons beneath. */
function summarise(said: (k: number) => string, res: BulkResult, extra = ''): Outcome {
    if (!res.ok) return { tone: 'error', text: res.error ?? 'That did not work.', skipped: [] };
    const left = res.skipped.length;
    const done = res.done ? `${said(res.done)}${extra}` : 'None of them could be changed.';
    return {
        tone: left ? (res.done ? 'warn' : 'error') : 'ok',
        text: left ? `${done} ${left} left as ${left === 1 ? 'it was' : 'they were'}:` : done,
        skipped: res.skipped,
    };
}

/**
 * The selection, and the bar that acts on it.
 *
 * `library` offers accept, send back and delete; `trash` offers restore and
 * destroy. The bar floats at the bottom while anything is selected, so the
 * actions stay in reach however far down the grid the last tick was.
 */
export function SelectionProvider({
    ids,
    mode,
    children,
}: {
    ids: string[];
    mode: 'library' | 'trash';
    children: React.ReactNode;
}) {
    const router = useRouter();
    const [picked, setPicked] = useState<Set<string>>(() => new Set());
    const [panel, setPanel] = useState<null | 'send-back' | 'delete' | 'purge'>(null);
    const [note, setNote] = useState('');
    const [typed, setTyped] = useState('');
    const [impact, setImpact] = useState<CombinedImpact | null>(null);
    const [outcome, setOutcome] = useState<Outcome | null>(null);
    const [pending, startTransition] = useTransition();

    // Only what is still on screen: a filter, or a refresh after an action,
    // drops anything no longer shown.
    const visible = useMemo(() => new Set(ids), [ids]);
    const selected = useMemo(() => new Set([...picked].filter((id) => visible.has(id))), [picked, visible]);
    const chosen = [...selected];
    const n = chosen.length;
    const tooMany = n > MAX_AT_ONCE;
    const allSelected = n > 0 && n === ids.length;

    const toggle = (id: string) => {
        setPicked((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };
    const clear = () => {
        setPicked(new Set());
        setPanel(null);
        setNote('');
        setTyped('');
        setImpact(null);
    };

    function run(work: () => Promise<Outcome>) {
        setOutcome(null);
        startTransition(async () => {
            const o = await work();
            setOutcome(o);
            if (o.tone !== 'error' || o.skipped.length) {
                clear();
                router.refresh();
            }
        });
    }

    const accept = () =>
        run(async () => summarise((k) => `Accepted ${k}.`, await bulkReviewOutputsAction(chosen, 'approved')));

    const sendBack = () =>
        run(async () => {
            const res = await bulkReviewOutputsAction(chosen, 'declined', note);
            const handed = res.escalatedTo?.length
                ? ` ${res.escalatedTo.length === 1 ? 'One step was' : `${res.escalatedTo.length} steps were`} handed to a new agent after repeated refusals.`
                : '';
            return summarise((k) => `Sent back ${k} — each agent redoes its step with your reason.`, res, handed);
        });

    function openDelete() {
        setPanel('delete');
        setImpact(null);
        setOutcome(null);
        startTransition(async () => {
            const res = await bulkDeletionImpactAction(chosen);
            if (res.ok && res.data) setImpact(res.data);
            else {
                setPanel(null);
                setOutcome({ tone: 'error', text: res.error ?? 'Could not work out what this would affect.', skipped: [] });
            }
        });
    }

    const trash = () =>
        run(async () => {
            const o = summarise((k) => `Moved ${k} to the trash.`, await bulkDeleteOutputsAction(chosen));
            return { ...o, trashLink: o.tone !== 'error' };
        });

    const restore = () =>
        run(async () => summarise((k) => `Restored ${k} to the library.`, await bulkRestoreOutputsAction(chosen)));

    const purge = () =>
        run(async () => {
            const res = await bulkPurgeOutputsAction(chosen, typed);
            return res.ok
                ? { tone: 'ok', text: `Permanently deleted ${res.purged}.`, skipped: [] }
                : { tone: 'error', text: res.error ?? 'Could not delete them.', skipped: [] };
        });

    const plural = (k: number, one: string, many: string) => (k === 1 ? one : many);

    return (
        <SelectionContext.Provider value={{ selected, selecting: n > 0, toggle }}>
            <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {ids.length > 0 && (
                        <button
                            onClick={() => (allSelected ? clear() : setPicked(new Set(ids)))}
                            className="rounded-md border border-white/10 px-2.5 py-1 hover:border-white/25 hover:text-zinc-200"
                        >
                            {allSelected ? 'Clear selection' : `Select all ${ids.length}`}
                        </button>
                    )}
                    {n === 0 && (
                        <span>
                            {mode === 'library'
                                ? 'Tick outputs to accept, send back or delete several at once.'
                                : 'Tick items to restore or delete several at once.'}
                        </span>
                    )}
                </div>

                {outcome && <OutcomeNote outcome={outcome} onDismiss={() => setOutcome(null)} />}

                {children}

                {n > 0 && (
                    <div className="sticky bottom-4 z-30">
                        <div className="space-y-3 rounded-xl border border-white/15 bg-zinc-950/95 p-3 shadow-2xl backdrop-blur">
                            {panel === 'send-back' && (
                                <div className="space-y-2">
                                    <Label htmlFor="bulk-note" className="text-xs">
                                        What needs to change — every agent gets this reason with its step
                                    </Label>
                                    <Textarea
                                        id="bulk-note"
                                        value={note}
                                        onChange={(e) => setNote(e.target.value)}
                                        placeholder="e.g. Cite a source for every figure, and say plainly what you could not find."
                                        className="min-h-20 border-white/10 bg-white/5 text-sm"
                                    />
                                    <p className="text-[11px] text-muted-foreground">
                                        Each step is redone once, by its agent — one new run per step. A step
                                        sent back twice goes to a new agent, with your consent.
                                    </p>
                                    <div className="flex flex-wrap gap-2">
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            disabled={pending || note.trim().length < 10}
                                            onClick={sendBack}
                                            className="border-amber-400/30 text-amber-400 hover:bg-amber-400/10 hover:text-amber-300"
                                        >
                                            {pending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                                            Send back {n}
                                        </Button>
                                        <Button size="sm" variant="outline" disabled={pending} onClick={() => setPanel(null)} className="border-white/10">
                                            Cancel
                                        </Button>
                                    </div>
                                </div>
                            )}

                            {panel === 'delete' && (
                                <div className="space-y-2">
                                    <p className="text-sm font-medium text-red-400">
                                        Move {n} {plural(n, 'deliverable', 'deliverables')} to the trash
                                    </p>
                                    {!impact ? (
                                        <p className="flex items-center gap-2 text-xs text-muted-foreground">
                                            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Working out what this would affect…
                                        </p>
                                    ) : (
                                        <ul className="space-y-0.5 text-xs text-muted-foreground">
                                            <li>You can restore them from the trash; nothing is destroyed until you say so again.</li>
                                            {impact.dependants.length > 0 ? (
                                                <li className="text-amber-400">
                                                    Later steps were built on these —{' '}
                                                    {impact.dependants.map((d) => `step ${d.seq}`).join(', ')}. They keep what they
                                                    already produced; re-run one and it stops rather than working from nothing.
                                                </li>
                                            ) : (
                                                <li>Nothing downstream was built on these.</li>
                                            )}
                                            {impact.onlyVersions > 0 && (
                                                <li className="text-amber-400">
                                                    {impact.onlyVersions} {plural(impact.onlyVersions, 'is the only version of its step', 'are the only version of their step')} —
                                                    nothing is left behind {plural(impact.onlyVersions, 'it', 'them')}.
                                                </li>
                                            )}
                                            {impact.accepted > 0 && (
                                                <li>
                                                    {impact.accepted} of them you had accepted.
                                                </li>
                                            )}
                                        </ul>
                                    )}
                                    <div className="flex flex-wrap gap-2">
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            disabled={pending || !impact}
                                            onClick={trash}
                                            className="border-red-400/30 text-red-400 hover:bg-red-400/10 hover:text-red-300"
                                        >
                                            {pending && impact ? (
                                                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                                            ) : (
                                                <Trash2 className="mr-2 h-3.5 w-3.5" />
                                            )}
                                            Move {n} to trash
                                        </Button>
                                        <Button size="sm" variant="outline" disabled={pending && !!impact} onClick={() => setPanel(null)} className="border-white/10">
                                            Cancel
                                        </Button>
                                    </div>
                                </div>
                            )}

                            {panel === 'purge' && (
                                <div className="space-y-2">
                                    <p className="text-sm font-medium text-red-400">
                                        Destroy {n} {plural(n, 'deliverable', 'deliverables')}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                        Permanently, along with any stored files. There is no way back from this.
                                    </p>
                                    <div className="space-y-1.5">
                                        <Label htmlFor="bulk-count" className="text-xs">
                                            Type <span className="font-mono text-zinc-200">{n}</span> to confirm
                                        </Label>
                                        <Input
                                            id="bulk-count"
                                            value={typed}
                                            onChange={(e) => setTyped(e.target.value)}
                                            className="max-w-32 border-red-400/20 bg-white/5"
                                        />
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            disabled={pending || typed.trim() !== String(n)}
                                            onClick={purge}
                                            className="border-red-400/30 text-red-400 hover:bg-red-400/10 hover:text-red-300"
                                        >
                                            {pending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                                            Delete {n} for good
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            disabled={pending}
                                            onClick={() => {
                                                setPanel(null);
                                                setTyped('');
                                            }}
                                            className="border-white/10"
                                        >
                                            Cancel
                                        </Button>
                                    </div>
                                </div>
                            )}

                            {tooMany && (
                                <p className="flex items-center gap-2 text-xs text-amber-400">
                                    <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
                                    At most {MAX_AT_ONCE} at a time — {n - MAX_AT_ONCE} too many selected.
                                </p>
                            )}

                            <div className="flex flex-wrap items-center gap-2">
                                <span className="mr-1 text-sm font-medium">{n} selected</span>
                                {mode === 'library' ? (
                                    <>
                                        <Button size="sm" disabled={pending || tooMany} onClick={accept}>
                                            {pending && !panel ? (
                                                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                                            ) : (
                                                <Check className="mr-2 h-3.5 w-3.5" />
                                            )}
                                            Accept
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            disabled={pending || tooMany}
                                            onClick={() => setPanel(panel === 'send-back' ? null : 'send-back')}
                                            className="border-amber-400/30 text-amber-400 hover:bg-amber-400/10 hover:text-amber-300"
                                        >
                                            <RotateCcw className="mr-2 h-3.5 w-3.5" />
                                            Send back
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            disabled={pending || tooMany}
                                            onClick={openDelete}
                                            className="text-muted-foreground hover:bg-red-400/10 hover:text-red-400"
                                        >
                                            <Trash2 className="mr-2 h-3.5 w-3.5" />
                                            Delete
                                        </Button>
                                    </>
                                ) : (
                                    <>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            disabled={pending || tooMany}
                                            onClick={restore}
                                            className="border-emerald-400/30 text-emerald-400 hover:bg-emerald-400/10 hover:text-emerald-300"
                                        >
                                            {pending && !panel ? (
                                                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                                            ) : (
                                                <Undo2 className="mr-2 h-3.5 w-3.5" />
                                            )}
                                            Restore
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            disabled={pending || tooMany}
                                            onClick={() => setPanel(panel === 'purge' ? null : 'purge')}
                                            className="text-muted-foreground hover:bg-red-400/10 hover:text-red-400"
                                        >
                                            Delete for good
                                        </Button>
                                    </>
                                )}
                                <Button size="sm" variant="ghost" disabled={pending} onClick={clear} className="ml-auto text-muted-foreground">
                                    <X className="mr-1.5 h-3.5 w-3.5" />
                                    Clear
                                </Button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </SelectionContext.Provider>
    );
}
