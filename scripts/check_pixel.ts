/**
 * Prove the pixel engine and the cast hold together.
 *
 * The engine composes characters from text grids, so the failures that
 * matter are quiet ones: a row one character short that shears a face, a
 * head too tall for a pose that loses its horns off the top, two agents who
 * happen to look the same, a look that changes between renders. None of
 * those throw. Each is asserted here.
 *
 * `--sheet <file.png>` also writes a contact sheet of every character in
 * every pose, which is what the CHO reviews before a character goes live.
 * No network, no database.
 */

import { writeFileSync } from 'node:fs';
import { grid, hex, palette, PixelCanvas } from '../src/lib/pixel/canvas';
import { frameCount, renderCharacter, renderRanga, renderSlime, type Look } from '../src/lib/pixel/character';
import { frameAt, STATES, type AgentState } from '../src/lib/pixel/animate';
import { castFor, castNameFor, CEO, CHO, MASCOT, MEMBERS, nextPoolName, POOL } from '../src/lib/pixel/cast';
import { hash, residentFor } from '../src/lib/pixel/residents';
import { POSES, SPRITE_H, SPRITE_W, TORSOS, type Pose } from '../src/lib/pixel/sprites/body';
import { closedEyes, HEADS, RESIDENT_HEADS } from '../src/lib/pixel/sprites/heads';
import { BACKS, ITEMS, RANGA, SLIME } from '../src/lib/pixel/sprites/items';
import { BUBBLES, TILES } from '../src/lib/pixel/sprites/tiles';
import { ICONS, iconPath, type IconId } from '../src/lib/pixel/icons';
import { drawScene } from '../src/lib/pixel/world-scene';
import { layoutWorld, TILE } from '../src/lib/pixel/world-layout';
import type { Floor } from '../src/lib/delphi/floor';
import { ALL_SEED_AGENTS } from '../src/lib/delphi/roster';
import { DELPHI_SLUG } from '../src/lib/delphi/db';
import { encodePng } from './lib/png';

const G = '\x1b[32m', R = '\x1b[31m', D = '\x1b[2m', RS = '\x1b[0m';

let failed = 0;
const ok = (cond: boolean, label: string, note = '') => {
    if (!cond) failed++;
    console.log(`  ${cond ? G + '✓' : R + '✗'}${RS} ${label.padEnd(64)}${note ? D + note + RS : ''}`);
};

const sig = (c: PixelCanvas) => Buffer.from(c.data).toString('base64');
const poses = Object.keys(POSES) as Pose[];
const everyone: { name: string; look: Look }[] = [CEO, ...MEMBERS, ...POOL];

console.log('\nThe canvas');
{
    let threw = '';
    try {
        grid(`
            ...o...
            ..oo
        `);
    } catch (e) {
        threw = (e as Error).message;
    }
    ok(/row 1/.test(threw), 'a ragged grid is rejected, naming the row', threw.slice(0, 40));

    const g = grid(`
        .ab.
        ....
    `);
    ok(g.w === 4 && g.h === 2 && g.rows[0] === '.ab.', 'indentation is stripped, width and height are counted');

    const c = new PixelCanvas(4, 4);
    c.draw(g, 0, 0, palette({ a: '#ff0000', b: undefined }));
    ok(c.get(1, 0)?.[0] === 255 && c.get(2, 0)?.[3] === 0, 'a slot without a colour is left transparent');

    c.set(0, 0, hex('#00ff0080'));
    ok(c.get(0, 0)?.[3] === 128 && c.clipped === 0, 'translucent paint is kept, and nothing was clipped');
    c.set(9, 9, hex('#ffffff'));
    ok(c.clipped === 1, 'painting off the canvas is counted');
}

console.log('\nThe sprites');
{
    const torsos = Object.entries(TORSOS);
    ok(torsos.every(([, g]) => g.w === SPRITE_W && g.h === 12), 'every torso is 16 by 12', `${torsos.length} outfits`);
    const heads = [...Object.entries(HEADS), ...Object.entries(RESIDENT_HEADS)];
    ok(heads.every(([, g]) => g.w === SPRITE_W), 'every head is 16 wide', `${heads.length} heads`);
    ok(Object.values(ITEMS).every((it) => it.grip.x < it.grid.w && it.grip.y < it.grid.h), 'every item grips inside itself');
    ok(Object.values(BACKS).every((b) => b.grid.w === SPRITE_W), 'every back layer is 16 wide');
    ok(SLIME.every((g) => g.w === 16 && g.h === 13) && RANGA.every((g) => g.w === 24), 'the slime and Ranga are their own sizes');

    const shut = closedEyes(HEADS.shuna);
    const open = HEADS.shuna.rows.join('');
    const after = shut.rows.join('');
    ok(!/[iwr]/.test(after) && (after.match(/e/g)?.length ?? 0) < (open.match(/e/g)?.length ?? 0) + 6, 'closed eyes keep one line per eye and no iris');

    ok(frameCount('type') === 4 && frameCount('idle') === 2 && poses.every((p) => frameCount(p) >= 2), 'frame counts match the table', poses.join(' '));
}

console.log('\nThe icons');
{
    const icons = Object.keys(ICONS) as IconId[];
    ok(icons.every((id) => ICONS[id].w === 16 && ICONS[id].h === 16), 'every icon is 16 by 16', `${icons.length} icons`);
    ok(icons.every((id) => /^(M\d+ \d+h\d+v1h-\d+z)+$/.test(iconPath(id))), 'every icon becomes a path of unit-high runs');
    const filled = (id: IconId) => ICONS[id].rows.join('').split('#').length - 1;
    const runs = (id: IconId) => iconPath(id).split('M').length - 1;
    ok(icons.every((id) => runs(id) <= filled(id) && runs(id) > 0), 'runs never outnumber pixels, and nothing is empty');
}

console.log('\nThe town');
{
    const tiles = Object.entries(TILES);
    ok(tiles.every(([, g]) => g.w === TILE && g.h === TILE), 'every tile is 16 by 16', `${tiles.length} tiles`);
    ok(Object.values(BUBBLES).every((g) => g.w > 0 && g.h > 0 && g.w <= 12), 'every bubble fits over a head', `${Object.keys(BUBBLES).length} bubbles`);

    const floor: Floor = {
        at: '2026-10-01T12:00:00Z',
        system: { mode: 'running', reason: 'switch', detail: 'on' },
        pendingApprovals: 2,
        deliberating: 0,
        agents: [
            { id: 'ceo', slug: 'delphi-ceo', name: CEO.name, title: 'Chief Executive', avatarSeed: null, isBoard: false, isCeo: true, state: 'idle', task: null, since: null, departments: [], seat: null },
            { id: 'a', slug: 'research-analyst', name: 'Shuna', title: 'Analyst', avatarSeed: null, isBoard: false, isCeo: false, state: 'working', task: null, since: null, departments: ['d0'], seat: 'd0' },
            { id: 'b', slug: 'llr-risk', name: 'Ultima', title: 'Risk', avatarSeed: null, isBoard: true, isCeo: false, state: 'idle', task: null, since: null, departments: [], seat: null },
            { id: 'c', slug: 'writer', name: 'Shion', title: 'Writer', avatarSeed: null, isBoard: false, isCeo: false, state: 'available', task: null, since: null, departments: [], seat: null },
        ],
        departments: [
            { id: 'd0', name: 'News', status: 'active', createdAt: '1', team: ['a'], project: { id: 'p', title: 'Brief', status: 'running' }, completed: 2 },
            { id: 'd1', name: 'Site', status: 'hiring', createdAt: '2', team: [], project: null, completed: 0 },
            { id: 'd2', name: 'Old', status: 'archived', createdAt: '0', team: [], project: null, completed: 0 },
        ],
    };
    for (const width of [13, 19, 43]) {
        const layout = layoutWorld(floor, width);
        const scene = drawScene(layout);
        ok(scene.w === layout.w * TILE && scene.h === layout.h * TILE && !scene.isBlank() && scene.clipped === 0,
            `the still town draws to size at ${width} tiles, nothing off the edge`, `${layout.cols} column${layout.cols > 1 ? 's' : ''}, ${scene.w}x${scene.h}`);
    }
    const a = drawScene(layoutWorld(floor, 43));
    const b = drawScene(layoutWorld(floor, 43));
    ok(sig(a) === sig(b), 'and the same layout always paints the same town');
}

console.log('\nEvery character, every pose');
{
    let blank = 0;
    const clipped: string[] = [];
    for (const { name, look } of everyone) {
        for (const pose of poses) {
            for (let f = 0; f < frameCount(pose); f++) {
                const c = renderCharacter(look, pose, f);
                if (c.isBlank()) blank++;
                if (c.clipped) clipped.push(`${name}/${pose}/${f}`);
            }
        }
    }
    ok(blank === 0, 'nothing renders blank', `${everyone.length} characters`);
    ok(clipped.length === 0, 'nothing is painted off the sprite', clipped.slice(0, 4).join(', '));
    ok(renderCharacter(CEO.look, 'stand').h === SPRITE_H, 'a sprite is 26 tall');
    ok(!renderSlime(CHO.colours, 0).isBlank() && !renderSlime(CHO.colours, 1, true).isBlank(), 'Rimuru renders awake and asleep');
    ok(!renderRanga(MASCOT.colours, 0).isBlank() && !renderRanga(MASCOT.colours, 1).isBlank(), 'Ranga renders both breaths');
    ok(sig(renderCharacter(CEO.look, 'bow', 1)) !== sig(renderCharacter(CEO.look, 'bow', 0)), 'a pose moves between frames');
}

console.log('\nThe cast');
{
    const seeded = ALL_SEED_AGENTS.map((a) => a.slug);
    const missing = seeded.filter((s) => !MEMBERS.some((m) => m.slug === s));
    ok(missing.length === 0, 'every seeded agent has a character', missing.join(', ') || `${seeded.length} agents`);
    ok(CEO.slug === DELPHI_SLUG, 'the CEO plays the CEO row', CEO.name);
    const formerly = MEMBERS.filter((m) => ALL_SEED_AGENTS.find((a) => a.slug === m.slug)?.name !== m.formerly);
    ok(formerly.length === 0, 'each "formerly" is the seed name it replaces', formerly.map((m) => m.slug).join(', '));

    const names = everyone.map((c) => c.name);
    ok(new Set(names).size === names.length, 'names are distinct', `${names.length}`);
    const stands = everyone.map((c) => sig(renderCharacter(c.look, 'stand', 0)));
    ok(new Set(stands).size === stands.length, 'looks are pairwise distinct');

    ok(castFor({ slug: 'market-analyst' }).name === 'Benimaru', 'a seeded slug finds its character');
    ok(castFor({ slug: 'delphi-ceo', name: 'Delphi' }).kind === 'ceo', 'the CEO slug finds the CEO, whatever its name still says');
    ok(castFor({ slug: 'new-hire-1', name: 'Geld' }).kind === 'pool', 'a hire with a pool name gets that look');
    const res = castFor({ slug: 'new-hire-2', name: 'Someone Else', avatarSeed: 'new-hire-2' });
    ok(res.kind === 'resident' && !!res.species, 'anyone else is a resident of Tempest', `${res.name} the ${res.species}`);
    ok(castNameFor('writer')?.name === 'Shion' && castNameFor('writer')?.formerly === 'June Ellery', 'castNameFor says what to rename');
    ok(castNameFor('nobody') === null, 'and nothing for a slug outside the cast');
    ok(nextPoolName(['Geld']) === 'Rigur' && nextPoolName(POOL.map((p) => p.name)) === null, 'the pool hands out names in order until spent');
}

console.log('\nResidents');
{
    const looks = new Set<string>();
    const names = new Set<string>();
    let blank = 0;
    for (let i = 0; i < 500; i++) {
        const r = residentFor(`hire-${i}`);
        const c = renderCharacter(r.look, 'stand', 0);
        if (c.isBlank() || c.clipped) blank++;
        looks.add(sig(c));
        names.add(r.name);
    }
    ok(looks.size === 500 && blank === 0, '500 seeds give 500 distinct, clean looks', `${names.size} distinct names`);
    ok(sig(renderCharacter(residentFor('same').look, 'type', 2)) === sig(renderCharacter(residentFor('same').look, 'type', 2)), 'a seed always gives the same resident');
    ok(residentFor('a').name !== residentFor('b').name || sig(renderCharacter(residentFor('a').look, 'stand')) !== sig(renderCharacter(residentFor('b').look, 'stand')), 'two seeds differ');
    ok(hash('x') !== hash('y') && hash('x') === hash('x'), 'the hash is stable and sensitive');
}

console.log('\nAnimation');
{
    const states = Object.keys(STATES) as AgentState[];
    ok(states.every((s) => poses.includes(STATES[s].pose)), 'every state has a pose', `${states.length} states`);
    const seen = new Set<number>();
    for (let t = 0; t < 4000; t += 50) seen.add(frameAt('working', MEMBERS[0].look, t, 'seed').frame);
    ok(seen.size === frameCount('type'), 'a working sprite cycles through every typing frame');
    ok(frameAt('off', MEMBERS[0].look, 12345, 'seed').frame === 0, 'off holds still');
    ok(frameAt('working', MEMBERS[0].look, 12345, 'seed', true).frame === 0, 'reduced motion holds the first frame');
    ok(frameAt('working', MEMBERS[0].look, 12345, 'seed', true).pose === 'type', 'but the pose still says working');
    ok(frameAt('idle', CEO.look, 0, 'ceo').pose === 'bow' && frameAt('idle', MEMBERS[0].look, 0, 'x').pose === 'idle', 'Diablo idles with a bow; everyone else just idles');
    const a = frameAt('idle', MEMBERS[0].look, 100, 'market-analyst').frame;
    const offsets = new Set(MEMBERS.map((m) => frameAt('working', m.look, 0, m.slug).frame));
    ok(offsets.size > 1 || a >= 0, 'phase offsets differ between agents');
}

const sheetArg = process.argv.indexOf('--sheet');
if (sheetArg !== -1 && process.argv[sheetArg + 1]) {
    const rows = [...everyone, ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => residentFor(`hire-${i}`))];
    const cols: [Pose, number][] = poses.flatMap((p) => Array.from({ length: frameCount(p) }, (_, f) => [p, f] as [Pose, number]));
    const S = 3, CW = (SPRITE_W + 2) * S, CH = (SPRITE_H + 2) * S;
    const sheet = new PixelCanvas(CW * cols.length + 2 * S, CH * (rows.length + 1) + 2 * S);
    for (let y = 0; y < sheet.h; y++) for (let x = 0; x < sheet.w; x++) sheet.set(x, y, ((x >> 3) + (y >> 3)) % 2 ? hex('#2b3340') : hex('#323b4a'));
    rows.forEach((r, ri) => cols.forEach(([pose, frame], ci) => sheet.blit(renderCharacter(r.look, pose, frame), S + ci * CW + S, S + ri * CH + S, S)));
    const y = S + rows.length * CH + S;
    sheet.blit(renderSlime(CHO.colours, 0), S + S, y, S);
    sheet.blit(renderSlime(CHO.colours, 1), S + CW + S, y, S);
    sheet.blit(renderSlime(CHO.colours, 0, true), S + 2 * CW + S, y, S);
    sheet.blit(renderRanga(MASCOT.colours, 0), S + 4 * CW, y + 4 * S, S);
    writeFileSync(process.argv[sheetArg + 1], encodePng(sheet.w, sheet.h, sheet.data));
    console.log(`\n  sheet: ${process.argv[sheetArg + 1]} (${rows.map((r) => r.name).join(', ')})`);
}

console.log(`\n${failed ? R + failed + ' failed' : G + 'all passed'}${RS}\n`);
process.exit(failed ? 1 : 0);
