'use client';

/**
 * The accounts a department produces for.
 *
 * One card per YouTube channel or social page, with the preferences that
 * shape everything made for it. Delphi reads these when it staffs the
 * department — one production chain per account — and the studio reads them
 * when it renders, so a change here changes the next piece, not this one.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Clapperboard, Loader2, Pencil, Plus, RefreshCw, Trash2, TriangleAlert, X } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
    accountLabel,
    ASPECTS,
    FORMAT_LABEL,
    FORMATS,
    formatsLine,
    isImageFormat,
    isVideoFormat,
    PLATFORM_LABEL,
    PLATFORMS,
    platformDefaults,
    VOICES,
    withDefaults,
    type AccountInput,
    type AccountPreferences,
    type Aspect,
    type Format,
    type MediaAccount,
    type Platform,
} from '@/lib/studio/accounts';
import { createAccountAction, deleteAccountAction, updateAccountAction } from '@/lib/studio/actions';
import { restaffDepartmentAction } from '@/lib/delphi/actions';

import { CEO_NAME } from '@/lib/pixel/cast/names';

interface Draft {
    platform: Platform;
    name: string;
    handle: string;
    url: string;
    status: 'active' | 'paused';
    p: AccountPreferences;
}

interface TestRender {
    kind: 'video' | 'image';
    url: string | null;
    seconds?: number;
    width: number;
    height: number;
    narrated: boolean;
    stock: boolean;
    renderMs: number;
}

function draftFrom(a: MediaAccount | null, platform: Platform = 'youtube'): Draft {
    return a
        ? { platform: a.platform, name: a.name, handle: a.handle ?? '', url: a.url ?? '', status: a.status, p: a.preferences }
        : { platform, name: '', handle: '', url: '', status: 'active', p: withDefaults(platformDefaults(platform)) };
}

function toInput(d: Draft): AccountInput {
    return { platform: d.platform, name: d.name, handle: d.handle, url: d.url, status: d.status, preferences: d.p };
}

const selectClass =
    'h-9 w-full rounded-md border border-white/10 bg-white/5 px-2 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-white/30 disabled:opacity-40';

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
    return (
        <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">{label}</Label>
            {children}
            {hint && <p className="text-[11px] text-muted-foreground/60">{hint}</p>}
        </div>
    );
}

function AccountForm({
    initial,
    onSave,
    onCancel,
    pending,
    error,
}: {
    initial: Draft;
    onSave: (d: Draft) => void;
    onCancel: () => void;
    pending: boolean;
    error: string | null;
}) {
    const [d, setD] = useState<Draft>(initial);
    const setP = (patch: Partial<AccountPreferences>) => setD({ ...d, p: { ...d.p, ...patch } });
    const list = (s: string) => s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
    const makesVideo = d.p.formats.some(isVideoFormat);
    const makesImages = d.p.formats.some(isImageFormat);

    const toggleFormat = (f: Format) => {
        const on = d.p.formats.includes(f);
        // Never none: an account that makes nothing has nothing to staff.
        if (on && d.p.formats.length === 1) return;
        setP({ formats: FORMATS.filter((x) => (x === f ? !on : d.p.formats.includes(x))) });
    };

    return (
        <div className="space-y-4 rounded-lg border border-white/10 bg-black/30 p-3">
            <div className="grid grid-cols-1 gap-3 inner:grid-cols-2">
                <Field label="Platform">
                    <select
                        className={selectClass}
                        value={d.platform}
                        onChange={(e) => {
                            const platform = e.target.value as Platform;
                            // A new platform brings its usual shape; what the owner typed stays.
                            setD({ ...d, platform, p: withDefaults(platformDefaults(platform), d.p) });
                        }}
                    >
                        {PLATFORMS.map((p) => (
                            <option key={p} value={p}>{PLATFORM_LABEL[p]}</option>
                        ))}
                    </select>
                </Field>
                <Field label="Channel or page name">
                    <Input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="Kitchen Science" className="border-white/10 bg-white/5 text-sm" />
                </Field>
                <Field label="Handle">
                    <Input value={d.handle} onChange={(e) => setD({ ...d, handle: e.target.value })} placeholder="@kitchensci" className="border-white/10 bg-white/5 text-sm" />
                </Field>
                <Field label="URL">
                    <Input value={d.url} onChange={(e) => setD({ ...d, url: e.target.value })} placeholder="https://youtube.com/@kitchensci" className="border-white/10 bg-white/5 text-sm" />
                </Field>
            </div>

            <Field label="Makes" hint="Everything this account publishes. Each plan makes at least one of them for it.">
                <div className="flex flex-wrap gap-2">
                    {FORMATS.map((f) => {
                        const on = d.p.formats.includes(f);
                        return (
                            <button
                                key={f}
                                type="button"
                                onClick={() => toggleFormat(f)}
                                aria-pressed={on}
                                className={
                                    on
                                        ? 'rounded-md border border-emerald-400/40 bg-emerald-400/10 px-2.5 py-1 text-xs text-emerald-300'
                                        : 'rounded-md border border-white/10 px-2.5 py-1 text-xs text-muted-foreground hover:border-white/25'
                                }
                            >
                                {on ? '✓ ' : ''}
                                {FORMAT_LABEL[f]}
                            </button>
                        );
                    })}
                </div>
            </Field>

            <div className="grid grid-cols-1 gap-3 inner:grid-cols-2 desk:grid-cols-4">
                <Field label="Video length, seconds" hint="Min and max. Narration is written to fit.">
                    <div className="flex items-center gap-2">
                        <Input type="number" min={5} max={180} disabled={!makesVideo} value={d.p.durationSec.min} onChange={(e) => setP({ durationSec: { ...d.p.durationSec, min: Number(e.target.value) } })} className="border-white/10 bg-white/5 text-sm" />
                        <span className="text-muted-foreground">–</span>
                        <Input type="number" min={5} max={180} disabled={!makesVideo} value={d.p.durationSec.max} onChange={(e) => setP({ durationSec: { ...d.p.durationSec, max: Number(e.target.value) } })} className="border-white/10 bg-white/5 text-sm" />
                    </div>
                </Field>
                <Field label="Image shape" hint="For posts and carousels. Videos take their format's shape.">
                    <select className={selectClass} disabled={!makesImages} value={d.p.imageAspect} onChange={(e) => setP({ imageAspect: e.target.value as Aspect })}>
                        {ASPECTS.map((a) => (
                            <option key={a} value={a}>{a}</option>
                        ))}
                    </select>
                </Field>
                <Field label="Quality" hint="Full HD renders about twice as slowly.">
                    <select className={selectClass} value={d.p.quality} onChange={(e) => setP({ quality: e.target.value as 'hd' | 'fhd' })}>
                        <option value="fhd">Full HD (1080)</option>
                        <option value="hd">HD (720)</option>
                    </select>
                </Field>
                <Field label="Status">
                    <select className={selectClass} value={d.status} onChange={(e) => setD({ ...d, status: e.target.value as 'active' | 'paused' })}>
                        <option value="active">Active</option>
                        <option value="paused">Paused — nothing planned</option>
                    </select>
                </Field>
            </div>

            <div className="grid grid-cols-1 gap-3 inner:grid-cols-3">
                <Field label="Narration">
                    <select className={selectClass} disabled={!makesVideo} value={d.p.narration ? 'on' : 'off'} onChange={(e) => setP({ narration: e.target.value === 'on' })}>
                        <option value="on">Narrated (text-to-speech)</option>
                        <option value="off">Silent, text on screen</option>
                    </select>
                </Field>
                <Field label="Voice">
                    <select className={selectClass} value={d.p.voice} onChange={(e) => setP({ voice: e.target.value })} disabled={!makesVideo || !d.p.narration}>
                        {VOICES.map((v) => (
                            <option key={v.name} value={v.name}>{v.name} — {v.note}</option>
                        ))}
                    </select>
                </Field>
                <Field label="Captions">
                    <select className={selectClass} disabled={!makesVideo} value={d.p.captions ? 'on' : 'off'} onChange={(e) => setP({ captions: e.target.value === 'on' })}>
                        <option value="on">Burned in, plus an .srt file</option>
                        <option value="off">The .srt file only</option>
                    </select>
                </Field>
            </div>

            <div className="grid grid-cols-1 gap-3 inner:grid-cols-2">
                <Field label="Niche" hint="What the account is about, in one line.">
                    <Input value={d.p.niche} onChange={(e) => setP({ niche: e.target.value })} placeholder="Weeknight cooking for people with one pan" className="border-white/10 bg-white/5 text-sm" />
                </Field>
                <Field label="Audience">
                    <Input value={d.p.audience} onChange={(e) => setP({ audience: e.target.value })} placeholder="Renters in their twenties who cook after work" className="border-white/10 bg-white/5 text-sm" />
                </Field>
                <Field label="Tone">
                    <Input value={d.p.tone} onChange={(e) => setP({ tone: e.target.value })} className="border-white/10 bg-white/5 text-sm" />
                </Field>
                <Field label="Language">
                    <Input value={d.p.language} onChange={(e) => setP({ language: e.target.value })} className="border-white/10 bg-white/5 text-sm" />
                </Field>
                <Field label="Cadence" hint="In words. The department's schedule decides when it runs.">
                    <Input value={d.p.cadence} onChange={(e) => setP({ cadence: e.target.value })} placeholder="Three shorts a week" className="border-white/10 bg-white/5 text-sm" />
                </Field>
                <Field label="Call to action">
                    <Input value={d.p.cta} onChange={(e) => setP({ cta: e.target.value })} placeholder="Subscribe for a new one every Tuesday." className="border-white/10 bg-white/5 text-sm" />
                </Field>
                <Field label="Content pillars" hint="Comma-separated. The themes the account rotates through.">
                    <Textarea rows={2} value={d.p.pillars.join(', ')} onChange={(e) => setP({ pillars: list(e.target.value) })} className="border-white/10 bg-white/5 text-sm" />
                </Field>
                <Field label="Never" hint="Comma-separated. Things this account does not do or say.">
                    <Textarea rows={2} value={d.p.avoid.join(', ')} onChange={(e) => setP({ avoid: list(e.target.value) })} className="border-white/10 bg-white/5 text-sm" />
                </Field>
                <Field label="Hashtags" hint="Appended to every description or caption.">
                    <Input value={d.p.hashtags.join(' ')} onChange={(e) => setP({ hashtags: e.target.value.split(/[\s,]+/).filter(Boolean) })} placeholder="#onepan #weeknightdinner" className="border-white/10 bg-white/5 text-sm" />
                </Field>
                <Field label="Description footer" hint="Links, disclaimers, credits — appended to every description.">
                    <Textarea rows={2} value={d.p.descriptionTemplate} onChange={(e) => setP({ descriptionTemplate: e.target.value })} className="border-white/10 bg-white/5 text-sm" />
                </Field>
            </div>

            <div className="grid grid-cols-1 gap-3 inner:grid-cols-3">
                <Field label="Brand colour" hint="Backgrounds and caption boxes.">
                    <div className="flex items-center gap-2">
                        <input type="color" value={d.p.brand.primary} onChange={(e) => setP({ brand: { ...d.p.brand, primary: e.target.value } })} className="h-9 w-12 shrink-0 cursor-pointer rounded border border-white/10 bg-transparent" aria-label="Brand colour" />
                        <Input value={d.p.brand.primary} onChange={(e) => setP({ brand: { ...d.p.brand, primary: e.target.value } })} className="border-white/10 bg-white/5 font-mono text-sm" />
                    </div>
                </Field>
                <Field label="Accent colour">
                    <div className="flex items-center gap-2">
                        <input type="color" value={d.p.brand.accent} onChange={(e) => setP({ brand: { ...d.p.brand, accent: e.target.value } })} className="h-9 w-12 shrink-0 cursor-pointer rounded border border-white/10 bg-transparent" aria-label="Accent colour" />
                        <Input value={d.p.brand.accent} onChange={(e) => setP({ brand: { ...d.p.brand, accent: e.target.value } })} className="border-white/10 bg-white/5 font-mono text-sm" />
                    </div>
                </Field>
                <Field label="Watermark" hint="Small, in a corner of every frame. Defaults to the handle.">
                    <Input value={d.p.brand.watermark} onChange={(e) => setP({ brand: { ...d.p.brand, watermark: e.target.value } })} className="border-white/10 bg-white/5 text-sm" />
                </Field>
            </div>

            <Field label="Notes for the agents">
                <Textarea rows={2} value={d.p.notes} onChange={(e) => setP({ notes: e.target.value })} placeholder="Anything else that shapes what gets made for this account." className="border-white/10 bg-white/5 text-sm" />
            </Field>

            {error && (
                <p className="flex items-start gap-1.5 text-xs text-red-400">
                    <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
                </p>
            )}

            <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => onSave(d)} disabled={pending}>
                    {pending ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-2 h-3.5 w-3.5" />}
                    Save account
                </Button>
                <Button size="sm" variant="outline" onClick={onCancel} disabled={pending} className="border-white/10">
                    <X className="mr-2 h-3.5 w-3.5" /> Cancel
                </Button>
            </div>
        </div>
    );
}

function Summary({ a }: { a: MediaAccount }) {
    const p = a.preferences;
    const video = p.formats.some(isVideoFormat);
    const bits = [
        formatsLine(p),
        video ? `${p.durationSec.min}–${p.durationSec.max}s` : null,
        video ? (p.narration ? `voice ${p.voice}` : 'silent') : null,
        p.cadence || null,
    ].filter(Boolean);
    return (
        <div className="space-y-1">
            <p className="text-xs text-muted-foreground">{bits.join(' · ')}</p>
            {p.niche && <p className="text-xs text-zinc-300">{p.niche}</p>}
            {p.pillars.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-0.5">
                    {p.pillars.slice(0, 6).map((x) => (
                        <Badge key={x} variant="outline" className="border-white/10 text-[10px] text-muted-foreground">{x}</Badge>
                    ))}
                </div>
            )}
        </div>
    );
}

export function AccountsCard({
    departmentId,
    accounts,
    canEdit,
    hasTeam,
}: {
    departmentId: string;
    accounts: MediaAccount[];
    canEdit: boolean;
    /** A team already proposed: a changed account only shapes the next plan. */
    hasTeam: boolean;
}) {
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);
    const [adding, setAdding] = useState(false);
    const [editing, setEditing] = useState<string | null>(null);
    const [confirm, setConfirm] = useState<string | null>(null);
    const [confirmRestaff, setConfirmRestaff] = useState(false);
    const [test, setTest] = useState<{ result: TestRender | null; error: string | null; running: boolean }>({ result: null, error: null, running: false });

    const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) => {
        setError(null);
        startTransition(async () => {
            const res = await fn();
            if (!res.ok) setError(res.error ?? 'Something went wrong.');
            else {
                after?.();
                router.refresh();
            }
        });
    };

    const testRender = async (accountId: string | null) => {
        setTest({ result: null, error: null, running: true });
        try {
            const res = await fetch('/api/delphi/studio', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ accountId }),
            });
            const body = (await res.json().catch(() => ({}))) as TestRender & { error?: string };
            setTest(res.ok ? { result: body, error: null, running: false } : { result: null, error: body.error ?? `The studio answered ${res.status}.`, running: false });
        } catch (err) {
            setTest({ result: null, error: (err as Error).message, running: false });
        }
    };

    return (
        <Card className="border-white/10 bg-black/40">
            <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="flex items-center gap-2 text-sm">
                        <Clapperboard className="h-4 w-4" /> Accounts
                        <span className="text-xs font-normal text-muted-foreground">{accounts.length || 'none yet'}</span>
                    </CardTitle>
                    {canEdit && !adding && (
                        <div className="flex flex-wrap gap-2">
                            <Button size="sm" variant="outline" className="border-white/10" onClick={() => testRender(accounts[0]?.id ?? null)} disabled={pending || test.running} title="Render a ten-second sample to prove the studio works here">
                                {test.running ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Clapperboard className="mr-2 h-3.5 w-3.5" />}
                                Test render
                            </Button>
                            <Button size="sm" onClick={() => { setAdding(true); setEditing(null); }} disabled={pending}>
                                <Plus className="mr-2 h-3.5 w-3.5" /> Add account
                            </Button>
                        </div>
                    )}
                </div>
                <p className="text-xs text-muted-foreground">
                    Each YouTube channel or social page this department produces for, with what it wants made.{' '}
                    {CEO_NAME} plans one production chain per account, and the studio renders every piece to that
                    account&rsquo;s preferences. Accounts share research, never scripts.
                </p>
            </CardHeader>
            <CardContent className="space-y-3">
                {test.running && (
                    <p className="text-xs text-muted-foreground">Rendering a sample — ten to forty seconds…</p>
                )}
                {test.error && (
                    <p className="flex items-start gap-1.5 text-xs text-red-400">
                        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {test.error}
                    </p>
                )}
                {test.result && (
                    <div className="space-y-2 rounded-lg border border-emerald-400/20 bg-emerald-400/5 p-3">
                        <p className="text-xs text-emerald-300">
                            Rendered {test.result.width}×{test.result.height}
                            {test.result.seconds !== undefined && <>, {Math.round(test.result.seconds)}s</>} in{' '}
                            {(test.result.renderMs / 1000).toFixed(1)}s
                            {test.result.kind === 'video' && <> — {test.result.narrated ? 'narrated' : 'silent'}</>},{' '}
                            {test.result.stock ? 'stock photos' : 'painted backgrounds (no stock key)'}.
                        </p>
                        {test.result.url ? (
                            test.result.kind === 'video' ? (
                                <video controls preload="metadata" src={test.result.url} className="max-h-80 rounded-md bg-black" />
                            ) : (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={test.result.url} alt="Test render" className="max-h-80 rounded-md" />
                            )
                        ) : (
                            <p className="text-xs text-amber-400">The file was rendered and stored, but could not be signed for playback. Run migration 0011 for the storage policies.</p>
                        )}
                    </div>
                )}

                {accounts.length === 0 && !adding && (
                    <p className="text-sm text-muted-foreground">
                        No accounts yet. Add each channel or page before {CEO_NAME} staffs this department, so every one gets
                        its own script and its own render.
                    </p>
                )}

                {adding && (
                    <AccountForm
                        initial={draftFrom(null)}
                        pending={pending}
                        error={error}
                        onCancel={() => { setAdding(false); setError(null); }}
                        onSave={(d) => run(() => createAccountAction(departmentId, toInput(d)), () => setAdding(false))}
                    />
                )}

                {accounts.map((a) =>
                    editing === a.id ? (
                        <AccountForm
                            key={a.id}
                            initial={draftFrom(a)}
                            pending={pending}
                            error={error}
                            onCancel={() => { setEditing(null); setError(null); }}
                            onSave={(d) => run(() => updateAccountAction(a.id, toInput(d)), () => setEditing(null))}
                        />
                    ) : (
                        <div key={a.id} className="space-y-2 rounded-lg border border-white/10 bg-black/30 p-3">
                            <div className="flex flex-wrap items-start gap-2">
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-zinc-200">
                                        <span className="min-w-0 break-words">{accountLabel(a)}</span>
                                        {a.status === 'paused' && (
                                            <Badge variant="outline" className="border-amber-400/30 text-[10px] text-amber-400">paused</Badge>
                                        )}
                                    </div>
                                    <Summary a={a} />
                                </div>
                                {canEdit && (
                                    <div className="flex items-center gap-1">
                                        <button type="button" onClick={() => testRender(a.id)} disabled={pending || test.running} title="Test render for this account" aria-label={`Test render for ${a.name}`} className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-white/5 hover:text-white disabled:opacity-40">
                                            <Clapperboard className="h-3.5 w-3.5" />
                                        </button>
                                        <button type="button" onClick={() => { setEditing(a.id); setAdding(false); setError(null); }} disabled={pending} title="Edit" aria-label={`Edit ${a.name}`} className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-white/5 hover:text-white disabled:opacity-40">
                                            <Pencil className="h-3.5 w-3.5" />
                                        </button>
                                        <button type="button" onClick={() => setConfirm(a.id)} disabled={pending} title="Remove" aria-label={`Remove ${a.name}`} className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-red-400/10 hover:text-red-400 disabled:opacity-40">
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                    </div>
                                )}
                            </div>
                            {confirm === a.id && (
                                <div className="space-y-2 rounded border border-red-400/20 bg-red-400/5 p-2.5">
                                    <p className="text-xs text-red-400">
                                        Remove {a.name}? Its finished videos and posts stay in Outputs; they just stop saying which account they were for.
                                    </p>
                                    <div className="flex gap-2">
                                        <Button size="sm" variant="outline" onClick={() => run(() => deleteAccountAction(a.id), () => setConfirm(null))} disabled={pending} className="border-red-400/30 text-red-400 hover:bg-red-400/10 hover:text-red-300">
                                            {pending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />} Remove
                                        </Button>
                                        <Button size="sm" variant="outline" onClick={() => setConfirm(null)} disabled={pending} className="border-white/10">Keep it</Button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )
                )}

                {canEdit && hasTeam && accounts.length > 0 && !adding && !editing && (
                    <div className="space-y-2 rounded-lg border border-white/10 bg-black/20 p-3">
                        <p className="text-xs text-muted-foreground">
                            This department was staffed before some of these accounts or preferences were set. Re-staff it
                            and {CEO_NAME} proposes a new team with a production chain for each account.
                        </p>
                        {confirmRestaff ? (
                            <div className="space-y-2">
                                <p className="text-xs text-amber-300">
                                    The current plan is set aside: what it already made stays in Outputs, what was still to come
                                    is skipped, and an approval still waiting is withdrawn. Nothing new runs until you approve the
                                    new team.
                                </p>
                                <div className="flex flex-wrap gap-2">
                                    <Button size="sm" onClick={() => run(() => restaffDepartmentAction(departmentId), () => setConfirmRestaff(false))} disabled={pending}>
                                        {pending ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-2 h-3.5 w-3.5" />}
                                        {pending ? `${CEO_NAME} is staffing…` : 'Set it aside and re-staff'}
                                    </Button>
                                    <Button size="sm" variant="outline" onClick={() => setConfirmRestaff(false)} disabled={pending} className="border-white/10">Keep the current plan</Button>
                                </div>
                            </div>
                        ) : (
                            <Button size="sm" variant="outline" className="border-white/10" onClick={() => setConfirmRestaff(true)} disabled={pending}>
                                <RefreshCw className="mr-2 h-3.5 w-3.5" /> Re-staff for these accounts
                            </Button>
                        )}
                    </div>
                )}

                {error && !adding && !editing && (
                    <p className="flex items-start gap-1.5 text-xs text-red-400">
                        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
                    </p>
                )}
            </CardContent>
        </Card>
    );
}
