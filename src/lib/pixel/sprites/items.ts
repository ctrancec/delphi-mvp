/**
 * What characters hold, what hangs behind them, and the two who are not
 * shaped like anyone else: Rimuru, a slime, and Ranga, a wolf.
 *
 * Items are painted before the arms, so the hand closes over the grip. `grip`
 * is the item pixel that lands on the right hand.
 *
 * Slots (on top of the character's own): a/A blade and its shade, d/D wood,
 * U/u paper, x/X the character's accent, y a second cover colour, g gold,
 * k red, w white, v wing.
 */

import { grid, type Grid } from '../canvas';

export interface Item {
    grid: Grid;
    grip: { x: number; y: number };
}

const item = (g: Grid, x: number, y: number): Item => ({ grid: g, grip: { x, y } });

export const ITEMS = {
    katana: item(
        grid(`
            .o.
            oko
            oko
            oko
            oko
            oko
            oko
            ogo
            odo
            odo
            odo
            .o.
        `),
        1,
        9
    ),
    greatsword: item(
        grid(`
            .ooo.
            oaaAo
            oaaAo
            oaaAo
            oaaAo
            oaaAo
            oaaAo
            oaaAo
            oaaAo
            ogggo
            .odo.
            .odo.
            .odo.
            ..o..
        `),
        2,
        11
    ),
    book: item(
        grid(`
            oooo
            oxxo
            oxgo
            oxxo
            oooo
        `),
        0,
        2
    ),
    scroll: item(
        grid(`
            .oo.
            oUUo
            oUuo
            oUUo
            .oo.
        `),
        0,
        2
    ),
    cane: item(
        grid(`
            oo
            od
            od
            od
            od
            od
            oo
        `),
        1,
        1
    ),
    hammer: item(
        grid(`
            ooooo
            oaaAo
            oAAAo
            .odo.
            .odo.
            .odo.
            ..o..
        `),
        2,
        4
    ),
    ledger: item(
        grid(`
            .ogo.
            oUUUo
            oUuUo
            oUUUo
            oUuUo
            ooooo
        `),
        1,
        2
    ),
    reel: item(
        grid(`
            .ooo.
            oyoyo
            ooyoo
            oyoyo
            .ooo.
        `),
        2,
        2
    ),
    wand: item(
        grid(`
            .o.
            ogo
            .o.
            .d.
            .d.
            .d.
        `),
        1,
        4
    ),
    leaf: item(
        grid(`
            ..oo
            .oyo
            oyyo
            oyo.
            oo..
        `),
        0,
        3
    ),
    spear: item(
        grid(`
            .o.
            oao
            oao
            oAo
            .o.
            .d.
            .d.
            .d.
            .d.
            .d.
            .d.
            .d.
            .d.
            .d.
            .d.
            .o.
        `),
        1,
        11
    ),
    megaphone: item(
        grid(`
            ooooo
            okwko
            .oko.
            .oko.
            ..o..
        `),
        2,
        3
    ),
    manga: item(
        grid(`
            oooo
            oxyo
            oyxo
            oxyo
            oooo
        `),
        0,
        2
    ),
    dice: item(
        grid(`
            oooo
            owko
            okwo
            oooo
        `),
        0,
        2
    ),
    gavel: item(
        grid(`
            ooooo
            oDddo
            ooooo
            .odo.
            .odo.
            ..o..
        `),
        2,
        4
    ),
    tome: item(
        grid(`
            oooo
            oxgo
            oxxo
            oxgo
            oooo
        `),
        0,
        2
    ),
} satisfies Record<string, Item>;

export type ItemId = keyof typeof ITEMS;

/** Layers painted behind the body, top-left at the given sprite row. */
export const BACKS = {
    wings: {
        y: 13,
        grid: grid(`
            .oo..........oo.
            ovvo........ovvo
            ovvvo......ovvvo
            .ovvvo....ovvvo.
            ..ovvo....ovvo..
            .ovvo......ovvo.
            ovvo........ovvo
            .oo..........oo.
        `),
    },
    cape: {
        y: 15,
        grid: grid(`
            ..oooooooooooo..
            ..okkkkkkkkkko..
            ..okkkkkkkkkko..
            ..okKkkkkkkKko..
            ..okkkkkkkkkko..
            ..okkkkkkkkkko..
            ..oKkkkkkkkkKo..
            ..okkkkkkkkkko..
            ..oKKkKKkKKkKo..
            ...oooooooooo...
        `),
    },
} satisfies Record<string, { y: number; grid: Grid }>;

export type BackId = keyof typeof BACKS;

/**
 * Rimuru. Two frames of a bounce: up, then squashed. Slots: a/A body and
 * shade, l shine, e eyes, o outline.
 */
export const SLIME: readonly Grid[] = [
    grid(`
        ................
        ......oooo......
        ....ooaaaaoo....
        ...oallaaaaao...
        ..oallaaaaaaao..
        ..oalaaaaaaaao..
        .oaaaaeaaeaaaao.
        .oaaaaeaaeaaaao.
        .oaaaaaaaaaaaao.
        .oAaaaaaaaaaaAo.
        .oAAaaaaaaaaAAo.
        ..oAAAAAAAAAAo..
        ...oooooooooo...
    `),
    grid(`
        ................
        ................
        ................
        .....oooooo.....
        ...ooaallaaoo...
        ..oalllaaaaaao..
        .oallaaaaaaaaao.
        oaaaaaeaaeaaaaao
        oaaaaaeaaeaaaaao
        oAaaaaaaaaaaaaAo
        oAAaaaaaaaaaaAAo
        .oAAAAAAAAAAAAo.
        ..oooooooooooo..
    `),
];

/**
 * Ranga, napping. Two frames of breathing. Slots: a/A fur and shade, q horn,
 * e closed eye, n nose.
 */
export const RANGA: readonly Grid[] = [
    grid(`
        ...o..o.................
        ..oaooao.......o........
        ..oaaaaoo.....oqo.......
        .oaaaaaaaoooooooooooo...
        oaaeeaaaaaaaaaaaaaaaaoo.
        onaaaaaaaaaaaaaaaaaaaaao
        .ooaaaaAaaaaaaaaaAaaaaao
        ..oaaaAAaaaaaaaaAAaaaao.
        ...oooooooooooooooooooo.
    `),
    grid(`
        ...o..o.................
        ..oaooao.......o........
        ..oaaaaoo.....oqo.......
        .oaaaaaaaoooooooooooo...
        oaaeeaaaaaaaaaaaaaaaaaoo
        onaaaaaaaaaaaaaaaaaaaaao
        .ooaaaaAaaaaaaaaaAaaaaao
        ..oaaaAAaaaaaaaaAAaaaao.
        ...oooooooooooooooooooo.
    `),
];
