'use strict';
// Round / match results as CSV (Excel friendly: UTF-8 BOM, CRLF, quoted fields).
// Rows that can't be written (e.g. the file is open in Excel) are queued and retried.

const fs = require('fs');
const path = require('path');

const ROUND_COLUMNS = [
  'timestamp', 'match', 'match_id', 'round', 'level', 'arena', 'ai', 'ai_label', 'fighter', 'result', 'method', 'fight_seconds',
  'hp_left_pct', 'damage_dealt', 'damage_taken', 'healing', 'shield_absorbed', 'accuracy_pct', 'biggest_hit', 'biggest_hit_ability',
  'stuns_landed', 'abilities_used', 'build_seconds', 'coding_seconds', 'saves', 'tests', 'checks', 'auto_locked',
  'vitality', 'power', 'armor', 'speed', 'energy', 'regen', 'traits', 'abilities', 'brain_lines', 'brain_errors',
  'opponent_ai', 'opponent_fighter', 'host_prediction', 'prediction_correct',
  // v3
  'weapon', 'crit', 'haste', 'tenacity', 'precision', 'crits', 'weapon_damage', 'dot_damage', 'parries', 'traps_sprung',
  'lib_files', 'memory_bytes', 'look',
  // v4
  'vigor', 'focus', 'stance', 'offhand', 'relics', 'ultimate', 'ults', 'ult_damage', 'awakenings', 'god_powers', 'god_casts', 'god_damage',
];

const MATCH_COLUMNS = [
  'match', 'match_id', 'started', 'ended', 'rounds', 'ai_a', 'wins_a', 'ai_b', 'wins_b', 'draws', 'winner',
  'coding_seconds_a', 'coding_seconds_b', 'damage_a', 'damage_b', 'predictions_correct', 'predictions_made',
];

const pending = new Map(); // file -> [rows]

function esc(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Local time, e.g. 2026-09-28 17:40:15 (what the host's clock showed).
function iso(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function secs(ms) { return ms === null || ms === undefined ? '' : Math.round(ms / 100) / 10; }

function headerLine(header) { return header.map(esc).join(','); }

function readHeader(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(8192);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    return buf.subarray(0, n).toString('utf8').replace(/^﻿/, '').split(/\r?\n/)[0];
  } finally { fs.closeSync(fd); }
}

/** Minimal RFC 4180 parser (quoted fields, doubled quotes, CRLF). */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// A file written by an older version has fewer columns: rewrite it with the
// current header (old values kept under their column names, new ones blank).
function migrate(file, header) {
  const rows = parseCsv(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  if (!rows.length) return;
  const old = rows[0];
  const idx = header.map(h => old.indexOf(h));
  let out = '﻿' + headerLine(header) + '\r\n';
  for (const r of rows.slice(1)) {
    if (r.length === 1 && r[0] === '') continue;
    out += idx.map(i => esc(i >= 0 ? r[i] : '')).join(',') + '\r\n';
  }
  fs.writeFileSync(`${file}.tmp`, out);
  fs.renameSync(`${file}.tmp`, file);
}

function flush(file, header) {
  const rows = pending.get(file);
  if (!rows || !rows.length) return true;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file) && readHeader(file) !== headerLine(header)) migrate(file, header);
    let text = '';
    if (!fs.existsSync(file)) text += '﻿' + header.map(esc).join(',') + '\r\n';
    for (const r of rows) text += header.map(h => esc(r[h])).join(',') + '\r\n';
    fs.appendFileSync(file, text);
    pending.set(file, []);
    return true;
  } catch {
    return false; // keep them pending (file locked by another program?)
  }
}

function append(file, header, rows) {
  const list = pending.get(file) || [];
  list.push(...rows);
  pending.set(file, list);
  return flush(file, header);
}

function retryPending(dir) {
  const ok1 = flush(path.join(dir, 'rounds.csv'), ROUND_COLUMNS);
  const ok2 = flush(path.join(dir, 'matches.csv'), MATCH_COLUMNS);
  return ok1 && ok2;
}

function hasPending() {
  for (const rows of pending.values()) if (rows.length) return true;
  return false;
}

/** Two rows (one per fighter) for a finished round record. */
function roundRows(match, rec, fighters) {
  return fighters.map((f, i) => {
    const other = fighters[1 - i];
    const v = rec.fighters[f.id] || {};
    const o = rec.fighters[other.id] || {};
    const sm = v.summary || {};
    const act = (rec.activity && rec.activity[f.id]) || {};
    // Rounds from before coding-time tracking only have the build time.
    const codingMs = act.codingMs !== null && act.codingMs !== undefined ? act.codingMs : v.buildMs;
    const winner = rec.result.winnerId;
    return {
      timestamp: iso(rec.endedAt), match: match.matchNumber, match_id: match.matchId, round: rec.round, level: rec.level,
      arena: rec.themeName || '', ai: f.id, ai_label: f.label, fighter: v.name,
      result: winner === null ? 'draw' : winner === f.id ? 'win' : 'loss', method: rec.result.method, fight_seconds: rec.result.time,
      hp_left_pct: rec.result.hpPct ? Math.round(rec.result.hpPct[f.id]) : '',
      damage_dealt: sm.dealt, damage_taken: sm.taken, healing: sm.healed, shield_absorbed: sm.shieldAbsorbed,
      accuracy_pct: sm.accuracy === null || sm.accuracy === undefined ? '' : Math.round(sm.accuracy * 100),
      biggest_hit: sm.biggestHit, biggest_hit_ability: sm.biggestHitAbility || '', stuns_landed: sm.stunsLanded, abilities_used: sm.casts,
      build_seconds: secs(v.buildMs), coding_seconds: secs(codingMs), saves: act.saves, tests: act.tests, checks: act.checks,
      auto_locked: act.autoLocked || '',
      vitality: v.stats && v.stats.vitality, power: v.stats && v.stats.power, armor: v.stats && v.stats.armor,
      speed: v.stats && v.stats.speed, energy: v.stats && v.stats.energy, regen: v.stats && v.stats.regen,
      traits: (v.traits || []).join('; '), abilities: (v.abilities || []).filter(a => !a.basic && !a.ultimate).map(a => `${a.name} (${a.type})`).join('; '),
      brain_lines: v.brainLines, brain_errors: v.brainErrors,
      opponent_ai: other.id, opponent_fighter: o.name,
      host_prediction: rec.prediction || '', prediction_correct: rec.prediction ? (rec.prediction === winner ? 'yes' : 'no') : '',
      weapon: v.weapon ? v.weapon.name || v.weapon.id || '' : '',
      crit: v.stats && v.stats.crit, haste: v.stats && v.stats.haste, tenacity: v.stats && v.stats.tenacity, precision: v.stats && v.stats.precision,
      crits: sm.crits, weapon_damage: sm.basicDamage,
      dot_damage: sm.burnDamage === undefined ? '' : (sm.burnDamage || 0) + (sm.poisonDamage || 0) + (sm.bleedDamage || 0),
      parries: sm.countersLanded, traps_sprung: sm.trapsTriggered,
      lib_files: v.libFiles, memory_bytes: v.memoryBytes,
      look: v.look ? [v.look.base, v.look.build, v.look.outfit, v.look.headgear].filter(x => x && x !== 'none').join(' ') : '',
      vigor: v.stats && v.stats.vigor, focus: v.stats && v.stats.focus,
      stance: v.stance || '', offhand: v.offhand ? v.offhand.name || v.offhand.id : '',
      relics: (v.relics || []).join('; '), ultimate: v.ultimate ? v.ultimate.name : '',
      ults: sm.ults, ult_damage: sm.ultDamage, awakenings: sm.awakenings,
      god_powers: (v.godPowers || []).join('; '), god_casts: sm.godCasts, god_damage: sm.godDamage,
    };
  });
}

function matchRow(match, score, fighters) {
  const [a, b] = fighters;
  const coding = (id) => match.rounds.reduce((t, r) => {
    const a = r.activity && r.activity[id];
    const ms = a && a.codingMs !== null && a.codingMs !== undefined ? a.codingMs : (r.fighters[id] && r.fighters[id].buildMs);
    return t + (ms || 0);
  }, 0);
  const dmg = (id) => match.rounds.reduce((t, r) => t + ((r.fighters[id] && r.fighters[id].summary && r.fighters[id].summary.dealt) || 0), 0);
  const preds = match.rounds.filter(r => r.prediction);
  const sa = score[a.id] || 0, sb = score[b.id] || 0;
  return {
    match: match.matchNumber, match_id: match.matchId, started: iso(match.startedAt), ended: iso(match.endedAt), rounds: match.rounds.length,
    ai_a: a.id, wins_a: sa, ai_b: b.id, wins_b: sb, draws: score.draws || 0,
    winner: sa === sb ? 'draw' : sa > sb ? a.id : b.id,
    coding_seconds_a: secs(coding(a.id)), coding_seconds_b: secs(coding(b.id)),
    damage_a: dmg(a.id), damage_b: dmg(b.id),
    predictions_correct: preds.filter(r => r.prediction === r.result.winnerId).length, predictions_made: preds.length,
  };
}

module.exports = { ROUND_COLUMNS, MATCH_COLUMNS, append, retryPending, hasPending, roundRows, matchRow };
