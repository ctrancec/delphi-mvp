'use client';

/**
 * Setting up a department, in five steps.
 *
 *   1  what kind of department
 *   2  its name, purpose and budget        (the draft is saved from here)
 *   3  the kind's own setup: topics, sources and the report for research;
 *      the channels for a studio
 *   4  the CHO's rules for the team: house rules, a note per role, pinned
 *      agents, how much the CEO decides alone
 *   5  review, then the CEO staffs it with all of that in hand
 *
 * Every step saves before it moves on, so a draft resumes where it stopped.
 * Opened on a department that is already set up, the same steps edit it.
 */

import { useState, useSyncExternalStore, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Check, Clapperboard, FileText, Loader2, Shapes, Sparkles, TriangleAlert } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { AccountsCard } from '@/components/delphi/accounts-card';
import { DayPicker } from '@/components/delphi/day-picker';
import { cn } from '@/lib/utils';
import {
    KINDS,
    REPORT_LENGTH_LABEL,
    rolesFor,
    scheduleWords,
    withSettings,
    type DepartmentKind,
    type DepartmentSettings,
    type DeliverySchedule,
    type ReportLength,
    type RoleKey,
} from '@/lib/delphi/kinds';
import { accountLabel, formatsLine, type MediaAccount } from '@/lib/studio/accounts';
import { finishSetupAction, saveDepartmentBasicsAction, saveDepartmentSettingsAction } from '@/lib/delphi/setup';
import { CEO_NAME } from '@/lib/pixel/cast/names';

export interface WizardDraft {
    id: string;
    kind: DepartmentKind;
    name: string;
    charter: string;
    budgetUsd: number;
    status: string;
    settings: DepartmentSettings;
    hasTeam: boolean;
    accounts: MediaAccount[];
}

export interface RosterEntry {
    slug: string;
    name: string;
    title: string;
    role: RoleKey | null;
}

const STEPS = ['Kind', 'Basics', 'Setup', 'Team rules', 'Review'];

const KIND_ICON: Record<DepartmentKind, typeof FileText> = {
    research: FileText,
    studio: Clapperboard,
    general: Shapes,
};

/** What each connected source is, in a few words. */
const SOURCE_LABEL: Record<string, string> = {
    perplexity: 'Web search (Perplexity)',
    fred: 'US economic data (FRED)',
    rss: 'News headlines (RSS)',
    boc: 'Bank of Canada',
    gdelt: 'World news (GDELT)',
    sec: 'Company filings (SEC)',
    finnhub: 'Stock prices (Finnhub)',
};

const FALLBACK_ZONES = ['UTC', 'Europe/London', 'Europe/Paris', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Toronto', 'America/Vancouver', 'Asia/Tokyo', 'Asia/Singapore', 'Australia/Sydney'];

function zones(): string[] {
    try {
        const all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone');
        return all?.length ? all : FALLBACK_ZONES;
    } catch {
        return FALLBACK_ZONES;
    }
}

/** The browser's zone; UTC while rendering on the server, so the two agree on first paint. */
function useBrowserZone(): string {
    return useSyncExternalStore(
        () => () => {},
        () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        () => 'UTC'
    );
}

const fieldClass = 'border-white/10 bg-white/5 text-sm';
const selectClass =
    'h-9 w-full rounded-md border border-white/10 bg-white/5 px-2 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-white/30';

function Field({ label, hint, children, htmlFor }: { label: string; hint?: string; children: React.ReactNode; htmlFor?: string }) {
    return (
        <div className="space-y-1.5">
            <Label htmlFor={htmlFor} className="text-xs text-muted-foreground">{label}</Label>
            {children}
            {hint && <p className="text-[11px] text-muted-foreground/70">{hint}</p>}
        </div>
    );
}

function ScheduleFields({
    schedule,
    onChange,
    timezone,
    optionalLabel,
}: {
    schedule: DeliverySchedule | null;
    onChange: (s: DeliverySchedule | null) => void;
    timezone: string;
    optionalLabel: string;
}) {
    const days = schedule?.days ?? [];
    const time = schedule?.time ?? '09:00';
    return (
        <div className="space-y-3">
            <Field label={optionalLabel} hint="Leave every day off to run only when you ask.">
                <DayPicker days={days} onChange={(d) => onChange(d.length ? { days: d, time } : null)} />
            </Field>
            <div className="grid grid-cols-1 gap-3 inner:grid-cols-2">
                <Field label="At" htmlFor="wiz-time">
                    <Input id="wiz-time" type="time" value={time} disabled={!days.length} onChange={(e) => onChange({ days, time: e.target.value || '09:00' })} className={fieldClass} />
                </Field>
            </div>
            <p className="text-[11px] text-muted-foreground/70">{scheduleWords(schedule, timezone)}</p>
        </div>
    );
}

/**
 * The time zone, said rather than asked: the CHO's own, found on their device.
 * A department can be given another — rarely wanted — and set back.
 */
function ZoneNote({
    zone,
    fromDevice,
    pinned,
    onPin,
    onUnpin,
}: {
    zone: string;
    /** True while the workspace has no zone of its own yet, so this device's is shown. */
    fromDevice: boolean;
    pinned: boolean;
    onPin: (tz: string) => void;
    onUnpin: () => void;
}) {
    if (!pinned) {
        return (
            <p className="text-[11px] text-muted-foreground">
                Times are in your time zone, <span className="text-zinc-300">{zone}</span>
                {fromDevice ? ', found on this device' : ''}.{' '}
                <button type="button" onClick={() => onPin(zone)} className="text-sky-400 hover:underline">
                    Use a different one for this department
                </button>
            </p>
        );
    }
    return (
        <div className="space-y-1.5">
            <Field label="This department's time zone" htmlFor="wiz-tz">
                <select id="wiz-tz" className={selectClass} value={zone} onChange={(e) => onPin(e.target.value)}>
                    {[...new Set([zone, ...zones()])].map((z) => (
                        <option key={z} value={z}>{z}</option>
                    ))}
                </select>
            </Field>
            <button type="button" onClick={onUnpin} className="text-[11px] text-sky-400 hover:underline">
                Use my time zone instead
            </button>
        </div>
    );
}

export function DepartmentWizard({
    draft,
    convertTo,
    workspaceZone = null,
    startStep,
    sources,
    roster,
}: {
    draft: WizardDraft | null;
    convertTo: DepartmentKind | null;
    /** The workspace's time zone, when it is known; otherwise this device's is used. */
    workspaceZone?: string | null;
    startStep: number | null;
    sources: string[];
    roster: RosterEntry[];
}) {
    const router = useRouter();
    const browserZone = useBrowserZone();
    const [pending, startTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);

    // Set up before: these steps edit it. A conversion is a fresh setup of an
    // existing department, finished by re-staffing it.
    const editing = Boolean(draft?.settings.setup.complete) && !convertTo;

    const [id, setId] = useState<string | null>(draft?.id ?? null);
    const [step, setStep] = useState<number>(
        startStep ?? (convertTo ? 3 : draft ? (editing ? 2 : Math.max(2, draft.settings.setup.step)) : 1)
    );
    const [kind, setKind] = useState<DepartmentKind | null>(convertTo ?? draft?.kind ?? null);
    const [basics, setBasics] = useState({
        name: draft?.name ?? '',
        charter: draft?.charter ?? '',
        budgetUsd: String(draft?.budgetUsd ?? '5'),
    });
    const [settings, setSettings] = useState<DepartmentSettings>(draft?.settings ?? withSettings({ setup: { step: 1, complete: false } }));
    // The CHO's own zone — the workspace's, else this device's — unless this
    // department was deliberately given another.
    const autoZone = workspaceZone ?? browserZone;
    const [pinnedZone, setPinnedZone] = useState<string | null>(draft?.settings.timezonePinned ? draft.settings.timezone : null);
    const timezone = pinnedZone ?? autoZone;

    const accounts = draft?.accounts ?? [];
    const k = kind ?? 'research';
    const roles = rolesFor(k);

    const go = (n: number) => {
        setError(null);
        setStep(n);
        if (id) router.replace(`/dashboard/delphi/departments/new?draft=${id}&step=${n}${convertTo ? `&convert=${convertTo}` : ''}`, { scroll: false });
    };

    const saveBasics = () => {
        setError(null);
        startTransition(async () => {
            const res = await saveDepartmentBasicsAction({
                id,
                kind: k,
                name: basics.name,
                charter: basics.charter,
                budgetUsd: Number(basics.budgetUsd),
                timezone,
            });
            if (!res.ok || !res.data) return setError(res.error ?? 'Could not save.');
            setId(res.data.id);
            setStep(3);
            router.replace(`/dashboard/delphi/departments/new?draft=${res.data.id}&step=3${convertTo ? `&convert=${convertTo}` : ''}`, { scroll: false });
        });
    };

    const saveSettings = (patch: Partial<DepartmentSettings>, next: number) => {
        if (!id) return setError('Save the basics first.');
        setError(null);
        startTransition(async () => {
            const res = await saveDepartmentSettingsAction(id, { ...patch, timezone, timezonePinned: pinnedZone !== null }, next, convertTo ?? undefined);
            if (!res.ok || !res.data) return setError(res.error ?? 'Could not save.');
            setSettings(res.data.settings);
            go(next);
        });
    };

    const finish = () => {
        if (!id) return;
        setError(null);
        startTransition(async () => {
            const res = await finishSetupAction(id);
            if (!res.ok) return setError(res.error ?? `${CEO_NAME} could not staff it.`);
            router.push(`/dashboard/delphi/departments/${id}`);
        });
    };

    const title = convertTo
        ? `Convert ${draft?.name ?? 'this department'} to a ${KINDS[convertTo].label.toLowerCase()}`
        : editing
          ? `Set up ${draft?.name}`
          : 'New department';

    return (
        <div className="space-y-5">
            <div>
                <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    {editing
                        ? 'Each step saves as you go. The team is not re-staffed unless you ask.'
                        : `Set it up the way you want it. ${CEO_NAME} staffs it from everything you put here.`}
                </p>
            </div>

            <ol className="flex flex-wrap gap-1.5" aria-label="Steps">
                {STEPS.map((label, i) => {
                    const n = i + 1;
                    const reachable = n === 1 ? !convertTo : n === 2 || Boolean(id);
                    return (
                        <li key={label}>
                            <button
                                type="button"
                                disabled={!reachable || pending}
                                onClick={() => go(n)}
                                aria-current={step === n ? 'step' : undefined}
                                className={cn(
                                    'rounded-md border px-2.5 py-1 text-xs',
                                    step === n ? 'border-white/40 bg-white/10 text-white' : 'border-white/10 text-muted-foreground',
                                    reachable && step !== n && 'hover:border-white/25',
                                    !reachable && 'opacity-40'
                                )}
                            >
                                {n}. {label}
                            </button>
                        </li>
                    );
                })}
            </ol>

            {error && (
                <p className="flex items-start gap-1.5 rounded-md border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400" role="alert">
                    <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {error}
                </p>
            )}

            {step === 1 && (
                <div className="space-y-3">
                    <div className="grid grid-cols-1 gap-3 inner:grid-cols-3">
                        {(Object.keys(KINDS) as DepartmentKind[]).map((key) => {
                            const info = KINDS[key];
                            const Icon = KIND_ICON[key];
                            const on = kind === key;
                            return (
                                <button
                                    key={key}
                                    type="button"
                                    aria-pressed={on}
                                    onClick={() => setKind(key)}
                                    className={cn(
                                        'space-y-2 rounded-lg border p-4 text-left transition-colors',
                                        on ? 'border-emerald-400/50 bg-emerald-400/10' : 'border-white/10 bg-black/30 hover:border-white/25'
                                    )}
                                >
                                    <Icon className={cn('h-5 w-5', on ? 'text-emerald-300' : 'text-muted-foreground')} />
                                    <div className="text-sm font-semibold">{info.label}</div>
                                    <p className="text-xs text-muted-foreground">{info.blurb}</p>
                                </button>
                            );
                        })}
                    </div>
                    <div className="flex justify-end">
                        <Button onClick={() => go(2)} disabled={!kind}>
                            Continue <ArrowRight className="ml-2 h-4 w-4" />
                        </Button>
                    </div>
                </div>
            )}

            {step === 2 && (
                <Card className="border-white/10 bg-black/40">
                    <CardContent className="space-y-4 pt-6">
                        <Field label="Name" htmlFor="wiz-name">
                            <Input id="wiz-name" value={basics.name} onChange={(e) => setBasics({ ...basics, name: e.target.value })} placeholder={k === 'studio' ? 'YouTube studio' : 'Morning market brief'} className={fieldClass} />
                        </Field>
                        <Field
                            label="What it is for"
                            htmlFor="wiz-purpose"
                            hint={`What the team delivers and what good looks like. ${CEO_NAME} staffs from this.`}
                        >
                            <Textarea id="wiz-purpose" rows={5} value={basics.charter} onChange={(e) => setBasics({ ...basics, charter: e.target.value })} placeholder={KINDS[k].examplePurpose || 'Describe the work.'} className={fieldClass} />
                        </Field>
                        {KINDS[k].examplePurpose && !basics.charter && (
                            <button type="button" className="text-xs text-sky-400 hover:underline" onClick={() => setBasics({ ...basics, charter: KINDS[k].examplePurpose })}>
                                Start from the example
                            </button>
                        )}
                        <Field label="Monthly budget (USD)" htmlFor="wiz-budget" hint="Work stops for the month when this is spent.">
                            <Input id="wiz-budget" type="number" min="0.5" step="0.5" value={basics.budgetUsd} onChange={(e) => setBasics({ ...basics, budgetUsd: e.target.value })} className={cn(fieldClass, 'max-w-40')} />
                        </Field>
                        <div className="flex justify-between gap-2">
                            <Button variant="outline" className="border-white/10" onClick={() => go(1)} disabled={pending || Boolean(convertTo)}>
                                <ArrowLeft className="mr-2 h-4 w-4" /> Back
                            </Button>
                            <Button onClick={saveBasics} disabled={pending}>
                                {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                Save and continue <ArrowRight className="ml-2 h-4 w-4" />
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            )}

            {step === 3 && (
                <div className="space-y-4">
                    {k === 'research' && (
                        <Card className="border-white/10 bg-black/40">
                            <CardContent className="space-y-4 pt-6">
                                <Field label="Topics and questions" htmlFor="wiz-topics" hint="One per line. What every report should cover.">
                                    <Textarea
                                        id="wiz-topics"
                                        rows={4}
                                        value={settings.research.topics.join('\n')}
                                        onChange={(e) => setSettings({ ...settings, research: { ...settings.research, topics: e.target.value.split('\n').map((t) => t.trimStart()) } })}
                                        placeholder={'Overnight moves in the S&P 500 and Nasdaq\nUS rates and the dollar\nEarnings this week for my holdings'}
                                        className={fieldClass}
                                    />
                                </Field>
                                <Field label="Sources the team may use" hint={sources.length ? 'None selected means all of them.' : 'No sources are connected yet. See Diagnostics.'}>
                                    <div className="flex flex-wrap gap-1.5">
                                        {sources.map((src) => {
                                            const on = settings.research.sources.includes(src);
                                            return (
                                                <button
                                                    key={src}
                                                    type="button"
                                                    aria-pressed={on}
                                                    onClick={() =>
                                                        setSettings({
                                                            ...settings,
                                                            research: {
                                                                ...settings.research,
                                                                sources: on ? settings.research.sources.filter((x) => x !== src) : [...settings.research.sources, src],
                                                            },
                                                        })
                                                    }
                                                    className={cn(
                                                        'rounded-md border px-2.5 py-1 text-xs',
                                                        on ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300' : 'border-white/10 text-muted-foreground hover:border-white/25'
                                                    )}
                                                >
                                                    {on ? '✓ ' : ''}
                                                    {SOURCE_LABEL[src] ?? src}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </Field>
                                <div className="grid grid-cols-1 gap-3 inner:grid-cols-2">
                                    <Field label="Report length" htmlFor="wiz-length">
                                        <select id="wiz-length" className={selectClass} value={settings.research.report.length} onChange={(e) => setSettings({ ...settings, research: { ...settings.research, report: { ...settings.research.report, length: e.target.value as ReportLength } } })}>
                                            {(Object.keys(REPORT_LENGTH_LABEL) as ReportLength[]).map((l) => (
                                                <option key={l} value={l}>{REPORT_LENGTH_LABEL[l]}</option>
                                            ))}
                                        </select>
                                    </Field>
                                    <Field label="Tone" htmlFor="wiz-tone">
                                        <Input id="wiz-tone" value={settings.research.report.tone} onChange={(e) => setSettings({ ...settings, research: { ...settings.research, report: { ...settings.research.report, tone: e.target.value } } })} placeholder="Plain, numbers first, no hype" className={fieldClass} />
                                    </Field>
                                </div>
                                <Field label="Sections" htmlFor="wiz-sections" hint="The headings you want, in order.">
                                    <Textarea id="wiz-sections" rows={2} value={settings.research.report.sections} onChange={(e) => setSettings({ ...settings, research: { ...settings.research, report: { ...settings.research.report, sections: e.target.value } } })} placeholder="What changed overnight; Why it matters to me; What to watch today" className={fieldClass} />
                                </Field>
                                <ScheduleFields
                                    schedule={settings.schedule}
                                    onChange={(sch) => setSettings({ ...settings, schedule: sch })}
                                    timezone={timezone}
                                    optionalLabel="Deliver on"
                                />
                                <ZoneNote zone={timezone} fromDevice={!workspaceZone} pinned={pinnedZone !== null} onPin={setPinnedZone} onUnpin={() => setPinnedZone(null)} />
                            </CardContent>
                        </Card>
                    )}

                    {k === 'studio' && id && (
                        <>
                            <Card className="border-white/10 bg-black/40">
                                <CardContent className="space-y-3 pt-6">
                                    <p className="text-sm text-muted-foreground">
                                        Add each YouTube channel or social page this studio makes content for. Each one is kept
                                        separate: its own settings, schedule, conversations and history. In a channel&rsquo;s
                                        settings you choose what it makes, when, and whether you approve its topics.
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                        Not ready to connect a real account? Add a <span className="text-zinc-300">test channel</span>: the
                                        team makes real videos and images for it, and you can switch it to your real account later.
                                    </p>
                                    <ZoneNote zone={timezone} fromDevice={!workspaceZone} pinned={pinnedZone !== null} onPin={setPinnedZone} onUnpin={() => setPinnedZone(null)} />
                                </CardContent>
                            </Card>
                            <AccountsCard departmentId={id} accounts={accounts} canEdit hasTeam={false} timezone={timezone} />
                            {!accounts.some((a) => a.status === 'active') && (
                                <p className="text-xs text-amber-300">Add at least one active channel before the studio can be staffed.</p>
                            )}
                        </>
                    )}

                    {k === 'general' && (
                        <Card className="border-white/10 bg-black/40">
                            <CardContent className="space-y-4 pt-6">
                                <p className="text-sm text-muted-foreground">
                                    Nothing more to set for this kind. Choose when it should run, or leave it to run only when you ask.
                                </p>
                                <ScheduleFields
                                    schedule={settings.schedule}
                                    onChange={(sch) => setSettings({ ...settings, schedule: sch })}
                                    timezone={timezone}
                                    optionalLabel="Run on"
                                />
                                <ZoneNote zone={timezone} fromDevice={!workspaceZone} pinned={pinnedZone !== null} onPin={setPinnedZone} onUnpin={() => setPinnedZone(null)} />
                            </CardContent>
                        </Card>
                    )}

                    <div className="flex justify-between gap-2">
                        <Button variant="outline" className="border-white/10" onClick={() => go(2)} disabled={pending}>
                            <ArrowLeft className="mr-2 h-4 w-4" /> Back
                        </Button>
                        <Button
                            onClick={() =>
                                saveSettings(
                                    k === 'research'
                                        ? {
                                              research: { ...settings.research, topics: settings.research.topics.map((t) => t.trim()).filter(Boolean) },
                                              schedule: settings.schedule,
                                          }
                                        : k === 'general'
                                          ? { schedule: settings.schedule }
                                          : {},
                                    4
                                )
                            }
                            disabled={pending || !id}
                        >
                            {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            Save and continue <ArrowRight className="ml-2 h-4 w-4" />
                        </Button>
                    </div>
                </div>
            )}

            {step === 4 && (
                <Card className="border-white/10 bg-black/40">
                    <CardContent className="space-y-5 pt-6">
                        <Field
                            label="House rules"
                            htmlFor="wiz-rules"
                            hint="For everyone in this department, on every task. Only this department's team ever sees them."
                        >
                            <Textarea id="wiz-rules" rows={4} value={settings.houseRules} onChange={(e) => setSettings({ ...settings, houseRules: e.target.value })} placeholder={k === 'studio' ? 'Never mention competitors by name. No clickbait titles. Keep every claim to what the research supports.' : 'Lead with what changed. Every figure gets its date. Say plainly when only one outlet reports something.'} className={fieldClass} />
                        </Field>

                        <div className="space-y-3">
                            <div>
                                <h3 className="text-sm font-semibold">Notes per role</h3>
                                <p className="text-[11px] text-muted-foreground/70">
                                    Added to that role&rsquo;s tasks in this department only. Leave any blank. Pin a named agent to a role
                                    and {CEO_NAME} gives them that work.
                                </p>
                            </div>
                            {roles.map((r) => {
                                const fits = roster.filter((a) => a.role === r.key);
                                const others = roster.filter((a) => a.role !== r.key);
                                return (
                                    <div key={r.key} className="space-y-2 rounded-lg border border-white/10 bg-black/20 p-3">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <span className="text-sm font-medium">{r.label}</span>
                                            <select
                                                aria-label={`Pin an agent as ${r.label}`}
                                                className={cn(selectClass, 'h-8 w-auto max-w-full text-xs')}
                                                value={settings.pinned[r.key] ?? ''}
                                                // An empty value is sent, not a missing key: it is what un-pins.
                                                onChange={(e) => setSettings({ ...settings, pinned: { ...settings.pinned, [r.key]: e.target.value } })}
                                            >
                                                <option value="">{CEO_NAME} chooses</option>
                                                {fits.length > 0 && (
                                                    <optgroup label={`${r.label}s`}>
                                                        {fits.map((a) => (
                                                            <option key={a.slug} value={a.slug}>{a.name} — {a.title}</option>
                                                        ))}
                                                    </optgroup>
                                                )}
                                                {others.length > 0 && (
                                                    <optgroup label="Anyone else">
                                                        {others.map((a) => (
                                                            <option key={a.slug} value={a.slug}>{a.name} — {a.title}</option>
                                                        ))}
                                                    </optgroup>
                                                )}
                                            </select>
                                        </div>
                                        <Textarea
                                            aria-label={`Notes for the ${r.label}`}
                                            rows={2}
                                            value={settings.roleNotes[r.key] ?? ''}
                                            onChange={(e) => setSettings({ ...settings, roleNotes: { ...settings.roleNotes, [r.key]: e.target.value } })}
                                            placeholder={r.hint}
                                            className={fieldClass}
                                        />
                                    </div>
                                );
                            })}
                        </div>

                        <Field label={`How much ${CEO_NAME} decides alone`}>
                            <div className="grid grid-cols-1 gap-2 inner:grid-cols-2">
                                {(
                                    [
                                        ['scheduled', 'Run on schedule', 'Approved work starts on its own at its time. You review what it makes.'],
                                        ['ask', 'Ask me first', `Each run waits for your go in the department's room before anything is spent.`],
                                    ] as const
                                ).map(([value, label, hint]) => (
                                    <button
                                        key={value}
                                        type="button"
                                        aria-pressed={settings.autonomy === value}
                                        onClick={() => setSettings({ ...settings, autonomy: value })}
                                        className={cn(
                                            'space-y-1 rounded-lg border p-3 text-left',
                                            settings.autonomy === value ? 'border-emerald-400/50 bg-emerald-400/10' : 'border-white/10 hover:border-white/25'
                                        )}
                                    >
                                        <div className="text-sm font-medium">{label}</div>
                                        <p className="text-[11px] text-muted-foreground">{hint}</p>
                                    </button>
                                ))}
                            </div>
                        </Field>

                        <div className="flex justify-between gap-2">
                            <Button variant="outline" className="border-white/10" onClick={() => go(3)} disabled={pending}>
                                <ArrowLeft className="mr-2 h-4 w-4" /> Back
                            </Button>
                            <Button
                                onClick={() =>
                                    saveSettings(
                                        { houseRules: settings.houseRules, roleNotes: settings.roleNotes, pinned: settings.pinned, autonomy: settings.autonomy },
                                        5
                                    )
                                }
                                disabled={pending}
                            >
                                {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                Save and continue <ArrowRight className="ml-2 h-4 w-4" />
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            )}

            {step === 5 && (
                <div className="space-y-4">
                    <Card className="border-white/10 bg-black/40">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm">{basics.name || draft?.name}</CardTitle>
                            <p className="text-xs text-muted-foreground">
                                {KINDS[k].label} · ${Number(basics.budgetUsd || 0).toFixed(2)} a month
                            </p>
                        </CardHeader>
                        <CardContent className="space-y-3 text-sm">
                            <p className="text-muted-foreground">{basics.charter}</p>
                            {k === 'research' && (
                                <ul className="space-y-1 text-xs text-muted-foreground">
                                    <li>Topics: {settings.research.topics.filter(Boolean).join('; ') || 'as the purpose says'}</li>
                                    <li>Sources: {settings.research.sources.length ? settings.research.sources.map((s) => SOURCE_LABEL[s] ?? s).join(', ') : 'every connected source'}</li>
                                    <li>Report: {REPORT_LENGTH_LABEL[settings.research.report.length]}{settings.research.report.tone ? `, ${settings.research.report.tone}` : ''}</li>
                                    <li>Delivered: {scheduleWords(settings.schedule, timezone)}</li>
                                </ul>
                            )}
                            {k === 'studio' && (
                                <ul className="space-y-1 text-xs text-muted-foreground">
                                    {accounts.length === 0 && <li className="text-amber-300">No channels yet. Add one in step 3.</li>}
                                    {accounts.map((a) => (
                                        <li key={a.id}>
                                            {accountLabel(a)}: {formatsLine(a.preferences)} · {scheduleWords(a.preferences.schedule, timezone)} ·{' '}
                                            {a.preferences.topics === 'cho' ? 'you approve topics' : 'the team picks topics'}
                                            {a.status === 'paused' ? ' · paused' : ''}
                                        </li>
                                    ))}
                                </ul>
                            )}
                            <ul className="space-y-1 text-xs text-muted-foreground">
                                <li>House rules: {settings.houseRules ? settings.houseRules.slice(0, 160) + (settings.houseRules.length > 160 ? '…' : '') : 'none'}</li>
                                <li>
                                    Role notes: {Object.entries(settings.roleNotes).filter(([, v]) => v).length || 'none'}
                                    {Object.entries(settings.pinned).filter(([, v]) => v).length > 0 &&
                                        ` · pinned: ${Object.entries(settings.pinned)
                                            .filter(([, v]) => v)
                                            .map(([role, slug]) => `${roster.find((a) => a.slug === slug)?.name ?? slug} (${role.replace('_', ' ')})`)
                                            .join(', ')}`}
                                </li>
                                <li>{settings.autonomy === 'ask' ? 'Asks you before each run' : 'Runs on schedule'}</li>
                            </ul>
                        </CardContent>
                    </Card>

                    <div className="flex flex-wrap justify-between gap-2">
                        <Button variant="outline" className="border-white/10" onClick={() => go(4)} disabled={pending}>
                            <ArrowLeft className="mr-2 h-4 w-4" /> Back
                        </Button>
                        <div className="flex flex-wrap gap-2">
                            {editing ? (
                                <>
                                    <Button variant="outline" className="border-white/10" onClick={finish} disabled={pending}>
                                        {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                                        Save and re-staff
                                    </Button>
                                    <Button onClick={() => id && router.push(`/dashboard/delphi/departments/${id}`)} disabled={pending}>
                                        <Check className="mr-2 h-4 w-4" /> Done
                                    </Button>
                                </>
                            ) : (
                                <Button onClick={finish} disabled={pending || (k === 'studio' && !accounts.some((a) => a.status === 'active'))}>
                                    {pending ? (
                                        <>
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {CEO_NAME} is staffing…
                                        </>
                                    ) : (
                                        <>
                                            <Sparkles className="mr-2 h-4 w-4" />
                                            {draft?.hasTeam ? `Finish and ask ${CEO_NAME} to re-staff` : `Create and ask ${CEO_NAME} to staff it`}
                                        </>
                                    )}
                                </Button>
                            )}
                        </div>
                    </div>
                    {!editing && draft?.hasTeam && (
                        <p className="text-xs text-muted-foreground">
                            Re-staffing sets the current plan aside. What it already made stays in Outputs; what was still to come is skipped.
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}
