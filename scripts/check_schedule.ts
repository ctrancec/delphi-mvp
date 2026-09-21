/**
 * Prove the switch and the schedule can coexist.
 *
 * Two controls over the same thing is where systems get confusing, and every
 * failure here is quiet: agents that work at 3am, or — worse — agents that
 * never start because an override from Tuesday is still holding them and
 * nothing says so. None of it surfaces as an error, so it needs asserting.
 *
 * The awkward cases are the point. A window that runs through midnight, the
 * day such a window belongs to, a timezone that is not the server's, and an
 * override that has to expire on its own.
 */

import {
    DEFAULT_SCHEDULE,
    effectiveState,
    isWithinHours,
    nextBoundary,
    switchIntent,
    type SystemState,
    type WorkSchedule,
} from '../src/lib/delphi/schedule';

const G = '\x1b[32m', R = '\x1b[31m', D = '\x1b[2m', RS = '\x1b[0m';

let failed = 0;
const ok = (cond: boolean, label: string, note = '') => {
    if (!cond) failed++;
    console.log(`  ${cond ? G + '✓' : R + '✗'}${RS} ${label.padEnd(54)}${note ? D + note + RS : ''}`);
};

const hours = (over: Partial<WorkSchedule> = {}): WorkSchedule => ({
    ...DEFAULT_SCHEDULE,
    enabled: true,
    start: '09:00',
    end: '17:00',
    days: [1, 2, 3, 4, 5],
    timezone: 'UTC',
    ...over,
});

const state = (over: Partial<SystemState> = {}): SystemState => ({
    mode: 'running',
    schedule: hours(),
    override: null,
    ...over,
});

// 2026-09-21 is a Monday.
const MON_10AM = new Date('2026-09-21T10:00:00Z');
const MON_3AM = new Date('2026-09-21T03:00:00Z');
const SAT_10AM = new Date('2026-09-26T10:00:00Z');

console.log('\nThe schedule decides the rhythm\n' + '─'.repeat(70));

ok(effectiveState(state(), MON_10AM).mode === 'running', 'inside hours on a working day, it works');
ok(
    effectiveState(state(), MON_3AM).mode === 'paused',
    'outside them it does not, whatever the switch says',
    effectiveState(state(), MON_3AM).reason
);
ok(effectiveState(state(), SAT_10AM).mode === 'paused', 'and not at all on a day you did not pick');

ok(
    effectiveState(state({ schedule: hours({ enabled: false }) }), MON_3AM).mode === 'running',
    'with hours off, the switch alone decides',
    'the behaviour that predates all this'
);

// An emergency stop a schedule could undo at 9am would not be a stop.
ok(
    effectiveState(state({ mode: 'stopped' }), MON_10AM).mode === 'stopped',
    'stopped beats the schedule',
    'an emergency stop is not a suggestion'
);

console.log('\nThe switch decides right now\n' + '─'.repeat(70));

// Asking for work while the window is shut.
const runNow = switchIntent(state(), 'running', MON_3AM);
ok(runNow.override?.mode === 'run', 'switching on outside hours overrides them');
ok(
    Boolean(runNow.override && new Date(runNow.override.until) > MON_3AM),
    'and expires at the next boundary',
    runNow.override ? new Date(runNow.override.until).toISOString().slice(11, 16) + ' UTC' : '—'
);
ok(
    effectiveState(state({ override: runNow.override }), MON_3AM).mode === 'running',
    'so the agents work through the closed window'
);

// Asking for quiet while it is open.
const holdNow = switchIntent(state(), 'paused', MON_10AM);
ok(holdNow.override?.mode === 'hold', 'switching off inside hours holds them');
ok(
    effectiveState(state({ mode: 'paused', override: holdNow.override }), MON_10AM).mode === 'paused',
    'and they stay held while the window is open'
);

// The property that keeps both controls honest.
const stale = { mode: 'hold' as const, until: '2026-09-21T09:00:00Z' };
ok(
    effectiveState(state({ mode: 'paused', override: stale }), MON_10AM).reason === 'switch',
    'a lapsed override stops deciding anything',
    'you cannot switch them off by accident for a week'
);

// Writing a schedule is an argument the old override was not part of.
ok(switchIntent(state(), 'stopped', MON_10AM).override === null, 'stopping clears any override');
ok(
    switchIntent(state({ schedule: hours({ enabled: false }) }), 'paused', MON_10AM).override === null,
    'and no override is written when there are no hours to fight'
);

console.log('\nWindows that run through midnight\n' + '─'.repeat(70));

// A night desk watching Asian markets: Mon–Fri, 22:00 to 06:00.
const night = hours({ start: '22:00', end: '06:00' });

ok(isWithinHours(night, new Date('2026-09-21T23:00:00Z')), 'open at 23:00 on a Monday');
ok(isWithinHours(night, new Date('2026-09-22T02:00:00Z')), 'still open at 02:00 on the Tuesday');
ok(!isWithinHours(night, new Date('2026-09-21T12:00:00Z')), 'shut in the middle of the day');

// The small hours belong to the day the window opened. A Friday-night shift
// is Friday's, and Saturday is not a working day.
ok(
    isWithinHours(night, new Date('2026-09-26T02:00:00Z')),
    'Saturday 02:00 counts as the Friday shift',
    'the day it opened, not the day it is'
);
ok(
    !isWithinHours(night, new Date('2026-09-26T23:00:00Z')),
    'but Saturday night itself is not a shift'
);

console.log('\nHours mean nothing without a timezone\n' + '─'.repeat(70));

const vancouver = hours({ timezone: 'America/Vancouver' });
// 17:00 UTC is 10:00 in Vancouver — a working hour there, an idle one in UTC
// if you read the clock off the server.
ok(isWithinHours(vancouver, new Date('2026-09-21T17:00:00Z')), 'a CHO in Vancouver works at 10:00 local');
ok(
    !isWithinHours(vancouver, new Date('2026-09-21T10:00:00Z')),
    'and not at 10:00 UTC, which is 03:00 for them',
    'the mistake "the server timezone" makes'
);

const tokyo = hours({ timezone: 'Asia/Tokyo' });
ok(isWithinHours(tokyo, new Date('2026-09-21T01:00:00Z')), 'Tokyo works while UTC sleeps');

// A zone nobody recognises must not take the engine down with it.
const nonsense = hours({ timezone: 'Middle/Earth' });
ok(
    typeof isWithinHours(nonsense, MON_10AM) === 'boolean',
    'an unknown timezone degrades, it does not throw'
);

console.log('\nSchedules that can never run\n' + '─'.repeat(70));

const noDays = state({ schedule: hours({ days: [] }) });
ok(effectiveState(noDays, MON_10AM).mode === 'paused', 'no days selected means nothing runs');
ok(
    /nothing will run/i.test(effectiveState(noDays, MON_10AM).detail),
    'and it says so rather than looking broken',
    'silence here reads as a bug'
);
ok(nextBoundary(hours({ days: [] }), MON_10AM) === null, 'with no boundary to wait for');

const always = hours({ start: '00:00', end: '00:00', days: [1, 2, 3, 4, 5, 6, 7] });
ok(isWithinHours(always, MON_3AM) && isWithinHours(always, SAT_10AM), 'a 24/7 window is always open');

console.log(`\n${failed ? R + failed + ' failed' : G + 'all passed'}${RS}\n`);
process.exit(failed ? 1 : 0);
