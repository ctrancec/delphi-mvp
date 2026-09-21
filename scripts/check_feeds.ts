/**
 * Are the seeded feeds actually reachable?
 *
 *   npm run delphi:feeds
 *
 * Outlets change URLs, rate-limit and geo-block constantly, so the registry
 * rots. Results stream as they arrive rather than at the end, because a run
 * that gets killed part-way should still tell you something.
 */

import Parser from 'rss-parser';
import { FEED_USER_AGENT, SEED_SOURCES } from '../src/lib/world/sources';

const PER_FEED_MS = 8_000;
const CONCURRENCY = 8;

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

const parser = new Parser({
    timeout: PER_FEED_MS,
    headers: { 'User-Agent': FEED_USER_AGENT },
});

/** rss-parser's own timeout does not always cover a stalled connect. */
function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
        p,
        new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)
        ),
    ]);
}

async function main() {
    const live: string[] = [];
    const dead: { name: string; err: string }[] = [];

    for (let i = 0; i < SEED_SOURCES.length; i += CONCURRENCY) {
        const batch = SEED_SOURCES.slice(i, i + CONCURRENCY);
        await Promise.all(
            batch.map(async (s) => {
                try {
                    const feed = await withDeadline(parser.parseURL(s.rssUrl), PER_FEED_MS + 1_000);
                    const count = feed.items?.length ?? 0;
                    live.push(s.name);
                    console.log(`${GREEN}ok  ${RESET} ${s.name.padEnd(26)} ${DIM}${count} items${RESET}`);
                } catch (err) {
                    const message = (err as Error).message.slice(0, 60);
                    dead.push({ name: s.name, err: message });
                    console.log(`${RED}DEAD${RESET} ${s.name.padEnd(26)} ${DIM}${message}${RESET}`);
                }
            })
        );
    }

    const ok = SEED_SOURCES.filter((s) => live.includes(s.name));
    const countries = new Set(ok.map((s) => s.country));
    const languages = new Set(ok.map((s) => s.language));
    const wires = ok.filter((s) => s.category === 'wire').length;

    console.log(`\n${live.length}/${SEED_SOURCES.length} feeds live`);
    console.log(
        `coverage: ${countries.size} countries, ${languages.size} languages (${[...languages].sort().join(', ')}), ${wires} wires`
    );

    if (dead.length) {
        console.log(`\n${RED}dead:${RESET} ${dead.map((d) => d.name).join(', ')}`);
    }

    // A monitor with no wire service and no language diversity is not a
    // monitor, so those are the two conditions worth failing on.
    const tooThin = wires === 0 || languages.size < 3;
    if (tooThin) {
        console.log(`\n${RED}Coverage is too thin to corroborate anything.${RESET}`);
    }

    // Explicit, because undici holds keep-alive sockets open after the last
    // response and Node will not exit while they are alive — the run would
    // otherwise print its summary and then appear to hang.
    process.exit(tooThin ? 1 : 0);
}

main();
