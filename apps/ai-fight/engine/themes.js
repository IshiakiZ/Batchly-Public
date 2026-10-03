'use strict';
// Arenas rotate every round. Each has its own look AND its own obstacle layout
// (pillars / rocks / trees that block movement, projectiles, beams and dashes).
// Layouts are mirror-symmetric (left/right) so neither starting side has an advantage,
// and both starting spots (±260, 0) are kept clear.
// Round 1 is always the Stone Colosseum; rounds 2–9 cycle through the other regular
// arenas (a different stretch every match); rounds 10–12 are the godly arenas.

const THEMES = [
  {
    id: 'colosseum', name: 'Stone Colosseum', blurb: 'Four stone pillars around the centre.',
    obstacles: [{ x: -170, y: -150, r: 30 }, { x: 170, y: -150, r: 30 }, { x: -170, y: 150, r: 30 }, { x: 170, y: 150, r: 30 }],
  },
  {
    id: 'lava', name: 'Lava Forge', blurb: 'A basalt rock blocks the centre line; two more north and south.',
    obstacles: [{ x: 0, y: 0, r: 34 }, { x: 0, y: -215, r: 42 }, { x: 0, y: 215, r: 42 }],
  },
  {
    id: 'frost', name: 'Frost Lake', blurb: 'Ice crystals in front of both corners, two more far out.',
    obstacles: [{ x: -125, y: 0, r: 30 }, { x: 125, y: 0, r: 30 }, { x: 0, y: -260, r: 28 }, { x: 0, y: 260, r: 28 }],
  },
  {
    id: 'neon', name: 'Neon Grid', blurb: 'Six thin pylons in a hexagon.',
    obstacles: [{ x: -140, y: -120, r: 20 }, { x: 140, y: -120, r: 20 }, { x: -140, y: 120, r: 20 }, { x: 140, y: 120, r: 20 }, { x: 0, y: -210, r: 20 }, { x: 0, y: 210, r: 20 }],
  },
  {
    id: 'forest', name: 'Forest Glade', blurb: 'A big old tree in the middle and four around it.',
    obstacles: [{ x: 0, y: 0, r: 40 }, { x: -210, y: -170, r: 32 }, { x: 210, y: -170, r: 32 }, { x: -210, y: 170, r: 32 }, { x: 210, y: 170, r: 32 }],
  },
  {
    id: 'desert', name: 'Desert Ruins', blurb: 'Broken columns near both corners and two in the middle lane.',
    obstacles: [{ x: -190, y: -115, r: 30 }, { x: 190, y: -115, r: 30 }, { x: -190, y: 115, r: 30 }, { x: 190, y: 115, r: 30 }, { x: 0, y: -90, r: 26 }, { x: 0, y: 90, r: 26 }],
  },
  {
    id: 'swamp', name: 'Witchwood Swamp', blurb: 'Two thickets of twisted trees, north and south; the middle is open bog.',
    obstacles: [
      { x: -70, y: -160, r: 26 }, { x: 70, y: -160, r: 26 }, { x: 0, y: -250, r: 22 },
      { x: -70, y: 160, r: 26 }, { x: 70, y: 160, r: 26 }, { x: 0, y: 250, r: 22 },
    ],
  },
  {
    id: 'sky', name: 'Sky Temple', blurb: 'Marble columns flank both starting spots; the middle of the platform is wide open.',
    obstacles: [{ x: -210, y: -105, r: 22 }, { x: 210, y: -105, r: 22 }, { x: -210, y: 105, r: 22 }, { x: 210, y: 105, r: 22 }],
  },
  {
    id: 'graveyard', name: 'Haunted Graveyard', blurb: 'A crypt blocks the north; four tombstones give low cover in the south.',
    obstacles: [
      { x: 0, y: -170, r: 44 },
      { x: -150, y: 60, r: 20 }, { x: 150, y: 60, r: 20 }, { x: -70, y: 190, r: 20 }, { x: 70, y: 190, r: 20 },
    ],
  },
  {
    id: 'dojo', name: 'Sakura Dojo', blurb: 'Cherry trees north and south; four stone lanterns around the open centre.',
    obstacles: [
      { x: 0, y: -190, r: 34 }, { x: 0, y: 190, r: 34 },
      { x: -120, y: -80, r: 20 }, { x: 120, y: -80, r: 20 }, { x: -120, y: 80, r: 20 }, { x: 120, y: 80, r: 20 },
    ],
  },
  {
    id: 'ship', name: 'Pirate Deck', blurb: 'Two masts on the centre line (the lane between them is open); barrels by the rails.',
    obstacles: [
      { x: 0, y: -120, r: 30 }, { x: 0, y: 120, r: 30 },
      { x: -160, y: -230, r: 20 }, { x: 160, y: -230, r: 20 }, { x: -160, y: 230, r: 20 }, { x: 160, y: 230, r: 20 },
    ],
  },
  {
    id: 'jungle', name: 'Jungle Temple', blurb: 'A row of stone idols splits the arena down the middle, with gaps to slip through.',
    obstacles: [{ x: 0, y: -200, r: 24 }, { x: 0, y: -70, r: 24 }, { x: 0, y: 70, r: 24 }, { x: 0, y: 200, r: 24 }],
  },
  {
    id: 'crystal', name: 'Crystal Cavern', blurb: 'Five glowing crystal clusters ring the cavern floor.',
    obstacles: [
      { x: 0, y: -170, r: 28 }, { x: -162, y: -53, r: 28 }, { x: 162, y: -53, r: 28 }, { x: -100, y: 138, r: 28 }, { x: 100, y: 138, r: 28 },
    ],
  },
  {
    id: 'rooftop', name: 'Rain Rooftop', blurb: 'Two rows of AC units make a corridor through the middle.',
    obstacles: [
      { x: -160, y: -130, r: 24 }, { x: 0, y: -130, r: 24 }, { x: 160, y: -130, r: 24 },
      { x: -160, y: 130, r: 24 }, { x: 0, y: 130, r: 24 }, { x: 160, y: 130, r: 24 },
    ],
  },
  {
    id: 'beach', name: 'Sunset Beach', blurb: 'Just two palm trees, far north and south: the most open arena.',
    obstacles: [{ x: 0, y: -210, r: 26 }, { x: 0, y: 210, r: 26 }],
  },
  {
    id: 'castle', name: 'Castle Courtyard', blurb: 'A big fountain blocks the centre; four knight statues stand north and south.',
    obstacles: [
      { x: 0, y: 0, r: 46 },
      { x: -150, y: -210, r: 22 }, { x: 150, y: -210, r: 22 }, { x: -150, y: 210, r: 22 }, { x: 150, y: 210, r: 22 },
    ],
  },
  {
    id: 'factory', name: 'Clockwork Factory', blurb: 'Four steam machines in a tight diamond around the centre.',
    obstacles: [{ x: 0, y: -110, r: 28 }, { x: -110, y: 0, r: 28 }, { x: 110, y: 0, r: 28 }, { x: 0, y: 110, r: 28 }],
  },
  {
    id: 'candy', name: 'Candy Kingdom', blurb: 'Eight giant lollipops ring the centre like a candy clock.',
    obstacles: [
      { x: 185, y: 77, r: 20 }, { x: 77, y: 185, r: 20 }, { x: -77, y: 185, r: 20 }, { x: -185, y: 77, r: 20 },
      { x: -185, y: -77, r: 20 }, { x: -77, y: -185, r: 20 }, { x: 77, y: -185, r: 20 }, { x: 185, y: -77, r: 20 },
    ],
  },
  {
    id: 'celestial', name: 'Celestial Throne', blurb: 'The arena of the gods (level 10): a ring of divine pillars around a starlit void.',
    godly: true, level: 10,
    obstacles: [
      { x: -210, y: 0, r: 26 }, { x: 210, y: 0, r: 26 },
      { x: -105, y: -182, r: 24 }, { x: 105, y: -182, r: 24 }, { x: -105, y: 182, r: 24 }, { x: 105, y: 182, r: 24 },
    ],
  },
  {
    id: 'olympus', name: 'Mount Olympus', blurb: 'The gods\' mountaintop (level 11): two golden colonnades, north and south, above the clouds.',
    godly: true, level: 11,
    obstacles: [
      { x: -150, y: -190, r: 24 }, { x: 0, y: -215, r: 24 }, { x: 150, y: -190, r: 24 },
      { x: -150, y: 190, r: 24 }, { x: 0, y: 215, r: 24 }, { x: 150, y: 190, r: 24 },
    ],
  },
  {
    id: 'abyss', name: 'The Abyss', blurb: 'The final arena (level 12): three tentacles coil around the centre, two more lurk in the north.',
    godly: true, level: 12,
    obstacles: [
      { x: 0, y: -115, r: 30 }, { x: -100, y: 58, r: 30 }, { x: 100, y: 58, r: 30 },
      { x: -210, y: -180, r: 22 }, { x: 210, y: -180, r: 22 },
    ],
  },
];

// Rounds 2–9 cycle through these (every regular arena except the colosseum), in this fixed order;
// each match starts 8 further along, so consecutive matches see different arenas.
const ROTATION_ORDER = ['lava', 'swamp', 'sky', 'frost', 'graveyard', 'dojo', 'neon', 'ship',
  'jungle', 'crystal', 'desert', 'rooftop', 'beach', 'forest', 'castle', 'factory', 'candy'];
const ROTATION = ROTATION_ORDER.map(id => THEMES.find(t => t.id === id));
const GODLY = THEMES.filter(t => t.godly).sort((a, b) => a.level - b.level);   // celestial, olympus, abyss
const GODLY_FROM_ROUND = 10;

/** The godly arena of a level (10 celestial, 11 olympus, 12+ abyss); null below level 10. */
function godlyThemeForLevel(level) {
  const l = Math.floor(Number(level) || 0);
  if (l < GODLY_FROM_ROUND) return null;
  return GODLY.find(t => t.level === l) || GODLY[GODLY.length - 1];
}

/**
 * The arena of a round. Round 1 = colosseum; rounds 2–9 = ROTATION[((match - 1) * 8 + (round - 2)) % 17];
 * rounds 10/11/12 = celestial/olympus/abyss. Deterministic; matchNumber defaults to 1.
 */
function themeForRound(round, matchNumber = 1) {
  const r = Math.max(1, Math.floor(Number(round)) || 1);
  if (r >= GODLY_FROM_ROUND) return godlyThemeForLevel(r);
  if (r === 1) return THEMES[0];
  const m = Math.max(1, Math.floor(Number(matchNumber)) || 1);
  return ROTATION[((m - 1) * 8 + (r - 2)) % ROTATION.length];
}

function themeById(id) {
  return THEMES.find(t => t.id === id) || THEMES[0];
}

/** Public theme info (without the obstacle list) for state.json / the UI. */
function themeInfo(t) { return { id: t.id, name: t.name, blurb: t.blurb }; }

/**
 * Obstacles of a theme at a level: layouts are designed for the level-1 arena (radius 520) and
 * spread out as the arena grows (positions scale with the radius, sizes grow half as fast).
 */
function obstaclesFor(themeOrId, level = 1) {
  const t = typeof themeOrId === 'string' ? themeById(themeOrId) : themeOrId && themeOrId.id ? themeById(themeOrId.id) : null;
  if (!t) return [];
  const { arenaFor } = require('./rules');
  const k = arenaFor(level).scale;
  const kr = 1 + (k - 1) * 0.5;
  return t.obstacles.map(o => ({ x: Math.round(o.x * k), y: Math.round(o.y * k), r: Math.round(o.r * kr) }));
}

module.exports = { THEMES, ROTATION, themeForRound, godlyThemeForLevel, themeById, themeInfo, obstaclesFor };
