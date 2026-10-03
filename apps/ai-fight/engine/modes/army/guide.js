'use strict';
// Builds ARMY_GUIDE.md (project root) from guide.md.tpl + the live numbers in data.js.
// Run after changing any number:  node engine/modes/army/guide.js

const fs = require('fs');
const path = require('path');
const D = require('./data');

function table(head, rows) {
  const out = [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`];
  for (const r of rows) out.push(`| ${r.join(' | ')} |`);
  return out.join('\n');
}

function blocks() {
  const levels = table(['Level', 'Budget', 'Max squads', 'New this level', 'Battlefield'], Array.from({ length: D.MAX_LEVEL }, (_, i) => {
    const L = i + 1;
    const nu = [];
    for (const [, u] of Object.entries(D.UNITS)) if (u.level === L) nu.push(u.name + (u.legendary ? ' (legendary)' : ''));
    for (const [k, u] of Object.entries(D.UPGRADES)) if (u.level === L) nu.push(`upgrade *${k}*`);
    for (const [k, p] of Object.entries(D.POWERS)) if (p.level === L) nu.push(`power *${k}*`);
    return [L, D.budgetFor(L), D.maxSquadsFor(L), nu.join(', ') || '-', D.mapForRound(L).name];
  }));
  const units = table(['type', 'name', 'lvl', 'cost', 'soldiers', 'hp each', 'armor', 'melee', 'charge', 'speed', 'morale', 'range', 'class', 'notes'],
    Object.entries(D.UNITS).map(([k, u]) => {
      const range = u.ranged ? u.ranged.range : u.spell ? u.spell.range : u.siege ? `${u.siege.min}-${u.siege.range}` : u.breath ? u.breath.range : '-';
      const notes = [u.fly ? 'flies' : '', u.brace ? 'braces' : '', u.shield ? `shield (front arrows x${u.shield})` : '', u.fear ? 'fear' : '', u.cleave ? 'cleave' : '', u.regen ? `regen ${u.regen}/s` : '', u.heal ? `heals ${u.heal.hps}/s r${u.heal.radius}` : '', u.elite ? 'elite' : '', u.fearless ? 'fearless' : '', u.mounted ? 'mounted' : ''].filter(Boolean).join(', ');
      return ['`' + k + '`', u.name, u.level, u.cost, u.size, u.hp, u.armor, u.melee, u.charge, u.speed, u.morale, range, u.cls, notes];
    }));
  const roles = Object.entries(D.UNITS).map(([k, u]) => `- **${u.name}** (\`${k}\`, level ${u.level}): ${u.role} *Strong vs* ${u.strong}. *Weak vs* ${u.weak}.`).join('\n');
  const attacks = [];
  for (const [k, u] of Object.entries(D.UNITS)) {
    if (u.ranged) attacks.push(`- **${u.name}** missiles: range ${u.ranged.range}${u.ranged.min ? ` (min ${u.ranged.min})` : ''}, reload ${u.ranged.reload} s, ${u.ranged.dmg} damage per ${u.ranged.kind === 'holy' ? 'holy bolt (ignores armor, x2 vs beasts and legendary units)' : 'arrow'}, flight speed ${u.ranged.speed}.`);
    if (u.spell) attacks.push(`- **${u.name}** \`${u.spell.name}\`: range ${u.spell.range}, blast radius ${u.spell.radius}, ${u.spell.dmg} per soldier caught (ignores armor), cooldown ${u.spell.cd} s, flies ${u.spell.flight} s (aimed ahead of a moving target). Hits friends too.`);
    if (u.siege) attacks.push(`- **${u.name}** boulders (ability name \`fire\`): range ${u.siege.min}-${u.siege.range}, radius ${u.siege.radius}, ${u.siege.dmg} per soldier caught (half armor), reload ${u.siege.reload} s, flight 0.8 s + distance/${u.siege.speed} - it lands where the target WAS. Must stand still. Hits friends too; almost useless vs flyers.`);
    if (u.breath) attacks.push(`- **${u.name}** \`breath\`: range ${u.breath.range}, radius ${u.breath.radius}, ${u.breath.dmg} per soldier caught (half armor), cooldown ${u.breath.cd} s. Hits friends too.`);
    if (u.stomp) attacks.push(`- **${u.name}** \`stomp\`: every enemy within ${u.stomp.radius} of the titan, ${u.stomp.dmg} per soldier caught (half armor) + morale shock, cooldown ${u.stomp.cd} s.`);
  }
  const upgrades = table(['upgrade', 'level', 'cost', 'effect'], Object.entries(D.UPGRADES).map(([k, u]) => ['`' + k + '`', u.level, `+${u.costPct}% of the unit cost`, u.text]));
  const forms = table(['formation', 'effect'], Object.entries(D.FORMATIONS).map(([k, f]) => ['`' + k + '`', f.text + ` (fighting front: ${Math.round(f.front * 100)}% of the soldiers)`]));
  const powers = table(['power', 'level', 'cooldown', 'effect'], Object.entries(D.POWERS).map(([k, p]) => ['`' + k + '`', p.level, `${p.cd} s`, p.text]));
  const counters = table(['attacker class', 'bonus damage vs'], Object.entries(D.BONUS).filter(([, r]) => Object.keys(r).length).map(([a, row]) => [a, Object.entries(row).map(([d, m]) => `${d} x${m}`).join(', ')]));
  const classes = Object.entries(D.UNITS).map(([k, u]) => `${k} = ${u.cls}`).join(', ') + ', general = hero';
  const maps = D.MAPS.map(m => `- **${m.name}** (\`${m.id}\`): ${m.blurb} Rocks ${m.rocks.map(r => `(${r.x}, ${r.y}) r${r.r}`).join(', ')}; woods ${m.woods.map(r => `(${r.x}, ${r.y}) r${r.r}`).join(', ')}${m.river ? `; river x ${m.river.x0}..${m.river.x1}, fords at y ${m.river.fords.map(f => `${f.y0}..${f.y1}`).join(', ')}` : ''}.`).join('\n');
  return {
    LEVELS: levels, UNITS: units, ROLES: roles, ATTACKS: attacks.join('\n'), UPGRADES: upgrades, FORMATIONS: forms, POWERS: powers,
    COUNTERS: counters, CLASSES: classes, MAPS: maps,
    GENERAL: `${D.GENERAL.hp} HP, armor ${D.GENERAL.armor}, melee ${D.GENERAL.melee}, charge ${D.GENERAL.charge}, speed ${D.GENERAL.speed}, regenerates ${D.GENERAL.regen} HP/s when it has not been hurt for 3 s, fearless`,
    AURA: D.GENERAL.aura.radius, BUDGET1: D.budgetFor(1), SQUADS1: D.maxSquadsFor(1), TIME: D.BATTLE_TIME,
  };
}

function buildGuide() {
  const tpl = fs.readFileSync(path.join(__dirname, 'guide.md.tpl'), 'utf8');
  const b = blocks();
  return tpl.replace(/\{\{(\w+)\}\}/g, (m, k) => (b[k] !== undefined ? String(b[k]) : m));
}

if (require.main === module) {
  const out = path.join(__dirname, '..', '..', '..', 'ARMY_GUIDE.md');
  fs.writeFileSync(out, buildGuide());
  console.log(`wrote ${out}`);
}

module.exports = { buildGuide };
