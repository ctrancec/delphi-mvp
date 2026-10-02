/**
 * What the town makes of the news.
 *
 * Each reading of the floor carries the newest lines of the activity log.
 * The lines seen for the first time are what the town reacts to: a finished
 * task has its agent carry the work to Rimuru; a failed one sends them to
 * Diablo's study to report it; an approval granted has the whole house
 * cheer. Nothing is inferred from state going from one thing to another,
 * because a decline and an approval look the same from the outside and
 * only the log knows which it was.
 *
 * Pure: the same log read twice yields the same ceremonies once.
 */

import { agentForActor, isCho } from '@/lib/delphi/actors';
import type { Floor } from '@/lib/delphi/floor';

export type CeremonyKind = 'deliver' | 'report' | 'cheer';

export interface Ceremony {
    kind: CeremonyKind;
    agentId: string;
    eventId: number;
}

/** The newest event id in a reading, or `fallback` when there is none. */
export function newestEvent(floor: Floor, fallback = 0): number {
    return floor.recent.reduce((m, e) => Math.max(m, e.id), fallback);
}

/**
 * Ceremonies for the lines newer than `seenUpTo`, and the id to remember
 * for next time. At most one of each kind per agent per reading.
 */
export function ceremoniesFrom(seenUpTo: number, floor: Floor): { ceremonies: Ceremony[]; seenUpTo: number } {
    const fresh = floor.recent.filter((e) => e.id > seenUpTo).sort((a, b) => a.id - b.id);
    const ceremonies: Ceremony[] = [];
    const given = new Set<string>();
    const add = (kind: CeremonyKind, agentId: string, eventId: number) => {
        const key = `${kind}:${agentId}`;
        if (given.has(key)) return;
        given.add(key);
        ceremonies.push({ kind, agentId, eventId });
    };

    for (const e of fresh) {
        if (e.type === 'task_done' || e.type === 'task_failed') {
            // A step the CHO removed is logged as a failure too; nobody reports that to Diablo.
            if (!e.actor || isCho(e.actor, floor.cho)) continue;
            const who = agentForActor(e.actor, floor.agents);
            if (who) add(e.type === 'task_done' ? 'deliver' : 'report', who.id, e.id);
        } else if (e.type === 'approval_decided' && e.verb?.startsWith('approved')) {
            const house =
                floor.departments.find((d) => d.project?.id === e.projectId) ??
                (e.departmentId ? floor.departments.find((d) => d.id === e.departmentId) : undefined);
            for (const id of house?.team ?? []) add('cheer', id, e.id);
        }
    }

    return { ceremonies, seenUpTo: newestEvent(floor, seenUpTo) };
}
