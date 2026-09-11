/**
 * Persistence. One localStorage key holds the whole tank.
 *
 * Two things make this more than a JSON.stringify wrapper:
 *
 * 1. Schema versioning. Saves are stamped with SCHEMA and run through a
 *    migration chain on load, so an old save from a previous build is upgraded
 *    instead of thrown away.
 * 2. Away time. Fish live on wall-clock time, not frames. On load we diff
 *    `lastSeen` against now and settle up: hunger drains, happiness drifts,
 *    and coins earned while away are paid out (capped, so idling isn't a
 *    strategy).
 */

import { STARTER_COLORS, TRANSPARENT } from './palette.js';
import { RULES } from '../game/rules.js';

const KEY = 'pixel-aquarium/save';
export const SCHEMA = 2;

/* ------------------------------ sprite codec ------------------------------ */

/**
 * 16x16 palette indices -> base64. One byte per pixel: 256 bytes becomes a
 * 344-character string, small enough that dozens of fish fit comfortably in
 * localStorage.
 */
export function packPixels(px) {
  let s = '';
  for (let i = 0; i < px.length; i++) s += String.fromCharCode(px[i]);
  return btoa(s);
}

export function unpackPixels(b64, len = 256) {
  const out = new Uint8Array(len).fill(TRANSPARENT);
  try {
    const s = atob(b64);
    for (let i = 0; i < Math.min(len, s.length); i++) out[i] = s.charCodeAt(i);
  } catch {
    /* corrupt sprite: leave it blank rather than losing the whole save */
  }
  return out;
}

/* -------------------------------- defaults -------------------------------- */

export function defaultSave() {
  const now = Date.now();
  return {
    schema: SCHEMA,
    createdAt: now,
    lastSeen: now,
    coins: 20,
    unlockedColors: [...STARTER_COLORS],
    ownedBackgrounds: ['open'],
    background: 'open',
    // Two freebies so Decorate mode has something in it on day one.
    inventory: { seaweed: 1, pebbles: 1 },
    items: [],
    fish: [],
    nextUid: 1,
    totalFed: 0,
  };
}

/* ------------------------------- migrations ------------------------------- */

/**
 * Keyed by the version being upgraded FROM. Each returns the next version up.
 * Kept even for pre-release shapes: a stale save in someone's browser is
 * cheaper to migrate than to explain.
 */
const MIGRATIONS = {
  // v1 stored sprites as 16 row-strings and had no inventory or backdrops.
  1: (s) => ({
    ...s,
    schema: 2,
    ownedBackgrounds: ['open'],
    background: 'open',
    inventory: { seaweed: 1, pebbles: 1 },
    items: [],
    fish: (s.fish || []).map((f) => ({
      ...f,
      pixels:
        typeof f.pixels === 'string'
          ? f.pixels
          : packPixels(rowsToPixels(f.rows || f.sprite || [])),
      rows: undefined,
      sprite: undefined,
    })),
  }),
};

function rowsToPixels(rows) {
  const out = new Uint8Array(256).fill(TRANSPARENT);
  for (let y = 0; y < Math.min(16, rows.length); y++) {
    for (let x = 0; x < Math.min(16, rows[y].length); x++) {
      const n = parseInt(rows[y][x], 16);
      out[y * 16 + x] = Number.isNaN(n) ? TRANSPARENT : n;
    }
  }
  return out;
}

function migrate(save) {
  let s = save;
  let guard = 0;
  while ((s.schema || 1) < SCHEMA && guard++ < 20) {
    const step = MIGRATIONS[s.schema || 1];
    if (!step) {
      // No path from this version: keep the fish, reset everything else.
      const fresh = defaultSave();
      return { ...fresh, fish: Array.isArray(s.fish) ? s.fish : [] };
    }
    s = step(s);
  }
  return s;
}

/* --------------------------------- shape ---------------------------------- */

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const num = (v, fallback) => (Number.isFinite(v) ? v : fallback);

/** Force a loaded save into a shape the game can trust. */
function sanitise(raw) {
  const d = defaultSave();
  const s = { ...d, ...raw };

  s.schema = SCHEMA;
  s.coins = Math.max(0, Math.floor(num(s.coins, d.coins)));
  s.createdAt = num(s.createdAt, d.createdAt);
  s.lastSeen = num(s.lastSeen, d.lastSeen);
  s.totalFed = Math.max(0, Math.floor(num(s.totalFed, 0)));
  s.nextUid = Math.max(1, Math.floor(num(s.nextUid, 1)));

  s.unlockedColors = Array.isArray(s.unlockedColors)
    ? [...new Set(s.unlockedColors.filter((n) => Number.isInteger(n) && n >= 0 && n < 16))]
    : [...d.unlockedColors];
  for (const i of STARTER_COLORS) if (!s.unlockedColors.includes(i)) s.unlockedColors.push(i);

  s.ownedBackgrounds = Array.isArray(s.ownedBackgrounds)
    ? [...new Set(['open', ...s.ownedBackgrounds])]
    : ['open'];
  if (!s.ownedBackgrounds.includes(s.background)) s.background = 'open';

  s.inventory =
    s.inventory && typeof s.inventory === 'object' && !Array.isArray(s.inventory)
      ? Object.fromEntries(
          Object.entries(s.inventory).map(([k, v]) => [k, Math.max(0, Math.floor(num(v, 0)))])
        )
      : { ...d.inventory };

  s.items = (Array.isArray(s.items) ? s.items : [])
    .filter((it) => it && typeof it.id === 'string')
    .map((it) => ({
      uid: num(it.uid, s.nextUid++),
      id: it.id,
      // Positions are stored 0..1 relative to the tank so a save made on a
      // phone still lays out sensibly on a desktop.
      nx: clamp(num(it.nx, 0.5), 0, 1),
      ny: clamp(num(it.ny, 0.9), 0, 1),
      // Planted on the sand? Re-snapped on every layout so it can't end up
      // floating. Saves from before this flag existed assume planted, which is
      // where all but a handful of props actually sit.
      floor: it.floor === undefined ? true : !!it.floor,
      flip: !!it.flip,
      rot: [0, 1, 2, 3].includes(it.rot) ? it.rot : 0,
      front: !!it.front,
    }));

  s.fish = (Array.isArray(s.fish) ? s.fish : [])
    .filter((f) => f && typeof f.pixels === 'string')
    .map((f) => ({
      uid: num(f.uid, s.nextUid++),
      name: String(f.name || 'Fish').slice(0, 12),
      pixels: f.pixels,
      hunger: clamp(num(f.hunger, 80), 0, 100),
      happiness: clamp(num(f.happiness, 70), 0, 100),
      feeds: Math.max(0, Math.floor(num(f.feeds, 0))),
      bornAt: num(f.bornAt, s.createdAt),
      nx: clamp(num(f.nx, Math.random()), 0, 1),
      ny: clamp(num(f.ny, 0.4), 0, 1),
    }));

  for (const f of s.fish) if (f.uid >= s.nextUid) s.nextUid = f.uid + 1;
  for (const it of s.items) if (it.uid >= s.nextUid) s.nextUid = it.uid + 1;

  return s;
}

/* -------------------------------- away time ------------------------------- */

/**
 * Settle up for time spent with the tab closed.
 *
 * Hunger drains at the same rate it does live. Happiness eases toward what
 * hunger alone implies (decoration comfort is ignored here — recomputing
 * proximity for hours of simulated swimming isn't worth it, and erring low is
 * kinder than handing out coins the tank didn't earn).
 *
 * Returns a report so the UI can tell the player what happened.
 */
export function settleAwayTime(save, now = Date.now()) {
  const seconds = Math.max(0, (now - save.lastSeen) / 1000);
  const capped = Math.min(seconds, RULES.offline.maxHours * 3600);
  const report = { seconds, capped, coins: 0, hungry: 0 };

  if (capped < 30 || save.fish.length === 0) {
    save.lastSeen = now;
    return report;
  }

  const earnSeconds = Math.min(capped, RULES.coins.offlineCapHours * 3600);
  let coins = 0;

  for (const f of save.fish) {
    const startHappy = f.happiness;
    f.hunger = clamp(f.hunger - RULES.hunger.drainPerSec * capped, 0, 100);

    // Where happiness ends up is driven by hunger; ease all the way there
    // since `capped` is minutes at minimum.
    const target =
      RULES.happiness.baseTarget * (1 - RULES.happiness.hungerWeight) +
      f.hunger * RULES.happiness.hungerWeight;
    const ease = 1 - Math.exp((-RULES.happiness.easePerSec * capped) / 100);
    f.happiness = clamp(f.happiness + (target - f.happiness) * ease, 0, 100);

    // Pay out on the average of start and end happiness, so a fish that was
    // happy when you left still earns something on the way down.
    const avg = (startHappy + f.happiness) / 2;
    if (avg >= RULES.coins.minHappiness) {
      coins += (avg / 100) * RULES.coins.perMinutePerFish * (earnSeconds / 60);
    }
    if (f.hunger < RULES.hunger.hungryAt) report.hungry++;
  }

  report.coins = Math.min(RULES.coins.offlineMaxCoins, Math.floor(coins));
  save.coins += report.coins;
  save.lastSeen = now;
  return report;
}

/* ---------------------------------- io ------------------------------------ */

let available = null;

/** localStorage can throw (private mode, disabled storage). Detect once. */
export function storageAvailable() {
  if (available !== null) return available;
  try {
    const probe = '__pa_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    available = true;
  } catch {
    available = false;
  }
  return available;
}

export function load() {
  if (!storageAvailable()) return { save: defaultSave(), report: null, fresh: true };
  let raw = null;
  try {
    raw = JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch {
    raw = null;
  }
  if (!raw) return { save: defaultSave(), report: null, fresh: true };

  const save = sanitise(migrate(raw));
  const report = settleAwayTime(save);
  return { save, report, fresh: false };
}

let pending = null;

/** Debounced write — the game loop calls this freely. */
export function save(state, immediate = false) {
  if (!storageAvailable()) return;
  const write = () => {
    pending = null;
    state.lastSeen = Date.now();
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* quota or private mode: the tank keeps running, it just won't persist */
    }
  };
  if (immediate) {
    if (pending) clearTimeout(pending);
    write();
    return;
  }
  if (pending) return;
  pending = setTimeout(write, 800);
}

export function wipe() {
  if (!storageAvailable()) return;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
}
