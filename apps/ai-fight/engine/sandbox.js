'use strict';
// Runs a fighter's brain.js (+ its lib/*.js modules) inside an isolated V8 context.
//  • no process / fs / network — only plain JavaScript + `util` helpers + `require('./lib/x')`
//  • Math.random is seeded, so fights are reproducible
//  • every brain() call is time-limited; a total time budget stops runaway brains
//  • data only crosses the boundary as JSON strings
//  • `memory` is a plain object that survives between the rounds of a match

const vm = require('vm');
const { RULES } = require('./rules');

const PRELUDE = (seed) => `
(function (seed) {
  'use strict';
  var s = seed >>> 0;
  function rand() {
    s = (s + 0x6D2B79F5) >>> 0;
    var t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  Object.defineProperty(Math, 'random', { value: rand, writable: false, configurable: false });
  try { delete globalThis.Atomics; delete globalThis.SharedArrayBuffer; delete globalThis.WebAssembly; } catch (e) {}

  var logs = [];
  function fmt(v) {
    if (typeof v === 'string') return v;
    try { return JSON.stringify(v); } catch (e) { return String(v); }
  }
  function log() {
    if (logs.length >= 50) return;
    var parts = [];
    for (var i = 0; i < arguments.length; i++) parts.push(fmt(arguments[i]));
    logs.push(parts.join(' ').slice(0, 300));
  }
  globalThis.console = { log: log, info: log, warn: log, error: log, debug: log };
  globalThis.__logs = logs;
  globalThis.module = { exports: {} };
  globalThis.exports = globalThis.module.exports;
  globalThis.memory = {};

  // require('./lib/name') for the fighter's own lib/*.js files
  var libs = {}, cache = {};
  globalThis.__libs = libs;
  globalThis.require = function (name) {
    var key = String(name).replace(/^\\.\\//, '').replace(/^lib\\//, '').replace(/\\.js$/, '');
    if (cache[key]) return cache[key].exports;
    var fn = libs[key];
    if (!fn) throw new Error('module not found: ' + name + ' (only files in your lib/ folder can be required, e.g. require("./lib/' + key + '"))');
    var m = { exports: {} };
    cache[key] = m;
    fn(m, m.exports, globalThis.require);
    return m.exports;
  };

  var R = ${RULES.fighterRadius};
  function segDist(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    var t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }
  var util = {
    dist: function (a, b) { return Math.hypot(b.x - a.x, b.y - a.y); },
    angle: function (a, b) { return Math.atan2(b.y - a.y, b.x - a.x); },
    vec: function (angle, len) { if (len === undefined) len = 1; return { x: Math.cos(angle) * len, y: Math.sin(angle) * len }; },
    len: function (v) { return Math.hypot(v.x, v.y); },
    norm: function (v) { var l = Math.hypot(v.x, v.y); return l > 1e-9 ? { x: v.x / l, y: v.y / l } : { x: 0, y: 0 }; },
    add: function (a, b) { return { x: a.x + b.x, y: a.y + b.y }; },
    sub: function (a, b) { return { x: a.x - b.x, y: a.y - b.y }; },
    scale: function (v, k) { return { x: v.x * k, y: v.y * k }; },
    dot: function (a, b) { return a.x * b.x + a.y * b.y; },
    rotate: function (v, a) { var c = Math.cos(a), s2 = Math.sin(a); return { x: v.x * c - v.y * s2, y: v.x * s2 + v.y * c }; },
    toward: function (from, to) { return util.norm({ x: to.x - from.x, y: to.y - from.y }); },
    away: function (from, to) { return util.norm({ x: from.x - to.x, y: from.y - to.y }); },
    perp: function (v, side) { return side === -1 ? { x: v.y, y: -v.x } : { x: -v.y, y: v.x }; },
    predict: function (o, t) { return { x: o.x + (o.vx || 0) * t, y: o.y + (o.vy || 0) * t }; },
    lead: function (from, target, speed) {
      var dx = target.x - from.x, dy = target.y - from.y, vx = target.vx || 0, vy = target.vy || 0;
      var a = vx * vx + vy * vy - speed * speed, b = 2 * (dx * vx + dy * vy), c = dx * dx + dy * dy;
      var t;
      if (Math.abs(a) < 1e-6) t = b !== 0 ? -c / b : 0;
      else {
        var disc = b * b - 4 * a * c;
        if (disc < 0) return { x: target.x, y: target.y };
        var sq = Math.sqrt(disc), t1 = (-b - sq) / (2 * a), t2 = (-b + sq) / (2 * a);
        var lo = Math.min(t1, t2), hi = Math.max(t1, t2);
        t = lo > 0 ? lo : hi;
      }
      if (!(t > 0) || !isFinite(t)) return { x: target.x, y: target.y };
      return { x: target.x + vx * t, y: target.y + vy * t };
    },
    edgeDistance: function (p, arena) { return arena.radius - Math.hypot(p.x, p.y); },
    inArena: function (p, arena, margin) { return Math.hypot(p.x, p.y) <= arena.radius - (margin || 0); },
    clampToArena: function (p, arena, margin) {
      var r = arena.radius - (margin || 0), d = Math.hypot(p.x, p.y);
      if (d <= r || d === 0) return { x: p.x, y: p.y };
      return { x: p.x / d * r, y: p.y / d * r };
    },
    ability: function (s, nameOrIndex) {
      var list = s.me.abilities;
      if (typeof nameOrIndex === 'number') return list[nameOrIndex] || null;
      if (nameOrIndex === 'attack' || nameOrIndex === 'basic') return util.basic(s);
      for (var i = 0; i < list.length; i++) if (list[i].name === nameOrIndex) return list[i];
      return null;
    },
    basic: function (s) {
      var list = s.me.abilities;
      for (var i = 0; i < list.length; i++) if (list[i].basic) return list[i];
      return null;
    },
    enemyAbility: function (s, name) {
      var list = s.enemy.abilities;
      for (var i = 0; i < list.length; i++) if (list[i].name === name || (name === 'attack' && list[i].basic)) return list[i];
      return null;
    },
    incoming: function (s, horizon) {
      if (horizon === undefined) horizon = 1;
      var me = s.me, out = [];
      for (var i = 0; i < s.projectiles.length; i++) {
        var p = s.projectiles[i];
        if (p.mine) continue;
        var vv = p.vx * p.vx + p.vy * p.vy;
        if (vv === 0) continue;
        var rx = me.x - p.x, ry = me.y - p.y;
        var tc = (rx * p.vx + ry * p.vy) / vv;
        if (tc < 0) continue;
        var cx = p.x + p.vx * tc - me.x, cy = p.y + p.vy * tc - me.y;
        var miss = Math.hypot(cx, cy), hitR = R + p.radius;
        if (miss > hitR) continue;
        var t = Math.max(0, tc - Math.sqrt(hitR * hitR - miss * miss) / Math.sqrt(vv));
        if (t <= horizon && util.lineOfSight(s, p, me)) out.push({ projectile: p, time: t, missBy: miss });
      }
      out.sort(function (a, b) { return a.time - b.time; });
      return out;
    },
    dodge: function (s, threat) {
      var p = threat && threat.projectile ? threat.projectile : threat;
      var me = s.me;
      if (!p) return { x: 0, y: 0 };
      var v = util.norm({ x: p.vx, y: p.vy });
      var side = { x: -v.y, y: v.x };
      var cross = v.x * (me.y - p.y) - v.y * (me.x - p.x);
      if (cross < 0) side = { x: v.y, y: -v.x };
      var probe = { x: me.x + side.x * 90, y: me.y + side.y * 90 };
      if (!util.inArena(probe, s.arena, R) || util.blocked(s, probe, R)) side = { x: -side.x, y: -side.y };
      return side;
    },
    // ── obstacles ──
    obstacles: function (s) { return (s.arena && s.arena.obstacles) || []; },
    blocked: function (s, p, radius) {
      var obs = util.obstacles(s), r = radius === undefined ? R : radius;
      for (var i = 0; i < obs.length; i++) if (Math.hypot(p.x - obs[i].x, p.y - obs[i].y) < obs[i].radius + r) return obs[i];
      return null;
    },
    lineOfSight: function (s, a, b, width) {
      var obs = util.obstacles(s), w = width || 0;
      var dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
      for (var i = 0; i < obs.length; i++) {
        var o = obs[i];
        var t = l2 > 0 ? ((o.x - a.x) * dx + (o.y - a.y) * dy) / l2 : 0;
        t = Math.max(0, Math.min(1, t));
        if (Math.hypot(o.x - (a.x + t * dx), o.y - (a.y + t * dy)) < o.radius + w) return false;
      }
      return true;
    },
    nearestObstacle: function (s, p) {
      var obs = util.obstacles(s), best = null, bd = Infinity;
      for (var i = 0; i < obs.length; i++) {
        var d = Math.hypot(p.x - obs[i].x, p.y - obs[i].y) - obs[i].radius;
        if (d < bd) { bd = d; best = obs[i]; }
      }
      return best ? { x: best.x, y: best.y, radius: best.radius, gap: bd } : null;
    },
    steer: function (s, dir, lookahead) {
      var me = s.me, d = util.norm(dir), ahead = lookahead || 90;
      if (d.x === 0 && d.y === 0) return d;
      var obs = util.obstacles(s);
      for (var i = 0; i < obs.length; i++) {
        var o = obs[i];
        var rx = o.x - me.x, ry = o.y - me.y;
        var along = rx * d.x + ry * d.y;
        if (along <= 0 || along > ahead + o.radius) continue;
        var side = rx * d.y - ry * d.x;
        var lateral = Math.abs(side);
        if (lateral > o.radius + R + 6) continue;
        // side > 0: the obstacle is on the (d.y, -d.x) side of our path, so go round the other way.
        // Dead ahead (a tie): everyone passes on the north side, so two fighters walking at each
        // other through a centre rock meet instead of circling it forever.
        var t1 = { x: -d.y, y: d.x }, t2 = { x: d.y, y: -d.x };
        var tangent = Math.abs(side) < 4 ? (t1.y < t2.y || (t1.y === t2.y && t1.x > t2.x) ? t1 : t2) : side > 0 ? t1 : t2;
        var w = 1 - Math.min(1, along / (ahead + o.radius));
        d = util.norm({ x: d.x * (1 - w) + tangent.x * (0.6 + w), y: d.y * (1 - w) + tangent.y * (0.6 + w) });
      }
      return d;
    },
    cover: function (s, from) {
      var src = from || s.enemy, obs = util.obstacles(s), best = null, bd = Infinity;
      for (var i = 0; i < obs.length; i++) {
        var o = obs[i];
        var away = util.norm({ x: o.x - src.x, y: o.y - src.y });
        var spot = { x: o.x + away.x * (o.radius + R + 4), y: o.y + away.y * (o.radius + R + 4) };
        if (!util.inArena(spot, s.arena, R + 4)) continue;
        var d = Math.hypot(spot.x - s.me.x, spot.y - s.me.y);
        if (d < bd) { bd = d; best = spot; }
      }
      return best;
    },
    // ── danger ──
    dangers: function (s) {
      var out = [];
      for (var i = 0; i < s.zones.length; i++) if (!s.zones[i].mine) out.push({ kind: 'zone', x: s.zones[i].x, y: s.zones[i].y, radius: s.zones[i].radius, timeLeft: s.zones[i].timeLeft });
      for (var j = 0; j < (s.traps || []).length; j++) if (!s.traps[j].mine) out.push({ kind: 'trap', x: s.traps[j].x, y: s.traps[j].y, radius: s.traps[j].radius, timeLeft: s.traps[j].timeLeft, armed: s.traps[j].armed });
      for (var k = 0; k < (s.meteors || []).length; k++) if (!s.meteors[k].mine) out.push({ kind: 'meteor', x: s.meteors[k].x, y: s.meteors[k].y, radius: s.meteors[k].radius, timeLeft: s.meteors[k].timeLeft });
      return out;
    },
    safe: function (s, p, margin) {
      var m = margin === undefined ? R : margin;
      if (!util.inArena(p, s.arena, R) || util.blocked(s, p, R)) return false;
      var d = util.dangers(s);
      for (var i = 0; i < d.length; i++) if (Math.hypot(p.x - d[i].x, p.y - d[i].y) < d[i].radius + m) return false;
      return true;
    },
    // ── v4 ──
    /** Your ultimate as an ability entry (null if you have none); .ready when charged and castable. */
    ultimate: function (s) {
      var list = s.me.abilities;
      for (var i = 0; i < list.length; i++) if (list[i].ultimate) return list[i];
      return null;
    },
    /** Your godly powers [{id, name, ready}] (empty below level 10). */
    godPowers: function (s) { return s.me.godPowers || []; },
    /**
     * Roughly how much damage one hit of 'ability' (name, index or entry) would do to 'target'
     * (default: the enemy) right now — your damage multiplier, their armor, stance, marks and shields
     * included; crits, traits and weapon passives are not.
     */
    damageEstimate: function (s, ability, target) {
      var ab = typeof ability === 'object' && ability ? ability : util.ability(s, ability);
      if (!ab) return 0;
      var me = s.me, t = target || s.enemy;
      var base = ab.damage || (ab.dps ? ab.dps * (ab.duration || 1) : 0);
      var hits = ab.type === 'melee' ? (ab.hits || 1) : ab.type === 'projectile' ? (ab.count || 1) : 1;
      var dmg = base * hits * (me.damageMult || 1) * (t.damageTaken || 1);
      var st = s.rules.stances && s.rules.stances[t.stance];
      if (st) dmg *= st.taken;
      if (t.marked > 0) dmg *= 1.2;
      return Math.max(0, Math.round(dmg - (t.shield || 0) * 0));
    },
    /** Seconds to walk to point p at your current speed (ignores obstacles). */
    timeTo: function (s, p) { var sp = s.me.moveSpeed || 1; return Math.hypot(p.x - s.me.x, p.y - s.me.y) / Math.max(1, sp); },
    /**
     * The next point to walk toward to reach 'to' around obstacles: 'to' itself when the way is clear,
     * otherwise a waypoint just beside the blocking obstacle.
     */
    path: function (s, to) {
      var me = s.me;
      if (util.lineOfSight(s, me, to, R)) return { x: to.x, y: to.y };
      var obs = util.obstacles(s), best = null, bd = Infinity;
      for (var i = 0; i < obs.length; i++) {
        var o = obs[i];
        if (segDist(o.x, o.y, me.x, me.y, to.x, to.y) >= o.radius + R) continue;
        var d = Math.hypot(o.x - me.x, o.y - me.y);
        if (d < bd) { bd = d; best = o; }
      }
      if (!best) return { x: to.x, y: to.y };
      var dir = util.norm({ x: to.x - me.x, y: to.y - me.y });
      var clearance = best.radius + R + 12;
      var cands = [util.perp(dir, 1), util.perp(dir, -1)].map(function (pv) { return { x: best.x + pv.x * clearance, y: best.y + pv.y * clearance }; });
      cands.sort(function (a, b) { return (Math.hypot(a.x - me.x, a.y - me.y) + Math.hypot(to.x - a.x, to.y - a.y)) - (Math.hypot(b.x - me.x, b.y - me.y) + Math.hypot(to.x - b.x, to.y - b.y)); });
      return util.inArena(cands[0], s.arena, R) ? cands[0] : cands[1];
    },
    inReach: function (s, name) {
      var ab = util.ability(s, name);
      if (!ab) return false;
      var d = s.distance, gap = s.gap;
      switch (ab.type) {
        case 'melee': return gap <= ab.range + (ab.lunge || 0);
        case 'projectile': return d <= ab.range && util.lineOfSight(s, s.me, s.enemy, ab.radius);
        case 'area': return ab.target === 'point' ? d <= ab.range + ab.radius : d <= ab.radius + R;
        case 'beam': return d <= ab.range && util.lineOfSight(s, s.me, s.enemy);
        case 'dash': return d <= ab.distance + 2 * R;
        case 'zone': return ab.follow ? d <= ab.radius + R : d <= ab.range + ab.radius;
        case 'trap': return d <= ab.range + ab.radius;
        case 'counter': return gap <= ab.range;
        case 'turret': return d <= (ab.place || 0) + (ab.range || 0);
        default: return true;
      }
    }
  };
  globalThis.util = util;
})(${seed >>> 0});
`;

const RESOLVE = `
(function () {
  var m = globalThis.module && globalThis.module.exports;
  var f = null;
  if (typeof m === 'function') f = m;
  else if (m && typeof m.brain === 'function') f = m.brain;
  else if (typeof brain === 'function') f = brain;
  globalThis.__brainFn = f;
  return f ? 'ok' : 'missing';
})()
`;

const TICK = `
(function () {
  var logs = globalThis.__logs;
  try {
    var r = globalThis.__brainFn(JSON.parse(__in));
    return JSON.stringify({ a: r === undefined ? null : r, l: logs.length ? logs.splice(0) : 0 });
  } catch (e) {
    var msg;
    try { msg = e && e.stack ? String(e.stack) : String(e); } catch (e2) { msg = 'unknown error'; }
    return JSON.stringify({ err: msg.slice(0, 2000), l: logs.length ? logs.splice(0) : 0 });
  }
})()
`;

const MEMORY_OUT = `
(function () {
  try { return JSON.stringify(globalThis.memory === undefined ? {} : globalThis.memory); } catch (e) { return null; }
})()
`;

const tickScript = new vm.Script(TICK, { filename: 'arena-tick.js' });
const resolveScript = new vm.Script(RESOLVE, { filename: 'arena-resolve.js' });
const memoryScript = new vm.Script(MEMORY_OUT, { filename: 'arena-memory.js' });

function brainLine(stack) {
  const m = /((?:brain\.js)|(?:lib\/[\w.-]+)):(\d+)(?::(\d+))?/.exec(String(stack || ''));
  return m ? (m[1] === 'brain.js' ? Number(m[2]) : `${m[1]}:${m[2]}`) : null;
}

function cleanMessage(stack) {
  const first = String(stack || '').split('\n')[0];
  return first.replace(/^Error: /, '').slice(0, 300);
}

function libKey(name) { return String(name).replace(/\\/g, '/').replace(/^lib\//, '').replace(/\.js$/, ''); }

/**
 * Create a brain from source.
 * @param {string} source brain.js
 * @param {{seed?:number, label?:string, lib?:Object<string,string>, memory?:string|object|null}} opts
 * @returns {{ok:boolean, error:string|null, think:(state:object, tick:number)=>object|null, stats:object, exportMemory:()=>{json:string|null, note:string|null}}}
 */
function createBrain(source, { seed = 1, label = 'brain', lib = null, memory = null } = {}) {
  const stats = {
    calls: 0, errors: 0, timeouts: 0, totalMs: 0, maxMs: 0,
    firstErrors: [], logs: [], disabled: false, disabledReason: null, loadError: null,
  };
  const noop = { ok: false, error: null, think: () => null, stats, exportMemory: () => ({ json: null, note: null }) };

  const sandbox = {};
  Object.defineProperty(sandbox, '__in', { value: '', writable: true, enumerable: false, configurable: false });
  let context;
  try {
    context = vm.createContext(sandbox, {
      name: label,
      codeGeneration: { strings: false, wasm: false },
      microtaskMode: 'afterEvaluate',
    });
    new vm.Script(PRELUDE(seed), { filename: 'arena-prelude.js' }).runInContext(context, { timeout: 1000 });
  } catch (e) {
    noop.error = stats.loadError = `internal sandbox error: ${e.message}`;
    return noop;
  }

  // memory from earlier rounds
  if (memory !== null && memory !== undefined) {
    try {
      const json = typeof memory === 'string' ? memory : JSON.stringify(memory);
      sandbox.__in = json;
      new vm.Script('globalThis.memory = JSON.parse(__in) || {};', { filename: 'arena-memory-in.js' }).runInContext(context, { timeout: 200 });
    } catch { /* start with an empty memory */ }
  }

  // lib modules (compiled from the host so the brain itself can't generate code)
  for (const [name, src] of Object.entries(lib || {})) {
    const key = libKey(name);
    try {
      new vm.Script(`globalThis.__libs[${JSON.stringify(key)}] = (function (module, exports, require) {\n${src}\n});`, { filename: `lib/${key}.js`, lineOffset: -1 })
        .runInContext(context, { timeout: RULES.brainLoadTimeoutMs });
    } catch (e) {
      let msg;
      try { msg = String(e && e.stack ? e.stack : e); } catch { msg = 'unknown error'; }
      noop.error = stats.loadError = `lib/${key}.js failed to load: ${cleanMessage(msg)}`;
      return noop;
    }
  }

  try {
    const script = new vm.Script(String(source), { filename: 'brain.js' });
    script.runInContext(context, { timeout: RULES.brainLoadTimeoutMs });
    const res = resolveScript.runInContext(context, { timeout: 200 });
    if (res !== 'ok') {
      noop.error = stats.loadError = 'brain.js must define `function brain(state) { ... }` (or set module.exports = function (state) { ... })';
      return noop;
    }
  } catch (e) {
    if (e && e.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') {
      noop.error = stats.loadError = `brain.js took longer than ${RULES.brainLoadTimeoutMs} ms to load (infinite loop at top level?)`;
    } else {
      let msg;
      try { msg = String(e && e.stack ? e.stack : e); } catch { msg = 'unknown error'; }
      const line = brainLine(msg);
      noop.error = stats.loadError = `brain.js failed to load${line ? ` (${typeof line === 'number' ? `line ${line}` : line})` : ''}: ${cleanMessage(msg)}`;
    }
    return noop;
  }

  function recordError(kind, message, tick) {
    stats.errors++;
    if (kind === 'timeout') stats.timeouts++;
    if (stats.firstErrors.length < 8) stats.firstErrors.push({ tick, kind, message });
  }

  function think(state, tick = 0) {
    if (stats.disabled) return null;
    stats.calls++;
    let out;
    const t0 = process.hrtime.bigint();
    try {
      sandbox.__in = JSON.stringify(state);
      out = tickScript.runInContext(context, { timeout: RULES.brainTimeoutMs });
    } catch (e) {
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      stats.totalMs += ms;
      if (e && e.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') recordError('timeout', `brain() took longer than ${RULES.brainTimeoutMs} ms`, tick);
      else recordError('error', `internal: ${e && e.message}`, tick);
      checkBudget();
      return null;
    }
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    stats.totalMs += ms;
    if (ms > stats.maxMs) stats.maxMs = ms;
    checkBudget();
    if (typeof out !== 'string') { recordError('error', 'brain() output could not be read', tick); return null; }
    let parsed;
    try { parsed = JSON.parse(out); } catch { recordError('error', 'brain() returned something that is not plain data', tick); return null; }
    if (parsed.l && Array.isArray(parsed.l)) {
      for (const line of parsed.l) if (stats.logs.length < 300) stats.logs.push({ tick, text: String(line) });
    }
    if (parsed.err !== undefined) {
      const line = brainLine(parsed.err);
      recordError('error', `${line ? (typeof line === 'number' ? `line ${line}: ` : `${line}: `) : ''}${cleanMessage(parsed.err)}`, tick);
      return null;
    }
    return parsed.a;
  }

  function checkBudget() {
    if (stats.totalMs > RULES.brainBudgetMs && !stats.disabled) {
      stats.disabled = true;
      stats.disabledReason = `brain used more than ${RULES.brainBudgetMs} ms of CPU this fight and overheated — the fighter stood still for the rest of the round`;
    }
  }

  /** The `memory` object as JSON (≤ memoryMaxBytes), to hand to the next round. */
  function exportMemory() {
    let json = null;
    try { json = memoryScript.runInContext(context, { timeout: 200 }); } catch { return { json: null, note: 'memory could not be saved (took too long)' }; }
    if (typeof json !== 'string') return { json: null, note: 'memory is not plain JSON data — it was not saved' };
    if (Buffer.byteLength(json, 'utf8') > RULES.memoryMaxBytes) return { json: null, note: `memory is larger than ${RULES.memoryMaxBytes} bytes — it was not saved` };
    return { json, note: null };
  }

  return { ok: true, error: null, think, stats, exportMemory };
}

module.exports = { createBrain, libKey };
