'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  AI FIGHT — rules, formulas, levels, stats, weapons, traits and validation.
//  Everything numeric about the game lives here so the engine, the CLI, the
//  server and the docs all agree. `node arena.js rules` prints this live.
// ─────────────────────────────────────────────────────────────────────────────

const RULES = Object.freeze({
  version: 4,
  tickRate: 30,            // simulation ticks per second
  thinkEvery: 3,           // brain() runs every 3 ticks → 10 decisions per second
  roundTime: 90,           // seconds; then the fight is decided on HP %
  arenaRadius: 520,        // arena is a circle centred on (0,0) — at level 1; it grows with the level
  ring: Object.freeze({ shrinkStart: 45, shrinkEnd: 75, minRadius: 220 }),  // minRadius at level 1 (scales with the arena)
  fighterRadius: 24,       // every fighter's hitbox is a circle of this radius
  startOffset: 260,        // fighters start at x = -260 and x = +260 at level 1 (half the arena radius)
  statPoints: 150,         // at max level
  statMax: 40,             // at max level
  maxAbilities: 6,         // at max level (the weapon attack and the ultimate are extra)
  maxTraits: 4,            // at max level
  maxTurrets: 2,           // turrets alive at once per fighter
  stanceCooldown: 1.5,     // seconds between stance switches
  swapTime: 0.3,           // weapon swap: no attacks for this long
  swapCooldown: 2,
  emoteCooldown: 3,
  ultBudget: 420,          // an ultimate's power budget (energy-formula units) at 100% power caps
  ultCapMult: 1.6,         // an ultimate's damage/heal/… maximums are 1.6× an ability's
  ultMinWindup: 1.0,       // ultimates charge up for at least 1 s: the caster is rooted and exposed meanwhile
  godMinCast: 1.0,         // godly powers too
  exposedTaken: 1.25,      // damage taken while charging an ultimate
  chargeRefund: 50,        // an interrupted charge-up keeps this much of its meter
  awakenAfter: 20,         // awakening is available after this many seconds (or below 50% HP)
  cinematicCapMs: 3000,    // total hit-stop time per fight (big hits and the K.O.)
  globalCooldown: 0.25,    // after starting any ability (or attack) you must wait this long
  stunImmunity: 2.0,       // immune to new stuns for this long after a stun ends
  ccImmunity: 1.0,         // immune to new roots / silences for this long after one ends
  dashSpeed: 950,          // units / second while dashing
  energyScale: 0.32,       // global multiplier in the ability energy formula
  burstTax: 250,           // big hits cost extra: value = dmg * (1 + dmg / 250)
  dotTax: 350,             // damage over time: value = 0.9 * total * (1 + total / 350)
  critMult: 2.0,           // critical hits deal double damage
  maxTraps: 3,             // traps alive at once per fighter
  sayCooldown: 2.0,
  sayMaxLength: 60,
  brainTimeoutMs: 50,      // a single brain() call may not run longer than this
  brainBudgetMs: 10000,    // total brain time per fight before it overheats
  brainLoadTimeoutMs: 1500,
  brainMaxBytes: 300000,   // brain.js + lib/*.js together
  libMaxFiles: 24,
  memoryMaxBytes: 16000,   // `memory` kept between the rounds of a match
  drawMaxShapes: 16,       // debug shapes per decision
  spriteMaxBytes: 400000,
  spriteSize: 32,          // sprites are 32 x 32 pixel art
  spriteMaxColors: 32,
});

// ── Levels: fighters evolve round by round ──────────────────────────────────
// Round 1 is level 1 (everyone uses the same starter), round 2 → level 2, …
// `power` scales the maximum of every "strength" field (damage, heals, stun…)
// and the damage of weapon attacks.
// Level: stat points, max per stat, ability / trait / relic / godly-power slots, power caps, arena radius.
const LV = (level, statPoints, statMax, abilitySlots, traitSlots, relicSlots, godSlots, power, arenaRadius) =>
  Object.freeze({ level, statPoints, statMax, abilitySlots, traitSlots, relicSlots, godSlots, power, arenaRadius });
const LEVELS = Object.freeze({
  1: LV(1, 60, 25, 2, 0, 0, 0, 0.30, 520),
  2: LV(2, 68, 27, 3, 1, 0, 0, 0.38, 540),
  3: LV(3, 76, 29, 3, 1, 0, 0, 0.46, 560),
  4: LV(4, 84, 31, 4, 1, 0, 0, 0.54, 580),
  5: LV(5, 92, 33, 4, 2, 0, 0, 0.62, 600),
  6: LV(6, 100, 35, 4, 2, 1, 0, 0.70, 620),
  7: LV(7, 108, 37, 5, 2, 1, 0, 0.77, 640),
  8: LV(8, 116, 39, 5, 3, 1, 0, 0.84, 660),
  9: LV(9, 124, 40, 5, 3, 2, 0, 0.90, 680),
  10: LV(10, 132, 40, 6, 3, 2, 1, 0.95, 720),
  11: LV(11, 140, 40, 6, 4, 3, 1, 1.00, 760),
  12: LV(12, 150, 40, 6, 4, 3, 2, 1.00, 800),
});
const MAX_LEVEL = 12;

// What unlocks when. Ability types and stats not listed are available from level 1.
const TYPE_UNLOCK = Object.freeze({ area: 2, shield: 2, heal: 2, buff: 2, zone: 3, trap: 3, counter: 4, cleanse: 4, beam: 4, turret: 6 });
const STAT_UNLOCK = Object.freeze({ vigor: 2, focus: 5 });
const FEATURE_UNLOCK = Object.freeze({ weapons: 2, traits: 2, look: 2, stances: 3, ultimate: 5, relics: 6, offhand: 7, awakening: 8, godPowers: 10, ascension: 12 });

function levelForRound(round) {
  const r = Math.floor(Number(round) || 1);
  return Math.max(1, Math.min(MAX_LEVEL, r));
}
function levelInfo(level) { return LEVELS[Math.max(1, Math.min(MAX_LEVEL, level || MAX_LEVEL))]; }
function unlocked(feature, level) { return levelInfo(level).level >= (FEATURE_UNLOCK[feature] || 1); }
/** Weapon attacks scale with the level: 0.685 at level 1 … 1.0 at level 11+. */
function weaponScale(level) { return 0.55 + 0.45 * levelInfo(level).power; }
/** The arena at a level: it grows from radius 520 (level 1) to 800 (level 12). */
function arenaFor(level) {
  const radius = levelInfo(level).arenaRadius;
  const k = radius / RULES.arenaRadius;
  return {
    radius, scale: k,
    minRadius: Math.round(RULES.ring.minRadius * k),
    startOffset: Math.round(RULES.startOffset * k),
    shrinkStart: RULES.ring.shrinkStart, shrinkEnd: RULES.ring.shrinkEnd,
  };
}

/** Human-readable list of what a level unlocks (compared with the level before). */
function levelUnlocks(level) {
  const lvl = levelInfo(level);
  const out = [];
  if (lvl.level === 1) return ['Mirror round: both fighters use the identical Rookie starter — only the brain differs'];
  const prev = levelInfo(lvl.level - 1);
  const feat = {
    weapons: 'Weapons: choose any of the 17', traits: 'Traits', look: 'Your own look (skins, presets, colours)',
    stances: 'Stances: aggressive / defensive / swift, switchable mid-fight', ultimate: 'ULTIMATE: a huge signature move charged by fighting',
    relics: 'Relics: legendary artefacts', offhand: 'Off-hand weapon: carry two weapons and swap mid-fight',
    awakening: 'AWAKENING: a once-per-fight power-up transformation', godPowers: 'GODLY POWERS: divine abilities with a divinity meter',
    ascension: 'ASCENSION: awakening becomes a godly form; a 2nd godly power',
  };
  for (const [k, v] of Object.entries(FEATURE_UNLOCK)) if (v === lvl.level && feat[k]) out.push(feat[k]);
  const types = Object.entries(TYPE_UNLOCK).filter(([, v]) => v === lvl.level).map(([k]) => k);
  if (types.length) out.push(`Ability types: ${types.join(', ')}`);
  const stats = Object.entries(STAT_UNLOCK).filter(([, v]) => v === lvl.level).map(([k]) => k);
  if (stats.length) out.push(`Stat: ${stats.join(', ')}`);
  if (lvl.abilitySlots > prev.abilitySlots) out.push(`Ability slot ${lvl.abilitySlots}`);
  if (lvl.traitSlots > prev.traitSlots && lvl.level !== FEATURE_UNLOCK.traits) out.push(`Trait slot ${lvl.traitSlots}`);
  if (lvl.relicSlots > prev.relicSlots && lvl.level !== FEATURE_UNLOCK.relics) out.push(`Relic slot ${lvl.relicSlots}`);
  if (lvl.godSlots > prev.godSlots && lvl.level !== FEATURE_UNLOCK.godPowers && lvl.level !== FEATURE_UNLOCK.ascension) out.push(`Godly power slot ${lvl.godSlots}`);
  if (lvl.arenaRadius > prev.arenaRadius) out.push(`Bigger arena (radius ${lvl.arenaRadius})`);
  out.push(`${lvl.statPoints} stat points (max ${lvl.statMax} each), power caps ${Math.round(lvl.power * 100)}%`);
  return out;
}

// ── Stats ────────────────────────────────────────────────────────────────────

const STAT_KEYS = ['vitality', 'power', 'armor', 'speed', 'energy', 'regen', 'crit', 'haste', 'tenacity', 'precision', 'vigor', 'focus'];

const STAT = Object.freeze({
  hpBase: 1350, hpPer: 31.5,
  powerPer: 0.017,
  armorPer: 1.55,
  speedBase: 170, speedPer: 5.5,
  energyBase: 100, energyPer: 8,
  regenBase: 13, regenPer: 0.75,
  critPer: 0.015,
  hastePer: 0.011, hasteWindupPer: 0.005,
  tenacityPer: 0.035, tenacityDotPer: 0.02,
  precisionPer: 0.022, precisionSpeedPer: 0.01, precisionCritPer: 0.01,
  vigorRegenPer: 0.55, vigorHealPer: 0.01,
  focusChargePer: 0.08, focusAwakenPer: 0.15,
});

const pctOf = (v) => `${+(v * 100).toFixed(2)}%`;
const STAT_INFO = {
  vitality:  { label: 'Vitality',  short: 'VIT', group: 'defence', formula: `max HP = ${STAT.hpBase} + ${STAT.hpPer} × vitality` },
  power:     { label: 'Power',     short: 'POW', group: 'offence', formula: `damage dealt × (1 + ${STAT.powerPer} × power)` },
  armor:     { label: 'Armor',     short: 'ARM', group: 'defence', formula: `damage taken × 100 / (100 + ${STAT.armorPer} × armor)  (the attacker's precision ignores part of it)` },
  speed:     { label: 'Speed',     short: 'SPD', group: 'utility', formula: `move speed = ${STAT.speedBase} + ${STAT.speedPer} × speed (units/s)` },
  energy:    { label: 'Energy',    short: 'ENG', group: 'utility', formula: `max energy = ${STAT.energyBase} + ${STAT.energyPer} × energy` },
  regen:     { label: 'Regen',     short: 'REG', group: 'utility', formula: `energy regen = ${STAT.regenBase} + ${STAT.regenPer} × regen (per second)` },
  crit:      { label: 'Crit',      short: 'CRT', group: 'offence', formula: `${pctOf(STAT.critPer)} chance per point that a hit deals ×${RULES.critMult} damage (DoTs never crit)` },
  haste:     { label: 'Haste',     short: 'HST', group: 'utility', formula: `cooldowns × (1 − ${STAT.hastePer} × haste), windups × (1 − ${STAT.hasteWindupPer} × haste)` },
  tenacity:  { label: 'Tenacity',  short: 'TEN', group: 'defence', formula: `stun/root/silence/slow durations and knockback × (1 − ${STAT.tenacityPer} × tenacity, min 0.2); damage over time taken × (1 − ${STAT.tenacityDotPer} × tenacity)` },
  precision: { label: 'Precision', short: 'PRC', group: 'offence', formula: `per point: ignore ${pctOf(STAT.precisionPer)} of the target's armor (max 80%), projectiles ${pctOf(STAT.precisionSpeedPer)} faster, crits +${pctOf(STAT.precisionCritPer)} damage` },
  vigor:     { label: 'Vigor',     short: 'VGR', group: 'defence', unlock: 2, formula: `regenerate ${STAT.vigorRegenPer} HP per second per point; healing you receive +${pctOf(STAT.vigorHealPer)} per point` },
  focus:     { label: 'Focus',     short: 'FOC', group: 'utility', unlock: 5, formula: `ultimate and divinity charge ${pctOf(STAT.focusChargePer)} faster per point; awakening lasts +${STAT.focusAwakenPer} s per point (unlocks at level 5)` },
};

// ── Stances (level 3+): switch any time with { stance } (1.5 s between switches) ──
const STANCES = Object.freeze({
  balanced:   { name: 'Balanced',   dealt: 1.00, taken: 1.00, speed: 1.00, text: 'No modifiers.' },
  aggressive: { name: 'Aggressive', dealt: 1.15, taken: 1.12, speed: 1.00, text: 'Deal 15% more damage, take 12% more.' },
  defensive:  { name: 'Defensive',  dealt: 0.88, taken: 0.82, speed: 0.90, text: 'Take 18% less damage, deal 12% less, move 10% slower.' },
  swift:      { name: 'Swift',      dealt: 0.92, taken: 1.00, speed: 1.15, text: 'Move 15% faster, deal 8% less damage.' },
});
const STANCE_IDS = Object.keys(STANCES);

// ── Relics (level 6 / 9 / 11): legendary artefacts, fully deterministic ──────
const RELICS = Object.freeze({
  phoenix_feather: { name: 'Phoenix Feather', text: 'Once per fight, when you would be knocked out, revive with 10% HP and 1 s of invulnerability.' },
  hourglass:       { name: 'Hourglass',       text: 'Every 6 s, the ability with the longest remaining cooldown is refreshed.' },
  vampire_fang:    { name: 'Vampire Fang',    text: 'Weapon attacks heal you for 20% of their damage.' },
  mirror_charm:    { name: 'Mirror Charm',    text: 'Every 12 s, the next enemy projectile that would hit you is reflected back at its owner.' },
  thunder_idol:    { name: 'Thunder Idol',    text: 'Every 4th hit you land calls lightning on the enemy for 30 damage (scaled by level).' },
  energy_crystal:  { name: 'Energy Crystal',  text: '+60 max energy and +20% energy regen.' },
  warding_rune:    { name: 'Warding Rune',    text: 'The first stun, root or silence on you every 6 s is ignored.' },
  hunters_mark:    { name: "Hunter's Mark",   text: 'Your first hit every 8 s marks the enemy: it takes 20% more damage for 3 s.' },
  frost_heart:     { name: 'Frost Heart',     text: 'Your hits slow the enemy by 25% for 1.5 s.' },
  venom_gland:     { name: 'Venom Gland',     text: 'Weapon attacks poison: 5 damage per second for 3 s (scaled by level).' },
  winged_boots:    { name: 'Winged Boots',    text: '+12% move speed; dashes travel 20% farther.' },
  scholars_tome:   { name: "Scholar's Tome",  text: 'Ultimate and divinity charge 60% faster, and your ultimate and godly powers deal 15% more damage.' },
  titan_belt:      { name: 'Titan Belt',      text: '+10% max HP; knockback and pulls on you are halved.' },
  bloodstone:      { name: 'Bloodstone',      text: 'Every 10 s while below 50% HP, heal 6% of your max HP.' },
  storm_battery:   { name: 'Storm Battery',   text: 'Every 6 s, your next ability costs no energy.' },
  berserker_helm:  { name: 'Berserker Helm',  text: 'Below 50% HP, your weapon attacks recover 40% faster and deal 20% more damage.' },
});
const RELIC_IDS = Object.keys(RELICS);

// Ultimates are priced by the energy formula x a risk factor: sustain ultimates (heal, shield, buff)
// can't miss and cost more; a channelled beam or a delayed meteor can be dodged and cost less.
const ULT_TYPE_COST = Object.freeze({ heal: 2.4, volley: 2.2, buff: 2.0, shield: 1.9, nova: 1.5, projectile: 1.2, melee: 0.9, zone: 0.6, meteor: 0.6, beam: 0.3 });

// ── Weapons: every fighter carries one and gets a free basic attack ──────────
// Damage values are for level 4 and are scaled by weaponScale(level).
// `kind` is the animation family used by the sprite composer and renderer.
const WEAPONS = Object.freeze({
  fists:      { name: 'Bare Fists',     kind: 'claw',   attack: { name: 'Punch',  type: 'melee', damage: 27, range: 30, arc: 100, cooldown: 0.42, windup: 0.05, style: 'claw' },   passive: 'fists',      passiveText: '+8% move speed.' },
  shortsword: { name: 'Shortsword',     kind: 'slash',  attack: { name: 'Slash',  type: 'melee', damage: 38, range: 42, arc: 110, cooldown: 0.7, windup: 0.1, style: 'slash' },   passive: 'shortsword', passiveText: 'Balanced. Each attack that hits refunds 3 energy.' },
  greatsword: { name: 'Greatsword',     kind: 'slash',  attack: { name: 'Cleave', type: 'melee', damage: 80, range: 62, arc: 150, cooldown: 1.4, windup: 0.3, style: 'slash', effects: { knockback: 50 } }, passive: 'greatsword', passiveText: 'Huge sweeping arc that knocks back. −5% move speed.' },
  dagger:     { name: 'Twin Daggers',   kind: 'thrust', attack: { name: 'Stab',   type: 'melee', damage: 22, range: 28, arc: 90, cooldown: 0.35, windup: 0.05, style: 'thrust' }, passive: 'dagger',     passiveText: '+12% crit chance. Attacks from behind deal +40%.' },
  spear:      { name: 'Spear',          kind: 'thrust', attack: { name: 'Thrust', type: 'melee', damage: 33, range: 85, arc: 40, cooldown: 0.8, windup: 0.15, style: 'thrust', effects: { knockback: 35 } }, passive: 'spear', passiveText: 'Very long, narrow reach; attacks push the enemy back.' },
  hammer:     { name: 'Warhammer',      kind: 'smash',  attack: { name: 'Smash',  type: 'melee', damage: 77, range: 45, arc: 110, cooldown: 1.3, windup: 0.3, style: 'smash' },  passive: 'hammer',     passiveText: 'Every 3rd attack that hits stuns for 0.5 s (scaled by level).' },
  axe:        { name: 'Battle Axe',     kind: 'slash',  attack: { name: 'Hack',   type: 'melee', damage: 48, range: 45, arc: 120, cooldown: 1.0, windup: 0.2, style: 'slash' },  passive: 'axe',        passiveText: 'Attacks make the enemy bleed: 5 damage/s for 3 s (scaled by level).' },
  scythe:     { name: 'Scythe',         kind: 'slash',  attack: { name: 'Reap',   type: 'melee', damage: 45, range: 72, arc: 200, cooldown: 1.1, windup: 0.2, style: 'slash' },  passive: 'scythe',     passiveText: 'Very wide reach. Attacks heal you for 15% of the damage.' },
  whip:       { name: 'Whip',           kind: 'slash',  attack: { name: 'Lash',   type: 'melee', damage: 27, range: 115, arc: 50, cooldown: 0.8, windup: 0.1, style: 'slash', effects: { slow: { amount: 0.25, duration: 1 } } }, passive: 'whip', passiveText: 'Longest melee reach; attacks slow by 25% for 1 s.' },
  katana:     { name: 'Katana',         kind: 'slash',  attack: { name: 'Draw Cut', type: 'melee', damage: 38, range: 50, arc: 90, cooldown: 0.75, windup: 0.1, style: 'slash' }, passive: 'katana',   passiveText: 'The first attack within 3 s after any dash is a guaranteed crit.' },
  shield:     { name: 'Sword & Shield', kind: 'slash',  attack: { name: 'Jab',    type: 'melee', damage: 31, range: 40, arc: 100, cooldown: 0.75, windup: 0.1, style: 'slash' }, passive: 'shield',     passiveText: 'Hits coming from your front (±60°) deal 15% less damage.' },
  claws:      { name: 'Claws',          kind: 'claw',   attack: { name: 'Rake',   type: 'melee', damage: 22, range: 32, arc: 120, cooldown: 0.4, windup: 0.05, style: 'claw' },  passive: 'claws',      passiveText: 'Each consecutive attack hit within 1.5 s deals +5% more (max +25%).' },
  bow:        { name: 'Longbow',        kind: 'shoot',  attack: { name: 'Arrow',  type: 'projectile', damage: 36, speed: 1000, radius: 6, range: 780, cooldown: 0.95, windup: 0.15, style: 'arrow' }, passive: 'bow', passiveText: 'Arrows deal +15% damage to targets more than 350 units away.' },
  crossbow:   { name: 'Crossbow',       kind: 'shoot',  attack: { name: 'Bolt Shot', type: 'projectile', damage: 62, speed: 1300, radius: 6, range: 800, cooldown: 1.6, windup: 0.3, style: 'bolt' }, passive: 'crossbow', passiveText: 'Bolts ignore 40% of the target\'s armor.' },
  staff:      { name: 'Staff',          kind: 'cast',   attack: { name: 'Orb',    type: 'projectile', damage: 24, speed: 700, radius: 10, range: 600, homing: 0.3, cooldown: 0.95, windup: 0.1, style: 'orb' }, passive: 'staff', passiveText: 'Your abilities deal +10% damage.' },
  wand:       { name: 'Wand',           kind: 'cast',   attack: { name: 'Spark',  type: 'projectile', damage: 15, speed: 1000, radius: 6, range: 550, cooldown: 0.45, windup: 0, style: 'bolt' }, passive: 'wand', passiveText: '+15% energy regen.' },
  pistol:     { name: 'Flintlock',      kind: 'gun',    attack: { name: 'Shot',   type: 'projectile', damage: 36, speed: 1500, radius: 5, range: 650, cooldown: 1.25, windup: 0.15, style: 'bolt' }, passive: 'pistol', passiveText: '+8% crit chance.' },
});
const WEAPON_IDS = Object.keys(WEAPONS);
const DEFAULT_WEAPON = 'fists';

// ── Traits: passive perks, picked from a catalog ─────────────────────────────

const TRAITS = Object.freeze({
  // defence
  thick_skin:    { name: 'Thick Skin',    group: 'defence', text: 'Take 8% less damage.' },
  last_stand:    { name: 'Last Stand',    group: 'defence', text: 'Below 25% HP, take 30% less damage.' },
  iron_will:     { name: 'Iron Will',     group: 'defence', text: 'Stuns, roots and silences on you last 40% shorter.' },
  unstoppable:   { name: 'Unstoppable',   group: 'defence', text: 'Immune to knockback and pulls; slows and roots on you are 40% weaker.' },
  regenerator:   { name: 'Regenerator',   group: 'defence', text: 'Regenerate 5 HP per second.' },
  second_wind:   { name: 'Second Wind',   group: 'defence', text: 'The first time you drop below 30% HP, instantly heal 15% of your max HP.' },
  bulwark:       { name: 'Bulwark',       group: 'defence', text: 'Your shields and heals are 15% stronger.' },
  colossus:      { name: 'Colossus',      group: 'defence', text: '+15% max HP, −5% move speed.' },
  // offence
  glass_cannon:  { name: 'Glass Cannon',  group: 'offence', text: 'Deal 15% more damage, take 10% more damage.' },
  berserker:     { name: 'Berserker',     group: 'offence', text: 'Deal +1% damage for every 3% of HP you are missing (max +25%).' },
  executioner:   { name: 'Executioner',   group: 'offence', text: 'Deal 25% more damage to enemies below 30% HP.' },
  opportunist:   { name: 'Opportunist',   group: 'offence', text: 'Deal 20% more damage to stunned, rooted or slowed enemies.' },
  vampiric:      { name: 'Vampiric',      group: 'offence', text: 'Heal 8% of all damage you deal.' },
  pyromaniac:    { name: 'Pyromaniac',    group: 'offence', text: 'Your burns deal 25% more damage.' },
  venomous:      { name: 'Venomous',      group: 'offence', text: 'Your poisons and bleeds deal 30% more damage.' },
  thorns:        { name: 'Thorns',        group: 'offence', text: 'Melee attackers (melee and dash strikes) take 20% of the damage they deal to you.' },
  marksman:      { name: 'Marksman',      group: 'offence', text: 'Deal 15% more damage when the enemy is more than 300 units away.' },
  close_quarters:{ name: 'Close Quarters',group: 'offence', text: 'Deal 15% more damage when the enemy is within 120 units.' },
  momentum:      { name: 'Momentum',      group: 'offence', text: 'For 2 s after you start a dash, your next hit deals 30% more damage.' },
  duelist:       { name: 'Duelist',       group: 'offence', text: 'Your weapon attacks deal 15% more damage.' },
  spellblade:    { name: 'Spellblade',    group: 'offence', text: 'After you use an ability, your next weapon attack within 3 s deals 35% more damage.' },
  deadeye:       { name: 'Deadeye',       group: 'offence', text: '+8% crit chance, and your crits deal ×2.25 instead of ×2.' },
  // utility
  swift:         { name: 'Swift',         group: 'utility', text: '+10% move speed.' },
  focused:       { name: 'Focused',       group: 'utility', text: 'All cooldowns 15% shorter.' },
  efficient:     { name: 'Efficient',     group: 'utility', text: 'Abilities cost 10% less energy.' },
  deep_reserves: { name: 'Deep Reserves', group: 'utility', text: '+50 max energy.' },
  adrenaline:    { name: 'Adrenaline',    group: 'utility', text: '+60% energy regen while below 40% HP.' },
  quick_hands:   { name: 'Quick Hands',   group: 'utility', text: 'Windups 30% shorter.' },
  sharpshooter:  { name: 'Sharpshooter',  group: 'utility', text: 'Projectiles fly 25% faster and 20% farther.' },
  long_reach:    { name: 'Long Reach',    group: 'utility', text: 'Melee range +20 and melee arc +20°.' },
  blast_radius:  { name: 'Blast Radius',  group: 'utility', text: 'Area, zone and trap radius +20%.' },
  trapper:       { name: 'Trapper',       group: 'utility', text: 'Traps arm 50% faster and you may have 5 at once.' },
  riposte:       { name: 'Riposte',       group: 'utility', text: 'Counter windows last 50% longer and counter-strikes deal 30% more.' },
  arcane_flow:   { name: 'Arcane Flow',   group: 'utility', text: 'Heals, shields, buffs and cleanses cost 20% less energy.' },
  channeler:     { name: 'Channeler',     group: 'utility', text: 'Beams deal 20% more damage and turn 50% faster.' },
});
const TRAIT_IDS = Object.keys(TRAITS);

function round2(v) { return Math.round(v * 100) / 100; }
function round3(v) { return Math.round(v * 1000) / 1000; }
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

/** Everything the stats, traits and weapon add up to (shown by `check`, used by the simulation). */
function deriveStats(stats, traits, weaponId, relics) {
  const s = stats || {};
  const t = new Set(traits || []);
  const rl = new Set(relics || []);
  const w = WEAPONS[weaponId] ? weaponId : DEFAULT_WEAPON;
  let maxHp = STAT.hpBase + STAT.hpPer * (s.vitality || 0);
  let damageMult = 1 + STAT.powerPer * (s.power || 0);
  let takenMult = 1;
  let moveSpeed = STAT.speedBase + STAT.speedPer * (s.speed || 0);
  let maxEnergy = STAT.energyBase + STAT.energyPer * (s.energy || 0);
  let energyRegen = STAT.regenBase + STAT.regenPer * (s.regen || 0);
  let critChance = STAT.critPer * (s.crit || 0);
  let critMult = RULES.critMult;
  if (t.has('glass_cannon')) { damageMult *= 1.15; takenMult *= 1.1; }
  if (t.has('thick_skin')) takenMult *= 0.92;
  if (t.has('swift')) moveSpeed *= 1.1;
  if (t.has('colossus')) { maxHp *= 1.15; moveSpeed *= 0.95; }
  if (t.has('deep_reserves')) maxEnergy += 50;
  if (t.has('deadeye')) { critChance += 0.08; critMult = 2.25; }
  if (w === 'fists') moveSpeed *= 1.08;
  if (w === 'greatsword') moveSpeed *= 0.95;
  if (w === 'dagger') critChance += 0.12;
  if (w === 'pistol') critChance += 0.08;
  if (w === 'wand') energyRegen *= 1.15;
  if (rl.has('energy_crystal')) { maxEnergy += 60; energyRegen *= 1.2; }
  if (rl.has('winged_boots')) moveSpeed *= 1.12;
  if (rl.has('titan_belt')) maxHp *= 1.1;
  const armor = s.armor || 0;
  return {
    maxHp: Math.round(maxHp),
    damageMult: round3(damageMult),
    armor,
    takenMult: round3(takenMult),
    damageTaken: round3(takenMult * 100 / (100 + STAT.armorPer * armor)),
    moveSpeed: round2(moveSpeed),
    maxEnergy,
    energyRegen: round2(energyRegen),
    critChance: round3(Math.min(0.9, critChance)),
    critMult: round3(critMult + STAT.precisionCritPer * (s.precision || 0)),
    cooldownMult: round3(1 - STAT.hastePer * (s.haste || 0)),
    windupMult: round3(1 - STAT.hasteWindupPer * (s.haste || 0)),
    ccMult: round3(Math.max(0.2, 1 - STAT.tenacityPer * (s.tenacity || 0))),
    dotMult: round3(1 - STAT.tenacityDotPer * (s.tenacity || 0)),
    armorPen: round3(Math.min(0.8, STAT.precisionPer * (s.precision || 0))),
    projSpeedMult: round3(1 + STAT.precisionSpeedPer * (s.precision || 0)),
    hpRegen: round2(STAT.vigorRegenPer * (s.vigor || 0)),
    healMult: round3(1 + STAT.vigorHealPer * (s.vigor || 0)),
    chargeMult: round3((1 + STAT.focusChargePer * (s.focus || 0)) * (rl.has('scholars_tome') ? 1.6 : 1)),
    awakenBonus: round2(STAT.focusAwakenPer * (s.focus || 0)),
  };
}

// ── Ability schema ───────────────────────────────────────────────────────────
// `scale: true` fields have their maximum multiplied by the level's `power`.

const num = (min, max, def, extra) => Object.assign({ kind: 'number', min, max, def }, extra);
const int = (min, max, def, extra) => Object.assign({ kind: 'number', int: true, min, max, def }, extra);
const bool = (def) => ({ kind: 'bool', def });
const oneOf = (values, def, extra) => Object.assign({ kind: 'enum', values, def }, extra);
const REQ = { required: true };
const SCALE = { scale: true };
const REQ_SCALE = { required: true, scale: true };

const EFFECT_SCHEMA = {
  stun: num(0, 1.5, 0, SCALE),
  root: num(0, 2.5, 0, SCALE),
  silence: num(0, 2, 0, SCALE),
  slow: { kind: 'object', fields: { amount: num(0.1, 0.8, undefined, REQ), duration: num(0.3, 4, undefined, REQ) } },
  knockback: num(-350, 350, 0),
  burn: { kind: 'object', fields: { dps: num(5, 60, undefined, REQ_SCALE), duration: num(1, 5, undefined, REQ) } },
  poison: { kind: 'object', fields: { dps: num(5, 50, undefined, REQ_SCALE), duration: num(1, 8, undefined, REQ) } },
  vulnerable: { kind: 'object', fields: { amount: num(0.05, 0.4, undefined, REQ), duration: num(0.5, 5, undefined, REQ) } },
  weaken: { kind: 'object', fields: { amount: num(0.05, 0.4, undefined, REQ), duration: num(0.5, 5, undefined, REQ) } },
  drain: num(0, 80, 0, SCALE),
  lifesteal: num(0, 1, 0),
};
const EFFECT_KEYS = Object.keys(EFFECT_SCHEMA);

const EFFECT_INFO = {
  stun: 'seconds the target cannot move or act (interrupts windups; 2 s stun immunity afterwards)',
  root: 'seconds the target cannot move (it can still attack and cast; 1 s root immunity afterwards)',
  silence: 'seconds the target cannot use abilities (weapon attacks still work; 1 s immunity afterwards)',
  slow: '{amount 0.1–0.8, duration} — move speed reduced by amount',
  knockback: 'push the target this far (negative = pull it toward you); slams into obstacles stun briefly',
  burn: '{dps, duration} — fire damage over time (refreshes; the strongest burn wins)',
  poison: '{dps, duration} — damage over time that also halves healing received',
  vulnerable: '{amount 0.05–0.4, duration} — the target takes +amount damage',
  weaken: '{amount 0.05–0.4, duration} — the target deals −amount damage',
  drain: 'energy removed from the target (you gain half of it)',
  lifesteal: 'fraction of the damage dealt healed back (0–1)',
};

const COMMON_SCHEMA = {
  windup: num(0, 1.5, 0),
  cooldown: num(0.4, 30, 1),
};

const TYPE_SCHEMA = {
  melee: {
    damage: num(0, 300, undefined, REQ_SCALE),
    range: num(10, 160, 50),
    arc: num(30, 360, 90),
    hits: int(1, 4, 1),
    lunge: num(0, 120, 0),
    effects: 'effects',
  },
  projectile: {
    damage: num(0, 300, undefined, REQ_SCALE),
    speed: num(200, 1400, 700),
    radius: num(4, 40, 8),
    range: num(100, 1000, 700),
    count: int(1, 7, 1),
    spread: num(0, 120, 0),
    homing: num(0, 1, 0),
    bounce: int(0, 3, 0),
    returns: bool(false),
    effects: 'effects',
  },
  area: {
    damage: num(0, 300, undefined, REQ_SCALE),
    radius: num(40, 200, 120),
    target: oneOf(['self', 'point'], 'self'),
    range: num(0, 650, 0),
    delay: num(0, 2, 0),
    effects: 'effects',
  },
  zone: {
    dps: num(0, 100, undefined, REQ_SCALE),
    duration: num(1, 6, 3),
    radius: num(40, 160, 90),
    range: num(0, 700, 400),
    slow: num(0, 0.8, 0),
    pull: num(0, 160, 0),
    follow: bool(false),
  },
  dash: {
    distance: num(60, 420, undefined, REQ),
    damage: num(0, 250, 0, SCALE),
    invulnerable: bool(false),
    teleport: bool(false),
    effects: 'effects',
  },
  shield: {
    amount: num(20, 500, undefined, REQ_SCALE),
    duration: num(0.5, 8, 3),
  },
  heal: {
    amount: num(20, 500, undefined, REQ_SCALE),
    duration: num(0, 8, 0),
  },
  buff: {
    stat: oneOf(['power', 'armor', 'speed', 'haste', 'crit', 'tenacity'], undefined, REQ),
    amount: num(10, 100, undefined, REQ_SCALE),
    duration: num(1, 6, 4),
  },
  beam: {
    dps: num(10, 200, undefined, REQ_SCALE),
    duration: num(0.5, 3, 1.5),
    range: num(100, 650, 450),
    width: num(6, 40, 14),
    turnRate: num(0, 180, 60),
  },
  trap: {
    damage: num(0, 300, 0, SCALE),
    radius: num(20, 90, 40),
    arm: num(0.2, 2, 0.6),
    duration: num(3, 20, 10),
    range: num(0, 500, 300),
    effects: 'effects',
  },
  counter: {
    duration: num(0.2, 1.2, 0.6),
    damage: num(0, 300, 0, SCALE),
    range: num(40, 200, 120),
    effects: 'effects',
  },
  cleanse: {
    immunity: num(0, 2, 0),
  },
  turret: {
    damage: num(0, 120, undefined, REQ_SCALE),
    rate: num(0.3, 2, 1),          // shots per second
    duration: num(3, 12, 6),
    range: num(150, 600, 400),     // it shoots at the enemy when within this range (and in line of sight)
    speed: num(400, 1200, 800),    // shot speed
    place: num(0, 400, 150),       // how far from you it can be placed
    effects: 'effects',
  },
};

// An ultimate beam may channel longer and turn much faster (it can follow an enemy circling you).
const ULT_BEAM_SCHEMA = Object.assign({}, TYPE_SCHEMA.beam, { duration: num(0.5, 4, 1.5), turnRate: num(0, 360, 60) });

const ABILITY_TYPES = Object.keys(TYPE_SCHEMA);
const BUFF_STATS = TYPE_SCHEMA.buff.stat.values;
const BUFF_MAX = { armor: 50 };

const STYLES = {
  melee: ['slash', 'thrust', 'smash', 'claw'],
  projectile: ['orb', 'bolt', 'arrow', 'shard', 'fireball', 'wave'],
  area: ['nova', 'quake', 'frost', 'storm', 'meteor'],
  zone: ['fire', 'ice', 'poison', 'void', 'holy'],
  dash: ['charge', 'blink', 'shadow'],
  shield: ['bubble', 'barrier'],
  heal: ['glow', 'nature'],
  buff: ['aura', 'rage'],
  beam: ['laser', 'holy', 'void', 'fire', 'frost'],
  trap: ['spike', 'rune', 'mine', 'snare'],
  counter: ['parry', 'mirror'],
  cleanse: ['purify', 'shake'],
  turret: ['cannon', 'crystal', 'totem'],
};

const TYPE_BLURB = {
  melee: 'Strike in an arc in front of you. Hits if the enemy is within `range` of your body edge and inside the `arc`. `hits` = strikes per swing (damage is per strike); `lunge` = step forward that far as you strike.',
  projectile: 'Fire `count` projectiles toward the target. They fly straight (or curve with `homing`) until they hit, travel `range`, or hit an obstacle. `bounce` = ricochets off obstacles/walls; `returns` = boomerang that can hit again on the way back.',
  area: 'Burst of `radius`. `target: "self"` = centred on you (instant after the windup); `target: "point"` = at a point up to `range` away, exploding after `delay` s (telegraphed — dodgeable).',
  zone: 'Lingering circle at a point up to `range` away (or around you with `follow`). Deals `dps`, applies `slow`, and `pull` drags the enemy toward its centre (units/s) while they stand in it.',
  dash: 'Rush `distance` units toward the target (stops at the enemy or an obstacle; hits with damage/effects). `invulnerable` = can\'t be hit while dashing. `teleport` = blink instantly (no damage/effects allowed).',
  shield: 'Absorb up to `amount` damage for `duration` seconds.',
  heal: 'Restore `amount` HP — instantly, or spread over `duration` seconds. Poison halves healing.',
  buff: 'Boost `stat` by `amount` % for `duration` s: power (damage), armor (damage taken −%, max 50), speed, haste (cooldowns recover faster), crit (chance +%), tenacity (CC/DoT shorter −%). Cooldown must be at least 2× the duration.',
  beam: 'Channel a laser for `duration` s: `dps` to the enemy while it is within `width` of the line (up to `range`, blocked by obstacles). You are rooted while channelling and it turns toward your aim at `turnRate` °/s. Stuns/silences interrupt it.',
  trap: 'Place a trap at a point up to `range` away. It arms after `arm` s, then springs once when the enemy steps within `radius` (`damage` + effects). Lasts `duration` s; max 3 alive.',
  counter: 'Parry stance for `duration` s. The next hit you take (melee, projectile, dash, beam tick, trap) is negated; if the attacker is within `range` it takes `damage` + effects. Visible to the enemy (`enemy.countering`).',
  cleanse: 'Remove stun, root, silence, slow, burn, poison, bleed, vulnerable and weaken from yourself and be immune to them for `immunity` s. Works while stunned or silenced.',
  turret: 'Place a turret at a point up to `place` away. For `duration` s it fires a shot (`damage` + effects, `speed`) at the enemy `rate` times per second while the enemy is within `range` and in line of sight. Max 2 alive; cooldown must be at least the duration.',
};

// ── Energy cost formula ──────────────────────────────────────────────────────

function dotValue(total) { return 0.9 * total * (1 + total / RULES.dotTax); }

function hitValue(damage, fx) {
  const d = damage || 0;
  const e = fx || {};
  let v = d * (1 + d / RULES.burstTax);
  if (e.stun) v += 110 * e.stun;
  if (e.root) v += 60 * e.root;
  if (e.silence) v += 80 * e.silence;
  if (e.slow) v += 70 * e.slow.amount * e.slow.duration;
  if (e.knockback) v += 0.2 * Math.abs(e.knockback);
  if (e.burn) v += dotValue(e.burn.dps * e.burn.duration);
  if (e.poison) v += dotValue(e.poison.dps * e.poison.duration) + 10 * e.poison.duration;
  if (e.vulnerable) v += 110 * e.vulnerable.amount * e.vulnerable.duration;
  if (e.weaken) v += 100 * e.weaken.amount * e.weaken.duration;
  if (e.drain) v += 0.8 * e.drain;
  if (e.lifesteal) v += 1.2 * e.lifesteal * d;
  return v;
}

const BUFF_WEIGHT = { power: 150, armor: 130, speed: 60, haste: 110, crit: 100, tenacity: 50 };

function abilityCost(ab) {
  let value = 0;
  let delivery = 1;
  switch (ab.type) {
    case 'melee':
      value = (ab.hits || 1) * hitValue(ab.damage, ab.effects) + 0.15 * (ab.lunge || 0);
      delivery = 0.55 + ab.range / 500 + ab.arc / 1500;
      break;
    case 'projectile':
      value = ab.count * hitValue(ab.damage, ab.effects) * (ab.returns ? 1.35 : 1);
      delivery = 0.6 + ab.speed / 3000 + ab.radius / 150 + ab.range / 4000 + 0.5 * ab.homing + 0.08 * (ab.bounce || 0);
      break;
    case 'area':
      value = hitValue(ab.damage, ab.effects);
      delivery = ab.target === 'point'
        ? Math.max(0.3, 0.55 + ab.radius / 250 + ab.range / 1000 - 0.15 * Math.min(ab.delay, 1.5))
        : 0.55 + ab.radius / 250;
      break;
    case 'zone': {
      const total = ab.dps * ab.duration;
      value = 0.9 * total * (1 + total / 500) + 45 * ab.slow * ab.duration + 0.4 * (ab.pull || 0) * ab.duration;
      delivery = (0.5 + ab.radius / 300 + ab.range / 2000) * (ab.follow ? 1.3 : 1);
      break;
    }
    case 'dash':
      value = 0.2 * ab.distance + (ab.invulnerable ? 25 + 0.1 * ab.distance : 0) + 0.9 * hitValue(ab.damage, ab.effects);
      if (ab.teleport) value *= 1.4;
      break;
    case 'shield':
      value = ab.amount * (0.55 + 0.08 * Math.min(ab.duration, 6)) * (1 + ab.amount / 800);
      break;
    case 'heal':
      value = ab.amount * ((ab.duration > 0 ? 1.4 : 1.5) + ab.amount / 500);
      break;
    case 'buff':
      value = (ab.amount / 100) * ab.duration * BUFF_WEIGHT[ab.stat];
      break;
    case 'beam': {
      const total = ab.dps * ab.duration;
      value = dotValue(total);
      delivery = 0.6 + ab.range / 1200 + ab.width / 80 + ab.turnRate / 200;
      break;
    }
    case 'trap':
      value = hitValue(ab.damage, ab.effects) * (0.8 + ab.duration / 60);
      delivery = 0.3 + ab.radius / 200;
      break;
    case 'counter':
      value = 40 + 60 * ab.duration + 0.5 * hitValue(ab.damage, ab.effects);
      break;
    case 'cleanse':
      value = 90 + 80 * ab.immunity;
      break;
    case 'turret':
      // turret shots are slowish and dodgeable, so each one is worth less than a direct projectile
      value = 0.45 * hitValue(ab.damage, ab.effects) * ab.rate * ab.duration;
      delivery = 0.5 + ab.range / 1500 + ab.speed / 4000 + ab.place / 2000;
      break;
    default:
      break;
  }
  const windupMod = 1 - 0.4 * Math.min(ab.windup, 1);
  const cooldownMod = clamp(1.35 - 0.075 * ab.cooldown, 0.6, 1.35);
  const energy = Math.max(1, Math.round(RULES.energyScale * value * delivery * windupMod * cooldownMod));
  return {
    value: round2(value),
    delivery: round2(delivery),
    windupMod: round2(windupMod),
    cooldownMod: round2(cooldownMod),
    energy,
  };
}

// Traits and stats that change how an ability behaves (cost is always computed from the design).
function applyModifiers(ab, traits, derived) {
  const t = new Set(traits || []);
  const notes = [];
  const set = (k, v, why) => { if (ab[k] !== v) { notes.push(`${why}: ${k} ${fmtNum(ab[k])} → ${fmtNum(v)}`); ab[k] = v; } };
  if (!ab.basic && t.has('efficient')) set('energy', Math.max(1, Math.round(ab.energy * 0.9)), 'Efficient');
  if (!ab.basic && t.has('arcane_flow') && ['heal', 'shield', 'buff', 'cleanse'].includes(ab.type)) set('energy', Math.max(1, Math.round(ab.energy * 0.8)), 'Arcane Flow');
  if (t.has('focused')) set('cooldown', round2(ab.cooldown * 0.85), 'Focused');
  if (derived && derived.cooldownMult < 1) set('cooldown', round2(Math.max(0.2, ab.cooldown * derived.cooldownMult)), 'Haste');
  if (t.has('quick_hands') && ab.windup > 0) set('windup', round2(ab.windup * 0.7), 'Quick Hands');
  if (derived && derived.windupMult < 1 && ab.windup > 0) set('windup', round2(ab.windup * derived.windupMult), 'Haste');
  if (ab.type === 'projectile') {
    if (t.has('sharpshooter')) { set('speed', Math.round(ab.speed * 1.25), 'Sharpshooter'); set('range', Math.round(ab.range * 1.2), 'Sharpshooter'); }
    if (derived && derived.projSpeedMult > 1) set('speed', Math.round(ab.speed * derived.projSpeedMult), 'Precision');
  }
  if (t.has('long_reach') && ab.type === 'melee') { set('range', ab.range + 20, 'Long Reach'); set('arc', Math.min(360, ab.arc + 20), 'Long Reach'); }
  if (t.has('blast_radius') && ['area', 'zone', 'trap'].includes(ab.type)) set('radius', Math.round(ab.radius * 1.2), 'Blast Radius');
  if (t.has('bulwark') && (ab.type === 'shield' || ab.type === 'heal')) set('amount', Math.round(ab.amount * 1.15), 'Bulwark');
  if (t.has('trapper') && ab.type === 'trap') set('arm', round2(ab.arm * 0.5), 'Trapper');
  if (t.has('riposte') && ab.type === 'counter') { set('duration', round2(ab.duration * 1.5), 'Riposte'); if (ab.damage) set('damage', Math.round(ab.damage * 1.3), 'Riposte'); }
  if (t.has('channeler') && ab.type === 'beam') { set('dps', Math.round(ab.dps * 1.2), 'Channeler'); set('turnRate', Math.round(ab.turnRate * 1.5), 'Channeler'); }
  if (ab.effects && ab.effects.burn && t.has('pyromaniac')) {
    const dps = round2(ab.effects.burn.dps * 1.25);
    notes.push(`Pyromaniac: burn ${fmtNum(ab.effects.burn.dps)}/s → ${fmtNum(dps)}/s`);
    ab.effects = Object.assign({}, ab.effects, { burn: Object.assign({}, ab.effects.burn, { dps }) });
  }
  if (ab.effects && ab.effects.poison && t.has('venomous')) {
    const dps = round2(ab.effects.poison.dps * 1.3);
    notes.push(`Venomous: poison ${fmtNum(ab.effects.poison.dps)}/s → ${fmtNum(dps)}/s`);
    ab.effects = Object.assign({}, ab.effects, { poison: Object.assign({}, ab.effects.poison, { dps }) });
  }
  return notes;
}

// Human friendly "reach" of an ability (used by UI + brain state).
function abilityReach(ab) {
  const R = RULES.fighterRadius;
  switch (ab.type) {
    case 'melee': return 2 * R + ab.range + (ab.lunge || 0);   // centre-to-centre distance that still hits
    case 'projectile': return ab.range;
    case 'area': return ab.target === 'point' ? ab.range + ab.radius : ab.radius + R;
    case 'zone': return ab.follow ? ab.radius : ab.range + ab.radius;
    case 'dash': return ab.distance + 2 * R;
    case 'beam': return ab.range;
    case 'trap': return ab.range + ab.radius;
    case 'counter': return ab.range;
    case 'turret': return ab.place + ab.range;
    default: return 0;
  }
}

// ── Validation ───────────────────────────────────────────────────────────────

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const TOP_LEVEL_KEYS = new Set(['name', 'title', 'catchphrase', 'description', 'notes', 'colors', 'stats', 'traits', 'abilities', 'weapon', 'look', '$schema', 'version',
  'stance', 'ultimate', 'relics', 'offhand', 'awakening', 'godPowers']);
const DEFAULT_COLORS = { primary: '#8ab4ff', secondary: '#1d2b53' };

function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
function fmtNum(v) { return typeof v === 'number' ? (Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000)) : String(v); }

function scaledMax(rule, power) {
  if (!rule.scale) return rule.max;
  const m = rule.max * power;
  return rule.max >= 10 ? Math.round(m) : Math.round(m * 100) / 100;
}

function capLadder(rule) {
  return [1, 3, 5, 8, 11].map(l => `L${l} ${fmtNum(scaledMax(rule, LEVELS[l].power))}`).join(', ');
}

function checkField(value, rule, path, errors, lvl) {
  if (value === undefined || value === null) {
    if (rule.required) { errors.push(`${path} is required`); }
    return rule.def;
  }
  if (rule.kind === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) { errors.push(`${path} must be a number (got ${JSON.stringify(value)})`); return rule.def; }
    if (rule.int && !Number.isInteger(value)) { errors.push(`${path} must be a whole number (got ${value})`); return Math.round(value); }
    const max = scaledMax(rule, lvl.power);
    if (value < rule.min) { errors.push(`${path} = ${fmtNum(value)} is below the minimum ${rule.min}`); return rule.min; }
    if (value > max) {
      errors.push(rule.scale && max < rule.max
        ? `${path} = ${fmtNum(value)} is above the level ${lvl.level} cap of ${fmtNum(max)} (caps grow as you level up: ${capLadder(rule)})`
        : `${path} = ${fmtNum(value)} is out of range [${rule.min} – ${rule.max}]`);
      return max;
    }
    return value;
  }
  if (rule.kind === 'bool') {
    if (typeof value !== 'boolean') { errors.push(`${path} must be true or false`); return rule.def; }
    return value;
  }
  if (rule.kind === 'enum') {
    if (!rule.values.includes(value)) { errors.push(`${path} must be one of: ${rule.values.join(', ')} (got ${JSON.stringify(value)})`); return rule.def; }
    return value;
  }
  return value;
}

function validateEffects(raw, path, errors, warnings, lvl) {
  const out = {};
  if (raw === undefined || raw === null) return out;
  if (!isObj(raw)) { errors.push(`${path} must be an object like {"stun": 0.5}`); return out; }
  for (const key of Object.keys(raw)) {
    const rule = EFFECT_SCHEMA[key];
    if (!rule) { errors.push(`${path}.${key} is not a known effect (use: ${EFFECT_KEYS.join(', ')})`); continue; }
    const v = raw[key];
    if (rule.kind === 'object') {
      if (v === 0 || v === null || v === false) continue;
      if (!isObj(v)) { errors.push(`${path}.${key} must be an object with ${Object.keys(rule.fields).join(' and ')}`); continue; }
      const o = {};
      for (const f of Object.keys(rule.fields)) o[f] = checkField(v[f], rule.fields[f], `${path}.${key}.${f}`, errors, lvl);
      for (const f of Object.keys(v)) if (!rule.fields[f]) warnings.push(`${path}.${key}.${f} is not used (ignored)`);
      out[key] = o;
    } else {
      const n = checkField(v, rule, `${path}.${key}`, errors, lvl);
      if (n) out[key] = n;
    }
  }
  return out;
}

// Lazily load the godly powers catalogue (engine/powers.js) so the rules work without it.
let powersModule;
function powers() {
  if (powersModule !== undefined) return powersModule;
  try { powersModule = require('./powers'); } catch { powersModule = null; }
  return powersModule;
}

// Lazily load the look system (engine/look.js) so the rules work without it.
let lookModule;
function looks() {
  if (lookModule) return lookModule;
  try { lookModule = require('./look'); } catch { lookModule = null; }
  return lookModule;
}

function validateAbility(raw, i, errors, warnings, lvlIn, opts = {}) {
  const ult = !!opts.ultimate;
  const path = ult ? 'ultimate' : `abilities[${i}]`;
  // ultimates get bigger caps (their power is limited by a budget instead of energy)
  const lvl = ult ? Object.assign({}, lvlIn, { power: lvlIn.power * RULES.ultCapMult }) : lvlIn;
  if (!isObj(raw)) { errors.push(`${path} must be an object`); return null; }
  const ab = { index: i };
  if (typeof raw.name !== 'string' || !raw.name.trim()) errors.push(`${path}.name is required (a short string)`);
  ab.name = String(raw.name || `Ability ${i + 1}`).trim().slice(0, 24);
  if (typeof raw.name === 'string' && raw.name.trim().length > 24) warnings.push(`${path}.name is longer than 24 characters (truncated)`);
  if (ab.name.toLowerCase() === 'attack') errors.push(`${path}.name "attack" is reserved for your weapon attack`);
  if (!ABILITY_TYPES.includes(raw.type)) {
    errors.push(`${path}.type must be one of: ${ABILITY_TYPES.join(', ')} (got ${JSON.stringify(raw.type)})`);
    return null;
  }
  ab.type = raw.type;
  if ((TYPE_UNLOCK[ab.type] || 1) > lvlIn.level) errors.push(`${path}: ${ab.type} abilities unlock at level ${TYPE_UNLOCK[ab.type]} (you are level ${lvlIn.level})`);
  const schema = ult && ab.type === 'beam' ? ULT_BEAM_SCHEMA : TYPE_SCHEMA[ab.type];
  const known = new Set(['name', 'type', 'color', 'style', 'description', ...Object.keys(COMMON_SCHEMA), ...Object.keys(schema)]);
  for (const key of Object.keys(COMMON_SCHEMA)) ab[key] = checkField(raw[key], COMMON_SCHEMA[key], `${path}.${key}`, errors, lvl);
  for (const key of Object.keys(schema)) {
    if (schema[key] === 'effects') ab.effects = validateEffects(raw.effects, `${path}.effects`, errors, warnings, lvl);
    else ab[key] = checkField(raw[key], schema[key], `${path}.${key}`, errors, lvl);
  }
  // type-specific rules (cooldown rules don't apply to ultimates: they are charged instead)
  if (ab.type === 'buff') {
    const cap = BUFF_MAX[ab.stat];
    if (cap && ab.amount > cap) { errors.push(`${path}.amount = ${ab.amount}: a ${ab.stat} buff can be at most ${cap} (%)`); ab.amount = cap; }
    if (!ult && ab.cooldown < 2 * ab.duration) errors.push(`${path}: a buff's cooldown (${fmtNum(ab.cooldown)} s) must be at least twice its duration (${fmtNum(ab.duration)} s) — no permanent buffs`);
  }
  if (!ult) {
    if (ab.type === 'shield' && ab.cooldown < ab.duration + 2) errors.push(`${path}: a shield's cooldown (${fmtNum(ab.cooldown)} s) must be at least its duration + 2 s (${fmtNum(ab.duration + 2)} s)`);
    if (ab.type === 'heal' && ab.duration > 0 && ab.cooldown < ab.duration) errors.push(`${path}: a heal-over-time's cooldown must be at least its duration`);
    if (ab.type === 'counter' && ab.cooldown < ab.duration + 2) errors.push(`${path}: a counter's cooldown must be at least its duration + 2 s`);
    if (ab.type === 'cleanse' && ab.cooldown < 6) errors.push(`${path}: a cleanse's cooldown must be at least 6 s`);
    if (ab.type === 'beam' && ab.cooldown < ab.duration + 1) errors.push(`${path}: a beam's cooldown must be at least its duration + 1 s`);
  }
  if (ab.type === 'dash' && ab.teleport && (ab.damage > 0 || Object.keys(ab.effects || {}).length)) errors.push(`${path}: a teleport dash can't carry damage or effects`);
  if (ab.type === 'turret' && !ult && ab.cooldown < ab.duration) errors.push(`${path}: a turret's cooldown (${fmtNum(ab.cooldown)} s) must be at least its duration (${fmtNum(ab.duration)} s)`);
  if (ab.type === 'area') {
    if (ab.target === 'point' && ab.range <= 0) errors.push(`${path}: target "point" needs a range above 0`);
    if (ab.target === 'self' && (ab.range > 0 || ab.delay > 0)) warnings.push(`${path}: range/delay only apply to target "point" areas (ignored)`);
    if (ab.target === 'self') { ab.range = 0; ab.delay = 0; }
  }
  if (ab.type === 'melee' && ab.hits > 1 && ab.damage === 0) warnings.push(`${path}: hits > 1 with 0 damage does nothing extra`);
  if (ab.type === 'projectile' && ab.count > 1 && ab.spread === 0) warnings.push(`${path}: count ${ab.count} with spread 0 fires all projectiles on top of each other`);
  if (raw.effects !== undefined && !TYPE_SCHEMA[ab.type].effects) warnings.push(`${path}.effects is ignored — ${ab.type} abilities can't carry hit effects`);
  for (const key of Object.keys(raw)) if (!known.has(key) && !(key === 'effects')) warnings.push(`${path}.${key} is not a field of a ${ab.type} ability (ignored)`);
  if (raw.color !== undefined) {
    if (typeof raw.color === 'string' && HEX.test(raw.color)) ab.color = raw.color;
    else warnings.push(`${path}.color must be a hex colour like "#ff8800" (ignored)`);
  }
  if (raw.style !== undefined) {
    if (STYLES[ab.type].includes(raw.style)) ab.style = raw.style;
    else warnings.push(`${path}.style for ${ab.type} can be: ${STYLES[ab.type].join(', ')} (ignored)`);
  }
  if (!ab.style) ab.style = STYLES[ab.type][0];
  if (typeof raw.description === 'string') ab.description = raw.description.slice(0, 140);
  if (!ab.effects) ab.effects = {};
  if (ult) {
    // no energy, no cooldown: charged by fighting. Power is limited by a budget instead.
    if (ab.windup < RULES.ultMinWindup) { ab.windup = RULES.ultMinWindup; }   // the charge-up (not a warning: it's the rule)
    const raw = abilityCost(Object.assign({}, ab, { cooldown: 14 / 3 }));  // neutral cooldownMod = 1
    const kind = ab.type === 'area' ? (ab.target === 'point' ? 'meteor' : 'nova') : ab.type === 'projectile' && ab.count > 1 ? 'volley' : ab.type;
    const risk = ULT_TYPE_COST[kind] || 1;
    const cost = Object.assign({}, raw, { energy: Math.round(raw.energy * risk), risk });
    const budget = Math.round(RULES.ultBudget * lvlIn.power);
    ab.ultimate = true;
    ab.ultCost = cost.energy;
    ab.ultBudget = budget;
    if (cost.energy > budget) errors.push(`ultimate "${ab.name}" is too strong: it is worth ${cost.energy} but your level ${lvlIn.level} ultimate budget is ${budget} (budget = ${RULES.ultBudget} × power cap)`);
    ab.cooldown = 0;
    ab.energy = 0;
    ab.cost = Object.assign({}, cost, { energy: 0 });
    return ab;
  }
  const cost = abilityCost(ab);
  ab.energy = cost.energy;
  ab.cost = cost;
  return ab;
}

/** The weapon's basic attack as an ability object (free, scaled to the level). */
function weaponAttack(weaponId, level, index) {
  const w = WEAPONS[weaponId] || WEAPONS[DEFAULT_WEAPON];
  const a = w.attack;
  const scale = weaponScale(level);
  const ab = {
    index, basic: true, weapon: WEAPONS[weaponId] ? weaponId : DEFAULT_WEAPON,
    name: a.name, type: a.type, style: a.style,
    windup: a.windup || 0, cooldown: a.cooldown,
    damage: Math.round(a.damage * scale),
    effects: JSON.parse(JSON.stringify(a.effects || {})),
    description: `${w.name} attack. ${w.passiveText}`,
  };
  if (a.type === 'melee') Object.assign(ab, { range: a.range, arc: a.arc, hits: 1, lunge: 0 });
  else Object.assign(ab, { speed: a.speed, radius: a.radius, range: a.range, count: 1, spread: 0, homing: a.homing || 0, bounce: 0, returns: false });
  if (ab.effects.slow) ab.effects.slow = { amount: ab.effects.slow.amount, duration: ab.effects.slow.duration };
  ab.energy = 0;
  ab.cost = { value: 0, delivery: 0, windupMod: 1, cooldownMod: 1, energy: 0 };
  return ab;
}

function weaponInfo(weaponId, level) {
  const id = WEAPONS[weaponId] ? weaponId : DEFAULT_WEAPON;
  const w = WEAPONS[id];
  return { id, name: w.name, kind: w.kind, passive: w.passive, passiveText: w.passiveText, attackName: w.attack.name, scale: round3(weaponScale(level)) };
}

/**
 * Validate a fighter definition (the parsed fighter.json) at a level.
 * Returns { ok, errors, warnings, spec } — `spec` is always filled as best as
 * possible so the UI can still render a half-finished fighter.
 */
function validateFighter(raw, { level = MAX_LEVEL } = {}) {
  const lvl = levelInfo(level);
  const errors = [];
  const warnings = [];
  const spec = {
    name: 'Unnamed Fighter', title: '', catchphrase: '', description: '', notes: '',
    colors: { ...DEFAULT_COLORS },
    stats: Object.fromEntries(STAT_KEYS.map(k => [k, 0])),
    traits: [],
    weapon: weaponInfo(DEFAULT_WEAPON, lvl.level),
    look: null,
    stance: 'balanced', relics: [], offhand: null, awakening: null, godPowers: [],
    ultIdx: -1, basicIdx: 0, offIdx: -1,
    derived: null, abilities: [], pointsUsed: 0, level: lvl.level,
  };
  if (!isObj(raw)) {
    errors.push('fighter.json must contain a JSON object');
    spec.derived = deriveStats(spec.stats, [], DEFAULT_WEAPON);
    spec.abilities.push(weaponAttack(DEFAULT_WEAPON, lvl.level, 0));
    return { ok: false, errors, warnings, spec };
  }
  for (const key of Object.keys(raw)) if (!TOP_LEVEL_KEYS.has(key)) warnings.push(`"${key}" is not a known top-level field (ignored)`);

  if (typeof raw.name !== 'string' || !raw.name.trim()) errors.push('name is required');
  else spec.name = raw.name.trim().slice(0, 32);
  const text = (key, max) => {
    if (raw[key] === undefined) return '';
    if (typeof raw[key] !== 'string') { warnings.push(`${key} should be a string`); return ''; }
    if (raw[key].length > max) warnings.push(`${key} is longer than ${max} characters (truncated)`);
    return raw[key].slice(0, max);
  };
  spec.title = text('title', 48);
  spec.catchphrase = text('catchphrase', 80);
  spec.description = text('description', 300);
  spec.notes = text('notes', 1500);

  if (raw.colors !== undefined) {
    if (!isObj(raw.colors)) warnings.push('colors should be {"primary": "#hex", "secondary": "#hex"}');
    else for (const k of ['primary', 'secondary']) {
      if (raw.colors[k] === undefined) continue;
      if (typeof raw.colors[k] === 'string' && HEX.test(raw.colors[k])) spec.colors[k] = raw.colors[k];
      else warnings.push(`colors.${k} must be a hex colour like "#ff8800"`);
    }
  }

  // weapon
  let weaponId = DEFAULT_WEAPON;
  if (raw.weapon !== undefined) {
    if (typeof raw.weapon === 'string' && WEAPONS[raw.weapon]) weaponId = raw.weapon;
    else errors.push(`weapon ${JSON.stringify(raw.weapon)} is not a weapon (choose: ${WEAPON_IDS.join(', ')} — see \`node arena.js weapons\`)`);
  }
  spec.weapon = weaponInfo(weaponId, lvl.level);

  // look (cosmetic)
  if (raw.look !== undefined) {
    const lm = looks();
    if (!lm) { warnings.push('look: the look system is not installed — your look is ignored'); }
    else {
      try {
        const r = lm.validateLook(raw.look, { colors: isObj(raw.colors) ? raw.colors : undefined });
        spec.look = r.look || null;
        for (const e of r.errors || []) errors.push(`look: ${e}`);
        for (const w of r.warnings || []) warnings.push(`look: ${w}`);
      } catch (e) {
        warnings.push(`look: could not be read (${e.message})`);
      }
    }
  }

  // stats
  if (!isObj(raw.stats)) errors.push(`stats is required: {${STAT_KEYS.map(k => `"${k}": n`).join(', ')}}`);
  else {
    for (const key of Object.keys(raw.stats)) if (!STAT_KEYS.includes(key)) errors.push(`stats.${key} is not a stat (use: ${STAT_KEYS.join(', ')})`);
    let total = 0;
    for (const key of STAT_KEYS) {
      const v = raw.stats[key] === undefined ? 0 : raw.stats[key];
      if (typeof v !== 'number' || !Number.isInteger(v)) { errors.push(`stats.${key} must be a whole number`); continue; }
      if (v < 0) errors.push(`stats.${key} = ${v} can't be negative`);
      else if (v > lvl.statMax) errors.push(`stats.${key} = ${v} is above the level ${lvl.level} cap of ${lvl.statMax} per stat`);
      else if (v > 0 && (STAT_UNLOCK[key] || 1) > lvl.level) errors.push(`stats.${key}: ${key} unlocks at level ${STAT_UNLOCK[key]} (you are level ${lvl.level})`);
      spec.stats[key] = clamp(v, 0, lvl.statMax);
      total += v;
    }
    spec.pointsUsed = total;
    if (total > lvl.statPoints) errors.push(`stats use ${total} points but the level ${lvl.level} budget is ${lvl.statPoints}`);
    else if (total < lvl.statPoints) warnings.push(`only ${total}/${lvl.statPoints} stat points spent (${lvl.statPoints - total} unspent)`);
  }

  // traits
  if (raw.traits !== undefined && !Array.isArray(raw.traits)) errors.push('traits must be an array of trait ids, e.g. ["thick_skin"]');
  const tlist = Array.isArray(raw.traits) ? raw.traits : [];
  const seen = new Set();
  for (const [i, t] of tlist.entries()) {
    if (typeof t !== 'string' || !TRAITS[t]) { errors.push(`traits[${i}] ${JSON.stringify(t)} is not a trait (see \`node arena.js traits\`)`); continue; }
    if (seen.has(t)) { errors.push(`trait "${t}" is listed twice`); continue; }
    seen.add(t);
    spec.traits.push(t);
  }
  if (spec.traits.length > lvl.traitSlots) {
    errors.push(lvl.traitSlots === 0
      ? `no trait slots at level ${lvl.level} — traits unlock at level 2`
      : `${spec.traits.length} traits but level ${lvl.level} only has ${lvl.traitSlots} trait slot${lvl.traitSlots === 1 ? '' : 's'}`);
  }
  // relics (level 6 / 9 / 11)
  if (raw.relics !== undefined && !Array.isArray(raw.relics)) errors.push('relics must be an array of relic ids, e.g. ["hourglass"]');
  const rlist = Array.isArray(raw.relics) ? raw.relics : [];
  for (const [i, r] of rlist.entries()) {
    if (typeof r !== 'string' || !RELICS[r]) { errors.push(`relics[${i}] ${JSON.stringify(r)} is not a relic (see \`node arena.js relics\`)`); continue; }
    if (spec.relics.includes(r)) { errors.push(`relic "${r}" is listed twice`); continue; }
    spec.relics.push(r);
  }
  if (spec.relics.length > lvl.relicSlots) {
    errors.push(lvl.relicSlots === 0
      ? `no relic slots at level ${lvl.level} — relics unlock at level ${FEATURE_UNLOCK.relics}`
      : `${spec.relics.length} relics but level ${lvl.level} only has ${lvl.relicSlots} relic slot${lvl.relicSlots === 1 ? '' : 's'}`);
  }

  // stance (level 3+): the stance you start the fight in
  if (raw.stance !== undefined) {
    if (!STANCES[raw.stance]) errors.push(`stance must be one of: ${STANCE_IDS.join(', ')} (got ${JSON.stringify(raw.stance)})`);
    else if (raw.stance !== 'balanced' && !unlocked('stances', lvl.level)) errors.push(`stances unlock at level ${FEATURE_UNLOCK.stances}`);
    else spec.stance = raw.stance;
  }

  // off-hand weapon (level 7+)
  let offId = null;
  if (raw.offhand !== undefined && raw.offhand !== null) {
    if (!unlocked('offhand', lvl.level)) errors.push(`an off-hand weapon unlocks at level ${FEATURE_UNLOCK.offhand}`);
    else if (typeof raw.offhand !== 'string' || !WEAPONS[raw.offhand]) errors.push(`offhand ${JSON.stringify(raw.offhand)} is not a weapon (choose: ${WEAPON_IDS.join(', ')})`);
    else if (raw.offhand === weaponId) errors.push('offhand must be a different weapon from your main weapon');
    else { offId = raw.offhand; spec.offhand = weaponInfo(offId, lvl.level); }
  }

  // awakening flavour (level 8+; the power-up itself is automatic)
  if (raw.awakening !== undefined && raw.awakening !== null) {
    if (!unlocked('awakening', lvl.level)) warnings.push(`awakening unlocks at level ${FEATURE_UNLOCK.awakening} (ignored)`);
    else if (!isObj(raw.awakening)) warnings.push('awakening should be {"name": "...", "color": "#hex"} (ignored)');
    else {
      spec.awakening = {
        name: typeof raw.awakening.name === 'string' && raw.awakening.name.trim() ? raw.awakening.name.trim().slice(0, 24) : (unlocked('ascension', lvl.level) ? 'Ascension' : 'Awakening'),
        color: typeof raw.awakening.color === 'string' && HEX.test(raw.awakening.color) ? raw.awakening.color : spec.colors.primary,
      };
    }
  }

  // godly powers (level 10: 1, level 12: 2) — catalogue in engine/powers.js
  if (raw.godPowers !== undefined && raw.godPowers !== null) {
    const ids = Array.isArray(raw.godPowers) ? raw.godPowers : [raw.godPowers];
    if (!ids.length) { /* nothing */ } else if (lvl.godSlots === 0) errors.push(`godly powers unlock at level ${FEATURE_UNLOCK.godPowers}`);
    else {
      const pm = powers();
      if (!pm) errors.push('godly powers are not available in this build');
      else {
        const r = pm.validate(ids, lvl.level);
        for (const e of r.errors || []) errors.push(`godPowers: ${e}`);
        for (const w of r.warnings || []) warnings.push(`godPowers: ${w}`);
        const list = (r.list || []).slice(0, lvl.godSlots);
        if ((r.list || []).length > lvl.godSlots) errors.push(`${r.list.length} godly powers but level ${lvl.level} only has ${lvl.godSlots} slot${lvl.godSlots === 1 ? '' : 's'}`);
        spec.godPowers = list.map(id => Object.assign({ id }, pm.GOD_POWERS[id] ? { name: pm.GOD_POWERS[id].name, color: pm.GOD_POWERS[id].color, blurb: pm.GOD_POWERS[id].blurb } : {}));
      }
    }
  }

  spec.derived = deriveStats(spec.stats, spec.traits, weaponId, spec.relics);
  if (offId) spec.derivedOff = deriveStats(spec.stats, spec.traits, offId, spec.relics);
  if (unlocked('awakening', lvl.level)) {
    spec.derived.awakenSeconds = round2((unlocked('ascension', lvl.level) ? 10 : 8) + spec.derived.awakenBonus);
    if (spec.derivedOff) spec.derivedOff.awakenSeconds = spec.derived.awakenSeconds;
  }

  // abilities
  if (raw.abilities !== undefined && !Array.isArray(raw.abilities)) errors.push('abilities must be an array');
  const list = Array.isArray(raw.abilities) ? raw.abilities : [];
  if (list.length > lvl.abilitySlots) errors.push(`${list.length} abilities but level ${lvl.level} only has ${lvl.abilitySlots} ability slots`);
  const names = new Set();
  const basicName = WEAPONS[weaponId].attack.name.toLowerCase();
  list.slice(0, RULES.maxAbilities).forEach((a, i) => {
    const ab = validateAbility(a, i, errors, warnings, lvl);
    if (!ab) return;
    const key = ab.name.toLowerCase();
    if (names.has(key)) errors.push(`abilities[${i}].name "${ab.name}" is used twice — names must be unique`);
    if (key === basicName) errors.push(`abilities[${i}].name "${ab.name}" is the name of your weapon attack — pick another name`);
    names.add(key);
    ab.design = { cooldown: ab.cooldown, windup: ab.windup, energy: ab.energy };
    ab.traitNotes = applyModifiers(ab, spec.traits, spec.derived);
    ab.reach = abilityReach(ab);
    if (ab.energy > spec.derived.maxEnergy) errors.push(`abilities[${i}] "${ab.name}" costs ${ab.energy} energy but your max energy is only ${Math.round(spec.derived.maxEnergy)} — it could never be cast`);
    spec.abilities.push(ab);
  });
  // ultimate (level 5+): after your abilities
  if (raw.ultimate !== undefined && raw.ultimate !== null) {
    if (!unlocked('ultimate', lvl.level)) errors.push(`the ultimate unlocks at level ${FEATURE_UNLOCK.ultimate}`);
    else {
      const ab = validateAbility(raw.ultimate, spec.abilities.length, errors, warnings, lvl, { ultimate: true });
      if (ab) {
        const key = ab.name.toLowerCase();
        if (names.has(key) || key === basicName || key === 'ultimate') errors.push(`ultimate.name "${ab.name}" is already used — pick another name`);
        ab.design = { cooldown: 0, windup: ab.windup, energy: 0 };
        const cdBefore = ab.cooldown;
        ab.traitNotes = applyModifiers(ab, spec.traits, spec.derived);
        ab.cooldown = cdBefore;                           // ultimates have no cooldown (they are charged)
        ab.energy = 0;
        ab.traitNotes = ab.traitNotes.filter(n => !/cooldown|energy/.test(n));
        ab.reach = abilityReach(ab);
        spec.abilities.push(ab);
        spec.ultIdx = spec.abilities.length - 1;
      }
    }
  }
  // weapon attacks: main weapon, then the off-hand (level 7+)
  const addBasic = (wid, off) => {
    const b = weaponAttack(wid, lvl.level, spec.abilities.length);
    if (off) b.offhand = true;
    b.design = { cooldown: b.cooldown, windup: b.windup, energy: 0 };
    b.traitNotes = applyModifiers(b, spec.traits, spec.derived);
    b.reach = abilityReach(b);
    spec.abilities.push(b);
    return spec.abilities.length - 1;
  };
  spec.basicIdx = addBasic(weaponId, false);
  if (offId) {
    const offName = WEAPONS[offId].attack.name.toLowerCase();
    if (names.has(offName)) errors.push(`an ability is named "${WEAPONS[offId].attack.name}", the name of your off-hand weapon's attack — pick another name`);
    if (offName === basicName) warnings.push('both weapons have the same attack name — use util.basic(s) to get the active one');
    spec.offIdx = addBasic(offId, true);
  }
  spec.abilities.forEach((ab, i) => { ab.index = i; });
  if (list.length === 0) warnings.push(`no abilities — your fighter only has its weapon attack (${spec.abilities[spec.basicIdx].name})`);

  return { ok: errors.length === 0, errors, warnings, spec };
}

// Everything that affects the fight — used to enforce the round-1 mirror.
function mechanicsSignature(spec) {
  const abil = spec.abilities.map(a => {
    const o = {};
    for (const k of Object.keys(a).sort()) {
      if (['name', 'color', 'style', 'description', 'index', 'cost', 'design', 'traitNotes', 'reach'].includes(k)) continue;
      o[k] = a[k];
    }
    return JSON.stringify(o);
  }).sort();
  return JSON.stringify({
    stats: spec.stats, traits: spec.traits.slice().sort(), weapon: spec.weapon && spec.weapon.id, abilities: abil,
    stance: spec.stance || 'balanced', relics: (spec.relics || []).slice().sort(), offhand: spec.offhand ? spec.offhand.id : null,
    godPowers: (spec.godPowers || []).map(g => g.id).sort(),
  });
}

// Plain-text rules summary (used by `node arena.js rules`).
function describeRules() {
  const L = [];
  L.push('AI FIGHT v3 — LIVE RULES (generated from engine/rules.js)');
  L.push('');
  L.push(`Arena: circle radius ${RULES.arenaRadius} with obstacles (pillars/rocks/trees depending on the arena), shrinks to ${RULES.ring.minRadius} between ${RULES.ring.shrinkStart}s and ${RULES.ring.shrinkEnd}s. Round time ${RULES.roundTime}s.`);
  L.push(`Fighters: hitbox radius ${RULES.fighterRadius}, start at x=±${RULES.startOffset}. ${RULES.tickRate} ticks/s, brain runs every ${RULES.thinkEvery} ticks (${RULES.tickRate / RULES.thinkEvery}/s).`);
  L.push(`Global cooldown ${RULES.globalCooldown}s · stun immunity ${RULES.stunImmunity}s after a stun · root/silence immunity ${RULES.ccImmunity}s · dash speed ${RULES.dashSpeed}/s · crits ×${RULES.critMult}.`);
  L.push('');
  L.push('LEVELS — your level is the round number (max 4). Round 1 = everyone uses the identical starter.');
  L.push('  level  stat points  max per stat  ability slots  trait slots  power caps  weapon damage');
  for (let l = 1; l <= MAX_LEVEL; l++) {
    const v = LEVELS[l];
    L.push(`  ${String(l).padEnd(6)} ${String(v.statPoints).padEnd(12)} ${String(v.statMax).padEnd(13)} ${String(v.abilitySlots).padEnd(14)} ${String(v.traitSlots).padEnd(12)} ${String(Math.round(v.power * 100) + '%').padEnd(11)} ${Math.round(weaponScale(l) * 100)}%`);
  }
  L.push('  "power caps": the maximum of damage, dps, heal/shield amount, buff amount, stun/root/silence, burn/poison dps and drain is multiplied by this.');
  L.push('');
  L.push('STATS — whole numbers, all start at 0:');
  for (const k of STAT_KEYS) L.push(`  ${k.padEnd(10)} ${STAT_INFO[k].formula}`);
  L.push('');
  L.push('WEAPONS — "weapon": "<id>" in fighter.json (default fists). Free basic attack (0 energy): use it with {use: "attack"}.');
  for (const id of WEAPON_IDS) {
    const w = WEAPONS[id], a = w.attack;
    const shape = a.type === 'melee' ? `melee ${a.damage} dmg, range ${a.range}, arc ${a.arc}°` : `projectile ${a.damage} dmg, speed ${a.speed}, range ${a.range}`;
    L.push(`  ${id.padEnd(11)} ${w.name.padEnd(15)} ${a.name.padEnd(10)} ${shape}, every ${a.cooldown}s, windup ${a.windup || 0}s — ${w.passiveText}`);
  }
  L.push('');
  L.push('TRAITS — passive perks (pick up to your trait slots):');
  for (const id of TRAIT_IDS) L.push(`  ${id.padEnd(15)} ${TRAITS[id].name.padEnd(15)} ${TRAITS[id].text}`);
  L.push('');
  L.push(`ABILITIES — up to your ability slots (plus the free weapon attack). Common fields: windup [0–1.5] s (you are rooted while winding up), cooldown [0.4–30] s.`);
  const show = (schema) => Object.entries(schema).map(([k, r]) => {
    if (r === 'effects') return 'effects';
    if (r.kind === 'number') return `${k}${r.required ? '*' : ''} [${r.min}–${r.max}${r.scale ? ' ×power' : ''}${r.def !== undefined ? `, default ${r.def}` : ''}]`;
    if (r.kind === 'bool') return `${k} (true/false, default ${r.def})`;
    if (r.kind === 'enum') return `${k}${r.required ? '*' : ''} (${r.values.join('|')}${r.def !== undefined ? `, default ${r.def}` : ''})`;
    return k;
  }).join(', ');
  for (const t of ABILITY_TYPES) {
    L.push(`  ${t.toUpperCase()}: ${show(TYPE_SCHEMA[t])}`);
    L.push(`      ${TYPE_BLURB[t]}  styles: ${STYLES[t].join(', ')}`);
  }
  L.push('  (* = required, ×power = the maximum scales with your level)');
  L.push('  EFFECTS (melee / projectile / area / dash / trap / counter):');
  for (const k of EFFECT_KEYS) {
    const r = EFFECT_SCHEMA[k];
    const range = r.kind === 'object' ? Object.entries(r.fields).map(([f, fr]) => `${f} [${fr.min}–${fr.max}${fr.scale ? ' ×power' : ''}]`).join(', ') : `[${r.min}–${r.max}${r.scale ? ' ×power' : ''}]`;
    L.push(`    ${k.padEnd(11)} ${range} — ${EFFECT_INFO[k]}`);
  }
  L.push('');
  L.push('ENERGY COST = max(1, round(0.32 × value × delivery × windupMod × cooldownMod))   (computed from your design, before traits)');
  L.push('  hitValue  = dmg × (1 + dmg/250) + 110*stun + 60*root + 80*silence + 70*slow.amount*slow.duration + 0.2*|knockback|');
  L.push('              + dot(burn) + dot(poison) + 10*poison.duration + 110*vulnerable.amount*duration + 100*weaken.amount*duration + 0.8*drain + 1.2*lifesteal*dmg');
  L.push('  dot(x)    = 0.9 × total × (1 + total/350)   where total = dps × duration');
  L.push('  melee:      value = hits × hitValue + 0.15*lunge;  delivery = 0.55 + range/500 + arc/1500');
  L.push('  projectile: value = count × hitValue (*1.35 if returns); delivery = 0.6 + speed/3000 + radius/150 + range/4000 + 0.5*homing + 0.08*bounce');
  L.push('  area:       value = hitValue; delivery = 0.55 + radius/250  (point: + range/1000 − 0.15*min(delay,1.5), min 0.3)');
  L.push('  zone:       value = 0.9*T*(1 + T/500) + 45*slow*duration + 0.4*pull*duration (T = dps*duration); delivery = 0.5 + radius/300 + range/2000 (*1.3 if follow)');
  L.push('  dash:       value = 0.2*distance + (invulnerable ? 25 + 0.1*distance : 0) + 0.9 × hitValue  (*1.4 if teleport)');
  L.push('  shield:     value = amount × (0.55 + 0.08*min(duration, 6)) × (1 + amount/800)');
  L.push('  heal:       value = amount × ((duration > 0 ? 1.4 : 1.5) + amount/500)');
  L.push('  buff:       value = amount/100 × duration × {power 150, armor 130, speed 60, haste 110, crit 100, tenacity 50}');
  L.push('  beam:       value = dot(dps × duration); delivery = 0.6 + range/1200 + width/80 + turnRate/200');
  L.push('  trap:       value = hitValue × (0.8 + duration/60); delivery = 0.3 + radius/200');
  L.push('  counter:    value = 40 + 60*duration + 0.5 × hitValue');
  L.push('  cleanse:    value = 90 + 80*immunity');
  L.push('  windupMod   = 1 − 0.4 × min(windup, 1)');
  L.push('  cooldownMod = clamp(1.35 − 0.075 × cooldown, 0.6, 1.35)');
  L.push('  An ability must cost ≤ your max energy. Buffs need cooldown ≥ 2×duration; shields/counters cooldown ≥ duration + 2 s; cleanses ≥ 6 s; beams ≥ duration + 1 s.');
  L.push('');
  L.push(`LOOK — "look": {…} in fighter.json builds an animated sprite for you (node arena.js looks). A hand-painted sprite.json overrides it: 32×32 frames, ≤ ${RULES.spriteMaxColors} colours; animations idle (1–6, required), walk (0–8, alias move), attack, cast, ko, victory (0–6), dash, hurt, block (0–3).`);
  return L.join('\n');
}

module.exports = {
  RULES, LEVELS, MAX_LEVEL, levelForRound, levelInfo, weaponScale, STAT, arenaFor, levelUnlocks, unlocked,
  TYPE_UNLOCK, STAT_UNLOCK, FEATURE_UNLOCK, STANCES, STANCE_IDS, RELICS, RELIC_IDS, powers,
  STAT_KEYS, STAT_INFO, TRAITS, TRAIT_IDS, EFFECT_SCHEMA, EFFECT_KEYS, EFFECT_INFO, TYPE_SCHEMA, COMMON_SCHEMA, ABILITY_TYPES, STYLES, TYPE_BLURB,
  WEAPONS, WEAPON_IDS, DEFAULT_WEAPON, BUFF_STATS, BUFF_MAX, BUFF_WEIGHT,
  deriveStats, abilityCost, abilityReach, hitValue, dotValue, validateFighter, weaponAttack, weaponInfo, mechanicsSignature, describeRules, clamp, scaledMax,
};
