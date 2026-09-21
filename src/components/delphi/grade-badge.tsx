/**
 * One agent's grade, as something you can argue with.
 *
 * A number on its own invites trust it has not earned — this is an LLM judging
 * an LLM. So the reasoning travels with it, and the unsourced-claim count is
 * shown separately because that part is counted rather than judged and is the
 * only figure here that is not a matter of opinion.
 */

import { AlertTriangle, UserMinus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export interface GradeRow {
    id: string;
    overall: number;
    accuracy_score: number | null;
    completeness_score: number | null;
    adherence_score: number | null;
    efficiency_score: number | null;
    reasoning: string;
    unsourced_claims: number;
    triggered_replacement: boolean;
}

export function toneFor(overall: number): string {
    if (overall >= 0.75) return 'text-emerald-400 border-emerald-400/30';
    if (overall >= 0.45) return 'text-amber-400 border-amber-400/30';
    return 'text-red-400 border-red-400/30';
}

export function GradeBadge({ overall, className }: { overall: number; className?: string }) {
    return (
        <Badge variant="outline" className={cn('text-[10px]', toneFor(overall), className)}>
            {(overall * 100).toFixed(0)}%
        </Badge>
    );
}

function Dimension({ label, value }: { label: string; value: number | null }) {
    if (value === null) return null;
    return (
        <div className="space-y-1">
            <div className="flex items-baseline justify-between gap-2">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
                <span className="font-mono text-[11px] text-zinc-300">{(value * 100).toFixed(0)}</span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-white/5">
                <div
                    className={cn(
                        'h-full rounded-full',
                        value >= 0.75 ? 'bg-emerald-400/60' : value >= 0.45 ? 'bg-amber-400/60' : 'bg-red-400/60'
                    )}
                    style={{ width: `${Math.round(value * 100)}%` }}
                />
            </div>
        </div>
    );
}

export function GradeCard({ grade }: { grade: GradeRow }) {
    return (
        <div className="space-y-3 rounded-lg border border-white/10 bg-black/40 p-4">
            <div className="flex flex-wrap items-center gap-2">
                <GradeBadge overall={Number(grade.overall)} />
                {grade.unsourced_claims > 0 && (
                    <span className="flex items-center gap-1 text-[11px] text-red-400">
                        <AlertTriangle className="h-3 w-3" />
                        {grade.unsourced_claims} unsourced claim
                        {grade.unsourced_claims === 1 ? '' : 's'}
                    </span>
                )}
                {grade.triggered_replacement && (
                    <span className="flex items-center gap-1 text-[11px] text-amber-400">
                        <UserMinus className="h-3 w-3" />
                        replaced
                    </span>
                )}
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-2 desk:grid-cols-4">
                <Dimension label="Accuracy" value={grade.accuracy_score} />
                <Dimension label="Complete" value={grade.completeness_score} />
                <Dimension label="Adherence" value={grade.adherence_score} />
                <Dimension label="Efficiency" value={grade.efficiency_score} />
            </div>

            <p className="text-xs leading-relaxed text-muted-foreground">{grade.reasoning}</p>
        </div>
    );
}
