/**
 * Notifications, offline.
 *
 * Push: keys, the VAPID token verified with the public key, and a message
 * encrypted then read back by a simulated browser. Email: the request to
 * Resend. The notify step: who gets what, by their preferences, with dead
 * devices dropped and nothing thrown when a service is down.
 *
 *   npm run delphi:notify
 */

import { createECDH, createPublicKey, randomBytes, verify } from 'node:crypto';
import { b64url, decryptPayload, encryptPayload, generateVapidKeys, sendPush, vapidAuthorization } from '../src/lib/notify/webpush';
import { sendEmail } from '../src/lib/notify/email';
import { notify, type Prefs } from '../src/lib/delphi/notify';
import type { Db } from '../src/lib/delphi/db';

const G = '\x1b[32m', R = '\x1b[31m', D = '\x1b[2m', RS = '\x1b[0m';
let failed = 0;
const ok = (cond: boolean, label: string, note = '') => {
    if (!cond) failed++;
    console.log(`  ${cond ? G + '✓' : R + '✗'}${RS} ${label.padEnd(66)}${note ? D + note + RS : ''}`);
};

// A fake fetch that records every request.
interface Sent { url: string; method: string; headers: Record<string, string>; body: Buffer | string }
const sent: Sent[] = [];
type Route = (req: Sent) => { status?: number; body?: string } | undefined;
let route: Route = () => ({ status: 201 });
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) headers[k.toLowerCase()] = v;
    const body = init?.body instanceof Uint8Array ? Buffer.from(init.body) : typeof init?.body === 'string' ? init.body : '';
    const req: Sent = { url, method: init?.method ?? 'GET', headers, body };
    sent.push(req);
    const hit = route(req);
    if (!hit) throw new TypeError('fetch failed');
    return new Response(hit.body ?? '', { status: hit.status ?? 200 });
}) as typeof fetch;

/** A browser's side of a subscription. */
function subscriber(endpoint: string) {
    const ecdh = createECDH('prime256v1');
    ecdh.generateKeys();
    const auth = randomBytes(16);
    return { endpoint, keys: { p256dh: b64url.encode(ecdh.getPublicKey()), auth: b64url.encode(auth) }, priv: ecdh.getPrivateKey(), auth };
}

type Row = Record<string, unknown>;
function fakeDb(tables: Record<string, Row[]>) {
    let nextId = 1;
    function builder(table: string) {
        const st = { op: 'select' as 'select' | 'insert' | 'update' | 'delete' | 'upsert', filters: [] as ((r: Row) => boolean)[], payload: null as unknown, single: false, head: false };
        const run = () => {
            const rows = (tables[table] ??= []);
            let out: Row[];
            if (st.op === 'insert' || st.op === 'upsert') {
                const ins = (Array.isArray(st.payload) ? st.payload : [st.payload]) as Row[];
                out = ins.map((r) => ({ id: `${table}-${nextId++}`, ...r }));
                rows.push(...out);
            } else if (st.op === 'update') {
                out = rows.filter((r) => st.filters.every((f) => f(r)));
                for (const r of out) Object.assign(r, st.payload as Row);
            } else if (st.op === 'delete') {
                out = rows.filter((r) => st.filters.every((f) => f(r)));
                for (const r of out) rows.splice(rows.indexOf(r), 1);
            } else {
                out = rows.filter((r) => st.filters.every((f) => f(r))).map((r) => ({ ...r }));
            }
            if (st.head) return { data: null, count: out.length, error: null };
            return st.single ? { data: out[0] ?? null, error: null } : { data: out, error: null, count: out.length };
        };
        const b: Record<string, unknown> = {
            select: (_c?: string, o?: { head?: boolean }) => ((st.head = !!o?.head), b),
            eq: (k: string, v: unknown) => (st.filters.push((r) => r[k] === v), b),
            insert: (p: unknown) => ((st.op = 'insert'), (st.payload = p), b),
            upsert: (p: unknown) => ((st.op = 'upsert'), (st.payload = p), b),
            update: (p: unknown) => ((st.op = 'update'), (st.payload = p), b),
            delete: () => ((st.op = 'delete'), b),
            maybeSingle: () => ((st.single = true), b),
            then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
        };
        return b;
    }
    return { db: { from: builder } as unknown as Db, tables };
}

(async () => {
    console.log('\nPush: keys and the token');
    const vapid = generateVapidKeys();
    {
        ok(b64url.decode(vapid.publicKey).length === 65 && b64url.decode(vapid.publicKey)[0] === 4 && b64url.decode(vapid.privateKey).length === 32, 'a key pair is a raw public point and a 32-byte scalar');
        const keys = { ...vapid, subject: 'mailto:cho@example.com' };
        const auth = vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', keys, 1_800_000_000_000);
        const m = auth.match(/^vapid t=([^,]+), k=(.+)$/);
        ok(!!m && m[2] === vapid.publicKey, 'the authorization carries a token and the public key');
        const [h, c, sig] = m![1].split('.');
        const header = JSON.parse(b64url.decode(h).toString());
        const claims = JSON.parse(b64url.decode(c).toString());
        ok(header.alg === 'ES256' && header.typ === 'JWT', 'signed ES256');
        ok(claims.aud === 'https://fcm.googleapis.com' && claims.sub === 'mailto:cho@example.com' && claims.exp === 1_800_000_000 + 12 * 3600, 'for the push service, from us, good for twelve hours');
        const pub = b64url.decode(vapid.publicKey);
        const jwk = { kty: 'EC', crv: 'P-256', x: b64url.encode(pub.subarray(1, 33)), y: b64url.encode(pub.subarray(33, 65)) };
        const valid = verify('sha256', Buffer.from(`${h}.${c}`), { key: createPublicKey({ key: jwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }, b64url.decode(sig));
        ok(valid, 'and the signature verifies with the public key');
    }

    console.log('\nPush: the message');
    {
        const browser = subscriber('https://updates.push.services.mozilla.com/wpush/v2/xyz');
        const body = encryptPayload(browser, 'When I grow up, I want to be a watermelon');
        ok(body.readUInt32BE(16) === 4096 && body[20] === 65 && body.length === 21 + 65 + 'When I grow up, I want to be a watermelon'.length + 1 + 16, 'the body is salt, record size, the sender key, then one record', `${body.length} bytes`);
        ok(decryptPayload(body, browser.priv, browser.auth) === 'When I grow up, I want to be a watermelon', 'and the browser reads it back');
        ok(!encryptPayload(browser, 'same words').equals(encryptPayload(browser, 'same words')), 'a fresh salt and key every time');
        let bad = '';
        try {
            decryptPayload(body, subscriber('x').priv, browser.auth);
        } catch (e) {
            bad = (e as Error).message;
        }
        ok(bad.length > 0, 'another device cannot read it', bad.slice(0, 40));

        const keys = { ...vapid, subject: 'mailto:cho@example.com' };
        sent.length = 0;
        route = () => ({ status: 201 });
        const res = await sendPush(browser, { title: 'Hi', body: 'there', url: '/x' }, keys);
        const req = sent[0];
        ok(res.ok && res.status === 201 && !res.gone, 'a send is a POST to the endpoint that the service accepts');
        ok(req.method === 'POST' && req.headers.authorization?.startsWith('vapid t=') === true && req.headers['content-encoding'] === 'aes128gcm' && req.headers.ttl === '86400', 'signed, encrypted, with a day to live');
        ok(Buffer.isBuffer(req.body) && decryptPayload(req.body as Buffer, browser.priv, browser.auth) === JSON.stringify({ title: 'Hi', body: 'there', url: '/x' }), 'carrying the note as JSON');
        route = () => ({ status: 410 });
        const gone = await sendPush(browser, { title: 'Hi' }, keys);
        ok(!gone.ok && gone.gone, 'a 410 means the device is gone');
        route = () => undefined;
        const down = await sendPush(browser, { title: 'Hi' }, keys);
        ok(!down.ok && !down.gone && /fetch failed/.test(down.detail ?? ''), 'and a service that does not answer is a result, not a throw');
    }

    console.log('\nEmail');
    {
        process.env.RESEND_API_KEY = 're_test';
        sent.length = 0;
        route = () => ({ status: 200, body: '{"id":"e1"}' });
        const r = await sendEmail('cho@example.com', 'Report landed', 'text', '<b>html</b>');
        const req = sent[0];
        const body = JSON.parse(req.body as string);
        ok(r.ok && req.url === 'https://api.resend.com/emails' && req.headers.authorization === 'Bearer re_test', 'goes to Resend with the key');
        ok(body.to[0] === 'cho@example.com' && body.subject === 'Report landed' && body.from === 'Tempest <onboarding@resend.dev>' && body.html === '<b>html</b>', 'to the address given, from the default sender');
        route = () => ({ status: 403, body: 'nope' });
        ok(!(await sendEmail('a@b.c', 's', 't', 'h')).ok, 'a refusal is a result');
    }

    console.log('\nWho gets what');
    {
        process.env.VAPID_PUBLIC_KEY = vapid.publicKey;
        process.env.VAPID_PRIVATE_KEY = vapid.privateKey;
        process.env.VAPID_SUBJECT = 'mailto:cho@example.com';
        const phone = subscriber('https://fcm.googleapis.com/fcm/send/phone');
        const laptop = subscriber('https://fcm.googleapis.com/fcm/send/laptop');
        const old = subscriber('https://fcm.googleapis.com/fcm/send/old');
        const prefs = (user_id: string, p: Partial<Prefs>) => ({ workspace_id: 'ws', user_id, email: p.email ?? null, on_report: p.onReport ?? true, on_approval: p.onApproval ?? true, on_halt: p.onHalt ?? true });
        const { db, tables } = fakeDb({
            delphi_notify_prefs: [prefs('curtis', { email: 'curtis@example.com', onHalt: false }), prefs('quiet', { email: 'quiet@example.com', onReport: false })],
            delphi_push_subscriptions: [
                { id: 's1', workspace_id: 'ws', user_id: 'curtis', endpoint: phone.endpoint, p256dh: phone.keys.p256dh, auth: phone.keys.auth, failures: 0 },
                { id: 's2', workspace_id: 'ws', user_id: 'curtis', endpoint: laptop.endpoint, p256dh: laptop.keys.p256dh, auth: laptop.keys.auth, failures: 0 },
                { id: 's3', workspace_id: 'ws', user_id: 'quiet', endpoint: old.endpoint, p256dh: old.keys.p256dh, auth: old.keys.auth, failures: 0 },
                { id: 's4', workspace_id: 'ws', user_id: 'devices-only', endpoint: 'https://fcm.googleapis.com/fcm/send/d', p256dh: phone.keys.p256dh, auth: phone.keys.auth, failures: 0 },
            ],
        });
        sent.length = 0;
        route = (req) => (req.url.includes('/old') ? { status: 410 } : { status: req.url.includes('resend') ? 200 : 201, body: '{}' });
        const report = await notify(db, 'ws', { kind: 'report', title: 'Report landed: Morning brief', body: 'Done.', url: '/dashboard/delphi/outputs' });
        ok(report.emailed === 1 && report.pushed === 3 && report.dropped === 0 && report.errors.length === 0, 'a report reaches everyone who wants reports: one email, three devices', JSON.stringify(report));
        const emails = sent.filter((s) => s.url.includes('resend')).map((s) => JSON.parse(s.body as string).to[0]);
        ok(emails.join(',') === 'curtis@example.com', 'the one who switched reports off is not emailed');
        ok(sent.some((s) => s.url.endsWith('/d')), 'a device whose owner never saved preferences gets the defaults');
        ok(tables.delphi_push_subscriptions.find((r) => r.id === 's1')?.last_ok_at !== undefined, 'a delivered device is marked as answering');

        sent.length = 0;
        const halt = await notify(db, 'ws', { kind: 'halt', title: 'Halted on budget', body: 'x', url: '/dashboard/delphi' });
        ok(halt.emailed === 1 && halt.dropped === 1 && !tables.delphi_push_subscriptions.some((r) => r.id === 's3'), 'a halt skips who switched halts off, and drops a device that is gone', JSON.stringify(halt));

        sent.length = 0;
        const test = await notify(db, 'ws', { kind: 'test', title: 'Test', body: 'x', url: '/' }, { onlyUserId: 'curtis' });
        ok(test.emailed === 1 && test.pushed === 2 && sent.every((s) => !s.url.endsWith('/d')), 'a test goes only to the person who asked, whatever their settings');

        route = () => undefined;
        const down = await notify(db, 'ws', { kind: 'approval', title: 'Waiting on you', body: 'x', url: '/dashboard/delphi/approvals' });
        ok(down.pushed === 0 && down.emailed === 0 && down.errors.length > 0 && tables.delphi_push_subscriptions.find((r) => r.id === 's1')?.failures === 1, 'with every service down nothing throws and the failures are counted', `${down.errors.length} errors`);

        delete process.env.VAPID_PRIVATE_KEY;
        delete process.env.RESEND_API_KEY;
        sent.length = 0;
        const unset = await notify(db, 'ws', { kind: 'report', title: 'R', body: 'x', url: '/' });
        ok(unset.pushed === 0 && unset.emailed === 0 && sent.length === 0, 'without keys nothing is attempted');
    }

    console.log(`\n${failed ? R + failed + ' failed' : G + 'all passed'}${RS}\n`);
    process.exit(failed ? 1 : 0);
})().catch((e) => {
    console.error('THREW:', e);
    process.exit(1);
});
