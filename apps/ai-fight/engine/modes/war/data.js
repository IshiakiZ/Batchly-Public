'use strict';
// Modern Warfare — every number of the mode lives here: unit catalogue, weapons, the damage table,
// upgrades, formations, support powers, level budgets and battlefields. The simulation (sim.js), the
// checker, the CLI catalogues and the guide all read from this one table.

const FIELD = { width: 2400, height: 1350, minX: -1200, maxX: 1200, minY: -675, maxY: 675 };
// Deployment zone in YOUR coordinates (every army sees itself on the left, attacking toward +x).
const DEPLOY = { minX: -1170, maxX: -320, minY: -640, maxY: 640 };
const BATTLE_TIME = 180;       // seconds of simulated time
const TICK = 0.1;              // simulation step (10 Hz)
const THINK_EVERY = 5;         // commander runs every 5 ticks = twice per second
const RECORD_EVERY = 2;        // replay frames at 5 Hz
const REARM_TIME = 14;         // jets: seconds on the ground to rearm after a sortie

// ── levels ──────────────────────────────────────────────────────────────────
const BUDGET = [0, 500, 650, 800, 1000, 1200, 1450, 1700, 1950, 2250, 2600, 2950, 3300];
const MAX_UNITS = [0, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 20];
const MAX_LEVEL = 12;
function clampLevel(level) { return Math.max(1, Math.min(MAX_LEVEL, Math.floor(Number(level) || 1))); }
function budgetFor(level) { return BUDGET[clampLevel(level)]; }
function maxUnitsFor(level) { return MAX_UNITS[clampLevel(level)]; }

// ── damage table: weapon kind -> target armour class ─────────────────────────
// inf = infantry, light = light vehicles, heavy = tanks, heli = helicopters & drones, jet = jets,
// ship = surface ships, sub = submarines, hq = the command post
const VS = {
  rifle:      { inf: 1.0,  light: 0.15, heavy: 0.01, heli: 0.15, jet: 0,    ship: 0.03, sub: 0,   hq: 0.05 },
  mg:         { inf: 1.25, light: 0.3,  heavy: 0.02, heli: 0.3,  jet: 0.02, ship: 0.06, sub: 0,   hq: 0.08 },
  sniper:     { inf: 1.6,  light: 0.1,  heavy: 0,    heli: 0.05, jet: 0,    ship: 0,    sub: 0,   hq: 0.05 },
  autocannon: { inf: 0.8,  light: 1.0,  heavy: 0.15, heli: 1.0,  jet: 0.5,  ship: 0.25, sub: 0,   hq: 0.3 },
  rocket:     { inf: 0.5,  light: 1.3,  heavy: 1.15, heli: 0.35, jet: 0,    ship: 0.6,  sub: 0,   hq: 1.0 },
  cannon:     { inf: 0.6,  light: 1.2,  heavy: 1.0,  heli: 0.15, jet: 0,    ship: 0.5,  sub: 0,   hq: 0.9 },
  missile:    { inf: 0.5,  light: 1.2,  heavy: 1.15, heli: 0.6,  jet: 0,    ship: 0.8,  sub: 0,   hq: 1.0 },
  shell:      { inf: 1.0,  light: 0.7,  heavy: 0.35, heli: 0,    jet: 0,    ship: 0.5,  sub: 0,   hq: 0.5 },
  bomb:       { inf: 1.0,  light: 0.9,  heavy: 0.6,  heli: 0,    jet: 0,    ship: 0.8,  sub: 0,   hq: 0.7 },
  aa:         { inf: 0,    light: 0,    heavy: 0,    heli: 1.1,  jet: 1.0,  ship: 0,    sub: 0,   hq: 0 },
  torpedo:    { inf: 0,    light: 0,    heavy: 0,    heli: 0,    jet: 0,    ship: 1.4,  sub: 1.0, hq: 0 },
};
const AREA_KINDS = { shell: true, bomb: true };
function vs(kind, cls) { const row = VS[kind]; return row ? (row[cls] || 0) : 0; }
// which domains a weapon kind can hit at all
function canHit(kind, cls) { return vs(kind, cls) > 0; }

// ── unit catalogue ──────────────────────────────────────────────────────────
// size = soldiers / vehicles in the unit; hp per soldier or vehicle; armor = fraction of damage
// ignored; speed = world units per second; morale 0-100; spacing = gap between elements.
// weapons: kind, range (min), reload s, dmg per element per shot, acc = base accuracy,
// move = accuracy multiplier while moving (0 = must stand still), radius = blast (area kinds),
// ammo = shots per sortie (jets), supp = extra suppression (morale damage) per hit.
const UNITS = {
  riflemen: {
    name: 'Riflemen', level: 1, cost: 50, cls: 'inf', domain: 'ground', size: 12, hp: 10, armor: 0, speed: 32, morale: 58, spacing: 11,
    weapons: [{ name: 'rifles', kind: 'rifle', range: 270, reload: 1.2, dmg: 1.1, acc: 0.42, move: 0.6 }],
    role: 'Line infantry with assault rifles. Cheap, flexible, hard to root out of towns and woods.',
    strong: 'infantry in the open, holding towns', weak: 'machine guns, artillery, tanks',
  },
  machinegun: {
    name: 'Machine Gunners', level: 1, cost: 65, cls: 'inf', domain: 'ground', size: 6, hp: 10, armor: 0, speed: 26, morale: 62, spacing: 12,
    weapons: [{ name: 'machine guns', kind: 'mg', range: 340, reload: 0.5, dmg: 1.0, acc: 0.34, move: 0.2, supp: 1.4 }],
    role: 'Heavy machine guns: a wall of fire that shreds and pins down infantry. Nearly useless on the move.',
    strong: 'infantry (and it suppresses them)', weak: 'vehicles, artillery, snipers',
  },
  rockets: {
    name: 'Rocket Team', level: 2, cost: 70, cls: 'inf', domain: 'ground', size: 6, hp: 10, armor: 0, speed: 28, morale: 60, spacing: 12,
    weapons: [
      { name: 'anti-tank rockets', kind: 'rocket', range: 300, reload: 5, dmg: 16, acc: 0.5, move: 0.3, speed: 420 },
      { name: 'carbines', kind: 'rifle', range: 220, reload: 1.4, dmg: 0.8, acc: 0.38, move: 0.6 },
    ],
    role: 'Anti-tank infantry with rocket launchers. The cheap answer to armour, deadly from towns and woods.',
    strong: 'tanks, APCs, jeeps, the command post', weak: 'infantry, machine guns, artillery',
  },
  jeep: {
    name: 'Recon Jeeps', level: 2, cost: 70, cls: 'light', domain: 'ground', size: 3, hp: 55, armor: 0.1, speed: 130, morale: 60, spacing: 22, spotter: 380,
    weapons: [{ name: 'mounted MGs', kind: 'mg', range: 300, reload: 0.5, dmg: 0.8, acc: 0.3, move: 0.6, supp: 0.8 }],
    role: 'Fast scouts with mounted machine guns. Spot snipers, submarines and units in smoke or cover (range 380).',
    strong: 'infantry in the open, snipers, artillery crews', weak: 'rockets, tanks, anything armoured',
  },
  apc: {
    name: 'APCs', level: 3, cost: 110, cls: 'light', domain: 'ground', size: 3, hp: 130, armor: 0.25, speed: 85, morale: 70, spacing: 24,
    weapons: [{ name: 'autocannons', kind: 'autocannon', range: 360, reload: 1.0, dmg: 3.2, acc: 0.4, move: 0.8 }],
    role: 'Armoured personnel carriers with autocannons: quick, tough against small arms, good at everything light.',
    strong: 'infantry, jeeps, helicopters', weak: 'rockets, tanks',
  },
  snipers: {
    name: 'Snipers', level: 3, cost: 85, cls: 'inf', domain: 'ground', size: 3, hp: 10, armor: 0, speed: 30, morale: 64, spacing: 16, stealth: true,
    weapons: [{ name: 'sniper rifles', kind: 'sniper', range: 580, reload: 3.5, dmg: 10, acc: 0.75, move: 0, supp: 2 }],
    role: 'Hidden marksmen (range 580). Invisible until an enemy comes within 150 or they fire; each hit kills a soldier.',
    strong: 'infantry, machine gunners, rocket teams, artillery crews', weak: 'recon jeeps, drones, anything that finds them',
  },
  tank: {
    name: 'Tanks', level: 4, cost: 180, cls: 'heavy', domain: 'ground', size: 3, hp: 330, armor: 0.35, speed: 58, morale: 82, spacing: 26,
    weapons: [
      { name: 'main guns', kind: 'cannon', range: 470, reload: 4, dmg: 40, acc: 0.55, move: 0.75, speed: 900 },
      { name: 'coaxial MGs', kind: 'mg', range: 280, reload: 0.6, dmg: 0.8, acc: 0.3, move: 0.7, supp: 0.6 },
    ],
    role: 'Main battle tanks: heavy armour and a big gun. The fist of any army - but rockets and missiles kill them.',
    strong: 'vehicles, infantry in the open, the command post', weak: 'rocket teams in cover, helicopters, missiles, artillery',
  },
  artillery: {
    name: 'Artillery', level: 5, cost: 170, cls: 'light', domain: 'ground', size: 3, hp: 110, armor: 0.1, speed: 32, morale: 60, spacing: 30,
    weapons: [{ name: 'howitzers', kind: 'shell', range: 1300, min: 260, reload: 8, dmg: 22, acc: 1, move: 0, radius: 72, flight: 1.2, fspeed: 700 }],
    role: 'Howitzers: indirect fire up to 1300 away. Shells take a while to land (they land where the target WAS) and hit everyone in the blast - friends too.',
    strong: 'infantry, dug-in positions, slow or parked units', weak: 'anything fast, jeeps and aircraft that reach them',
  },
  antiair: {
    name: 'Anti-Air', level: 6, cost: 140, cls: 'light', domain: 'ground', size: 3, hp: 130, armor: 0.2, speed: 62, morale: 68, spacing: 26,
    weapons: [
      { name: 'surface-to-air missiles', kind: 'aa', range: 760, reload: 7, dmg: 45, acc: 0.7, move: 0.5, speed: 900 },
      { name: 'flak cannons', kind: 'autocannon', range: 420, reload: 0.8, dmg: 3, acc: 0.4, move: 0.6, air: true },
    ],
    role: 'Missiles and flak against aircraft. The only ground unit that really threatens jets.',
    strong: 'helicopters, jets, bombers, drones', weak: 'tanks, rockets, artillery',
  },
  helicopter: {
    name: 'Attack Helicopters', level: 6, cost: 190, cls: 'heli', domain: 'air', size: 2, hp: 170, armor: 0.15, speed: 120, morale: 78, spacing: 34, fly: true,
    weapons: [
      { name: 'anti-tank missiles', kind: 'missile', range: 520, reload: 6, dmg: 42, acc: 0.65, move: 0.8, speed: 600 },
      { name: 'chain guns', kind: 'autocannon', range: 340, reload: 0.8, dmg: 2.5, acc: 0.38, move: 0.8 },
    ],
    role: 'Gunships that hover over the battle: missiles for armour, chain guns for the rest. Flies over rivers and towns.',
    strong: 'tanks, APCs, everything on the ground without AA', weak: 'anti-air, fighters, APC autocannons',
  },
  fighter: {
    name: 'Fighter Jets', level: 7, cost: 210, cls: 'jet', domain: 'air', size: 2, hp: 140, armor: 0.1, speed: 430, morale: 90, spacing: 30, fly: true, jet: true,
    weapons: [
      { name: 'air-to-air missiles', kind: 'aa', range: 650, reload: 3, dmg: 60, acc: 0.72, ammo: 4, speed: 1200 },
      { name: 'cannons', kind: 'autocannon', range: 300, reload: 0.6, dmg: 3, acc: 0.35, ammo: 30 },
    ],
    role: 'Air superiority jets. Attack runs at 430 speed, then they fly home to rearm (14 s). Shoot down helicopters, bombers and drones.',
    strong: 'helicopters, bombers, drones, other jets', weak: 'anti-air, destroyers',
  },
  bomber: {
    name: 'Bombers', level: 8, cost: 270, cls: 'jet', domain: 'air', size: 2, hp: 190, armor: 0.15, speed: 330, morale: 90, spacing: 34, fly: true, jet: true,
    weapons: [{ name: 'bombs', kind: 'bomb', range: 90, reload: 0.35, dmg: 40, acc: 1, radius: 85, ammo: 6, flight: 1.1 }],
    role: 'Strike jets: a bombing run drops 6 bombs (radius 85) on the target, then home to rearm. Friendly fire is real.',
    strong: 'massed infantry, artillery, parked vehicles, ships', weak: 'fighters, anti-air, destroyers',
  },
  drone: {
    name: 'Drones', level: 9, cost: 140, cls: 'heli', domain: 'air', size: 3, hp: 45, armor: 0, speed: 95, morale: 100, spacing: 26, fly: true, spotter: 420, fearless: true,
    weapons: [{ name: 'guided missiles', kind: 'missile', range: 460, reload: 8, dmg: 30, acc: 0.7, move: 1, speed: 500 }],
    role: 'Unmanned loitering drones: spot hidden units (range 420) and pick off vehicles with missiles. Fearless and expendable.',
    strong: 'vehicles, snipers, submarines (they spot them)', weak: 'anti-air, fighters, any autocannon',
  },
  mlrs: {
    name: 'Rocket Artillery', level: 9, cost: 230, cls: 'light', domain: 'ground', size: 3, hp: 110, armor: 0.1, speed: 52, morale: 60, spacing: 30,
    weapons: [{ name: 'rocket salvos', kind: 'shell', range: 1500, min: 300, reload: 20, dmg: 16, acc: 1, move: 0, radius: 130, flight: 2.2, fspeed: 900, salvo: true }],
    role: 'Multiple rocket launchers: one enormous salvo (radius 130) every 20 s from up to 1500 away. Friends in the blast get hit too.',
    strong: 'massed infantry, parked vehicles, anything bunched up', weak: 'fast units, aircraft, counter-battery fire',
  },
  patrolboat: {
    name: 'Patrol Boats', level: 8, cost: 120, cls: 'ship', domain: 'naval', size: 2, hp: 140, armor: 0.1, speed: 120, morale: 80, spacing: 40, naval: true,
    weapons: [
      { name: 'autocannons', kind: 'autocannon', range: 380, reload: 1.0, dmg: 3, acc: 0.4, move: 0.8 },
      { name: 'deck MGs', kind: 'mg', range: 330, reload: 0.6, dmg: 0.8, acc: 0.3, move: 0.7 },
    ],
    role: 'Fast gunboats: hunt submarines near the surface, harass the shore, screen bigger ships. Water only.',
    strong: 'infantry on the shore, helicopters, other boats', weak: 'destroyers, tanks, missiles',
  },
  destroyer: {
    name: 'Destroyer', level: 8, cost: 300, cls: 'ship', domain: 'naval', size: 1, hp: 900, armor: 0.3, speed: 70, morale: 90, spacing: 60, naval: true, spotter: 260,
    weapons: [
      { name: 'naval gun', kind: 'shell', range: 1100, min: 120, reload: 4, dmg: 30, acc: 1, move: 1, radius: 55, flight: 0.8, fspeed: 1100 },
      { name: 'SAM launchers', kind: 'aa', range: 800, reload: 5, dmg: 50, acc: 0.7, move: 1, speed: 1000 },
      { name: 'torpedoes', kind: 'torpedo', range: 600, reload: 12, dmg: 140, acc: 0.7, move: 1, speed: 160 },
    ],
    role: 'A warship with a long-range gun (shore bombardment, 1100), air-defence missiles and torpedoes. Water only.',
    strong: 'aircraft, boats, submarines, anything near the coast', weak: 'submarines it has not found, bombers in numbers',
  },
  submarine: {
    name: 'Submarine', level: 10, cost: 260, cls: 'sub', domain: 'naval', size: 1, hp: 650, armor: 0.2, speed: 65, morale: 95, spacing: 60, naval: true, stealth: true,
    weapons: [{ name: 'torpedoes', kind: 'torpedo', range: 700, reload: 9, dmg: 260, acc: 0.8, move: 1, speed: 180 }],
    role: 'Hidden under water: torpedoes wreck ships. Only seen within 250 of an enemy ship, helicopter or drone - or when it fires.',
    strong: 'ships (destroyers, battleships)', weak: 'patrol boats, destroyers and drones that find it; it cannot hit land',
  },
  stealthbomber: {
    name: 'Stealth Bomber', level: 10, cost: 520, cls: 'jet', domain: 'air', size: 1, hp: 700, armor: 0.2, speed: 360, morale: 100, spacing: 40, fly: true, jet: true, stealth: true, legendary: true, fearless: true,
    weapons: [{ name: 'heavy bombs', kind: 'bomb', range: 110, reload: 0.25, dmg: 70, acc: 1, radius: 95, ammo: 12, flight: 1.3 }],
    role: 'LEGENDARY. Invisible to radar: anti-air and fighters can only engage it within 220. Twelve heavy bombs (radius 95) per run. One legendary per army.',
    strong: 'everything on the ground, ships', weak: 'anti-air and fighters close by',
  },
  battleship: {
    name: 'Battleship', level: 11, cost: 600, cls: 'ship', domain: 'naval', size: 1, hp: 3200, armor: 0.45, speed: 42, morale: 100, spacing: 80, naval: true, legendary: true, fearless: true, spotter: 260,
    weapons: [
      { name: 'main batteries', kind: 'shell', range: 1600, min: 150, reload: 5, dmg: 50, acc: 1, move: 1, radius: 88, flight: 1.1, fspeed: 1200, shells: 3 },
      { name: 'SAM launchers', kind: 'aa', range: 800, reload: 4, dmg: 50, acc: 0.72, move: 1, speed: 1000 },
      { name: 'secondary guns', kind: 'autocannon', range: 420, reload: 0.8, dmg: 6, acc: 0.4, move: 1 },
    ],
    role: 'LEGENDARY. A floating fortress: three-shell salvos (radius 88) from 1600 away, air defence, secondary guns. Water only.',
    strong: 'everything within 1600 of the water', weak: 'submarines, massed bombers',
  },
  mammoth: {
    name: 'Mammoth Tank', level: 12, cost: 560, cls: 'heavy', domain: 'ground', size: 1, hp: 2600, armor: 0.5, speed: 36, morale: 100, spacing: 40, legendary: true, fearless: true,
    weapons: [
      { name: 'twin cannons', kind: 'cannon', range: 520, reload: 3, dmg: 120, acc: 0.6, move: 0.8, speed: 900 },
      { name: 'missile pods', kind: 'aa', range: 600, reload: 6, dmg: 50, acc: 0.65, move: 0.8, speed: 900 },
      { name: 'heavy MG', kind: 'mg', range: 300, reload: 0.5, dmg: 1.4, acc: 0.34, move: 0.8, supp: 1 },
    ],
    role: 'LEGENDARY. A super-heavy tank: twin cannons, anti-air missile pods and a heavy MG. Nearly unstoppable - except by massed rockets and missiles.',
    strong: 'everything on the ground, aircraft that come close', weak: 'massed rockets, missiles, bombs',
  },
};

// The command post: every army has exactly one (free). If it is destroyed, the army loses.
const HQ = {
  name: 'Command Post', cls: 'hq', domain: 'ground', size: 1, hp: 1100, armor: 0.4, speed: 55, morale: 100, spacing: 20, fearless: true, regen: 3,
  weapons: [{ name: 'defence MG', kind: 'mg', range: 280, reload: 0.6, dmg: 1.0, acc: 0.3, move: 0.7 }],
  aura: { radius: 320, regen: 2, resist: 0.75 },
  role: 'Your armoured command vehicle (id 99). Morale aura (radius 320) and the support powers. If it is destroyed you LOSE.',
};

const POWERS = {
  rally:     { level: 1,  cd: 40, radius: 350, text: 'Friendly units within 350 of the command post: +30 morale; retreating units there turn and fight again.' },
  smoke:     { level: 3,  cd: 30, range: 900, radius: 130, time: 12, text: 'Smoke screen at a point within 900 of the command post (radius 130, 12 s): units inside take half damage from direct fire and are hidden from enemies more than 150 away.' },
  barrage:   { level: 5,  cd: 45, range: 1600, radius: 120, shells: 8, dmg: 22, blast: 55, delay: 3, text: 'Off-map artillery: 8 shells land over 4 s in a radius of 120 around a point within 1600 (each blast radius 55, 22 damage per element caught). Friends too.' },
  airstrike: { level: 7,  cd: 50, range: 2400, bombs: 6, length: 360, dmg: 36, blast: 60, delay: 2.5, text: 'Two jets bomb a 360-long line through a point (6 bombs, radius 60, 36 damage each), 2.5 s after the call. Friends too.' },
  cruise:    { level: 10, cd: 60, range: 3000, radius: 130, dmg: 120, delay: 4, text: 'A cruise missile hits a point anywhere after 4 s: radius 130, 120 damage per element caught. Friends too.' },
  emp:       { level: 11, cd: 60, range: 1000, radius: 260, time: 7, text: 'An EMP burst at a point within 1000: every vehicle, aircraft and ship within 260 (both sides!) is disabled for 7 s - no moving, no shooting.' },
  carpet:    { level: 12, cd: 70, range: 2400, bombs: 18, length: 700, dmg: 42, blast: 70, delay: 3, text: 'Carpet bombing: 18 bombs along a 700-long line through a point (radius 70, 42 damage each), 3 s after the call. Friends too.' },
};

const UPGRADES = {
  veteran: { level: 2, costPct: 30, text: '+25% damage with every weapon, +10 morale' },
  armor:   { level: 3, costPct: 25, text: '+0.12 armor (body armour / extra plating, max 0.7), -6% speed' },
  radio:   { level: 5, costPct: 15, text: '+8 morale; this unit and friendly units within 200 lose 15% less morale' },
};

const FORMATIONS = {
  line:   { text: 'The default: every weapon in the fight.', fire: 1, speed: 1, spread: 1, areaTaken: 1, directTaken: 1 },
  column: { text: 'Road march: +25% speed, -40% firepower, +25% damage from shells and bombs.', fire: 0.6, speed: 1.25, spread: 0.8, areaTaken: 1.25, directTaken: 1 },
  spread: { text: 'Spread out: 45% less damage from shells and bombs, -15% firepower, -10% speed.', fire: 0.85, speed: 0.9, spread: 1.6, areaTaken: 0.55, directTaken: 1.05 },
};

// Cover: damage taken multipliers (infantry | vehicles) and speed multipliers.
const COVER = {
  town:   { inf: 0.55, veh: 0.85, speedInf: 0.9, speedVeh: 0.75 },
  forest: { inf: 0.7,  veh: 0.9,  speedInf: 0.85, speedVeh: 0.55 },
  smoke:  { direct: 0.5 },
  dug:    { taken: 0.65, after: 6 },   // infantry that stands still for 6 s digs in
};

const EMBLEMS = ['star', 'eagle', 'wolf', 'shield', 'skull', 'lightning', 'anchor', 'wings', 'crosshair', 'tower', 'bear', 'lion', 'dragon', 'sun', 'moon', 'trident', 'globe', 'hawk', 'tiger', 'cobra'];

// ── battlefields (mirror-symmetric: x -> -x maps the field onto itself) ─────────────
// towns: cover zones (circles); forests: circles; blocks: impassable buildings / cliffs (circles);
// water: rectangles {x0, y0, x1, y1} ships sail in (ground units cannot enter);
// bridges: rectangles inside the water that ground units CAN cross.
const MAPS = [
  {
    id: 'farmland', name: 'Farmland', palette: 'farm', blurb: 'Rolling fields between two villages (north and south of centre) and patches of forest on the flanks.',
    towns: [{ x: 0, y: -330, r: 130 }, { x: 0, y: 330, r: 130 }],
    forests: [{ x: -560, y: -420, r: 120 }, { x: 560, y: -420, r: 120 }, { x: -560, y: 440, r: 120 }, { x: 560, y: 440, r: 120 }, { x: -260, y: 20, r: 70 }, { x: 260, y: 20, r: 70 }],
    blocks: [{ x: 0, y: 0, r: 44 }], water: [], bridges: [],
  },
  {
    id: 'rivertown', name: 'River Town', palette: 'river', blurb: 'A river cuts the field in two; three bridges and a town on each bank. Tanks must use the bridges.',
    towns: [{ x: -300, y: -40, r: 150 }, { x: 300, y: -40, r: 150 }],
    forests: [{ x: -700, y: -440, r: 110 }, { x: 700, y: -440, r: 110 }, { x: -700, y: 420, r: 110 }, { x: 700, y: 420, r: 110 }],
    blocks: [],
    water: [{ x0: -70, y0: -675, x1: 70, y1: 675 }],
    bridges: [{ x0: -70, y0: -470, x1: 70, y1: -410 }, { x0: -70, y0: -30, x1: 70, y1: 30 }, { x0: -70, y0: 410, x1: 70, y1: 470 }],
  },
  {
    id: 'desert', name: 'Desert Storm', palette: 'desert', blurb: 'Open desert with rock mesas north and south and an oasis town in the middle - a tank country.',
    towns: [{ x: 0, y: 0, r: 120 }],
    forests: [{ x: -520, y: 0, r: 60 }, { x: 520, y: 0, r: 60 }],
    blocks: [{ x: 0, y: -420, r: 110 }, { x: 0, y: 430, r: 115 }, { x: -620, y: -300, r: 55 }, { x: 620, y: -300, r: 55 }, { x: -620, y: 310, r: 55 }, { x: 620, y: 310, r: 55 }],
    water: [], bridges: [],
  },
  {
    id: 'city', name: 'City Siege', palette: 'city', blurb: 'A city of blocks and streets: towns everywhere, office towers you cannot pass. Infantry country.',
    towns: [{ x: -380, y: -300, r: 150 }, { x: 380, y: -300, r: 150 }, { x: -380, y: 300, r: 150 }, { x: 380, y: 300, r: 150 }, { x: 0, y: 0, r: 180 }],
    forests: [{ x: -760, y: 0, r: 80 }, { x: 760, y: 0, r: 80 }],
    blocks: [{ x: -170, y: -200, r: 50 }, { x: 170, y: -200, r: 50 }, { x: -170, y: 200, r: 50 }, { x: 170, y: 200, r: 50 }, { x: 0, y: -470, r: 70 }, { x: 0, y: 470, r: 70 }],
    water: [], bridges: [],
  },
  {
    id: 'coast', name: 'Coastal Assault', palette: 'coast', naval: true, blurb: 'The sea along the north edge (ships!), beaches and a harbour town; open ground and woods in the south.',
    towns: [{ x: -420, y: -160, r: 120 }, { x: 420, y: -160, r: 120 }, { x: 0, y: 200, r: 110 }],
    forests: [{ x: -640, y: 420, r: 120 }, { x: 640, y: 420, r: 120 }, { x: 0, y: 520, r: 90 }],
    blocks: [],
    water: [{ x0: -1200, y0: -675, x1: 1200, y1: -330 }],
    bridges: [],
  },
  {
    id: 'islands', name: 'Island Chain', palette: 'islands', naval: true, blurb: 'Two coasts facing each other across a wide channel; three causeways cross it. Fleets fight in the channel.',
    towns: [{ x: -620, y: -60, r: 130 }, { x: 620, y: -60, r: 130 }],
    forests: [{ x: -800, y: -460, r: 110 }, { x: 800, y: -460, r: 110 }, { x: -800, y: 420, r: 110 }, { x: 800, y: 420, r: 110 }],
    blocks: [{ x: 0, y: -300, r: 60 }, { x: 0, y: 320, r: 60 }],
    water: [{ x0: -330, y0: -675, x1: 330, y1: 675 }],
    bridges: [{ x0: -330, y0: -560, x1: 330, y1: -500 }, { x0: -330, y0: -30, x1: 330, y1: 30 }, { x0: -330, y0: 500, x1: 330, y1: 560 }],
  },
];
// Rounds 1-7 rotate the land maps; from round 8 (ships unlock) the naval maps take turns.
function mapForRound(round) {
  const r = Math.max(1, Math.floor(Number(round) || 1));
  if (r >= 8) return r % 2 === 0 ? MAPS[4] : MAPS[5];
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
function unitCost(type, upgrades) {
  const u = UNITS[type];
  if (!u) return 0;
  let c = u.cost;
  for (const up of upgrades || []) if (UPGRADES[up]) c += Math.round(u.cost * UPGRADES[up].costPct / 100);
  return c;
}
function inWater(map, x, y) {
  for (const w of map.water) if (x >= w.x0 && x <= w.x1 && y >= w.y0 && y <= w.y1) {
    for (const b of map.bridges) if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) return false;
    return true;
  }
  return false;
}
function onBridge(map, x, y) { for (const b of map.bridges) if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) return true; return false; }
function deepWater(map, x, y) { for (const w of map.water) if (x >= w.x0 && x <= w.x1 && y >= w.y0 && y <= w.y1) return true; return false; }

module.exports = {
  FIELD, DEPLOY, BATTLE_TIME, TICK, THINK_EVERY, RECORD_EVERY, REARM_TIME, BUDGET, MAX_UNITS, MAX_LEVEL,
  VS, AREA_KINDS, UNITS, HQ, POWERS, UPGRADES, FORMATIONS, COVER, EMBLEMS, MAPS,
  clampLevel, budgetFor, maxUnitsFor, vs, canHit, mapForRound, mapById, unitsAt, upgradesAt, powersAt, unitCost,
  inWater, onBridge, deepWater,
};
