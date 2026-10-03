'use strict';
// Modern Warfare — the deterministic battle simulation.
//
// Units are the unit of simulation: a position, a heading, a formation, a pool of hit points
// (elements = ceil(hp / hp per element): soldiers, vehicles, aircraft or ships), a morale value and
// their weapons. Every tick (0.1 s):
//   visibility -> commanders (every 0.5 s) -> movement plan -> move + collide -> close assaults ->
//   weapons (direct fire, guided missiles, shells and bombs) -> projectiles -> damage -> regen ->
//   morale / retreats -> victory.
// Everything that could depend on processing order is computed from the state at the start of the
// phase and applied afterwards, so a mirrored battle is an exact draw.

const D = require('./data');
const { UNITS, HQ, POWERS, FORMATIONS, FIELD, COVER } = D;
const DT = D.TICK;
const TAU = Math.PI * 2;

const hyp = (x, y) => Math.sqrt(x * x + y * y);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
function angNorm(a) { a %= TAU; if (a > Math.PI) a -= TAU; else if (a < -Math.PI) a += TAU; return a; }
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;

const ST = { idle: 0, moving: 1, fighting: 2, assault: 3, routing: 5, dead: 6, fled: 7, away: 8 };
const FORM_CODE = { line: 0, column: 1, spread: 2 };
const ROUT_AT = 12, RALLY_AT = 45;
// how much of a target's armour a weapon kind has to go through
const ARMOR_EFFECT = { rifle: 1, mg: 1, sniper: 1, autocannon: 0.8, rocket: 0.3, cannon: 0.4, missile: 0.3, shell: 0.7, bomb: 0.5, aa: 0.2, torpedo: 0.2 };
// resolved at once (the replay shows tracers); everything else flies (rockets, missiles, torpedoes)
const INSTANT = { rifle: true, mg: true, sniper: true, autocannon: true, cannon: true };
// weapons worth a replay event of their own (small arms are recorded as the unit's fire target)
const BIG = { sniper: true, cannon: true, rocket: true, missile: true, aa: true, torpedo: true };
const CAT = { rifle: 'small', mg: 'small', sniper: 'small', autocannon: 'cannon', cannon: 'cannon', rocket: 'antitank', missile: 'antitank', aa: 'antiair', shell: 'artillery', bomb: 'bombs', torpedo: 'naval' };
const JET_TURN = { fighter: 2.1, bomber: 1.4, stealthbomber: 1.25 };   // rad/s

const isInf = (q) => q.U.cls === 'inf';
const isAir = (q) => !!q.U.fly;
const isJet = (q) => !!q.U.jet;
const isNaval = (q) => !!q.U.naval;

function radiusOf(q) {
  if (q.hq) return 14;
  const U = q.U;
  if (U.jet) return 18;
  if (U.fly) return Math.max(14, 0.5 * U.spacing * Math.sqrt(Math.max(1, q.count)));
  if (U.naval) return Math.max(18, U.spacing * (q.count > 1 ? 0.55 * Math.sqrt(q.count) : 0.5));
  const spread = FORMATIONS[q.form] ? FORMATIONS[q.form].spread : 1;
  if (isInf(q)) return Math.max(9, 0.56 * U.spacing * Math.sqrt(Math.max(1, q.count)) * spread);
  return Math.max(12, (q.count > 1 ? 0.62 : 0.5) * U.spacing * Math.sqrt(Math.max(1, q.count)) * spread);
}

function makeUnit(sd, side, k, isHQ, gid) {
  const U = isHQ ? HQ : UNITS[sd.type];
  const ups = isHQ ? [] : (sd.upgrades || []).filter(u => D.UPGRADES[u]);
  const vet = ups.includes('veteran'), arm = ups.includes('armor'), radio = ups.includes('radio');
  const moraleBase = U.fearless ? 100 : Math.min(100, U.morale + (vet ? 10 : 0) + (radio ? 8 : 0));
  const q = {
    gid, side, k, hq: isHQ, type: isHQ ? 'hq' : sd.type, U, name: String(sd.name || U.name),
    x: side === 0 ? sd.x : -sd.x, y: sd.y, vx: 0, vy: 0, spd: 0, face: side === 0 ? 0 : Math.PI,
    n0: U.size, count: U.size, hpPer: U.hp, maxHp: U.size * U.hp, hp: U.size * U.hp,
    armor: Math.min(0.7, U.armor + (arm ? 0.12 : 0)), speed: U.speed * (arm ? 0.94 : 1), dmgMult: vet ? 1.25 : 1,
    vet, arm, radio, upgrades: ups, cost: isHQ ? 0 : D.unitCost(sd.type, ups),
    morale: moraleBase, moraleBase,
    form: isHQ || U.legendary || U.fly || U.naval ? 'line' : (FORMATIONS[sd.formation] ? sd.formation : 'line'),
    order: { kind: 'auto' }, autocast: true, pending: null,
    w: U.weapons.map((w, i) => Object.assign({}, w, { rl: 0.6 + 0.3 * ((k + i) % 4), ammoLeft: w.ammo === undefined ? Infinity : w.ammo })),
    routing: false, routs: 0, broken: false, dead: false, fled: false, endT: null,
    contacts: [], prevContacts: new Set(), fireTarget: null, autoTarget: null,
    lastHurt: -99, reveal: -99, dmgIn: 0, hurtBy: [], shock: 0, dealtTick: 0, takenTick: 0,
    r: 0, inTown: false, inForest: false, inSmoke: false, still: 0, dug: false, emp: 0, away: false,
    sortie: U.jet ? { mode: 'patrol', t: 0, egX: 0, egY: 0, tgt: null, y0: sd.y, eg: 0 } : null,
    jh: 0,   // jets: heading in the side's own frame (0 = toward the enemy); world facing is derived from it
    h: 0,    // everyone else: heading in the own frame, same idea (exact mirror symmetry between the sides)
    pw: isHQ ? Object.fromEntries(Object.keys(POWERS).map(p => [p, 0])) : null,
    st: { dealt: 0, taken: 0, kills: 0, shots: 0, hits: 0, shells: 0, bombs: 0, missiles: 0, torpedoes: 0, sorties: 0, casts: 0, routs: 0, rallies: 0, assault: 0, small: 0, cannon: 0, antitank: 0, antiair: 0, artillery: 0, bombsDmg: 0, naval: 0, power: 0, lostFled: 0, lost: 0 },
    rec: { x: [], y: [], a: [], n: [], s: [], m: [], f: [] },
  };
  q.r = radiusOf(q);
  return q;
}

/**
 * Run one battle.
 * @param {object} o  specs: [specA, specB] validated specs (own-perspective coordinates);
 *                    commanders: [cmdA, cmdB] from sandbox.createCommander (or null); level, round, maxTime
 * @returns {{ map, duration, hud, events, stats, orderStats, decided, names, units }}
 */
function runBattle({ specs, commanders, level = 1, round = 1, maxTime = D.BATTLE_TIME, stopAfter = 3 }) {
  const map = D.mapForRound(round || level);
  const towns = map.towns, forests = map.forests, blocks = map.blocks, water = map.water, bridges = map.bridges;
  const L = D.clampLevel(level);
  const units = [];
  const bySide = [[], []];
  const hqs = [null, null];
  for (let side = 0; side < 2; side++) {
    const spec = specs[side];
    spec.units.forEach((sd, k) => { const q = makeUnit(sd, side, k, false, units.length); units.push(q); bySide[side].push(q); });
    const g = makeUnit({ name: spec.hq.name, x: spec.hq.x, y: spec.hq.y }, side, 98, true, units.length);
    units.push(g); bySide[side].push(g); hqs[side] = g;
  }
  const valueStart = [0, 1].map(s => bySide[s].reduce((a, q) => a + q.cost, 0));
  const events = [];
  const cmdEvents = [[], []];
  const projectiles = [];
  const delayed = [];          // barrage shells, airstrike / carpet bombs, cruise missiles
  const smokes = [];           // { x, y, r, until, side }
  const sayT = [-99, -99];
  const orderStats = [{ orders: 0, bad: 0, badNotes: [] }, { orders: 0, bad: 0, badNotes: [] }];
  let t = 0, tick = 0;
  let decided = null;
  let endAt = null;
  const brokenSince = [null, null];
  const hud = [];
  const REC = D.RECORD_EVERY;
  const alive = (q) => !q.dead && !q.fled;
  const present = (q) => alive(q) && !q.away;
  const homeX = (side) => (side === 0 ? FIELD.minX : FIELD.maxX);
  const fwd = (side) => (side === 0 ? 1 : -1);

  function ev(e) { e.t = r2(t); events.push(e); return e; }
  function cmdEv(side, e) { const l = cmdEvents[side]; if (l.length < 2000) l.push(e); }
  // what a commander hears is sorted the same way from both sides (and the newest 60 are kept),
  // so two identical commanders in mirrored spots hear exactly the same thing
  const byNews = (p, q) => (p.t - q.t) || (p.type < q.type ? -1 : p.type > q.type ? 1 : 0) || (p.who < q.who ? -1 : p.who > q.who ? 1 : 0) || (p.unit - q.unit) || ((p.target || 0) - (q.target || 0)) || (String(p.power || '') < String(q.power || '') ? -1 : String(p.power || '') > String(q.power || '') ? 1 : 0);
  function pid(q, viewer) { return (q.side === viewer ? 0 : 100) + (q.hq ? 99 : q.k + 1); }
  function fromPid(viewer, id) {
    const n = Number(id);
    if (!Number.isFinite(n)) return null;
    const side = n >= 100 ? 1 - viewer : viewer;
    const local = n >= 100 ? n - 100 : n;
    if (local === 99) return hqs[side];
    const q = bySide[side][local - 1];
    return q && !q.hq ? q : null;
  }
  function tellBoth(type, q, other, extra) {
    for (let v = 0; v < 2; v++) cmdEv(v, Object.assign({ t: r2(t), type, who: q.side === v ? 'me' : 'enemy', unit: pid(q, v), target: other ? pid(other, v) : undefined }, extra || {}));
  }

  // ── terrain ──────────────────────────────────────────────────────────────
  const inCircles = (list, x, y) => { for (const c of list) if (hyp(x - c.x, y - c.y) < c.r) return true; return false; };
  const waterAt = (x, y) => D.inWater(map, x, y);
  const deepAt = (x, y) => D.deepWater(map, x, y);
  const bridgeAt = (x, y) => { for (const b of bridges) if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) return b; return null; };
  const smokeAt = (x, y) => { for (const s of smokes) if (s.until > t && hyp(x - s.x, y - s.y) < s.r) return true; return false; };
  function segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    let k = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    k = clamp(k, 0, 1);
    return hyp(px - (ax + k * dx), py - (ay + k * dy));
  }
  const fullHeight = (w) => w.y1 - w.y0 >= FIELD.height - 1;
  /** A land point near (x, y) on the side of the water the unit is on. */
  function toLand(q, x, y) {
    for (const w of water) {
      if (!(x >= w.x0 && x <= w.x1 && y >= w.y0 && y <= w.y1)) continue;
      if (bridgeAt(x, y)) return { x, y };
      if (fullHeight(w)) return { x: q.x < (w.x0 + w.x1) / 2 ? w.x0 - q.r - 12 : w.x1 + q.r + 12, y };
      // a sea along an edge: step back onto the shore
      const up = w.y0 <= FIELD.minY + 1 ? w.y1 + q.r + 12 : w.y0 - q.r - 12;
      return { x, y: up };
    }
    return { x, y };
  }
  /** A point inside the water body the ship is in. */
  function toWater(q, x, y) {
    let body = null;
    for (const w of water) if (q.x >= w.x0 && q.x <= w.x1 && q.y >= w.y0 && q.y <= w.y1) { body = w; break; }
    if (!body) body = water[0];
    if (!body) return { x: q.x, y: q.y };
    const m = Math.min(q.r, 30);
    return { x: clamp(x, body.x0 + m, body.x1 - m), y: clamp(y, Math.max(body.y0, FIELD.minY) + m, Math.min(body.y1, FIELD.maxY) - m) };
  }
  /** Next waypoint for a ground unit: over a bridge if water is in the way, around buildings / cliffs. */
  function waypoint(q, tx, ty) {
    if (q.U.fly) return { x: tx, y: ty };
    if (q.U.naval) return toWater(q, tx, ty);
    const R = Math.min(q.r, 36);
    if (waterAt(tx, ty)) { const p = toLand(q, tx, ty); tx = p.x; ty = p.y; }
    for (const w of water) {
      if (!fullHeight(w) || !bridges.length) continue;
      const onB = bridgeAt(q.x, q.y);
      if (onB) return { x: tx > q.x ? w.x1 + R + 24 : w.x0 - R - 24, y: (onB.y0 + onB.y1) / 2 };
      const left = q.x < w.x0, right = q.x > w.x1;
      if ((left && tx > w.x0) || (right && tx < w.x1)) {
        let best = null, bd = Infinity;
        for (const b of bridges) {
          const by = (b.y0 + b.y1) / 2;
          const d = Math.abs(by - q.y) + Math.abs(by - ty) * 0.6;
          if (d < bd - 1e-9) { bd = d; best = b; }
        }
        if (best) {
          const by = (best.y0 + best.y1) / 2;
          const entryX = left ? w.x0 - R - 14 : w.x1 + R + 14;
          if (Math.abs(q.y - by) > 10 || Math.abs(q.x - entryX) > 20) return { x: entryX, y: by };
          return { x: left ? w.x1 + R + 30 : w.x0 - R - 30, y: by };
        }
      }
    }
    let best = null, bd = Infinity;
    for (const o of blocks) {
      if (segDist(o.x, o.y, q.x, q.y, tx, ty) >= o.r + R * 0.8) continue;
      const d = hyp(o.x - q.x, o.y - q.y);
      if (d < bd) { bd = d; best = o; }
    }
    if (!best) return { x: tx, y: ty };
    let dx = tx - q.x, dy = ty - q.y;
    const l = hyp(dx, dy) || 1; dx /= l; dy /= l;
    const c = best.r + R + 18;
    const c1 = { x: best.x - dy * c, y: best.y + dx * c }, c2 = { x: best.x + dy * c, y: best.y - dx * c };
    const l1 = hyp(c1.x - q.x, c1.y - q.y) + hyp(tx - c1.x, ty - c1.y);
    const l2 = hyp(c2.x - q.x, c2.y - q.y) + hyp(tx - c2.x, ty - c2.y);
    const pick = Math.abs(l1 - l2) < 1 ? (c1.y <= c2.y ? c1 : c2) : l1 < l2 ? c1 : c2;
    const bad = (p) => p.x < FIELD.minX + 10 || p.x > FIELD.maxX - 10 || p.y < FIELD.minY + 10 || p.y > FIELD.maxY - 10 || waterAt(p.x, p.y);
    return bad(pick) ? (pick === c1 ? c2 : c1) : pick;
  }

  // ── derived numbers ──────────────────────────────────────────────────────
  function terrainSpeed(q) {
    if (q.U.fly || q.U.naval) return 1;
    let k = 1;
    if (q.inTown) k *= isInf(q) ? COVER.town.speedInf : COVER.town.speedVeh;
    if (q.inForest) k *= isInf(q) ? COVER.forest.speedInf : COVER.forest.speedVeh;
    return k;
  }
  function maxSpeed(q) {
    if (q.emp > 0) return 0;
    let s = q.speed * terrainSpeed(q) * (FORMATIONS[q.form] ? FORMATIONS[q.form].speed : 1);
    if (q.routing) s *= 1.1;
    return s;
  }
  const rangeOf = (q) => q.w.reduce((m, w) => Math.max(m, w.range), 0);
  const minRangeOf = (q) => q.w.reduce((m, w) => (w.min ? Math.max(m, w.min) : m), 0);
  /** damage-taken multiplier from cover, digging in, smoke and formation */
  function coverMult(q, area) {
    let k = 1;
    if (!q.U.fly && !q.U.naval) {
      if (q.inTown) k *= isInf(q) ? COVER.town.inf : COVER.town.veh;
      if (q.inForest) k *= isInf(q) ? COVER.forest.inf : COVER.forest.veh;
      if (q.dug) k *= COVER.dug.taken;
    }
    if (!area && q.inSmoke) k *= COVER.smoke.direct;
    const f = FORMATIONS[q.form];
    if (f) k *= area ? f.areaTaken : f.directTaken;
    return k;
  }
  // hits and shock add up on a 1/1024 grid: the sum is exact whatever order the hits arrive in
  const grid = (v) => Math.round(v * 1024) / 1024;
  function hurt(def, amount, src, cat) {
    amount = grid(amount);
    if (!(amount > 0) || !alive(def) || def.away) return;
    def.dmgIn += amount;
    if (src) {
      def.hurtBy.push(src.gid, amount);
      src.dealtTick += amount;
      if (cat && src.st[cat] !== undefined) src.st[cat] += amount;
    }
  }

  // ── visibility ───────────────────────────────────────────────────────────
  const visible = [new Set(), new Set()];
  function seesStealth(f, e) {
    const d = hyp(f.x - e.x, f.y - e.y);
    if (e.type === 'submarine') return (f.U.naval || f.U.fly) && !f.U.jet && d < Math.max(250, f.U.spotter || 0) + e.r;
    if (e.type === 'stealthbomber') return D.canHit('aa', 'jet') && f.w.some(w => w.kind === 'aa' || (w.kind === 'autocannon' && (w.air || f.U.jet))) && d < 220 + e.r;
    return d < Math.max(150, f.U.spotter || 0) + e.r + f.r;
  }
  function updateVisibility() {
    for (let v = 0; v < 2; v++) {
      const set = visible[v];
      set.clear();
      for (const e of bySide[1 - v]) {
        if (!present(e)) continue;
        const hidden = (e.U.stealth && t - e.reveal > 3) || (e.inSmoke && !e.U.fly);
        if (!hidden || e.contacts.length) { set.add(e.gid); continue; }
        for (const f of bySide[v]) {
          if (!present(f)) continue;
          if (e.inSmoke && !e.U.stealth) { if (hyp(f.x - e.x, f.y - e.y) < 150 + e.r + f.r) { set.add(e.gid); break; } continue; }
          if (seesStealth(f, e)) { set.add(e.gid); break; }
        }
      }
    }
  }

  // ── commander I/O ────────────────────────────────────────────────────────
  function stateName(q) {
    if (q.dead) return 'dead';
    if (q.fled) return 'fled';
    if (q.away) return 'rearming';
    if (q.routing) return 'retreating';
    if (q.contacts.length) return 'assault';
    if (q.fireTarget !== null) return 'firing';
    if (q.spd > 4) return 'moving';
    return 'idle';
  }
  function weaponInfo(q, w) {
    return { name: w.name, kind: w.kind, range: w.range, min: w.min || 0, ready: w.rl <= 0 && w.ammoLeft > 0, reloadLeft: r1(Math.max(0, w.rl)), ammo: w.ammoLeft === Infinity ? null : w.ammoLeft, area: !!D.AREA_KINDS[w.kind], radius: w.radius || 0, antiAir: w.kind === 'aa' || !!w.air };
  }
  const ownH = (q) => (q.U.jet ? q.jh : q.h);   // heading in the unit's own side frame (exact mirror)
  function publicUnit(q, v) {
    const m = v === 0 ? 1 : -1;
    const o = {
      id: pid(q, v), type: q.type, name: q.name, domain: q.U.domain, cls: q.U.cls,
      x: r1(q.x * m), y: r1(q.y), vx: r1(q.vx * m), vy: r1(q.vy),
      facing: Math.round((q.side === v ? ownH(q) : angNorm(Math.PI - ownH(q))) * 1000) / 1000,
      radius: r1(q.r), count: q.count, maxCount: q.n0, hp: r1(q.hp), maxHp: q.maxHp, morale: Math.round(q.morale),
      state: stateName(q), formation: q.form, routing: q.routing, broken: q.broken,
      engaged: q.contacts.map(c => pid(c, v)), speed: r1(maxSpeed(q)), range: rangeOf(q), minRange: minRangeOf(q),
      weapons: q.w.map(w => weaponInfo(q, w)),
      inTown: q.inTown, inForest: q.inForest, inSmoke: q.inSmoke, dugIn: q.dug, disabled: r1(Math.max(0, q.emp)),
      flying: !!q.U.fly, jet: !!q.U.jet, naval: !!q.U.naval, hq: q.hq, legendary: !!q.U.legendary,
      value: Math.round(q.cost * q.hp / q.maxHp), cost: q.cost, armor: r2(q.armor), upgrades: q.upgrades.slice(),
    };
    if (q.sortie) o.sortie = q.sortie.mode === 'rearm' ? `rearming (${Math.ceil(q.sortie.t)} s)` : q.sortie.mode;
    if (q.side === v) {
      const od = q.order;
      o.order = od.kind;
      if (od.kind === 'attack') o.orderTarget = pid(units[od.target], v);
      if (od.x !== undefined) o.orderPoint = { x: r1(od.x * m), y: r1(od.y) };
      o.target = q.fireTarget !== null && units[q.fireTarget] ? pid(units[q.fireTarget], v) : null;
      o.autocast = q.autocast;
      o.hidden = !!(q.U.stealth && t - q.reveal > 3) || q.inSmoke;
    }
    return o;
  }
  function armyValue(side) {
    let v = 0;
    for (const q of bySide[side]) if (!q.hq && alive(q)) v += q.cost * q.hp / q.maxHp * (q.routing ? 0.5 : 1);
    return v;
  }
  function moraleAvg(side) {
    let s = 0, n = 0;
    for (const q of bySide[side]) if (!q.hq && alive(q)) { s += q.routing ? 0 : q.morale; n++; }
    return n ? s / n : 0;
  }
  function buildState(v) {
    const own = bySide[v].filter(alive).map(q => publicUnit(q, v));
    const enemies = bySide[1 - v].filter(q => present(q) && visible[v].has(q.gid)).map(q => publicUnit(q, v));
    const g = hqs[v];
    const m = v === 0 ? 1 : -1;
    const powers = D.powersAt(L).map(name => ({ name, ready: g.pw[name] <= 0 && alive(g), cooldownLeft: r1(Math.max(0, g.pw[name])), range: POWERS[name].range || POWERS[name].radius || 0 }));
    const evs = cmdEvents[v].splice(0).sort(byNews).slice(-60);
    const mirror = (list) => list.map(c => (c.x0 !== undefined ? { x0: v === 0 ? c.x0 : -c.x1, y0: c.y0, x1: v === 0 ? c.x1 : -c.x0, y1: c.y1 } : { x: c.x * m, y: c.y, r: c.r }));
    return {
      time: r2(t), timeLeft: r2(Math.max(0, maxTime - t)), tick, level: L, round,
      field: { width: FIELD.width, height: FIELD.height, minX: FIELD.minX, maxX: FIELD.maxX, minY: FIELD.minY, maxY: FIELD.maxY, deploy: Object.assign({}, D.DEPLOY) },
      terrain: { map: map.id, name: map.name, naval: !!map.naval, towns: mirror(towns), forests: mirror(forests), blocks: mirror(blocks), water: mirror(water), bridges: mirror(bridges), smoke: smokes.filter(s => s.until > t).map(s => ({ x: r1(s.x * m), y: r1(s.y), r: s.r, left: r1(s.until - t) })) },
      me: { name: specs[v].name, hq: 99, strength: Math.round(100 * armyValue(v) / (valueStart[v] || 1)), morale: Math.round(moraleAvg(v)), units: own.length },
      enemy: { name: specs[1 - v].name, hq: 199, seen: enemies.length, strength: Math.round(100 * armyValue(1 - v) / (valueStart[1 - v] || 1)) },
      units: own, squads: own, enemies, powers, events: evs,
    };
  }
  function worldPoint(v, p) {
    if (!p || typeof p !== 'object') return null;
    const x = Number(p.x), y = Number(p.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x: clamp(v === 0 ? x : -x, FIELD.minX + 10, FIELD.maxX - 10), y: clamp(y, FIELD.minY + 10, FIELD.maxY - 10) };
  }
  function badOrder(v, msg) {
    const s = orderStats[v];
    s.bad++;
    if (s.badNotes.length < 6 && !s.badNotes.includes(msg)) s.badNotes.push(msg);
  }
  function resolveTarget(v, id) {
    if (id && typeof id === 'object' && id.id !== undefined) id = id.id;
    const e = fromPid(v, id);
    if (!e || e.side === v || !present(e)) return null;
    if (!visible[v].has(e.gid)) return null;
    return e;
  }
  function setOrder(v, q, o) {
    if (typeof o === 'string') o = o === 'hold' ? { hold: true } : o === 'retreat' ? { retreat: true } : o === 'auto' || o === 'advance' ? { auto: true } : FORMATIONS[o] ? { formation: o } : {};
    if (!o || typeof o !== 'object') { badOrder(v, 'an order must be an object like { move: {x, y} }'); return; }
    orderStats[v].orders++;
    if (o.formation !== undefined) {
      if (!FORMATIONS[o.formation]) badOrder(v, `unknown formation "${String(o.formation).slice(0, 20)}" (line, column, spread)`);
      else if (!q.hq && !q.U.legendary && !q.U.fly && !q.U.naval && q.form !== o.formation) {
        q.form = o.formation; q.r = radiusOf(q);
        ev({ k: 'form', a: q.gid, f: FORM_CODE[q.form] });
      }
    }
    if (o.autocast !== undefined) q.autocast = !!o.autocast;
    if (q.routing) return;
    const tgtOf = (x) => resolveTarget(v, x);
    if (o.charge !== undefined || o.attack !== undefined) {
      const raw = o.charge !== undefined ? o.charge : o.attack;
      const e = tgtOf(raw);
      if (!e) badOrder(v, `attack: enemy ${JSON.stringify(raw)} not found or not visible`);
      else q.order = { kind: 'attack', target: e.gid, assault: o.charge !== undefined && isInf(q) };
    } else if (o.move !== undefined) {
      const p = worldPoint(v, o.move);
      if (!p) badOrder(v, 'move needs a point {x, y}');
      else q.order = { kind: 'move', x: p.x, y: p.y };
    } else if (o.retreat !== undefined && o.retreat !== false) {
      const p = worldPoint(v, typeof o.retreat === 'object' ? o.retreat : null) || { x: v === 0 ? FIELD.minX + 80 : FIELD.maxX - 80, y: q.y };
      q.order = { kind: 'retreat', x: p.x, y: p.y };
    } else if (o.hold !== undefined && o.hold !== false) {
      const p = worldPoint(v, typeof o.hold === 'object' ? o.hold : null) || { x: q.x, y: q.y };
      q.order = { kind: 'hold', x: p.x, y: p.y };
    } else if (o.auto) q.order = { kind: 'auto' };
    if (o.target !== undefined && o.ability === undefined) {
      const e = tgtOf(o.target);
      if (e) q.order.focus = e.gid; else badOrder(v, `target: enemy ${JSON.stringify(o.target)} not found or not visible`);
    }
    if (o.ability !== undefined) {
      const name = String(o.ability);
      let tgt = null;
      if (o.target !== undefined) {
        if (typeof o.target === 'object' && o.target && o.target.id === undefined) tgt = worldPoint(v, o.target);
        else { const e = tgtOf(o.target); if (e) tgt = { gid: e.gid }; }
      }
      q.pending = { name, tgt, at: t };
    }
  }
  function applyCommand(v, out) {
    if (out === null || out === undefined) return;
    let list = [];
    let say = null;
    if (Array.isArray(out)) list = out;
    else if (typeof out === 'object') {
      if (typeof out.say === 'string') say = out.say;
      if (out.power) list.push({ id: 99, ability: out.power, target: out.target });
      const src = out.orders !== undefined ? out.orders : out;
      if (Array.isArray(src)) list = list.concat(src);
      else if (src && typeof src === 'object') {
        for (const key of Object.keys(src)) {
          if (key === 'say' || key === 'orders' || key === 'power' || key === 'target') continue;
          const id = Number(key);
          if (!Number.isFinite(id)) { badOrder(v, `"${key.slice(0, 20)}" is not a unit id`); continue; }
          const o = src[key];
          list.push(typeof o === 'string' ? { id, _s: o } : Object.assign({ id }, o));
        }
      }
    } else { badOrder(v, 'command() must return an object or an array'); return; }
    for (const item of list.slice(0, 64)) {
      if (!item || typeof item !== 'object') { badOrder(v, 'each order must be an object with an id'); continue; }
      const q = fromPid(v, item.id);
      if (!q || q.side !== v) { badOrder(v, `no unit of yours has id ${JSON.stringify(item.id)}`); continue; }
      if (!alive(q)) continue;
      setOrder(v, q, item._s !== undefined ? item._s : item);
    }
    if (say && t - sayT[v] >= 3) {
      sayT[v] = t;
      ev({ k: 'say', s: v, text: say.replace(/\s+/g, ' ').slice(0, 60) });
    }
  }

  // ── targeting ────────────────────────────────────────────────────────────
  function visibleEnemies(q) {
    const out = [];
    for (const e of bySide[1 - q.side]) if (present(e) && visible[q.side].has(e.gid)) out.push(e);
    return out;
  }
  function weaponFits(w, e) {
    if (!D.canHit(w.kind, e.U.cls)) return false;
    if (w.air && !e.U.fly) return false;   // flak: aircraft only
    return true;
  }
  /** how much damage one hit of weapon w would do to e (for choosing targets) */
  function effect(w, e) { return D.vs(w.kind, e.U.cls) * (1 - e.armor * ARMOR_EFFECT[w.kind]) * w.dmg; }
  function directTarget(q, w, maxRange) {
    const R = maxRange || w.range;
    const focus = q.order.kind === 'attack' ? q.order.target : q.order.focus;
    if (focus !== undefined && focus !== null) {
      const e = units[focus];
      if (e && present(e) && visible[q.side].has(e.gid) && weaponFits(w, e)) {
        const d = hyp(e.x - q.x, e.y - q.y);
        if (d <= R && d >= (w.min || 0)) return e;
      }
    }
    let best = null, bs = -Infinity;
    for (const e of visibleEnemies(q)) {
      if (!weaponFits(w, e)) continue;
      const d = hyp(e.x - q.x, e.y - q.y);
      if (d > R + e.r || d < (w.min || 0)) continue;
      let s = effect(w, e) * Math.min(e.count, 6) - d * 0.02;
      if (e.hq) s *= 1.3;
      if (e.routing) s *= 0.4;
      if (s > bs) { bs = s; best = e; }
    }
    return best;
  }
  function areaFriendsClear(q, x, y, radius) {
    for (const f of bySide[q.side]) if (present(f) && !f.U.fly && hyp(f.x - x, f.y - y) < radius + f.r + 20) return false;
    return true;
  }
  function areaTarget(q, w) {
    const focus = q.order.kind === 'attack' ? q.order.target : q.order.focus;
    if (focus !== undefined && focus !== null) {
      const e = units[focus];
      if (e && present(e) && !e.U.fly && visible[q.side].has(e.gid)) {
        const d = hyp(e.x - q.x, e.y - q.y);
        if (d <= w.range && d >= (w.min || 0)) return e;
      }
    }
    if (!q.autocast) return null;
    let best = null, bs = -Infinity;
    for (const e of visibleEnemies(q)) {
      if (e.U.fly || !D.canHit(w.kind, e.U.cls)) continue;
      const d = hyp(e.x - q.x, e.y - q.y);
      if (d > w.range || d < (w.min || 0)) continue;
      if (!areaFriendsClear(q, e.x, e.y, w.radius)) continue;
      // bunched, slow, big targets first
      let s = e.count * Math.sqrt(e.hpPer / 10) * D.vs(w.kind, e.U.cls) * (e.spd < 5 ? 1.5 : 1) - d * 0.005;
      if (e.hq) s += 8;
      if (e.routing) s *= 0.3;
      if (s > bs) { bs = s; best = e; }
    }
    return best;
  }

  // ── movement ─────────────────────────────────────────────────────────────
  function nearestOf(q, list, pref) {
    let best = null, bd = Infinity;
    for (const e of list) {
      let d = hyp(e.x - q.x, e.y - q.y);
      if (e.routing) d += 500;
      if (pref) d = pref(e, d);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }
  function friendsCentre(side, exclude) {
    let cx = 0, cy = 0, w = 0;
    for (const f of bySide[side]) if (f !== exclude && !f.hq && present(f) && !f.U.jet && !f.routing) { cx += f.x * f.count; cy += f.y * f.count; w += f.count; }
    return w ? { x: cx / w, y: cy / w } : null;
  }
  /** Where a unit without orders goes, and whom it aims at. */
  function autoPlan(q) {
    const foes = visibleEnemies(q);
    if (q.hq) {
      const threat = nearestOf(q, foes.filter(e => !e.U.jet));
      if (threat && hyp(threat.x - q.x, threat.y - q.y) < 260 + threat.r) return { x: q.x + (q.x - threat.x), y: q.y + (q.y - threat.y), target: null };
      const c = friendsCentre(q.side, q);
      if (!c) return { x: q.x, y: q.y, target: null };
      // follow the army, well behind it, and never past our own side of the middle
      const f = fwd(q.side);
      return { x: Math.min(c.x * f - 300, -300) * f, y: c.y * 0.8, target: null };
    }
    const main = q.w[0];
    const area = !!D.AREA_KINDS[main.kind];
    // never chase jets across the map (they are shot at when they come close)
    const usable = foes.filter(e => !e.U.jet && q.w.some(w => weaponFits(w, e)));
    let target = nearestOf(q, usable, (e, d) => d - 60 * Math.min(3, effect(q.w.find(w => weaponFits(w, e)) || main, e) / Math.max(1, main.dmg)));
    if (!target) {
      // nothing to shoot at yet: advance (artillery and ships stay back)
      const adv = q.x + fwd(q.side) * 220;
      if (area) return { x: q.x, y: q.y, target: null, stay: true };
      return { x: q.side === 0 ? Math.min(adv, FIELD.maxX - 60) : Math.max(adv, FIELD.minX + 60), y: q.y, target: null };
    }
    const d = hyp(target.x - q.x, target.y - q.y);
    const w = q.w.find(x => weaponFits(x, target)) || main;
    if (area) {
      if (d <= w.range * 0.95 && d >= (w.min || 0)) return { x: q.x, y: q.y, target: target.gid, stay: true };
      if (d < (w.min || 0)) return { x: q.x - (target.x - q.x) * 0.5, y: q.y - (target.y - q.y) * 0.5, target: target.gid };
      return { x: target.x, y: target.y, target: target.gid };
    }
    const want = w.range * (isInf(q) ? 0.8 : 0.85);
    if (d <= want) return { x: q.x, y: q.y, target: target.gid, stay: true };
    return { x: target.x + target.vx * 0.3, y: target.y + target.vy * 0.3, target: target.gid };
  }
  function plan(q) {
    q.fireTarget = null;
    if (q.away) return null;
    if (q.emp > 0) return { dx: 0, dy: 0, speed: 0, face: null };
    if (q.U.jet) return planJet(q);
    if (q.routing) {
      let ax = 0, ay = 0;
      for (const e of bySide[1 - q.side]) {
        if (!present(e) || e.U.jet) continue;
        const dx = q.x - e.x, dy = q.y - e.y, d = hyp(dx, dy);
        if (d < 260 && d > 1) { ax += dx / d * (260 - d) / 260; ay += dy / d * (260 - d) / 260; }
      }
      const home = q.side === 0 ? FIELD.minX - 40 : FIELD.maxX + 40;
      const wp = q.U.fly ? { x: home, y: q.y } : waypoint(q, home, q.y + ay * 200);
      let dx = wp.x - q.x, dy = wp.y - q.y;
      const l = hyp(dx, dy) || 1;
      dx = dx / l + ax * 0.5; dy = dy / l + ay * 0.5;
      const l2 = hyp(dx, dy) || 1;
      return { dx: dx / l2, dy: dy / l2, speed: maxSpeed(q), face: null };
    }
    if (q.contacts.length && q.order.kind !== 'retreat') return { dx: 0, dy: 0, speed: 0, face: null };
    const od = q.order;
    let gx = q.x, gy = q.y, target = null, stay = false, speedMul = 1;
    if (od.kind === 'attack') {
      const e = units[od.target];
      if (!e || !present(e) || !visible[q.side].has(e.gid)) { q.order = { kind: 'auto' }; return plan(q); }
      target = e.gid;
      const w = q.w.find(x => weaponFits(x, e)) || q.w[0];
      const d = hyp(e.x - q.x, e.y - q.y);
      if (od.assault) { gx = e.x + e.vx * 0.3; gy = e.y + e.vy * 0.3; speedMul = 1.2; }
      else if (d <= w.range * 0.9 && d >= (w.min || 0)) stay = true;
      else { gx = e.x; gy = e.y; }
    } else if (od.kind === 'move' || od.kind === 'retreat') {
      gx = od.x; gy = od.y;
      if (hyp(gx - q.x, gy - q.y) < 8) { q.order = { kind: 'hold', x: od.x, y: od.y }; stay = true; }
      target = od.focus !== undefined ? od.focus : null;
    } else if (od.kind === 'hold') {
      gx = od.x; gy = od.y;
      if (hyp(gx - q.x, gy - q.y) < 14) stay = true;
      target = od.focus !== undefined ? od.focus : null;
    } else {
      const p = autoPlan(q);
      gx = p.x; gy = p.y; target = p.target; stay = !!p.stay;
    }
    q.autoTarget = target;
    let face = null;
    if (target !== null && units[target] && present(units[target])) {
      const e = units[target];
      if (hyp(e.x - q.x, e.y - q.y) <= rangeOf(q) + 60) face = Math.atan2(e.y - q.y, (e.x - q.x) * fwd(q.side) + 0);
    }
    if (stay) return { dx: 0, dy: 0, speed: 0, face };
    const wp = waypoint(q, clamp(gx, FIELD.minX + q.r * 0.5, FIELD.maxX - q.r * 0.5), clamp(gy, FIELD.minY + q.r * 0.5, FIELD.maxY - q.r * 0.5));
    let dx = wp.x - q.x, dy = wp.y - q.y;
    const d = hyp(dx, dy);
    if (d < 0.5) return { dx: 0, dy: 0, speed: 0, face };
    const sp = Math.min(maxSpeed(q) * speedMul, d / DT);
    return { dx: dx / d, dy: dy / d, speed: sp, face };
  }

  // jets: patrol -> attack run -> egress -> attack ... until out of ammo -> fly home -> rearm (off map) -> back
  function jetTarget(q) {
    const od = q.order;
    if (od.kind === 'attack') {
      const e = units[od.target];
      if (e && present(e) && visible[q.side].has(e.gid) && q.w.some(w => w.ammoLeft > 0 && weaponFits(w, e))) return e;
      q.order = { kind: 'auto' };
    }
    if (od.kind === 'move' || od.kind === 'hold') return null;
    const foes = visibleEnemies(q);
    const hasAA = q.w.some(w => w.kind === 'aa' && w.ammoLeft > 0);
    const hasBombs = q.w.some(w => w.kind === 'bomb' && w.ammoLeft > 0);
    if (hasAA) {
      const air = nearestOf(q, foes.filter(e => e.U.fly), (e, d) => d - (e.type === 'bomber' || e.type === 'helicopter' ? 150 : 0));
      if (air) return air;
    }
    if (hasBombs) {
      let best = null, bs = -Infinity;
      for (const e of foes) {
        if (e.U.fly) continue;
        if (!areaFriendsClear(q, e.x, e.y, 100)) continue;
        const d = hyp(e.x - q.x, e.y - q.y);
        let s = e.count * Math.sqrt(e.hpPer / 10) * (e.spd < 5 ? 1.4 : 1) + (e.hq ? 6 : 0) - d * 0.002;
        if (e.type === 'antiair') s *= 0.5;
        if (s > bs) { bs = s; best = e; }
      }
      return best;
    }
    // fighters without air targets: strafe what is on the ground near their own army
    if (q.w.some(w => w.kind === 'autocannon' && w.ammoLeft > 0)) {
      const c = friendsCentre(q.side, null) || { x: q.x, y: q.y };
      return nearestOf({ x: c.x, y: c.y }, foes.filter(e => !e.U.fly && !e.U.naval && e.type !== 'antiair' && hyp(e.x - c.x, e.y - c.y) < 700));
    }
    return null;
  }
  function planJet(q) {
    const S = q.sortie;
    const f = fwd(q.side);                       // own frame: X = x * f (exact), heading q.jh
    const ammo = q.w.some(w => w.ammoLeft > 0);
    if (S.mode !== 'rtb' && (!ammo || q.order.kind === 'retreat' || q.routing)) {
      S.mode = 'rtb';
      ev({ k: 'sortie', s: q.side, a: q.gid, m: 'rtb' });
    }
    let ax, ay;                                  // aim point in WORLD coordinates
    if (S.mode === 'rtb') {
      ax = homeX(q.side) - f * 140; ay = q.y;
    } else {
      const e = jetTarget(q);
      if (e) {
        const d = hyp(e.x - q.x, e.y - q.y);
        const lead = Math.min(1.5, d / Math.max(1, q.speed));
        const px = e.x + e.vx * lead, py = e.y + e.vy * lead;
        const ang = Math.abs(angNorm(Math.atan2(py - q.y, (px - q.x) * f + 0) - q.jh));   // + 0: never -0 (atan2(0, -0) = pi)
        if (S.mode === 'egress') {
          if (hyp(S.egX - q.x, S.egY - q.y) < 70 || S.eg > 3.5) S.mode = 'attack';
          else { ax = S.egX; ay = S.egY; S.eg += DT; }
        }
        if (S.mode !== 'egress') {
          S.mode = 'attack';
          S.tgt = e.gid;
          // overshoot: once the target is behind us or we are on top of it, fly on and come round again
          if ((d < 60) || (ang > 1.9 && d < 320)) {
            S.mode = 'egress'; S.eg = 0;
            S.egX = clamp(q.x + f * Math.cos(q.jh) * 420, FIELD.minX + 40, FIELD.maxX - 40);
            S.egY = clamp(q.y + Math.sin(q.jh) * 420, FIELD.minY + 40, FIELD.maxY - 40);
            ax = S.egX; ay = S.egY;
          } else { ax = px; ay = py; }
        }
        q.autoTarget = e.gid;
      } else {
        // patrol: orbit a point (the order point, or over our own army)
        S.mode = 'patrol';
        let Pp = null;
        if (q.order.kind === 'move' || q.order.kind === 'hold') Pp = { x: q.order.x, y: q.order.y };
        if (!Pp) { const c = friendsCentre(q.side, null); Pp = c ? { x: c.x + f * 160, y: c.y } : { x: 0, y: q.y }; }
        const d = hyp(Pp.x - q.x, Pp.y - q.y);
        if (d > 260) { ax = Pp.x; ay = Pp.y; }
        else { const a = Math.atan2(q.y - Pp.y, (q.x - Pp.x) * f + 0) + 0.9; ax = Pp.x + f * Math.cos(a) * 240; ay = Pp.y + Math.sin(a) * 240; }
      }
    }
    const wdx = (ax - q.x) * f + 0, wdy = ay - q.y;         // own frame; + 0 turns -0 into 0 so both sides agree
    const want = wdx * wdx + wdy * wdy < 1e-9 ? q.jh : Math.atan2(wdy, wdx);
    return { jet: true, want, speed: q.emp > 0 ? q.speed * 0.8 : q.speed };
  }
  function move(plans) {
    const nx = new Float64Array(units.length), ny = new Float64Array(units.length);
    for (const q of units) {
      nx[q.gid] = q.x; ny[q.gid] = q.y;
      if (!alive(q) || q.away) continue;
      const p = plans[q.gid];
      if (!p) continue;
      if (p.jet) {
        const f = fwd(q.side);
        if (q.emp <= 0) {
          const diff = angNorm(p.want - q.jh);
          const rate = (JET_TURN[q.type] || 1.4) * DT;
          q.jh = angNorm(q.jh + clamp(diff, -rate, rate));
        }
        q.face = q.side === 0 ? q.jh : angNorm(Math.PI - q.jh);
        nx[q.gid] = q.x + f * Math.cos(q.jh) * p.speed * DT;
        ny[q.gid] = q.y + Math.sin(q.jh) * p.speed * DT;
        continue;
      }
      const f = fwd(q.side);
      let want = p.speed > 0.5 ? Math.atan2(p.dy, p.dx * f + 0) : null;       // own frame
      if (q.contacts.length && !q.routing && q.order.kind !== 'retreat') {
        const e = q.contacts[0];
        want = Math.atan2(e.y - q.y, (e.x - q.x) * f + 0);
      } else if (p.face !== null && p.face !== undefined && p.speed < 0.5) want = p.face;
      let turnK = 1;
      if (want !== null) {
        const diff = angNorm(want - q.h);
        const rate = (q.U.fly ? 3.5 : q.U.naval ? (q.U.legendary ? 0.5 : 0.9) : isInf(q) ? 2.6 : 1.8) * DT;
        q.h = angNorm(q.h + clamp(diff, -rate, rate));
        q.face = q.side === 0 ? q.h : angNorm(Math.PI - q.h);
        turnK = q.U.naval ? 0.6 + 0.4 * Math.max(0, Math.cos(diff)) : 0.45 + 0.55 * Math.max(0, Math.cos(diff));
      }
      if (p.speed > 0) {
        const sp = p.speed * (q.routing ? 1 : turnK);
        nx[q.gid] = q.x + p.dx * sp * DT;
        ny[q.gid] = q.y + p.dy * sp * DT;
      }
    }
    // collisions within a layer (ground, water, low air); jets never collide
    const layer = (q) => (q.U.jet ? -1 : q.U.fly ? 2 : q.U.naval ? 1 : 0);
    // pushes from friends and from enemies are summed apart (each in the same unit order on both
    // sides) and only then added together, so a mirrored battle stays an exact mirror
    const px = new Float64Array(units.length), py = new Float64Array(units.length);
    const ex = new Float64Array(units.length), ey = new Float64Array(units.length);
    for (let i = 0; i < units.length; i++) {
      const a = units[i];
      if (!alive(a) || a.away || layer(a) < 0) continue;
      for (let j = i + 1; j < units.length; j++) {
        const b = units[j];
        if (!alive(b) || b.away || layer(b) !== layer(a)) continue;
        const dx = nx[j] - nx[i], dy = ny[j] - ny[i];
        const minD = (a.r + b.r) * (layer(a) === 2 ? 0.7 : 1);
        const d2 = dx * dx + dy * dy;
        if (d2 >= minD * minD) continue;
        let d = Math.sqrt(d2), ux, uy;
        if (d < 1e-6) { ux = a.side === 0 ? 1 : -1; uy = 0; d = 0; } else { ux = dx / d; uy = dy / d; }
        const over = minD - d;
        const k = a.side === b.side ? (a.contacts.length || b.contacts.length ? 0.15 : 0.3) : 0.5;
        const ma = a.U.legendary || a.hq ? 3 : isInf(a) ? 1 : 2, mb = b.U.legendary || b.hq ? 3 : isInf(b) ? 1 : 2;
        const sa = mb / (ma + mb) * 2, sb = ma / (ma + mb) * 2;
        const X = a.side === b.side ? px : ex, Y = a.side === b.side ? py : ey;
        X[i] -= ux * over * k * sa; Y[i] -= uy * over * k * sa;
        X[j] += ux * over * k * sb; Y[j] += uy * over * k * sb;
      }
    }
    for (const q of units) {
      if (!alive(q) || q.away) continue;
      let x = nx[q.gid] + (px[q.gid] + ex[q.gid]), y = ny[q.gid] + (py[q.gid] + ey[q.gid]);
      if (q.U.jet) {
        // jets may leave the field when heading home
        if (q.sortie.mode === 'rtb' && ((q.side === 0 && x < FIELD.minX - 60) || (q.side === 1 && x > FIELD.maxX + 60))) {
          q.away = true; q.sortie.mode = 'rearm'; q.sortie.t = D.REARM_TIME; q.sortie.y0 = clamp(y, FIELD.minY + 60, FIELD.maxY - 60);
          ev({ k: 'sortie', s: q.side, a: q.gid, m: 'away' });
        }
        if (q.sortie.mode !== 'rtb') { x = clamp(x, FIELD.minX - 40, FIELD.maxX + 40); y = clamp(y, FIELD.minY - 40, FIELD.maxY + 40); }
      } else if (q.U.naval) {
        if (!deepAt(x, y)) {
          if (deepAt(x, q.y)) y = q.y; else if (deepAt(q.x, y)) x = q.x; else { x = q.x; y = q.y; }
        }
        // islets and rocks in the water: sail round them
        for (const o of blocks) {
          const dx = x - o.x, dy = y - o.y, d = hyp(dx, dy), m = o.r + q.r * 0.55;
          if (d >= m) continue;
          const nx2 = d < 1e-6 ? o.x + (q.side === 0 ? -m : m) : o.x + dx / d * m, ny2 = d < 1e-6 ? y : o.y + dy / d * m;
          if (deepAt(nx2, ny2)) { x = nx2; y = ny2; } else { x = q.x; y = q.y; }
        }
      } else if (!q.U.fly) {
        for (const o of blocks) {
          const dx = x - o.x, dy = y - o.y, d = hyp(dx, dy), m = o.r + q.r * 0.55;
          if (d < m) {
            if (d < 1e-6) x = o.x + (q.side === 0 ? -m : m);
            else { x = o.x + dx / d * m; y = o.y + dy / d * m; }
          }
        }
        if (waterAt(x, y)) {
          if (!waterAt(x, q.y)) y = q.y; else if (!waterAt(q.x, y)) x = q.x; else { x = q.x; y = q.y; }
        }
      }
      if (!q.U.jet) {
        const my = Math.min(q.r * 0.6, 30);
        y = clamp(y, FIELD.minY + my, FIELD.maxY - my);
        if (q.routing) {
          if ((q.side === 0 && x < FIELD.minX + 2) || (q.side === 1 && x > FIELD.maxX - 2)) {
            q.fled = true; q.endT = t; q.st.lostFled = q.count;
            ev({ k: 'fled', s: q.side, a: q.gid, n: q.count });
            tellBoth('fled', q);
          }
        } else x = clamp(x, FIELD.minX + my, FIELD.maxX - my);
      }
      const moved = hyp(x - q.x, y - q.y);
      q.vx = (x - q.x) / DT; q.vy = (y - q.y) / DT; q.spd = moved / DT;
      q.x = x; q.y = y;
      if (q.U.fly) { q.inTown = false; q.inForest = false; }
      else { q.inTown = inCircles(towns, x, y); q.inForest = inCircles(forests, x, y); }
      q.inSmoke = smokeAt(x, y);
      // standing still: artillery sets up after 1.5 s, infantry digs in after 6 s
      if (q.spd < 2 && !q.routing) { q.still += DT; if (isInf(q) && !q.dug && q.still >= COVER.dug.after) { q.dug = true; ev({ k: 'dug', a: q.gid }); } }
      else { q.still = 0; q.dug = false; }
    }
  }

  // ── jets coming back from rearming ───────────────────────────────────────
  function rearmPhase() {
    for (const q of units) {
      if (!alive(q) || !q.away) continue;
      q.sortie.t -= DT;
      if (q.sortie.t > 0) continue;
      q.away = false;
      q.sortie.mode = 'patrol';
      for (const w of q.w) { w.ammoLeft = w.ammo === undefined ? Infinity : w.ammo; w.rl = 0.5; }
      q.x = homeX(q.side) - fwd(q.side) * 30; q.y = q.sortie.y0;
      q.jh = 0;
      q.face = q.side === 0 ? 0 : Math.PI;
      q.st.sorties++;
      if (q.order.kind === 'retreat') q.order = { kind: 'auto' };
      ev({ k: 'sortie', s: q.side, a: q.gid, m: 'in' });
    }
  }

  // ── close assault (infantry in contact) ──────────────────────────────────
  function contactsPhase() {
    for (const q of units) { q.prevContacts = new Set(q.contacts.map(c => c.gid)); q.contacts = []; }
    for (let i = 0; i < units.length; i++) {
      const a = units[i];
      if (!present(a) || a.U.fly || a.U.naval) continue;
      for (let j = i + 1; j < units.length; j++) {
        const b = units[j];
        if (!present(b) || b.side === a.side || b.U.fly || b.U.naval) continue;
        if (!isInf(a) && !isInf(b)) continue;
        if (hyp(b.x - a.x, b.y - a.y) <= a.r + b.r + 4) { a.contacts.push(b); b.contacts.push(a); }
      }
    }
    for (const a of units) {
      if (!present(a) || !a.contacts.length) continue;
      a.contacts.sort((x, y) => x.gid - y.gid);
      for (const b of a.contacts) {
        if (a.prevContacts.has(b.gid) || a.gid > b.gid) continue;
        ev({ k: 'assault', s: a.side, a: a.gid, b: b.gid });
        // close combat is mutual: each side hears it as its own unit fighting theirs
        for (let v = 0; v < 2; v++) { const mine = a.side === v ? a : b, theirs = mine === a ? b : a; cmdEv(v, { t: r2(t), type: 'assault', who: 'me', unit: pid(mine, v), target: pid(theirs, v) }); }
      }
    }
  }
  function assaultPhase() {
    for (const a of units) {
      if (!present(a) || a.routing || !isInf(a) || !a.contacts.length || a.emp > 0) continue;
      const b = a.contacts[0];
      let d = a.count * 0.9 * a.dmgMult * (b.U.cls === 'inf' ? 1 : b.U.cls === 'light' ? 0.4 : b.U.cls === 'hq' ? 0.25 : 0.08);
      d *= (b.inTown || b.dug ? 0.7 : 1) * (b.routing ? 1.5 : 1);
      if (a.order.assault) d *= 1.25;
      hurt(b, d * DT, a, 'assault');
      a.reveal = t;
    }
  }

  // ── weapons ──────────────────────────────────────────────────────────────
  function shoot(q, w, e) {
    const d = hyp(e.x - q.x, e.y - q.y);
    const moving = q.spd > 3;
    let acc = w.acc * (moving ? (w.move === undefined ? 1 : w.move) : 1) * (1 - 0.3 * clamp(d / w.range, 0, 1));
    if (e.U.jet && w.kind !== 'aa') acc *= 0.45;
    if (q.inSmoke) acc *= 0.6;
    if (q.morale < 30 && !q.U.fearless) acc *= 0.8;
    const f = FORMATIONS[q.form];
    const shooters = q.count * (f ? f.fire : 1);
    const hits = shooters * acc;
    const dmg = hits * w.dmg * q.dmgMult * D.vs(w.kind, e.U.cls) * (1 - e.armor * ARMOR_EFFECT[w.kind]);
    w.ammoLeft -= w.ammoLeft === Infinity ? 0 : 1;
    q.reveal = t;
    q.fireTarget = e.gid;
    q.st.shots += shooters;
    if (INSTANT[w.kind]) {
      const got = dmg * coverMult(e, false);
      hurt(e, got, q, CAT[w.kind]);
      q.st.hits += hits;
      if (!e.U.fearless) e.shock += grid(Math.min(6, hits * (w.supp || 0.25) * (isInf(e) ? 1 : 0.3)));
      if (BIG[w.kind]) ev({ k: 'fire', s: q.side, a: q.gid, b: e.gid, w: w.kind, ft: 0 });
    } else {
      const ft = d / (w.speed || 600);
      projectiles.push({ kind: w.kind, t: t + ft, side: q.side, from: q.gid, to: e.gid, dmg, hits, supp: w.supp || 0.5 });
      if (w.kind === 'torpedo') q.st.torpedoes++; else q.st.missiles++;
      ev({ k: 'fire', s: q.side, a: q.gid, b: e.gid, w: w.kind, ft: r2(ft) });
      tellBoth(w.kind === 'aa' ? 'missile' : w.kind, q, e);
    }
  }
  function lob(q, w, spot) {
    // shells, salvos and bombs: they land where the target WAS (plus a little lead)
    const d = hyp(spot.x - q.x, spot.y - q.y);
    const ft = (w.flight || 1) + d / (w.fspeed || 800);
    const lead = spot.e && spot.e.spd > 3 ? 0.35 * ft : 0;
    const x = spot.x + (spot.e ? spot.e.vx * lead : 0), y = spot.y + (spot.e ? spot.e.vy * lead : 0);
    const power = w.dmg * (0.4 + 0.6 * q.count / q.n0) * q.dmgMult;
    const n = w.shells || 1;
    for (let i = 0; i < n; i++) {
      const ox = n > 1 ? Math.cos(i * 2.1 + 0.5) * w.radius * 0.7 * fwd(q.side) : 0, oy = n > 1 ? Math.sin(i * 2.1 + 0.5) * w.radius * 0.7 : 0;
      delayed.push({ t: t + ft + i * 0.25, kind: w.kind, side: q.side, from: q.gid, x: x + ox, y: y + oy, radius: w.radius, dmg: power, ff: true, salvo: !!w.salvo });
    }
    w.ammoLeft -= w.ammoLeft === Infinity ? 0 : 1;
    q.reveal = t;
    q.fireTarget = spot.e ? spot.e.gid : null;
    if (w.kind === 'bomb') q.st.bombs++; else q.st.shells += n;
    ev({ k: 'shell', s: q.side, a: q.gid, x: Math.round(x), y: Math.round(y), r: w.radius, ft: r2(ft), w: w.salvo ? 'salvo' : w.kind, n });
  }
  function weaponsPhase() {
    // command-post powers first, for both sides at once: who may cast is decided before either
    // power lands, so one side's EMP or rally never lands "mid-tick" for the other side
    const casters = [];
    for (const q of units) {
      if (!alive(q) || !q.hq) continue;
      if (q.pw) for (const k in q.pw) q.pw[k] -= DT;
      if (q.pending && t - q.pending.at > 3) q.pending = null;
      if (q.pending && q.emp <= 0 && !q.away && !q.routing) casters.push(q);
    }
    for (const q of casters) { usePower(q, q.pending); q.pending = null; }
    for (const q of units) {
      if (!alive(q)) continue;
      for (const w of q.w) w.rl -= DT;
      if (q.emp > 0) { q.emp -= DT; continue; }
      if (q.away || q.routing) { if (q.routing) q.pending = null; continue; }
      if (q.pending && t - q.pending.at > 3) q.pending = null;
      const moving = q.spd > 3;
      for (const w of q.w) {
        if (w.rl > 0 || w.ammoLeft <= 0) continue;
        if (!w.move && w.move !== undefined && moving) continue;       // must stand still
        if (D.AREA_KINDS[w.kind]) {
          if (w.kind === 'bomb') {
            // bombers release when over the target
            const e = q.sortie && q.sortie.tgt !== null ? units[q.sortie.tgt] : null;
            if (!e || !present(e) || e.U.fly) continue;
            if (hyp(e.x - q.x, e.y - q.y) > w.range + e.r) continue;
            lob(q, w, { x: e.x, y: e.y, e });
            w.rl = w.reload;
            continue;
          }
          if (q.still < 1.5 && !q.U.naval) continue;                   // artillery needs a moment to set up
          let spot = null;
          const pend = q.pending;
          if (pend && (pend.name === 'fire' || pend.name === 'shoot' || pend.name === 'barrage')) {
            const p = pend.tgt ? (pend.tgt.gid !== undefined ? (present(units[pend.tgt.gid]) ? { x: units[pend.tgt.gid].x, y: units[pend.tgt.gid].y, e: units[pend.tgt.gid] } : null) : { x: pend.tgt.x, y: pend.tgt.y, e: null }) : null;
            q.pending = null;
            if (p) { const d = hyp(p.x - q.x, p.y - q.y); if (d <= w.range && d >= (w.min || 0)) spot = p; else badOrder(q.side, `fire: target out of range for ${q.name} (${w.min || 0}-${w.range})`); }
          }
          if (!spot) { const e = areaTarget(q, w); if (e) spot = { x: e.x, y: e.y, e }; }
          if (spot) { lob(q, w, spot); w.rl = w.reload; }
          continue;
        }
        let e;
        if (q.U.jet) {
          // jets shoot forward: aircraft for missiles, anything in the nose cone for cannons
          e = null;
          const cone = w.kind === 'aa' ? 0.55 : 0.35;
          let bd = Infinity;
          for (const c of visibleEnemies(q)) {
            if (!weaponFits(w, c)) continue;
            const d = hyp(c.x - q.x, c.y - q.y);
            if (d > w.range || Math.abs(angNorm(Math.atan2(c.y - q.y, (c.x - q.x) * fwd(q.side) + 0) - q.jh)) > cone) continue;
            const pri = (q.sortie.tgt !== null && c.gid === q.sortie.tgt ? -400 : 0) + d;
            if (pri < bd) { bd = pri; e = c; }
          }
        } else e = directTarget(q, w);
        if (!e) continue;
        shoot(q, w, e);
        w.rl = w.reload * (0.9 + 0.1 * q.n0 / Math.max(1, q.count));
      }
      if (q.pending && t - q.pending.at > 0 && !q.hq) {
        const n = q.pending.name;
        if (!q.w.some(w => D.AREA_KINDS[w.kind]) || !(n === 'fire' || n === 'shoot' || n === 'barrage')) { badOrder(q.side, `${q.type} has no ability "${String(n).slice(0, 20)}" (only artillery, rocket artillery and warships can "fire" at a point)`); q.pending = null; }
      }
    }
  }
  function usePower(g, pend) {
    const name = pend.name;
    if (!POWERS[name] || POWERS[name].level > L) { badOrder(g.side, `power "${String(name).slice(0, 20)}" is not available at level ${L}`); return; }
    if (g.pw[name] > 0) return;
    const P = POWERS[name];
    const spotOf = () => {
      if (!pend.tgt) return null;
      if (pend.tgt.gid !== undefined) { const e = units[pend.tgt.gid]; return e && present(e) ? { x: e.x, y: e.y } : null; }
      return { x: pend.tgt.x, y: pend.tgt.y };
    };
    if (name === 'rally') {
      let n = 0;
      for (const f of bySide[g.side]) {
        if (!alive(f) || f.hq || f.away || hyp(f.x - g.x, f.y - g.y) > P.radius) continue;
        f.morale = Math.min(100, f.morale + 30);
        if (f.routing && !f.broken) { f.routing = false; f.order = { kind: 'hold', x: f.x, y: f.y }; ev({ k: 'rally', s: f.side, a: f.gid }); tellBoth('rally', f); f.st.rallies++; }
        n++;
      }
      ev({ k: 'power', s: g.side, a: g.gid, p: 'rally', x: Math.round(g.x), y: Math.round(g.y), r: P.radius, n });
    } else {
      const spot = spotOf();
      if (!spot) { badOrder(g.side, `${name} needs a target: an enemy id or a point {x, y}`); return; }
      if (P.range && hyp(spot.x - g.x, spot.y - g.y) > P.range) { badOrder(g.side, `${name}: target further than ${P.range} from the command post`); return; }
      if (name === 'smoke') {
        smokes.push({ x: spot.x, y: spot.y, r: P.radius, until: t + 1 + P.time, side: g.side });
        ev({ k: 'power', s: g.side, a: g.gid, p: 'smoke', x: Math.round(spot.x), y: Math.round(spot.y), r: P.radius, ft: 1 });
      } else if (name === 'barrage') {
        for (let i = 0; i < P.shells; i++) {
          const a = i * 2.39996, rr = P.radius * Math.sqrt((i + 0.5) / P.shells);
          delayed.push({ t: t + P.delay + i * 0.5, kind: 'shell', side: g.side, from: g.gid, x: spot.x + Math.cos(a) * rr * fwd(g.side), y: spot.y + Math.sin(a) * rr, radius: P.blast, dmg: P.dmg, ff: true, power: true });
        }
        ev({ k: 'power', s: g.side, a: g.gid, p: 'barrage', x: Math.round(spot.x), y: Math.round(spot.y), r: P.radius, ft: P.delay });
      } else if (name === 'airstrike' || name === 'carpet') {
        const dir = fwd(g.side);
        for (let i = 0; i < P.bombs; i++) {
          const off = -P.length / 2 + P.length * (i + 0.5) / P.bombs;
          delayed.push({ t: t + P.delay + i * (name === 'carpet' ? 0.12 : 0.18), kind: 'bomb', side: g.side, from: g.gid, x: spot.x + dir * off, y: spot.y + (i % 2 ? 14 : -14), radius: P.blast, dmg: P.dmg, ff: true, power: true });
        }
        ev({ k: 'power', s: g.side, a: g.gid, p: name, x: Math.round(spot.x), y: Math.round(spot.y), r: Math.round(P.length / 2), ft: P.delay });
      } else if (name === 'cruise') {
        delayed.push({ t: t + P.delay, kind: 'bomb', side: g.side, from: g.gid, x: spot.x, y: spot.y, radius: P.radius, dmg: P.dmg, ff: true, power: true, cruise: true });
        ev({ k: 'power', s: g.side, a: g.gid, p: 'cruise', x: Math.round(spot.x), y: Math.round(spot.y), r: P.radius, ft: P.delay });
      } else if (name === 'emp') {
        let n = 0;
        for (const u of units) {
          if (!present(u) || isInf(u) || hyp(u.x - spot.x, u.y - spot.y) > P.radius + u.r) continue;
          u.emp = P.time; n++;
        }
        ev({ k: 'power', s: g.side, a: g.gid, p: 'emp', x: Math.round(spot.x), y: Math.round(spot.y), r: P.radius, n });
      }
    }
    g.pw[name] = P.cd;
    g.st.casts++;
    tellBoth('power', g, null, { power: name });
  }
  function areaImpact(p) {
    let kills = 0;
    const src = units[p.from];
    for (const s of units) {
      if (!present(s) || s.U.fly) continue;
      if (s.side === p.side && !p.ff) continue;
      if (!D.canHit(p.kind, s.U.cls)) continue;
      const d = hyp(s.x - p.x, s.y - p.y);
      if (d >= p.radius + s.r) continue;
      const f = p.radius >= s.r && d <= p.radius - s.r ? 1 : clamp((p.radius + s.r - d) / (2 * Math.min(s.r, p.radius)), 0, 1) * Math.min(1, (p.radius * p.radius) / (s.r * s.r));
      const caught = s.count * f;
      let dmg = caught * p.dmg * D.vs(p.kind, s.U.cls) * (1 - s.armor * ARMOR_EFFECT[p.kind]) * coverMult(s, true);
      if (s.count <= 3 && !isInf(s)) dmg *= 1.6;   // a direct hit on a vehicle or ship does real harm
      dmg = Math.min(dmg, caught * s.hpPer);
      if (dmg <= 0) continue;
      hurt(s, dmg, src, p.power ? 'power' : p.kind === 'bomb' ? 'bombsDmg' : src && src.U.naval ? 'naval' : 'artillery');
      if (!s.U.fearless) s.shock += grid(Math.min(18, 3 + 14 * dmg / s.maxHp));
      kills += dmg / s.hpPer;
    }
    return kills;
  }
  function projectilePhase() {
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const p = projectiles[i];
      if (p.t > t + 1e-9) continue;
      projectiles.splice(i, 1);
      const src = units[p.from];
      const b = units[p.to];
      if (!present(b)) continue;
      const got = p.dmg * coverMult(b, false);
      hurt(b, got, src, CAT[p.kind]);
      src.st.hits += p.hits;
      if (!b.U.fearless) b.shock += grid(Math.min(8, p.hits * p.supp * (isInf(b) ? 1 : 0.4) + 10 * got / b.maxHp));
    }
    for (let i = delayed.length - 1; i >= 0; i--) {
      const dl = delayed[i];
      if (dl.t > t + 1e-9) continue;
      delayed.splice(i, 1);
      const k = areaImpact(dl);
      ev({ k: 'boom', s: dl.side, a: dl.from, x: Math.round(dl.x), y: Math.round(dl.y), r: dl.radius, w: dl.cruise ? 'cruise' : dl.salvo ? 'salvo' : dl.kind, n: Math.round(k * 10) / 10 });
    }
  }
  function regenPhase() {
    for (const q of units) {
      if (!alive(q) || !q.U.regen) continue;
      if (t - q.lastHurt < 3) continue;
      q.hp = Math.min(q.maxHp, q.hp + q.U.regen * DT);
    }
  }
  function applyDamage() {
    const out = [];
    for (const q of units) {
      if (!alive(q)) { q.dmgIn = 0; q.hurtBy.length = 0; continue; }
      q.takenTick = q.dmgIn;
      if (q.dmgIn > 0) {
        const dmg = Math.min(q.dmgIn, q.hp);
        const before = q.count;
        q.hp -= dmg;
        q.st.taken += dmg;
        q.lastHurt = t;
        const after = q.hp <= 1e-6 ? 0 : Math.ceil(q.hp / q.hpPer - 1e-9);
        const lost = before - after;
        if (lost > 0 && q.hurtBy.length) {
          let tot = 0;
          for (let i = 1; i < q.hurtBy.length; i += 2) tot += q.hurtBy[i];
          for (let i = 0; i < q.hurtBy.length; i += 2) units[q.hurtBy[i]].st.kills += lost * q.hurtBy[i + 1] / tot;
        }
        for (let i = 0; i < q.hurtBy.length; i += 2) units[q.hurtBy[i]].st.dealt += q.hurtBy[i + 1] * dmg / q.dmgIn;
        q.count = after;
        if (lost > 0) {
          q.st.lost += lost;
          if (!isInf(q)) ev({ k: 'kill', s: q.side, a: q.gid, n: lost, x: Math.round(q.x), y: Math.round(q.y) });
        }
        if (!q.U.fearless) q.morale -= (dmg / q.maxHp) * 100 * 0.7 * moraleResist(q);
        if (q.count <= 0) {
          q.dead = true; q.count = 0; q.hp = 0; q.endT = t;
          ev({ k: q.hq ? 'hq' : 'destroyed', s: q.side, a: q.gid, x: Math.round(q.x), y: Math.round(q.y) });
          tellBoth(q.hq ? 'hqDestroyed' : 'destroyed', q);
          out.push({ q, kind: 'destroyed' });
        }
      }
      q.dmgIn = 0; q.hurtBy.length = 0;
    }
    return out;
  }
  function moraleResist(q) {
    let k = q.U.legendary ? 0.6 : isInf(q) ? 1 : 0.8;
    const g = hqs[q.side];
    if (alive(g) && hyp(g.x - q.x, g.y - q.y) <= HQ.aura.radius) k *= HQ.aura.resist;
    if (q.radio) k *= 0.85;
    else for (const f of bySide[q.side]) if (f.radio && alive(f) && f !== q && hyp(f.x - q.x, f.y - q.y) <= 200) { k *= 0.85; break; }
    return k;
  }
  function moralePhase(prevEvents) {
    const valueNow = [armyValue(0), armyValue(1)];
    const lostFrac = [0, 1].map(s => 1 - valueNow[s] / (valueStart[s] || 1));
    const newRouts = [];
    for (const q of units) {
      if (!alive(q) || q.U.fearless || q.away || q.U.jet) { if (alive(q)) q.shock = 0; continue; }
      const res = moraleResist(q);
      let dm = -q.shock * res;
      q.shock = 0;
      const engaged = q.contacts.length > 0;
      if (engaged && !q.routing) {
        const fighting = q.contacts.filter(e => !e.routing).length;
        let pressure = fighting >= 2 ? 1.5 * (fighting - 1) : 0;
        if (q.takenTick > q.dealtTick * 1.3 && q.takenTick > 0) pressure += 1;
        else if (q.dealtTick > q.takenTick * 1.3) dm += 0.6 * DT;
        dm -= pressure * DT * res;
      }
      if (lostFrac[q.side] >= 0.7) dm -= 1.2 * DT * res; else if (lostFrac[q.side] >= 0.5) dm -= 0.4 * DT * res;
      const g = hqs[q.side];
      const nearG = alive(g) && hyp(g.x - q.x, g.y - q.y) <= HQ.aura.radius;
      if (q.routing) {
        const near = bySide[1 - q.side].some(e => present(e) && !e.routing && !e.U.jet && hyp(e.x - q.x, e.y - q.y) < 200 + e.r + q.r);
        if (!near && !q.broken) dm += (4 + (nearG ? 6 : 0)) * DT;
      } else {
        if (!engaged && t - q.lastHurt > 2.5 && q.morale < q.moraleBase) dm += 3 * DT;
        if (nearG) dm += (engaged ? 1 : HQ.aura.regen) * DT;
      }
      q.morale = clamp(q.morale + dm, 0, 100);
      if (!q.routing && !q.hq && q.morale < ROUT_AT && !decided) newRouts.push(q);
      else if (q.routing && !q.broken && q.morale >= RALLY_AT) {
        q.routing = false; q.order = { kind: 'hold', x: q.x, y: q.y }; q.st.rallies++;
        ev({ k: 'rally', s: q.side, a: q.gid });
        tellBoth('rally', q);
      }
      if (!q.routing && q.morale > q.moraleBase && !nearG) q.morale = Math.max(q.moraleBase, q.morale - 0.5 * DT);
    }
    for (const q of newRouts) {
      q.routing = true; q.routs++; q.st.routs++;
      if (q.routs >= 3) q.broken = true;
      q.pending = null;
      ev({ k: 'rout', s: q.side, a: q.gid, br: q.broken ? 1 : 0 });
      tellBoth('retreat', q);
      prevEvents.push({ q, kind: 'rout' });
    }
    for (const { q, kind } of prevEvents) {
      for (const f of bySide[q.side]) {
        if (f === q || !alive(f) || f.U.fearless || f.U.jet) continue;
        if (hyp(f.x - q.x, f.y - q.y) < 280) f.shock += kind === 'destroyed' ? 7 : 5;
      }
      if (q.hq) for (const f of bySide[q.side]) if (alive(f) && !f.U.fearless) f.shock += 40;
    }
  }
  function checkVictory() {
    if (decided) return;
    const hqDead = [!alive(hqs[0]), !alive(hqs[1])];
    let winner, method;
    if (hqDead[0] || hqDead[1]) {
      method = 'HQ';
      winner = hqDead[0] && hqDead[1] ? compareValue() : hqDead[0] ? 1 : 0;
    } else {
      const broken = [0, 1].map(s => bySide[s].every(q => q.hq || !alive(q) || q.routing || q.U.jet));
      const gone = [0, 1].map(s => bySide[s].every(q => q.hq || !alive(q)));
      for (let s = 0; s < 2; s++) brokenSince[s] = broken[s] ? (brokenSince[s] === null ? t : brokenSince[s]) : null;
      const done = [0, 1].map(s => gone[s] || (brokenSince[s] !== null && t - brokenSince[s] >= 3));
      if (done[0] || done[1]) {
        const wiped = (s) => bySide[s].every(q => q.hq || q.dead);
        method = (done[0] && wiped(0)) || (done[1] && wiped(1)) ? 'ANNIHILATION' : 'ROUT';
        winner = done[0] && done[1] ? compareValue() : done[0] ? 1 : 0;
      } else if (t >= maxTime - 1e-9) {
        method = 'TIME';
        winner = compareValue();
      } else return;
    }
    decided = { winner, method, time: r2(t), value: [armyValue(0), armyValue(1)] };
    endAt = t + stopAfter;
    ev({ k: 'end', s: winner === null ? -1 : winner, method });
    if (winner !== null) {
      for (const q of bySide[1 - winner]) if (alive(q) && !q.hq && !q.routing && !q.U.jet) { q.routing = true; q.broken = true; ev({ k: 'rout', s: q.side, a: q.gid, br: 1, end: 1 }); }
      for (const q of bySide[winner]) if (alive(q)) { if (!q.U.jet) q.order = { kind: 'hold', x: q.x, y: q.y }; q.pending = null; }
    }
  }
  function compareValue() {
    const a = armyValue(0), b = armyValue(1);
    if (Math.abs(a - b) < 0.5) return null;
    return a > b ? 0 : 1;
  }
  function stateCode(q) {
    if (q.dead) return ST.dead;
    if (q.fled) return ST.fled;
    if (q.away) return ST.away;
    if (q.routing) return ST.routing;
    if (q.contacts.length) return ST.assault;
    if (q.fireTarget !== null) return ST.fighting;
    if (q.spd > 4) return ST.moving;
    return ST.idle;
  }
  function record() {
    for (const q of units) {
      const R = q.rec;
      R.x.push(Math.round(q.x)); R.y.push(Math.round(q.y));
      R.a.push(Math.round(((q.face * 180 / Math.PI) % 360 + 360) % 360));
      // m = morale (0-100); for the command post it is its HP %, for jets their ammo %
      const ammoPct = q.U.jet ? Math.round(100 * q.w.reduce((a, w) => a + (w.ammo ? w.ammoLeft / w.ammo : 0), 0) / Math.max(1, q.w.filter(w => w.ammo).length)) : 0;
      R.n.push(q.count); R.s.push(stateCode(q)); R.m.push(Math.round(q.hq ? 100 * q.hp / q.maxHp : q.U.jet ? ammoPct : q.morale));
      R.f.push(q.fireTarget === null ? -1 : q.fireTarget);
    }
    hud.push([Math.round(100 * armyValue(0) / (valueStart[0] || 1)), Math.round(moraleAvg(0)), Math.round(100 * armyValue(1) / (valueStart[1] || 1)), Math.round(moraleAvg(1))]);
  }

  // ── setup: settle deployments ────────────────────────────────────────────
  for (const q of units) {
    if (q.U.naval && !deepAt(q.x, q.y)) { const p = toWater(q, q.x, q.y); q.x = p.x; q.y = p.y; }
    q.inTown = !q.U.fly && inCircles(towns, q.x, q.y);
    q.inForest = !q.U.fly && inCircles(forests, q.x, q.y);
  }
  for (let it = 0; it < 12; it++) move(units.map(q => (q.U.jet ? null : { dx: 0, dy: 0, speed: 0, face: null })));
  for (const q of units) { q.vx = 0; q.vy = 0; q.spd = 0; q.still = 0; q.dug = false; }
  ev({ k: 'start', s: -1 });

  // ── main loop ────────────────────────────────────────────────────────────
  const maxTicks = Math.round((maxTime + stopAfter + 1) / DT);
  updateVisibility();
  record();
  for (tick = 1; tick <= maxTicks; tick++) {
    t = tick * DT;
    updateVisibility();
    if ((tick - 1) % D.THINK_EVERY === 0 && !decided) {
      const states = [buildState(0), buildState(1)];
      for (let v = 0; v < 2; v++) {
        const c = commanders[v];
        if (!c || !c.ok) continue;
        const out = c.think(states[v], r2(t));
        applyCommand(v, out);
      }
    }
    rearmPhase();
    const plans = units.map(q => (alive(q) ? plan(q) : null));
    move(plans);
    contactsPhase();
    for (const q of units) q.dealtTick = 0;
    assaultPhase();
    weaponsPhase();
    projectilePhase();
    const deaths = applyDamage();
    regenPhase();
    for (const q of units) if (alive(q)) q.r = radiusOf(q);
    moralePhase(deaths);
    checkVictory();
    if (tick % REC === 0) record();
    if (endAt !== null && t >= endAt - 1e-9) break;
  }
  const duration = r2((hud.length - 1) * DT * REC);

  // ── stats ────────────────────────────────────────────────────────────────
  const stats = [0, 1].map(s => {
    const own = bySide[s].filter(q => !q.hq);
    const sum = (f) => own.reduce((a, q) => a + f(q), 0);
    const g = hqs[s];
    const lostOf = (pred) => own.filter(pred).reduce((a, q) => a + q.st.lost, 0);
    const enemy = bySide[1 - s].filter(q => !q.hq);
    const eLost = (pred) => enemy.filter(pred).reduce((a, q) => a + q.st.lost, 0);
    return {
      // value when the battle was decided (not after the beaten army has fled the field)
      valueStart: Math.round(valueStart[s]), valueLeft: Math.round(decided ? decided.value[s] : armyValue(s)), valuePct: Math.round(100 * (decided ? decided.value[s] : armyValue(s)) / (valueStart[s] || 1)),
      units: own.length, unitsLeft: own.filter(q => alive(q) && !q.routing).length, unitsDestroyed: own.filter(q => q.dead).length, unitsFled: own.filter(q => q.fled).length,
      soldiersLost: lostOf(q => isInf(q)), vehiclesLost: lostOf(q => q.U.domain === 'ground' && !isInf(q)), aircraftLost: lostOf(q => q.U.fly), shipsLost: lostOf(q => q.U.naval),
      enemySoldiersKilled: eLost(q => isInf(q)), enemyVehiclesKilled: eLost(q => q.U.domain === 'ground' && !isInf(q)), enemyAircraftDowned: eLost(q => q.U.fly), enemyShipsSunk: eLost(q => q.U.naval),
      routs: sum(q => q.st.routs), rallies: sum(q => q.st.rallies),
      shotsFired: Math.round(sum(q => q.st.shots) + g.st.shots), hits: Math.round(sum(q => q.st.hits) + g.st.hits),
      shells: sum(q => q.st.shells), bombs: sum(q => q.st.bombs), missiles: sum(q => q.st.missiles), torpedoes: sum(q => q.st.torpedoes), sorties: sum(q => q.st.sorties),
      dmgSmallArms: Math.round(sum(q => q.st.small) + g.st.small), dmgCannon: Math.round(sum(q => q.st.cannon)), dmgAntiTank: Math.round(sum(q => q.st.antitank)), dmgAntiAir: Math.round(sum(q => q.st.antiair)),
      dmgArtillery: Math.round(sum(q => q.st.artillery)), dmgBombs: Math.round(sum(q => q.st.bombsDmg)), dmgNaval: Math.round(sum(q => q.st.naval)), dmgAssault: Math.round(sum(q => q.st.assault)), dmgPowers: Math.round(g.st.power),
      dmgDealt: Math.round(sum(q => q.st.dealt) + g.st.dealt), dmgTaken: Math.round(sum(q => q.st.taken)),
      hqHpPct: Math.round(100 * g.hp / g.maxHp), hqAlive: alive(g) ? 1 : 0, powersUsed: g.st.casts,
      moraleEnd: Math.round(moraleAvg(s)), orders: orderStats[s].orders, badOrders: orderStats[s].bad,
    };
  });
  if (!decided) decided = { winner: compareValue(), method: 'TIME', time: r2(t) };
  return {
    map, duration, hud, events, stats, orderStats, decided, names: specs.map(s => s.name),
    units: units.map(q => ({
      gid: q.gid, side: q.side, k: q.k, type: q.type, name: q.name, hq: q.hq, n0: q.n0, cost: q.cost,
      upgrades: q.upgrades, legendary: !!q.U.legendary, fly: !!q.U.fly, jet: !!q.U.jet, naval: !!q.U.naval, endT: q.endT, dead: q.dead, fled: q.fled,
      rec: q.rec, st: q.st, count: q.count, hp: q.hp, maxHp: q.maxHp, routs: q.routs, form0: FORM_CODE[q.form] || 0,
    })),
  };
}

module.exports = { runBattle, ST, FORM_CODE, radiusOf };
