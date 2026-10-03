'use strict';
// File-based messaging between the AI-facing CLI (arena.js) and the server.
// Using files instead of HTTP keeps it working inside sandboxed agents that
// can write to the project folder but may not be allowed to open sockets.
//
//   data/state.json          server → everyone   (phase, round, ready flags, heartbeat)
//   data/inbox/<id>.json     server → fighter    (acks + round notices)
//   data/outbox/<id>/*.json  fighter → server    (ready / say / test messages)
//   data/presence/<id>.json  fighter → server    ("I'm waiting" heartbeat)

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const FIGHTERS = path.join(ROOT, 'fighters');

const DEFAULT_CONFIG = {
  port: 3000,
  mirrorFirstRound: true, // round 1: both AIs use the identical starter fighter (only brains differ)
  firstRoundLimitSec: 360, // build time limit for round 1 (0 = no limit)
  roundLimitSec: 300,      // build time limit for later rounds (0 = no limit)
  fighters: [
    { id: 'claude', label: 'Claude', color: '#e8825c' },
    { id: 'chatgpt', label: 'ChatGPT', color: '#2fc58e' },
  ],
};

function loadConfig() {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8').replace(/^﻿/, '')); } catch { /* defaults */ }
  const out = Object.assign({}, DEFAULT_CONFIG, cfg);
  if (!Array.isArray(out.fighters) || out.fighters.length !== 2) out.fighters = DEFAULT_CONFIG.fighters;
  out.fighters = out.fighters.map((f, i) => {
    const def = DEFAULT_CONFIG.fighters[i];
    const id = String((f && f.id) || def.id).toLowerCase().replace(/[^a-z0-9_-]/g, '') || def.id;
    return { id, label: String((f && f.label) || id), color: /^#[0-9a-f]{6}$/i.test(f && f.color) ? f.color : def.color, side: i };
  });
  if (out.fighters[0].id === out.fighters[1].id) out.fighters[1].id += '2';
  if (process.env.AIFIGHT_PORT) out.port = Number(process.env.AIFIGHT_PORT);
  out.port = Number(out.port) || 3000;
  out.mirrorFirstRound = out.mirrorFirstRound !== false;
  const lim = (v, d) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.round(Number(v)) : d);
  out.firstRoundLimitSec = lim(out.firstRoundLimitSec, DEFAULT_CONFIG.firstRoundLimitSec);
  out.roundLimitSec = lim(out.roundLimitSec, DEFAULT_CONFIG.roundLimitSec);
  return out;
}

const paths = {
  root: ROOT,
  data: DATA,
  fighters: FIGHTERS,
  state: path.join(DATA, 'state.json'),
  history: path.join(DATA, 'history.json'),
  inbox: (id) => path.join(DATA, 'inbox', `${id}.json`),
  outbox: (id) => path.join(DATA, 'outbox', id),
  presence: (id) => path.join(DATA, 'presence', `${id}.json`),
  tests: (id) => path.join(DATA, 'tests', `${id}.json`),
  results: path.join(ROOT, 'results'),
  fighterDir: (id) => path.join(FIGHTERS, id),
  reports: (id) => path.join(FIGHTERS, id, 'reports'),
  matchDir: (matchId) => path.join(DATA, 'matches', matchId),
  // What a fighter's brain saved in s.memory at the end of its last round of the match.
  memory: (matchId, id) => path.join(DATA, 'matches', matchId, `memory-${id}.json`),
};

function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); }

function sleepSync(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* ignore */ }
}

const RETRY = new Set(['EPERM', 'EBUSY', 'EACCES', 'EEXIST']);

function atomicWrite(file, text) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, text);
  for (let i = 0; i < 25; i++) {
    try { fs.renameSync(tmp, file); return; } catch (e) {
      if (!RETRY.has(e.code)) { try { fs.unlinkSync(tmp); } catch { /* ignore */ } throw e; }
      sleepSync(20);
    }
  }
  try { fs.writeFileSync(file, text); } finally { try { fs.unlinkSync(tmp); } catch { /* ignore */ } }
}

function readJson(file, fallback = null) {
  for (let i = 0; i < 6; i++) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      if (e.code === 'ENOENT') return fallback;
      sleepSync(15);
    }
  }
  return fallback;
}

function removeFile(file) {
  for (let i = 0; i < 10; i++) {
    try { fs.unlinkSync(file); return true; } catch (e) {
      if (e.code === 'ENOENT') return true;
      if (!RETRY.has(e.code)) return false;
      sleepSync(15);
    }
  }
  return false;
}

/** Fighter → server message. Returns the nonce used to match the reply. */
function postToServer(id, type, payload = {}) {
  const nonce = crypto.randomBytes(6).toString('hex');
  const name = `${Date.now()}-${process.pid}-${nonce}-${type}.json`;
  atomicWrite(path.join(paths.outbox(id), name), JSON.stringify(Object.assign({ type, nonce, at: Date.now(), fighter: id }, payload)));
  return nonce;
}

/** Server side: read + delete pending messages for one fighter, oldest first. */
function drainOutbox(id) {
  const dir = paths.outbox(id);
  let names;
  try { names = fs.readdirSync(dir).filter(n => n.endsWith('.json')).sort(); } catch { return []; }
  const out = [];
  for (const name of names) {
    const file = path.join(dir, name);
    let msg = null;
    try { msg = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { msg = null; }
    removeFile(file);
    if (msg) out.push(msg);
  }
  return out;
}

function serverAlive(state) {
  return !!(state && state.heartbeat && Date.now() - state.heartbeat < 8000);
}

module.exports = {
  ROOT, DATA, FIGHTERS, DEFAULT_CONFIG, loadConfig, paths, ensureDir, atomicWrite, readJson, removeFile,
  postToServer, drainOutbox, serverAlive, sleepSync,
};
