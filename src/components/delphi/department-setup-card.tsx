/**
 * How a department is set up, at a glance, with the way back into the wizard.
 *
 * Also carries the two prompts a department can need: a draft whose setup was
 * never finished, and a department that is really a content studio but was
 * made before kinds existed.
 */

import Link from 'next/link';
import { ArrowRight, Clapperboard, Settings2, TriangleAlert } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { KINDS, looksLikeStudio, REPORT_LENGTH_LABEL, roleInfo, scheduleWords, type DepartmentKind, type DepartmentSettings, type RoleKey } from '@/lib/delphi/kinds';

export function DepartmentSetupCard({
    departmentId,
    kind,
    name,
    charter,
    settings,
    canEdit,
}: {
    departmentId: string;
    kind: DepartmentKind;
    name: string;
    charter: string;
    settings: DepartmentSettings;
    canEdit: boolean;
}) {
    const base = `/dashboard/delphi/departments/new?draft=${departmentId}`;
    const notes = Object.entries(settings.roleNotes).filter(([, v]) => v) as [RoleKey, string][];
    const pins = Object.entries(settings.pinned).filter(([, v]) => v) as [RoleKey, string][];

    return (
        <div className="space-y-3">
            {canEdit && !settings.setup.complete && (
                <Card className="border-amber-400/30 bg-amber-400/5">
                    <CardContent className="flex flex-col items-start gap-2 py-4 inner:flex-row inner:items-center inner:gap-3">
                        <TriangleAlert className="h-4 w-4 shrink-0 text-amber-300" />
                        <p className="min-w-0 text-sm text-amber-200 inner:flex-1">This department&rsquo;s setup isn&rsquo;t finished, so it hasn&rsquo;t been staffed.</p>
                        <Link href={`${base}&step=${settings.setup.step}`} className="inline-flex shrink-0 items-center gap-1 text-sm text-amber-200 underline-offset-4 hover:underline">
                            Continue setup <ArrowRight className="h-3.5 w-3.5" />
                        </Link>
                    </CardContent>
                </Card>
            )}

            {canEdit && looksLikeStudio(kind, name, charter) && (
                <Card className="border-sky-400/30 bg-sky-400/5">
                    <CardContent className="flex flex-col items-start gap-2 py-4 inner:flex-row inner:items-center inner:gap-3">
                        <Clapperboard className="h-4 w-4 shrink-0 text-sky-300" />
                        <p className="min-w-0 text-sm text-sky-100 inner:flex-1">
                            This looks like a content department. As a content studio it gets channels kept apart from each other,
                            a schedule and topics per channel, and real videos and images.
                        </p>
                        <Link href={`${base}&convert=studio`} className="inline-flex shrink-0 items-center gap-1 text-sm text-sky-200 underline-offset-4 hover:underline">
                            Convert to a content studio <ArrowRight className="h-3.5 w-3.5" />
                        </Link>
                    </CardContent>
                </Card>
            )}

            <Card className="border-white/10 bg-black/40">
                <CardHeader className="pb-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <CardTitle className="flex items-center gap-2 text-sm">
                            <Settings2 className="h-4 w-4" /> How this department works
                        </CardTitle>
                        {canEdit && (
                            <Link href={`${base}&step=${kind === 'general' ? 4 : 3}`} className="text-xs text-sky-400 hover:underline">
                                Edit setup
                            </Link>
                        )}
                    </div>
                    <p className="text-xs text-muted-foreground">{KINDS[kind].label}. {KINDS[kind].blurb}</p>
                </CardHeader>
                <CardContent className="space-y-1.5 text-xs text-muted-foreground">
                    {kind === 'research' && (
                        <>
                            {settings.research.topics.length > 0 && <p>Topics: {settings.research.topics.join('; ')}</p>}
                            <p>Sources: {settings.research.sources.length ? settings.research.sources.join(', ') : 'every connected source'}</p>
                            <p>
                                Report: {REPORT_LENGTH_LABEL[settings.research.report.length]}
                                {settings.research.report.tone ? `, ${settings.research.report.tone}` : ''}
                            </p>
                            <p>Delivered: {scheduleWords(settings.schedule, settings.timezone)}</p>
                        </>
                    )}
                    {kind === 'general' && <p>Runs: {scheduleWords(settings.schedule, settings.timezone)}</p>}
                    <p>House rules: {settings.houseRules ? settings.houseRules : 'none set'}</p>
                    {notes.length > 0 && (
                        <ul className="space-y-0.5">
                            {notes.map(([role, note]) => (
                                <li key={role}>
                                    <span className="text-zinc-300">{roleInfo(role).label}:</span> {note}
                                </li>
                            ))}
                        </ul>
                    )}
                    {pins.length > 0 && <p>Pinned: {pins.map(([role, slug]) => `${slug} as ${roleInfo(role).label.toLowerCase()}`).join(', ')}</p>}
                    <p>{settings.autonomy === 'ask' ? 'Asks you before each run.' : 'Runs on its schedule; you review what it makes.'}</p>
                </CardContent>
            </Card>
        </div>
    );
}
