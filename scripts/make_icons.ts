/**
 * Writes the app's icons from the slime sprite: the favicon, the tab icon,
 * the Apple touch icon, and the manifest's launcher icons in both purposes.
 * Run as `npm run delphi:icons`; the files it writes are committed.
 */
import { writeFileSync } from 'node:fs';
import { scaledIcon } from '../src/lib/pixel/brand';
import { encodeIco } from './lib/ico';
import { encodePng } from './lib/png';

const png = (base: number, scale: number, solid = false) => {
    const c = scaledIcon(base, scale, { solid });
    return { w: c.w, h: c.h, png: encodePng(c.w, c.h, c.data) };
};

const out: [string, Buffer][] = [
    ['src/app/favicon.ico', encodeIco([png(16, 1), png(16, 2)])],
    ['src/app/icon.png', png(16, 4).png],
    ['src/app/apple-icon.png', png(20, 9, true).png],
    ['public/icons/icon-192x192.png', png(16, 12).png],
    ['public/icons/icon-512x512.png', png(16, 32).png],
    ['public/icons/icon-maskable-192x192.png', png(24, 8, true).png],
    ['public/icons/icon-maskable-512x512.png', png(32, 16, true).png],
];
for (const [path, bytes] of out) {
    writeFileSync(path, bytes);
    console.log(`  ${path.padEnd(44)} ${bytes.length} bytes`);
}
