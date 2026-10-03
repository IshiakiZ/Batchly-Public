'use strict';
// Game-mode registry + the file plumbing every non-fighter mode shares (see README.md).
// The fighter mode is built into server.js / arena.js; other modes live in engine/modes/<id>/.

const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const LIB_DIR = 'lib';
const MAX_FILE = 400 * 1024;     // a design / brain file larger than this is refused
const MAX_LIB_FILES = 24;

const cache = {};
/** The adapter of a mode (null for 'fighter' or an unknown / broken mode). */
function get(id) {
  if (!id || id === 'fighter') return null;
  if (cache[id] !== undefined) return cache[id];
  let m = null;
  try {
    const file = path.join(DIR, id, 'index.js');
    if (/^[a-z][\w-]*$/.test(id) && fs.existsSync(file)) m = require(file);
  } catch (e) {
    console.error(`[modes] could not load mode "${id}": ${e && e.stack ? e.stack : e}`);
    m = null;
  }
  cache[id] = m;
  return m;
}

/** Every mode the host can pick (the fighter mode first). */
function list({ includeHidden = false } = {}) {
  const out = [{ id: 'fighter', name: 'Fighter Duel', tagline: 'Each AI builds and codes a pixel-art fighter. 12 rounds, one level per round, up to godly powers.', available: true }];
  let names = [];
  try { names = fs.readdirSync(DIR, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort(); } catch { names = []; }
  for (const id of names) {
    if (!fs.existsSync(path.join(DIR, id, 'index.js'))) continue;
    const m = get(id);
    if (!m) { out.push({ id, name: id, tagline: 'This mode failed to load (see the server log).', available: false }); continue; }
    if (m.hidden && !includeHidden) continue;
    out.push({ id, name: m.name || id, tagline: m.tagline || '', available: true, maxRounds: m.maxRounds || 12, hidden: !!m.hidden });
  }
  return out;
}

function readText(file) {
  try {
    const st = fs.statSync(file);
    if (!st.isFile()) return { exists: false };
    if (st.size > MAX_FILE) return { exists: true, size: st.size, mtimeMs: st.mtimeMs, tooBig: true, text: null };
    return { exists: true, size: st.size, mtimeMs: st.mtimeMs, text: fs.readFileSync(file, 'utf8').replace(/^﻿/, '') };
  } catch { return { exists: false }; }
}

/** Read an AI's working folder for a mode: { exists, files, design, brain, lib, notes, errors }. */
function readBundle(dir, mode) {
  const files = {};
  const errors = [];
  const d = readText(path.join(dir, mode.designFile));
  const b = readText(path.join(dir, mode.brainFile));
  const n = readText(path.join(dir, 'notes.md'));
  files[mode.designFile] = { exists: !!d.exists, size: d.size || 0, mtimeMs: d.mtimeMs || 0 };
  files[mode.brainFile] = { exists: !!b.exists, size: b.size || 0, mtimeMs: b.mtimeMs || 0 };
  if (d.tooBig) errors.push(`${mode.designFile} is larger than ${MAX_FILE / 1024} KB`);
  if (b.tooBig) errors.push(`${mode.brainFile} is larger than ${MAX_FILE / 1024} KB`);
  let lib = null;
  try {
    const libDir = path.join(dir, LIB_DIR);
    if (fs.existsSync(libDir)) {
      const names = fs.readdirSync(libDir).filter(f => /^[\w.-]+\.js$/.test(f)).sort();
      if (names.length > MAX_LIB_FILES) errors.push(`lib/ has ${names.length} files (max ${MAX_LIB_FILES})`);
      for (const name of names.slice(0, MAX_LIB_FILES)) {
        const t = readText(path.join(libDir, name));
        if (t.exists && t.text !== null) { lib = lib || {}; lib[name] = t.text; }
        files[`lib/${name}`] = { exists: !!t.exists, size: t.size || 0, mtimeMs: t.mtimeMs || 0 };
      }
    }
  } catch { /* no lib */ }
  return {
    mode: mode.id,
    exists: !!(d.exists || b.exists),
    files,
    design: d.text !== undefined ? d.text : null,
    brain: b.text !== undefined ? b.text : null,
    lib,
    notes: n.text || null,
    readErrors: errors,
  };
}

/** What gets locked in / stored per round (plain JSON). */
function snapshotOf(bundle) {
  return { mode: bundle.mode, design: bundle.design, brain: bundle.brain, lib: bundle.lib || null, notes: bundle.notes || null };
}
function bundleFromSnapshot(snap) {
  return { mode: snap.mode, exists: true, files: {}, design: snap.design ?? null, brain: snap.brain ?? null, lib: snap.lib || null, notes: snap.notes || null, readErrors: [] };
}
function writeSnapshot(dir, snap, mode) {
  fs.mkdirSync(dir, { recursive: true });
  const w = (name, text) => { if (typeof text === 'string') fs.writeFileSync(path.join(dir, name), text); };
  w(mode.designFile, snap.design);
  w(mode.brainFile, snap.brain);
  w('notes.md', snap.notes);
  if (snap.lib && typeof snap.lib === 'object') {
    fs.mkdirSync(path.join(dir, LIB_DIR), { recursive: true });
    for (const [name, src] of Object.entries(snap.lib)) if (/^[\w.-]+\.js$/.test(name)) w(path.join(LIB_DIR, name), src);
  }
  fs.writeFileSync(path.join(dir, 'snapshot.json'), JSON.stringify(snap));
}
function readSnapshot(dir) {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(dir, 'snapshot.json'), 'utf8'));
    return s && typeof s === 'object' && s.mode ? s : null;
  } catch { return null; }
}

/** Run a mode's check without ever throwing. */
function safeCheck(mode, bundle, level) {
  try {
    const c = mode.check(bundle, { level }) || {};
    const errors = (bundle.readErrors || []).concat(Array.isArray(c.errors) ? c.errors : []);
    return {
      ok: !!c.ok && errors.length === 0, errors, warnings: Array.isArray(c.warnings) ? c.warnings : [],
      spec: c.spec || null, name: String(c.name || (c.spec && c.spec.name) || 'Unnamed').slice(0, 60),
      colors: c.colors || null, summary: c.summary || '', cardLines: Array.isArray(c.cardLines) ? c.cardLines.slice(0, 8) : [],
      text: c.text || '',
    };
  } catch (e) {
    return { ok: false, errors: [`the ${mode.name || mode.id} checker crashed: ${e && e.message}`], warnings: [], spec: null, name: 'Unnamed', colors: null, summary: '', cardLines: [], text: '' };
  }
}

module.exports = { get, list, readBundle, snapshotOf, bundleFromSnapshot, writeSnapshot, readSnapshot, safeCheck, LIB_DIR };
