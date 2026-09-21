import Parser from 'rss-parser';
import { SEED_SOURCES } from '../src/lib/world/sources';

const parser = new Parser({ timeout: 12_000, headers: { 'User-Agent': 'Delphi/1.0' } });

(async () => {
    const results: { name: string; ok: boolean; count: number; err?: string }[] = [];
    const CONC = 6;
    for (let i = 0; i < SEED_SOURCES.length; i += CONC) {
        const batch = SEED_SOURCES.slice(i, i + CONC);
        const settled = await Promise.allSettled(batch.map((s) => parser.parseURL(s.rssUrl)));
        settled.forEach((r, j) => {
            const s = batch[j];
            if (r.status === 'fulfilled') results.push({ name: s.name, ok: true, count: r.value.items?.length ?? 0 });
            else results.push({ name: s.name, ok: false, count: 0, err: String((r.reason as Error).message).slice(0, 70) });
        });
    }
    const ok = results.filter((r) => r.ok);
    for (const r of results) console.log(`${r.ok ? 'ok  ' : 'DEAD'}  ${r.name.padEnd(26)} ${r.ok ? r.count + ' items' : r.err}`);
    console.log(`\n${ok.length}/${results.length} feeds live, ${ok.reduce((s, r) => s + r.count, 0)} items available`);
    const langs = new Set(SEED_SOURCES.filter(s => ok.some(o => o.name === s.name)).map(s => s.language));
    const countries = new Set(SEED_SOURCES.filter(s => ok.some(o => o.name === s.name)).map(s => s.country));
    console.log(`coverage: ${countries.size} countries, ${langs.size} languages (${[...langs].join(', ')})`);
})();
