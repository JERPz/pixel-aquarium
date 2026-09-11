/**
 * Builds a save file for verification runs: fish at different growth stages and
 * hunger levels (including one starving, to prove the fade and the warning
 * badge), plus a decorated tank. Written to scripts/out/seed.json.
 *
 *   node scripts/seed.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { TEMPLATES } from '../src/data/templates.js';
import { charToIndex } from '../src/data/palette.js';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'out');

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
/** Hours to backdate lastSeen by, to exercise the away-time catch-up. */
const awayHours = Number(argOf('away', 0));
/** Emit a pre-migration (schema 1) save instead, to exercise the migration. */
const legacy = args.includes('--v1');

function pack(rows) {
  const bytes = Buffer.alloc(256, 255);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) bytes[y * 16 + x] = charToIndex(rows[y][x]);
  }
  return bytes.toString('base64');
}

const byId = Object.fromEntries(TEMPLATES.map((t) => [t.id, t]));
const now = Date.now();
const day = 86400000;

const fish = [
  ['goldfish', 'BUBBLES', 92, 88, 2, 0.6, 0.3, 0.4 * day],
  ['angelfish', 'HALO', 64, 74, 9, 0.25, 0.45, 3.2 * day],
  ['puffer', 'SPIKE', 12, 30, 20, 0.5, 0.6, 6 * day],
  ['clownfish', 'PIP', 78, 91, 41, 0.8, 0.5, 11 * day],
].map(([id, name, hunger, happiness, feeds, nx, ny, age], i) => ({
  uid: 10 + i,
  name,
  pixels: pack(byId[id].rows),
  hunger,
  happiness,
  feeds,
  bornAt: now - age,
  nx,
  ny,
}));

// ny 0.905 puts an item's base on the sand line at a typical tank aspect.
const items = [
  ['seaweed', 0.08, 0.905],
  ['seaweed', 0.19, 0.905],
  ['coral', 0.36, 0.905],
  ['rock', 0.55, 0.905],
  ['castle', 0.78, 0.905],
  ['bubbler', 0.93, 0.905],
  ['pebbles', 0.46, 0.905],
].map(([id, nx, ny], i) => ({ uid: 100 + i, id, nx, ny, flip: i % 2 === 1, front: false }));

const save = {
  schema: 2,
  createdAt: now - 12 * day,
  lastSeen: now - awayHours * 3600000,
  coins: 260,
  unlockedColors: [0, 1, 2, 3, 5, 6, 7, 8, 9, 10, 12, 13],
  ownedBackgrounds: ['open'],
  background: 'open',
  inventory: { seaweed: 2, pebbles: 1, coral: 1 },
  items,
  fish,
  nextUid: 200,
  totalFed: 72,
};

mkdirSync(OUT, { recursive: true });

if (legacy) {
  // Schema 1: sprites as row strings, no inventory, no backdrops, no items.
  // Exactly the shape MIGRATIONS[1] in storage.js has to cope with.
  const v1 = {
    schema: 1,
    createdAt: save.createdAt,
    lastSeen: save.lastSeen,
    coins: 42,
    unlockedColors: [0, 1, 2, 3, 5, 6, 7, 8, 9, 10, 12, 13],
    fish: [
      { uid: 1, name: 'ANCIENT', rows: byId.goldfish.rows, hunger: 70, happiness: 66, feeds: 4, bornAt: now - 5 * day, nx: 0.4, ny: 0.35 },
    ],
    nextUid: 2,
  };
  writeFileSync(join(OUT, 'seed-v1.json'), JSON.stringify(v1));
  console.log('seed-v1.json  schema 1, 1 fish stored as row strings');
} else {
  const name = awayHours ? `seed-away${awayHours}.json` : 'seed.json';
  writeFileSync(join(OUT, name), JSON.stringify(save));
  console.log(
    `${name}  ${fish.length} fish, ${items.length} items, ${save.coins} coins, away ${awayHours}h`
  );
}
