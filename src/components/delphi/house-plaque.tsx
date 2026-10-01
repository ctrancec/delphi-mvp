import Link from 'next/link';
import type { CSSProperties } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AgentSprite } from '@/components/pixel/agent-sprite';
import type { FloorAgent, FloorDepartment } from '@/lib/delphi/floor';
import { formatUsd } from '@/lib/llm/cost';
import type { AgentState } from '@/lib/pixel/animate';
import { buildingKind, DESKS_PER_HOUSE } from '@/lib/pixel/world-layout';
import { roofFor, wallFor } from '@/lib/pixel/world-scene';

/**
 * A department's card, as the plaque on its house: the same roof colour and
 * the same walls as the building in the town, the team standing in front in
 * whatever they are doing, and the quest in progress. The colours come from
 * the tiles themselves, so a plaque and its house can never disagree.
 */

export interface PlaqueDepartment {
    id: string;
    name: string;
    status: string;
    charter: string | null;
    budgetUsd: number;
    spentUsd: number;
    cadenceCron: string | null;
}

export const STATUS_STYLES: Record<string, string> = {
    draft: 'text-muted-foreground border-white/15',
    hiring: 'text-amber-400 border-amber-400/30',
    awaiting_approval: 'text-amber-400 border-amber-400/30',
    active: 'text-emerald-400 border-emerald-400/30',
    paused: 'text-muted-foreground border-white/15',
    archived: 'text-muted-foreground border-white/10',
};

/** The roof strip: the house's colour, a scaffold while it is being built, dark once boarded. */
function roofStyle(id: string, status: string): CSSProperties {
    const kind = buildingKind(status);
    if (kind === 'site') return { backgroundImage: 'repeating-linear-gradient(45deg, #cfae7e 0 4px, #6a4226 4px 8px)' };
    if (kind === 'boarded') return { backgroundColor: '#2a2d3a', boxShadow: 'inset 0 -3px 0 #1a1423' };
    const roof = roofFor(id);
    return { backgroundColor: roof.tile, boxShadow: `inset 0 -3px 0 ${roof.shade}` };
}

/** The wall strip, in CSS, from the same colours as the wall tiles. */
function wallStyle(id: string, status: string): CSSProperties {
    if (buildingKind(status) === 'site') return { backgroundColor: '#b59463', opacity: 0.5 };
    const wall = wallFor(id);
    switch (wall.material) {
        case 'timber':
            return { backgroundColor: wall.base, backgroundImage: `repeating-linear-gradient(90deg, ${wall.detail} 0 2px, transparent 2px 14px)` };
        case 'brick':
            return {
                backgroundColor: wall.base,
                backgroundImage: `repeating-linear-gradient(0deg, ${wall.detail} 0 1px, transparent 1px 4px), repeating-linear-gradient(90deg, ${wall.detail} 0 1px, transparent 1px 9px)`,
            };
        default:
            return {
                backgroundColor: wall.base,
                backgroundImage: `repeating-linear-gradient(0deg, ${wall.detail} 0 1px, transparent 1px 4px), repeating-linear-gradient(90deg, ${wall.detail} 0 1px, transparent 1px 7px)`,
            };
    }
}

/** What an agent is doing here: their state at this house, idle when their task is in another. */
function stateAt(agent: FloorAgent, departmentId: string): AgentState {
    if (agent.task && agent.task.departmentId && agent.task.departmentId !== departmentId) return 'idle';
    return agent.state;
}

export function HousePlaque({ department, house, team }: { department: PlaqueDepartment; house: FloorDepartment | null; team: FloorAgent[] }) {
    const d = department;
    const shown = team.slice(0, DESKS_PER_HOUSE);
    const more = team.length - shown.length;
    return (
        <Link href={`/dashboard/delphi/departments/${d.id}`} className="block h-full">
            <Card className="h-full overflow-hidden border-white/10 bg-black/40 transition-colors hover:border-white/25">
                <div aria-hidden="true" className="h-2.5" style={roofStyle(d.id, d.status)} />
                <div aria-hidden="true" className="h-1.5" style={wallStyle(d.id, d.status)} />
                <CardHeader className="flex flex-row items-start justify-between gap-3 pb-2 pt-3">
                    <CardTitle className="text-base leading-tight">{d.name}</CardTitle>
                    <Badge variant="outline" className={STATUS_STYLES[d.status] ?? ''}>
                        {d.status.replace('_', ' ')}
                    </Badge>
                </CardHeader>
                <CardContent className="space-y-3">
                    {shown.length > 0 && (
                        <div className="flex items-end gap-1" role="group" aria-label={`Team: ${team.map((a) => a.name).join(', ')}`}>
                            {shown.map((a) => (
                                <AgentSprite key={a.id} agent={{ slug: a.slug, name: a.name, avatarSeed: a.avatarSeed }} state={stateAt(a, d.id)} scale={2} />
                            ))}
                            {more > 0 && <span className="pb-1 text-xs text-muted-foreground">+{more}</span>}
                        </div>
                    )}
                    {d.charter && <p className="line-clamp-2 text-sm text-muted-foreground">{d.charter}</p>}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        {house?.project ? (
                            <span className="truncate text-sky-300" title={`Running: ${house.project.title}`}>
                                Running: {house.project.title}
                            </span>
                        ) : null}
                        {house && house.completed > 0 ? <span>{house.completed} completed</span> : null}
                        <span>
                            {formatUsd(d.spentUsd)} / {formatUsd(d.budgetUsd)}
                        </span>
                        {d.cadenceCron && <span className="font-mono">{d.cadenceCron}</span>}
                    </div>
                </CardContent>
            </Card>
        </Link>
    );
}
