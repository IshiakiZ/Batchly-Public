'use strict';
// Glue: validate bundles → create sandboxed brains → simulate → replay + reports.

const path = require('path');
const {
  RULES, MAX_LEVEL, levelInfo, TYPE_SCHEMA, EFFECT_SCHEMA, STAT_KEYS, STAT_UNLOCK, TYPE_UNLOCK, RELICS, unlocked, scaledMax, mechanicsSignature, arenaFor,
} = require('./rules');
const { checkBundle, readBundle, spriteKey, composeFromLook } = require('./loader');
const { createBrain } = require('./sandbox');
const { simulate } = require('./sim');
const { buildReport } = require('./report');
const { themeById, themeInfo, obstaclesFor } = require('./themes');

const BOTS_DIR = path.join(__dirname, 'bots');
const STARTER_DIR = path.join(__dirname, 'starter');
const BOTS = {
  rookie: 'Rookie — the shared starter (shortsword, Bolt, Roll) with its default brain (your round-1 baseline)',
  dummy: 'Training Dummy — stands still, lots of HP (measure your damage)',
  brawler: 'Iron Brawler — bare-knuckle robot: charge, stunning haymaker, uppercut knockback, iron skin, war cry',
  archer: 'Wind Archer — longbow kiter: piercing shot, volley, tumble, snare traps, gust arrow',
  tank: 'Stone Warden — warhammer golem: stunning slam, chain hook pull, boulder meteor, stone skin, mend',
  mage: 'Storm Mage — staff caster: meteor, lightning beam, frost nova, blink teleport, mana shield',
  ninja: 'Shadow Ninja — twin-dagger assassin: backstab, shadow step, poison shuriken, poison cloud, smoke-bomb cleanse',
  paladin: 'Iron Paladin — sword & shield knight: judgment, consecrate zone, holy light, divine parry (counter), radiant bolt',
  pyro: 'Blaze Pyromancer — wand pyromancer: burning bolts, flame wall, inferno nova, flame beam, kindle',
  frost: 'Frost Witch — staff control mage: slowing shards, deep freeze, frozen ground, frost hook, purify',
  berserker: 'Blood Berserker — battle axe berserker: wide cleave, leap smash, blood rage, rending chop, returning throwing axe',
  gunslinger: 'Clockwork Gunslinger — flintlock robot: fan the hammer, scatter blast, combat roll, flash bang, tripmines',
};
const BOT_NAMES = Object.keys(BOTS);
const GAUNTLET = ['rookie', 'brawler', 'archer', 'tank', 'mage'];
const FULL_GAUNTLET = BOT_NAMES.filter(n => n !== 'dummy');

function seedFor(seed, side) {
  return ((seed >>> 0) ^ (side ? 0x9e3779b9 : 0x85ebca6b)) >>> 0;
}

// ── starter (round-1 mirror) ─────────────────────────────────────────────────
let starterCache = null;
function starterInfo() {
  if (starterCache) return starterCache;
  const bundle = readBundle(STARTER_DIR);
  const check = checkBundle(bundle, { level: 1 });
  if (!check.ok) throw new Error(`engine/starter is invalid: ${check.errors.join('; ')}`);
  starterCache = { dir: STARTER_DIR, bundle, spec: check.spec, signature: mechanicsSignature(check.spec), spriteKey: spriteKey(bundle.sprite) };
  return starterCache;
}

// ── bots, scaled to the current level ────────────────────────────────────────
function clampScaledFields(ab, lvl) {
  const schema = TYPE_SCHEMA[ab.type];
  if (!schema) return ab;
  for (const [k, rule] of Object.entries(schema)) {
    if (rule === 'effects' || !rule.scale || typeof ab[k] !== 'number') continue;
    ab[k] = Math.min(ab[k], scaledMax(rule, lvl.power));
  }
  if (ab.effects) {
    for (const [k, rule] of Object.entries(EFFECT_SCHEMA)) {
      const v = ab.effects[k];
      if (v === undefined || v === null) continue;
      if (rule.kind === 'object') {
        for (const [f, fr] of Object.entries(rule.fields)) if (fr.scale && typeof v[f] === 'number') v[f] = Math.min(v[f], scaledMax(fr, lvl.power));
      } else if (rule.scale && typeof v === 'number') ab.effects[k] = Math.min(v, scaledMax(rule, lvl.power));
    }
  }
  return ab;
}

/**
 * Fit a fighter design to `level`: stats are scaled to exactly the level's points (down or up,
 * respecting the per-stat cap and stat unlocks), and anything not unlocked yet is dropped.
 */
function fitToLevel(raw, level) {
  const lvl = levelInfo(level);
  const out = JSON.parse(JSON.stringify(raw));
  const stats = Object.assign({}, out.stats || {});
  for (const k of Object.keys(STAT_UNLOCK)) if ((STAT_UNLOCK[k] || 1) > lvl.level) delete stats[k];
  const total = STAT_KEYS.reduce((a, k) => a + (stats[k] || 0), 0);
  if (total > 0 && (total !== lvl.statPoints || STAT_KEYS.some(k => (stats[k] || 0) > lvl.statMax))) {
    const f = lvl.statPoints / total;
    const st = {};
    let used = 0;
    for (const k of STAT_KEYS) { st[k] = Math.min(lvl.statMax, Math.floor((stats[k] || 0) * f)); used += st[k]; }
    const order = STAT_KEYS.slice().sort((a, b) => (stats[b] || 0) - (stats[a] || 0));
    let rem = lvl.statPoints - used;
    while (rem > 0) {
      let moved = false;
      for (const k of order) {
        if (rem <= 0) break;
        if ((stats[k] || 0) > 0 && st[k] < lvl.statMax) { st[k]++; rem--; moved = true; }
      }
      if (!moved) break;
    }
    out.stats = st;
  }
  out.traits = (out.traits || []).slice(0, lvl.traitSlots);
  const typeOk = (ab) => ab && (TYPE_UNLOCK[ab.type] || 1) <= lvl.level;
  out.abilities = (out.abilities || []).filter(typeOk).slice(0, lvl.abilitySlots).map(ab => clampScaledFields(ab, lvl));
  if (out.ultimate && (!unlocked('ultimate', lvl.level) || !typeOk(out.ultimate))) delete out.ultimate;
  else if (out.ultimate) out.ultimate = clampScaledFields(out.ultimate, Object.assign({}, lvl, { power: lvl.power * RULES.ultCapMult }));
  if (out.stance && out.stance !== 'balanced' && !unlocked('stances', lvl.level)) delete out.stance;
  out.relics = (out.relics || []).slice(0, lvl.relicSlots);
  if (!out.relics.length) delete out.relics;
  if (out.offhand && !unlocked('offhand', lvl.level)) delete out.offhand;
  if (out.awakening && !unlocked('awakening', lvl.level)) delete out.awakening;
  out.godPowers = (out.godPowers || []).slice(0, lvl.godSlots);
  if (!out.godPowers.length) delete out.godPowers;
  return out;
}

/**
 * A bot design made legal at `level`: fitToLevel(), then abilities that became unaffordable are
 * dropped and an ultimate that is over the level's budget is toned down.
 */
function loadBotDesign(json, level) {
  const out = fitToLevel(json, level);
  const { bundleFromSnapshot } = require('./loader');
  for (let guard = 0; guard < 40; guard++) {
    const c = checkBundle(bundleFromSnapshot({ fighter: out, brain: 'function brain(){return {}}' }), { level });
    if (c.ok) break;
    if (out.ultimate && c.errors.some(e => /^ultimate/.test(e) && /too strong/.test(e))) {
      for (const k of ['damage', 'dps', 'amount']) if (typeof out.ultimate[k] === 'number') out.ultimate[k] = Math.max(1, Math.floor(out.ultimate[k] * 0.9));
      continue;
    }
    const bad = c.spec.abilities.find(a => !a.basic && !a.ultimate && a.energy > c.spec.derived.maxEnergy);
    if (!bad) break;
    out.abilities = out.abilities.filter(a => a.name !== bad.name);
  }
  return out;
}

function loadBot(name, level = MAX_LEVEL) {
  if (!BOTS[name]) throw new Error(`unknown sparring bot "${name}" (choose: ${BOT_NAMES.join(', ')}, mirror, all, full)`);
  const bundle = readBundle(name === 'rookie' ? STARTER_DIR : path.join(BOTS_DIR, name));
  if (name !== 'rookie' && bundle.json) {
    bundle.json = loadBotDesign(bundle.json, level);
  }
  return bundle;
}

function brainFor(bundle, seed, label, memory) {
  return createBrain(bundle.brain, { seed, label, lib: bundle.lib || null, memory: memory || null });
}

/**
 * Static check + brain load + a 4 second smoke fight against the dummy.
 * `mirror` enforces the round-1 starter rule at level 1.
 */
function fullCheck(bundle, { level = MAX_LEVEL, mirror = true } = {}) {
  const starter = mirror && level === 1 ? starterInfo() : null;
  const check = checkBundle(bundle, { level, starter });
  check.smoke = null;
  if (!check.ok) return check;
  const brain = brainFor(bundle, 7, 'smoke', null);
  if (!brain.ok) {
    check.ok = false;
    check.errors.push(brain.error);
    return check;
  }
  const dummyBundle = loadBot('dummy', level);
  const dummy = checkBundle(dummyBundle, { level });
  const dummyBrain = createBrain(dummyBundle.brain, { seed: 1, label: 'dummy' });
  const sim = simulate({ specs: [check.spec, dummy.spec], brains: [brain, dummyBrain], seed: 7, maxTime: 4, level, obstacles: obstaclesFor('colosseum', level) });
  const st = brain.stats;
  check.smoke = {
    calls: st.calls, errors: st.errors, timeouts: st.timeouts,
    firstErrors: st.firstErrors, logs: st.logs.slice(0, 8),
    avgMs: st.calls ? st.totalMs / st.calls : 0,
    casts: sim.stats[0].abilities.reduce((a, s) => a + s.casts, 0),
    dealt: sim.stats[0].dealt,
  };
  if (st.errors > 0) {
    check.ok = false;
    const e = st.firstErrors[0];
    check.errors.push(`brain() crashed during a 4 second smoke test vs the dummy (${st.errors} errors in ${st.calls} calls). First: t=${(e.tick / RULES.tickRate).toFixed(1)}s ${e.message}`);
  }
  return check;
}

function displayAbility(ab) {
  const o = {};
  for (const k of Object.keys(ab)) if (k !== 'cost' && k !== 'design' && k !== 'traitNotes') o[k] = ab[k];
  return o;
}

function uiSummary(st) {
  let fired = 0, hits = 0, casts = 0;
  for (const a of st.abilities) {
    casts += a.casts;
    if (['melee', 'projectile', 'area', 'dash', 'beam', 'trap'].includes(a.type)) { fired += a.fired; hits += a.hits; }
  }
  return {
    dealt: st.dealt, taken: st.taken, healed: st.healed, shieldAbsorbed: st.shieldAbsorbed,
    biggestHit: st.biggestHit, biggestHitAbility: st.biggestHitAbility,
    accuracy: fired ? Math.min(1, hits / fired) : null, casts, stunsLanded: st.stunsLanded, evades: st.evades,
    stunnedTime: st.stunnedTime, avgDistance: st.avgDistance,
    crits: st.crits, basicDamage: st.basicDamage, countersLanded: st.countersLanded, trapsTriggered: st.trapsTriggered,
    burnDamage: st.burnDamage, poisonDamage: st.poisonDamage, bleedDamage: st.bleedDamage, beamDamage: st.beamDamage, zoneDamage: st.zoneDamage,
    ults: st.ults, ultDamage: st.ultDamage, godCasts: st.godCasts, godDamage: st.godDamage, awakenings: st.awakenings,
    swaps: st.swaps, stanceSwitches: st.stanceSwitches, relicTriggers: st.relicTriggers, turretShots: st.turretShots, revives: st.revives,
    abilities: st.abilities.map(a => ({ name: a.name, type: a.type, basic: a.basic, casts: a.casts, fired: a.fired, hits: a.hits, damage: a.damage, healing: a.healing, crits: a.crits })),
  };
}

function buildReplay({ kind, round, level, seed, ids, labels, specs, bundles, sim, theme }) {
  const arena = sim.arena || arenaFor(level);
  return {
    v: 4,
    kind,
    round,
    level: sim.level || level,
    seed,
    tickRate: RULES.tickRate,
    roundTime: RULES.roundTime,
    fighterRadius: RULES.fighterRadius,
    theme: theme ? themeInfo(theme) : null,
    arena: {
      radius: arena.radius, minRadius: arena.minRadius, shrinkStart: arena.shrinkStart, shrinkEnd: arena.shrinkEnd,
      obstacles: (sim.obstacles || []).map(o => ({ x: o.x, y: o.y, r: o.r })),
    },
    cinematics: sim.cinematics || [],
    fighters: specs.map((s, i) => ({
      id: ids[i], label: labels[i], side: i, level: s.level,
      name: s.name, title: s.title, catchphrase: s.catchphrase, colors: s.colors,
      sprite: bundles[i].sprite || null,
      spriteOff: s.offhand ? offhandSprite(bundles[i], s.offhand.id) : null,
      look: s.look || null,
      weapon: s.weapon || null,
      offhand: s.offhand || null,
      stance: s.stance || 'balanced',
      relics: (s.relics || []).map(id => Object.assign({ id }, RELICS[id] || {})),
      godPowers: s.godPowers || [],
      awakening: s.awakening || null,
      ultimate: s.ultIdx >= 0 ? displayAbility(s.abilities[s.ultIdx]) : null,
      ultIdx: s.ultIdx >= 0 ? s.ultIdx : -1, basicIdx: s.basicIdx, offIdx: s.offIdx >= 0 ? s.offIdx : -1,
      maxHp: s.derived.maxHp, maxEnergy: s.derived.maxEnergy, stats: s.stats, derived: s.derived, traits: s.traits,
      abilities: s.abilities.map(displayAbility),
    })),
    frames: sim.frames,
    events: sim.events,
    result: sim.result,
    timeline: sim.timeline,
    summary: sim.stats.map(uiSummary),
  };
}

/** The fighter's sprite holding its off-hand weapon (looks only; a hand-painted sprite.json has one weapon). */
function offhandSprite(bundle, weaponId) {
  if (!bundle || !bundle.json || bundle.spriteSource !== 'look') return null;
  try { return composeFromLook(Object.assign({}, bundle.json, { weapon: weaponId })); } catch { return null; }
}

/**
 * Run one fight between two bundles at a level.
 * `theme` (id or {id}) picks the arena obstacles; `memories` = [json|null, json|null] from earlier rounds.
 * @returns {{sim, specs, replay, memories}}
 */
function runFight({ bundles, ids, labels, seed = 1, kind = 'round', round = 0, level = MAX_LEVEL, maxTime, swapStart = false, theme = null, memories = null }) {
  const checks = bundles.map(b => checkBundle(b, { level }));
  checks.forEach((c, i) => {
    if (!c.ok) throw new Error(`${labels[i]}'s fighter is invalid: ${c.errors.join('; ')}`);
  });
  const brains = bundles.map((b, i) => brainFor(b, seedFor(seed, i), ids[i], memories ? memories[i] : null));
  const specs = checks.map(c => c.spec);
  const th = theme ? themeById(typeof theme === 'string' ? theme : theme.id) : null;
  const sim = simulate({ specs, brains, seed, maxTime, swapStart, level, obstacles: th ? obstaclesFor(th, level) : [] });
  const replay = buildReplay({ kind, round, level, seed, ids, labels, specs, bundles, sim, theme: th });
  replay.swapStart = !!swapStart;
  const memOut = brains.map(b => (b.exportMemory ? b.exportMemory() : { json: null, note: null }));
  return { sim, specs, replay, memories: memOut };
}

function reportsFor({ sim, specs, labels, round, kind, score, arena = null, memoryNotes = null }) {
  return [0, 1].map(side => buildReport({ side, sim, specs, labels, round, kind, score, arena, memoryNote: memoryNotes ? memoryNotes[side] : null }));
}

module.exports = {
  BOTS, BOT_NAMES, GAUNTLET, FULL_GAUNTLET, STARTER_DIR, loadBot, loadBotDesign, fitToLevel, starterInfo, fullCheck, runFight, reportsFor, buildReplay, uiSummary, seedFor,
};
