/**
 * Prove the cast reaches the roster, the prompts and nowhere it should not.
 *
 * The quiet failures here are the ones that would reach a real agent: a
 * prompt that introduces one name and is graded under another, a rename that
 * runs again on every page load, a hire the CEO invented being renamed too,
 * or the chat persona leaking into a grade or a board verdict. Each is
 * asserted against the real applyCast, seedRoster and insertInventedAgent on
 * a small fake database. No network, no model call.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyCast, castDrift, castedPrompt } from '../src/lib/delphi/cast';
import { DELPHI_SLUG, ensureDelphiAgent, insertInventedAgent, seedRoster, type Db } from '../src/lib/delphi/db';
import { DELPHI_SYSTEM_PROMPT } from '../src/lib/delphi/delphi';
import { ALL_SEED_AGENTS, composeSystemPrompt } from '../src/lib/delphi/roster';
import { CAST_NAMES, castNameFor, CEO_FORMERLY, CEO_NAME, CHO_NAME, nextPoolName, POOL_NAMES, renameInPrompt } from '../src/lib/pixel/cast/names';
import { POOL } from '../src/lib/pixel/cast';

const G = '\x1b[32m', R = '\x1b[31m', D = '\x1b[2m', RS = '\x1b[0m';

let failed = 0;
const ok = (cond: boolean, label: string, note = '') => {
    if (!cond) failed++;
    console.log(`  ${cond ? G + '✓' : R + '✗'}${RS} ${label.padEnd(64)}${note ? D + note + RS : ''}`);
};

const WS = 'ws-1';
type Row = Record<string, unknown>;

// ---------------------------------------------------------------------------
// A small Supabase: select with filters, insert with ids, update in place.
// ---------------------------------------------------------------------------
function fakeDb(tables: Record<string, Row[]>) {
    const calls: string[] = [];
    let nextId = 1;
    function builder(table: string) {
        const st = { op: 'select' as 'select' | 'insert' | 'update', filters: [] as ((r: Row) => boolean)[], payload: null as unknown, single: false };
        const run = () => {
            const rows = (tables[table] ??= []);
            let out: Row[];
            if (st.op === 'insert') {
                const ins = (Array.isArray(st.payload) ? st.payload : [st.payload]) as Row[];
                out = ins.map((r) => ({ id: `${table}-${nextId++}`, ...r }));
                rows.push(...out);
            } else if (st.op === 'update') {
                out = rows.filter((r) => st.filters.every((f) => f(r)));
                for (const r of out) Object.assign(r, st.payload as Row);
            } else {
                out = rows.filter((r) => st.filters.every((f) => f(r))).map((r) => ({ ...r }));
            }
            calls.push(`${st.op} ${table}`);
            return st.single ? { data: out[0] ?? null, error: out.length ? null : { message: 'no rows' } } : { data: out, error: null };
        };
        const b: Record<string, unknown> = {
            select: () => b,
            order: () => b,
            limit: () => b,
            eq: (k: string, v: unknown) => ((st.filters.push((r) => r[k] === v), b)),
            is: (k: string, v: unknown) => ((st.filters.push((r) => (r[k] ?? null) === v), b)),
            in: (k: string, vs: unknown[]) => ((st.filters.push((r) => vs.includes(r[k])), b)),
            insert: (p: unknown) => ((st.op = 'insert'), (st.payload = p), b),
            update: (p: unknown) => ((st.op = 'update'), (st.payload = p), b),
            single: () => ((st.single = true), b),
            maybeSingle: () => ((st.single = true), b),
            then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
        };
        return b;
    }
    return { db: { from: builder } as unknown as Db, calls, tables };
}

/** What a workspace seeded before the cast looks like: seed names, prompts graded by the old CEO. */
function preCastRows(): Row[] {
    const rows: Row[] = ALL_SEED_AGENTS.map((a) => ({
        id: `agent-${a.slug}`,
        workspace_id: WS,
        slug: a.slug,
        name: a.name,
        system_prompt: composeSystemPrompt(a).split(CEO_NAME).join(CEO_FORMERLY),
        archived_at: null,
        origin: 'seed',
    }));
    rows.push({ id: 'agent-ceo', workspace_id: WS, slug: DELPHI_SLUG, name: CEO_FORMERLY, system_prompt: 'The CEO. Hires, plans, consolidates and reports to the CHO.', archived_at: null, origin: 'seed' });
    rows.push({ id: 'agent-zed', workspace_id: WS, slug: 'podcast-producer', name: 'Zed Marlow', system_prompt: 'You are Zed Marlow, a Podcast Producer.', archived_at: null, origin: 'invented' });
    return rows;
}

const src = (f: string) => readFileSync(join(__dirname, '..', 'src', 'lib', 'delphi', f), 'utf8');

(async () => {
    console.log('\nThe names');
    {
        const seeded = ALL_SEED_AGENTS.map((a) => a.slug);
        ok(seeded.every((s) => CAST_NAMES[s]), 'every seeded agent has a cast name', `${seeded.length}`);
        ok(ALL_SEED_AGENTS.every((a) => CAST_NAMES[a.slug].formerly === a.name), '"formerly" is the seed name, byte for byte');
        ok(castNameFor(DELPHI_SLUG)?.name === CEO_NAME && castNameFor('podcast-producer') === null, 'the CEO slug maps to the CEO; an invented slug maps to nothing');
        ok(POOL.map((p) => p.name).join() === POOL_NAMES.join(), 'the pool looks and the pool names agree', POOL_NAMES.join(', '));
        ok(new Set([...Object.values(CAST_NAMES).map((n) => n.name), ...POOL_NAMES, CEO_NAME]).size === Object.keys(CAST_NAMES).length + POOL_NAMES.length + 1, 'no two characters share a name');
        ok(renameInPrompt('You are Vera Quinn. Vera Quinn checks.', 'Vera Quinn', 'Shuna') === 'You are Shuna. Shuna checks.', 'renameInPrompt replaces every mention');
        ok(renameInPrompt('x', 'Same', 'Same') === 'x' && renameInPrompt('x', '', 'Y') === 'x', 'and leaves a prompt alone with nothing to rename');
    }

    console.log('\nA roster from before the cast');
    {
        const { db, tables, calls } = fakeDb({ delphi_agents: preCastRows(), delphi_events: [] });
        const rows = tables.delphi_agents.map((r) => ({ id: r.id as string, slug: r.slug as string, name: r.name as string }));
        const drift = castDrift(rows);
        ok(drift.length === ALL_SEED_AGENTS.length + 1, 'every seeded agent and the CEO drift; the invented hire does not', `${drift.length}`);

        const before = new Map(tables.delphi_agents.map((r) => [r.id as string, r.system_prompt as string]));
        const { renamed } = await applyCast(db, WS, rows);
        ok(renamed.length === drift.length, 'applyCast renames each of them', renamed[0]);

        const shuna = tables.delphi_agents.find((r) => r.slug === 'research-analyst')!;
        const old = before.get('agent-research-analyst')!;
        const expected = old.split('Vera Quinn').join('Shuna').split(CEO_FORMERLY).join(CEO_NAME);
        ok(shuna.name === 'Shuna' && shuna.system_prompt === expected, 'the prompt introduces the character and is graded by the new CEO', 'byte for byte otherwise');
        ok(!String(shuna.system_prompt).includes('Vera Quinn') && String(shuna.system_prompt).startsWith('You are Shuna,'), 'the seed name is gone from it');
        const ceo = tables.delphi_agents.find((r) => r.slug === DELPHI_SLUG)!;
        ok(ceo.name === CEO_NAME && ceo.system_prompt === before.get('agent-ceo'), 'the CEO row takes the name; its prompt had nothing to change');
        const zed = tables.delphi_agents.find((r) => r.slug === 'podcast-producer')!;
        ok(zed.name === 'Zed Marlow' && zed.system_prompt === before.get('agent-zed'), 'the invented hire is untouched');
        ok(tables.delphi_events.length === 1 && tables.delphi_events[0].type === 'cast_applied', 'one event records it', String((tables.delphi_events[0]?.payload as Row)?.verb ?? ''));

        const callsBefore = calls.length;
        const again = await applyCast(db, WS, tables.delphi_agents.map((r) => ({ id: r.id as string, slug: r.slug as string, name: r.name as string })));
        ok(again.renamed.length === 0 && calls.length === callsBefore && tables.delphi_events.length === 1, 'a second run changes nothing and asks nothing');
        ok(castDrift(tables.delphi_agents.map((r) => ({ id: r.id as string, slug: r.slug as string, name: r.name as string }))).length === 0, 'and the roster no longer drifts');

        const hand = castedPrompt('You are Vera Quinn, an analyst. Delphi grades.', { name: 'Shuna', current: 'V. Quinn', seed: 'Vera Quinn' });
        ok(hand === `You are Shuna, an analyst. ${CEO_NAME} grades.`, 'a row renamed by hand still gets its prompt fixed from the seed name');
    }

    console.log('\nA new workspace');
    {
        const { db, tables } = fakeDb({ delphi_agents: [], delphi_agent_stats: [], delphi_channels: [] });
        const { inserted } = await seedRoster(db, WS);
        ok(inserted === ALL_SEED_AGENTS.length, 'seeds the whole roster', `${inserted}`);
        const wrong = tables.delphi_agents.filter((r) => r.name !== CAST_NAMES[r.slug as string].name);
        ok(wrong.length === 0, 'under the cast names from the start', wrong.map((r) => r.slug).join(', '));
        const leak = tables.delphi_agents.filter((r) => {
            const seed = ALL_SEED_AGENTS.find((a) => a.slug === r.slug)!;
            return String(r.system_prompt).includes(seed.name) || !String(r.system_prompt).startsWith(`You are ${CAST_NAMES[seed.slug].name}`);
        });
        ok(leak.length === 0, 'every prompt introduces the character, not the seed name', leak.map((r) => r.slug).join(', '));
        ok(tables.delphi_agents.every((r) => String(r.system_prompt).includes(`${CEO_NAME} grades every task`)), 'and is graded by the CEO by name');
        const ceoId = await ensureDelphiAgent(db, WS);
        ok(!!ceoId && tables.delphi_agents.find((r) => r.slug === DELPHI_SLUG)?.name === CEO_NAME, 'the CEO row is created under the CEO name');
    }

    console.log('\nHires past the roster');
    {
        const spec = { slug: 'podcast-producer', name: 'Zed Marlow', title: 'Podcast Producer', systemPrompt: 'You are Zed Marlow, a Podcast Producer. Zed Marlow edits audio.', skills: ['audio'], costTier: 2 as const, requiredChannels: [] };
        const { db, tables } = fakeDb({ delphi_agents: [{ id: 'g', workspace_id: WS, slug: 'x', name: POOL_NAMES[0], archived_at: '2026-01-01' }, { id: 'r', workspace_id: WS, slug: 'y', name: POOL_NAMES[1] }], delphi_agent_stats: [], delphi_channels: [] });
        const hired = await insertInventedAgent(db, WS, spec, null);
        ok(hired.name === POOL_NAMES[2], 'takes the next pool name, skipping ones in use, archived included', hired.name);
        const row = tables.delphi_agents.find((r) => r.slug === 'podcast-producer')!;
        ok(row.system_prompt === `You are ${POOL_NAMES[2]}, a Podcast Producer. ${POOL_NAMES[2]} edits audio.`, 'with its prompt introducing that name');
        ok(nextPoolName(POOL_NAMES) === null, 'the pool runs out');
        const full = fakeDb({ delphi_agents: POOL_NAMES.map((n, i) => ({ id: `p${i}`, workspace_id: WS, slug: `p${i}`, name: n })), delphi_agent_stats: [], delphi_channels: [] });
        const kept = await insertInventedAgent(full.db, WS, spec, null);
        ok(kept.name === 'Zed Marlow' && kept.systemPrompt === spec.systemPrompt, 'after which a hire keeps the name the CEO gave it');
    }

    console.log('\nThe voice');
    {
        const chat = src('chat.ts');
        ok(/\$\{CHO_NAME\}-sama/.test(chat) && /Kufufu/.test(chat), 'the chat prompt carries the persona');
        ok(DELPHI_SYSTEM_PROMPT.includes(`You are ${CEO_NAME},`) && DELPHI_SYSTEM_PROMPT.includes(`the CHO, ${CHO_NAME},`), 'the CEO prompt knows both names');
        const quiet = ['delphi.ts', 'grading.ts', 'retrospective.ts', 'board.ts', 'replacement.ts', 'runtime.ts', 'roster.ts'].filter((f) => /sama|Kufufu/.test(src(f)));
        ok(quiet.length === 0, 'and nothing else does: plans, grades, the board and the agents stay neutral', quiet.join(', '));
        ok(!DELPHI_SYSTEM_PROMPT.includes('-sama'), 'the persona is not in the planning prompt');
    }

    console.log(`\n${failed ? R + failed + ' failed' : G + 'all passed'}${RS}\n`);
    process.exit(failed ? 1 : 0);
})().catch((e) => {
    console.error('THREW:', e);
    process.exit(1);
});
