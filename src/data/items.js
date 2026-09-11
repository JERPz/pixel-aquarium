/**
 * Tank furniture. Same row-string format as the fish templates: each character
 * is a REEF-16 index, '.' is transparent. Sizes are deliberately mixed so the
 * tray doesn't read as a grid of identical tiles.
 *
 * Per-item game data:
 *   price      coins to buy
 *   comfort    happiness per second added to fish inside `radius` (tank pixels)
 *   anchor     'floor' snaps to the sand line, 'free' can sit anywhere
 *   emits      'bubbles' spawns a bubble column from the sprite's top edge
 */

export const ITEMS = [
  {
    id: 'seaweed',
    name: 'Seaweed',
    price: 12,
    comfort: 1.2,
    radius: 40,
    anchor: 'floor',
    rows: [
      '.ccd..........',
      'ccd...........',
      'ccd......ccd..',
      '.ccd.....ccd..',
      '.ccd....ccd...',
      '..ccd...ccd...',
      '..ccd..ccd....',
      '..ccd..ccd.ccd',
      '.ccd...ccd.ccd',
      '.ccd..ccd..ccd',
      'ccd...ccd.ccd.',
      'ccd...ccd.ccd.',
      '.ccd..ccd.ccd.',
      '.ccd...ccd.ccd',
      '..ccd..ccd.ccd',
      '..ccd..ccd.ccd',
      '..ccd..ccd.ccd',
      '.ccd...ccd.ccd',
      '.ccd...ccd..cd',
      '.ccd...ccd..cd',
      '.ccd...cccd.cd',
      '.cccd..cccd.cd',
    ],
  },
  {
    id: 'coral',
    name: 'Coral',
    price: 20,
    comfort: 1.6,
    radius: 36,
    anchor: 'floor',
    rows: [
      '.aa...........',
      '.99.......aa..',
      '.99...aa..99..',
      '.99...99..99..',
      '..99..99..99..',
      '..99..99..99..',
      '..99..99..99..',
      '...99.99.99...',
      '...99.99.99...',
      '....9999999...',
      '.....99999....',
      '.....99999....',
      '.....99999....',
      '....9999999...',
      '...999999999..',
      '..99999999999.',
    ],
  },
  {
    id: 'rock',
    name: 'Boulder',
    price: 8,
    comfort: 0.5,
    radius: 28,
    anchor: 'floor',
    rows: [
      '....ffff......',
      '..ff5fffff....',
      '.fff5ffffff...',
      'fffffffffff1..',
      'ffffffffffff1.',
      'fffffffffff11.',
      '1ffffffffff11.',
      '.11111111111..',
    ],
  },
  {
    id: 'pebbles',
    name: 'Pebbles',
    price: 5,
    comfort: 0.3,
    radius: 20,
    anchor: 'floor',
    rows: [
      '..fff...',
      '.f5ffff.',
      'ffffffff',
      'ffffff11',
      '.111111.',
    ],
  },
  {
    id: 'driftwood',
    name: 'Driftwood',
    price: 15,
    comfort: 1.0,
    radius: 32,
    anchor: 'floor',
    rows: [
      '..........7.......',
      '.........78.......',
      '.........78.......',
      '..77777777777777..',
      '.7888888888888887.',
      '.8878888878888888.',
      '..88888888888888..',
    ],
  },
  {
    id: 'bubbler',
    name: 'Bubbler chest',
    price: 40,
    comfort: 2.0,
    radius: 48,
    anchor: 'floor',
    emits: 'bubbles',
    rows: [
      '..777777..',
      '.78888887.',
      '7888888887',
      '7666666667',
      '7888888887',
      '7888668887',
      '7888888887',
      '7888888887',
      '.11111111.',
    ],
  },
  {
    id: 'castle',
    name: 'Castle',
    price: 60,
    comfort: 2.8,
    radius: 56,
    anchor: 'floor',
    rows: [
      '..8..............8..',
      '..899............899',
      '..89.............89.',
      '..8..............8..',
      'f.f.f..........f.f.f',
      'fffff..........fffff',
      'f00f1..........f00f1',
      'f00f1..........f00f1',
      'ffff1..........ffff1',
      'ffff1f.f.f.f.f.ffff1',
      'ffff1ffffffffffffff1',
      'ffff1ff00ff00ffffff1',
      'ffff1ff00ff00ffffff1',
      'ffff1ffffffffffffff1',
      'ffff1ffff00fffffff1f',
      'ffff1ffff00fffffff1f',
      'ffff1ffff00fffffff1f',
      'ffff1ffff00fffffff1f',
      'ffff1ffff00fffffff1f',
      '11111111111111111111',
    ],
  },
];

export const ITEMS_BY_ID = Object.fromEntries(ITEMS.map((i) => [i.id, i]));

/**
 * Backgrounds are not images — they're 8-stop depth ramps of palette indices.
 * The renderer dithers between neighbouring stops, which is what makes the
 * water read as 8-bit instead of as a CSS gradient.
 */
export const BACKGROUNDS = [
  {
    id: 'open',
    name: 'Open water',
    price: 0,
    ramp: [3, 3, 2, 2, 2, 1, 1, 1],
    sand: 6,
    sandShade: 7,
  },
  {
    id: 'reef',
    name: 'Reef wall',
    price: 35,
    ramp: [4, 3, 3, 2, 2, 2, 1, 1],
    sand: 6,
    sandShade: 10,
  },
  {
    id: 'trench',
    name: 'Deep trench',
    price: 60,
    ramp: [2, 2, 1, 1, 1, 0, 0, 0],
    sand: 15,
    sandShade: 1,
  },
];

export const BACKGROUNDS_BY_ID = Object.fromEntries(BACKGROUNDS.map((b) => [b.id, b]));
