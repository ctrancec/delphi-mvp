/**
 * The service worker, run outside a browser.
 *
 * public/sw.js is loaded into a sandbox with just enough of a browser around
 * it — caches, fetch, clients — to fire its events and watch what it does:
 * a page with no network becomes the offline page, a hashed asset is kept,
 * an API call is never touched, and a push becomes a notification.
 *
 *   npm run delphi:pwa
 */

import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const G = '\x1b[32m', R = '\x1b[31m', D = '\x1b[2m', RS = '\x1b[0m';
let failed = 0;
const ok = (cond: boolean, label: string, note = '') => {
    if (!cond) failed++;
    console.log(`  ${cond ? G + '✓' : R + '✗'}${RS} ${label.padEnd(66)}${note ? D + note + RS : ''}`);
};

// ---------------------------------------------------------------------------
// Just enough browser.
// ---------------------------------------------------------------------------
const ORIGIN = 'https://tempest.example';
const store = new Map<string, Response>();
const cache = {
    add: async (u: string) => {
        store.set(new URL(u, ORIGIN).href, new Response(`cached:${u}`, { status: 200 }));
    },
    put: async (req: { url: string }, res: Response) => {
        store.set(req.url, res);
    },
    match: async (req: { url: string } | string) => {
        const key = typeof req === 'string' ? new URL(req, ORIGIN).href : req.url;
        const hit = store.get(key);
        return hit ? hit.clone() : undefined;
    },
};
const cacheNames = new Set<string>(['tempest-static-v0', 'tempest-static-v1']);
const caches = {
    open: async () => cache,
    match: cache.match,
    keys: async () => [...cacheNames],
    delete: async (k: string) => cacheNames.delete(k),
};
let online = true;
const fetched: string[] = [];
const fetchImpl = async (req: { url: string }) => {
    fetched.push(req.url);
    if (!online) throw new TypeError('Failed to fetch');
    return new Response(`net:${new URL(req.url).pathname}`, { status: 200 });
};
const shown: { title: string; options: Record<string, unknown> }[] = [];
const opened: string[] = [];
const listeners = new Map<string, (e: unknown) => void>();
const self = {
    __tempest: null as null | { strategyFor: (url: URL, mode: string) => string; CACHE: string; OFFLINE_URL: string },
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: (e: unknown) => void) => listeners.set(type, fn),
    skipWaiting: async () => undefined,
    clients: { claim: async () => undefined, matchAll: async () => [], openWindow: async (u: string) => opened.push(u) },
    registration: { showNotification: async (title: string, options: Record<string, unknown>) => shown.push({ title, options }) },
};
const context = vm.createContext({ self, caches, fetch: fetchImpl, Request, Response, URL, Promise, Object, TypeError, console });
vm.runInContext(readFileSync('public/sw.js', 'utf8'), context);

const fire = async (type: string, event: Record<string, unknown>): Promise<Response | null> => {
    const box: { responded: Promise<Response> | null } = { responded: null };
    const waits: Promise<unknown>[] = [];
    listeners.get(type)!({
        ...event,
        respondWith: (p: Promise<Response>) => {
            box.responded = p;
        },
        waitUntil: (p: Promise<unknown>) => waits.push(p),
    });
    await Promise.all(waits);
    return box.responded ? await box.responded : null;
};
// Node's Request refuses mode 'navigate', so requests are the plain shape the worker reads.
const request = (path: string, mode = 'cors', method = 'GET', origin = ORIGIN) => ({ request: { url: `${origin}${path}`, method, mode } });

(async () => {
    console.log('\nRouting');
    {
        const s = self.__tempest!;
        ok(s.strategyFor(new URL(`${ORIGIN}/dashboard/delphi`), 'navigate') === 'page', 'a page is a page');
        ok(s.strategyFor(new URL(`${ORIGIN}/_next/static/chunks/app.js`), 'cors') === 'static' && s.strategyFor(new URL(`${ORIGIN}/icons/icon-192x192.png`), 'no-cors') === 'static', 'hashed assets and icons are static');
        ok(s.strategyFor(new URL(`${ORIGIN}/api/delphi/floor`), 'cors') === 'network' && s.strategyFor(new URL(`${ORIGIN}/dashboard/delphi/outputs`), 'cors') === 'network', 'data and everything else go to the network, uncached');
    }

    console.log('\nInstalling');
    {
        await fire('install', {});
        ok(store.has(`${ORIGIN}/offline`) && store.has(`${ORIGIN}/icons/icon-192x192.png`), 'the offline page and the icons are kept on install');
        await fire('activate', {});
        ok(cacheNames.has('tempest-static-v1') && !cacheNames.has('tempest-static-v0'), 'an older cache is thrown away on activation');
    }

    console.log('\nFetching');
    {
        online = true;
        fetched.length = 0;
        const page = await fire('fetch', request('/dashboard/delphi', 'navigate'));
        ok(page !== null && (await page.text()) === 'net:/dashboard/delphi', 'with a connection a page comes from the network');
        online = false;
        const offline = await fire('fetch', request('/dashboard/delphi/approvals', 'navigate'));
        ok(offline !== null && (await offline.text()) === 'cached:/offline', 'without one, the offline page stands in');
        online = true;
        fetched.length = 0;
        const asset = await fire('fetch', request('/_next/static/chunks/town.js'));
        ok(asset !== null && (await asset.text()) === 'net:/_next/static/chunks/town.js' && fetched.length === 1, 'an asset is fetched the first time');
        await new Promise((r) => setTimeout(r, 5));
        fetched.length = 0;
        const again = await fire('fetch', request('/_next/static/chunks/town.js'));
        ok(again !== null && (await again.text()) === 'net:/_next/static/chunks/town.js' && fetched.length === 0, 'and served from the cache after that');
        const api = await fire('fetch', request('/api/delphi/floor'));
        ok(api === null && !store.has(`${ORIGIN}/api/delphi/floor`), 'a reading of the town is never intercepted or cached');
        const post = await fire('fetch', request('/dashboard/delphi', 'navigate', 'POST'));
        ok(post === null, 'nor is anything but a GET');
        const foreign = await fire('fetch', request('/x', 'cors', 'GET', 'https://api.example.org'));
        ok(foreign === null, 'nor another origin');
    }

    console.log('\nNotifications');
    {
        await fire('push', { data: { json: () => ({ title: 'A report landed', body: 'Morning brief', url: '/dashboard/delphi/outputs' }) } });
        ok(shown.length === 1 && shown[0].title === 'A report landed' && (shown[0].options.data as { url: string }).url === '/dashboard/delphi/outputs', 'a push becomes a notification carrying its page');
        await fire('notificationclick', { notification: { close: () => undefined, data: { url: '/dashboard/delphi/outputs' } } });
        ok(opened[0] === '/dashboard/delphi/outputs', 'and tapping it opens that page');
    }

    console.log(`\n${failed ? R + failed + ' failed' : G + 'all passed'}${RS}\n`);
    process.exit(failed ? 1 : 0);
})().catch((e) => {
    console.error('THREW:', e);
    process.exit(1);
});
