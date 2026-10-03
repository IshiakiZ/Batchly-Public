'use strict';
// Reads a fighter folder (fighter.json + brain.js + lib/*.js + sprite.json + notes.md)
// into a "bundle" and runs every static check we can do without fighting.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { RULES, validateFighter, mechanicsSignature, levelInfo, WEAPONS, DEFAULT_WEAPON } = require('./rules');

const FILES = ['fighter.json', 'brain.js', 'sprite.json', 'notes.md'];
// animation → [min frames, max frames]. "move" is accepted as an old name for "walk".
const SPRITE_FRAMES = { idle: [1, 6], walk: [0, 8], attack: [0, 6], cast: [0, 6], dash: [0, 3], hurt: [0, 3], ko: [0, 6], victory: [0, 6], block: [0, 3] };
const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function readText(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

function fileInfo(dir) {
  const info = {};
  for (const name of FILES) {
    try {
      const st = fs.statSync(path.join(dir, name));
      info[name] = { exists: true, size: st.size, mtimeMs: Math.floor(st.mtimeMs) };
    } catch {
      info[name] = { exists: false, size: 0, mtimeMs: 0 };
    }
  }
  return info;
}

/** lib/*.js files of a fighter folder → { "name.js": source } (+ size / mtime info). */
function readLib(dir) {
  const libDir = path.join(dir, 'lib');
  let names = [];
  try { names = fs.readdirSync(libDir).filter(n => n.endsWith('.js')).sort(); } catch { return { lib: null, info: {} }; }
  const lib = {};
  const info = {};
  for (const n of names.slice(0, RULES.libMaxFiles + 1)) {
    const src = readText(path.join(libDir, n));
    if (src === null) continue;
    lib[n] = src;
    try { const st = fs.statSync(path.join(libDir, n)); info[n] = { size: st.size, mtimeMs: Math.floor(st.mtimeMs) }; } catch { /* ignore */ }
  }
  return { lib: Object.keys(lib).length ? lib : null, info };
}

function parseJson(text, label = 'fighter.json') {
  const clean = String(text).replace(/^﻿/, '');
  try {
    return { value: JSON.parse(clean) };
  } catch (e) {
    let msg = e.message;
    const m = /position (\d+)/.exec(msg);
    if (m && !/line \d+/.test(msg)) {
      const pos = Number(m[1]);
      const before = clean.slice(0, pos);
      const line = before.split('\n').length;
      const col = pos - before.lastIndexOf('\n');
      msg += ` (line ${line}, column ${col})`;
    }
    return { error: `${label} is not valid JSON: ${msg}` };
  }
}

function normalizeHex(h) {
  const s = h.toLowerCase();
  return s.length === 4 ? `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}` : s;
}

function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

/** Validate an already-parsed sprite object. Returns { sprite|null, errors, warnings }. */
function checkSpriteObject(raw, label = 'sprite.json') {
  const errors = [];
  const warnings = [];
  if (!isObj(raw)) { errors.push(`${label} must contain an object with "palette" and "frames"`); return { sprite: null, errors, warnings }; }
  const N = RULES.spriteSize;

  const palette = {};
  if (!isObj(raw.palette)) errors.push(`${label} needs "palette": {"k": "#1a1c2c", "r": "#e94560", ...} (one-character keys; "." is always transparent)`);
  else {
    const keys = Object.keys(raw.palette);
    if (keys.length > RULES.spriteMaxColors) errors.push(`${label} palette has ${keys.length} colours (max ${RULES.spriteMaxColors})`);
    for (const k of keys) {
      if (k.length !== 1 || k === '.' || /\s/.test(k)) { errors.push(`${label} palette key ${JSON.stringify(k)} must be exactly one character (not "." or a space)`); continue; }
      const v = raw.palette[k];
      if (typeof v !== 'string' || !HEX.test(v)) { errors.push(`${label} palette[${JSON.stringify(k)}] must be a hex colour like "#ff8800"`); continue; }
      palette[k] = normalizeHex(v);
    }
  }

  const frames = {};
  if (!isObj(raw.frames)) errors.push(`${label} needs "frames": {"idle": [ [${N} strings of ${N} characters] ]}`);
  else {
    const src = Object.assign({}, raw.frames);
    if (src.move !== undefined && src.walk === undefined) { src.walk = src.move; }
    delete src.move;
    for (const name of Object.keys(src)) if (!SPRITE_FRAMES[name]) warnings.push(`${label} frames.${name} is not an animation the arena uses (use: ${Object.keys(SPRITE_FRAMES).join(', ')})`);
    for (const [name, [min, max]] of Object.entries(SPRITE_FRAMES)) {
      let list = src[name];
      if (list === undefined) { if (min > 0) errors.push(`${label} frames.${name} is required`); continue; }
      if (Array.isArray(list) && list.length && typeof list[0] === 'string') list = [list]; // a single frame given directly
      if (!Array.isArray(list)) { errors.push(`${label} frames.${name} must be a list of frames`); continue; }
      if (list.length < min || list.length > max) errors.push(`${label} frames.${name} has ${list.length} frames (allowed ${min}–${max})`);
      const good = [];
      list.slice(0, max).forEach((fr, fi) => {
        const p = `${label} frames.${name}[${fi}]`;
        if (!Array.isArray(fr)) { errors.push(`${p} must be an array of ${N} strings`); return; }
        let bad = 0;
        const note = (msg) => { if (bad++ < 3) errors.push(msg); };
        if (fr.length !== N) note(`${p} has ${fr.length} rows (need exactly ${N})`);
        fr.forEach((row, ri) => {
          if (typeof row !== 'string') { note(`${p} row ${ri} is not a string`); return; }
          if (row.length !== N) note(`${p} row ${ri} is ${row.length} characters long (need exactly ${N})`);
          for (let ci = 0; ci < row.length; ci++) {
            const ch = row[ci];
            if (ch !== '.' && !palette[ch]) { note(`${p} row ${ri} col ${ci}: "${ch}" is not in the palette`); break; }
          }
        });
        good.push(fr.slice(0, N).map(r => String(r).slice(0, N).padEnd(N, '.')));
      });
      if (good.length) frames[name] = good;
    }
  }
  if (errors.length > 10) errors.splice(10, errors.length - 10, `…and more ${label} problems`);
  if (errors.length) return { sprite: null, errors, warnings };

  for (const [name, list] of Object.entries(frames)) {
    list.forEach((fr, fi) => {
      const filled = fr.map(r => /[^.]/.test(r));
      if (!filled.some(Boolean)) warnings.push(`${label} frames.${name}[${fi}] is completely transparent`);
      else if (name !== 'ko' && !filled.slice(N - 4).some(Boolean)) warnings.push(`${label} frames.${name}[${fi}]: nothing in the bottom 4 rows — your fighter will look like it is floating (feet belong on the bottom rows)`);
    });
  }
  if (frames.walk) frames.move = frames.walk; // old renderers read "move"
  return { sprite: { palette, frames }, errors, warnings };
}

/** Parse + validate sprite.json text. Returns { sprite|null, errors, warnings, missing }. */
function parseSprite(text) {
  if (text === null || text === undefined) return { sprite: null, errors: [], warnings: [], missing: true };
  if (Buffer.byteLength(String(text), 'utf8') > RULES.spriteMaxBytes) {
    return { sprite: null, errors: [`sprite.json is larger than ${Math.round(RULES.spriteMaxBytes / 1000)} KB`], warnings: [] };
  }
  const parsed = parseJson(text, 'sprite.json');
  if (parsed.error) return { sprite: null, errors: [parsed.error], warnings: [] };
  return checkSpriteObject(parsed.value, 'sprite.json');
}

// ── looks (engine/look.js, optional) ─────────────────────────────────────────
let lookModule;
function looks() {
  if (lookModule) return lookModule;
  try { lookModule = require('./look'); } catch { lookModule = null; }
  return lookModule;
}

const composeCache = new Map();
/** Build the sprite for a fighter.json that has a "look" (null if not possible). */
function composeFromLook(json) {
  if (!isObj(json) || json.look === undefined) return null;
  const lm = looks();
  if (!lm || typeof lm.composeSprite !== 'function') return null;
  const weapon = typeof json.weapon === 'string' && WEAPONS[json.weapon] ? json.weapon : DEFAULT_WEAPON;
  const key = JSON.stringify([json.look, weapon, json.colors || null]);
  if (composeCache.has(key)) return composeCache.get(key);
  let out = null;
  try {
    // The fighter's colors are the default primary/secondary for a look without its own.
    const v = lm.validateLook(json.look, { colors: isObj(json.colors) ? json.colors : undefined });
    const sprite = lm.composeSprite(v.look, weapon);
    const chk = checkSpriteObject(sprite, 'composed look');
    out = chk.sprite ? chk.sprite : null;
  } catch { out = null; }
  if (composeCache.size > 64) composeCache.delete(composeCache.keys().next().value);
  composeCache.set(key, out);
  return out;
}

/** Load the raw files of a fighter folder. */
function readBundle(dir) {
  const files = fileInfo(dir);
  const jsonText = readText(path.join(dir, 'fighter.json'));
  const libRead = readLib(dir);
  const bundle = {
    dir,
    files,
    exists: FILES.some(f => files[f].exists),
    jsonText,
    json: null,
    jsonError: null,
    brain: readText(path.join(dir, 'brain.js')),
    lib: libRead.lib,
    libInfo: libRead.info,
    spriteText: readText(path.join(dir, 'sprite.json')),
    notes: readText(path.join(dir, 'notes.md')),
  };
  if (jsonText !== null) {
    const parsed = parseJson(jsonText);
    if (parsed.error) bundle.jsonError = parsed.error;
    else bundle.json = parsed.value;
  }
  attachSprite(bundle);
  return bundle;
}

function attachSprite(bundle) {
  const s = parseSprite(bundle.spriteText);
  bundle.sprite = s.sprite;
  bundle.spriteErrors = s.errors;
  bundle.spriteWarnings = s.warnings;
  bundle.spriteMissing = !!s.missing;
  bundle.spriteSource = s.sprite ? 'file' : null;
  if (s.missing) {
    const composed = composeFromLook(bundle.json);
    if (composed) { bundle.sprite = composed; bundle.spriteSource = 'look'; bundle.spriteMissing = false; }
  }
  return bundle;
}

/** Bundle from a snapshot object {fighter, brain, lib, sprite, notes} (what `ready` locks in). */
function bundleFromSnapshot(snap) {
  const spriteText = typeof snap.sprite === 'string' ? snap.sprite : snap.sprite ? JSON.stringify(snap.sprite) : null;
  return attachSprite({
    dir: null,
    files: null,
    exists: true,
    jsonText: null,
    json: snap.fighter,
    jsonError: snap.fighter ? null : 'snapshot has no fighter.json',
    brain: typeof snap.brain === 'string' ? snap.brain : null,
    lib: isObj(snap.lib) ? snap.lib : null,
    spriteText,
    notes: typeof snap.notes === 'string' ? snap.notes : null,
  });
}

function snapshotOf(bundle) {
  return { fighter: bundle.json, brain: bundle.brain, lib: bundle.lib || null, sprite: bundle.spriteText, notes: bundle.notes };
}

function escapeRe(s) { return String(s).replace(/[.*+?^$()|[\]\\/{}]/g, (c) => `\\${c}`); }

function checkSyntax(src, filename, wrap) {
  try {
    new vm.Script(wrap ? `(function (module, exports, require) {\n${src}\n})` : src, { filename, lineOffset: wrap ? -1 : 0 });
    return null;
  } catch (e) {
    const where = new RegExp(escapeRe(filename) + ':(\\d+)').exec(String(e.stack || ''));
    return `${filename} has a syntax error${where ? ` on line ${where[1]}` : ''}: ${e.message}`;
  }
}

function spriteKey(sprite) {
  if (!sprite) return 'none';
  const frames = Object.assign({}, sprite.frames);
  delete frames.move;
  return JSON.stringify({ palette: sprite.palette, frames });
}

/**
 * Full static check of a bundle at a level. Returns { ok, errors, warnings, spec, level }.
 * `starter` ({signature, spriteKey}) enforces the round-1 mirror at level 1.
 * `spec` is best-effort even when invalid (for display).
 */
function checkBundle(bundle, { level, starter } = {}) {
  const errors = [];
  const warnings = [];
  let result;
  if (bundle.jsonError || bundle.json === null || bundle.json === undefined) {
    errors.push(bundle.jsonError || 'fighter.json is missing');
    result = validateFighter({}, { level });
    result.errors = [];
    result.warnings = [];
  } else {
    result = validateFighter(bundle.json, { level });
  }
  errors.push(...result.errors);
  warnings.push(...result.warnings);

  let total = 0;
  if (bundle.brain === null || bundle.brain === undefined) {
    errors.push('brain.js is missing');
  } else {
    total += Buffer.byteLength(bundle.brain, 'utf8');
    const syntax = checkSyntax(bundle.brain, 'brain.js', false);
    if (syntax) errors.push(syntax);
  }
  if (bundle.lib) {
    const names = Object.keys(bundle.lib);
    if (names.length > RULES.libMaxFiles) errors.push(`lib/ has ${names.length} .js files (max ${RULES.libMaxFiles})`);
    for (const n of names) {
      total += Buffer.byteLength(bundle.lib[n], 'utf8');
      const syntax = checkSyntax(bundle.lib[n], `lib/${n}`, true);
      if (syntax) errors.push(syntax);
    }
  }
  if (total > RULES.brainMaxBytes) errors.push(`brain.js + lib/*.js are ${Math.round(total / 1000)} KB together (max ${Math.round(RULES.brainMaxBytes / 1000)} KB)`);

  if (bundle.spriteMissing) warnings.push(bundle.json && bundle.json.look !== undefined
    ? 'no sprite.json and the look could not be built — a plain default sprite will be used'
    : 'no sprite.json and no "look" — a plain default pixel sprite will be used (add a "look" to fighter.json or paint sprite.json)');
  errors.push(...(bundle.spriteErrors || []));
  warnings.push(...(bundle.spriteWarnings || []));

  const lvl = levelInfo(level);
  if (starter && lvl.level === 1 && !bundle.jsonError && bundle.json) {
    if (mechanicsSignature(result.spec) !== starter.signature) {
      errors.push('ROUND 1 IS A MIRROR MATCH: stats, traits, weapon and abilities must be exactly the starter\'s (only names, colours, styles, text and brain.js/lib may change). Customising unlocks at level 2 — after the host starts round 2. Restore the starter values from engine/starter/fighter.json.');
    }
    if (spriteKey(bundle.sprite) !== starter.spriteKey && !(bundle.spriteErrors || []).length) {
      errors.push('ROUND 1 IS A MIRROR MATCH: your look/sprite must stay the starter\'s (keep the starter "look", no sprite.json). You can redesign your look from round 2.');
    }
  }
  return { ok: errors.length === 0, errors, warnings, spec: result.spec, level: lvl.level };
}

module.exports = {
  FILES, SPRITE_FRAMES, readBundle, readLib, bundleFromSnapshot, snapshotOf, checkBundle, fileInfo, parseJson, parseSprite,
  checkSpriteObject, composeFromLook, spriteKey,
};
