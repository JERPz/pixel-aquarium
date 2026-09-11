/**
 * Dev-only sprite proofer. Renders the hand-authored pixel data to PNG so it
 * can actually be looked at, and fails loudly on malformed rows or on any
 * template that leans on a colour the player hasn't unlocked yet.
 *
 *   npm run sprites   ->  scripts/out/*.png
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { COLORS, TRANSPARENT, charToIndex, PALETTE } from '../src/data/palette.js';
import { TEMPLATES } from '../src/data/templates.js';
import { ITEMS, BACKGROUNDS } from '../src/data/items.js';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'out');

/* ---------- minimal PNG encoder (truecolour + alpha, no filtering) -------- */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(w, h, rgba) {
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------- canvas-ish ------------------------------- */

function surface(w, h) {
  const buf = Buffer.alloc(w * h * 4);
  return {
    w,
    h,
    buf,
    set(x, y, hex, a = 255) {
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      const i = (y * w + x) * 4;
      const n = parseInt(hex.slice(1), 16);
      buf[i] = (n >> 16) & 255;
      buf[i + 1] = (n >> 8) & 255;
      buf[i + 2] = n & 255;
      buf[i + 3] = a;
    },
    rect(x0, y0, rw, rh, hex) {
      for (let y = y0; y < y0 + rh; y++) for (let x = x0; x < x0 + rw; x++) this.set(x, y, hex);
    },
    png() {
      return encodePNG(w, h, buf);
    },
  };
}

/** Draw a row-string sprite at `scale`, over a checkerboard so gaps are visible. */
function blit(sfc, rows, ox, oy, scale, { checker = true } = {}) {
  const h = rows.length;
  const w = rows[0].length;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = charToIndex(rows[y][x]);
      if (idx === TRANSPARENT && !checker) continue;
      const hex =
        idx === TRANSPARENT ? ((x + y) & 1 ? '#2a2a34' : '#20202a') : COLORS[idx];
      sfc.rect(ox + x * scale, oy + y * scale, scale, scale, hex);
    }
  }
}

/* -------------------------------- validate ------------------------------- */

const LOCKED = new Set(PALETTE.map((c, i) => (c.price ? i : -1)).filter((i) => i >= 0));
let problems = 0;

function validate(label, rows, { allowLocked = true } = {}) {
  const w = rows[0].length;
  rows.forEach((r, y) => {
    if (r.length !== w) {
      console.error(`  ✗ ${label} row ${y}: ${r.length} chars, expected ${w}`);
      problems++;
    }
    for (const ch of r) {
      if (ch !== '.' && charToIndex(ch) === TRANSPARENT) {
        console.error(`  ✗ ${label} row ${y}: bad char '${ch}'`);
        problems++;
      }
      if (!allowLocked && LOCKED.has(charToIndex(ch))) {
        console.error(`  ✗ ${label} row ${y}: uses locked colour '${ch}'`);
        problems++;
      }
    }
  });
  return { w, h: rows.length };
}

/* --------------------------------- output -------------------------------- */

mkdirSync(OUT, { recursive: true });

// Fish templates: 16x scale, side by side.
{
  const scale = 14;
  const cell = 16 * scale + scale;
  const sfc = surface(cell * TEMPLATES.length, 16 * scale + 2 * scale);
  sfc.rect(0, 0, sfc.w, sfc.h, '#15151c');
  TEMPLATES.forEach((t, i) => {
    validate(`template ${t.id}`, t.rows, { allowLocked: false });
    blit(sfc, t.rows, i * cell + scale / 2, scale, scale);
  });
  writeFileSync(join(OUT, 'templates.png'), sfc.png());
  console.log(`templates.png  ${TEMPLATES.map((t) => t.name).join(' / ')}`);
}

// Decoration items: packed left to right, bottom-aligned.
{
  const scale = 8;
  const gap = 2 * scale;
  let totalW = gap;
  let maxH = 0;
  for (const it of ITEMS) {
    const { w, h } = validate(`item ${it.id}`, it.rows);
    totalW += w * scale + gap;
    maxH = Math.max(maxH, h * scale);
  }
  const sfc = surface(totalW, maxH + 2 * gap);
  sfc.rect(0, 0, sfc.w, sfc.h, '#15151c');
  let x = gap;
  for (const it of ITEMS) {
    const h = it.rows.length * scale;
    blit(sfc, it.rows, x, gap + (maxH - h), scale);
    x += it.rows[0].length * scale + gap;
  }
  writeFileSync(join(OUT, 'items.png'), sfc.png());
  console.log(`items.png      ${ITEMS.map((i) => i.id).join(' / ')}`);
}

// Background depth ramps, as vertical strips.
{
  const scale = 24;
  const sfc = surface(BACKGROUNDS.length * scale * 3, 8 * scale);
  BACKGROUNDS.forEach((bg, i) => {
    bg.ramp.forEach((idx, j) => {
      sfc.rect(i * scale * 3, j * scale, scale * 3, scale, COLORS[idx]);
    });
  });
  writeFileSync(join(OUT, 'backgrounds.png'), sfc.png());
  console.log(`backgrounds.png ${BACKGROUNDS.map((b) => b.name).join(' / ')}`);
}

// Palette proof sheet.
{
  const scale = 40;
  const sfc = surface(scale * 8, scale * 2);
  PALETTE.forEach((c, i) => {
    sfc.rect((i % 8) * scale, Math.floor(i / 8) * scale, scale, scale, c.hex);
  });
  writeFileSync(join(OUT, 'palette.png'), sfc.png());
  console.log('palette.png');
}

// Favicon: the goldfish at 2x on transparent, written into public/ as a real
// build asset rather than a throwaway preview.
{
  const scale = 2;
  const sfc = surface(32, 32);
  blit(sfc, TEMPLATES[0].rows, 0, 0, scale, { checker: false });
  const pub = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
  mkdirSync(pub, { recursive: true });
  writeFileSync(join(pub, 'favicon.png'), sfc.png());
  console.log('public/favicon.png');
}

if (problems) {
  console.error(`\n${problems} sprite problem(s).`);
  process.exit(1);
}
console.log('\nAll sprite data valid.');
