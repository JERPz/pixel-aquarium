/**
 * Food. Pellets are 2x2 pixel particles that sink, drift, settle on the sand
 * and eventually dissolve. Fish claim them by proximity — several fish can
 * chase the same pellet, and whoever gets there first eats it, which produces
 * the little races that make feeding fun to watch.
 */

import { COLORS, C } from '../data/palette.js';
import { RULES } from './rules.js';

export class FoodField {
  constructor() {
    this.pellets = [];
  }

  get count() {
    return this.pellets.length;
  }

  /**
   * Drop a small cluster so one click reads as a pinch of food rather than a
   * single dot. Spread and initial speed are jittered.
   */
  drop(x, y, n = RULES.food.perDrop) {
    for (let i = 0; i < n; i++) {
      if (this.pellets.length >= RULES.food.maxPellets) break;
      this.pellets.push({
        x: x + (Math.random() - 0.5) * 7,
        y: y + (Math.random() - 0.5) * 4,
        vx: (Math.random() - 0.5) * 4,
        drift: Math.random() * Math.PI * 2,
        sink: RULES.food.sinkSpeed * (0.75 + Math.random() * 0.5),
        resting: false,
        life: RULES.food.restSeconds,
        gone: false,
      });
    }
  }

  update(dt, world) {
    const keep = [];
    for (const p of this.pellets) {
      if (p.gone) continue;

      if (!p.resting) {
        // Sideways wobble as it falls: a straight vertical drop looks fake.
        p.drift += dt * 2.4;
        p.x += (p.vx + Math.sin(p.drift) * 3) * dt;
        p.y += p.sink * dt;
        p.vx *= 1 - 0.9 * dt;

        const floor = world.sandTop - 2;
        if (p.y >= floor) {
          p.y = floor;
          p.resting = true;
        }
        p.x = Math.max(1, Math.min(world.w - 2, p.x));
      } else {
        // Settled pellets rot away, so an over-fed tank cleans itself up.
        p.life -= dt;
        if (p.life <= 0) p.gone = true;
      }
      if (!p.gone) keep.push(p);
    }
    this.pellets = keep;
  }

  /** Closest live pellet to a point, or null. */
  nearest(x, y) {
    let best = null;
    let bestD = Infinity;
    for (const p of this.pellets) {
      if (p.gone) continue;
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  consume(pellet) {
    pellet.gone = true;
  }

  draw(ctx) {
    for (const p of this.pellets) {
      const x = Math.round(p.x);
      const y = Math.round(p.y);
      // Settled pellets dim as they dissolve — the last few seconds go dark so
      // the player can see the tank tidying itself.
      const fading = p.resting && p.life < RULES.food.restSeconds * 0.35;
      ctx.fillStyle = COLORS[fading ? C.BARK : C.DRIFTWOOD];
      ctx.fillRect(x, y, 2, 2);
      if (!fading) {
        ctx.fillStyle = COLORS[C.SAND];
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }

  clear() {
    this.pellets = [];
  }
}
