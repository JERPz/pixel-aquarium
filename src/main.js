/**
 * Bootstrap and screen routing.
 *
 * Owns the save object and hands the same reference to both screens, so the
 * editor's palette locks and the tank's coin counter are always looking at the
 * same numbers. Everything that mutates the save funnels through `persist()`.
 */

import './style.css';
import { load, save as writeSave, settleAwayTime } from './data/storage.js';
import { PALETTE, LOCKABLE_COLORS } from './data/palette.js';
import { ITEMS, ITEMS_BY_ID, BACKGROUNDS } from './data/items.js';
import { createEditor } from './editor/pixelEditor.js';
import { createAquarium } from './game/aquarium.js';
import { itemSpriteFor } from './game/decoration.js';
import { RULES } from './game/rules.js';

const { save: state, report } = load();

/* ------------------------------- shared bits ------------------------------ */

const el = (id) => document.getElementById(id);
const purseCount = el('purse-count');
const shopPurse = el('shop-purse');
const toastEl = el('toast');
const scrim = el('scrim');
const card = el('fish-card');
const shop = el('shop');
const dockHint = el('dock-hint');
const tray = el('tray');
const trayList = el('tray-list');
const traySel = el('tray-sel');
const traySelName = el('tray-selname');

const SIZE_NAMES = ['Fry', 'Young', 'Grown', 'Whopper'];

/** Declared up here because the aquarium calls back into the roster during
 *  construction, before the later module body has run. */
let rosterEl = null;

let toastTimer = 0;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.dataset.show = '1';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.dataset.show = '0';
  }, 2400);
}

function persist(immediate = false) {
  writeSave(state, immediate);
  updatePurse();
}

function updatePurse() {
  const n = Math.floor(state.coins);
  purseCount.textContent = String(n);
  shopPurse.textContent = `${n} coin${n === 1 ? '' : 's'} in the pot`;
}

/** Copy a cached sprite into a fresh canvas so it can live in the DOM. */
function chipOf(sprite, label) {
  const c = document.createElement('canvas');
  c.width = sprite.width;
  c.height = sprite.height;
  const cx = c.getContext('2d');
  cx.imageSmoothingEnabled = false;
  cx.drawImage(sprite, 0, 0);
  if (label) {
    c.setAttribute('role', 'img');
    c.setAttribute('aria-label', label);
  } else {
    c.setAttribute('aria-hidden', 'true');
  }
  return c;
}

/* ================================= tank ================================== */

const tank = createAquarium({
  state,
  onToast: toast,
  onOpenFish: openCard,
  onChange: (structural) => {
    updatePurse();
    persist(false);
    if (structural) renderTray();
  },
  onRosterChange: (fish) => {
    renderRoster(fish);
    renderTraySelection();
  },
});

/* ================================ editor ================================= */

const editor = createEditor({
  state,
  onToast: toast,
  onRelease: ({ name, pixels }) => {
    tank.addFish(name, pixels);
    persist(true);
    go('tank');
    toast(`${name} is in the tank`);
  },
  onBuyColor: (index) => {
    const price = PALETTE[index].price || 0;
    if (state.coins < price) {
      toast(`${PALETTE[index].name} costs ${price}`);
      return false;
    }
    state.coins -= price;
    state.unlockedColors.push(index);
    persist(true);
    toast(`${PALETTE[index].name} unlocked`);
    renderShop();
    return true;
  },
});

/* =============================== routing ================================= */

const screens = {
  tank: el('screen-tank'),
  designer: el('screen-designer'),
};
let current = null;

/**
 * Leaving the tank stops the loop. Time keeps passing for the fish either way —
 * the storage layer settles it up on the way back in, the same code path a
 * player returning tomorrow goes through.
 */
function pauseTank() {
  tank.stop();
  persist(true);
}

function resumeTank() {
  tank.flushFish();
  const r = settleAwayTime(state);
  if (r.capped > 60) {
    tank.syncFish();
    if (r.coins > 0) toast(`+${r.coins} coins while you were away`);
  }
  tank.resize();
  tank.start();
  renderTray();
}

/** Apply a screen. Idempotent. */
function show(name) {
  if (!screens[name] || current === name) return;
  current = name;

  for (const [key, node] of Object.entries(screens)) node.hidden = key !== name;
  for (const b of document.querySelectorAll('.tab[data-goto]')) {
    if (b.dataset.goto === name) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }

  if (name === 'tank') {
    editor.hide();
    resumeTank();
  } else {
    pauseTank();
    editor.show();
  }
}

/**
 * The hash is the source of truth, so the browser's back button works and a
 * stale queued `hashchange` can never drag the player onto a screen they just
 * left. `show` runs immediately for responsiveness; the event that follows
 * re-reads the hash and finds nothing left to do.
 */
function go(name) {
  if (!screens[name]) return;
  if (location.hash !== `#${name}`) location.hash = `#${name}`;
  show(name);
}

function onHash() {
  const name = location.hash.replace('#', '');
  show(screens[name] ? name : 'tank');
}

for (const b of document.querySelectorAll('[data-goto]')) {
  b.addEventListener('click', () => go(b.dataset.goto));
}
window.addEventListener('hashchange', onHash);

/* ============================== tank modes =============================== */

const modeButtons = [...document.querySelectorAll('[data-mode]')];

function setMode(next) {
  tank.setMode(next);
  for (const b of modeButtons) b.setAttribute('aria-checked', String(b.dataset.mode === next));
  tray.hidden = next !== 'decorate';
  dockHint.textContent =
    next === 'decorate'
      ? 'Pick an item, then click the tank. Drag to move, Delete to put it back.'
      : 'Click the water to drop food. Click a fish to see how it is doing.';
  renderTray();
}

for (const b of modeButtons) {
  b.addEventListener('click', () => setMode(b.dataset.mode));
}

/* ================================= tray ================================== */

function renderTray() {
  if (tray.hidden) return;
  trayList.textContent = '';

  const owned = Object.entries(state.inventory).filter(([, n]) => n > 0);
  if (!owned.length) {
    const li = document.createElement('li');
    li.className = 'dock__hint';
    li.textContent = 'Tray empty — buy something in the shop.';
    trayList.append(li);
    renderTraySelection();
    return;
  }

  for (const [id, count] of owned) {
    const def = ITEMS_BY_ID[id];
    const sprite = itemSpriteFor(id);
    if (!def || !sprite) continue;

    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tray__item';
    b.setAttribute('aria-pressed', String(tank.getTraySelection() === id));
    b.setAttribute('aria-label', `${def.name}, ${count} in tray`);
    b.append(chipOf(sprite));
    const n = document.createElement('span');
    n.className = 'tray__count';
    n.textContent = `x${count}`;
    b.append(n);
    b.addEventListener('click', () => {
      const next = tank.getTraySelection() === id ? null : id;
      tank.setTraySelection(next);
      renderTray();
      if (next) toast(`Click the tank to place ${def.name}`);
    });
    li.append(b);
    trayList.append(li);
  }
  renderTraySelection();
}

function renderTraySelection() {
  const sel = tank.getSelected();
  traySel.hidden = !sel;
  if (sel) traySelName.textContent = ITEMS_BY_ID[sel.id]?.name || 'Item';
}

for (const b of document.querySelectorAll('[data-sel]')) {
  b.addEventListener('click', () => {
    tank.actOnSelected(b.dataset.sel);
    renderTraySelection();
  });
}

/* ============================ keyboard roster ============================= */

/**
 * The tank is a canvas, so its contents can't be reached with Tab. This mirrors
 * the fish as a real list of buttons for screen readers and keyboard users:
 * off-screen, but focusable and labelled with live stats.
 */
function renderRoster(fish) {
  if (!rosterEl) {
    rosterEl = document.createElement('nav');
    rosterEl.className = 'sr-only';
    rosterEl.setAttribute('aria-label', 'Fish in the tank');
    el('screen-tank').append(rosterEl);
  }
  rosterEl.textContent = '';
  const list = document.createElement('ul');
  for (const f of fish) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = `${f.name}: hunger ${Math.round(f.hunger)}, happiness ${Math.round(
      f.happiness
    )}. Open card.`;
    b.addEventListener('click', () => openCard(f));
    li.append(b);
    list.append(li);
  }
  rosterEl.append(list);
}

/* =============================== fish card =============================== */

let cardFish = null;
let cardTimer = 0;

function meter(value, colourVar) {
  const wrap = document.createElement('div');
  wrap.className = 'meter';
  wrap.style.setProperty('--m', colourVar);
  const on = Math.round((value / 100) * 10);
  for (let i = 0; i < 10; i++) {
    const cell = document.createElement('i');
    if (i < on) cell.dataset.on = '1';
    wrap.append(cell);
  }
  return wrap;
}

function statRow(label, value, colourVar, text) {
  const row = document.createElement('div');
  row.className = 'stat';
  const l = document.createElement('span');
  l.className = 'stat__label';
  l.textContent = label;
  row.append(l);
  if (value === null) {
    const spacer = document.createElement('span');
    spacer.textContent = '';
    row.append(spacer);
  } else {
    row.append(meter(value, colourVar));
  }
  const v = document.createElement('span');
  v.textContent = text;
  row.append(v);
  return row;
}

function ageText(days) {
  if (days < 1 / 24) return 'brand new';
  if (days < 1) return `${Math.floor(days * 24)}h old`;
  return `${Math.floor(days)}d old`;
}

function refreshCard() {
  if (!cardFish) return;
  const f = cardFish;
  el('card-name').textContent = f.name;
  el('card-meta').textContent = `${ageText(f.ageDays)} · ${SIZE_NAMES[f.stage]} · ${
    f.feeds
  } meals`;

  const portrait = el('card-portrait');
  const pctx = portrait.getContext('2d');
  pctx.imageSmoothingEnabled = false;
  pctx.clearRect(0, 0, portrait.width, portrait.height);
  pctx.drawImage(f.portrait(16), 0, 0);

  const hungerColour =
    f.hunger >= RULES.hunger.hungryAt
      ? 'var(--c12)'
      : f.hunger >= RULES.hunger.starvingAt
        ? 'var(--c11)'
        : 'var(--c9)';

  const stats = el('card-stats');
  stats.textContent = '';
  stats.append(
    statRow('Hunger', f.hunger, hungerColour, `${Math.round(f.hunger)}%`),
    statRow('Happy', f.happiness, 'var(--c3)', `${Math.round(f.happiness)}%`),
    // Stage 0 of 4 shown as one filled segment, not an empty bar — a fry has
    // still made it onto the ladder.
    statRow(
      'Size',
      ((f.stage + 1) / SIZE_NAMES.length) * 100,
      'var(--c10)',
      SIZE_NAMES[f.stage]
    )
  );
}

function openCard(f) {
  cardFish = f;
  shop.hidden = true;
  card.hidden = false;
  scrim.hidden = false;
  el('rename').value = f.name;
  refreshCard();
  clearInterval(cardTimer);
  cardTimer = setInterval(refreshCard, 600);
  el('rename').focus();
}

function closeDialogs() {
  card.hidden = true;
  shop.hidden = true;
  scrim.hidden = true;
  cardFish = null;
  clearInterval(cardTimer);
  armedRelease = false;
}

for (const b of document.querySelectorAll('[data-close]')) {
  b.addEventListener('click', closeDialogs);
}
scrim.addEventListener('pointerdown', (ev) => {
  if (ev.target === scrim) closeDialogs();
});
window.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && !scrim.hidden) closeDialogs();
});

let armedRelease = false;
for (const b of document.querySelectorAll('[data-card]')) {
  b.addEventListener('click', () => {
    if (!cardFish) return;
    if (b.dataset.card === 'rename') {
      const next = el('rename').value.trim().toUpperCase().slice(0, 12);
      if (!next) {
        toast('Give it a name first');
        return;
      }
      cardFish.name = next;
      const record = state.fish.find((r) => r.uid === cardFish.uid);
      if (record) record.name = next;
      persist(true);
      refreshCard();
      renderRoster(tank.fish);
      toast('Renamed');
      return;
    }
    // Setting a fish free is permanent, so it takes two taps.
    if (!armedRelease) {
      armedRelease = true;
      b.textContent = 'Tap again to confirm';
      setTimeout(() => {
        armedRelease = false;
        b.textContent = 'Set free';
      }, 3000);
      return;
    }
    const name = cardFish.name;
    tank.removeFish(cardFish);
    closeDialogs();
    persist(true);
    toast(`${name} swam away`);
  });
}

/* ================================= shop ================================== */

let shopTab = 'items';

function shopRow({ label, note, price, owned, chip, swatch, onBuy, action }) {
  const row = document.createElement('div');
  row.className = `shopitem${owned ? ' shopitem--owned' : ''}`;

  if (chip) row.append(chip);
  else if (swatch) {
    const sw = document.createElement('span');
    sw.className = 'shopitem__sw';
    sw.style.background = swatch;
    row.append(sw);
  } else row.append(document.createElement('span'));

  const text = document.createElement('div');
  text.className = 'shopitem__n';
  text.textContent = label;
  if (note) {
    const d = document.createElement('div');
    d.className = 'shopitem__d';
    d.textContent = note;
    text.append(d);
  }
  row.append(text);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn--tiny';
  if (action) {
    btn.textContent = action.label;
    btn.disabled = !!action.disabled;
    btn.addEventListener('click', action.run);
  } else {
    btn.textContent = `Buy ${price}`;
    btn.setAttribute('aria-label', `Buy ${label} for ${price} coins`);
    btn.classList.add('btn--go');
    btn.disabled = state.coins < price;
    btn.addEventListener('click', onBuy);
  }
  row.append(btn);
  return row;
}

function renderShop() {
  updatePurse();
  const body = el('shop-body');
  body.textContent = '';

  for (const b of document.querySelectorAll('[data-shop]')) {
    b.setAttribute('aria-selected', String(b.dataset.shop === shopTab));
  }

  if (shopTab === 'items') {
    el('shop-note').textContent = 'Decorations go to your tray, then into the tank.';
    for (const item of ITEMS) {
      const have = state.inventory[item.id] || 0;
      body.append(
        shopRow({
          label: item.name,
          note: `Comfort ${item.comfort}${have ? ` · ${have} in tray` : ''}`,
          price: item.price,
          chip: chipOf(itemSpriteFor(item.id)),
          onBuy: () => {
            if (state.coins < item.price) return;
            state.coins -= item.price;
            state.inventory[item.id] = have + 1;
            persist(true);
            renderShop();
            renderTray();
            toast(`${item.name} added to the tray`);
          },
        })
      );
    }
    return;
  }

  if (shopTab === 'colors') {
    el('shop-note').textContent = 'Unlocked colours appear in the editor palette.';
    for (const i of LOCKABLE_COLORS) {
      const owned = state.unlockedColors.includes(i);
      body.append(
        shopRow({
          label: PALETTE[i].name,
          note: owned ? 'Unlocked' : 'Locked',
          price: PALETTE[i].price,
          owned,
          swatch: PALETTE[i].hex,
          action: owned ? { label: 'Owned', disabled: true, run: () => {} } : null,
          onBuy: () => {
            if (state.coins < PALETTE[i].price) return;
            state.coins -= PALETTE[i].price;
            state.unlockedColors.push(i);
            persist(true);
            renderShop();
            editor.refreshPalette();
            toast(`${PALETTE[i].name} unlocked`);
          },
        })
      );
    }
    return;
  }

  el('shop-note').textContent = 'Backdrops change the water and the sand.';
  for (const bg of BACKGROUNDS) {
    const owned = state.ownedBackgrounds.includes(bg.id);
    const activeNow = state.background === bg.id;
    const strip = document.createElement('canvas');
    strip.width = 8;
    strip.height = 8;
    const sctx = strip.getContext('2d');
    bg.ramp.forEach((idx, j) => {
      sctx.fillStyle = PALETTE[idx].hex;
      sctx.fillRect(0, j, 8, 1);
    });
    strip.setAttribute('aria-hidden', 'true');

    body.append(
      shopRow({
        label: bg.name,
        note: activeNow ? 'In use' : owned ? 'Owned' : `${bg.price} coins`,
        price: bg.price,
        owned,
        chip: strip,
        action: owned
          ? {
              label: activeNow ? 'In use' : 'Use',
              disabled: activeNow,
              run: () => {
                state.background = bg.id;
                persist(true);
                tank.rebuildScene();
                renderShop();
                toast(`${bg.name} set`);
              },
            }
          : null,
        onBuy: () => {
          if (state.coins < bg.price) return;
          state.coins -= bg.price;
          state.ownedBackgrounds.push(bg.id);
          state.background = bg.id;
          persist(true);
          tank.rebuildScene();
          renderShop();
          toast(`${bg.name} set`);
        },
      })
    );
  }
}

for (const b of document.querySelectorAll('[data-shop]')) {
  b.addEventListener('click', () => {
    shopTab = b.dataset.shop;
    renderShop();
  });
}

for (const b of document.querySelectorAll('[data-open="shop"]')) {
  b.addEventListener('click', () => {
    card.hidden = true;
    shop.hidden = false;
    scrim.hidden = false;
    renderShop();
    shop.querySelector('.shoptab').focus();
  });
}

/* ============================== lifecycle =============================== */

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (current === 'tank') pauseTank();
    else persist(true);
  } else if (current === 'tank') {
    resumeTank();
  }
});

window.addEventListener('pagehide', () => {
  tank.flushFish();
  persist(true);
});

/* ================================ start ================================= */

updatePurse();
tank.boot();
setMode('feed');
renderShop();

const hashScreen = location.hash.replace('#', '');
const startScreen = screens[hashScreen]
  ? hashScreen
  : state.fish.length === 0
    ? 'designer'
    : 'tank';
go(startScreen);

// Tell the player what happened while they were gone, once the UI is up.
if (report && report.capped > 300) {
  const hours = Math.floor(report.capped / 3600);
  const mins = Math.round((report.capped % 3600) / 60);
  const away = hours ? `${hours}h ${mins}m` : `${mins}m`;
  const bits = [`Away ${away}`];
  if (report.coins > 0) bits.push(`+${report.coins} coins`);
  if (report.hungry > 0) bits.push(`${report.hungry} hungry`);
  setTimeout(() => toast(bits.join(' · ')), 500);
}
