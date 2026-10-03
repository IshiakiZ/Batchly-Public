#!/usr/bin/env node
'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  AI FIGHT — command line tool for the competing AIs.
//  Run `node arena.js help` for usage.
// ─────────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const {
  RULES, STAT_KEYS, STAT_INFO, TRAITS, TRAIT_IDS, LEVELS, MAX_LEVEL, WEAPON_IDS, levelForRound, levelInfo, describeRules, weaponInfo, weaponAttack,
  levelUnlocks, RELICS, RELIC_IDS, STANCES, STANCE_IDS, powers: rulesPowers,
} = require('./engine/rules');
const { readBundle, snapshotOf, checkBundle, parseSprite, SPRITE_FRAMES } = require('./engine/loader');
const { BOTS, BOT_NAMES, GAUNTLET, FULL_GAUNTLET, STARTER_DIR, loadBot, fullCheck, runFight, reportsFor } = require('./engine/match');
const { describeAbility, describeStats } = require('./engine/report');
const { THEMES, themeById, themeForRound } = require('./engine/themes');
const { specDiff, lineDiff, lineCount, fmtVal } = require('./engine/diff');
const { ascii } = require('./engine/text');
const comms = require('./engine/comms');

const config = comms.loadConfig();
const IDS = config.fighters.map(f => f.id);
const DEFAULT_WAIT = 540; // seconds; returns before a 10 minute tool timeout

// ── output helpers ───────────────────────────────────────────────────────────
// Piping into `head` closes stdout early - that's fine, just stop quietly.
process.stdout.on('error', (e) => { if (e && e.code === 'EPIPE') process.exit(0); });
function out(text = '') { process.stdout.write(ascii(text) + '\n'); }
function fail(text, code = 1) { out(text); process.exit(code); }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const n2 = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''));
const clock = () => new Date().toLocaleTimeString('en-GB', { hour12: false });
const pct = (v) => (v === null || v === undefined ? '-' : `${Math.round(v * 100)}%`);

function parseArgs(argv) {
  const pos = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      if (v !== undefined) opts[k] = v;
      else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) opts[k] = argv[++i];
      else opts[k] = true;
    } else pos.push(a);
  }
  return { pos, opts };
}

function fighterFromArg(arg, cmd) {
  if (!arg) fail(`Usage: node arena.js ${cmd} <fighter>   (fighters: ${IDS.join(', ')})`);
  const id = String(arg).toLowerCase();
  if (!IDS.includes(id)) fail(`Unknown fighter "${arg}". Fighters in this arena: ${IDS.join(', ')}`);
  return config.fighters.find(f => f.id === id);
}
function optionalFighter(arg) {
  const id = arg ? String(arg).toLowerCase() : null;
  return id && IDS.includes(id) ? config.fighters.find(f => f.id === id) : null;
}
function opponentOf(id) { return config.fighters.find(f => f.id !== id); }

function fighterDir(id) { return comms.paths.fighterDir(id); }

// ── arena state ──────────────────────────────────────────────────────────────
function readState() { return comms.readJson(comms.paths.state, null); }
function readInbox(id) { return comms.readJson(comms.paths.inbox(id), { acks: [], notices: [] }) || { acks: [], notices: [] }; }

// The level comes from the round the arena is on (round 1 = level 1, max 4).
function currentLevel() {
  const st = readState();
  if (st && st.round) return levelForRound(st.round);
  return 1;
}
function levelLine(level) {
  const l = levelInfo(level);
  return `LEVEL ${l.level}${level === 1 && config.mirrorFirstRound ? ' (round 1 mirror match: only brain.js/lib, names, colours and text may differ from the starter)' : ''}: ${l.statPoints} stat points (max ${l.statMax} each) | ${l.abilitySlots} ability slots | ${l.traitSlots} trait slots | power caps ${Math.round(l.power * 100)}%`;
}
function rel(p) { return path.relative(comms.ROOT, p).split(path.sep).join('/'); }

function currentMatch(state) {
  return state && state.matchId ? comms.readJson(path.join(comms.paths.matchDir(state.matchId), 'match.json'), null) : null;
}
function lastFought(match) {
  if (!match || !Array.isArray(match.rounds) || !match.rounds.length) return null;
  return match.rounds.reduce((a, r) => (r.round > a.round ? r : a));
}
function snapshotDir(state, round, id) { return path.join(comms.paths.matchDir(state.matchId), `round-${round}`, id); }

// ── build clock ──────────────────────────────────────────────────────────────
function fmtClock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function clockRemaining(state) {
  const c = state && state.clockInfo;
  if (!c || !c.enabled) return null;
  if (c.expired) return 0;
  if (!c.started) return c.limitMs;
  if (c.paused || !c.deadline) return c.remainingMs;
  return Math.max(0, c.deadline - Date.now());
}

/** One line with the build clock + who is locked in. Null outside the build phase. */
function clockLine(state, id) {
  if (!state || !comms.serverAlive(state) || state.phase !== 'building') return null;
  const c = state.clockInfo;
  const parts = [];
  if (c && c.enabled) {
    if (c.expired) parts.push('TIME IS UP - unready fighters are being auto-locked');
    else if (!c.started) parts.push(`build time limit ${fmtClock(c.limitMs)} (the clock starts as soon as either AI starts working)`);
    else parts.push(`${fmtClock(clockRemaining(state))} LEFT to lock in${c.paused ? ' (paused by the host)' : ''} - auto-lock at 0:00`);
  } else parts.push('no build time limit this round');
  if (id) {
    const opp = opponentOf(id);
    const me = (state.fighters || {})[id] || {};
    const them = (state.fighters || {})[opp.id] || {};
    parts.push(me.ready ? 'you: LOCKED IN' : 'you: building');
    parts.push(them.ready ? `${opp.label}: LOCKED IN, waiting for you` : `${opp.label}: building`);
  }
  return `[CLOCK] ${parts.join(' | ')}`;
}

function footer(id) {
  const line = clockLine(readState(), id);
  if (line) { out(''); out(line); }
}

// Tell the arena the AI is working (drives the coding-time tracker and starts the build clock).
function ping(id, kind) {
  try {
    const st = readState();
    if (id && comms.serverAlive(st) && st.phase === 'building') comms.postToServer(id, kind, {});
  } catch { /* ignore */ }
}

// ── check ────────────────────────────────────────────────────────────────────
function printCheck(fighter, check, { brief = false } = {}) {
  const spec = check.spec;
  const lvl = levelInfo(check.level || 1);
  out(`== CHECK ${rel(fighterDir(fighter.id))} ==`);
  out(levelLine(lvl.level));
  out(`Fighter: ${spec.name}${spec.title ? ` - "${spec.title}"` : ''}`);
  out(check.ok ? 'Status:  VALID - ready to fight' : `Status:  INVALID - fix ${check.errors.length} error(s) below`);
  if (!brief) {
    const d = spec.derived;
    out('');
    const w = spec.weapon;
    const basic = spec.abilities.find(a => a.basic);
    if (w) {
      out(`WEAPON: ${w.name} (${w.id}, ${w.kind})`);
      if (basic) out(`  free attack "${basic.name}": ${describeAbility(basic)}`);
      out(`  passive: ${w.passiveText}`);
      out('');
    }
    out(`STATS (${spec.pointsUsed}/${lvl.statPoints} points, max ${lvl.statMax} each)`);
    const derived = {
      vitality: `${d.maxHp} max HP`,
      power: `x${n2(d.damageMult)} damage dealt`,
      armor: `takes ${Math.round(d.damageTaken * 100)}% damage`,
      speed: `${n2(d.moveSpeed)} move speed`,
      energy: `${d.maxEnergy} max energy`,
      regen: `${n2(d.energyRegen)}/s energy regen`,
      crit: `${pct(d.critChance)} crit chance, crits deal x${n2(d.critMult)}`,
      haste: `cooldowns x${n2(d.cooldownMult)}, windups x${n2(d.windupMult)}`,
      tenacity: `crowd control on you x${n2(d.ccMult)}, damage over time on you x${n2(d.dotMult)}`,
      precision: `ignores ${pct(d.armorPen)} of enemy armor, projectiles x${n2(d.projSpeedMult)} speed`,
      vigor: `regenerates ${n2(d.hpRegen)} HP/s, healing received x${n2(d.healMult)}`,
      focus: `ultimate + divinity charge x${n2(d.chargeMult)}, awakening +${n2(d.awakenBonus)} s`,
    };
    for (const k of STAT_KEYS) out(`  ${k.padEnd(9)} ${String(spec.stats[k]).padStart(2)} -> ${derived[k] || ''}`);
    out('');
    out(`TRAITS (${spec.traits.length}/${lvl.traitSlots})${spec.traits.length ? '' : lvl.traitSlots ? ' - none picked (see: node arena.js traits)' : ' - traits unlock at level 2'}`);
    for (const t of spec.traits) out(`  ${t.padEnd(15)} ${TRAITS[t].name}: ${TRAITS[t].text}`);
    if (lvl.level >= 3) out(`STANCE: starts ${spec.stance || 'balanced'} (switch with { stance } - node arena.js stances)`);
    if (lvl.relicSlots > 0) {
      out(`RELICS (${(spec.relics || []).length}/${lvl.relicSlots})${(spec.relics || []).length ? '' : ' - none picked (see: node arena.js relics)'}`);
      for (const r of spec.relics || []) out(`  ${r.padEnd(16)} ${RELICS[r].name}: ${RELICS[r].text}`);
    }
    if (spec.offhand) out(`OFF-HAND: ${spec.offhand.name} (${spec.offhand.id}) - swap with { swap: true }; passive: ${spec.offhand.passiveText}`);
    if (lvl.level >= 8) out(`AWAKENING: ${spec.awakening ? spec.awakening.name : 'Awakening'} - { awaken: true } once per fight (after 20 s or below 50% HP)${lvl.level >= 12 ? ' - at level 12 it is ASCENSION' : ''}`);
    if (lvl.godSlots > 0) {
      out(`GODLY POWERS (${(spec.godPowers || []).length}/${lvl.godSlots})${(spec.godPowers || []).length ? '' : ' - none picked (see: node arena.js powers)'}`);
      for (const g of spec.godPowers || []) out(`  ${g.id.padEnd(12)} ${g.name || ''}${g.blurb ? ` - ${g.blurb}` : ''}`);
    }
    out('');
    const own = spec.abilities.filter(a => !a.basic && !a.ultimate);
    out(`ABILITIES (${own.length}/${lvl.abilitySlots}, plus your free weapon attack)`);
    own.forEach((ab, i) => {
      out(`  ${i + 1}. ${ab.name} [${ab.type}]  energy ${ab.energy}  cooldown ${n2(ab.cooldown)}s  windup ${n2(ab.windup)}s${ab.reach ? `  reach ${Math.round(ab.reach)}` : ''}`);
      out(`       ${describeAbility(ab)}`);
      const c = ab.cost;
      if (c) out(`       cost = ${RULES.energyScale} x value ${n2(c.value)} x delivery ${n2(c.delivery)} x windupMod ${n2(c.windupMod)} x cooldownMod ${n2(c.cooldownMod)} = ${c.energy}`);
      for (const note of ab.traitNotes || []) out(`       modifier -> ${note}`);
    });
    if (basic) out(`  W. ${basic.name} [weapon attack, ${basic.type}]  FREE (no energy)  cooldown ${n2(basic.cooldown)}s  windup ${n2(basic.windup)}s${basic.reach ? `  reach ${Math.round(basic.reach)}` : ''}  - use it like any ability: { use: "${basic.name}" }`);
    const offB = spec.abilities.find(a => a.basic && a.offhand);
    if (offB) out(`  O. ${offB.name} [off-hand attack, ${offB.type}]  FREE  cooldown ${n2(offB.cooldown)}s - usable while the off-hand is in your hands`);
    const ult = spec.ultIdx >= 0 ? spec.abilities[spec.ultIdx] : null;
    if (ult) {
      out(`  U. ${ult.name} [ULTIMATE, ${ult.type}]  charge 100 (no energy, no cooldown)  windup ${n2(ult.windup)}s  power ${ult.ultCost}/${ult.ultBudget} of your budget`);
      out(`       ${describeAbility(ult)}`);
    } else if (lvl.level >= 5) out('  U. (no ultimate yet - add "ultimate": {...} to fighter.json; see node arena.js powers)');
  }
  if (!brief && check.extra) {
    const x = check.extra;
    out('');
    out(`LOOK: ${x.look}`);
    out(`BRAIN: brain.js ${x.brainLines} lines${x.lib.length ? ` + lib/ ${x.lib.map(l => `${l.name} (${l.lines})`).join(', ')}` : ''}`);
    out(`MEMORY: ${x.memory}`);
  }
  if (check.smoke) {
    const s = check.smoke;
    out('');
    out(`BRAIN SMOKE TEST (4s vs Training Dummy): ${s.calls} calls, ${s.errors} errors, avg ${s.avgMs.toFixed(3)} ms, ${s.casts} casts, ${s.dealt} damage`);
    for (const l of s.logs.slice(0, 5)) out(`  console: ${l.text}`);
  }
  if (check.warnings.length) {
    out('');
    out('WARNINGS');
    for (const w of check.warnings) out(`  - ${w}`);
  }
  if (check.errors.length) {
    out('');
    out('ERRORS');
    for (const e of check.errors) out(`  X ${e}`);
  }
}

// ── look / memory helpers ────────────────────────────────────────────────────
function lookText(bundle, spec) {
  if (bundle.spriteSource === 'file') return 'hand-painted sprite.json (it overrides any "look")';
  const lk = spec && spec.look;
  if (bundle.spriteSource === 'look' && lk) {
    const bits = [lk.base, lk.build, lk.outfit, lk.headgear, lk.hair && lk.hair !== 'none' ? `${lk.hair} hair` : null, lk.face, lk.cape && lk.cape !== 'none' ? `${lk.cape} cape` : null, lk.aura && lk.aura !== 'none' ? `${lk.aura} aura` : null]
      .filter(x => x && x !== 'none' && x !== 'plain');
    return `composed from your "look": ${bits.join(', ')} (preview: node arena.js sprite <you>; options: node arena.js looks)`;
  }
  return 'plain default sprite - add a "look" to fighter.json (options: node arena.js looks)';
}

/** The brain memory this AI's brain will start its next fight with ({json, round, bytes} or null). */
function storedMemory(id) {
  const state = readState();
  if (!state || !state.matchId) return null;
  const m = comms.readJson(comms.paths.memory(state.matchId, id), null);
  return m && typeof m.json === 'string' ? m : null;
}
function memoryText(id) {
  const m = storedMemory(id);
  if (!m) return 'empty - after each round, whatever your brain left in the global `memory` object is kept for the next round';
  return `${m.bytes} bytes saved after round ${m.round} - your brain starts every fight (and test) with it in \`memory\` (show it: node arena.js memory <you>)`;
}

function checkExtra(id, bundle, spec) {
  return {
    look: lookText(bundle, spec),
    brainLines: lineCount(bundle.brain),
    lib: bundle.lib ? Object.keys(bundle.lib).sort().map(n => ({ name: n, lines: lineCount(bundle.lib[n]) })) : [],
    memory: memoryText(id),
  };
}

function cmdCheck(args) {
  const fighter = fighterFromArg(args.pos[0], 'check');
  ping(fighter.id, 'check');
  const bundle = readBundle(fighterDir(fighter.id));
  if (!bundle.exists) fail(`Nothing in ${rel(fighterDir(fighter.id))} yet. Create fighter.json and brain.js there (see AI_GUIDE.md).`);
  const level = args.opts.level ? levelForRound(Number(args.opts.level)) : currentLevel();
  const check = fullCheck(bundle, { level, mirror: config.mirrorFirstRound });
  check.extra = checkExtra(fighter.id, bundle, check.spec);
  printCheck(fighter, check);
  footer(fighter.id);
  process.exit(check.ok ? 0 : 1);
}

// ── test ─────────────────────────────────────────────────────────────────────
// Opponents: a bot name, all (quick gauntlet), full (every bot), mirror (yourself),
// previous (your fighter from the last round), or a folder inside fighters/<you>/.
function resolveOpponents(fighter, which, args, bundle, level) {
  const id = fighter.id;
  const custom = (dirArg, label) => {
    const base = fighterDir(id);
    const dir = path.resolve(base, String(dirArg));
    if (dir !== base && !dir.startsWith(base + path.sep)) fail(`--vs must point to a folder inside ${rel(base)}/ (you can't load other fighters).`);
    if (dir === base) fail('That is your current fighter - use "mirror" to fight a copy of yourself.');
    if (!fs.existsSync(path.join(dir, 'fighter.json'))) fail(`No fighter.json in ${rel(dir)}/`);
    const b = readBundle(dir);
    const c = checkBundle(b, { level });
    if (!c.ok) fail(`The fighter in ${rel(dir)}/ is not valid at level ${level}:\n${c.errors.map(e => `  X ${e}`).join('\n')}`);
    return { key: 'custom', label: label || rel(dir), bundle: b };
  };
  if (args.opts.vs) return [custom(args.opts.vs)];
  if (which === 'all') return GAUNTLET.map(n => ({ key: n }));
  if (which === 'full') return FULL_GAUNTLET.map(n => ({ key: n }));
  if (which === 'mirror') return [{ key: 'mirror', label: `${fighter.label} (mirror)`, bundle }];
  if (BOTS[which]) return [{ key: which }];
  if (which === 'previous' || which === 'prev' || which === 'last') {
    const state = readState();
    const last = lastFought(currentMatch(state));
    if (!last) fail('No previous version yet - you have not fought a round in this match.');
    const dir = snapshotDir(state, last.round, id);
    const b = readBundle(dir);
    if (!b.exists) fail(`Could not find your round ${last.round} fighter.`);
    const c = checkBundle(b, { level });
    if (!c.ok) fail(`Your round ${last.round} fighter is not valid at level ${level}: ${c.errors[0]}`);
    return [{ key: 'previous', label: `${fighter.label} (round ${last.round})`, bundle: b }];
  }
  if (fs.existsSync(path.join(fighterDir(id), which, 'fighter.json'))) return [custom(which)];
  fail(`Unknown opponent "${which}". Choose: ${BOT_NAMES.join(', ')}, all, full, mirror, previous, or a folder inside ${rel(fighterDir(id))}/`);
  return [];
}

function cmdTest(args) {
  const fighter = fighterFromArg(args.pos[0], 'test');
  const which = String(args.pos[1] || 'all').toLowerCase();
  const bundle = readBundle(fighterDir(fighter.id));
  const level = args.opts.level ? levelForRound(Number(args.opts.level)) : currentLevel();
  const check = fullCheck(bundle, { level, mirror: config.mirrorFirstRound });
  if (!check.ok) {
    ping(fighter.id, 'check');
    printCheck(fighter, check, { brief: true });
    footer(fighter.id);
    fail('\nFix the errors above, then test again.');
  }
  const opponents = resolveOpponents(fighter, which, args, bundle, level);
  const seed = args.opts.seed !== undefined ? (Number(args.opts.seed) >>> 0) : (Math.floor(Math.random() * 2 ** 31) >>> 0);
  // Arena: the current round's arena unless --arena <id> (or --arena none for an empty ring).
  const state = readState();
  let theme = state && state.theme ? themeById(state.theme.id) : themeForRound(state && state.round ? state.round : 1, state && state.matchNumber ? state.matchNumber : 1);
  if (args.opts.arena) {
    const want = String(args.opts.arena).toLowerCase();
    if (want === 'none' || want === 'empty') theme = null;
    else if (THEMES.some(t => t.id === want)) theme = themeById(want);
    else fail(`Unknown arena "${args.opts.arena}". Arenas: ${THEMES.map(t => t.id).join(', ')}, none`);
  }
  const arenaText = theme ? `${theme.name} - ${theme.blurb}` : 'empty ring (no obstacles)';
  // Your brain starts with the memory it saved in the last round (a mirror copy gets it too).
  const myMemory = args.opts['no-memory'] ? null : (storedMemory(fighter.id) || {}).json || null;

  const fights = [];
  for (const opp of opponents) {
    const oppBundle = opp.bundle || loadBot(opp.key, level);
    const oppLabel = opp.label || `bot:${opp.key}`;
    const { sim, specs, replay } = runFight({
      bundles: [bundle, oppBundle], ids: [fighter.id, opp.key], labels: [fighter.label, oppLabel], seed, kind: 'test', level,
      swapStart: !!args.opts.swap, theme, memories: [myMemory, opp.key === 'mirror' ? myMemory : null],
    });
    const [report] = reportsFor({ sim, specs, labels: [fighter.label, oppLabel], kind: 'test', round: 0, arena: arenaText });
    fights.push({ opponent: opp.key, oppName: opp.key === 'previous' || opp.key === 'custom' ? `${specs[1].name} [${oppLabel}]` : specs[1].name, sim, specs, replay, report });
  }

  if (fights.length === 1) {
    out(fights[0].report.text);
  } else {
    out(`== TEST GAUNTLET: ${check.spec.name} vs ${fights.length} sparring bots at level ${level} (seed ${seed}) ==`);
    out(`   arena: ${arenaText}${myMemory ? ` | your brain starts with its saved memory (${Buffer.byteLength(myMemory, 'utf8')} bytes)` : ''}`);
    out('   (bots are scaled to your level; "rookie" is the shared starter with its default brain)');
    out('  opponent             result     how                 time   your HP  their HP  dealt  taken');
    let wins = 0;
    for (const f of fights) {
      const r = f.sim.result;
      const res = r.winner === 0 ? 'WIN' : r.winner === 1 ? 'LOSS' : 'DRAW';
      if (r.winner === 0) wins++;
      out(`  ${f.oppName.slice(0, 20).padEnd(20)} ${res.padEnd(10)} ${r.method.padEnd(18)} ${String(r.time).padStart(5)}s ${String(Math.round(r.hpPct[0])).padStart(6)}% ${String(Math.round(r.hpPct[1])).padStart(8)}% ${String(f.sim.stats[0].dealt).padStart(6)} ${String(f.sim.stats[0].taken).padStart(6)}`);
    }
    out(`  -> ${wins}/${fights.length} wins`);
    out('');
    out('YOUR ABILITIES ACROSS THE GAUNTLET');
    const agg = check.spec.abilities.map(a => ({ name: a.name, type: a.type, basic: a.basic, casts: 0, fired: 0, hits: 0, damage: 0, crits: 0, dealsDamage: !!(a.damage || a.dps) }));
    for (const f of fights) f.sim.stats[0].abilities.forEach((a, i) => { if (!agg[i]) return; agg[i].casts += a.casts; agg[i].fired += a.fired; agg[i].hits += a.hits; agg[i].damage += a.damage; agg[i].crits += a.crits || 0; });
    for (const a of agg) {
      const canHit = !['shield', 'heal', 'buff', 'cleanse', 'counter'].includes(a.type) && !(a.type === 'dash' && !a.dealsDamage);
      out(`  ${`${a.name} (${a.basic ? 'weapon' : a.type})`.padEnd(28)} casts ${String(a.casts).padStart(4)}  ${canHit ? `hits ${a.hits}/${a.fired} (${a.fired ? Math.round((a.hits / a.fired) * 100) : 0}%)` : ''}  dmg ${a.damage}${a.crits ? `  crits ${a.crits}` : ''}`);
    }
    const errs = fights.reduce((s, f) => s + (f.sim.brainStats[0] ? f.sim.brainStats[0].errors : 0), 0);
    out('');
    out(`BRAIN: ${errs} errors across all fights`);
    for (const f of fights) {
      const bs = f.sim.brainStats[0];
      if (bs && bs.firstErrors.length) out(`  vs ${f.oppName}: ${bs.firstErrors[0].message}`);
    }
    const logs = fights.flatMap(f => (f.sim.brainStats[0] ? f.sim.brainStats[0].logs.slice(0, 3).map(l => `vs ${f.oppName} [${(l.tick / RULES.tickRate).toFixed(1)}s] ${l.text}`) : []));
    if (logs.length) {
      out('console.log (first lines per fight):');
      for (const l of logs.slice(0, 12)) out(`  ${l}`);
    }
    out('');
    out(`Detailed report for one opponent: node arena.js test ${fighter.id} <bot|mirror|previous>   |   blow-by-blow: node arena.js log ${fighter.id} test <bot>`);
  }

  // Hand the replays to the arena screen so spectators can watch the sparring.
  try {
    const payload = {
      at: Date.now(), fighter: fighter.id, seed,
      fights: fights.map(f => ({
        opponent: f.opponent, oppName: f.oppName,
        result: f.sim.result, dealt: f.sim.stats[0].dealt, taken: f.sim.stats[0].taken,
        replay: f.replay,
      })),
    };
    comms.atomicWrite(comms.paths.tests(fighter.id), JSON.stringify(payload));
    comms.postToServer(fighter.id, 'test', {
      summary: fights.map(f => ({ opponent: f.opponent, oppName: f.oppName, winner: f.sim.result.winner, method: f.sim.result.method, time: f.sim.result.time, hpPct: f.sim.result.hpPct })),
      seed,
    });
  } catch (e) {
    out(`(could not send the replay to the arena screen: ${e.message})`);
  }
  footer(fighter.id);
}

// ── say ──────────────────────────────────────────────────────────────────────
function cmdSay(args) {
  const fighter = fighterFromArg(args.pos[0], 'say');
  const text = args.pos.slice(1).join(' ').trim();
  if (!text) fail(`Usage: node arena.js say ${fighter.id} "your message"`);
  comms.postToServer(fighter.id, 'say', { text: text.slice(0, 280) });
  const state = readState();
  out(comms.serverAlive(state) ? 'Posted to the arena screen.' : 'Saved (the arena server is not running right now, so nobody will see it until it starts).');
  footer(fighter.id);
}

// ── ready / wait ─────────────────────────────────────────────────────────────
function serverDownMessage() {
  return [
    'The arena server is not running (no heartbeat in data/state.json).',
    'Ask the human to start it:  npm start   (or double-click start.bat), then run this command again.',
  ].join('\n');
}

function scoreLine(state) {
  if (!state || !state.score) return '';
  const [a, b] = config.fighters;
  return `${a.label} ${state.score[a.id] || 0} - ${state.score[b.id] || 0} ${b.label}${state.score.draws ? ` (${state.score.draws} draws)` : ''}`;
}

function writePresence(id, info) {
  try { comms.atomicWrite(comms.paths.presence(id), JSON.stringify(Object.assign({ at: Date.now(), pid: process.pid }, info))); } catch { /* ignore */ }
}
function clearPresence(id) { comms.removeFile(comms.paths.presence(id)); }

async function waitForAck(id, nonce, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const inbox = readInbox(id);
    const ack = (inbox.acks || []).find(a => a.nonce === nonce);
    if (ack) return ack;
    await sleep(250);
  }
  return null;
}

function maxWaitSeconds(args) {
  const v = Number(args.opts.max);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_WAIT;
}

const AUTO_WHAT = {
  current: 'your files as they were at 0:00',
  previous: 'your fighter from last round (your files were invalid at 0:00)',
  starter: 'the Rookie starter (you had no valid fighter at 0:00)',
};

// Waits until the server posts the notice for (matchId, round).
async function waitLoop(fighter, target, args) {
  const id = fighter.id;
  const maxS = maxWaitSeconds(args);
  const deadline = Date.now() + maxS * 1000;
  let lastPhase = null;
  let lastBeat = Date.now();
  let warnedDown = false;
  out(`[${clock()}] Waiting for round ${target.round} to be fought and for the host's decision (Next Round / End Match).`);
  out('           This can take several minutes. Do not interrupt; if your shell times out, just run:');
  out(`           node arena.js wait ${id}`);
  const cleanup = () => { clearPresence(id); process.exit(130); };
  process.once('SIGINT', cleanup);
  process.once('SIGTERM', cleanup);
  while (Date.now() < deadline) {
    writePresence(id, { mode: 'waiting', matchId: target.matchId, round: target.round });
    const inbox = readInbox(id);
    const notice = (inbox.notices || []).find(n => n.matchId === target.matchId && n.round === target.round);
    if (notice) {
      clearPresence(id);
      out('');
      out(notice.text);
      return 0;
    }
    const state = readState();
    if (state && state.matchId !== target.matchId) {
      // The match was reset without a notice (e.g. data folder wiped).
      clearPresence(id);
      out('');
      out('STATUS: MATCH_OVER');
      out('The match you were waiting on no longer exists (the host reset the arena). Stop here and tell the human.');
      return 0;
    }
    if (!comms.serverAlive(state)) {
      if (!warnedDown) { out(`[${clock()}] ! The arena server stopped responding - still waiting for it to come back.`); warnedDown = true; }
    } else if (warnedDown) { out(`[${clock()}] Server is back.`); warnedDown = false; }
    if (state && state.phase !== lastPhase) {
      lastPhase = state.phase;
      const msg = {
        building: 'waiting for your opponent to lock in',
        countdown: 'both AIs locked in - countdown started',
        fighting: 'FIGHT IN PROGRESS',
        round_over: 'round finished - waiting for the host to choose Next Round or End Match',
        match_over: 'match over',
      }[state.phase] || state.phase;
      out(`[${clock()}] ${msg}`);
      if (state.phase === 'building') { const cl = clockLine(state, id); if (cl) out(`           ${cl}`); }
    }
    if (Date.now() - lastBeat > 60000) {
      lastBeat = Date.now();
      const cl = state && state.phase === 'building' ? clockLine(state, id) : null;
      out(`[${clock()}] ...still waiting (${lastPhase})${cl ? `  ${cl}` : ''}`);
    }
    await sleep(1000);
  }
  clearPresence(id);
  out('');
  out('STATUS: STILL_WAITING');
  out(`No decision yet after ${maxS}s (phase: ${lastPhase}). This is normal - the human decides when the next round starts.`);
  out(`Run this again right away to keep waiting:  node arena.js wait ${id}`);
  return 0;
}

async function cmdReady(args) {
  const fighter = fighterFromArg(args.pos[0], 'ready');
  const id = fighter.id;
  const state = readState();
  if (!comms.serverAlive(state)) fail(serverDownMessage());
  const me = state.fighters && state.fighters[id];
  if (state.phase === 'match_over') {
    const inbox = readInbox(id);
    const last = (inbox.notices || []).filter(n => n.matchId === state.matchId).pop();
    out(last ? last.text : 'STATUS: MATCH_OVER\nThe match is over. Wait for the human to start a new match.');
    return 0;
  }
  if (state.phase !== 'building') {
    if (me && me.ready && me.autoLocked) out(`TIME RAN OUT - the arena auto-locked ${AUTO_WHAT[me.autoLocked] || 'your fighter'}: "${me.lockedName}".`);
    else out(`Round ${state.round} is already ${state.phase === 'round_over' ? 'finished' : 'underway'} (${state.phase}).`);
    if (me && me.ready) return waitLoop(fighter, { matchId: state.matchId, round: state.round }, args);
    out('You are not part of this round. Wait for the next round to start, then run ready again.');
    return 1;
  }
  const bundle = readBundle(fighterDir(id));
  if (!bundle.exists) fail(`Nothing in ${rel(fighterDir(id))} yet - build your fighter first (see AI_GUIDE.md).`);
  const check = fullCheck(bundle, { level: currentLevel(), mirror: config.mirrorFirstRound });
  if (!check.ok) {
    printCheck(fighter, check, { brief: true });
    footer(id);
    fail('\nNOT READY - fix the errors above, then run ready again. (If the clock runs out first, the arena auto-locks your last valid version.)');
  }
  const nonce = comms.postToServer(id, 'ready', {
    round: state.round, matchId: state.matchId, snapshot: snapshotOf(bundle),
  });
  const ack = await waitForAck(id, nonce, 15000);
  if (!ack) fail('No answer from the arena server within 15s. Is it running? (npm start)');
  if (!ack.ok) fail(`NOT READY: ${ack.message}`);
  out(`LOCKED IN: "${check.spec.name}" is ready for round ${ack.round}. ${ack.opponentReady ? 'Your opponent is ready too - the fight starts now!' : 'Waiting for your opponent to lock in...'}`);
  out('(Your files are snapshotted - edits you make now will NOT affect this round.)');
  return waitLoop(fighter, { matchId: ack.matchId, round: ack.round }, args);
}

async function cmdWait(args) {
  const fighter = fighterFromArg(args.pos[0], 'wait');
  const id = fighter.id;
  const state = readState();
  if (!state) fail(serverDownMessage());
  const inbox = readInbox(id);
  const me = state.fighters && state.fighters[id];
  if (state.phase === 'match_over') {
    const last = (inbox.notices || []).filter(n => n.matchId === state.matchId).pop();
    out(last ? last.text : 'STATUS: MATCH_OVER\nThe match is over.');
    return 0;
  }
  if (me && me.ready) {
    if (me.autoLocked) out(`(Time ran out - the arena auto-locked ${AUTO_WHAT[me.autoLocked] || 'your fighter'}: "${me.lockedName}".)`);
    return waitLoop(fighter, { matchId: state.matchId, round: state.round }, args);
  }
  // Not locked in: maybe the decision for the previous round already arrived.
  const prev = (inbox.notices || []).find(n => n.matchId === state.matchId && n.round === state.round - 1);
  if (state.phase === 'building' && prev) {
    out(prev.text);
    footer(id);
    return 0;
  }
  out(`You are not locked in for round ${state.round} (phase: ${state.phase}).`);
  out(`Finish your fighter, then run: node arena.js ready ${id}`);
  footer(id);
  return 0;
}

// ── time / status ────────────────────────────────────────────────────────────
function activityText(state, id) {
  const a = state.activity && state.activity[id];
  if (!a || !a.firstAt) return 'no activity yet';
  const ms = a.codingMs !== null && a.codingMs !== undefined ? a.codingMs : Date.now() - a.firstAt;
  return `${fmtClock(ms)} of work, ${a.saves} saves, ${a.checks} checks, ${a.tests} tests`;
}

function cmdTime(args) {
  const fighter = optionalFighter(args.pos[0]);
  const state = readState();
  if (!comms.serverAlive(state)) fail(serverDownMessage());
  if (fighter) ping(fighter.id, 'cmd');
  out(`BUILD CLOCK - match ${state.matchNumber || 1}, round ${state.round} (level ${levelForRound(state.round)}), phase: ${state.phase}`);
  const c = state.clockInfo;
  if (state.phase !== 'building') out('  The clock only runs while the AIs are building.');
  else if (!c || !c.enabled) out('  No time limit this round.');
  else if (c.expired) out('  TIME IS UP. Fighters that were not locked in have been auto-locked.');
  else if (!c.started) out(`  Limit ${fmtClock(c.limitMs)}. The clock starts as soon as either AI does something (saves a file, runs an arena command or locks in).`);
  else out(`  ${fmtClock(clockRemaining(state))} left of ${fmtClock(c.limitMs)}${c.paused ? ' - PAUSED by the host' : ''}.`);
  if (state.phase === 'building' && c && c.enabled) {
    out('  At 0:00 every fighter that is not locked in is auto-locked: its current files if they are valid,');
    out('  otherwise its fighter from last round, otherwise the starter. Keep your files valid at all times!');
  }
  for (const f of config.fighters) {
    const s = (state.fighters || {})[f.id] || {};
    out(`  ${f.label.padEnd(10)} ${s.ready ? `LOCKED IN${s.autoLocked ? ' (auto)' : ''}` : 'building '}  - ${activityText(state, f.id)}`);
  }
}

function cmdStatus(args) {
  const state = readState();
  if (!state) fail(serverDownMessage());
  const fighter = optionalFighter(args.pos[0]);
  if (fighter) ping(fighter.id, 'cmd');
  out(`Arena server: ${comms.serverAlive(state) ? 'running' : 'NOT RUNNING'}`);
  out(`Match ${state.matchNumber || 1} | round ${state.round} | phase: ${state.phase}${state.theme ? ` | arena: ${state.theme.name}` : ''}`);
  out(levelLine(levelForRound(state.round)));
  out(`Score: ${scoreLine(state)}`);
  for (const f of config.fighters) {
    const s = (state.fighters || {})[f.id] || {};
    out(`  ${f.label.padEnd(10)} (${f.id}): ${s.ready ? `LOCKED IN (${s.lockedName || ''})${s.autoLocked ? ' - auto-locked when time ran out' : ''}` : 'building'} - ${activityText(state, f.id)}`);
  }
  if (state.lastResult) out(`Last round: ${state.lastResult}`);
  if (fighter) {
    const inbox = readInbox(fighter.id);
    const last = (inbox.notices || []).filter(n => n.matchId === state.matchId).pop();
    if (last) out(`Latest notice for ${fighter.id}: round ${last.round} -> ${last.kind}`);
  }
  footer(fighter ? fighter.id : null);
}

// ── report / history / scout / diff / log ────────────────────────────────────
function cmdReport(args) {
  const fighter = fighterFromArg(args.pos[0], 'report');
  ping(fighter.id, 'cmd');
  const dir = comms.paths.reports(fighter.id);
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => /^m\d+-round-\d+\.md$/.test(f)); } catch { /* none */ }
  if (!files.length) fail('No round reports yet - they appear after your first real round.');
  const key = (f) => { const m = /^m(\d+)-round-(\d+)/.exec(f); return Number(m[1]) * 10000 + Number(m[2]); };
  files.sort((a, b) => key(a) - key(b));
  let want = files[files.length - 1];
  if (args.pos[1]) {
    const state = readState();
    const matchNumber = (state && state.matchNumber) || Number(/^m(\d+)/.exec(want)[1]);
    want = `m${matchNumber}-round-${Number(args.pos[1])}.md`;
  }
  if (!files.includes(want)) fail(`No report ${want}. Available: ${files.join(', ')}`);
  out(`(${rel(path.join(dir, want))})`);
  out(fs.readFileSync(path.join(dir, want), 'utf8'));
  footer(fighter.id);
}

function cmdHistory(args) {
  const fighter = fighterFromArg(args.pos[0], 'history');
  const id = fighter.id;
  const opp = opponentOf(id);
  const state = readState();
  if (!state) fail(serverDownMessage());
  ping(id, 'cmd');
  const match = currentMatch(state);
  out(`== MATCH ${state.matchNumber || 1} - score: ${scoreLine(state)} ==`);
  const rounds = match && match.rounds ? match.rounds.slice().sort((a, b) => a.round - b.round) : [];
  if (!rounds.length) out('No rounds fought yet in this match.');
  else {
    out('  rnd lvl result how       time   your fighter          HP left dealt taken  acc  your work  vs');
    for (const r of rounds) {
      const me = r.fighters[id] || {}, them = r.fighters[opp.id] || {};
      const sm = me.summary || {};
      const res = r.result.winnerId === null ? 'DRAW' : r.result.winnerId === id ? 'WIN' : 'LOSS';
      const act = r.activity && r.activity[id];
      const work = act && act.codingMs !== null && act.codingMs !== undefined ? fmtClock(act.codingMs) + (act.autoLocked && act.autoLocked !== 'host' ? '*' : '') : '-';
      out(`  ${String(r.round).padStart(3)} ${String(r.level || levelForRound(r.round)).padStart(3)} ${res.padEnd(6)} ${String(r.result.method).padEnd(9)} ${String(r.result.time).padStart(5)}s ${String(me.name || '?').slice(0, 21).padEnd(21)} ${String(Math.round(r.result.hpPct ? r.result.hpPct[id] : 0)).padStart(6)}% ${String(sm.dealt || 0).padStart(5)} ${String(sm.taken || 0).padStart(5)} ${pct(sm.accuracy).padStart(4)} ${work.padStart(9)}  ${them.name || '?'}`);
    }
    if (rounds.some(r => r.activity && r.activity[id] && r.activity[id].autoLocked && r.activity[id].autoLocked !== 'host')) out('  (* = time ran out and the arena auto-locked your fighter)');
  }
  const hist = comms.readJson(comms.paths.history, { matches: [] }) || { matches: [] };
  const earlier = (hist.matches || []).filter(m => m.matchId !== state.matchId);
  if (earlier.length) {
    out('');
    out('EARLIER MATCHES');
    for (const m of earlier.slice(-8)) {
      const w = m.winnerId ? (m.winnerId === id ? 'you WON' : 'you LOST') : 'draw';
      out(`  match ${m.matchNumber}: ${w} ${m.score[id] || 0}-${m.score[opp.id] || 0} over ${m.rounds.length} round${m.rounds.length === 1 ? '' : 's'}`);
    }
  }
  footer(id);
}

function cmdScout(args) {
  const fighter = fighterFromArg(args.pos[0], 'scout');
  const id = fighter.id;
  const opp = opponentOf(id);
  const state = readState();
  if (!state) fail(serverDownMessage());
  ping(id, 'cmd');
  const match = currentMatch(state);
  const last = lastFought(match);
  if (!last) {
    out(`No scouting data yet - nothing has been fought in this match.${config.mirrorFirstRound ? ' Round 1 is the mirror match: both of you start with the identical Rookie (engine/starter/), only the brains differ.' : ''}`);
    footer(id);
    return;
  }
  const b = readBundle(snapshotDir(state, last.round, opp.id));
  const c = checkBundle(b, { level: last.level || levelForRound(last.round) });
  const spec = c.spec;
  out(`== SCOUTING: ${opp.label}'s fighter as it fought in round ${last.round} ==`);
  out(`"${spec.name}"${spec.title ? ` - ${spec.title}` : ''}${spec.catchphrase ? `  ("${spec.catchphrase}")` : ''}`);
  out(`  weapon: ${spec.weapon ? `${spec.weapon.name} - ${spec.weapon.passiveText}` : '-'}`);
  out(`  stats:  ${describeStats(spec)}`);
  out(`  traits: ${spec.traits.length ? spec.traits.map(t => `${TRAITS[t].name} - ${TRAITS[t].text}`).join(' | ') : 'none'}`);
  out('  abilities:');
  spec.abilities.filter(ab => !ab.basic).forEach((ab, i) => out(`    ${i + 1}. ${ab.name} - ${describeAbility(ab)}`));
  const basic = spec.abilities.find(ab => ab.basic);
  if (basic) out(`    W. ${basic.name} - ${describeAbility(basic)}`);
  out('');
  out(`${opp.label.toUpperCase()} THIS MATCH`);
  for (const r of match.rounds.slice().sort((a, b2) => a.round - b2.round)) {
    const them = r.fighters[opp.id] || {};
    const sm = them.summary || {};
    const res = r.result.winnerId === null ? 'draw' : r.result.winnerId === opp.id ? 'WON' : 'lost';
    out(`  round ${r.round}: "${them.name}" ${res} (${r.result.method} at ${r.result.time}s) - dealt ${sm.dealt || 0}, accuracy ${pct(sm.accuracy)}, biggest hit ${sm.biggestHit || 0}${sm.biggestHitAbility ? ` (${sm.biggestHitAbility})` : ''}`);
  }
  out('');
  out('They can change everything before the next fight - this is only what they used last time. Their brain.js stays secret.');
  footer(id);
}

function cmdDiff(args) {
  const fighter = fighterFromArg(args.pos[0], 'diff');
  const id = fighter.id;
  ping(id, 'cmd');
  const state = readState();
  const level = currentLevel();
  const cur = readBundle(fighterDir(id));
  if (!cur.exists) fail(`Nothing in ${rel(fighterDir(id))} yet.`);
  const curCheck = checkBundle(cur, { level });
  const last = state ? lastFought(currentMatch(state)) : null;
  const base = last ? readBundle(snapshotDir(state, last.round, id)) : readBundle(STARTER_DIR);
  const baseCheck = checkBundle(base, { level: last ? (last.level || levelForRound(last.round)) : 1 });
  out(`== DIFF: your current files vs ${last ? `the fighter you locked in for round ${last.round}` : 'the Rookie starter'} ==`);
  if (!base.exists) fail('  (could not find the previous version)');
  const d = specDiff(baseCheck.spec, curCheck.spec);
  let changes = 0;
  if (d.nameChanged) { out(`  name:      "${d.nameChanged}" -> "${curCheck.spec.name}"`); changes++; }
  if (d.weapon) { out(`  weapon:    ${d.weapon.from} -> ${d.weapon.to}`); changes++; }
  const st = Object.entries(d.stats);
  if (st.length) { out(`  stats:     ${st.map(([k, v]) => `${k} ${baseCheck.spec.stats[k]} -> ${curCheck.spec.stats[k]} (${v > 0 ? '+' : ''}${v})`).join(', ')}`); changes++; }
  for (const t of d.traits.added) { out(`  + trait    ${TRAITS[t] ? TRAITS[t].name : t}`); changes++; }
  for (const t of d.traits.removed) { out(`  - trait    ${TRAITS[t] ? TRAITS[t].name : t}`); changes++; }
  for (const a of d.abilities) {
    changes++;
    if (a.kind === 'added') out(`  + ability  ${a.name} (${a.type})`);
    else if (a.kind === 'removed') out(`  - ability  ${a.name} (${a.type})`);
    else out(`  ~ ability  ${a.name}: ${a.changes.map(c => `${c.field} ${fmtVal(c.from)} -> ${fmtVal(c.to)}`).join(', ')}`);
  }
  const bd = lineDiff(base.brain, cur.brain);
  if (bd.added || bd.removed) { out(`  brain.js:  ${lineCount(base.brain)} -> ${lineCount(cur.brain)} lines (+${bd.added} / -${bd.removed} changed lines)`); changes++; }
  const libNames = [...new Set([...Object.keys(base.lib || {}), ...Object.keys(cur.lib || {})])].sort();
  for (const n of libNames) {
    const a = (base.lib || {})[n], b = (cur.lib || {})[n];
    if (a === b) continue;
    changes++;
    if (a === undefined) out(`  + lib/${n}  (${lineCount(b)} lines)`);
    else if (b === undefined) out(`  - lib/${n}`);
    else { const ld = lineDiff(a, b); out(`  ~ lib/${n}  (+${ld.added} / -${ld.removed} changed lines)`); }
  }
  if (d.lookChanged) { out('  look:      changed (preview: node arena.js sprite ' + id + ')'); changes++; }
  if ((base.spriteText || '') !== (cur.spriteText || '')) { out(`  sprite.json: ${cur.spriteText ? 'changed' : 'removed'}${cur.spriteText && !cur.sprite ? ' (and currently has errors - run: node arena.js sprite ' + id + ')' : ''}`); changes++; }
  if (!changes) out('  No changes yet.');
  if (!curCheck.ok) { out(''); out(`Your current files have ${curCheck.errors.length} error(s) - run: node arena.js check ${id}`); }
  footer(id);
}

const HIT_FLAGS = [
  [64, 'CRIT'], [1, '+stun'], [2, '(stun resisted)'], [128, '+root'], [256, '+silence'], [4, '+slow'], [8, '+burn'], [2048, '+poison'],
  [512, '+vulnerable'], [1024, '+weaken'], [4096, '+drain'], [16, '+knockback'], [32, '+lifesteal'], [8192, '(partly blocked)'],
];

function cmdLog(args) {
  const fighter = fighterFromArg(args.pos[0], 'log');
  const id = fighter.id;
  ping(id, 'cmd');
  let replay, title, me = 0;
  if (String(args.pos[1] || '').toLowerCase() === 'test') {
    const t = comms.readJson(comms.paths.tests(id), null);
    if (!t || !t.fights || !t.fights.length) fail(`No test fights yet - run: node arena.js test ${id}`);
    const want = args.pos[2] ? String(args.pos[2]).toLowerCase() : null;
    const f = want ? t.fights.find(x => x.opponent === want || String(x.oppName || '').toLowerCase().includes(want)) : t.fights[0];
    if (!f) fail(`No fight vs "${want}" in your last test. Opponents: ${t.fights.map(x => x.opponent).join(', ')}`);
    replay = f.replay;
    title = `your last test vs ${f.oppName}`;
  } else {
    const state = readState();
    if (!state) fail(serverDownMessage());
    const last = lastFought(currentMatch(state));
    const round = args.pos[1] ? Number(args.pos[1]) : last && last.round;
    if (!round) fail(`No rounds fought yet in this match. (For your last test fight: node arena.js log ${id} test [bot])`);
    replay = comms.readJson(path.join(comms.paths.matchDir(state.matchId), `round-${round}`, 'replay.json'), null);
    if (!replay) fail(`No replay for round ${round}.`);
    title = `round ${round}`;
    me = Math.max(0, replay.fighters.findIndex(f => f.id === id));
  }
  const tr = replay.tickRate || RULES.tickRate;
  const from = Number(args.opts.from) || 0;
  const to = args.opts.to !== undefined ? Number(args.opts.to) : Infinity;
  const limit = Math.max(10, Number(args.opts.limit) || 150);
  const all = !!args.opts.all;
  const abName = (side, idx) => { const f = replay.fighters[side]; return (f && f.abilities[idx] && f.abilities[idx].name) || 'ability'; };
  const hpAt = (t) => {
    const fr = replay.frames[Math.min(replay.frames.length - 1, Math.max(0, t))];
    return fr ? `${Math.round(fr[1 + me][2])} / ${Math.round(fr[2 - me][2])}` : '';
  };
  out(`== COMBAT LOG (${title}): YOU = ${replay.fighters[me].name}, OPP = ${replay.fighters[1 - me].name} ==`);
  out(`Result: ${replay.result.winner === null ? 'DRAW' : replay.result.winner === me ? 'YOU WON' : 'YOU LOST'} (${replay.result.method} at ${replay.result.time}s)${all ? '' : '   (--all adds swings/shots; --from S --to S to page)'}`);
  out('   time  who  event                                                   HP you / opp');
  let printed = 0, skipped = 0, nextFrom = null;
  for (const e of replay.events) {
    const time = e.t / tr;
    if (time < from || time > to) continue;
    const who = e.a === me ? 'YOU' : 'OPP';
    let text = null;
    let hp = false;
    switch (e.k) {
      case 'cast': text = `starts ${abName(e.a, e.ab)}`; break;
      case 'swing': case 'fire': if (all) text = `${e.k === 'fire' ? 'fires' : 'swings'} ${abName(e.a, e.ab)}`; break;
      case 'burst': if (all) text = `${abName(e.a, e.ab)} bursts (radius ${e.r})`; break;
      case 'zone': text = `places ${abName(e.a, e.ab)} (radius ${e.r})`; break;
      case 'dash': if (all) text = `dashes (${abName(e.a, e.ab)})`; break;
      case 'hit': {
        const fl = HIT_FLAGS.filter(([bit]) => (e.fl || 0) & bit).map(([, t]) => t).join(' ');
        text = `${abName(e.a, e.ab)} HITS for ${e.dmg}${e.abs ? ` (${e.abs} into shield)` : ''}${fl ? ` ${fl}` : ''}`;
        hp = true;
        break;
      }
      case 'dot': text = e.kind === 'thorns' ? `thorns reflect ${e.dmg}` : `${e.kind === 'zone' ? `${abName(e.a, e.ab)} zone` : e.kind} deals ${e.dmg}`; hp = true; break;
      case 'heal': text = e.over ? `${abName(e.a, e.ab)}: heals ${e.v} over ${e.over}s` : `heals ${e.v}${e.ab !== undefined && e.ab !== null ? ` (${abName(e.a, e.ab)})` : ''}`; hp = true; break;
      case 'shield': text = `${abName(e.a, e.ab)}: ${e.v} shield`; break;
      case 'buff': text = `${abName(e.a, e.ab)}: +${e.v}% ${e.stat}`; break;
      case 'interrupt': text = `${abName(e.a, e.ab)} INTERRUPTED`; break;
      case 'evade': text = 'evades a hit (invulnerable)'; break;
      case 'trait': text = `${e.id === 'second_wind' ? 'Second Wind' : e.id}: +${e.v} HP`; hp = true; break;
      case 'ko': text = 'is KNOCKED OUT'; hp = true; break;
      case 'say': text = `says "${String(e.text || '').slice(0, 50)}"`; break;
      case 'counter': text = e.ok ? 'PARRIES the hit and strikes back' : `raises a parry (${abName(e.a, e.ab)})`; break;
      case 'trap': text = `sets ${abName(e.a, e.ab)} at (${Math.round(e.x)}, ${Math.round(e.y)})`; break;
      case 'trigger': text = `'s ${abName(e.a, e.ab)} is SPRUNG`; break;
      case 'beam': text = `channels ${abName(e.a, e.ab)}`; break;
      case 'beamend': if (all) text = `stops channelling ${abName(e.a, e.ab)}`; break;
      case 'cleanse': text = `cleanses (${abName(e.a, e.ab)})`; break;
      case 'slam': text = 'is SLAMMED into an obstacle'; hp = true; break;
      case 'meteor': text = `calls ${abName(e.a, e.ab)} at (${Math.round(e.x)}, ${Math.round(e.y)}) - lands in ${e.delay}s`; break;
      case 'cancel': if (all) text = 'cancels its cast'; break;
      case 'stance': text = `switches to ${e.v} stance`; break;
      case 'swap': text = `swaps to ${e.w}`; break;
      case 'turret': text = `places ${abName(e.a, e.ab)} at (${Math.round(e.x)}, ${Math.round(e.y)})`; break;
      case 'ultready': text = 'ULTIMATE READY'; break;
      case 'divready': text = 'DIVINITY FULL - a godly power is ready'; break;
      case 'ult': text = `*** ULTIMATE: ${abName(e.a, e.ab)} ***`; break;
      case 'awaken': text = e.v === 'ascend' ? '*** ASCENDS ***' : '*** AWAKENS ***'; break;
      case 'awakenend': text = 'awakening ends'; break;
      case 'god': text = `*** GODLY POWER: ${e.id} ***`; break;
      case 'relic': text = `relic: ${e.id}`; break;
      case 'revive': text = 'REVIVES (Phoenix Feather)'; hp = true; break;
      case 'reflect': text = `reflects a shot back for ${e.dmg}`; hp = true; break;
      case 'emote': if (all) text = `emote: ${e.v}`; break;
      case 'impact': if (all) text = `big impact: ${e.dmg} (${Math.round((e.pct || 0) * 100)}% HP)`; break;
      default:
        if (typeof e.k === 'string' && e.k.startsWith('g:') && all) text = `godly: ${e.k.slice(2)}`;
        break;
    }
    if (!text) continue;
    if (printed >= limit) { skipped++; if (nextFrom === null) nextFrom = time; continue; }
    out(`  ${time.toFixed(1).padStart(5)}s ${who}  ${text.slice(0, 55).padEnd(55)} ${hp ? hpAt(e.t) : ''}`);
    printed++;
  }
  if (skipped) out(`  ... ${skipped} more events. Continue with: node arena.js log ${[id, ...args.pos.slice(1)].join(' ')} --from ${nextFrom.toFixed(1)}`);
  footer(id);
}

// ── sprite preview (PNG) ─────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
function crc32(buf) { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(w, h, rgba) {
  const stride = w * 4 + 1;
  const raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * stride + 1, y * w * 4, (y + 1) * w * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
}

function cmdSprite(args) {
  const fighter = fighterFromArg(args.pos[0], 'sprite');
  const id = fighter.id;
  ping(id, 'cmd');
  // A hand-painted sprite.json wins; otherwise the sprite composed from fighter.json's "look".
  const file = path.join(fighterDir(id), 'sprite.json');
  let sprite, errors = [], warnings = [], source;
  if (fs.existsSync(file)) {
    ({ sprite, errors, warnings } = parseSprite(fs.readFileSync(file, 'utf8')));
    source = rel(file);
    if (!sprite) { out(`${rel(file)} has problems:`); for (const e of errors) out(`  X ${e}`); footer(id); process.exit(1); }
  } else {
    const bundle = readBundle(fighterDir(id));
    if (!bundle.json) fail(`No valid fighter.json in ${rel(fighterDir(id))} yet.`);
    if (bundle.spriteSource !== 'look' || !bundle.sprite) fail('No sprite.json and no usable "look" in fighter.json - add a "look" (options: node arena.js looks) or paint sprite.json.');
    sprite = bundle.sprite;
    source = 'the "look" in fighter.json';
    const c = checkBundle(bundle, { level: currentLevel() });
    warnings = c.warnings.filter(w => w.startsWith('look:'));
  }
  const scale = Math.max(2, Math.min(16, Math.round(Number(args.opts.scale) || 6)));
  const N = RULES.spriteSize;
  // One row per animation (idle, walk, attack, cast, dash, hurt, ko, victory, block).
  const order = Object.keys(SPRITE_FRAMES).filter(k => k !== 'move' && sprite.frames[k] && sprite.frames[k].length);
  const rowsOf = order.map(k => sprite.frames[k]);
  const cols = Math.max(...rowsOf.map(r => r.length));
  const gap = 2 * scale;
  const W = cols * N * scale + (cols + 1) * gap;
  const H = order.length * N * scale + (order.length + 1) * gap;
  const rgba = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      const check = ((Math.floor(x / (scale * 2)) + Math.floor(y / (scale * 2))) % 2) ? 34 : 26;
      rgba[o] = check; rgba[o + 1] = check + 4; rgba[o + 2] = check + 14; rgba[o + 3] = 255;
    }
  }
  const pal = {};
  for (const [k, v] of Object.entries(sprite.palette)) pal[k] = [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16)];
  rowsOf.forEach((frames, ri) => {
    const oy = gap + ri * (N * scale + gap);
    frames.forEach((fr, fi) => {
      const ox = gap + fi * (N * scale + gap);
      fr.forEach((row, ry) => {
        for (let rx = 0; rx < N; rx++) {
          const c = pal[row[rx]];
          if (!c) continue;
          for (let yy = 0; yy < scale; yy++) {
            for (let xx = 0; xx < scale; xx++) {
              const o = ((oy + ry * scale + yy) * W + ox + rx * scale + xx) * 4;
              rgba[o] = c[0]; rgba[o + 1] = c[1]; rgba[o + 2] = c[2]; rgba[o + 3] = 255;
            }
          }
        }
      });
    });
  });
  const outFile = path.join(fighterDir(id), 'sprite-preview.png');
  fs.writeFileSync(outFile, encodePng(W, H, rgba));
  out(`Wrote ${rel(outFile)} (${W}x${H} px, ${scale}x zoom) from ${source} - open/view it to check your pixel art.`);
  out(`Rows top to bottom: ${order.map(k => `${k} x${sprite.frames[k].length}`).join(' | ')}`);
  out(`Palette: ${Object.keys(sprite.palette).length}/${RULES.spriteMaxColors} colours (${Object.entries(sprite.palette).map(([k, v]) => `${k}=${v}`).join(' ')})`);
  for (const w of warnings) out(`  - ${w}`);
  out('Tip: sprites face RIGHT (the arena mirrors them when you face left); feet belong on the bottom rows.');
  footer(id);
}

// ── catalogues ───────────────────────────────────────────────────────────────
function cmdWeapons(args) {
  const fighter = optionalFighter(args.pos[0]);
  if (fighter) ping(fighter.id, 'cmd');
  const level = args.opts.level ? levelForRound(Number(args.opts.level)) : currentLevel();
  out(`WEAPONS - pick one in fighter.json: "weapon": "<id>". It gives a FREE attack (no energy, its own cooldown) that`);
  out(`is added after your abilities, plus a passive. Numbers below are at level ${level} (weapon damage scales with level).`);
  out(`Use it from brain.js like an ability: { use: "<attack name>" } or util.basic(s).`);
  out('');
  out('  id          name             kind    attack      type        dmg  reach/range  cooldown windup');
  for (const id of WEAPON_IDS) {
    const w = weaponInfo(id, level);
    const a = weaponAttack(id, level, 0);
    const reach = a.type === 'melee' ? `${a.range} (arc ${a.arc})` : `${a.range} @${a.speed}`;
    out(`  ${id.padEnd(11)} ${w.name.padEnd(16)} ${w.kind.padEnd(7)} ${a.name.padEnd(11)} ${a.type.padEnd(10)} ${String(a.damage).padStart(4)}  ${reach.padEnd(12)} ${`${n2(a.cooldown)}s`.padStart(7)} ${`${n2(a.windup)}s`.padStart(6)}`);
    out(`              passive: ${w.passiveText}`);
  }
  if (fighter) footer(fighter.id);
}

function cmdLooks(args) {
  const fighter = optionalFighter(args.pos[0]);
  if (fighter) ping(fighter.id, 'cmd');
  let cat;
  try { cat = require('./engine/look').lookCatalog(); } catch (e) { fail(`The look system is not available: ${e.message}`); }
  out('LOOKS - your pixel-art character is composed from "look" in fighter.json (unless you paint sprite.json yourself).');
  out('Every field is optional; unknown values fall back to a default with a warning. Preview: node arena.js sprite <you>');
  const list = (name, items) => {
    if (!items || !items.length) return;
    out('');
    out(`  ${name}:`);
    for (const it of items) out(`    ${String(it.id).padEnd(12)} ${it.desc || it.name || ''}`);
  };
  list('preset (a complete ready-made skin; any other field you set overrides it)', cat.presets);
  list('base (body type)', cat.bases);
  list('build', cat.builds);
  list('hair', cat.hair);
  list('face', cat.faces);
  list('headgear', cat.headgear);
  list('outfit', cat.outfits);
  list('cape', cat.capes);
  list('shoulders', cat.shoulders);
  list('back (wings flap in every animation, or an item on the back)', cat.backs);
  list('tail (any base; "none" also removes a base\'s own tail)', cat.tails);
  list('eyeStyle ("eyes" stays the eye colour; "eyes2" = second colour for hetero)', cat.eyeStyles);
  list('markings (painted on bare skin; colour: colors.marking)', cat.markings);
  list('emblem (chest emblem in the accent colour)', cat.emblems);
  list('gloves', cat.gloves);
  list('boots', cat.boots);
  list('accessory (one, or a list of up to 3)', cat.accessories);
  list('weaponGlow (elemental glow on your weapon or fists)', cat.weaponGlows);
  list('aura (particles in the arena)', cat.auras);
  if (cat.colors) {
    out('');
    out(`  colors: { ${cat.colors.slots.map(s => `"${s}": "#rrggbb"`).join(', ')} } - hex or a colour name`);
    if (cat.colors.names && cat.colors.names.length) out(`    colour names: ${cat.colors.names.join(', ')}`);
    if (cat.colors.skin && cat.colors.skin.length) out(`    "skin": ${cat.colors.skin.join(', ')} (or hex)`);
    if (cat.colors.hair && cat.colors.hair.length) out(`    "hairColor": ${cat.colors.hair.join(', ')} (or hex)`);
  }
  out('  also: "eyes": "#hex", "eyes2": "#hex", "weaponColor": "#hex", "trail": "#hex" (weapon swing trail colour)');
  out('  colour slots glow / accent2 / marking recolour glowing bits, wings+tails+back items, and markings');
  out('');
  out(`  animations drawn for you: ${Object.entries(cat.animations || {}).map(([k, v]) => `${k} ${v}`).join(', ')} (the weapon you carry is drawn too)`);
  out('');
  out('  quickest: "look": { "preset": "samurai", "hairColor": "red" }   (a preset plus your own tweaks)');
  out('  example: "look": { "base": "orc", "build": "bulky", "skin": "#6d9b52", "hair": "mohawk", "hairColor": "black",');
  out('                     "face": "scar", "headgear": "horned", "outfit": "plate", "cape": "long", "aura": "fire",');
  out('                     "back": "dragon", "tail": "dragon", "markings": "tribal", "emblem": "skull", "eyeStyle": "glowing",');
  out('                     "gloves": "spiked", "boots": "armored", "accessory": ["amulet", "earrings"], "weaponGlow": "flame",');
  out('                     "colors": { "primary": "#8a2a1f", "secondary": "#e0b04a", "accent": "#ff7a2a", "metal": "#9aa3ad",');
  out('                                 "accent2": "#5a2a2a", "marking": "#1e1a24", "glow": "#ffb030" } }');
  if (fighter) footer(fighter.id);
}

function cmdArenas(args) {
  const fighter = optionalFighter(args.pos[0]);
  if (fighter) ping(fighter.id, 'cmd');
  const state = readState();
  const cur = state && state.theme ? state.theme.id : null;
  const round = state ? state.round : 1;
  const match = (state && state.matchNumber) || 1;
  out('ARENAS - every round is fought on a different arena. Obstacles block movement, projectiles, beams and dashes (not melee, areas or zones).');
  out(`The ring has radius ${RULES.arenaRadius} around the centre (0,0) at level 1; from ${RULES.ring.shrinkStart}s to ${RULES.ring.shrinkEnd}s it shrinks to ${RULES.ring.minRadius}.`);
  out(`Fighters start at (-${RULES.startOffset}, 0) and (${RULES.startOffset}, 0). In brain.js: s.arena.obstacles = [{x, y, r}], util.lineOfSight, util.steer, util.cover.`);
  out('Obstacles below are for level 1: the arena grows with the level, positions scale with it and sizes grow half as fast (s.arena.obstacles has the real ones).');
  out('Round 1 is always the colosseum; rounds 2-9 rotate through the other regular arenas (a different stretch every match); levels 10, 11 and 12 are fought in the godly arenas.');
  const plan = [];
  for (let r = 1; r <= 12; r++) plan.push(`${r} ${themeForRound(r, match).id}`);
  out(`THIS MATCH (match ${match}): ${plan.join(' | ')}`);
  out('');
  THEMES.forEach((t) => {
    const tag = t.id === cur ? `  <- round ${round}` : '';
    const rounds = [];
    for (let r = 1; r <= 12; r++) if (themeForRound(r, match).id === t.id) rounds.push(r);
    const when = t.godly ? `level ${t.level || '10+'} (godly)` : rounds.length ? `this match: round ${rounds.join(', ')}` : 'not this match';
    out(`  ${t.id.padEnd(10)} ${t.name.padEnd(18)} ${when}${tag}`);
    out(`             ${t.blurb}`);
    out(`             obstacles: ${t.obstacles.map(o => `(${o.x}, ${o.y}) r${o.r}`).join('  ')}`);
  });
  out('');
  out('Test on any arena: node arena.js test <you> <bot> --arena <id>   (default: this round\'s arena)');
  if (fighter) footer(fighter.id);
}

function cmdMemory(args) {
  const fighter = fighterFromArg(args.pos[0], 'memory');
  ping(fighter.id, 'cmd');
  const m = storedMemory(fighter.id);
  out(`BRAIN MEMORY (${fighter.id})`);
  out('Whatever your brain leaves in the global `memory` object at the end of a round is saved (JSON, max');
  out(`${RULES.memoryMaxBytes} bytes) and handed back at the start of your next round of this match (and to your tests).`);
  out('');
  if (!m) out('  Nothing saved yet this match.');
  else {
    out(`  saved after round ${m.round}, ${m.bytes} bytes${m.note ? ` (${m.note})` : ''}:`);
    let pretty = m.json;
    try { pretty = JSON.stringify(JSON.parse(m.json), null, 2); } catch { /* raw */ }
    const lines = pretty.split('\n');
    for (const l of lines.slice(0, 200)) out(`  ${l}`);
    if (lines.length > 200) out(`  ... (${lines.length - 200} more lines)`);
  }
  footer(fighter.id);
}

function cmdBots(args) {
  const fighter = optionalFighter(args.pos[0]);
  if (fighter) ping(fighter.id, 'cmd');
  out('SPARRING BOTS (files in engine/bots/<name>/ and engine/starter/ - read them for examples).');
  out('Bots are max-level designs that are automatically scaled down to your current level.');
  for (const [k, v] of Object.entries(BOTS)) out(`  ${k.padEnd(11)} ${v}`);
  out('  mirror      a copy of your own fighter');
  out('  previous    your own fighter from the last round');
  out(`  all         ${GAUNTLET.join(' + ')} (default, quick)`);
  out(`  full        every bot above except the dummy (${FULL_GAUNTLET.length} fights)`);
  out(`  <folder>    any fighter folder inside fighters/<you>/ (e.g. a lab version): test <you> lab/v2`);
  if (fighter) footer(fighter.id);
}

function cmdTraits(args) {
  const fighter = optionalFighter(args.pos[0]);
  if (fighter) ping(fighter.id, 'cmd');
  const level = currentLevel();
  const l = levelInfo(level);
  out(`TRAITS - passive perks. Put their ids in fighter.json: "traits": ["thick_skin", ...]`);
  out(`You have ${l.traitSlots} trait slot${l.traitSlots === 1 ? '' : 's'} at level ${level} (level 2: 1, level 3: 2, level 4: 3).`);
  let group = null;
  for (const id of TRAIT_IDS) {
    const t = TRAITS[id];
    if (t.group !== group) { group = t.group; out(''); out(`  ${group.toUpperCase()}`); }
    out(`  ${id.padEnd(15)} ${t.name.padEnd(15)} ${t.text}`);
  }
  if (fighter) footer(fighter.id);
}

function cmdLevel(args) {
  const fighter = optionalFighter(args.pos[0]);
  if (fighter) ping(fighter.id, 'cmd');
  const level = currentLevel();
  out(levelLine(level));
  out('');
  out('  level  stats (max)  abilities  traits  relics  godly  power  arena   unlocks');
  for (let l = 1; l <= MAX_LEVEL; l++) {
    const v = LEVELS[l];
    const u = levelUnlocks(l).filter(x => !/stat points \(max/.test(x) && !/^Bigger arena/.test(x) && !/^Ability slot|^Trait slot/.test(x));
    out(`  ${(l === level ? '>' : ' ') + String(l).padEnd(5)} ${`${v.statPoints} (${v.statMax})`.padEnd(12)} ${String(v.abilitySlots).padEnd(10)} ${String(v.traitSlots).padEnd(7)} ${String(v.relicSlots).padEnd(7)} ${String(v.godSlots).padEnd(6)} ${String(Math.round(v.power * 100) + '%').padEnd(6)} ${String(v.arenaRadius).padEnd(7)} ${u.join('; ')}`);
  }
  out('');
  out(`Your level = the round number (capped at ${MAX_LEVEL}). Round 1 is the mirror round with the shared starter.`);
  out('"power" caps the maximum of damage, heals, shields, buffs, stuns… (max damage per hit = 300 × power). "arena" = ring radius.');
  if (fighter) footer(fighter.id);
}

function cmdRelics(args) {
  const fighter = optionalFighter(args.pos[0]);
  if (fighter) ping(fighter.id, 'cmd');
  const level = currentLevel();
  const l = levelInfo(level);
  out(`RELICS - legendary artefacts. fighter.json: "relics": ["hourglass", ...]. Slots: level 6: 1, level 9: 2, level 11: 3 (you: ${l.relicSlots} at level ${level}).`);
  for (const id of RELIC_IDS) out(`  ${id.padEnd(16)} ${RELICS[id].name.padEnd(16)} ${RELICS[id].text}`);
  if (fighter) footer(fighter.id);
}

function cmdStances(args) {
  const fighter = optionalFighter(args.pos[0]);
  if (fighter) ping(fighter.id, 'cmd');
  out('STANCES (level 3+) - switch any time from brain.js with { stance: "aggressive" } (1.5 s between switches).');
  out('fighter.json "stance" = the stance you start in. You can see the enemy\'s stance in s.enemy.stance.');
  for (const id of STANCE_IDS) out(`  ${id.padEnd(11)} ${STANCES[id].text}`);
  if (fighter) footer(fighter.id);
}

function cmdPowers(args) {
  const fighter = optionalFighter(args.pos[0]);
  if (fighter) ping(fighter.id, 'cmd');
  const P = rulesPowers();
  out('ULTIMATE (level 5+): fighter.json "ultimate": { ...any ability... } - bigger caps, no energy, no cooldown; cast with { use: "ultimate" } when s.me.ult.ready.');
  out('CHARGE-UP: ultimates and godly powers power up for at least 1 s first - you are rooted and a stun interrupts it (you keep half the meter); while charging an ultimate you also take 25% more damage. The target you return while charging steers where it lands.');
  out('AWAKENING (level 8+): once per fight after 20 s or below 50% HP: { awaken: true } -> 8 s (+0.15 s per focus) of +25% damage, +20% speed, faster cooldowns, more regen, immune to slows and roots.');
  out('ASCENSION (level 12): awakening becomes a 10 s godly form: +35% damage, +25% speed, immune to all crowd control, +40 divinity.');
  out('DIVINITY (s.me.divinity, 0-100) fills as you deal and take damage (faster with focus); a godly power costs 100.');
  out('');
  if (!P) { out('  (godly powers are not available in this build)'); return; }
  try { out(P.describe()); } catch (e) { for (const [id, g] of Object.entries(P.GOD_POWERS || {})) out(`  ${id.padEnd(12)} ${g.name} - ${g.blurb || ''}`); }
  if (fighter) footer(fighter.id);
}

function cmdHelp() {
  out(`AI FIGHT - command line for competing AIs. Fighters: ${IDS.join(', ')}

 BUILD
  node arena.js check   <fighter>             validate your fighter, show stats, weapon, energy costs, smoke test
  node arena.js test    <fighter> [opponent]  practice fights (default: quick gauntlet). --seed N --swap
                                              --arena <id|none> (default: this round's arena) --no-memory
                                              opponent = a bot | all | full | mirror | previous | <folder in your dir>
  node arena.js diff    <fighter>             what you changed since the fighter you last locked in
  node arena.js sprite  <fighter>             render your look (or sprite.json) to fighters/<you>/sprite-preview.png
  node arena.js memory  <fighter>             what your brain saved in \`memory\` for its next round
  node arena.js say     <fighter> "message"   show a message to the spectators on the arena screen

 COMPETE
  node arena.js ready   <fighter>             LOCK IN for this round, then wait for the result + host decision
  node arena.js wait    <fighter>             keep waiting (after STILL_WAITING or a shell timeout)
  node arena.js time    [fighter]             the build clock: time left before auto-lock

 STUDY
  node arena.js report  <fighter> [round]     print a round report again
  node arena.js log     <fighter> [round|test [bot]]   blow-by-blow combat log (--from S --to S --all)
  node arena.js scout   <fighter>             your opponent's fighter as it fought last round
  node arena.js history <fighter>             every round of this match (+ earlier matches)
  node arena.js status  [fighter]             match status, score, who is locked in

 RULES & CATALOGUES
  node arena.js rules | level | weapons | traits | relics | stances | powers | looks | arenas | bots

  check / test accept --level N to try a different level.
  ready / wait accept --max <seconds> (default ${DEFAULT_WAIT}) - how long to wait before printing STILL_WAITING.
  THERE IS A BUILD TIME LIMIT: when it runs out, fighters that aren't locked in are auto-locked.
Read AI_GUIDE.md for the full manual.`);
}

// ── other game modes (engine/modes/<id>: army, business, ...) ────────────────
// The match's mode comes from the arena state. Shared commands (say, wait, time, report,
// memory) work as usual; check / test / ready / level / history / status / help are mode-aware.
const modes = require('./engine/modes');

function modeLevelFor(args, state) {
  const l = Number(args.opts.level);
  return l >= 1 ? Math.min(12, Math.floor(l)) : levelForRound(state && state.round ? state.round : 1);
}

function modeCmdCheck(m, args) {
  const fighter = fighterFromArg(args.pos[0], 'check');
  ping(fighter.id, 'check');
  const level = modeLevelFor(args, readState());
  const bundle = modes.readBundle(fighterDir(fighter.id), m);
  const c = modes.safeCheck(m, bundle, level);
  out(`== CHECK ${rel(fighterDir(fighter.id))} - ${m.name}, level ${level} ==`);
  if (c.text) out(c.text);
  else {
    out(`Name: ${c.name}`);
    if (c.summary) out(c.summary);
    for (const l of c.cardLines) out(`  ${l}`);
  }
  const shown = c.text || '';
  const missing = c.errors.filter(e => !shown.includes(e));
  if (missing.length) { out(''); out('ERRORS:'); for (const e of missing) out(`  - ${e}`); }
  const warn = c.warnings.filter(w => !shown.includes(w));
  if (warn.length) { out(''); out('WARNINGS:'); for (const w of warn) out(`  - ${w}`); }
  out('');
  out(c.ok ? `STATUS: VALID - ready to lock in (node arena.js ready ${fighter.id})` : 'STATUS: INVALID - fix the errors above');
  footer(fighter.id);
}

function modeCmdTest(m, args) {
  const fighter = fighterFromArg(args.pos[0], 'test');
  const id = fighter.id;
  const opp = opponentOf(id);
  const state = readState();
  ping(id, 'test');
  const level = modeLevelFor(args, state);
  const bundle = modes.readBundle(fighterDir(id), m);
  const c = modes.safeCheck(m, bundle, level);
  if (!c.ok) { for (const e of c.errors) out(`  - ${e}`); fail(`\nYour files are not valid at level ${level} - fix them first (node arena.js check ${id}).`); }
  const which = String(args.pos[1] || 'all').toLowerCase();
  const opponents = [];
  if (which === 'all') for (const b of m.bots || []) opponents.push({ name: `bot ${b}`, bundle: m.botBundle(b, level) });
  else if (which === 'previous' || which === 'last') {
    const last = lastFought(currentMatch(state));
    const snap = last && state ? modes.readSnapshot(snapshotDir(state, last.round, opp.id)) : null;
    if (!snap || snap.mode !== m.id) fail(`No locked-in ${m.name} files from ${opp.label} yet (they appear after the first round).`);
    opponents.push({ name: `${opp.label}'s round ${last.round} entry`, bundle: modes.bundleFromSnapshot(snap) });
  } else if ((m.bots || []).includes(which)) opponents.push({ name: `bot ${which}`, bundle: m.botBundle(which, level) });
  else fail(`Unknown opponent "${args.pos[1]}". Use: all | previous | ${(m.bots || []).join(' | ')}`);
  const memory = (storedMemory(id) || {}).json || null;
  const summary = [];
  for (const o of opponents) {
    let r;
    try {
      r = m.simulate({ bundles: [bundle, o.bundle], ids: [id, 'sparring'], labels: [fighter.label, o.name], seed: Number(args.opts.seed) || 1, level, round: state && state.round ? state.round : 1, theme: state ? state.theme : null, memories: [args.opts['no-memory'] ? null : memory, null] });
    } catch (e) { out(`  vs ${o.name}: the simulation crashed - ${e && e.message}`); continue; }
    const w = r.result.winner;
    out(`vs ${o.name}: ${w === 0 ? 'WIN' : w === 1 ? 'LOSS' : 'DRAW'} (${r.result.method}${r.result.time !== undefined ? `, ${r.result.time}s` : ''}) - ${r.result.text || ''}`);
    summary.push({ oppName: o.name, winner: w === 0 ? 0 : w === 1 ? 1 : null, method: r.result.method, time: r.result.time });
    if (opponents.length === 1) {
      try { out(''); out(m.report({ side: 0, replay: r.replay, result: r.result, stats: r.stats, specs: [c.spec, null], labels: [fighter.label, o.name], round: 0, level, score: '' })); } catch { /* report optional */ }
    }
  }
  if (summary.length > 1) out(`\n${summary.filter(s => s.winner === 0).length}/${summary.length} wins`);
  try { comms.postToServer(id, 'test', { summary, seed: Number(args.opts.seed) || 1, at: Date.now() }); } catch { /* server optional */ }
  footer(id);
}

async function modeCmdReady(m, args) {
  const fighter = fighterFromArg(args.pos[0], 'ready');
  const id = fighter.id;
  const state = readState();
  if (!comms.serverAlive(state)) fail(serverDownMessage());
  const me = state.fighters && state.fighters[id];
  if (state.phase === 'match_over') {
    const inbox = readInbox(id);
    const last = (inbox.notices || []).filter(n => n.matchId === state.matchId).pop();
    out(last ? last.text : 'STATUS: MATCH_OVER\nThe match is over. Wait for the human to start a new match.');
    return 0;
  }
  if (state.phase !== 'building') {
    out(`Round ${state.round} is already ${state.phase === 'round_over' ? 'finished' : 'underway'} (${state.phase}).`);
    if (me && me.ready) return waitLoop(fighter, { matchId: state.matchId, round: state.round }, args);
    out('You are not part of this round. Wait for the next round to start, then run ready again.');
    return 1;
  }
  const bundle = modes.readBundle(fighterDir(id), m);
  if (!bundle.exists) fail(`Nothing in ${rel(fighterDir(id))} yet - read ${m.guideFile} and create ${m.designFile} + ${m.brainFile}.`);
  const c = modes.safeCheck(m, bundle, levelForRound(state.round));
  if (!c.ok) {
    for (const e of c.errors) out(`  - ${e}`);
    footer(id);
    fail('\nNOT READY - fix the errors above, then run ready again. (If the clock runs out first, the arena auto-locks your last valid version.)');
  }
  const nonce = comms.postToServer(id, 'ready', { round: state.round, matchId: state.matchId, snapshot: modes.snapshotOf(bundle) });
  const ack = await waitForAck(id, nonce, 15000);
  if (!ack) fail('No answer from the arena server within 15s. Is it running? (npm start)');
  if (!ack.ok) fail(`NOT READY: ${ack.message}`);
  out(`LOCKED IN: "${c.name}" is ready for round ${ack.round}. ${ack.opponentReady ? 'Your opponent is ready too - the round starts now!' : 'Waiting for your opponent to lock in...'}`);
  out('(Your files are snapshotted - edits you make now will NOT affect this round.)');
  return waitLoop(fighter, { matchId: ack.matchId, round: ack.round }, args);
}

function modeCmdLevel(m, args) {
  const state = readState();
  const cur = levelForRound(state && state.round ? state.round : 1);
  out(`${m.name.toUpperCase()} - LEVELS (level = round number, ${m.maxRounds || 12} rounds per match; you are at level ${cur})`);
  for (let l = 1; l <= (m.maxRounds || 12); l++) {
    let info = null, unl = [];
    try { info = m.levelInfo(l); } catch { info = null; }
    try { unl = m.levelUnlocks(l) || []; } catch { unl = []; }
    out(`${l === cur ? '>' : ' '} L${String(l).padEnd(2)} ${info && info.headline ? info.headline : ''}${unl.length ? `  | new: ${unl.join('; ')}` : ''}`);
    if (args.opts.all || l === cur) for (const line of (info && info.lines) || []) out(`       ${line}`);
  }
  const f = optionalFighter(args.pos[0]);
  if (f) footer(f.id);
}

function modeCmdHistory(m, args) {
  const fighter = fighterFromArg(args.pos[0], 'history');
  const id = fighter.id;
  const opp = opponentOf(id);
  const state = readState();
  if (!state) fail(serverDownMessage());
  ping(id, 'cmd');
  const match = currentMatch(state);
  out(`== MATCH ${state.matchNumber || 1} (${m.name}) - score: ${scoreLine(state)} ==`);
  const rounds = match && match.rounds ? match.rounds.slice().sort((a, b) => a.round - b.round) : [];
  if (!rounds.length) out('No rounds fought yet in this match.');
  for (const r of rounds) {
    const me = r.fighters[id] || {}, them = r.fighters[opp.id] || {};
    const res = r.result.winnerId === null ? 'DRAW' : r.result.winnerId === id ? 'WIN' : 'LOSS';
    const mine = r.fighters[IDS[0]] === me ? 1 : 2;
    const rows = (r.resultRows || []).slice(0, 3).map(row => `${row[0]} ${row[mine]} vs ${row[3 - mine]}`).join(' | ');
    out(`  round ${String(r.round).padStart(2)} L${r.level || r.round}: ${res.padEnd(4)} ${String(r.result.method || '').padEnd(10)} "${me.name || '?'}" vs "${them.name || '?'}"${rows ? `  ${rows}` : ''}`);
  }
  footer(id);
}

function modeCmdStatus(m, args) {
  const state = readState();
  if (!state) fail(serverDownMessage());
  const fighter = optionalFighter(args.pos[0]);
  if (fighter) ping(fighter.id, 'cmd');
  out(`Arena server: ${comms.serverAlive(state) ? 'running' : 'NOT RUNNING'}`);
  out(`${m.name} | match ${state.matchNumber || 1} | round ${state.round} of ${m.maxRounds || 12} | phase: ${state.phase}`);
  let info = null;
  try { info = m.levelInfo(levelForRound(state.round)); } catch { info = null; }
  if (info && info.headline) out(`LEVEL ${levelForRound(state.round)}: ${info.headline}`);
  out(`Score: ${scoreLine(state)}`);
  for (const f of config.fighters) {
    const s = (state.fighters || {})[f.id] || {};
    out(`  ${f.label.padEnd(10)} (${f.id}): ${s.ready ? `LOCKED IN (${s.lockedName || ''})${s.autoLocked ? ' - auto-locked when time ran out' : ''}` : 'building'} - ${activityText(state, f.id)}`);
  }
  if (state.lastResult) out(`Last round: ${state.lastResult}`);
  footer(fighter ? fighter.id : null);
}

function modeCmdHelp(m) {
  const extra = Object.entries(m.commands || {});
  out(`AI FIGHT - ${m.name.toUpperCase()} MODE. ${m.tagline || ''}
Fighters: ${IDS.join(', ')}. Your files: fighters/<you>/${m.designFile} and ${m.brainFile} (+ optional lib/*.js). Manual: ${m.guideFile}

 BUILD
  node arena.js check   <you>              validate your files (--level N to try another level)
  node arena.js test    <you> [opponent]   practice rounds: all (default) | previous | ${(m.bots || []).join(' | ')}   (--seed N --no-memory)
  node arena.js say     <you> "message"    show a message to the spectators
  node arena.js memory  <you>              what your brain saved in \`memory\` for its next round

 COMPETE
  node arena.js ready   <you>              LOCK IN for this round, then wait for the result + host decision
  node arena.js wait    <you>              keep waiting (after STILL_WAITING or a shell timeout)
  node arena.js time    [you]              the build clock

 STUDY
  node arena.js report  <you> [round]      print a round report again
  node arena.js history <you>              every round of this match
  node arena.js status  [you]              match status, score, who is locked in
  node arena.js level                      what every level unlocks (--all for details)
${extra.length ? `\n MODE COMMANDS\n${extra.map(([k, c]) => `  node arena.js ${k.padEnd(18)} ${c.help || ''}`).join('\n')}\n` : ''}
THERE IS A BUILD TIME LIMIT: when it runs out, entries that aren't locked in are auto-locked.`);
}

async function modeMain(m, cmd, cmdRaw, args) {
  switch (cmd) {
    case 'check': return modeCmdCheck(m, args);
    case 'test': case 'spar': return modeCmdTest(m, args);
    case 'ready': case 'mark-ready': case 'markready': case 'lock': return process.exit(await modeCmdReady(m, args));
    case 'wait': return process.exit(await cmdWait(args));
    case 'say': return cmdSay(args);
    case 'time': case 'clock': return cmdTime(args);
    case 'status': return modeCmdStatus(m, args);
    case 'report': return cmdReport(args);
    case 'history': return modeCmdHistory(m, args);
    case 'memory': case 'mem': return cmdMemory(args);
    case 'level': case 'levels': return modeCmdLevel(m, args);
    case 'help': case '--help': case '-h': case 'commands': case 'rules': return modeCmdHelp(m);
    default: {
      const c = (m.commands || {})[cmd];
      if (c && typeof c.run === 'function') {
        const state = readState();
        const f = optionalFighter(args.pos[0]);
        if (f) ping(f.id, 'cmd');
        // args: the raw words after the command (an array, e.g. ['3', '--level', '4']) with the parsed .pos / .opts attached
        const argv = Object.assign(process.argv.slice(3), { pos: args.pos, opts: args.opts });
        await c.run(argv, { level: modeLevelFor(args, state), out, state, fighter: f ? f.id : null });
        if (f) footer(f.id);
        return undefined;
      }
      const FIGHTER_ONLY = ['weapons', 'weapon', 'looks', 'look', 'skins', 'sprite', 'preview', 'relics', 'relic', 'stances', 'stance', 'powers', 'godly', 'gods', 'ultimate', 'traits', 'arenas', 'arena', 'maps', 'bots', 'diff', 'changes', 'scout', 'log', 'replay'];
      if (FIGHTER_ONLY.includes(cmd)) { out(`"${cmdRaw}" belongs to the Fighter Duel mode - this match is ${m.name}.\n`); return modeCmdHelp(m); }
      out(`Unknown command "${cmdRaw}".\n`);
      return modeCmdHelp(m);
    }
  }
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  const [cmdRaw, ...rest] = process.argv.slice(2);
  const cmd = String(cmdRaw || 'help').toLowerCase();
  const args = parseArgs(rest);
  const modeState = readState();
  const activeMode = modeState && modeState.mode && modeState.mode !== 'fighter' ? modes.get(modeState.mode) : null;
  if (modeState && modeState.mode && modeState.mode !== 'fighter' && !activeMode) fail(`This match uses the game mode "${modeState.mode}", which could not be loaded. Ask the host to check the server.`);
  if (activeMode) return modeMain(activeMode, cmd, cmdRaw, args);
  switch (cmd) {
    case 'check': return cmdCheck(args);
    case 'test': case 'spar': return cmdTest(args);
    case 'say': return cmdSay(args);
    case 'ready': case 'mark-ready': case 'markready': case 'lock': return process.exit(await cmdReady(args));
    case 'wait': return process.exit(await cmdWait(args));
    case 'time': case 'clock': return cmdTime(args);
    case 'status': return cmdStatus(args);
    case 'report': return cmdReport(args);
    case 'log': case 'replay': return cmdLog(args);
    case 'scout': return cmdScout(args);
    case 'history': return cmdHistory(args);
    case 'diff': case 'changes': return cmdDiff(args);
    case 'sprite': case 'preview': return cmdSprite(args);
    case 'rules': return out(describeRules());
    case 'bots': return cmdBots(args);
    case 'traits': return cmdTraits(args);
    case 'weapons': case 'weapon': return cmdWeapons(args);
    case 'looks': case 'look': case 'skins': return cmdLooks(args);
    case 'arenas': case 'arena': case 'maps': return cmdArenas(args);
    case 'memory': case 'mem': return cmdMemory(args);
    case 'relics': case 'relic': return cmdRelics(args);
    case 'stances': case 'stance': return cmdStances(args);
    case 'powers': case 'godly': case 'gods': case 'ultimate': return cmdPowers(args);
    case 'level': case 'levels': return cmdLevel(args);
    case 'help': case '--help': case '-h': case 'commands': return cmdHelp();
    default: out(`Unknown command "${cmdRaw}".\n`); return cmdHelp();
  }
}

main().catch(e => { out(`arena.js crashed: ${e && e.stack ? e.stack : e}`); process.exit(2); });
