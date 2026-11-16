// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// Spectrum plot: flux density against wavelength (0.7 to 5.1 um) for one clicked source.
//
// Contract API (unchanged):
//   createSpectrumPlot(container) -> { setData({ points, binned, model?, lens?, title }), clear(), toCsv() }
//
// Optional extras (all backwards compatible):
//   createSpectrumPlot(container, options)   options = { colorBy, units, logY, features }
//   setData({ ..., colorBy })     'pass' colours per-exposure points by survey pass and adds a thin
//                                 per-pass channel-mean line in place of the all-pass channel
//                                 means, so spectral change shows up
//   setData({ ..., features })    [{ wave, label, note }] marks these features for this source in
//                                 place of the general molecular list
//   setData({ ..., model })       model may be [{ wave, flux_uJy }], { wave: [], flux_uJy: [] }
//                                 or a function wave_um -> flux_uJy
//   setOptions({ units: 'flux' | 'ab', logY: boolean, features: boolean, colorBy: 'none' | 'pass' })
//                                 the same switches as the toolbar (Flux / AB mag, Log y, Features,
//                                 Passes); the choice survives setData() and clear()
//   getOptions(), destroy(), el (the root <figure>)
//   Pure helpers, usable without a DOM: spectrumToCsv, spectrumAxis, assignPasses,
//   passChannelMeans, normalizeModel, SPECTRUM_CSV_HEADER, SPECTRUM_EMPTY_TEXT.
//
// Points with ok === false are never drawn (they stay in the CSV). Flagged points are hollow.
// In AB-magnitude and log views a flux at or below zero cannot be drawn; the subtitle says how
// many points that hides.

import {
  DETECTORS, FEATURES, WAVE_MIN, WAVE_MAX, PAPER, STONE, SIGNAL, INK,
  isNum, clamp, quantile, weightedMean, splitPasses, detectorOf,
  niceTicks, logTicks, linearScale, logScale, formatTick, formatLogTick, formatNumber,
  formatWithError, fluxUnit, uJyToAbMag, abMagErr, formatMonthYear, formatIsoDate,
  formatIsoMinute, passStyle, csvCell, slug,
  svgEl, htmlEl, clearNode, px, chemText, markerPath, watchWidth, createTooltip, attachHover,
} from './svg.js';
import { ensurePlotStyles } from './plots.css.js';

export const SPECTRUM_EMPTY_TEXT = 'Click a source in the image to read its spectrum.';
export const SPECTRUM_CSV_HEADER = 'wave_um,bw_um,flux_uJy,err_uJy,mjd,date_utc,det,pass,flagged,ok';

// ---------------------------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------------------------

/** Survey pass of every point. Returns { passOf: Map<point, index>, passes: [{ index, mjd0, mjd1, label, n }] }. */
export function assignPasses(points, gapDays = 45) {
  const groups = splitPasses(points, gapDays);
  const passOf = new Map();
  const passes = groups.map((g, index) => {
    for (const p of g) passOf.set(p, index);
    const mid = g[Math.floor(g.length / 2)].mjd;
    return { index, mjd0: g[0].mjd, mjd1: g[g.length - 1].mjd, label: formatMonthYear(mid), n: g.length };
  });
  return { passOf, passes };
}

/** The per-exposure table as CSV text with a header row, sorted by wavelength. */
export function spectrumToCsv(points) {
  const list = (points || []).filter((p) => p && typeof p === 'object');
  const { passOf } = assignPasses(list);
  const rows = [SPECTRUM_CSV_HEADER];
  const sorted = list.slice().sort((a, b) => (a.wave ?? Infinity) - (b.wave ?? Infinity));
  for (const p of sorted) {
    const det = isNum(p.det) ? p.det : detectorOf(p.wave) || '';
    const pass = passOf.has(p) ? passOf.get(p) + 1 : '';
    rows.push([
      csvCell(p.wave), csvCell(p.bw), csvCell(p.flux_uJy), csvCell(p.err_uJy), csvCell(p.mjd),
      csvCell(isNum(p.mjd) ? formatIsoDate(p.mjd) : ''), csvCell(det), csvCell(pass),
      p.flagged ? '1' : '0', p.ok === false ? '0' : '1',
    ].join(','));
  }
  return rows.join('\n') + '\n';
}

/** Accepts an array of { wave, flux_uJy }, parallel arrays { wave: [], flux_uJy: [] } or a
 * function of wavelength; returns a sorted array of finite { wave, flux_uJy }. */
export function normalizeModel(model) {
  const out = [];
  if (!model) return out;
  if (typeof model === 'function') {
    for (let w = WAVE_MIN + 0.05; w <= WAVE_MAX - 0.1 + 1e-9; w += 0.01) {
      let f = NaN;
      try { f = model(w); } catch { f = NaN; }
      if (isNum(f)) out.push({ wave: w, flux_uJy: f });
    }
    return out;
  }
  if (Array.isArray(model)) {
    for (const m of model) {
      if (m && isNum(m.wave) && isNum(m.flux_uJy)) out.push({ wave: m.wave, flux_uJy: m.flux_uJy });
    }
  } else if (model.wave && model.flux_uJy && typeof model.wave.length === 'number') {
    for (let i = 0; i < model.wave.length; i++) {
      if (isNum(model.wave[i]) && isNum(model.flux_uJy[i])) out.push({ wave: model.wave[i], flux_uJy: model.flux_uJy[i] });
    }
  }
  return out.sort((a, b) => a.wave - b.wave);
}

/** Channel means per survey pass (17 channels per detector, by wavelength), for the pass lines. */
export function passChannelMeans(points, passOf, nPasses) {
  const buckets = Array.from({ length: nPasses }, () => new Map());
  for (const p of points) {
    if (!passOf.has(p) || p.flagged || p.ok === false) continue;
    if (!isNum(p.wave) || !isNum(p.flux_uJy)) continue;
    const det = detectorOf(p.wave);
    if (!det) continue;
    const d = DETECTORS[det - 1];
    const ch = clamp(Math.floor(((p.wave - d.min) / (d.max - d.min)) * 17), 0, 16);
    const key = det * 17 + ch;
    const b = buckets[passOf.get(p)];
    if (!b.has(key)) b.set(key, []);
    b.get(key).push(p);
  }
  return buckets.map((b) => {
    const rows = [];
    for (const [key, list] of b) {
      const m = weightedMean(list.map((p) => p.flux_uJy), list.map((p) => p.err_uJy));
      let w = 0;
      for (const p of list) w += p.wave;
      rows.push({ wave: w / list.length, flux_uJy: m.mean, err_uJy: m.err, n: list.length, det: Math.floor(key / 17) });
    }
    return rows.sort((a, c) => a.wave - c.wave);
  });
}

/**
 * Work out the y axis for a set of samples.
 * @param {Array<{ f:number, e?:number, robust?:boolean }>} samples flux and error in microJy;
 *   robust samples (per-exposure points) set the range through percentiles so one wild exposure
 *   cannot flatten the plot, the others (channel means, model) are always fully inside.
 * @param {{ units?: 'flux'|'ab', logY?: boolean }} opts
 * @returns {{ mode:'linear'|'log'|'ab', unit:{unit:string,label:string,factor:number},
 *   domain:[number,number], value:(f_uJy:number)=>number, ticks:Array<{v:number,label:string}>,
 *   title:string }} domain and tick values are in axis units: microJy for linear and log, AB
 *   magnitudes for 'ab' (domain is [bottom, top], so faint first)
 */
export function spectrumAxis(samples, opts = {}) {
  const units = opts.units === 'ab' ? 'ab' : 'flux';
  const mode = units === 'ab' ? 'ab' : opts.logY ? 'log' : 'linear';
  const robustHi = [];
  const robustLo = [];
  const robustPos = [];
  let fixedHi = -Infinity;
  let fixedLo = Infinity;
  let fixedPosLo = Infinity;
  for (const s of samples || []) {
    if (!s || !isNum(s.f)) continue;
    const e = isNum(s.e) && s.e > 0 ? s.e : 0;
    if (s.robust) {
      robustHi.push(s.f + e);
      robustLo.push(s.f - e);
      if (s.f > 0) robustPos.push(s.f);
    } else {
      fixedHi = Math.max(fixedHi, s.f + e);
      fixedLo = Math.min(fixedLo, s.f - e);
      if (s.f > 0) fixedPosLo = Math.min(fixedPosLo, s.f);
    }
  }
  // Trim the most extreme 1 percent of exposures at each end (at least one once there are 20):
  // a cosmic ray or a bad subtraction must not set the range.
  const trimmed = (values, top) => {
    const a = values.slice().sort((x, y) => x - y);
    const k = a.length >= 20 ? Math.max(1, Math.round(a.length * 0.01)) : 0;
    return top ? a[a.length - 1 - k] : a[k];
  };
  let hi = Math.max(fixedHi, robustHi.length ? trimmed(robustHi, true) : -Infinity);
  let lo = Math.min(fixedLo, robustLo.length ? trimmed(robustLo, false) : Infinity);
  const empty = !(hi >= lo);

  if (mode === 'linear') {
    if (empty) {
      lo = 0;
      hi = 1;
    }
    lo = Math.min(lo, 0);
    if (hi <= lo) hi = lo + 1;
    const span = hi - lo;
    hi += span * 0.06;
    if (lo < 0) lo -= span * 0.04;
    const unit = fluxUnit(hi);
    const tv = niceTicks(lo * unit.factor, hi * unit.factor, 5);
    const step = tv.length > 1 ? tv[1] - tv[0] : 1;
    return {
      mode,
      unit,
      domain: [lo, hi],
      value: (f) => (isNum(f) ? f : NaN),
      ticks: tv.map((t) => ({ v: t / unit.factor, label: formatTick(t, step) })),
      title: `Flux density (${unit.label})`,
    };
  }

  // Log and AB views can only show positive flux. The faint end stops at the faintest channel
  // mean (or the 5th percentile of exposures) and never more than 3000 times below the peak, so
  // noise around zero cannot stretch the axis.
  let plo = Math.min(fixedPosLo, robustPos.length ? quantile(robustPos, 0.05) : Infinity);
  let phi = hi;
  if (!(phi > 0) || !isNum(plo)) {
    plo = 1;
    phi = 100;
  }
  if (plo >= phi) plo = phi / 10;
  plo = Math.max(plo, phi / 3000);
  const pad = (phi / plo) ** 0.07;
  plo /= pad;
  phi *= pad;

  if (mode === 'log') {
    const unit = fluxUnit(phi);
    const tv = logTicks(plo * unit.factor, phi * unit.factor);
    return {
      mode,
      unit,
      domain: [plo, phi],
      value: (f) => (isNum(f) && f > 0 ? f : NaN),
      ticks: tv.map((t) => ({ v: t / unit.factor, label: formatLogTick(t) })),
      title: `Flux density (${unit.label}, log scale)`,
    };
  }

  const faint = uJyToAbMag(plo);
  const bright = uJyToAbMag(phi);
  const tv = niceTicks(bright, faint, 5);
  const step = tv.length > 1 ? tv[1] - tv[0] : 1;
  return {
    mode,
    unit: { unit: 'ABmag', label: 'AB mag', factor: 1 },
    domain: [faint, bright],
    value: (f) => uJyToAbMag(f),
    ticks: tv.map((t) => ({ v: t, label: formatTick(t, step) })),
    title: 'AB magnitude (brighter is up)',
  };
}

function median(values) {
  return quantile(values, 0.5);
}

// ---------------------------------------------------------------------------------------------
// The plot
// ---------------------------------------------------------------------------------------------

let uidCounter = 0;

/**
 * @param {HTMLElement} container
 * @param {{ colorBy?: 'none'|'pass', units?: 'flux'|'ab', logY?: boolean, features?: boolean }} [options]
 */
export function createSpectrumPlot(container, options = {}) {
  ensurePlotStyles(container.ownerDocument);
  const uid = `tbp-spec-${++uidCounter}`;

  const state = {
    points: [],
    drawn: [],
    binned: [],
    model: [],
    lens: null,
    title: '',
    hasData: false,
    colorBy: options.colorBy === 'pass' ? 'pass' : 'none',
    units: options.units === 'ab' ? 'ab' : 'flux',
    logY: !!options.logY,
    features: options.features !== false,
    width: 0,
    passOf: new Map(),
    passes: [],
    animate: false,
  };

  // --- static DOM -------------------------------------------------------------------------
  const root = htmlEl('figure', { class: 'tbp tbp-spectrum' });
  const head = htmlEl('div', { class: 'tbp-head' }, root);
  const titles = htmlEl('div', { class: 'tbp-titles' }, head);
  const titleEl = htmlEl('div', { class: 'tbp-title', text: 'Spectrum' }, titles);
  const subEl = htmlEl('div', { class: 'tbp-sub' }, titles);
  const tools = htmlEl('div', { class: 'tbp-tools', role: 'group', 'aria-label': 'Spectrum options' }, head);

  const seg = htmlEl('span', { class: 'tbp-seg', role: 'group', 'aria-label': 'Brightness unit' }, tools);
  const btnFlux = htmlEl('button', { class: 'tbp-btn', type: 'button', text: 'Flux', title: 'Flux density in janskys' }, seg);
  const btnAb = htmlEl('button', { class: 'tbp-btn', type: 'button', text: 'AB mag', title: 'AB magnitudes' }, seg);
  const btnLog = htmlEl('button', { class: 'tbp-btn', type: 'button', text: 'Log y', title: 'Logarithmic flux axis' }, tools);
  const btnFeat = htmlEl('button', { class: 'tbp-btn', type: 'button', text: 'Features', title: 'Mark molecular features' }, tools);
  const btnPass = htmlEl('button', { class: 'tbp-btn', type: 'button', text: 'Passes', title: 'Colour the exposures by survey pass to see change over time' }, tools);
  // The two export buttons wrap together, so a narrow toolbar breaks between view and export.
  const exportGroup = htmlEl('span', { class: 'tbp-tools-group' }, tools);
  const btnCopy = htmlEl('button', { class: 'tbp-btn tbp-btn-fixed', type: 'button', text: 'Copy CSV', title: 'Copy the per-exposure table' }, exportGroup);
  const btnDown = htmlEl('button', { class: 'tbp-btn', type: 'button', text: 'Download CSV', title: 'Download the per-exposure table' }, exportGroup);

  const body = htmlEl('div', { class: 'tbp-body' }, root);
  const svg = svgEl('svg', { class: 'tbp-svg', role: 'img', tabindex: '0', 'aria-label': SPECTRUM_EMPTY_TEXT }, body);
  const tip = createTooltip(body);
  const foot = htmlEl('div', { class: 'tbp-foot' }, root);
  const legend = htmlEl('div', { class: 'tbp-legend' }, foot);
  const tableHost = htmlEl('div', { class: 'tbp-sr' }, root);
  container.appendChild(root);

  // --- hover state ------------------------------------------------------------------------
  let targets = [];
  let hoverLayer = null;
  let plotBox = { left: 0, right: 0, top: 0, bottom: 0 };
  let axisNow = null;

  const hover = attachHover(svg, () => targets, (t) => {
    if (!hoverLayer) return;
    clearNode(hoverLayer);
    if (!t) {
      tip.hide();
      return;
    }
    svgEl('line', { x1: px(t.x), x2: px(t.x), y1: plotBox.top, y2: plotBox.bottom, stroke: PAPER, 'stroke-opacity': 0.35, 'stroke-width': 1 }, hoverLayer);
    svgEl('line', { x1: plotBox.left, x2: plotBox.right, y1: px(t.y), y2: px(t.y), stroke: PAPER, 'stroke-opacity': 0.35, 'stroke-width': 1 }, hoverLayer);
    svgEl('circle', { cx: px(t.x), cy: px(t.y), r: 5.5, fill: 'none', stroke: PAPER, 'stroke-width': 1.5 }, hoverLayer);
    tip.show(tooltipLines(t), t.x, t.y);
  });

  function tooltipLines(t) {
    const p = t.p;
    const det = isNum(p.det) ? p.det : detectorOf(p.wave);
    const lines = [{ text: `${p.wave.toFixed(3)} µm${det ? ` · D${det}` : ''}`, cls: 'tbp-tip-head' }];
    const unit = axisNow && axisNow.mode !== 'ab' ? axisNow.unit : fluxUnit(Math.abs(p.flux_uJy));
    const fluxText = `${formatWithError(p.flux_uJy * unit.factor, isNum(p.err_uJy) ? p.err_uJy * unit.factor : NaN, 2).text} ${unit.label}`;
    if (state.units === 'ab') {
      const mag = uJyToAbMag(p.flux_uJy);
      const me = abMagErr(p.flux_uJy, p.err_uJy);
      lines.push(isNum(mag) ? `AB ${mag.toFixed(2)}${isNum(me) ? ` ± ${me.toFixed(2)}` : ''}` : 'no magnitude (flux ≤ 0)');
      lines.push({ text: fluxText, cls: 'tbp-tip-dim' });
    } else {
      lines.push(fluxText);
    }
    if (t.kind === 'binned') {
      lines.push({ text: isNum(p.n) ? `mean of ${p.n} exposures` : 'channel mean', cls: 'tbp-tip-dim' });
    } else if (t.kind === 'passmean') {
      lines.push({ text: `${state.passes[t.pass].label} \u00B7 mean of ${p.n} exposure${p.n === 1 ? '' : 's'}`, cls: 'tbp-tip-dim' });
    } else {
      if (isNum(p.mjd)) {
        const pass = state.passOf.get(p);
        const passText = state.passes.length > 1 && pass !== undefined ? ` · pass ${pass + 1}` : '';
        lines.push({ text: `${formatIsoMinute(p.mjd)} UTC${passText}`, cls: 'tbp-tip-dim' });
      }
      if (p.flagged) lines.push({ text: 'flagged pixel in the aperture', cls: 'tbp-tip-dim' });
    }
    return lines;
  }

  // --- toolbar ----------------------------------------------------------------------------
  function syncButtons() {
    btnFlux.setAttribute('aria-pressed', String(state.units === 'flux'));
    btnAb.setAttribute('aria-pressed', String(state.units === 'ab'));
    btnLog.setAttribute('aria-pressed', String(state.logY && state.units === 'flux'));
    btnLog.disabled = state.units === 'ab';
    btnFeat.setAttribute('aria-pressed', String(state.features));
    btnPass.setAttribute('aria-pressed', String(state.colorBy === 'pass' && state.passes.length > 1));
    btnPass.disabled = state.passes.length < 2;
    btnCopy.disabled = !state.hasData;
    btnDown.disabled = !state.hasData;
  }
  btnFlux.addEventListener('click', () => api.setOptions({ units: 'flux' }));
  btnAb.addEventListener('click', () => api.setOptions({ units: 'ab' }));
  btnLog.addEventListener('click', () => api.setOptions({ logY: !state.logY }));
  btnFeat.addEventListener('click', () => api.setOptions({ features: !state.features }));
  btnPass.addEventListener('click', () => api.setOptions({ colorBy: state.colorBy === 'pass' ? 'none' : 'pass' }));

  function flash(btn, text) {
    const original = btn.dataset.label || btn.textContent;
    btn.dataset.label = original;
    btn.textContent = text;
    clearTimeout(btn._tbpTimer);
    btn._tbpTimer = setTimeout(() => { btn.textContent = original; }, 1600);
  }

  function fallbackCopy(text) {
    try {
      const doc = root.ownerDocument;
      const ta = htmlEl('textarea', { 'aria-hidden': 'true', tabindex: '-1' }, root);
      ta.value = text;
      ta.style.cssText = 'position:absolute;left:-9999px;top:0;opacity:0';
      ta.select();
      const ok = doc.execCommand && doc.execCommand('copy');
      ta.remove();
      return !!ok;
    } catch {
      return false;
    }
  }

  btnCopy.addEventListener('click', async () => {
    const text = api.toCsv();
    let ok = false;
    try {
      const nav = root.ownerDocument.defaultView.navigator;
      if (nav.clipboard && nav.clipboard.writeText) {
        await nav.clipboard.writeText(text);
        ok = true;
      }
    } catch {
      ok = false;
    }
    if (!ok) ok = fallbackCopy(text);
    flash(btnCopy, ok ? 'Copied' : 'Copy blocked');
  });

  btnDown.addEventListener('click', () => {
    try {
      const view = root.ownerDocument.defaultView;
      const blob = new view.Blob([api.toCsv()], { type: 'text/csv;charset=utf-8' });
      const url = view.URL.createObjectURL(blob);
      const a = htmlEl('a', { href: url, download: `tombaugh-spectrum-${slug(state.title)}.csv` }, root);
      a.style.display = 'none';
      a.click();
      a.remove();
      setTimeout(() => {
        try { view.URL.revokeObjectURL(url); } catch { /* nothing to clean up */ }
      }, 2000);
    } catch {
      flash(btnDown, 'Download blocked');
    }
  });

  // --- rendering --------------------------------------------------------------------------
  function featureRows(xs, wide) {
    const rows = [[], []];
    const placed = [];
    for (const f of state.featureList || FEATURES) {
      if (!(f.wave >= WAVE_MIN && f.wave <= WAVE_MAX)) continue;
      const label = f.id === 'ch4' && wide ? 'CH4 / PAH' : f.label;
      const w = label.length * 6.1 + 2;
      const x = xs(f.wave);
      const span = [x - w / 2, x + w / 2];
      let row = 0;
      if (rows[0].some((s) => span[0] < s[1] + 5 && span[1] > s[0] - 5)) row = 1;
      rows[row].push(span);
      placed.push({ f, label, x, row });
    }
    return { placed, count: rows[1].length ? 2 : 1 };
  }

  function render() {
    const W = Math.max(280, state.width || container.clientWidth || 640);
    const narrow = W < 520;
    const H = narrow ? 280 : 340;
    root.classList.toggle('tbp-narrow', narrow);
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('height', H);
    clearNode(svg);
    tip.hide();
    targets = [];
    hoverLayer = null;

    const left = 56;
    const right = 10;
    const bottom = H - 40;
    const xs = linearScale(WAVE_MIN, WAVE_MAX, left, W - right);
    const feat = state.features ? featureRows(xs, W >= 640) : { placed: [], count: 0 };
    const detStrip = 17;
    const top = detStrip + feat.count * 13 + 8;
    plotBox = { left, right: W - right, top, bottom };

    // Detector bands: alternate shading from the label strip down to the axis.
    const gBands = svgEl('g', { 'aria-hidden': 'true' }, svg);
    for (const d of DETECTORS) {
      const x0 = xs(d.min);
      const x1 = xs(d.max);
      if (d.det % 2 === 1) {
        svgEl('rect', { x: px(x0), y: 0, width: px(x1 - x0), height: bottom, fill: PAPER, 'fill-opacity': 0.045 }, gBands);
      }
      svgEl('text', { x: px((x0 + x1) / 2), y: 12, 'text-anchor': 'middle', class: 'tbp-num', 'font-size': 10, text: `D${d.det}` }, gBands);
    }

    // Y axis.
    const good = state.drawn;
    const samples = [];
    for (const p of good) if (!p.flagged) samples.push({ f: p.flux_uJy, e: p.err_uJy, robust: true });
    if (!samples.length) for (const p of good) samples.push({ f: p.flux_uJy, e: p.err_uJy, robust: true });
    for (const b of state.binned) samples.push({ f: b.flux_uJy, e: b.err_uJy });
    for (const m of state.model) samples.push({ f: m.flux_uJy });
    const axis = spectrumAxis(samples, { units: state.units, logY: state.logY });
    axisNow = axis;
    const ys = axis.mode === 'log'
      ? logScale(axis.domain[0], axis.domain[1], bottom, top)
      : linearScale(axis.domain[0], axis.domain[1], bottom, top);
    const Y = (f) => ys(axis.value(f));
    const yLow = (f) => {
      const y = Y(f);
      return isNum(y) ? Math.min(y, bottom + 4) : bottom + 4;
    };

    const gAxes = svgEl('g', { 'aria-hidden': 'true' }, svg);
    if (state.hasData) {
      for (const t of axis.ticks) {
        const y = Math.round(ys(t.v)) + 0.5;
        if (y < top - 1 || y > bottom + 1) continue;
        if (y < bottom - 1) svgEl('line', { x1: left, x2: W - right, y1: y, y2: y, class: 'tbp-grid' }, gAxes);
        svgEl('text', { x: left - 7, y: y + 3.5, 'text-anchor': 'end', class: 'tbp-num', text: t.label }, gAxes);
      }
    }
    svgEl('text', {
      x: 0, y: 0, transform: `translate(12 ${px((top + bottom) / 2)}) rotate(-90)`, 'text-anchor': 'middle',
      class: 'tbp-axis-title', text: state.hasData ? axis.title : 'Flux density',
    }, gAxes);

    // Lens windows sit behind the data.
    const lens = state.lens;
    if (lens && state.hasData) {
      const gLens = svgEl('g', { 'aria-hidden': 'true' }, svg);
      const windows = Array.isArray(lens.continuum) ? lens.continuum : [];
      for (const c of windows) {
        if (!Array.isArray(c) || !isNum(c[0]) || !isNum(c[1])) continue;
        const x0 = clamp(xs(Math.min(c[0], c[1])), left, W - right);
        const x1 = clamp(xs(Math.max(c[0], c[1])), left, W - right);
        svgEl('rect', { x: px(x0), y: top, width: px(Math.max(1, x1 - x0)), height: bottom - top, fill: PAPER, 'fill-opacity': 0.08 }, gLens);
        svgEl('rect', { x: px(x0), y: top, width: px(Math.max(1, x1 - x0)), height: 2, fill: PAPER, 'fill-opacity': 0.7 }, gLens);
      }
      if (Array.isArray(lens.band) && isNum(lens.band[0]) && isNum(lens.band[1])) {
        const x0 = clamp(xs(Math.min(lens.band[0], lens.band[1])), left, W - right);
        const x1 = clamp(xs(Math.max(lens.band[0], lens.band[1])), left, W - right);
        svgEl('rect', { x: px(x0), y: top, width: px(Math.max(1, x1 - x0)), height: bottom - top, fill: SIGNAL, 'fill-opacity': 0.2 }, gLens);
        svgEl('rect', { x: px(x0), y: top, width: px(Math.max(1, x1 - x0)), height: 2, fill: SIGNAL }, gLens);
      }
    }

    // Molecular features: a label in the top margin and a hairline through the plot.
    if (state.features) {
      const gFeat = svgEl('g', {}, svg);
      for (const it of feat.placed) {
        const ly = detStrip + 11 + it.row * 13;
        const x = Math.round(it.x) + 0.5;
        svgEl('line', { x1: x, x2: x, y1: ly + 4, y2: bottom, stroke: PAPER, 'stroke-opacity': 0.12, 'stroke-width': 1 }, gFeat);
        svgEl('line', { x1: x, x2: x, y1: ly + 4, y2: top + 5, stroke: STONE, 'stroke-width': 1 }, gFeat);
        const t = chemText(gFeat, it.label, { x: px(it.x), y: ly, 'text-anchor': 'middle', 'font-size': 10.5 });
        svgEl('title', { text: it.f.note }, t);
      }
    }

    // X axis.
    svgEl('path', { d: `M${left + 0.5} ${top}V${bottom + 0.5}H${W - right}`, class: 'tbp-axis' }, gAxes);
    for (let w = 1; w <= 5.0001; w += 0.5) {
      const x = Math.round(xs(w)) + 0.5;
      const major = Math.abs(w - Math.round(w)) < 1e-6;
      svgEl('line', { x1: x, x2: x, y1: bottom, y2: bottom + (major ? 5 : 3), class: 'tbp-axis' }, gAxes);
      if (major) svgEl('text', { x, y: bottom + 17, 'text-anchor': 'middle', class: 'tbp-num', text: String(Math.round(w)) }, gAxes);
    }
    svgEl('text', { x: px((left + W - right) / 2), y: H - 5, 'text-anchor': 'middle', class: 'tbp-axis-title', text: 'Wavelength (µm)' }, gAxes);

    if (!state.hasData) {
      svgEl('text', { x: px((left + W - right) / 2), y: px((top + bottom) / 2 + 4), 'text-anchor': 'middle', class: 'tbp-empty', text: SPECTRUM_EMPTY_TEXT }, svg);
      return;
    }

    // Data, clipped to the plot area.
    const clipId = `${uid}-clip`;
    const defs = svgEl('defs', {}, svg);
    const clip = svgEl('clipPath', { id: clipId }, defs);
    svgEl('rect', { x: left + 1, y: top - 4, width: W - right - left + 3, height: bottom - top + 4 }, clip);
    const gData = svgEl('g', { 'clip-path': `url(#${clipId})` }, svg);
    const enter = state.animate ? 'tbp-enter' : null;
    const byPass = state.colorBy === 'pass' && state.passes.length > 0;
    // With two or more passes coloured apart, the per-pass channel means replace the all-pass
    // ones: a mean across passes of a source that changed is not a spectrum of anything.
    const passLines = byPass && state.passes.length > 1;
    const hasBinned = state.binned.length > 0 && !passLines;

    // Per-exposure points: error bars first (one path per colour), then markers.
    const gPts = svgEl('g', { class: enter }, gData);
    const barPaths = new Map();
    const rPt = narrow ? 1.9 : 2.2;
    const markers = [];
    for (const p of good) {
      const x = xs(p.wave);
      const y = Y(p.flux_uJy);
      if (!isNum(x) || !isNum(y)) continue;
      const pass = state.passOf.get(p);
      const style = byPass && pass !== undefined ? passStyle(pass) : { color: PAPER, shape: 'circle' };
      if (isNum(p.err_uJy) && p.err_uJy > 0) {
        const y1 = Y(p.flux_uJy + p.err_uJy);
        const y0 = yLow(p.flux_uJy - p.err_uJy);
        if (isNum(y1)) barPaths.set(style.color, `${barPaths.get(style.color) || ''}M${px(x)} ${px(y1)}V${px(y0)}`);
      }
      markers.push({ p, x, y, style });
      targets.push({ x, y, kind: 'point', p, skipKeys: hasBinned || passLines });
    }
    for (const [color, d] of barPaths) {
      svgEl('path', { d, stroke: color, 'stroke-opacity': byPass ? 0.28 : 0.15, 'stroke-width': 1, fill: 'none' }, gPts);
    }
    for (const m of markers) {
      const o = byPass ? 0.8 : 0.42;
      const common = m.p.flagged
        ? { fill: INK, stroke: m.style.color, 'stroke-opacity': o + 0.1, 'stroke-width': 1 }
        : { fill: m.style.color, 'fill-opacity': o };
      if (m.style.shape === 'circle') svgEl('circle', { cx: px(m.x), cy: px(m.y), r: m.p.flagged ? rPt + 0.3 : rPt, ...common }, gPts);
      else svgEl('path', { d: markerPath(m.style.shape, m.x, m.y, rPt), ...common }, gPts);
    }

    // Per-pass channel means as thin coloured lines.
    if (passLines) {
      const gPass = svgEl('g', { class: enter }, gData);
      const means = passChannelMeans(good, state.passOf, state.passes.length);
      means.forEach((rows, i) => {
        let d = '';
        let prevDet = 0;
        for (const r of rows) {
          const y = Y(r.flux_uJy);
          if (!isNum(y)) {
            prevDet = 0;
            continue;
          }
          d += `${prevDet === r.det ? 'L' : 'M'}${px(xs(r.wave))} ${px(y)}`;
          prevDet = r.det;
          targets.push({ x: xs(r.wave), y, kind: 'passmean', p: r, pass: i, bias: 0.3 });
        }
        if (d) svgEl('path', { d, stroke: passStyle(i).color, 'stroke-width': 1.75, fill: 'none', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, gPass);
      });
    }

    // Smooth model curve.
    if (state.model.length > 1) {
      let d = '';
      let pen = false;
      for (const m of state.model) {
        const y = Y(m.flux_uJy);
        if (!isNum(y)) {
          pen = false;
          continue;
        }
        d += `${pen ? 'L' : 'M'}${px(xs(m.wave))} ${px(y)}`;
        pen = true;
      }
      if (d) svgEl('path', { d, class: enter, stroke: PAPER, 'stroke-opacity': 0.5, 'stroke-width': 3, fill: 'none', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, gData);
    }

    // Channel means: error bars, connecting line, markers.
    if (hasBinned) {
      const gBin = svgEl('g', { class: enter ? `${enter} tbp-binned` : 'tbp-binned' }, gData);
      const gaps = [];
      for (let i = 1; i < state.binned.length; i++) gaps.push(state.binned[i].wave - state.binned[i - 1].wave);
      const typical = median(gaps);
      let bars = '';
      let line = '';
      let prev = null;
      const dots = [];
      for (const b of state.binned) {
        const x = xs(b.wave);
        const y = Y(b.flux_uJy);
        if (!isNum(x) || !isNum(y)) {
          prev = null;
          continue;
        }
        if (isNum(b.err_uJy) && b.err_uJy > 0) {
          const y1 = Y(b.flux_uJy + b.err_uJy);
          if (isNum(y1)) bars += `M${px(x)} ${px(y1)}V${px(yLow(b.flux_uJy - b.err_uJy))}`;
        }
        const joined = prev && (!isNum(typical) || b.wave - prev.wave <= typical * 3.5);
        line += `${joined ? 'L' : 'M'}${px(x)} ${px(y)}`;
        prev = b;
        dots.push({ x, y });
        targets.push({ x, y, kind: 'binned', p: b, bias: 0.3 });
      }
      if (line) svgEl('path', { d: line, stroke: PAPER, 'stroke-width': 1.5, fill: 'none', 'stroke-linejoin': 'round' }, gBin);
      if (bars) svgEl('path', { d: bars, stroke: PAPER, 'stroke-opacity': 0.85, 'stroke-width': 1, fill: 'none' }, gBin);
      // Marker size follows the tightest channel spacing so neighbours never merge into a bar.
      const dx = [];
      for (let i = 1; i < dots.length; i++) dx.push(dots[i].x - dots[i - 1].x);
      const tight = dx.length ? quantile(dx, 0.1) : 12;
      const rBin = clamp(tight * 0.5, 1.5, 3);
      for (const dot of dots) {
        svgEl('circle', { cx: px(dot.x), cy: px(dot.y), r: px(rBin), fill: PAPER, stroke: rBin >= 2.4 ? INK : null, 'stroke-width': 1 }, gBin);
      }
    }

    hoverLayer = svgEl('g', { 'aria-hidden': 'true', 'pointer-events': 'none' }, svg);
    // A transparent sheet so pointer events fire over empty parts of the plot too.
    svgEl('rect', { x: left, y: top, width: W - right - left, height: bottom - top, fill: 'transparent' }, svg);
    state.animate = false;
  }

  // --- legend, subtitle, accessible summary ----------------------------------------------
  function swatch(build, w = 18) {
    const s = svgEl('svg', { width: w, height: 12, viewBox: `0 0 ${w} 12`, 'aria-hidden': 'true' });
    build(s);
    return s;
  }

  function legendItem(icon, text) {
    const item = htmlEl('span', { class: 'tbp-legend-item' }, legend);
    item.appendChild(icon);
    htmlEl('span', { text }, item);
    return item;
  }

  function renderLegend() {
    clearNode(legend);
    if (!state.hasData) return;
    const byPass = state.colorBy === 'pass' && state.passes.length > 0;
    if (byPass) {
      state.passes.forEach((pass, i) => {
        if (i > 4) return;
        const st = passStyle(i);
        const label = i === 4 && state.passes.length > 5 ? 'later passes' : pass.label;
        legendItem(swatch((s) => {
          if (state.passes.length > 1) svgEl('line', { x1: 0, x2: 18, y1: 6, y2: 6, stroke: st.color, 'stroke-width': 1.75 }, s);
          if (st.shape === 'circle') svgEl('circle', { cx: 9, cy: 6, r: 3, fill: st.color }, s);
          else svgEl('path', { d: markerPath(st.shape, 9, 6, 3), fill: st.color }, s);
        }), label);
      });
    } else {
      legendItem(swatch((s) => svgEl('circle', { cx: 6, cy: 6, r: 2.6, fill: PAPER, 'fill-opacity': 0.5 }, s), 12), 'one exposure');
    }
    if (state.drawn.some((p) => p.flagged)) {
      legendItem(swatch((s) => svgEl('circle', { cx: 6, cy: 6, r: 2.8, fill: 'none', stroke: PAPER, 'stroke-opacity': 0.6 }, s), 12), 'flagged');
    }
    if (state.binned.length && !(byPass && state.passes.length > 1)) {
      legendItem(swatch((s) => {
        svgEl('line', { x1: 0, x2: 18, y1: 6, y2: 6, stroke: PAPER, 'stroke-width': 1.25 }, s);
        svgEl('circle', { cx: 9, cy: 6, r: 3, fill: PAPER }, s);
      }), 'channel mean');
    }
    if (state.model.length > 1) {
      legendItem(swatch((s) => svgEl('line', { x1: 0, x2: 18, y1: 6, y2: 6, stroke: PAPER, 'stroke-opacity': 0.5, 'stroke-width': 3, 'stroke-linecap': 'round' }, s)), 'smooth model');
    }
    if (state.lens) {
      if (Array.isArray(state.lens.band)) {
        legendItem(swatch((s) => {
          svgEl('rect', { x: 0, y: 1, width: 12, height: 10, fill: SIGNAL, 'fill-opacity': 0.3 }, s);
          svgEl('rect', { x: 0, y: 1, width: 12, height: 2, fill: SIGNAL }, s);
        }, 12), `${state.lens.label || 'lens'} band`);
      }
      if (Array.isArray(state.lens.continuum) && state.lens.continuum.length) {
        legendItem(swatch((s) => {
          svgEl('rect', { x: 0, y: 1, width: 12, height: 10, fill: PAPER, 'fill-opacity': 0.12 }, s);
          svgEl('rect', { x: 0, y: 1, width: 12, height: 2, fill: PAPER, 'fill-opacity': 0.7 }, s);
        }, 12), 'continuum');
      }
    }
  }

  function renderMeta() {
    titleEl.textContent = state.title || 'Spectrum';
    if (!state.hasData) {
      subEl.textContent = '';
      svg.setAttribute('aria-label', `${state.title ? `${state.title}: ` : ''}${SPECTRUM_EMPTY_TEXT}`);
      clearNode(tableHost);
      return;
    }
    const n = state.drawn.length;
    const nPass = state.passes.length;
    const nFlag = state.drawn.filter((p) => p.flagged).length;
    const hidden = state.units === 'ab' || state.logY ? state.drawn.filter((p) => !(p.flux_uJy > 0)).length : 0;
    const parts = [`${n} exposure${n === 1 ? '' : 's'}`];
    if (nPass) parts.push(`${nPass} survey pass${nPass === 1 ? '' : 'es'}`);
    if (nFlag) parts.push(`${nFlag} flagged`);
    if (hidden) parts.push(`${hidden} at or below zero not shown`);
    if (!n && state.binned.length) parts[0] = `${state.binned.length} channels`;
    subEl.textContent = parts.join(' · ');

    // Accessible summary.
    const series = state.binned.length ? state.binned : state.drawn.filter((p) => !p.flagged);
    let label = `Spectrum of ${state.title || 'the selected source'}: ${parts.join(', ')}.`;
    if (series.length) {
      let peak = series[0];
      let dip = series[0];
      for (const p of series) {
        if (p.flux_uJy > peak.flux_uJy) peak = p;
        if (p.flux_uJy < dip.flux_uJy) dip = p;
      }
      const med = median(series.map((p) => p.flux_uJy));
      const waves = series.map((p) => p.wave);
      label += ` Wavelengths ${Math.min(...waves).toFixed(2)} to ${Math.max(...waves).toFixed(2)} micrometres.`;
      label += ` Median flux density ${formatNumber(med, 3)} microjansky; brightest near ${peak.wave.toFixed(2)} micrometres`;
      label += ` (${formatNumber(peak.flux_uJy, 3)}), faintest near ${dip.wave.toFixed(2)} (${formatNumber(dip.flux_uJy, 3)}).`;
    }
    if (state.passes.length > 1) label += ` Passes: ${state.passes.map((p) => p.label).join(', ')}.`;
    svg.setAttribute('aria-label', label);

    // Visually hidden data table.
    clearNode(tableHost);
    const useBinned = state.binned.length > 0;
    const rows = (useBinned ? state.binned : state.drawn).slice(0, 400);
    const table = htmlEl('table', {}, tableHost);
    htmlEl('caption', {
      text: `${state.title || 'Spectrum'}: ${useBinned ? 'mean flux density per spectral channel' : 'flux density per exposure'}`
        + (rows.length < (useBinned ? state.binned : state.drawn).length ? ` (first ${rows.length} rows; the CSV has all)` : ''),
    }, table);
    const thead = htmlEl('tr', {}, htmlEl('thead', {}, table));
    const cols = ['Wavelength (micrometres)', 'Flux density (microjansky)', 'Uncertainty (microjansky)'];
    if (!useBinned) cols.push('Date (UTC)', 'Detector');
    for (const c of cols) htmlEl('th', { scope: 'col', text: c }, thead);
    const tbody = htmlEl('tbody', {}, table);
    for (const p of rows) {
      const tr = htmlEl('tr', {}, tbody);
      htmlEl('td', { text: isNum(p.wave) ? p.wave.toFixed(3) : '' }, tr);
      htmlEl('td', { text: formatNumber(p.flux_uJy, 4) }, tr);
      htmlEl('td', { text: isNum(p.err_uJy) ? formatNumber(p.err_uJy, 2) : '' }, tr);
      if (!useBinned) {
        htmlEl('td', { text: formatIsoDate(p.mjd) }, tr);
        htmlEl('td', { text: String(isNum(p.det) ? p.det : detectorOf(p.wave) || '') }, tr);
      }
    }
  }

  function renderAll() {
    syncButtons();
    renderMeta();
    renderLegend();
    render();
  }

  // --- public API -------------------------------------------------------------------------
  const api = {
    el: root,

    /**
     * @param {{ points: Array, binned?: Array, model?: any, lens?: Object|null, title?: string,
     *   colorBy?: 'none'|'pass' }} data
     */
    setData(data) {
      const d = data || {};
      state.points = Array.isArray(d.points) ? d.points.filter((p) => p && typeof p === 'object') : [];
      state.drawn = state.points
        .filter((p) => p.ok !== false && isNum(p.wave) && isNum(p.flux_uJy))
        .sort((a, b) => a.wave - b.wave);
      state.binned = (Array.isArray(d.binned) ? d.binned : [])
        .filter((p) => p && p.ok !== false && isNum(p.wave) && isNum(p.flux_uJy))
        .sort((a, b) => a.wave - b.wave);
      state.model = normalizeModel(d.model);
      // Features to mark for this source in place of the general list (a tool that knows what
      // the source is, such as the solar-system plugin, supplies them).
      const own = (Array.isArray(d.features) ? d.features : [])
        .filter((f) => f && isNum(f.wave) && typeof f.label === 'string' && f.label)
        .map((f) => ({ id: '', label: f.label, wave: f.wave, note: String(f.note || f.what || f.label) }));
      state.featureList = own.length ? own : null;
      state.lens = d.lens && typeof d.lens === 'object' ? d.lens : null;
      state.title = d.title ? String(d.title) : '';
      if (d.colorBy === 'pass' || d.colorBy === 'none') state.colorBy = d.colorBy;
      const passes = assignPasses(state.drawn);
      state.passOf = passes.passOf;
      state.passes = passes.passes;
      state.hasData = state.drawn.length > 0 || state.binned.length > 0;
      state.animate = state.hasData;
      renderAll();
    },

    /** Change view options without touching the data. */
    setOptions(patch) {
      const p = patch || {};
      if (p.units === 'flux' || p.units === 'ab') state.units = p.units;
      if (typeof p.logY === 'boolean') state.logY = p.logY;
      if (typeof p.features === 'boolean') state.features = p.features;
      if (p.colorBy === 'pass' || p.colorBy === 'none') state.colorBy = p.colorBy;
      renderAll();
    },

    getOptions() {
      return { units: state.units, logY: state.logY, features: state.features, colorBy: state.colorBy };
    },

    /** Back to the empty state ("Click a source in the image to read its spectrum."). */
    clear() {
      state.points = [];
      state.drawn = [];
      state.binned = [];
      state.model = [];
      state.lens = null;
      state.title = '';
      state.featureList = null;
      state.passOf = new Map();
      state.passes = [];
      state.hasData = false;
      state.animate = false;
      renderAll();
    },

    /** The per-exposure table (all points given to setData, flagged and failed ones included). */
    toCsv() {
      return spectrumToCsv(state.points);
    },

    destroy() {
      stopWatching();
      hover.destroy();
      root.remove();
    },
  };

  const stopWatching = watchWidth(body, (w) => {
    state.width = w;
    render();
  });
  state.width = Math.round(body.clientWidth || 0);
  renderAll();
  return api;
}
