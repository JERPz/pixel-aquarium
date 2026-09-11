/**
 * Sprite plumbing shared by the editor, the tank and the UI chips.
 *
 * Palette-index arrays are rasterised once into small canvases and cached;
 * drawing then costs one drawImage per sprite column. Nothing is ever scaled
 * by a fractional factor at draw time — growth stages pre-scale to whole pixel
 * sizes with nearest-neighbour, which is what keeps the art crisp.
 */

import { COLORS, TRANSPARENT, fadeHex, charToIndex } from '../data/palette.js';

export const FISH_W = 16;
export const FISH_H = 16;

export function createCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function ctx2d(canvas) {
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  return ctx;
}

/** Row strings -> flat palette-index array (used for templates and items). */
export function rowsToPixels(rows) {
  const h = rows.length;
  const w = rows[0].length;
  const px = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) px[y * w + x] = charToIndex(rows[y][x]);
  }
  return { px, w, h };
}

/**
 * Rasterise indices to a canvas via ImageData, so no interpolation can creep
 * in. `fade` (0..1) drains saturation for hungry fish.
 */
export function spriteToCanvas(px, w, h, fade = 0) {
  const canvas = createCanvas(w, h);
  const ctx = ctx2d(canvas);
  const img = ctx.createImageData(w, h);
  const rgb = new Map();

  for (let i = 0; i < w * h; i++) {
    const p = px[i];
    if (p === TRANSPARENT || p === undefined || p > 15) continue;
    let c = rgb.get(p);
    if (!c) {
      const hex = fade > 0 ? fadeHex(COLORS[p], fade) : COLORS[p];
      const n = parseInt(hex.slice(1), 16);
      c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      rgb.set(p, c);
    }
    const o = i * 4;
    img.data[o] = c[0];
    img.data[o + 1] = c[1];
    img.data[o + 2] = c[2];
    img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Nearest-neighbour rescale to an exact pixel size. */
export function scaleCanvas(src, size) {
  if (src.width === size && src.height === size) return src;
  const out = createCanvas(size, size);
  const ctx = ctx2d(out);
  ctx.drawImage(src, 0, 0, size, size);
  return out;
}

/** True if a sprite has at least one painted pixel. */
export function isBlank(px) {
  for (let i = 0; i < px.length; i++) if (px[i] !== TRANSPARENT) return false;
  return true;
}

/**
 * Draw a sprite with a travelling sine shear, which is how one static drawing
 * becomes a swimming fish.
 *
 * Fish are authored facing right, so the tail is at the left edge. Each column
 * is displaced vertically by a sine wave whose amplitude ramps from zero at
 * the nose to full at the tail — the head stays steady while the back half
 * flicks. Offsets are rounded to whole pixels so the sprite never smears.
 *
 * `flip` mirrors the whole thing for leftward travel; the shear still lands on
 * the tail because it's applied in sprite space before the mirror.
 */
export function drawWavy(ctx, sprite, x, y, phase, flip, amp = 1.4) {
  const w = sprite.width;
  const h = sprite.height;
  const px = Math.round(x);
  const py = Math.round(y);

  ctx.save();
  if (flip) {
    ctx.translate(px + w, py);
    ctx.scale(-1, 1);
  } else {
    ctx.translate(px, py);
  }

  for (let col = 0; col < w; col++) {
    const t = 1 - col / (w - 1); // 1 at the tail, 0 at the nose
    const ramp = t * t;
    const off = Math.round(Math.sin(phase + t * 2.4) * amp * ramp);
    ctx.drawImage(sprite, col, 0, 1, h, col, off, 1, h);
  }
  ctx.restore();
}

/** Plain blit with no wave, for still portraits. */
export function drawSprite(ctx, sprite, x, y, flip = false) {
  const px = Math.round(x);
  const py = Math.round(y);
  if (!flip) {
    ctx.drawImage(sprite, px, py);
    return;
  }
  ctx.save();
  ctx.translate(px + sprite.width, py);
  ctx.scale(-1, 1);
  ctx.drawImage(sprite, 0, 0);
  ctx.restore();
}

/**
 * Tight bounds of the painted pixels, so a small drawing inside a 16x16 grid
 * still gets a sensible hit box and can be centred in previews.
 */
export function spriteBounds(px, w, h) {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (px[y * w + x] === TRANSPARENT) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return { x: 0, y: 0, w, h, empty: true };
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, empty: false };
}
