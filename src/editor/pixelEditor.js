/**
 * Screen 1 — the fish designer.
 *
 * A 16x16 grid of palette indices is the single source of truth. The canvas is
 * literally 16x16 pixels and CSS blows it up to ~512, so what you draw is
 * exactly what gets stored and exactly what swims: no resampling anywhere.
 *
 * Undo/redo keeps whole-grid snapshots. At 256 bytes each, 64 of them cost
 * 16KB — far simpler than diffing, and instant to restore.
 */

import { PALETTE, COLORS, TRANSPARENT } from '../data/palette.js';
import { TEMPLATES, NAME_POOL } from '../data/templates.js';
import { BACKGROUNDS_BY_ID } from '../data/items.js';
import {
  createCanvas,
  ctx2d,
  spriteToCanvas,
  drawWavy,
  isBlank,
  rowsToPixels,
} from '../game/sprite.js';
import { buildPreviewWater } from '../game/render.js';

const W = 16;
const H = 16;
const MAX_HISTORY = 64;

const TOOL_NAMES = {
  pencil: 'Pencil',
  eraser: 'Eraser',
  fill: 'Fill',
  picker: 'Picker',
};

export function createEditor({ state, onRelease, onBuyColor, onToast }) {
  /* ------------------------------- elements ------------------------------- */
  const canvas = document.getElementById('editor-canvas');
  const ctx = ctx2d(canvas);
  const gridlines = document.getElementById('gridlines');
  const kcursor = document.getElementById('kcursor');
  const statusEl = document.getElementById('editor-status');
  const paletteEl = document.getElementById('palette');
  const paletteNote = document.getElementById('palette-note');
  const templatesEl = document.getElementById('templates');
  const previewCanvas = document.getElementById('preview-canvas');
  const previewCtx = ctx2d(previewCanvas);
  const nameField = document.getElementById('fish-name');
  const releaseBtn = document.getElementById('release');
  const releaseNote = document.getElementById('release-note');
  const toolButtons = [...document.querySelectorAll('.tool')];
  const actButtons = [...document.querySelectorAll('[data-act]')];

  /* -------------------------------- state --------------------------------- */
  let px = new Uint8Array(W * H).fill(TRANSPARENT);
  let tool = 'pencil';
  let color = 10; // Sunset — a friendly default that isn't the water colour
  let history = [px.slice()];
  let hIndex = 0;
  let gridOn = true;
  let drawing = false;
  let lastCell = null;
  let strokeChanged = false;
  let cursor = { x: 8, y: 8 };
  let active = false;
  let rafId = 0;
  let previewSprite = null;
  let previewWater = null;
  let phase = 0;
  let swimX = 8;
  let swimDir = 1;

  /* ------------------------------ grid basics ----------------------------- */

  const idx = (x, y) => y * W + x;
  const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H;

  function render() {
    const img = ctx.createImageData(W, H);
    for (let i = 0; i < W * H; i++) {
      const p = px[i];
      if (p === TRANSPARENT) continue; // leave alpha 0: CSS checkerboard shows
      const n = parseInt(COLORS[p].slice(1), 16);
      const o = i * 4;
      img.data[o] = (n >> 16) & 255;
      img.data[o + 1] = (n >> 8) & 255;
      img.data[o + 2] = n & 255;
      img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    previewSprite = null; // preview re-bakes on next frame
  }

  function setPixel(x, y, value) {
    if (!inside(x, y)) return false;
    const i = idx(x, y);
    if (px[i] === value) return false;
    px[i] = value;
    return true;
  }

  /* ------------------------------- history -------------------------------- */

  function pushHistory() {
    history = history.slice(0, hIndex + 1);
    history.push(px.slice());
    if (history.length > MAX_HISTORY) history.shift();
    hIndex = history.length - 1;
    syncActs();
  }

  function commit(label) {
    if (!strokeChanged) return;
    strokeChanged = false;
    pushHistory();
    if (label) say(label);
  }

  function undo() {
    if (hIndex === 0) return;
    hIndex--;
    px = history[hIndex].slice();
    render();
    syncActs();
    say('Undone');
  }

  function redo() {
    if (hIndex >= history.length - 1) return;
    hIndex++;
    px = history[hIndex].slice();
    render();
    syncActs();
    say('Redone');
  }

  function syncActs() {
    const u = actButtons.find((b) => b.dataset.act === 'undo');
    const r = actButtons.find((b) => b.dataset.act === 'redo');
    if (u) u.disabled = hIndex === 0;
    if (r) r.disabled = hIndex >= history.length - 1;
  }

  /* -------------------------------- tools --------------------------------- */

  /**
   * Four-way flood fill over matching indices. Iterative with an explicit
   * stack — 256 cells never needs recursion, but a stack keeps it obvious.
   */
  function floodFill(sx, sy, value) {
    const target = px[idx(sx, sy)];
    if (target === value) return false;
    const stack = [[sx, sy]];
    const seen = new Uint8Array(W * H);
    let changed = false;
    while (stack.length) {
      const [x, y] = stack.pop();
      if (!inside(x, y)) continue;
      const i = idx(x, y);
      if (seen[i] || px[i] !== target) continue;
      seen[i] = 1;
      px[i] = value;
      changed = true;
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    return changed;
  }

  /** Apply the active tool at a cell. Returns whether pixels changed. */
  function applyTool(x, y) {
    if (!inside(x, y)) return false;
    switch (tool) {
      case 'eraser':
        return setPixel(x, y, TRANSPARENT);
      case 'fill':
        return floodFill(x, y, color);
      case 'picker': {
        const p = px[idx(x, y)];
        selectColor(p === TRANSPARENT ? TRANSPARENT : p);
        say(p === TRANSPARENT ? 'Picked see-through' : `Picked ${PALETTE[p].name}`);
        return false;
      }
      default:
        return setPixel(x, y, color);
    }
  }

  /**
   * Bresenham between the previous and current cell. Without this, a fast drag
   * (or a flicked finger) leaves gaps in the line.
   */
  function strokeTo(x, y) {
    if (!lastCell) {
      strokeChanged = applyTool(x, y) || strokeChanged;
      lastCell = { x, y };
      render();
      return;
    }
    let { x: x0, y: y0 } = lastCell;
    const dx = Math.abs(x - x0);
    const dy = Math.abs(y - y0);
    const sx = x0 < x ? 1 : -1;
    const sy = y0 < y ? 1 : -1;
    let err = dx - dy;
    for (;;) {
      strokeChanged = applyTool(x0, y0) || strokeChanged;
      if (x0 === x && y0 === y) break;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x0 += sx;
      }
      if (e2 < dx) {
        err += dx;
        y0 += sy;
      }
    }
    lastCell = { x, y };
    render();
  }

  function mirror() {
    const out = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) out[idx(x, y)] = px[idx(W - 1 - x, y)];
    }
    px = out;
    strokeChanged = true;
    render();
    commit('Mirrored');
  }

  function clear() {
    if (isBlank(px)) return;
    px = new Uint8Array(W * H).fill(TRANSPARENT);
    strokeChanged = true;
    render();
    commit('Cleared');
  }

  function loadPixels(next, label) {
    px = next.slice();
    strokeChanged = true;
    render();
    commit(label);
  }

  /* -------------------------------- pointer ------------------------------- */

  /** Client coords -> grid cell. Uses the element box, so any CSS size works. */
  function cellFromEvent(ev) {
    const r = canvas.getBoundingClientRect();
    return {
      x: Math.floor(((ev.clientX - r.left) / r.width) * W),
      y: Math.floor(((ev.clientY - r.top) / r.height) * H),
    };
  }

  canvas.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    canvas.setPointerCapture(ev.pointerId);
    drawing = true;
    lastCell = null;
    strokeChanged = false;
    const c = cellFromEvent(ev);
    cursor = c;
    moveCursorEl();
    strokeTo(c.x, c.y);
  });

  canvas.addEventListener('pointermove', (ev) => {
    if (!drawing) return;
    ev.preventDefault();
    const c = cellFromEvent(ev);
    if (lastCell && c.x === lastCell.x && c.y === lastCell.y) return;
    cursor = c;
    moveCursorEl();
    strokeTo(c.x, c.y);
  });

  function endStroke() {
    if (!drawing) return;
    drawing = false;
    lastCell = null;
    commit();
  }
  canvas.addEventListener('pointerup', endStroke);
  canvas.addEventListener('pointercancel', endStroke);
  canvas.addEventListener('lostpointercapture', endStroke);

  /* ------------------------------- keyboard ------------------------------- */

  function moveCursorEl() {
    kcursor.style.setProperty('--cx', cursor.x);
    kcursor.style.setProperty('--cy', cursor.y);
  }

  canvas.addEventListener('focus', () => {
    kcursor.hidden = false;
    moveCursorEl();
    say(`Cursor at column ${cursor.x + 1}, row ${cursor.y + 1}`);
  });
  canvas.addEventListener('blur', () => {
    kcursor.hidden = true;
  });

  canvas.addEventListener('keydown', (ev) => {
    const step = ev.shiftKey ? 4 : 1;
    let handled = true;
    switch (ev.key) {
      case 'ArrowLeft':
        cursor.x = Math.max(0, cursor.x - step);
        break;
      case 'ArrowRight':
        cursor.x = Math.min(W - 1, cursor.x + step);
        break;
      case 'ArrowUp':
        cursor.y = Math.max(0, cursor.y - step);
        break;
      case 'ArrowDown':
        cursor.y = Math.min(H - 1, cursor.y + step);
        break;
      case 'Home':
        cursor.x = 0;
        break;
      case 'End':
        cursor.x = W - 1;
        break;
      case 'Enter':
      case ' ':
        strokeChanged = applyTool(cursor.x, cursor.y) || strokeChanged;
        render();
        commit(describeCell());
        handled = true;
        break;
      case 'Backspace':
      case 'Delete':
        strokeChanged = setPixel(cursor.x, cursor.y, TRANSPARENT) || strokeChanged;
        render();
        commit('Erased');
        break;
      default:
        handled = false;
    }
    if (handled) {
      ev.preventDefault();
      moveCursorEl();
      if (ev.key.startsWith('Arrow') || ev.key === 'Home' || ev.key === 'End') {
        say(describeCell());
      }
    }
  });

  function describeCell() {
    const p = px[idx(cursor.x, cursor.y)];
    const what = p === TRANSPARENT ? 'empty' : PALETTE[p].name;
    return `Column ${cursor.x + 1}, row ${cursor.y + 1}: ${what}`;
  }

  function say(msg) {
    if (msg) statusEl.textContent = msg;
  }

  /* --------------------------- tools and actions -------------------------- */

  function selectTool(next) {
    tool = next;
    for (const b of toolButtons) {
      b.setAttribute('aria-pressed', String(b.dataset.tool === next));
    }
    canvas.style.cursor = next === 'picker' ? 'cell' : 'crosshair';
    say(`${TOOL_NAMES[next]} selected`);
  }

  for (const b of toolButtons) {
    b.addEventListener('click', () => selectTool(b.dataset.tool));
  }

  for (const b of actButtons) {
    b.addEventListener('click', () => {
      switch (b.dataset.act) {
        case 'undo':
          undo();
          break;
        case 'redo':
          redo();
          break;
        case 'mirror':
          mirror();
          break;
        case 'clear':
          clear();
          break;
        case 'grid':
          gridOn = !gridOn;
          gridlines.hidden = !gridOn;
          b.setAttribute('aria-pressed', String(gridOn));
          say(gridOn ? 'Grid on' : 'Grid off');
          break;
      }
    });
  }

  /* -------------------------------- palette ------------------------------- */

  let swatchEls = [];

  function selectColor(value) {
    color = value;
    for (const el of swatchEls) {
      const own = Number(el.dataset.index);
      const on = Number.isNaN(own) ? value === TRANSPARENT : own === value;
      el.setAttribute('aria-checked', String(on));
      el.tabIndex = on ? 0 : -1;
    }
    // Painting with a colour implies you want the pencil.
    if (tool === 'eraser' && value !== TRANSPARENT) selectTool('pencil');
  }

  function renderPalette() {
    paletteEl.textContent = '';
    swatchEls = [];

    PALETTE.forEach((entry, i) => {
      const locked = !state.unlockedColors.includes(i);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `swatch${locked ? ' swatch--locked' : ''}`;
      b.setAttribute('role', 'radio');
      b.dataset.index = String(i);
      b.style.setProperty('--sw', entry.hex);
      if (locked) b.dataset.price = String(entry.price);
      b.setAttribute(
        'aria-label',
        locked ? `${entry.name}, locked, ${entry.price} coins` : entry.name
      );
      b.setAttribute('aria-checked', String(!locked && color === i));
      b.tabIndex = !locked && color === i ? 0 : -1;

      b.addEventListener('click', () => {
        if (!state.unlockedColors.includes(i)) {
          const bought = onBuyColor(i);
          if (bought) {
            renderPalette();
            selectColor(i);
          }
          return;
        }
        selectColor(i);
        say(`${entry.name} selected`);
      });

      paletteEl.append(b);
      swatchEls.push(b);
    });

    // 17th control: the see-through slot. Full width, so the 16 colours stay a
    // clean 8x2 block.
    const none = document.createElement('button');
    none.type = 'button';
    none.className = 'swatch swatch--none';
    none.setAttribute('role', 'radio');
    none.dataset.index = 'none';
    none.textContent = 'See-through';
    none.setAttribute('aria-label', 'See-through, paints holes');
    none.setAttribute('aria-checked', String(color === TRANSPARENT));
    none.tabIndex = color === TRANSPARENT ? 0 : -1;
    none.addEventListener('click', () => {
      selectColor(TRANSPARENT);
      say('See-through selected');
    });
    paletteEl.append(none);
    swatchEls.push(none);

    const lockedCount = PALETTE.filter((_, i) => !state.unlockedColors.includes(i)).length;
    paletteNote.textContent = lockedCount
      ? `${lockedCount} colours still locked. Tap one to buy it.`
      : 'Every colour unlocked.';
  }

  // Radiogroup keyboard model: arrows move and select, roving tabindex.
  paletteEl.addEventListener('keydown', (ev) => {
    const dirs = { ArrowRight: 1, ArrowDown: 8, ArrowLeft: -1, ArrowUp: -8 };
    const d = dirs[ev.key];
    if (!d) return;
    ev.preventDefault();
    const here = swatchEls.findIndex((el) => el === document.activeElement);
    if (here < 0) return;
    const next = Math.max(0, Math.min(swatchEls.length - 1, here + d));
    swatchEls[next].focus();
    swatchEls[next].click();
  });

  /* ------------------------------- templates ------------------------------ */

  function renderTemplates() {
    templatesEl.textContent = '';
    for (const t of TEMPLATES) {
      const { px: tpx } = rowsToPixels(t.rows);
      const chip = spriteToCanvas(tpx, W, H);

      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tpl';
      b.setAttribute('aria-label', `Start from the ${t.name} template`);
      const label = document.createElement('span');
      label.textContent = t.name;
      b.append(chip, label);
      b.addEventListener('click', () => {
        loadPixels(tpx, `${t.name} loaded`);
        if (!nameField.value) nameField.placeholder = t.suggested.toUpperCase();
      });
      templatesEl.append(b);
    }
  }

  /* -------------------------------- preview ------------------------------- */

  /**
   * The swim test: the fish drawn at tank size, in tank water, with the same
   * wave and bob the aquarium uses. It's the honest answer to "what will this
   * look like when it's alive".
   */
  function drawPreview(dt) {
    if (!previewWater) {
      previewWater = buildPreviewWater(
        previewCanvas.width,
        previewCanvas.height,
        BACKGROUNDS_BY_ID[state.background]?.ramp || BACKGROUNDS_BY_ID.open.ramp
      );
    }
    if (!previewSprite) previewSprite = spriteToCanvas(px, W, H);

    const pw = previewCanvas.width;
    const ph = previewCanvas.height;

    previewCtx.drawImage(previewWater, 0, 0);

    const speed = 11;
    swimX += swimDir * speed * dt;
    if (swimX > pw - W - 2) {
      swimX = pw - W - 2;
      swimDir = -1;
    } else if (swimX < 2) {
      swimX = 2;
      swimDir = 1;
    }
    phase += dt * 7;

    const bob = Math.sin(phase * 0.35) * 1.6;
    const y = (ph - H) / 2 + bob - 2;
    drawWavy(previewCtx, previewSprite, swimX, y, phase, swimDir < 0);
  }

  let last = 0;
  function loop(now) {
    if (!active) return;
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016);
    last = now;
    drawPreview(dt);
    rafId = requestAnimationFrame(loop);
  }

  /* -------------------------------- release ------------------------------- */

  function randomName() {
    return NAME_POOL[Math.floor(Math.random() * NAME_POOL.length)];
  }

  releaseBtn.addEventListener('click', () => {
    if (isBlank(px)) {
      releaseNote.textContent = 'Nothing drawn yet. Pick a template to start.';
      onToast('Draw a fish first');
      canvas.focus();
      return;
    }
    const name = (nameField.value.trim() || randomName()).toUpperCase().slice(0, 12);
    releaseNote.textContent = '';
    nameField.value = '';
    onRelease({ name, pixels: px.slice() });
  });

  nameField.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') releaseBtn.click();
  });

  /* ----------------------------- global keys ------------------------------ */

  function onGlobalKey(ev) {
    if (!active) return;
    const t = ev.target;
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;

    const meta = ev.ctrlKey || ev.metaKey;
    if (meta && ev.key.toLowerCase() === 'z') {
      ev.preventDefault();
      if (ev.shiftKey) redo();
      else undo();
      return;
    }
    if (meta) return;

    const map = { b: 'pencil', e: 'eraser', f: 'fill', i: 'picker' };
    const key = ev.key.toLowerCase();
    if (map[key]) {
      selectTool(map[key]);
      ev.preventDefault();
    } else if (key === 'g') {
      document.querySelector('[data-act="grid"]').click();
      ev.preventDefault();
    } else if (key === 'm') {
      mirror();
      ev.preventDefault();
    }
  }
  window.addEventListener('keydown', onGlobalKey);

  /* --------------------------------- init --------------------------------- */

  renderPalette();
  renderTemplates();
  selectColor(color);
  selectTool('pencil');
  render();
  syncActs();
  // Start on a template: an empty grid is a worse first impression than a fish
  // the player can immediately mess with.
  loadPixels(rowsToPixels(TEMPLATES[0].rows).px, '');
  history = [px.slice()];
  hIndex = 0;
  syncActs();

  return {
    show() {
      active = true;
      last = 0;
      previewWater = null; // backdrop may have changed while away
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(loop);
      renderPalette();
      selectColor(color);
    },
    hide() {
      active = false;
      cancelAnimationFrame(rafId);
    },
    refreshPalette: renderPalette,
    focusCanvas() {
      canvas.focus();
    },
  };
}
