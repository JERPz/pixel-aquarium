/**
 * Scene painting.
 *
 * The tank is drawn in low-resolution "tank pixels" and blown up by a whole
 * number, so a bubble and a fish scale eye are the same size on screen. The
 * water is not a canvas gradient — it's an 8-stop palette ramp with ordered
 * (Bayer) dithering between stops, which is how the depth banding reads as
 * 8-bit rather than as CSS. Same trick for the caustics on the surface.
 *
 * Everything here is expensive-but-static, so each layer is baked into an
 * offscreen canvas and only rebuilt when the tank resizes or the backdrop
 * changes. Per frame we just blit three images and a scrolling highlight.
 */

import { COLORS, C } from '../data/palette.js';
import { createCanvas, ctx2d } from './sprite.js';

/** Ordered dither matrix. Values 0..15 normalised to 0..1 thresholds. */
const BAYER4 = [
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5,
];

function bayer(x, y) {
  return (BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
}

/** Deterministic noise so a tank looks the same every time it loads. */
function hash2(x, y, seed) {
  let h = x * 374761393 + y * 668265263 + seed * 144665;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Vertical depth ramp with dithered transitions.
 *
 * The 8 ramp stops are spread over the water column; between two neighbouring
 * stops we mix by scattering pixels of the deeper colour according to the
 * Bayer threshold. Result: hard-edged 8-bit banding with soft-looking seams.
 */
function buildWater(w, h, ramp, sandTop) {
  const canvas = createCanvas(w, h);
  const ctx = ctx2d(canvas);
  const img = ctx.createImageData(w, h);
  const rgb = ramp.map((i) => {
    const n = parseInt(COLORS[i].slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  });
  const columnH = Math.max(1, sandTop);

  for (let y = 0; y < h; y++) {
    // Position down the water column, 0 at the surface, 1 at the sand.
    const t = Math.min(1, y / columnH) * (ramp.length - 1);
    const lo = Math.min(ramp.length - 1, Math.floor(t));
    const hi = Math.min(ramp.length - 1, lo + 1);
    const frac = t - lo;
    for (let x = 0; x < w; x++) {
      const c = frac > bayer(x, y) ? rgb[hi] : rgb[lo];
      const o = (y * w + x) * 4;
      img.data[o] = c[0];
      img.data[o + 1] = c[1];
      img.data[o + 2] = c[2];
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/**
 * Sand floor: a dithered top edge that fades into the water, speckles for
 * grain, and a darker band underneath so the floor has weight.
 */
function buildSand(w, h, sandTop, sandIdx, shadeIdx, seed) {
  const canvas = createCanvas(w, h);
  const ctx = ctx2d(canvas);
  const sand = COLORS[sandIdx];
  const shade = COLORS[shadeIdx];
  const depth = h - sandTop;

  // Gently undulating dune line, then a 3px dithered fringe above it.
  for (let x = 0; x < w; x++) {
    const dune =
      Math.sin((x / w) * Math.PI * 4) * 1.6 +
      Math.sin((x / w) * Math.PI * 11 + 1.3) * 0.9;
    const top = Math.round(sandTop + dune);

    for (let y = top - 3; y < top; y++) {
      const density = (y - (top - 3)) / 3;
      if (density > bayer(x, y)) {
        ctx.fillStyle = sand;
        ctx.fillRect(x, y, 1, 1);
      }
    }
    ctx.fillStyle = sand;
    ctx.fillRect(x, top, 1, h - top);

    // Grain: a few darker specks, denser as it gets deeper.
    for (let y = top + 1; y < h; y++) {
      const n = hash2(x, y, seed);
      const deep = (y - top) / Math.max(1, depth);
      if (n < 0.06 + deep * 0.1) {
        ctx.fillStyle = shade;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
  return canvas;
}

/**
 * Caustics: the shifting net of light on the surface. Built as a horizontally
 * tileable strip using wave functions whose periods divide the tank width, so
 * it can be scrolled forever without a visible seam.
 */
function buildCaustics(w, bandH, seed, hueIdx) {
  const canvas = createCanvas(w, bandH);
  const ctx = ctx2d(canvas);
  ctx.fillStyle = COLORS[hueIdx];
  const k = (2 * Math.PI) / w;

  for (let y = 0; y < bandH; y++) {
    const depth = y / bandH;
    const falloff = (1 - depth) * (1 - depth);
    for (let x = 0; x < w; x++) {
      const v =
        0.5 +
        0.28 * Math.sin(k * 3 * x + y * 0.42 + seed) +
        0.22 * Math.sin(k * 7 * x - y * 0.27 + seed * 2);
      if (v * falloff > bayer(x, y) * 0.95) ctx.fillRect(x, y, 1, 1);
    }
  }
  return canvas;
}

/**
 * A baked tank backdrop at one particular size. Cheap to draw, rebuilt only on
 * resize or backdrop change.
 */
export class Scene {
  constructor(w, h, backdrop) {
    this.resize(w, h, backdrop);
  }

  resize(w, h, backdrop) {
    this.w = w;
    this.h = h;
    this.backdrop = backdrop;
    // Floor takes ~16% of the tank, with sane limits on very short screens.
    this.sandTop = Math.round(h - Math.max(8, Math.min(30, h * 0.16)));
    this.surfaceBand = Math.max(6, Math.round(h * 0.22));

    this.water = buildWater(w, h, backdrop.ramp, this.sandTop);
    this.sand = buildSand(w, h, this.sandTop, backdrop.sand, backdrop.sandShade, 7);
    this.caustics = [
      buildCaustics(w, this.surfaceBand, 0.0, C.FOAM),
      buildCaustics(w, this.surfaceBand, 2.1, C.SHALLOW),
    ];
  }

  /** Water, caustics and the surface line. Fish and props draw on top. */
  drawBack(ctx, time) {
    ctx.drawImage(this.water, 0, 0);

    // Two caustic layers scrolling at different speeds: cheap parallax that
    // reads as light moving on water.
    const a = Math.round(-((time * 7) % this.w));
    const b = Math.round(-((time * 11 + this.w / 3) % this.w));
    ctx.drawImage(this.caustics[1], b, 1);
    ctx.drawImage(this.caustics[1], b + this.w, 1);
    ctx.drawImage(this.caustics[0], a, 0);
    ctx.drawImage(this.caustics[0], a + this.w, 0);

    // Surface line: one wobbling row of foam so the water has a top.
    ctx.fillStyle = COLORS[C.FOAM];
    for (let x = 0; x < this.w; x++) {
      const y = Math.round(
        1 + Math.sin(x * 0.16 + time * 1.7) + Math.sin(x * 0.07 - time * 1.1)
      );
      ctx.fillRect(x, Math.max(0, y), 1, 1);
    }
  }

  drawFloor(ctx) {
    ctx.drawImage(this.sand, 0, 0);
  }
}

/**
 * Small dithered water swatch used by the editor preview, where there's no
 * full Scene. Same ramp maths, tiny output.
 */
export function buildPreviewWater(w, h, ramp) {
  const canvas = createCanvas(w, h);
  const ctx = ctx2d(canvas);
  const water = buildWater(w, h, ramp, h - 4);
  ctx.drawImage(water, 0, 0);
  ctx.fillStyle = COLORS[C.SAND];
  for (let x = 0; x < w; x++) {
    const top = h - 4 + (Math.sin(x * 0.5) > 0.4 ? -1 : 0);
    ctx.fillRect(x, top, 1, h - top);
  }
  return canvas;
}
