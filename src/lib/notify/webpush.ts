/**
 * Web Push, by hand.
 *
 * A push message is an encrypted body (RFC 8291, aes128gcm) posted to the
 * endpoint the browser gave us, signed with the app's VAPID key (RFC 8292)
 * so the push service knows who is sending. Node's own crypto has every
 * primitive needed, so there is no package and no service in between: the
 * message goes from here to the browser's push service and nowhere else.
 *
 * The subscriber's side of the encryption is here too, exported for the
 * test, which plays the browser and reads what was sent.
 */

import { createCipheriv, createDecipheriv, createECDH, createPrivateKey, generateKeyPairSync, hkdfSync, randomBytes, sign as signData } from 'node:crypto';

export interface PushKeys {
    /** Base64url, the raw 65-byte uncompressed P-256 point. */
    publicKey: string;
    /** Base64url, the 32-byte scalar. */
    privateKey: string;
    /** mailto: or https: — who to contact about this sender. */
    subject: string;
}

export interface Subscription {
    endpoint: string;
    keys: { p256dh: string; auth: string };
}

export const b64url = {
    encode: (b: Uint8Array | Buffer): string => Buffer.from(b).toString('base64url'),
    decode: (s: string): Buffer => Buffer.from(s, 'base64url'),
};

/** A fresh VAPID key pair, as the two base64url strings Vercel will hold. */
export function generateVapidKeys(): { publicKey: string; privateKey: string } {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const jwk = privateKey.export({ format: 'jwk' }) as { x: string; y: string; d: string };
    const raw = Buffer.concat([Buffer.from([4]), b64url.decode(jwk.x), b64url.decode(jwk.y)]);
    return { publicKey: b64url.encode(raw), privateKey: jwk.d };
}

/** The signed token that tells a push service who is sending, good for twelve hours. */
export function vapidAuthorization(endpoint: string, keys: PushKeys, nowMs = Date.now()): string {
    const pub = b64url.decode(keys.publicKey);
    if (pub.length !== 65 || pub[0] !== 4) throw new Error('VAPID_PUBLIC_KEY is not a raw P-256 public key.');
    const jwk = { kty: 'EC', crv: 'P-256', x: b64url.encode(pub.subarray(1, 33)), y: b64url.encode(pub.subarray(33, 65)), d: keys.privateKey };
    const header = b64url.encode(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
    const claims = b64url.encode(Buffer.from(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(nowMs / 1000) + 12 * 3600, sub: keys.subject })));
    const signature = signData('sha256', Buffer.from(`${header}.${claims}`), { key: createPrivateKey({ key: jwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' });
    return `vapid t=${header}.${claims}.${b64url.encode(signature)}, k=${keys.publicKey}`;
}

const RECORD_SIZE = 4096;
const info = (s: string) => Buffer.from(`${s}\0`, 'utf8');

function deriveKeys(sharedSecret: Buffer, authSecret: Buffer, uaPublic: Buffer, asPublic: Buffer, salt: Buffer): { cek: Buffer; nonce: Buffer } {
    const ikmInfo = Buffer.concat([Buffer.from('WebPush: info\0', 'utf8'), uaPublic, asPublic]);
    const ikm = Buffer.from(hkdfSync('sha256', sharedSecret, authSecret, ikmInfo, 32));
    const cek = Buffer.from(hkdfSync('sha256', ikm, salt, info('Content-Encoding: aes128gcm'), 16));
    const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, info('Content-Encoding: nonce'), 12));
    return { cek, nonce };
}

/** The encrypted body for a subscription: one record, the whole message. */
export function encryptPayload(sub: Subscription, plaintext: string | Buffer, opts: { salt?: Buffer; senderPrivate?: Buffer } = {}): Buffer {
    const uaPublic = b64url.decode(sub.keys.p256dh);
    const authSecret = b64url.decode(sub.keys.auth);
    if (uaPublic.length !== 65 || authSecret.length !== 16) throw new Error('The subscription keys are not what a browser gives.');
    const ecdh = createECDH('prime256v1');
    if (opts.senderPrivate) ecdh.setPrivateKey(opts.senderPrivate);
    else ecdh.generateKeys();
    const asPublic = ecdh.getPublicKey();
    const shared = ecdh.computeSecret(uaPublic);
    const salt = opts.salt ?? randomBytes(16);
    const { cek, nonce } = deriveKeys(shared, authSecret, uaPublic, asPublic, salt);
    const padded = Buffer.concat([Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext, 'utf8'), Buffer.from([2])]);
    const cipher = createCipheriv('aes-128-gcm', cek, nonce);
    const body = Buffer.concat([cipher.update(padded), cipher.final(), cipher.getAuthTag()]);
    const header = Buffer.alloc(21);
    salt.copy(header, 0);
    header.writeUInt32BE(RECORD_SIZE, 16);
    header[20] = asPublic.length;
    return Buffer.concat([header, asPublic, body]);
}

/** What the browser does with the body: here so the test can read a message back. */
export function decryptPayload(body: Buffer, subscriberPrivate: Buffer, authSecret: Buffer): string {
    const salt = body.subarray(0, 16);
    const idlen = body[20];
    const asPublic = body.subarray(21, 21 + idlen);
    const ciphertext = body.subarray(21 + idlen);
    const ecdh = createECDH('prime256v1');
    ecdh.setPrivateKey(subscriberPrivate);
    const uaPublic = ecdh.getPublicKey();
    const shared = ecdh.computeSecret(asPublic);
    const { cek, nonce } = deriveKeys(shared, authSecret, uaPublic, asPublic, salt);
    const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
    decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
    const padded = Buffer.concat([decipher.update(ciphertext.subarray(0, ciphertext.length - 16)), decipher.final()]);
    const delimiter = padded.lastIndexOf(2);
    return padded.subarray(0, delimiter).toString('utf8');
}

export interface PushResult {
    ok: boolean;
    status: number;
    /** The push service says this subscription no longer exists: drop it. */
    gone: boolean;
    detail?: string;
}

/** Send one message to one device. Never throws: a dead endpoint is a result, not a crash. */
export async function sendPush(sub: Subscription, payload: Record<string, unknown>, keys: PushKeys, ttlSeconds = 86_400): Promise<PushResult> {
    try {
        const body = encryptPayload(sub, JSON.stringify(payload));
        const res = await fetch(sub.endpoint, {
            method: 'POST',
            headers: {
                authorization: vapidAuthorization(sub.endpoint, keys),
                'content-encoding': 'aes128gcm',
                'content-type': 'application/octet-stream',
                ttl: String(ttlSeconds),
                urgency: 'normal',
            },
            // A copy into a plain ArrayBuffer, which is what fetch's body type wants.
            body: new Uint8Array(body),
            signal: AbortSignal.timeout(8_000),
        });
        const gone = res.status === 404 || res.status === 410;
        return { ok: res.ok, status: res.status, gone, detail: res.ok ? undefined : (await res.text()).slice(0, 160) };
    } catch (err) {
        return { ok: false, status: 0, gone: false, detail: (err as Error).message };
    }
}
