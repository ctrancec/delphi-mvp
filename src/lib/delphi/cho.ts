/**
 * What to call the CHO.
 *
 * The person signed in is the CHO. The town, the log and Diablo call them by
 * the name they gave when they signed up, or set since in Account settings;
 * a Google sign-in brings a name with it. Until there is one, they go by the
 * cast's name for the role, so nothing is ever blank.
 *
 * Pure, and never a database read: the name rides on the auth user, which
 * every request already has.
 */

import { CHO_NAME } from '@/lib/pixel/cast/names';

/** Long enough for any name, short enough to fit a label. */
export const NAME_MAX = 40;

type UserLike = { user_metadata?: Record<string, unknown> | null } | null | undefined;

/** A name as a person typed it: one line, trimmed, and no longer than a label can hold. */
export function cleanName(input: unknown): string {
    if (typeof input !== 'string') return '';
    return input
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, NAME_MAX);
}

/** The CHO's name: their own when they have given one, the cast's until then. */
export function choNameOf(user: UserLike): string {
    const meta = user?.user_metadata ?? {};
    return cleanName(meta.full_name) || cleanName(meta.name) || CHO_NAME;
}

/** True once the CHO has a name of their own, rather than the role's. */
export function hasOwnName(user: UserLike): boolean {
    return choNameOf(user) !== CHO_NAME;
}
