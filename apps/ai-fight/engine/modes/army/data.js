'use strict';
// Army Battle — every number of the mode lives here: unit catalogue, upgrades, formations,
// level budgets, battlefields. The simulation (sim.js), the checker, the CLI catalogues and
// the guide all read from this one table.

const FIELD = { width: 1600, height: 900, minX: -800, maxX: 800, minY: -450, maxY: 450 };
// Deployment zone in YOUR coordinates (every army sees itself on the left, attacking toward +x).
const DEPLOY = { minX: -770, maxX: -140, minY: -420, maxY: 420 };
const BATTLE_TIME = 180;       // seconds of simulated time
const TICK = 0.1;              // simulation step (10 Hz)
const THINK_EVERY = 5;         // commander runs every 5 ticks = twice per second
const RECORD_EVERY = 2;        // replay frames at 5 Hz

// ── levels ──────────────────────────────────────────────────────────────────
const BUDGET = [0, 450, 560, 660, 780, 900, 1020, 1150, 1300, 1460, 1700, 1900, 2100];
const MAX_SQUADS = [0, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 12];
const MAX_LEVEL = 12;
function budgetFor(level) { return BUDGET[clampLevel(level)]; }
function maxSquadsFor(level) { return MAX_SQUADS[clampLevel(level)]; }
function clampLevel(level) { return Math.max(1, Math.min(MAX_LEVEL, Math.floor(Number(level) || 1))); }

// ── unit classes (for the counter table) ────────────────────────────────────
// foot, spear, heavy, ranged, magic, siege, cav, beast, flyer, legend, hero
const BONUS = {
  foot:   { spear: 1.4, ranged: 1.3, siege: 1.6, magic: 1.3 },
  spear:  { cav: 2.6, beast: 1.7, flyer: 1.6, hero: 1.6, legend: 1.3 },
  heavy:  { foot: 1.25, spear: 1.35, ranged: 1.2 },
  ranged: { flyer: 1.7, legend: 1.2, magic: 1.2 },
  magic:  { heavy: 1.4, beast: 1.5, legend: 1.4, spear: 1.2 },
  siege:  { heavy: 1.6, beast: 1.6, legend: 1.5, spear: 1.2, foot: 1.1, flyer: 0.15, cav: 0.7 },
  cav:    { ranged: 2.1, magic: 2.1, siege: 2.4, foot: 1.1, spear: 0.55 },
  beast:  { foot: 1.6, spear: 1.3, heavy: 1.4, ranged: 1.4 },
  flyer:  { ranged: 1.9, magic: 1.9, siege: 2.4 },
  legend: { foot: 1.3, spear: 1.3, heavy: 1.2, cav: 1.2, ranged: 1.3 },
  hero:   { },
};
function bonus(atkClass, defClass) {
  const row = BONUS[atkClass];
  return (row && row[defClass]) || 1;
}

// ── unit catalogue ──────────────────────────────────────────────────────────
// size = soldiers per squad; hp per soldier; armor = fraction of physical damage ignored;
// melee = damage per second per fighting soldier; charge = impact damage per soldier;
// speed = world units per second; morale = starting morale (0-100); spacing = formation gap.
const UNITS = {
  infantry: {
    name: 'Infantry', level: 1, cost: 60, cls: 'foot', size: 20, hp: 10, armor: 0.2, melee: 1.0, charge: 2.5,
    speed: 40, morale: 62, spacing: 13, form: 'line',
    role: 'Sword-and-shield line troops. Cheap, sturdy, the backbone of any army.',
    strong: 'spearmen, archers, mages, siege', weak: 'cavalry charges on the flank, war beasts, heavy infantry',
  },
  archers: {
    name: 'Archers', level: 1, cost: 70, cls: 'ranged', size: 16, hp: 7, armor: 0.05, melee: 0.45, charge: 0,
    speed: 42, morale: 48, spacing: 13, form: 'line',
    ranged: { kind: 'arrow', range: 340, min: 40, reload: 2.8, dmg: 4.0, speed: 320, spread: 34 },
    role: 'Volleys of arrows (range 340). Must stand still to shoot. Fragile in melee.',
    strong: 'infantry, spearmen, flyers, anything slow at range', weak: 'cavalry, shield walls (front), loose formations, woods',
  },
  spearmen: {
    name: 'Spearmen', level: 2, cost: 62, cls: 'spear', size: 20, hp: 10, armor: 0.2, melee: 0.85, charge: 1.5,
    speed: 38, morale: 64, spacing: 12, form: 'line', brace: true,
    role: 'Pike wall. When standing still they BRACE: a frontal charge breaks on them and the chargers are impaled.',
    strong: 'cavalry, knights, war beasts, flyers, the general', weak: 'infantry, archers, mages, flank attacks',
  },
  shieldwall: {
    name: 'Shield Guard', level: 3, cost: 95, cls: 'heavy', size: 18, hp: 14, armor: 0.45, melee: 0.9, charge: 2,
    speed: 32, morale: 74, spacing: 13, form: 'line', shield: 0.3,
    role: 'Heavy infantry with tower shields: arrows from the front do only 30%. Slow; holds a line.',
    strong: 'infantry, spearmen, archers', weak: 'mages, catapults, war beasts, flanking cavalry',
  },
  cavalry: {
    name: 'Cavalry', level: 4, cost: 100, cls: 'cav', size: 12, hp: 15, armor: 0.2, melee: 1.35, charge: 9,
    speed: 95, morale: 62, spacing: 18, form: 'wedge', mounted: true,
    role: 'Fast riders with a devastating charge (impact on contact after a run-up). Best into flanks, rears, archers and siege.',
    strong: 'archers, mages, clerics, catapults, flanks and rears', weak: 'braced spearmen (never charge them from the front), long melee grinds',
  },
  mages: {
    name: 'Battle Mages', level: 5, cost: 110, cls: 'magic', size: 8, hp: 7, armor: 0, melee: 0.3, charge: 0,
    speed: 38, morale: 52, spacing: 14, form: 'loose',
    spell: { name: 'fireball', range: 380, radius: 62, dmg: 4.6, cd: 7.5, flight: 1.0, kind: 'fire' },
    role: 'Hurl fireballs (range 380, blast radius 62) that ignore armor and hit EVERY squad in the blast - friends too.',
    strong: 'dense formations, shield walls, war beasts, legendary units', weak: 'cavalry, flyers, archers; loose formations',
  },
  clerics: {
    name: 'Clerics', level: 6, cost: 90, cls: 'magic', size: 8, hp: 8, armor: 0.1, melee: 0.3, charge: 0,
    speed: 40, morale: 62, spacing: 14, form: 'loose',
    heal: { radius: 170, hps: 7 }, aura: 1.5,
    role: 'Heal nearby squads (7 hp/s shared, radius 170) - healed soldiers get back up - and steady their morale.',
    strong: 'long grinding fights', weak: 'everything that reaches them: cavalry, flyers, archers',
  },
  catapult: {
    name: 'Catapults', level: 7, cost: 125, cls: 'siege', size: 3, hp: 16, armor: 0.1, melee: 0.3, charge: 0,
    speed: 22, morale: 55, spacing: 24, form: 'loose',
    siege: { kind: 'stone', range: 820, min: 160, reload: 9, radius: 58, dmg: 13, speed: 330 },
    role: 'Very long range (820) boulders with a slow flight: they land where the target WAS. Hit everything in the blast, friends too.',
    strong: 'slow or standing blocks: shield walls, spearmen, war beasts, titans', weak: 'cavalry, flyers (almost immune), anything that moves',
  },
  knights: {
    name: 'Knights', level: 8, cost: 170, cls: 'cav', size: 10, hp: 24, armor: 0.5, melee: 2.1, charge: 17,
    speed: 82, morale: 90, spacing: 19, form: 'wedge', mounted: true, elite: true,
    role: 'Elite heavy cavalry. The strongest charge in the game and tough enough to stay in the melee afterwards.',
    strong: 'everything on foot that is not a braced spear wall', weak: 'braced spearmen, mages, war beasts',
  },
  beasts: {
    name: 'War Trolls', level: 9, cost: 185, cls: 'beast', size: 4, hp: 90, armor: 0.25, melee: 5.5, charge: 22,
    speed: 46, morale: 82, spacing: 28, form: 'loose', regen: 1.2, fear: true, cleave: true, elite: true,
    role: 'Four huge trolls. Their blows hit every enemy squad they touch, they regenerate and they terrify nearby enemies.',
    strong: 'infantry, shield walls, archers, morale', weak: 'spearmen, mages (fire), catapults',
  },
  griffins: {
    name: 'Griffin Riders', level: 9, cost: 165, cls: 'flyer', size: 6, hp: 32, armor: 0.25, melee: 3.0, charge: 12,
    speed: 115, morale: 76, spacing: 24, form: 'loose', fly: true, elite: true,
    role: 'Flyers: ignore rocks, woods and rivers and fly over other squads. Hunt archers, mages and siege.',
    strong: 'archers, mages, clerics, catapults', weak: 'archers in numbers, spearmen, a long melee',
  },
  dragon: {
    name: 'Dragon', level: 10, cost: 420, cls: 'legend', size: 1, hp: 1500, armor: 0.35, melee: 18, charge: 60,
    speed: 92, morale: 100, spacing: 40, form: 'line', fly: true, fear: true, fearless: true, legendary: true, cleave: true,
    breath: { range: 170, radius: 72, dmg: 9, cd: 5, kind: 'fire' },
    role: 'LEGENDARY. Flies, breathes fire (every 5 s, radius 72, hits friends too), terrifies. One legendary per army.',
    strong: 'dense infantry, archers, anything on the ground', weak: 'massed archers, mages, spearmen',
  },
  titan: {
    name: 'Titan', level: 11, cost: 460, cls: 'legend', size: 1, hp: 2400, armor: 0.4, melee: 28, charge: 80,
    speed: 34, morale: 100, spacing: 44, form: 'line', fear: true, fearless: true, legendary: true, cleave: true,
    stomp: { radius: 110, dmg: 8, cd: 9, kind: 'crush' },
    role: 'LEGENDARY. A walking mountain: sweeping blows hit every squad in reach, a stomp shakes all enemies around it.',
    strong: 'everything in melee', weak: 'mages, catapults, being kited by archers',
  },
  archangels: {
    name: 'Archangels', level: 12, cost: 440, cls: 'legend', size: 3, hp: 320, armor: 0.3, melee: 6, charge: 20,
    speed: 96, morale: 100, spacing: 26, form: 'loose', fly: true, fearless: true, legendary: true,
    ranged: { kind: 'holy', range: 300, min: 0, reload: 2.5, dmg: 20, speed: 420, spread: 30 },
    heal: { radius: 190, hps: 12 }, aura: 2,
    role: 'LEGENDARY. Three flying angels: holy bolts that ignore armor (x2 vs beasts and legends), heal and inspire friends nearby.',
    strong: 'war beasts, legendary units, keeping an army alive', weak: 'massed archers, cavalry that catches them',
  },
};
const HOLY_BONUS = { beast: 2, legend: 2 };

// The general: every army has exactly one (free). If it dies, the army loses the battle.
const GENERAL = {
  name: 'General', cls: 'hero', size: 1, hp: 1000, armor: 0.45, melee: 9, charge: 30, speed: 75, morale: 100,
  spacing: 16, form: 'line', mounted: true, fearless: true, regen: 3,
  aura: { radius: 220, regen: 2, resist: 0.75 },
  role: 'Your commander on horseback. Morale aura (radius 220). Powers: rally, and divine powers at levels 10-12. If the general dies you LOSE.',
};

const POWERS = {
  rally:  { level: 1, cd: 40, radius: 300, text: 'Friendly squads within 300 of the general: +30 morale; routing squads there turn and fight again.' },
  meteor: { level: 10, cd: 50, range: 900, radius: 95, dmg: 16, delay: 1.8, text: 'A meteor strikes a point within 900 of the general after 1.8 s: radius 95, 16 damage per soldier caught (ignores armor) - friends too.' },
  aegis:  { level: 11, cd: 60, radius: 320, time: 10, text: 'Friendly squads within 320 of the general take half damage for 10 s.' },
  wrath:  { level: 12, cd: 60, range: 600, bolts: 6, radius: 45, dmg: 12, text: 'Six lightning bolts over 3 s on the biggest visible enemy squads within 600 of the general (radius 45, 12 per soldier, ignores armor).' },
};

const UPGRADES = {
  veteran: { level: 2, costPct: 30, text: '+25% damage (melee, charge, missiles, spells), +10 morale' },
  armored: { level: 3, costPct: 25, text: '+0.12 armor (max 0.7), -8% speed' },
  banner:  { level: 5, costPct: 20, text: '+8 morale; this squad and friendly squads within 160 lose 15% less morale' },
};

const FORMATIONS = {
  line:  { text: 'Wide front: the most soldiers fight. The default.', front: 0.8, atk: 1, speed: 1, spread: 1 },
  wedge: { text: 'Charge impact x1.4, +10% attack, +5% speed; fewer soldiers fight after the impact.', front: 0.6, atk: 1.1, speed: 1.05, spread: 1, chargeMult: 1.4 },
  square:{ text: 'No flank or rear bonus against it, charges against it do 40%; 40% slower, -10% attack.', front: 0.55, atk: 0.9, speed: 0.6, spread: 0.92, allRound: true, chargeTaken: 0.4 },
  loose: { text: 'Spread out: takes 45% less from arrows, spells and siege, but +20% from melee and charges; -20% attack, +10% speed.', front: 0.55, atk: 0.8, speed: 1.1, spread: 1.5, missileTaken: 0.55, meleeTaken: 1.2 },
};

const EMBLEMS = ['lion', 'eagle', 'wolf', 'dragon', 'tower', 'sun', 'moon', 'star', 'skull', 'crown', 'sword', 'tree', 'rose', 'bear', 'serpent', 'stag', 'hammer', 'flame', 'wave', 'raven'];

// ── battlefields (mirror-symmetric: x -> -x maps the field onto itself) ─────────────
const MAPS = [
  {
    id: 'greenvale', name: 'Greenvale Fields', palette: 'meadow',
    blurb: 'Open meadows. Two woods on the northern flanks, a rocky knoll north of centre, a copse in the south.',
    rocks: [{ x: 0, y: -300, r: 58 }, { x: -600, y: 340, r: 40 }, { x: 600, y: 340, r: 40 }],
    woods: [{ x: -330, y: -250, r: 88 }, { x: 330, y: -250, r: 88 }, { x: 0, y: 290, r: 96 }],
    river: null,
  },
  {
    id: 'silverford', name: 'Silverford', palette: 'river',
    blurb: 'A river runs north-south through the centre. Three fords (north, centre, south) are the only fast crossings.',
    rocks: [{ x: -170, y: -140, r: 40 }, { x: 170, y: -140, r: 40 }, { x: -170, y: 160, r: 36 }, { x: 170, y: 160, r: 36 }],
    woods: [{ x: -440, y: -300, r: 82 }, { x: 440, y: -300, r: 82 }, { x: -440, y: 300, r: 82 }, { x: 440, y: 300, r: 82 }],
    river: { x0: -40, x1: 40, fords: [{ y0: -345, y1: -235 }, { y0: -55, y1: 55 }, { y0: 235, y1: 345 }] },
  },
  {
    id: 'cragpass', name: 'Crag Pass', palette: 'highland',
    blurb: 'Two great crags squeeze the centre into a pass; open lanes run along the north and south edges.',
    rocks: [{ x: 0, y: -225, r: 95 }, { x: 0, y: 235, r: 98 }, { x: -420, y: -380, r: 38 }, { x: 420, y: -380, r: 38 }],
    woods: [{ x: -460, y: 20, r: 74 }, { x: 460, y: 20, r: 74 }, { x: -250, y: 330, r: 60 }, { x: 250, y: 330, r: 60 }],
    river: null,
  },
  {
    id: 'twingroves', name: 'Twin Groves', palette: 'autumn',
    blurb: 'Autumn woods crowd the middle on both sides of an open centre lane - perfect for ambushes.',
    rocks: [{ x: 0, y: -390, r: 44 }, { x: 0, y: 390, r: 44 }, { x: -620, y: 0, r: 34 }, { x: 620, y: 0, r: 34 }],
    woods: [{ x: -230, y: -170, r: 105 }, { x: 230, y: -170, r: 105 }, { x: -230, y: 195, r: 95 }, { x: 230, y: 195, r: 95 }],
    river: null,
  },
  {
    id: 'heaven', name: "Heaven's Anvil", palette: 'celestial', godly: true,
    blurb: 'The battlefield of the gods (levels 10-12): crystal spires north and south, holy groves on the flanks.',
    rocks: [{ x: 0, y: -250, r: 62 }, { x: 0, y: 255, r: 62 }],
    woods: [{ x: -390, y: 0, r: 84 }, { x: 390, y: 0, r: 84 }, { x: -560, y: -330, r: 60 }, { x: 560, y: -330, r: 60 }],
    river: null,
  },
];
function mapForRound(round) {
  const r = Math.max(1, Math.floor(Number(round) || 1));
  if (r >= 10) return MAPS[4];
  return MAPS[(r - 1) % 4];
}
function mapById(id) { return MAPS.find(m => m.id === id) || null; }

function unitsAt(level) {
  const L = clampLevel(level);
  return Object.keys(UNITS).filter(k => UNITS[k].level <= L);
}
function upgradesAt(level) {
  const L = clampLevel(level);
  return Object.keys(UPGRADES).filter(k => UPGRADES[k].level <= L);
}
function powersAt(level) {
  const L = clampLevel(level);
  return Object.keys(POWERS).filter(k => POWERS[k].level <= L);
}
function squadCost(type, upgrades) {
  const u = UNITS[type];
  if (!u) return 0;
  let c = u.cost;
  for (const up of upgrades || []) if (UPGRADES[up]) c += Math.round(u.cost * UPGRADES[up].costPct / 100);
  return c;
}

module.exports = {
  FIELD, DEPLOY, BATTLE_TIME, TICK, THINK_EVERY, RECORD_EVERY, BUDGET, MAX_SQUADS, MAX_LEVEL,
  UNITS, GENERAL, POWERS, UPGRADES, FORMATIONS, EMBLEMS, MAPS, BONUS, HOLY_BONUS,
  budgetFor, maxSquadsFor, clampLevel, bonus, mapForRound, mapById, unitsAt, upgradesAt, powersAt, squadCost,
};
