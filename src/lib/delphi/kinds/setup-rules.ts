/**
 * The setup wizard's rules, pure, so they are asserted offline rather than
 * only exercised through a signed-in request.
 */

import { isDepartmentKind, type DepartmentKind, type DepartmentSettings } from './settings';

export interface BasicsInput {
    kind: unknown;
    name: unknown;
    charter: unknown;
    budgetUsd: unknown;
}

export type ValidBasics = { kind: DepartmentKind; name: string; charter: string; budgetUsd: number };

export function validateBasics(input: BasicsInput, ceoName = 'the CEO'): { ok: true; value: ValidBasics } | { ok: false; error: string } {
    if (!isDepartmentKind(input.kind)) return { ok: false, error: 'Pick what kind of department this is.' };
    const name = String(input.name ?? '').trim().slice(0, 80);
    if (name.length < 2) return { ok: false, error: 'Give the department a name.' };
    const charter = String(input.charter ?? '').trim().slice(0, 4000);
    if (charter.length < 20) return { ok: false, error: `Say what the department is for in a sentence or two — ${ceoName} staffs from it.` };
    const budget = Number(input.budgetUsd);
    if (!Number.isFinite(budget) || budget <= 0 || budget > 10_000) return { ok: false, error: 'A monthly budget is a positive amount in dollars.' };
    return { ok: true, value: { kind: input.kind, name, charter, budgetUsd: Math.round(budget * 100) / 100 } };
}

/**
 * Where a draft resumes after a step is saved. It only moves forward — going
 * back to change step 3 does not make the draft forget step 4 was done — and a
 * finished setup stays finished.
 */
export function nextSetup(current: DepartmentSettings['setup'], savedStep: number, reopen = false): DepartmentSettings['setup'] {
    // A department converted to another kind is set up again from here, even
    // one that was finished: its team was made for the old kind.
    if (reopen) return { step: Math.min(5, Math.max(1, savedStep)), complete: false };
    if (current.complete) return current;
    return { step: Math.min(5, Math.max(current.step, savedStep)), complete: false };
}

/** What still stops a department from being staffed, or null. */
export function setupBlocker(
    kind: DepartmentKind,
    charter: string,
    accounts: { status: 'active' | 'paused' }[]
): string | null {
    if (charter.trim().length < 20) return 'Say what the department is for before it is staffed.';
    if (kind === 'studio' && !accounts.some((a) => a.status === 'active')) {
        return 'A content studio needs at least one active channel or page before it can be staffed. Add one in step 3 — a test channel will do.';
    }
    return null;
}

/** A research department whose name or purpose says it makes channel content. */
export function looksLikeStudio(kind: DepartmentKind, name: string, charter: string): boolean {
    if (kind !== 'research') return false;
    return /\b(youtube|tiktok|instagram|reels?|shorts|social media|social|video|channel|posts?|carousel)\b/i.test(`${name} ${charter}`);
}
