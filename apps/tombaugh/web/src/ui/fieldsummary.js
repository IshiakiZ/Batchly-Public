// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

// The field summary: a compact block that stays under the measurement tabs whatever tab is open.
// It says which patch of sky this is (name, coordinates in both forms), what the archive holds
// for it (one row of ticks per detector, one group per survey pass, one tick per exposure), where
// the frame on screen sits on the 0.75 to 5 micrometre ruler, and which data releases it uses.
//
// The helpers at the top are pure (no DOM) and tested in fieldsummary.test.js.
//
//   createFieldSummary(container) -> { update(info), setFrame(frame), el }
//   info:  { name, coord: { deg, hms, dms }, det, fov, gridN, scale, refs: [{ id, det, mjd, release }],
//            loaded: { [det]: count }, releases: [], notes: [], simulated }
//   frame: { ids: Set<string> | null, span: [lo, hi] | null, label }   the frame on screen

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MICRON = 'µm';
const WAVE_MIN = 0.75;
const WAVE_MAX = 5.0;

/** The six detector bands (same numbers as CONTRACT.md and pipeline.js). */
export const SUMMARY_BANDS = Object.freeze([
  { det: 1, min: 0.75, max: 1.09 },
  { det: 2, min: 1.1, max: 1.62 },
  { det: 3, min: 1.63, max: 2.41 },
  { det: 4, min: 2.42, max: 3.82 },
  { det: 5, min: 3.83, max: 4.41 },
  { det: 6, min: 4.42, max: 5.0 },
]);

const mjdToDate = (mjd) => new Date((mjd - 40587) * 86400000);
const isoDay = (mjd) => mjdToDate(mjd).toISOString().slice(0, 10);

function monthLabel(mjd) {
  const d = mjdToDate(mjd);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "2025-06-12 to 14" when both days share a month, else both days in full. */
export function dayRange(mjd0, mjd1) {
  const a = isoDay(mjd0);
  const b = isoDay(mjd1);
  if (a === b) return a;
  if (a.slice(0, 7) === b.slice(0, 7)) return `${a} to ${b.slice(8)}`;
  return `${a} to ${b}`;
}

/**
 * Group exposure references (all detectors) into survey passes: a new pass starts after a gap of
 * more than `gapDays`. -> [{ index, mjd0, mjd1, label, dates, total, perDet: { 1..6: refs[] } }]
 */
export function summarizePasses(refs, gapDays = 45, maxSpanDays = 120) {
  const list = (refs || []).filter((r) => r && Number.isFinite(r.mjd)).slice().sort((a, b) => a.mjd - b.mjd);
  // Runs separated by gaps; a run longer than maxSpanDays (a deep field, visited every orbit)
  // is cut into equal seasons of at most 90 days, as core/frames.js splitPasses does.
  const runs = [];
  let run = null;
  let last = -Infinity;
  for (const ref of list) {
    if (!run || ref.mjd - last > gapDays) {
      run = [];
      runs.push(run);
    }
    run.push(ref);
    last = ref.mjd;
  }
  const groups = [];
  for (const r of runs) {
    const t0 = r[0].mjd;
    const span = r[r.length - 1].mjd - t0;
    if (!(span > maxSpanDays)) {
      groups.push(r);
      continue;
    }
    const k = Math.ceil(span / 90);
    const seasons = Array.from({ length: k }, () => []);
    for (const ref of r) seasons[Math.min(k - 1, Math.floor(((ref.mjd - t0) / span) * k))].push(ref);
    for (const season of seasons) if (season.length) groups.push(season);
  }
  const passes = groups.map((g, index) => {
    const p = { index, mjd0: g[0].mjd, mjd1: g[g.length - 1].mjd, total: g.length, perDet: {} };
    for (const ref of g) (p.perDet[ref.det] || (p.perDet[ref.det] = [])).push(ref);
    p.label = monthLabel((p.mjd0 + p.mjd1) / 2);
    p.dates = dayRange(p.mjd0, p.mjd1);
    return p;
  });
  return passes;
}

/** One line for the loading card: "42 exposures in 3 passes: Jun 2025 (14), Dec 2025 (14), Jun 2026 (14)". */
export function foundLine(refs, det = null) {
  const mine = det === null ? refs || [] : (refs || []).filter((r) => r.det === det);
  const passes = summarizePasses(mine);
  if (!mine.length) return '';
  const n = mine.length;
  const head = `${n} exposure${n === 1 ? '' : 's'} in ${passes.length} pass${passes.length === 1 ? '' : 'es'}`;
  return `${head}: ${passes.map((p) => `${p.label} (${p.total})`).join(', ')}`;
}

/** Position 0..1 of a wavelength on the 0.75 to 5 micrometre ruler (clamped). */
export function rulerX(wave) {
  if (!Number.isFinite(wave)) return 0;
  return Math.min(1, Math.max(0, (wave - WAVE_MIN) / (WAVE_MAX - WAVE_MIN)));
}

/**
 * The wavelength span a movie frame covers: the centre wavelengths of the exposures in it, or
 * the lens band, or null. -> [lo, hi] (equal for one exposure).
 */
export function frameWaveSpan(frame, layerWave) {
  if (!frame) return null;
  const waves = [];
  for (const layer of Array.isArray(frame.layers) ? frame.layers : []) {
    let w = NaN;
    try {
      w = layerWave ? layerWave(layer) : layer && layer.frame ? layer.frame.waveCenter : NaN;
    } catch {
      w = NaN;
    }
    if (Number.isFinite(w)) waves.push(w);
  }
  if (waves.length) return [Math.min(...waves), Math.max(...waves)];
  if (Array.isArray(frame.band) && frame.band.length === 2 && frame.band.every(Number.isFinite)) return [frame.band[0], frame.band[1]];
  return null;
}

/** "1.874 µm" for one wavelength, "1.63–2.41 µm" for a span. */
export function spanLabel(span) {
  if (!span) return '';
  const [lo, hi] = span;
  if (Math.abs(hi - lo) < 0.0005) return `${lo.toFixed(3)} ${MICRON}`;
  return `${lo.toFixed(2)}–${hi.toFixed(2)} ${MICRON}`;
}

// ---------------------------------------------------------------------------------------------
// DOM

const SVG_NS = 'http://www.w3.org/2000/svg';

function el(doc, tag, cls, text) {
  const node = doc.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function svg(doc, name, attrs, parent) {
  const node = doc.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, String(v));
  if (parent) parent.append(node);
  return node;
}

export function createFieldSummary(container) {
  const doc = container.ownerDocument;
  container.textContent = '';
  container.classList.add('fieldsum');

  const kicker = el(doc, 'span', 'fs-label', 'This field');
  const releases = el(doc, 'span', 'fs-releases num');
  const name = el(doc, 'p', 'fs-name');
  const coords = el(doc, 'p', 'fs-coords num');
  const head = el(doc, 'div', 'fs-head');
  const headLine = el(doc, 'div', 'fs-row');
  headLine.append(kicker, releases);
  head.append(headLine, name, coords);

  const passLabel = el(doc, 'span', 'fs-label', 'Passes');
  const passValue = el(doc, 'span', 'fs-value num');
  const passHead = el(doc, 'div', 'fs-row');
  passHead.append(passLabel, passValue);
  const strip = el(doc, 'div', 'fs-strip');
  strip.setAttribute('role', 'img');

  const waveLabel = el(doc, 'span', 'fs-label', 'Wavelength of this frame');
  const waveValue = el(doc, 'span', 'fs-value num');
  const waveHead = el(doc, 'div', 'fs-row');
  waveHead.append(waveLabel, waveValue);
  const ruler = svg(doc, 'svg', { class: 'fs-ruler', role: 'img', preserveAspectRatio: 'none' });

  const notes = el(doc, 'div', 'fs-notes');
  const empty = el(doc, 'p', 'fs-empty', 'Pick a target to see what SPHEREx has for it.');

  const passBlock = el(doc, 'div', 'fs-block');
  passBlock.append(passHead, strip);
  const waveBlock = el(doc, 'div', 'fs-block');
  waveBlock.append(waveHead, ruler);
  container.append(head, passBlock, waveBlock, notes, empty);

  let info = null;
  let frame = null;
  let tickById = new Map();
  let groupEls = []; // [det][pass] -> element
  let rulerWidth = 0;

  function renderHead() {
    const has = !!info && info.coord;
    head.hidden = !has;
    empty.hidden = has;
    passBlock.hidden = !has;
    waveBlock.hidden = !has;
    if (!has) {
      notes.textContent = '';
      return;
    }
    name.textContent = info.name || 'Unnamed position';
    name.classList.toggle('is-plain', !info.name);
    coords.textContent = '';
    coords.append(el(doc, 'span', '', info.coord.deg));
    if (info.coord.hms) coords.append(el(doc, 'span', '', `${info.coord.hms} ${info.coord.dms}`));
    const rel = (info.releases || []).map((r) => String(r).toUpperCase());
    releases.textContent = rel.length ? rel.join(' · ') : '';
    releases.title = rel.length ? `Data release${rel.length > 1 ? 's' : ''}: ${rel.join(', ')}` : '';
    notes.textContent = '';
    for (const note of info.notes || []) notes.append(el(doc, 'p', 'fs-note', note));
    notes.hidden = !notes.childElementCount;
  }

  function renderStrip() {
    strip.textContent = '';
    tickById = new Map();
    groupEls = [];
    if (!info || !info.coord) return;
    const refs = info.refs || [];
    if (!refs.length) {
      passValue.textContent = '';
      strip.append(el(doc, 'p', 'fs-wait', info.searching ? 'Asking the archive which exposures cover this spot.' : 'No exposures of this spot in the public releases yet.'));
      strip.setAttribute('aria-label', 'No exposures listed');
      return;
    }
    const passes = summarizePasses(refs);
    const mine = refs.filter((r) => r.det === info.det).length;
    passValue.textContent = `${passes.length} pass${passes.length === 1 ? '' : 'es'} · ${refs.length} exposures · D${info.det}: ${mine}`;
    strip.setAttribute(
      'aria-label',
      `Exposures of this spot: ${passes.map((p) => `${p.label}, ${p.dates}, ${p.total} exposures`).join('; ')}. Detector ${info.det} has ${mine}.`,
    );

    // header row: pass names and dates
    const headRow = el(doc, 'div', 'fs-strip-row fs-strip-head');
    headRow.append(el(doc, 'span', 'fs-det'));
    const headGroups = el(doc, 'div', 'fs-groups');
    for (const p of passes) {
      const g = el(doc, 'div', 'fs-group');
      g.style.flex = `${Math.max(1, p.total)} 1 0`;
      g.append(el(doc, 'span', 'fs-pass-name', p.label), el(doc, 'span', 'fs-pass-dates num', p.dates));
      g.title = `${p.label}: ${p.dates}, ${p.total} exposures over all detectors`;
      headGroups.append(g);
    }
    headRow.append(headGroups, el(doc, 'span', 'fs-count'));
    strip.append(headRow);

    for (const band of SUMMARY_BANDS) {
      const row = el(doc, 'div', `fs-strip-row${band.det === info.det ? ' is-current' : ''}`);
      row.dataset.det = String(band.det);
      const count = refs.filter((r) => r.det === band.det).length;
      row.append(el(doc, 'span', 'fs-det num', `D${band.det}`));
      const groups = el(doc, 'div', 'fs-groups');
      const rowGroups = [];
      for (const p of passes) {
        const g = el(doc, 'div', 'fs-group');
        g.style.flex = `${Math.max(1, p.total)} 1 0`;
        const list = p.perDet[band.det] || [];
        // Keep one slot per exposure of the busiest detector, so rows line up in time.
        const slots = Math.max(...SUMMARY_BANDS.map((b) => (p.perDet[b.det] || []).length), 1);
        for (const ref of list) {
          const tick = el(doc, 'i', 'fs-tick');
          if (ref.id) tickById.set(ref.id, tick);
          g.append(tick);
        }
        for (let k = list.length; k < slots; k++) g.append(el(doc, 'i', 'fs-tick is-none'));
        rowGroups.push(g);
        groups.append(g);
      }
      groupEls[band.det] = rowGroups;
      row.append(groups, el(doc, 'span', 'fs-count num', String(count)));
      row.title = `Detector ${band.det}, ${band.min.toFixed(2)}–${band.max.toFixed(2)} ${MICRON}: ${count} exposure${count === 1 ? '' : 's'}`;
      strip.append(row);
    }
    markLive();
  }

  function markLive() {
    for (const tick of tickById.values()) tick.classList.remove('is-live');
    if (!frame || !frame.ids) return;
    for (const id of frame.ids) {
      const tick = tickById.get(id);
      if (tick) tick.classList.add('is-live');
    }
  }

  function renderRuler() {
    const W = Math.max(200, Math.round(ruler.getBoundingClientRect().width) || rulerWidth || 320);
    rulerWidth = W;
    const H = 40;
    ruler.setAttribute('viewBox', `0 0 ${W} ${H}`);
    ruler.setAttribute('height', String(H));
    ruler.textContent = '';
    const x = (w) => Math.round(rulerX(w) * (W - 1)) + 0.5;
    const top = 13;
    const base = 26;
    const det = info ? info.det : 0;
    for (const b of SUMMARY_BANDS) {
      const x0 = x(b.min);
      const x1 = x(b.max);
      svg(doc, 'rect', { x: x0, y: top, width: Math.max(1, x1 - x0), height: base - top, class: `fs-band${b.det % 2 ? '' : ' is-alt'}${b.det === det ? ' is-current' : ''}` }, ruler);
      const label = svg(doc, 'text', { x: (x0 + x1) / 2, y: 9, 'text-anchor': 'middle', class: `fs-band-label${b.det === det ? ' is-current' : ''}` }, ruler);
      label.textContent = `D${b.det}`;
    }
    svg(doc, 'path', { d: `M0.5 ${base + 0.5}H${W - 0.5}`, class: 'fs-axis' }, ruler);
    for (let w = 1; w <= 5; w++) {
      const tx = x(w);
      svg(doc, 'path', { d: `M${tx} ${base}V${base + 4}`, class: 'fs-axis' }, ruler);
      const t = svg(doc, 'text', { x: w === 5 ? W - 1 : tx, y: H - 1, 'text-anchor': w === 5 ? 'end' : 'middle', class: 'fs-tick-label' }, ruler);
      t.textContent = w === 5 ? `5 ${MICRON}` : String(w);
    }
    const span = frame ? frame.span : null;
    if (span) {
      const x0 = x(span[0]);
      const x1 = x(span[1]);
      if (x1 - x0 >= 2) svg(doc, 'rect', { x: x0, y: base - 2, width: x1 - x0, height: 3, class: 'fs-live' }, ruler);
      const mid = (x0 + x1) / 2;
      if (x1 - x0 < 2) svg(doc, 'path', { d: `M${mid} ${top - 2}V${base + 1}`, class: 'fs-live-line' }, ruler);
      svg(doc, 'path', { d: `M${mid - 4} ${top - 5}h8l-4 5z`, class: 'fs-live' }, ruler);
    }
    const text = span ? spanLabel(span) : '';
    waveValue.textContent = text || (info && info.coord ? 'no frame yet' : '');
    waveLabel.textContent = frame && frame.label ? frame.label : 'Wavelength of this frame';
    ruler.setAttribute('aria-label', text ? `The frame on screen covers ${text} on the 0.75 to 5 micrometre range of SPHEREx; detector ${det} is highlighted.` : 'The 0.75 to 5 micrometre range of SPHEREx with its six detector bands.');
  }

  // Redraw the ruler when the column changes width.
  let observer = null;
  try {
    if (typeof ResizeObserver === 'function') {
      observer = new ResizeObserver(() => {
        const w = Math.round(ruler.getBoundingClientRect().width);
        if (w && Math.abs(w - rulerWidth) > 1) renderRuler();
      });
      observer.observe(ruler);
    }
  } catch {
    observer = null;
  }

  let stripKey = '';
  function update(next) {
    info = next || null;
    renderHead();
    // The strip is only rebuilt when the exposure list or the detector changes.
    const key = info && info.coord ? `${info.det}|${(info.refs || []).length}|${info.refsKey || ''}|${info.searching ? 1 : 0}` : '';
    if (key !== stripKey) {
      stripKey = key;
      renderStrip();
    }
    renderRuler();
  }

  function setFrame(next) {
    frame = next || null;
    markLive();
    renderRuler();
  }

  renderHead();
  return {
    el: container,
    update,
    setFrame,
    destroy() {
      if (observer) observer.disconnect();
      container.textContent = '';
    },
  };
}
