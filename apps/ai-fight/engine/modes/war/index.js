'use strict';
// Modern Warfare — each AI raises a modern army (forces.json: infantry, armour, artillery, aircraft,
// warships) and commands it in battle (commander.js). Implements the game-mode contract in
// engine/modes/README.md.

const fs = require('fs');
const path = require('path');
const D = require('./data');
const { createCommander, LIMITS } = require('./sandbox');
const { runBattle } = require('./sim');
const { buildReport } = require('./report');

const read = (p) => { try { return fs.readFileSync(path.join(__dirname, p), 'utf8'); } catch { return null; } };
const STARTER_FORCES = read('starter/forces.json');
const STARTER_COMMANDER = read('starter/commander.js');
const BOT_LIB = read('bots/botlib.js');
const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const ordinal = (n) => `${n}${[, 'st', 'nd', 'rd'][n % 100 >> 3 ^ 1 && n % 10] || 'th'}`;
const inZone = (x, y) => x >= D.DEPLOY.minX && x <= D.DEPLOY.maxX && y >= D.DEPLOY.minY && y <= D.DEPLOY.maxY;
const NAVAL_MAX_X = -40;   // ships deploy in any water on your half of the field

// ── validation ───────────────────────────────────────────────────────────────
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function cleanName(v, max, fallback) {
  const s = typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
  return s || fallback;
}
function inBlock(map, x, y, pad) { for (const b of map.blocks) if (Math.hypot(x - b.x, y - b.y) < b.r + (pad || 0)) return b; return null; }
/** nearest water point on your half (ships) */
function toOwnWater(map, x, y) {
  let best = null, bd = Infinity;
  for (const w of map.water) {
    const px = Math.max(w.x0 + 40, Math.min(Math.min(w.x1, NAVAL_MAX_X) - 40, x)), py = Math.max(w.y0 + 40, Math.min(w.y1 - 40, y));
    if (px > NAVAL_MAX_X || w.x0 > NAVAL_MAX_X) continue;
    const d = Math.hypot(px - x, py - y);
    if (d < bd) { bd = d; best = { x: Math.round(px), y: Math.round(py) }; }
  }
  return best;
}
function toLand(map, x, y) {
  for (const w of map.water) {
    if (!(x >= w.x0 && x <= w.x1 && y >= w.y0 && y <= w.y1)) continue;
    if (w.y1 - w.y0 >= D.FIELD.height - 1) return { x: Math.min(x, w.x0 - 40), y };
    return { x, y: w.y0 <= D.FIELD.minY + 1 ? w.y1 + 40 : w.y0 - 40 };
  }
  return { x, y };
}

/** Validate forces.json text at a level. Never throws. -> { errors, warnings, spec } */
function validateDesign(text, level) {
  const L = D.clampLevel(level);
  const map = D.mapForRound(L);
  const errors = [], warnings = [];
  let j = null;
  if (typeof text !== 'string' || !text.trim()) errors.push('forces.json is missing or empty');
  else {
    try { j = JSON.parse(text.replace(/^﻿/, '')); } catch (e) { errors.push(`forces.json is not valid JSON: ${e.message}`); }
    if (j !== null && (typeof j !== 'object' || Array.isArray(j))) { errors.push('forces.json must be a JSON object { "name": ..., "units": [...] }'); j = null; }
  }
  j = j || {};
  const name = cleanName(j.name, 32, 'Unnamed Battlegroup');
  if (!j.name) warnings.push('no "name": your army is called "Unnamed Battlegroup"');
  const colors = { primary: '#6b7b5a', secondary: '#e8e0c8' };
  if (j.colors && typeof j.colors === 'object') {
    if (HEX.test(j.colors.primary || '')) colors.primary = j.colors.primary; else warnings.push('colors.primary must be "#rrggbb" - using olive');
    if (HEX.test(j.colors.secondary || '')) colors.secondary = j.colors.secondary; else warnings.push('colors.secondary must be "#rrggbb" - using cream');
  } else warnings.push('no "colors": { "primary": "#rrggbb", "secondary": "#rrggbb" } - using olive');
  let emblem = String(j.emblem || j.banner || '').toLowerCase();
  if (!D.EMBLEMS.includes(emblem)) { if (j.emblem) warnings.push(`unknown emblem "${String(j.emblem).slice(0, 20)}" - using "star" (choose from: ${D.EMBLEMS.join(', ')})`); emblem = 'star'; }
  const motto = cleanName(j.motto, 60, '');

  // command post
  const hj = j.hq && typeof j.hq === 'object' ? j.hq : {};
  const hq = { name: cleanName(hj.name, 24, 'Command Post'), x: num(hj.x), y: num(hj.y) };
  if (hq.x === null || hq.y === null) { hq.x = -980; hq.y = 0; if (j.hq) warnings.push('hq: x / y missing - placed at (-980, 0)'); }
  if (!inZone(hq.x, hq.y)) {
    warnings.push(`hq at (${hq.x}, ${hq.y}) is outside your deployment zone - moved inside`);
    hq.x = Math.max(D.DEPLOY.minX, Math.min(D.DEPLOY.maxX, hq.x)); hq.y = Math.max(D.DEPLOY.minY, Math.min(D.DEPLOY.maxY, hq.y));
  }
  if (D.inWater(map, hq.x, hq.y)) { const p = toLand(map, hq.x, hq.y); warnings.push(`hq is in the water on ${map.name} - moved to (${p.x}, ${p.y})`); hq.x = p.x; hq.y = p.y; }

  // units
  const unlocked = new Set(D.unitsAt(L));
  const upUnlocked = new Set(D.upgradesAt(L));
  const list = Array.isArray(j.units) ? j.units : Array.isArray(j.squads) ? j.squads : [];
  if (!Array.isArray(j.units) && !Array.isArray(j.squads)) errors.push('forces.json needs "units": [ { "type": "riflemen", "x": -600, "y": 0 }, ... ]');
  else if (!list.length) errors.push('your army has no units');
  const maxN = D.maxUnitsFor(L);
  if (list.length > maxN) errors.push(`${list.length} units - at level ${L} you may field at most ${maxN}`);
  const units = [];
  let cost = 0, legends = 0;
  const counts = {};
  list.slice(0, 24).forEach((sq, i) => {
    const tag = `unit ${i + 1}`;
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
      x = -520 - 120 * Math.floor(i / 8); y = -420 + 120 * (i % 8);
      warnings.push(`${tag} (${nm}): x / y missing - placed at (${x}, ${y})`);
    }
    if (U.naval) {
      if (!map.water.length) { errors.push(`${tag}: ${U.name} needs water - ${map.name} (this round's battlefield) has none. Ships fight on the naval maps (rounds 8-12).`); return; }
      if (!(D.deepWater(map, x, y) && x <= NAVAL_MAX_X)) {
        const p = toOwnWater(map, x, y);
        if (!p) { errors.push(`${tag}: no water on your half of ${map.name}`); return; }
        warnings.push(`${tag} (${nm}): ships deploy in water on your half (x <= ${NAVAL_MAX_X}) - moved to (${p.x}, ${p.y})`);
        x = p.x; y = p.y;
      }
    } else {
      if (!inZone(x, y)) {
        const nx = Math.max(D.DEPLOY.minX, Math.min(D.DEPLOY.maxX, x)), ny = Math.max(D.DEPLOY.minY, Math.min(D.DEPLOY.maxY, y));
        warnings.push(`${tag} (${nm}): (${Math.round(x)}, ${Math.round(y)}) is outside your deployment zone (x ${D.DEPLOY.minX}..${D.DEPLOY.maxX}, y ${D.DEPLOY.minY}..${D.DEPLOY.maxY}) - moved to (${Math.round(nx)}, ${Math.round(ny)})`);
        x = nx; y = ny;
      }
      if (!U.fly && D.inWater(map, x, y)) { const p = toLand(map, x, y); warnings.push(`${tag} (${nm}) deploys in the water on ${map.name} - moved to (${Math.round(p.x)}, ${Math.round(p.y)})`); x = p.x; y = p.y; }
      if (!U.fly && inBlock(map, x, y, 10)) warnings.push(`${tag} (${nm}) deploys inside a building / cliff on ${map.name} - it will be pushed out`);
    }
    let formation = sq.formation === undefined ? 'line' : String(sq.formation).toLowerCase();
    if (!D.FORMATIONS[formation]) { warnings.push(`${tag} (${nm}): unknown formation "${String(sq.formation).slice(0, 12)}" - using "line" (line, column, spread)`); formation = 'line'; }
    const ups = [];
    for (const u of Array.isArray(sq.upgrades) ? sq.upgrades : sq.upgrades ? [sq.upgrades] : []) {
      const k = String(u).toLowerCase();
      if (!D.UPGRADES[k]) { errors.push(`${tag} (${nm}): unknown upgrade "${String(u).slice(0, 20)}" (upgrades: ${Object.keys(D.UPGRADES).join(', ')})`); continue; }
      if (!upUnlocked.has(k)) { errors.push(`${tag} (${nm}): upgrade "${k}" unlocks at level ${D.UPGRADES[k].level}`); continue; }
      if (U.legendary) { errors.push(`${tag} (${nm}): legendary units cannot take upgrades`); continue; }
      if (ups.includes(k)) { warnings.push(`${tag} (${nm}): upgrade "${k}" listed twice`); continue; }
      ups.push(k);
    }
    const c = D.unitCost(type, ups);
    cost += c;
    units.push({ type, name: nm, x: Math.round(x), y: Math.round(y), formation, upgrades: ups, cost: c });
  });
  if (legends > 1) errors.push(`${legends} legendary units - an army may have only one`);
  const budget = D.budgetFor(L);
  if (cost > budget) errors.push(`army costs ${cost} points - the level ${L} budget is ${budget} (remove units or upgrades)`);
  const spec = { name, colors, emblem, motto, hq, units, squads: units, cost, budget, level: L, map: map.id };
  return { errors, warnings, spec };
}

function starterSpec(level) { return validateDesign(STARTER_FORCES, level).spec; }

// ── bots ─────────────────────────────────────────────────────────────────────
// recipe entries: [role, preferred type, fallback types...] - the first unlocked type is used.
// roles: front, back, support, rear, wing, air, naval (naval entries are skipped on maps without water)
const BOTS = {
  coalition: {
    blurb: 'combined arms: infantry line, armour and helicopters, artillery behind, fighters overhead', colors: ['#5b6e3a', '#e4d7a8'], emblem: 'star', name: 'Coalition Force', hq: 'Task Force HQ',
    legend: ['mammoth', 'battleship', 'stealthbomber'], filler: ['riflemen', 'machinegun'], ups: ['veteran', 'armor', 'radio'],
    recipe: [['front', 'riflemen'], ['front', 'machinegun'], ['front', 'riflemen'], ['front', 'tank', 'rockets'], ['back', 'apc', 'riflemen'], ['rear', 'artillery', 'machinegun'], ['air', 'helicopter', 'rockets'], ['back', 'antiair', 'riflemen'],
      ['air', 'fighter'], ['naval', 'destroyer'], ['front', 'tank'], ['air', 'drone'], ['rear', 'mlrs'], ['air', 'bomber'], ['naval', 'submarine'], ['front', 'riflemen'], ['wing', 'jeep']],
  },
  ironfist: {
    blurb: 'armour: tank columns with APC support thrust through, anti-air and artillery follow', colors: ['#6b5f4a', '#f0c24b'], emblem: 'tiger', name: 'Iron Fist Division', hq: 'Panzer HQ',
    legend: ['mammoth', 'stealthbomber', 'battleship'], filler: ['riflemen', 'rockets'], ups: ['armor', 'veteran', 'radio'],
    recipe: [['wing', 'jeep', 'riflemen'], ['front', 'tank', 'rockets'], ['front', 'tank', 'riflemen'], ['front', 'apc', 'riflemen'], ['back', 'rockets', 'machinegun'], ['front', 'tank', 'riflemen'], ['back', 'antiair', 'machinegun'], ['rear', 'artillery'],
      ['front', 'tank'], ['air', 'helicopter'], ['front', 'apc'], ['naval', 'destroyer'], ['air', 'fighter'], ['front', 'tank'], ['air', 'drone']],
  },
  skycommand: {
    blurb: 'air power: gunships, jets and bombers rule the sky while a small ground force holds with AA', colors: ['#3a5f8a', '#dfe8f2'], emblem: 'wings', name: 'Sky Command', hq: 'Air Ops',
    legend: ['stealthbomber', 'battleship', 'mammoth'], filler: ['riflemen', 'machinegun'], ups: ['veteran', 'radio', 'armor'],
    recipe: [['front', 'riflemen'], ['front', 'machinegun'], ['back', 'antiair', 'rockets'], ['air', 'helicopter', 'riflemen'], ['air', 'fighter', 'jeep'], ['air', 'bomber', 'apc'], ['air', 'helicopter'], ['front', 'riflemen'],
      ['air', 'drone'], ['air', 'fighter'], ['naval', 'destroyer'], ['back', 'antiair'], ['air', 'bomber'], ['naval', 'patrolboat']],
  },
  steelrain: {
    blurb: 'firepower: dug-in infantry and snipers hold while howitzers, rocket artillery and warships pound', colors: ['#7a3b2e', '#e8d7c0'], emblem: 'crosshair', name: 'Steel Rain Battery', hq: 'Fire Control',
    legend: ['battleship', 'mammoth', 'stealthbomber'], filler: ['riflemen', 'machinegun'], ups: ['veteran', 'radio', 'armor'],
    recipe: [['front', 'riflemen'], ['front', 'machinegun'], ['front', 'rockets', 'riflemen'], ['back', 'snipers', 'machinegun'], ['rear', 'artillery', 'riflemen'], ['front', 'apc', 'riflemen'], ['rear', 'artillery'], ['back', 'antiair', 'machinegun'],
      ['rear', 'mlrs'], ['naval', 'destroyer'], ['front', 'tank'], ['rear', 'mlrs'], ['naval', 'destroyer'], ['air', 'drone']],
  },
  redtide: {
    blurb: 'numbers: waves of cheap riflemen, machine guns and rocket teams storm the line together', colors: ['#8a2b2b', '#e8c060'], emblem: 'bear', name: 'Red Tide Army', hq: 'Front HQ',
    legend: ['mammoth', 'battleship', 'stealthbomber'], filler: ['riflemen', 'rockets', 'machinegun'], ups: ['veteran', 'radio', 'armor'],
    recipe: [['front', 'riflemen'], ['front', 'riflemen'], ['front', 'machinegun'], ['front', 'rockets', 'riflemen'], ['front', 'riflemen'], ['back', 'machinegun'], ['front', 'apc', 'riflemen'], ['back', 'snipers', 'rockets'],
      ['front', 'riflemen'], ['rear', 'artillery'], ['back', 'antiair'], ['front', 'tank'], ['naval', 'patrolboat'], ['air', 'helicopter'], ['front', 'riflemen'], ['rear', 'mlrs']],
  },
};

function buildBotArmy(name, level) {
  const L = D.clampLevel(level);
  const B = BOTS[name];
  const map = D.mapForRound(L);
  const budget = D.budgetFor(L), maxN = D.maxUnitsFor(L);
  const unlocked = new Set(D.unitsAt(L));
  const picks = [];
  let spent = 0;
  const add = (role, type) => {
    if (picks.length >= maxN) return false;
    if (D.UNITS[type].naval && !map.water.length) return false;
    const c = D.unitCost(type, []);
    if (spent + c > budget) return false;
    picks.push({ role: D.UNITS[type].naval ? 'naval' : D.UNITS[type].fly ? 'air' : role, type, upgrades: [] }); spent += c; return true;
  };
  const legend = B.legend.find(t => unlocked.has(t) && !(D.UNITS[t].naval && !map.water.length));
  if (legend) add('legend', legend);
  for (const [role, ...types] of B.recipe) {
    const type = types.find(t => unlocked.has(t) && !(D.UNITS[t].naval && !map.water.length));
    if (type) add(role, type);
  }
  for (let guard = 0; guard < 30 && picks.length < maxN; guard++) {
    const want = B.filler[guard % B.filler.length];
    const type = unlocked.has(want) ? want : 'riflemen';
    if (!add(type === 'machinegun' ? 'back' : 'front', type)) { if (!add('front', 'riflemen')) break; }
  }
  const ups = B.ups.filter(u => D.UPGRADES[u].level <= L);
  for (const u of ups) {
    for (const p of picks) {
      if (D.UNITS[p.type].legendary || p.upgrades.includes(u)) continue;
      if (u === 'armor' && D.UNITS[p.type].cls === 'inf' && name !== 'redtide') continue;
      const extra = Math.round(D.UNITS[p.type].cost * D.UPGRADES[u].costPct / 100);
      if (spent + extra > budget) continue;
      p.upgrades.push(u); spent += extra;
      if (u === 'radio' && p.upgrades.length) break;   // one radio is enough
    }
  }
  // positions (own coordinates: we deploy on the left)
  const byRole = {};
  for (const p of picks) (byRole[p.role] = byRole[p.role] || []).push(p);
  const place = (role, x, spacing) => {
    const list = byRole[role] || [];
    list.forEach((p, i) => { p.x = x; p.y = Math.round((i - (list.length - 1) / 2) * spacing); });
  };
  const frontX = name === 'steelrain' ? -480 : -420;
  place('front', frontX, Math.min(140, 1100 / Math.max(1, (byRole.front || []).length)));
  place('back', frontX - 150, 150);
  place('support', frontX - 250, 150);
  // artillery and aircraft set up clear of the command post (the first thing a cruise missile hits)
  const flank = (role, x, gap) => (byRole[role] || []).forEach((p, i) => { p.x = x; p.y = (i % 2 === 0 ? -1 : 1) * (gap + Math.floor(i / 2) * 170); });
  flank('rear', -960, 300);
  flank('air', -860, 260);
  (byRole.wing || []).forEach((p, i) => { p.x = frontX - 40; p.y = (i % 2 === 0 ? -1 : 1) * 520; });
  (byRole.legend || []).forEach(p => { p.x = D.UNITS[p.type].fly ? -900 : frontX - 110; p.y = 0; });
  const navals = picks.filter(p => D.UNITS[p.type].naval);
  navals.forEach((p, i) => {
    const w = map.water[0];
    if (!w) return;
    const base = w.y1 - w.y0 >= D.FIELD.height - 1 ? { x: Math.max(w.x0 + 60, -260), y: 0 } : { x: -700, y: Math.round((w.y0 + w.y1) / 2) };
    p.x = w.y1 - w.y0 >= D.FIELD.height - 1 ? base.x + (i % 2) * 60 : base.x + i * 160;
    p.y = w.y1 - w.y0 >= D.FIELD.height - 1 ? Math.round((i - (navals.length - 1) / 2) * 200) : base.y;
  });
  // keep ground units out of water and out of buildings
  for (const p of picks) {
    if (D.UNITS[p.type].naval || D.UNITS[p.type].fly) continue;
    if (D.inWater(map, p.x, p.y)) { const q = toLand(map, p.x, p.y); p.x = Math.round(q.x); p.y = Math.round(q.y); }
    for (let k = 0; k < 6 && inBlock(map, p.x, p.y, 20); k++) p.x -= 60;
  }
  const count = {};
  const units = picks.map(p => {
    const U = D.UNITS[p.type];
    count[p.type] = (count[p.type] || 0) + 1;
    // Red Tide's foot soldiers spread out once artillery and bombs are in play
    const formation = name === 'redtide' && U.cls === 'inf' && L >= 5 ? 'spread' : 'line';
    return { type: p.type, name: `${ordinal(count[p.type])} ${U.name}`, x: p.x, y: p.y, formation, upgrades: p.upgrades };
  });
  return { name: B.name, colors: { primary: B.colors[0], secondary: B.colors[1] }, emblem: B.emblem, motto: B.blurb, hq: { name: B.hq, x: -1020, y: 0 }, units };
}

function botBundle(name, level) {
  const key = BOTS[name] ? name : 'coalition';
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
  const opp = botBundle('coalition', level);
  const oppSpec = validateDesign(opp.design, level).spec;
  const oppCmd = createCommander(opp.brain, { seed: 7, label: 'bot', lib: opp.lib });
  try {
    runBattle({ specs: [spec, oppSpec], commanders: [cmd, oppCmd], level, round: level, maxTime: 10, stopAfter: 0 });
  } catch (e) { return { load: `internal error in the smoke test: ${e.message}` }; }
  return { stats: cmd.stats };
}

function check(bundle, { level = 1, smoke = true } = {}) {
  const L = D.clampLevel(level);
  const b = bundle || {};
  const { errors, warnings, spec } = validateDesign(b.design, L);
  let brainNote = '';
  if (typeof b.brain !== 'string' || !b.brain.trim()) errors.push('commander.js is missing or empty (define function command(s) { ... })');
  else if (smoke) {
    const r = smokeTest(spec.units.length ? spec : starterSpec(L), b, L);
    if (r.load) errors.push(r.load);
    else {
      const s = r.stats;
      brainNote = `Commander: loaded OK. Smoke test (10 s vs the coalition bot): ${s.calls} calls, ${s.errors} errors, avg ${(s.totalMs / Math.max(1, s.calls)).toFixed(2)} ms, max ${s.maxMs.toFixed(1)} ms`;
      if (s.errors) errors.push(`commander.js crashed in the smoke test: ${s.firstErrors.map(e => `[${e.t}s] ${e.message}`).slice(0, 3).join(' | ')}`);
      if (s.maxMs > LIMITS.callTimeoutMs * 0.6) warnings.push(`command() took up to ${s.maxMs.toFixed(1)} ms - the limit is ${LIMITS.callTimeoutMs} ms per call`);
      if (s.logs.length) brainNote += `\n  console.log: ${s.logs.slice(0, 5).map(l => `[${l.t}s] ${l.text}`).join('\n               ')}`;
    }
  } else {
    const cmd = createCommander(b.brain, { seed: 7, label: 'check', lib: b.lib || null });
    if (!cmd.ok) errors.push(cmd.error);
  }
  const map = D.mapForRound(L);
  const counts = {};
  for (const q of spec.units) counts[q.type] = (counts[q.type] || 0) + 1;
  const comp = Object.entries(counts).map(([t, n]) => `${n}x ${D.UNITS[t].name}`).join(', ');
  const domains = { ground: 0, air: 0, naval: 0 };
  for (const q of spec.units) domains[D.UNITS[q.type].domain]++;
  const lines = [];
  lines.push(`== FORCES CHECK: ${spec.name} | level ${L} | battlefield this round: ${map.name}${map.naval ? ' (naval)' : ''} ==`);
  lines.push(`Budget ${spec.cost} / ${spec.budget} points | units ${spec.units.length} / ${D.maxUnitsFor(L)} (${domains.ground} ground, ${domains.air} air, ${domains.naval} naval) | command post "${spec.hq.name}" at (${spec.hq.x}, ${spec.hq.y})`);
  lines.push(`Colors ${spec.colors.primary} / ${spec.colors.secondary} | emblem: ${spec.emblem}${spec.motto ? ` | motto: "${spec.motto}"` : ''}`);
  lines.push('');
  lines.push('  id  type           name                       x     y  formation  upgrades             cost');
  spec.units.forEach((q, i) => {
    lines.push(`  ${String(i + 1).padStart(2)}  ${q.type.padEnd(13)}  ${q.name.padEnd(24).slice(0, 24)}  ${String(q.x).padStart(5)} ${String(q.y).padStart(5)}  ${q.formation.padEnd(9)}  ${(q.upgrades.join(',') || '-').padEnd(19)}  ${String(q.cost).padStart(4)}`);
  });
  lines.push(`  99  hq             ${spec.hq.name.padEnd(24).slice(0, 24)}  ${String(spec.hq.x).padStart(5)} ${String(spec.hq.y).padStart(5)}  -          -                    free`);
  lines.push('');
  lines.push(`Unlocked at level ${L}: ${D.unitsAt(L).join(', ')} | upgrades: ${D.upgradesAt(L).join(', ') || 'none yet'} | support powers: ${D.powersAt(L).join(', ')}`);
  if (brainNote) lines.push(brainNote);
  if (warnings.length) { lines.push(''); lines.push('WARNINGS'); for (const w of warnings) lines.push(`  - ${w}`); }
  if (errors.length) { lines.push(''); lines.push('ERRORS'); for (const e of errors) lines.push(`  - ${e}`); }
  lines.push('');
  lines.push(errors.length ? 'RESULT: INVALID - fix the errors above.' : 'RESULT: VALID');
  return {
    ok: errors.length === 0, errors, warnings, spec, name: spec.name, colors: spec.colors,
    summary: `${spec.units.length} units · ${domains.air} air · ${domains.naval} naval · ${spec.cost}/${spec.budget} pts`,
    cardLines: [`Command post: ${spec.hq.name}`, comp || 'no units', `${spec.cost} / ${spec.budget} points`, spec.motto ? `"${spec.motto}"` : null].filter(Boolean),
    text: lines.join('\n'),
  };
}

// ── simulate ─────────────────────────────────────────────────────────────────
function resultText(winner, method, time, sides, pct) {
  const who = (i) => `${sides[i].label}'s ${sides[i].name}`;
  if (winner === null) return `Draw - ${who(0)} and ${who(1)} ended even (${pct[0]}% vs ${pct[1]}% of their forces left)`;
  const w = who(winner), l = who(1 - winner);
  switch (method) {
    case 'HQ': return `${w} destroyed ${sides[1 - winner].label}'s command post at ${fmtTime(time)}`;
    case 'ROUT': return `${w} broke ${l} at ${fmtTime(time)}`;
    case 'ANNIHILATION': return `${w} wiped out ${l} at ${fmtTime(time)}`;
    default: return `${w} held the field at the time limit (${pct[winner]}% vs ${pct[1 - winner]}% of their forces left)`;
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
    id: ids[i], label: labels[i], name: specs[i].name, colors: specs[i].colors, hq: specs[i].hq.name,
    emblem: specs[i].emblem, motto: specs[i].motto || '', fallback: !checks[i].ok,
  }));
  const pct = out.stats.map(s => s.valuePct);
  const { winner, method, time } = out.decided;
  const result = { winner, method, time, text: resultText(winner, method, time, sides, pct) };
  const r0 = (v) => Math.round(v);
  const m = out.map;
  const replay = {
    mode: 'war', v: 1, duration: out.duration, hz: Math.round(1 / (D.TICK * D.RECORD_EVERY)), level: L, round: R,
    field: D.FIELD,
    map: { id: m.id, name: m.name, palette: m.palette, blurb: m.blurb, naval: !!m.naval, towns: m.towns, forests: m.forests, blocks: m.blocks, water: m.water, bridges: m.bridges },
    sides,
    units: out.units.map(q => ({
      side: q.side, k: q.k, type: q.type, name: q.name, hq: q.hq ? 1 : 0, n0: q.n0, cost: q.cost, up: q.upgrades,
      legend: q.legendary ? 1 : 0, fly: q.fly ? 1 : 0, jet: q.jet ? 1 : 0, naval: q.naval ? 1 : 0, f0: q.form0,
      x: q.rec.x, y: q.rec.y, a: q.rec.a, n: q.rec.n, s: q.rec.s, m: q.rec.m, f: q.rec.f,
      st: { dealt: r0(q.st.dealt), taken: r0(q.st.taken), kills: r0(q.st.kills), shots: r0(q.st.shots), hits: r0(q.st.hits), shells: q.st.shells, bombs: q.st.bombs, missiles: q.st.missiles, torpedoes: q.st.torpedoes, sorties: q.st.sorties, casts: q.st.casts, routs: q.st.routs, rallies: q.st.rallies, lost: q.st.lost, fled: q.fled ? 1 : 0, dead: q.dead ? 1 : 0, end: q.endT === null ? null : Math.round(q.endT * 10) / 10 },
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
    headline: `Budget ${D.budgetFor(L)} · up to ${D.maxUnitsFor(L)} units`,
    lines: [
      `Units: ${D.unitsAt(L).map(t => D.UNITS[t].name).join(', ')}`,
      `Upgrades: ${D.upgradesAt(L).join(', ') || 'none yet'} · Support powers: ${D.powersAt(L).join(', ')}`,
      `Battlefield: ${map.name}${map.naval ? ' (naval)' : ''} - ${map.blurb}`,
    ],
  };
}
function levelUnlocks(level) {
  const L = D.clampLevel(level);
  const out = [];
  for (const [, u] of Object.entries(D.UNITS)) if (u.level === L) out.push(`${u.name} unlocked${u.legendary ? ' (LEGENDARY)' : ''}`);
  for (const [k, u] of Object.entries(D.UPGRADES)) if (u.level === L) out.push(`"${k}" upgrade unlocked (${u.text})`);
  for (const [k, p] of Object.entries(D.POWERS)) if (p.level === L && L > 1) out.push(`support power "${k}" unlocked`);
  if (L > 1) {
    out.push(`budget ${D.budgetFor(L - 1)} -> ${D.budgetFor(L)} points`);
    if (D.maxUnitsFor(L) > D.maxUnitsFor(L - 1)) out.push(`up to ${D.maxUnitsFor(L)} units`);
  }
  const mp = D.mapForRound(L), pm = D.mapForRound(L - 1);
  if (L > 1 && mp.id !== pm.id) out.push(`battlefield: ${mp.name}${mp.naval ? ' (naval: ships can fight)' : ''}`);
  return out;
}

function resultRows(stats) {
  const [a, b] = stats && stats.length === 2 ? stats : [{}, {}];
  const v = (s, k) => (s && Number.isFinite(s[k]) ? s[k] : 0);
  return [
    ['Forces left %', v(a, 'valuePct'), v(b, 'valuePct'), 'high'],
    ['Units left', v(a, 'unitsLeft'), v(b, 'unitsLeft'), 'high'],
    ['Soldiers lost', v(a, 'soldiersLost'), v(b, 'soldiersLost'), 'low'],
    ['Vehicles lost', v(a, 'vehiclesLost'), v(b, 'vehiclesLost'), 'low'],
    ['Aircraft lost', v(a, 'aircraftLost'), v(b, 'aircraftLost'), 'low'],
    ['Ships lost', v(a, 'shipsLost'), v(b, 'shipsLost'), 'low'],
    ['Shells & bombs', v(a, 'shells') + v(a, 'bombs'), v(b, 'shells') + v(b, 'bombs'), 'none'],
    ['Missiles & rockets', v(a, 'missiles'), v(b, 'missiles'), 'none'],
    ['Sorties flown', v(a, 'sorties'), v(b, 'sorties'), 'none'],
    ['Command post HP %', v(a, 'hqHpPct'), v(b, 'hqHpPct'), 'high'],
  ];
}

// ── CLI extras ───────────────────────────────────────────────────────────────
function unitsText(level) {
  const L = level ? D.clampLevel(level) : null;
  const out = [];
  out.push(`== UNITS${L ? ` (you are level ${L}: budget ${D.budgetFor(L)}, up to ${D.maxUnitsFor(L)} units)` : ''} ==`);
  out.push('type           name                 lvl  cost domain  class  size    hp armor speed morale  notes');
  for (const [k, u] of Object.entries(D.UNITS)) {
    const lock = L && u.level > L ? '  (locked)' : '';
    out.push(`${k.padEnd(14)} ${u.name.padEnd(20)} ${String(u.level).padStart(3)} ${String(u.cost).padStart(5)} ${u.domain.padEnd(7)} ${u.cls.padEnd(6)} ${String(u.size).padStart(4)} ${String(u.hp).padStart(5)} ${u.armor.toFixed(2).padStart(5)} ${String(u.speed).padStart(5)} ${String(u.morale).padStart(6)}  ${[u.jet ? 'jet' : u.fly ? 'flies' : '', u.stealth ? 'stealth' : '', u.spotter ? `spots ${u.spotter}` : '', u.legendary ? 'LEGENDARY' : '', u.fearless ? 'fearless' : ''].filter(Boolean).join(' ')}${lock}`);
  }
  const H = D.HQ;
  out.push(`hq             ${H.name.padEnd(20)}   1  free ground  hq        1 ${String(H.hp).padStart(5)} ${H.armor.toFixed(2).padStart(5)} ${String(H.speed).padStart(5)}    100  aura r${H.aura.radius}, regen ${H.regen} hp/s, support powers`);
  out.push('');
  const wtxt = (w) => `${w.name} (${w.kind}): range ${w.min ? `${w.min}-` : ''}${w.range}, ${w.dmg} dmg per element per shot, reload ${w.reload}s, accuracy ${Math.round(w.acc * 100)}%${w.move === 0 ? ', must stand still' : w.move !== undefined && w.move < 1 ? `, ${Math.round(w.move * 100)}% accuracy on the move` : ''}${w.radius ? `, blast radius ${w.radius}` : ''}${w.ammo ? `, ${w.ammo} per sortie` : ''}${w.air ? ', aircraft only' : ''}${w.supp ? ', suppresses' : ''}`;
  for (const [k, u] of Object.entries(D.UNITS)) {
    out.push(`${u.name} (${k}, level ${u.level}): ${u.role}`);
    out.push(`    strong vs: ${u.strong} | weak vs: ${u.weak}`);
    for (const w of u.weapons) out.push(`    - ${wtxt(w)}`);
  }
  out.push(`Command Post (hq, id 99): ${D.HQ.role}`);
  for (const w of D.HQ.weapons) out.push(`    - ${wtxt(w)}`);
  out.push('');
  out.push('DAMAGE TABLE (multiplier of each weapon kind against each armour class; 0 = cannot hurt it):');
  const classes = ['inf', 'light', 'heavy', 'heli', 'jet', 'ship', 'sub', 'hq'];
  out.push(`  ${'kind'.padEnd(11)} ${classes.map(c => c.padStart(6)).join('')}`);
  for (const [k, row] of Object.entries(D.VS)) out.push(`  ${k.padEnd(11)} ${classes.map(c => String(row[c]).padStart(6)).join('')}`);
  out.push('  classes: ' + Object.entries(D.UNITS).map(([k, u]) => `${k}=${u.cls}`).join(', ') + ', hq=hq');
  out.push('');
  out.push('UPGRADES (per unit, cost = % of the unit cost):');
  for (const [k, u] of Object.entries(D.UPGRADES)) out.push(`  ${k.padEnd(8)} level ${String(u.level).padStart(2)}  +${u.costPct}%  ${u.text}${L && u.level > L ? '  (locked)' : ''}`);
  out.push('FORMATIONS (ground units):');
  for (const [k, f] of Object.entries(D.FORMATIONS)) out.push(`  ${k.padEnd(7)} ${f.text}`);
  out.push(`COVER: towns - infantry takes ${Math.round(100 * D.COVER.town.inf)}%, vehicles ${Math.round(100 * D.COVER.town.veh)}%; forests - infantry ${Math.round(100 * D.COVER.forest.inf)}%, vehicles ${Math.round(100 * D.COVER.forest.veh)}% (and vehicles crawl); infantry standing still ${D.COVER.dug.after} s digs in (${Math.round(100 * D.COVER.dug.taken)}%).`);
  out.push('SUPPORT POWERS (order the command post, id 99: { ability: "rally" } / { ability: "barrage", target: {x, y} }):');
  for (const [k, p] of Object.entries(D.POWERS)) out.push(`  ${k.padEnd(9)} level ${String(p.level).padStart(2)}  cooldown ${p.cd}s  ${p.text}${L && p.level > L ? '  (locked)' : ''}`);
  return out.join('\n');
}

function battlefieldText(round) {
  const map = D.mapForRound(round);
  const W = 96, H = 30;
  const grid = [];
  for (let r = 0; r < H; r++) {
    const row = [];
    for (let c = 0; c < W; c++) {
      const x = D.FIELD.minX + (c + 0.5) * D.FIELD.width / W, y = D.FIELD.minY + (r + 0.5) * D.FIELD.height / H;
      let ch = '.';
      if (x >= D.DEPLOY.minX && x <= D.DEPLOY.maxX && y >= D.DEPLOY.minY && y <= D.DEPLOY.maxY) ch = ':';
      if (-x >= D.DEPLOY.minX && -x <= D.DEPLOY.maxX && y >= D.DEPLOY.minY && y <= D.DEPLOY.maxY) ch = ',';
      for (const w of map.forests) if (Math.hypot(x - w.x, y - w.y) < w.r) ch = 'T';
      for (const w of map.towns) if (Math.hypot(x - w.x, y - w.y) < w.r) ch = 'H';
      if (D.deepWater(map, x, y)) ch = D.onBridge(map, x, y) ? '=' : '~';
      for (const k of map.blocks) if (Math.hypot(x - k.x, y - k.y) < k.r) ch = '#';
      if (Math.abs(x) < D.FIELD.width / W / 2 && ch === '.') ch = '|';
      row.push(ch);
    }
    grid.push(row.join(''));
  }
  const out = [];
  out.push(`== BATTLEFIELD for round ${round}: ${map.name} (${map.id})${map.naval ? ' - NAVAL' : ''} ==`);
  out.push(map.blurb);
  out.push(`Field x ${D.FIELD.minX}..${D.FIELD.maxX}, y ${D.FIELD.minY}..${D.FIELD.maxY} (y grows DOWNWARD: y < 0 is north). 1 char = ${D.FIELD.width / W} x ${D.FIELD.height / H} units.`);
  out.push('You always deploy on the LEFT: ":" = your deployment zone (x ' + D.DEPLOY.minX + '..' + D.DEPLOY.maxX + ', y ' + D.DEPLOY.minY + '..' + D.DEPLOY.maxY + '), "," = the enemy\'s. Ships deploy in water with x <= ' + NAVAL_MAX_X + '.');
  out.push('Legend: H town (cover), T forest (cover, slows vehicles), # building / cliff (impassable), ~ water (ships only), = bridge / causeway, | centre line');
  out.push('+' + '-'.repeat(W) + '+');
  for (const r of grid) out.push('|' + r + '|');
  out.push('+' + '-'.repeat(W) + '+');
  if (map.towns.length) out.push('towns: ' + map.towns.map(r => `(${r.x}, ${r.y}) r${r.r}`).join('  '));
  if (map.forests.length) out.push('forests: ' + map.forests.map(r => `(${r.x}, ${r.y}) r${r.r}`).join('  '));
  if (map.blocks.length) out.push('buildings / cliffs: ' + map.blocks.map(r => `(${r.x}, ${r.y}) r${r.r}`).join('  '));
  if (map.water.length) out.push('water: ' + map.water.map(w => `x ${w.x0}..${w.x1} y ${w.y0}..${w.y1}`).join('  ') + (map.bridges.length ? ` | bridges: ${map.bridges.map(b => `y ${b.y0}..${b.y1}`).join(', ')}` : ''));
  out.push('Rotation: rounds 1,5 Farmland | 2,6 River Town | 3,7 Desert Storm | 4 City Siege | 8,10,12 Coastal Assault | 9,11 Island Chain');
  return out.join('\n');
}

const commands = {
  units: { help: 'the full catalogue: every unit, weapon, the damage table, upgrades, formations, cover and support powers', run(args, { level, out }) { (out || console.log)(unitsText(level)); } },
  battlefield: { help: 'ASCII map of a round\'s battlefield with deployment zones: battlefield [round]', run(args, { level, out }) { const r = Number((args || [])[0]) || level || 1; (out || console.log)(battlefieldText(r)); } },
};

function report(opts) { return buildReport(opts); }

module.exports = {
  id: 'war',
  name: 'Modern Warfare',
  tagline: 'Each AI raises a modern army - infantry, tanks, artillery, helicopters, jets and warships - and commands it in battle. Protect your command post.',
  maxRounds: D.MAX_LEVEL,
  designFile: 'forces.json',
  brainFile: 'commander.js',
  guideFile: 'WAR_GUIDE.md',
  starter: { 'forces.json': STARTER_FORCES, 'commander.js': STARTER_COMMANDER },
  levelInfo, levelUnlocks, check, simulate, report, resultRows,
  bots: Object.keys(BOTS),
  botInfo: Object.fromEntries(Object.entries(BOTS).map(([k, b]) => [k, b.blurb])),
  botBundle,
  commands,
  _internal: { validateDesign, buildBotArmy, unitsText, battlefieldText, D, BOTS },
};
