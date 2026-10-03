'use strict';
// Runs an army's commander.js (+ its lib/*.js modules) inside an isolated V8 context.
// Adapted from engine/sandbox.js (the fighter mode's sandbox):
//  • no process / fs / network — only plain JavaScript + `util` helpers + `require('./lib/x')`
//  • Math.random is seeded, so battles are reproducible
//  • every command() call is time-limited; a total CPU budget stops runaway commanders
//  • data only crosses the boundary as JSON strings
//  • `memory` is a plain object that survives between the rounds of a match

const vm = require('vm');
const D = require('./data');

const LIMITS = {
  callTimeoutMs: 50,       // one command() call
  budgetMs: 12000,         // total commander CPU per battle
  loadTimeoutMs: 1500,
  memoryMaxBytes: 16000,
};

// Unit info that the helpers expose (plain data, no functions).
const UNIT_INFO = {};
for (const [k, u] of Object.entries(D.UNITS)) {
  UNIT_INFO[k] = {
    type: k, name: u.name, level: u.level, cost: u.cost, cls: u.cls, size: u.size, hp: u.hp, armor: u.armor,
    melee: u.melee, charge: u.charge, speed: u.speed, morale: u.morale,
    range: u.ranged ? u.ranged.range : u.spell ? u.spell.range : u.siege ? u.siege.range : u.breath ? u.breath.range : 0,
    fly: !!u.fly, brace: !!u.brace, legendary: !!u.legendary, strong: u.strong, weak: u.weak,
  };
}
UNIT_INFO.general = { type: 'general', name: 'General', cls: 'hero', size: 1, hp: D.GENERAL.hp, armor: D.GENERAL.armor, melee: D.GENERAL.melee, charge: D.GENERAL.charge, speed: D.GENERAL.speed, morale: 100, range: 0 };
const BONUS_JSON = JSON.stringify(D.BONUS);

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

  var UNITS = ${JSON.stringify(UNIT_INFO)};
  var BONUS = ${BONUS_JSON};
  function hyp(x, y) { return Math.sqrt(x * x + y * y); }
  function segDist(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    var t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    return hyp(px - (ax + t * dx), py - (ay + t * dy));
  }
  var util = {
    dist: function (a, b) { return hyp(b.x - a.x, b.y - a.y); },
    angle: function (a, b) { return Math.atan2(b.y - a.y, b.x - a.x); },
    vec: function (angle, len) { if (len === undefined) len = 1; return { x: Math.cos(angle) * len, y: Math.sin(angle) * len }; },
    len: function (v) { return hyp(v.x, v.y); },
    norm: function (v) { var l = hyp(v.x, v.y); return l > 1e-9 ? { x: v.x / l, y: v.y / l } : { x: 0, y: 0 }; },
    add: function (a, b) { return { x: a.x + b.x, y: a.y + b.y }; },
    sub: function (a, b) { return { x: a.x - b.x, y: a.y - b.y }; },
    scale: function (v, k) { return { x: v.x * k, y: v.y * k }; },
    lerp: function (a, b, k) { return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }; },
    clamp: function (v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; },
    toward: function (from, to, d) { var n = util.norm({ x: to.x - from.x, y: to.y - from.y }); return d === undefined ? n : { x: from.x + n.x * d, y: from.y + n.y * d }; },
    away: function (from, to) { return util.norm({ x: from.x - to.x, y: from.y - to.y }); },
    predict: function (o, t) { return { x: o.x + (o.vx || 0) * t, y: o.y + (o.vy || 0) * t }; },
    // ── lists ──
    byId: function (s, id) {
      var i;
      for (i = 0; i < s.squads.length; i++) if (s.squads[i].id === id) return s.squads[i];
      for (i = 0; i < s.enemies.length; i++) if (s.enemies[i].id === id) return s.enemies[i];
      return null;
    },
    nearest: function (list, p, filter) {
      var best = null, bd = Infinity;
      for (var i = 0; i < list.length; i++) {
        var o = list[i];
        if (filter && !filter(o)) continue;
        var d = hyp(o.x - p.x, o.y - p.y);
        if (d < bd) { bd = d; best = o; }
      }
      return best;
    },
    within: function (list, p, radius) {
      var out = [];
      for (var i = 0; i < list.length; i++) if (hyp(list[i].x - p.x, list[i].y - p.y) <= radius) out.push(list[i]);
      out.sort(function (a, b) { return hyp(a.x - p.x, a.y - p.y) - hyp(b.x - p.x, b.y - p.y); });
      return out;
    },
    centroid: function (list) {
      var x = 0, y = 0, w = 0;
      for (var i = 0; i < list.length; i++) { var k = list[i].count || 1; x += list[i].x * k; y += list[i].y * k; w += k; }
      return w ? { x: x / w, y: y / w } : { x: 0, y: 0 };
    },
    ofType: function (list, type) { return list.filter(function (q) { return q.type === type; }); },
    fighting: function (list) { return list.filter(function (q) { return q.engaged && q.engaged.length > 0; }); },
    strength: function (list) { var v = 0; for (var i = 0; i < list.length; i++) v += list[i].value || 0; return v; },
    threats: function (s, squad, radius) { return util.within(s.enemies, squad, radius || 250).filter(function (e) { return !e.routing; }); },
    // ── geometry of a squad ──
    front: function (q, d) { return { x: q.x + Math.cos(q.facing) * (d || 60), y: q.y + Math.sin(q.facing) * (d || 60) }; },
    rear: function (q, d) { return { x: q.x - Math.cos(q.facing) * (d || 90), y: q.y - Math.sin(q.facing) * (d || 90) }; },
    flank: function (q, side, d) { var a = q.facing + (side === -1 ? -Math.PI / 2 : Math.PI / 2); return { x: q.x + Math.cos(a) * (d || 80), y: q.y + Math.sin(a) * (d || 80) }; },
    // Where an attack coming from 'from' lands on 'q': 'front' | 'flank' | 'rear'.
    side: function (q, from) {
      var a = Math.atan2(from.y - q.y, from.x - q.x) - q.facing;
      while (a > Math.PI) a -= 2 * Math.PI;
      while (a < -Math.PI) a += 2 * Math.PI;
      a = Math.abs(a);
      return a < Math.PI / 3 ? 'front' : a < 2 * Math.PI / 3 ? 'flank' : 'rear';
    },
    // ── units ──
    unit: function (type) { return UNITS[type] || null; },
    bonus: function (attackerType, defenderType) {
      var a = UNITS[attackerType], d = UNITS[defenderType];
      if (!a || !d) return 1;
      var row = BONUS[a.cls];
      return (row && row[d.cls]) || 1;
    },
    inRange: function (q, target) {
      var d = hyp(target.x - q.x, target.y - q.y);
      if (q.range > 0) return d <= q.range && d >= (q.minRange || 0);
      return d <= q.radius + target.radius + 4;
    },
    timeTo: function (q, p) { return hyp(p.x - q.x, p.y - q.y) / Math.max(1, q.speed || 1); },
    // ── terrain ──
    inWoods: function (s, p) { var w = s.terrain.woods; for (var i = 0; i < w.length; i++) if (hyp(p.x - w[i].x, p.y - w[i].y) < w[i].r) return true; return false; },
    inRiver: function (s, p) {
      var r = s.terrain.river;
      if (!r || p.x < r.x0 || p.x > r.x1) return false;
      for (var i = 0; i < r.fords.length; i++) if (p.y >= r.fords[i].y0 && p.y <= r.fords[i].y1) return false;
      return true;
    },
    blocked: function (s, p, radius) { var k = s.terrain.rocks; for (var i = 0; i < k.length; i++) if (hyp(p.x - k[i].x, p.y - k[i].y) < k[i].r + (radius || 0)) return k[i]; return null; },
    clampToField: function (s, p, margin) {
      var m = margin || 20, f = s.field;
      return { x: Math.max(f.minX + m, Math.min(f.maxX - m, p.x)), y: Math.max(f.minY + m, Math.min(f.maxY - m, p.y)) };
    },
    // The next waypoint from 'from' toward 'to': around rocks, and through the nearest ford.
    path: function (s, from, to, radius) {
      var R = radius || 30, rocks = s.terrain.rocks, river = s.terrain.river, i;
      if (river && ((from.x < river.x0 - 5 && to.x > river.x0) || (from.x > river.x1 + 5 && to.x < river.x1))) {
        var yCross = from.y + (to.y - from.y) * ((river.x0 + river.x1) / 2 - from.x) / ((to.x - from.x) || 1e-9);
        var inFord = false, bestF = null, bd = Infinity;
        for (i = 0; i < river.fords.length; i++) {
          var f = river.fords[i];
          if (yCross >= f.y0 + 12 && yCross <= f.y1 - 12) inFord = true;
          var cy = (f.y0 + f.y1) / 2, dd = Math.abs(cy - yCross);
          if (dd < bd) { bd = dd; bestF = f; }
        }
        if (!inFord && bestF) {
          var fx = from.x < river.x0 ? river.x0 - R - 10 : river.x1 + R + 10;
          var fy = (bestF.y0 + bestF.y1) / 2;
          if (hyp(from.x - fx, from.y - fy) > 25) to = { x: fx, y: fy };
          else to = { x: from.x < river.x0 ? river.x1 + R + 20 : river.x0 - R - 20, y: fy };
        }
      }
      var best = null, bdist = Infinity;
      for (i = 0; i < rocks.length; i++) {
        var o = rocks[i];
        if (segDist(o.x, o.y, from.x, from.y, to.x, to.y) >= o.r + R) continue;
        var d = hyp(o.x - from.x, o.y - from.y);
        if (d < bdist) { bdist = d; best = o; }
      }
      if (!best) return { x: to.x, y: to.y };
      var dir = util.norm({ x: to.x - from.x, y: to.y - from.y });
      var c = best.r + R + 18;
      var c1 = { x: best.x - dir.y * c, y: best.y + dir.x * c }, c2 = { x: best.x + dir.y * c, y: best.y - dir.x * c };
      var l1 = hyp(c1.x - from.x, c1.y - from.y) + hyp(to.x - c1.x, to.y - c1.y);
      var l2 = hyp(c2.x - from.x, c2.y - from.y) + hyp(to.x - c2.x, to.y - c2.y);
      return Math.abs(l1 - l2) < 1 ? (c1.y <= c2.y ? c1 : c2) : l1 < l2 ? c1 : c2;
    },
    power: function (s, name) { var p = s.powers || []; for (var i = 0; i < p.length; i++) if (p[i].name === name) return p[i]; return null; }
  };
  globalThis.util = util;
})(${seed >>> 0});
`;

const RESOLVE = `
(function () {
  var m = globalThis.module && globalThis.module.exports;
  var f = null;
  if (typeof m === 'function') f = m;
  else if (m && typeof m.command === 'function') f = m.command;
  else if (typeof command === 'function') f = command;
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

const tickScript = new vm.Script(TICK, { filename: 'army-tick.js' });
const resolveScript = new vm.Script(RESOLVE, { filename: 'army-resolve.js' });
const memoryScript = new vm.Script(MEMORY_OUT, { filename: 'army-memory.js' });

function brainLine(stack) {
  const m = /((?:commander\.js)|(?:lib\/[\w.-]+)):(\d+)(?::(\d+))?/.exec(String(stack || ''));
  return m ? (m[1] === 'commander.js' ? Number(m[2]) : `${m[1]}:${m[2]}`) : null;
}
function cleanMessage(stack) {
  const first = String(stack || '').split('\n')[0];
  return first.replace(/^Error: /, '').slice(0, 300);
}
function libKey(name) { return String(name).replace(/\\/g, '/').replace(/^lib\//, '').replace(/\.js$/, ''); }

/**
 * Create a commander from source.
 * @returns {{ok, error, think(state, t), stats, exportMemory()}}
 */
function createCommander(source, { seed = 1, label = 'commander', lib = null, memory = null } = {}) {
  const stats = {
    calls: 0, errors: 0, timeouts: 0, totalMs: 0, maxMs: 0,
    firstErrors: [], logs: [], disabled: false, disabledReason: null, loadError: null,
  };
  const noop = { ok: false, error: null, think: () => null, stats, exportMemory: () => ({ json: null, note: null }) };
  if (typeof source !== 'string' || !source.trim()) {
    noop.error = stats.loadError = 'commander.js is missing or empty';
    return noop;
  }
  const sandbox = {};
  Object.defineProperty(sandbox, '__in', { value: '', writable: true, enumerable: false, configurable: false });
  let context;
  try {
    context = vm.createContext(sandbox, { name: label, codeGeneration: { strings: false, wasm: false }, microtaskMode: 'afterEvaluate' });
    new vm.Script(PRELUDE(seed), { filename: 'army-prelude.js' }).runInContext(context, { timeout: 1000 });
  } catch (e) {
    noop.error = stats.loadError = `internal sandbox error: ${e.message}`;
    return noop;
  }
  if (memory !== null && memory !== undefined) {
    try {
      const json = typeof memory === 'string' ? memory : JSON.stringify(memory);
      sandbox.__in = json;
      new vm.Script('globalThis.memory = JSON.parse(__in) || {};', { filename: 'army-memory-in.js' }).runInContext(context, { timeout: 200 });
    } catch { /* start with an empty memory */ }
  }
  for (const [name, src] of Object.entries(lib || {})) {
    const key = libKey(name);
    try {
      new vm.Script(`globalThis.__libs[${JSON.stringify(key)}] = (function (module, exports, require) {\n${src}\n});`, { filename: `lib/${key}.js`, lineOffset: -1 })
        .runInContext(context, { timeout: LIMITS.loadTimeoutMs });
    } catch (e) {
      let msg;
      try { msg = String(e && e.stack ? e.stack : e); } catch { msg = 'unknown error'; }
      noop.error = stats.loadError = `lib/${key}.js failed to load: ${cleanMessage(msg)}`;
      return noop;
    }
  }
  try {
    new vm.Script(String(source), { filename: 'commander.js' }).runInContext(context, { timeout: LIMITS.loadTimeoutMs });
    const res = resolveScript.runInContext(context, { timeout: 200 });
    if (res !== 'ok') {
      noop.error = stats.loadError = 'commander.js must define `function command(state) { ... }` (or set module.exports = function (state) { ... })';
      return noop;
    }
  } catch (e) {
    if (e && e.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') noop.error = stats.loadError = `commander.js took longer than ${LIMITS.loadTimeoutMs} ms to load (infinite loop at top level?)`;
    else {
      let msg;
      try { msg = String(e && e.stack ? e.stack : e); } catch { msg = 'unknown error'; }
      const line = brainLine(msg);
      noop.error = stats.loadError = `commander.js failed to load${line ? ` (${typeof line === 'number' ? `line ${line}` : line})` : ''}: ${cleanMessage(msg)}`;
    }
    return noop;
  }

  function recordError(kind, message, t) {
    stats.errors++;
    if (kind === 'timeout') stats.timeouts++;
    if (stats.firstErrors.length < 8) stats.firstErrors.push({ t, kind, message });
  }
  function checkBudget() {
    if (stats.totalMs > LIMITS.budgetMs && !stats.disabled) {
      stats.disabled = true;
      stats.disabledReason = `commander used more than ${LIMITS.budgetMs} ms of CPU this battle and collapsed - the squads followed their last orders (and defaults) for the rest of the battle`;
    }
  }
  function think(state, t = 0) {
    if (stats.disabled) return null;
    stats.calls++;
    let out;
    const t0 = process.hrtime.bigint();
    try {
      sandbox.__in = JSON.stringify(state);
      out = tickScript.runInContext(context, { timeout: LIMITS.callTimeoutMs });
    } catch (e) {
      stats.totalMs += Number(process.hrtime.bigint() - t0) / 1e6;
      if (e && e.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') recordError('timeout', `command() took longer than ${LIMITS.callTimeoutMs} ms`, t);
      else recordError('error', `internal: ${e && e.message}`, t);
      checkBudget();
      return null;
    }
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    stats.totalMs += ms;
    if (ms > stats.maxMs) stats.maxMs = ms;
    checkBudget();
    if (typeof out !== 'string') { recordError('error', 'command() output could not be read', t); return null; }
    let parsed;
    try { parsed = JSON.parse(out); } catch { recordError('error', 'command() returned something that is not plain data', t); return null; }
    if (parsed.l && Array.isArray(parsed.l)) for (const line of parsed.l) if (stats.logs.length < 300) stats.logs.push({ t, text: String(line) });
    if (parsed.err !== undefined) {
      const line = brainLine(parsed.err);
      recordError('error', `${line ? (typeof line === 'number' ? `line ${line}: ` : `${line}: `) : ''}${cleanMessage(parsed.err)}`, t);
      return null;
    }
    return parsed.a;
  }
  function exportMemory() {
    let json = null;
    try { json = memoryScript.runInContext(context, { timeout: 200 }); } catch { return { json: null, note: 'memory could not be saved (took too long)' }; }
    if (typeof json !== 'string') return { json: null, note: 'memory is not plain JSON data - it was not saved' };
    if (Buffer.byteLength(json, 'utf8') > LIMITS.memoryMaxBytes) return { json: null, note: `memory is larger than ${LIMITS.memoryMaxBytes} bytes - it was not saved` };
    return { json, note: null };
  }
  return { ok: true, error: null, think, stats, exportMemory };
}

module.exports = { createCommander, LIMITS, libKey };
