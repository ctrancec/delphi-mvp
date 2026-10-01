/**
 * Acting on several deliverables at once.
 *
 * A bulk action is the same decision made for several items, not a way round
 * any rule a single one obeys: each item still goes through the action that
 * handles it alone, and is refused for the same reasons. What is new is what
 * only arises with several — two versions of one step in the same batch, and
 * a combined account of what deleting them would touch.
 *
 * Pure, so it can be tested without a database. `cho-review.ts` and
 * `trash.ts` wrap it as the CHO's server actions.
 */

import type { DeletionImpact } from './deletion';

/** More than this in one go is a different job — and a long wait. */
export const MAX_BULK = 100;

export interface BulkSkip {
    id: string;
    title: string;
    reason: string;
}

export interface BulkResult {
    ok: boolean;
    /** Set when the call as a whole could not run. */
    error?: string;
    done: number;
    skipped: BulkSkip[];
}

/** Run `fn` over items a few at a time: quicker than one by one, gentler than all at once. */
export async function eachLimited<T, R>(items: T[], fn: (item: T) => Promise<R>, width = 8): Promise<R[]> {
    const out: R[] = [];
    for (let i = 0; i < items.length; i += width) out.push(...(await Promise.all(items.slice(i, i + width).map(fn))));
    return out;
}

/** The ids to act on, de-duplicated and within the cap — or why not. */
export function checkBatch(ids: string[]): { ids: string[] } | { error: string } {
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) return { error: 'Nothing is selected.' };
    if (unique.length > MAX_BULK) return { error: `Select at most ${MAX_BULK} at a time.` };
    return { ids: unique };
}

export interface ReviewCandidate {
    id: string;
    title: string;
    taskId: string | null;
    reviewStatus: string;
    deletedAt: string | null;
    createdAt: string;
}

/**
 * Which of the selected deliverables a verdict applies to, and why the rest
 * are left alone.
 *
 * Sending back is per step, not per file: two versions of one step in the
 * same batch would send that step back twice, which counts as two refusals
 * and hands it to a new agent. So only the newest version of each goes.
 */
export function chooseForReview(
    rows: ReviewCandidate[],
    decision: 'approved' | 'declined'
): { act: ReviewCandidate[]; skipped: BulkSkip[] } {
    const act: ReviewCandidate[] = [];
    const skipped: BulkSkip[] = [];
    const steps = new Set<string>();
    const skip = (r: ReviewCandidate, reason: string) => skipped.push({ id: r.id, title: r.title, reason });

    // Newest first, so the version kept for a step is its latest.
    for (const r of [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
        if (r.deletedAt) {
            skip(r, 'it is in the trash — restore it first');
            continue;
        }
        if (r.reviewStatus === 'superseded') {
            skip(r, 'a later version replaced it');
            continue;
        }
        if (decision === 'declined') {
            if (!r.taskId) {
                skip(r, 'there is no step behind it to redo');
                continue;
            }
            if (steps.has(r.taskId)) {
                skip(r, 'a newer version of the same step is in this batch');
                continue;
            }
            steps.add(r.taskId);
        }
        if (r.reviewStatus === decision) {
            skip(r, decision === 'approved' ? 'it is already accepted' : 'it is already sent back');
            continue;
        }
        act.push(r);
    }
    return { act, skipped };
}

export interface CombinedImpact {
    count: number;
    /** Later steps built on any of them — named once each. */
    dependants: { seq: number; title: string }[];
    /** How many are the last surviving version of their step. */
    onlyVersions: number;
    /** How many carry a stored file. */
    files: number;
    /** How many the CHO had accepted. */
    accepted: number;
}

/** What deleting several would touch, counted together rather than warned about. */
export function combineImpact(impacts: DeletionImpact[]): CombinedImpact {
    const steps = new Map<string, { seq: number; title: string }>();
    for (const i of impacts) for (const d of i.dependants) steps.set(`${d.seq}:${d.title}`, d);
    return {
        count: impacts.length,
        dependants: [...steps.values()].sort((a, b) => a.seq - b.seq),
        onlyVersions: impacts.filter((i) => i.onlyVersion).length,
        files: impacts.filter((i) => i.hasFile).length,
        accepted: impacts.filter((i) => i.reviewStatus === 'approved').length,
    };
}
