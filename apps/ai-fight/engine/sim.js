'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  AI FIGHT — deterministic fight simulation (v4).
//  simulate() runs a whole round instantly and returns frames + events + stats.
//  The server then plays the frames back in real time for spectators.
// ─────────────────────────────────────────────────────────────────────────────

const { RULES, STAT, clamp, weaponScale, arenaFor, STANCES, STANCE_IDS, levelInfo, unlocked, powers: powersModule } = require('./rules');

const DT = 1 / RULES.tickRate;
const R = RULES.fighterRadius;
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

const FLAG = {
  STUN: 1, SLOW: 2, BURN: 4, INVULN: 8, DASH: 16, POWER: 32, ARMOR: 64, SPEED: 128,
  REGEN: 256, SHIELD: 512, KO: 1024, HOT: 2048, KNOCK: 4096, CAST: 8192,
  ROOT: 1 << 14, SILENCE: 1 << 15, VULN: 1 << 16, WEAK: 1 << 17, POISON: 1 << 18, IMMUNE: 1 << 19,
  COUNTER: 1 << 20, CHANNEL: 1 << 21, HASTE: 1 << 22, CRITBUFF: 1 << 23, TENACITY: 1 << 24, BLEED: 1 << 25,
};
const HIT = {
  STUN: 1, RESISTED: 2, SLOW: 4, BURN: 8, KNOCK: 16, LIFESTEAL: 32, CRIT: 64, ROOT: 128, SILENCE: 256,
  VULN: 512, WEAK: 1024, POISON: 2048, DRAIN: 4096, BLOCK: 8192, BASIC: 16384,
};
const FLAG2 = {
  AWAKENED: 1, ASCENDED: 2, ULT_READY: 4, GOD_READY: 8, SWAPPING: 16, REVIVED: 32, MARKED: 64, WARD: 128, ULT_CAST: 256,
};
const STANCE_CODE = { balanced: 0, aggressive: 1, defensive: 2, swift: 3 };
const EMOTES = ['taunt', 'laugh', 'salute', 'cheer', 'bow', 'rage'];
const BUFFS = ['power', 'armor', 'speed', 'haste', 'crit', 'tenacity'];
const DOT_KINDS = new Set(['burn', 'poison', 'bleed', 'zone']);
// Default hit-stop / cut-in budgets (ms); engine/powers.js may override them.
const DEFAULT_CINEMATICS = { ult: 800, god: 1500, awaken: 900, ascend: 1500, ko: 700, impact: 140, ulthit: 260, godhit: 420 };
const CINEMATIC_PRIORITY = { ko: 9, god: 8, ascend: 7, ult: 6, awaken: 5, godhit: 4, ulthit: 3, impact: 1 };
// Ultimate / divinity meters: the share of max HP that fills a meter, and the passive trickle per second.
const CHARGE = { ult: { dealt: 0.6, taken: 1.0, perSecond: 0.6 }, div: { dealt: 0.8, taken: 1.3, perSecond: 0.5 } };
const QUIET_RELICS = new Set(['thunder_idol', 'hunters_mark', 'storm_battery']);

function angleDiff(a, b) {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;

/** Ring radius at time t for an arena ({radius, minRadius, shrinkStart, shrinkEnd}; default = level 1). */
function ringRadiusAt(t, arena) {
  const a = arena || arenaFor(1);
  if (t <= a.shrinkStart) return a.radius;
  if (t >= a.shrinkEnd) return a.minRadius;
  const k = (t - a.shrinkStart) / (a.shrinkEnd - a.shrinkStart);
  return a.radius + (a.minRadius - a.radius) * k;
}

// Segment (x0,y0)->(x1,y1) against a circle: first t in [0,1] where the moving
// point is within r of (cx,cy); -1 if never. Starting inside only counts when
// moving toward the centre.
function sweep(x0, y0, x1, y1, cx, cy, r) {
  const dx = x1 - x0, dy = y1 - y0;
  const fx = x0 - cx, fy = y0 - cy;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - r * r;
  if (c <= 0) return b < 0 ? 0 : -1;
  const a = dx * dx + dy * dy;
  if (a < 1e-12) return -1;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : -1;
}

/** Distance from point p to segment a-b. */
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function mulberry(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hasEffects(ab) {
  const e = ab.effects || {};
  return Object.keys(e).some(k => e[k]);
}

function makeStats(spec) {
  return {
    dealt: 0, taken: 0, shieldAbsorbed: 0, healed: 0, lifesteal: 0,
    biggestHit: 0, biggestHitAbility: null,
    abilities: spec.abilities.map(a => ({
      name: a.name, type: a.type, basic: !!a.basic, casts: 0, fired: 0, hits: 0, damage: 0, energy: 0,
      interrupted: 0, evaded: 0, missed: 0, healing: 0, shielding: 0, crits: 0, countered: 0, cancelled: 0,
    })),
    burnDamage: 0, zoneDamage: 0, poisonDamage: 0, bleedDamage: 0, beamDamage: 0, basicDamage: 0,
    crits: 0, blocked: 0, countersLanded: 0, trapsTriggered: 0, cleanses: 0, slams: 0, drained: 0,
    stunnedTime: 0, slowedTime: 0, rootedTime: 0, silencedTime: 0, castingTime: 0, starvedTime: 0, wallTime: 0,
    stunsLanded: 0, stunsResisted: 0, evades: 0,
    distance: { sum: 0, samples: 0, close: 0, mid: 0, far: 0 },
    blockedCasts: { cooldown: 0, energy: 0, busy: 0, stunned: 0, silenced: 0, rooted: 0, gcd: 0, unknown: 0, charge: 0 },
    says: [],
    // v4
    ults: 0, ultDamage: 0, godCasts: 0, godDamage: 0, awakenings: 0, swaps: 0, stanceSwitches: 0,
    relicTriggers: 0, turretShots: 0, revives: 0, emotes: 0, stanceTime: { balanced: 0, aggressive: 0, defensive: 0, swift: 0 },
  };
}

class Fighter {
  constructor(spec, side, brain, swapStart = false, startOffset = RULES.startOffset) {
    this.spec = spec;
    this.side = side;
    this.brain = brain;
    this.d = spec.derived;
    const left = (side === 0) !== swapStart;
    this.x = left ? -startOffset : startOffset;
    this.y = 0;
    this.vx = 0; this.vy = 0;
    this.hp = this.d.maxHp;
    this.energy = this.d.maxEnergy;
    this.shield = 0; this.shieldTime = 0;
    this.stun = 0; this.stunImmune = 0;
    this.root = 0; this.rootImmune = 0;
    this.silence = 0; this.silenceImmune = 0;
    this.immune = 0;
    this.slow = 0; this.slowTime = 0;
    this.burnDps = 0; this.burnTime = 0; this.burnSrc = null;
    this.poisonDps = 0; this.poisonTime = 0; this.poisonSrc = null;
    this.bleedDps = 0; this.bleedTime = 0; this.bleedSrc = null;
    this.vuln = { amount: 0, time: 0 };
    this.weak = { amount: 0, time: 0 };
    this.buffs = Object.fromEntries(BUFFS.map(k => [k, { amount: 0, time: 0 }]));
    this.hots = [];
    this.casting = null;
    this.channel = null;
    this.counterTime = 0; this.counterIdx = -1;
    this.dash = null;
    this.knock = null;
    this.cooldowns = spec.abilities.map(() => 0);
    this.gcd = 0;
    this.move = { x: 0, y: 0 };
    this.aim = null;
    this.pending = null;
    this.facing = left ? 0 : Math.PI;
    this.ko = false;
    this.lastSay = -1e9;
    this.lastDraw = null;
    this.lastDrawAt = -1;
    this.traits = new Set(spec.traits || []);
    this.weapon = (spec.weapon && spec.weapon.id) || 'fists';
    this.basicIdx = spec.abilities.findIndex(a => a.basic);
    this.wScale = weaponScale(spec.level || 4);
    this.secondWindUsed = false;
    this.momentumUntil = -1;
    this.spellbladeUntil = -1;
    this.katanaUntil = -1;
    this.hammerHits = 0;
    this.clawCombo = 0; this.clawUntil = -1;
    this.eventIdx = 0;
    const costs = spec.abilities.filter(a => !a.basic && !a.ultimate).map(a => a.energy);
    this.cheapest = costs.length ? Math.min(...costs) : Infinity;
    this.stats = makeStats(spec);
    this.publicAbilities = spec.abilities.map(publicAbility);
    // ── v4 ──
    const lvl = spec.level || 4;
    this.level = lvl;
    this.stance = STANCES[spec.stance] ? spec.stance : 'balanced';
    this.stanceCd = 0;
    this.ultIdx = spec.ultIdx >= 0 ? spec.ultIdx : -1;
    this.ult = 0;                                 // ultimate charge 0–100
    this.ultReadyAnnounced = false;
    this.godPowers = (spec.godPowers || []).map(g => g.id);
    this.div = 0;                                 // divinity 0–100
    this.divReadyAnnounced = false;
    this.godCast = null;                          // { id, remaining, total, target }
    this.mainIdx = spec.basicIdx >= 0 ? spec.basicIdx : this.basicIdx;
    this.offIdx = spec.offIdx >= 0 ? spec.offIdx : -1;
    this.weaponSlot = 0;                          // 0 = main weapon, 1 = off-hand
    this.mainWeapon = this.weapon;
    this.offWeapon = spec.offhand ? spec.offhand.id : null;
    this.dMain = spec.derived;
    this.dOff = spec.derivedOff || spec.derived;
    this.swapLock = 0; this.swapCd = 0;
    this.canAwakenLevel = unlocked('awakening', lvl);
    this.ascends = unlocked('ascension', lvl);
    this.awakened = 0; this.awakenUsed = false; this.ascended = false;
    this.awakenDur = (this.ascends ? 10 : 8) + (spec.derived.awakenBonus || 0);
    this.relics = new Set(spec.relics || []);
    this.relicState = { hourglass: 6, mirror: 0, ward: 0, markCd: 0, thunder: 0, bloodstone: 10, storm: 0, phoenixUsed: false };
    this.marked = 0;                              // Hunter's Mark on this fighter (s left)
    this.revived = 0;                             // flash after a phoenix revive (s left)
    this.invulnTime = 0;                          // invulnerable for this long (revive / powers)
    this.frozen = 0;                              // time-stopped by a godly power (s left)
    this.lastEmote = -1e9;
    this.flags2Extra = 0;                         // bits set by engine/powers.js
    this.lastImpact = -1e9;
  }
  get invulnerable() { return !!(this.dash && this.dash.invulnerable) || this.invulnTime > 0; }
  buff(stat) { const b = this.buffs[stat]; return b && b.time > 0 ? b.amount : 0; }
  get busy() { return !!(this.casting || this.dash || this.channel || this.godCast); }
}

function publicAbility(ab) {
  const out = { name: ab.name, type: ab.type, index: ab.index, energyCost: ab.energy, cooldown: ab.cooldown, windup: ab.windup, reach: ab.reach };
  if (ab.basic) out.basic = true;
  if (ab.offhand) out.offhand = true;
  if (ab.ultimate) out.ultimate = true;
  if (ab.weapon) out.weapon = ab.weapon;
  for (const k of ['damage', 'range', 'arc', 'speed', 'radius', 'count', 'spread', 'homing', 'dps', 'duration', 'distance', 'invulnerable', 'amount', 'stat', 'slow',
    'hits', 'lunge', 'target', 'delay', 'bounce', 'returns', 'pull', 'follow', 'teleport', 'width', 'turnRate', 'arm', 'immunity', 'rate', 'place']) {
    if (ab[k] !== undefined) out[k] = ab[k];
  }
  if (ab.effects && Object.keys(ab.effects).length) out.effects = ab.effects;
  return out;
}

function cleanDraw(list) {
  if (!Array.isArray(list)) return null;
  const hex = /^#[0-9a-fA-F]{6}$/;
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? r1(clamp(v, -2000, 2000)) : null);
  const out = [];
  for (const s of list.slice(0, RULES.drawMaxShapes)) {
    if (!s || typeof s !== 'object') continue;
    const c = typeof s.c === 'string' && hex.test(s.c) ? s.c.toLowerCase() : '#ffffff';
    if (s.t === 'circle' && num(s.x) !== null && num(s.y) !== null && num(s.r) !== null) out.push({ t: 'circle', x: num(s.x), y: num(s.y), r: Math.max(1, Math.min(600, num(s.r))), c });
    else if (s.t === 'line' && [s.x1, s.y1, s.x2, s.y2].every(v => num(v) !== null)) out.push({ t: 'line', x1: num(s.x1), y1: num(s.y1), x2: num(s.x2), y2: num(s.y2), c });
    else if (s.t === 'text' && num(s.x) !== null && num(s.y) !== null && typeof s.s === 'string') out.push({ t: 'text', x: num(s.x), y: num(s.y), s: s.s.replace(/[\u0000-\u001f]/g, ' ').slice(0, 24), c });
    else if (s.t === 'point' && num(s.x) !== null && num(s.y) !== null) out.push({ t: 'point', x: num(s.x), y: num(s.y), c });
  }
  return out;
}

class Sim {
  constructor({ specs, brains, seed = 1, maxTime = RULES.roundTime, swapStart = false, obstacles = [], level = null }) {
    this.seed = seed;
    this.level = level || Math.max(specs[0].level || 1, specs[1].level || 1);
    this.arena = arenaFor(this.level);
    this.f = [
      new Fighter(specs[0], 0, brains[0], swapStart, this.arena.startOffset),
      new Fighter(specs[1], 1, brains[1], swapStart, this.arena.startOffset),
    ];
    this.tick = 0;
    this.maxTicks = Math.round(maxTime * RULES.tickRate);
    this.ringR = this.arena.radius;
    this.obstacles = (obstacles || []).map(o => ({ x: o.x, y: o.y, r: o.r }));
    this.projectiles = [];
    this.zones = [];
    this.traps = [];
    this.meteors = [];
    this.beams = [];
    this.turrets = [];
    this.nextId = 1;
    this.frames = [];
    this.events = [];
    this.cinematics = [];
    this.dots = new Map(); // key → accumulated DoT damage for batching events
    this.result = null;
    this.timeline = [];
    this.rng = mulberry((seed ^ 0x51f15e) >>> 0);
    // godly powers (engine/powers.js) — only when someone brought one
    this.P = this.f.some(f => f.godPowers.length) ? powersModule() : null;
    this.cinBudget = Object.assign({}, DEFAULT_CINEMATICS, (powersModule() && powersModule().CINEMATICS) || {});
    this.pctx = null;
    if (this.P) {
      try { this.pctx = this.P.create(this.powerApi()); } catch (e) { this.P = null; this.pctx = null; }
    }
  }

  get time() { return this.tick * DT; }

  ev(e) { e.t = this.tick + 1; this.events.push(e); }

  // ── derived values that include buffs / debuffs ────────────────────────────
  speedOf(f) {
    if (f.root > 0 || f.channel || f.frozen > 0 || f.godCast) return 0;
    const st = STANCES[f.stance] || STANCES.balanced;
    const aw = f.awakened > 0 ? (f.ascended ? 1.25 : 1.2) : 1;
    return f.d.moveSpeed * (1 + f.buff('speed') / 100) * (1 - (f.slowTime > 0 ? f.slow : 0)) * st.speed * aw;
  }
  damageMult(f) {
    const st = STANCES[f.stance] || STANCES.balanced;
    const aw = f.awakened > 0 ? (f.ascended ? 1.35 : 1.25) : 1;
    return f.d.damageMult * (1 + f.buff('power') / 100) * (1 - (f.weak.time > 0 ? f.weak.amount : 0)) * st.dealt * aw;
  }
  critChance(f) { return Math.min(0.95, f.d.critChance + f.buff('crit') / 100); }
  ccMult(f) { return Math.max(0.1, f.d.ccMult * (1 - f.buff('tenacity') / 100)); }
  dotMult(f) { return Math.max(0.1, f.d.dotMult * (1 - f.buff('tenacity') / 100)); }

  // ── brain interface ────────────────────────────────────────────────────────
  canCast(f, i) {
    const ab = f.spec.abilities[i];
    if (!ab || f.ko || f.busy || f.gcd > 1e-9 || f.cooldowns[i] > 1e-9 || f.frozen > 0) return false;
    if (ab.ultimate ? f.ult < 100 : f.energy < this.costOf(f, ab)) return false;
    if (ab.basic && i !== this.activeBasic(f)) return false;
    if (ab.basic && f.swapLock > 0) return false;
    if (ab.type === 'cleanse') return true;
    if (f.stun > 0) return false;
    if (f.silence > 0 && !ab.basic) return false;
    if (f.root > 0 && ab.type === 'dash') return false;
    return true;
  }
  /** Index of the weapon attack of the weapon in hand. */
  activeBasic(f) { return f.weaponSlot === 1 && f.offIdx >= 0 ? f.offIdx : f.mainIdx; }
  /** Energy an ability costs right now (Storm Battery makes the next one free). */
  costOf(f, ab) { return ab.basic || ab.ultimate ? 0 : (f.relics.has('storm_battery') && f.relicState.storm <= 0 ? 0 : ab.energy); }

  publicFighter(f, self) {
    const c = f.casting;
    const ab = c ? f.spec.abilities[c.idx] : null;
    const ch = f.channel;
    const o = {
      name: f.spec.name,
      x: r2(f.x), y: r2(f.y), vx: r2(f.vx), vy: r2(f.vy),
      hp: r2(f.hp), maxHp: f.d.maxHp,
      energy: r2(f.energy), maxEnergy: f.d.maxEnergy, energyRegen: r2(this.regenOf(f)),
      shield: r2(f.shield), shieldTime: r2(f.shieldTime),
      moveSpeed: r2(this.speedOf(f)), baseSpeed: f.d.moveSpeed,
      damageMult: r2(this.damageMult(f)), damageTaken: r2(f.d.damageTaken * (1 - f.buff('armor') / 100) * (1 + (f.vuln.time > 0 ? f.vuln.amount : 0))),
      critChance: r2(this.critChance(f)),
      facing: r2(f.facing),
      stunned: r2(f.stun), stunImmune: r2(f.stunImmune),
      rooted: r2(f.root), silenced: r2(f.silence), immune: r2(f.immune),
      slowed: f.slowTime > 0 ? f.slow : 0, slowTime: r2(Math.max(0, f.slowTime)),
      burning: f.burnTime > 0 ? r2(f.burnDps) : 0, burnTime: r2(Math.max(0, f.burnTime)),
      poisoned: f.poisonTime > 0 ? r2(f.poisonDps) : 0, poisonTime: r2(Math.max(0, f.poisonTime)),
      bleeding: f.bleedTime > 0 ? r2(f.bleedDps) : 0, bleedTime: r2(Math.max(0, f.bleedTime)),
      vulnerable: f.vuln.time > 0 ? { amount: f.vuln.amount, timeLeft: r2(f.vuln.time) } : null,
      weakened: f.weak.time > 0 ? { amount: f.weak.amount, timeLeft: r2(f.weak.time) } : null,
      buffs: Object.fromEntries(BUFFS.map(k => [k, f.buff(k)])),
      casting: c ? {
        ability: ab.name, index: c.idx, type: ab.type, basic: !!ab.basic, timeLeft: r2(c.remaining), total: c.total,
        target: { x: r2(c.tx), y: r2(c.ty) }, direction: r2(c.dir),
      } : null,
      channeling: ch ? { ability: f.spec.abilities[ch.idx].name, index: ch.idx, timeLeft: r2(ch.time), direction: r2(ch.dir) } : null,
      godCasting: f.godCast ? { id: f.godCast.id, name: this.godName(f.godCast.id), timeLeft: r2(f.godCast.remaining), total: f.godCast.total,
        target: { x: r2(f.godCast.target.x), y: r2(f.godCast.target.y) } } : null,
      countering: f.counterTime > 0,
      dashing: !!f.dash, invulnerable: f.invulnerable,
      knockedBack: !!f.knock,
      gcd: r2(Math.max(0, f.gcd)),
      weapon: this.weaponPublic(f, f.weaponSlot),
      offhand: f.offIdx >= 0 ? this.weaponPublic(f, 1 - f.weaponSlot) : null,
      swapCooldown: r2(Math.max(0, f.swapCd)),
      stats: f.spec.stats,
      traits: Array.from(f.traits),
      level: f.level,
      stance: f.stance,
      stanceCooldown: r2(Math.max(0, f.stanceCd)),
      ult: f.ultIdx >= 0 ? { name: f.spec.abilities[f.ultIdx].name, charge: Math.floor(f.ult), ready: this.canCast(f, f.ultIdx) } : null,
      divinity: f.godPowers.length ? Math.floor(f.div) : 0,
      godPowers: f.godPowers.map(id => ({ id, name: this.godName(id), ready: f.div >= 100 && !f.busy && f.stun <= 0 && f.frozen <= 0 && !f.ko })),
      canAwaken: this.canAwaken(f),
      awakened: r2(Math.max(0, f.awakened)),
      awakenUsed: f.awakenUsed,
      ascended: f.ascended && f.awakened > 0,
      relics: Array.from(f.relics),
      marked: r2(Math.max(0, f.marked)),
      frozen: r2(Math.max(0, f.frozen)),
      abilities: f.publicAbilities.map((a, i) => Object.assign({}, a, {
        cooldownLeft: r2(Math.max(0, f.cooldowns[i])), ready: this.canCast(f, i),
        energyCost: this.costOf(f, f.spec.abilities[i]),
        active: a.basic ? i === this.activeBasic(f) : undefined,
      })),
    };
    if (self) {
      o.counterTimeLeft = r2(Math.max(0, f.counterTime));
      o.traps = this.traps.filter(t => t.owner === f.side).length;
      o.turrets = this.turrets.filter(t => t.owner === f.side).length;
    }
    return o;
  }

  weaponPublic(f, slot) {
    const w = slot === 1 && f.spec.offhand ? f.spec.offhand : f.spec.weapon;
    return w ? { id: w.id, name: w.name, kind: w.kind } : { id: f.weapon, name: f.weapon, kind: 'claw' };
  }

  godName(id) {
    const P = powersModule();
    return P && P.GOD_POWERS && P.GOD_POWERS[id] ? P.GOD_POWERS[id].name : id;
  }

  canAwaken(f) {
    return f.canAwakenLevel && !f.awakenUsed && !f.ko && f.stun <= 0 && f.frozen <= 0
      && (this.time >= RULES.awakenAfter || f.hp <= f.d.maxHp * 0.5);
  }

  eventsFor(f) {
    const list = this.events.slice(f.eventIdx);
    f.eventIdx = this.events.length;
    const out = [];
    for (const e of list.slice(-60)) {
      if (e.k === 'draw') continue;
      const who = e.a === f.side ? 'me' : 'enemy';
      const owner = this.f[e.a];
      const o = { t: r2((e.t - 1) * DT), type: e.k, who };
      if (e.ab !== undefined && e.ab !== null && owner.spec.abilities[e.ab]) o.ability = owner.spec.abilities[e.ab].name;
      for (const k of ['dmg', 'abs', 'x', 'y', 'r', 'v', 'stat', 'kind', 'text', 'ok', 'id', 'delay']) if (e[k] !== undefined) o[k] = e[k];
      if (e.fl) o.flags = Object.keys(HIT).filter(k => e.fl & HIT[k]).map(k => k.toLowerCase());
      out.push(o);
    }
    return out;
  }

  buildState(f) {
    const o = this.f[1 - f.side];
    const dist = Math.hypot(o.x - f.x, o.y - f.y);
    const t = this.time;
    const abName = (side, i) => this.f[side].spec.abilities[i].name;
    return {
      tick: this.tick,
      time: r2(t),
      timeLeft: r2(RULES.roundTime - t),
      level: f.level,
      arena: {
        radius: r2(this.ringR), center: { x: 0, y: 0 }, maxRadius: this.arena.radius,
        minRadius: this.arena.minRadius, shrinkStart: this.arena.shrinkStart, shrinkEnd: this.arena.shrinkEnd,
        shrinking: t >= this.arena.shrinkStart && t < this.arena.shrinkEnd,
        obstacles: this.obstacles.map(b => ({ x: b.x, y: b.y, radius: b.r })),
      },
      turrets: this.turrets.map(tu => ({
        id: tu.id, x: r2(tu.x), y: r2(tu.y), mine: tu.owner === f.side, timeLeft: r2(tu.life), range: tu.range,
        ability: abName(tu.owner, tu.ab), nextShot: r2(Math.max(0, tu.next - t)),
      })),
      godfx: this.P && this.pctx && this.P.state ? this.safePower(() => this.P.state(this.pctx, this.handle(f)), []) : [],
      me: this.publicFighter(f, true),
      enemy: this.publicFighter(o, false),
      distance: r2(dist),
      gap: r2(dist - 2 * R),
      angleToEnemy: r2(Math.atan2(o.y - f.y, o.x - f.x)),
      projectiles: this.projectiles.map(p => ({
        id: p.id, x: r2(p.x), y: r2(p.y), vx: r2(Math.cos(p.dir) * p.speed), vy: r2(Math.sin(p.dir) * p.speed),
        radius: p.radius, mine: p.owner === f.side, damage: this.f[p.owner].spec.abilities[p.ab].damage,
        ability: abName(p.owner, p.ab), homing: p.homing, returning: !!p.returning, basic: !!this.f[p.owner].spec.abilities[p.ab].basic,
      })),
      zones: this.zones.map(z => ({
        id: z.id, x: r2(z.x), y: r2(z.y), radius: z.radius, mine: z.owner === f.side, timeLeft: r2(z.remaining),
        dps: r2(z.dps), slow: z.slow, pull: z.pull, follow: z.follow, ability: abName(z.owner, z.ab),
      })),
      traps: this.traps.map(tr => ({
        id: tr.id, x: r2(tr.x), y: r2(tr.y), radius: tr.radius, mine: tr.owner === f.side, armed: tr.armIn <= 0,
        armsIn: r2(Math.max(0, tr.armIn)), timeLeft: r2(tr.life), ability: abName(tr.owner, tr.ab),
      })),
      beams: this.beams.map(b => ({ mine: b.owner === f.side, x1: r2(b.x1), y1: r2(b.y1), x2: r2(b.x2), y2: r2(b.y2), width: b.width, ability: abName(b.owner, b.ab) })),
      meteors: this.meteors.map(m => ({ mine: m.owner === f.side, x: r2(m.x), y: r2(m.y), radius: m.radius, timeLeft: r2(Math.max(0, m.at - t)), ability: abName(m.owner, m.ab) })),
      events: this.eventsFor(f),
      rules: {
        fighterRadius: R, tickRate: RULES.tickRate, thinkEvery: RULES.thinkEvery, roundTime: RULES.roundTime,
        globalCooldown: RULES.globalCooldown, stunImmunity: RULES.stunImmunity, ccImmunity: RULES.ccImmunity,
        dashSpeed: RULES.dashSpeed, critMult: RULES.critMult, stanceCooldown: RULES.stanceCooldown,
        swapTime: RULES.swapTime, swapCooldown: RULES.swapCooldown, awakenAfter: RULES.awakenAfter,
        stances: STANCES,
      },
    };
  }

  resolveUse(f, use) {
    if (typeof use === 'number' && Number.isInteger(use)) return use;
    if (typeof use !== 'string') return -1;
    const want = use.toLowerCase();
    if (want === 'attack' || want === 'basic') return this.activeBasic(f);
    if (want === 'ultimate' || want === 'ult') return f.ultIdx;
    const idx = f.spec.abilities.findIndex(x => x.name.toLowerCase() === want);
    // both weapons may share an attack name: pick the one in hand
    if (idx >= 0 && f.spec.abilities[idx].basic) return this.activeBasic(f);
    return idx;
  }

  applyAction(f, a) {
    f.move = { x: 0, y: 0 };
    f.pending = null;
    if (!a || typeof a !== 'object') return;
    let mv = a.move;
    if (typeof mv === 'number' && Number.isFinite(mv)) mv = { x: Math.cos(mv), y: Math.sin(mv) };
    if (mv && typeof mv === 'object' && Number.isFinite(mv.x) && Number.isFinite(mv.y)) {
      const l = Math.hypot(mv.x, mv.y);
      f.move = l > 1 ? { x: mv.x / l, y: mv.y / l } : { x: mv.x, y: mv.y };
    }
    let target = null;
    const tg = a.target;
    if (tg && typeof tg === 'object' && Number.isFinite(tg.x) && Number.isFinite(tg.y)) target = { x: tg.x, y: tg.y };
    else if (typeof tg === 'number' && Number.isFinite(tg)) target = { x: f.x + Math.cos(tg) * 200, y: f.y + Math.sin(tg) * 200 };
    f.aim = target;
    if (a.cancel === true) this.cancel(f);
    // v4 commands
    if (typeof a.stance === 'string' && a.stance !== f.stance && STANCES[a.stance]) this.setStance(f, a.stance);
    if (a.swap === true) this.swapWeapon(f);
    if (a.awaken === true) this.awaken(f);
    if (typeof a.god === 'string' && a.god) this.castGod(f, a.god, target);
    if (typeof a.emote === 'string' && EMOTES.includes(a.emote) && this.time - f.lastEmote >= RULES.emoteCooldown) {
      f.lastEmote = this.time;
      f.stats.emotes++;
      this.ev({ k: 'emote', a: f.side, v: a.emote });
    }
    if (a.use !== undefined && a.use !== null && a.use !== false && a.use !== '') {
      const idx = this.resolveUse(f, a.use);
      if (idx < 0 || idx >= f.spec.abilities.length) f.stats.blockedCasts.unknown++;
      else f.pending = { idx, target };
    }
    if (typeof a.say === 'string' && a.say.trim() && this.time - f.lastSay >= RULES.sayCooldown) {
      const text = a.say.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, RULES.sayMaxLength);
      f.lastSay = this.time;
      if (f.stats.says.length < 40) f.stats.says.push({ t: r1(this.time), text });
      this.ev({ k: 'say', a: f.side, text });
    }
    if (a.draw !== undefined) {
      const shapes = cleanDraw(a.draw) || [];
      const key = JSON.stringify(shapes);
      // A new drawing at most every 0.2 s; an unchanged one is re-sent every 0.4 s so the
      // spectators' overlay (which fades after 0.5 s) keeps showing it while the brain draws it.
      const since = this.time - f.lastDrawAt;
      if ((key !== f.lastDraw && since >= 0.2) || since >= 0.4) {
        f.lastDraw = key;
        f.lastDrawAt = this.time;
        this.ev({ k: 'draw', a: f.side, shapes });
      }
    }
  }

  cancel(f) {
    if (f.casting) {
      const c = f.casting;
      const ab = f.spec.abilities[c.idx];
      f.energy = Math.min(f.d.maxEnergy, f.energy + ab.energy * 0.5);
      f.cooldowns[c.idx] = Math.min(f.cooldowns[c.idx], ab.cooldown * 0.5);
      f.stats.abilities[c.idx].cancelled++;
      this.ev({ k: 'cancel', a: f.side, ab: c.idx });
      f.casting = null;
    } else if (f.channel) {
      this.endChannel(f);
    }
  }

  // ── v4 systems: stances, weapon swap, awakening, godly powers, cinematics ──
  setStance(f, id) {
    if (f.ko || f.stanceCd > 1e-9 || f.frozen > 0) return false;
    if (id !== 'balanced' && !unlocked('stances', f.level)) return false;
    f.stance = id;
    f.stanceCd = RULES.stanceCooldown;
    f.stats.stanceSwitches++;
    this.ev({ k: 'stance', a: f.side, v: id });
    return true;
  }

  swapWeapon(f) {
    if (f.ko || f.offIdx < 0 || f.swapCd > 1e-9 || f.casting || f.channel || f.godCast || f.stun > 0 || f.frozen > 0) return false;
    f.weaponSlot = 1 - f.weaponSlot;
    f.weapon = f.weaponSlot === 1 ? f.offWeapon : f.mainWeapon;
    // the weapon's passive stat bonuses (speed, crit, regen) come with it; HP / energy pools stay
    f.d = f.weaponSlot === 1 ? f.dOff : f.dMain;
    f.swapLock = RULES.swapTime;
    f.swapCd = RULES.swapCooldown;
    f.katanaUntil = -1; f.clawCombo = 0;
    f.stats.swaps++;
    this.ev({ k: 'swap', a: f.side, w: f.weapon });
    return true;
  }

  awaken(f) {
    if (!this.canAwaken(f)) return false;
    f.awakenUsed = true;
    f.ascended = f.ascends;
    f.awakened = f.awakenDur;
    f.stats.awakenings++;
    if (f.ascended) {
      // godly form: shrug off every crowd control, +40 divinity
      f.stun = 0; f.root = 0; f.silence = 0; f.slow = 0; f.slowTime = 0;
      if (f.godPowers.length) f.div = Math.min(100, f.div + 40);
    } else { f.root = 0; f.slow = 0; f.slowTime = 0; }
    this.ev({ k: 'awaken', a: f.side, v: f.ascended ? 'ascend' : 'awaken', x: r1(f.x), y: r1(f.y) });
    return true;
  }

  castGod(f, id, target) {
    if (!this.P || !this.pctx || !f.godPowers.includes(id)) { f.stats.blockedCasts.unknown++; return false; }
    if (f.ko || f.div < 100 || f.busy || f.stun > 0 || f.frozen > 0) { f.stats.blockedCasts.charge++; return false; }
    const def = (this.P.GOD_POWERS || {})[id] || {};
    const o = this.f[1 - f.side];
    const tgt = target || { x: o.x, y: o.y };
    const ok = this.safePower(() => this.P.cast(this.pctx, this.handle(f), id, tgt), false);
    if (!ok) return false;
    f.div = 0;
    f.divReadyAnnounced = false;
    f.stats.godCasts++;
    const castTime = Math.max(RULES.godMinCast, Number(def.cast) || 0);
    this.ev({ k: 'god', a: f.side, id, x: r1(tgt.x), y: r1(tgt.y), cast: castTime });
    f.godCast = { id, remaining: castTime, total: castTime, target: tgt };
    return true;
  }

  stepGodCast(f) {
    const g = f.godCast;
    if (!g || f.ko) return;
    g.remaining -= DT;
    if (g.remaining <= 1e-9) {
      f.godCast = null;
      this.safePower(() => this.P.fire(this.pctx, this.handle(f), g.id, g.target), null);
    }
  }

  safePower(fn, fallback) {
    try { return fn(); } catch (e) {
      if (!this.powerError) { this.powerError = String(e && e.message || e); this.ev({ k: 'g:error', a: 0, text: this.powerError.slice(0, 120) }); }
      return fallback;
    }
  }

  /** A hit-stop / cut-in: playback holds for `ms` at this tick (capped per fight in finalize). */
  cinematic(kind, a, v, ms) {
    // ultimates, godly powers and awakenings show a charge-up / transformation in the arena
    // instead of freezing the fight: only short hit-stops for big hits and the K.O. remain
    if (kind === 'ult' || kind === 'god' || kind === 'awaken' || kind === 'ascend') return;
    const budget = ms !== undefined ? ms : this.cinBudget[kind];
    if (!budget) return;
    const t = this.tick + 1;
    const hitKinds = ['impact', 'ulthit', 'godhit', 'ko'];
    if (hitKinds.includes(kind)) {
      // one hit-stop per moment: keep the more important one
      const same = this.cinematics.find(c => c.t === t && hitKinds.includes(c.kind));
      if (same) {
        if ((CINEMATIC_PRIORITY[same.kind] || 0) >= (CINEMATIC_PRIORITY[kind] || 0)) return;
        Object.assign(same, { ms: Math.round(budget), kind, a, v });
        return;
      }
    }
    this.cinematics.push({ t, ms: Math.round(budget), kind, a, v });
  }

  /** Big hits: impact event + (throttled) hit-stop. */
  impact(attacker, victim, dmg, kind) {
    const pct = dmg / Math.max(1, victim.d.maxHp);
    this.ev({ k: 'impact', a: attacker.side, v: victim.side, dmg: Math.round(dmg), pct: r2(pct), x: r1(victim.x), y: r1(victim.y), kind });
    const cin = kind === 'ult' ? 'ulthit' : kind === 'god' ? 'godhit' : kind === 'ko' ? 'ko' : 'impact';
    if (cin === 'impact' && this.time - attacker.lastImpact < 2) return;
    attacker.lastImpact = this.time;
    this.cinematic(cin, attacker.side, victim.side);
  }

  /**
   * Charge the ultimate / divinity meters from damage dealt and taken (ultimate and godly damage
   * never charge them, so big moments can't chain). A full meter takes about: ultimate 60% of the
   * enemy's HP dealt or 100% of yours taken; divinity 80% / 130%; plus a slow passive trickle.
   */
  charge(attacker, target, dmg, noCharge) {
    if (dmg <= 0 || noCharge) return;
    for (const [f, other, dealt] of [[attacker, target, true], [target, attacker, false]]) {
      if (!f || f.ko) continue;
      const mult = f.d.chargeMult || 1;
      if (f.ultIdx >= 0) f.ult = Math.min(100, f.ult + mult * 100 * dmg / (dealt ? CHARGE.ult.dealt * other.d.maxHp : CHARGE.ult.taken * f.d.maxHp));
      if (f.godPowers.length) f.div = Math.min(100, f.div + mult * 100 * dmg / (dealt ? CHARGE.div.dealt * other.d.maxHp : CHARGE.div.taken * f.d.maxHp));
    }
  }

  // ── PowerAPI: the only way engine/powers.js touches the fight ──────────────
  handle(f) {
    if (!f.__handle) {
      const sim = this;
      f.__handle = {
        get side() { return f.side; }, get x() { return f.x; }, get y() { return f.y; }, get hp() { return f.hp; },
        get maxHp() { return f.d.maxHp; }, get energy() { return f.energy; }, get facing() { return f.facing; },
        get stunned() { return f.stun > 0; }, get dead() { return f.ko; }, get level() { return f.level; },
        get awakened() { return f.awakened > 0; }, get ascended() { return f.ascended && f.awakened > 0; },
        get damageMult() { return sim.damageMult(f); },
        __f: f,
      };
    }
    return f.__handle;
  }

  powerApi() {
    const sim = this;
    const F = (h) => (h && h.__f) || h;
    return {
      get time() { return sim.time; }, get tick() { return sim.tick; }, tickRate: RULES.tickRate, get level() { return sim.level; },
      get fighters() { return sim.f.map(f => sim.handle(f)); },
      enemyOf: (h) => sim.handle(sim.f[1 - F(h).side]),
      damage: (att, tgt, amount, opts = {}) => {
        const a = F(att), t = F(tgt);
        if (!t || t.ko || !(amount > 0)) return 0;
        if (t.invulnerable && !opts.pierce) return 0;
        const res = sim.dealDamage(a, t, amount, null, opts.kind === 'dot' ? 'zone' : 'god', { canCrit: false, pierce: !!opts.pierce });
        a.stats.godDamage += res.total;
        return res.total;
      },
      heal: (h, amount) => sim.heal(F(h), amount, null, 'heal'),
      shield: (h, amount, dur) => { const f = F(h); f.shield = Math.max(f.shield, amount); f.shieldTime = Math.max(f.shieldTime, dur || 3); },
      stun: (h, s) => sim.applyStun(F(h), s, null),
      root: (h, s) => sim.applyRoot(F(h), s),
      silence: (h, s) => sim.applySilence(F(h), s),
      slow: (h, amount, dur) => sim.applySlow(F(h), amount, dur),
      knock: (h, fromX, fromY, dist) => sim.knockFrom(F(h), fromX, fromY, dist),
      pull: (h, toX, toY, dist) => sim.knockFrom(F(h), toX, toY, -Math.abs(dist)),
      teleport: (h, x, y) => { const f = F(h); f.x = x; f.y = y; sim.clampRing(f); sim.pushOutObstacles(f); },
      buff: (h, stat, amount, dur) => {
        const b = F(h).buffs[stat];
        if (!b) return;
        const pct = Math.abs(amount) < 5 ? amount * 100 : amount;   // powers pass fractions (0.35 = +35%)
        b.amount = Math.max(b.time > 0 ? b.amount : 0, pct); b.time = Math.max(b.time, dur);
      },
      invuln: (h, s) => { const f = F(h); f.invulnTime = Math.max(f.invulnTime, s); },
      freeze: (h, s) => {
        const f = F(h);
        if (f.ko || (f.ascended && f.awakened > 0)) return false;   // an ascended god can't be frozen
        f.frozen = Math.max(f.frozen, s); sim.interrupt(f); if (f.dash) sim.endDash(f);
        return true;
      },
      setFlag2: (h, bit, on) => { const f = F(h); if (on) f.flags2Extra |= bit; else f.flags2Extra &= ~bit; },
      event: (e) => sim.ev(Object.assign({}, e, { k: String(e.k || 'g:fx').startsWith('g:') ? e.k : `g:${e.k}` })),
      impact: (att, vic, dmg, kind) => sim.impact(F(att), F(vic), dmg, kind || 'god'),
      cinematic: (kind, a, ms) => sim.cinematic(kind, a, undefined, ms),
      dist: (a, b) => Math.hypot(a.x - b.x, a.y - b.y),
      inRing: (p) => Math.hypot(p.x, p.y) <= sim.ringR - R,
      blocked: (p, r) => sim.obstacles.some(b => Math.hypot(p.x - b.x, p.y - b.y) < b.r + (r || 0)),
      lineOfSight: (a, b, w) => !sim.obstacles.some(o => segDist(o.x, o.y, a.x, a.y, b.x, b.y) < o.r + (w || 0)),
      get obstacles() { return sim.obstacles.map(o => ({ x: o.x, y: o.y, r: o.r })); },
      get ringRadius() { return sim.ringR; },
    };
  }

  /** Knock f away from (fx, fy) by dist (negative = toward it); respects Unstoppable, tenacity and Titan Belt. */
  knockFrom(f, fx, fy, dist) {
    if (f.ko || f.traits.has('unstoppable') || (f.ascended && f.awakened > 0)) return;
    const k = this.ccMult(f) * (f.relics.has('titan_belt') ? 0.5 : 1);
    let dir, mag;
    if (dist >= 0) { dir = Math.atan2(f.y - fy, f.x - fx); mag = dist * k; }
    else { dir = Math.atan2(fy - f.y, fx - f.x); mag = Math.min(-dist * k, Math.max(0, Math.hypot(f.x - fx, f.y - fy) - R)); }
    const n = 6;
    if (mag > 0) f.knock = { dx: Math.cos(dir) * mag / n, dy: Math.sin(dir) * mag / n, n };
    if (f.dash) this.endDash(f);
    if (f.channel) this.endChannel(f, true);
  }

  // ── combat helpers ────────────────────────────────────────────────────────
  regenOf(f) {
    const adrenaline = f.traits.has('adrenaline') && f.hp < f.d.maxHp * 0.4 ? 1.6 : 1;
    const aw = f.awakened > 0 ? (f.ascended ? 2 : 1.5) : 1;
    return f.d.energyRegen * adrenaline * aw;
  }

  dealDamage(attacker, target, raw, abIdx, kind = 'hit', opts = {}) {
    if (target.ko || raw <= 0) return { total: 0, absorbed: 0, crit: false, blocked: false };
    let amt = raw;
    const at = attacker.traits, tt = target.traits;
    const ab = abIdx !== null && abIdx !== undefined ? attacker.spec.abilities[abIdx] : null;
    const basic = !!(ab && ab.basic);
    const direct = kind === 'hit' || kind === 'beam' || kind === 'counter';
    if (kind !== 'thorns') {
      if (at.has('berserker')) amt *= 1 + Math.min(0.25, (1 - Math.max(0, attacker.hp) / attacker.d.maxHp) / 3);
      if (at.has('executioner') && target.hp / target.d.maxHp < 0.3) amt *= 1.25;
      if (at.has('opportunist') && (target.stun > 0 || target.slowTime > 0 || target.root > 0)) amt *= 1.2;
      if (ab && !basic && attacker.weapon === 'staff') amt *= 1.1;
      if (attacker.relics.has('scholars_tome') && ((ab && ab.ultimate) || kind === 'god')) amt *= 1.15;
    }
    let crit = false;
    if (kind === 'hit' || kind === 'counter') {
      const dist = Math.hypot(target.x - attacker.x, target.y - attacker.y);
      if (at.has('marksman') && dist > 300) amt *= 1.15;
      if (at.has('close_quarters') && dist < 120) amt *= 1.15;
      if (at.has('momentum') && attacker.momentumUntil > this.time) { amt *= 1.3; attacker.momentumUntil = -1; }
      if (basic) {
        if (at.has('duelist')) amt *= 1.15;
        if (attacker.relics.has('berserker_helm') && attacker.hp < attacker.d.maxHp * 0.5) amt *= 1.2;
        if (at.has('spellblade') && attacker.spellbladeUntil > this.time) { amt *= 1.35; attacker.spellbladeUntil = -1; }
        if (attacker.weapon === 'bow' && dist > 350) amt *= 1.15;
        if (attacker.weapon === 'claws') amt *= 1 + 0.05 * attacker.clawCombo;
        if (attacker.weapon === 'dagger') {
          const behind = Math.abs(angleDiff(Math.atan2(attacker.y - target.y, attacker.x - target.x), target.facing)) > 110 * DEG;
          if (behind) amt *= 1.4;
        }
      }
      const forced = basic && attacker.weapon === 'katana' && attacker.katanaUntil > this.time;
      if (forced) attacker.katanaUntil = -1;
      if (forced || (opts.canCrit !== false && this.rng() < this.critChance(attacker))) {
        crit = true;
        amt *= attacker.d.critMult;
      }
    }
    // armor (the attacker's precision ignores part of it)
    const pen = Math.min(0.9, attacker.d.armorPen + (basic && attacker.weapon === 'crossbow' ? 0.4 : 0));
    const armor = target.d.armor * (1 - pen);
    let dmg = amt * target.d.takenMult * 100 / (100 + STAT.armorPer * armor);
    dmg *= 1 - target.buff('armor') / 100;
    if (target.vuln.time > 0) dmg *= 1 + target.vuln.amount;
    dmg *= (STANCES[target.stance] || STANCES.balanced).taken;
    if (target.marked > 0) dmg *= 1.2;
    if (target.casting && target.casting.idx === target.ultIdx) dmg *= RULES.exposedTaken;   // exposed while charging an ultimate
    if (DOT_KINDS.has(kind)) dmg *= this.dotMult(target);
    if (tt.has('last_stand') && target.hp / target.d.maxHp < 0.25) dmg *= 0.7;
    let blocked = false;
    if (target.weapon === 'shield' && direct) {
      const from = Math.atan2(attacker.y - target.y, attacker.x - target.x);
      if (Math.abs(angleDiff(from, target.facing)) <= 60 * DEG) { const cut = dmg * 0.15; dmg -= cut; blocked = true; target.stats.blocked += cut; }
    }
    let absorbed = 0;
    if (target.shield > 0) {
      absorbed = Math.min(target.shield, dmg);
      target.shield -= absorbed;
    }
    target.hp -= dmg - absorbed;
    attacker.stats.dealt += dmg;
    target.stats.taken += dmg;
    target.stats.shieldAbsorbed += absorbed;
    if (crit) { attacker.stats.crits++; if (ab) attacker.stats.abilities[abIdx].crits++; }
    if (ab) attacker.stats.abilities[abIdx].damage += dmg;
    if (basic) attacker.stats.basicDamage += dmg;
    if (ab && ab.ultimate) attacker.stats.ultDamage += dmg;
    target.lastHitBy = attacker.side;
    if (kind !== 'thorns' && dmg > 0) {
      if (at.has('vampiric')) this.heal(attacker, dmg * 0.08, null, 'vampiric');
      if (basic && attacker.weapon === 'scythe' && kind === 'hit') this.heal(attacker, dmg * 0.15, null, 'lifesteal');
      if (basic && kind === 'hit' && attacker.relics.has('vampire_fang')) this.heal(attacker, dmg * 0.2, null, 'lifesteal');
      if (kind === 'hit' && attacker.relics.has('hunters_mark') && attacker.relicState.markCd <= 0) {
        attacker.relicState.markCd = 8;
        target.marked = 3;
        this.relicFired(attacker, 'hunters_mark');
      }
      this.charge(attacker, target, dmg, (ab && ab.ultimate) || kind === 'god');
      // big moments get impact frames / hit-stop
      if (ab && ab.ultimate && attacker.ultImpactPending) { attacker.ultImpactPending = false; this.impact(attacker, target, dmg, 'ult'); }
      else if (kind === 'god') { /* engine/powers.js calls api.impact on its big hits */ }
      else if ((kind === 'hit' || kind === 'counter') && dmg >= 0.07 * target.d.maxHp) this.impact(attacker, target, dmg, crit ? 'crit' : 'big');
      if (this.P && this.pctx && this.P.onDamage) this.safePower(() => this.P.onDamage(this.pctx, this.handle(attacker), this.handle(target), { amount: dmg, kind, crit, ability: ab ? ab.name : null, basic }), null);
    }
    if (tt.has('thorns') && opts.melee && dmg > 0 && kind === 'hit') {
      const back = this.dealDamage(target, attacker, dmg * 0.2, null, 'thorns');
      if (back.total > 0) this.ev({ k: 'dot', a: target.side, kind: 'thorns', dmg: Math.round(back.total), x: r1(attacker.x), y: r1(attacker.y) });
    }
    if (tt.has('second_wind') && !target.secondWindUsed && target.hp > 0 && target.hp < target.d.maxHp * 0.3) {
      target.secondWindUsed = true;
      const healed = this.heal(target, target.d.maxHp * 0.15, null, 'heal');
      this.ev({ k: 'trait', a: target.side, id: 'second_wind', v: Math.round(healed) });
    }
    return { total: dmg, absorbed, crit, blocked };
  }

  relicFired(f, id) {
    f.stats.relicTriggers++;
    // frequent relics work quietly (their effect is visible anyway); rare moments get an event
    if (QUIET_RELICS.has(id)) return;
    this.ev({ k: 'relic', a: f.side, id, x: r1(f.x), y: r1(f.y) });
  }

  /** Warding Rune: the first stun / root / silence every 15 s is ignored. */
  warded(target) {
    if (!target.relics.has('warding_rune') || target.relicState.ward > 0) return false;
    target.relicState.ward = 6;
    this.relicFired(target, 'warding_rune');
    return true;
  }

  heal(f, amount, abIdx, kind) {
    if (f.ko || amount <= 0) return 0;
    amount *= f.d.healMult || 1;
    if (f.poisonTime > 0) amount *= 0.5;
    const before = f.hp;
    f.hp = Math.min(f.d.maxHp, f.hp + amount);
    const done = f.hp - before;
    f.stats.healed += done;
    if (kind === 'lifesteal') f.stats.lifesteal += done;
    if (abIdx !== null && abIdx !== undefined) f.stats.abilities[abIdx].healing += done;
    return done;
  }

  applySlow(target, amount, duration) {
    if (target.immune > 0 || target.awakened > 0) return false;
    if (target.traits.has('unstoppable')) amount *= 0.6;
    duration *= this.ccMult(target);
    if (target.slowTime <= 0) { target.slow = amount; target.slowTime = duration; return true; }
    target.slow = Math.max(target.slow, amount);
    target.slowTime = Math.max(target.slowTime, duration);
    return true;
  }

  applyStun(target, dur, attacker) {
    if (target.immune > 0 || dur <= 0 || (target.ascended && target.awakened > 0)) return 'none';
    if (target.stunImmune > 0) { target.stats.stunsResisted++; return 'resisted'; }
    if (this.warded(target)) return 'resisted';
    let d = dur * this.ccMult(target);
    if (target.traits.has('iron_will')) d *= 0.6;
    target.stun = Math.max(target.stun, d);
    target.stunImmune = d + RULES.stunImmunity;
    if (attacker) attacker.stats.stunsLanded++;
    this.interrupt(target);
    if (target.dash) this.endDash(target);
    return 'stunned';
  }

  applyRoot(target, dur) {
    if (target.immune > 0 || target.rootImmune > 0 || dur <= 0 || target.awakened > 0) return false;
    if (this.warded(target)) return false;
    let d = dur * this.ccMult(target);
    if (target.traits.has('iron_will')) d *= 0.6;
    if (target.traits.has('unstoppable')) d *= 0.6;
    target.root = Math.max(target.root, d);
    target.rootImmune = d + RULES.ccImmunity;
    if (target.dash) this.endDash(target);
    return true;
  }

  applySilence(target, dur) {
    if (target.immune > 0 || target.silenceImmune > 0 || dur <= 0 || (target.ascended && target.awakened > 0)) return false;
    if (this.warded(target)) return false;
    let d = dur * this.ccMult(target);
    if (target.traits.has('iron_will')) d *= 0.6;
    target.silence = Math.max(target.silence, d);
    target.silenceImmune = d + RULES.ccImmunity;
    if (target.casting && !target.spec.abilities[target.casting.idx].basic) this.interrupt(target);
    if (target.channel) this.endChannel(target, true);
    return true;
  }

  applyDot(target, kind, dps, duration, src) {
    if (target.immune > 0) return false;
    const k = kind === 'burn' ? 'burn' : kind === 'poison' ? 'poison' : 'bleed';
    const dpsKey = `${k}Dps`, timeKey = `${k}Time`, srcKey = `${k}Src`;
    if (target[timeKey] <= 0 || dps >= target[dpsKey]) { target[dpsKey] = dps; target[srcKey] = src; }
    target[timeKey] = Math.max(target[timeKey], duration);
    return true;
  }

  interrupt(f) {
    if (f.casting) {
      f.stats.abilities[f.casting.idx].interrupted++;
      this.ev({ k: 'interrupt', a: f.side, ab: f.casting.idx });
      if (f.casting.idx === f.ultIdx) { f.ult = Math.max(f.ult, RULES.chargeRefund); f.ultImpactPending = false; }
      f.casting = null;
    }
    if (f.godCast) {
      const bit = this.P && this.P.FLAGS2 ? this.P.FLAGS2.GOD_CAST : 0;
      if (bit) f.flags2Extra &= ~bit;
      this.ev({ k: 'interrupt', a: f.side, god: f.godCast.id });
      f.div = Math.max(f.div, RULES.chargeRefund);
      f.godCast = null;
    }
    if (f.channel) this.endChannel(f, true);
  }

  endDash(f) { f.dash = null; }

  endChannel(f, interrupted = false) {
    const ch = f.channel;
    if (!ch) return;
    f.channel = null;
    if (interrupted) f.stats.abilities[ch.idx].interrupted++;
    this.ev({ k: 'beamend', a: f.side, ab: ch.idx });
  }

  // A parry negates the hit and may strike back. Returns true when the hit was countered.
  tryCounter(attacker, target) {
    if (target.counterTime <= 0 || target.ko) return false;
    const cab = target.spec.abilities[target.counterIdx];
    target.counterTime = 0;
    target.stats.countersLanded++;
    target.stats.abilities[target.counterIdx].hits++;
    this.ev({ k: 'counter', a: target.side, ab: target.counterIdx, ok: 1, x: r1(target.x), y: r1(target.y) });
    if (attacker.dash) this.endDash(attacker);
    if (attacker.channel) this.endChannel(attacker, true);
    const gap = Math.hypot(attacker.x - target.x, attacker.y - target.y) - 2 * R;
    if (cab && gap <= cab.range && (cab.damage > 0 || hasEffects(cab))) {
      this.applyHit(target, attacker, cab, { fromCounter: true, dir: Math.atan2(attacker.y - target.y, attacker.x - target.x), kind: 'counter' });
    }
    return true;
  }

  applyHit(attacker, target, ab, opts = {}) {
    if (target.ko) return false;
    if (target.invulnerable) {
      attacker.stats.abilities[ab.index].evaded++;
      target.stats.evades++;
      this.ev({ k: 'evade', a: target.side, x: r1(target.x), y: r1(target.y) });
      return false;
    }
    if (!opts.fromCounter && this.tryCounter(attacker, target)) {
      attacker.stats.abilities[ab.index].countered++;
      return false;
    }
    const mult = opts.mult !== undefined ? opts.mult : this.damageMult(attacker);
    const fx = ab.effects || {};
    let flags = ab.basic ? HIT.BASIC : 0;
    const melee = ab.type === 'melee' || ab.type === 'dash';
    const hits = ab.type === 'melee' ? Math.max(1, ab.hits || 1) : 1;
    let total = 0, absorbed = 0;
    if (ab.damage > 0) {
      for (let h = 0; h < hits; h++) {
        const r = this.dealDamage(attacker, target, ab.damage * mult, ab.index, opts.kind === 'counter' ? 'counter' : 'hit', { melee });
        total += r.total; absorbed += r.absorbed;
        if (r.crit) flags |= HIT.CRIT;
        if (r.blocked) flags |= HIT.BLOCK;
        if (target.hp <= 0) break;
      }
    }
    if (fx.lifesteal && total > 0) {
      this.heal(attacker, total * fx.lifesteal, ab.index, 'lifesteal');
      flags |= HIT.LIFESTEAL;
    }
    if (fx.stun) {
      const s = this.applyStun(target, fx.stun, attacker);
      if (s === 'stunned') flags |= HIT.STUN;
      else if (s === 'resisted') flags |= HIT.RESISTED;
    }
    if (fx.root && this.applyRoot(target, fx.root)) flags |= HIT.ROOT;
    if (fx.silence && this.applySilence(target, fx.silence)) flags |= HIT.SILENCE;
    if (fx.slow && this.applySlow(target, fx.slow.amount, fx.slow.duration)) flags |= HIT.SLOW;
    if (fx.burn && this.applyDot(target, 'burn', fx.burn.dps * mult, fx.burn.duration, { side: attacker.side, ab: ab.index })) flags |= HIT.BURN;
    if (fx.poison && this.applyDot(target, 'poison', fx.poison.dps * mult, fx.poison.duration, { side: attacker.side, ab: ab.index })) flags |= HIT.POISON;
    if (fx.vulnerable && target.immune <= 0) {
      target.vuln = { amount: Math.max(target.vuln.time > 0 ? target.vuln.amount : 0, fx.vulnerable.amount), time: Math.max(target.vuln.time, fx.vulnerable.duration) };
      flags |= HIT.VULN;
    }
    if (fx.weaken && target.immune <= 0) {
      target.weak = { amount: Math.max(target.weak.time > 0 ? target.weak.amount : 0, fx.weaken.amount), time: Math.max(target.weak.time, fx.weaken.duration) };
      flags |= HIT.WEAK;
    }
    if (fx.drain) {
      const got = Math.min(target.energy, fx.drain);
      target.energy -= got;
      attacker.energy = Math.min(attacker.d.maxEnergy, attacker.energy + got / 2);
      attacker.stats.drained += got;
      flags |= HIT.DRAIN;
    }
    const unstoppable = target.traits.has('unstoppable') || (target.ascended && target.awakened > 0);
    if (fx.knockback && !unstoppable) {
      let dir, dist = fx.knockback * this.ccMult(target) * (target.relics.has('titan_belt') ? 0.5 : 1);
      if (dist < 0) {
        // Pull: always straight toward the attacker, never past them.
        dir = Math.atan2(target.y - attacker.y, target.x - attacker.x);
        const gap = Math.hypot(target.x - attacker.x, target.y - attacker.y) - 2 * R;
        dist = -Math.min(-dist, Math.max(0, gap - 2));
      } else {
        dir = opts.dir !== undefined ? opts.dir : Math.atan2(target.y - attacker.y, target.x - attacker.x);
      }
      const n = 6;
      if (dist !== 0) target.knock = { dx: Math.cos(dir) * dist / n, dy: Math.sin(dir) * dist / n, n };
      if (target.dash) this.endDash(target);
      if (target.channel) this.endChannel(target, true);
      flags |= HIT.KNOCK;
    }
    // weapon passives on attack hits
    if (ab.basic) this.weaponOnHit(attacker, target, total, flags);
    // relics that trigger on hits
    const rl = attacker.relics;
    if (rl.size && !target.ko) {
      if (rl.has('frost_heart') && this.applySlow(target, 0.25, 1.5)) flags |= HIT.SLOW;
      if (rl.has('venom_gland') && ab.basic) {
        const dps = 5 * attacker.wScale * this.damageMult(attacker);
        if (this.applyDot(target, 'poison', dps, 3, { side: attacker.side, ab: ab.index })) flags |= HIT.POISON;
      }
      if (rl.has('thunder_idol') && ++attacker.relicState.thunder % 4 === 0) {
        const bolt = this.dealDamage(attacker, target, 30 * attacker.wScale * this.damageMult(attacker), null, 'relic');
        this.relicFired(attacker, 'thunder_idol');
        this.ev({ k: 'dot', a: attacker.side, kind: 'lightning', dmg: Math.round(bolt.total), x: r1(target.x), y: r1(target.y) });
      }
    }
    if (total > attacker.stats.biggestHit) {
      attacker.stats.biggestHit = total;
      attacker.stats.biggestHitAbility = ab.name;
    }
    this.ev({ k: 'hit', a: attacker.side, ab: ab.index, dmg: Math.round(total), abs: Math.round(absorbed), x: r1(target.x), y: r1(target.y), fl: flags });
    return true;
  }

  weaponOnHit(f, target, dmg) {
    switch (f.weapon) {
      case 'shortsword': f.energy = Math.min(f.d.maxEnergy, f.energy + 3); break;
      case 'hammer':
        f.hammerHits++;
        if (f.hammerHits % 3 === 0) this.applyStun(target, 0.5 * f.wScale, f);
        break;
      case 'axe': {
        const dps = 5 * f.wScale * (f.traits.has('venomous') ? 1.3 : 1) * this.damageMult(f);
        this.applyDot(target, 'bleed', dps, 3, { side: f.side, ab: f.basicIdx });
        break;
      }
      case 'claws':
        f.clawCombo = this.time <= f.clawUntil ? Math.min(5, f.clawCombo + 1) : 1;
        f.clawUntil = this.time + 1.5;
        break;
      default: break;
    }
    void dmg;
  }

  // ── casting ───────────────────────────────────────────────────────────────
  tryCast(f, idx, target) {
    const st = f.stats.blockedCasts;
    if (f.ko) return;
    const ab = f.spec.abilities[idx];
    if (ab.type !== 'cleanse') {
      if (f.stun > 0) { st.stunned++; return; }
      if (f.silence > 0 && !ab.basic) { st.silenced++; return; }
      if (f.root > 0 && ab.type === 'dash') { st.rooted++; return; }
    }
    if (f.busy || f.frozen > 0) { st.busy++; return; }
    if (ab.basic && (idx !== this.activeBasic(f) || f.swapLock > 0)) { st.busy++; return; }
    if (f.gcd > 1e-9) { st.gcd++; return; }
    if (f.cooldowns[idx] > 1e-9) { st.cooldown++; return; }
    if (ab.ultimate && f.ult < 100) { st.charge++; return; }
    const cost = this.costOf(f, ab);
    if (f.energy < cost) { st.energy++; return; }
    const o = this.f[1 - f.side];
    const tx = target ? target.x : o.x;
    const ty = target ? target.y : o.y;
    let dir = Math.atan2(ty - f.y, tx - f.x);
    if (Math.abs(tx - f.x) < 1e-6 && Math.abs(ty - f.y) < 1e-6) dir = f.facing;
    f.energy -= cost;
    if (!ab.basic && !ab.ultimate && f.relics.has('storm_battery') && f.relicState.storm <= 0) {
      f.relicState.storm = 6;
      if (ab.energy > 0) this.relicFired(f, 'storm_battery');
    }
    let cd = ab.cooldown;
    if (ab.basic && f.relics.has('berserker_helm') && f.hp < f.d.maxHp * 0.5) cd *= 0.6;
    f.cooldowns[idx] = cd;
    f.gcd = RULES.globalCooldown;
    if (!ab.basic && f.traits.has('spellblade')) f.spellbladeUntil = this.time + 3;
    const s = f.stats.abilities[idx];
    s.casts++;
    s.energy += cost;
    this.ev({ k: 'cast', a: f.side, ab: idx, x: r1(tx), y: r1(ty) });
    let windup = ab.windup;
    if (ab.ultimate) {
      f.ult = 0;
      f.ultReadyAnnounced = false;
      f.ultImpactPending = true;
      f.stats.ults++;
      windup = Math.max(RULES.ultMinWindup, windup);   // the charge-up: rooted and exposed
      this.ev({ k: 'ult', a: f.side, ab: idx, x: r1(tx), y: r1(ty), charge: windup });
    }
    if (windup > 0) {
      f.casting = { idx, remaining: windup, total: windup, dir, tx, ty };
      if (!['shield', 'heal', 'buff', 'cleanse', 'counter'].includes(ab.type)) f.facing = dir;
    } else {
      this.fire(f, idx, dir, tx, ty);
    }
  }

  // Move f up to `dist` along `dir`, stopping at the enemy, obstacles and the ring.
  shove(f, dir, dist) {
    const o = this.f[1 - f.side];
    let nx = f.x + Math.cos(dir) * dist, ny = f.y + Math.sin(dir) * dist;
    let t = 1;
    if (!o.ko) { const h = sweep(f.x, f.y, nx, ny, o.x, o.y, 2 * R); if (h >= 0) t = Math.min(t, h); }
    for (const b of this.obstacles) { const h = sweep(f.x, f.y, nx, ny, b.x, b.y, R + b.r); if (h >= 0) t = Math.min(t, h); }
    nx = f.x + (nx - f.x) * t; ny = f.y + (ny - f.y) * t;
    f.x = nx; f.y = ny;
    this.clampRing(f);
  }

  fire(f, idx, dir, tx, ty) {
    const ab = f.spec.abilities[idx];
    const o = this.f[1 - f.side];
    const s = f.stats.abilities[idx];
    const mult = this.damageMult(f);
    switch (ab.type) {
      case 'melee': {
        s.fired++;
        f.facing = dir;
        if (ab.lunge > 0 && !o.ko) {
          const gap = Math.hypot(o.x - f.x, o.y - f.y) - 2 * R;
          this.shove(f, dir, Math.min(ab.lunge, Math.max(0, gap - ab.range * 0.5)));
        }
        this.ev({ k: 'swing', a: f.side, ab: idx, x: r1(f.x), y: r1(f.y), d: Math.round(dir / DEG) });
        if (!o.ko) {
          const dx = o.x - f.x, dy = o.y - f.y;
          const dist = Math.hypot(dx, dy);
          let inArc = ab.arc >= 360;
          if (!inArc) {
            const slack = dist > R ? Math.asin(Math.min(1, R / dist)) : Math.PI;
            inArc = Math.abs(angleDiff(Math.atan2(dy, dx), dir)) <= (ab.arc / 2) * DEG + slack;
          }
          if (dist - 2 * R <= ab.range && inArc) {
            if (this.applyHit(f, o, ab, { dir })) s.hits++;
          }
        }
        break;
      }
      case 'projectile': {
        f.facing = dir;
        const n = ab.count;
        for (let i = 0; i < n; i++) {
          const off = n > 1 ? (-ab.spread / 2 + (ab.spread * i) / (n - 1)) * DEG : 0;
          const a = dir + off;
          this.projectiles.push({
            id: this.nextId++, owner: f.side, ab: idx,
            x: f.x + Math.cos(a) * (R + ab.radius * 0.5), y: f.y + Math.sin(a) * (R + ab.radius * 0.5),
            dir: a, speed: ab.speed, radius: ab.radius, range: ab.range, traveled: 0,
            homing: ab.homing, mult, evaded: false, bounce: ab.bounce || 0, returns: !!ab.returns, returning: false, hitOut: false,
          });
          s.fired++;
        }
        this.ev({ k: 'fire', a: f.side, ab: idx, x: r1(f.x), y: r1(f.y), d: Math.round(dir / DEG) });
        break;
      }
      case 'area': {
        s.fired++;
        if (ab.target === 'point') {
          let px = tx, py = ty;
          const d = Math.hypot(px - f.x, py - f.y);
          if (d > ab.range) { px = f.x + (px - f.x) / d * ab.range; py = f.y + (py - f.y) / d * ab.range; }
          this.meteors.push({ owner: f.side, ab: idx, x: px, y: py, radius: ab.radius, at: this.time + ab.delay, mult });
          this.ev({ k: 'meteor', a: f.side, ab: idx, x: r1(px), y: r1(py), r: ab.radius, delay: ab.delay });
          if (ab.delay <= 0) this.stepMeteors();
        } else {
          this.ev({ k: 'burst', a: f.side, ab: idx, x: r1(f.x), y: r1(f.y), r: ab.radius });
          if (!o.ko && Math.hypot(o.x - f.x, o.y - f.y) <= ab.radius + R) {
            if (this.applyHit(f, o, ab, { dir: Math.atan2(o.y - f.y, o.x - f.x) })) s.hits++;
          }
        }
        break;
      }
      case 'zone': {
        s.fired++;
        let zx = tx, zy = ty;
        if (ab.follow) { zx = f.x; zy = f.y; } else {
          const dx = zx - f.x, dy = zy - f.y, d = Math.hypot(dx, dy);
          if (d > ab.range) { zx = f.x + dx / d * ab.range; zy = f.y + dy / d * ab.range; }
        }
        this.zones.push({ id: this.nextId++, owner: f.side, ab: idx, x: zx, y: zy, radius: ab.radius, remaining: ab.duration, duration: ab.duration, dps: ab.dps * mult, slow: ab.slow, pull: ab.pull || 0, follow: !!ab.follow, touched: false });
        this.ev({ k: 'zone', a: f.side, ab: idx, x: r1(zx), y: r1(zy), r: ab.radius });
        break;
      }
      case 'dash': {
        s.fired++;
        f.facing = dir;
        if (f.traits.has('momentum')) f.momentumUntil = this.time + 2;
        if (f.weapon === 'katana') f.katanaUntil = this.time + 3;
        const dashDist = ab.distance * (f.relics.has('winged_boots') ? 1.2 : 1);
        if (ab.teleport) {
          const d = Math.min(dashDist, Math.hypot(tx - f.x, ty - f.y) || dashDist);
          const x0 = f.x, y0 = f.y;
          f.x += Math.cos(dir) * d; f.y += Math.sin(dir) * d;
          this.clampRing(f);
          this.pushOutObstacles(f);
          if (!o.ko) {
            const dd = Math.hypot(f.x - o.x, f.y - o.y);
            if (dd < 2 * R) { const ux = dd > 1e-6 ? (f.x - o.x) / dd : 1, uy = dd > 1e-6 ? (f.y - o.y) / dd : 0; f.x = o.x + ux * 2 * R; f.y = o.y + uy * 2 * R; this.clampRing(f); }
          }
          this.ev({ k: 'dash', a: f.side, ab: idx, x: r1(x0), y: r1(y0), d: Math.round(dir / DEG), tp: 1, x2: r1(f.x), y2: r1(f.y) });
        } else {
          f.dash = { idx, dir, remaining: dashDist, invulnerable: !!ab.invulnerable, hit: false };
          this.ev({ k: 'dash', a: f.side, ab: idx, x: r1(f.x), y: r1(f.y), d: Math.round(dir / DEG) });
        }
        break;
      }
      case 'shield': {
        s.fired++;
        f.shield = Math.max(f.shield, ab.amount);
        f.shieldTime = Math.max(f.shieldTime, ab.duration);
        s.shielding += ab.amount;
        this.ev({ k: 'shield', a: f.side, ab: idx, v: ab.amount });
        break;
      }
      case 'heal': {
        s.fired++;
        if (ab.duration > 0) {
          f.hots.push({ perSec: ab.amount / ab.duration, time: ab.duration, ab: idx });
          this.ev({ k: 'heal', a: f.side, ab: idx, v: ab.amount, over: ab.duration });
        } else {
          const done = this.heal(f, ab.amount, idx, 'heal');
          this.ev({ k: 'heal', a: f.side, ab: idx, v: Math.round(done) });
        }
        break;
      }
      case 'buff': {
        s.fired++;
        const b = f.buffs[ab.stat];
        b.amount = b.time > 0 ? Math.max(b.amount, ab.amount) : ab.amount;
        b.time = Math.max(b.time, ab.duration);
        this.ev({ k: 'buff', a: f.side, ab: idx, stat: ab.stat, v: ab.amount });
        break;
      }
      case 'beam': {
        s.fired++;
        f.facing = dir;
        f.channel = { idx, time: ab.duration, total: ab.duration, dir, hit: false, mult };
        this.ev({ k: 'beam', a: f.side, ab: idx });
        break;
      }
      case 'trap': {
        s.fired++;
        let px = tx, py = ty;
        const d = Math.hypot(px - f.x, py - f.y);
        if (d > ab.range) { px = f.x + (px - f.x) / d * ab.range; py = f.y + (py - f.y) / d * ab.range; }
        const p = { x: px, y: py };
        this.pushOutObstacles(p, 0);
        const max = f.traits.has('trapper') ? 5 : RULES.maxTraps;
        const mine = this.traps.filter(t => t.owner === f.side);
        if (mine.length >= max) this.traps.splice(this.traps.indexOf(mine[0]), 1);
        this.traps.push({ id: this.nextId++, owner: f.side, ab: idx, x: p.x, y: p.y, radius: ab.radius, armIn: ab.arm, life: ab.duration, mult });
        this.ev({ k: 'trap', a: f.side, ab: idx, x: r1(p.x), y: r1(p.y), r: ab.radius });
        break;
      }
      case 'counter': {
        s.fired++;
        f.counterTime = ab.duration;
        f.counterIdx = idx;
        this.ev({ k: 'counter', a: f.side, ab: idx, ok: 0, x: r1(f.x), y: r1(f.y) });
        break;
      }
      case 'turret': {
        s.fired++;
        let px = tx, py = ty;
        const d = Math.hypot(px - f.x, py - f.y);
        if (d > ab.place) { px = f.x + (px - f.x) / (d || 1) * ab.place; py = f.y + (py - f.y) / (d || 1) * ab.place; }
        const p = { x: px, y: py };
        this.pushOutObstacles(p, 12);
        const r = Math.hypot(p.x, p.y);
        if (r > this.ringR - 16) { p.x *= (this.ringR - 16) / r; p.y *= (this.ringR - 16) / r; }
        const mine = this.turrets.filter(t => t.owner === f.side);
        if (mine.length >= RULES.maxTurrets) this.turrets.splice(this.turrets.indexOf(mine[0]), 1);
        this.turrets.push({ id: this.nextId++, owner: f.side, ab: idx, x: p.x, y: p.y, life: ab.duration, duration: ab.duration, range: ab.range, next: this.time + 0.4, mult });
        this.ev({ k: 'turret', a: f.side, ab: idx, x: r1(p.x), y: r1(p.y) });
        break;
      }
      case 'cleanse': {
        s.fired++;
        f.stun = 0; f.root = 0; f.silence = 0;
        f.slow = 0; f.slowTime = 0;
        f.burnTime = 0; f.burnDps = 0; f.poisonTime = 0; f.poisonDps = 0; f.bleedTime = 0; f.bleedDps = 0;
        f.vuln = { amount: 0, time: 0 }; f.weak = { amount: 0, time: 0 };
        f.immune = Math.max(f.immune, ab.immunity || 0);
        f.stats.cleanses++;
        this.ev({ k: 'cleanse', a: f.side, ab: idx });
        break;
      }
      default: break;
    }
  }

  // ── per-tick steps ────────────────────────────────────────────────────────
  pushOutObstacles(p, radius = R) {
    let hit = false;
    for (const b of this.obstacles) {
      const dx = p.x - b.x, dy = p.y - b.y;
      const d = Math.hypot(dx, dy);
      const min = radius + b.r;
      if (d < min) {
        const ux = d > 1e-6 ? dx / d : 1, uy = d > 1e-6 ? dy / d : 0;
        p.x = b.x + ux * min; p.y = b.y + uy * min;
        hit = true;
      }
    }
    return hit;
  }

  stepDash(f, o) {
    const d = f.dash;
    const step = Math.min(RULES.dashSpeed * DT, d.remaining);
    const nx = f.x + Math.cos(d.dir) * step, ny = f.y + Math.sin(d.dir) * step;
    let tObs = -1;
    for (const b of this.obstacles) { const t = sweep(f.x, f.y, nx, ny, b.x, b.y, R + b.r); if (t >= 0 && (tObs < 0 || t < tObs)) tObs = t; }
    if (!o.ko) {
      const t = sweep(f.x, f.y, nx, ny, o.x, o.y, 2 * R);
      if (t >= 0 && (tObs < 0 || t <= tObs)) {
        f.x += (nx - f.x) * t;
        f.y += (ny - f.y) * t;
        const ab = f.spec.abilities[d.idx];
        if (!d.hit && (ab.damage > 0 || hasEffects(ab))) {
          d.hit = true;
          if (this.applyHit(f, o, ab, { dir: d.dir })) f.stats.abilities[d.idx].hits++;
        }
        this.endDash(f);
        return;
      }
    }
    if (tObs >= 0) {
      f.x += (nx - f.x) * tObs; f.y += (ny - f.y) * tObs;
      this.endDash(f);
      return;
    }
    f.x = nx; f.y = ny;
    d.remaining -= step;
    if (d.remaining <= 1e-6) this.endDash(f);
  }

  moveFighter(f, o) {
    if (f.ko || f.frozen > 0) return;
    if (f.dash) { this.stepDash(f, o); return; }
    if (f.knock) {
      f.x += f.knock.dx; f.y += f.knock.dy;
      if (--f.knock.n <= 0) f.knock = null;
      if (this.pushOutObstacles(f)) {
        f.knock = null;
        f.stats.slams++;
        this.ev({ k: 'slam', a: f.side, x: r1(f.x), y: r1(f.y) });
        this.applyStun(f, 0.3, null);
      }
      return;
    }
    if (f.stun > 0 || f.casting || f.channel || f.root > 0) return;
    if (f.move.x || f.move.y) {
      const spd = this.speedOf(f);
      f.x += f.move.x * spd * DT;
      f.y += f.move.y * spd * DT;
    }
  }

  clampRing(f) {
    const max = this.ringR - R;
    const d = Math.hypot(f.x, f.y);
    if (d > max) {
      f.x *= max / d; f.y *= max / d;
      if (f.dash) this.endDash(f);
      if (f.knock) f.knock = null;
    }
  }

  resolveBodies() {
    const [a, b] = this.f;
    if (a.ko || b.ko) return;
    let dx = b.x - a.x, dy = b.y - a.y;
    let d = Math.hypot(dx, dy);
    const min = 2 * R;
    if (d >= min) return;
    if (d < 1e-6) { dx = 1; dy = 0; d = 1; }
    const push = (min - d) / 2;
    const ux = dx / d, uy = dy / d;
    a.x -= ux * push; a.y -= uy * push;
    b.x += ux * push; b.y += uy * push;
  }

  stepProjectiles() {
    const keep = [];
    for (const p of this.projectiles) {
      const owner = this.f[p.owner];
      // a shot reflected by a Mirror Charm flies back at its owner; the reflector gets the credit
      const target = p.reflected ? owner : this.f[1 - p.owner];
      const ab = owner.spec.abilities[p.ab];
      const home = p.returning ? owner : target;
      if (p.returning || (p.homing > 0 && !target.ko)) {
        const want = Math.atan2(home.y - p.y, home.x - p.x);
        const maxTurn = (p.returning ? Math.max(p.homing, 0.6) : p.homing) * 3.5 * DT;
        p.dir += clamp(angleDiff(want, p.dir), -maxTurn, maxTurn);
      }
      const step = p.speed * DT;
      let nx = p.x + Math.cos(p.dir) * step, ny = p.y + Math.sin(p.dir) * step;
      // obstacles: bounce or break
      let blocked = false;
      for (const b of this.obstacles) {
        const t = sweep(p.x, p.y, nx, ny, b.x, b.y, b.r + p.radius);
        if (t < 0) continue;
        const hx = p.x + (nx - p.x) * t, hy = p.y + (ny - p.y) * t;
        if (p.bounce > 0) {
          const nxn = (hx - b.x), nyn = (hy - b.y), nl = Math.hypot(nxn, nyn) || 1;
          const ux = nxn / nl, uy = nyn / nl;
          const vx = Math.cos(p.dir), vy = Math.sin(p.dir);
          const dot = vx * ux + vy * uy;
          p.dir = Math.atan2(vy - 2 * dot * uy, vx - 2 * dot * ux);
          p.bounce--;
          p.x = hx + ux * 1.5; p.y = hy + uy * 1.5;
          nx = p.x; ny = p.y;
        } else blocked = true;
        break;
      }
      if (blocked) { if (!p.reflected) owner.stats.abilities[p.ab].missed++; continue; }
      let gone = false;
      if (!target.ko) {
        const t = sweep(p.x, p.y, nx, ny, target.x, target.y, R + p.radius);
        const canHit = p.returning ? !p.hitBack : !p.hitOut;
        if (t >= 0 && canHit && p.reflected) {
          const credit = this.f[1 - p.owner];
          const res = this.dealDamage(credit, target, (ab.damage || 0) * p.mult, null, 'relic');
          this.ev({ k: 'reflect', a: credit.side, dmg: Math.round(res.total), x: r1(target.x), y: r1(target.y) });
          continue;
        }
        if (t >= 0 && canHit && !target.invulnerable && target.relics.has('mirror_charm') && target.relicState.mirror <= 0 && !p.returning) {
          // Mirror Charm: bounce it straight back at the shooter
          target.relicState.mirror = 12;
          this.relicFired(target, 'mirror_charm');
          p.reflected = true; p.homing = 0; p.returns = false; p.traveled = 0; p.bounce = 0;
          p.dir = Math.atan2(owner.y - p.y, owner.x - p.x);
          keep.push(p);
          continue;
        }
        if (t >= 0 && canHit) {
          if (target.invulnerable) {
            if (!p.evaded) {
              p.evaded = true;
              owner.stats.abilities[p.ab].evaded++;
              target.stats.evades++;
              this.ev({ k: 'evade', a: target.side, x: r1(target.x), y: r1(target.y) });
            }
          } else {
            if (this.applyHit(owner, target, ab, { dir: p.dir, mult: p.mult })) owner.stats.abilities[p.ab].hits++;
            if (p.returns && !p.returning) p.hitOut = true;
            else gone = true;
          }
        }
      }
      if (gone) continue;
      p.x = nx; p.y = ny;
      p.traveled += step;
      if (p.returning && Math.hypot(owner.x - p.x, owner.y - p.y) <= R + p.radius) continue; // caught
      if (p.traveled >= p.range) {
        if (p.returns && !p.returning) { p.returning = true; p.traveled = 0; p.evaded = false; }
        else { if (!p.hitOut && !p.hitBack && !p.reflected) owner.stats.abilities[p.ab].missed++; continue; }
      }
      const dr = Math.hypot(p.x, p.y);
      if (dr > this.ringR - p.radius) {
        if (p.bounce > 0) {
          const ux = p.x / dr, uy = p.y / dr;
          const vx = Math.cos(p.dir), vy = Math.sin(p.dir);
          const dot = vx * ux + vy * uy;
          if (dot > 0) { p.dir = Math.atan2(vy - 2 * dot * uy, vx - 2 * dot * ux); p.bounce--; }
        } else if (dr > this.ringR + 60) { if (!p.reflected) owner.stats.abilities[p.ab].missed++; continue; }
      }
      keep.push(p);
    }
    this.projectiles = keep;
  }

  beamSegment(f, ab, dir) {
    const x1 = f.x + Math.cos(dir) * R, y1 = f.y + Math.sin(dir) * R;
    let len = ab.range;
    for (const b of this.obstacles) {
      // ray-circle: first intersection distance along the beam
      const fx = x1 - b.x, fy = y1 - b.y;
      const dx = Math.cos(dir), dy = Math.sin(dir);
      const bb = fx * dx + fy * dy;
      const c = fx * fx + fy * fy - b.r * b.r;
      const disc = bb * bb - c;
      if (disc < 0) continue;
      const t = -bb - Math.sqrt(disc);
      if (t >= 0 && t < len) len = t;
    }
    return { x1, y1, x2: x1 + Math.cos(dir) * len, y2: y1 + Math.sin(dir) * len };
  }

  stepBeams() {
    this.beams = [];
    for (const f of this.f) {
      const ch = f.channel;
      if (!ch || f.ko) continue;
      const ab = f.spec.abilities[ch.idx];
      const o = this.f[1 - f.side];
      const aim = f.aim || o;
      const want = Math.atan2(aim.y - f.y, aim.x - f.x);
      const maxTurn = ab.turnRate * DEG * DT;
      ch.dir += clamp(angleDiff(want, ch.dir), -maxTurn, maxTurn);
      f.facing = ch.dir;
      const seg = this.beamSegment(f, ab, ch.dir);
      this.beams.push({ owner: f.side, ab: ch.idx, x1: seg.x1, y1: seg.y1, x2: seg.x2, y2: seg.y2, width: ab.width });
      if (!o.ko && segDist(o.x, o.y, seg.x1, seg.y1, seg.x2, seg.y2) <= ab.width / 2 + R) {
        if (o.invulnerable) { /* dodged */ } else if (this.tryCounter(f, o)) {
          f.stats.abilities[ch.idx].countered++;
        } else {
          if (!ch.hit) { ch.hit = true; f.stats.abilities[ch.idx].hits++; }
          const res = this.dealDamage(f, o, ab.dps * ch.mult * DT, ch.idx, 'beam', { canCrit: false });
          f.stats.beamDamage += res.total;
          this.addDot(f, o, res.total, 'beam', ch.idx);
        }
      }
      if (!f.channel) continue; // interrupted by a counter
      ch.time -= DT;
      if (ch.time <= 1e-9) this.endChannel(f);
    }
  }

  stepMeteors() {
    const keep = [];
    for (const m of this.meteors) {
      if (this.time + 1e-9 < m.at) { keep.push(m); continue; }
      const f = this.f[m.owner], o = this.f[1 - m.owner];
      const ab = f.spec.abilities[m.ab];
      this.ev({ k: 'burst', a: m.owner, ab: m.ab, x: r1(m.x), y: r1(m.y), r: m.radius });
      if (!o.ko && Math.hypot(o.x - m.x, o.y - m.y) <= m.radius + R) {
        if (this.applyHit(f, o, ab, { dir: Math.atan2(o.y - m.y, o.x - m.x), mult: m.mult })) f.stats.abilities[m.ab].hits++;
      }
    }
    this.meteors = keep;
  }

  stepTraps() {
    const keep = [];
    for (const tr of this.traps) {
      const f = this.f[tr.owner], o = this.f[1 - tr.owner];
      tr.armIn -= DT;
      tr.life -= DT;
      if (tr.armIn <= 0 && !o.ko && !o.invulnerable && Math.hypot(o.x - tr.x, o.y - tr.y) <= tr.radius + R * 0.6) {
        const ab = f.spec.abilities[tr.ab];
        f.stats.trapsTriggered++;
        this.ev({ k: 'trigger', a: tr.owner, ab: tr.ab, x: r1(tr.x), y: r1(tr.y), r: tr.radius });
        if (this.applyHit(f, o, ab, { dir: Math.atan2(o.y - tr.y, o.x - tr.x), mult: tr.mult })) f.stats.abilities[tr.ab].hits++;
        continue;
      }
      if (tr.life > 1e-9) keep.push(tr);
    }
    this.traps = keep;
  }

  addDot(attacker, target, amount, kind, abIdx) {
    const key = `${attacker.side}:${kind}:${abIdx}`;
    const cur = this.dots.get(key) || { a: attacker.side, kind, ab: abIdx, dmg: 0 };
    cur.dmg += amount;
    this.dots.set(key, cur);
  }

  flushDots(force) {
    if (!force && this.tick % 15 !== 14) return;
    for (const d of this.dots.values()) {
      if (d.dmg >= 0.5) {
        const target = this.f[1 - d.a];
        this.ev({ k: 'dot', a: d.a, kind: d.kind, ab: d.ab, dmg: Math.round(d.dmg), x: r1(target.x), y: r1(target.y) });
      }
    }
    this.dots.clear();
  }

  stepZones() {
    const keep = [];
    for (const z of this.zones) {
      const owner = this.f[z.owner];
      const target = this.f[1 - z.owner];
      if (z.follow && !owner.ko) { z.x = owner.x; z.y = owner.y; }
      const d = Math.hypot(target.x - z.x, target.y - z.y);
      if (!target.ko && !target.invulnerable && d <= z.radius + R * 0.5) {
        if (!z.touched) { z.touched = true; owner.stats.abilities[z.ab].hits++; }
        if (z.dps > 0) {
          const res = this.dealDamage(owner, target, z.dps * DT, z.ab, 'zone');
          owner.stats.zoneDamage += res.total;
          this.addDot(owner, target, res.total, 'zone', z.ab);
        }
        if (z.slow > 0) this.applySlow(target, z.slow, 0.3);
        if (z.pull > 0 && !target.traits.has('unstoppable') && !target.dash && d > 4) {
          const step = Math.min(d, z.pull * DT * this.ccMult(target));
          target.x += (z.x - target.x) / d * step;
          target.y += (z.y - target.y) / d * step;
        }
      }
      z.remaining -= DT;
      if (z.remaining > 1e-9) keep.push(z);
    }
    this.zones = keep;
  }

  stepTurrets() {
    const keep = [];
    for (const tu of this.turrets) {
      const f = this.f[tu.owner], o = this.f[1 - tu.owner];
      tu.life -= DT;
      if (tu.life <= 1e-9 || f.ko) continue;
      const ab = f.spec.abilities[tu.ab];
      if (!o.ko && this.time + 1e-9 >= tu.next) {
        const d = Math.hypot(o.x - tu.x, o.y - tu.y);
        const clear = !this.obstacles.some(b => segDist(b.x, b.y, tu.x, tu.y, o.x, o.y) < b.r + 6);
        if (d <= tu.range && clear) {
          // lead the target a little
          const tHit = d / ab.speed;
          const ax = o.x + o.vx * tHit * 0.8, ay = o.y + o.vy * tHit * 0.8;
          const dir = Math.atan2(ay - tu.y, ax - tu.x);
          this.projectiles.push({
            id: this.nextId++, owner: tu.owner, ab: tu.ab,
            x: tu.x + Math.cos(dir) * 14, y: tu.y + Math.sin(dir) * 14,
            dir, speed: ab.speed, radius: 7, range: tu.range + 60, traveled: 0,
            homing: 0, mult: tu.mult, evaded: false, bounce: 0, returns: false, returning: false, hitOut: false,
          });
          f.stats.abilities[tu.ab].fired++;
          f.stats.turretShots++;
          this.ev({ k: 'fire', a: tu.owner, ab: tu.ab, x: r1(tu.x), y: r1(tu.y), d: Math.round(dir / DEG), turret: tu.id });
          tu.next = this.time + 1 / Math.max(0.1, ab.rate);
        }
      }
      keep.push(tu);
    }
    this.turrets = keep;
  }

  // Per-tick bookkeeping for the v4 systems.
  stepV4(f) {
    if (f.ko) return;
    const rs = f.relicState;
    const dec = (v) => (v > 0 ? Math.max(0, v - DT) : v);
    f.stanceCd = dec(f.stanceCd); f.swapCd = dec(f.swapCd); f.swapLock = dec(f.swapLock);
    f.marked = dec(f.marked); f.invulnTime = dec(f.invulnTime); f.revived = dec(f.revived); f.frozen = dec(f.frozen);
    rs.markCd = dec(rs.markCd); rs.ward = dec(rs.ward); rs.mirror = dec(rs.mirror); rs.storm = dec(rs.storm);
    f.stats.stanceTime[f.stance] = (f.stats.stanceTime[f.stance] || 0) + DT;
    if (f.relics.has('hourglass')) {
      rs.hourglass -= DT;
      if (rs.hourglass <= 0) {
        rs.hourglass = 6;
        let best = -1;
        f.spec.abilities.forEach((a, i) => { if (!a.basic && !a.ultimate && f.cooldowns[i] > 0.5 && (best < 0 || f.cooldowns[i] > f.cooldowns[best])) best = i; });
        if (best >= 0) { f.cooldowns[best] = 0; this.relicFired(f, 'hourglass'); }
      }
    }
    if (f.relics.has('bloodstone')) {
      rs.bloodstone -= DT;
      if (rs.bloodstone <= 0) {
        rs.bloodstone = 10;
        if (f.hp < f.d.maxHp * 0.5) { this.heal(f, f.d.maxHp * 0.06, null, 'heal'); this.relicFired(f, 'bloodstone'); }
      }
    }
    if (f.awakened > 0) {
      f.awakened -= DT;
      if (f.awakened <= 0) { f.awakened = 0; this.ev({ k: 'awakenend', a: f.side }); }
    }
    if (f.d.hpRegen > 0) this.heal(f, f.d.hpRegen * DT, null, 'regen');
    const mult = f.d.chargeMult || 1;
    if (f.ultIdx >= 0 && f.ult < 100) f.ult = Math.min(100, f.ult + CHARGE.ult.perSecond * DT * mult);
    if (f.godPowers.length && f.div < 100) f.div = Math.min(100, f.div + CHARGE.div.perSecond * DT * mult);
    if (f.ultIdx >= 0 && f.ult >= 100 && !f.ultReadyAnnounced) { f.ultReadyAnnounced = true; this.ev({ k: 'ultready', a: f.side }); }
    if (f.godPowers.length && f.div >= 100 && !f.divReadyAnnounced) { f.divReadyAnnounced = true; this.ev({ k: 'divready', a: f.side }); }
  }

  /** A fighter at 0 HP: a relic or godly power may save it; otherwise it is knocked out. */
  checkKO(f) {
    if (f.ko || f.hp > 0) return;
    if (this.P && this.pctx && this.P.onKO && this.safePower(() => this.P.onKO(this.pctx, this.handle(f)), false) && f.hp > 0) return;
    if (f.relics.has('phoenix_feather') && !f.relicState.phoenixUsed) {
      f.relicState.phoenixUsed = true;
      f.hp = f.d.maxHp * 0.1;
      f.invulnTime = 1.0; f.revived = 1.0;
      f.burnTime = 0; f.burnDps = 0; f.poisonTime = 0; f.poisonDps = 0; f.bleedTime = 0; f.bleedDps = 0;
      f.stats.revives++;
      this.relicFired(f, 'phoenix_feather');
      this.ev({ k: 'revive', a: f.side, x: r1(f.x), y: r1(f.y) });
      this.cinematic('impact', f.side, undefined, 500);
      return;
    }
    f.hp = 0;
    f.ko = true;
    f.casting = null; f.dash = null; f.knock = null; f.channel = null; f.counterTime = 0; f.godCast = null; f.awakened = 0;
    this.ev({ k: 'ko', a: f.side, x: r1(f.x), y: r1(f.y) });
    const killer = this.f[f.lastHitBy !== undefined ? f.lastHitBy : 1 - f.side];
    this.impact(killer, f, 0, 'ko');
  }

  stepTimers(f) {
    // Cooldowns tick at the start of a tick so a 1.0 s cooldown lasts exactly 1.0 s.
    const rate = DT * (1 + f.buff('haste') / 100) * (f.awakened > 0 ? (f.ascended ? 1.75 : 1.5) : 1);
    for (let i = 0; i < f.cooldowns.length; i++) if (f.cooldowns[i] > 0) f.cooldowns[i] = Math.max(0, f.cooldowns[i] - rate);
    if (f.gcd > 0) f.gcd = Math.max(0, f.gcd - DT);
  }

  stepDot(f, kind) {
    const timeKey = `${kind}Time`;
    if (f[timeKey] <= 0) return;
    const src = f[`${kind}Src`];
    const attacker = this.f[src.side];
    const res = this.dealDamage(attacker, f, f[`${kind}Dps`] * DT, src.ab, kind);
    attacker.stats[`${kind}Damage`] += res.total;
    this.addDot(attacker, f, res.total, kind, src.ab);
    f[timeKey] -= DT;
    if (f[timeKey] <= 0) { f[timeKey] = 0; f[`${kind}Dps`] = 0; }
  }

  stepStatus(f) {
    if (f.ko) return;
    const st = f.stats;
    if (f.stun > 0) { f.stun = Math.max(0, f.stun - DT); st.stunnedTime += DT; }
    if (f.stunImmune > 0) f.stunImmune = Math.max(0, f.stunImmune - DT);
    if (f.root > 0) { f.root = Math.max(0, f.root - DT); st.rootedTime += DT; }
    if (f.rootImmune > 0) f.rootImmune = Math.max(0, f.rootImmune - DT);
    if (f.silence > 0) { f.silence = Math.max(0, f.silence - DT); st.silencedTime += DT; }
    if (f.silenceImmune > 0) f.silenceImmune = Math.max(0, f.silenceImmune - DT);
    if (f.immune > 0) f.immune = Math.max(0, f.immune - DT);
    if (f.counterTime > 0) f.counterTime = Math.max(0, f.counterTime - DT);
    if (f.slowTime > 0) {
      f.slowTime -= DT; st.slowedTime += DT;
      if (f.slowTime <= 0) { f.slowTime = 0; f.slow = 0; }
    }
    this.stepDot(f, 'burn');
    this.stepDot(f, 'poison');
    this.stepDot(f, 'bleed');
    for (const k of ['vuln', 'weak']) {
      if (f[k].time > 0) { f[k].time -= DT; if (f[k].time <= 0) f[k] = { amount: 0, time: 0 }; }
    }
    for (const k of BUFFS) {
      const b = f.buffs[k];
      if (b.time > 0) { b.time -= DT; if (b.time <= 0) { b.time = 0; b.amount = 0; } }
    }
    if (f.shieldTime > 0) {
      f.shieldTime -= DT;
      if (f.shieldTime <= 0 || f.shield <= 0) { f.shieldTime = 0; f.shield = 0; }
    }
    if (f.hots.length) {
      for (const h of f.hots) {
        const amt = h.perSec * Math.min(DT, h.time);
        this.heal(f, amt, h.ab, 'heal');
        h.time -= DT;
      }
      f.hots = f.hots.filter(h => h.time > 1e-9);
    }
    if (f.traits.has('regenerator')) this.heal(f, 5 * DT, null, 'regen');
    f.energy = Math.min(f.d.maxEnergy, f.energy + this.regenOf(f) * DT);
    if (f.casting || f.channel) st.castingTime += DT;
    if (f.energy < f.cheapest) st.starvedTime += DT;
    if (this.ringR - Math.hypot(f.x, f.y) < R + 40) st.wallTime += DT;
  }

  flagsOf(f) {
    let fl = 0;
    if (f.stun > 0) fl |= FLAG.STUN;
    if (f.slowTime > 0) fl |= FLAG.SLOW;
    if (f.burnTime > 0) fl |= FLAG.BURN;
    if (f.invulnerable) fl |= FLAG.INVULN;
    if (f.dash) fl |= FLAG.DASH;
    if (f.buff('power')) fl |= FLAG.POWER;
    if (f.buff('armor')) fl |= FLAG.ARMOR;
    if (f.buff('speed')) fl |= FLAG.SPEED;
    if (f.shield > 0) fl |= FLAG.SHIELD;
    if (f.ko) fl |= FLAG.KO;
    if (f.hots.length) fl |= FLAG.HOT;
    if (f.knock) fl |= FLAG.KNOCK;
    if (f.casting) fl |= FLAG.CAST;
    if (f.root > 0) fl |= FLAG.ROOT;
    if (f.silence > 0) fl |= FLAG.SILENCE;
    if (f.vuln.time > 0) fl |= FLAG.VULN;
    if (f.weak.time > 0) fl |= FLAG.WEAK;
    if (f.poisonTime > 0) fl |= FLAG.POISON;
    if (f.immune > 0) fl |= FLAG.IMMUNE;
    if (f.counterTime > 0) fl |= FLAG.COUNTER;
    if (f.channel) fl |= FLAG.CHANNEL;
    if (f.buff('haste')) fl |= FLAG.HASTE;
    if (f.buff('crit')) fl |= FLAG.CRITBUFF;
    if (f.buff('tenacity')) fl |= FLAG.TENACITY;
    if (f.bleedTime > 0) fl |= FLAG.BLEED;
    return fl;
  }

  recordFrame() {
    const fr = [r1(this.ringR)];
    for (const f of this.f) {
      const c = f.casting;
      const ch = f.channel;
      fr.push([
        r1(f.x), r1(f.y), Math.max(0, Math.round(f.hp)), Math.round(f.energy), Math.round(f.shield), this.flagsOf(f),
        Math.round(f.facing / DEG),
        c ? c.idx : ch ? ch.idx : -1,
        c ? Math.round((1 - c.remaining / c.total) * 100) : ch ? Math.round((1 - ch.time / ch.total) * 100) : 0,
        c ? r1(c.tx) : 0, c ? r1(c.ty) : 0,
        f.cooldowns.map(v => Math.round(v * 10)),
        // v4
        this.flags2Of(f), STANCE_CODE[f.stance] || 0, Math.floor(f.ult), Math.floor(f.div), f.weaponSlot, Math.round(Math.max(0, f.awakened) * 10),
      ]);
    }
    fr.push(this.projectiles.map(p => [p.id, r1(p.x), r1(p.y), p.owner, p.ab, p.radius, Math.round(p.dir / DEG)]));
    fr.push(this.zones.map(z => [z.id, r1(z.x), r1(z.y), z.radius, z.owner, z.ab, Math.round((z.remaining / z.duration) * 100)]));
    fr.push(this.traps.map(t => [t.id, r1(t.x), r1(t.y), t.radius, t.owner, t.ab, t.armIn <= 0 ? 1 : 0]));
    fr.push(this.beams.map(b => [b.owner, b.ab, r1(b.x1), r1(b.y1), r1(b.x2), r1(b.y2), b.width]));
    fr.push(this.turrets.map(tu => [tu.id, r1(tu.x), r1(tu.y), tu.owner, tu.ab, Math.round((tu.life / tu.duration) * 100)]));
    fr.push(this.P && this.pctx && this.P.frame ? this.safePower(() => this.P.frame(this.pctx), []) : []);
    this.frames.push(fr);
  }

  flags2Of(f) {
    let fl = f.flags2Extra || 0;
    if (f.awakened > 0) fl |= f.ascended ? FLAG2.ASCENDED : FLAG2.AWAKENED;
    if (f.ultIdx >= 0 && f.ult >= 100) fl |= FLAG2.ULT_READY;
    if (f.godPowers.length && f.div >= 100) fl |= FLAG2.GOD_READY;
    if (f.swapLock > 0) fl |= FLAG2.SWAPPING;
    if (f.revived > 0) fl |= FLAG2.REVIVED;
    if (f.marked > 0) fl |= FLAG2.MARKED;
    if (f.relics.has('warding_rune') && f.relicState.ward <= 0) fl |= FLAG2.WARD;
    if (f.casting && f.casting.idx === f.ultIdx) fl |= FLAG2.ULT_CAST;
    return fl;
  }

  updateFacing(f, o) {
    if (f.ko || f.casting || f.dash || f.channel || f.frozen > 0) return;
    f.facing = Math.atan2(o.y - f.y, o.x - f.x);
  }

  sample() {
    const [a, b] = this.f;
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    for (const f of this.f) {
      const dist = f.stats.distance;
      dist.sum += d; dist.samples++;
      if (d < 150) dist.close++; else if (d < 350) dist.mid++; else dist.far++;
    }
    if (this.tick % RULES.tickRate === 0) {
      this.timeline.push([Math.round(this.time), r2(Math.max(0, a.hp) / a.d.maxHp), r2(Math.max(0, b.hp) / b.d.maxHp)]);
    }
  }

  // ── main loop ─────────────────────────────────────────────────────────────
  step() {
    const t = this.time;
    this.ringR = ringRadiusAt(t, this.arena);
    const order = this.tick % 2 === 0 ? [0, 1] : [1, 0];

    for (const f of this.f) this.stepTimers(f);

    if (this.tick % RULES.thinkEvery === 0) {
      const states = this.f.map(f => (f.ko || !f.brain ? null : this.buildState(f)));
      for (const i of order) {
        const f = this.f[i];
        if (!states[i]) { f.move = { x: 0, y: 0 }; f.pending = null; continue; }
        const action = f.brain.think(states[i], this.tick);
        this.applyAction(f, action);
      }
    }

    for (const i of order) {
      const f = this.f[i];
      if (f.pending) { const p = f.pending; f.pending = null; this.tryCast(f, p.idx, p.target); }
    }

    for (const i of order) {
      const f = this.f[i];
      if (f.casting && !f.ko) {
        // an ultimate's charge-up can be steered: the target the brain returns this tick is where it goes
        const c0 = f.casting, ab0 = f.spec.abilities[c0.idx];
        if (ab0.ultimate && f.aim) {
          c0.tx = f.aim.x; c0.ty = f.aim.y;
          if (Math.abs(c0.tx - f.x) > 1e-6 || Math.abs(c0.ty - f.y) > 1e-6) {
            c0.dir = Math.atan2(c0.ty - f.y, c0.tx - f.x);
            if (!['shield', 'heal', 'buff', 'cleanse', 'counter'].includes(ab0.type)) f.facing = c0.dir;
          }
        }
        f.casting.remaining -= DT;
        if (f.casting.remaining <= 1e-9) {
          const c = f.casting;
          f.casting = null;
          this.fire(f, c.idx, c.dir, c.tx, c.ty);
        }
      }
      if (f.godCast) {
        if (f.aim) f.godCast.target = { x: f.aim.x, y: f.aim.y };   // godly powers are steered the same way
        this.stepGodCast(f);
      }
    }

    const x0 = this.f.map(f => [f.x, f.y]);
    for (const i of order) this.moveFighter(this.f[i], this.f[1 - i]);
    for (let k = 0; k < 2; k++) {
      this.resolveBodies();
      for (const f of this.f) { if (!f.ko) this.pushOutObstacles(f); this.clampRing(f); }
    }
    this.f.forEach((f, i) => { f.vx = (f.x - x0[i][0]) / DT; f.vy = (f.y - x0[i][1]) / DT; });
    for (const i of order) this.updateFacing(this.f[i], this.f[1 - i]);

    this.stepProjectiles();
    this.stepBeams();
    this.stepMeteors();
    this.stepTraps();
    this.stepZones();
    this.stepTurrets();
    if (this.P && this.pctx) this.safePower(() => this.P.step(this.pctx), null);
    for (const i of order) { this.stepStatus(this.f[i]); this.stepV4(this.f[i]); }
    this.flushDots(false);
    this.sample();

    for (const f of this.f) this.checkKO(f);
    this.tick++;
    this.recordFrame();
  }

  run() {
    this.recordFrame();
    while (this.tick < this.maxTicks) {
      this.step();
      if (this.f[0].ko || this.f[1].ko) break;
    }
    this.flushDots(true);
    const [a, b] = this.f;
    const pa = Math.max(0, a.hp) / a.d.maxHp, pb = Math.max(0, b.hp) / b.d.maxHp;
    let winner = null, method;
    if (a.ko && b.ko) method = 'DOUBLE KO';
    else if (a.ko) { winner = 1; method = 'KO'; }
    else if (b.ko) { winner = 0; method = 'KO'; }
    else if (Math.abs(pa - pb) < 0.005) method = 'DRAW';
    else { winner = pa > pb ? 0 : 1; method = 'DECISION'; }
    this.timeline.push([r1(this.time), r2(pa), r2(pb)]);
    this.result = {
      winner, method,
      time: r2(this.time), ticks: this.tick,
      hp: [Math.round(Math.max(0, a.hp)), Math.round(Math.max(0, b.hp))],
      maxHp: [a.d.maxHp, b.d.maxHp],
      hpPct: [r2(pa * 100), r2(pb * 100)],
    };
    return this;
  }
}

/** Keep the hit-stop / cut-in list within the per-fight budget (most important moments first). */
function capCinematics(list, level) {
  // the godly tier (levels 10-12) is meant to be a spectacle: it gets a bigger budget
  const cap = level >= 10 ? RULES.cinematicCapMs * 1.5 : RULES.cinematicCapMs;
  let total = list.reduce((a, c) => a + c.ms, 0);
  if (total <= cap) return list;
  const order = list.map((c, i) => ({ c, i })).sort((a, b) => (CINEMATIC_PRIORITY[a.c.kind] || 0) - (CINEMATIC_PRIORITY[b.c.kind] || 0) || b.i - a.i);
  const drop = new Set();
  for (const { i, c } of order) {
    if (total <= cap) break;
    drop.add(i);
    total -= c.ms;
  }
  return list.filter((_, i) => !drop.has(i));
}

function simulate(opts) {
  const sim = new Sim(opts).run();
  return {
    frames: sim.frames,
    events: sim.events,
    result: sim.result,
    timeline: sim.timeline,
    obstacles: sim.obstacles,
    arena: sim.arena,
    level: sim.level,
    cinematics: capCinematics(sim.cinematics, sim.level),
    stats: sim.f.map(f => finalizeStats(f)),
    brainStats: sim.f.map(f => (f.brain ? f.brain.stats : null)),
  };
}

function finalizeStats(f) {
  const s = f.stats;
  const round = (v) => Math.round(v);
  return {
    dealt: round(s.dealt), taken: round(s.taken), shieldAbsorbed: round(s.shieldAbsorbed), healed: round(s.healed),
    lifesteal: round(s.lifesteal), biggestHit: round(s.biggestHit), biggestHitAbility: s.biggestHitAbility,
    burnDamage: round(s.burnDamage), zoneDamage: round(s.zoneDamage), poisonDamage: round(s.poisonDamage), bleedDamage: round(s.bleedDamage),
    beamDamage: round(s.beamDamage), basicDamage: round(s.basicDamage),
    crits: s.crits, blockedDamage: round(s.blocked), countersLanded: s.countersLanded, trapsTriggered: s.trapsTriggered,
    cleanses: s.cleanses, slams: s.slams, drained: round(s.drained),
    stunnedTime: r1(s.stunnedTime), slowedTime: r1(s.slowedTime), rootedTime: r1(s.rootedTime), silencedTime: r1(s.silencedTime),
    castingTime: r1(s.castingTime), starvedTime: r1(s.starvedTime), wallTime: r1(s.wallTime),
    stunsLanded: s.stunsLanded, stunsResisted: s.stunsResisted, evades: s.evades,
    avgDistance: s.distance.samples ? round(s.distance.sum / s.distance.samples) : 0,
    distanceShare: s.distance.samples ? {
      close: r2(s.distance.close / s.distance.samples), mid: r2(s.distance.mid / s.distance.samples), far: r2(s.distance.far / s.distance.samples),
    } : { close: 0, mid: 0, far: 0 },
    blocked: s.blockedCasts,
    says: s.says,
    abilities: s.abilities.map(a => Object.assign({}, a, { damage: round(a.damage), healing: round(a.healing) })),
    ults: s.ults, ultDamage: round(s.ultDamage), godCasts: s.godCasts, godDamage: round(s.godDamage), awakenings: s.awakenings,
    swaps: s.swaps, stanceSwitches: s.stanceSwitches, relicTriggers: s.relicTriggers, turretShots: s.turretShots, revives: s.revives,
    emotes: s.emotes, stanceTime: Object.fromEntries(Object.entries(s.stanceTime).map(([k, v]) => [k, r1(v)])),
  };
}

module.exports = { simulate, Sim, ringRadiusAt, FLAG, FLAG2, HIT, STANCE_CODE, EMOTES, publicAbility, segDist };
