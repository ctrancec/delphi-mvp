'use client';

/**
 * Managing a department.
 *
 * Archiving is offered first and deleting is made deliberately awkward,
 * because the cascade is much wider than the button implies — deliverables,
 * the activity log that made them traceable, and the lessons learned all go
 * with it. The confirmation names the counts rather than warning in the
 * abstract, so the decision is made against what is actually at stake.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Archive, Check, Loader2, RotateCcw, Trash2, TriangleAlert } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
    deleteDepartmentAction,
    departmentDeletionImpactAction,
    setDepartmentArchivedAction,
    updateDepartmentAction,
    type DeletionImpact,
} from '@/lib/delphi/manage';

export function DepartmentSettings({
    departmentId,
    name,
    charter,
    budgetUsd,
    cadenceCron,
    archived,
}: {
    departmentId: string;
    name: string;
    charter: string;
    budgetUsd: number;
    cadenceCron: string | null;
    archived: boolean;
}) {
    const router = useRouter();
    const [form, setForm] = useState({ name, charter, budgetUsd: String(budgetUsd), cadenceCron: cadenceCron ?? '' });
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [pending, startTransition] = useTransition();

    const [impact, setImpact] = useState<DeletionImpact | null>(null);
    const [confirmName, setConfirmName] = useState('');

    const dirty =
        form.name !== name ||
        form.charter !== charter ||
        form.budgetUsd !== String(budgetUsd) ||
        form.cadenceCron !== (cadenceCron ?? '');

    function save() {
        setError(null);
        setSaved(false);
        startTransition(async () => {
            const res = await updateDepartmentAction(departmentId, {
                name: form.name,
                charter: form.charter,
                budgetUsd: Number(form.budgetUsd),
                cadenceCron: form.cadenceCron || null,
            });
            if (res.ok) {
                setSaved(true);
                router.refresh();
            } else {
                setError(res.error ?? 'Could not save.');
            }
        });
    }

    function toggleArchive() {
        setError(null);
        startTransition(async () => {
            const res = await setDepartmentArchivedAction(departmentId, !archived);
            if (res.ok) router.refresh();
            else setError(res.error ?? 'Could not change that.');
        });
    }

    function loadImpact() {
        setError(null);
        startTransition(async () => {
            const res = await departmentDeletionImpactAction(departmentId);
            if (res.ok && res.data) setImpact(res.data);
            else setError(res.error ?? 'Could not work out what this would delete.');
        });
    }

    function destroy() {
        setError(null);
        startTransition(async () => {
            const res = await deleteDepartmentAction(departmentId, confirmName);
            if (res.ok) router.push('/dashboard/delphi');
            else setError(res.error ?? 'Could not delete it.');
        });
    }

    return (
        <Card className="border-white/10 bg-black/40">
            <CardHeader className="pb-3">
                <CardTitle className="text-sm">Settings</CardTitle>
                <p className="text-xs text-muted-foreground">
                    Editing the charter does not re-staff the team — they were hired against the old
                    one. Ask Delphi to staff it again when you want the change reflected.
                </p>
            </CardHeader>

            <CardContent className="space-y-4">
                <div className="space-y-2">
                    <Label htmlFor="dept-name">Name</Label>
                    <Input
                        id="dept-name"
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                        className="border-white/10 bg-white/5"
                    />
                </div>

                <div className="space-y-2">
                    <Label htmlFor="dept-charter">Charter</Label>
                    <Textarea
                        id="dept-charter"
                        rows={4}
                        value={form.charter}
                        onChange={(e) => setForm({ ...form, charter: e.target.value })}
                        className="border-white/10 bg-white/5 text-sm"
                    />
                </div>

                <div className="grid gap-4 inner:grid-cols-2">
                    <div className="space-y-2">
                        <Label htmlFor="dept-budget">Budget cap (USD)</Label>
                        <Input
                            id="dept-budget"
                            type="number"
                            step="0.5"
                            min="0"
                            value={form.budgetUsd}
                            onChange={(e) => setForm({ ...form, budgetUsd: e.target.value })}
                            className="border-white/10 bg-white/5"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="dept-cadence">Cadence</Label>
                        <Input
                            id="dept-cadence"
                            value={form.cadenceCron}
                            onChange={(e) => setForm({ ...form, cadenceCron: e.target.value })}
                            placeholder="0 7 * * 1-5"
                            className="border-white/10 bg-white/5 font-mono text-xs"
                        />
                        <p className="text-[11px] text-muted-foreground/60">
                            Five fields, or empty. Weekday mornings is <code>0 7 * * 1-5</code>.
                        </p>
                    </div>
                </div>

                {error && (
                    <p className="flex items-start gap-2 text-sm text-red-400">
                        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                        {error}
                    </p>
                )}

                <div className="flex flex-wrap items-center gap-3">
                    <Button onClick={save} disabled={pending || !dirty} size="sm">
                        {pending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                        Save changes
                    </Button>
                    {saved && !dirty && (
                        <span className="flex items-center gap-1.5 text-xs text-emerald-400">
                            <Check className="h-3.5 w-3.5" /> Saved
                        </span>
                    )}

                    <Button
                        onClick={toggleArchive}
                        disabled={pending}
                        size="sm"
                        variant="outline"
                        className="ml-auto border-white/10"
                    >
                        {archived ? (
                            <>
                                <RotateCcw className="mr-2 h-3.5 w-3.5" /> Restore
                            </>
                        ) : (
                            <>
                                <Archive className="mr-2 h-3.5 w-3.5" /> Archive
                            </>
                        )}
                    </Button>
                </div>

                <div className="space-y-3 rounded-lg border border-red-400/20 bg-red-400/5 p-4">
                    <div>
                        <p className="text-sm font-medium text-red-400">Delete permanently</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                            Archiving stops a department and hides it while keeping everything. Deleting
                            does not — and it reaches further than it looks.
                        </p>
                    </div>

                    {!impact ? (
                        <Button
                            onClick={loadImpact}
                            disabled={pending}
                            size="sm"
                            variant="outline"
                            className="border-red-400/30 text-red-400 hover:bg-red-400/10 hover:text-red-300"
                        >
                            {pending ? (
                                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                            ) : (
                                <Trash2 className="mr-2 h-3.5 w-3.5" />
                            )}
                            Show me what this would delete
                        </Button>
                    ) : (
                        <div className="space-y-3">
                            <ul className="space-y-0.5 text-xs text-muted-foreground">
                                <li>{impact.projects} run{impact.projects === 1 ? '' : 's'}</li>
                                <li>{impact.tasks} task{impact.tasks === 1 ? '' : 's'}</li>
                                <li className={impact.artifacts > 0 ? 'text-red-400' : undefined}>
                                    {impact.artifacts} deliverable{impact.artifacts === 1 ? '' : 's'}
                                    {impact.artifacts > 0 && ' — these are your reports'}
                                </li>
                                <li className={impact.memories > 0 ? 'text-amber-400' : undefined}>
                                    {impact.memories} remembered lesson{impact.memories === 1 ? '' : 's'}
                                    {impact.memories > 0 && ' — Delphi forgets these'}
                                </li>
                                <li>
                                    {impact.events} activity log entr{impact.events === 1 ? 'y' : 'ies'} — the
                                    trail that makes a claim traceable
                                </li>
                            </ul>

                            <div className="space-y-2">
                                <Label htmlFor="confirm-name" className="text-xs">
                                    Type <span className="font-mono text-zinc-200">{impact.name}</span> to confirm
                                </Label>
                                <Input
                                    id="confirm-name"
                                    value={confirmName}
                                    onChange={(e) => setConfirmName(e.target.value)}
                                    className="border-red-400/20 bg-white/5"
                                />
                            </div>

                            <div className="flex flex-wrap gap-2">
                                <Button
                                    onClick={destroy}
                                    disabled={pending || confirmName.trim() !== impact.name}
                                    size="sm"
                                    variant="outline"
                                    className="border-red-400/30 text-red-400 hover:bg-red-400/10 hover:text-red-300"
                                >
                                    {pending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                                    Delete it all
                                </Button>
                                <Button
                                    onClick={() => {
                                        setImpact(null);
                                        setConfirmName('');
                                    }}
                                    disabled={pending}
                                    size="sm"
                                    variant="outline"
                                    className="border-white/10"
                                >
                                    Cancel
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}
