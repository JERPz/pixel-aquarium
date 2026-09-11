/**
 * A single fish: its state, its brain, and how it's drawn.
 *
 * Everything time-based is per-second and multiplied by delta time, so the
 * simulation runs identically at 30, 60 or 144 fps.
 *
 * Motion is three separate things stacked, which is what makes it read as
 * swimming rather than sliding:
 *   1. a wander heading that changes on a random timer,
 *   2. velocity that eases toward that heading instead of snapping to it,
 *   3. a sine bob applied at draw time only, so it never accumulates into the
 *      real position and can't drift the fish into the sand.
 */

import { C, COLORS, TRANSPARENT } from '../data/palette.js';
import { RULES, sizeForStage, stageForFeeds } from './rules.js';
import {
  spriteToCanvas,
  scaleCanvas,
  drawWavy,
  spriteBounds,
  rowsToPixels,
  createCanvas,
  ctx2d,
} from './sprite.js';
import { unpackPixels, packPixels } from '../data/storage.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const rand = (a, b) => a + Math.random() * (b - a);

/** Floating "feed me" badge: a yolk plate with a coral exclamation. */
const WARN_ROWS = ['.000.', '0b9b0', '0b9b0', '0b9b0', '0bbb0', '0b9b0', '.000.'];
let warnSprite = null;
function getWarnSprite() {
  if (!warnSprite) {
    const { px, w, h } = rowsToPixels(WARN_ROWS);
    warnSprite = spriteToCanvas(px, w, h);
  }
  return warnSprite;
}

export class Fish {
  constructor(record, world) {
    this.uid = record.uid;
    this.name = record.name;
    this.packed = record.pixels;
    this.pixels = unpackPixels(record.pixels);

    this.hunger = record.hunger;
    this.happiness = record.happiness;
    this.feeds = record.feeds;
    this.bornAt = record.bornAt;

    // Normalised position from the save, converted to tank pixels.
    this.nx = record.nx;
    this.ny = record.ny;
    this.x = record.nx * world.w;
    this.y = record.ny * world.h;

    this.vx = rand(-1, 1) < 0 ? -RULES.fish.speed : RULES.fish.speed;
    this.vy = 0;
    this.heading = rand(0, Math.PI * 2);
    this.wanderIn = rand(...RULES.fish.wanderEvery);
    this.flip = this.vx < 0;
    this.phase = rand(0, Math.PI * 2);
    this.bobPhase = rand(0, Math.PI * 2);
    this.target = null;
    this.justGrew = false;
    this.justAte = false;

    this.stage = stageForFeeds(this.feeds);
    this.spriteCache = new Map();
    this.bounds = spriteBounds(this.pixels, 16, 16);
    this.base = spriteToCanvas(this.pixels, 16, 16);
  }

  get size() {
    return sizeForStage(this.stage);
  }

  get ageDays() {
    return (Date.now() - this.bornAt) / 86400000;
  }

  /** 0 = healthy colours, up to ~0.85 = badly faded. */
  get fade() {
    const { hungryAt } = RULES.hunger;
    if (this.hunger >= hungryAt) return 0;
    return clamp((1 - this.hunger / hungryAt) * 0.85, 0, 0.85);
  }

  /**
   * Sprites are cached per growth stage and per quantised fade level. Without
   * the quantising this would rebuild an ImageData every frame as hunger
   * ticks down.
   */
  sprite() {
    const bucket = Math.round(this.fade * 4) / 4;
    const key = `${this.stage}|${bucket}`;
    let s = this.spriteCache.get(key);
    if (!s) {
      const base = bucket === 0 ? this.base : spriteToCanvas(this.pixels, 16, 16, bucket);
      s = scaleCanvas(base, this.size);
      this.spriteCache.set(key, s);
    }
    return s;
  }

  /** Centre point, used for hit tests and pellet distance. */
  get cx() {
    return this.x + this.size / 2;
  }
  get cy() {
    return this.y + this.size / 2;
  }

  /* ------------------------------- behaviour ------------------------------ */

  update(dt, world) {
    const R = RULES.fish;
    this.justGrew = false;
    this.justAte = false;

    /* --- appetite ------------------------------------------------------- */
    this.hunger = clamp(this.hunger - RULES.hunger.drainPerSec * dt, 0, 100);

    /* --- pick something to do ------------------------------------------- */
    // Hungry fish hunt; full fish wander. Re-targeting every frame is fine at
    // these counts and means a fish switches to a closer pellet mid-chase.
    this.target = null;
    if (this.hunger < RULES.hunger.seeksAt) {
      this.target = world.food.nearest(this.cx, this.cy);
    }

    let speed = R.speed;
    if (this.hunger < RULES.hunger.hungryAt) {
      // Starving fish are sluggish, but never fully stop.
      const t = this.hunger / RULES.hunger.hungryAt;
      speed *= R.hungrySpeedMul + (1 - R.hungrySpeedMul) * t;
    }

    let desiredX;
    let desiredY;

    if (this.target) {
      const dx = this.target.x - this.cx;
      const dy = this.target.y - this.cy;
      const d = Math.hypot(dx, dy) || 1;
      speed *= R.chaseSpeedMul;
      desiredX = (dx / d) * speed;
      desiredY = (dy / d) * speed;

      if (d < RULES.food.eatRadius + this.size * 0.25) {
        world.food.consume(this.target);
        this.hunger = clamp(this.hunger + RULES.hunger.pelletGain, 0, 100);
        this.feeds++;
        this.justAte = true;
        const nextStage = stageForFeeds(this.feeds);
        if (nextStage !== this.stage) {
          this.stage = nextStage;
          this.spriteCache.clear();
          this.justGrew = true;
        }
        this.target = null;
      }
    } else {
      // Idle wander: hold a heading for a while, then pick a new one.
      this.wanderIn -= dt;
      if (this.wanderIn <= 0) {
        this.wanderIn = rand(...R.wanderEvery);
        // Bias toward horizontal travel — fish that mostly go up and down look
        // like they're panicking.
        this.heading = rand(0, Math.PI * 2);
        const flat = Math.abs(Math.sin(this.heading)) * 0.45;
        this.heading = Math.atan2(
          Math.sin(this.heading) * flat,
          Math.cos(this.heading)
        );
      }
      desiredX = Math.cos(this.heading) * speed;
      desiredY = Math.sin(this.heading) * speed;
    }

    /* --- stay inside the glass ------------------------------------------ */
    // Steering away from walls (rather than bouncing off them) keeps the
    // motion smooth and stops fish hugging the edges.
    const m = R.margin;
    const top = m + 2;
    const bottom = world.sandTop - this.size - 1;
    if (this.x < m) desiredX = Math.abs(desiredX) + 4;
    if (this.x + this.size > world.w - m) desiredX = -Math.abs(desiredX) - 4;
    if (this.y < top) desiredY = Math.abs(desiredY) + 4;
    if (this.y > bottom) desiredY = -Math.abs(desiredY) - 4;

    /* --- ease velocity, then integrate --------------------------------- */
    const k = Math.min(1, R.steer * dt);
    this.vx += (desiredX - this.vx) * k;
    this.vy += (desiredY - this.vy) * k;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.x = clamp(this.x, 1, Math.max(1, world.w - this.size - 1));
    this.y = clamp(this.y, 1, Math.max(1, world.sandTop - this.size));

    /* --- facing --------------------------------------------------------- */
    // Hysteresis: without it a fish hovering at vx≈0 flickers left/right.
    if (this.vx < -1.5) this.flip = true;
    else if (this.vx > 1.5) this.flip = false;

    /* --- animation phases ----------------------------------------------- */
    const travel = Math.hypot(this.vx, this.vy);
    this.phase += dt * (2 + (travel / R.speed) * R.tailHz);
    this.bobPhase += dt * Math.PI * 2 * R.bobHz;

    /* --- mood ------------------------------------------------------------ */
    const H = RULES.happiness;
    const comfort = Math.min(H.comfortCap, world.decorations.comfortAt(this.cx, this.cy));
    const crowd = Math.max(0, world.fishCount - H.roomyFishCount) * H.crowdPenalty;
    const target = clamp(
      H.baseTarget * (1 - H.hungerWeight) +
        this.hunger * H.hungerWeight +
        comfort -
        crowd,
      0,
      100
    );
    this.happiness += (target - this.happiness) * Math.min(1, (H.easePerSec * dt) / 10);
    this.happiness = clamp(this.happiness, 0, 100);

    // Keep the normalised position current so a save at any moment is sane.
    this.nx = world.w ? this.x / world.w : 0.5;
    this.ny = world.h ? this.y / world.h : 0.4;
  }

  /* -------------------------------- drawing ------------------------------ */

  draw(ctx, world) {
    const sprite = this.sprite();
    const bob = Math.sin(this.bobPhase) * RULES.fish.bobAmp;
    const drawY = this.y + bob;
    drawWavy(ctx, sprite, this.x, drawY, this.phase, this.flip, 1 + this.size / 16);

    if (this.hunger < RULES.hunger.starvingAt) {
      const icon = getWarnSprite();
      const hover = Math.round(Math.sin(world.time * 4) * 1.5);
      ctx.drawImage(
        icon,
        Math.round(this.cx - icon.width / 2),
        Math.round(drawY - icon.height - 2 + hover)
      );
    }
  }

  /** Generous hit box: the painted bounds plus a couple of pixels of slack. */
  hitTest(px, py) {
    const s = this.size / 16;
    const bx = this.x + this.bounds.x * s - 2;
    const by = this.y + this.bounds.y * s - 2;
    const bw = this.bounds.w * s + 4;
    const bh = this.bounds.h * s + 4;
    return px >= bx && px <= bx + bw && py >= by && py <= by + bh;
  }

  /** Rescale position when the tank changes size. */
  reflow(world) {
    this.x = clamp(this.nx * world.w, 1, Math.max(1, world.w - this.size - 1));
    this.y = clamp(this.ny * world.h, 1, Math.max(1, world.sandTop - this.size));
  }

  toJSON() {
    return {
      uid: this.uid,
      name: this.name,
      pixels: this.packed,
      hunger: this.hunger,
      happiness: this.happiness,
      feeds: this.feeds,
      bornAt: this.bornAt,
      nx: this.nx,
      ny: this.ny,
    };
  }

  /** 16x16 still for the info card, at whatever size the chip needs. */
  portrait(size = 16) {
    return scaleCanvas(this.base, size);
  }
}

/** Build the record a brand new fish starts life with. */
export function newFishRecord(uid, name, pixels) {
  return {
    uid,
    name,
    pixels: packPixels(pixels),
    hunger: 78,
    happiness: 72,
    feeds: 0,
    bornAt: Date.now(),
    nx: 0.2 + Math.random() * 0.6,
    ny: 0.25 + Math.random() * 0.3,
  };
}
