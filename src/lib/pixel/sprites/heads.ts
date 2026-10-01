/**
 * Heads: hair, horns, faces.
 *
 * Each is 16 wide. Row 0 lands on sprite row 0; rows 0-1 are spare for horns
 * and spiky hair, and a head may run past row 13 — long hair over the
 * shoulders, a beard over the chest — because heads are painted after bodies.
 *
 * Slots:
 *   o outline   h/H/l hair, its shade and highlight   s/S skin and shade
 *   e lashes and closed eyes   i iris   w eye shine   r pupil accent
 *   m mouth   b blush   q/Q horn and shade   x/X accent (a streak, a band)
 *   z ear tip   g gold
 *
 * Drawn for this dashboard as fan art in the spirit of the characters, not
 * traced from anything: a few signature colours and shapes per character.
 */

import { grid, type Grid } from '../canvas';

export const HEADS = {
    // Pink hime cut, two small white horns.
    shuna: grid(`
        ................
        .....q....q.....
        ...ooqooooqoo...
        ..ohhhhhhhhhho..
        .ohhhlhhhhhhhho.
        .ohhhhhhhhhhhho.
        .ohhhhhhhhhhhho.
        .ohhhhhhhhhhhho.
        .ohseesssseesho.
        .ohsiwssssiwsho.
        .ohsiissssiisho.
        .ohsbssssssbsho.
        .ohhossmmssohho.
        .ohhhoooooohhho.
        .ohho......ohho.
        ..oo........oo..
    `),
    // Red and spiky, two black horns.
    benimaru: grid(`
        ...oo......oo...
        ...oqo....oqo...
        ...oqQooooQqo...
        ..ohlhhhhhhhho..
        .ohhhhhhhhhhhho.
        .ohhhhhhhhhhhho.
        .oHhhhhhhhhhhHo.
        .ohHshhhhhhsHho.
        .ohseesssseesho.
        .ohsiwssssiwsho.
        ..osiissssiiso..
        ..osbssssssbso..
        ...osssmmssso...
        ....oooooooo....
    `),
    // Long violet hair, one horn at the brow.
    shion: grid(`
        .......oo.......
        ......oqqo......
        ...ooooqQoooo...
        ..ohhhhhhhhhho..
        .ohhlhhhhhhhhho.
        .ohhhhhhhhhhhho.
        .ohhhhhhhhhhhho.
        .ohhhshhhhshhho.
        .ohseesssseesho.
        .ohsiwssssiwsho.
        .ohsiissssiisho.
        .ohsbssssssbsho.
        .ohhossmmssohho.
        .ohhhoooooohhho.
        .ohhho....ohhho.
        .ohho......ohho.
        ..oo........oo..
    `),
    // Dark blue, swept over one eye, one horn, a cool look.
    souei: grid(`
        ....oo..........
        ....oqo.........
        ...ooqQooooo....
        ..ohhhhhhhhhho..
        .ohhhlhhhhhhhho.
        .ohhhhhhhhhhhho.
        .ohhhhhhhhhhhho.
        .ohhhhhhhhshhho.
        .ohhhhhssseesho.
        .ohhhhhsssiisho.
        ..ohhhssssssso..
        ..ohsssssssbso..
        ...osssmmssso...
        ....oooooooo....
    `),
    // White hair drawn back, a long white beard, eyes narrowed with age.
    hakurou: grid(`
        ................
        ................
        ....oooooooo....
        ...ohhhhhhhho...
        ..ohhlhhhhhhho..
        ..ohhhhhhhhhho..
        ..ohhhhhhhhhho..
        ..ohsssssssssho.
        ..oseesssseeso..
        ..osssssssssso..
        ..osssshhsssso..
        ..oshhhhhhhhso..
        ..ohhhhhhhhhho..
        ...ohhhhhhhho...
        ....ohhhhhho....
        .....ohhhho.....
        ......oooo......
    `),
    // A dwarf: receding hair, heavy brows, a great beard.
    kaijin: grid(`
        ................
        ................
        ....oooooooo....
        ...ohssssssho...
        ..ohhsssssshho..
        ..ohsssssssssho.
        ..ohsssssssssho.
        ..ohsHHssssHHso.
        ..ohseesssseeso.
        ..ohsiissssiiso.
        ..ohhhsssssshhho
        ..ohhhhhmmhhhhho
        ..ohhhhhhhhhhhho
        ...ohhhhhhhhhho.
        ....ohhhhhhhho..
        .....ohhhhhho...
        ......oooooo....
    `),
    // A hobgoblin elder: cropped hair, a heavy moustache.
    rigurd: grid(`
        ................
        ................
        ....oooooooo....
        ...ohhhhhhhho...
        ..ohhhhhhhhhho..
        ..ohhhhhhhhhho..
        ..osssssssssso..
        .zosHHssssHHsoz.
        .zoseessssseeso.
        ..osiwssssiwso..
        ..osssssSsssso..
        ..oshhhhhhhhso..
        ...oshsmmshso...
        ....oooooooo....
    `),
    // Black and messy, one horn, a white headband.
    kurobe: grid(`
        .........oo.....
        .........oqo....
        ...ooooooqQoo...
        ..ohhhlhhhhhho..
        .ohhhhhhhhhhhho.
        .oxxxxxxxxxxxxo.
        .oXxxxxxxxxxxXo.
        .ohhshhhhhhshho.
        .ohseesssseesho.
        .ohsiwssssiwsho.
        ..osiissssiiso..
        ..osssssssssso..
        ...osssmmssso...
        ....oooooooo....
    `),
    // A fairy: long light hair and a big bow.
    ramiris: grid(`
        ................
        .xx..........xx.
        oxXxooooooooxXxo
        .xxohhhhhhhhoxx.
        ..ohhlhhhhhhho..
        .ohhhhhhhhhhhho.
        .ohhhhhhhhhhhho.
        .ohhshhhhhhshho.
        .ohseesssseesho.
        .ohsiwssssiwsho.
        .ohsiissssiisho.
        .ohsbssssssbsho.
        .ohhossmmssohho.
        .ohhhoooooohhho.
        .ohhho....ohhho.
        ..ohho....ohho..
        ...oo......oo...
    `),
    // A dryad: long green hair, a flower, pointed ears.
    treyni: grid(`
        ................
        ................
        ...oooooooxxo...
        ..ohhhhhhhxXxo..
        .ohhlhhhhhhxxho.
        .ohhhhhhhhhhhho.
        .ohhhhhhhhhhhho.
        zohhshhhhhhshhoz
        zohseesssseeshoz
        .ohsiwssssiwsho.
        .ohsiissssiisho.
        .ohsbssssssbsho.
        .ohhossmmssohho.
        .ohhhoooooohhho.
        .ohhho....ohhho.
        .ohho......ohho.
        ..oo........oo..
    `),
    // A lizardman: a red crest, slit eyes, a long snout.
    gabiru: grid(`
        ......oxxo......
        .....oxXXxo.....
        ....oxxXXxxo....
        ...ossxxxxsso...
        ..osssssssssso..
        .osssssssssssso.
        .osSssssssssSso.
        .oswiessssseiwso
        .ossiessssseisso
        .osssssssssssso.
        ..osSssssssSso..
        ..osssssssssso..
        ..oseessssseeso.
        ..ossmmmmmmmsso.
        ...ossssssssso..
        ....ooooooooo...
    `),
    // A young hobgoblin: spiky hair, big eyes, a wide grin.
    gobta: grid(`
        ..o..o..o..o....
        ..oho.ohoohoo...
        ..ohhohhhhhho...
        ..ohhhhhhhhhho..
        .ohhhlhhhhhhhho.
        .ohhhhhhhhhhhho.
        .ohhhhhhhhhhhho.
        zohhshhhhhhshhoz
        zoseeesssseeesoz
        .osiiwssssiiwso.
        ..osiissssiiso..
        ..osbssssssbso..
        ...osmmmmmmso...
        ....oooooooo....
    `),
    // Long, wild golden hair and a grin.
    veldora: grid(`
        ..o...o..o...o..
        .ohooohoohooho..
        .ohhhhhhhhhhhho.
        .ohhlhhhhhhhhho.
        ohhhhhhhhhhhhhho
        ohhhhhhhhhhhhhho
        ohhhhhhhhhhhhhho
        ohhhshhhhhhshhho
        .ohseesssseesho.
        .ohsiwssssiwsho.
        .ohsiissssiisho.
        .ohssssssssssho.
        ohhhosmmmmsohhho
        ohhhhoooooohhhho
        ohhhho....ohhhho
        .ohho......ohho.
        ..oo........oo..
    `),
    // Long golden hair, golden eyes, a fang.
    carrera: grid(`
        ................
        ................
        ...oooooooooo...
        ..ohhhhhhhhhho..
        .ohhlhhhhhhhhho.
        .ohhhhhhhhhhhho.
        .ohhhhhhhhhhhho.
        .ohhshhhhhhshho.
        .ohseesssseesho.
        .ohsiwssssiwsho.
        .ohsiissssiisho.
        .ohssssssssssho.
        .ohhosmmmwsohho.
        .ohhhoooooohhho.
        .ohhho....ohhho.
        .ohhho....ohhho.
        ..ohho....ohho..
        ...oo......oo...
    `),
    // Short violet hair with twin tails.
    ultima: grid(`
        ................
        ................
        ...oooooooooo...
        ..ohhhhhhhhhho..
        .ohhlhhhhhhhhho.
        ohhhhhhhhhhhhhho
        ohhhhhhhhhhhhhho
        ohhhshhhhhhshhho
        ohhseesssseeshho
        .ohsiwssssiwsho.
        .ohsiissssiisho.
        ohhsbssssssbshho
        ohhoossmmssoohho
        .oo.oooooooo.oo.
    `),
    // Long white hair, red eyes, composed.
    testarossa: grid(`
        ................
        ................
        ...oooooooooo...
        ..ohhhhhhhhhho..
        .ohhlhhhhhhhhho.
        .ohhhhhhhhhhhho.
        .ohhhhhhhhhhhho.
        .ohhshhhhhhshho.
        .ohseesssseesho.
        .ohsiwssssiwsho.
        .ohsiissssiisho.
        .ohsbssssssbsho.
        .ohhossmmssohho.
        .ohhhoooooohhho.
        .ohhho....ohhho.
        .ohhho....ohhho.
        .ohho......ohho.
        ..oo........oo..
    `),
    // Black hair with a red forelock; gold eyes with red pupils.
    diablo: grid(`
        ................
        ................
        ....oooooooo....
        ...ohhhhhhhhoo..
        ..ohhhhhhxhhhho.
        .ohhhhhhhxxhhhho
        .ohhhhhhhhxhhhho
        .ohhshhhhhhxshho
        .ohseesssseesho.
        .ohsiwssssiwsho.
        ..hsirssssirsh..
        ..osssssssssso..
        ...osssmmssso...
        ....oooooooo....
    `),
} satisfies Record<string, Grid>;

export type HeadId = keyof typeof HEADS;

/**
 * Residents' heads, for hires past the named cast. Colour does most of the
 * varying; these give each kind its own silhouette.
 */
export const RESIDENT_HEADS = {
    // Hobgoblins: three haircuts.
    'hob-short': grid(`
        ................
        ................
        ....oooooooo....
        ...ohhhhhhhho...
        ..ohhlhhhhhhho..
        ..ohhhhhhhhhho..
        ..ohhhhhhhhhho..
        .zohhsshhsshhoz.
        .zoseesssseesoz.
        ..osiwssssiwso..
        ..osiissssiiso..
        ..osbssssssbso..
        ...osssmmssso...
        ....oooooooo....
    `),
    'hob-long': grid(`
        ................
        ................
        ...oooooooooo...
        ..ohhhhhhhhhho..
        .ohhlhhhhhhhhho.
        .ohhhhhhhhhhhho.
        .ohhhhhhhhhhhho.
        zohhshhhhhhshhoz
        zohseesssseeshoz
        .ohsiwssssiwsho.
        .ohsiissssiisho.
        .ohsbssssssbsho.
        .ohhossmmssohho.
        .ohhhoooooohhho.
        .ohho......ohho.
        ..oo........oo..
    `),
    'hob-bun': grid(`
        ......oooo......
        .....ohhhho.....
        ....oohhhhoo....
        ...ohhhhhhhho...
        ..ohhlhhhhhhho..
        ..ohhhhhhhhhho..
        ..ohssshhsssho..
        .zoseesssseesoz.
        .zosiwssssiwsoz.
        ..osiissssiiso..
        ..osbssssssbso..
        ...osssmmssso...
        ....oooooooo....
        ................
    `),
    // Kobolds: a dog's ears and muzzle.
    kobold: grid(`
        ..oo........oo..
        .ohho......ohho.
        .ohHho....ohHho.
        .ohhhoooooohhho.
        ..ohhhhhhhhhho..
        .ohhhhhhhhhhhho.
        .ohhhhhhhhhhhho.
        .ohheehhhheehho.
        .ohhiwhhhhiwhho.
        .ohhhhssssshhho.
        ..ohhssoossshho.
        ..ohhsssssshho..
        ...ohssmmssho...
        ....oooooooo....
    `),
    // Dwarves: a helmet and a beard.
    dwarf: grid(`
        ................
        ......oooo......
        ....ooxxxxoo....
        ...oxxxxxxxxo...
        ..oxXxxxxxxXxo..
        ..oXXXXXXXXXXo..
        ..osssssssssso..
        ..oseessssseeso.
        ..osiissssiisso.
        ..ohhsssssshhho.
        ..ohhhhmmhhhhho.
        ..ohhhhhhhhhhho.
        ...ohhhhhhhhho..
        ....ohhhhhhho...
        .....ohhhhho....
        ......ooooo.....
    `),
    // High orcs: a heavy brow, tusks, a broad jaw.
    orc: grid(`
        ................
        ................
        ....oooooooo....
        ...ohhhhhhhho...
        ..ohhhhhhhhhho..
        ..ossssssssssso.
        .zoSSSssssSSSoz.
        .zoseesssseesoz.
        ..osiwssssiwso..
        ..osssssSsssso..
        ..osssssssssso..
        ..oswssmmsswso..
        ...ossssssssso..
        ....ooooooooo...
    `),
    // Lizardmen: a crest and a snout.
    lizard: grid(`
        ................
        ......oxxo......
        .....oxXXxo.....
        ...ossxxxxsso...
        ..osssssssssso..
        .osssssssssssso.
        .oswiesssseiwso.
        .ossiesssseisso.
        .osssssssssssso.
        ..osSssssssSso..
        ..ossssssssssso.
        ..oseessssseeso.
        ..ossmmmmmmmsso.
        ...ossssssssso..
        ....ooooooooo...
    `),
} satisfies Record<string, Grid>;

export type ResidentHeadId = keyof typeof RESIDENT_HEADS;

/**
 * The same head with its eyes shut: every eye column keeps only its bottom
 * pixel, as a line. Used for sleep, a bow, a laugh, and blinking.
 */
export function closedEyes(head: Grid): Grid {
    const rows = head.rows.map((r) => r.split(''));
    const isEye = (c: string) => c === 'e' || c === 'i' || c === 'w' || c === 'r';
    for (let x = 0; x < head.w; x++) {
        let bottom = -1;
        for (let y = 0; y < head.h; y++) if (isEye(rows[y][x])) bottom = y;
        if (bottom < 0) continue;
        for (let y = 0; y < head.h; y++) if (isEye(rows[y][x])) rows[y][x] = y === bottom ? 'e' : 's';
    }
    return { ...head, rows: rows.map((r) => r.join('')) };
}
