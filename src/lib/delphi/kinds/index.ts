/**
 * Department kinds.
 *
 * A research department and a YouTube studio are set up differently, laid out
 * differently, staffed under different rules and run on different rhythms.
 * Each kind says so here, in one place, rather than in conditionals scattered
 * across the pages, the planner and the runtime.
 */

import type { DepartmentKind } from './settings';

export * from './settings';
export * from './setup-rules';

export interface KindInfo {
    kind: DepartmentKind;
    label: string;
    /** One line, on the wizard's first step. */
    blurb: string;
    /** What step 3 of the wizard asks for. */
    setup: 'research' | 'studio' | 'general';
    /** Added to the CEO's staffing prompt for departments of this kind. */
    planningRules: string;
    /** A charter to start from, so a new department staffs well. */
    examplePurpose: string;
}

export const KINDS: Record<DepartmentKind, KindInfo> = {
    research: {
        kind: 'research',
        label: 'Research & reports',
        blurb: 'Finds out what is true and reports it to you, sourced, on a schedule.',
        setup: 'research',
        planningRules: [
            'THIS IS A RESEARCH DEPARTMENT.',
            '- Every run produces one report for the CHO. Plan the chain that gets there: gather, analyse, write, check.',
            '- Gathering goes to agents holding the sources the CHO chose for this department. If a needed source is not among them, say so in the summary rather than working around it.',
            '- The report follows the shape the CHO set below: its length, its sections, its tone.',
        ].join('\n'),
        examplePurpose:
            'Every weekday morning, brief me on the market moves and news that affect my positions. Lead with what changed overnight, anchor every claim to a real figure, and flag anything only one outlet is reporting.',
    },
    studio: {
        kind: 'studio',
        label: 'Content studio',
        blurb: 'Makes videos and images for your YouTube channels and social pages, one channel at a time.',
        setup: 'studio',
        planningRules: [
            'THIS IS A CONTENT STUDIO.',
            '- It produces for the channels listed below. Each channel is separate: its own script, its own render, its own voice. Research may be shared; nothing else is.',
            '- Follow the CHO\'s house rules and the notes for each role exactly. They are the standing brief.',
        ].join('\n'),
        examplePurpose:
            'Make short videos for my channels from current topics in their niches: researched, scripted in each channel\'s voice, rendered with captions. Nothing is posted without me.',
    },
    general: {
        kind: 'general',
        label: 'Something else',
        blurb: 'Anything that is neither reports nor channel content. You describe it; the CEO staffs it.',
        setup: 'general',
        planningRules: '',
        examplePurpose: '',
    },
};

export function kindInfo(kind: DepartmentKind): KindInfo {
    return KINDS[kind] ?? KINDS.research;
}
