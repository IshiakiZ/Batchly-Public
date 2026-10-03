'use strict';
// Modern Warfare — the round report each AI receives (plain text). Written to help it win the next
// battle: what decided this one, where its army bled, what the enemy fielded and how it fought.

const D = require('./data');

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const pad = (v, n) => String(v).padEnd(n).slice(0, n);
const lpad = (v, n) => String(v).padStart(n);
const unitName = (t) => (t === 'hq' ? 'Command Post' : (D.UNITS[t] && D.UNITS[t].name) || t);
const pct = (a, b) => (b ? Math.round(100 * a / b) : 0);

function buildReport({ side = 0, replay, result, stats, labels, round, level, score }) {
  if (!replay || !replay.units) return 'No replay data for this round.';
  const me = side, en = 1 - side;
  const sides = replay.sides || [];
  const L = [];
  const lab = (i) => (labels && labels[i]) || (sides[i] && sides[i].label) || `Side ${i + 1}`;
  const res = result || replay.result || {};
  const won = res.winner === me, draw = res.winner === null || res.winner === undefined;
  const verdict = draw ? 'DRAW' : won ? 'YOU WON' : 'YOU LOST';
  const how = { ROUT: 'the enemy army fell back', ANNIHILATION: 'an army was wiped out', HQ: 'a command post was destroyed', TIME: 'time limit, army value decides' }[res.method] || res.method;
  L.push(`====== ROUND ${round || replay.round} | ${verdict} - ${res.method} at ${fmt(res.time || 0)} (${how}) ======`);
  L.push(res.text || '');
  L.push(`You:      ${sides[me].name} (${lab(me)}) - command post "${sides[me].hq}"`);
  L.push(`Opponent: ${sides[en].name} (${lab(en)}) - command post "${sides[en].hq}"`);
  if (Array.isArray(score)) L.push(`Match score: ${lab(0)} ${score[0]} - ${score[1]} ${lab(1)}`);
  else if (score && typeof score === 'object') L.push(`Match score: ${Object.entries(score).map(([k, v]) => `${k} ${v}`).join(' - ')}`);
  L.push(`Level ${level || replay.level} | battlefield: ${replay.map.name} - ${replay.map.blurb}`);
  if (sides[me].fallback) L.push('!! Your files were INVALID when the battle started - you fought with the starter army and commander. Run `check`.');
  L.push('');

  const S = stats && stats[me] ? stats[me] : {}, E = stats && stats[en] ? stats[en] : {};
  L.push('FORCES');
  L.push(`  army value left   you ${lpad(S.valuePct, 3)}%   enemy ${lpad(E.valuePct, 3)}%   (value = points x health share; retreating units count half)`);
  L.push(`  units lost        you ${S.unitsDestroyed} destroyed + ${S.unitsFled} fled   enemy ${E.unitsDestroyed} destroyed + ${E.unitsFled} fled`);
  L.push(`  losses            you: ${S.soldiersLost} soldiers, ${S.vehiclesLost} vehicles, ${S.aircraftLost} aircraft, ${S.shipsLost} ships`);
  L.push(`                    enemy: ${E.soldiersLost} soldiers, ${E.vehiclesLost} vehicles, ${E.aircraftLost} aircraft, ${E.shipsLost} ships`);
  L.push(`  retreats / rallies you ${S.routs}/${S.rallies}   enemy ${E.routs}/${E.rallies}`);
  L.push(`  fire              you: ${S.shotsFired} rounds (${pct(S.hits, S.shotsFired)}% hit), ${S.missiles} missiles/rockets, ${S.shells} shells, ${S.bombs} bombs, ${S.torpedoes} torpedoes, ${S.sorties} sorties`);
  L.push(`                    enemy: ${E.shotsFired} rounds (${pct(E.hits, E.shotsFired)}% hit), ${E.missiles} missiles/rockets, ${E.shells} shells, ${E.bombs} bombs, ${E.torpedoes} torpedoes, ${E.sorties} sorties`);
  const dmgLine = (x) => `small arms ${x.dmgSmallArms} | cannons ${x.dmgCannon} | anti-tank ${x.dmgAntiTank} | anti-air ${x.dmgAntiAir} | artillery ${x.dmgArtillery} | bombs ${x.dmgBombs} | naval ${x.dmgNaval} | assault ${x.dmgAssault} | support powers ${x.dmgPowers}`;
  L.push(`  damage dealt      you: ${dmgLine(S)}`);
  L.push(`                    enemy: ${dmgLine(E)}`);
  L.push(`  command post      you ${S.hqHpPct}% HP   enemy ${E.hqHpPct}% HP   | support powers used: you ${S.powersUsed} enemy ${E.powersUsed}`);
  L.push('');

  // ── what decided it
  const ev = replay.events || [];
  const U = replay.units;
  const nameOf = (gid) => { const q = U[gid]; return q ? `${q.side === me ? 'your' : 'enemy'} ${q.name}` : '?'; };
  const routs = ev.filter(e => e.k === 'rout' && !e.end);
  L.push('WHAT DECIDED IT');
  if (res.method === 'HQ') {
    const h = ev.find(e => e.k === 'hq');
    if (h) L.push(`  - ${h.s === me ? 'YOUR command post was destroyed' : 'you destroyed the ENEMY command post'} at ${fmt(h.t)}. The battle ends the moment a command post falls.`);
  }
  const firstRout = [me, en].map(s => routs.find(e => e.s === s));
  if (firstRout[me]) L.push(`  - your first unit to fall back: ${U[firstRout[me].a].name} at ${fmt(firstRout[me].t)}`);
  if (firstRout[en]) L.push(`  - the enemy's first unit to fall back: ${U[firstRout[en].a].name} at ${fmt(firstRout[en].t)}`);
  const firstShot = ev.find(e => e.k === 'fire' || e.k === 'shell');
  if (firstShot) L.push(`  - first heavy fire at ${fmt(firstShot.t)} (${nameOf(firstShot.a)})`);
  const best = [me, en].map(s => U.filter(q => q.side === s && !q.hq).sort((a, b) => b.st.dealt - a.st.dealt)[0]);
  if (best[me]) L.push(`  - your most destructive unit: ${best[me].name} (${unitName(best[me].type)}) - ${best[me].st.dealt} damage, ${best[me].st.kills} kills`);
  if (best[en]) L.push(`  - their most destructive unit: ${best[en].name} (${unitName(best[en].type)}) - ${best[en].st.dealt} damage, ${best[en].st.kills} kills`);
  const cascade = routs.filter(e => e.s === me).length;
  if (cascade >= 3) L.push(`  - ${cascade} of your units fell back: once a few break, neighbours lose morale too. Keep the command post aura (r ${D.HQ.aura.radius}) near the fighting, bring radios, use "rally".`);
  L.push('');

  // ── own units
  L.push('YOUR UNITS (elements start -> end | damage dealt / taken | kills | retreats | fate)');
  L.push(`  ${pad('unit', 22)} ${pad('type', 18)} ${lpad('size', 7)} ${lpad('dealt', 7)} ${lpad('taken', 7)} ${lpad('kills', 6)}  retr  fate`);
  for (const q of U.filter(q => q.side === me)) {
    const end = q.n[q.n.length - 1];
    const fate = q.st.dead ? `destroyed ${fmt(q.st.end || 0)}` : q.st.fled ? `fled ${fmt(q.st.end || 0)}` : q.s[q.s.length - 1] === 5 ? 'retreating' : 'standing';
    const extra = [q.st.missiles ? `${q.st.missiles} missiles` : '', q.st.shells ? `${q.st.shells} shells` : '', q.st.bombs ? `${q.st.bombs} bombs` : '', q.st.torpedoes ? `${q.st.torpedoes} torpedoes` : '', q.st.sorties ? `${q.st.sorties} sorties` : ''].filter(Boolean).join(', ');
    L.push(`  ${pad(q.name, 22)} ${pad(unitName(q.type), 18)} ${lpad(`${q.n0}->${end}`, 7)} ${lpad(q.st.dealt, 7)} ${lpad(q.st.taken, 7)} ${lpad(q.st.kills, 6)}  ${lpad(q.st.routs, 4)}  ${fate}${extra ? ` | ${extra}` : ''}`);
  }
  L.push('');

  // ── enemy scouting (positions shown in YOUR coordinates)
  L.push(`ENEMY ARMY - ${sides[en].name} "${sides[en].motto || ''}" (positions in YOUR coordinates: they deploy at x > 0)`);
  for (const q of U.filter(q => q.side === en)) {
    const x0 = (me === 0 ? 1 : -1) * q.x[0], y0 = q.y[0];
    const end = q.n[q.n.length - 1];
    const fate = q.st.dead ? 'destroyed' : q.st.fled ? 'fled' : q.s[q.s.length - 1] === 5 ? 'retreating' : 'standing';
    L.push(`  ${pad(q.name, 22)} ${pad(unitName(q.type), 18)} ${q.up && q.up.length ? pad(q.up.join('+'), 16) : pad('-', 16)} start (${lpad(x0, 5)}, ${lpad(y0, 4)})  ${q.n0}->${end} ${fate}; dealt ${q.st.dealt}`);
  }
  const comp = {};
  for (const q of U.filter(q => q.side === en && !q.hq)) comp[q.type] = (comp[q.type] || 0) + 1;
  L.push('  composition: ' + Object.entries(comp).map(([k, v]) => `${unitName(k)} x${v}`).join(', '));
  const powers = ev.filter(e => e.k === 'power');
  L.push(`  support powers used: enemy ${powers.filter(e => e.s === en).map(e => `${e.p} ${fmt(e.t)}`).join(', ') || 'none'} | you ${powers.filter(e => e.s === me).map(e => `${e.p} ${fmt(e.t)}`).join(', ') || 'none'}`);
  const hz = replay.hz || 5;
  const midX = (s, fi) => { const own = U.filter(q => q.side === s && !q.hq && !q.jet); return own.reduce((a, q) => a + q.x[Math.min(fi, q.x.length - 1)], 0) / Math.max(1, own.length); };
  const adv = Math.round(Math.abs(midX(en, 30 * hz) - midX(en, 0)));
  L.push(`  behaviour: their ground forces moved ${adv} units in the first 30 s (${adv < 150 ? 'they HELD / dug in' : adv > 450 ? 'they PUSHED hard' : 'a measured advance'}).`);
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
  const key = ev.filter(e => ['rout', 'destroyed', 'hq', 'fled', 'rally', 'power'].includes(e.k) && !e.end).slice(0, 20);
  for (const e of key) {
    const who = e.s === me ? 'you' : 'enemy';
    const what = e.k === 'power' ? `${who}: command post called ${e.p}` : `${nameOf(e.a)} ${e.k === 'rout' ? 'FELL BACK' : e.k === 'hq' ? 'DESTROYED (command post)' : e.k === 'rally' ? 'rallied' : e.k.toUpperCase()}`;
    L.push(`  ${fmt(e.t)}  ${what}`);
  }
  L.push('');

  // ── commander
  const b = replay.brain && replay.brain[me];
  L.push('YOUR COMMANDER');
  if (b) {
    L.push(`  ${b.calls} calls | ${b.errors} errors (${b.timeouts} timeouts)${S.brainMs !== undefined ? ` | ${S.brainMs} ms CPU total, max ${S.brainMaxMs} ms per call` : ''}`);
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
  const mine = (type) => U.filter(q => q.side === me && q.type === type);
  const theirs = (type) => U.filter(q => q.side === en && q.type === type);
  if (S.aircraftLost > 0 && E.dmgAntiAir > 0) tips.push(`You lost ${S.aircraftLost} aircraft to anti-air fire. Kill or avoid their Anti-Air / destroyers first (artillery, tanks, bombers from out of range), or escort with fighters.`);
  if (S.vehiclesLost >= 3 && E.dmgAntiTank > E.dmgDealt * 0.3) tips.push(`Rockets and missiles destroyed ${S.vehiclesLost} of your vehicles. Screen armour with infantry, keep it out of towns and woods full of rocket teams, and hunt their helicopters with AA.`);
  if (E.dmgArtillery + E.dmgBombs > E.dmgDealt * 0.3) tips.push('Shells and bombs did much of the damage to you: use "spread" formation under fire, keep moving (shells land where you WERE), keep units apart, and send fast units (jeeps, helicopters, jets) at their artillery.');
  if (mine('artillery').concat(mine('mlrs')).some(q => q.st.shells === 0)) tips.push('Some of your artillery never fired: it needs 1.5 s standing still to set up, a visible target inside its range band (min-max), and no friends near the target.');
  if (S.routs >= 2 && S.soldiersLost < 60) tips.push('Your units fell back before they were destroyed: morale lost you this. Machine guns, snipers, blasts and nearby losses drain morale; the command post aura, radios and "rally" restore it.');
  if (S.hqHpPct < 60 && S.hqAlive) tips.push(`Your command post was badly hit (${S.hqHpPct}% HP). If it is destroyed you lose instantly - keep it behind the army and away from enemy jets and artillery.`);
  if (E.hqHpPct < 100 && res.method !== 'HQ') tips.push(`The enemy command post took damage (${E.hqHpPct}% left). A strike on it (bombers, a cruise missile, a tank thrust) can win outright.`);
  if (theirs('snipers').length && E.dmgSmallArms > 0 && !mine('jeep').length && !mine('drone').length) tips.push('Enemy snipers were hidden: only units within 150 (or jeeps / drones within their spotting range) can see them. Bring spotters.');
  if (res.method === 'TIME') tips.push('The battle went the distance: at the time limit only army VALUE counts (retreating units count half). Preserve expensive units, finish off retreating ones, pull back wounded vehicles late.');
  if (!tips.length) tips.push(won ? 'You won - but your opponent reads this report too and will change its army and tactics. Keep improving rather than repeating.' : 'Study the enemy composition and the timeline above; test ideas with `node arena.js test <id> <bot>` against several bots.');
  for (const t of tips.slice(0, 6)) L.push(`  - ${t}`);
  L.push(`  - Next round is level ${Math.min(D.MAX_LEVEL, (level || replay.level) + 1)}: ${nextUnlocks((level || replay.level) + 1)}`);
  L.push("  - Remember: your opponent evolves too. Don't just hard-counter the army you saw - build something that wins against several plans.");
  return L.join('\n');
}

function nextUnlocks(level) {
  if (level > D.MAX_LEVEL) return 'this was the last round.';
  const out = [];
  for (const [, u] of Object.entries(D.UNITS)) if (u.level === level) out.push(u.name + (u.legendary ? ' (LEGENDARY)' : ''));
  for (const [k, u] of Object.entries(D.UPGRADES)) if (u.level === level) out.push(`upgrade "${k}"`);
  for (const [k, p] of Object.entries(D.POWERS)) if (p.level === level && level > 1) out.push(`power "${k}"`);
  out.push(`budget ${D.budgetFor(level)}, ${D.maxUnitsFor(level)} units, battlefield ${D.mapForRound(level).name}`);
  return out.join(', ');
}

module.exports = { buildReport, nextUnlocks };
