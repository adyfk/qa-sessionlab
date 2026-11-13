// Generates the extension icons as PNGs with no image dependencies:
// three stacked, offset rounded cards (blue / green / orange) = parallel isolated sessions.
import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x + 0.5, y + 0.5, size);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// signed distance to rounded rect, in unit coords
function rrect(px, py, x0, y0, x1, y1, r) {
  const cx = Math.max(x0 + r, Math.min(px, x1 - r));
  const cy = Math.max(y0 + r, Math.min(py, y1 - r));
  return Math.hypot(px - cx, py - cy) - r;
}

const cards = [
  { x: 0.06, y: 0.06, c: [250, 144, 62] },   // orange (back)
  { x: 0.17, y: 0.17, c: [24, 128, 56] },    // green
  { x: 0.28, y: 0.28, c: [26, 115, 232] },   // blue (front)
];

function pixel(x, y, size) {
  const u = x / size, v = y / size, aa = 1 / size;
  let out = [0, 0, 0, 0];
  for (const k of cards) {
    const d = rrect(u, v, k.x, k.y, k.x + 0.66, k.y + 0.66, 0.12);
    const a = Math.max(0, Math.min(1, 0.5 - d / aa));
    if (a <= 0) continue;
    // white border between cards for separation
    const border = Math.max(0, Math.min(1, 0.5 - (d + 0.035) / aa));
    const col = k.c.map((ch) => ch * border + 255 * (1 - border));
    out = [0, 1, 2].map((i) => col[i] * a + out[i] * (1 - a)).concat([255 * a + out[3] * (1 - a)]);
  }
  // check mark on the front card
  const fx = (u - 0.28) / 0.66, fy = (v - 0.28) / 0.66;
  const seg = (ax, ay, bx, by) => {
    const t = Math.max(0, Math.min(1, ((fx - ax) * (bx - ax) + (fy - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
    return Math.hypot(fx - (ax + t * (bx - ax)), fy - (ay + t * (by - ay)));
  };
  const dc = Math.min(seg(0.25, 0.52, 0.43, 0.7), seg(0.43, 0.7, 0.76, 0.32)) - 0.07;
  const ca = Math.max(0, Math.min(1, 0.5 - dc / (aa / 0.66)));
  if (ca > 0 && fx > 0 && fx < 1 && fy > 0 && fy < 1) out = [0, 1, 2].map((i) => 255 * ca + out[i] * (1 - ca)).concat([out[3]]);
  return out.map((n) => Math.round(n));
}

export async function writeIcons(dir) {
  await mkdir(dir, { recursive: true });
  for (const s of [16, 32, 48, 128]) await writeFile(resolve(dir, `${s}.png`), png(s, pixel));
}
