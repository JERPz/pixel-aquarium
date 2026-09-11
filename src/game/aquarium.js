/**
 * Screen 2 — the tank, and the game loop that drives it.
 *
 * Resolution strategy: the tank is drawn in low-res "tank pixels" and the
 * canvas backing store is an exact whole-number multiple of that, so a bubble,
 * a food pellet and a fish scale are all the same size on screen. The logical
 * size is derived from the element's real size (rather than fixed) so the tank
 * fills any viewport without letterboxing, while the chunk stays constant.
 *
 * The loop is delta-time driven and dt is clamped: after a tab has been in the
 * background, `now - last` can be enormous, and without a clamp every fish
 * would teleport across the glass on the first frame back. Long absences are
 * settled by the storage layer's catch-up pass instead, which is the right
 * place for it — it also runs on a cold load.
 */

import { COLORS, C } from '../data/palette.js';
import { BACKGROUNDS_BY_ID, ITEMS_BY_ID } from '../data/items.js';
import { RULES } from './rules.js';
import { Scene } from './render.js';
import { Fish, newFishRecord } from './fish.js';
import { FoodField } from './food.js';
import { BubbleField } from './bubbles.js';
import { Decorations, itemSpriteFor } from './decoration.js';
import { ctx2d, createCanvas } from './sprite.js';

/**
 * Target tank size in tank pixels. The chunk is picked from whichever axis
 * needs it more: a tall narrow phone tank derived from width alone would end up
 * hundreds of pixels deep, leaving the fish tiny specks in a lot of empty blue.
 */
const TARGET_LOGICAL_W = 340;
const TARGET_LOGICAL_H = 300;

/** Ghost sprites for placement previews: the sprite with every other pixel
 *  knocked out. An 8-bit stand-in for transparency. */
const ghostCache = new Map();
function ghostSprite(id) {
  let g = ghostCache.get(id);
  if (g) return g;
  const src = itemSpriteFor(id, false);
  if (!src) return null;
  g = createCanvas(src.width, src.height);
  const gc = ctx2d(g);
  gc.drawImage(src, 0, 0);
  const img = gc.getImageData(0, 0, src.width, src.height);
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      if ((x + y) & 1) img.data[(y * src.width + x) * 4 + 3] = 0;
    }
  }
  gc.putImageData(img, 0, 0);
  ghostCache.set(id, g);
  return g;
}

export function createAquarium({ state, onToast, onOpenFish, onChange, onRosterChange }) {
  const canvas = document.getElementById('tank-canvas');
  const glass = canvas.parentElement;
  const emptyEl = document.getElementById('tank-empty');

  let ctx = ctx2d(canvas);
  let scale = 3;

  const world = { w: 200, h: 120, sandTop: 100, time: 0, fishCount: 0 };
  const food = new FoodField();
  const bubbles = new BubbleField();
  const decorations = new Decorations(state);
  let scene = null;
  let fish = [];

  let mode = 'feed';
  let running = false;
  let raf = 0;
  let last = 0;
  let saveDebt = 0;
  let coinDebt = 0;

  // Decorate-mode interaction state.
  let traySelection = null; // item id waiting to be placed
  let selected = null; // placed item currently selected
  let dragging = null;
  let dragOffset = { x: 0, y: 0 };
  let hover = null;

  // Keyboard pointer for playing without a mouse.
  let kpointer = { x: 0, y: 0, visible: false };

  world.food = food;
  world.decorations = decorations;

  /* ------------------------------- sizing --------------------------------- */

  function backdrop() {
    return BACKGROUNDS_BY_ID[state.background] || BACKGROUNDS_BY_ID.open;
  }

  function resize() {
    const rect = glass.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    // Pick the chunk size first, then derive how many tank pixels fit.
    scale = Math.max(
      2,
      Math.round(
        Math.max(
          (rect.width * dpr) / TARGET_LOGICAL_W,
          (rect.height * dpr) / TARGET_LOGICAL_H
        )
      )
    );
    const lw = Math.max(140, Math.round((rect.width * dpr) / scale));
    const lh = Math.max(90, Math.round((rect.height * dpr) / scale));

    canvas.width = lw * scale;
    canvas.height = lh * scale;
    ctx = ctx2d(canvas);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);

    world.w = lw;
    world.h = lh;

    if (!scene) scene = new Scene(lw, lh, backdrop());
    else scene.resize(lw, lh, backdrop());
    world.sandTop = scene.sandTop;

    decorations.layout(world);
    for (const f of fish) f.reflow(world);
    kpointer.x = Math.round(lw / 2);
    kpointer.y = Math.round(lh / 2);
    draw();
  }

  const ro = new ResizeObserver(() => resize());
  ro.observe(glass);

  /** Rebuild baked layers after a backdrop purchase or switch. */
  function rebuildScene() {
    if (!scene) return;
    scene.resize(world.w, world.h, backdrop());
    world.sandTop = scene.sandTop;
    draw();
  }

  /* -------------------------------- roster -------------------------------- */

  // Callbacks reach back into main.js, which hasn't finished wiring up while
  // this factory is still running. Nothing fires until boot() says so.
  let booted = false;

  function syncFish() {
    fish = state.fish.map((r) => new Fish(r, world));
    world.fishCount = fish.length;
    emptyEl.hidden = fish.length > 0;
    if (booted) onRosterChange?.(fish);
  }

  function addFish(name, pixels) {
    const record = newFishRecord(state.nextUid++, name, pixels);
    state.fish.push(record);
    const f = new Fish(record, world);
    f.x = Math.random() < 0.5 ? 2 : world.w - f.size - 2;
    f.y = world.h * (0.25 + Math.random() * 0.3);
    fish.push(f);
    world.fishCount = fish.length;
    emptyEl.hidden = true;
    onRosterChange?.(fish);
    onChange?.(true);
    return f;
  }

  function removeFish(target) {
    fish = fish.filter((f) => f !== target);
    state.fish = state.fish.filter((r) => r.uid !== target.uid);
    world.fishCount = fish.length;
    emptyEl.hidden = fish.length > 0;
    onRosterChange?.(fish);
    onChange?.(true);
  }

  /** Push live fish state back into the save records before writing. */
  function flushFish() {
    state.fish = fish.map((f) => f.toJSON());
  }

  /* -------------------------------- update -------------------------------- */

  function update(dt) {
    world.time += dt;

    food.update(dt, world);
    bubbles.update(dt, world, decorations.emitters());

    for (const f of fish) {
      f.update(dt, world);
      if (f.justGrew) onToast?.(`${f.name} grew bigger`);
    }

    /* --- coins: paid per second, banked when a whole one accumulates ----- */
    const { minHappiness, perMinutePerFish } = RULES.coins;
    let rate = 0;
    for (const f of fish) {
      if (f.happiness >= minHappiness) rate += (f.happiness / 100) * perMinutePerFish;
    }
    coinDebt += (rate * dt) / 60;
    if (coinDebt >= 1) {
      const gained = Math.floor(coinDebt);
      coinDebt -= gained;
      state.coins += gained;
      onChange?.(false);
    }

    /* --- persistence: batched, never per frame --------------------------- */
    saveDebt += dt;
    if (saveDebt > 4) {
      saveDebt = 0;
      flushFish();
      onChange?.(true);
    }
  }

  /* --------------------------------- draw --------------------------------- */

  function draw() {
    if (!scene) return;
    scene.drawBack(ctx, world.time);

    // Floor goes down before the props: the sand layer is a full-canvas image,
    // so anything drawn before it would be buried.
    scene.drawFloor(ctx);

    decorations.draw(ctx, false); // behind fish
    food.draw(ctx);

    for (const f of fish) f.draw(ctx, world);

    decorations.draw(ctx, true); // in front of fish
    bubbles.draw(ctx);

    if (mode === 'decorate') drawDecorateOverlay();
    if (kpointer.visible) drawKeyboardPointer();
  }

  function drawDecorateOverlay() {
    if (selected) decorations.drawSelection(ctx, selected, COLORS[C.YOLK]);
    if (traySelection && hover) {
      const g = ghostSprite(traySelection);
      if (g) {
        const { nx, ny } = decorations.anchorFor(traySelection, hover.x, hover.y);
        ctx.drawImage(
          g,
          Math.round(nx * world.w - g.width / 2),
          Math.round(ny * world.h - g.height)
        );
      }
    }
  }

  function drawKeyboardPointer() {
    ctx.fillStyle = COLORS[C.YOLK];
    const { x, y } = kpointer;
    ctx.fillRect(x - 4, y, 3, 1);
    ctx.fillRect(x + 2, y, 3, 1);
    ctx.fillRect(x, y - 4, 1, 3);
    ctx.fillRect(x, y + 2, 1, 3);
  }

  /* --------------------------------- loop --------------------------------- */

  function frame(now) {
    if (!running) return;
    // Clamp dt: a backgrounded tab can hand us a multi-second gap.
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
    last = now;
    update(dt);
    draw();
    raf = requestAnimationFrame(frame);
  }

  /* ------------------------------- pointers ------------------------------- */

  /** Client coords -> tank pixels. */
  function toTank(ev) {
    const r = canvas.getBoundingClientRect();
    return {
      x: ((ev.clientX - r.left) / r.width) * world.w,
      y: ((ev.clientY - r.top) / r.height) * world.h,
    };
  }

  function fishAt(x, y) {
    // Front-to-back: later fish are drawn on top, so search in reverse.
    for (let i = fish.length - 1; i >= 0; i--) {
      if (fish[i].hitTest(x, y)) return fish[i];
    }
    return null;
  }

  /** A tap in feed mode: open a fish, or drop a pinch of food. */
  function actFeed(x, y) {
    const hit = fishAt(x, y);
    if (hit) {
      onOpenFish?.(hit);
      return;
    }
    if (y > world.sandTop - 2) {
      onToast?.('Drop food in the water');
      return;
    }
    food.drop(x, y);
  }

  /** A tap in decorate mode: place, select, or clear the selection. */
  function actDecorate(x, y) {
    if (traySelection) {
      const placed = decorations.place(traySelection, x, y);
      if (placed) {
        selected = placed;
        onChange?.(true);
        onToast?.(`${ITEMS_BY_ID[traySelection].name} placed`);
        if ((state.inventory[traySelection] || 0) <= 0) traySelection = null;
        onRosterChange?.(fish);
      }
      return;
    }
    const hit = decorations.hitTest(x, y);
    selected = hit;
    onRosterChange?.(fish);
  }

  canvas.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    canvas.focus({ preventScroll: true });
    kpointer.visible = false;
    const p = toTank(ev);
    hover = p;

    if (mode === 'feed') {
      actFeed(p.x, p.y);
      return;
    }

    // Decorate: dragging an already-placed item takes priority over placing a
    // new one, so you can rearrange without emptying the tray.
    const hit = traySelection ? null : decorations.hitTest(p.x, p.y);
    if (hit) {
      const b = decorations.box(hit);
      selected = hit;
      dragging = hit;
      dragOffset = { x: p.x - (b.x + b.w / 2), y: p.y - (b.y + b.h) };
      canvas.setPointerCapture(ev.pointerId);
      onRosterChange?.(fish);
      return;
    }
    actDecorate(p.x, p.y);
  });

  canvas.addEventListener('pointermove', (ev) => {
    const p = toTank(ev);
    hover = p;
    if (!dragging) return;
    ev.preventDefault();
    decorations.moveTo(dragging, p.x - dragOffset.x, p.y - dragOffset.y);
  });

  function endDrag() {
    if (!dragging) return;
    dragging = null;
    onChange?.(true);
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('lostpointercapture', endDrag);
  canvas.addEventListener('pointerleave', () => {
    hover = null;
  });

  /* ------------------------------- keyboard ------------------------------- */

  canvas.addEventListener('keydown', (ev) => {
    const step = ev.shiftKey ? 12 : 4;
    let handled = true;
    switch (ev.key) {
      case 'ArrowLeft':
        kpointer.x = Math.max(1, kpointer.x - step);
        break;
      case 'ArrowRight':
        kpointer.x = Math.min(world.w - 1, kpointer.x + step);
        break;
      case 'ArrowUp':
        kpointer.y = Math.max(1, kpointer.y - step);
        break;
      case 'ArrowDown':
        kpointer.y = Math.min(world.h - 1, kpointer.y + step);
        break;
      case 'Enter':
      case ' ':
        kpointer.visible = true;
        if (mode === 'feed') actFeed(kpointer.x, kpointer.y);
        else actDecorate(kpointer.x, kpointer.y);
        break;
      case 'Delete':
      case 'Backspace':
        if (mode === 'decorate' && selected) {
          decorations.remove(selected);
          selected = null;
          onChange?.(true);
          onRosterChange?.(fish);
          onToast?.('Item back in the tray');
        }
        break;
      default:
        handled = false;
    }
    if (handled) {
      ev.preventDefault();
      kpointer.visible = true;
    }
  });

  canvas.addEventListener('blur', () => {
    kpointer.visible = false;
  });

  /* -------------------------------- public -------------------------------- */

  syncFish();
  resize();

  return {
    world,
    decorations,

    /** Called once the host page has finished wiring its own callbacks. */
    boot() {
      booted = true;
      onRosterChange?.(fish);
    },

    start() {
      if (running) return;
      running = true;
      last = 0;
      raf = requestAnimationFrame(frame);
    },

    stop() {
      running = false;
      cancelAnimationFrame(raf);
      flushFish();
    },

    resize,
    rebuildScene,
    addFish,
    removeFish,
    flushFish,
    syncFish,
    draw,

    get fish() {
      return fish;
    },

    setMode(next) {
      mode = next;
      traySelection = null;
      selected = null;
      if (next === 'feed') food.pellets.length; // no-op, keeps intent explicit
      draw();
    },

    getMode() {
      return mode;
    },

    setTraySelection(id) {
      traySelection = id;
      selected = null;
      draw();
    },

    getTraySelection() {
      return traySelection;
    },

    getSelected() {
      return selected;
    },

    clearSelection() {
      selected = null;
      draw();
    },

    actOnSelected(action) {
      if (!selected) return;
      if (action === 'flip') decorations.flip(selected);
      else if (action === 'turn') decorations.rotate(selected);
      else if (action === 'front') decorations.setFront(selected, true);
      else if (action === 'back') decorations.setFront(selected, false);
      else if (action === 'remove') {
        decorations.remove(selected);
        selected = null;
      }
      onChange?.(true);
      onRosterChange?.(fish);
      draw();
    },

    destroy() {
      ro.disconnect();
      cancelAnimationFrame(raf);
    },
  };
}
