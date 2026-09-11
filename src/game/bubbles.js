/**
 * Bubbles. Two sources: a slow ambient trickle across the whole floor, and
 * fast columns from any bubbler the player has placed.
 *
 * A bubble is 1 or 2 pixels. The 2px ones are drawn as a hollow ring so they
 * read as air rather than as a blob, and they wobble on the way up.
 */

import { COLORS, C } from '../data/palette.js';
import { RULES } from './rules.js';

export class BubbleField {
  constructor() {
    this.bubbles = [];
    this.ambientDebt = 0;
    this.emitterDebt = 0;
  }

  spawn(x, y, big = Math.random() < 0.35) {
    if (this.bubbles.length >= RULES.bubbles.maxBubbles) return;
    const [lo, hi] = RULES.bubbles.riseSpeed;
    this.bubbles.push({
      x,
      y,
      big,
      rise: lo + Math.random() * (hi - lo),
      wob: Math.random() * Math.PI * 2,
      wobAmp: 0.6 + Math.random() * 1.6,
    });
  }

  /**
   * `emitters` is a list of {x, y} points — the top edge of each bubbler.
   * Fractional spawn counts are carried over in a debt accumulator so the rate
   * stays correct at any frame rate.
   */
  update(dt, world, emitters = []) {
    this.ambientDebt += RULES.bubbles.ambientRate * dt;
    while (this.ambientDebt >= 1) {
      this.ambientDebt -= 1;
      this.spawn(2 + Math.random() * (world.w - 4), world.sandTop - 1, Math.random() < 0.2);
    }

    if (emitters.length) {
      this.emitterDebt += RULES.bubbles.emitterRate * emitters.length * dt;
      while (this.emitterDebt >= 1) {
        this.emitterDebt -= 1;
        const e = emitters[(Math.random() * emitters.length) | 0];
        this.spawn(e.x + (Math.random() - 0.5) * 4, e.y, Math.random() < 0.5);
      }
    }

    const keep = [];
    for (const b of this.bubbles) {
      b.wob += dt * 3.1;
      b.y -= b.rise * dt;
      b.x += Math.sin(b.wob) * b.wobAmp * dt * 6;
      // Pop just under the surface line.
      if (b.y > 2 && b.x > -2 && b.x < world.w + 2) keep.push(b);
    }
    this.bubbles = keep;
  }

  draw(ctx) {
    ctx.fillStyle = COLORS[C.FOAM];
    for (const b of this.bubbles) {
      const x = Math.round(b.x);
      const y = Math.round(b.y);
      if (b.big) {
        // Hollow 2x2: top-left and bottom-right pixels only.
        ctx.fillRect(x, y, 1, 1);
        ctx.fillRect(x + 1, y + 1, 1, 1);
      } else {
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }

  clear() {
    this.bubbles = [];
  }
}
