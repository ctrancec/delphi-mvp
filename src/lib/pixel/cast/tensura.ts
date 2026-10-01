/**
 * The Tempest cast: "That Time I Got Reincarnated as a Slime".
 *
 * The CHO asked for these characters, for a private dashboard. They belong to
 * their creators. Everything here is fan art drawn in code — a few signature
 * colours and shapes per character, nothing traced or copied — and it lives in
 * this one pack so that, before Delphi is ever opened to anyone else, swapping
 * the pack in `./index.ts` puts original characters, the original names and
 * the original product name back everywhere at once.
 *
 * The CHO is Rimuru. The CEO is Diablo. Each seeded agent is played by the
 * character whose temperament fits the job: Souei gathers intelligence,
 * Hakurou grades without mercy, Gabiru was born for social media.
 */

import { palette, type Palette } from '../canvas';
import type { Look } from '../character';
import type { Outfit, Pose } from '../sprites/body';
import { HEADS, RESIDENT_HEADS } from '../sprites/heads';
import type { BackId, ItemId } from '../sprites/items';
import type { Grid } from '../canvas';

export interface CastMember {
    /** The seeded agent this character plays. */
    slug: string;
    name: string;
    /** The agent's name before the cast arrived: what to swap out of its prompt. */
    formerly: string;
    look: Look;
}

/** A name kept for a future hire, with the look that goes with it. */
export interface PoolMember {
    name: string;
    look: Look;
}

const SKIN = {
    fair: ['#f7d9c0', '#e3b394'],
    pale: ['#f5e6dc', '#dcc3b3'],
    tan: ['#e0b58f', '#c3946d'],
    ruddy: ['#eebc98', '#d09572'],
    dryad: ['#e3f0cf', '#c3dba7'],
    lizard: ['#6fae4e', '#4f8a36'],
    orc: ['#9fb07a', '#7f9058'],
} as const;

/** Slots every character shares, so each entry only says what makes it them. */
function colours(skin: readonly [string, string], own: Record<string, string>): Palette {
    return palette({
        o: '#1a1423',
        e: '#1a1423',
        w: '#ffffff',
        m: '#9c4a4a',
        b: '#f4a3a3',
        a: '#d5dce6',
        A: '#8f9aa8',
        d: '#8a5a36',
        D: '#6a4226',
        U: '#f2e8cf',
        u: '#ece6d8',
        g: '#e8b923',
        f: '#3a2a1a',
        s: skin[0],
        S: skin[1],
        n: skin[0],
        j: skin[0],
        J: skin[1],
        z: skin[0],
        ...own,
    });
}

function look(
    head: Grid,
    outfit: Outfit,
    skin: readonly [string, string],
    own: Record<string, string>,
    extra: { item?: ItemId; back?: BackId[]; floats?: boolean; squint?: boolean; idlePose?: Pose } = {}
): Look {
    return { head, outfit, colours: colours(skin, own), ...extra };
}

export const APP_NAME = 'Tempest';

/** The CHO, in slime form. Rimuru is not an agent and never has a row. */
export const CHO = {
    name: 'Rimuru',
    colours: palette({ o: '#2a5f8f', a: '#7fd0f0', A: '#4aa7d8', l: '#d8f6ff', e: '#1a3a5a' }),
};

/** Ranga, napping wherever Rimuru is. */
export const MASCOT = {
    name: 'Ranga',
    colours: palette({ o: '#14121a', a: '#3a3f52', A: '#262a38', q: '#e8e2d4', e: '#14121a', n: '#14121a' }),
};

export const CEO: CastMember = {
    slug: 'delphi-ceo',
    name: 'Diablo',
    formerly: 'Delphi',
    look: look(
        HEADS.diablo,
        'tailcoat',
        SKIN.pale,
        {
            h: '#1f1b24',
            H: '#0f0c14',
            l: '#3a3346',
            x: '#c8344a',
            i: '#e8b923',
            r: '#c8344a',
            c: '#24212b',
            C: '#15131a',
            u: '#f2eff7',
            k: '#c8344a',
            p: '#24212b',
            P: '#15131a',
            f: '#15131a',
            n: '#f2eff7',
        },
        { item: 'tome', idlePose: 'bow' }
    ),
};

export const MEMBERS: readonly CastMember[] = [
    {
        slug: 'research-analyst',
        name: 'Shuna',
        formerly: 'Vera Quinn',
        look: look(
            HEADS.shuna,
            'miko',
            SKIN.fair,
            {
                h: '#f5a8c6',
                H: '#d9799f',
                l: '#ffd6e6',
                q: '#f7f3ea',
                Q: '#cfc6b0',
                i: '#d23a52',
                c: '#f7f3ea',
                C: '#d9d0bd',
                t: '#d23a52',
                k: '#d23a52',
                K: '#a32640',
                p: '#d23a52',
                P: '#a32640',
                f: '#f7f3ea',
                x: '#7a3b8f',
            },
            { item: 'book' }
        ),
    },
    {
        slug: 'global-news-monitor',
        name: 'Souei',
        formerly: 'Idris Kane',
        look: look(
            HEADS.souei,
            'ninja',
            SKIN.fair,
            {
                h: '#2c3a6b',
                H: '#1c264a',
                l: '#4a5f9c',
                q: '#2a2430',
                Q: '#4a4252',
                i: '#4f7bd6',
                c: '#2a2f45',
                C: '#1b1f30',
                t: '#1b1f30',
                k: '#6b7080',
                K: '#4a4f5e',
                p: '#2a2f45',
                P: '#1b1f30',
                f: '#1b1f30',
            },
            { item: 'scroll' }
        ),
    },
    {
        slug: 'market-analyst',
        name: 'Benimaru',
        formerly: 'Nadia Brandt',
        look: look(
            HEADS.benimaru,
            'kimono',
            SKIN.fair,
            {
                h: '#d8382c',
                H: '#a3221a',
                l: '#f26a4f',
                q: '#2a2430',
                Q: '#4a4252',
                i: '#d8382c',
                c: '#2b2b33',
                C: '#1a1a20',
                t: '#d8382c',
                k: '#d8382c',
                K: '#a3221a',
                p: '#3d3d48',
                P: '#2a2a33',
                f: '#4a3426',
            },
            { item: 'katana' }
        ),
    },
    {
        slug: 'writer',
        name: 'Shion',
        formerly: 'June Ellery',
        look: look(
            HEADS.shion,
            'suit-skirt',
            SKIN.fair,
            {
                h: '#7e4fc0',
                H: '#5a3590',
                l: '#a97fe6',
                q: '#2a2430',
                Q: '#4a4252',
                i: '#8a5cc7',
                c: '#2f2a3d',
                C: '#1e1a29',
                u: '#efeaf5',
                k: '#8a5cc7',
                p: '#2f2a3d',
                P: '#1e1a29',
                j: '#3a3448',
                J: '#2a2534',
                f: '#1a1423',
            },
            { item: 'greatsword' }
        ),
    },
    {
        slug: 'critic',
        name: 'Hakurou',
        formerly: 'Halle Roth',
        look: look(
            HEADS.hakurou,
            'kimono',
            SKIN.fair,
            {
                h: '#eeeeee',
                H: '#c4c4c4',
                l: '#ffffff',
                i: '#3a3346',
                c: '#4e5f4e',
                C: '#354235',
                t: '#e8e2d4',
                k: '#7a6a4a',
                K: '#5a4a2e',
                p: '#3d3d48',
                P: '#2a2a33',
                f: '#4a3426',
            },
            { item: 'cane', squint: true }
        ),
    },
    {
        slug: 'data-engineer',
        name: 'Kaijin',
        formerly: 'Sol Nakamura',
        look: look(
            HEADS.kaijin,
            'apron',
            SKIN.ruddy,
            {
                h: '#7a4a2a',
                H: '#5a321b',
                l: '#9a6a44',
                i: '#3a6aa0',
                c: '#5a6e8a',
                C: '#41526b',
                t: '#5a6e8a',
                k: '#8a5a36',
                K: '#6a4226',
                p: '#4a4a58',
                P: '#33333f',
            },
            { item: 'hammer' }
        ),
    },
    {
        slug: 'editor',
        name: 'Rigurd',
        formerly: 'Marcus Vane',
        look: look(
            HEADS.rigurd,
            'tunic',
            SKIN.tan,
            {
                h: '#2a2430',
                H: '#1a1423',
                l: '#4a4252',
                i: '#7a5a2a',
                c: '#6b7f3a',
                C: '#4f5f28',
                t: '#8a5a36',
                p: '#5a4a3a',
                P: '#40342a',
            },
            { item: 'ledger' }
        ),
    },
    {
        slug: 'video-editor',
        name: 'Kurobe',
        formerly: 'Kit Alvarez',
        look: look(
            HEADS.kurobe,
            'apron',
            SKIN.fair,
            {
                h: '#24232b',
                H: '#15141a',
                l: '#3a3946',
                q: '#d9d0bd',
                Q: '#a89f8c',
                x: '#f2efe6',
                X: '#cfc8b5',
                i: '#5a4636',
                c: '#c9c3b5',
                C: '#a9a293',
                t: '#8a8f99',
                k: '#4a3a2e',
                K: '#33281f',
                p: '#3d3d48',
                P: '#2a2a33',
                f: '#2a1f17',
                y: '#3a3946',
            },
            { item: 'reel' }
        ),
    },
    {
        slug: 'motion-designer',
        name: 'Ramiris',
        formerly: 'Rune Sato',
        look: look(
            HEADS.ramiris,
            'dress',
            SKIN.fair,
            {
                h: '#8fd8ec',
                H: '#5fb3cf',
                l: '#d2f4fb',
                x: '#ee6f93',
                X: '#c94f73',
                i: '#3f8fd6',
                c: '#fbf7f0',
                C: '#ddd5c6',
                t: '#8fd8ec',
                k: '#ee6f93',
                f: '#8fd8ec',
                v: '#d4f6ffb0',
            },
            { item: 'wand', back: ['wings'], floats: true }
        ),
    },
    {
        slug: 'caption-writer',
        name: 'Treyni',
        formerly: 'Priya Raman',
        look: look(
            HEADS.treyni,
            'dress',
            SKIN.dryad,
            {
                h: '#5bbd5f',
                H: '#3c8f45',
                l: '#9be08f',
                x: '#f6c64a',
                X: '#d9a22e',
                i: '#4a9a5a',
                c: '#5f9f45',
                C: '#467a32',
                t: '#9be08f',
                k: '#f6c64a',
                f: '#467a32',
                y: '#7bc96f',
            },
            { item: 'leaf' }
        ),
    },
    {
        slug: 'social-strategist',
        name: 'Gabiru',
        formerly: 'Dez Okafor',
        look: look(
            HEADS.gabiru,
            'armor',
            SKIN.lizard,
            {
                x: '#d8382c',
                X: '#a3221a',
                i: '#1a1423',
                w: '#f2c230',
                c: '#8a5a36',
                C: '#6a4226',
                t: '#5a3a2a',
                k: '#d8382c',
                K: '#a3221a',
                p: '#4f8a36',
                P: '#3c6e28',
                f: '#3c6e28',
            },
            { item: 'spear', back: ['cape'] }
        ),
    },
    {
        slug: 'social-publisher',
        name: 'Gobta',
        formerly: 'Wren Hollis',
        look: look(
            HEADS.gobta,
            'armor',
            SKIN.tan,
            {
                h: '#3a3346',
                H: '#241f2e',
                l: '#5a5268',
                i: '#3a2a1a',
                c: '#8a6a4a',
                C: '#6a4e34',
                t: '#5a3a2a',
                k: '#d8382c',
                K: '#a3221a',
                p: '#5a4a3a',
                P: '#40342a',
            },
            { item: 'megaphone' }
        ),
    },
    {
        slug: 'archivist',
        name: 'Veldora',
        formerly: 'Tomas Leger',
        look: look(
            HEADS.veldora,
            'coat',
            SKIN.fair,
            {
                h: '#f2d16b',
                H: '#c9a83e',
                l: '#fff0b0',
                i: '#e8b923',
                c: '#3a3550',
                C: '#28243a',
                t: '#e8b923',
                p: '#3a3550',
                P: '#28243a',
                f: '#1a1423',
                x: '#d8382c',
                y: '#4f7bd6',
            },
            { item: 'manga' }
        ),
    },
    {
        slug: 'llr-liabilities',
        name: 'Carrera',
        formerly: 'Adaeze Nwosu',
        look: look(
            HEADS.carrera,
            'uniform',
            SKIN.fair,
            {
                h: '#f5d76e',
                H: '#d4b04a',
                l: '#fff0b0',
                i: '#e8b923',
                c: '#1f1b24',
                C: '#110e15',
                k: '#d8382c',
                u: '#f2eff7',
                t: '#e8b923',
                p: '#1f1b24',
                P: '#110e15',
                f: '#1a1423',
                x: '#d8382c',
            },
            { item: 'book' }
        ),
    },
    {
        slug: 'llr-risk',
        name: 'Ultima',
        formerly: 'Tobias Okonkwo',
        look: look(
            HEADS.ultima,
            'dress',
            SKIN.fair,
            {
                h: '#9d6bd6',
                H: '#6f45a8',
                l: '#c9a5f2',
                i: '#9d6bd6',
                c: '#3a2a4f',
                C: '#271b36',
                t: '#9d6bd6',
                k: '#9d6bd6',
                j: '#2a1f3a',
                J: '#1e1629',
                f: '#1a1423',
            },
            { item: 'dice' }
        ),
    },
    {
        slug: 'llr-legal',
        name: 'Testarossa',
        formerly: 'Margit Halvorsen',
        look: look(
            HEADS.testarossa,
            'dress',
            SKIN.pale,
            {
                h: '#f2f0f7',
                H: '#c9c5d8',
                l: '#ffffff',
                i: '#d6283a',
                c: '#f2eff7',
                C: '#cfc8dc',
                t: '#d6283a',
                k: '#d6283a',
                f: '#d6283a',
            },
            { item: 'gavel' }
        ),
    },
];

/** Names for hires past the seeded roster, used in order, then residents. */
export const POOL: readonly PoolMember[] = [
    {
        name: 'Geld',
        look: look(RESIDENT_HEADS.orc, 'armor', SKIN.orc, {
            h: '#2a2430',
            H: '#1a1423',
            i: '#a36a1f',
            c: '#6a5a3a',
            C: '#4f4228',
            t: '#3a2a1a',
            k: '#8a5a36',
            K: '#6a4226',
            p: '#4a4a58',
            P: '#33333f',
        }, { item: 'hammer' }),
    },
    {
        name: 'Rigur',
        look: look(RESIDENT_HEADS['hob-short'], 'tunic', SKIN.tan, {
            h: '#2a2430',
            H: '#1a1423',
            l: '#4a4252',
            i: '#5a3a2a',
            c: '#3b6ea8',
            C: '#2a4f7a',
            t: '#8a5a36',
            p: '#4a4a58',
            P: '#33333f',
        }, { item: 'spear' }),
    },
    {
        name: 'Vesta',
        look: look(HEADS.kaijin, 'coat', SKIN.ruddy, {
            h: '#9a9aa6',
            H: '#74747f',
            l: '#c0c0ca',
            i: '#3a6aa0',
            c: '#f2efe6',
            C: '#cfc8b5',
            t: '#3a6aa0',
            p: '#4a4a58',
            P: '#33333f',
        }, { item: 'book' }),
    },
    {
        name: 'Milim',
        look: look(HEADS.ultima, 'dress', SKIN.fair, {
            h: '#f59ac0',
            H: '#d66f98',
            l: '#ffd1e3',
            i: '#4f9ad6',
            c: '#2a2430',
            C: '#1a1423',
            t: '#f59ac0',
            k: '#f59ac0',
            f: '#2a2430',
        }),
    },
    {
        name: 'Myulan',
        look: look(HEADS.testarossa, 'robe', SKIN.fair, {
            h: '#6b4a2b',
            H: '#4d331c',
            l: '#8f6a45',
            i: '#3d7a4a',
            c: '#3d6b4a',
            C: '#2a4d34',
            t: '#e8c34a',
            k: '#e8c34a',
        }, { item: 'wand' }),
    },
    {
        name: 'Youm',
        look: look(RESIDENT_HEADS['hob-short'], 'armor', SKIN.fair, {
            z: '',
            h: '#6b4a2b',
            H: '#4d331c',
            l: '#8f6a45',
            i: '#3a6aa0',
            c: '#8a8f99',
            C: '#6a6f79',
            t: '#5a3a2a',
            k: '#3b6ea8',
            K: '#2a4f7a',
            p: '#4a4a58',
            P: '#33333f',
        }, { item: 'katana' }),
    },
];
