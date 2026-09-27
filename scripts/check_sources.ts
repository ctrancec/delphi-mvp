/**
 * Prove the two new sources say only what they actually know — and that they
 * reach the agents meant to use them.
 *
 * The failures worth guarding against here are all quiet ones:
 *
 *  - a blank Bank of Canada observation read as zero, which is a fabricated
 *    policy rate;
 *  - a wire story carried by four outlets counted as four confirmations, which
 *    is how a single source gets reported as well corroborated;
 *  - a throttled GDELT call handing the agent nothing but still leaving it free
 *    to write as if it had looked;
 *  - a channel shipped after an agent was hired never reaching that agent, so
 *    the connection exists and nobody can use it;
 *  - Delphi staffing data work without being able to see who holds which data.
 *
 * None of those throws. Each produces plausible output. So each is asserted.
 */

import { bareBocId, fetchBocSeries } from '../src/lib/channels/boc';
import {
    buildQuery,
    corroborate,
    headlineKey,
    searchGdelt,
    useGdeltClock,
    type GdeltArticle,
} from '../src/lib/channels/gdelt';
import {
    CHANNEL_CAPABILITIES,
    implementedChannelKinds,
    toolsForChannels,
} from '../src/lib/channels/registry';
import { bindRosterChannels, listChannels, seedChannels, syncChannels } from '../src/lib/delphi/db';
import { channelChecks, worst } from '../src/lib/delphi/diagnostics';
import { buildPlanPrompt } from '../src/lib/delphi/delphi';
import type { Candidate } from '../src/lib/delphi/types';

const G = '\x1b[32m', R = '\x1b[31m', D = '\x1b[2m', RS = '\x1b[0m';

let failed = 0;
const ok = (cond: boolean, label: string, note = '') => {
    if (!cond) failed++;
    console.log(`  ${cond ? G + '✓' : R + '✗'}${RS} ${label.padEnd(56)}${note ? D + note + RS : ''}`);
};

// ---------------------------------------------------------------------------
// A fake network
// ---------------------------------------------------------------------------

type Route = (url: string) => { status?: number; body: string } | undefined;
let route: Route = () => undefined;
const requested: string[] = [];

globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    requested.push(url);
    const hit = route(url);
    if (!hit) throw new Error(`unexpected request: ${url}`);
    return new Response(hit.body, { status: hit.status ?? 200 });
}) as typeof fetch;

const json = (o: unknown) => ({ body: JSON.stringify(o) });

// ---------------------------------------------------------------------------
// A fake database, enough of PostgREST for the code under test
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

function fakeDb(
    tables: Record<string, Row[]>,
    onInsert: (table: string, row: Row) => { code: string; message: string } | null = () => null
) {
    const builder = (table: string) => {
        const filters: ((r: Row) => boolean)[] = [];
        let mode: 'select' | 'insert' | 'update' = 'select';
        let payload: Row | null = null;
        let insertError: { code: string; message: string } | null = null;

        const run = () => {
            if (mode === 'insert') return { data: null, error: insertError };
            const matched = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
            if (mode === 'update') for (const r of matched) Object.assign(r, payload);
            return { data: matched, error: null };
        };

        const self: Record<string, unknown> = {
            select: () => self,
            eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), self),
            order: () => self,
            insert: (row: Row) => {
                mode = 'insert';
                insertError = onInsert(table, row);
                if (!insertError) (tables[table] ??= []).push({ id: `${table}-${row.kind ?? 'x'}`, ...row });
                return self;
            },
            update: (patch: Row) => ((mode = 'update'), (payload = patch), self),
            then: (resolve: (v: unknown) => unknown) => Promise.resolve(run()).then(resolve),
        };
        return self;
    };
    return { from: (t: string) => builder(t) } as never;
}

function channel(id: string, kind: string, label: string): Row {
    return {
        id, workspace_id: 'ws-1', kind, label, config: {}, credential_ref: null,
        enabled: true, health: 'unknown', health_detail: null, last_ok_at: null,
    };
}

// ---------------------------------------------------------------------------

(async () => {
    console.log('\nBank of Canada: every number dated, no blank read as zero\n' + '─'.repeat(74));

    {
        // Valet's real shape: one row per date, carrying only the series
        // observed that day, in no promised order.
        route = (url) =>
            url.includes('bankofcanada.ca')
                ? json({
                      seriesDetail: { FXUSDCAD: { label: 'USD/CAD' }, CPI_TRIM: { label: 'CPI-trim' } },
                      observations: [
                          { d: '2026-09-25', FXUSDCAD: { v: '1.4145' } },
                          { d: '2026-09-23', FXUSDCAD: { v: '1.4096' } },
                          { d: '2026-09-24', FXUSDCAD: { v: '' } },
                          { d: '2026-08-01', CPI_TRIM: { v: '1.9' } },
                          { d: '2026-07-01', CPI_TRIM: { v: '1.9' } },
                      ],
                  })
                : undefined;

        const { series } = await fetchBocSeries(['FXUSDCAD', 'CPI_TRIM']);
        const fx = series.find((s) => s.seriesId === 'FXUSDCAD')!;
        const cpi = series.find((s) => s.seriesId === 'CPI_TRIM')!;

        ok(fx.points.length === 2, 'a blank observation is dropped', 'not coerced to 0');
        ok(!fx.points.some((p) => p.value === 0), 'so no zero appears anywhere');
        ok(fx.points[0].date === '2026-09-23' && fx.latest?.value === 1.4145, 'sorted oldest first, latest is latest', '1.4145 on 09-25');
        ok(cpi.points.length === 2, 'a monthly series reads out beside a daily one');

        const [tool] = toolsForChannels(['boc']);
        const res = await tool.execute({ seriesIds: ['boc:fxusdcad', 'CPI_TRIM'] });
        ok(
            res.locators.some((l) => l.kind === 'series' && l.seriesId === 'BOC:FXUSDCAD' && l.date === '2026-09-25'),
            'citations carry the BOC: id and the exact date'
        );
        ok(res.locators.length === 4, 'one citation per real observation', 'none for the blank');
        ok(requested.at(-1)!.includes('/FXUSDCAD,CPI_TRIM/'), 'a prefixed, lower-case id is asked for correctly');
        ok(bareBocId(' BOC:v39079 ') === 'V39079', 'either form of an id resolves to one');
    }

    {
        // Valet fails the whole request over one unknown id.
        route = (url) => {
            if (!url.includes('bankofcanada.ca')) return undefined;
            if (url.includes('NOT_A_SERIES')) {
                return { status: 404, body: JSON.stringify({ message: 'Series NOT_A_SERIES not found.' }) };
            }
            return json({ observations: [{ d: '2026-09-25', FXUSDCAD: { v: '1.4145' } }] });
        };

        const [tool] = toolsForChannels(['boc']);
        const res = await tool.execute({ seriesIds: ['FXUSDCAD', 'NOT_A_SERIES'] });
        ok(res.locators.length === 1, 'one bad id does not cost the good ones');
        ok(/no series named NOT_A_SERIES/.test(res.content), 'and the bad one is named, so nothing is asserted for it');
    }

    console.log('\nGDELT: one report republished is one source\n' + '─'.repeat(74));

    const article = (domain: string, title: string, country: string, language: string, n: number): GdeltArticle => ({
        url: `https://${domain}/story-${n}`, title, domain, country, language, seenAt: `2026-09-24 1${n}:00Z`,
    });

    {
        // The case that prompted this, as observed live: one wire story on
        // four Quebec sites, with the small differences real copies carry.
        const wire = [
            article('granbyexpress.com', 'Grève à la Banque du Canada : le NPD accuse Ottawa', 'Canada', 'French', 1),
            article('lavoixdusud.com', 'GRÈVE À LA BANQUE DU CANADA: le NPD accuse Ottawa', 'Canada', 'French', 2),
            article('courrierfrontenac.qc.ca', 'Greve a la Banque du Canada : le NPD accuse Ottawa', 'Canada', 'French', 3),
            article('lechodemaskinonge.com', 'Grève à la Banque du Canada : le NPD accuse Ottawa | L’Écho', 'Canada', 'French', 4),
        ];
        const independent = [
            article('reuters.com', 'Bank of Canada workers walk out over pay', 'United States', 'English', 5),
            article('lemonde.fr', 'Canada : la banque centrale face à une grève inédite', 'France', 'French', 6),
        ];

        const c = corroborate([...wire, ...independent]);
        ok(c.reports.length === 3, 'six articles are three reports, not six', `${c.outlets} outlets`);
        ok(c.reports[0].outlets.length === 4, 'the wire story is one report carried four times');
        ok(c.syndicatedCopies === 3, 'three of those outlets are counted as copies');
        ok(c.countries.length === 3 && c.languages.length === 2, 'countries and languages are counted', c.countries.join(', '));
        ok(headlineKey('Story here | Some Outlet') === headlineKey('Story here'), 'an outlet naming itself is not a different story');
    }

    {
        useGdeltClock({ now: () => 0, sleep: async () => {} });
        route = (url) =>
            url.includes('gdeltproject.org')
                ? json({
                      articles: [
                          { url: 'https://a.ca/1', title: 'Same wire headline', domain: 'a.ca', language: 'French', sourcecountry: 'Canada', seendate: '20260924T100000Z' },
                          { url: 'https://b.ca/1', title: 'Same wire headline', domain: 'b.ca', language: 'French', sourcecountry: 'Canada', seendate: '20260924T110000Z' },
                          { url: 'https://c.fr/1', title: 'A different report', domain: 'c.fr', language: 'French', sourcecountry: 'France', seendate: '20260924T120000Z' },
                      ],
                  })
                : undefined;

        const [tool] = toolsForChannels(['gdelt']);
        const res = await tool.execute({ query: 'Banque du Canada' });
        ok(/ONE report, republished; not 2 confirmations/.test(res.content), 'the agent is told a copy is not a confirmation');
        ok(/Distinct reports: 2\. Syndicated copies: 1/.test(res.content), 'the counts are stated, not left to be worked out');
        ok(res.locators.length === 3 && res.locators.every((l) => l.kind === 'url'), 'every shown article is citable by URL');
    }

    console.log('\nGDELT: when it will not answer, the agent is told so\n' + '─'.repeat(74));

    const THROTTLE = 'Please limit requests to one every 5 seconds or contact us for larger queries.';

    {
        let t = 0;
        const slept: number[] = [];
        useGdeltClock({ now: () => t, sleep: async (ms) => { slept.push(ms); t += ms; } });
        route = (url) => (url.includes('gdeltproject.org') ? json({ articles: [] }) : undefined);

        await searchGdelt({ query: 'Bank of Canada' });
        await searchGdelt({ query: 'Bank of Canada' });
        ok(slept.some((ms) => ms >= 5_000), 'back-to-back calls are spaced', `${Math.max(...slept)}ms`);
    }

    {
        // Retrying a refusal only prolongs it — measured by others, and seen
        // here: from shared cloud addresses the throttle did not lift.
        let t = 0;
        useGdeltClock({ now: () => t, sleep: async (ms) => { t += ms; } });
        route = (url) => (url.includes('gdeltproject.org') ? { status: 429, body: THROTTLE } : undefined);

        const before = requested.length;
        const r = await searchGdelt({ query: 'Bank of Canada' });
        ok(r.kind === 'unavailable' && r.reason === 'throttled', 'a throttle is an answer, not a reason to ask again');
        ok(requested.length - before === 1, 'exactly one request is made', 'no retry to prolong the block');
    }

    {
        useGdeltClock({ now: () => 0, sleep: async () => {} });
        route = (url) => (url.includes('gdeltproject.org') ? { body: THROTTLE } : undefined);

        const [tool] = toolsForChannels(['gdelt']);
        const res = await tool.execute({ query: 'Bank of Canada' });
        ok(res.locators.length === 0, 'still refused: nothing to cite');
        ok(/Assert nothing/.test(res.content) && /rss_headlines/.test(res.content), 'and pointed at the sources that still work');

        const before = requested.length;
        const probe = await searchGdelt({ query: 'economy', probe: true });
        ok(
            probe.kind === 'unavailable' && probe.reason === 'throttled' && requested.length - before === 1,
            'a health probe reports rather than waits'
        );
    }

    {
        // Seen live while this was being built: a 503, then 429s taking ten
        // seconds each. However GDELT fails to answer, the agent hears the same.
        let t = 0;
        useGdeltClock({ now: () => t, sleep: async (ms) => { t += ms; } });
        route = (url) => (url.includes('gdeltproject.org') ? { status: 503, body: 'Service Unavailable' } : undefined);
        const [tool] = toolsForChannels(['gdelt']);
        const res = await tool.execute({ query: 'Bank of Canada' });
        ok(res.locators.length === 0 && /not answering right now \(HTTP 503\)/.test(res.content), 'a 503 reads as down, not thrown, with nothing to cite');

        // The cooldown: an agent told to fall back may still try once more.
        const before = requested.length;
        const again = await tool.execute({ query: 'a different query' });
        ok(requested.length === before, 'a second try inside the cooldown asks nothing', 'no second wait');
        ok(/still cooling off/.test(again.content) && again.locators.length === 0, 'and says why');

        t += 5 * 60_000;
        await tool.execute({ query: 'five minutes later' });
        ok(requested.length === before, 'still cooling off five minutes on', 'a refusal can last a quarter hour');

        t += 6 * 60_000;
        route = (url) => (url.includes('gdeltproject.org') ? json({ articles: [] }) : undefined);
        const later = await searchGdelt({ query: 'Bank of Canada' });
        ok(later.kind === 'ok' && requested.length > before, 'after ten minutes it asks again');
    }

    {
        // A request that never answers. The fake network throws what
        // AbortSignal.timeout throws.
        useGdeltClock({ now: () => 0, sleep: async () => {} });
        route = (url) => {
            if (!url.includes('gdeltproject.org')) return undefined;
            throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
        };
        const timedOut = await searchGdelt({ query: 'Bank of Canada' }).then((r) => r, () => null);
        ok(timedOut?.kind === 'unavailable' && timedOut.reason === 'down', 'a timeout is an answer, not an exception', timedOut?.kind === 'unavailable' ? timedOut.detail : '');
    }

    {
        useGdeltClock({ now: () => 0, sleep: async () => {} });
        route = (url) => (url.includes('gdeltproject.org') ? { body: 'The specified phrase is too short.' } : undefined);

        const [tool] = toolsForChannels(['gdelt']);
        const res = await tool.execute({ query: 'BoC' });
        ok(res.locators.length === 0 && /too short/.test(res.content), 'a rejected query is explained, verbatim', 'so it can be rephrased');

        route = (url) => (url.includes('gdeltproject.org') ? json({}) : undefined);
        const empty = await tool.execute({ query: 'nothing matches this' });
        ok(empty.locators.length === 0 && /Absence here is not evidence/.test(empty.content), 'no coverage is not reported as a finding');
    }

    {
        ok(
            buildQuery({ query: 'rates', languages: ['French', 'spanish'] }) === 'rates (sourcelang:french OR sourcelang:spanish)',
            'languages become one OR group'
        );
        ok(
            buildQuery({ query: 'rates', countries: ['United Kingdom'] }) === 'rates sourcecountry:unitedkingdom',
            'country names lose their spaces'
        );
        ok(
            !buildQuery({ query: 'x', countries: ['france) OR (theme:ANYTHING'] }).includes(')'),
            'a filter value cannot smuggle in its own operators'
        );
    }

    console.log('\nThe channels reach the agents already hired\n' + '─'.repeat(74));

    {
        // A database that predates migration 0007: the kind check refuses both.
        const tables: Record<string, Row[]> = {
            delphi_channels: [channel('c-rss', 'rss', 'Global News Feeds')],
        };
        const db = fakeDb(tables, (table, row) =>
            table === 'delphi_channels' && (row.kind === 'boc' || row.kind === 'gdelt')
                ? { code: '23514', message: 'violates check constraint "delphi_channels_kind_check"' }
                : null
        );

        let threw = false;
        const warn = console.warn;
        console.warn = () => {};
        try {
            await seedChannels(db, 'ws-1');
        } catch {
            threw = true;
        } finally {
            console.warn = warn;
        }
        ok(!threw, 'before the migration, seeding does not throw');
        ok(tables.delphi_channels.length === 1, 'the new kinds are skipped', 'existing channels untouched');
    }

    {
        const tables: Record<string, Row[]> = { delphi_channels: [channel('c-rss', 'rss', 'Global News Feeds')] };
        const res = await seedChannels(fakeDb(tables), 'ws-1');
        ok(res.inserted === 2, 'after it, both are recorded', tables.delphi_channels.map((c) => c.kind).join(', '));

        const raced = await seedChannels(
            fakeDb({ delphi_channels: [] }, () => ({ code: '23505', message: 'duplicate key' })),
            'ws-1'
        ).then(() => true, () => false);
        ok(raced, 'a concurrent sync that got there first is not an error');
    }

    {
        const tables: Record<string, Row[]> = {
            delphi_channels: [
                channel('c-fred', 'fred', 'FRED Economic Data'),
                channel('c-pplx', 'perplexity', 'Perplexity Web Search'),
                channel('c-rss', 'rss', 'Global News Feeds'),
                channel('c-boc', 'boc', 'Bank of Canada'),
                channel('c-gdelt', 'gdelt', 'GDELT Global News'),
            ],
            delphi_agents: [
                // Hired before the new channels existed, and given one extra by hand.
                { id: 'nadia', workspace_id: 'ws-1', slug: 'market-analyst', origin: 'seed', channel_ids: ['c-fred', 'c-pplx', 'c-extra'] },
                { id: 'idris', workspace_id: 'ws-1', slug: 'global-news-monitor', origin: 'seed', channel_ids: ['c-rss'] },
                { id: 'june', workspace_id: 'ws-1', slug: 'writer', origin: 'seed', channel_ids: [] },
                { id: 'kaelen', workspace_id: 'ws-1', slug: 'invented-specialist', origin: 'invented', channel_ids: [] },
            ],
        };
        const db = fakeDb(tables);
        const agent = (id: string) => tables.delphi_agents.find((a) => a.id === id)!.channel_ids as string[];

        const first = await bindRosterChannels(db, 'ws-1');
        ok(agent('nadia').includes('c-boc'), 'the market analyst now holds the Bank of Canada');
        ok(agent('nadia').includes('c-extra'), 'and keeps what she was given by hand', 'adds, never removes');
        ok(agent('idris').includes('c-gdelt'), 'the news monitor now holds GDELT');
        ok(agent('june').length === 0, 'a role that needs no channels gets none');
        ok(agent('kaelen').length === 0, 'an invented agent is left to its own spec');
        ok(first.updated === 2, 'exactly the agents that were missing something change');

        const second = await bindRosterChannels(db, 'ws-1');
        ok(second.updated === 0 && agent('nadia').length === 4, 'a second run changes nothing');

        const broken = { from: () => { throw new Error('connection reset'); } } as never;
        const warn = console.warn;
        console.warn = () => {};
        const synced = await syncChannels(broken, 'ws-1').then((r) => r, () => 'threw');
        console.warn = warn;
        ok(synced === null, 'a failed sync never takes the tick down with it');
    }

    console.log('\nDelphi can see what each channel does, and who holds it\n' + '─'.repeat(74));

    {
        const candidate = (slug: string, name: string, channelIds: string[]) =>
            ({
                agent: { slug, name, title: 'Agent', skills: ['x'], channelIds, costTier: 1 },
                stats: null,
                skillMatch: 1,
            }) as unknown as Candidate;

        const input = {
            brief: 'Screen equities near their 52-week lows.',
            candidates: [
                candidate('market-analyst', 'Nadia Brandt', ['c-fred', 'c-boc']),
                candidate('research-analyst', 'Vera Quinn', ['c-pplx']),
                candidate('writer', 'June Ellery', []),
            ],
            availableChannels: ['fred', 'perplexity', 'boc'] as ('fred' | 'perplexity' | 'boc')[],
            channelKindsById: { 'c-fred': 'fred', 'c-boc': 'boc', 'c-pplx': 'perplexity' } as const,
        };

        const prompt = buildPlanPrompt(input);
        ok(prompt.includes('channels: fred, boc'), 'each candidate is shown with what it holds');
        ok(prompt.includes('channels: perplexity'), 'including the analyst who only has web search');
        ok(prompt.includes('channels: none — cannot reach any live source'), 'and one with nothing says so');
        ok(/- perplexity — .*cannot screen stocks/.test(prompt), 'web search is described by what it cannot do', 'why screening went astray');
        ok(/- fred — .*No per-company or per-ticker data/.test(prompt), 'so is FRED');

        const legacy = buildPlanPrompt({ ...input, channelKindsById: undefined });
        ok(!legacy.includes('  channels:'), 'callers that pass no channel map are unchanged', 'test_hiring.ts');
    }

    {
        const kinds = implementedChannelKinds();
        ok(kinds.includes('boc') && kinds.includes('gdelt'), 'the health page lists both new channels');
        ok(kinds.every((k) => Boolean(CHANNEL_CAPABILITIES[k])), 'and every channel has a capability line');
        const names = toolsForChannels(['boc', 'gdelt', 'worldmonitor']).map((t) => t.declaration.name);
        ok(names.join(',') === 'boc_series,global_news_search', 'an unbuilt channel is still dropped, not faked');
    }

    console.log('\nSwitched off means off\n' + '─'.repeat(74));

    const REASON = 'Switched off by the CHO: its news API refuses shared cloud servers.';
    const off = (row: Row): Row => ({ ...row, enabled: false, health_detail: REASON });

    {
        const tables: Record<string, Row[]> = {
            delphi_channels: [
                channel('c-rss', 'rss', 'Global News Feeds'),
                channel('c-boc', 'boc', 'Bank of Canada'),
                off(channel('c-gdelt', 'gdelt', 'GDELT Global News')),
            ],
        };
        const db = fakeDb(tables);

        await seedChannels(db, 'ws-1');
        const rows = tables.delphi_channels.filter((c) => c.kind === 'gdelt');
        ok(rows.length === 1 && rows[0].enabled === false, 'a sync neither re-enables it nor adds a second row');
        ok(rows[0].health_detail === REASON, 'and the reason stays on record');

        const live = await listChannels(db, 'ws-1', true);
        ok(!live.some((c) => c.kind === 'gdelt'), 'it is not among the channels tools are built from', 'what the runtime reads');
    }

    {
        // Everything but the Bank of Canada is off, so the only probe allowed
        // to run is one the fake network can answer. GDELT's must not run.
        const tables: Record<string, Row[]> = {
            delphi_channels: [
                off(channel('c-pplx', 'perplexity', 'Perplexity Web Search')),
                off(channel('c-fred', 'fred', 'FRED Economic Data')),
                off(channel('c-rss', 'rss', 'Global News Feeds')),
                channel('c-boc', 'boc', 'Bank of Canada'),
                off(channel('c-gdelt', 'gdelt', 'GDELT Global News')),
            ],
        };
        route = (url) =>
            url.includes('bankofcanada.ca')
                ? json({ observations: [{ d: '2026-09-25', FXUSDCAD: { v: '1.4145' } }] })
                : undefined;

        const before = requested.length;
        const checks = await channelChecks(fakeDb(tables), 'ws-1');
        const made = requested.slice(before);
        const gdelt = checks.find((c) => c.name === 'gdelt')!;
        const boc = checks.find((c) => c.name === 'boc')!;

        ok(gdelt.level === 'off', 'diagnostics shows it as switched off, not broken');
        ok(gdelt.detail.startsWith(REASON), 'with the reason it was switched off');
        const toGdelt = made.filter((u) => u.includes('gdeltproject.org')).length;
        ok(toGdelt === 0, 'and never contacts it', `${toGdelt} of ${made.length} request(s) went to GDELT`);
        ok(boc.level === 'ok', 'a channel that is on is still checked', 'Bank of Canada');
        ok(worst(checks) === 'ok', 'switching things off does not make the verdict worse');
    }

    console.log(`\n${failed ? R + failed + ' failed' : G + 'all passed'}${RS}\n`);
    process.exit(failed ? 1 : 0);
})().catch((e) => {
    console.error('THREW:', e);
    process.exit(1);
});
