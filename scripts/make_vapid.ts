/**
 * Prints a fresh VAPID key pair for push notifications. Paste the three
 * lines into Vercel's environment variables; nothing is written to disk.
 *
 *   npm run delphi:vapid
 */
import { generateVapidKeys } from '../src/lib/notify/webpush';

const { publicKey, privateKey } = generateVapidKeys();
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.log('VAPID_SUBJECT=mailto:you@example.com   # an address or https:// URL a push service may contact');
