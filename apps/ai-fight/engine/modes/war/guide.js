'use strict';
// Builds WAR_GUIDE.md (project root) from guide.md.tpl + the live numbers in data.js.
// Run after changing any number:  node engine/modes/war/guide.js

const fs = require('fs');
const path = require('path');
const D = require('./data');

function table(head, rows) {
  const out = [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`];
  for (const r of rows) out.push(`| ${r.join(' | ')} |`);
  return out.join('\n');
}

const KIND_TEXT = {
  rifle: 'rifles', mg: 'machine gun', sniper: 'sniper rifle', autocannon: 'autocannon', rocket: 'anti-tank rocket',
  cannon: 'tank cannon', missile: 'guided missile', shell: 'shells (area)', bomb: 'bombs (area)', aa: 'anti-air missile', torpedo: 'torpedo',
};

function weaponLine(w) {
  const bits = [`${w.name}: ${KIND_TEXT[w.kind] || w.kind}`, `range ${w.min ? `${w.min}-` : ''}${w.range}`, `reload ${w.reload} s`, `${w.dmg} dmg`];
  if (w.acc !== undefined && !D.AREA_KINDS[w.kind]) bits.push(`accuracy ${w.acc}`);
  if (w.radius) bits.push(`blast radius ${w.radius}`);
  if (w.ammo) bits.push(`${w.ammo} per sortie`);
  if (w.move === 0) bits.push('must stand still');
  else if (w.move !== undefined && w.move < 1) bits.push(`x${w.move} on the move`);
  if (w.air) bits.push('also hits aircraft');
  if (w.salvo) bits.push('salvo');
  return bits.join(', ');
}

function blocks() {
  const levels = table(['Level', 'Budget', 'Max units', 'New this level', 'Battlefield'], Array.from({ length: D.MAX_LEVEL }, (_, i) => {
    const L = i + 1;
    const nu = [];
    for (const [, u] of Object.entries(D.UNITS)) if (u.level === L) nu.push(u.name + (u.legendary ? ' (legendary)' : ''));
    for (const [k, u] of Object.entries(D.UPGRADES)) if (u.level === L) nu.push(`upgrade *${k}*`);
    for (const [k, p] of Object.entries(D.POWERS)) if (p.level === L) nu.push(`power *${k}*`);
    return [L, D.budgetFor(L), D.maxUnitsFor(L), nu.join(', ') || '-', D.mapForRound(L).name];
  }));
  const units = table(['type', 'name', 'lvl', 'cost', 'elements', 'hp each', 'armor', 'speed', 'morale', 'class', 'range', 'notes'],
    Object.entries(D.UNITS).map(([k, u]) => {
      const range = u.weapons.reduce((m, w) => Math.max(m, w.range), 0);
      const notes = [u.jet ? 'jet (sorties)' : u.fly ? 'flies' : '', u.naval ? 'ship (water only)' : '', u.stealth ? 'stealth' : '', u.spotter ? `spotter ${u.spotter}` : '', u.fearless ? 'fearless' : '', u.legendary ? 'legendary' : ''].filter(Boolean).join(', ');
      return ['`' + k + '`', u.name, u.level, u.cost, u.size, u.hp, u.armor, u.speed, u.morale, u.cls, range, notes || '-'];
    }));
  const roles = Object.entries(D.UNITS).map(([k, u]) => `- **${u.name}** (\`${k}\`, level ${u.level}): ${u.role} *Strong vs* ${u.strong}. *Weak vs* ${u.weak}.\n  ${u.weapons.map(w => '`' + weaponLine(w) + '`').join('; ')}`).join('\n');
  const classes = ['inf', 'light', 'heavy', 'heli', 'jet', 'ship', 'sub', 'hq'];
  const vs = table(['weapon \\ target', ...classes], Object.entries(D.VS).map(([kind, row]) => ['`' + kind + '`', ...classes.map(c => (row[c] ? row[c] : '-'))]));
  const classList = Object.entries(D.UNITS).map(([k, u]) => `${k} = ${u.cls}`).join(', ') + ', command post = hq';
  const upgrades = table(['upgrade', 'level', 'cost', 'effect'], Object.entries(D.UPGRADES).map(([k, u]) => ['`' + k + '`', u.level, `+${u.costPct}% of the unit cost`, u.text]));
  const forms = table(['formation', 'effect'], Object.entries(D.FORMATIONS).map(([k, f]) => ['`' + k + '`', f.text]));
  const powers = table(['power', 'level', 'cooldown', 'effect'], Object.entries(D.POWERS).map(([k, p]) => ['`' + k + '`', p.level, `${p.cd} s`, p.text]));
  const C = D.COVER;
  const cover = table(['where', 'direct fire taken', 'shells / bombs taken', 'speed'], [
    ['town', `infantry x${C.town.inf}, vehicles x${C.town.veh}`, `infantry x${C.town.inf}, vehicles x${C.town.veh}`, `infantry x${C.town.speedInf}, vehicles x${C.town.speedVeh}`],
    ['forest', `infantry x${C.forest.inf}, vehicles x${C.forest.veh}`, `infantry x${C.forest.inf}, vehicles x${C.forest.veh}`, `infantry x${C.forest.speedInf}, vehicles x${C.forest.speedVeh}`],
    [`dug in (infantry that stood still ${C.dug.after} s)`, `x${C.dug.taken}`, `x${C.dug.taken}`, '-'],
    ['smoke', `x${C.smoke.direct} (and hidden beyond 150)`, 'x1', '-'],
  ]);
  const rect = (r) => `x ${r.x0}..${r.x1}, y ${r.y0}..${r.y1}`;
  const circ = (list) => list.map(c => `(${c.x}, ${c.y}) r${c.r}`).join(', ') || 'none';
  const maps = D.MAPS.map(m => {
    const parts = [`towns ${circ(m.towns)}`, `forests ${circ(m.forests)}`];
    if (m.blocks.length) parts.push(`buildings / cliffs (impassable) ${circ(m.blocks)}`);
    if (m.water.length) parts.push(`water ${m.water.map(rect).join('; ')}`);
    if (m.bridges.length) parts.push(`bridges / causeways ${m.bridges.map(rect).join('; ')}`);
    return `- **${m.name}** (\`${m.id}\`${m.naval ? ', naval' : ''}): ${m.blurb}\n  ${parts.join('; ')}.`;
  }).join('\n');
  const H = D.HQ;
  return {
    LEVELS: levels, UNITS: units, ROLES: roles, VS: vs, CLASSES: classList, UPGRADES: upgrades, FORMATIONS: forms, POWERS: powers,
    COVER: cover, MAPS: maps,
    HQ: `${H.hp} HP, armor ${H.armor}, speed ${H.speed}, a defence machine gun (range ${H.weapons[0].range}), repairs ${H.regen} HP/s when it has not been hurt for 3 s, fearless`,
    AURA: H.aura.radius, BUDGET1: D.budgetFor(1), UNITS1: D.maxUnitsFor(1), TIME: D.BATTLE_TIME, REARM: D.REARM_TIME,
    DEPLOY: `x ${D.DEPLOY.minX}..${D.DEPLOY.maxX}, y ${D.DEPLOY.minY}..${D.DEPLOY.maxY}`,
    FIELD: `x ${D.FIELD.minX}..${D.FIELD.maxX}, y ${D.FIELD.minY}..${D.FIELD.maxY}`,
    EMBLEMS: D.EMBLEMS.join(', '),
  };
}

function buildGuide() {
  const tpl = fs.readFileSync(path.join(__dirname, 'guide.md.tpl'), 'utf8');
  const b = blocks();
  return tpl.replace(/\{\{(\w+)\}\}/g, (m, k) => (b[k] !== undefined ? String(b[k]) : m));
}

if (require.main === module) {
  const out = path.join(__dirname, '..', '..', '..', 'WAR_GUIDE.md');
  fs.writeFileSync(out, buildGuide());
  console.log(`wrote ${out}`);
}

module.exports = { buildGuide };
