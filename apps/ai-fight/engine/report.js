'use strict';
// Builds the post-fight report each AI reads before improving its fighter.

const { STAT_KEYS, STAT_INFO, TRAITS, RULES, RELICS, FEATURE_UNLOCK } = require('./rules');
const { ascii } = require('./text');

const pct = (v) => `${Math.round(v * 100)}%`;
const num = (v) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100));
const sec = (tick) => ((tick - 1) / RULES.tickRate).toFixed(1);

function effectsText(fx) {
  const e = [];
  if (!fx) return e;
  if (fx.stun) e.push(`stun ${num(fx.stun)}s`);
  if (fx.root) e.push(`root ${num(fx.root)}s`);
  if (fx.silence) e.push(`silence ${num(fx.silence)}s`);
  if (fx.slow) e.push(`slow ${pct(fx.slow.amount)} for ${num(fx.slow.duration)}s`);
  if (fx.knockback) e.push(fx.knockback < 0 ? `pull ${-fx.knockback}` : `knockback ${fx.knockback}`);
  if (fx.burn) e.push(`burn ${num(fx.burn.dps)}/s for ${num(fx.burn.duration)}s`);
  if (fx.poison) e.push(`poison ${num(fx.poison.dps)}/s for ${num(fx.poison.duration)}s (halves healing)`);
  if (fx.vulnerable) e.push(`vulnerable +${pct(fx.vulnerable.amount)} dmg taken for ${num(fx.vulnerable.duration)}s`);
  if (fx.weaken) e.push(`weaken −${pct(fx.weaken.amount)} dmg dealt for ${num(fx.weaken.duration)}s`);
  if (fx.drain) e.push(`drain ${num(fx.drain)} energy`);
  if (fx.lifesteal) e.push(`lifesteal ${pct(fx.lifesteal)}`);
  return e;
}

function describeAbility(ab) {
  const p = [];
  switch (ab.type) {
    case 'melee': p.push(`${ab.damage} dmg${ab.hits > 1 ? ` ×${ab.hits} hits` : ''}`, `range ${ab.range}`, `arc ${ab.arc}°`); if (ab.lunge) p.push(`lunge ${ab.lunge}`); break;
    case 'projectile':
      p.push(`${ab.damage} dmg${ab.count > 1 ? ` ×${ab.count} (spread ${ab.spread}°)` : ''}`, `speed ${ab.speed}`, `radius ${ab.radius}`, `range ${ab.range}`);
      if (ab.homing) p.push(`homing ${ab.homing}`);
      if (ab.bounce) p.push(`bounces ${ab.bounce}`);
      if (ab.returns) p.push('returns');
      break;
    case 'area':
      p.push(`${ab.damage} dmg`, `radius ${ab.radius}`);
      if (ab.target === 'point') p.push(`at a point up to ${ab.range} away`, `after ${num(ab.delay)}s`);
      break;
    case 'zone':
      p.push(`${ab.dps} dps for ${ab.duration}s`, `radius ${ab.radius}`, ab.follow ? 'follows you' : `range ${ab.range}`);
      if (ab.slow) p.push(`slow ${pct(ab.slow)}`);
      if (ab.pull) p.push(`pull ${ab.pull}/s`);
      break;
    case 'dash': p.push(`${ab.teleport ? 'teleport' : 'distance'} ${ab.distance}`); if (ab.damage) p.push(`${ab.damage} dmg on contact`); if (ab.invulnerable) p.push('invulnerable'); break;
    case 'shield': p.push(`absorbs ${ab.amount} for ${ab.duration}s`); break;
    case 'heal': p.push(ab.duration > 0 ? `heals ${ab.amount} over ${ab.duration}s` : `heals ${ab.amount}`); break;
    case 'buff': p.push(`+${ab.amount}% ${ab.stat} for ${ab.duration}s`); break;
    case 'beam': p.push(`${ab.dps} dps channelled for ${ab.duration}s`, `range ${ab.range}`, `width ${ab.width}`, `turn ${ab.turnRate}°/s`); break;
    case 'trap': p.push(`${ab.damage} dmg`, `radius ${ab.radius}`, `arms in ${num(ab.arm)}s`, `lasts ${ab.duration}s`, `range ${ab.range}`); break;
    case 'counter': p.push(`parry ${num(ab.duration)}s`, ab.damage ? `strikes back ${ab.damage} dmg within ${ab.range}` : `range ${ab.range}`); break;
    case 'cleanse': p.push(ab.immunity ? `cleanse + ${num(ab.immunity)}s immunity` : 'cleanse'); break;
    case 'turret': p.push(`${ab.damage} dmg shots`, `${num(ab.rate)}/s for ${num(ab.duration)}s`, `range ${ab.range}`); break;
    default: break;
  }
  if (ab.ultimate) p.push(`charge-up ${num(ab.windup)}s`, 'fires when the ultimate meter is full');
  else p.push(`windup ${num(ab.windup)}s`, `cd ${num(ab.cooldown)}s`, ab.basic ? 'free (weapon attack)' : `${ab.energy} energy`);
  const e = effectsText(ab.effects);
  return `${ab.basic ? 'WEAPON ' : ab.ultimate ? 'ULTIMATE ' : ''}${ab.type}: ${p.join(', ')}${e.length ? `; ${e.join(', ')}` : ''}`;
}

function describeStats(spec) {
  const d = spec.derived;
  const pts = STAT_KEYS.filter(k => spec.stats[k]).map(k => `${STAT_INFO[k].short.toLowerCase()} ${spec.stats[k]}`).join(' · ') || 'no stats';
  const extra = [];
  if (d.critChance) extra.push(`${pct(d.critChance)} crit`);
  if (d.cooldownMult < 1) extra.push(`cooldowns ×${num(d.cooldownMult)}`);
  if (d.ccMult < 1) extra.push(`CC taken ×${num(d.ccMult)}`);
  if (d.armorPen) extra.push(`ignores ${pct(d.armorPen)} armor`);
  return `${pts}  →  ${d.maxHp} HP, ×${num(d.damageMult)} dmg, takes ${pct(d.damageTaken)} dmg, ${num(d.moveSpeed)} speed, ${d.maxEnergy} energy, ${num(d.energyRegen)}/s regen${extra.length ? `, ${extra.join(', ')}` : ''}`;
}

function abilityTable(stats, spec) {
  const rows = [];
  rows.push('  ability                    casts fired  hits   hit%    dmg crits  energy  notes');
  stats.abilities.forEach((a, i) => {
    const ab = spec.abilities[i];
    const label = `${a.name} (${ab && ab.basic ? 'weapon' : a.type})`.slice(0, 26).padEnd(26);
    const canHit = ab && (['melee', 'projectile', 'area', 'zone', 'beam', 'trap'].includes(ab.type) || (ab.type === 'dash' && (ab.damage > 0 || Object.keys(ab.effects || {}).length)));
    const hitRate = a.fired && canHit ? pct(Math.min(1, a.hits / a.fired)) : '—';
    const hitsCol = canHit ? String(a.hits) : '—';
    const notes = [];
    if (a.interrupted) notes.push(`${a.interrupted} interrupted`);
    if (a.cancelled) notes.push(`${a.cancelled} cancelled`);
    if (a.evaded) notes.push(`${a.evaded} evaded by i-frames`);
    if (a.countered) notes.push(`${a.countered} parried`);
    if (a.healing) notes.push(`healed ${a.healing}`);
    if (a.shielding) notes.push(`shield ${a.shielding}`);
    if (ab && ab.type === 'zone' && a.fired) notes.push('hits = zones that touched the enemy');
    if (ab && ab.type === 'counter') notes.push(`${a.hits} successful parries`);
    rows.push(`  ${label} ${String(a.casts).padStart(5)} ${String(a.fired).padStart(5)} ${hitsCol.padStart(5)} ${hitRate.padStart(6)} ${String(a.damage).padStart(6)} ${String(a.crits || 0).padStart(5)} ${String(a.energy).padStart(7)}  ${notes.join(', ')}`);
  });
  return rows.join('\n');
}

function keyMoments(events, labels, specs, side) {
  const out = [];
  const name = (s, ab) => (specs[s].abilities[ab] ? specs[s].abilities[ab].name : 'hit');
  const firstHit = events.find(e => e.k === 'hit' && e.dmg > 0);
  if (firstHit) out.push(`first hit at ${sec(firstHit.t)}s by ${firstHit.a === side ? 'YOU' : 'the opponent'} (${name(firstHit.a, firstHit.ab)}, ${firstHit.dmg})`);
  for (const s of [side, 1 - side]) {
    let best = null;
    for (const e of events) if (e.k === 'hit' && e.a === s && (!best || e.dmg > best.dmg)) best = e;
    if (best) out.push(`${s === side ? 'your' : 'opponent\'s'} biggest hit: ${name(s, best.ab)} for ${best.dmg}${best.fl & 64 ? ' (CRIT)' : ''} at ${sec(best.t)}s`);
  }
  const stuns = events.filter(e => e.k === 'hit' && (e.fl & 1));
  if (stuns.length) out.push(`stuns landed: you ${stuns.filter(e => e.a === side).length}, opponent ${stuns.filter(e => e.a !== side).length}`);
  const parries = events.filter(e => e.k === 'counter' && e.ok === 1);
  if (parries.length) out.push(`parries: you ${parries.filter(e => e.a === side).length}, opponent ${parries.filter(e => e.a !== side).length}`);
  const traps = events.filter(e => e.k === 'trigger');
  if (traps.length) out.push(`traps sprung: yours ${traps.filter(e => e.a === side).length}, theirs ${traps.filter(e => e.a !== side).length}`);
  const slams = events.filter(e => e.k === 'slam');
  if (slams.length) out.push(`slammed into obstacles: you ${slams.filter(e => e.a === side).length}×, opponent ${slams.filter(e => e.a !== side).length}×`);
  const ko = events.find(e => e.k === 'ko');
  if (ko) out.push(`KO at ${sec(ko.t)}s — ${ko.a === side ? 'YOU were knocked out' : 'you knocked the opponent out'}`);
  return out;
}

/**
 * The damage race + the biggest levers on YOUR side — so a report pushes the AI to build a
 * fighter that wins, not just one that counters the last opponent.
 */
function winPlan(me, opp, res, side, my, p) {
  const other = 1 - side;
  const t = Math.max(1, res.time);
  const myDps = me.dealt / t, theirDps = opp.dealt / t;
  const myKo = myDps > 0 ? res.maxHp[other] / myDps : Infinity;
  const theirKo = theirDps > 0 ? res.maxHp[side] / theirDps : Infinity;
  const fmtT = (s) => (Number.isFinite(s) ? `${s.toFixed(1)}s` : 'never');
  const L = [];
  L.push('THE DAMAGE RACE (what decides fights)');
  L.push(`  you: ${Math.round(myDps)} damage/s -> would KO them in ${fmtT(myKo)} · them: ${Math.round(theirDps)} damage/s -> would KO you in ${fmtT(theirKo)}`);
  if (res.winner !== side && res.hp[other] > 0 && me.dealt > 0) {
    const need = Math.round((res.hp[other] / me.dealt) * 100);
    L.push(`  to have won this fight you needed about +${need}% damage (or to survive ~${fmtT(res.hp[other] / Math.max(1, myDps))} longer)`);
  } else if (res.winner === side) {
    L.push(`  you won with ${Math.round(res.hpPct[side])}% HP left — they will evolve, so keep improving your own race, not just last round's counter`);
  }
  // biggest levers on your side (not about the opponent)
  const lev = [];
  const hits = me.abilities.reduce((a, x, i) => a + (my.abilities[i] && my.abilities[i].type !== 'heal' && my.abilities[i].type !== 'shield' && my.abilities[i].type !== 'buff' ? x.hits : 0), 0);
  const fired = me.abilities.reduce((a, x, i) => a + (my.abilities[i] && my.abilities[i].type !== 'heal' && my.abilities[i].type !== 'shield' && my.abilities[i].type !== 'buff' ? x.fired : 0), 0);
  if (fired >= 6 && hits / fired < 0.45) lev.push(`only ${pct(hits / fired)} of your attacks connected — lead moving targets, attack from range you can hit, or pick wider/faster attacks`);
  if (me.starvedTime > t * 0.12) lev.push(`energy-starved for ${me.starvedTime}s — more energy/regen, cheaper abilities, or spend on what hits`);
  if (me.stunnedTime + me.rootedTime > t * 0.15) lev.push(`controlled for ${Math.round(me.stunnedTime + me.rootedTime)}s — tenacity, a cleanse, or dodge the telegraphs (enemy.casting)`);
  const idle = me.abilities.filter((x, i) => my.abilities[i] && !my.abilities[i].basic && !my.abilities[i].ultimate && x.casts === 0).map((x) => x.name);
  if (idle.length) lev.push(`never used: ${idle.slice(0, 4).join(', ')} — make your brain use it or swap it for something that wins`);
  if (me.distanceShare && my.abilities.filter(a => !a.basic && a.type === 'melee').length >= 2 && me.distanceShare.close < 0.3) lev.push(`melee-heavy kit but only ${pct(me.distanceShare.close)} of the fight was close — close the gap (dash, speed) or change plan`);
  if (my.ultIdx >= 0 && !me.ults) lev.push('your ultimate never fired — it charges from damage dealt/taken; make sure your brain casts it when ready');
  if (lev.length) {
    L.push('  biggest levers on YOUR side:');
    for (const x of lev.slice(0, 4)) L.push(`   - ${x}`);
  }
  if (p.kind !== 'test') L.push('  Beat them, don\'t just counter them: they will change their fighter too. First make YOUR damage race win (burst, uptime, accuracy, sustain), then add counters.');
  return L;
}

/**
 * @param {object} p
 *  side, round, kind ('round'|'test'), labels [a,b], ids [a,b], specs [a,b],
 *  sim {result, stats, brainStats, timeline, events}, score (optional), memoryNote (optional)
 */
function buildReport(p) {
  const { side, sim, specs, labels } = p;
  const other = 1 - side;
  const me = sim.stats[side], opp = sim.stats[other];
  const res = sim.result;
  const my = specs[side], their = specs[other];
  let outcome;
  if (res.winner === null) outcome = res.method === 'DOUBLE KO' ? 'DOUBLE KO — DRAW' : 'DRAW';
  else outcome = res.winner === side ? 'YOU WON' : 'YOU LOST';
  const how = res.method === 'KO' ? `KO at ${res.time}s` : res.method === 'DECISION' ? `on HP % at time (${res.time}s)` : `at ${res.time}s`;
  const head = p.kind === 'test' ? `TEST FIGHT vs ${labels[other]}` : `ROUND ${p.round}`;

  const L = [];
  L.push(`══════ ${head} · ${outcome} — ${how} ══════`);
  L.push(`You:      ${my.name} (${labels[side]})  HP ${res.hp[side]} / ${res.maxHp[side]} (${Math.round(res.hpPct[side])}%)`);
  L.push(`Opponent: ${their.name} (${labels[other]})  HP ${res.hp[other]} / ${res.maxHp[other]} (${Math.round(res.hpPct[other])}%)`);
  if (p.score) L.push(`Match score: ${p.score}`);
  if (p.arena) L.push(`Arena: ${p.arena}`);
  L.push('');
  L.push(...winPlan(me, opp, res, side, my, p));
  L.push('');
  L.push(`Your weapon: ${my.weapon ? `${my.weapon.name} — ${my.weapon.passiveText}` : '—'} · traits: ${my.traits && my.traits.length ? my.traits.map(t => (TRAITS[t] ? TRAITS[t].name : t)).join(', ') : 'none'}`);
  L.push(`DAMAGE     dealt ${me.dealt} (weapon ${me.basicDamage}, crits ${me.crits}) · taken ${me.taken} · healed ${me.healed}${me.lifesteal ? ` (lifesteal ${me.lifesteal})` : ''} · your shields absorbed ${me.shieldAbsorbed}${me.blockedDamage ? ` · shield-blocked ${me.blockedDamage}` : ''}`);
  const dots = [['burn', me.burnDamage], ['poison', me.poisonDamage], ['bleed', me.bleedDamage], ['zone', me.zoneDamage], ['beam', me.beamDamage]].filter(x => x[1]);
  L.push(`           ${dots.length ? dots.map(([k, v]) => `${k} ${v}`).join(' · ') : 'no damage over time'} · stuns landed ${me.stunsLanded} (resisted: ${opp.stunsResisted}) · parries ${me.countersLanded} · traps sprung ${me.trapsTriggered}${me.drained ? ` · drained ${me.drained} energy` : ''}`);
  const v4 = [];
  const awakenWord = (sim.level || 1) >= FEATURE_UNLOCK.ascension ? 'ascension' : 'awakening';
  if (my.ultIdx >= 0) v4.push(`ultimate "${my.abilities[my.ultIdx].name}" ×${me.ults || 0} (${me.ultDamage || 0} dmg)`);
  if ((my.godPowers || []).length) v4.push(`godly powers ×${me.godCasts || 0} (${me.godDamage || 0} dmg)`);
  if (me.awakenings) v4.push(my.awakening && my.awakening.name ? `${my.awakening.name} (${awakenWord}) used` : awakenWord === 'ascension' ? 'ascended' : 'awakened');
  if (me.stanceSwitches) v4.push(`stance switches ${me.stanceSwitches}`);
  if (me.swaps) v4.push(`weapon swaps ${me.swaps}`);
  if (me.relicTriggers) v4.push(`relic triggers ${me.relicTriggers}`);
  if (me.turretShots) v4.push(`turret shots ${me.turretShots}`);
  if (me.revives) v4.push(`revived ${me.revives}×`);
  if (v4.length) L.push(`POWERS     ${v4.join(' · ')}`);
  if (me.stanceTime && Object.values(me.stanceTime).some(v => v > 0) && (my.level || 1) >= 3) {
    L.push(`STANCES    ${Object.entries(me.stanceTime).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${v}s`).join(' · ')}`);
  }
  L.push(`CONTROL    you were stunned ${me.stunnedTime}s · rooted ${me.rootedTime}s · silenced ${me.silencedTime}s · slowed ${me.slowedTime}s · casting/channelling ${me.castingTime}s · energy-starved ${me.starvedTime}s · near the wall ${me.wallTime}s${me.slams ? ` · slammed ${me.slams}×` : ''}`);
  L.push(`DISTANCE   avg ${me.avgDistance} · close (<150) ${pct(me.distanceShare.close)} · mid ${pct(me.distanceShare.mid)} · far (>350) ${pct(me.distanceShare.far)}`);
  L.push('');
  L.push('YOUR ABILITIES (the weapon attack is listed last)');
  L.push(abilityTable(me, my));
  const b = me.blocked;
  const blockedTotal = Object.values(b).reduce((x, y) => x + y, 0);
  if (blockedTotal) {
    L.push(`  ignored "use" requests: ${b.cooldown} on cooldown · ${b.energy} not enough energy · ${b.busy} while casting/dashing/channelling · ${b.gcd} during global cooldown · ${b.stunned} while stunned · ${b.silenced || 0} while silenced · ${b.rooted || 0} dashes while rooted · ${b.unknown} unknown ability`);
  }
  if (p.memoryNote) L.push(`  memory: ${p.memoryNote}`);
  L.push('');
  L.push(`OPPONENT SCOUTING — ${their.name}${their.title ? ` "${their.title}"` : ''} (${labels[other]})`);
  L.push(`  ${describeStats(their)}`);
  L.push(`  weapon: ${their.weapon ? `${their.weapon.name} — ${their.weapon.passiveText}` : '—'}`);
  L.push(`  traits: ${their.traits && their.traits.length ? their.traits.map(t => `${TRAITS[t] ? TRAITS[t].name : t} (${TRAITS[t] ? TRAITS[t].text : ''})`).join(' | ') : 'none'}`);
  if (their.offhand) L.push(`  off-hand: ${their.offhand.name} — ${their.offhand.passiveText}`);
  if (their.stance && their.stance !== 'balanced') L.push(`  starting stance: ${their.stance}`);
  if ((their.relics || []).length) L.push(`  relics: ${their.relics.map(r => (RELICS[r] ? `${RELICS[r].name} (${RELICS[r].text})` : r)).join(' | ')}`);
  if ((their.godPowers || []).length) L.push(`  godly powers: ${their.godPowers.map(g => `${g.name || g.id}${g.blurb ? ` — ${g.blurb}` : ''}`).join(' | ')}`);
  if (their.awakening) L.push(`  ${awakenWord}: ${their.awakening.name}`);
  if (opp.ults || opp.godCasts || opp.awakenings) L.push(`  they used: ${[opp.ults ? `ultimate ×${opp.ults}` : null, opp.godCasts ? `godly powers ×${opp.godCasts}` : null, opp.awakenings ? awakenWord : null].filter(Boolean).join(', ')}`);
  their.abilities.forEach((ab, i) => {
    const s = opp.abilities[i];
    L.push(`  • ${ab.name} — ${describeAbility(ab)}`);
    const canHit = ['melee', 'projectile', 'area', 'zone', 'beam', 'trap'].includes(ab.type) || (ab.type === 'dash' && (ab.damage > 0 || Object.keys(ab.effects || {}).length > 0));
    const hitPart = canHit ? ` · hit you ${s.hits}/${s.fired}${s.fired ? ` (${pct(Math.min(1, s.hits / s.fired))})` : ''} · ${s.damage} damage to you` : '';
    L.push(`      used ${s.casts}×${hitPart}${s.crits ? ` · ${s.crits} crits` : ''}${s.healing ? ` · healed ${s.healing}` : ''}${s.shielding ? ` · shielded ${s.shielding}` : ''}${s.evaded ? ` · ${s.evaded} evaded by your i-frames` : ''}${s.countered ? ` · ${s.countered} parried by you` : ''}`);
  });
  L.push(`  behaviour: avg distance ${opp.avgDistance}; close ${pct(opp.distanceShare.close)} / mid ${pct(opp.distanceShare.mid)} / far ${pct(opp.distanceShare.far)}; energy-starved ${opp.starvedTime}s; evaded ${opp.evades} hits with i-frames; parried ${opp.countersLanded}`);
  if (opp.says.length) L.push(`  they said: ${opp.says.slice(0, 5).map(s => `"${s.text}"`).join(' · ')}`);
  L.push('');
  L.push('TIMELINE (HP % you / opponent)');
  const tl = sim.timeline.filter((row, i) => row[0] % 5 === 0 || i === sim.timeline.length - 1);
  L.push('  ' + tl.map(r => `${r[0]}s ${Math.round(r[1 + side] * 100)}/${Math.round(r[1 + other] * 100)}`).join(' · '));
  const km = keyMoments(sim.events, labels, specs, side);
  if (km.length) {
    L.push('KEY MOMENTS');
    for (const k of km) L.push(`  - ${k}`);
  }
  const bs = sim.brainStats[side];
  if (bs) {
    L.push('');
    L.push(`YOUR BRAIN  ${bs.calls} calls · ${bs.errors} errors (${bs.timeouts} timeouts) · avg ${bs.calls ? (bs.totalMs / bs.calls).toFixed(3) : 0} ms · max ${bs.maxMs.toFixed(2)} ms · budget used ${Math.round(bs.totalMs)}/${RULES.brainBudgetMs} ms`);
    if (bs.loadError) L.push(`  !! ${bs.loadError}`);
    if (bs.disabledReason) L.push(`  !! ${bs.disabledReason}`);
    for (const e of bs.firstErrors.slice(0, 5)) L.push(`  !! t=${(e.tick / RULES.tickRate).toFixed(1)}s ${e.kind}: ${e.message}`);
    if (bs.logs.length) {
      L.push(`  console.log (first ${Math.min(bs.logs.length, 12)} of ${bs.logs.length}):`);
      for (const l of bs.logs.slice(0, 12)) L.push(`    [${(l.tick / RULES.tickRate).toFixed(1)}s] ${l.text}`);
    }
  }
  const text = ascii(L.join('\n'));

  const json = {
    kind: p.kind, round: p.round, side, you: labels[side], opponent: labels[other],
    outcome, result: res, arena: p.arena || null,
    you_stats: me, opponent_stats: opp,
    your_fighter: summarizeSpec(my), opponent_fighter: summarizeSpec(their),
    timeline: sim.timeline,
    key_moments: km,
    brain: bs ? { calls: bs.calls, errors: bs.errors, timeouts: bs.timeouts, avgMs: bs.calls ? bs.totalMs / bs.calls : 0, maxMs: bs.maxMs, totalMs: bs.totalMs, firstErrors: bs.firstErrors, logs: bs.logs.slice(0, 100), loadError: bs.loadError, disabledReason: bs.disabledReason } : null,
  };
  return { text, json, outcome };
}

function summarizeSpec(spec) {
  return {
    name: spec.name, title: spec.title, stats: spec.stats, derived: spec.derived, traits: spec.traits, weapon: spec.weapon,
    abilities: spec.abilities.map(ab => {
      const o = {};
      for (const k of Object.keys(ab)) if (!['cost', 'index', 'design', 'traitNotes'].includes(k)) o[k] = ab[k];
      return o;
    }),
  };
}

module.exports = { buildReport, describeAbility, describeStats, summarizeSpec, effectsText };
