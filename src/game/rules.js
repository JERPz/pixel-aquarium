/**
 * Every tuning number in the game, in one place.
 *
 * Timings are in seconds and are wall-clock, not frames: the same constants
 * drive both the live loop and the catch-up pass that runs when a player comes
 * back after a day away.
 */

export const RULES = {
  hunger: {
    /**
     * Full belly to empty in eight hours of real time — roughly "feed it twice
     * a day". Faster than this and any absence long enough to matter would
     * guarantee every fish is starving on return, which would make the
     * away-earnings payout unreachable in practice.
     */
    drainPerSec: 100 / (8 * 60 * 60),
    /** One pellet is roughly a third of a meal. */
    pelletGain: 34,
    /** Below this a fish starts hunting pellets even when not desperate. */
    seeksAt: 82,
    /** Below this it slows down and its colours start draining. */
    hungryAt: 45,
    /** Below this the warning icon appears. */
    starvingAt: 22,
  },

  happiness: {
    /** Happiness eases toward its target rather than snapping. */
    easePerSec: 1.6,
    /** A well-fed fish in a bare tank sits here. */
    baseTarget: 62,
    /** Hunger is the dominant term: this much of the target comes from it. */
    hungerWeight: 0.55,
    /** Decoration comfort is capped so one castle can't max a fish out. */
    comfortCap: 34,
    /** Tank feels crowded past this many fish; each extra one costs a little. */
    roomyFishCount: 6,
    crowdPenalty: 4,
  },

  growth: {
    /** Pellets eaten needed to reach stage 1, 2, 3. Stage 0 is the start. */
    feedsPerStage: [0, 6, 16, 32],
    /** Sprite edge length in tank pixels per stage. Integers keep art crisp. */
    sizes: [16, 20, 24, 28],
  },

  coins: {
    /** Coins per minute per fish, at 100 happiness. Scales down linearly. */
    perMinutePerFish: 0.9,
    /** No income below this happiness — the tank has to actually be nice. */
    minHappiness: 65,
    /** Away earnings stop accruing after this long. */
    offlineCapHours: 4,
    /**
     * And they're capped in absolute terms as well. A per-minute rate compounded
     * over hours would hand a returning player the whole shop; this keeps time
     * away as a welcome-back gift rather than the optimal way to play.
     */
    offlineMaxCoins: 60,
  },

  fish: {
    /** Tank pixels per second at full health. */
    speed: 15,
    /** Speed multiplier when starving. */
    hungrySpeedMul: 0.45,
    /** Extra speed while chasing a pellet. */
    chaseSpeedMul: 2.1,
    /** How fast velocity catches up to the desired direction (per second). */
    steer: 2.6,
    /** Seconds between idle heading changes (randomised in this range). */
    wanderEvery: [1.4, 4.2],
    /** Vertical bob: pixels and cycles per second. */
    bobAmp: 1.6,
    bobHz: 0.55,
    /** Tail wave speed multiplier relative to travel speed. */
    tailHz: 3.2,
    /** Keep this far from the glass. */
    margin: 4,
  },

  food: {
    sinkSpeed: 10,
    /** Pellets rest on the sand this long before dissolving. */
    restSeconds: 26,
    eatRadius: 6,
    maxPellets: 30,
    /** Pellets dropped per click. */
    perDrop: 3,
  },

  bubbles: {
    /** Ambient bubbles spawned per second across the whole tank. */
    ambientRate: 1.1,
    /** Extra per second from each bubbler item. */
    emitterRate: 4.5,
    riseSpeed: [10, 22],
    maxBubbles: 90,
  },

  /** Catch-up is clamped so a month away doesn't produce nonsense. */
  offline: { maxHours: 72 },
};

/** Discrete sprite size for a given growth stage. */
export function sizeForStage(stage) {
  const s = RULES.growth.sizes;
  return s[Math.max(0, Math.min(s.length - 1, stage))];
}

/** How many pellets a fish must have eaten to be at a given stage. */
export function stageForFeeds(feeds) {
  const t = RULES.growth.feedsPerStage;
  let stage = 0;
  for (let i = 0; i < t.length; i++) if (feeds >= t[i]) stage = i;
  return stage;
}
