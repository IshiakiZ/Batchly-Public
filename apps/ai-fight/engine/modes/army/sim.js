'use strict';
// Army Battle — the deterministic battle simulation.
//
// Squads are the unit of simulation: a position, a facing, a formation, a pool of hit points
// (soldiers = ceil(hp / hp per soldier)) and a morale value. Every tick (0.1 s):
//   commanders (every 0.5 s) -> movement plan -> move + collide -> melee contacts -> charges ->
//   melee -> missiles / spells / powers -> damage -> healing -> morale / routs -> victory.
// Everything that could depend on processing order is computed from the state at the start of
// the phase and applied afterwards, so a mirrored battle is an exact draw.

const D = require('./data');
const { UNITS, GENERAL, POWERS, FORMATIONS, FIELD } = D;
const DT = D.TICK;
const TAU = Math.PI * 2;

const hyp = (x, y) => Math.sqrt(x * x + y * y);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
function angNorm(a) { a %= TAU; if (a > Math.PI) a -= TAU; else if (a < -Math.PI) a += TAU; return a; }
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;

const ST = { idle: 0, moving: 1, fighting: 2, charging: 4, routing: 5, dead: 6, fled: 7 };
const FORM_CODE = { line: 0, wedge: 1, square: 2, loose: 3 };
const FLANK_MELEE = [1, 1.4, 1.8];
const FLANK_CHARGE = [0.7, 1.5, 2.0];
const ROUT_AT = 12, RALLY_AT = 45;

function radiusOf(q) {
  if (q.general) return 11;
  if (q.U.legendary && q.n0 === 1) return Math.round(q.U.spacing * 0.55);
  const spread = q.U.legendary ? 1.2 : FORMATIONS[q.form].spread;
  return Math.max(9, 0.56 * q.U.spacing * Math.sqrt(Math.max(1, q.count)) * spread);
}
function weightOf(q) { return Math.sqrt(q.hpPer / 10); } // area damage vs big bodies

function makeSquad(sd, side, k, isGen, gid) {
  const U = isGen ? GENERAL : UNITS[sd.type];
  const ups = isGen ? [] : (sd.upgrades || []).filter(u => D.UPGRADES[u]);
  const vet = ups.includes('veteran'), arm = ups.includes('armored'), ban = ups.includes('banner');
  const moraleBase = U.fearless ? 100 : Math.min(100, U.morale + (vet ? 10 : 0) + (ban ? 8 : 0));
  const q = {
    gid, side, k, general: isGen, type: isGen ? 'general' : sd.type, U, name: String(sd.name || U.name),
    x: side === 0 ? sd.x : -sd.x, y: sd.y, vx: 0, vy: 0, spd: 0, face: side === 0 ? 0 : Math.PI,
    n0: U.size, count: U.size, hpPer: U.hp, maxHp: U.size * U.hp, hp: U.size * U.hp,
    armor: Math.min(0.7, U.armor + (arm ? 0.12 : 0)), speed: U.speed * (arm ? 0.92 : 1), dmgMult: vet ? 1.25 : 1,
    vet, arm, banner: ban, upgrades: ups, cost: isGen ? 0 : D.squadCost(sd.type, ups),
    morale: moraleBase, moraleBase,
    form: isGen || U.legendary ? 'line' : (FORMATIONS[sd.formation] ? sd.formation : U.form), reformT: 0,
    order: { kind: 'auto' }, autocast: true, pending: null,
    reload: 0.8 + 0.35 * (k % 4), cd: 1.5 + 0.5 * (k % 3),
    pw: isGen ? { rally: 0, meteor: 0, aegis: 0, wrath: 0 } : null,
    routing: false, routs: 0, broken: false, dead: false, fled: false, endT: null,
    run: 0, contacts: [], prevContacts: new Set(), meleeTarget: null, fireTarget: null, autoTarget: null,
    lastHurt: -99, reveal: -99, aegis: 0, dmgIn: 0, hurtBy: [], shock: 0, wasEngaged: false, dealtTick: 0, takenTick: 0,
    r: 0, inWoods: false, inRiver: false, chargeFlag: false,
    st: { dealt: 0, taken: 0, kills: 0, charges: 0, chargeDmg: 0, bracedOn: 0, stopped: 0, volleys: 0, fired: 0, hits: 0, casts: 0, healed: 0, routs: 0, rallies: 0, melee: 0, ranged: 0, magic: 0, siege: 0, power: 0, lostFled: 0 },
    rec: { x: [], y: [], a: [], n: [], s: [], m: [] },
  };
  q.r = radiusOf(q);
  return q;
}

/**
 * Run one battle.
 * @param {object} o
 *   specs: [specA, specB] validated army specs (own-perspective coordinates)
 *   commanders: [cmdA, cmdB] from sandbox.createCommander (or null)
 *   level, round, maxTime
 * @returns {{ frames, squads, events, result, stats, hud, map, duration }}
 */
function runBattle({ specs, commanders, level = 1, round = 1, maxTime = D.BATTLE_TIME, stopAfter = 3 }) {
  const map = D.mapForRound(round || level);
  const rocks = map.rocks, woods = map.woods, river = map.river;
  const L = D.clampLevel(level);
  const squads = [];
  const bySide = [[], []];
  const generals = [null, null];
  for (let side = 0; side < 2; side++) {
    const spec = specs[side];
    spec.squads.forEach((sd, k) => { const q = makeSquad(sd, side, k, false, squads.length); squads.push(q); bySide[side].push(q); });
    const g = makeSquad({ name: spec.general.name, x: spec.general.x, y: spec.general.y }, side, 98, true, squads.length);
    squads.push(g); bySide[side].push(g); generals[side] = g;
  }
  const valueStart = [0, 1].map(s => bySide[s].reduce((a, q) => a + q.cost, 0));
  const events = [];
  const cmdEvents = [[], []];
  const projectiles = [];
  const delayed = []; // meteors, wrath bolts
  const pairClash = new Map();
  const sayT = [-99, -99];
  const orderStats = [{ orders: 0, bad: 0, badNotes: [] }, { orders: 0, bad: 0, badNotes: [] }];
  let t = 0, tick = 0;
  let decided = null; // { winner, method, time }
  let endAt = null;
  const brokenSince = [null, null];
  const hud = [];
  const REC = D.RECORD_EVERY;
  const alive = (q) => !q.dead && !q.fled;

  function ev(e) { e.t = r2(t); events.push(e); return e; }
  function cmdEv(side, e) { const l = cmdEvents[side]; if (l.length < 60) l.push(e); }
  function pid(q, viewer) { return (q.side === viewer ? 0 : 100) + (q.general ? 99 : q.k + 1); }
  function fromPid(viewer, id) {
    const n = Number(id);
    if (!Number.isFinite(n)) return null;
    const side = n >= 100 ? 1 - viewer : viewer;
    const local = n >= 100 ? n - 100 : n;
    if (local === 99) return generals[side];
    const list = bySide[side];
    const q = list[local - 1];
    return q && !q.general ? q : null;
  }
  function tellBoth(type, q, other, extra) {
    for (let v = 0; v < 2; v++) cmdEv(v, Object.assign({ t: r2(t), type, who: q.side === v ? 'me' : 'enemy', squad: pid(q, v), target: other ? pid(other, v) : undefined }, extra || {}));
  }

  // ── terrain ──────────────────────────────────────────────────────────────
  function inWoods(x, y) { for (const w of woods) if (hyp(x - w.x, y - w.y) < w.r) return true; return false; }
  function inRiver(x, y) {
    if (!river || x < river.x0 || x > river.x1) return false;
    for (const f of river.fords) if (y >= f.y0 && y <= f.y1) return false;
    return true;
  }
  function segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    let k = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    k = clamp(k, 0, 1);
    return hyp(px - (ax + k * dx), py - (ay + k * dy));
  }
  /** Next waypoint toward (tx, ty) around rocks and through fords (ground squads). */
  function waypoint(q, tx, ty) {
    if (q.U.fly) return { x: tx, y: ty };
    const R = Math.min(q.r, 40);
    if (river && !q.routing && ((q.x < river.x0 - 4 && tx > river.x0) || (q.x > river.x1 + 4 && tx < river.x1))) {
      const mid = (river.x0 + river.x1) / 2;
      const yCross = q.y + (ty - q.y) * (mid - q.x) / ((tx - q.x) || 1e-9);
      let inFord = false, best = null, bd = Infinity;
      for (const f of river.fords) {
        if (yCross >= f.y0 + 14 && yCross <= f.y1 - 14) inFord = true;
        const dd = Math.abs((f.y0 + f.y1) / 2 - yCross);
        if (dd < bd) { bd = dd; best = f; }
      }
      if (!inFord && best && bd < 330) {
        const fy = (best.y0 + best.y1) / 2;
        const fx = q.x < river.x0 ? river.x0 - R - 12 : river.x1 + R + 12;
        if (hyp(q.x - fx, q.y - fy) > 30 && Math.abs(q.y - fy) > 12) { tx = fx; ty = fy; }
        else { tx = q.x < river.x0 ? river.x1 + R + 30 : river.x0 - R - 30; ty = fy; }
      }
    }
    let best = null, bd = Infinity;
    for (const o of rocks) {
      if (segDist(o.x, o.y, q.x, q.y, tx, ty) >= o.r + R * 0.8) continue;
      const d = hyp(o.x - q.x, o.y - q.y);
      if (d < bd) { bd = d; best = o; }
    }
    if (!best) return { x: tx, y: ty };
    let dx = tx - q.x, dy = ty - q.y;
    const l = hyp(dx, dy) || 1; dx /= l; dy /= l;
    const c = best.r + R + 16;
    const c1 = { x: best.x - dy * c, y: best.y + dx * c }, c2 = { x: best.x + dy * c, y: best.y - dx * c };
    const l1 = hyp(c1.x - q.x, c1.y - q.y) + hyp(tx - c1.x, ty - c1.y);
    const l2 = hyp(c2.x - q.x, c2.y - q.y) + hyp(tx - c2.x, ty - c2.y);
    const pick = Math.abs(l1 - l2) < 1 ? (c1.y <= c2.y ? c1 : c2) : l1 < l2 ? c1 : c2;
    return (pick.x < FIELD.minX + 10 || pick.x > FIELD.maxX - 10 || pick.y < FIELD.minY + 10 || pick.y > FIELD.maxY - 10) ? (pick === c1 ? c2 : c1) : pick;
  }

  // ── derived numbers ──────────────────────────────────────────────────────
  function terrainSpeed(q) {
    if (q.U.fly) return 1;
    let k = 1;
    if (q.inWoods) k *= q.U.mounted ? 0.5 : (q.U.cls === 'beast' || q.U.legendary) ? 0.85 : 0.65;
    if (q.inRiver) k *= q.U.legendary ? 0.7 : 0.4;
    return k;
  }
  function maxSpeed(q) {
    let s = q.speed * terrainSpeed(q) * (q.general || q.U.legendary ? 1 : FORMATIONS[q.form].speed);
    if (q.reformT > 0) s *= 0.7;
    if (q.routing) s *= 1.1;
    return s;
  }
  function rangeOf(q) {
    const U = q.U;
    if (U.ranged) return U.ranged.range;
    if (U.spell) return U.spell.range;
    if (U.siege) return U.siege.range;
    if (U.breath) return U.breath.range;
    return 0;
  }
  function minRangeOf(q) { return q.U.ranged ? q.U.ranged.min : q.U.siege ? q.U.siege.min : 0; }
  const isShooter = (q) => !!(q.U.ranged || q.U.siege || q.U.spell);
  function counterMult(a, d) { return D.bonus(a.U.cls, d.U.cls); }
  function armorOf(def, kind) {
    if (kind === 'magic' || kind === 'holy' || kind === 'divine') return 0;
    if (kind === 'fire' || kind === 'stone' || kind === 'crush') return def.armor * 0.5;
    return def.armor;
  }
  function flankOf(def, att) {
    if ((def.form === 'square' && !def.general && !def.U.legendary) || def.U.legendary) return 0;
    const a = Math.abs(angNorm(Math.atan2(att.y - def.y, att.x - def.x) - def.face));
    return a < Math.PI / 3 ? 0 : a < 2 * Math.PI / 3 ? 1 : 2;
  }
  const capacity = (def) => Math.max(2, TAU * def.r / 11);
  function fightersVs(att, def) {
    if (att.n0 <= 4) return att.count;
    const f = FORMATIONS[att.form];
    return Math.min(att.count * f.front, capacity(def));
  }
  const isLooseDef = (q) => q.form === 'loose' && !q.general && !q.U.legendary;
  function hurt(def, amount, src, kind) {
    if (!(amount > 0) || !alive(def)) return;
    if (def.aegis > 0) amount *= 0.5;
    def.dmgIn += amount;
    if (src) {
      def.hurtBy.push(src.gid, amount);
      src.dealtTick += amount;
      src.st[kind === 'arrow' || kind === 'holy' ? 'ranged' : kind === 'fire' || kind === 'magic' ? 'magic' : kind === 'stone' ? 'siege' : kind === 'divine' ? 'power' : 'melee'] += amount;
    }
  }

  // ── visibility ───────────────────────────────────────────────────────────
  const visible = [new Set(), new Set()];
  function updateVisibility() {
    for (let v = 0; v < 2; v++) {
      const set = visible[v];
      set.clear();
      for (const e of bySide[1 - v]) {
        if (!alive(e)) continue;
        if (!e.inWoods || e.U.fly || t - e.reveal < 2 || e.contacts.length) { set.add(e.gid); continue; }
        for (const f of bySide[v]) if (alive(f) && hyp(f.x - e.x, f.y - e.y) < 170 + f.r + e.r) { set.add(e.gid); break; }
      }
    }
  }

  // ── commander I/O ────────────────────────────────────────────────────────
  function abilityInfo(q) {
    const U = q.U;
    if (U.spell) return { name: U.spell.name, ready: q.cd <= 0, cooldownLeft: r1(Math.max(0, q.cd)), range: U.spell.range, radius: U.spell.radius };
    if (U.breath) return { name: 'breath', ready: q.cd <= 0, cooldownLeft: r1(Math.max(0, q.cd)), range: U.breath.range, radius: U.breath.radius };
    if (U.stomp) return { name: 'stomp', ready: q.cd <= 0, cooldownLeft: r1(Math.max(0, q.cd)), range: U.stomp.radius, radius: U.stomp.radius };
    if (U.siege) return { name: 'fire', ready: q.reload <= 0, cooldownLeft: r1(Math.max(0, q.reload)), range: U.siege.range, radius: U.siege.radius };
    return null;
  }
  function stateName(q) {
    if (q.dead) return 'dead';
    if (q.fled) return 'fled';
    if (q.routing) return 'routing';
    if (q.contacts.length) return 'fighting';
    if (q.chargeFlag) return 'charging';
    if (q.spd > 4) return 'moving';
    return 'idle';
  }
  function publicSquad(q, v) {
    const m = v === 0 ? 1 : -1;
    const o = {
      id: pid(q, v), type: q.type, name: q.name, x: r1(q.x * m), y: r1(q.y), vx: r1(q.vx * m), vy: r1(q.vy),
      facing: Math.round((v === 0 ? q.face : angNorm(Math.PI - q.face)) * 1000) / 1000,
      radius: r1(q.r), count: q.count, maxCount: q.n0, hp: r1(q.hp), maxHp: q.maxHp, morale: Math.round(q.morale),
      state: stateName(q), formation: q.form, routing: q.routing, broken: q.broken,
      engaged: q.contacts.map(c => pid(c, v)), speed: r1(maxSpeed(q)), range: rangeOf(q), minRange: minRangeOf(q),
      reload: q.U.ranged || q.U.siege ? r1(Math.max(0, q.reload)) : 0, ability: abilityInfo(q),
      chargeReady: q.U.charge > 0 && q.run >= 50, inWoods: q.inWoods, inRiver: q.inRiver, flying: !!q.U.fly,
      general: q.general, legendary: !!q.U.legendary, value: Math.round(q.cost * q.hp / q.maxHp), cost: q.cost,
      armor: r2(q.armor), upgrades: q.upgrades.slice(),
    };
    if (q.side === v) {
      const od = q.order;
      o.order = od.kind;
      if (od.kind === 'attack' || od.kind === 'charge') o.orderTarget = pid(squads[od.target], v);
      if (od.x !== undefined) o.orderPoint = { x: r1(od.x * m), y: r1(od.y) };
      o.target = q.meleeTarget !== null ? pid(squads[q.meleeTarget], v) : q.fireTarget !== null ? pid(squads[q.fireTarget], v) : null;
      o.autocast = q.autocast;
    }
    return o;
  }
  function armyValue(side) {
    let v = 0;
    for (const q of bySide[side]) if (!q.general && alive(q)) v += q.cost * q.hp / q.maxHp * (q.routing ? 0.5 : 1);
    return v;
  }
  function moraleAvg(side) {
    let s = 0, n = 0;
    for (const q of bySide[side]) if (!q.general && alive(q)) { s += q.routing ? 0 : q.morale; n++; }
    return n ? s / n : 0;
  }
  function buildState(v) {
    const own = bySide[v].filter(alive).map(q => publicSquad(q, v));
    const enemies = bySide[1 - v].filter(q => alive(q) && visible[v].has(q.gid)).map(q => publicSquad(q, v));
    const g = generals[v];
    const powers = D.powersAt(L).map(name => ({ name, ready: g.pw[name] <= 0 && alive(g), cooldownLeft: r1(Math.max(0, g.pw[name])), range: POWERS[name].range || POWERS[name].radius || 0 }));
    const evs = cmdEvents[v].splice(0);
    return {
      time: r2(t), timeLeft: r2(Math.max(0, maxTime - t)), tick, level: L, round,
      field: { width: FIELD.width, height: FIELD.height, minX: FIELD.minX, maxX: FIELD.maxX, minY: FIELD.minY, maxY: FIELD.maxY, deploy: Object.assign({}, D.DEPLOY) },
      terrain: { map: map.id, name: map.name, rocks, woods, river },
      me: { name: specs[v].name, general: 99, strength: Math.round(100 * armyValue(v) / (valueStart[v] || 1)), morale: Math.round(moraleAvg(v)), squads: own.length },
      enemy: { name: specs[1 - v].name, general: 199, seen: enemies.length, strength: Math.round(100 * armyValue(1 - v) / (valueStart[1 - v] || 1)) },
      squads: own, enemies, powers, events: evs,
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
    if (!e || e.side === v || !alive(e)) return null;
    if (!visible[v].has(e.gid)) return null;
    return e;
  }
  function setOrder(v, q, o) {
    if (typeof o === 'string') o = o === 'hold' ? { hold: true } : o === 'retreat' ? { retreat: true } : o === 'auto' || o === 'advance' ? { auto: true } : FORMATIONS[o] ? { formation: o } : {};
    if (!o || typeof o !== 'object') { badOrder(v, 'an order must be an object like { move: {x, y} }'); return; }
    orderStats[v].orders++;
    if (o.formation !== undefined) {
      if (!FORMATIONS[o.formation]) badOrder(v, `unknown formation "${String(o.formation).slice(0, 20)}" (line, wedge, square, loose)`);
      else if (!q.general && !q.U.legendary && q.form !== o.formation) {
        q.form = o.formation; q.reformT = 1.5; q.r = radiusOf(q);
        ev({ k: 'form', a: q.gid, f: FORM_CODE[q.form] });
      }
    }
    if (o.autocast !== undefined) q.autocast = !!o.autocast;
    if (q.routing) return; // routing squads ignore movement orders
    if (o.charge !== undefined) {
      const e = resolveTarget(v, o.charge);
      if (!e) badOrder(v, `charge: enemy ${JSON.stringify(o.charge)} not found or not visible`);
      else q.order = { kind: q.U.charge > 0 ? 'charge' : 'attack', target: e.gid };
    } else if (o.attack !== undefined) {
      const e = resolveTarget(v, o.attack);
      if (!e) badOrder(v, `attack: enemy ${JSON.stringify(o.attack)} not found or not visible`);
      else q.order = { kind: 'attack', target: e.gid };
    } else if (o.move !== undefined) {
      const p = worldPoint(v, o.move);
      if (!p) badOrder(v, 'move needs a point {x, y}');
      else q.order = { kind: 'move', x: p.x, y: p.y };
    } else if (o.retreat !== undefined && o.retreat !== false) {
      const p = worldPoint(v, typeof o.retreat === 'object' ? o.retreat : null) || { x: v === 0 ? FIELD.minX + 60 : FIELD.maxX - 60, y: q.y };
      q.order = { kind: 'retreat', x: p.x, y: p.y };
    } else if (o.hold !== undefined && o.hold !== false) {
      const p = worldPoint(v, typeof o.hold === 'object' ? o.hold : null) || { x: q.x, y: q.y };
      q.order = { kind: 'hold', x: p.x, y: p.y };
    } else if (o.auto) q.order = { kind: 'auto' };
    if (o.target !== undefined && o.ability === undefined) {
      const e = resolveTarget(v, o.target);
      if (e) q.order.focus = e.gid; else badOrder(v, `target: enemy ${JSON.stringify(o.target)} not found or not visible`);
    }
    if (o.ability !== undefined) {
      const name = String(o.ability);
      let tgt = null;
      if (o.target !== undefined) {
        if (typeof o.target === 'object' && o.target && o.target.id === undefined) tgt = worldPoint(v, o.target);
        else { const e = resolveTarget(v, o.target); if (e) tgt = { gid: e.gid }; }
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
          if (!Number.isFinite(id)) { badOrder(v, `"${key.slice(0, 20)}" is not a squad id`); continue; }
          const o = src[key];
          list.push(typeof o === 'string' ? { id, _s: o } : Object.assign({ id }, o));
        }
      }
    } else { badOrder(v, 'command() must return an object or an array'); return; }
    for (const item of list.slice(0, 64)) {
      if (!item || typeof item !== 'object') { badOrder(v, 'each order must be an object with an id'); continue; }
      const q = fromPid(v, item.id);
      if (!q || q.side !== v) { badOrder(v, `no squad of yours has id ${JSON.stringify(item.id)}`); continue; }
      if (!alive(q)) continue;
      setOrder(v, q, item._s !== undefined ? item._s : item);
    }
    if (say && t - sayT[v] >= 3) {
      sayT[v] = t;
      ev({ k: 'say', s: v, text: say.replace(/\s+/g, ' ').slice(0, 60) });
    }
  }

  // ── movement ─────────────────────────────────────────────────────────────
  const backX = (side) => side === 0 ? -1 : 1;
  function visibleEnemies(q) {
    const out = [];
    for (const e of bySide[1 - q.side]) if (alive(e) && visible[q.side].has(e.gid)) out.push(e);
    return out;
  }
  function nearestOf(q, list, pref) {
    let best = null, bd = Infinity;
    for (const e of list) {
      let d = hyp(e.x - q.x, e.y - q.y);
      if (e.routing) d += 400;
      if (pref) d = pref(e, d);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }
  /** Where a squad without orders goes, and whom it aims at. */
  function autoPlan(q) {
    const foes = visibleEnemies(q);
    const bx = backX(q.side);
    if (q.general) {
      const friends = bySide[q.side].filter(f => !f.general && alive(f) && !f.routing);
      const threat = nearestOf(q, foes);
      if (threat && hyp(threat.x - q.x, threat.y - q.y) < 170 + threat.r) return { x: q.x + (q.x - threat.x), y: q.y + (q.y - threat.y), target: null };
      if (!friends.length) return { x: q.x, y: q.y, target: null };
      let cx = 0, cy = 0, w = 0;
      for (const f of friends) { cx += f.x * f.count; cy += f.y * f.count; w += f.count; }
      return { x: cx / w + bx * 170, y: cy / w, target: null };
    }
    if (q.U.heal && !q.U.ranged) {
      let best = null, bd = 0;
      for (const f of bySide[q.side]) {
        if (!alive(f) || f === q || f.general) continue;
        const miss = f.maxHp - f.hp;
        if (miss > bd && hyp(f.x - q.x, f.y - q.y) < 700) { bd = miss; best = f; }
      }
      if (best) return { x: best.x + bx * (best.r + 45), y: best.y, target: null };
      const friends = bySide[q.side].filter(f => !f.general && alive(f) && f !== q);
      if (!friends.length) return { x: q.x, y: q.y, target: null };
      let cx = 0, cy = 0;
      for (const f of friends) { cx += f.x; cy += f.y; }
      return { x: cx / friends.length + bx * 90, y: cy / friends.length, target: null };
    }
    const shooter = isShooter(q);
    let target;
    if (q.U.cls === 'cav' || q.U.cls === 'flyer') target = nearestOf(q, foes, (e, d) => (e.U.cls === 'ranged' || e.U.cls === 'magic' || e.U.cls === 'siege') ? d - 150 : e.U.brace ? d + 150 : d);
    else target = nearestOf(q, foes);
    if (!target) {
      const adv = q.x - bx * 200;
      const lim = shooter ? 0 : FIELD.maxX;
      return { x: q.side === 0 ? Math.min(adv, lim) : Math.max(adv, -lim), y: q.y, target: null };
    }
    if (shooter) {
      const d = hyp(target.x - q.x, target.y - q.y);
      const rng = rangeOf(q);
      if (d <= rng * 0.92) return { x: q.x, y: q.y, target: target.gid, stay: true };
      return { x: target.x, y: target.y, target: target.gid };
    }
    return { x: target.x + target.vx * 0.3, y: target.y + target.vy * 0.3, target: target.gid };
  }
  function plan(q) {
    q.chargeFlag = false;
    q.fireTarget = null;
    if (q.routing) {
      // run for the home edge, away from the nearest enemy
      let ax = 0, ay = 0;
      for (const e of bySide[1 - q.side]) {
        if (!alive(e)) continue;
        const dx = q.x - e.x, dy = q.y - e.y, d = hyp(dx, dy);
        if (d < 220 && d > 1) { ax += dx / d * (220 - d) / 220; ay += dy / d * (220 - d) / 220; }
      }
      const home = q.side === 0 ? FIELD.minX - 40 : FIELD.maxX + 40;
      let dx = home - q.x, dy = ay * 200;
      const l = hyp(dx, dy) || 1;
      dx = dx / l + ax * 0.6; dy = dy / l + ay * 0.6;
      return { dx, dy, speed: maxSpeed(q), face: null };
    }
    if (q.contacts.length && q.order.kind !== 'retreat') return { dx: 0, dy: 0, speed: 0, face: null };
    const od = q.order;
    let gx = q.x, gy = q.y, target = null, stay = false, speedMul = 1;
    if (od.kind === 'attack' || od.kind === 'charge') {
      const e = squads[od.target];
      if (!e || !alive(e) || (!visible[q.side].has(e.gid))) { q.order = { kind: 'auto' }; return plan(q); }
      target = e.gid;
      if (isShooter(q)) {
        const d = hyp(e.x - q.x, e.y - q.y);
        if (d <= rangeOf(q) * 0.92) stay = true; else { gx = e.x; gy = e.y; }
      } else {
        const lead = od.kind === 'charge' ? 0.4 : 0.3;
        gx = e.x + e.vx * lead; gy = e.y + e.vy * lead;
        if (od.kind === 'charge' && hyp(e.x - q.x, e.y - q.y) < 260) { speedMul = 1.2; q.chargeFlag = true; }
      }
    } else if (od.kind === 'move' || od.kind === 'retreat') {
      gx = od.x; gy = od.y;
      if (hyp(gx - q.x, gy - q.y) < 6) { q.order = { kind: 'hold', x: od.x, y: od.y }; stay = true; }
      target = od.focus !== undefined ? od.focus : null;
    } else if (od.kind === 'hold') {
      gx = od.x; gy = od.y;
      if (hyp(gx - q.x, gy - q.y) < 12) stay = true;
      target = od.focus !== undefined ? od.focus : null;
    } else {
      const p = autoPlan(q);
      gx = p.x; gy = p.y; target = p.target; stay = !!p.stay;
    }
    q.autoTarget = target;
    let face = null;
    if (target !== null && squads[target] && alive(squads[target])) {
      const e = squads[target];
      if (isShooter(q) && hyp(e.x - q.x, e.y - q.y) <= rangeOf(q) + 40) face = Math.atan2(e.y - q.y, e.x - q.x);
    }
    if (stay) return { dx: 0, dy: 0, speed: 0, face };
    const wp = waypoint(q, clamp(gx, FIELD.minX + q.r * 0.5, FIELD.maxX - q.r * 0.5), clamp(gy, FIELD.minY + q.r * 0.5, FIELD.maxY - q.r * 0.5));
    let dx = wp.x - q.x, dy = wp.y - q.y;
    const d = hyp(dx, dy);
    if (d < 0.5) return { dx: 0, dy: 0, speed: 0, face };
    const sp = Math.min(maxSpeed(q) * speedMul, d / DT);
    return { dx: dx / d, dy: dy / d, speed: sp, face, retreat: od.kind === 'retreat' };
  }

  function move(plans) {
    const nx = new Float64Array(squads.length), ny = new Float64Array(squads.length);
    for (const q of squads) {
      nx[q.gid] = q.x; ny[q.gid] = q.y;
      if (!alive(q)) continue;
      const p = plans[q.gid];
      if (!p) continue;
      // turning slows the squad down; retreating squads turn their backs
      let want = p.speed > 0.5 ? Math.atan2(p.dy, p.dx) : null;
      if (q.contacts.length && q.meleeTarget !== null && !q.routing && q.order.kind !== 'retreat') {
        const e = squads[q.meleeTarget];
        want = Math.atan2(e.y - q.y, e.x - q.x);
      } else if (p.face !== null && p.face !== undefined && p.speed < 0.5) want = p.face;
      let turnK = 1;
      if (want !== null) {
        const diff = angNorm(want - q.face);
        const rate = (q.U.legendary ? 1.6 : q.U.mounted || q.U.fly ? 3.2 : 2.4) * DT;
        q.face = angNorm(q.face + clamp(diff, -rate, rate));
        turnK = 0.45 + 0.55 * Math.max(0, Math.cos(diff));
      }
      if (p.speed > 0) {
        const sp = p.speed * (q.routing ? 1 : turnK);
        nx[q.gid] = q.x + p.dx * sp * DT;
        ny[q.gid] = q.y + p.dy * sp * DT;
      }
    }
    // collisions (Jacobi: all pushes from the same positions)
    const px = new Float64Array(squads.length), py = new Float64Array(squads.length);
    for (let i = 0; i < squads.length; i++) {
      const a = squads[i];
      if (!alive(a)) continue;
      for (let j = i + 1; j < squads.length; j++) {
        const b = squads[j];
        if (!alive(b)) continue;
        if (!!a.U.fly !== !!b.U.fly) continue;
        const dx = nx[j] - nx[i], dy = ny[j] - ny[i];
        const minD = a.r + b.r;
        const d2 = dx * dx + dy * dy;
        if (d2 >= minD * minD) continue;
        let d = Math.sqrt(d2), ux, uy;
        if (d < 1e-6) { ux = a.side === 0 ? 1 : -1; uy = 0; d = 0; } else { ux = dx / d; uy = dy / d; }
        const over = minD - d;
        const k = a.side === b.side ? (a.contacts.length || b.contacts.length ? 0.15 : 0.3) : 0.5;
        const ma = a.U.legendary || a.U.cls === 'beast' ? 3 : 1, mb = b.U.legendary || b.U.cls === 'beast' ? 3 : 1;
        const sa = mb / (ma + mb) * 2, sb = ma / (ma + mb) * 2;
        px[i] -= ux * over * k * sa; py[i] -= uy * over * k * sa;
        px[j] += ux * over * k * sb; py[j] += uy * over * k * sb;
      }
    }
    for (const q of squads) {
      if (!alive(q)) continue;
      let x = nx[q.gid] + px[q.gid], y = ny[q.gid] + py[q.gid];
      if (!q.U.fly) {
        for (const o of rocks) {
          const dx = x - o.x, dy = y - o.y, d = hyp(dx, dy), m = o.r + q.r * 0.55;
          if (d < m) {
            if (d < 1e-6) { x = o.x + (q.side === 0 ? -m : m); }
            else { x = o.x + dx / d * m; y = o.y + dy / d * m; }
          }
        }
      }
      const my = Math.min(q.r * 0.6, 30);
      y = clamp(y, FIELD.minY + my, FIELD.maxY - my);
      if (q.routing) {
        if ((q.side === 0 && x < FIELD.minX + 2) || (q.side === 1 && x > FIELD.maxX - 2)) {
          q.fled = true; q.endT = t; q.st.lostFled = q.count;
          ev({ k: 'fled', s: q.side, a: q.gid, n: q.count });
          tellBoth('fled', q);
        }
      } else x = clamp(x, FIELD.minX + my, FIELD.maxX - my);
      const moved = hyp(x - q.x, y - q.y);
      q.vx = (x - q.x) / DT; q.vy = (y - q.y) / DT; q.spd = moved / DT;
      q.x = x; q.y = y;
      q.run += moved;
      q.inWoods = inWoods(x, y);
      q.inRiver = !q.U.fly && inRiver(x, y);
    }
  }

  // ── combat ───────────────────────────────────────────────────────────────
  function contactsPhase() {
    for (const q of squads) { q.prevContacts = new Set(q.contacts.map(c => c.gid)); q.contacts = []; }
    for (let i = 0; i < squads.length; i++) {
      const a = squads[i];
      if (!alive(a)) continue;
      for (let j = i + 1; j < squads.length; j++) {
        const b = squads[j];
        if (!alive(b) || a.side === b.side) continue;
        const d = hyp(b.x - a.x, b.y - a.y);
        if (d <= a.r + b.r + 4) { a.contacts.push(b); b.contacts.push(a); }
      }
    }
    for (const q of squads) {
      if (!alive(q)) continue;
      q.contacts.sort((x, y) => x.gid - y.gid);
      if (!q.contacts.length) { q.meleeTarget = null; continue; }
      let pick = null;
      const od = q.order;
      if ((od.kind === 'attack' || od.kind === 'charge') && q.contacts.some(c => c.gid === od.target)) pick = od.target;
      else if (q.meleeTarget !== null && q.contacts.some(c => c.gid === q.meleeTarget)) pick = q.meleeTarget;
      else {
        let bd = Infinity;
        for (const c of q.contacts) {
          const a = Math.abs(angNorm(Math.atan2(c.y - q.y, c.x - q.x) - q.face)) + (c.routing ? 2 : 0);
          if (a < bd - 1e-9) { bd = a; pick = c.gid; }
        }
      }
      q.meleeTarget = pick;
    }
  }
  function chargesPhase() {
    for (const a of squads) {
      if (!alive(a) || a.routing || !a.contacts.length) { if (alive(a) && !a.contacts.length) continue; a.run = 0; continue; }
      const fresh = a.contacts.filter(b => !a.prevContacts.has(b.gid));
      for (const b of fresh) {
        const key = a.gid < b.gid ? `${a.gid}:${b.gid}` : `${b.gid}:${a.gid}`;
        const canCharge = a.U.charge > 0 && a.run >= 50 && a.spd >= 0.5 * a.speed * terrainSpeed(a) && !a.inRiver;
        if (!canCharge) {
          if (a.gid < b.gid && (!pairClash.has(key) || t - pairClash.get(key) > 8)) {
            pairClash.set(key, t);
            ev({ k: 'clash', s: a.side, a: a.gid, b: b.gid });
            tellBoth('clash', a, b);
          }
          continue;
        }
        pairClash.set(key, t);
        const fl = flankOf(b, a);
        const braced = b.U.brace && !b.routing && b.spd < 12 && fl === 0 && b.form !== 'loose' && !a.U.fly;
        const n = a.n0 <= 4 ? a.count : Math.min(a.count, capacity(b) * 1.4);
        let dmg = n * a.U.charge * a.dmgMult * counterMult(a, b) * FLANK_CHARGE[fl] * (1 - armorOf(b, 'charge'));
        if (a.form === 'wedge' && !a.general && !a.U.legendary) dmg *= FORMATIONS.wedge.chargeMult;
        if (b.form === 'square' && !b.general && !b.U.legendary) dmg *= FORMATIONS.square.chargeTaken;
        if (isLooseDef(b)) dmg *= FORMATIONS.loose.meleeTaken;
        if (b.inWoods && a.U.mounted) dmg *= 0.6;
        let back = 0;
        if (braced) {
          dmg *= 0.25;
          back = fightersVs(b, a) * 3 * counterMult(b, a) * (1 - armorOf(a, 'melee'));
          hurt(a, back, b, 'melee');
          a.shock += 15;
          b.st.stopped++;
          a.st.bracedOn++;
        }
        dmg = Math.min(dmg, b.hp * 0.45);
        hurt(b, dmg, a, 'charge');
        a.st.charges++; a.st.chargeDmg += dmg;
        if (!b.U.fearless) b.shock += Math.min(30, (5 + 30 * dmg / b.maxHp) * (fl ? 1.5 : 1));
        a.run = 0;
        a.reveal = t;
        ev({ k: 'charge', s: a.side, a: a.gid, b: b.gid, fl, br: braced ? 1 : 0, d: Math.round(dmg) });
        tellBoth(braced ? 'braced' : 'charge', a, b, { flank: ['front', 'flank', 'rear'][fl] });
        if (a.order.kind === 'charge') a.order = { kind: 'attack', target: a.order.target };
      }
      a.run = 0;
    }
  }
  function meleePhase() {
    for (const a of squads) {
      if (!alive(a) || a.routing || !a.contacts.length || a.meleeTarget === null) continue;
      const main = squads[a.meleeTarget];
      const targets = a.U.cleave ? a.contacts : [main];
      for (const b of targets) {
        const f = FORMATIONS[a.form];
        let d = fightersVs(a, b) * a.U.melee * a.dmgMult * counterMult(a, b)
          * (a.general || a.U.legendary ? 1 : f.atk) * FLANK_MELEE[flankOf(b, a)] * (1 - armorOf(b, 'melee'));
        if (a.reformT > 0) d *= 0.75;
        if (a.morale < 30 && !a.U.fearless) d *= 0.85;
        if (a.inRiver) d *= 0.75;
        if (b.inRiver) d *= 1.25;
        if (a.inWoods && a.U.mounted) d *= 0.75;
        if (isLooseDef(b)) d *= FORMATIONS.loose.meleeTaken;
        if (b.routing) d *= 1.5;
        if (b !== main) d *= 0.6;
        hurt(b, d * DT, a, 'melee');
      }
      a.reveal = t;
    }
  }
  function accuracy(att, def, dist, rng) {
    let acc = 0.62 * Math.min(1, (def.r + 4) / 26) * (1 - 0.25 * clamp(dist / rng, 0, 1));
    if (def.inWoods && !def.U.fly) acc *= 0.5;
    if (isLooseDef(def)) acc *= FORMATIONS.loose.missileTaken;
    return acc;
  }
  function volley(a, b) {
    const R = a.U.ranged;
    const d = hyp(b.x - a.x, b.y - a.y);
    const ft = d / R.speed;
    const ax = b.x + b.vx * ft * 0.5, ay = b.y + b.vy * ft * 0.5;
    const n = a.count;
    projectiles.push({ kind: R.kind, t: t + ft, side: a.side, from: a.gid, to: b.gid, x: ax, y: ay, n, dist: d, sx: a.x, sy: a.y });
    a.reload = R.reload * (0.9 + 0.1 * a.n0 / Math.max(1, a.count));
    a.reveal = t;
    a.st.volleys++; a.st.fired += n;
    ev({ k: 'volley', s: a.side, a: a.gid, b: b.gid, n, ft: r2(ft), x: Math.round(ax), y: Math.round(ay), kind: R.kind });
  }
  function areaTargetOk(a, x, y, radius, friendlyFire) {
    if (!friendlyFire) return true;
    for (const f of bySide[a.side]) if (alive(f) && !f.U.fly && hyp(f.x - x, f.y - y) < radius + f.r + 18) return false;
    return true;
  }
  function pickAreaTarget(a, range, radius, minR, friendlyFire, preferBig) {
    let best = null, bs = -Infinity;
    for (const e of visibleEnemies(a)) {
      if (preferBig === 'ground' && e.U.fly) continue;
      const d = hyp(e.x - a.x, e.y - a.y);
      if (d > range || d < (minR || 0)) continue;
      if (!areaTargetOk(a, e.x, e.y, radius, friendlyFire)) continue;
      let score = preferBig ? e.count * weightOf(e) - d * 0.01 : -d;
      if (e.routing) score -= 1000;
      if (score > bs) { bs = score; best = e; }
    }
    return best;
  }
  function launchArea(a, kind, x, y, radius, dmg, ft, extra) {
    projectiles.push(Object.assign({ kind, t: t + ft, side: a.side, from: a.gid, x, y, radius, dmg, area: true, sx: a.x, sy: a.y }, extra || {}));
  }
  function resolvePointOrSquad(a, tgt) {
    if (!tgt) return null;
    if (tgt.gid !== undefined) { const e = squads[tgt.gid]; return e && alive(e) ? { x: e.x, y: e.y, e } : null; }
    return { x: tgt.x, y: tgt.y, e: null };
  }
  function rangedPhase() {
    for (const a of squads) {
      if (!alive(a)) continue;
      a.reload -= DT; a.cd -= DT;
      if (a.reformT > 0) a.reformT -= DT;
      if (a.aegis > 0) a.aegis -= DT;
      if (a.pw) for (const k in a.pw) a.pw[k] -= DT;
      if (a.routing) { a.pending = null; continue; }
      const U = a.U;
      const engaged = a.contacts.length > 0;
      const pend = a.pending;
      if (pend && t - pend.at > 3) a.pending = null;
      // ── general's powers
      if (a.general && a.pending) { usePower(a, a.pending); a.pending = null; continue; }
      // ── missile troops (archers, archangels)
      if (U.ranged && !engaged && a.reload <= 0 && a.spd < 0.3 * a.speed + 2) {
        let target = null;
        const focus = a.order.kind === 'attack' ? a.order.target : a.order.focus;
        if (focus !== undefined && focus !== null) {
          const e = squads[focus];
          if (e && alive(e) && visible[a.side].has(e.gid)) {
            const d = hyp(e.x - a.x, e.y - a.y);
            if (d <= U.ranged.range && d >= U.ranged.min) target = e;
          }
        }
        if (!target) {
          let bd = Infinity;
          for (const e of visibleEnemies(a)) {
            const d = hyp(e.x - a.x, e.y - a.y) + (e.routing ? 150 : 0);
            if (d > U.ranged.range + (e.routing ? 150 : 0) || d < U.ranged.min) continue;
            if (d < bd) { bd = d; target = e; }
          }
        }
        if (target) { a.fireTarget = target.gid; volley(a, target); }
      }
      // ── spells (mages)
      if (U.spell && !engaged && a.cd <= 0) {
        const S = U.spell;
        let spot = null;
        if (pend && (pend.name === S.name || pend.name === 'cast')) { spot = resolvePointOrSquad(a, pend.tgt); a.pending = null; }
        else if (a.autocast) { const e = pickAreaTarget(a, S.range, S.radius, 0, true, true); if (e) spot = { x: e.x, y: e.y, e }; }
        if (spot && hyp(spot.x - a.x, spot.y - a.y) <= S.range + 5) {
          const lead = spot.e ? 0.8 * S.flight : 0;
          const x = spot.x + (spot.e ? spot.e.vx * lead : 0), y = spot.y + (spot.e ? spot.e.vy * lead : 0);
          launchArea(a, 'fire', x, y, S.radius, S.dmg * (0.4 + 0.6 * a.count / a.n0), S.flight, { ff: true, spell: 'fireball' });
          a.cd = S.cd; a.reveal = t; a.st.casts++;
          ev({ k: 'spell', s: a.side, a: a.gid, x: Math.round(x), y: Math.round(y), r: S.radius, ft: S.flight, kind: 'fireball' });
          tellBoth('spell', a, spot.e, { x: undefined });
        }
      }
      // ── siege (catapults)
      if (U.siege && !engaged && a.reload <= 0 && a.spd < 3) {
        const S = U.siege;
        let spot = null;
        if (pend && (pend.name === 'fire' || pend.name === 'shoot')) { spot = resolvePointOrSquad(a, pend.tgt); a.pending = null; }
        if (!spot) {
          const focus = a.order.kind === 'attack' ? a.order.target : a.order.focus;
          const e = focus !== undefined && focus !== null ? squads[focus] : null;
          if (e && alive(e) && visible[a.side].has(e.gid)) spot = { x: e.x, y: e.y, e };
        }
        if (!spot && a.autocast) { const e = pickAreaTarget(a, S.range, S.radius, S.min, true, 'ground'); if (e) spot = { x: e.x, y: e.y, e }; }
        if (spot) {
          const d = hyp(spot.x - a.x, spot.y - a.y);
          if (d <= S.range && d >= S.min) {
            const ft = 0.8 + d / S.speed;
            launchArea(a, 'stone', spot.x, spot.y, S.radius, S.dmg * (0.4 + 0.6 * a.count / a.n0), ft, { ff: true, noFly: true });
            a.reload = S.reload; a.reveal = t; a.st.volleys++;
            a.fireTarget = spot.e ? spot.e.gid : null;
            ev({ k: 'siege', s: a.side, a: a.gid, x: Math.round(spot.x), y: Math.round(spot.y), r: S.radius, ft: r2(ft) });
          }
        }
      }
      // ── dragon breath
      if (U.breath && a.cd <= 0) {
        const B = U.breath;
        let spot = null;
        if (pend && pend.name === 'breath') { spot = resolvePointOrSquad(a, pend.tgt); a.pending = null; }
        else if (a.autocast) { const e = pickAreaTarget(a, B.range + 30, B.radius, 0, true, true); if (e) spot = { x: e.x, y: e.y, e }; }
        if (spot && hyp(spot.x - a.x, spot.y - a.y) <= B.range + 40) {
          launchArea(a, 'fire', spot.x, spot.y, B.radius, B.dmg, 0.35, { ff: true, spell: 'breath' });
          a.cd = B.cd; a.reveal = t; a.st.casts++;
          a.face = Math.atan2(spot.y - a.y, spot.x - a.x);
          ev({ k: 'breath', s: a.side, a: a.gid, x: Math.round(spot.x), y: Math.round(spot.y), r: B.radius });
        }
      }
      // ── titan stomp
      if (U.stomp && a.cd <= 0) {
        const S = U.stomp;
        const want = (pend && pend.name === 'stomp') || (a.autocast && bySide[1 - a.side].some(e => alive(e) && !e.U.fly && hyp(e.x - a.x, e.y - a.y) < S.radius + e.r * 0.5));
        if (pend && pend.name === 'stomp') a.pending = null;
        if (want) {
          launchArea(a, 'crush', a.x, a.y, S.radius, S.dmg, 0.05, { ff: false, noFly: true, spell: 'stomp', shock: 12 });
          a.cd = S.cd; a.st.casts++;
          ev({ k: 'stomp', s: a.side, a: a.gid, x: Math.round(a.x), y: Math.round(a.y), r: S.radius });
        }
      }
      if (a.pending && t - a.pending.at > 0) {
        // an ability this squad does not have
        const n = a.pending.name;
        const has = (U.spell && U.spell.name === n) || (U.breath && n === 'breath') || (U.stomp && n === 'stomp') || (U.siege && (n === 'fire' || n === 'shoot'));
        if (!has) { badOrder(a.side, `${a.type} has no ability "${String(n).slice(0, 20)}"`); a.pending = null; }
      }
    }
  }
  function usePower(g, pend) {
    const name = pend.name;
    if (!POWERS[name] || POWERS[name].level > L) { badOrder(g.side, `power "${String(name).slice(0, 20)}" is not available at level ${L}`); return; }
    if (g.pw[name] > 0) return;
    const P = POWERS[name];
    if (name === 'rally') {
      let n = 0;
      for (const f of bySide[g.side]) {
        if (!alive(f) || f.general || hyp(f.x - g.x, f.y - g.y) > P.radius) continue;
        f.morale = Math.min(100, f.morale + 30);
        if (f.routing && !f.broken) { f.routing = false; f.order = { kind: 'hold', x: f.x, y: f.y }; ev({ k: 'rally', s: f.side, a: f.gid }); tellBoth('rally', f); f.st.rallies++; }
        n++;
      }
      ev({ k: 'power', s: g.side, a: g.gid, p: 'rally', x: Math.round(g.x), y: Math.round(g.y), r: P.radius, n });
    } else if (name === 'meteor') {
      const spot = resolvePointOrSquad(g, pend.tgt);
      if (!spot) { badOrder(g.side, 'meteor needs a target: an enemy id or a point {x, y}'); return; }
      if (hyp(spot.x - g.x, spot.y - g.y) > P.range) { badOrder(g.side, `meteor target is further than ${P.range} from the general`); return; }
      launchArea(g, 'divine', spot.x, spot.y, P.radius, P.dmg, P.delay, { ff: true, spell: 'meteor', shock: 15 });
      ev({ k: 'power', s: g.side, a: g.gid, p: 'meteor', x: Math.round(spot.x), y: Math.round(spot.y), r: P.radius, ft: P.delay });
    } else if (name === 'aegis') {
      for (const f of bySide[g.side]) if (alive(f) && hyp(f.x - g.x, f.y - g.y) <= P.radius) f.aegis = P.time;
      ev({ k: 'power', s: g.side, a: g.gid, p: 'aegis', x: Math.round(g.x), y: Math.round(g.y), r: P.radius });
    } else if (name === 'wrath') {
      const foes = visibleEnemies(g).filter(e => hyp(e.x - g.x, e.y - g.y) <= P.range && !e.routing);
      if (!foes.length) { badOrder(g.side, 'wrath: no visible enemy within range of the general'); return; }
      foes.sort((a, b) => (b.count * weightOf(b)) - (a.count * weightOf(a)) || a.gid - b.gid);
      for (let i = 0; i < P.bolts; i++) delayed.push({ t: t + 0.3 + i * 0.5, kind: 'bolt', side: g.side, from: g.gid, target: foes[i % Math.min(3, foes.length)].gid });
      ev({ k: 'power', s: g.side, a: g.gid, p: 'wrath', x: Math.round(g.x), y: Math.round(g.y), r: P.range });
    }
    g.pw[name] = P.cd;
    g.st.casts++;
    tellBoth('power', g, null, { power: name });
  }
  function areaHit(p, hitsNow) {
    let killsEst = 0;
    for (const s of squads) {
      if (!alive(s)) continue;
      if (s.side === p.side && !p.ff) continue;
      if (p.noFly && s.U.fly) continue;
      if (p.enemyOnly && s.side === p.side) continue;
      const d = hyp(s.x - p.x, s.y - p.y);
      if (d >= p.radius + s.r) continue;
      let f = p.radius >= s.r && d <= p.radius - s.r ? 1 : clamp((p.radius + s.r - d) / (2 * Math.min(s.r, p.radius)), 0, 1) * Math.min(1, (p.radius * p.radius) / (s.r * s.r));
      let caught = s.count * f;
      if (isLooseDef(s)) caught *= FORMATIONS.loose.missileTaken;
      const src = squads[p.from];
      let dmg = caught * weightOf(s) * p.dmg * (src ? counterMult(src, s) : 1) * (1 - armorOf(s, p.kind === 'stone' ? 'stone' : p.kind === 'divine' ? 'divine' : p.kind === 'crush' ? 'crush' : 'fire'));
      if (src && src.dmgMult) dmg *= src.dmgMult;
      dmg = Math.min(dmg, caught * s.hpPer);
      if (dmg <= 0) continue;
      hurt(s, dmg, src, p.kind === 'stone' ? 'stone' : p.kind === 'divine' ? 'divine' : p.kind === 'crush' ? 'melee' : 'fire');
      if (!s.U.fearless) s.shock += Math.min(18, 2 + 14 * dmg / s.maxHp + (p.shock || 0));
      killsEst += dmg / s.hpPer;
    }
    return killsEst;
  }
  function projectilePhase() {
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const p = projectiles[i];
      if (p.t > t + 1e-9) continue;
      projectiles.splice(i, 1);
      const src = squads[p.from];
      if (p.area) {
        const k = areaHit(p);
        ev({ k: 'boom', s: p.side, a: p.from, x: Math.round(p.x), y: Math.round(p.y), r: p.radius, kind: p.spell || p.kind, n: Math.round(k) });
        continue;
      }
      const b = squads[p.to];
      if (!alive(b)) continue;
      const d = hyp(b.x - p.x, b.y - p.y);
      const R = src.U.ranged;
      let acc = accuracy(src, b, p.dist, R.range) * (d <= b.r ? 1 : Math.max(0, 1 - (d - b.r) / R.spread));
      if (b.U.shield && !b.routing && flankOf(b, { x: p.sx, y: p.sy }) === 0) acc *= b.U.shield;
      const hits = p.n * acc;
      let dmg = hits * R.dmg * src.dmgMult * counterMult(src, b) * (1 - armorOf(b, p.kind === 'holy' ? 'holy' : 'arrow'));
      if (p.kind === 'holy') dmg *= D.HOLY_BONUS[b.U.cls] || 1;
      if (b.routing) dmg *= 1.3;
      src.st.hits += hits;
      hurt(b, dmg, src, p.kind === 'holy' ? 'holy' : 'arrow');
      if (!b.U.fearless && hits > 0) b.shock += Math.min(4, 1 + 8 * dmg / b.maxHp);
    }
    for (let i = delayed.length - 1; i >= 0; i--) {
      const dl = delayed[i];
      if (dl.t > t + 1e-9) continue;
      delayed.splice(i, 1);
      const e = squads[dl.target];
      if (!e || !alive(e)) continue;
      const P = POWERS.wrath;
      const p = { kind: 'divine', side: dl.side, from: dl.from, x: e.x, y: e.y, radius: P.radius, dmg: P.dmg, ff: false, shock: 6 };
      const k = areaHit(p);
      ev({ k: 'boom', s: dl.side, a: dl.from, x: Math.round(e.x), y: Math.round(e.y), r: P.radius, kind: 'bolt', n: Math.round(k) });
    }
  }
  function healPhase() {
    const heals = [];
    for (const h of squads) {
      if (!alive(h) || !h.U.heal || h.routing) continue;
      const H = h.U.heal;
      let pool = H.hps * (h.count / h.n0) * DT;
      const cands = bySide[h.side].filter(f => alive(f) && f.hp < f.maxHp - 0.01 && hyp(f.x - h.x, f.y - h.y) <= H.radius + f.r);
      cands.sort((a, b) => (b.maxHp - b.hp) / b.maxHp - (a.maxHp - a.hp) / a.maxHp || a.gid - b.gid);
      for (const f of cands.slice(0, 3)) {
        if (pool <= 0) break;
        const amt = Math.min(pool * 0.6 + (cands.length === 1 ? pool * 0.4 : 0), f.maxHp - f.hp);
        heals.push([f, amt, h]);
        pool -= amt;
      }
    }
    for (const [f, amt, h] of heals) {
      const before = f.hp;
      f.hp = Math.min(f.maxHp, f.hp + amt);
      h.st.healed += f.hp - before;
      if (t - (h.lastHealEv || -99) > 2.5 && f.hp - before > 0) { h.lastHealEv = t; ev({ k: 'heal', s: h.side, a: h.gid, b: f.gid }); }
    }
    // regeneration (general, trolls)
    for (const q of squads) {
      if (!alive(q) || !q.U.regen) continue;
      if (q.general && t - q.lastHurt < 3) continue;
      q.hp = Math.min(q.maxHp, q.hp + q.U.regen * q.count * DT);
    }
  }
  function applyDamage() {
    const routEvents = [];
    for (const q of squads) {
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
        // kill credit, proportional to damage share
        if (lost > 0 && q.hurtBy.length) {
          let tot = 0;
          for (let i = 1; i < q.hurtBy.length; i += 2) tot += q.hurtBy[i];
          for (let i = 0; i < q.hurtBy.length; i += 2) squads[q.hurtBy[i]].st.kills += lost * q.hurtBy[i + 1] / tot;
        }
        for (let i = 0; i < q.hurtBy.length; i += 2) squads[q.hurtBy[i]].st.dealt += q.hurtBy[i + 1] * dmg / q.dmgIn;
        q.count = after;
        if (!q.U.fearless) q.morale -= (dmg / q.maxHp) * 100 * 0.8 * moraleResist(q);
        if (q.count <= 0) {
          q.dead = true; q.count = 0; q.hp = 0; q.endT = t;
          ev({ k: q.general ? 'general' : 'destroyed', s: q.side, a: q.gid });
          tellBoth(q.general ? 'generalSlain' : 'destroyed', q);
          routEvents.push({ q, kind: 'destroyed' });
        }
      }
      q.dmgIn = 0; q.hurtBy.length = 0;
    }
    return routEvents;
  }
  function moraleResist(q) {
    let k = q.U.elite ? 0.7 : 1;
    const g = generals[q.side];
    if (alive(g) && hyp(g.x - q.x, g.y - q.y) <= GENERAL.aura.radius) k *= GENERAL.aura.resist;
    if (q.banner) k *= 0.85;
    else for (const f of bySide[q.side]) if (f.banner && alive(f) && f !== q && hyp(f.x - q.x, f.y - q.y) <= 160) { k *= 0.85; break; }
    return k;
  }
  function moralePhase(prevEvents) {
    const valueNow = [armyValue(0), armyValue(1)];
    const lostFrac = [0, 1].map(s => 1 - valueNow[s] / (valueStart[s] || 1));
    const newRouts = [];
    for (const q of squads) {
      if (!alive(q) || q.U.fearless) { if (alive(q)) q.shock = 0; continue; }
      const res = moraleResist(q);
      let dm = -q.shock * res;
      q.shock = 0;
      const engaged = q.contacts.length > 0;
      if (engaged && !q.routing) {
        let pressure = 0;
        for (const e of q.contacts) { if (e.routing) continue; const fl = flankOf(q, e); pressure += fl === 2 ? 4.5 : fl === 1 ? 2.5 : 0; }
        const fighting = q.contacts.filter(e => !e.routing).length;
        if (fighting >= 2) pressure += 1.5 * (fighting - 1);
        if (q.takenTick > q.dealtTick * 1.3 && q.takenTick > 0) pressure += 1;
        else if (q.dealtTick > q.takenTick * 1.3) dm += 0.6 * DT;
        dm -= pressure * DT * res;
      }
      // fear
      for (const e of bySide[1 - q.side]) {
        if (!alive(e) || !e.U.fear || e.routing) continue;
        if (hyp(e.x - q.x, e.y - q.y) < e.r + q.r + 110) { dm -= 2.5 * DT * res; break; }
      }
      if (lostFrac[q.side] >= 0.7) dm -= 1.2 * DT * res; else if (lostFrac[q.side] >= 0.5) dm -= 0.4 * DT * res;
      // recovery
      const g = generals[q.side];
      const nearG = alive(g) && hyp(g.x - q.x, g.y - q.y) <= GENERAL.aura.radius;
      let aura = 0;
      for (const f of bySide[q.side]) if (typeof f.U.aura === 'number' && alive(f) && !f.routing && f !== q && hyp(f.x - q.x, f.y - q.y) <= (f.U.heal ? f.U.heal.radius : 170)) aura = Math.max(aura, f.U.aura);
      if (q.routing) {
        const near = bySide[1 - q.side].some(e => alive(e) && !e.routing && hyp(e.x - q.x, e.y - q.y) < 150 + e.r + q.r);
        if (!near && !q.broken) dm += (4 + (nearG ? 6 : 0) + aura) * DT;
      } else {
        if (!engaged && t - q.lastHurt > 2.5 && q.morale < q.moraleBase) dm += 3 * DT;
        if (nearG) dm += (engaged ? 1 : GENERAL.aura.regen) * DT;
        dm += aura * DT;
      }
      q.morale = clamp(q.morale + dm, 0, 100);
      if (!q.routing && !q.general && q.morale < ROUT_AT && !decided) newRouts.push(q);
      else if (q.routing && !q.broken && q.morale >= RALLY_AT) {
        q.routing = false; q.order = { kind: 'hold', x: q.x, y: q.y }; q.st.rallies++;
        ev({ k: 'rally', s: q.side, a: q.gid });
        tellBoth('rally', q);
      }
      if (!q.routing && q.morale > q.moraleBase && !nearG && !aura) q.morale = Math.max(q.moraleBase, q.morale - 0.5 * DT);
    }
    for (const q of newRouts) {
      q.routing = true; q.routs++; q.st.routs++;
      if (q.routs >= 3) q.broken = true;
      q.pending = null;
      ev({ k: 'rout', s: q.side, a: q.gid, br: q.broken ? 1 : 0 });
      tellBoth('rout', q);
      prevEvents.push({ q, kind: 'rout' });
    }
    // neighbours see a squad break or die (applied next tick through shock)
    for (const { q, kind } of prevEvents) {
      for (const f of bySide[q.side]) {
        if (f === q || !alive(f) || f.U.fearless) continue;
        if (hyp(f.x - q.x, f.y - q.y) < 250) f.shock += kind === 'destroyed' ? 8 : 6;
      }
      if (q.general) for (const f of bySide[q.side]) if (alive(f) && !f.U.fearless) f.shock += 40;
    }
  }
  function checkVictory() {
    if (decided) return;
    const gDead = [!alive(generals[0]), !alive(generals[1])];
    let winner, method;
    if (gDead[0] || gDead[1]) {
      method = 'GENERAL';
      if (gDead[0] && gDead[1]) winner = compareValue();
      else winner = gDead[0] ? 1 : 0;
    } else {
      const broken = [0, 1].map(s => bySide[s].every(q => q.general || !alive(q) || q.routing));
      const gone = [0, 1].map(s => bySide[s].every(q => q.general || !alive(q)));
      for (let s = 0; s < 2; s++) brokenSince[s] = broken[s] ? (brokenSince[s] === null ? t : brokenSince[s]) : null;
      const done = [0, 1].map(s => gone[s] || (brokenSince[s] !== null && t - brokenSince[s] >= 3));
      if (done[0] || done[1]) {
        const wiped = (s) => bySide[s].every(q => q.general || q.dead);
        method = (done[0] && wiped(0)) || (done[1] && wiped(1)) ? 'ANNIHILATION' : 'ROUT';
        if (done[0] && done[1]) winner = compareValue(); else winner = done[0] ? 1 : 0;
      } else if (t >= maxTime - 1e-9) {
        method = 'TIME';
        winner = compareValue();
      } else return;
    }
    decided = { winner, method, time: r2(t) };
    endAt = t + stopAfter;
    ev({ k: 'end', s: winner === null ? -1 : winner, method });
    if (winner !== null) {
      for (const q of bySide[1 - winner]) if (alive(q) && !q.general && !q.routing) { q.routing = true; q.broken = true; ev({ k: 'rout', s: q.side, a: q.gid, br: 1, end: 1 }); }
      for (const q of bySide[winner]) if (alive(q)) { q.order = { kind: 'hold', x: q.x, y: q.y }; q.pending = null; }
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
    if (q.routing) return ST.routing;
    if (q.contacts.length) return ST.fighting;
    if (q.chargeFlag || (q.U.charge > 0 && q.run >= 50 && q.spd > 0.6 * q.speed && q.autoTarget !== null && squads[q.autoTarget] && hyp(squads[q.autoTarget].x - q.x, squads[q.autoTarget].y - q.y) < 220)) return ST.charging;
    if (q.spd > 4) return ST.moving;
    return ST.idle;
  }
  function record() {
    for (const q of squads) {
      const R = q.rec;
      R.x.push(Math.round(q.x)); R.y.push(Math.round(q.y));
      R.a.push(Math.round(((q.face * 180 / Math.PI) % 360 + 360) % 360));
      // m = morale (0-100); for generals (always fearless) it is the general's HP %
      R.n.push(q.count); R.s.push(stateCode(q)); R.m.push(Math.round(q.general ? 100 * q.hp / q.maxHp : q.morale));
    }
    hud.push([Math.round(100 * armyValue(0) / (valueStart[0] || 1)), Math.round(moraleAvg(0)), Math.round(100 * armyValue(1) / (valueStart[1] || 1)), Math.round(moraleAvg(1))]);
  }

  // ── setup: settle deployments ────────────────────────────────────────────
  for (const q of squads) { q.inWoods = inWoods(q.x, q.y); q.inRiver = !q.U.fly && inRiver(q.x, q.y); }
  for (let it = 0; it < 12; it++) move(squads.map(() => ({ dx: 0, dy: 0, speed: 0, face: null })));
  for (const q of squads) { q.vx = 0; q.vy = 0; q.spd = 0; q.run = 0; }
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
    const plans = squads.map(q => (alive(q) ? plan(q) : null));
    move(plans);
    contactsPhase();
    for (const q of squads) { q.dealtTick = 0; }
    chargesPhase();
    meleePhase();
    rangedPhase();
    projectilePhase();
    const deaths = applyDamage();
    healPhase();
    for (const q of squads) if (alive(q)) q.r = radiusOf(q);
    moralePhase(deaths);
    checkVictory();
    if (tick % REC === 0) record();
    if (endAt !== null && t >= endAt - 1e-9) break;
  }
  const duration = r2((hud.length - 1) * DT * REC);

  // ── stats ────────────────────────────────────────────────────────────────
  const stats = [0, 1].map(s => {
    const own = bySide[s].filter(q => !q.general);
    const sum = (f) => own.reduce((a, q) => a + f(q), 0);
    const g = generals[s];
    const soldiersStart = sum(q => q.n0), soldiersLeft = sum(q => (alive(q) ? q.count : 0));
    const enemyLost = bySide[1 - s].filter(q => !q.general).reduce((a, q) => a + (q.n0 - (alive(q) ? q.count : 0) - (q.fled ? q.st.lostFled : 0)), 0);
    return {
      valueStart: Math.round(valueStart[s]), valueLeft: Math.round(armyValue(s)), valuePct: Math.round(100 * armyValue(s) / (valueStart[s] || 1)),
      squads: own.length, squadsLeft: own.filter(q => alive(q) && !q.routing).length, squadsDestroyed: own.filter(q => q.dead).length, squadsFled: own.filter(q => q.fled).length,
      soldiersStart, soldiersLeft, soldiersLost: soldiersStart - soldiersLeft, enemiesSlain: Math.round(enemyLost),
      routs: sum(q => q.st.routs), rallies: sum(q => q.st.rallies), charges: sum(q => q.st.charges) + g.st.charges,
      chargesBraced: sum(q => q.st.bracedOn) + g.st.bracedOn, chargesStopped: sum(q => q.st.stopped),
      volleys: sum(q => q.st.volleys), arrowsFired: sum(q => q.st.fired), arrowsHit: Math.round(sum(q => q.st.hits)),
      spells: sum(q => q.st.casts), healed: Math.round(sum(q => q.st.healed)),
      dmgMelee: Math.round(sum(q => q.st.melee) + g.st.melee), dmgCharge: Math.round(sum(q => q.st.chargeDmg) + g.st.chargeDmg),
      dmgRanged: Math.round(sum(q => q.st.ranged)), dmgMagic: Math.round(sum(q => q.st.magic)), dmgSiege: Math.round(sum(q => q.st.siege)), dmgPowers: Math.round(g.st.power + g.st.magic),
      dmgDealt: Math.round(sum(q => q.st.dealt) + g.st.dealt), dmgTaken: Math.round(sum(q => q.st.taken)),
      generalHpPct: Math.round(100 * g.hp / g.maxHp), generalAlive: alive(g) ? 1 : 0, powersUsed: g.st.casts,
      moraleEnd: Math.round(moraleAvg(s)), orders: orderStats[s].orders, badOrders: orderStats[s].bad,
    };
  });

  let text;
  const names = specs.map(s => s.name);
  if (!decided) decided = { winner: compareValue(), method: 'TIME', time: r2(t) };
  return {
    map, duration, hud, events, stats, orderStats, decided, names,
    squads: squads.map(q => ({
      gid: q.gid, side: q.side, k: q.k, type: q.type, name: q.name, general: q.general, n0: q.n0, cost: q.cost,
      upgrades: q.upgrades, legendary: !!q.U.legendary, fly: !!q.U.fly, endT: q.endT, dead: q.dead, fled: q.fled,
      rec: q.rec, st: q.st, count: q.count, hp: q.hp, maxHp: q.maxHp, routs: q.routs, form0: FORM_CODE[specs[q.side].squads[q.k] ? (specs[q.side].squads[q.k].formation || q.U.form) : 'line'] || 0,
    })),
    text,
  };
}

module.exports = { runBattle, ST, FORM_CODE, radiusOf };
