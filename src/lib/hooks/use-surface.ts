'use client';

/**
 * Which surface class is this, and is there a hinge in the way?
 *
 * Delphi runs on three shapes that are not simply three sizes: a folded cover
 * panel you glance at and approve from, an unfolded inner panel that is really
 * a small tablet, and a desktop. Components branch on posture with this rather
 * than every screen being duplicated per platform.
 *
 * Most layout should still be plain CSS — the `cover:`, `inner:` and `desk:`
 * Tailwind variants exist for exactly that. Reach for this hook only when the
 * decision cannot be expressed in CSS, such as choosing how many items to
 * fetch, or whether to mount a panel at all.
 */

import { useEffect, useState } from 'react';

export type Surface = 'cover' | 'inner' | 'desk';

/** Keep in step with the --breakpoint-* tokens in globals.css. */
const INNER_MIN = 600;
const DESK_MIN = 1100;

function surfaceFor(width: number): Surface {
    if (width >= DESK_MIN) return 'desk';
    if (width >= INNER_MIN) return 'inner';
    return 'cover';
}

export interface SurfaceState {
    surface: Surface;
    /** True when the viewport spans two physical panels — i.e. a hinge. */
    spanned: boolean;
    /**
     * CSS length of the hinge gap, for `padding` or a spacer. Empty string when
     * there is no hinge, so it can be dropped into a style value unconditionally.
     */
    hingeGap: string;
}

/**
 * Server render and first paint both assume `desk`.
 *
 * Guessing small and correcting upward makes a desktop load visibly reflow;
 * guessing large only costs a phone one frame, since the CSS variants have
 * already laid the page out correctly before this resolves.
 */
export function useSurface(): SurfaceState {
    const [state, setState] = useState<SurfaceState>({
        surface: 'desk',
        spanned: false,
        hingeGap: '',
    });

    useEffect(() => {
        // The Viewport Segments API is not shipped everywhere, so hinge
        // awareness is progressive enhancement: the layout must be correct
        // without it, and merely better with it.
        const spannedQuery = window.matchMedia('(horizontal-viewport-segments: 2)');

        const read = () => {
            const spanned = spannedQuery.matches;
            setState({
                surface: surfaceFor(window.innerWidth),
                spanned,
                hingeGap: spanned
                    ? 'calc(env(viewport-segment-left-1-left, 0px) - env(viewport-segment-right-0-right, 0px))'
                    : '',
            });
        };

        read();
        window.addEventListener('resize', read);
        spannedQuery.addEventListener?.('change', read);

        return () => {
            window.removeEventListener('resize', read);
            spannedQuery.removeEventListener?.('change', read);
        };
    }, []);

    return state;
}
