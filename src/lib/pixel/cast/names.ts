/**
 * The names in the active cast, and nothing else.
 *
 * Prompts, the activity log, the shell and the manifest all need the CEO's
 * name or the product's, and none of them should carry sprite data to get
 * it. So the names live here, with no imports, and the pack in `tensura.ts`
 * reads them too — one source, however many readers.
 *
 * Swapping the cast means swapping this file along with the pack. The
 * `formerly` names are the seed roster's own, which is what a live row still
 * says before the cast is applied, and what comes back if it is ever removed.
 */

export const APP_NAME = 'Tempest';

/** The CHO, by their chosen name. Never an agent; never has a row. */
export const CHO_NAME = 'Rimuru';

export const CEO_NAME = 'Diablo';
/** What the CEO row was called before the cast: see ensureDelphiAgent. */
export const CEO_FORMERLY = 'Delphi';

/** Seeded agents by slug: the character who plays them, and the seed name. */
export const CAST_NAMES: Readonly<Record<string, { name: string; formerly: string }>> = {
    'research-analyst': { name: 'Shuna', formerly: 'Vera Quinn' },
    'global-news-monitor': { name: 'Souei', formerly: 'Idris Kane' },
    'market-analyst': { name: 'Benimaru', formerly: 'Nadia Brandt' },
    writer: { name: 'Shion', formerly: 'June Ellery' },
    critic: { name: 'Hakurou', formerly: 'Halle Roth' },
    'data-engineer': { name: 'Kaijin', formerly: 'Sol Nakamura' },
    editor: { name: 'Rigurd', formerly: 'Marcus Vane' },
    'video-editor': { name: 'Kurobe', formerly: 'Kit Alvarez' },
    'motion-designer': { name: 'Ramiris', formerly: 'Rune Sato' },
    'caption-writer': { name: 'Treyni', formerly: 'Priya Raman' },
    'social-strategist': { name: 'Gabiru', formerly: 'Dez Okafor' },
    'social-publisher': { name: 'Gobta', formerly: 'Wren Hollis' },
    archivist: { name: 'Veldora', formerly: 'Tomas Leger' },
    'llr-liabilities': { name: 'Carrera', formerly: 'Adaeze Nwosu' },
    'llr-risk': { name: 'Ultima', formerly: 'Tobias Okonkwo' },
    'llr-legal': { name: 'Testarossa', formerly: 'Margit Halvorsen' },
};

/** Names kept for hires past the seeded roster, handed out in this order. */
export const POOL_NAMES: readonly string[] = ['Geld', 'Rigur', 'Vesta', 'Milim', 'Myulan', 'Youm'];

/** The slug the CEO row carries; the same as DELPHI_SLUG in the data layer. */
export const CEO_SLUG = 'delphi-ceo';

/** The character name a seeded agent or the CEO should carry, with the name it replaces. */
export function castNameFor(slug: string): { name: string; formerly: string } | null {
    if (slug === CEO_SLUG) return { name: CEO_NAME, formerly: CEO_FORMERLY };
    return CAST_NAMES[slug] ?? null;
}

/**
 * The next pool name nobody on the roster has, or null once the pool is
 * spent — after which a hire is a resident with a generated name.
 */
export function nextPoolName(taken: Iterable<string>): string | null {
    const used = new Set(taken);
    return POOL_NAMES.find((n) => !used.has(n)) ?? null;
}

/**
 * A prompt with its identity line pointing at the new name: "You are Vera
 * Quinn, a Senior Research Analyst." becomes "You are Shuna, ...". Every
 * mention of the old name goes, since a prompt that introduces one name and
 * signs another confuses the model that reads it. Nothing else changes.
 */
export function renameInPrompt(prompt: string, formerly: string, name: string): string {
    if (!formerly || formerly === name) return prompt;
    return prompt.split(formerly).join(name);
}
