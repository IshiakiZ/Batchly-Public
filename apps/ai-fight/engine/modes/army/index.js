'use strict';
// Army Battle — each AI raises an army (army.json) and commands it in battle (commander.js).
// Implements the game-mode contract in engine/modes/README.md.

const fs = require('fs');
const path = require('path');
const D = require('./data');
const { createCommander, LIMITS } = require('./sandbox');
const { runBattle, ST } = require('./sim');
const { buildReport } = require('./report');

const read = (p) => { try { return fs.readFileSync(path.join(__dirname, p), 'utf8'); } catch { return null; } };
const STARTER_ARMY = read('starter/army.json');
const STARTER_COMMANDER = read('starter/commander.js');
const BOT_LIB = read('bots/botlib.js');
const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const ordinal = (n) => `${n}${[, 'st', 'nd', 'rd'][n % 100 >> 3 ^ 1 && n % 10] || 'th'}`;
const inZone = (x, y) => x >= D.DEPLOY.minX && x <= D.DEPLOY.maxX && y >= D.DEPLOY.minY && y <= D.DEPLOY.maxY;

// ── validation ───────────────────────────────────────────────────────────────
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function cleanName(v, max, fallback) {
  const s = typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
  return s || fallback;
}

/** Validate army.json text at a level. Never throws. -> { errors, warnings, spec } */
function validateDesign(text, level) {
  const L = D.clampLevel(level);
  const errors = [], warnings = [];
  let j = null;
  if (typeof text !== 'string' || !text.trim()) errors.push('army.json is missing or empty');
  else {
    try { j = JSON.parse(text.replace(/^﻿/, '')); } catch (e) { errors.push(`army.json is not valid JSON: ${e.message}`); }
    if (j !== null && (typeof j !== 'object' || Array.isArray(j))) { errors.push('army.json must be a JSON object { "name": ..., "squads": [...] }'); j = null; }
  }
  j = j || {};
  const name = cleanName(j.name, 32, 'Nameless Host');
  if (!j.name) warnings.push('no "name": your army is called "Nameless Host"');
  const colors = { primary: '#8a94b0', secondary: '#e8e0c8' };
  if (j.colors && typeof j.colors === 'object') {
    if (HEX.test(j.colors.primary || '')) colors.primary = j.colors.primary; else warnings.push('colors.primary must be "#rrggbb" - using grey');
    if (HEX.test(j.colors.secondary || '')) colors.secondary = j.colors.secondary; else warnings.push('colors.secondary must be "#rrggbb" - using cream');
  } else warnings.push('no "colors": { "primary": "#rrggbb", "secondary": "#rrggbb" } - using grey');
  let banner = String(j.banner || '').toLowerCase();
  if (!D.EMBLEMS.includes(banner)) { if (j.banner) warnings.push(`unknown banner "${String(j.banner).slice(0, 20)}" - using "star" (choose from: ${D.EMBLEMS.join(', ')})`); banner = 'star'; }
  const motto = cleanName(j.motto, 60, '');

  // general
  const gj = j.general && typeof j.general === 'object' ? j.general : {};
  const general = { name: cleanName(gj.name, 24, 'The General'), x: num(gj.x), y: num(gj.y) };
  if (general.x === null || general.y === null) { general.x = -690; general.y = 0; if (j.general) warnings.push('general: x / y missing - placed at (-690, 0)'); }
  if (!inZone(general.x, general.y)) {
    warnings.push(`general at (${general.x}, ${general.y}) is outside your deployment zone - moved inside`);
    general.x = Math.max(D.DEPLOY.minX, Math.min(D.DEPLOY.maxX, general.x)); general.y = Math.max(D.DEPLOY.minY, Math.min(D.DEPLOY.maxY, general.y));
  }

  // squads
  const unlocked = new Set(D.unitsAt(L));
  const upUnlocked = new Set(D.upgradesAt(L));
  const list = Array.isArray(j.squads) ? j.squads : [];
  if (!Array.isArray(j.squads)) errors.push('army.json needs "squads": [ { "type": "infantry", "x": -400, "y": 0 }, ... ]');
  else if (!list.length) errors.push('your army has no squads');
  const maxN = D.maxSquadsFor(L);
  if (list.length > maxN) errors.push(`${list.length} squads - at level ${L} you may field at most ${maxN}`);
  const squads = [];
  let cost = 0, legends = 0;
  const counts = {};
  list.slice(0, 16).forEach((sq, i) => {
    const tag = `squad ${i + 1}`;
    if (!sq || typeof sq !== 'object') { errors.push(`${tag}: must be an object`); return; }
    const type = String(sq.type || '').toLowerCase();
    const U = D.UNITS[type];
    if (!U) { errors.push(`${tag}: unknown type "${String(sq.type).slice(0, 20)}" (types: ${Object.keys(D.UNITS).join(', ')})`); return; }
    if (!unlocked.has(type)) { errors.push(`${tag}: ${U.name} (${type}) unlocks at level ${U.level} (this is level ${L})`); return; }
    if (U.legendary) legends++;
    counts[type] = (counts[type] || 0) + 1;
    const nm = cleanName(sq.name, 24, `${ordinal(counts[type])} ${U.name}`);
    let x = num(sq.x), y = num(sq.y);
    if (x === null || y === null) {
      x = -420 - 110 * Math.floor(i / 6); y = -275 + 110 * (i % 6);
      warnings.push(`${tag} (${nm}): x / y missing - placed at (${x}, ${y})`);
    }
    if (!inZone(x, y)) {
      const nx = Math.max(D.DEPLOY.minX, Math.min(D.DEPLOY.maxX, x)), ny = Math.max(D.DEPLOY.minY, Math.min(D.DEPLOY.maxY, y));
      warnings.push(`${tag} (${nm}): (${Math.round(x)}, ${Math.round(y)}) is outside your deployment zone (x ${D.DEPLOY.minX}..${D.DEPLOY.maxX}, y ${D.DEPLOY.minY}..${D.DEPLOY.maxY}) - moved to (${Math.round(nx)}, ${Math.round(ny)})`);
      x = nx; y = ny;
    }
    let formation = sq.formation === undefined ? U.form : String(sq.formation).toLowerCase();
    if (!D.FORMATIONS[formation]) { warnings.push(`${tag} (${nm}): unknown formation "${String(sq.formation).slice(0, 12)}" - using "${U.form}" (line, wedge, square, loose)`); formation = U.form; }
    const ups = [];
    for (const u of Array.isArray(sq.upgrades) ? sq.upgrades : sq.upgrades ? [sq.upgrades] : []) {
      const k = String(u).toLowerCase();
      if (!D.UPGRADES[k]) { errors.push(`${tag} (${nm}): unknown upgrade "${String(u).slice(0, 20)}" (upgrades: ${Object.keys(D.UPGRADES).join(', ')})`); continue; }
      if (!upUnlocked.has(k)) { errors.push(`${tag} (${nm}): upgrade "${k}" unlocks at level ${D.UPGRADES[k].level}`); continue; }
      if (U.legendary) { errors.push(`${tag} (${nm}): legendary units cannot take upgrades`); continue; }
      if (ups.includes(k)) { warnings.push(`${tag} (${nm}): upgrade "${k}" listed twice`); continue; }
      ups.push(k);
    }
    const c = D.squadCost(type, ups);
    cost += c;
    squads.push({ type, name: nm, x: Math.round(x), y: Math.round(y), formation, upgrades: ups, cost: c });
  });
  if (legends > 1) errors.push(`${legends} legendary units - an army may have only one`);
  const budget = D.budgetFor(L);
  if (cost > budget) errors.push(`army costs ${cost} points - the level ${L} budget is ${budget} (remove squads or upgrades)`);
  // terrain warnings for this round's battlefield
  const map = D.mapForRound(L);
  for (const q of squads) {
    for (const r of map.rocks) if (Math.hypot(q.x - r.x, q.y - r.y) < r.r + 10) warnings.push(`${q.name} deploys inside a rock on ${map.name} (${r.x}, ${r.y}, r ${r.r}) - it will be pushed out`);
    if (map.river && q.x >= map.river.x0 - 20 && q.x <= map.river.x1 + 20) warnings.push(`${q.name} deploys in the river on ${map.name}`);
  }
  const spec = { name, colors, banner, motto, general, squads, cost, budget, level: L };
  return { errors, warnings, spec };
}

function starterSpec(level) { return validateDesign(STARTER_ARMY, level).spec; }

// ── bots ─────────────────────────────────────────────────────────────────────
const BOTS = {
  marshal: {
    blurb: 'combined arms: steady line, archers behind, cavalry hammers on the wings', colors: ['#3a5fb0', '#e8d27a'], banner: 'lion', name: 'Royal Marshalcy', general: 'Marshal Aldric',
    legend: ['archangels', 'titan', 'dragon'], filler: ['infantry', 'archers'], ups: ['veteran', 'armored', 'banner'],
    recipe: [['front', 'shieldwall', 'infantry'], ['front', 'infantry'], ['back', 'archers'], ['front', 'spearmen', 'infantry'], ['wing', 'knights', 'cavalry'], ['back', 'archers'], ['wing', 'knights', 'cavalry'], ['back', 'mages'], ['support', 'clerics'], ['front', 'infantry'], ['rear', 'catapult'], ['wing', 'griffins']],
  },
  ironwall: {
    blurb: 'defence: shield walls and braced spears hold, archers and catapults shoot, cavalry counter-punches', colors: ['#6b6f7a', '#c0392b'], banner: 'tower', name: 'Iron Bastion', general: 'Castellan Varga',
    legend: ['titan', 'archangels', 'dragon'], filler: ['spearmen', 'archers', 'infantry'], ups: ['armored', 'banner', 'veteran'],
    recipe: [['front', 'shieldwall', 'infantry'], ['front', 'spearmen', 'infantry'], ['back', 'archers'], ['front', 'shieldwall', 'infantry'], ['back', 'archers'], ['rear', 'catapult'], ['support', 'clerics'], ['front', 'spearmen', 'infantry'], ['back', 'archers'], ['wing', 'knights', 'cavalry'], ['rear', 'catapult']],
  },
  stormriders: {
    blurb: 'speed: cavalry and flyers sweep the flanks and hunt archers, siege and the general', colors: ['#1f8a8a', '#f2f2f2'], banner: 'eagle', name: 'Storm Riders', general: 'Khan Temur',
    legend: ['dragon', 'archangels', 'titan'], filler: ['cavalry', 'infantry'], ups: ['veteran', 'armored'],
    // at most three cavalry squads until knights and griffins arrive, so the centre can hold while they ride
    recipe: [['wing', 'knights', 'cavalry', 'infantry'], ['wing', 'knights', 'cavalry', 'infantry'], ['front', 'infantry'], ['wing', 'griffins', 'archers'], ['wing', 'cavalry', 'archers'], ['back', 'archers'], ['front', 'spearmen', 'infantry'], ['wing', 'griffins', 'knights', 'infantry'], ['back', 'archers'], ['front', 'infantry']],
  },
  horde: {
    blurb: 'numbers: cheap squads advance in loose order and crash into the line together', colors: ['#8a3b1f', '#d8c060'], banner: 'skull', name: 'Grey Horde', general: 'Warlord Gruk',
    legend: ['titan', 'dragon', 'archangels'], filler: ['infantry', 'spearmen'], ups: ['veteran', 'banner'],
    // one squad of war trolls from level 9: the horde stays a sea of cheap infantry rather than a troll army
    recipe: [['front', 'beasts', 'infantry'], ['front', 'infantry'], ['front', 'infantry'], ['front', 'spearmen', 'infantry'], ['front', 'infantry'], ['back', 'archers'], ['front', 'infantry'], ['wing', 'cavalry', 'infantry'], ['front', 'spearmen', 'infantry']],
  },
  warlock: {
    blurb: 'firepower: archers, mages and catapults behind a spear screen; meteor early and often', colors: ['#5b2a86', '#ff9a3c'], banner: 'flame', name: 'Ember Covenant', general: 'Archmage Sel',
    legend: ['archangels', 'dragon', 'titan'], filler: ['archers', 'spearmen'], ups: ['veteran', 'banner', 'armored'],
    recipe: [['front', 'spearmen', 'infantry'], ['back', 'archers'], ['back', 'mages', 'archers'], ['front', 'spearmen', 'infantry'], ['back', 'archers'], ['rear', 'catapult'], ['back', 'mages'], ['support', 'clerics'], ['wing', 'cavalry'], ['rear', 'catapult'], ['back', 'archers']],
  },
};

function buildBotArmy(name, level) {
  const L = D.clampLevel(level);
  const B = BOTS[name];
  const budget = D.budgetFor(L), maxN = D.maxSquadsFor(L);
  const unlocked = new Set(D.unitsAt(L));
  const picks = [];
  let spent = 0;
  const add = (role, type) => {
    if (picks.length >= maxN) return false;
    const c = D.squadCost(type, []);
    if (spent + c > budget) return false;
    picks.push({ role, type, upgrades: [] }); spent += c; return true;
  };
  const legend = B.legend.find(t => unlocked.has(t));
  if (legend) add('legend', legend);
  for (const [role, ...types] of B.recipe) {
    const type = types.find(t => unlocked.has(t));
    if (type) add(role, type);
  }
  for (let guard = 0; guard < 20 && picks.length < maxN; guard++) {
    const type = B.filler[guard % B.filler.length];
    if (!add(type === 'archers' ? 'back' : 'front', type)) { if (!add('front', 'infantry')) break; }
  }
  // upgrades, most valuable squads first
  const ups = B.ups.filter(u => D.UPGRADES[u].level <= L);
  for (const u of ups) {
    for (const p of picks) {
      if (D.UNITS[p.type].legendary || p.upgrades.includes(u)) continue;
      if (u === 'banner' && p.role !== 'front') continue;
      const extra = Math.round(D.UNITS[p.type].cost * D.UPGRADES[u].costPct / 100);
      if (spent + extra > budget) continue;
      p.upgrades.push(u); spent += extra;
      if (u === 'banner' && p.upgrades.length) break; // one banner is enough
    }
  }
  // positions
  const byRole = {};
  for (const p of picks) (byRole[p.role] = byRole[p.role] || []).push(p);
  const place = (role, x, spacing) => {
    const list = byRole[role] || [];
    list.forEach((p, i) => { p.x = x; p.y = Math.round((i - (list.length - 1) / 2) * spacing); });
  };
  place('front', name === 'ironwall' ? -330 : -380, 112);
  place('back', -520, 120);
  place('support', -580, 110);
  place('rear', -660, 150);
  (byRole.wing || []).forEach((p, i) => { p.x = -430 - 40 * Math.floor(i / 2); p.y = (i % 2 === 0 ? -1 : 1) * Math.min(380, 280 + 70 * Math.floor(i / 2)); });
  (byRole.legend || []).forEach(p => { p.x = -470; p.y = 0; });
  const count = {};
  const squads = picks.map(p => {
    const U = D.UNITS[p.type];
    count[p.type] = (count[p.type] || 0) + 1;
    return { type: p.type, name: `${ordinal(count[p.type])} ${U.name}`, x: p.x, y: p.y, formation: U.form, upgrades: p.upgrades };
  });
  return { name: B.name, colors: { primary: B.colors[0], secondary: B.colors[1] }, banner: B.banner, motto: B.blurb, general: { name: B.general, x: -700, y: 0 }, squads };
}

function botBundle(name, level) {
  const key = BOTS[name] ? name : 'marshal';
  return {
    design: JSON.stringify(buildBotArmy(key, level), null, 2),
    brain: read(`bots/${key}.js`) || STARTER_COMMANDER,
    lib: { 'botlib.js': BOT_LIB },
  };
}

// ── check ────────────────────────────────────────────────────────────────────
function smokeTest(spec, bundle, level) {
  const cmd = createCommander(bundle.brain, { seed: 7, label: 'check', lib: bundle.lib || null });
  if (!cmd.ok) return { load: cmd.error };
  const opp = botBundle('marshal', level);
  const oppSpec = validateDesign(opp.design, level).spec;
  const oppCmd = createCommander(opp.brain, { seed: 7, label: 'bot', lib: opp.lib });
  try {
    runBattle({ specs: [spec, oppSpec], commanders: [cmd, oppCmd], level, round: level, maxTime: 10, stopAfter: 0 });
  } catch (e) { return { load: `internal error in the smoke test: ${e.message}` }; }
  return { stats: cmd.stats };
}

function describeSquad(q) {
  const U = D.UNITS[q.type];
  return `${q.name} (${U.name} x${U.size})`;
}

function check(bundle, { level = 1, smoke = true } = {}) {
  const L = D.clampLevel(level);
  const b = bundle || {};
  const { errors, warnings, spec } = validateDesign(b.design, L);
  let brainNote = '';
  if (typeof b.brain !== 'string' || !b.brain.trim()) errors.push('commander.js is missing or empty (define function command(s) { ... })');
  else if (smoke) {
    const r = smokeTest(spec.squads.length ? spec : starterSpec(L), b, L);
    if (r.load) errors.push(r.load);
    else {
      const s = r.stats;
      brainNote = `Commander: loaded OK. Smoke test (10 s vs the marshal bot): ${s.calls} calls, ${s.errors} errors, avg ${(s.totalMs / Math.max(1, s.calls)).toFixed(2)} ms, max ${s.maxMs.toFixed(1)} ms`;
      if (s.errors) {
        errors.push(`commander.js crashed in the smoke test: ${s.firstErrors.map(e => `[${e.t}s] ${e.message}`).slice(0, 3).join(' | ')}`);
      }
      if (s.maxMs > LIMITS.callTimeoutMs * 0.6) warnings.push(`command() took up to ${s.maxMs.toFixed(1)} ms - the limit is ${LIMITS.callTimeoutMs} ms per call`);
      if (s.logs.length) brainNote += `\n  console.log: ${s.logs.slice(0, 5).map(l => `[${l.t}s] ${l.text}`).join('\n               ')}`;
    }
  } else {
    const cmd = createCommander(b.brain, { seed: 7, label: 'check', lib: b.lib || null });
    if (!cmd.ok) errors.push(cmd.error);
  }
  const map = D.mapForRound(L);
  const counts = {};
  for (const q of spec.squads) counts[q.type] = (counts[q.type] || 0) + 1;
  const comp = Object.entries(counts).map(([t, n]) => `${n}x ${D.UNITS[t].name}`).join(', ');
  const soldiers = spec.squads.reduce((a, q) => a + D.UNITS[q.type].size, 0);
  const lines = [];
  lines.push(`== ARMY CHECK: ${spec.name} | level ${L} | battlefield this round: ${map.name} ==`);
  lines.push(`Budget ${spec.cost} / ${spec.budget} points | squads ${spec.squads.length} / ${D.maxSquadsFor(L)} | ${soldiers} soldiers | general ${spec.general.name} at (${spec.general.x}, ${spec.general.y})`);
  lines.push(`Colors ${spec.colors.primary} / ${spec.colors.secondary} | banner: ${spec.banner}${spec.motto ? ` | motto: "${spec.motto}"` : ''}`);
  lines.push('');
  lines.push('  id  type         name                      x     y  formation  upgrades              cost');
  spec.squads.forEach((q, i) => {
    lines.push(`  ${String(i + 1).padStart(2)}  ${q.type.padEnd(11)}  ${q.name.padEnd(24).slice(0, 24)}  ${String(q.x).padStart(5)} ${String(q.y).padStart(5)}  ${q.formation.padEnd(9)}  ${(q.upgrades.join(',') || '-').padEnd(20)}  ${String(q.cost).padStart(4)}`);
  });
  lines.push(`  99  general      ${spec.general.name.padEnd(24).slice(0, 24)}  ${String(spec.general.x).padStart(5)} ${String(spec.general.y).padStart(5)}  -          -                     free`);
  lines.push('');
  lines.push(`Unlocked at level ${L}: ${D.unitsAt(L).join(', ')} | upgrades: ${D.upgradesAt(L).join(', ') || 'none yet'} | general powers: ${D.powersAt(L).join(', ')}`);
  if (brainNote) lines.push(brainNote);
  if (warnings.length) { lines.push(''); lines.push('WARNINGS'); for (const w of warnings) lines.push(`  - ${w}`); }
  if (errors.length) { lines.push(''); lines.push('ERRORS'); for (const e of errors) lines.push(`  - ${e}`); }
  lines.push('');
  lines.push(errors.length ? 'RESULT: INVALID - fix the errors above.' : 'RESULT: VALID');
  return {
    ok: errors.length === 0, errors, warnings, spec, name: spec.name, colors: spec.colors,
    summary: `${spec.squads.length} squads · ${soldiers} soldiers · ${spec.cost}/${spec.budget} pts`,
    cardLines: [`General ${spec.general.name}`, comp || 'no squads', `${spec.cost} / ${spec.budget} points`, spec.motto ? `"${spec.motto}"` : null].filter(Boolean),
    text: lines.join('\n'),
  };
}

// ── simulate ─────────────────────────────────────────────────────────────────
function resultText(winner, method, time, sides, pct) {
  const who = (i) => `${sides[i].label}'s ${sides[i].name}`;
  if (winner === null) return `Draw - ${who(0)} and ${who(1)} ended even (${pct[0]}% vs ${pct[1]}% of their armies left)`;
  const w = who(winner), l = who(1 - winner);
  switch (method) {
    case 'GENERAL': return `${w} slew ${sides[1 - winner].label}'s general ${sides[1 - winner].general} at ${fmtTime(time)}`;
    case 'ROUT': return `${w} routed ${l} at ${fmtTime(time)}`;
    case 'ANNIHILATION': return `${w} destroyed ${l} at ${fmtTime(time)}`;
    default: return `${w} held the field at the time limit (${pct[winner]}% vs ${pct[1 - winner]}% of their armies left)`;
  }
}

function simulate({ bundles, ids = ['a', 'b'], labels = ['A', 'B'], seed = 1, level = 1, round, memories = null }) {
  const L = D.clampLevel(level);
  const R = Math.max(1, Math.floor(Number(round) || L));
  const checks = bundles.map(b => check(b || {}, { level: L, smoke: false }));
  const specs = checks.map(c => (c.ok ? c.spec : starterSpec(L)));
  const commanders = bundles.map((b, i) => createCommander(checks[i].ok ? b.brain : STARTER_COMMANDER, {
    seed: (Number(seed) >>> 0) || 1, label: String(ids[i] || `side${i}`), lib: checks[i].ok ? (b.lib || null) : null, memory: memories ? memories[i] : null,
  }));
  const out = runBattle({ specs, commanders, level: L, round: R });
  const sides = [0, 1].map(i => ({
    id: ids[i], label: labels[i], name: specs[i].name, colors: specs[i].colors, general: specs[i].general.name,
    banner: specs[i].banner, motto: specs[i].motto || '', fallback: !checks[i].ok,
  }));
  const pct = out.stats.map(s => s.valuePct);
  const { winner, method, time } = out.decided;
  const result = { winner, method, time, text: resultText(winner, method, time, sides, pct) };
  const r0 = (v) => Math.round(v);
  const replay = {
    mode: 'army', v: 1, duration: out.duration, hz: Math.round(1 / (D.TICK * D.RECORD_EVERY)), level: L, round: R,
    field: D.FIELD,
    map: { id: out.map.id, name: out.map.name, palette: out.map.palette, blurb: out.map.blurb, rocks: out.map.rocks, woods: out.map.woods, river: out.map.river },
    sides,
    squads: out.squads.map(q => ({
      side: q.side, k: q.k, type: q.type, name: q.name, gen: q.general ? 1 : 0, n0: q.n0, cost: q.cost, up: q.upgrades,
      legend: q.legendary ? 1 : 0, fly: q.fly ? 1 : 0, f0: q.form0,
      x: q.rec.x, y: q.rec.y, a: q.rec.a, n: q.rec.n, s: q.rec.s, m: q.rec.m,
      st: { dealt: r0(q.st.dealt), taken: r0(q.st.taken), kills: r0(q.st.kills), charges: q.st.charges, braced: q.st.bracedOn, stopped: q.st.stopped, volleys: q.st.volleys, fired: q.st.fired, hits: r0(q.st.hits), casts: q.st.casts, healed: r0(q.st.healed), routs: q.st.routs, rallies: q.st.rallies, melee: r0(q.st.melee), ranged: r0(q.st.ranged), magic: r0(q.st.magic), siege: r0(q.st.siege), power: r0(q.st.power), fled: q.fled ? 1 : 0, dead: q.dead ? 1 : 0, end: q.endT === null ? null : Math.round(q.endT * 10) / 10 },
    })),
    hud: out.hud,
    events: out.events,
    result,
    notes: out.orderStats.map(o => o.badNotes),
  };
  const stats = out.stats.map((s, i) => Object.assign({}, s, {
    brainCalls: commanders[i].stats.calls, brainErrors: commanders[i].stats.errors, brainMs: Math.round(commanders[i].stats.totalMs), brainMaxMs: Math.round(commanders[i].stats.maxMs * 10) / 10,
  }));
  const memOut = commanders.map(c => (c.ok ? c.exportMemory().json : null));
  // no wall-clock timings in the replay: the same inputs must give the same replay (CPU times are in stats)
  replay.brain = commanders.map(c => ({ calls: c.stats.calls, errors: c.stats.errors, timeouts: c.stats.timeouts, firstErrors: c.stats.firstErrors.slice(0, 5), logs: c.stats.logs.slice(0, 40), disabled: c.stats.disabledReason, loadError: c.stats.loadError }));
  return { replay, result, stats, memories: memOut, brainErrors: commanders.map(c => c.stats.errors) };
}

// ── host info ────────────────────────────────────────────────────────────────
function levelInfo(level) {
  const L = D.clampLevel(level);
  const map = D.mapForRound(L);
  return {
    level: L,
    headline: `Budget ${D.budgetFor(L)} · up to ${D.maxSquadsFor(L)} squads`,
    lines: [
      `Units: ${D.unitsAt(L).map(t => D.UNITS[t].name).join(', ')}`,
      `Upgrades: ${D.upgradesAt(L).join(', ') || 'none yet'} · General powers: ${D.powersAt(L).join(', ')}`,
      `Battlefield: ${map.name} - ${map.blurb}`,
    ],
  };
}
function levelUnlocks(level) {
  const L = D.clampLevel(level);
  const out = [];
  for (const [k, u] of Object.entries(D.UNITS)) if (u.level === L) out.push(`${u.name} unlocked${u.legendary ? ' (LEGENDARY)' : ''}`);
  for (const [k, u] of Object.entries(D.UPGRADES)) if (u.level === L) out.push(`"${k}" upgrade unlocked (${u.text})`);
  for (const [k, p] of Object.entries(D.POWERS)) if (p.level === L && L > 1) out.push(`general power "${k}" unlocked`);
  if (L > 1) {
    out.push(`budget ${D.budgetFor(L - 1)} -> ${D.budgetFor(L)} points`);
    if (D.maxSquadsFor(L) > D.maxSquadsFor(L - 1)) out.push(`up to ${D.maxSquadsFor(L)} squads`);
  }
  const m = D.mapForRound(L), pm = D.mapForRound(L - 1);
  if (L > 1 && m.id !== pm.id) out.push(`battlefield: ${m.name}`);
  return out;
}

function resultRows(stats) {
  const [a, b] = stats && stats.length === 2 ? stats : [{}, {}];
  const v = (s, k) => (s && Number.isFinite(s[k]) ? s[k] : 0);
  return [
    ['Army left %', v(a, 'valuePct'), v(b, 'valuePct'), 'high'],
    ['Soldiers left', v(a, 'soldiersLeft'), v(b, 'soldiersLeft'), 'high'],
    ['Enemies slain', v(a, 'enemiesSlain'), v(b, 'enemiesSlain'), 'high'],
    ['Squads lost', v(a, 'squadsDestroyed') + v(a, 'squadsFled'), v(b, 'squadsDestroyed') + v(b, 'squadsFled'), 'low'],
    ['Routs', v(a, 'routs'), v(b, 'routs'), 'low'],
    ['Charges', v(a, 'charges'), v(b, 'charges'), 'high'],
    ['Arrows that hit', v(a, 'arrowsHit'), v(b, 'arrowsHit'), 'high'],
    ['Spells & powers', v(a, 'spells'), v(b, 'spells'), 'none'],
    ['Healed', v(a, 'healed'), v(b, 'healed'), 'high'],
    ['General HP %', v(a, 'generalHpPct'), v(b, 'generalHpPct'), 'high'],
  ];
}

// ── CLI extras ───────────────────────────────────────────────────────────────
function unitsText(level) {
  const L = level ? D.clampLevel(level) : null;
  const out = [];
  out.push(`== UNITS${L ? ` (you are level ${L}: budget ${D.budgetFor(L)}, up to ${D.maxSquadsFor(L)} squads)` : ''} ==`);
  out.push('type         name            lvl  cost  size   hp  armor  melee charge speed morale  range  notes');
  for (const [k, u] of Object.entries(D.UNITS)) {
    const range = u.ranged ? u.ranged.range : u.spell ? u.spell.range : u.siege ? u.siege.range : u.breath ? u.breath.range : 0;
    const lock = L && u.level > L ? '  (locked)' : '';
    out.push(`${k.padEnd(12)} ${u.name.padEnd(15)} ${String(u.level).padStart(3)} ${String(u.cost).padStart(5)} ${String(u.size).padStart(5)} ${String(u.hp).padStart(4)} ${u.armor.toFixed(2).padStart(6)} ${u.melee.toFixed(2).padStart(6)} ${String(u.charge).padStart(6)} ${String(u.speed).padStart(5)} ${String(u.morale).padStart(6)} ${String(range || '-').padStart(6)}  ${[u.fly ? 'flies' : '', u.brace ? 'braces' : '', u.fear ? 'fear' : '', u.cleave ? 'cleave' : '', u.legendary ? 'LEGENDARY' : '', u.elite ? 'elite' : ''].filter(Boolean).join(' ')}${lock}`);
  }
  out.push(`general      ${D.GENERAL.name.padEnd(15)}   1  free     1  ${D.GENERAL.hp}   ${D.GENERAL.armor.toFixed(2)}   ${D.GENERAL.melee.toFixed(2)}     ${D.GENERAL.charge}    ${D.GENERAL.speed}    100      -  fearless, aura r${D.GENERAL.aura.radius}, regen ${D.GENERAL.regen} hp/s`);
  out.push('');
  for (const [k, u] of Object.entries(D.UNITS)) {
    out.push(`${u.name} (${k}, level ${u.level}): ${u.role}`);
    out.push(`    strong vs: ${u.strong} | weak vs: ${u.weak}`);
    if (u.ranged) out.push(`    missiles: range ${u.ranged.range} (min ${u.ranged.min}), reload ${u.ranged.reload}s, ${u.ranged.dmg} dmg per ${u.ranged.kind}, flight speed ${u.ranged.speed}`);
    if (u.spell) out.push(`    ${u.spell.name}: range ${u.spell.range}, radius ${u.spell.radius}, ${u.spell.dmg} dmg per soldier caught (ignores armor), cooldown ${u.spell.cd}s, flight ${u.spell.flight}s`);
    if (u.siege) out.push(`    boulder: range ${u.siege.min}-${u.siege.range}, radius ${u.siege.radius}, ${u.siege.dmg} dmg per soldier caught (half armor), reload ${u.siege.reload}s, flight 0.8s + distance/${u.siege.speed}`);
    if (u.breath) out.push(`    breath: range ${u.breath.range}, radius ${u.breath.radius}, ${u.breath.dmg} dmg per soldier caught, cooldown ${u.breath.cd}s`);
    if (u.stomp) out.push(`    stomp: radius ${u.stomp.radius} around the titan, ${u.stomp.dmg} dmg per enemy soldier caught + morale shock, cooldown ${u.stomp.cd}s`);
    if (u.heal) out.push(`    heals ${u.heal.hps} hp/s (shared) to friendly squads within ${u.heal.radius}; morale aura +${u.aura}/s`);
  }
  out.push('');
  out.push('UPGRADES (per squad, cost = % of the unit cost):');
  for (const [k, u] of Object.entries(D.UPGRADES)) out.push(`  ${k.padEnd(8)} level ${String(u.level).padStart(2)}  +${u.costPct}%  ${u.text}${L && u.level > L ? '  (locked)' : ''}`);
  out.push('FORMATIONS:');
  for (const [k, f] of Object.entries(D.FORMATIONS)) out.push(`  ${k.padEnd(7)} ${f.text}`);
  out.push('GENERAL POWERS (order the general, id 99: { ability: "rally" } / { ability: "meteor", target: {x, y} }):');
  for (const [k, p] of Object.entries(D.POWERS)) out.push(`  ${k.padEnd(7)} level ${String(p.level).padStart(2)}  cooldown ${p.cd}s  ${p.text}${L && p.level > L ? '  (locked)' : ''}`);
  out.push('COUNTERS (damage multiplier, attacker class -> defender class):');
  for (const [a, row] of Object.entries(D.BONUS)) {
    const cells = Object.entries(row).map(([d, m]) => `${d} x${m}`).join(', ');
    if (cells) out.push(`  ${a.padEnd(7)} ${cells}`);
  }
  out.push('  classes: ' + Object.entries(D.UNITS).map(([k, u]) => `${k}=${u.cls}`).join(', ') + ', general=hero');
  return out.join('\n');
}

function battlefieldText(round) {
  const map = D.mapForRound(round);
  const W = 80, H = 30;
  const grid = [];
  for (let r = 0; r < H; r++) {
    const row = [];
    for (let c = 0; c < W; c++) {
      const x = D.FIELD.minX + (c + 0.5) * D.FIELD.width / W, y = D.FIELD.minY + (r + 0.5) * D.FIELD.height / H;
      let ch = '.';
      if (x >= D.DEPLOY.minX && x <= D.DEPLOY.maxX && y >= D.DEPLOY.minY && y <= D.DEPLOY.maxY) ch = ':';
      if (-x >= D.DEPLOY.minX && -x <= D.DEPLOY.maxX && y >= D.DEPLOY.minY && y <= D.DEPLOY.maxY) ch = ',';
      if (map.river && x >= map.river.x0 && x <= map.river.x1) ch = map.river.fords.some(f => y >= f.y0 && y <= f.y1) ? '=' : '~';
      for (const w of map.woods) if (Math.hypot(x - w.x, y - w.y) < w.r) ch = 'T';
      for (const k of map.rocks) if (Math.hypot(x - k.x, y - k.y) < k.r) ch = '#';
      if (Math.abs(x) < D.FIELD.width / W / 2 && ch === '.') ch = '|';
      row.push(ch);
    }
    grid.push(row.join(''));
  }
  const out = [];
  out.push(`== BATTLEFIELD for round ${round}: ${map.name} (${map.id}) ==`);
  out.push(map.blurb);
  out.push(`Field x ${D.FIELD.minX}..${D.FIELD.maxX}, y ${D.FIELD.minY}..${D.FIELD.maxY} (y grows DOWNWARD: y < 0 is north). 1 char = ${D.FIELD.width / W} x ${D.FIELD.height / H} units.`);
  out.push('You always deploy on the LEFT: ":" = your deployment zone (x ' + D.DEPLOY.minX + '..' + D.DEPLOY.maxX + ', y ' + D.DEPLOY.minY + '..' + D.DEPLOY.maxY + '), "," = the enemy\'s.');
  out.push('Legend: # rock (impassable), T woods (slow, cover vs arrows, hides squads), ~ river (very slow), = ford, | centre line');
  out.push('+' + '-'.repeat(W) + '+');
  for (const r of grid) out.push('|' + r + '|');
  out.push('+' + '-'.repeat(W) + '+');
  out.push('rocks: ' + map.rocks.map(r => `(${r.x}, ${r.y}) r${r.r}`).join('  '));
  out.push('woods: ' + map.woods.map(r => `(${r.x}, ${r.y}) r${r.r}`).join('  '));
  if (map.river) out.push(`river: x ${map.river.x0}..${map.river.x1}; fords at y ${map.river.fords.map(f => `${f.y0}..${f.y1}`).join(', ')}`);
  out.push('Rotation: rounds 1,5,9 Greenvale Fields | 2,6 Silverford | 3,7 Crag Pass | 4,8 Twin Groves | 10-12 Heaven\'s Anvil');
  return out.join('\n');
}

const commands = {
  units: { help: 'the army catalogue: every unit type, upgrade, formation, general power and the counter table', run(args, { level, out }) { (out || console.log)(unitsText(level)); } },
  battlefield: { help: 'ASCII map of a round\'s battlefield with deployment zones: battlefield [round]', run(args, { level, out }) { const r = Number((args || [])[0]) || level || 1; (out || console.log)(battlefieldText(r)); } },
};

function report(opts) { return buildReport(opts); }

module.exports = {
  id: 'army',
  name: 'Army Battle',
  tagline: 'Each AI raises an army and commands it in battle: squads, formations, charges, volleys, morale - and a general to protect.',
  maxRounds: D.MAX_LEVEL,
  designFile: 'army.json',
  brainFile: 'commander.js',
  guideFile: 'ARMY_GUIDE.md',
  starter: { 'army.json': STARTER_ARMY, 'commander.js': STARTER_COMMANDER },
  levelInfo, levelUnlocks, check, simulate, report, resultRows,
  bots: Object.keys(BOTS),
  botInfo: Object.fromEntries(Object.entries(BOTS).map(([k, b]) => [k, b.blurb])),
  botBundle,
  commands,
  // for tests / tools
  _internal: { validateDesign, buildBotArmy, unitsText, battlefieldText, D },
};
