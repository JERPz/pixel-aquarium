/**
 * REEF-16 — the game's entire colour vocabulary.
 *
 * Every pixel drawn anywhere (fish, water, sand, coral, UI chrome) comes from
 * this list. 16 hues, hand-tuned for underwater scenes: six cool tones so the
 * water can be depth-banded with dithering, three earth tones for sand and
 * wood, three hot tones so fish pop against the blue, two greens, one accent.
 *
 * Four slots ship locked and are bought with coins in the editor. The renderer
 * ignores locks — they only gate what the player can paint with.
 */

export const PALETTE = [
  { hex: '#0b1026', name: 'Abyss' },
  { hex: '#1e2f5c', name: 'Deep' },
  { hex: '#2f6ba8', name: 'Water' },
  { hex: '#4fb8d8', name: 'Shallow' },
  { hex: '#a9f0ea', name: 'Foam', price: 25 },
  { hex: '#f5f5e6', name: 'Shell' },
  { hex: '#e8c56a', name: 'Sand' },
  { hex: '#c07a3a', name: 'Driftwood' },
  { hex: '#7a3f2b', name: 'Bark' },
  { hex: '#e8593f', name: 'Coral' },
  { hex: '#f59b5c', name: 'Sunset' },
  { hex: '#f2d33c', name: 'Yolk', price: 40 },
  { hex: '#7cc44a', name: 'Kelp' },
  { hex: '#2f7a4f', name: 'Fern' },
  { hex: '#a45ec4', name: 'Anemone', price: 90 },
  { hex: '#7b8394', name: 'Stone', price: 60 },
];

/** Flat hex list, indexed 0..15 — what sprite data refers to. */
export const COLORS = PALETTE.map((c) => c.hex);

/** Sprite pixels use this value for "no paint". */
export const TRANSPARENT = 255;

/** Slots the player owns from the start. */
export const STARTER_COLORS = PALETTE.reduce(
  (acc, c, i) => (c.price ? acc : acc.concat(i)),
  []
);

/** Slots that must be bought, cheapest first. */
export const LOCKABLE_COLORS = PALETTE.map((c, i) => (c.price ? i : -1))
  .filter((i) => i >= 0)
  .sort((a, b) => PALETTE[a].price - PALETTE[b].price);

/** Named indices, so game code reads as English instead of magic numbers. */
export const C = {
  ABYSS: 0,
  DEEP: 1,
  WATER: 2,
  SHALLOW: 3,
  FOAM: 4,
  SHELL: 5,
  SAND: 6,
  DRIFTWOOD: 7,
  BARK: 8,
  CORAL: 9,
  SUNSET: 10,
  YOLK: 11,
  KELP: 12,
  FERN: 13,
  ANEMONE: 14,
  STONE: 15,
};

/** '0'-'9','a'-'f' -> 0..15, '.' -> TRANSPARENT. Used by the sprite strings. */
export function charToIndex(ch) {
  if (ch === '.' || ch === ' ') return TRANSPARENT;
  const n = parseInt(ch, 16);
  return Number.isNaN(n) ? TRANSPARENT : n;
}

/** Turn an array of row strings into a flat Uint8Array of palette indices. */
export function parseSprite(rows) {
  const h = rows.length;
  const w = rows[0].length;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) out[y * w + x] = charToIndex(rows[y][x]);
  }
  out.width = w;
  out.height = h;
  return out;
}

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex({ r, g, b }) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${((1 << 24) | (c(r) << 16) | (c(g) << 8) | c(b)).toString(16).slice(1)}`;
}

export function mixHex(a, b, t) {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex({
    r: x.r + (y.r - x.r) * t,
    g: x.g + (y.g - x.g) * t,
    b: x.b + (y.b - x.b) * t,
  });
}

/**
 * Drain the life out of a colour: pull it toward its own brightness (killing
 * saturation) and then a little toward the water blue, so a starving fish
 * looks like it's fading into the background rather than just going grey.
 */
export function fadeHex(hex, amount) {
  const { r, g, b } = hexToRgb(hex);
  const luma = 0.299 * r + 0.587 * g + 0.114 * b;
  const grey = { r: luma, g: luma, b: luma };
  const desat = rgbToHex({
    r: r + (grey.r - r) * amount,
    g: g + (grey.g - g) * amount,
    b: b + (grey.b - b) * amount,
  });
  return mixHex(desat, COLORS[C.DEEP], amount * 0.35);
}
