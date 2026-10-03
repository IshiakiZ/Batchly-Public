'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  BUSINESS MODE — "Build a business as big as you can against each other."
//  Each round is one simulated business year (120 days) in a shared pixel city.
//  Both AIs write company.json (identity + starting choices) and strategy.js
//  (decide(state) runs once per day). Deterministic: no dice, no wall clock.
//  Contract: engine/modes/README.md
// ─────────────────────────────────────────────────────────────────────────────
const R = require('./rules');
const { simulateYear, rulesFor } = require('./sim');
const { createStrategy, syntaxError, libKey } = require('./sandbox');
const { buildReport } = require('./report');
const { BOT_NAMES, BOT_DESCS, botBundle, STARTER } = require('./bots');

const ICONS = ['cup', 'taco', 'burger', 'star', 'bolt', 'leaf', 'crown', 'rocket', 'heart', 'diamond', 'robot', 'planet', 'flame', 'tag', 'gear', 'anchor'];
const DEFAULT_COLORS = ['#e8825c', '#fff4e0'];
const $ = (v) => `${v < 0 ? '-' : ''}$${R.fmtShort(Math.abs(Math.round(v || 0)))}`;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const hex = (c) => (typeof c === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c.trim()) ? normHex(c.trim()) : null);
function normHex(h) { h = h.toLowerCase(); return h.length === 4 ? `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}` : h; }
const clean = (s, n) => String(s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

// ── validation ───────────────────────────────────────────────────────────────
function normalizeDesign(text, level, errors, warnings) {
  let raw = null;
  if (text === null || text === undefined || !String(text).trim()) { errors.push('company.json is missing or empty'); raw = {}; }
  else {
    try { raw = JSON.parse(String(text).replace(/^﻿/, '')); } catch (e) { errors.push(`company.json is not valid JSON: ${e.message}`); raw = {}; }
  }
  if (!isObj(raw)) { if (raw !== null) errors.push('company.json must be a JSON object { ... }'); raw = {}; }
  const cats = R.unlockedCategories(level), dists = R.unlockedDistricts(level).filter(d => !R.DISTRICTS[d].needs), chans = R.unlockedChannels(level);
  const spec = { name: 'My Company', slogan: '', logo: { icon: 'cup', primary: DEFAULT_COLORS[0], secondary: DEFAULT_COLORS[1] }, hq: dists[0], lines: [], prices: {}, stockDays: {}, marketing: {}, rnd: {} };
  if (typeof raw.name === 'string' && clean(raw.name, 24)) spec.name = clean(raw.name, 24);
  else if (raw.name !== undefined) warnings.push('name must be a string of 1-24 characters - using "My Company"');
  else warnings.push('no "name" - using "My Company"');
  if (typeof raw.name === 'string' && raw.name.trim().length > 24) warnings.push('name is longer than 24 characters - cut');
  if (raw.slogan !== undefined) spec.slogan = clean(raw.slogan, 60);
  const lg = isObj(raw.logo) ? raw.logo : {};
  if (lg.icon !== undefined) { if (ICONS.includes(lg.icon)) spec.logo.icon = lg.icon; else warnings.push(`logo.icon "${lg.icon}" unknown - pick one of: ${ICONS.join(', ')}`); }
  if (lg.primary !== undefined) { const c = hex(lg.primary); if (c) spec.logo.primary = c; else warnings.push('logo.primary must be a hex colour like "#e8825c"'); }
  if (lg.secondary !== undefined) { const c = hex(lg.secondary); if (c) spec.logo.secondary = c; else warnings.push('logo.secondary must be a hex colour like "#fff4e0"'); }
  if (raw.hq !== undefined) {
    if (dists.includes(raw.hq)) spec.hq = raw.hq;
    else errors.push(`hq "${raw.hq}" is not an open district at level ${level} (open: ${dists.join(', ')})`);
  } else warnings.push(`no "hq" district - starting in ${R.DISTRICTS[spec.hq].name}`);
  const tier = R.startTier(level);
  const lines = Array.isArray(raw.lines) ? raw.lines : raw.lines === undefined ? [] : null;
  if (lines === null) errors.push('lines must be an array of product ids, e.g. ["food"]');
  for (const c of lines || []) {
    if (!cats.includes(c)) { warnings.push(`line "${c}" is ${R.CATEGORIES[c] ? `locked until level ${R.CATEGORIES[c].level}` : 'unknown'} - ignored`); continue; }
    if (!spec.lines.includes(c)) spec.lines.push(c);
  }
  const sellable = spec.lines.filter(c => !R.CATEGORIES[c].onlineOnly && (tier !== 'cart' || R.CATEGORIES[c].cart));
  if (!spec.lines.length) { spec.lines = [cats[0]]; warnings.push(`no product lines - starting with ${R.CATEGORIES[cats[0]].name}`); }
  else if (!sellable.length) warnings.push(`none of your lines can be sold from your starting ${R.TIERS[tier].name.toLowerCase()} - add a line it can sell`);
  if (spec.lines.some(c => R.CATEGORIES[c].onlineOnly)) warnings.push('AI Apps are sold only by an online store - open one ({ open: [{ tier: "online" }] })');
  spec.lines.sort((a, b) => R.CATEGORY_IDS.indexOf(a) - R.CATEGORY_IDS.indexOf(b));
  const numMap = (obj, name, allowed, lo, hi, unit) => {
    const out = {};
    if (obj === undefined) return out;
    if (!isObj(obj)) { errors.push(`${name} must be an object like { "${allowed[0]}": ... }`); return out; }
    for (const [k, v] of Object.entries(obj)) {
      if (!allowed.includes(k)) { warnings.push(`${name}.${k}: unknown or locked at level ${level} - ignored`); continue; }
      if (typeof v !== 'number' || !isFinite(v)) { errors.push(`${name}.${k} must be a number`); continue; }
      const L = typeof lo === 'function' ? lo(k) : lo, H = typeof hi === 'function' ? hi(k) : hi;
      if (v < L || v > H) warnings.push(`${name}.${k} = ${v} is outside ${L}-${H}${unit || ''} - clamped`);
      out[k] = Math.min(H, Math.max(L, v));
    }
    return out;
  };
  spec.prices = numMap(raw.prices, 'prices', cats, (c) => Math.round(R.CATEGORIES[c].ref * R.MODEL.minPrice * 100) / 100, (c) => R.CATEGORIES[c].ref * R.MODEL.maxPrice);
  spec.stockDays = numMap(raw.stockDays, 'stockDays', cats, 0, 30, ' days');
  spec.marketing = numMap(raw.marketing, 'marketing', chans, 0, R.START_CASH[level] * 0.05, ' $/day');
  if (raw.rnd !== undefined) {
    if (!R.has(level, 'rnd')) warnings.push('rnd unlocks at level 3 - ignored');
    else spec.rnd = numMap(raw.rnd, 'rnd', cats, 0, R.START_CASH[level] * 0.05, ' $/day');
  }
  const known = new Set(['name', 'slogan', 'logo', 'hq', 'lines', 'prices', 'stockDays', 'marketing', 'rnd', 'notes', 'comment', '_comment']);
  for (const k of Object.keys(raw)) if (!known.has(k)) warnings.push(`unknown field "${k}" in company.json - ignored (strategy.js makes the daily decisions)`);
  return spec;
}

function checkCode(bundle, errors, warnings) {
  const src = bundle.brain;
  let total = 0;
  if (src === null || src === undefined || !String(src).trim()) warnings.push('strategy.js is missing or empty - the company runs on AUTOPILOT (auto restock + staff, no growth)');
  else {
    total += Buffer.byteLength(String(src), 'utf8');
    const e = syntaxError(src, 'strategy.js', false);
    if (e) errors.push(`syntax error in ${e}`);
    else if (!/\bdecide\b|module\.exports/.test(String(src))) errors.push('strategy.js must define `function decide(state) { ... }`');
  }
  const lib = bundle.lib || {};
  const names = Object.keys(lib);
  if (names.length > R.LIMITS.libMaxFiles) errors.push(`lib/ has ${names.length} .js files (max ${R.LIMITS.libMaxFiles})`);
  for (const n of names) {
    total += Buffer.byteLength(String(lib[n] || ''), 'utf8');
    const e = syntaxError(lib[n], `lib/${libKey(n)}.js`, true);
    if (e) errors.push(`syntax error in ${e}`);
  }
  if (total > R.LIMITS.codeMaxBytes) errors.push(`strategy.js + lib/*.js are ${Math.round(total / 1000)} KB (max ${R.LIMITS.codeMaxBytes / 1000} KB)`);
}

function specFromBundle(bundle, level) {
  const errors = [], warnings = [];
  const spec = normalizeDesign(bundle && bundle.design, level, errors, warnings);
  checkCode(bundle || {}, errors, warnings);
  return { spec, errors, warnings };
}

function check(bundle, opts = {}) {
  const level = R.clampLevel(opts.level || 1);
  try {
    bundle = bundle || {};
    const { spec, errors, warnings } = specFromBundle(bundle, level);
    const name = spec.name;
    const colors = { primary: spec.logo.primary, secondary: spec.logo.secondary };
    const T = [];
    T.push(`COMPANY CHECK - level ${level} (${R.levelInfo(level).headline})`);
    T.push(`  ${name}${spec.slogan ? ` - "${spec.slogan}"` : ''}   logo: ${spec.logo.icon} ${spec.logo.primary}/${spec.logo.secondary}`);
    T.push(`  HQ: ${R.DISTRICTS[spec.hq].name} (a free ${R.TIERS[R.startTier(level)].name.toLowerCase()} opens there on day 1)   start cash ${$(R.START_CASH[level])}`);
    T.push(`  lines: ${spec.lines.map(c => `${R.CATEGORIES[c].name} ${fmtP(spec.prices[c] || R.CATEGORIES[c].ref)} (fair ${fmtP(R.CATEGORIES[c].ref)}, cost ${fmtP(R.CATEGORIES[c].cost)})`).join(', ')}`);
    const mk = Object.entries(spec.marketing).filter(([, v]) => v > 0).map(([k, v]) => `${k} $${v}/day`).join(', ');
    T.push(`  starting marketing: ${mk || 'none'}${Object.keys(spec.rnd).length ? `   R&D: ${Object.entries(spec.rnd).map(([k, v]) => `${k} $${v}/day`).join(', ')}` : ''}`);
    let smoke = null;
    if (!errors.length && bundle.brain && String(bundle.brain).trim()) {
      smoke = smokeTest(bundle, spec, level);
      if (smoke.loadError) errors.push(smoke.loadError);
      else {
        T.push(`  smoke test: 30 days vs the starter company -> net worth ${$(smoke.nw[0])} vs ${$(smoke.nw[1])}, ${smoke.stores} stores, ${smoke.customers} customers, ${smoke.ms} ms CPU`);
        if (smoke.errors) warnings.push(`strategy threw ${smoke.errors} error(s) in the 30-day smoke test - first: ${smoke.first}`);
        if (smoke.notes.length) warnings.push(`decisions the engine refused (first): ${smoke.notes.slice(0, 3).join(' | ')}`);
      }
    }
    for (const e of errors) T.push(`  ERROR: ${e}`);
    for (const w of warnings) T.push(`  warning: ${w}`);
    T.push(errors.length ? `  => NOT VALID (${errors.length} error${errors.length > 1 ? 's' : ''})` : '  => OK');
    const cardLines = [
      spec.slogan ? `"${spec.slogan}"` : `HQ ${R.DISTRICTS[spec.hq].name}`,
      `${spec.lines.map(c => `${R.CATEGORIES[c].name} ${fmtP(spec.prices[c] || R.CATEGORIES[c].ref)}`).join(' · ')}`,
      `HQ ${R.DISTRICTS[spec.hq].name} · ${bundle.brain && String(bundle.brain).trim() ? `strategy ${Math.round(Buffer.byteLength(String(bundle.brain), 'utf8') / 100) / 10} KB` : 'autopilot'}`,
    ];
    return {
      ok: errors.length === 0, errors, warnings, spec, name, colors,
      summary: `${name} · ${spec.lines.map(c => R.CATEGORIES[c].name).join(', ')} · HQ ${R.DISTRICTS[spec.hq].name}`,
      cardLines, text: T.join('\n'),
    };
  } catch (e) {
    return { ok: false, errors: [`internal check error: ${e && e.message}`], warnings: [], spec: null, name: 'Company', colors: { primary: DEFAULT_COLORS[0], secondary: DEFAULT_COLORS[1] }, summary: 'invalid', cardLines: [], text: `internal check error: ${e && e.stack}` };
  }
}
function fmtP(p) { return p >= 100 ? `$${Math.round(p)}` : `$${Number(p).toFixed(2)}`; }

function smokeTest(bundle, spec, level) {
  const strat = createStrategy(bundle.brain, { seed: 7, label: 'check', lib: bundle.lib || null, memory: null });
  if (!strat.ok) return { loadError: strat.error || 'strategy.js failed to load' };
  const sb = botBundle('starter', level);
  const other = specFromBundle(sb, level).spec;
  const os = createStrategy(sb.brain, { seed: 8, label: 'starter', lib: null });
  const out = simulateYear({ specs: [spec, other], strategies: [strat, os], level, round: level, labels: ['you', 'starter'], days: 30 });
  const co = out.companies[0];
  const notes = [];
  // re-run a single decide on day 1 to capture refused decisions (cheap)
  return {
    nw: out.result.netWorth, stores: out.stats[0].stores, customers: out.stats[0].customers, ms: Math.round(strat.stats.totalMs),
    errors: strat.stats.errors, first: strat.stats.firstErrors[0] ? `day ${strat.stats.firstErrors[0].day}: ${strat.stats.firstErrors[0].message}` : '',
    notes: notes.concat((co.noteLog || []).map(n => `day ${n.day}: ${n.text}`)),
  };
}

// ── simulate one round ───────────────────────────────────────────────────────
function simulate({ bundles, ids = ['a', 'b'], labels = ['A', 'B'], seed = 1, level = 1, round, memories } = {}) {
  level = R.clampLevel(level);
  const specs = [], strategies = [], loadErrors = [];
  for (let i = 0; i < 2; i++) {
    const b = (bundles && bundles[i]) || {};
    const c = check(b, { level });
    let spec = c.spec;
    if (!spec) spec = specFromBundle(botBundle('starter', level), level).spec;
    specs.push(spec);
    const mem = memories && memories[i] !== undefined ? memories[i] : null;
    const st = createStrategy(b.brain, { seed: ((seed >>> 0) ^ (i ? 0x9e3779b9 : 0x85ebca6b)) >>> 0, label: labels[i], lib: b.lib || null, memory: mem });
    strategies.push(st.ok ? st : null);
    loadErrors.push(st.ok ? null : st.error);
  }
  const out = simulateYear({ specs, strategies, level, round: round || level, labels, ids });
  const memOut = strategies.map((st, i) => {
    if (!st) return memories && memories[i] !== undefined ? memories[i] : null;
    const m = st.exportMemory();
    return m.json;
  });
  const brainErrors = strategies.map((st, i) => (st ? st.stats.errors : loadErrors[i] ? 1 : 0));
  out.replay.loadErrors = loadErrors;
  for (let i = 0; i < 2; i++) if (loadErrors[i] && out.replay.summary[i]) out.replay.summary[i].loadError = loadErrors[i];
  return { replay: out.replay, result: out.result, stats: out.stats, memories: memOut, brainErrors };
}

// ── report ───────────────────────────────────────────────────────────────────
function report(args) {
  try {
    let txt = buildReport(args);
    const S = args.replay && args.replay.summary && args.replay.summary[args.side];
    if (S && S.loadError) txt = `!! YOUR strategy.js DID NOT LOAD: ${S.loadError}\n!! The company ran on autopilot.\n\n${txt}`;
    return txt;
  } catch (e) {
    return `Report could not be built (${e && e.message}). Result: ${args && args.result ? args.result.text : '?'}`;
  }
}

function resultRows(stats) {
  const [a, b] = stats || [{}, {}];
  const rows = [
    ['Net worth', a.netWorth, b.netWorth, 'high'],
    ['Revenue', a.revenue, b.revenue, 'high'],
    ['Operating profit', a.profit, b.profit, 'high'],
    ['Market share %', a.marketShare, b.marketShare, 'high'],
    ['Customers', a.customers, b.customers, 'high'],
    ['Stores open', a.stores, b.stores, 'high'],
    ['Reputation', a.reputation, b.reputation, 'high'],
    ['Awareness %', a.awareness, b.awareness, 'high'],
    ['Gross margin %', a.grossMargin, b.grossMargin, 'high'],
    ['Marketing $', a.marketing, b.marketing, 'none'],
    ['Lost sales (stock)', a.lostSalesStock, b.lostSalesStock, 'low'],
    ['Lost sales (full)', a.lostSalesCapacity, b.lostSalesCapacity, 'low'],
    ['Debt', a.debt, b.debt, 'low'],
  ];
  if ((a.rnd || 0) + (b.rnd || 0) > 0) rows.push(['R&D $', a.rnd, b.rnd, 'none']);
  if ((a.acquisitions || 0) + (b.acquisitions || 0) > 0) rows.push(['Acquisitions', a.acquisitions, b.acquisitions, 'none']);
  if ((a.moonshots || 0) + (b.moonshots || 0) > 0) rows.push(['Moonshots', a.moonshots, b.moonshots, 'high']);
  if ((a.brainErrors || 0) + (b.brainErrors || 0) > 0) rows.push(['Strategy errors', a.brainErrors, b.brainErrors, 'low']);
  return rows;
}

// ── CLI extras ───────────────────────────────────────────────────────────────
function parseLevel(args, level) {
  const i = (args || []).indexOf('--level');
  if (i >= 0 && args[i + 1]) return R.clampLevel(args[i + 1]);
  const bare = (args || []).find(a => /^\d+$/.test(String(a)));
  return R.clampLevel(bare || level || 1);
}
function emit(out, text) { if (typeof out === 'function') out(text); else if (out && typeof out.write === 'function') out.write(`${text}\n`); else console.log(text); }

const commands = {
  market: {
    help: 'districts, products, stores and marketing channels at a level (--level N)',
    run(args, { level, out } = {}) {
      const lv = parseLevel(args, level);
      const L = [];
      L.push(`MARKET AT LEVEL ${lv} - ${R.levelInfo(lv).headline}`);
      L.push('');
      L.push('DISTRICTS      pop   price-sens  rent  wage  youth online  weekday/weekend  season(sp/su/au/wi)   adjacent');
      for (const d of R.unlockedDistricts(lv)) {
        const D = R.DISTRICTS[d];
        L.push(`  ${d.padEnd(11)}${String(D.pop).padStart(5)}${String(D.elas).padStart(9)}${`x${D.rent}`.padStart(9)}${`$${D.wage}`.padStart(6)}${String(D.youth).padStart(6)}${String(D.online).padStart(6)}   ${`${D.wk}/${D.we}`.padEnd(15)}  ${D.season.join('/').padEnd(20)}  ${(R.ADJ[d] || []).join(',') || '-'}${D.needs ? `  (needs ${D.needs})` : ''}`);
      }
      L.push('');
      L.push('DEMAND SHARE (shoppers per day who want each product = pop x share x seasons x weekday x events)');
      const cats = R.unlockedCategories(lv);
      L.push(`  ${''.padEnd(11)}${cats.map(c => c.padStart(9)).join('')}`);
      for (const d of R.unlockedDistricts(lv)) L.push(`  ${d.padEnd(11)}${cats.map(c => String(R.DISTRICTS[d].prefs[c]).padStart(9)).join('')}`);
      L.push('');
      L.push('PRODUCTS       fair price  unit cost  spoil/day  capacity/customer  launch   overhead/day  where');
      for (const c of cats) {
        const C = R.CATEGORIES[c];
        L.push(`  ${c.padEnd(11)}${fmtP(C.ref).padStart(9)}${fmtP(C.cost).padStart(11)}${`${Math.round(C.spoil * 1000) / 10}%`.padStart(10)}${String(C.serve).padStart(12)}${$(C.launch).padStart(14)}${`$${R.LINE_OVERHEAD(c)}`.padStart(10)}    ${C.onlineOnly ? 'online store only' : C.cart ? 'carts, stores' + (C.online ? ', online' : '') : 'shops+' + (C.online ? ', online' : '')}`);
      }
      L.push('');
      L.push('STORES         capacity  staff (max x per staff)  build (x district)  rent/day (x district)  days  presence  awareness/day');
      for (const t of R.unlockedTiers(lv)) {
        const T0 = R.TIERS[t];
        L.push(`  ${t.padEnd(11)}${String(T0.cap).padStart(8)}${`${T0.staffMax} x ${T0.perStaff}`.padStart(14)}${$(T0.build).padStart(22)}${`$${T0.rent}`.padStart(18)}${String(T0.days).padStart(10)}${String(T0.presence).padStart(10)}${String(T0.aw).padStart(12)}`);
      }
      L.push('  build factor per district = 0.5 + 0.5 x rent multiplier (Downtown x1.5, University x0.9 ...)');
      L.push('');
      L.push('MARKETING      scale($/day for 63% effect)  max gain/day  reach');
      for (const c of R.unlockedChannels(lv)) { const C = R.CHANNELS[c]; L.push(`  ${c.padEnd(12)}${String(C.scale).padStart(12)}${String(C.gain).padStart(22)}      ${C.reach}`); }
      if (R.has(lv, 'moonshots')) {
        L.push('');
        L.push(`MOONSHOTS (${R.MOONSHOT_SLOTS(lv)} funded at a time, min ${R.MOONSHOT_MIN_DAYS} days)`);
        for (const m of R.MOONSHOT_IDS) L.push(`  ${m.padEnd(11)}${$(R.MOONSHOTS[m].cost).padStart(8)}  ${R.MOONSHOTS[m].name}: ${R.MOONSHOTS[m].text}`);
      }
      L.push('');
      L.push('Example day-1 demand (shoppers who want each product today, before prices/brands):');
      for (const d of R.unlockedDistricts(lv)) L.push(`  ${d.padEnd(11)}${cats.map(c => `${c} ${Math.round(R.potential(lv, d, c, 1))}`).join('  ')}`);
      emit(out, L.join('\n'));
    },
  },
  calendar: {
    help: 'the fixed events calendar of a level (--level N)',
    run(args, { level, out } = {}) {
      const lv = parseLevel(args, level);
      const L = [`EVENTS CALENDAR - level ${lv} (120 days: spring 1-30, summer 31-60, autumn 61-90, winter 91-120; day 1 is a Monday)`];
      for (const e of R.calendarFor(lv)) L.push(`  days ${String(e.from).padStart(3)}-${String(e.to).padEnd(3)}  ${e.name.padEnd(18)} ${e.text}`);
      L.push('');
      L.push('The calendar is fixed and public: your strategy sees it as state.calendar (with the exact modifiers).');
      emit(out, L.join('\n'));
    },
  },
  levels: {
    help: 'what every level unlocks',
    run(args, { out } = {}) {
      const L = ['LEVELS (level = round number)'];
      for (let lv = 1; lv <= R.MAX_LEVEL; lv++) L.push(`  ${String(lv).padStart(2)}  ${R.levelInfo(lv).headline}\n      new: ${R.levelUnlocks(lv).join('; ')}`);
      emit(out, L.join('\n'));
    },
  },
};

module.exports = {
  id: 'business',
  name: 'Business Tycoon',
  tagline: 'Each AI builds a company and fights for the same customers - biggest net worth after a year wins.',
  maxRounds: R.MAX_LEVEL,
  designFile: 'company.json',
  brainFile: 'strategy.js',
  guideFile: 'BUSINESS_GUIDE.md',
  starter: { ...STARTER },
  levelInfo: R.levelInfo,
  levelUnlocks: R.levelUnlocks,
  check,
  simulate,
  report,
  bots: BOT_NAMES.slice(),
  botDescriptions: BOT_DESCS,
  botBundle: (name, level) => botBundle(name, level),
  resultRows,
  commands,
  // extras (not part of the contract, handy for tests)
  _rules: R, _rulesFor: rulesFor, ICONS,
};
