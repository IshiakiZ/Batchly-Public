'use strict';
// "What changed" between two versions of a fighter — used by the server's live
// feed / build panels and by `node arena.js diff`.

const { STAT_KEYS } = require('./rules');

const ABILITY_FIELDS = ['type', 'damage', 'range', 'arc', 'hits', 'lunge', 'speed', 'radius', 'count', 'spread', 'homing', 'bounce', 'returns',
  'target', 'delay', 'dps', 'duration', 'pull', 'follow', 'width', 'turnRate', 'arm', 'distance', 'invulnerable', 'teleport',
  'amount', 'stat', 'slow', 'immunity', 'windup', 'cooldown', 'energy'];

function lineCount(text) { return text ? String(text).split('\n').length : 0; }

/** Lines added / removed between two texts (multiset of trimmed, non-empty lines). */
function lineDiff(a, b) {
  const count = new Map();
  for (const l of String(a || '').split('\n')) { const k = l.trim(); if (k) count.set(k, (count.get(k) || 0) + 1); }
  let added = 0;
  for (const l of String(b || '').split('\n')) {
    const k = l.trim();
    if (!k) continue;
    const c = count.get(k) || 0;
    if (c > 0) count.set(k, c - 1); else added++;
  }
  let removed = 0;
  for (const c of count.values()) removed += c;
  return { added, removed };
}

const weaponId = (spec) => (spec && spec.weapon ? (typeof spec.weapon === 'string' ? spec.weapon : spec.weapon.id) : 'fists');

/**
 * Differences between two validated specs. The weapon attack (basic: true) is not
 * listed as an ability change — a weapon swap shows up in `weapon` instead.
 */
function specDiff(prev, cur) {
  const stats = {};
  for (const k of STAT_KEYS) { const d = ((cur.stats || {})[k] || 0) - ((prev.stats || {})[k] || 0); if (d) stats[k] = d; }
  const abilities = [];
  const own = (spec) => (spec.abilities || []).filter(a => !a.basic);
  const prevBy = new Map(own(prev).map(a => [a.name.toLowerCase(), a]));
  const seen = new Set();
  for (const a of own(cur)) {
    const key = a.name.toLowerCase();
    seen.add(key);
    const p = prevBy.get(key);
    if (!p) { abilities.push({ kind: 'added', name: a.name, type: a.type }); continue; }
    const changes = [];
    for (const f of ABILITY_FIELDS) {
      if ((a[f] !== undefined || p[f] !== undefined) && JSON.stringify(a[f]) !== JSON.stringify(p[f])) changes.push({ field: f, from: p[f], to: a[f] });
    }
    if (JSON.stringify(a.effects || {}) !== JSON.stringify(p.effects || {})) changes.push({ field: 'effects', from: p.effects || {}, to: a.effects || {} });
    if (changes.length) abilities.push({ kind: 'changed', name: a.name, changes });
  }
  for (const p of own(prev)) if (!seen.has(p.name.toLowerCase())) abilities.push({ kind: 'removed', name: p.name, type: p.type });
  const pt = new Set(prev.traits || []), ct = new Set(cur.traits || []);
  const traits = {
    added: [...ct].filter(t => !pt.has(t)),
    removed: [...pt].filter(t => !ct.has(t)),
  };
  const wp = weaponId(prev), wc = weaponId(cur);
  const weapon = wp !== wc ? { from: wp, to: wc } : null;
  const lookChanged = JSON.stringify(prev.look || null) !== JSON.stringify(cur.look || null);
  return { stats, abilities, traits, weapon, lookChanged, nameChanged: prev.name !== cur.name ? prev.name : null };
}

function fmtVal(v) {
  if (v === undefined) return '-';
  if (typeof v === 'object') return JSON.stringify(v).replace(/"/g, '');
  return String(v);
}

module.exports = { ABILITY_FIELDS, lineCount, lineDiff, specDiff, fmtVal };
