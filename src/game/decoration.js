/**
 * Tank furniture: placement, z-order, and the comfort auras that raise nearby
 * fish's happiness.
 *
 * Placements are stored as normalised centre-bottom anchors (nx, ny). Bottom
 * rather than centre because most props stand on the sand — anchoring to their
 * base means they stay planted when the tank is resized, instead of sinking
 * into the floor or hovering above it.
 */

import { ITEMS_BY_ID } from '../data/items.js';
import { rowsToPixels, spriteToCanvas, createCanvas, ctx2d } from './sprite.js';

/**
 * Floor items dropped anywhere in the bottom band of the tank plant themselves
 * on the sand. Generous on purpose: a rough click near the floor should look
 * deliberate, and nobody wants floating seaweed.
 */
const SNAP = 36;

const spriteCache = new Map();

/**
 * Rasterise an item once per orientation. Rotation is in whole quarter turns so
 * it stays a lossless pixel operation — no resampling, no soft edges. Note that
 * a quarter turn swaps width and height, which `box()` picks up automatically.
 */
function itemSprite(id, flip, rot = 0) {
  const turn = ((rot % 4) + 4) % 4;
  const key = `${id}|${flip ? 1 : 0}|${turn}`;
  let s = spriteCache.get(key);
  if (s) return s;

  const def = ITEMS_BY_ID[id];
  if (!def) return null;
  const { px, w, h } = rowsToPixels(def.rows);
  let base = spriteToCanvas(px, w, h);

  if (flip) {
    const out = createCanvas(w, h);
    const ctx = ctx2d(out);
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(base, 0, 0);
    base = out;
  }

  if (turn) {
    const swap = turn % 2 === 1;
    const out = createCanvas(swap ? h : w, swap ? w : h);
    const ctx = ctx2d(out);
    ctx.translate(out.width / 2, out.height / 2);
    ctx.rotate((turn * Math.PI) / 2);
    ctx.drawImage(base, -w / 2, -h / 2);
    base = out;
  }

  spriteCache.set(key, base);
  return base;
}

export function itemSpriteFor(id, flip = false, rot = 0) {
  return itemSprite(id, flip, rot);
}

export class Decorations {
  constructor(state) {
    this.state = state;
    this.world = { w: 1, h: 1, sandTop: 1 };
    // Tracked as primitives: `world` is mutated in place by the aquarium, so
    // comparing object references would never see a change.
    this.lastSandTop = -1;
    this.lastH = -1;
  }

  layout(world) {
    const changed = this.lastSandTop !== world.sandTop || this.lastH !== world.h;
    this.world = world;
    this.lastSandTop = world.sandTop;
    this.lastH = world.h;
    // Anchors are normalised, so a tank that changes shape (desktop to phone,
    // or the dock growing) would leave floor props hanging in mid-water. Items
    // that were planted stay planted; ones deliberately placed up in the water
    // keep their relative height.
    if (!changed) return;
    for (const p of this.state.items) {
      if (p.floor) p.ny = (world.sandTop + 3) / world.h;
    }
  }

  /** Where an item's sprite lands, in tank pixels. */
  box(placement) {
    const sprite = itemSprite(placement.id, placement.flip, placement.rot);
    if (!sprite) return null;
    const { w, h } = this.world;
    const cx = placement.nx * w;
    const by = placement.ny * h;
    return {
      x: Math.round(cx - sprite.width / 2),
      y: Math.round(by - sprite.height),
      w: sprite.width,
      h: sprite.height,
      sprite,
      def: ITEMS_BY_ID[placement.id],
      placement,
    };
  }

  get placements() {
    return this.state.items;
  }

  /** Back layer draws behind fish, front layer in front of them. */
  draw(ctx, front) {
    for (const p of this.state.items) {
      if (!!p.front !== front) continue;
      const b = this.box(p);
      if (b) ctx.drawImage(b.sprite, b.x, b.y);
    }
  }

  /**
   * Topmost item under a point — front items win, then later placements.
   * The slack is generous because these are small sprites and a fingertip
   * covers a lot of tank pixels.
   */
  hitTest(x, y) {
    const slack = 4;
    for (let pass = 0; pass < 2; pass++) {
      const wantFront = pass === 0;
      for (let i = this.state.items.length - 1; i >= 0; i--) {
        const p = this.state.items[i];
        if (!!p.front !== wantFront) continue;
        const b = this.box(p);
        if (!b) continue;
        if (
          x >= b.x - slack &&
          x <= b.x + b.w + slack &&
          y >= b.y - slack &&
          y <= b.y + b.h + slack
        ) {
          return p;
        }
      }
    }
    return null;
  }

  /**
   * Convert a drop point into a stored anchor.
   *
   * Floor items land on top of the sand whenever they're dropped in it or just
   * above it, so a prop can never end up half-buried. Drop one higher up and it
   * stays where you put it, which is how you get a rock on a ledge.
   */
  anchorFor(id, x, y) {
    const def = ITEMS_BY_ID[id];
    const { w, h, sandTop } = this.world;
    let by = y;
    let floor = false;
    if (def?.anchor === 'floor') {
      const sandLine = sandTop + 3;
      if (y > sandLine - SNAP) {
        by = sandLine;
        floor = true;
      }
    }
    const sprite = itemSprite(id, false);
    const halfW = sprite ? sprite.width / 2 : 4;
    const spriteH = sprite ? sprite.height : 8;
    return {
      nx: Math.max(halfW / w, Math.min(1 - halfW / w, x / w)),
      ny: Math.max(spriteH / h, Math.min(1, by / h)),
      floor,
    };
  }

  /** Take one out of inventory and place it. Returns the placement or null. */
  place(id, x, y) {
    if ((this.state.inventory[id] || 0) <= 0) return null;
    const { nx, ny, floor } = this.anchorFor(id, x, y);
    const placement = {
      uid: this.state.nextUid++,
      id,
      nx,
      ny,
      floor,
      flip: false,
      rot: 0,
      front: false,
    };
    this.state.inventory[id] -= 1;
    this.state.items.push(placement);
    return placement;
  }

  moveTo(placement, x, y) {
    const { nx, ny, floor } = this.anchorFor(placement.id, x, y);
    placement.nx = nx;
    placement.ny = ny;
    placement.floor = floor;
  }

  /** Removing returns the item to the tray rather than destroying it. */
  remove(placement) {
    const i = this.state.items.indexOf(placement);
    if (i < 0) return;
    this.state.items.splice(i, 1);
    this.state.inventory[placement.id] = (this.state.inventory[placement.id] || 0) + 1;
  }

  flip(placement) {
    placement.flip = !placement.flip;
  }

  /** Quarter turns, cycling back to upright on the fourth press. */
  rotate(placement) {
    placement.rot = (((placement.rot || 0) + 1) % 4 + 4) % 4;
  }

  setFront(placement, front) {
    placement.front = front;
    // Re-append so the newest change also wins among same-layer items.
    const i = this.state.items.indexOf(placement);
    if (i >= 0) {
      this.state.items.splice(i, 1);
      this.state.items.push(placement);
    }
  }

  /**
   * Total comfort at a point. Each item contributes its `comfort` value scaled
   * by a linear falloff to the edge of its radius, so a fish gets more out of
   * hovering right next to the castle than drifting past it.
   */
  comfortAt(x, y) {
    let total = 0;
    for (const p of this.state.items) {
      const def = ITEMS_BY_ID[p.id];
      if (!def?.comfort) continue;
      const b = this.box(p);
      if (!b) continue;
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2;
      const d = Math.hypot(x - cx, y - cy);
      if (d < def.radius) total += def.comfort * (1 - d / def.radius) * 10;
    }
    return total;
  }

  /** Bubble sources: the top edge of every bubbler. */
  emitters() {
    const out = [];
    for (const p of this.state.items) {
      const def = ITEMS_BY_ID[p.id];
      if (def?.emits !== 'bubbles') continue;
      const b = this.box(p);
      if (b) out.push({ x: b.x + b.w / 2, y: b.y });
    }
    return out;
  }

  /** Outline used in decorate mode to show what's selected. */
  drawSelection(ctx, placement, colour) {
    const b = this.box(placement);
    if (!b) return;
    ctx.fillStyle = colour;
    const x = b.x - 2;
    const y = b.y - 2;
    const w = b.w + 4;
    const h = b.h + 4;
    // Marching-ant style dashes, 2px on 2px off, drawn as rects.
    for (let i = 0; i < w; i += 4) {
      ctx.fillRect(x + i, y, 2, 1);
      ctx.fillRect(x + i, y + h - 1, 2, 1);
    }
    for (let i = 0; i < h; i += 4) {
      ctx.fillRect(x, y + i, 1, 2);
      ctx.fillRect(x + w - 1, y + i, 1, 2);
    }
  }
}
