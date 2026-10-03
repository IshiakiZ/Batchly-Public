'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  AI FIGHT — arena server.
//  • watches both AIs' fighter folders and streams every save to the browser
//  • runs the round state machine: building → countdown → fighting → round_over
//  • build clock: a per-round time limit; when it runs out fighters are auto-locked
//  • tracks how long each AI codes, logs every round to results/*.csv
//  • levels fighters up every round (round 1 = identical starter "mirror" round)
//  • talks to the AIs' `arena.js` commands through files in data/
//  • serves the spectator UI on http://localhost:3000
// ─────────────────────────────────────────────────────────────────────────────

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Worker } = require('worker_threads');
const { spawn } = require('child_process');

const comms = require('./engine/comms');
const csv = require('./engine/csv');
const {
  RULES, STAT_KEYS, STAT_INFO, LEVELS, MAX_LEVEL, TRAITS, WEAPON_IDS, ABILITY_TYPES, TYPE_BLURB, EFFECT_KEYS, EFFECT_INFO, BUFF_STATS,
  levelForRound, levelInfo, weaponInfo, weaponAttack, levelUnlocks, arenaFor, STANCES, RELICS, TYPE_UNLOCK, STAT_UNLOCK, FEATURE_UNLOCK, powers,
} = require('./engine/rules');
const { readBundle, bundleFromSnapshot, checkBundle, snapshotOf } = require('./engine/loader');
const { fullCheck, starterInfo, STARTER_DIR, loadBot, BOTS, BOT_NAMES } = require('./engine/match');
const { buildReport } = require('./engine/report');
const { createBrain } = require('./engine/sandbox');
const { ascii } = require('./engine/text');
const themesMod = require('./engine/themes');
const { THEMES, themeForRound, themeById, obstaclesFor } = themesMod;
const { lineCount, lineDiff, specDiff, fmtVal } = require('./engine/diff');
const modes = require('./engine/modes');

const config = comms.loadConfig();
const FIGHTERS = config.fighters;
const IDS = FIGHTERS.map(f => f.id);
const BY_ID = Object.fromEntries(FIGHTERS.map(f => [f.id, f]));
const PUBLIC = path.join(__dirname, 'public');
const PORT = config.port;
const MIRROR = config.mirrorFirstRound;
const COUNTDOWN_MS = 6500;
const OUTRO_MS = 3500;
// The match is 12 rounds (one per level): after the final round's fight it ends by itself.
const FINAL_ROUND = MAX_LEVEL;
const FINAL_RESULT_MS = 9000;   // how long the final round's result card shows before the match-over screen
const FIGHTER_FILES = ['fighter.json', 'brain.js', 'sprite.json', 'notes.md'];
const LIB_DIR = 'lib'; // optional brain modules: fighters/<id>/lib/*.js

const log = (...a) => console.log(`[${new Date().toLocaleTimeString('en-GB', { hour12: false })}]`, ...a);

for (const d of ['inbox', 'outbox', 'presence', 'tests', 'matches']) comms.ensureDir(path.join(comms.DATA, d));
for (const id of IDS) { comms.ensureDir(comms.paths.fighterDir(id)); comms.ensureDir(comms.paths.outbox(id)); }

// ═════════════════════════════════════════════════════════════════════════════
//  Persistence
// ═════════════════════════════════════════════════════════════════════════════

let state = null;   // light, rewritten every heartbeat (read by the CLI)
let match = null;   // rounds of the current match (heavier)
const locked = {};  // id → { snapshot, spec, sprite, round, at }
const prevLocked = {}; // id → locked entry from the last fought round (for diffs)
let pending = null; // finished simulation waiting for its fight to start
let worker = null;
const timers = {};

// Brain memory (s.memory): whatever a brain leaves in `memory` at the end of a round
// is handed to the same AI's brain in its next round of the match (tests read it too).
function readMemory(id) {
  const m = comms.readJson(comms.paths.memory(state.matchId, id), null);
  return m && typeof m.json === 'string' ? m.json : null;
}
function writeMemory(id, round, mem) {
  const file = comms.paths.memory(state.matchId, id);
  if (!mem || mem.json === null || mem.json === undefined) { comms.removeFile(file); return; }
  comms.atomicWrite(file, JSON.stringify({ round, at: Date.now(), bytes: Buffer.byteLength(mem.json, 'utf8'), note: mem.note || null, json: mem.json }));
}

function newMatchId() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `m${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function blankFighterState() { return { ready: false, readyAt: null, lockedName: null, buildMs: null }; }
function blankActivity() { return { firstAt: null, lastAt: null, saves: 0, tests: 0, checks: 0, says: 0, cmds: 0, lockedAt: null, codingMs: null, autoLocked: null }; }
function blankActivities() { return Object.fromEntries(IDS.map(id => [id, blankActivity()])); }

function curLevel() { return levelForRound(state ? state.round : 1); }
function starterFor(level) { return MIRROR && level === 1 ? starterInfo() : null; }
// The current game mode's adapter (engine/modes/<id>), or null for the built-in fighter duel.
function M() { return state && state.mode && state.mode !== 'fighter' ? modes.get(state.mode) : null; }
function modeLabel() { const m = M(); return m ? m.name : 'Fighter Duel'; }
function finalRound() { const m = M(); return m && m.maxRounds ? m.maxRounds : FINAL_ROUND; }

function defaultSettings() { return { firstRoundLimitSec: config.firstRoundLimitSec, roundLimitSec: config.roundLimitSec, impactFreeze: true }; }
/** Hit-stops (short freezes on big hits and the K.O.) can be switched off by the host. */
function applyFreezeSetting(replay) {
  if (replay && state && state.settings && state.settings.impactFreeze === false) replay.cinematics = [];
  return replay;
}

// ── build clock ──────────────────────────────────────────────────────────────
// The clock for a round starts at the first activity of either AI (or when the
// host presses Start). When it reaches zero every fighter that hasn't locked in
// is auto-locked: current files if valid, else last round's version, else the starter.
function newClock(round, settings) {
  const s = settings || (state && state.settings) || defaultSettings();
  const limitSec = round === 1 ? s.firstRoundLimitSec : s.roundLimitSec;
  return { limitMs: Math.max(0, limitSec) * 1000, startedAt: null, pausedAt: null, pausedMs: 0, bonusMs: 0, expired: false, warned: {} };
}

function clockDeadline(now = Date.now()) {
  const c = state.clock;
  if (!c || !c.limitMs || !c.startedAt) return null;
  const pausedNow = c.pausedAt ? now - c.pausedAt : 0;
  return c.startedAt + c.limitMs + c.bonusMs + c.pausedMs + pausedNow;
}

function clockView() {
  const c = state.clock || newClock(state.round);
  const now = Date.now();
  const deadline = clockDeadline(now);
  return {
    enabled: c.limitMs > 0,
    limitMs: c.limitMs + c.bonusMs,
    running: !!c.startedAt && !c.pausedAt && !c.expired,
    started: !!c.startedAt,
    paused: !!c.pausedAt,
    expired: !!c.expired,
    deadline,
    remainingMs: deadline === null ? (c.limitMs ? c.limitMs + c.bonusMs : null) : Math.max(0, deadline - now),
    startedAt: c.startedAt,
  };
}

function startClock(reason) {
  const c = state.clock;
  if (!c || !c.limitMs || c.startedAt || state.phase !== 'building') return;
  c.startedAt = Date.now();
  feed('system', 'clock', `⏱ Build clock started (${fmtMs(c.limitMs + c.bonusMs)} to lock in)${reason ? ` — ${reason}` : ''}`);
  saveState();
  broadcastState();
}

function fmtMs(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function checkClock() {
  if (state.phase !== 'building') return;
  const c = state.clock;
  if (!c || !c.limitMs || !c.startedAt || c.pausedAt || c.expired) return;
  const left = clockDeadline() - Date.now();
  for (const mark of [60000, 10000]) {
    if (left <= mark && !c.warned[mark] && left > 0) {
      c.warned[mark] = true;
      const waiting = IDS.filter(id => !state.fighters[id].ready).map(labelOf);
      if (waiting.length) {
        feed('system', 'clock', `⏱ ${mark / 1000} seconds left! Still building: ${waiting.join(', ')}`);
        toast('info', `⏱ ${mark / 1000}s left to lock in`);
      }
    }
  }
  if (left <= 0) timeUp();
}

function timeUp() {
  const c = state.clock;
  c.expired = true;
  const late = IDS.filter(id => !state.fighters[id].ready);
  feed('system', 'clock', late.length ? `⏰ TIME'S UP! Auto-locking ${late.map(labelOf).join(' and ')}.` : '⏰ Time is up — both fighters were already locked in.');
  log(`build clock expired; auto-locking: ${late.join(', ') || 'nobody'}`);
  for (const id of late) {
    try { autoLock(id); } catch (e) { log('auto-lock failed', id, e); }
  }
  saveState();
  broadcastState();
  maybeStartCountdown();
}

function autoLock(id) {
  if (M()) return autoLockMode(id, M());
  const level = curLevel();
  const bundle = readBundle(comms.paths.fighterDir(id));
  if (bundle.exists) {
    const check = fullCheck(bundle, { level, mirror: MIRROR });
    if (check.ok) return lockFighter(id, snapshotOf(bundle), check.spec, bundle.sprite, 'timeout', 'current');
  }
  const prev = prevLocked[id];
  if (prev) {
    const b = bundleFromSnapshot(prev.snapshot);
    const c = fullCheck(b, { level, mirror: MIRROR });
    if (c.ok) return lockFighter(id, prev.snapshot, c.spec, b.sprite, 'timeout', 'previous');
  }
  const sb = readBundle(STARTER_DIR);
  const sc = fullCheck(sb, { level, mirror: MIRROR });
  return lockFighter(id, snapshotOf(sb), sc.spec, sb.sprite, 'timeout', 'starter');
}

// ── activity (how long each AI codes) ────────────────────────────────────────
function touch(id, kind) {
  if (!state || state.phase !== 'building' || !state.activity || !state.activity[id]) return;
  if (state.fighters[id] && state.fighters[id].ready) return;
  const a = state.activity[id];
  const now = Date.now();
  if (!a.firstAt) a.firstAt = now;
  a.lastAt = now;
  if (kind === 'save') a.saves++;
  else if (kind === 'test') a.tests++;
  else if (kind === 'check') a.checks++;
  else if (kind === 'say') a.says++;
  else a.cmds++;
  broadcast('activity', { id, activity: a });
  maybeAutoStartClock();
}

// Every round the clock starts as soon as EITHER AI starts working (a save, an arena command
// or a lock-in). The host can always start it by hand.
function maybeAutoStartClock() {
  const c = state.clock;
  if (!c || !c.limitMs || c.startedAt || c.expired || state.phase !== 'building') return;
  const first = IDS.find(x => state.activity[x] && state.activity[x].firstAt);
  if (first) startClock(`${labelOf(first)} started working`);
}

function freshState(matchNumber, settings, mode) {
  const now = Date.now();
  const s = settings || defaultSettings();
  return {
    v: 2,
    matchId: newMatchId(),
    matchNumber,
    mode: mode || 'fighter',
    phase: 'building',
    round: 1,
    level: 1,
    mirrorFirstRound: MIRROR,
    phaseAt: now,
    buildStartedAt: now,
    countdownEndsAt: null,
    fightStartsAt: null,
    fightEndsAt: null,
    fighters: Object.fromEntries(IDS.map(id => [id, blankFighterState()])),
    score: Object.assign(Object.fromEntries(IDS.map(id => [id, 0])), { draws: 0 }),
    lastResult: null,
    settings: s,
    clock: newClock(1, s),
    activity: blankActivities(),
    prediction: null,
    theme: themeForRound(1, matchNumber),
    heartbeat: now,
    serverPid: process.pid,
    ids: IDS,
  };
}

function freshMatch(st) {
  return { matchId: st.matchId, matchNumber: st.matchNumber, mode: st.mode || 'fighter', startedAt: Date.now(), endedAt: null, fighters: FIGHTERS, rounds: [] };
}

function matchDir() { return comms.paths.matchDir(state.matchId); }
function roundDir(round) { return path.join(matchDir(), `round-${round}`); }

function saveState() {
  state.heartbeat = Date.now();
  state.level = curLevel();
  state.clockInfo = clockView();
  comms.atomicWrite(comms.paths.state, JSON.stringify(state, null, 1));
}
function saveMatch() { comms.atomicWrite(path.join(matchDir(), 'match.json'), JSON.stringify(match, null, 1)); }

function loadHistory() { return comms.readJson(comms.paths.history, { matches: [] }) || { matches: [] }; }

function writeSnapshot(dir, snap) {
  comms.ensureDir(dir);
  comms.atomicWrite(path.join(dir, 'fighter.json'), JSON.stringify(snap.fighter, null, 2));
  if (snap.brain !== null && snap.brain !== undefined) comms.atomicWrite(path.join(dir, 'brain.js'), snap.brain);
  if (snap.sprite) comms.atomicWrite(path.join(dir, 'sprite.json'), snap.sprite);
  if (snap.notes) comms.atomicWrite(path.join(dir, 'notes.md'), snap.notes);
  if (snap.lib && typeof snap.lib === 'object') {
    const libDir = path.join(dir, LIB_DIR);
    comms.ensureDir(libDir);
    for (const [name, src] of Object.entries(snap.lib)) {
      if (/^[\w.-]+\.js$/.test(name) && typeof src === 'string') comms.atomicWrite(path.join(libDir, name), src);
    }
  }
}

function readSnapshot(dir) {
  const b = readBundle(dir);
  if (!b.json) return null;
  return { fighter: b.json, brain: b.brain, lib: b.lib || null, sprite: b.spriteText, notes: b.notes };
}

// Every match starts with the identical starter fighter in both folders — and nothing else.
// EVERYTHING that was in fighters/<id>/ (old brains, lab copies, helper scripts, reports,
// previews) is moved to data/archive/<stamp>/<id>/, which the AIs are told never to read,
// so no AI can carry work over from an earlier match.
function installStarter(id, reason) {
  const dir = comms.paths.fighterDir(id);
  comms.ensureDir(dir);
  let entries = [];
  try { entries = fs.readdirSync(dir); } catch { entries = []; }
  if (entries.length) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const dest = path.join(comms.DATA, 'archive', stamp, id);
    comms.ensureDir(dest);
    const left = [];
    for (const name of entries) {
      const from = path.join(dir, name);
      const to = path.join(dest, name);
      try { fs.renameSync(from, to); continue; } catch { /* in use: copy, then delete */ }
      try {
        fs.cpSync(from, to, { recursive: true });
        fs.rmSync(from, { recursive: true, force: true });
      } catch (e) { left.push(name); log('archive failed', id, name, e.message); }
    }
    log(`archived ${entries.length - left.length} item(s) from fighters/${id}/ to data/archive/${stamp}/${id}/`);
    if (left.length) {
      feed('system', 'error', `Could not clear ${left.join(', ')} from fighters/${id}/ (in use?). Close whatever has it open and press New match again, so the AI starts clean.`);
    }
  }
  const m = M();
  if (m) {
    for (const [name, text] of Object.entries(m.starter || {})) {
      if (!/^(lib\/)?[\w.-]+$/.test(name) || typeof text !== 'string') continue;
      comms.ensureDir(path.dirname(path.join(dir, name)));
      fs.writeFileSync(path.join(dir, name), text);
    }
    log(`installed the ${m.name} starter in fighters/${id}/ (${reason})`);
    return;
  }
  for (const f of FIGHTER_FILES) {
    if (fs.existsSync(path.join(STARTER_DIR, f))) fs.copyFileSync(path.join(STARTER_DIR, f), path.join(dir, f));
  }
  log(`installed the starter fighter in fighters/${id}/ (${reason})`);
}

// ── feeds (live activity per fighter + system) ───────────────────────────────
let feeds = { system: [] };
for (const id of IDS) feeds[id] = [];
let feedsDirty = false;
let feedSeq = 0;

function feed(who, kind, text, data) {
  const entry = { n: ++feedSeq, at: Date.now(), who, kind, text: String(text).slice(0, 400) };
  if (data !== undefined) entry.data = data;
  const list = feeds[who] || (feeds[who] = []);
  list.push(entry);
  if (list.length > 120) list.splice(0, list.length - 120);
  feedsDirty = true;
  broadcast('feed', entry);
  return entry;
}

function saveFeeds() {
  if (!feedsDirty || !state) return;
  feedsDirty = false;
  comms.atomicWrite(path.join(matchDir(), 'feeds.json'), JSON.stringify({ matchId: state.matchId, feeds, feedSeq }));
}

// ── inbox (server → CLI) ─────────────────────────────────────────────────────
function updateInbox(id, fn) {
  const file = comms.paths.inbox(id);
  const inbox = comms.readJson(file, null) || { acks: [], notices: [] };
  inbox.acks = inbox.acks || [];
  inbox.notices = inbox.notices || [];
  fn(inbox);
  inbox.acks = inbox.acks.slice(-12);
  inbox.notices = inbox.notices.slice(-30);
  inbox.updatedAt = Date.now();
  comms.atomicWrite(file, JSON.stringify(inbox, null, 1));
}

function ack(id, nonce, body) {
  updateInbox(id, (ib) => ib.acks.push(Object.assign({ nonce, at: Date.now() }, body)));
}

function notice(id, n) {
  updateInbox(id, (ib) => {
    ib.notices = ib.notices.filter(x => !(x.matchId === n.matchId && x.round === n.round));
    ib.notices.push(Object.assign({ at: Date.now() }, n));
  });
}

// ═════════════════════════════════════════════════════════════════════════════
//  Live fighter folders
// ═════════════════════════════════════════════════════════════════════════════

const live = {};
for (const id of IDS) live[id] = { sig: null, bundle: null, check: null, revision: 0, lastChangeAt: null, lastGoodSpec: null, lastGoodSprite: null, brainLoadError: null, card: null, firstSeenAt: null };

function fileSig(dir) {
  const info = {};
  const m = M();
  for (const name of m ? [m.designFile, m.brainFile, 'notes.md'] : FIGHTER_FILES) {
    try {
      const st = fs.statSync(path.join(dir, name));
      info[name] = `${st.size}:${Math.floor(st.mtimeMs)}`;
    } catch { info[name] = '-'; }
  }
  // lib/*.js (brain modules) count as one entry
  let lib = '-';
  try {
    const libDir = path.join(dir, LIB_DIR);
    const names = fs.readdirSync(libDir).filter(n => n.endsWith('.js')).sort();
    lib = names.map(n => { const st = fs.statSync(path.join(libDir, n)); return `${n}:${st.size}:${Math.floor(st.mtimeMs)}`; }).join('|') || '-';
  } catch { /* no lib folder */ }
  info[LIB_DIR] = lib;
  return info;
}

function roundDiff(id) {
  const lv = live[id];
  const prev = prevLocked[id];
  if (!prev || !lv.check) return null;
  const spec = lv.check.ok || !lv.lastGoodSpec ? lv.check.spec : lv.lastGoodSpec;
  const d = specDiff(prev.spec, spec);
  d.vsRound = prev.round;
  d.brain = lineDiff(libText(prev.snapshot.brain, prev.snapshot.lib), libText(lv.bundle.brain, lv.bundle.lib));
  d.spriteChanged = (prev.snapshot.sprite || '') !== (lv.bundle.spriteText || '');
  return d;
}

function statLine(stats) {
  return STAT_KEYS.filter(k => stats[k]).map(k => `${STAT_INFO[k] ? STAT_INFO[k].short.toLowerCase() : k.slice(0, 3)} ${stats[k]}`).join(' ');
}

/** brain.js + lib/*.js as one text (for line diffs). */
function libText(brain, lib) {
  let t = brain || '';
  if (lib && typeof lib === 'object') for (const n of Object.keys(lib).sort()) t += `\n// lib/${n}\n${lib[n]}`;
  return t;
}

function frameCount(sprite) {
  if (!sprite) return 0;
  return Object.values(sprite.frames).reduce((a, l) => a + l.length, 0);
}

function describeSave(id, prevBundle, prevCheck, bundle, check, changed) {
  const parts = [];
  if (changed.includes('fighter.json')) {
    if (!bundle.files['fighter.json'].exists) parts.push('deleted fighter.json');
    else if (bundle.jsonError) parts.push(`fighter.json has a syntax error`);
    else if (!prevCheck || !prevBundle || !prevBundle.json) parts.push(`created "${check.spec.name}" — ${check.spec.weapon ? `${check.spec.weapon.name}, ` : ''}${statLine(check.spec.stats)}, ${check.spec.abilities.filter(a => !a.basic).length} abilities`);
    else {
      const d = specDiff(prevCheck.spec, check.spec);
      const bits = [];
      if (d.nameChanged) bits.push(`renamed to "${check.spec.name}"`);
      if (d.weapon) bits.push(`weapon → ${check.spec.weapon ? check.spec.weapon.name : d.weapon.to}`);
      if (d.lookChanged) bits.push(check.spec.look ? `new look (${[check.spec.look.base, check.spec.look.outfit, check.spec.look.headgear].filter(x => x && x !== 'none').join(' · ')})` : 'new look');
      const s = Object.entries(d.stats).map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${v}`);
      if (s.length) bits.push(`stats ${s.join(', ')}`);
      for (const t of d.traits.added) bits.push(`+ trait ${TRAITS[t] ? TRAITS[t].name : t}`);
      for (const t of d.traits.removed) bits.push(`− trait ${TRAITS[t] ? TRAITS[t].name : t}`);
      for (const a of d.abilities) {
        if (a.kind === 'added') bits.push(`+ ${a.name} (${a.type})`);
        else if (a.kind === 'removed') bits.push(`− ${a.name}`);
        else bits.push(`${a.name}: ${a.changes.slice(0, 3).map(c => `${c.field} ${fmtVal(c.from)}→${fmtVal(c.to)}`).join(', ')}${a.changes.length > 3 ? '…' : ''}`);
      }
      parts.push(bits.length ? `fighter.json: ${bits.join(' · ')}` : 'fighter.json saved (text only)');
    }
  }
  if (changed.includes('brain.js')) {
    if (!bundle.files['brain.js'].exists) parts.push('deleted brain.js');
    else {
      const d = lineDiff(prevBundle ? prevBundle.brain : '', bundle.brain);
      parts.push(`brain.js ${lineCount(bundle.brain)} lines (+${d.added} −${d.removed})`);
    }
  }
  if (changed.includes('sprite.json')) {
    if (!bundle.files['sprite.json'].exists) parts.push('deleted sprite.json');
    else if (bundle.spriteErrors && bundle.spriteErrors.length) parts.push('sprite.json has a problem');
    else parts.push(`painted sprite.json (${frameCount(bundle.sprite)} frames, ${Object.keys(bundle.sprite.palette).length} colours)`);
  }
  if (changed.includes(LIB_DIR)) {
    const n = bundle.lib ? Object.keys(bundle.lib).length : 0;
    const d = lineDiff(libText('', prevBundle ? prevBundle.lib : null), libText('', bundle.lib));
    parts.push(n ? `lib/ ${n} module${n === 1 ? '' : 's'} (+${d.added} −${d.removed} lines)` : 'removed lib/');
  }
  if (changed.includes('notes.md')) parts.push('updated notes.md');
  return parts.join(' | ');
}


function checkLive(bundle) {
  const level = curLevel();
  return checkBundle(bundle, { level, starter: starterFor(level) });
}

function refreshLive(id, { silent = false, force = false } = {}) {
  if (M()) return refreshLiveMode(id, M(), { silent, force });
  const dir = comms.paths.fighterDir(id);
  const sig = fileSig(dir);
  const lv = live[id];
  const prevSig = lv.sig;
  if (!force && prevSig && JSON.stringify(prevSig) === JSON.stringify(sig)) return false;
  const changed = prevSig ? Object.keys(sig).filter(k => sig[k] !== prevSig[k]) : [];
  const prevBundle = lv.bundle, prevCheck = lv.check;
  const bundle = readBundle(dir);
  const check = checkLive(bundle);
  lv.brainLoadError = null;
  if (bundle.brain && !check.errors.some(e => e.startsWith('brain.js'))) {
    const b = createBrain(bundle.brain, { seed: 1, label: `${id}-live`, lib: bundle.lib || null });
    if (!b.ok) lv.brainLoadError = b.error;
  }
  lv.sig = sig;
  lv.bundle = bundle;
  lv.check = check;
  if (bundle.json && !bundle.jsonError) lv.lastGoodSpec = check.spec;
  if (bundle.sprite) lv.lastGoodSprite = bundle.sprite;
  if (prevSig && changed.length) {
    lv.revision++;
    lv.lastChangeAt = Date.now();
    if (!lv.firstSeenAt && bundle.exists) lv.firstSeenAt = Date.now();
    if (!silent) {
      touch(id, 'save');
      const text = describeSave(id, prevBundle, prevCheck, bundle, check, changed);
      if (text) feed(id, 'file', text, { files: changed, valid: check.ok && !lv.brainLoadError, revision: lv.revision });
    }
  } else if (bundle.exists) {
    lv.firstSeenAt = lv.firstSeenAt || Date.now();
  }
  lv.card = buildCard(id);
  if (prevSig || force) broadcast('card', lv.card);
  return true;
}

function libCard(lib) {
  if (!lib || typeof lib !== 'object') return [];
  let budget = 60000;
  return Object.keys(lib).sort().map((name) => {
    const src = String(lib[name]);
    const source = budget > 0 ? src.slice(0, budget) : '';
    budget -= source.length;
    return { name, lines: lineCount(src), bytes: Buffer.byteLength(src, 'utf8'), source: source.length < src.length ? `${source}\n/* …truncated… */` : source };
  });
}

function memoryCard(id) {
  try {
    const m = comms.readJson(comms.paths.memory(state.matchId, id), null);
    return m && typeof m.json === 'string' ? { round: m.round, bytes: m.bytes, note: m.note || null } : null;
  } catch { return null; }
}

function buildCard(id) {
  if (M()) return modeCard(id, M());
  const f = BY_ID[id];
  const lv = live[id];
  const b = lv.bundle;
  const c = lv.check;
  const useSpec = !b.jsonError ? c.spec : (lv.lastGoodSpec || c.spec);
  const errors = c.errors.slice();
  if (lv.brainLoadError) errors.push(lv.brainLoadError);
  const brainSrc = b.brain || '';
  return {
    id, label: f.label, color: f.color, side: f.side,
    exists: b.exists,
    level: c.level,
    files: Object.fromEntries(Object.entries(b.files).map(([k, v]) => [k, { exists: v.exists, size: v.size, mtimeMs: v.mtimeMs }])),
    valid: errors.length === 0,
    stale: !!b.jsonError && !!lv.lastGoodSpec,
    errors, warnings: c.warnings,
    spec: useSpec,
    brain: { source: brainSrc.length > 120000 ? `${brainSrc.slice(0, 120000)}\n/* …truncated… */` : brainSrc, lines: lineCount(brainSrc), exists: !!b.brain },
    lib: libCard(b.lib),
    memory: memoryCard(id),
    sprite: b.sprite || lv.lastGoodSprite || null,
    spriteStale: !b.sprite && !!lv.lastGoodSprite,
    spriteSource: b.spriteSource || null,
    notes: b.notes ? b.notes.slice(0, 12000) : null,
    revision: lv.revision,
    lastChangeAt: lv.lastChangeAt,
    firstSeenAt: lv.firstSeenAt,
    diff: roundDiff(id),
  };
}

// ═════════════════════════════════════════════════════════════════════════════
//  Other game modes (engine/modes/<id>): the same round loop with mode files
//  (see engine/modes/README.md). The fighter duel above stays the built-in mode.
// ═════════════════════════════════════════════════════════════════════════════

function modeSpec(check) {
  return { name: check.name, colors: check.colors || null, summary: check.summary || '', cardLines: check.cardLines || [], spec: check.spec };
}

function modeStarterBundle(m) {
  const st = m.starter || {};
  return { mode: m.id, exists: true, files: {}, design: st[m.designFile] ?? null, brain: st[m.brainFile] ?? null, lib: null, notes: null, readErrors: [] };
}

function refreshLiveMode(id, m, { silent = false, force = false } = {}) {
  const dir = comms.paths.fighterDir(id);
  const sig = fileSig(dir);
  const lv = live[id];
  const prevSig = lv.sig;
  if (!force && prevSig && JSON.stringify(prevSig) === JSON.stringify(sig)) return false;
  const changed = prevSig ? Object.keys(sig).filter(k => sig[k] !== prevSig[k]) : [];
  const prevBundle = lv.bundle;
  const bundle = modes.readBundle(dir, m);
  const check = modes.safeCheck(m, bundle, curLevel());
  lv.sig = sig;
  lv.bundle = bundle;
  lv.check = check;
  if (prevSig && changed.length) {
    lv.revision++;
    lv.lastChangeAt = Date.now();
    if (!lv.firstSeenAt && bundle.exists) lv.firstSeenAt = Date.now();
    if (!silent) {
      touch(id, 'save');
      const parts = changed.map((k) => {
        if (k === LIB_DIR) return `lib/ ${bundle.lib ? Object.keys(bundle.lib).length : 0} module(s)`;
        const f = bundle.files[k];
        if (f && !f.exists) return `deleted ${k}`;
        if (k === m.brainFile && bundle.brain) {
          const d = lineDiff((prevBundle && prevBundle.brain) || '', bundle.brain);
          return `${k} ${lineCount(bundle.brain)} lines (+${d.added} −${d.removed})`;
        }
        return `saved ${k}`;
      });
      const tail = check.ok ? ` — ${check.name}${check.summary ? `: ${check.summary}` : ''}` : ` — INVALID: ${check.errors[0] || 'see node arena.js check'}`;
      feed(id, 'file', `${parts.join(' | ')}${tail}`, { files: changed, valid: check.ok, revision: lv.revision });
    }
  } else if (bundle.exists) {
    lv.firstSeenAt = lv.firstSeenAt || Date.now();
  }
  lv.card = modeCard(id, m);
  if (prevSig || force) broadcast('card', lv.card);
  return true;
}

function modeCard(id, m) {
  const f = BY_ID[id];
  const lv = live[id];
  const b = lv.bundle || { files: {}, design: null, brain: null, lib: null, exists: false };
  const c = lv.check || { ok: false, errors: ['not read yet'], warnings: [], name: '', summary: '', cardLines: [], colors: null };
  const brainSrc = b.brain || '';
  const design = b.design || '';
  return {
    id, label: f.label, color: f.color, side: f.side,
    mode: m.id, exists: !!b.exists, level: curLevel(),
    files: Object.fromEntries(Object.entries(b.files || {}).map(([k, v]) => [k, { exists: v.exists, size: v.size, mtimeMs: v.mtimeMs }])),
    valid: !!c.ok, errors: c.errors, warnings: c.warnings,
    name: c.name, colors: c.colors || null, summary: c.summary, cardLines: c.cardLines,
    // a minimal fighter-shaped spec, so shared UI code that expects one never breaks
    spec: { name: c.name || f.label, colors: c.colors || {}, abilities: [], stats: {}, traits: [] },
    design: { file: m.designFile, source: design.length > 60000 ? `${design.slice(0, 60000)}\n…truncated…` : design },
    brain: { file: m.brainFile, source: brainSrc.length > 120000 ? `${brainSrc.slice(0, 120000)}\n/* …truncated… */` : brainSrc, lines: lineCount(brainSrc), exists: !!b.brain },
    lib: libCard(b.lib),
    memory: memoryCard(id),
    sprite: null,
    notes: b.notes ? b.notes.slice(0, 12000) : null,
    revision: lv.revision, lastChangeAt: lv.lastChangeAt, firstSeenAt: lv.firstSeenAt,
    diff: null,
  };
}

function autoLockMode(id, m) {
  const level = curLevel();
  const b = modes.readBundle(comms.paths.fighterDir(id), m);
  if (b.exists) {
    const c = modes.safeCheck(m, b, level);
    if (c.ok) return lockFighter(id, modes.snapshotOf(b), modeSpec(c), null, 'timeout', 'current');
  }
  const prev = prevLocked[id];
  if (prev && prev.snapshot && prev.snapshot.mode === m.id) {
    const c = modes.safeCheck(m, modes.bundleFromSnapshot(prev.snapshot), level);
    if (c.ok) return lockFighter(id, prev.snapshot, modeSpec(c), null, 'timeout', 'previous');
  }
  const sb = modeStarterBundle(m);
  const sc = modes.safeCheck(m, sb, level);
  return lockFighter(id, modes.snapshotOf(sb), modeSpec(sc), null, 'timeout', 'starter');
}

function modeLockedFromSnapshot(snap, round) {
  const m = M();
  const c = modes.safeCheck(m, modes.bundleFromSnapshot(snap), levelForRound(round));
  return { snapshot: snap, spec: modeSpec(c), sprite: null, round, at: 0 };
}

function simFailed(err) {
  log('simulation failed:', err);
  feed('system', 'error', `The simulation crashed: ${String(err).split('\n')[0]}. Press FORCE START to retry.`);
  toast('error', 'Simulation crashed — press Force Start to retry');
  pending = null;
  clearTimers();
  setPhase('building', { countdownEndsAt: null });
}

function runModeSimulation(round, seed, m) {
  const started = Date.now();
  const w = spawnSim({
    mode: m.id,
    snapshots: IDS.map(id => locked[id].snapshot),
    ids: IDS, labels: IDS.map(id => BY_ID[id].label), seed, round,
    level: levelForRound(round),
    theme: state.theme,
    memories: IDS.map(id => readMemory(id)),
  }, (msg) => {
    if (worker !== w) return;
    worker = null;
    pending = { modeRound: true, round, seed, replay: msg.replay, result: msg.result, stats: msg.stats || [{}, {}], memories: msg.memories || null, brainErrors: msg.brainErrors || null };
    log(`round ${round} (${m.name}): simulated in ${Date.now() - started} ms — ${Number(msg.replay && msg.replay.duration || 0).toFixed(1)}s of action`);
    try {
      const dir = roundDir(round);
      comms.ensureDir(dir);
      comms.atomicWrite(path.join(dir, 'replay.json'), JSON.stringify(msg.replay));
      comms.atomicWrite(path.join(dir, 'sim.json'), JSON.stringify(Object.assign({}, pending, { replay: undefined })));
    } catch (e) { log('could not save replay', e); }
    tryStartFight();
  }, (err) => {
    if (worker !== w) return;
    worker = null;
    simFailed(err);
  });
  worker = w;
}

function writeModeCsv(rec, m) {
  const keys = [...new Set(IDS.flatMap(id => Object.keys((rec.fighters[id] || {}).stats || {})))].sort();
  const header = ['timestamp', 'match', 'match_id', 'mode', 'round', 'level', 'ai', 'ai_label', 'name', 'result', 'method', 'time', ...keys];
  const esc = (v) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const ts = new Date(rec.endedAt || Date.now()).toISOString().replace('T', ' ').slice(0, 19);
  const rows = IDS.map(id => {
    const f = rec.fighters[id] || {};
    const res = !rec.result.winnerId ? 'draw' : rec.result.winnerId === id ? 'win' : 'loss';
    return [ts, state.matchNumber, state.matchId, m.id, rec.round, rec.level, id, labelOf(id), f.name, res, rec.result.method, rec.result.time, ...keys.map(k => (f.stats || {})[k])];
  });
  const file = path.join(comms.paths.results, `${m.id}-rounds.csv`);
  try {
    fs.mkdirSync(comms.paths.results, { recursive: true });
    let first = '';
    try { first = fs.readFileSync(file, 'utf8').split('\n')[0]; } catch { first = ''; }
    const head = first === header.join(',') ? '' : `${header.join(',')}\n`;   // new stat columns start a new header row
    fs.appendFileSync(file, head + rows.map(r => r.map(esc).join(',')).join('\n') + '\n');
  } catch (e) { log('could not write the mode results csv', e.message); }
}

function endModeRound() {
  const m = M();
  clearTimers();
  const { round, seed, replay, result, stats, memories, brainErrors } = pending;
  const level = levelForRound(round);
  IDS.forEach((id, i) => {
    const json = memories && typeof memories[i] === 'string' ? memories[i] : null;
    try { writeMemory(id, round, json ? { json, note: null } : null); } catch (e) { log('could not save brain memory', id, e.message); }
  });
  const res = result || { winner: null, method: 'DRAW', time: 0, text: '' };
  const winnerId = res.winner === 0 || res.winner === 1 ? IDS[res.winner] : null;
  if (winnerId) state.score[winnerId]++; else state.score.draws++;
  state.lastResult = winnerId ? `${labelOf(winnerId)} won round ${round}${res.text ? ` — ${res.text}` : ''}` : `Round ${round} was a draw${res.text ? ` — ${res.text}` : ''}`;
  const labels = IDS.map(labelOf);
  const specs = IDS.map(id => (locked[id] && locked[id].spec) || { name: '?', spec: null });
  const reportFiles = {};
  IDS.forEach((id, side) => {
    let body;
    try { body = m.report({ side, replay, result: res, stats, specs: specs.map(s => s.spec), labels, round, level, score: scoreText() }); } catch (e) { body = `(the ${m.name} report could not be built: ${e.message})`; }
    const text = ascii(String(body || '').trimEnd());
    const dir = comms.paths.reports(id);
    comms.ensureDir(dir);
    const base = `m${state.matchNumber}-round-${round}`;
    comms.atomicWrite(path.join(dir, `${base}.md`), text + '\n');
    comms.atomicWrite(path.join(dir, 'latest.md'), text + '\n');
    reportFiles[id] = { md: `fighters/${id}/reports/${base}.md`, json: null };
  });
  let rows = [];
  try { rows = m.resultRows(stats) || []; } catch { rows = []; }
  const activity = JSON.parse(JSON.stringify(state.activity || blankActivities()));
  const rec = {
    round, seed, level, mode: m.id,
    theme: state.theme ? state.theme.id : null, themeName: state.theme ? state.theme.name : null,
    startedAt: state.fightStartsAt, endedAt: Date.now(),
    result: { winnerId, method: res.method || (winnerId ? 'WIN' : 'DRAW'), time: res.time ?? null, text: res.text || '' },
    resultRows: rows,
    text: state.lastResult,
    prediction: state.prediction || null,
    activity,
    clockLimitMs: state.clock ? state.clock.limitMs + state.clock.bonusMs : 0,
    fighters: Object.fromEntries(IDS.map((id, i) => [id, {
      name: specs[i].name, colors: specs[i].colors || null, summary: specs[i].summary || '', cardLines: specs[i].cardLines || [],
      stats: (stats && stats[i]) || {},
      notes: locked[id] && locked[id].snapshot ? (locked[id].snapshot.notes || null) : null,
      libFiles: locked[id] && locked[id].snapshot && locked[id].snapshot.lib ? Object.keys(locked[id].snapshot.lib).length : 0,
      memoryBytes: memories && typeof memories[i] === 'string' ? Buffer.byteLength(memories[i], 'utf8') : 0,
      buildMs: state.fighters[id].buildMs,
      brainErrors: brainErrors ? brainErrors[i] || 0 : 0,
      brainLines: locked[id] && locked[id].snapshot ? lineCount(locked[id].snapshot.brain || '') : null,
      autoLocked: state.fighters[id].autoLocked || null,
    }])),
    reports: Object.fromEntries(IDS.map(id => [id, reportFiles[id].md])),
    decision: null,
  };
  match.rounds = match.rounds.filter(r => r.round !== round);
  match.rounds.push(rec);
  saveMatch();
  writeModeCsv(rec, m);
  for (const id of IDS) prevLocked[id] = locked[id];
  state._reports = Object.fromEntries(IDS.map(id => [id, reportFiles[id]]));
  const pred = state.prediction ? (state.prediction === winnerId ? ' — the host called it!' : ' — upset! The host picked the other side.') : '';
  feed('system', 'result', `${state.lastResult}. Score: ${scoreText()}${pred}`);
  log(state.lastResult);
  setPhase('round_over', {});
  broadcast('match', matchPublic());
  if (round >= finalRound()) {
    feed('system', 'match', `That was the FINAL ROUND (${finalRound()} of ${finalRound()}) - the match ends now`);
    timers.final = setTimeout(() => endMatch('final round'), FINAL_RESULT_MS);
  }
}

function modeLevelUpText(m, nextRound) {
  const level = levelForRound(nextRound);
  const limit = limitSecFor(nextRound);
  const clockLine = limit ? `  TIME LIMIT: ${fmtMs(limit * 1000)} to evolve and lock in. The clock starts as soon as either AI starts working; when it hits 0:00 your current files are auto-locked (if they are valid). Check it any time: node arena.js time` : '  No time limit this round.';
  const lines = [`LEVEL UP -> level ${level} of ${finalRound()}!`];
  let info = null, unlocks = [];
  try { info = m.levelInfo(level); } catch { info = null; }
  try { unlocks = m.levelUnlocks(level) || []; } catch { unlocks = []; }
  if (info && info.headline) lines.push(`  ${info.headline}`);
  if (unlocks.length) { lines.push('  NEW AT THIS LEVEL:'); for (const u of unlocks) lines.push(`   + ${u}`); }
  lines.push(`  See everything: node arena.js level  |  rules  |  help   (the manual: ${m.guideFile})`);
  lines.push(clockLine);
  return lines;
}

function modeBootstrap() {
  const m = M();
  if (!m) return { id: 'fighter', name: 'Fighter Duel', guide: 'AI_GUIDE.md', maxRounds: FINAL_ROUND };
  const levels = {};
  for (let l = 1; l <= (m.maxRounds || 12); l++) {
    try { levels[l] = Object.assign({ level: l, headline: '', lines: [] }, m.levelInfo(l), { unlocks: m.levelUnlocks(l) || [] }); } catch { levels[l] = { level: l, headline: '', lines: [], unlocks: [] }; }
  }
  return { id: m.id, name: m.name, tagline: m.tagline, guide: m.guideFile, designFile: m.designFile, brainFile: m.brainFile, maxRounds: m.maxRounds || 12, levels, view: `/js/modes/${m.id}/view.js` };
}

function modePrompts(m) {
  const s = state ? state.settings : defaultSettings();
  const lim = (sec) => (sec ? fmtMs(sec * 1000) : 'no limit');
  const out = {};
  for (const f of FIGHTERS) {
    const other = FIGHTERS.find(x => x.id !== f.id);
    out[f.id] = [
      `You are competing in AI FIGHT - ${String(m.name).toUpperCase()} mode: ${m.tagline} A human watches everything live on a big screen.`,
      `You are "${f.id}". Your opponent is another AI (${other.label}) doing the same thing at the same time.`,
      ``,
      `Your working directory is the AI Fight project. Do this:`,
      `1. Read ${m.guideFile} completely. It explains the rules, the files you edit, the levels and the round loop.`,
      `2. Your files live in fighters/${f.id}/: ${m.designFile} and ${m.brainFile} (+ optional lib/*.js modules). Every match starts from the same starter files. The match is ${finalRound()} rounds; every round you level up (level = round number) and new options unlock.`,
      `   Spectators watch every save live, so narrate as you go: node arena.js say ${f.id} "..."`,
      `3. THERE IS A BUILD TIME LIMIT (round 1: ${lim(s.firstRoundLimitSec)}, later rounds: ${lim(s.roundLimitSec)}). Every round the clock starts as soon as either AI starts working, so get going right away. Every arena command shows the time left (or run: node arena.js time ${f.id}). When it hits 0:00 your current files are auto-locked if valid, so work fast and keep your files valid at all times.`,
      `4. Check and test: node arena.js check ${f.id}  and  node arena.js test ${f.id}`,
      `5. When you're happy, lock in: node arena.js ready ${f.id}`,
      `   That command WAITS for the round and for the human's decision. Run it (and "node arena.js wait ${f.id}") with the longest timeout your shell tool allows (e.g. 600000 ms). Whenever it prints STATUS: STILL_WAITING or your shell times out, immediately run: node arena.js wait ${f.id}`,
      `6. STATUS: NEXT_ROUND means the human wants another round: read the report, evolve, test, and ready again (the clock is running again).`,
      `   STATUS: MATCH_OVER means stop and give a short summary.`,
      ``,
      `Rules: only create or edit files inside fighters/${f.id}/. Never read or modify fighters/${other.id}/, the engine, arena.js, server.js or data/.`,
      `Every match is a fresh start: do not look for, restore or reuse anything from earlier matches. Play to WIN: your opponent evolves every round too, so build something that wins on its own instead of only countering their last round.`,
    ].join('\n');
  }
  return out;
}

// ═════════════════════════════════════════════════════════════════════════════
//  Presence + tests
// ═════════════════════════════════════════════════════════════════════════════

const presence = {};
for (const id of IDS) presence[id] = { listening: false, at: null, mode: null };

function pollPresence() {
  for (const id of IDS) {
    const p = comms.readJson(comms.paths.presence(id), null);
    const listening = !!(p && Date.now() - p.at < 7000);
    const next = { listening, at: p ? p.at : null, mode: listening ? p.mode : null };
    if (next.listening !== presence[id].listening) {
      presence[id] = next;
      broadcast('presence', { id, presence: next });
    } else presence[id] = next;
  }
}

const tests = {};
for (const id of IDS) tests[id] = null;

// ═════════════════════════════════════════════════════════════════════════════
//  Messages from the AIs
// ═════════════════════════════════════════════════════════════════════════════

function processOutboxes() {
  for (const id of IDS) {
    for (const msg of comms.drainOutbox(id)) {
      try { handleMessage(id, msg); } catch (e) { log('message error', id, e); }
    }
  }
}

function handleMessage(id, msg) {
  switch (msg.type) {
    case 'say': {
      const text = String(msg.text || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 280);
      touch(id, 'say');
      if (text) feed(id, 'say', text);
      break;
    }
    case 'test': {
      touch(id, 'test');
      const sum = Array.isArray(msg.summary) ? msg.summary : [];
      tests[id] = { at: msg.at || Date.now(), seed: msg.seed, summary: sum };
      const wins = sum.filter(s => s.winner === 0).length;
      const text = sum.length === 1
        ? `test vs ${sum[0].oppName}: ${sum[0].winner === 0 ? 'WIN' : sum[0].winner === 1 ? 'LOSS' : 'DRAW'} (${sum[0].method}, ${sum[0].time}s)`
        : `test gauntlet: ${wins}/${sum.length} wins — ${sum.map(s => `${s.oppName} ${s.winner === 0 ? 'W' : s.winner === 1 ? 'L' : 'D'}`).join(', ')}`;
      feed(id, 'test', text, { summary: sum });
      broadcast('test', { id, test: tests[id] });
      break;
    }
    case 'check': touch(id, 'check'); break;
    case 'cmd': touch(id, 'cmd'); break;
    case 'ready': touch(id, 'ready'); handleReady(id, msg); break;
    default: break;
  }
}

function handleReady(id, msg) {
  const reply = (ok, message, extra) => ack(id, msg.nonce, Object.assign({ ok, message, matchId: state.matchId, round: state.round, level: curLevel() }, extra));
  if (state.phase !== 'building') return reply(false, `round ${state.round} is already ${state.phase}`);
  if (msg.matchId !== state.matchId || msg.round !== state.round) return reply(false, 'the round changed while you were locking in — run ready again');
  if (!msg.snapshot || typeof msg.snapshot !== 'object') return reply(false, 'no fighter snapshot received');
  if (M()) {
    const m = M();
    if (msg.snapshot.mode !== m.id) return reply(false, `this match is ${m.name} - your snapshot is for another mode; run ready again`);
    const mc = modes.safeCheck(m, modes.bundleFromSnapshot(msg.snapshot), curLevel());
    if (!mc.ok) return reply(false, `the arena rejected your ${m.name} files: ${mc.errors.join('; ')}`);
    lockFighter(id, msg.snapshot, modeSpec(mc), null, 'ai');
    const otherId = IDS.find(x => x !== id);
    reply(true, 'locked in', { opponentReady: !!state.fighters[otherId].ready, name: mc.name });
    maybeStartCountdown();
    return;
  }
  const bundle = bundleFromSnapshot(msg.snapshot);
  const check = fullCheck(bundle, { level: curLevel(), mirror: MIRROR });
  if (!check.ok) return reply(false, `the arena rejected your fighter: ${check.errors.join('; ')}`);
  lockFighter(id, msg.snapshot, check.spec, bundle.sprite, 'ai');
  const other = IDS.find(x => x !== id);
  reply(true, 'locked in', { opponentReady: !!state.fighters[other].ready });
  maybeStartCountdown();
}

function lockFighter(id, snapshot, spec, sprite, by, source) {
  const wasReady = state.fighters[id].ready;
  const now = Date.now();
  locked[id] = { snapshot, spec, sprite, round: state.round, at: now };
  if (M()) modes.writeSnapshot(path.join(roundDir(state.round), id), snapshot, M());
  else writeSnapshot(path.join(roundDir(state.round), id), snapshot);
  state.fighters[id] = {
    ready: true, readyAt: now, lockedName: spec.name,
    buildMs: now - (state.buildStartedAt || now),
    autoLocked: by === 'timeout' ? source : null,
  };
  const act = state.activity && state.activity[id];
  if (act) {
    act.lockedAt = now;
    act.codingMs = act.firstAt ? now - act.firstAt : null;
    act.autoLocked = by === 'timeout' ? source : by === 'host' ? 'host' : null;
    broadcast('activity', { id, activity: act });
  }
  if (by === 'timeout') {
    const what = { current: 'its current files', previous: 'its fighter from last round (current files were invalid)', starter: 'the starter (no valid files)' }[source] || 'its files';
    feed(id, 'ready', `⏰ AUTO-LOCKED (time ran out) with ${what}: "${spec.name}"`);
    feed('system', 'ready', `${BY_ID[id].label} ran out of time — auto-locked with ${what}`);
  } else {
    feed(id, 'ready', `${wasReady ? 'RE-LOCKED' : 'LOCKED IN'} "${spec.name}" for round ${state.round}${by === 'host' ? ' (forced by host)' : ''}${act && act.codingMs ? ` after ${fmtMs(act.codingMs)} of work` : ''}`);
    feed('system', 'ready', `${BY_ID[id].label} ${wasReady ? 're-locked' : 'is READY'} with "${spec.name}"`);
  }
  maybeAutoStartClock();
  saveState();
  broadcastState();
}

// ═════════════════════════════════════════════════════════════════════════════
//  Round state machine
// ═════════════════════════════════════════════════════════════════════════════

function clearTimers() { for (const k of Object.keys(timers)) { clearTimeout(timers[k]); delete timers[k]; } }

function setPhase(phase, extra = {}) {
  state.phase = phase;
  state.phaseAt = Date.now();
  Object.assign(state, extra);
  saveState();
  broadcastState();
}

function maybeStartCountdown() {
  if (state.phase === 'building' && IDS.every(id => state.fighters[id].ready && locked[id])) startCountdown();
}

function startCountdown() {
  clearTimers();
  const round = state.round;
  const seed = crypto.randomBytes(4).readUInt32LE(0);
  pending = null;
  if (state.clock && state.clock.startedAt && !state.clock.pausedAt) state.clock.stoppedAt = Date.now();
  setPhase('countdown', { countdownEndsAt: Date.now() + COUNTDOWN_MS, fightStartsAt: null, fightEndsAt: null, seed });
  feed('system', 'round', `Both ${M() ? 'AIs' : 'fighters'} locked in — ROUND ${round}${round === 1 && MIRROR && !M() ? ' (mirror match: same starter, different brains)' : ''}${M() ? '' : ` in the ${state.theme.name}`}! ${locked[IDS[0]].spec.name} vs ${locked[IDS[1]].spec.name}`);
  log(`round ${round} (level ${curLevel()}, ${M() ? M().name : state.theme.name}): countdown (${locked[IDS[0]].spec.name} vs ${locked[IDS[1]].spec.name})`);
  runSimulation(round, seed);
  timers.countdown = setTimeout(tryStartFight, COUNTDOWN_MS);
}

function spawnSim(workerData, onDone, onFail) {
  const w = new Worker(path.join(__dirname, 'engine', 'worker.js'), { workerData, resourceLimits: { maxOldGenerationSizeMb: 512 } });
  let settled = false;
  w.once('message', (msg) => {
    if (settled) return;
    settled = true;
    if (!msg.ok) onFail(msg.error); else onDone(msg);
  });
  w.once('error', (e) => { if (!settled) { settled = true; onFail(e); } });
  w.once('exit', (code) => { if (!settled && code !== 0) { settled = true; onFail(`worker exited with code ${code}`); } });
  return w;
}

function runSimulation(round, seed) {
  if (worker) { try { worker.terminate(); } catch { /* ignore */ } }
  if (M()) return runModeSimulation(round, seed, M());
  const started = Date.now();
  const w = spawnSim({
    snapshots: IDS.map(id => locked[id].snapshot),
    ids: IDS, labels: IDS.map(id => BY_ID[id].label), seed, round,
    level: levelForRound(round),
    swapStart: round % 2 === 0, // alternate starting sides each round
    theme: state.theme,
    memories: IDS.map(id => readMemory(id)),
  }, (msg) => {
    if (worker !== w) return;
    worker = null;
    applyFreezeSetting(msg.replay);
    pending = { round, seed, replay: msg.replay, specs: msg.specs, sim: msg.sim, memories: msg.memories || null };
    log(`round ${round}: simulated in ${Date.now() - started} ms — ${msg.replay.frames.length} frames`);
    try {
      const dir = roundDir(round);
      comms.ensureDir(dir);
      comms.atomicWrite(path.join(dir, 'replay.json'), JSON.stringify(msg.replay));
      comms.atomicWrite(path.join(dir, 'sim.json'), JSON.stringify({ round, seed, specs: msg.specs, sim: msg.sim, memories: msg.memories || null }));
    } catch (e) { log('could not save replay', e); }
    tryStartFight();
  }, (err) => {
    if (worker !== w) return;
    worker = null;
    log('simulation failed:', err);
    feed('system', 'error', `The simulation crashed: ${String(err).split('\n')[0]}. Press FORCE START to retry.`);
    toast('error', 'Simulation crashed — press Force Start to retry');
    pending = null;
    clearTimers();
    setPhase('building', { countdownEndsAt: null });
  });
  worker = w;
}

function tryStartFight() {
  if (state.phase !== 'countdown' || !pending) return;
  if (Date.now() < state.countdownEndsAt - 50) return;
  const now = Date.now();
  // the replay's hit-stops hold playback still, so they add to the running time
  const cinematicMs = (pending.replay.cinematics || []).reduce((a, c) => a + (c.ms || 0), 0);
  const durationMs = pending.modeRound
    ? Math.round((Number(pending.replay.duration) || 0) * 1000)
    : Math.round((pending.replay.frames.length - 1) / RULES.tickRate * 1000) + cinematicMs;
  setPhase('fighting', { fightStartsAt: now, fightEndsAt: now + durationMs + OUTRO_MS });
  log(`round ${state.round}: FIGHT (${(durationMs / 1000).toFixed(1)}s)`);
  timers.fight = setTimeout(endFight, durationMs + OUTRO_MS);
}

function labelOf(id) { return BY_ID[id] ? BY_ID[id].label : id; }

function scoreText() {
  const [a, b] = IDS;
  return `${labelOf(a)} ${state.score[a]} - ${state.score[b]} ${labelOf(b)}${state.score.draws ? ` (${state.score.draws} draws)` : ''}`;
}

function endFight() {
  if (state.phase !== 'fighting' || !pending) return;
  if (pending.modeRound) return endModeRound();
  clearTimers();
  const { round, seed, replay, specs, sim, memories } = pending;
  const res = sim.result;
  // Brain memory for the next round of this match.
  const memoryNotes = IDS.map((id, i) => {
    const mem = memories ? memories[i] : null;
    try { writeMemory(id, round, mem); } catch (e) { log('could not save brain memory', id, e.message); }
    if (!mem) return null;
    if (mem.note) return mem.note;
    if (mem.json && mem.json !== '{}') return `${Buffer.byteLength(mem.json, 'utf8')} bytes saved — your brain starts next round with this \`memory\``;
    return null;
  });
  const arenaText = state.theme ? `${state.theme.name}${state.theme.blurb ? ` — ${state.theme.blurb}` : ''}` : null;
  const winnerId = res.winner === null ? null : IDS[res.winner];
  if (winnerId) state.score[winnerId]++; else state.score.draws++;
  const how = res.method === 'KO' ? `by KO at ${res.time}s` : res.method === 'DECISION' ? `on HP at time (${Math.round(res.hpPct[res.winner])}% vs ${Math.round(res.hpPct[1 - res.winner])}%)` : `(${res.method})`;
  state.lastResult = winnerId ? `${labelOf(winnerId)} won round ${round} ${how}` : `Round ${round} was a draw ${how}`;

  // Reports for both AIs (written now; delivered when the host decides).
  const labels = IDS.map(labelOf);
  const reportFiles = {};
  IDS.forEach((id, side) => {
    const rep = buildReport({ side, sim, specs, labels, round, kind: 'round', score: scoreText(), arena: arenaText, memoryNote: memoryNotes[side] });
    const dir = comms.paths.reports(id);
    comms.ensureDir(dir);
    const base = `m${state.matchNumber}-round-${round}`;
    comms.atomicWrite(path.join(dir, `${base}.md`), rep.text + '\n');
    comms.atomicWrite(path.join(dir, `${base}.json`), JSON.stringify(rep.json, null, 1));
    comms.atomicWrite(path.join(dir, 'latest.md'), rep.text + '\n');
    reportFiles[id] = { md: `fighters/${id}/reports/${base}.md`, json: `fighters/${id}/reports/${base}.json`, text: rep.text };
  });

  const activity = JSON.parse(JSON.stringify(state.activity || blankActivities()));
  const rec = {
    round, seed, level: levelForRound(round),
    theme: state.theme.id, themeName: state.theme.name,
    startedAt: state.fightStartsAt, endedAt: Date.now(),
    result: {
      winnerId, method: res.method, time: res.time,
      hpPct: Object.fromEntries(IDS.map((id, i) => [id, res.hpPct[i]])),
      hp: Object.fromEntries(IDS.map((id, i) => [id, res.hp[i]])),
      maxHp: Object.fromEntries(IDS.map((id, i) => [id, res.maxHp[i]])),
    },
    text: state.lastResult,
    prediction: state.prediction || null,
    activity,
    clockLimitMs: state.clock ? state.clock.limitMs + state.clock.bonusMs : 0,
    fighters: Object.fromEntries(IDS.map((id, i) => [id, {
      name: specs[i].name, title: specs[i].title, catchphrase: specs[i].catchphrase, colors: specs[i].colors,
      stats: specs[i].stats, derived: specs[i].derived, notes: specs[i].notes, traits: specs[i].traits,
      weapon: specs[i].weapon ? { id: specs[i].weapon.id, name: specs[i].weapon.name, kind: specs[i].weapon.kind } : null,
      offhand: specs[i].offhand ? { id: specs[i].offhand.id, name: specs[i].offhand.name, kind: specs[i].offhand.kind } : null,
      stance: specs[i].stance || 'balanced',
      relics: specs[i].relics || [],
      godPowers: (specs[i].godPowers || []).map(g => g.id),
      ultimate: specs[i].ultIdx >= 0 ? { name: specs[i].abilities[specs[i].ultIdx].name, type: specs[i].abilities[specs[i].ultIdx].type } : null,
      awakening: specs[i].awakening || null,
      look: specs[i].look || null,
      abilities: specs[i].abilities.map(a => ({
        name: a.name, type: a.type, basic: !!a.basic, ultimate: !!a.ultimate, offhand: !!a.offhand, energy: a.energy, damage: a.damage, dps: a.dps, amount: a.amount,
        cooldown: a.cooldown, windup: a.windup, style: a.style, color: a.color,
      })),
      libFiles: locked[id] && locked[id].snapshot.lib ? Object.keys(locked[id].snapshot.lib).length : 0,
      memoryBytes: memories && memories[i] && memories[i].json ? Buffer.byteLength(memories[i].json, 'utf8') : 0,
      buildMs: state.fighters[id].buildMs, summary: replay.summary[i],
      brainErrors: sim.brainStats[i] ? sim.brainStats[i].errors : 0,
      brainLines: locked[id] ? lineCount(locked[id].snapshot.brain) : null,
      autoLocked: state.fighters[id].autoLocked || null,
      sprite: replay.fighters[i].sprite,
    }])),
    timeline: sim.timeline,
    reports: Object.fromEntries(IDS.map(id => [id, reportFiles[id].md])),
    decision: null,
  };
  match.rounds = match.rounds.filter(r => r.round !== round);
  match.rounds.push(rec);
  saveMatch();
  writeRoundCsv(rec);
  for (const id of IDS) prevLocked[id] = locked[id];
  state._reports = Object.fromEntries(IDS.map(id => [id, { md: reportFiles[id].md, json: reportFiles[id].json }]));
  const pred = state.prediction ? (state.prediction === winnerId ? ' — the host called it!' : ' — upset! The host picked the other side.') : '';
  feed('system', 'result', `${state.lastResult}. Score: ${scoreText()}${pred}`);
  log(state.lastResult);
  setPhase('round_over', {});
  broadcast('match', matchPublic());
  if (round >= FINAL_ROUND) {
    feed('system', 'match', `That was the FINAL ROUND (${FINAL_ROUND} of ${FINAL_ROUND}) - the match ends now`);
    timers.final = setTimeout(() => endMatch('final round'), FINAL_RESULT_MS);
  }
}

// ── CSV results ──────────────────────────────────────────────────────────────
function writeRoundCsv(rec) {
  const ok = csv.append(path.join(comms.paths.results, 'rounds.csv'), csv.ROUND_COLUMNS, csv.roundRows(match, rec, FIGHTERS));
  if (!ok) csvLocked();
}

function writeMatchCsv() {
  const ok = csv.append(path.join(comms.paths.results, 'matches.csv'), csv.MATCH_COLUMNS, [csv.matchRow(match, state.score, FIGHTERS)]);
  if (!ok) csvLocked();
}

let csvWarned = 0;
function csvLocked() {
  if (Date.now() - csvWarned < 30000) return;
  csvWarned = Date.now();
  log('could not write results/*.csv (open in another program?) — will retry');
  toast('error', 'results CSV is open in another program — rows will be written when it closes');
}

// Fill results/*.csv from earlier matches the first time this version runs.
function backfillCsv() {
  const roundsFile = path.join(comms.paths.results, 'rounds.csv');
  if (fs.existsSync(roundsFile)) return;
  let dirs = [];
  try { dirs = fs.readdirSync(path.join(comms.DATA, 'matches')); } catch { return; }
  const matches = dirs.map(d => comms.readJson(path.join(comms.DATA, 'matches', d, 'match.json'), null)).filter(m => m && m.rounds && m.rounds.length);
  matches.sort((a, b) => (a.matchNumber || 0) - (b.matchNumber || 0) || (a.startedAt || 0) - (b.startedAt || 0));
  const hist = loadHistory();
  let n = 0;
  for (const m of matches) {
    if (m.mode && m.mode !== 'fighter') continue;   // other game modes log to results/<mode>-rounds.csv
    for (const r of m.rounds) { csv.append(roundsFile, csv.ROUND_COLUMNS, csv.roundRows(m, r, FIGHTERS)); n++; }
    const h = (hist.matches || []).find(x => x.matchId === m.matchId);
    if (h && m.endedAt) csv.append(path.join(comms.paths.results, 'matches.csv'), csv.MATCH_COLUMNS, [csv.matchRow(m, h.score, FIGHTERS)]);
  }
  if (n) log(`backfilled ${n} earlier round(s) into results/rounds.csv`);
}

function reportTextFor(id, round) {
  const r = match.rounds.find(x => x.round === round);
  if (!r) return null;
  try { return fs.readFileSync(path.join(comms.ROOT, r.reports[id]), 'utf8').trimEnd(); } catch { return null; }
}

function limitSecFor(round) {
  const s = state.settings || defaultSettings();
  return round === 1 ? s.firstRoundLimitSec : s.roundLimitSec;
}

function levelUpText(nextRound) {
  if (M()) return modeLevelUpText(M(), nextRound);
  const prev = levelInfo(levelForRound(nextRound - 1));
  const next = levelInfo(levelForRound(nextRound));
  const limit = limitSecFor(nextRound);
  const clockLine = limit ? `  TIME LIMIT: ${fmtMs(limit * 1000)} to evolve and lock in. The clock starts as soon as either AI starts working; when it hits 0:00 your current files are auto-locked (if they are valid). Check it any time: node arena.js time` : '  No time limit this round.';
  if (next.level === prev.level) {
    return [`You are at the max level (${next.level}): ${next.statPoints} stat points (max ${next.statMax} per stat), ${next.abilitySlots} ability slots, ${next.traitSlots} trait slots, power caps ${Math.round(next.power * 100)}%.`,
      'Re-spec anything you like - every choice is open.', clockLine];
  }
  const lines = [`LEVEL UP -> level ${next.level} of ${MAX_LEVEL}!${next.level >= FEATURE_UNLOCK.godPowers ? '  *** GODLY TIER ***' : ''}`];
  lines.push('  NEW AT THIS LEVEL:');
  for (const u of levelUnlocks(next.level)) lines.push(`   + ${u}`);
  lines.push(`  (ability slots ${next.abilitySlots}, trait slots ${next.traitSlots}, relic slots ${next.relicSlots}, godly power slots ${next.godSlots}; arena radius ${next.arenaRadius}; max damage per hit ${Math.round(300 * next.power)})`);
  if (prev.level === 1 && MIRROR) lines.push('  The mirror round is over: you may now change EVERYTHING - stats, weapon, traits, abilities, name and your look ("look" in fighter.json, or a hand-painted sprite.json).');
  lines.push('  See all options: node arena.js level  |  rules  |  weapons  |  traits  |  relics  |  powers  |  looks  |  arenas');
  lines.push(clockLine);
  return lines;
}

function nextRound() {
  if (state.phase !== 'round_over') return { ok: false, message: 'Next Round is only possible after a round has finished' };
  if (state.round >= finalRound()) { setImmediate(() => endMatch('final round')); return { ok: false, message: `Round ${finalRound()} was the final round - the match is over` }; }
  const round = state.round;
  const rec = match.rounds.find(r => r.round === round);
  if (rec) rec.decision = 'next';
  saveMatch();
  for (const id of IDS) {
    const rep = reportTextFor(id, round) || '(report missing)';
    const files = state._reports && state._reports[id];
    const text = [
      'STATUS: NEXT_ROUND',
      '='.repeat(72),
      round + 1 >= finalRound()
        ? `The host started ROUND ${round + 1} - the FINAL ROUND. After this fight the match is over. Evolve your fighter now and make it count.`
        : `The host started ROUND ${round + 1} of ${finalRound()}. Evolve ${M() ? 'your files' : 'your fighter'} now.`,
      ...(M() ? [] : [`  NEXT ARENA: ${themeForRound(round + 1, state.matchNumber).name} - ${themeForRound(round + 1, state.matchNumber).blurb} (layout: node arena.js arenas)`]),
      ...levelUpText(round + 1),
      '='.repeat(72),
      rep,
      '',
      limitSecFor(round + 1) ? 'WHAT TO DO NOW (the build clock is running - be quick and decisive)' : 'WHAT TO DO NOW (no time limit this round, but the host is waiting - stay focused)',
      ` 1. The report above is saved at ${files ? files.md : `fighters/${id}/reports/latest.md`}${files && files.json ? ` (full data: ${files.json})` : ''}.`,
      ` 2. PLAN TO WIN, not just to counter: your opponent is also evolving, so last round's ${M() ? 'plan' : 'fighter'} is already out of date.`,
      M() ? '    Start from your report: what decided the round, and what is YOUR win condition? Make that strong first.'
        : `    Start from THE DAMAGE RACE in your report: what is YOUR win condition (burst, sustained damage, sustain, control, outplaying with the brain)?`,
      `    Use this level's new unlocks aggressively - they are the biggest power jump. Counter-picks come second.`,
      `    Test broadly: node arena.js test ${id} all (every sparring bot) and node arena.js test ${id} previous (their last ${M() ? 'entry' : 'fighter'}) - aim to beat both.`,
      M() ? ` 3. Evolve fighters/${id}/ - ${M().designFile} and ${M().brainFile} (+ optional lib/*.js). The manual: ${M().guideFile}` : ` 3. Evolve fighters/${id}/ - fighter.json (stats, weapon, traits, abilities, look) and brain.js (+ optional lib/*.js).`,
      `    Whatever your brain left in \`memory\` at the end of this round is handed back to it next round.`,
      M() ? `    Keep notes.md updated: what you changed and why. Narrate: node arena.js say ${id} "..."` : `    Rewrite "notes" in fighter.json: what you changed and why. Narrate: node arena.js say ${id} "..."`,
      ` 4. Check + test: node arena.js check ${id}   and   node arena.js test ${id}`,
      ` 5. Lock in again: node arena.js ready ${id}   (it waits for the next result, like before)`,
    ].join('\n');
    notice(id, { matchId: state.matchId, round, kind: 'next_round', text: ascii(text) });
  }
  feed('system', 'round', `The host called NEXT ROUND — both AIs are evolving their fighters for round ${round + 1} (level ${levelForRound(round + 1)})`);
  startBuilding(round + 1);
  return { ok: true };
}

function startBuilding(round) {
  clearTimers();
  pending = null;
  for (const id of IDS) delete locked[id];
  state.round = round;
  state.fighters = Object.fromEntries(IDS.map(id => [id, blankFighterState()]));
  state.buildStartedAt = Date.now();
  state.countdownEndsAt = state.fightStartsAt = state.fightEndsAt = null;
  state.clock = newClock(round);
  state.activity = blankActivities();
  state.prediction = null;
  state.theme = themeForRound(round, state.matchNumber);
  delete state._reports;
  setPhase('building', {});
  for (const id of IDS) refreshLive(id, { force: true, silent: true });
}

function endMatch(reason) {
  if (state.phase === 'match_over') return { ok: false, message: 'The match is already over' };
  clearTimers();
  if (worker) { try { worker.terminate(); } catch { /* ignore */ } worker = null; }
  const round = state.round;
  const rec = match.rounds.find(r => r.round === round);
  if (rec && state.phase === 'round_over') rec.decision = 'end';
  const finished = match.rounds.length;
  for (const id of IDS) {
    const why = reason === 'final round' ? `Round ${finalRound()} was the final round - the match is over.` : 'The host ended the match.';
    const lines = ['STATUS: MATCH_OVER', '='.repeat(72), `${why} Final score: ${scoreText()} after ${finished} round${finished === 1 ? '' : 's'}.`, '='.repeat(72)];
    if (state.phase === 'round_over') {
      const rep = reportTextFor(id, round);
      if (rep) lines.push(rep, '');
    }
    lines.push('Stop here - do not edit your fighter any more. Give the human a short, honest summary of how the match went for you.');
    notice(id, { matchId: state.matchId, round, kind: 'match_over', text: ascii(lines.join('\n')) });
  }
  match.endedAt = Date.now();
  match.finalScore = Object.assign({}, state.score);
  saveMatch();
  // A match that never fought a round (e.g. New match pressed twice) isn't a result.
  if (match.rounds.length) { appendHistory(); writeMatchCsv(); }
  feed('system', 'match', `MATCH OVER — ${scoreText()}${reason ? ` (${reason})` : ''}`);
  pending = null;
  setPhase('match_over', {});
  broadcast('match', matchPublic());
  return { ok: true };
}

function appendHistory() {
  const h = loadHistory();
  h.matches = (h.matches || []).filter(m => m.matchId !== match.matchId);
  const [a, b] = IDS;
  const sa = state.score[a], sb = state.score[b];
  h.matches.push({
    matchId: match.matchId, matchNumber: match.matchNumber, mode: state.mode || 'fighter', startedAt: match.startedAt, endedAt: match.endedAt,
    fighters: FIGHTERS.map(f => ({ id: f.id, label: f.label })),
    score: Object.assign({}, state.score),
    winnerId: sa === sb ? null : sa > sb ? a : b,
    rounds: match.rounds.map(r => ({
      round: r.round, winnerId: r.result.winnerId, method: r.result.method, time: r.result.time, hpPct: r.result.hpPct,
      names: Object.fromEntries(IDS.map(id => [id, r.fighters[id].name])),
      dealt: Object.fromEntries(IDS.map(id => [id, (r.fighters[id].summary || {}).dealt ?? null])),
      biggestHit: Object.fromEntries(IDS.map(id => [id, (r.fighters[id].summary || {}).biggestHit ?? null])),
      accuracy: Object.fromEntries(IDS.map(id => [id, (r.fighters[id].summary || {}).accuracy ?? null])),
      codingMs: Object.fromEntries(IDS.map(id => [id, r.activity && r.activity[id] ? r.activity[id].codingMs : null])),
      prediction: r.prediction || null,
    })),
  });
  comms.atomicWrite(comms.paths.history, JSON.stringify(h, null, 1));
}

function newMatch(body) {
  const want = body && typeof body.mode === 'string' && body.mode ? body.mode : (state.mode || 'fighter');
  if (want !== 'fighter' && !modes.get(want)) return { ok: false, message: `Unknown or broken game mode "${want}"` };
  if (state.phase !== 'match_over') endMatch('host started a new match');
  saveFeeds();
  // Next number after the last match that was actually fought (empty ones are reused).
  const number = (loadHistory().matches || []).reduce((mx, m) => Math.max(mx, m.matchNumber || 0), 0) + 1;
  clearTimers();
  pending = null;
  for (const id of IDS) { delete locked[id]; delete prevLocked[id]; }
  const settings = state.settings;
  state = freshState(number, settings, want);
  match = freshMatch(state);
  comms.ensureDir(matchDir());
  saveMatch();
  feeds = { system: [] };
  for (const id of IDS) feeds[id] = [];
  feedsDirty = true;
  for (const id of IDS) installStarter(id, `match ${number}`);
  saveState();
  for (const id of IDS) { live[id].sig = null; refreshLive(id, { silent: true }); }
  feed('system', 'match', `MATCH ${number} started — ${modeLabel()}${M() ? ': both AIs begin with the same starter files' : ': both AIs begin with the identical Rookie starter'}`);
  writePromptFiles();
  broadcastAll();
  return { ok: true };
}

function forceStart() {
  if (state.phase !== 'building') return { ok: false, message: 'Force Start only works while the AIs are building' };
  const problems = [];
  for (const id of IDS) {
    if (state.fighters[id].ready && locked[id]) continue;
    if (M()) {
      const m = M();
      const mb = modes.readBundle(comms.paths.fighterDir(id), m);
      const mc = modes.safeCheck(m, mb, curLevel());
      if (!mc.ok) { problems.push(`${labelOf(id)}: ${mc.errors[0]}`); continue; }
      lockFighter(id, modes.snapshotOf(mb), modeSpec(mc), null, 'host');
      continue;
    }
    const bundle = readBundle(comms.paths.fighterDir(id));
    const check = fullCheck(bundle, { level: curLevel(), mirror: MIRROR });
    if (!check.ok) { problems.push(`${labelOf(id)}: ${check.errors[0]}`); continue; }
    lockFighter(id, snapshotOf(bundle), check.spec, bundle.sprite, 'host');
  }
  if (problems.length) return { ok: false, message: `Can't start: ${problems.join(' | ')}` };
  maybeStartCountdown();
  return { ok: true };
}

// ── host controls: clock, settings, predictions ──────────────────────────────
function clockAction(kind) {
  if (state.phase !== 'building') return { ok: false, message: 'The build clock only runs while the AIs are building' };
  const c = state.clock;
  if (!c.limitMs) return { ok: false, message: 'No time limit is set for this round (Settings)' };
  if (c.expired) return { ok: false, message: 'Time already ran out this round' };
  const now = Date.now();
  if (kind === 'start') {
    if (c.startedAt) return { ok: false, message: 'The clock is already running' };
    startClock('started by the host');
  } else if (kind === 'pause') {
    if (!c.startedAt || c.pausedAt) return { ok: false, message: 'The clock is not running' };
    c.pausedAt = now;
    feed('system', 'clock', '⏸ The host paused the build clock');
  } else if (kind === 'resume') {
    if (!c.pausedAt) return { ok: false, message: 'The clock is not paused' };
    c.pausedMs += now - c.pausedAt;
    c.pausedAt = null;
    feed('system', 'clock', '▶ The host resumed the build clock');
  } else if (kind === 'add') {
    c.bonusMs += 60000;
    c.warned = {};
    feed('system', 'clock', '⏱ The host added 1 minute to the build clock');
  }
  saveState();
  broadcastState();
  return { ok: true };
}

function updateSettings(body) {
  const s = Object.assign({}, state.settings || defaultSettings());
  const clean = (v) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n >= 0 && n <= 7200 ? n : null;
  };
  if (body.firstRoundLimitSec !== undefined) { const v = clean(body.firstRoundLimitSec); if (v === null) return { ok: false, message: 'bad first-round limit' }; s.firstRoundLimitSec = v; }
  if (body.roundLimitSec !== undefined) { const v = clean(body.roundLimitSec); if (v === null) return { ok: false, message: 'bad round limit' }; s.roundLimitSec = v; }
  if (body.impactFreeze !== undefined) {
    s.impactFreeze = !!body.impactFreeze;
    state.settings = s;
    feed('system', 'clock', `⚙ Impact freezes ${s.impactFreeze ? 'on' : 'off'}`);
    saveState();
    broadcastState();
    return { ok: true };
  }
  state.settings = s;
  // Apply to the current build phase if its clock hasn't run out.
  if (state.phase === 'building' && state.clock && !state.clock.expired) {
    const limitMs = limitSecFor(state.round) * 1000;
    state.clock.limitMs = limitMs;
    if (!limitMs) { state.clock.startedAt = null; state.clock.pausedAt = null; }
    state.clock.warned = {};
  }
  feed('system', 'clock', `⚙ Time limits: round 1 ${s.firstRoundLimitSec ? fmtMs(s.firstRoundLimitSec * 1000) : 'none'}, later rounds ${s.roundLimitSec ? fmtMs(s.roundLimitSec * 1000) : 'none'}`);
  saveState();
  broadcastState();
  return { ok: true };
}

function predict(body) {
  if (!['building', 'countdown'].includes(state.phase)) return { ok: false, message: 'Predictions close when the fight starts' };
  const id = body && body.id;
  if (id !== null && !IDS.includes(id)) return { ok: false, message: 'unknown fighter' };
  state.prediction = id || null;
  saveState();
  broadcastState();
  return { ok: true };
}

// ── exhibition matches (bots or current fighters, for fun while waiting) ─────
const exhibitions = new Map(); // id -> replay
let exhibitionBusy = false;

function resolveEntrant(key, level) {
  const [kind, name] = String(key || '').split(':');
  if (kind === 'bot' && BOTS[name]) {
    const b = loadBot(name, level);
    return { bundle: b, label: 'Bot', id: `bot-${name}` };
  }
  if (kind === 'ai' && IDS.includes(name)) {
    const b = readBundle(comms.paths.fighterDir(name));
    const c = checkBundle(b, { level });
    if (!c.ok) throw new Error(`${labelOf(name)}'s current fighter is not valid right now: ${c.errors[0]}`);
    return { bundle: b, label: labelOf(name), id: name };
  }
  throw new Error(`unknown fighter "${key}"`);
}

function startExhibition(body, done) {
  if (M()) return done({ ok: false, message: 'Exhibitions are only available in the Fighter Duel mode' });
  if (exhibitionBusy) return done({ ok: false, message: 'An exhibition is already being simulated' });
  const level = Math.max(1, Math.min(MAX_LEVEL, Number(body.level) || curLevel()));
  let a, b;
  try { a = resolveEntrant(body.a, level); b = resolveEntrant(body.b, level); } catch (e) { return done({ ok: false, message: e.message }); }
  exhibitionBusy = true;
  // godly levels are fought in the Celestial Throne; otherwise any regular arena
  const regular = THEMES.filter(t => !t.godly);
  const theme = level >= 10 ? (themesMod.godlyThemeForLevel ? themesMod.godlyThemeForLevel(level) : themeById('celestial')) : (body.theme && themeById(body.theme)) || regular[Math.floor(Math.random() * regular.length)];
  const seed = Number.isInteger(body.seed) ? body.seed >>> 0 : crypto.randomBytes(4).readUInt32LE(0);
  spawnSim({
    snapshots: [snapshotOf(a.bundle), snapshotOf(b.bundle)],
    ids: [a.id, b.id], labels: [a.label, b.label], seed, round: 0,
    level, kind: 'exhibition', theme,
  }, (msg) => {
    exhibitionBusy = false;
    applyFreezeSetting(msg.replay);
    const id = crypto.randomBytes(4).toString('hex');
    exhibitions.set(id, msg.replay);
    while (exhibitions.size > 6) exhibitions.delete(exhibitions.keys().next().value);
    feed('system', 'round', `🎮 Exhibition: ${msg.replay.fighters[0].name} vs ${msg.replay.fighters[1].name} (level ${level})`);
    done({ ok: true, id });
  }, (err) => {
    exhibitionBusy = false;
    done({ ok: false, message: `exhibition failed: ${String(err).split('\n')[0]}` });
  });
}

// ═════════════════════════════════════════════════════════════════════════════
//  SSE + HTTP
// ═════════════════════════════════════════════════════════════════════════════

const clients = new Set();

function send(res, type, data) {
  res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}

function broadcast(type, data) {
  for (const res of clients) {
    try { send(res, type, data); } catch { clients.delete(res); }
  }
}

function publicState() {
  const s = Object.assign({}, state);
  delete s._reports;
  s.level = curLevel();
  s.clockInfo = clockView();
  s.serverTime = Date.now();
  return s;
}

function broadcastState() { broadcast('state', publicState()); }

function toast(level, text) { broadcast('toast', { level, text }); }

function matchPublic() {
  return {
    matchId: match.matchId, matchNumber: match.matchNumber, mode: match.mode || state.mode || 'fighter', startedAt: match.startedAt, endedAt: match.endedAt,
    rounds: match.rounds, finalScore: match.finalScore || null,
  };
}

function bootstrap() {
  return {
    serverTime: Date.now(),
    config: { fighters: FIGHTERS, port: PORT, mirrorFirstRound: MIRROR, finalRound: finalRound() },
    modes: modes.list(),
    mode: modeBootstrap(),
    rules: {
      version: RULES.version,
      tickRate: RULES.tickRate, roundTime: RULES.roundTime, arenaRadius: RULES.arenaRadius, ring: RULES.ring,
      fighterRadius: RULES.fighterRadius, statPoints: RULES.statPoints, statMax: RULES.statMax, maxAbilities: RULES.maxAbilities,
      maxLevel: MAX_LEVEL, traits: TRAITS,
      levels: Object.fromEntries(Object.entries(LEVELS).map(([l, v]) => [l, Object.assign({}, v, { unlocks: levelUnlocks(Number(l)), arena: arenaFor(Number(l)) })])),
      typeUnlock: TYPE_UNLOCK, statUnlock: STAT_UNLOCK, featureUnlock: FEATURE_UNLOCK,
      stances: STANCES, relics: RELICS,
      godPowers: godPowersCatalog(),
      statKeys: STAT_KEYS, statInfo: STAT_INFO,
      weapons: WEAPON_IDS.map(id => Object.assign(weaponInfo(id, MAX_LEVEL), { attack: weaponAttack(id, MAX_LEVEL, 0) })),
      abilityTypes: ABILITY_TYPES, typeInfo: TYPE_BLURB,
      effectKeys: EFFECT_KEYS, effectInfo: EFFECT_INFO, buffStats: BUFF_STATS,
      critMult: RULES.critMult, maxTraps: RULES.maxTraps,
      looks: lookCatalogSafe(),
      countdownMs: COUNTDOWN_MS, outroMs: OUTRO_MS,
    },
    bots: BOT_NAMES.map(n => ({ id: n, desc: BOTS[n] })),
    themes: THEMES,
    state: publicState(),
    cards: Object.fromEntries(IDS.map(id => [id, live[id].card || buildCard(id)])),
    feeds,
    presence,
    tests,
    match: matchPublic(),
    prompts: prompts(),
  };
}

function broadcastAll() { broadcast('bootstrap', bootstrap()); }

// The godly powers (engine/powers.js), for the UI.
function godPowersCatalog() {
  const P = powers();
  if (!P || !P.GOD_POWERS) return {};
  return Object.fromEntries(Object.entries(P.GOD_POWERS).map(([id, g]) => [id, { id, name: g.name, blurb: g.blurb, color: g.color, element: g.element, cast: g.cast, target: g.target }]));
}

// Every look option (engine/look.js), for the UI's fighter pages.
let lookCatalogCache;
function lookCatalogSafe() {
  if (lookCatalogCache !== undefined) return lookCatalogCache;
  try { lookCatalogCache = require('./engine/look').lookCatalog(); } catch { lookCatalogCache = null; }
  return lookCatalogCache;
}

function prompts() {
  if (M()) return modePrompts(M());
  const s = state ? state.settings : defaultSettings();
  const lim = (sec) => (sec ? fmtMs(sec * 1000) : 'no limit');
  const out = {};
  for (const f of FIGHTERS) {
    const other = FIGHTERS.find(x => x.id !== f.id);
    out[f.id] = [
      `You are competing in AI FIGHT, a live pixel-art arena where two AIs each control and evolve a fighter while a human watches on a big screen.`,
      `You are the fighter "${f.id}". Your opponent is another AI (${other.label}) doing the same thing at the same time.`,
      ``,
      `Your working directory is the AI Fight project. Do this:`,
      `1. Read AI_GUIDE.md completely. It explains the rules, the files you edit, leveling, and the round loop.`,
      `2. Your fighter lives in fighters/${f.id}/: fighter.json (name, weapon, stats, traits, abilities, look) and brain.js (+ optional lib/*.js modules). Every match starts with both AIs holding the identical "Rookie" starter:${MIRROR ? ' round 1 is a mirror match where ONLY your brain.js/lib (fighting logic), names, colours and text may change.' : ''} The match is ${FINAL_ROUND} rounds. From round 2 you level up every round (up to level ${MAX_LEVEL}) and can evolve everything - stats, weapon, traits, abilities and your pixel-art look - while new systems unlock: stances, an ultimate, relics, an off-hand weapon, awakening and finally godly powers.`,
      `   Spectators watch every save live, so narrate as you go: node arena.js say ${f.id} "..."`,
      `3. THERE IS A BUILD TIME LIMIT (round 1: ${lim(s.firstRoundLimitSec)}, later rounds: ${lim(s.roundLimitSec)}). Every round the clock starts as soon as either AI starts working, so get going right away. Every arena command shows the time left (or run: node arena.js time ${f.id}). When it hits 0:00 your current files are auto-locked if valid, so work fast: decide quickly, keep your fighter valid at all times, and lock in before time runs out.`,
      `4. Check and test: node arena.js check ${f.id}  and  node arena.js test ${f.id}`,
      `5. When you're happy, lock in: node arena.js ready ${f.id}`,
      `   That command WAITS for the fight and for the human's decision. Run it (and "node arena.js wait ${f.id}") with the longest timeout your shell tool allows (e.g. 600000 ms). Whenever it prints STATUS: STILL_WAITING or your shell times out, immediately run: node arena.js wait ${f.id}`,
      `6. STATUS: NEXT_ROUND means the human wants another round: read the report, evolve your fighter, test, and ready again (the clock is running again).`,
      `   STATUS: MATCH_OVER means stop and give a short summary.`,
      ``,
      `Rules: only create or edit files inside fighters/${f.id}/. Never read or modify fighters/${other.id}/, the engine, arena.js, server.js or data/.`,
      `Every match is a fresh start: do not look for, restore or reuse anything from earlier matches (old brains, lab files, notes, reports, or strategies remembered from another session). Build this match's fighter during this match. Play to win.`,
    ].join('\n');
  }
  return out;
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.csv': 'text/csv; charset=utf-8',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
};

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function sendFile(res, file, type, extraHeaders, req) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found'); return; }
    const ext = path.extname(file).toLowerCase();
    const headers = Object.assign({
      'Content-Type': type || MIME[ext] || 'application/octet-stream',
      // audio never changes: let the browser keep it (the music loops)
      'Cache-Control': MIME[ext] && MIME[ext].startsWith('audio/') ? 'public, max-age=86400' : 'no-store',
      'Accept-Ranges': 'bytes',
    }, extraHeaders || {});
    // Range requests (audio/video elements stream and seek with these).
    const m = req && req.headers.range ? /^bytes=(\d*)-(\d*)$/.exec(req.headers.range) : null;
    if (m && (m[1] || m[2])) {
      let start, end;
      if (m[1]) { start = Number(m[1]); end = m[2] ? Math.min(Number(m[2]), st.size - 1) : st.size - 1; }
      else { start = Math.max(0, st.size - Number(m[2])); end = st.size - 1; }
      if (start > end || start >= st.size) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); res.end(); return; }
      res.writeHead(206, Object.assign(headers, { 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 }));
      fs.createReadStream(file, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, Object.assign(headers, { 'Content-Length': st.size }));
    fs.createReadStream(file).pipe(res);
  });
}

function originOk(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin);
}

function readBody(req, cb) {
  let data = '';
  req.on('data', (c) => { data += c; if (data.length > 1e5) req.destroy(); });
  req.on('end', () => { let body = {}; try { body = data ? JSON.parse(data) : {}; } catch { body = {}; } cb(body); });
}

const HOST_ACTIONS = {
  next: () => nextRound(),
  end: () => endMatch(),
  'force-start': () => forceStart(),
  'new-match': (body) => newMatch(body),
  'clock-start': () => clockAction('start'),
  'clock-pause': () => clockAction('pause'),
  'clock-resume': () => clockAction('resume'),
  'clock-add': () => clockAction('add'),
  settings: (body) => updateSettings(body),
  predict: (body) => predict(body),
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let p;
  try { p = decodeURIComponent(url.pathname); } catch { res.writeHead(400); res.end(); return; }

  if (p === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 1500\n\n');
    clients.add(res);
    send(res, 'bootstrap', bootstrap());
    req.on('close', () => clients.delete(res));
    return;
  }
  if (p === '/api/bootstrap') return sendJson(res, 200, bootstrap());
  if (p === '/api/replay/current') {
    if (!pending && !['round_over', 'match_over'].includes(state.phase)) return sendJson(res, 404, { error: 'no replay yet' });
    return sendFile(res, path.join(roundDir(pending ? pending.round : state.round), 'replay.json'), MIME['.json']);
  }
  let m;
  if ((m = /^\/api\/replay\/([\w-]+)\/(\d+)$/.exec(p))) return sendFile(res, path.join(comms.paths.matchDir(m[1]), `round-${m[2]}`, 'replay.json'), MIME['.json']);
  if ((m = /^\/api\/tests\/([\w-]+)$/.exec(p)) && IDS.includes(m[1])) return sendFile(res, comms.paths.tests(m[1]), MIME['.json']);
  if ((m = /^\/api\/exhibition\/([0-9a-f]+)$/.exec(p))) {
    const rep = exhibitions.get(m[1]);
    return rep ? sendJson(res, 200, rep) : sendJson(res, 404, { error: 'exhibition expired' });
  }
  if (p === '/api/exhibition' && req.method === 'POST') {
    if (!originOk(req)) return sendJson(res, 403, { error: 'bad origin' });
    return readBody(req, (body) => startExhibition(body, (r) => sendJson(res, r.ok ? 200 : 409, r)));
  }
  if ((m = /^\/api\/csv\/(rounds|matches|[a-z][\w]*-rounds)$/.exec(p))) {
    return sendFile(res, path.join(comms.paths.results, `${m[1]}.csv`), MIME['.csv'], { 'Content-Disposition': `attachment; filename="ai-fight-${m[1]}.csv"` });
  }
  if (p === '/api/match') return sendJson(res, 200, matchPublic());
  if ((m = /^\/api\/match\/([\w-]+)$/.exec(p))) {
    const rec = comms.readJson(path.join(comms.paths.matchDir(m[1]), 'match.json'), null);
    return rec ? sendJson(res, 200, rec) : sendJson(res, 404, { error: 'no such match' });
  }
  if (p === '/api/history') return sendJson(res, 200, loadHistory());
  if ((m = /^\/api\/host\/([\w-]+)$/.exec(p))) {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST only' });
    if (!originOk(req)) return sendJson(res, 403, { error: 'bad origin' });
    const fn = HOST_ACTIONS[m[1]];
    if (!fn) return sendJson(res, 404, { error: 'unknown action' });
    return readBody(req, (body) => {
      let result;
      try { result = fn(body); } catch (e) { log('host action failed', e); result = { ok: false, message: e.message }; }
      sendJson(res, result.ok ? 200 : 409, result);
    });
  }

  // Static files
  const rel = p === '/' ? '/index.html' : p;
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); res.end(); return; }
  sendFile(res, file, null, null, req);
});

// ═════════════════════════════════════════════════════════════════════════════
//  Boot
// ═════════════════════════════════════════════════════════════════════════════

function lockedFromSnapshot(snap, round) {
  const bundle = bundleFromSnapshot(snap);
  const c = checkBundle(bundle, { level: levelForRound(round) });
  return { snapshot: snap, spec: c.spec, sprite: bundle.sprite, round, at: 0 };
}

function restore() {
  const saved = comms.readJson(comms.paths.state, null);
  if (saved && saved.v === 2 && Array.isArray(saved.ids) && saved.ids.join() === IDS.join()) {
    state = saved;
    state.serverPid = process.pid;
    // Fields added in later versions.
    state.settings = state.settings || defaultSettings();
    state.clock = state.clock || newClock(state.round, state.settings);
    state.clock.warned = state.clock.warned || {};
    state.activity = state.activity || blankActivities();
    for (const id of IDS) state.activity[id] = state.activity[id] || blankActivity();
    state.mode = state.mode || 'fighter';
    if (state.mode !== 'fighter' && !modes.get(state.mode)) log(`WARNING: this match's game mode "${state.mode}" could not be loaded`);
    state.theme = state.theme || themeForRound(state.round, state.matchNumber);
    if (state.prediction === undefined) state.prediction = null;
    match = comms.readJson(path.join(matchDir(), 'match.json'), null) || freshMatch(state);
    const f = comms.readJson(path.join(matchDir(), 'feeds.json'), null);
    if (f && f.matchId === state.matchId && f.feeds) { feeds = f.feeds; feedSeq = f.feedSeq || 0; for (const id of IDS) feeds[id] = feeds[id] || []; feeds.system = feeds.system || []; }
    // The most recently *fought* locked fighters (for "what changed" diffs).
    for (const id of IDS) {
      const prevRound = ['round_over', 'match_over'].includes(state.phase) ? state.round : state.round - 1;
      const snap = prevRound >= 1 ? (M() ? modes.readSnapshot(path.join(roundDir(prevRound), id)) : readSnapshot(path.join(roundDir(prevRound), id))) : null;
      if (snap) prevLocked[id] = M() ? modeLockedFromSnapshot(snap, prevRound) : lockedFromSnapshot(snap, prevRound);
    }
    // Fighters locked for the current round.
    for (const id of IDS) {
      if (!state.fighters[id] || !state.fighters[id].ready) continue;
      const snap = M() ? modes.readSnapshot(path.join(roundDir(state.round), id)) : readSnapshot(path.join(roundDir(state.round), id));
      if (snap) {
        locked[id] = M() ? modeLockedFromSnapshot(snap, state.round) : lockedFromSnapshot(snap, state.round);
        locked[id].at = state.fighters[id].readyAt;
      } else state.fighters[id] = blankFighterState();
    }
    if (state.phase === 'countdown' || state.phase === 'fighting') {
      const saved2 = comms.readJson(path.join(roundDir(state.round), 'sim.json'), null);
      const replay = comms.readJson(path.join(roundDir(state.round), 'replay.json'), null);
      if (saved2 && replay && state.phase === 'fighting' && state.fightEndsAt) {
        pending = saved2.modeRound ? Object.assign({}, saved2, { replay }) : { round: saved2.round, seed: saved2.seed, specs: saved2.specs, sim: saved2.sim, replay, memories: saved2.memories || null };
        const left = state.fightEndsAt - Date.now();
        if (left > 0) timers.fight = setTimeout(endFight, left);
        else setImmediate(endFight);
      } else if (IDS.every(id => locked[id])) {
        setImmediate(startCountdown);
      } else {
        state.phase = 'building';
      }
    }
    if (state.phase === 'round_over' && state.round >= finalRound()) timers.final = setTimeout(() => endMatch('final round'), 3000);
    log(`restored match ${state.matchNumber} (${state.matchId}), round ${state.round}, phase ${state.phase}`);
  } else {
    const prev = loadHistory();
    const number = (prev.matches || []).reduce((mx, m) => Math.max(mx, m.matchNumber || 0), 0) + 1;
    state = freshState(number);
    match = freshMatch(state);
    comms.ensureDir(matchDir());
    saveMatch();
    for (const id of IDS) installStarter(id, `match ${number}`);
    feed('system', 'match', `MATCH ${number} started — both AIs begin with the identical Rookie starter`);
    log(`new match ${number} (${state.matchId})`);
  }
  saveState();
  for (const id of IDS) refreshLive(id, { silent: true });
}

function writePromptFiles() {
  const dir = path.join(comms.ROOT, 'prompts');
  comms.ensureDir(dir);
  const all = prompts();
  for (const f of FIGHTERS) {
    try { comms.atomicWrite(path.join(dir, `${f.id}.txt`), all[f.id] + '\n'); } catch { /* ignore */ }
  }
}

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).unref(); } catch { /* ignore */ }
}

let tickN = 0;
function startLoops() {
setInterval(() => {
  tickN++;
  try { processOutboxes(); } catch (e) { log('outbox error', e); }
  if (tickN % 2 === 0) for (const id of IDS) { try { refreshLive(id); } catch (e) { log('watch error', id, e); } }
  try { checkClock(); } catch (e) { log('clock error', e); }
  if (state.phase === 'countdown') tryStartFight();
  if (state.phase === 'fighting' && state.fightEndsAt && Date.now() > state.fightEndsAt + 1500) endFight();
}, 300);
setInterval(() => { try { pollPresence(); } catch { /* ignore */ } }, 1000);
setInterval(() => {
  try { saveState(); saveFeeds(); } catch (e) { log('save error', e); }
  if (csv.hasPending()) csv.retryPending(comms.paths.results);
}, 2000);
setInterval(() => { for (const res of clients) { try { res.write(': ping\n\n'); } catch { clients.delete(res); } } }, 15000);
}

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\nPort ${PORT} is already in use — is AI Fight already running? Open http://localhost:${PORT}\n(or pick another port in config.json)\n`);
    process.exit(1);
  }
  throw e;
});

// Listen first: if another copy is already running we must not touch its state.
server.listen(PORT, '127.0.0.1', () => {
  restore();
  try { backfillCsv(); } catch (e) { log('csv backfill failed', e.message); }
  writePromptFiles();
  startLoops();
  const url = `http://localhost:${PORT}`;
  console.log('');
  console.log('  +------------------------------------------------------+');
  console.log('  |                 AI FIGHT  -  arena open               |');
  console.log('  +------------------------------------------------------+');
  console.log(`   Spectator screen:  ${url}`);
  console.log(`   Fighters:          ${FIGHTERS.map(f => `${f.label} -> fighters/${f.id}/`).join('   ')}`);
  console.log(`   Build time limit:  round 1 ${state.settings.firstRoundLimitSec ? fmtMs(state.settings.firstRoundLimitSec * 1000) : 'none'}, later rounds ${state.settings.roundLimitSec ? fmtMs(state.settings.roundLimitSec * 1000) : 'none'} (change in the page's Settings)`);
  console.log('   Results log:       results/rounds.csv, results/matches.csv');
  console.log('   Paste the prompts from the "Setup & prompts" panel (or prompts/*.txt) into each AI.');
  console.log('   Ctrl+C to stop.\n');
  if (process.argv.includes('--open')) openBrowser(url);
});

function shutdown() {
  try { if (state) { saveState(); saveFeeds(); } } catch { /* ignore */ }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
