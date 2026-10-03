// ─────────────────────────────────────────────────────────────────────────────
//  UI kit: small reusable pieces shared by the Live, Fighters, Arena and Stats
//  screens — tab bars, the brain code viewer, stat bars, ability rows/cards,
//  the weapon block, feed items, trait chips and animation tiles.
// ─────────────────────────────────────────────────────────────────────────────
import {
  h, clear, add, n2, num, cap, statKeys, statMeta, derivedText, derivedRows, weaponOf, basicAttack,
  effectChips, abilityNumbers, abilityFields, iconFor, weaponIcon, abilityIcon, clockTime, ago, weaponAttackNames, archivedAbilities,
} from './util.js';
import { pixelSprite, spriteAnimator } from './sprites.js';

// ── tab bars (ARIA tabs with arrow-key roving focus) ─────────────────────────
let tabSeq = 0;
/**
 * tabs: [{id, label, title?}] · onSelect(id) · returns {el, select(id, silent), setBadge(id, text|null), active}
 */
export function tabBar(tabs, { active, onSelect, cls = '', label = 'Sections' } = {}) {
  const uid = `tb${++tabSeq}`;
  const bar = h('div', { class: `tabbar ${cls}`.trim(), role: 'tablist', 'aria-label': label });
  const btns = new Map();
  const api = { el: bar, active: active || tabs[0].id };
  const focusable = () => tabs.map(t => btns.get(t.id)).filter(b => b && !b.hidden);
  for (const t of tabs) {
    const badge = h('span', { class: 'tab-badge', hidden: true });
    const b = h('button', {
      class: 'tab', role: 'tab', id: `${uid}-${t.id}`, type: 'button', title: t.title || null,
      onclick: () => { api.select(t.id); },
    }, t.icon ? h('span', { class: 'tab-ic', 'aria-hidden': 'true' }, t.icon) : null, h('span', { class: 'tab-lbl' }, t.label), badge);
    b._badge = badge;
    btns.set(t.id, b);
    bar.append(b);
  }
  bar.addEventListener('keydown', (e) => {
    const list = focusable();
    const i = list.indexOf(document.activeElement);
    if (i < 0) return;
    let j = null;
    if (e.key === 'ArrowRight') j = (i + 1) % list.length;
    else if (e.key === 'ArrowLeft') j = (i - 1 + list.length) % list.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = list.length - 1;
    if (j === null) return;
    e.preventDefault();
    e.stopPropagation();
    list[j].focus();
    list[j].click();
  });
  api.select = (id, silent = false) => {
    if (!btns.has(id)) return;
    api.active = id;
    for (const [k, b] of btns) {
      const on = k === id;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    }
    if (!silent && onSelect) onSelect(id);
  };
  api.setBadge = (id, text, kind = '') => {
    const b = btns.get(id);
    if (!b) return;
    const badge = b._badge;
    if (text === null || text === undefined || text === false) { badge.hidden = true; return; }
    badge.hidden = false;
    badge.className = `tab-badge ${kind}`.trim();
    badge.textContent = text === true ? '' : String(text);
  };
  api.show = (id, on) => { const b = btns.get(id); if (b) b.hidden = !on; };
  api.button = (id) => btns.get(id);
  api.select(api.active, true);
  return api;
}

// ── brain.js viewer (tiny JS highlighter: escapes everything, the code is untrusted) ──
const KW = new Set(['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'break', 'continue', 'new', 'of', 'in', 'true', 'false', 'null', 'undefined', 'this', 'typeof', 'switch', 'case', 'default', 'try', 'catch', 'throw', 'class', 'module', 'exports', 'require', 'async', 'await']);
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function highlight(line, state) {
  let out = '';
  let i = 0;
  while (i < line.length) {
    if (state.inComment) {
      const end = line.indexOf('*/', i);
      const stop = end < 0 ? line.length : end + 2;
      out += `<span class="tok-c">${esc(line.slice(i, stop))}</span>`;
      i = stop;
      if (end >= 0) state.inComment = false;
      continue;
    }
    const rest = line.slice(i);
    let m;
    if (rest.startsWith('//')) { out += `<span class="tok-c">${esc(rest)}</span>`; break; }
    if (rest.startsWith('/*')) { state.inComment = true; continue; }
    if ((m = /^(['"`])(?:\\.|(?!\1).)*\1?/.exec(rest))) { out += `<span class="tok-s">${esc(m[0])}</span>`; i += m[0].length; continue; }
    if ((m = /^\d+(?:\.\d+)?/.exec(rest))) { out += `<span class="tok-n">${m[0]}</span>`; i += m[0].length; continue; }
    if ((m = /^[A-Za-z_$][\w$]*/.exec(rest))) {
      const w = m[0];
      const isCall = rest.slice(w.length).trimStart().startsWith('(');
      out += KW.has(w) ? `<span class="tok-k">${w}</span>` : isCall ? `<span class="tok-f">${w}</span>` : esc(w);
      i += w.length;
      continue;
    }
    out += esc(line[i]);
    i++;
  }
  return out;
}

/** A code panel that highlights lines changed since the previous set() and scrolls to them. */
/**
 * The brain as shown in the code viewer: brain.js, then every lib/*.js module (v3),
 * plus header chips for the modules and the memory the brain carries between rounds.
 */
export function brainView(card) {
  const brain = (card && card.brain) || {};
  const lib = (card && Array.isArray(card.lib)) ? card.lib : [];
  let source = brain.source || '';
  if (lib.length) {
    const bar = (t) => `// ${'─'.repeat(6)} ${t} ${'─'.repeat(Math.max(4, 58 - t.length))}`;
    source = `${bar('brain.js')}\n${source}`;
    for (const m of lib) source += `\n\n${bar(`lib/${m.name} (${m.lines} lines)`)}\n${m.source || ''}`;
  }
  const chips = [];
  if (lib.length) {
    const lines = lib.reduce((a, m) => a + (m.lines || 0), 0);
    chips.push(h('span', { class: 'file on', title: lib.map(m => `lib/${m.name} — ${m.lines} lines`).join('\n') }, `lib/ ${lib.length} module${lib.length === 1 ? '' : 's'} · ${lines} lines`));
  }
  const mem = card && card.memory;
  if (mem) chips.push(h('span', { class: 'file on', title: `What this brain saved in \`memory\` after round ${mem.round}; it starts its next fight with it.${mem.note ? `\n${mem.note}` : ''}` }, `memory ${mem.bytes < 1000 ? `${mem.bytes} B` : `${(mem.bytes / 1000).toFixed(1)} KB`}`));
  return { source, chips };
}

export function codeView({ emptyText = 'No brain.js yet — the fighting logic will stream in here.' } = {}) {
  const head = h('div', { class: 'code-head' });
  const body = h('div', { class: 'code-body', tabindex: '0', 'aria-label': 'brain.js source' });
  const el = h('div', { class: 'codeview' }, head, body);
  let last = null;
  return {
    el, head, body,
    reset() { last = null; },
    set(src, { animate = true, exists = true } = {}) {
      src = src || '';
      if (src === last) return;
      const prevLines = last === null ? null : last.split('\n');
      const lines = src.split('\n');
      const counts = new Map();
      if (prevLines) for (const l of prevLines) counts.set(l, (counts.get(l) || 0) + 1);
      const frag = document.createDocumentFragment();
      const state = { inComment: false };
      let firstChanged = null;
      if (exists && src) {
        lines.forEach((l, i) => {
          let changed = false;
          if (prevLines && animate) {
            const c = counts.get(l) || 0;
            if (c > 0) counts.set(l, c - 1); else if (l.trim()) changed = true;
          }
          const row = h('div', { class: `code-line${changed ? ' changed' : ''}` }, h('span', { class: 'ln' }, String(i + 1)));
          const lc = h('span', { class: 'lc' });
          lc.innerHTML = highlight(l, state) || ' ';
          row.appendChild(lc);
          if (changed && !firstChanged) firstChanged = row;
          frag.appendChild(row);
        });
      }
      const hovering = body.matches(':hover');
      clear(body).appendChild(frag);
      if (!exists || !src) body.append(h('div', { class: 'empty-note' }, emptyText));
      if (firstChanged && !hovering && body.offsetParent) {
        const top = firstChanged.offsetTop - body.offsetTop - 40;
        body.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
      }
      last = src;
    },
  };
}

// ── chips ────────────────────────────────────────────────────────────────────
export function traitChip(store, id, extra = '') {
  const t = store.rules.traits && store.rules.traits[id];
  return h('span', { class: `trait ${t ? t.group : ''} ${extra}`.trim(), title: t ? `${t.name} — ${t.text}` : id }, t ? t.name : id);
}
export function traitChips(store, ids) { return (ids || []).map(id => traitChip(store, id)); }

export function fxChips(ab, { long = false } = {}) {
  return effectChips(ab).map(([cls, short, full]) => h('span', { class: `fx ${cls}`, title: full }, long ? full : short));
}

export function sectionHead(label, right = null, extra = null) {
  return h('div', { class: 'sec-head' }, h('span', { class: 'sec-lbl' }, label), extra, right !== null && right !== undefined ? h('span', { class: 'sec-right' }, right) : null);
}

// ── stat bars ────────────────────────────────────────────────────────────────
/** Bars for every stat (rules.statKeys order). Bar length is relative to the max-level cap. */
export function statGrid(store, spec, { cols = 2, showDerived = true, capMax = null } = {}) {
  const rules = store.rules;
  const max = capMax || rules.statMax || 40;
  const keys = statKeys(rules, spec.stats);
  const grid = h('div', { class: `statgrid cols-${cols}` });
  for (const k of keys) {
    const v = (spec.stats && spec.stats[k]) || 0;
    const m = statMeta(rules, k);
    const d = showDerived ? derivedText(k, spec.derived) : '';
    grid.append(h('div', { class: `st-row g-${m.group || 'utility'}${v ? '' : ' zero'}`, title: `${m.label} ${v} — ${m.formula || ''}${d ? `\n→ ${d}` : ''}` },
      h('span', { class: 'st-k' }, m.short),
      h('span', { class: 'st-bar' }, h('i', { style: `width:${Math.min(100, (v / max) * 100)}%` })),
      h('span', { class: 'st-v' }, String(v)),
      showDerived ? h('span', { class: 'st-d' }, d) : null));
  }
  return grid;
}

/** Full stat table for the Fighters page. */
export function statTable(store, spec, { level } = {}) {
  const rules = store.rules;
  const lvl = rules.levels && rules.levels[level || spec.level || 1];
  const cap = lvl ? lvl.statMax : (rules.statMax || 40);
  const max = rules.statMax || 40;
  const keys = statKeys(rules, spec.stats);
  return h('table', { class: 'stat-table' },
    h('thead', null, h('tr', null, h('th', null, 'Stat'), h('th', { class: 'num' }, 'Points'), h('th', null, ''), h('th', null, 'Effect for this fighter'), h('th', null, 'Formula'))),
    h('tbody', null, keys.map(k => {
      const v = (spec.stats && spec.stats[k]) || 0;
      const m = statMeta(rules, k);
      return h('tr', { class: `g-${m.group || 'utility'}${v ? '' : ' zero'}` },
        h('td', null, h('b', null, m.label), h('span', { class: 'muted' }, ` ${m.short}`)),
        h('td', { class: 'num' }, `${v}`, h('span', { class: 'muted' }, ` / ${cap}`)),
        h('td', { class: 'barcell' }, h('span', { class: 'st-bar' }, h('i', { style: `width:${Math.min(100, (v / max) * 100)}%` }))),
        h('td', null, derivedText(k, spec.derived) || '—'),
        h('td', { class: 'formula' }, m.formula || ''));
    })));
}

export function derivedTable(spec) {
  const rows = derivedRows(spec.derived);
  if (!rows.length) return null;
  return h('dl', { class: 'kv-grid' }, rows.map(([k, v]) => h('div', { class: 'kv' }, h('dt', null, k), h('dd', null, v))));
}

// ── abilities ───────────────────────────────────────────────────────────────
/** One compact row: icon · name · type · energy/cooldown · key numbers · effect chips. */
export function abilityRow(ab, spec, { isNew = false, compactFx = true } = {}) {
  const color = ab.color || (spec.colors && spec.colors.primary) || '#8ab4ff';
  const basic = !!ab.basic;
  const ult = !!ab.ultimate;
  const off = !!ab.offhand;
  const fx = fxChips(ab);
  const tip = [ab.name, ult ? 'ultimate (needs a full charge)' : basic ? 'weapon attack (free)' : ab.type, ab.description || ''].filter(Boolean).join(' — ');
  return h('div', { class: `ab-row${basic ? ' basic' : ''}${ult ? ' ult' : ''}${isNew ? ' new' : ''}`, style: `--ac:${color}`, title: tip },
    h('span', { class: 'ab-ic' }, ult ? abilityIcon(ab.type) : iconFor(ab, spec)),
    h('span', { class: 'ab-main' },
      h('span', { class: 'ab-name' }, ab.name),
      ult ? h('span', { class: 'tag ult' }, 'ULTIMATE') : basic ? h('span', { class: 'tag gold' }, off ? 'OFF-HAND' : 'WEAPON') : null,
      h('span', { class: 'ab-type' }, `${basic ? `${ab.type} · free` : ab.type}${ult ? ` · ${n2(ab.windup || 1)}s charge-up` : ab.windup ? ` · ${n2(ab.windup)}s windup` : ''}`)),
    h('span', { class: 'ab-cost' },
      ult ? h('span', { class: 'en ult', title: 'Ultimates cost no energy: they need a full charge' }, '100%') : basic ? h('span', { class: 'en free', title: 'Weapon attacks cost no energy' }, 'free') : h('span', { class: 'en', title: 'Energy cost' }, `⚡${ab.energy}`),
      ab.cooldown !== undefined && !ult ? h('span', { class: 'cd', title: 'Cooldown' }, `⏱${n2(ab.cooldown)}s`) : null),
    h('span', { class: `ab-l2${compactFx ? ' compact' : ''}` }, h('span', { class: 'ab-nums' }, abilityNumbers(ab).join(' · ')), fx));
}

/** The off-hand weapon (v4, L7+) as one compact line, like the main weapon line. */
export function offhandLine(off) {
  const nums = off.basic ? abilityNumbers(off.basic).join(' · ') : '';
  return h('div', { class: 'weapon-line off', title: `${off.name} — off-hand${off.passiveText ? `
${off.passiveText}` : ''}` },
    h('span', { class: 'ab-ic gold' }, weaponIcon(off, off.basic)),
    h('span', { class: 'wl-name' }, off.name, h('span', { class: 'tag' }, 'off-hand')),
    off.basic ? h('span', { class: 'wl-atk' }, `${off.basic.name}: ${nums} · every ${n2(off.basic.cooldown)}s`) : null,
    off.passiveText ? h('span', { class: 'wl-passive' }, off.passiveText) : null);
}

/** A detailed card with every number, the cost breakdown and trait adjustments. */
export function abilityCard(ab, spec, { isNew = false } = {}) {
  const color = ab.color || (spec.colors && spec.colors.primary) || '#8ab4ff';
  const basic = !!ab.basic;
  const ult = !!ab.ultimate;
  const fields = abilityFields(ab);
  const fx = fxChips(ab, { long: true });
  const c = ult ? null : ab.cost;
  const design = ab.design;
  const changedByTraits = design && (design.cooldown !== ab.cooldown || design.windup !== ab.windup || design.energy !== ab.energy);
  return h('article', { class: `ab-card${basic ? ' basic' : ''}${ult ? ' ult' : ''}${isNew ? ' new' : ''}`, style: `--ac:${color}` },
    h('header', { class: 'abc-head' },
      h('span', { class: 'ab-ic big' }, ult ? abilityIcon(ab.type) : iconFor(ab, spec)),
      h('div', { class: 'abc-title' },
        h('div', { class: 'abc-name' }, ab.name, ult ? h('span', { class: 'tag ult' }, 'ULTIMATE') : basic ? h('span', { class: 'tag gold' }, ab.offhand ? 'OFF-HAND ATTACK' : 'WEAPON ATTACK') : null),
        h('div', { class: 'abc-type' }, [ab.type, ab.style, ab.reach ? `reach ${n2(ab.reach)}` : null].filter(Boolean).join(' · '))),
      h('div', { class: 'abc-cost' },
        h('div', { class: 'big-en' }, ult ? 'FULL CHARGE' : basic ? 'FREE' : `⚡ ${ab.energy}`),
        h('div', { class: 'muted' }, ult ? `${n2(ab.windup || 1)}s charge-up` : `every ${n2(ab.cooldown)}s${ab.windup ? ` · ${n2(ab.windup)}s windup` : ''}`))),
    ab.description ? h('p', { class: 'abc-desc' }, ab.description) : null,
    fields.length ? h('dl', { class: 'kv-grid tight' }, fields.map(([k, v]) => h('div', { class: 'kv' }, h('dt', null, k), h('dd', null, v)))) : null,
    fx.length ? h('div', { class: 'ab-fx' }, fx) : null,
    !basic && c && c.value !== undefined ? h('div', { class: 'abc-formula', title: 'energy = max(1, round(scale × value × delivery × windupMod × cooldownMod)), computed from the design before traits' },
      h('span', { class: 'muted' }, 'Cost '),
      h('span', null, `value ${n2(c.value)}`), h('i', null, '×'), h('span', null, `delivery ${n2(c.delivery)}`), h('i', null, '×'),
      h('span', null, `windup ${n2(c.windupMod)}`), h('i', null, '×'), h('span', null, `cooldown ${n2(c.cooldownMod)}`),
      h('i', null, '→'), h('b', null, `${c.energy} energy`)) : null,
    changedByTraits ? h('div', { class: 'abc-notes' }, h('span', { class: 'muted' }, 'Designed as '), `${n2(design.cooldown)}s cooldown, ${n2(design.windup)}s windup, ${design.energy} energy`) : null,
    ab.traitNotes && ab.traitNotes.length ? h('ul', { class: 'abc-trait-notes' }, ab.traitNotes.map(t => h('li', null, t))) : null);
}

// ── weapon ──────────────────────────────────────────────────────────────────
/** The weapon a fighter carries. compact = one line for the Live overview. */
export function weaponBlock(spec, rules, { compact = false } = {}) {
  const w = weaponOf(spec, rules);
  if (!w) return null;
  const basic = basicAttack(spec);
  const nums = basic ? abilityNumbers(basic).join(' · ') : '';
  const kind = w.kind ? w.kind : (basic ? basic.type : '');
  if (compact) {
    return h('div', { class: 'weapon-line', title: `${w.name}${kind ? ` (${kind})` : ''} — ${w.passiveText || ''}` },
      h('span', { class: 'ab-ic gold' }, weaponIcon(w, basic)),
      h('span', { class: 'wl-name' }, w.name),
      basic ? h('span', { class: 'wl-atk' }, `${basic.name}: ${nums} · every ${n2(basic.cooldown)}s`) : null,
      w.passiveText ? h('span', { class: 'wl-passive' }, w.passiveText) : null);
  }
  return h('div', { class: 'weapon-card' },
    h('span', { class: 'ab-ic big gold' }, weaponIcon(w, basic)),
    h('div', { class: 'wc-main' },
      h('div', { class: 'wc-name' }, w.name, kind ? h('span', { class: 'tag' }, kind) : null),
      basic ? h('div', { class: 'wc-atk' }, h('b', null, basic.name), ` — ${nums}, every ${n2(basic.cooldown)}s${basic.windup ? `, ${n2(basic.windup)}s windup` : ''} · free`) : null,
      w.passiveText ? h('div', { class: 'wc-passive' }, h('span', { class: 'muted' }, 'Passive: '), w.passiveText) : null,
      basic && effectChips(basic).length ? h('div', { class: 'ab-fx' }, fxChips(basic)) : null));
}

// ── what changed since the last round (server diff on a live card) ──────────
export function diffChips(store, d, spec = null) {
  const chips = [];
  if (!d) return chips;
  const tname = (id) => (store.rules.traits[id] ? store.rules.traits[id].name : id);
  const short = (k) => statMeta(store.rules, k).short;
  // The weapon attack is part of the ability list: show a weapon swap as one chip and
  // ignore the level scaling of its damage (that isn't something the AI changed).
  const basic = spec ? basicAttack(spec) : null;
  const basicName = basic ? basic.name.toLowerCase() : null;
  const attackNames = weaponAttackNames(store.rules);
  const abs = d.abilities || [];
  const swapped = !!basicName && abs.some(a => a.kind === 'added' && a.name.toLowerCase() === basicName);
  if (d.nameChanged) chips.push(h('span', { class: 'chip name', title: 'Renamed' }, `was “${d.nameChanged}”`));
  const w = spec ? weaponOf(spec, store.rules) : null;
  if (d.weaponChanged || d.weapon || swapped) chips.push(h('span', { class: 'chip up', title: 'New weapon (and weapon attack)' }, `weapon: ${w ? w.name : (typeof (d.weaponChanged || d.weapon) === 'string' ? (d.weaponChanged || d.weapon) : 'new')}`));
  for (const [k, v] of Object.entries(d.stats || {})) chips.push(h('span', { class: `chip ${v > 0 ? 'up' : 'down'}` }, `${short(k)} ${v > 0 ? '+' : ''}${v}`));
  for (const t of (d.traits && d.traits.added) || []) chips.push(h('span', { class: 'chip up' }, `+ ${tname(t)}`));
  for (const t of (d.traits && d.traits.removed) || []) chips.push(h('span', { class: 'chip down' }, `− ${tname(t)}`));
  for (const a of abs) {
    const lname = a.name.toLowerCase();
    if (a.basic || (basicName && lname === basicName)) continue;
    if (a.kind === 'removed' && swapped && attackNames.has(lname)) continue;
    if (a.kind === 'added') chips.push(h('span', { class: 'chip up' }, `+ ${a.name}`));
    else if (a.kind === 'removed') chips.push(h('span', { class: 'chip down' }, `− ${a.name}`));
    else chips.push(h('span', { class: 'chip', title: (a.changes || []).map(c => `${c.field}: ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}`).join('\n') }, `${a.name}: ${(a.changes || []).map(c => c.field).slice(0, 3).join(', ')}${(a.changes || []).length > 3 ? '…' : ''}`));
  }
  if (d.brain && (d.brain.added || d.brain.removed)) chips.push(h('span', { class: 'chip' }, `brain +${d.brain.added} −${d.brain.removed}`));
  if (d.spriteChanged || d.lookChanged) chips.push(h('span', { class: 'chip up' }, 'new look'));
  return chips;
}

/** Patch notes between two versions (archived match.rounds[].fighters[id] or a live/replay spec) → [[kind, text]]. */
export function patchNotes(store, prev, cur) {
  if (!prev || !cur) return null;
  const notes = [];
  const tname = (id) => (store.rules.traits[id] ? store.rules.traits[id].name : id);
  if (prev.name !== cur.name) notes.push(['name', `was “${prev.name}”`]);
  const pw = prev.weapon && (prev.weapon.id || prev.weapon), cw = cur.weapon && (cur.weapon.id || cur.weapon);
  const lastName = (v) => { const l = (v.abilities || []); const b = l.find(a => a.basic) || l[l.length - 1]; return b ? String(b.name).toLowerCase() : null; };
  const attackNames = weaponAttackNames(store.rules);
  const swapped = pw ? pw !== cw : (cw && attackNames.has(lastName(prev) || '') && lastName(prev) !== lastName(cur));
  if (cw && swapped) notes.push(['up', `weapon: ${(cur.weapon && cur.weapon.name) || cw}`]);
  for (const k of statKeys(store.rules, cur.stats)) {
    const d = ((cur.stats || {})[k] || 0) - ((prev.stats || {})[k] || 0);
    if (d) notes.push([d > 0 ? 'up' : 'down', `${d > 0 ? '+' : ''}${d} ${statMeta(store.rules, k).short}`]);
  }
  const pt = new Set(prev.traits || []), ct = new Set(cur.traits || []);
  for (const t of ct) if (!pt.has(t)) notes.push(['up', `+ ${tname(t)}`]);
  for (const t of pt) if (!ct.has(t)) notes.push(['down', `− ${tname(t)}`]);
  const names = (v) => new Set(archivedAbilities(v, store.rules).map(a => a.name));
  const pa = names(prev), ca = names(cur);
  for (const a of ca) if (!pa.has(a)) notes.push(['up', `+ ${a}`]);
  for (const a of pa) if (!ca.has(a)) notes.push(['down', `− ${a}`]);
  return notes;
}

// ── feed items (per-AI activity + arena log) ───────────────────────────────
export const FEED_ICON = { say: '💬', file: '💾', test: '⚔️', ready: '✅', error: '⚠️', round: '🔔', result: '🏆', match: '🏁', clock: '⏱' };
export function feedItem(f, { fresh = false, who = null } = {}) {
  return h('div', { class: `feed-item k-${f.kind}${fresh ? ' fresh' : ''}`, style: who && who.color ? `--wc:${who.color}` : null },
    h('span', { class: 'fi-ic', 'aria-hidden': 'true' }, FEED_ICON[f.kind] || '•'),
    h('span', { class: 'fi-t' }, who ? h('b', { class: 'fi-who' }, who.label) : null, f.text),
    h('time', { class: 'fi-time', title: new Date(f.at).toLocaleString() }, clockTime(f.at)));
}
export function relTime(ts) { return ago(ts); }

// ── look (cosmetic fields from fighter.json "look") ─────────────────────────
const HEXRE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
export function lookList(look) {
  if (!look || typeof look !== 'object') return null;
  const rows = [];
  const swatch = (v) => h('span', { class: 'swatch', style: `background:${v}` });
  const val = (v) => {
    if (typeof v === 'string' && HEXRE.test(v)) return [swatch(v), h('code', null, v)];
    if (v && typeof v === 'object') return Object.entries(v).map(([k, x]) => h('span', { class: 'look-sub' }, `${k} `, typeof x === 'string' && HEXRE.test(x) ? [swatch(x), h('code', null, x)] : String(x)));
    if (v === null || v === undefined || v === '') return '—';
    return String(v);
  };
  for (const [k, v] of Object.entries(look)) rows.push([cap(k.replace(/([A-Z])/g, ' $1').toLowerCase()), val(v)]);
  return h('dl', { class: 'kv-grid look' }, rows.map(([k, v]) => h('div', { class: 'kv' }, h('dt', null, k), h('dd', null, v))));
}

// ── animation tiles (one animation each, for the Fighters page) ─────────────
const ANIM_ORDER = ['idle', 'walk', 'move', 'attack', 'cast', 'dash', 'block', 'hurt', 'ko', 'victory'];
const ANIM_FPS = { idle: 4, walk: 9, move: 9, attack: 9, cast: 7, dash: 12, block: 5, hurt: 6, ko: 6, victory: 6 };
const tiles = new Set();
// Does sprites.js's spriteAnimator accept {anim}? (the art agent adds it; the old one only cycles)
const ANIM_OPT = (() => {
  try {
    const src = String(spriteAnimator);
    const params = src.slice(0, src.indexOf(')'));
    return /\banim\b/.test(params) || /\.anim\b/.test(src) || /[{,]\s*anim\s*[=,}]/.test(src);
  } catch { return false; }
})();

/** Names of the animations a sprite has, in a sensible order, with frame counts. */
export function spriteAnims(sprite, colors) {
  let frames = {};
  try { frames = pixelSprite(sprite, colors).frames || {}; } catch { frames = {}; }
  const names = Object.keys(frames).filter(k => Array.isArray(frames[k]) && frames[k].length);
  names.sort((a, b) => (ANIM_ORDER.indexOf(a) + 1 || 99) - (ANIM_ORDER.indexOf(b) + 1 || 99));
  if (names.includes('walk') && names.includes('move')) names.splice(names.indexOf('move'), 1);
  return names.map(n => ({ name: n, frames: frames[n].length }));
}

/** A canvas that plays one animation of a sprite on a loop. */
export function animPlayer(sprite, colors, anim, { scale = 3 } = {}) {
  if (ANIM_OPT) {
    try {
      const a = spriteAnimator(sprite, colors, { scale, anim, sequence: false });
      if (a && a.el) return a.el;
    } catch { /* fall back */ }
  }
  let entry;
  try { entry = pixelSprite(sprite, colors); } catch { entry = null; }
  const frames = (entry && entry.frames && (entry.frames[anim] || (anim === 'walk' && entry.frames.move) || (anim === 'move' && entry.frames.walk) || entry.frames.idle)) || [];
  const size = (frames[0] && frames[0].width) || 32;
  const c = h('canvas', { class: 'px-img' });
  c.width = c.height = size;
  c.style.width = c.style.height = `${size * scale}px`;
  const g = c.getContext('2d');
  const fps = ANIM_FPS[anim] || 6;
  const once = anim === 'ko';
  const t0 = performance.now();
  const tile = {
    el: c, last: null,
    draw(now) {
      if (!frames.length) return;
      let i = Math.floor((Math.max(0, now - t0) / 1000) * fps);
      if (once) i = Math.min(frames.length - 1, i % (frames.length + Math.round(fps * 1.2)));
      else i %= frames.length;
      const fr = frames[i];
      if (!fr || fr === tile.last) return;
      tile.last = fr;
      g.clearRect(0, 0, size, size);
      try { g.drawImage(fr, 0, 0); } catch { /* not a drawable frame */ }
    },
  };
  tiles.add(tile);
  tile.draw(t0);
  return c;
}

export function tickTiles(now) {
  for (const t of tiles) {
    if (!t.el.isConnected) { tiles.delete(t); continue; }
    t.draw(now);
  }
}

/** A small "keyboard key" label. */
export function kbd(k) { return h('kbd', null, k); }

