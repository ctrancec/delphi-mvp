/**
 * The department wizard's rules, offline.
 *
 * Settings shaped from anything stored; a draft that resumes where it
 * stopped; what each kind needs before it can be staffed; roles found for
 * seeded and invented agents; schedules in words and as cron; the banner that
 * spots a content department made before kinds existed.
 *
 *   npm run delphi:wizard
 */

import {
    DEFAULT_SETTINGS,
    KINDS,
    looksLikeStudio,
    nextSetup,
    roleOfAgent,
    rolesFor,
    scheduleCron,
    scheduleWords,
    setupBlocker,
    validateBasics,
    withSchedule,
    withSettings,
} from '../src/lib/delphi/kinds';
import { withDefaults } from '../src/lib/studio/accounts';
import { adoptDeviceZone, setWorkspaceZone, workspaceZone } from '../src/lib/delphi/zone';
import { fakeDb, type Row } from './fake_db';

const G = '\x1b[32m', R = '\x1b[31m', D = '\x1b[2m', RS = '\x1b[0m';
let failed = 0;
const ok = (cond: boolean, label: string, note = '') => {
    if (!cond) failed++;
    console.log(`  ${cond ? G + '✓' : R + '✗'}${RS} ${label.padEnd(70)}${note ? D + note + RS : ''}`);
};

console.log('\nSettings');
{
    const legacy = withSettings({});
    ok(legacy.setup.complete && legacy.autonomy === 'scheduled' && legacy.timezone === 'UTC', 'a department from before the wizard reads as set up, on schedule, in UTC');
    const s = withSettings({
        houseRules: '  Be brief.  ',
        roleNotes: { writer: '  Short sentences. ', designer: '   ', nonsense: 'x' },
        pinned: { writer: 'writer', editor: 'Not A Slug!', designer: 'motion-designer' },
        autonomy: 'ask',
        timezone: 'Mars/Olympus',
        schedule: { days: [5, 1, 1, 9, 3], time: '25:99' },
        research: { topics: 'rates, dollar\nrates', sources: ['fred'], report: { length: 'epic', sections: 'A; B', tone: 'plain' } },
    });
    ok(s.houseRules === 'Be brief.' && s.roleNotes.writer === 'Short sentences.' && !('designer' in s.roleNotes), 'notes are trimmed; a blank note is no note; unknown roles are dropped');
    ok(s.pinned.writer === 'writer' && !('editor' in s.pinned) && s.pinned.designer === 'motion-designer', 'a pin must look like a slug');
    ok(s.autonomy === 'ask' && s.timezone === 'UTC', 'an unknown timezone falls back to UTC');
    ok(JSON.stringify(s.schedule) === '{"days":[1,3,5],"time":"09:00"}', 'schedule days are unique, sorted, in range; a bad time is 09:00', JSON.stringify(s.schedule));
    ok(s.research.topics.join('|') === 'rates|dollar' && s.research.report.length === 'standard' && s.research.report.sections === 'A; B', 'topics are a deduplicated list; an unknown length is standard');

    const unpinned = withSettings({ pinned: { writer: '' } }, s);
    ok(!('writer' in unpinned.pinned) && unpinned.pinned.designer === 'motion-designer', 'an empty pin un-pins that role and leaves the others');
    const cleared = withSettings({ roleNotes: { writer: '' } }, s);
    ok(!('writer' in cleared.roleNotes), 'an emptied note is removed');
    ok(withSchedule({ days: [] }) === null && withSchedule(null) === null, 'no days is no schedule');
    ok(withSettings({ timezone: 'America/Toronto' }).timezone === 'America/Toronto', 'a real timezone is kept');
}

console.log('\nResuming a draft');
{
    ok(JSON.stringify(nextSetup({ step: 3, complete: false }, 4)) === '{"step":4,"complete":false}', 'saving step 3 moves the draft to step 4');
    ok(nextSetup({ step: 4, complete: false }, 3).step === 4, 'going back to change step 3 does not forget step 4 was done');
    ok(nextSetup({ step: 5, complete: true }, 3).complete, 'a finished setup stays finished when edited');
    ok(nextSetup({ step: 5, complete: false }, 9).step === 5, 'never past the last step');
    ok(JSON.stringify(nextSetup({ step: 5, complete: true }, 4, true)) === '{"step":4,"complete":false}', 'converted to another kind, a finished setup is opened again, so the team is made for the new kind');
}

console.log('\nBasics and what blocks staffing');
{
    ok(!validateBasics({ kind: 'nope', name: 'X', charter: 'x'.repeat(30), budgetUsd: 5 }).ok, 'a kind is required');
    ok(!validateBasics({ kind: 'studio', name: 'X', charter: 'x'.repeat(30), budgetUsd: 5 }).ok, 'a name of one letter is refused');
    ok(!validateBasics({ kind: 'studio', name: 'Studio', charter: 'too short', budgetUsd: 5 }).ok, 'a purpose of a few words is refused');
    ok(!validateBasics({ kind: 'studio', name: 'Studio', charter: 'x'.repeat(30), budgetUsd: 0 }).ok, 'a budget must be positive');
    const v = validateBasics({ kind: 'research', name: '  Morning brief ', charter: 'Brief me on the markets every weekday.', budgetUsd: '7.555' });
    ok(v.ok && v.value.name === 'Morning brief' && v.value.budgetUsd === 7.56, 'valid basics are tidied', v.ok ? `${v.value.name} $${v.value.budgetUsd}` : '');
    ok(setupBlocker('studio', 'x'.repeat(30), []) !== null, 'a studio with no channel cannot be staffed');
    ok(setupBlocker('studio', 'x'.repeat(30), [{ status: 'paused' }]) !== null, 'nor one whose channels are all paused');
    ok(setupBlocker('studio', 'x'.repeat(30), [{ status: 'active' }]) === null, 'one active channel is enough');
    ok(/test channel/.test(setupBlocker('studio', 'x'.repeat(30), []) ?? ''), 'and it says a test channel will do');
    ok(setupBlocker('research', 'x'.repeat(30), []) === null, 'research needs no channel');
}

console.log('\nRoles');
{
    ok(roleOfAgent({ slug: 'video-editor' }) === 'video_editor' && roleOfAgent({ slug: 'critic' }) === 'editor', 'seeded agents fill their roles by slug');
    ok(roleOfAgent({ slug: 'motion-animator', title: 'Motion Animator' }) === 'designer', 'an invented motion animator is a designer', String(roleOfAgent({ slug: 'motion-animator', title: 'Motion Animator' })));
    ok(roleOfAgent({ slug: 'yt-video-editor', title: 'YouTube Video Editor' }) === 'video_editor', 'an invented video editor is a video editor, not an editor');
    ok(roleOfAgent({ slug: 'thumb', title: 'Thumbnail Artist' }) === 'designer' && roleOfAgent({ slug: 'x', title: 'Head Chef' }) === null, 'by title when the slug is unknown; nothing when nothing fits');
    ok(rolesFor('research').map((r) => r.key).join(',') === 'researcher,writer,editor', 'research is offered the research roles');
    ok(rolesFor('studio').length === 6, 'a studio is offered all six');
    ok(KINDS.studio.planningRules.includes('CONTENT STUDIO') && KINDS.research.planningRules.includes('RESEARCH'), 'each kind brings its own staffing rules');
}

console.log('\nSchedules');
{
    ok(scheduleWords({ days: [1, 2, 3, 4, 5], time: '07:30' }, 'Europe/London') === 'Weekdays at 07:30 (Europe/London)', 'weekdays read as weekdays');
    ok(scheduleWords({ days: [1, 3, 5], time: '09:00' }, 'UTC') === 'Mon, Wed, Fri at 09:00 (UTC)', 'picked days are named');
    ok(scheduleWords(null, 'UTC') === 'On demand', 'no schedule is on demand');
    ok(scheduleCron({ days: [1, 3, 7], time: '07:05' }) === '5 7 * * 0,1,3', 'the cron for older code: Sunday is 0', String(scheduleCron({ days: [1, 3, 7], time: '07:05' })));
    const acc = withDefaults({ schedule: { days: [2, 4], time: '18:00' }, topics: 'team', monthlyCapUsd: '2.5' });
    ok(acc.schedule?.days.join(',') === '2,4' && acc.topics === 'team' && acc.monthlyCapUsd === 2.5, 'a channel keeps its own schedule, topic rule and cap');
    ok(withDefaults({}).topics === 'cho' && withDefaults({}).schedule === null && withDefaults({ monthlyCapUsd: '' }).monthlyCapUsd === null, 'new channels: you approve topics, no schedule, no own cap');
}

console.log('\nThe convert banner');
{
    ok(looksLikeStudio('research', 'YouTube managment team', 'Make videos'), 'the YouTube team is offered conversion');
    ok(looksLikeStudio('research', 'Social media content', 'Draft posts for my pages'), 'so is the social media team');
    ok(!looksLikeStudio('research', 'Financial market research', 'Brief me on markets'), 'a market research department is not');
    ok(!looksLikeStudio('studio', 'YouTube studio', 'videos'), 'a studio already converted is not asked again');
    ok(DEFAULT_SETTINGS.setup.complete, 'defaults describe a finished setup');
}

/** One time zone, the CHO's, found on their device; departments follow it unless set apart. */
async function zoneChecks() {
    console.log('\nOne time zone, found automatically');
    const W = 'ws-1';
    const world = (state: Row[] = []) => {
        const tables: Record<string, Row[]> = {
            delphi_system_state: state,
            delphi_departments: [
                { id: 'studio', workspace_id: W, settings: { setup: { step: 3, complete: false } } },
                { id: 'brief', workspace_id: W, settings: { timezone: 'UTC' } },
                { id: 'abroad', workspace_id: W, settings: { timezone: 'Asia/Tokyo', timezonePinned: true } },
                { id: 'other-workspace', workspace_id: 'ws-2', settings: {} },
            ],
        };
        return { tables, db: fakeDb(tables) };
    };
    const zoneOf = (tables: Record<string, Row[]>, id: string) => withSettings(tables.delphi_departments.find((d) => d.id === id)!.settings).timezone;

    {
        const { tables, db } = world();
        ok((await workspaceZone(db, W)) === null, 'a workspace starts with no time zone known');
        const r = await adoptDeviceZone(db, W, 'America/Toronto');
        ok(r.adopted && (await workspaceZone(db, W)) === 'America/Toronto', "the CHO's device zone is kept, without asking");
        ok(zoneOf(tables, 'studio') === 'America/Toronto' && zoneOf(tables, 'brief') === 'America/Toronto', 'every department follows it, the studio and its channels included');
        ok(zoneOf(tables, 'abroad') === 'Asia/Tokyo' && withSettings(tables.delphi_departments.find((d) => d.id === 'abroad')!.settings).timezonePinned, 'one deliberately given its own zone keeps it');
        ok(withSettings(tables.delphi_departments.find((d) => d.id === 'other-workspace')!.settings).timezone === 'UTC', 'no other workspace is touched');

        const travel = await adoptDeviceZone(db, W, 'Europe/Paris');
        ok(!travel.adopted && (await workspaceZone(db, W)) === 'America/Toronto' && zoneOf(tables, 'studio') === 'America/Toronto', 'opened abroad, nothing moves: a known zone is never replaced from a device');

        tables.delphi_departments.push({ id: 'new-from-chat', workspace_id: W, settings: { setup: { step: 3, complete: false } } });
        await adoptDeviceZone(db, W, 'America/Toronto');
        ok(zoneOf(tables, 'new-from-chat') === 'America/Toronto', 'a department made since, still on the default, is brought in line');

        const changed = await setWorkspaceZone(db, W, 'America/Vancouver');
        ok(changed.ok && zoneOf(tables, 'studio') === 'America/Vancouver' && zoneOf(tables, 'abroad') === 'Asia/Tokyo', 'changed by the CHO, everything that follows it moves; the one set apart does not');
        ok(!(await setWorkspaceZone(db, W, 'Mars/Olympus')).ok, 'a zone that does not exist is refused');
        ok(tables.delphi_system_state.length === 1, 'the zone lives in one place');
    }
    {
        // The usual live state: the row exists (the on/off switch made it), on the column's default.
        const { tables, db } = world([{ workspace_id: W, mode: 'on', timezone: 'UTC', schedule_enabled: false }]);
        ok((await workspaceZone(db, W)) === null, 'UTC left on its default, with no work hours, counts as not known');
        const r = await adoptDeviceZone(db, W, 'America/Toronto');
        ok(r.adopted && tables.delphi_system_state.length === 1 && tables.delphi_system_state[0].timezone === 'America/Toronto' && tables.delphi_system_state[0].mode === 'on', 'so the device zone is kept there, and nothing else on that row changes');
    }
    {
        const { db } = world([{ workspace_id: W, timezone: 'UTC', schedule_enabled: true }]);
        ok((await workspaceZone(db, W)) === 'UTC' && !(await adoptDeviceZone(db, W, 'America/Toronto')).adopted, 'working hours the CHO set in UTC count as chosen, and are left alone');
    }
    {
        const { db } = world();
        ok(!(await adoptDeviceZone(db, W, 'Not/AZone')).adopted && (await workspaceZone(db, W)) === null, "a device that reports nonsense changes nothing");
    }
    ok(withSettings({}).timezonePinned === false && withSettings({ timezonePinned: true }).timezonePinned, 'a department follows the workspace unless it says otherwise');
}

zoneChecks()
    .then(() => {
        console.log(failed ? `\n${R}${failed} check(s) failed${RS}` : `\n${G}all wizard checks passed${RS}`);
        process.exit(failed ? 1 : 0);
    })
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
