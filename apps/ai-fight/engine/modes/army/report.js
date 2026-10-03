'use strict';
// Army Battle — the round report each AI receives (plain text). Written to help it win the next
// battle: what decided this one, where its army bled, what the enemy fielded and how it fought.

const D = require('./data');

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const pad = (v, n) => String(v).padEnd(n).slice(0, n);
const lpad = (v, n) => String(v).padStart(n);
const unitName = (t) => (t === 'general' ? 'General' : (D.UNITS[t] && D.UNITS[t].name) || t);

function buildReport({ side = 0, replay, result, stats, labels, round, level, score }) {
  if (!replay || !replay.squads) return 'No replay data for this round.';
  const me = side, en = 1 - side;
  const sides = replay.sides || [];
  const L = [];
  const lab = (i) => (labels && labels[i]) || (sides[i] && sides[i].label) || `Side ${i + 1}`;
  const res = result || replay.result || {};
  const won = res.winner === me, draw = res.winner === null || res.winner === undefined;
  const verdict = draw ? 'DRAW' : won ? 'YOU WON' : 'YOU LOST';
  const how = { ROUT: 'the enemy army routed', ANNIHILATION: 'an army was destroyed', GENERAL: 'a general was slain', TIME: 'time limit, army value decides' }[res.method] || res.method;
  L.push(`====== ROUND ${round || replay.round} | ${verdict} - ${res.method} at ${fmt(res.time || 0)} (${how}) ======`);
  L.push(res.text || '');
  L.push(`You:      ${sides[me].name} (${lab(me)}) - general ${sides[me].general}`);
  L.push(`Opponent: ${sides[en].name} (${lab(en)}) - general ${sides[en].general}`);
  if (Array.isArray(score)) L.push(`Match score: ${lab(0)} ${score[0]} - ${score[1]} ${lab(1)}`);
  else if (score && typeof score === 'object') L.push(`Match score: ${Object.entries(score).map(([k, v]) => `${k} ${v}`).join(' - ')}`);
  L.push(`Level ${level || replay.level} | battlefield: ${replay.map.name} - ${replay.map.blurb}`);
  if (sides[me].fallback) L.push('!! Your files were INVALID when the battle started - you fought with the starter army and commander. Run `check`.');
  L.push('');

  const S = stats && stats[me] ? stats[me] : {}, E = stats && stats[en] ? stats[en] : {};
  L.push('ARMY');
  L.push(`  army value left   you ${lpad(S.valuePct, 3)}%   enemy ${lpad(E.valuePct, 3)}%   (value = points x health share; routing squads count half)`);
  L.push(`  soldiers          you ${S.soldiersLeft}/${S.soldiersStart}   enemy ${E.soldiersLeft}/${E.soldiersStart}   | you slew ${S.enemiesSlain}, lost ${S.soldiersLost}`);
  L.push(`  squads lost       you ${S.squadsDestroyed} destroyed + ${S.squadsFled} fled   enemy ${E.squadsDestroyed} destroyed + ${E.squadsFled} fled`);
  L.push(`  routs / rallies   you ${S.routs}/${S.rallies}   enemy ${E.routs}/${E.rallies}`);
  L.push(`  charges           you ${S.charges} (${S.chargesBraced} broke on braced spears)   enemy ${E.charges} (${E.chargesBraced} braced) | your spears stopped ${S.chargesStopped} charges`);
  L.push(`  missiles          you ${S.volleys} volleys, ${S.arrowsHit}/${S.arrowsFired} arrows hit (${S.arrowsFired ? Math.round(100 * S.arrowsHit / S.arrowsFired) : 0}%)   enemy ${E.arrowsHit}/${E.arrowsFired} (${E.arrowsFired ? Math.round(100 * E.arrowsHit / E.arrowsFired) : 0}%)`);
  L.push(`  damage dealt      you: melee ${S.dmgMelee} (charges ${S.dmgCharge}) | missiles ${S.dmgRanged} | magic ${S.dmgMagic} | siege ${S.dmgSiege} | powers ${S.dmgPowers}`);
  L.push(`                    enemy: melee ${E.dmgMelee} (charges ${E.dmgCharge}) | missiles ${E.dmgRanged} | magic ${E.dmgMagic} | siege ${E.dmgSiege} | powers ${E.dmgPowers}`);
  L.push(`  healed            you ${S.healed} hp   enemy ${E.healed} hp   | general HP: you ${S.generalHpPct}%  enemy ${E.generalHpPct}% | powers used: you ${S.powersUsed} enemy ${E.powersUsed}`);
  L.push('');

  // ── what decided it
  const ev = replay.events || [];
  const sq = replay.squads;
  const nameOf = (gid) => { const q = sq[gid]; return q ? `${q.side === me ? 'your' : 'enemy'} ${q.name}` : '?'; };
  const routs = ev.filter(e => e.k === 'rout' && !e.end);
  const dead = ev.filter(e => e.k === 'destroyed' || e.k === 'general' || e.k === 'fled');
  L.push('WHAT DECIDED IT');
  const firstRout = [me, en].map(s => routs.find(e => e.s === s));
  if (res.method === 'GENERAL') {
    const g = ev.find(e => e.k === 'general');
    if (g) L.push(`  - ${g.s === me ? 'YOUR general was slain' : "you slew the ENEMY general"} at ${fmt(g.t)}. The battle ends the moment a general dies.`);
  }
  if (firstRout[me]) L.push(`  - your first squad to break: ${sq[firstRout[me].a].name} at ${fmt(firstRout[me].t)}`);
  if (firstRout[en]) L.push(`  - the enemy's first squad to break: ${sq[firstRout[en].a].name} at ${fmt(firstRout[en].t)}`);
  const clash = ev.find(e => e.k === 'clash' || e.k === 'charge');
  if (clash) L.push(`  - the lines met at ${fmt(clash.t)} (${nameOf(clash.a)} vs ${nameOf(clash.b)})`);
  const best = [me, en].map(s => sq.filter(q => q.side === s).sort((a, b) => b.st.dealt - a.st.dealt)[0]);
  if (best[me]) L.push(`  - your most destructive squad: ${best[me].name} (${unitName(best[me].type)}) - ${best[me].st.dealt} damage, ${best[me].st.kills} kills`);
  if (best[en]) L.push(`  - their most destructive squad: ${best[en].name} (${unitName(best[en].type)}) - ${best[en].st.dealt} damage, ${best[en].st.kills} kills`);
  const cascade = routs.filter(e => e.s === me).length;
  if (cascade >= 3) L.push(`  - ${cascade} of your squads routed: once a few break, neighbours lose morale too (a cascade). Keep the general's aura (r ${D.GENERAL.aura.radius}) and banners near the fighting and use rally.`);
  L.push('');

  // ── own squads
  L.push('YOUR SQUADS (soldiers start -> end | damage dealt / taken | kills | routs | fate)');
  L.push(`  ${pad('squad', 22)} ${pad('type', 14)} ${lpad('men', 9)} ${lpad('dealt', 7)} ${lpad('taken', 7)} ${lpad('kills', 6)}  routs  fate`);
  for (const q of sq.filter(q => q.side === me)) {
    const end = q.n[q.n.length - 1];
    const fate = q.st.dead ? `destroyed ${fmt(q.st.end || 0)}` : q.st.fled ? `fled ${fmt(q.st.end || 0)}` : q.s[q.s.length - 1] === 5 ? 'routing' : 'standing';
    const extra = q.st.charges ? ` | ${q.st.charges} charges${q.st.braced ? ` (${q.st.braced} braced!)` : ''}` : q.st.volleys ? ` | ${q.st.volleys} volleys, ${q.st.fired ? Math.round(100 * q.st.hits / q.st.fired) : 0}% hit` : q.st.casts ? ` | ${q.st.casts} casts` : q.st.healed ? ` | healed ${q.st.healed}` : '';
    L.push(`  ${pad(q.name, 22)} ${pad(unitName(q.type), 14)} ${lpad(`${q.n0}->${end}`, 9)} ${lpad(q.st.dealt, 7)} ${lpad(q.st.taken, 7)} ${lpad(q.st.kills, 6)}  ${lpad(q.st.routs, 5)}  ${fate}${extra}`);
  }
  // losses by type
  const byType = (s) => {
    const m = {};
    for (const q of sq.filter(q => q.side === s && !q.gen)) {
      const k = q.type;
      m[k] = m[k] || { n0: 0, end: 0, dealt: 0 };
      m[k].n0 += q.n0; m[k].end += q.st.fled ? 0 : q.n[q.n.length - 1]; m[k].dealt += q.st.dealt;
    }
    return m;
  };
  const mt = byType(me);
  L.push('  by type: ' + Object.entries(mt).map(([k, v]) => `${unitName(k)} ${v.end}/${v.n0} left, ${v.dealt} dmg`).join(' | '));
  L.push('');

  // ── enemy scouting (positions shown in YOUR coordinates)
  L.push(`ENEMY ARMY - ${sides[en].name} "${sides[en].motto || ''}" (positions in YOUR coordinates: they deploy at x > 0)`);
  for (const q of sq.filter(q => q.side === en)) {
    const x0 = (me === 0 ? 1 : -1) * q.x[0], y0 = q.y[0];
    const end = q.n[q.n.length - 1];
    const fate = q.st.dead ? 'destroyed' : q.st.fled ? 'fled' : q.s[q.s.length - 1] === 5 ? 'routing' : 'standing';
    L.push(`  ${pad(q.name, 22)} ${pad(unitName(q.type), 14)} ${q.up && q.up.length ? pad(q.up.join('+'), 16) : pad('-', 16)} start (${lpad(x0, 4)}, ${lpad(y0, 4)})  ${q.n0}->${end} ${fate}; dealt ${q.st.dealt}${q.st.charges ? `, ${q.st.charges} charges` : ''}${q.st.volleys ? `, ${q.st.volleys} volleys` : ''}${q.st.casts ? `, ${q.st.casts} casts` : ''}`);
  }
  const et = byType(en);
  L.push('  composition: ' + Object.entries(et).map(([k, v]) => `${unitName(k)} x${sq.filter(q => q.side === en && q.type === k).length}`).join(', '));
  const powers = ev.filter(e => e.k === 'power');
  const ep = powers.filter(e => e.s === en).map(e => `${e.p} ${fmt(e.t)}`);
  const mp = powers.filter(e => e.s === me).map(e => `${e.p} ${fmt(e.t)}`);
  L.push(`  general powers used: enemy ${ep.join(', ') || 'none'} | you ${mp.join(', ') || 'none'}`);
  // enemy behaviour: where did they go?
  const midX = (s) => {
    const own = sq.filter(q => q.side === s && !q.gen);
    const at = (fi) => own.reduce((a, q) => a + q.x[Math.min(fi, q.x.length - 1)], 0) / Math.max(1, own.length);
    return at;
  };
  const hz = replay.hz || 5;
  const at30 = midX(en)(30 * hz), at0 = midX(en)(0);
  const adv = Math.round(Math.abs(at30 - at0));
  L.push(`  behaviour: their army centre moved ${adv} units in the first 30 s (${adv < 120 ? 'they WAITED / defended' : adv > 350 ? 'they ADVANCED fast' : 'a measured advance'}); ${E.charges} charges, ${E.volleys} volleys.`);
  L.push('');

  // ── timeline
  L.push('TIMELINE (army value % you / enemy)');
  const hud = replay.hud || [];
  const pts = [];
  for (let s = 0; s <= replay.duration; s += 15) {
    const f = hud[Math.min(hud.length - 1, Math.round(s * hz))];
    if (f) pts.push(`${fmt(s)} ${f[me * 2]}/${f[en * 2]}`);
  }
  L.push('  ' + pts.join(' | '));
  const key = ev.filter(e => ['rout', 'destroyed', 'general', 'fled', 'rally', 'power'].includes(e.k) && !e.end).slice(0, 18);
  for (const e of key) {
    const who = e.s === me ? 'you' : 'enemy';
    const what = e.k === 'power' ? `${who}: general used ${e.p}` : `${nameOf(e.a)} ${e.k === 'rout' ? 'ROUTED' : e.k === 'general' ? 'SLAIN (general)' : e.k === 'rally' ? 'rallied' : e.k.toUpperCase()}`;
    L.push(`  ${fmt(e.t)}  ${what}`);
  }
  L.push('');

  // ── commander
  const b = replay.brain && replay.brain[me];
  L.push('YOUR COMMANDER');
  if (b) {
    L.push(`  ${b.calls} calls | ${b.errors} errors (${b.timeouts} timeouts) | ${S.brainMs !== undefined ? `${S.brainMs} ms CPU total, max ${S.brainMaxMs} ms per call` : ''}`);
    if (b.loadError) L.push(`  LOAD ERROR: ${b.loadError}`);
    if (b.disabled) L.push(`  !! ${b.disabled}`);
    for (const e of b.firstErrors || []) L.push(`  error at ${e.t}s: ${e.message}`);
    const logs = (b.logs || []).slice(0, 12);
    if (logs.length) { L.push('  console.log (first lines):'); for (const l of logs) L.push(`    [${l.t}s] ${l.text}`); }
  }
  const notes = replay.notes && replay.notes[me];
  if (notes && notes.length) { L.push('  orders the engine could not follow:'); for (const n of notes) L.push(`    - ${n}`); }
  L.push('');

  // ── lessons
  L.push('LESSONS');
  const tips = [];
  if (S.chargesBraced > 0) tips.push(`${S.chargesBraced} of your charges hit BRACED spearmen from the front and bounced. Charge spears in the flank/rear, or when they are moving; grind them with infantry.`);
  if (S.arrowsFired > 200 && S.arrowsHit / S.arrowsFired < 0.25) tips.push(`Only ${Math.round(100 * S.arrowsHit / S.arrowsFired)}% of your arrows hit: targets in woods (half), in loose formation (-45%), fast movers and shield walls from the front (30%) are poor targets. Focus fire on slow, dense squads in the open.`);
  if (S.routs >= 2 && S.soldiersLost < S.soldiersStart * 0.5) tips.push('Your squads broke before they were destroyed: morale lost you this. Flank attacks, fear, charges and nearby routs drain morale; the general aura, banners, clerics and "rally" restore it.');
  if (S.generalHpPct < 60 && S.generalAlive) tips.push(`Your general was badly hurt (${S.generalHpPct}% HP). If it dies you lose instantly - keep it behind the line, but within ~220 of the troops that need its aura.`);
  if (E.generalHpPct < 100 && res.method !== 'GENERAL') tips.push(`The enemy general took damage (${E.generalHpPct}% left). A general hunt with fast troops can win outright - but guard your own.`);
  if (res.method === 'TIME') tips.push('The battle went the distance: at the time limit only army VALUE counts (routing squads count half). Preserve expensive squads, finish off routers, and pull back wounded units late.');
  if (S.dmgRanged + S.dmgMagic + S.dmgSiege < (S.dmgDealt || 1) * 0.15 && S.volleys > 0) tips.push('Your missile troops did little - were they in range and standing still? Archers only shoot when stopped.');
  if (S.charges === 0 && Object.keys(mt).some(k => D.UNITS[k] && D.UNITS[k].charge >= 9)) tips.push('Your cavalry never landed a charge. A charge needs a run-up of 50+ units at speed into a new contact; flank/rear charges hit x1.5-x2 and shatter morale.');
  if (E.dmgMagic > E.dmgDealt * 0.3 || E.dmgSiege > E.dmgDealt * 0.25) tips.push('Enemy blasts (spells/siege) hurt: spread out (loose formation), keep moving, keep squads apart, or send fast units at their casters.');
  if (!tips.length) tips.push(won ? 'You won - but your opponent reads this report too and will change its army and tactics. Keep improving rather than repeating.' : 'Study the enemy composition and the timeline above; test ideas with `node arena.js test <id> <bot>` against several bots.');
  for (const t of tips.slice(0, 6)) L.push(`  - ${t}`);
  L.push(`  - Next round is level ${Math.min(D.MAX_LEVEL, (level || replay.level) + 1)}: ${nextUnlocks((level || replay.level) + 1)}`);
  L.push("  - Remember: your opponent evolves too. Don't just hard-counter the army you saw - build something that wins against several plans.");
  return L.join('\n');
}

function nextUnlocks(level) {
  if (level > D.MAX_LEVEL) return 'this was the last round.';
  const out = [];
  for (const [k, u] of Object.entries(D.UNITS)) if (u.level === level) out.push(u.name);
  for (const [k, u] of Object.entries(D.UPGRADES)) if (u.level === level) out.push(`upgrade "${k}"`);
  for (const [k, p] of Object.entries(D.POWERS)) if (p.level === level && level > 1) out.push(`power "${k}"`);
  out.push(`budget ${D.budgetFor(level)}, ${D.maxSquadsFor(level)} squads, battlefield ${D.mapForRound(level).name}`);
  return out.join(', ');
}

module.exports = { buildReport };
