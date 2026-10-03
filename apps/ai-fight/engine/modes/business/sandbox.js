'use strict';
// Runs a company's strategy.js (+ its lib/*.js modules) inside an isolated V8 context.
// Adapted from engine/sandbox.js (the fighter sandbox):
//  • no process / fs / network — only plain JavaScript + `util` helpers + `require('./lib/x')`
//  • Math.random is seeded (but the market itself never rolls dice)
//  • every decide() call is time-limited; a total CPU budget per year stops runaway strategies
//  • data only crosses the boundary as JSON strings
//  • `memory` is a plain object that survives between the rounds of a match

const vm = require('vm');
const { LIMITS } = require('./rules');

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
    if (logs.length >= 20) return;
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

  var util = {
    clamp: function (v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; },
    sum: function (arr, f) { var t = 0; for (var i = 0; i < arr.length; i++) t += f ? f(arr[i]) : arr[i]; return t; },
    avg: function (arr, f) { return arr.length ? util.sum(arr, f) / arr.length : 0; },
    round: function (v, step) { step = step || 0.01; return Math.round(v / step) * step; },
    maxBy: function (arr, f) { var b = null, bv = -Infinity; for (var i = 0; i < arr.length; i++) { var v = f(arr[i]); if (v > bv) { bv = v; b = arr[i]; } } return b; },
    minBy: function (arr, f) { var b = null, bv = Infinity; for (var i = 0; i < arr.length; i++) { var v = f(arr[i]); if (v < bv) { bv = v; b = arr[i]; } } return b; },
    /** Stores of mine in a district (open or being built). */
    storesIn: function (s, d) { return s.me.stores.filter(function (x) { return x.district === d; }); },
    rivalStoresIn: function (s, d) { return s.rival.stores.filter(function (x) { return x.district === d; }); },
    /** Your effective price for category c in district d (district override or company price). */
    priceIn: function (s, c, d) { var dp = s.me.districtPrices && s.me.districtPrices[d]; return dp && dp[c] ? dp[c] : s.me.prices[c]; },
    /** How much a store of this tier would cost to build in district d. */
    buildCost: function (s, tier, d) { var t = s.rules.tiers[tier]; if (!t) return Infinity; return Math.round(t.build * (d ? 0.5 + 0.5 * s.rules.districts[d].rent : 1)); },
    /** Is a calendar event active on the given day (default today)? */
    eventOn: function (s, type, day) { day = day || s.day; for (var i = 0; i < s.calendar.length; i++) { var e = s.calendar[i]; if (e.type === type && day >= e.from && day <= e.to) return e; } return null; },
    /** Calendar events starting within the next n days. */
    upcoming: function (s, n) { return s.calendar.filter(function (e) { return e.from > s.day && e.from <= s.day + (n || 14); }); },
  };
  globalThis.util = util;
})(${seed >>> 0});
`;

const RESOLVE = `
(function () {
  var m = globalThis.module && globalThis.module.exports;
  var f = null;
  if (typeof m === 'function') f = m;
  else if (m && typeof m.decide === 'function') f = m.decide;
  else if (typeof decide === 'function') f = decide;
  globalThis.__decideFn = f;
  return f ? 'ok' : 'missing';
})()
`;

const TICK = `
(function () {
  var logs = globalThis.__logs;
  try {
    var r = globalThis.__decideFn(JSON.parse(__in));
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

const tickScript = new vm.Script(TICK, { filename: 'business-tick.js' });
const resolveScript = new vm.Script(RESOLVE, { filename: 'business-resolve.js' });
const memoryScript = new vm.Script(MEMORY_OUT, { filename: 'business-memory.js' });

function srcLine(stack) {
  const m = /((?:strategy\.js)|(?:lib\/[\w.-]+)):(\d+)(?::(\d+))?/.exec(String(stack || ''));
  return m ? (m[1] === 'strategy.js' ? Number(m[2]) : `${m[1]}:${m[2]}`) : null;
}
function cleanMessage(stack) {
  const first = String(stack || '').split('\n')[0];
  return first.replace(/^Error: /, '').slice(0, 300);
}
function libKey(name) { return String(name).replace(/\\/g, '/').replace(/^lib\//, '').replace(/\.js$/, ''); }

/**
 * Create a strategy from source.
 * @returns {{ok:boolean, error:string|null, decide:(state:object, day:number)=>object|null, stats:object, exportMemory:()=>{json:string|null, note:string|null}}}
 */
function createStrategy(source, { seed = 1, label = 'strategy', lib = null, memory = null } = {}) {
  const stats = {
    calls: 0, errors: 0, timeouts: 0, totalMs: 0, maxMs: 0,
    firstErrors: [], logs: [], disabled: false, disabledReason: null, loadError: null,
  };
  const noop = { ok: false, error: null, decide: () => null, stats, exportMemory: () => ({ json: null, note: null }) };
  if (source === null || source === undefined || !String(source).trim()) {
    noop.error = stats.loadError = null;   // no strategy: the company runs on autopilot
    return noop;
  }

  const sandbox = {};
  Object.defineProperty(sandbox, '__in', { value: '', writable: true, enumerable: false, configurable: false });
  let context;
  try {
    context = vm.createContext(sandbox, { name: label, codeGeneration: { strings: false, wasm: false }, microtaskMode: 'afterEvaluate' });
    new vm.Script(PRELUDE(seed), { filename: 'business-prelude.js' }).runInContext(context, { timeout: 1000 });
  } catch (e) {
    noop.error = stats.loadError = `internal sandbox error: ${e.message}`;
    return noop;
  }

  if (memory !== null && memory !== undefined) {
    try {
      const json = typeof memory === 'string' ? memory : JSON.stringify(memory);
      sandbox.__in = json;
      new vm.Script('globalThis.memory = JSON.parse(__in) || {};', { filename: 'business-memory-in.js' }).runInContext(context, { timeout: 200 });
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
    new vm.Script(String(source), { filename: 'strategy.js' }).runInContext(context, { timeout: LIMITS.loadTimeoutMs });
    const res = resolveScript.runInContext(context, { timeout: 200 });
    if (res !== 'ok') {
      noop.error = stats.loadError = 'strategy.js must define `function decide(state) { ... }` (or set module.exports = function (state) { ... })';
      return noop;
    }
  } catch (e) {
    if (e && e.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') {
      noop.error = stats.loadError = `strategy.js took longer than ${LIMITS.loadTimeoutMs} ms to load (infinite loop at top level?)`;
    } else {
      let msg;
      try { msg = String(e && e.stack ? e.stack : e); } catch { msg = 'unknown error'; }
      const line = srcLine(msg);
      noop.error = stats.loadError = `strategy.js failed to load${line ? ` (${typeof line === 'number' ? `line ${line}` : line})` : ''}: ${cleanMessage(msg)}`;
    }
    return noop;
  }

  function recordError(kind, message, day) {
    stats.errors++;
    if (kind === 'timeout') stats.timeouts++;
    if (stats.firstErrors.length < 8) stats.firstErrors.push({ day, kind, message });
  }
  function checkBudget() {
    if (stats.totalMs > LIMITS.budgetMs && !stats.disabled) {
      stats.disabled = true;
      stats.disabledReason = `strategy used more than ${LIMITS.budgetMs} ms of CPU this year and burned out - the company ran on autopilot (its last decisions) for the rest of the year`;
    }
  }

  function decide(state, day = 0) {
    if (stats.disabled) return null;
    stats.calls++;
    let out;
    const t0 = process.hrtime.bigint();
    try {
      sandbox.__in = JSON.stringify(state);
      out = tickScript.runInContext(context, { timeout: LIMITS.callTimeoutMs });
    } catch (e) {
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      stats.totalMs += ms;
      if (e && e.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') recordError('timeout', `decide() took longer than ${LIMITS.callTimeoutMs} ms`, day);
      else recordError('error', `internal: ${e && e.message}`, day);
      checkBudget();
      return null;
    }
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    stats.totalMs += ms;
    if (ms > stats.maxMs) stats.maxMs = ms;
    checkBudget();
    if (typeof out !== 'string') { recordError('error', 'decide() output could not be read', day); return null; }
    let parsed;
    try { parsed = JSON.parse(out); } catch { recordError('error', 'decide() returned something that is not plain data', day); return null; }
    if (parsed.l && Array.isArray(parsed.l)) {
      for (const line of parsed.l) if (stats.logs.length < 200) stats.logs.push({ day, text: String(line) });
    }
    if (parsed.err !== undefined) {
      const line = srcLine(parsed.err);
      recordError('error', `${line ? (typeof line === 'number' ? `line ${line}: ` : `${line}: `) : ''}${cleanMessage(parsed.err)}`, day);
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

  return { ok: true, error: null, decide, stats, exportMemory };
}

/** Syntax check without running anything (for `check`). */
function syntaxError(src, filename, wrap) {
  try {
    new vm.Script(wrap ? `(function (module, exports, require) {\n${src}\n})` : String(src), { filename, lineOffset: wrap ? -1 : 0 });
    return null;
  } catch (e) {
    const line = srcLine(e && e.stack);
    return `${filename}${line ? ` line ${typeof line === 'number' ? line : line}` : ''}: ${e && e.message}`;
  }
}

module.exports = { createStrategy, syntaxError, libKey };
