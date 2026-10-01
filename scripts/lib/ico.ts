/**
 * An .ico that holds PNG images — what every browser since 2010 reads, and
 * what lets the favicon be the same pixels as every other size of the icon.
 */
export function encodeIco(images: { w: number; h: number; png: Buffer }[]): Buffer {
    const header = Buffer.alloc(6);
    header.writeUInt16LE(0, 0);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(images.length, 4);
    const dir = Buffer.alloc(16 * images.length);
    let offset = header.length + dir.length;
    images.forEach((img, i) => {
        const o = i * 16;
        dir[o] = img.w >= 256 ? 0 : img.w;
        dir[o + 1] = img.h >= 256 ? 0 : img.h;
        dir[o + 2] = 0;
        dir[o + 3] = 0;
        dir.writeUInt16LE(1, o + 4);
        dir.writeUInt16LE(32, o + 6);
        dir.writeUInt32LE(img.png.length, o + 8);
        dir.writeUInt32LE(offset, o + 12);
        offset += img.png.length;
    });
    return Buffer.concat([header, dir, ...images.map((i) => i.png)]);
}
