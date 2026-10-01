/**
 * Tempest residents: hobgoblins, kobolds, dwarves, lizardmen and orcs, for
 * every hire past the named cast.
 *
 * A resident is a pure function of a seed — the agent's `avatar_seed`, which
 * is its slug — so the same agent looks the same on every page and every
 * visit. `LOOK_VERSION` is in the hash so the art can change later without
 * touching a single row.
 *
 * Nothing here reads an agent's name. A look is never inferred from one.
 */

import { palette } from './canvas';
import type { Look } from './character';
import type { Outfit } from './sprites/body';
import { RESIDENT_HEADS, type ResidentHeadId } from './sprites/heads';
import type { ItemId } from './sprites/items';

export const LOOK_VERSION = 1;

/** cyrb53: a small, well-mixed string hash. */
export function hash(text: string, seed = 0): number {
    let h1 = 0xdeadbeef ^ seed;
    let h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < text.length; i++) {
        const ch = text.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** mulberry32: a deterministic stream of numbers in [0, 1). */
export function random(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const pick = <T>(rnd: () => number, list: readonly T[]): T => list[Math.floor(rnd() * list.length)];

type Kind = 'hobgoblin' | 'kobold' | 'dwarf' | 'lizardman' | 'orc';

const KINDS: readonly { kind: Kind; heads: readonly ResidentHeadId[]; weight: number }[] = [
    { kind: 'hobgoblin', heads: ['hob-short', 'hob-long', 'hob-bun'], weight: 5 },
    { kind: 'kobold', heads: ['kobold'], weight: 2 },
    { kind: 'dwarf', heads: ['dwarf'], weight: 2 },
    { kind: 'lizardman', heads: ['lizard'], weight: 2 },
    { kind: 'orc', heads: ['orc'], weight: 1 },
];

const SKIN: Record<Kind, readonly [string, string][]> = {
    hobgoblin: [['#e0b58f', '#c3946d'], ['#d9c08f', '#b89e6c'], ['#c9a27a', '#a8805a'], ['#e8c6a2', '#cba27f']],
    kobold: [['#f2e2c8', '#d6c3a3'], ['#e8d6b8', '#c9b494']],
    dwarf: [['#eebc98', '#d09572'], ['#e5b08c', '#c48a66']],
    lizardman: [['#6fae4e', '#4f8a36'], ['#4e9aa8', '#367a87'], ['#9aaa4a', '#7a8a32']],
    orc: [['#9fb07a', '#7f9058'], ['#b0a27a', '#90825a']],
};

// Hair for most; fur for kobolds; a helmet's metal for dwarves rides on x.
const HAIR: readonly [string, string, string][] = [
    ['#2a2430', '#1a1423', '#4a4252'],
    ['#6b4a2b', '#4d331c', '#8f6a45'],
    ['#b8742f', '#8f5520', '#dc9a55'],
    ['#d9c7a0', '#b5a27c', '#f2e6c7'],
    ['#4a5a7a', '#33405a', '#6b7fa3'],
    ['#7a3b3b', '#5a2828', '#a35a5a'],
    ['#3d6b4a', '#2a4d34', '#5a8f6b'],
];
const FUR: readonly [string, string, string][] = [
    ['#a8743f', '#82572b', '#c9955f'],
    ['#6e6e78', '#50505a', '#90909a'],
    ['#d9c7a0', '#b5a27c', '#f2e6c7'],
    ['#3a3530', '#25211d', '#5a544d'],
];
const CLOTH: readonly [string, string][] = [
    ['#3b6ea8', '#2a4f7a'],
    ['#8a3b3b', '#662828'],
    ['#3d7a4a', '#2a5634'],
    ['#7a5a2e', '#5a411f'],
    ['#5a4a7a', '#40345a'],
    ['#2f6f6f', '#204f4f'],
    ['#8a6a3a', '#6a4e26'],
    ['#4a4a58', '#33333f'],
];
const TRIM = ['#e8c34a', '#d9d0bd', '#c8344a', '#8fd8ec', '#9be08f', '#f2a7c3'];
const OUTFITS: readonly Outfit[] = ['tunic', 'armor', 'apron', 'robe', 'coat', 'uniform'];
const ITEMS: readonly (ItemId | undefined)[] = [undefined, undefined, 'scroll', 'book', 'ledger', 'hammer', 'spear', 'wand'];

const SYLLABLES: Record<Kind, { start: readonly string[]; end: readonly string[] }> = {
    hobgoblin: { start: ['Gob', 'Rig', 'Hob', 'Gor', 'Rim', 'Kib'], end: ['ta', 'zo', 'chi', 'ke', 'mi', 'ra', 'to', 'ya', 'ne', 'ru'] },
    kobold: { start: ['Kob', 'Ruf', 'Pip', 'Bar', 'Wuf', 'Tok'], end: ['o', 'i', 'a', 'ly', 'ko', 'po'] },
    dwarf: { start: ['Dol', 'Bor', 'Kel', 'Thr', 'Gun', 'Hal'], end: ['in', 'ek', 'ur', 'do', 'gar', 'mund'] },
    lizardman: { start: ['Ga', 'Sa', 'Zo', 'Ri', 'Ka', 'Sho'], end: ['biru', 'shu', 'zel', 'kan', 'rio', 'gen'] },
    orc: { start: ['Gru', 'Mog', 'Bur', 'Dag', 'Uth', 'Gol'], end: ['ld', 'ak', 'ush', 'ok', 'rim', 'gar'] },
};

const KIND_LABEL: Record<Kind, string> = {
    hobgoblin: 'hobgoblin',
    kobold: 'kobold',
    dwarf: 'dwarf',
    lizardman: 'lizardman',
    orc: 'high orc',
};

export interface Resident {
    name: string;
    /** What they are, for a caption: "a kobold of Tempest". */
    kind: string;
    look: Look;
}

export function residentFor(seed: string): Resident {
    const rnd = random(hash(`${seed}#${LOOK_VERSION}`));

    const total = KINDS.reduce((n, k) => n + k.weight, 0);
    let roll = rnd() * total;
    const entry = KINDS.find((k) => (roll -= k.weight) < 0) ?? KINDS[0];

    const headId = pick(rnd, entry.heads);
    const [skin, skinShade] = pick(rnd, SKIN[entry.kind]);
    const [hair, hairShade, hairLight] = entry.kind === 'kobold' ? pick(rnd, FUR) : pick(rnd, HAIR);
    const [cloth, clothShade] = pick(rnd, CLOTH);
    const [legs, legsShade] = pick(rnd, CLOTH);
    const trim = pick(rnd, TRIM);
    const accent = pick(rnd, TRIM);
    const outfit = pick(rnd, OUTFITS);
    const item = pick(rnd, ITEMS);
    const iris = pick(rnd, ['#3a6aa0', '#5a3a2a', '#3d7a4a', '#7a3b8f', '#a36a1f', '#2a2430']);

    const syl = SYLLABLES[entry.kind];
    const name = pick(rnd, syl.start) + pick(rnd, syl.end);

    const isLizard = entry.kind === 'lizardman';
    const helmet = entry.kind === 'dwarf' ? pick(rnd, [['#a8b0bc', '#7a8290'], ['#c98a3a', '#9a6420']] as const) : null;

    return {
        name,
        kind: KIND_LABEL[entry.kind],
        look: {
            head: RESIDENT_HEADS[headId],
            outfit,
            item,
            colours: palette({
                o: '#1a1423',
                e: '#1a1423',
                w: isLizard ? '#f2c230' : '#ffffff',
                m: '#9c4a4a',
                b: '#f4a3a3',
                s: skin,
                S: skinShade,
                n: skin,
                j: skin,
                J: skinShade,
                z: skin,
                h: hair,
                H: hairShade,
                l: hairLight,
                i: iris,
                x: helmet ? helmet[0] : isLizard ? accent : trim,
                X: helmet ? helmet[1] : clothShade,
                c: cloth,
                C: clothShade,
                t: trim,
                u: '#ece6d8',
                k: accent,
                K: clothShade,
                g: '#e8b923',
                p: legs,
                P: legsShade,
                f: '#3a2a1a',
                a: '#d5dce6',
                A: '#8f9aa8',
                d: '#8a5a36',
                D: '#6a4226',
                U: '#f2e8cf',
                y: accent,
            }),
        },
    };
}
