/**
 * Prove the CHO's words reach the agent.
 *
 * Sending work back is only a feature if the reason arrives with it. A note
 * that is recorded, shown in the UI, counted towards escalation and then left
 * out of the prompt would look like it was working from every angle except
 * the one that matters — the next attempt would come back unchanged and the
 * fault would be invisible.
 */

import { buildPrompt } from '../src/lib/delphi/runtime';
import { REVISIONS_BEFORE_ESCALATION } from '../src/lib/delphi/revision';

const G = '\x1b[32m', R = '\x1b[31m', D = '\x1b[2m', RS = '\x1b[0m';

let failed = 0;
const ok = (cond: boolean, label: string, note = '') => {
    if (!cond) failed++;
    console.log(`  ${cond ? G + '✓' : R + '✗'}${RS} ${label.padEnd(52)}${note ? D + note + RS : ''}`);
};

const NOTE = 'The momentum screen is empty. Populate it from step 1, or say why it cannot be.';

const base = {
    objective: 'Rank the top 20 momentum equities.',
    projectBrief: 'Weekly market analysis for the CHO.',
    upstream: { title: 'Screening data', contentMd: '...rows...', handoffNote: 'All yours.' },
    handoffDossier: null,
    toolNames: ['fred_series'],
};

console.log('\nSending work back\n' + '─'.repeat(70));

// --- the note reaches the agent -------------------------------------------

const revised = buildPrompt({ ...base, choNote: NOTE, revision: 1 });

ok(revised.includes(NOTE), 'the note is in the prompt, in full');
ok(
    revised.includes('THE CHO SENT YOUR LAST ATTEMPT BACK'),
    'and is announced as the CHO, not as more context'
);
ok(revised.includes('attempt 2'), 'the agent is told which attempt this is');

// Ahead of the brief and the upstream note, because it is the only part of
// the prompt that comes from the person the work is for.
const notePos = revised.indexOf('THE CHO SENT YOUR LAST ATTEMPT BACK');
ok(notePos < revised.indexOf('INPUT FROM THE PREVIOUS AGENT'), 'it outranks the upstream input');
ok(
    revised.includes('Producing the same work again with different'),
    'and rewording is ruled out explicitly'
);

// --- and is absent when there is nothing to say ---------------------------

const fresh = buildPrompt({ ...base, choNote: null });
ok(!fresh.includes('SENT YOUR LAST ATTEMPT BACK'), 'a first attempt carries no revision section');

const cleared = buildPrompt({ ...base, choNote: '', revision: 3 });
ok(!cleared.includes('SENT YOUR LAST ATTEMPT BACK'), 'an answered note leaves nothing behind');

// --- escalation threshold -------------------------------------------------

console.log('\nWhen the agent, not the work, is the problem\n' + '─'.repeat(70));

ok(REVISIONS_BEFORE_ESCALATION === 2, 'escalates on the second refusal', 'one is a miss, two is a pattern');
ok(1 < REVISIONS_BEFORE_ESCALATION, 'the first refusal does not escalate');
ok(2 >= REVISIONS_BEFORE_ESCALATION, 'the second does');

// A taking-over agent gets both, and neither crowds the other out.
const both = buildPrompt({
    ...base,
    choNote: NOTE,
    revision: 2,
    handoffDossier: 'Completed: nothing verified. Remaining: all of it.',
});
ok(both.includes(NOTE), 'a replacement still sees what the CHO asked for');
ok(both.includes('TAKING OVER THIS TASK'), 'alongside the dossier from its predecessor');
ok(
    both.indexOf('THE CHO SENT YOUR LAST ATTEMPT BACK') < both.indexOf('TAKING OVER THIS TASK'),
    'with the CHO first'
);

console.log(`\n${failed ? R + failed + ' failed' : G + 'all passed'}${RS}\n`);
process.exit(failed ? 1 : 0);
