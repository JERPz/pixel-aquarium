# Pixel Aquarium

Draw a fish in a 16×16 pixel editor. It becomes a real fish in your tank —
it swims, gets hungry, grows when you feed it, and earns you coins when it's
happy. Decorate the tank with what you earn.

No backend, no accounts. Everything lives in `localStorage`.

```bash
npm install
npm run dev        # http://localhost:5180
```

```bash
npm run build      # -> dist/
npm run preview    # serve the built output
npm run sprites    # render sprite proof sheets to scripts/out/ + the favicon
npm run deploy     # build and publish dist/ to the gh-pages branch
```

Live at **https://jerpz.github.io/pixel-aquarium/**. The Vite `base` is `./`, so
the build is path-agnostic and works from a subdirectory without configuration.

## Playing

**Draw a fish** — 16×16 grid, four tools, one 16-colour palette. Start from a
template if you'd rather not draw from scratch. The Swim test panel shows the
fish alive, at tank size, while you work. Name it and release it.

| | |
|---|---|
| `B` `E` `F` `I` | pencil, eraser, fill, picker |
| `G` `M` | toggle grid, mirror horizontally |
| `Ctrl/⌘ Z`, `Shift` too | undo, redo |
| arrows, `Enter`, `Backspace` | draw with the keyboard (focus the grid first) |

**Tank** — click the water to drop food. Click a fish for its card: hunger,
happiness, size, age, rename, set free. Switch to Decorate to place, drag,
flip, turn, re-layer, or pick up items. Shop sells decorations, backdrops, and
the four locked palette colours.

Everything works with a mouse, a finger, or the keyboard alone. The fish are
also exposed as a hidden list of buttons, so a screen reader can reach them.

## How the simulation behaves

Hunger drains on **wall-clock time**, not frames — roughly two hours from full
to empty. Come back tomorrow and the tank settles up on load: hunger drops,
happiness drifts toward what hunger implies, and coins earned while you were
away are paid out (capped at 8 hours, so idling isn't a strategy). Long
absences are clamped at 72 hours.

A hungry fish slows down and its colours drain toward the water; below 22 it
gets a warning badge. Feeding enough grows it through four discrete sprite
sizes. Happiness comes mostly from hunger, plus comfort from nearby
decorations, minus a little for crowding. Fish above 65 happiness generate
coins.

Every tunable number is in `src/game/rules.js`.

## Structure

```
index.html              both screens, all controls
src/main.js             bootstrap, routing, HUD, fish card, shop
src/style.css           console chrome — hard 2px bevels, no blur, no radius
src/data/palette.js     REEF-16 and colour maths
src/data/templates.js   4 starter fish as 16×16 row strings
src/data/items.js       decorations + backdrop depth ramps
src/data/storage.js     load/save, schema migrations, away-time catch-up
src/game/rules.js       every balance constant
src/game/aquarium.js    canvas sizing, game loop, input
src/game/fish.js        Fish: wander AI, hunger, growth, drawing
src/game/render.js      dithered water, sand, caustics
src/game/food.js        sinking pellets
src/game/bubbles.js     ambient + bubbler bubbles
src/game/decoration.js  placement, z-order, comfort auras
src/game/sprite.js      rasterising and the tail-wave draw
src/editor/pixelEditor.js  screen 1
scripts/                dev tools (see below)
```

## Two implementation notes

**Nothing is a smooth gradient.** The water is an 8-stop palette ramp with
ordered (Bayer) dithering between stops; so are the caustics and the sand
fringe. That banding is what makes it read as 8-bit rather than as a canvas
with a gradient in it.

**The tank renders at low resolution and scales by a whole number.** The
logical size is derived from the element's real size, and the chunk factor is
picked from whichever axis needs it more — so a bubble, a pellet and a fish
scale are always the same size on screen, and a tall phone tank doesn't end up
hundreds of pixels deep with specks for fish.

## Dev tools

Zero-dependency, and they were used to build this rather than bolted on after.

- `scripts/preview-sprites.mjs` — renders all hand-authored pixel data to PNG
  (its own PNG encoder, via `zlib`) and fails on malformed rows or on a
  template using a colour the player hasn't unlocked. Also emits the favicon.
- `scripts/shoot.mjs` — drives the real app in headless Chrome over the
  DevTools protocol: seeds a save, dispatches genuine mouse, touch and key
  events, screenshots, and **exits non-zero if anything reaches the console**.
- `scripts/seed.mjs` — builds a save with fish at different growth stages and
  hunger levels, including a starving one, plus a decorated tank.

```bash
node scripts/seed.mjs
node scripts/shoot.mjs --out /tmp/tank.png --w 1280 --h 800 \
  --seed scripts/out/seed.json --clicks "400,300"
```
