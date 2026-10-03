// ─────────────────────────────────────────────────────────────────────────────
//  STATS tab: sub-pages Overview (score + highlights) · Rounds (the table view
//  of every chart) · Charts (damage, accuracy, coding time, HP over time) ·
//  Evolution (how each fighter changed) · All-time.
// ─────────────────────────────────────────────────────────────────────────────
import { $, h, clear, add, num, pct, chartColor, clockTime, dateTime, mmss, statKeys, statMeta, archivedAbilities, relicsOf, godPowersOf, STANCE_INFO, prefStr, setPrefStr } from './util.js';
import { spriteImg } from './sprites.js';
import { tabBar, traitChips } from './ui-kit.js';

const SVGNS = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) el.setAttribute(k, v);
  for (const c of children) if (c !== null && c !== undefined) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return el;
}

// Axis scale with round tick steps (1, 2, 2.5, 5 × 10^k) and 3–5 ticks.
function niceScale(v) {
  if (!(v > 0)) return { max: 1, step: 0.25 };
  const raw = v / 4;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  let step = 10 * p;
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= raw) { step = m * p; break; }
  return { max: Math.ceil(v / step) * step, step };
}

// Coding time for one AI in one round (rounds from before tracking fall back to build time).
function codingMs(r, id) {
  const a = r.activity && r.activity[id];
  if (a && a.codingMs !== null && a.codingMs !== undefined) return a.codingMs;
  const f = r.fighters[id];
  return f && f.buildMs ? f.buildMs : null;
}
function autoLocked(r, id) {
  const a = r.activity && r.activity[id];
  return !!(a && a.autoLocked && a.autoLocked !== 'host') || !!(r.fighters[id] && r.fighters[id].autoLocked);
}

// ── tooltip ──────────────────────────────────────────────────────────────────
const tip = () => $('#tooltip');
function showTip(evt, title, rows) {
  const t = clear(tip());
  t.append(h('div', { class: 'tt-h' }, title));
  for (const r of rows) t.append(h('div', { class: 'tt-r' }, h('i', { style: `background:${r.color}` }), h('b', null, r.value), h('span', null, r.label)));
  t.hidden = false;
  const pad = 14;
  const w = t.offsetWidth, hh = t.offsetHeight;
  let x = evt.clientX + pad, y = evt.clientY + pad;
  if (x + w > window.innerWidth - 8) x = evt.clientX - w - pad;
  if (y + hh > window.innerHeight - 8) y = evt.clientY - hh - pad;
  t.style.left = `${x}px`;
  t.style.top = `${y}px`;
}
function hideTip() { tip().hidden = true; }

// ── charts ───────────────────────────────────────────────────────────────────
function legend(series, kind = 'rect') {
  return h('div', { class: 'legend' }, series.map(se => h('span', { class: 'key' },
    kind === 'line' ? h('i', { class: 'ln', style: `background:${se.color}` }) : h('i', { style: `--c:${se.color};background:${se.color}` }),
    se.name)));
}

/** Grouped columns: one group per round, one column per fighter. */
function columnChart({ categories, series, valueFmt = (v) => num(v), height = 250, fixedMax = null, width = 620, label = '' }) {
  const W = width, H = height;
  const m = { l: 48, r: 12, t: 18, b: 30 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b;
  const { max, step } = fixedMax ? { max: fixedMax, step: fixedMax / 4 } : niceScale(Math.max(1, ...series.flatMap(se => se.values.filter(v => v !== null && v !== undefined))));
  const y = (v) => m.t + ph - (v / max) * ph;
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': label });
  const grid = s('g', { class: 'grid' });
  const axis = s('g', { class: 'axis' });
  for (let v = 0; v <= max + step / 2; v += step) {
    const yy = y(v);
    if (v > 0) grid.appendChild(s('line', { x1: m.l, x2: W - m.r, y1: yy, y2: yy }));
    axis.appendChild(s('text', { x: m.l - 8, y: yy + 4, 'text-anchor': 'end' }, valueFmt(v)));
  }
  svg.append(grid, axis, s('line', { class: 'baseline', x1: m.l, x2: W - m.r, y1: m.t + ph, y2: m.t + ph }));
  const band = pw / Math.max(1, categories.length);
  const gap = 2;
  const bw = Math.min(24, (band * 0.7 - gap * (series.length - 1)) / series.length);
  const groupW = bw * series.length + gap * (series.length - 1);
  const marks = s('g');
  const labels = s('g');
  // Label selectively: each series' peak, but never two labels in one group.
  const maxIdx = series.map(se => { let bi = -1, bv = -Infinity; se.values.forEach((v, i) => { if (v !== null && v !== undefined && v > bv) { bv = v; bi = i; } }); return bi; });
  series.forEach((se, si) => {
    series.forEach((other, oi) => {
      if (oi !== si && maxIdx[oi] === maxIdx[si] && maxIdx[si] >= 0) {
        const a = se.values[maxIdx[si]], b = other.values[maxIdx[oi]];
        if (a < b || (a === b && si > oi)) maxIdx[si] = -1;
      }
    });
  });
  categories.forEach((cat, ci) => {
    const gx = m.l + band * ci + (band - groupW) / 2;
    axis.appendChild(s('text', { x: m.l + band * ci + band / 2, y: H - 10, 'text-anchor': 'middle' }, cat));
    series.forEach((se, si) => {
      const v = se.values[ci];
      if (v === null || v === undefined) return;
      const x = gx + si * (bw + gap);
      const top = y(v), base = m.t + ph;
      const r = Math.min(4, bw / 2, Math.max(0, base - top));
      const d = `M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${base} Z`;
      const bar = s('path', { d, fill: se.color, class: 'mark' });
      marks.appendChild(bar);
      if (maxIdx[si] === ci && bw >= 12) labels.appendChild(s('text', { class: 'lbl', x: x + bw / 2, y: top - 5, 'text-anchor': 'middle' }, valueFmt(v)));
      const hit = s('rect', { class: 'hit', x: x - gap / 2, y: m.t, width: bw + gap, height: ph + 4, tabindex: '0' });
      const show = (evt) => { bar.classList.add('hl'); showTip(evt, cat, series.map(q => ({ color: q.color, value: q.values[ci] === null || q.values[ci] === undefined ? '—' : valueFmt(q.values[ci]), label: q.name }))); };
      hit.addEventListener('pointermove', show);
      hit.addEventListener('pointerleave', () => { bar.classList.remove('hl'); hideTip(); });
      hit.addEventListener('focus', () => { const b = hit.getBoundingClientRect(); show({ clientX: b.right, clientY: b.top }); });
      hit.addEventListener('blur', () => { bar.classList.remove('hl'); hideTip(); });
      marks.appendChild(hit);
    });
  });
  svg.append(marks, labels);
  return h('div', { class: 'chart' }, svg);
}

/** HP % over time for one round (two lines). */
function hpMultiple(round, series) {
  const W = 260, H = 118;
  const m = { l: 30, r: 10, t: 8, b: 18 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b;
  const pts = round.timeline || [];
  const tMax = Math.max(1, ...pts.map(p => p[0]));
  const x = (t) => m.l + (t / tMax) * pw;
  const y = (v) => m.t + ph - v * ph;
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `HP over time, round ${round.round}` });
  const grid = s('g', { class: 'grid' });
  const axis = s('g', { class: 'axis' });
  for (const v of [0.5, 1]) grid.appendChild(s('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }));
  for (const v of [0, 0.5, 1]) axis.appendChild(s('text', { x: m.l - 6, y: y(v) + 4, 'text-anchor': 'end' }, `${Math.round(v * 100)}%`));
  axis.appendChild(s('text', { x: m.l, y: H - 4, 'text-anchor': 'start' }, '0s'));
  axis.appendChild(s('text', { x: W - m.r, y: H - 4, 'text-anchor': 'end' }, `${Math.round(tMax)}s`));
  svg.append(grid, axis, s('line', { class: 'baseline', x1: m.l, x2: W - m.r, y1: y(0), y2: y(0) }));
  series.forEach((se, si) => {
    if (!pts.length) return;
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1 + si]).toFixed(1)}`).join(' ');
    svg.appendChild(s('path', { d, fill: 'none', stroke: se.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    const last = pts[pts.length - 1];
    svg.appendChild(s('circle', { cx: x(last[0]), cy: y(last[1 + si]), r: 4, fill: se.color, stroke: '#0f131c', 'stroke-width': 2 }));
  });
  // crosshair + tooltip
  const cross = s('line', { x1: 0, x2: 0, y1: m.t, y2: m.t + ph, stroke: 'rgba(255,255,255,.35)', 'stroke-width': 1, visibility: 'hidden' });
  const hit = s('rect', { class: 'hit', x: m.l, y: m.t, width: pw, height: ph });
  hit.addEventListener('pointermove', (evt) => {
    if (!pts.length) return;
    const b = svg.getBoundingClientRect();
    const sx = ((evt.clientX - b.left) / b.width) * W;
    const t = ((sx - m.l) / pw) * tMax;
    let best = pts[0];
    for (const p of pts) if (Math.abs(p[0] - t) < Math.abs(best[0] - t)) best = p;
    cross.setAttribute('x1', x(best[0]));
    cross.setAttribute('x2', x(best[0]));
    cross.setAttribute('visibility', 'visible');
    showTip(evt, `Round ${round.round} · ${best[0]}s`, series.map((se, si) => ({ color: se.color, value: pct(best[1 + si]), label: se.name })));
  });
  hit.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); hideTip(); });
  svg.append(cross, hit);
  return svg;
}

const SUBS = [
  { id: 'overview', label: 'Overview' },
  { id: 'rounds', label: 'Rounds' },
  { id: 'charts', label: 'Charts' },
  { id: 'evolution', label: 'Evolution' },
  { id: 'alltime', label: 'All-time' },
];

// ── screen ───────────────────────────────────────────────────────────────────
export class StatsScreen {
  constructor(api) {
    this.api = api;
    this.root = $('#stats');
    this.dirty = true;
    this.history = null;
    this.sub = prefStr('aifight-stats-tab', 'overview');
    if (!SUBS.some(x => x.id === this.sub)) this.sub = 'overview';
    this.built = false;
  }
  get store() { return this.api.store; }

  invalidate() { this.dirty = true; }

  enter() { this.dirty = true; this.render(); this.loadHistory(); }
  refresh() { if (this.dirty) this.render(); }
  tick() { if (this.dirty) this.render(); }

  /** Jump to a sub-page (used by the app after End Match). */
  show(sub) {
    if (SUBS.some(x => x.id === sub)) { this.sub = sub; if (this.tabs) this.tabs.select(sub, true); this.dirty = true; }
  }

  async loadHistory() {
    try {
      const r = await fetch('/api/history');
      if (r.ok) { this.history = await r.json(); this.dirty = true; }
    } catch { /* ignore */ }
  }

  build() {
    const root = clear(this.root);
    this.headEl = h('div', { class: 'page-head' });
    this.tabs = tabBar(SUBS, {
      active: this.sub, cls: 'page-tabs', label: 'Statistics sections',
      onSelect: (id) => { this.sub = id; setPrefStr('aifight-stats-tab', id); this.renderBody(); this.bodyEl.scrollTop = 0; },
    });
    this.bodyEl = h('div', { class: 'page-body', role: 'tabpanel' });
    root.append(this.headEl, this.tabs.el, this.bodyEl);
    this.built = true;
  }

  render() {
    this.dirty = false;
    if (!this.built) this.build();
    this.renderHead();
    this.renderBody();
  }

  renderHead() {
    const st = this.store.state;
    const match = this.store.match || { rounds: [] };
    const rounds = match.rounds || [];
    const over = st.phase === 'match_over';
    add(clear(this.headEl), 
      h('div', { class: 'ph-title' },
        h('h1', null, `Match ${match.matchNumber || st.matchNumber}`, h('span', { class: 'muted' }, over ? ' · final statistics' : ' · statistics so far')),
        h('div', { class: 'sub' }, `${rounds.length} round${rounds.length === 1 ? '' : 's'} fought${match.startedAt ? ` · started ${clockTime(match.startedAt)}` : ''}`)),
      h('span', { class: 'sp' }),
      (() => { const md = this.store.state && this.store.state.mode && this.store.state.mode !== 'fighter' ? this.store.state.mode : null;
        return md ? h('a', { class: 'btn ghost small', href: `/api/csv/${md}-rounds`, download: `ai-fight-${md}-rounds.csv`, title: `Every round of every ${md} match (results/${md}-rounds.csv)` }, '⬇ Rounds CSV')
          : h('a', { class: 'btn ghost small', href: '/api/csv/rounds', download: 'ai-fight-rounds.csv', title: 'Every round of every match (results/rounds.csv)' }, '⬇ Rounds CSV'); })(),
      h('a', { class: 'btn ghost small', href: '/api/csv/matches', download: 'ai-fight-matches.csv', title: 'One row per finished match (results/matches.csv)' }, '⬇ Matches CSV'),
      over ? h('button', { class: 'btn primary', onclick: () => this.api.newMatch() }, '＋ New match…') : null);
  }

  renderBody() {
    const st = this.store.state;
    const cfg = this.store.config.fighters;
    const match = this.store.match || { rounds: [] };
    const rounds = match.rounds || [];
    const mm = this.modeOf(match) || (st.mode && st.mode !== 'fighter' ? st.mode : null);
    const series = cfg.map(f => ({ id: f.id, name: f.label, color: chartColor(f.color), ui: f.color }));
    const over = st.phase === 'match_over';
    const body = clear(this.bodyEl);
    const noRounds = () => h('div', { class: 'pbox st-card empty-note' }, 'No rounds fought yet in this match. This page fills in after the first fight.');
    switch (this.sub) {
      case 'overview':
        body.append(this.hero(rounds, cfg, st, over));
        if (!rounds.length) body.append(noRounds());
        else body.append(mm ? this.modeTiles(rounds, cfg) : this.tiles(rounds, cfg), this.roundStrip(rounds, cfg, match));
        break;
      case 'rounds':
        body.append(rounds.length ? (mm ? this.modeRoundsTable(rounds, cfg, match) : this.roundsTable(rounds, cfg, match)) : noRounds());
        break;
      case 'charts': {
        if (!rounds.length) { body.append(noRounds()); break; }
        if (mm) { body.append(this.modeCharts(rounds, cfg, series)); break; }
        const cats = rounds.map(r => `R${r.round}`);
        body.append(h('div', { class: 'st-grid2' },
          h('div', { class: 'pbox st-card' },
            h('h2', null, 'Damage dealt per round'),
            h('div', { class: 'cap' }, 'Total damage each fighter landed (including damage over time and zones).'),
            legend(series),
            columnChart({ label: 'Damage dealt per round', categories: cats, series: series.map(se => ({ ...se, values: rounds.map(r => r.fighters[se.id].summary.dealt) })) })),
          h('div', { class: 'pbox st-card' },
            h('h2', null, 'Accuracy per round'),
            h('div', { class: 'cap' }, 'Share of attacks (swings, projectiles, bursts, dash strikes) that connected.'),
            legend(series),
            columnChart({ label: 'Accuracy per round', categories: cats, series: series.map(se => ({ ...se, values: rounds.map(r => { const a = r.fighters[se.id].summary.accuracy; return a === null || a === undefined ? null : Math.round(a * 100); }) })), valueFmt: (v) => `${Math.round(v)}%`, fixedMax: 100 }))));
        body.append(h('div', { class: 'pbox st-card' },
          h('h2', null, 'Coding time per round'),
          h('div', { class: 'cap' }, 'Minutes from each AI’s first save or arena command until it locked in. Rounds where the build clock ran out are marked in Rounds.'),
          legend(series),
          columnChart({ label: 'Coding time per round', categories: cats, height: 240, width: 1280, series: series.map(se => ({ ...se, values: rounds.map(r => { const ms = codingMs(r, se.id); return ms === null ? null : Math.round(ms / 6000) / 10; }) })), valueFmt: (v) => `${Math.round(v * 10) / 10}m` })));
        body.append(h('div', { class: 'pbox st-card' },
          h('h2', null, 'HP over time, round by round'),
          h('div', { class: 'cap' }, 'Each panel is one fight. Hover to read both fighters’ HP at any moment.'),
          legend(series, 'line'),
          h('div', { class: 'multiples chart' }, rounds.map(r => {
            const w = r.result.winnerId;
            const wl = w ? (cfg.find(f => f.id === w) || { label: w }).label : 'Draw';
            return h('div', { class: 'multiple' },
              h('div', { class: 'mh' }, h('b', null, `Round ${r.round}`), h('span', null, `${wl}${w ? ' won' : ''} · ${r.result.method === 'KO' ? `KO ${r.result.time}s` : r.result.method.toLowerCase()}`)),
              hpMultiple(r, series));
          }))));
        body.append(h('div', { class: 'muted note-line' }, 'Every number behind these charts is in the Rounds table.'));
        break;
      }
      case 'evolution':
        body.append(rounds.length ? (mm ? this.modeEvolution(rounds, cfg) : this.evolution(rounds, cfg, match)) : noRounds());
        break;
      case 'alltime':
        add(body, this.allTime(cfg));
        break;
      default: break;
    }
  }

  hero(rounds, cfg, st, over) {
    const last = rounds[rounds.length - 1];
    const side = (f, i) => {
      const card = this.store.cards[f.id];
      const ver = last ? last.fighters[f.id] : null;
      const name = ver ? ver.name : card && card.exists ? (card.name || card.spec.name) : f.label;
      const title = ver ? ver.title : card && card.exists ? card.spec.title : '';
      const other = this.modeOf(this.store.match) || (st.mode && st.mode !== 'fighter');
      const img = other ? h('div', { class: 'mode-vs-emblem', style: `--ec:${(ver && ver.colors && ver.colors.primary) || (card && card.colors && card.colors.primary) || f.color}` }, h('span', null, String(name || f.label).split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?'))
        : ver ? this.archivedSprite(this.store.match.matchId, last.round, f.id, ver.colors) : spriteImg(card && card.sprite, card ? card.spec.colors : {}, {});
      return h('div', { class: `side${i ? ' right' : ''}`, style: `--c:${f.color}` }, img,
        h('div', null, h('div', { class: 'ai' }, f.label.toUpperCase()), h('div', { class: 'nm' }, name || f.label), title ? h('div', { class: 'ttl' }, title) : null));
    };
    const [a, b] = cfg;
    const sa = st.score[a.id] || 0, sb = st.score[b.id] || 0;
    let verdict;
    if (!rounds.length) verdict = 'Waiting for the first round';
    else if (sa === sb) verdict = over ? 'The match ends level' : 'All square';
    else {
      const lead = sa > sb ? a : b;
      verdict = over ? `${lead.label} wins the match ${Math.max(sa, sb)}–${Math.min(sa, sb)}` : `${lead.label} leads`;
    }
    return h('div', { class: 'pbox st-hero' }, side(a, 0),
      h('div', null,
        h('div', { class: 'score' }, `${sa} – ${sb}`, h('small', null, st.score.draws ? `ROUNDS WON · ${st.score.draws} DRAW${st.score.draws > 1 ? 'S' : ''}` : 'ROUNDS WON')),
        h('div', { class: 'verdict' }, over && sa !== sb ? h('span', { class: 'crown' }, '👑 ') : null, verdict)),
      side(b, 1));
  }

  // ── other game modes (army, business…): stats built from each round's result rows ──
  modeOf(match) { const m = match && match.mode; return m && m.id ? m.id : m && m !== 'fighter' ? m : null; }

  modeRowLabels(rounds, n = 3) {
    const out = [];
    for (const r of rounds) for (const row of (r.resultRows || [])) {
      if (out.length >= n) break;
      if (typeof row[1] === 'number' && typeof row[2] === 'number' && !out.includes(row[0])) out.push(row[0]);
    }
    return out;
  }

  modeVal(r, label, i) {
    const row = (r.resultRows || []).find(x => x[0] === label);
    return row && typeof row[1 + i] === 'number' ? row[1 + i] : null;
  }

  modeTiles(rounds, cfg) {
    const who = (id) => { const f = cfg.find(x => x.id === id); return f ? h('div', { class: 'who', style: `--c:${f.color}` }, h('i'), f.label) : null; };
    const tile = (label, value, whoId, extra) => h('div', { class: 'tile' }, h('div', { class: 'lbl' }, label), h('div', { class: 'val' }, value), whoId ? who(whoId) : null, extra ? h('div', { class: 'lbl small' }, extra) : null);
    const tiles = [];
    for (const label of this.modeRowLabels(rounds, 3)) {
      let best = null;
      for (const r of rounds) {
        const row = (r.resultRows || []).find(x => x[0] === label);
        if (!row) continue;
        for (const i of [0, 1]) {
          const v = row[1 + i];
          if (typeof v !== 'number') continue;
          if (!best || (row[3] === 'low' ? v < best.v : v > best.v)) best = { v, id: cfg[i].id, round: r.round };
        }
      }
      tiles.push(tile(`Best · ${label}`, best ? num(Math.round(best.v * 10) / 10) : '—', best && best.id, best ? `round ${best.round}` : ''));
    }
    let quick = null;
    const codeTotal = {};
    for (const r of rounds) for (const f of cfg) {
      const ms = codingMs(r, f.id);
      if (ms !== null) codeTotal[f.id] = (codeTotal[f.id] || 0) + ms;
      if (ms !== null && !autoLocked(r, f.id) && (!quick || ms < quick.v)) quick = { v: ms, id: f.id, round: r.round };
    }
    const preds = rounds.filter(r => r.prediction);
    const hits = preds.filter(r => r.prediction === r.result.winnerId).length;
    const [a, b] = cfg;
    tiles.push(tile('Quickest lock-in', quick ? mmss(quick.v) : '—', quick && quick.id, quick ? `round ${quick.round}` : ''));
    tiles.push(tile('Total coding time', `${mmss(codeTotal[a.id] || 0)} / ${mmss(codeTotal[b.id] || 0)}`, null, `${a.label} / ${b.label}`));
    tiles.push(tile('Your predictions', preds.length ? `${hits}/${preds.length}` : '—', null, preds.length ? `${Math.round((hits / preds.length) * 100)}% correct` : 'pick a winner while the AIs build (1 / 2)'));
    return h('div', { class: 'pbox st-card' }, h('h2', null, 'Highlights'), h('div', { class: 'cap' }, 'Records from this match.'), h('div', { class: 'tiles' }, tiles));
  }

  modeRoundsTable(rounds, cfg, match) {
    const [a, b] = cfg;
    const labels = this.modeRowLabels(rounds, 2);
    const fmt = (v) => (v === null ? '—' : num(Math.round(v * 10) / 10));
    const winCell = (r) => {
      const f = cfg.find(x => x.id === r.result.winnerId);
      return h('div', { class: 'wcell' }, f ? h('span', { class: 'wtag', style: `--c:${f.color}` }, h('i'), f.label) : h('span', { class: 'wtag' }, 'Draw'));
    };
    const nameCell = (r, f) => { const v = r.fighters[f.id] || {}; return h('td', null, h('div', { class: 'fname' }, v.name || f.label), v.summary ? h('div', { class: 'fsub' }, v.summary) : null); };
    return h('div', { class: 'pbox st-card' },
      h('h2', null, 'Round by round'),
      h('div', { class: 'cap' }, 'Every round of this match.'),
      h('div', { class: 'table-scroll' }, h('table', { class: 'rounds-table' },
        h('thead', null, h('tr', null,
          h('th', null, 'Round'), h('th', null, 'Winner'), h('th', null, 'How'), h('th', { class: 'num' }, 'Time'),
          h('th', null, `${a.label}`), labels.map(l => h('th', { class: 'num' }, l)),
          h('th', null, `${b.label}`), labels.map(l => h('th', { class: 'num' }, l)),
          h('th', null, ''))),
        h('tbody', null, rounds.map(r => h('tr', null,
          h('td', null, String(r.round)), h('td', null, winCell(r)), h('td', null, r.result.text || String(r.result.method || '').toLowerCase()),
          h('td', { class: 'num' }, r.result.time !== undefined && r.result.time !== null ? `${r.result.time}s` : '—'),
          nameCell(r, a), labels.map(l => h('td', { class: 'num' }, fmt(this.modeVal(r, l, 0)))),
          nameCell(r, b), labels.map(l => h('td', { class: 'num' }, fmt(this.modeVal(r, l, 1)))),
          h('td', null, h('button', { class: 'btn ghost small', onclick: () => this.api.openReplay(match.matchId, r.round) }, '▶ Replay'))))))));
  }

  modeCharts(rounds, cfg, series) {
    const cats = rounds.map(r => `R${r.round}`);
    const out = [];
    for (const label of this.modeRowLabels(rounds, 4)) {
      out.push(h('div', { class: 'pbox st-card' }, h('h2', null, `${label} per round`), legend(series),
        columnChart({ label: `${label} per round`, categories: cats, series: series.map((se, i) => ({ ...se, values: rounds.map(r => this.modeVal(r, label, i)) })) })));
    }
    out.push(h('div', { class: 'pbox st-card' }, h('h2', null, 'Coding time per round'),
      h('div', { class: 'cap' }, 'Minutes from each AI’s first save or arena command until it locked in.'), legend(series),
      columnChart({ label: 'Coding time per round', categories: cats, height: 240, width: 1280, series: series.map(se => ({ ...se, values: rounds.map(r => { const ms = codingMs(r, se.id); return ms === null ? null : Math.round(ms / 6000) / 10; }) })), valueFmt: (v) => `${Math.round(v * 10) / 10}m` })));
    return h('div', null, h('div', { class: 'st-grid2' }, out.slice(0, -1)), out[out.length - 1]);
  }

  modeEvolution(rounds, cfg) {
    return h('div', { class: 'pbox st-card' },
      h('h2', null, 'How each AI evolved'),
      h('div', { class: 'cap' }, 'What each AI locked in for every round.'),
      h('div', { class: 'evo' }, cfg.map(f => h('div', { class: 'evo-row', style: `--c:${f.color}` },
        h('div', { class: 'evo-h' }, h('i'), f.label.toUpperCase(), h('span', { class: 'evo-n' }, `${rounds.length} round${rounds.length === 1 ? '' : 's'}`)),
        this.evoStrip(rounds.map(r => {
          const v = r.fighters[f.id] || {};
          const won = r.result.winnerId === f.id, lost = r.result.winnerId && !won;
          return h('div', { class: `evo-card${won ? ' won' : ''}` },
            h('div', null, h('div', { class: 'ev-r' }, `ROUND ${r.round} · LV ${r.level || r.round}`), h('div', { class: 'ev-n' }, v.name || f.label),
              h('div', { class: `ev-res ${won ? 'res-w' : lost ? 'res-l' : 'res-d'}` }, won ? 'WON' : lost ? 'LOST' : 'DRAW')),
            v.summary ? h('div', { class: 'ev-ab' }, v.summary) : null,
            (v.cardLines || []).length ? h('div', { class: 'ev-kit' }, v.cardLines.slice(0, 6).map(l => h('div', null, h('span', null, l)))) : null,
            v.notes ? h('div', { class: 'ev-notes' }, v.notes) : null);
        }))))));
  }

  archivedSprite(matchId, round, id, colors) {
    const rec = (this.store.match && this.store.match.rounds || []).find(r => r.round === round);
    const v = rec && rec.fighters[id];
    return spriteImg(v ? v.sprite : null, (v && v.colors) || colors || {}, {});
  }

  /** One chip per round: who won, how, with a replay button. */
  roundStrip(rounds, cfg, match) {
    return h('div', { class: 'pbox st-card' },
      h('h2', null, 'Round by round'),
      h('div', { class: 'round-strip' }, rounds.map(r => {
        const f = cfg.find(x => x.id === r.result.winnerId);
        return h('button', { class: 'rs-item', style: f ? `--c:${f.color}` : '', title: `Watch round ${r.round}`, onclick: () => this.api.openReplay(match.matchId, r.round) },
          h('span', { class: 'rs-r' }, `R${r.round}`),
          h('span', { class: 'rs-w' }, h('i'), f ? f.label : 'Draw'),
          h('span', { class: 'rs-how' }, r.result.method === 'KO' ? `K.O. ${r.result.time}s` : r.result.method.toLowerCase()),
          h('span', { class: 'rs-play' }, '▶'));
      })),
      h('div', { class: 'cap', style: 'margin:10px 0 0' }, 'Full numbers in Rounds · charts in Charts · more replays in the Replays tab.'));
  }

  tiles(rounds, cfg) {
    const who = (id) => { const f = cfg.find(x => x.id === id); return f ? h('div', { class: 'who', style: `--c:${f.color}` }, h('i'), f.label) : null; };
    let big = null, fast = null, most = null, acc = null;
    for (const r of rounds) {
      for (const f of cfg) {
        const sm = r.fighters[f.id].summary;
        if (!big || sm.biggestHit > big.v) big = { v: sm.biggestHit, id: f.id, ab: sm.biggestHitAbility, round: r.round };
        if (!most || sm.dealt > most.v) most = { v: sm.dealt, id: f.id, round: r.round };
        if (sm.accuracy !== null && sm.accuracy !== undefined && (!acc || sm.accuracy > acc.v)) acc = { v: sm.accuracy, id: f.id, round: r.round };
      }
      if (r.result.method === 'KO' && r.result.winnerId && (!fast || r.result.time < fast.v)) fast = { v: r.result.time, id: r.result.winnerId, round: r.round };
    }
    let quick = null;
    const codeTotal = {};
    for (const r of rounds) {
      for (const f of cfg) {
        const ms = codingMs(r, f.id);
        if (ms !== null) codeTotal[f.id] = (codeTotal[f.id] || 0) + ms;
        if (ms !== null && !autoLocked(r, f.id) && (!quick || ms < quick.v)) quick = { v: ms, id: f.id, round: r.round };
      }
    }
    const preds = rounds.filter(r => r.prediction);
    const hits = preds.filter(r => r.prediction === r.result.winnerId).length;
    const tile = (label, value, whoId, extra) => h('div', { class: 'tile' }, h('div', { class: 'lbl' }, label), h('div', { class: 'val' }, value), whoId ? who(whoId) : null, extra ? h('div', { class: 'lbl small' }, extra) : null);
    const [a, b] = cfg;
    return h('div', { class: 'pbox st-card' },
      h('h2', null, 'Highlights'),
      h('div', { class: 'cap' }, 'Records from this match.'),
      h('div', { class: 'tiles' },
        tile('Biggest hit', big ? num(big.v) : '—', big && big.id, big ? `${big.ab || ''} · round ${big.round}` : ''),
        tile('Fastest K.O.', fast ? `${fast.v}s` : '—', fast && fast.id, fast ? `round ${fast.round}` : 'no knockouts yet'),
        tile('Most damage in a round', most ? num(most.v) : '—', most && most.id, most ? `round ${most.round}` : ''),
        tile('Best accuracy', acc ? pct(acc.v) : '—', acc && acc.id, acc ? `round ${acc.round}` : ''),
        tile('Quickest lock-in', quick ? mmss(quick.v) : '—', quick && quick.id, quick ? `round ${quick.round}` : ''),
        tile('Total coding time', `${mmss(codeTotal[a.id] || 0)} / ${mmss(codeTotal[b.id] || 0)}`, null, `${a.label} / ${b.label}`),
        tile('Your predictions', preds.length ? `${hits}/${preds.length}` : '—', null, preds.length ? `${Math.round((hits / preds.length) * 100)}% correct` : 'pick a winner while the AIs build (1 / 2)')));
  }

  roundsTable(rounds, cfg, match) {
    const [a, b] = cfg;
    const fcell = (r, f) => {
      const v = r.fighters[f.id];
      const auto = autoLocked(r, f.id);
      return h('td', null, h('div', { class: 'fcell' }, this.archivedSprite(match.matchId, r.round, f.id, v.colors), h('div', null,
        h('div', { style: 'font-weight:700' }, v.name),
        h('div', { class: 'fsub' }, `coded ${mmss(codingMs(r, f.id))}`, auto ? h('span', { class: 'auto-tag', title: 'The build clock ran out and the arena auto-locked this fighter' }, 'TIME UP') : null,
          v.brainErrors ? ` · ${v.brainErrors} brain errors` : ''))));
    };
    const win = (r) => {
      const id = r.result.winnerId;
      const f = cfg.find(x => x.id === id);
      const pred = r.prediction ? h('span', { class: `pred-tag ${r.prediction === id ? 'hit' : 'miss'}`, title: `You predicted ${(cfg.find(x => x.id === r.prediction) || {}).label || r.prediction}` }, r.prediction === id ? '🔮✓' : '🔮✗') : null;
      return h('div', { class: 'wcell' }, f ? h('span', { class: 'wtag', style: `--c:${f.color}` }, h('i'), f.label) : h('span', { class: 'wtag' }, 'Draw'), pred,
        r.themeName ? h('div', { class: 'fsub' }, r.themeName) : null);
    };
    return h('div', { class: 'pbox st-card' },
      h('h2', null, 'Round by round'),
      h('div', { class: 'cap' }, 'Every number behind the charts.'),
      h('div', { class: 'table-scroll' }, h('table', { class: 'rounds-table' },
        h('thead', null, h('tr', null,
          h('th', null, 'Round'), h('th', null, 'Winner'), h('th', null, 'How'), h('th', { class: 'num' }, 'Time'),
          h('th', null, `${a.label} fighter`), h('th', { class: 'num' }, 'HP left'), h('th', { class: 'num' }, 'Dmg'), h('th', { class: 'num' }, 'Acc'),
          h('th', null, `${b.label} fighter`), h('th', { class: 'num' }, 'HP left'), h('th', { class: 'num' }, 'Dmg'), h('th', { class: 'num' }, 'Acc'),
          h('th', null, ''))),
        h('tbody', null, rounds.map(r => h('tr', null,
          h('td', null, String(r.round)), h('td', null, win(r)), h('td', null, r.result.method === 'KO' ? 'K.O.' : r.result.method.toLowerCase()),
          h('td', { class: 'num' }, `${r.result.time}s`),
          fcell(r, a), h('td', { class: 'num' }, `${Math.round(r.result.hpPct[a.id])}%`), h('td', { class: 'num' }, num(r.fighters[a.id].summary.dealt)), h('td', { class: 'num' }, pct(r.fighters[a.id].summary.accuracy)),
          fcell(r, b), h('td', { class: 'num' }, `${Math.round(r.result.hpPct[b.id])}%`), h('td', { class: 'num' }, num(r.fighters[b.id].summary.dealt)), h('td', { class: 'num' }, pct(r.fighters[b.id].summary.accuracy)),
          h('td', null, h('button', { class: 'btn ghost small', onclick: () => this.api.openReplay(match.matchId, r.round) }, '▶ Replay'))))))));
  }

  evolution(rounds, cfg, match) {
    const rules = this.store.rules;
    return h('div', { class: 'pbox st-card' },
      h('h2', null, 'How each fighter evolved'),
      h('div', { class: 'cap' }, 'The version each AI locked in for every round: stat changes from its previous version, its abilities, traits and its own notes. Round 1 is the shared starter. The Fighters tab has the full details.'),
      h('div', { class: 'evo' }, cfg.map(f => h('div', { class: 'evo-row', style: `--c:${f.color}` },
        h('div', { class: 'evo-h' }, h('i'), f.label.toUpperCase(), h('span', { class: 'evo-n' }, `${rounds.length} round${rounds.length === 1 ? '' : 's'}${rounds.length > 3 ? ' · scroll →' : ''}`)),
        this.evoStrip(rounds.map((r, i) => {
          const v = r.fighters[f.id];
          const prev = i > 0 ? rounds[i - 1].fighters[f.id] : null;
          const won = r.result.winnerId === f.id;
          const lost = r.result.winnerId && !won;
          const keys = statKeys(rules, v.stats);
          return h('div', { class: `evo-card${won ? ' won' : ''}` },
            h('div', { class: 'ev-top' }, this.archivedSprite(match.matchId, r.round, f.id, v.colors),
              h('div', null, h('div', { class: 'ev-r' }, `ROUND ${r.round} · LV ${r.level || Math.min(4, r.round)}`), h('div', { class: 'ev-n' }, v.name),
                h('div', { class: `ev-res ${won ? 'res-w' : lost ? 'res-l' : 'res-d'}` }, won ? 'WON' : lost ? 'LOST' : 'DRAW'))),
            h('div', { class: `ev-stats n${keys.length}` }, keys.map(k => {
              const cur = (v.stats || {})[k] || 0;
              const d = prev ? cur - ((prev.stats || {})[k] || 0) : 0;
              return h('div', { class: d > 0 ? 'd-up' : d < 0 ? 'd-down' : '', title: `${statMeta(rules, k).label}${prev && d ? ` ${d > 0 ? '+' : ''}${d} vs round ${rounds[i - 1].round}` : ''}` }, h('b', null, String(cur)), statMeta(rules, k).short);
            })),
            this.evoKit(v, rules),
            h('div', { class: 'ev-ab' }, archivedAbilities(v, rules).filter(a => !a.ultimate).map(a => `${a.name} (${a.type})`).join(' · ') || 'no abilities'),
            v.traits && v.traits.length ? h('div', { class: 'chips' }, traitChips(this.store, v.traits)) : null,
            v.notes ? h('div', { class: 'ev-notes' }, v.notes) : null);
        }))))));
  }

  /** Weapon (+ off-hand), stance, relics, ultimate and godly powers of one locked-in version. */
  evoKit(v, rules) {
    const rows = [];
    const wName = (w) => (w && (w.name || w.id)) || null;
    const weapon = wName(v.weapon);
    if (weapon) rows.push(['🗡', `${weapon}${v.offhand ? ` / ${wName(v.offhand)}` : ''}`, v.offhand ? 'Weapon / off-hand' : 'Weapon']);
    if (v.stance && v.stance !== 'balanced') rows.push([(STANCE_INFO[v.stance] || {}).icon || '⚖', v.stance[0].toUpperCase() + v.stance.slice(1), (STANCE_INFO[v.stance] || {}).text || 'Starting stance']);
    const relics = relicsOf(v, rules);
    if (relics.length) rows.push(['💎', relics.map(r => r.name).join(', '), relics.map(r => `${r.name}${r.text ? `: ${r.text}` : ''}`).join('\n')]);
    if (v.ultimate && v.ultimate.name) rows.push(['★', `${v.ultimate.name} (${v.ultimate.type})`, 'Ultimate']);
    const gods = godPowersOf(v, rules);
    if (gods.length) rows.push(['✦', gods.map(g => g.name).join(', '), gods.map(g => `${g.name}${g.blurb ? `: ${g.blurb}` : ''}`).join('\n')]);
    if (!rows.length) return null;
    return h('div', { class: 'ev-kit' }, rows.map(([icon, text, title]) => h('div', { title }, h('i', { 'aria-hidden': 'true' }, icon), h('span', null, text))));
  }

  /** A horizontally scrolling, snapping strip that starts at the latest round. */
  evoStrip(cards) {
    const strip = h('div', { class: 'evo-cards', tabindex: '0', 'aria-label': 'Versions round by round (scroll sideways)' }, cards);
    const sync = () => { strip.classList.toggle('at-end', strip.scrollLeft + strip.clientWidth >= strip.scrollWidth - 6); strip.classList.toggle('at-start', strip.scrollLeft <= 6); };
    strip.addEventListener('scroll', sync, { passive: true });
    requestAnimationFrame(() => { strip.scrollLeft = strip.scrollWidth; sync(); });
    return strip;
  }

  allTime(cfg) {
    const hist = this.history && this.history.matches ? this.history.matches : [];
    const t = { matches: hist.length, matchWins: {}, roundWins: {}, kos: {}, draws: 0 };
    for (const f of cfg) { t.matchWins[f.id] = 0; t.roundWins[f.id] = 0; t.kos[f.id] = 0; }
    const code = {};
    for (const m of hist) {
      if (m.winnerId && t.matchWins[m.winnerId] !== undefined) t.matchWins[m.winnerId]++;
      for (const r of m.rounds || []) {
        if (r.winnerId && t.roundWins[r.winnerId] !== undefined) { t.roundWins[r.winnerId]++; if (r.method === 'KO') t.kos[r.winnerId]++; }
        else t.draws++;
        for (const f of cfg) { const v = r.codingMs && r.codingMs[f.id]; if (v) code[f.id] = (code[f.id] || 0) + v; }
      }
    }
    const [a, b] = cfg;
    const tile = (label, va, vb) => h('div', { class: 'tile' }, h('div', { class: 'lbl' }, label),
      h('div', { class: 'val' }, `${va} – ${vb}`),
      h('div', { class: 'who' }, h('span', { style: `--c:${a.color}`, class: 'key' }, h('i'), a.label), h('span', { class: 'muted' }, 'vs'), h('span', { style: `--c:${b.color}`, class: 'key' }, h('i'), b.label)));
    const rows = hist.slice().reverse().map(m => {
      const w = cfg.find(f => f.id === m.winnerId);
      const sc = m.score || {};
      return h('tr', null,
        h('td', null, `#${m.matchNumber || '?'}`), h('td', null, dateTime(m.endedAt || m.startedAt)),
        h('td', null, w ? h('span', { class: 'wtag', style: `--c:${w.color}` }, h('i'), w.label) : h('span', { class: 'wtag' }, 'Level')),
        h('td', { class: 'num' }, `${sc[a.id] || 0} – ${sc[b.id] || 0}${sc.draws ? ` (${sc.draws}d)` : ''}`),
        h('td', { class: 'num' }, String((m.rounds || []).length)),
        h('td', null, h('button', { class: 'btn ghost small', onclick: () => this.api.go('replays', { match: m.matchId }) }, '▶ Rounds')));
    });
    return [
      h('div', { class: 'pbox st-card' },
        h('h2', null, 'All-time record'),
        h('div', { class: 'cap' }, hist.length ? `Across ${hist.length} finished match${hist.length === 1 ? '' : 'es'} on this machine.` : 'Finished matches are recorded here.'),
        h('div', { class: 'tiles' },
          h('div', { class: 'tile' }, h('div', { class: 'lbl' }, 'Matches finished'), h('div', { class: 'val' }, String(t.matches))),
          tile('Matches won', t.matchWins[a.id], t.matchWins[b.id]),
          tile('Rounds won', t.roundWins[a.id], t.roundWins[b.id]),
          tile('Wins by K.O.', t.kos[a.id], t.kos[b.id]),
          tile('Coding time', mmss(code[a.id] || 0), mmss(code[b.id] || 0)))),
      hist.length ? h('div', { class: 'pbox st-card' },
        h('h2', null, 'Finished matches'),
        h('div', { class: 'table-scroll' }, h('table', { class: 'rounds-table' },
          h('thead', null, h('tr', null, h('th', null, 'Match'), h('th', null, 'Ended'), h('th', null, 'Winner'), h('th', { class: 'num' }, 'Score'), h('th', { class: 'num' }, 'Rounds'), h('th', null, ''))),
          h('tbody', null, rows)))) : null,
    ];
  }
}
