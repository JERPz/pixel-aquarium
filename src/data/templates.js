/**
 * Starter fish, so a player who can't draw still gets something they're happy
 * to keep. Each row is 16 characters: '0'-'f' index into REEF-16, '.' is
 * transparent. Every fish faces RIGHT — the renderer mirrors for leftward
 * travel and applies the tail wave from the left edge inward.
 *
 * Templates only use colours the player owns from the start, so a template can
 * always be edited without hitting a locked swatch.
 */

export const TEMPLATES = [
  {
    id: 'goldfish',
    name: 'Goldfish',
    suggested: 'Bubbles',
    rows: [
      '................',
      '................',
      '.......999......',
      '......9aaa9.....',
      '9....aa66aa.....',
      '99..aa66aaaaa...',
      '999.a66aaaaaaa..',
      '9999aaaaaaa50aa.',
      '9999aaaaaaaaaa9.',
      '999.aaaaaaaaaa..',
      '99..aaaaaaaaa...',
      '9...aaaaaaaaa...',
      '.....9999999....',
      '......999.......',
      '................',
      '................',
    ],
  },
  {
    id: 'angelfish',
    name: 'Angelfish',
    suggested: 'Halo',
    rows: [
      '........66......',
      '.......6666.....',
      '.......6556.....',
      '.......1555.....',
      '......515551....',
      '......515551....',
      '..66655155515...',
      '.6666551555505..',
      '.6666551555155..',
      '.6666551555155..',
      '..66655155515...',
      '......515551....',
      '......51555.....',
      '.......6556.....',
      '.......6666.....',
      '........66......',
    ],
  },
  {
    id: 'puffer',
    name: 'Pufferfish',
    suggested: 'Spike',
    rows: [
      '................',
      '................',
      '......d.d.d.....',
      '......ccccc.....',
      '.....ccccccc....',
      '....ccccccccc...',
      '...cccdccdcccc..',
      '.ddcccccccc50cd.',
      '.ddcccccccccccd.',
      '...cc5555ccccc..',
      '....c55555ccc...',
      '.....c555ccc....',
      '......ccccc.....',
      '......d.d.d.....',
      '................',
      '................',
    ],
  },
  {
    id: 'clownfish',
    name: 'Clownfish',
    suggested: 'Pip',
    rows: [
      '................',
      '................',
      '......aaaa......',
      '.....aaaaaa.....',
      '9....55aaa5.....',
      '99..a55aaa55....',
      '999aa55aaa55aa..',
      '999aa55aaa55a0a.',
      '999aa55aaa55aa9.',
      '999aa55aaa55aa..',
      '99.aa55aaa55a...',
      '9...a55aaa55....',
      '.....55aaa5.....',
      '......999.......',
      '................',
      '................',
    ],
  },
];

export const BLANK_ROWS = Array.from({ length: 16 }, () => '.'.repeat(16));

/** Fallback names offered when the player leaves the name field empty. */
export const NAME_POOL = [
  'Bubbles', 'Finn', 'Nugget', 'Mango', 'Pebble', 'Sushi', 'Waffle',
  'Comet', 'Peach', 'Noodle', 'Biscuit', 'Marbles', 'Tofu', 'Gizmo',
];
