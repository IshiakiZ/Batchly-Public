// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// Validation plugin. A side panel that checks the tool against what is already known.
//
//   "Measure this field"             on what is loaded: the target's motion, brightness change,
//                                    spectrum and data quality (measure.js), and the field-star
//                                    controls: offsets from Gaia and the null test (fieldstars.js)
//   "Run the five challenge targets" goes to each challenge target in turn, waits for its
//                                    exposures, measures, and builds one combined report;
//                                    cancellable, and a target without data is reported as such
//   "Copy report (Markdown)", "Download JSON"   the report, to paste into a write-up or keep
//
// The table shows measured against catalogue and the difference in sigma. A small red mark
// appears only where the two disagree by more than three sigma; nothing else is coloured.
// All text reaches the page through textContent. The one piece of markup set as a string is the
// scatter plot, built here from numbers alone (scatterSvg).

import * as coreTargets from '../../core/targets.js';
import { fieldRows, toJson, toMarkdown, toRows } from './report.js';
import { TOUR_DEFAULTS, challengeTargets, collectContext, measureLoaded, runTour } from './tour.js';
import { ensureValidateStyles } from './validate.css.js';

export const meta = {
  id: 'validate',
  title: 'Validation',
  description: 'Measures the loaded field and the challenge targets against Gaia and the target table, with field-star controls, and exports the result as a report.',
};

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const PAPER = '#F7F2E7';
const STONE = '#77766E';
const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

export const TEXT = Object.freeze({
  lede: 'Checks the tool against what is already known: how far the target moved, how much its brightness changed, and whether stars that should stand still do.',
  nothingLoaded: 'Nothing is loaded yet. Choose a target and wait for its exposures, or run the challenge targets from here.',
  how: 'Measured is what Tombaugh computed from the images just now. Catalogue is the independent value it should match: Gaia, the target table, or what pure noise gives. '
    + 'σ is the difference divided by the measurement’s own error. Within about 2 is agreement; a red dot marks anything beyond 3. '
    + 'The field stars are the control: stars that should not move, measured the same way.',
  copyBlocked: 'Copying is blocked in this window. The report is in the box below: press Ctrl+C, or Cmd+C on a Mac.',
  downloadBlocked: 'Downloads are blocked in this window. The JSON is in the box below.',
});

const STEP_TEXT = {
  'field stars': 'Centroiding the Gaia reference stars',
  stack: 'Stacking each pass',
  motion: 'Fitting the motion',
  variability: 'Comparing brightness between passes',
  spectrum: 'Reading the spectrum',
  quality: 'Counting flagged pixels',
  residuals: 'Testing the noise on blank sky',
  done: 'Writing the table',
};

// ---- pure helpers (tested in Node) ----------------------------------------------------------------

function niceCeil(v) {
  if (!(v > 0)) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / exp;
  const step = m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10;
  return Number((step * exp).toPrecision(6));
}

const px = (v) => String(Math.round(v * 100) / 100);

/** Half-width of the scatter plot in arcsec: a round number that holds nearly all the dots and the circle. */
export function scatterRange(alignment) {
  const a = alignment || {};
  const pts = (Array.isArray(a.points) ? a.points : []).filter((p) => p && isNum(p.dEast) && isNum(p.dNorth));
  if (!pts.length) return 1;
  const sigma = isNum(a.sigma) && a.sigma > 0 ? a.sigma : 0;
  const mE = isNum(a.medianEast) ? a.medianEast : 0;
  const mN = isNum(a.medianNorth) ? a.medianNorth : 0;
  const reach = pts.map((p) => Math.max(Math.abs(p.dEast), Math.abs(p.dNorth))).sort((x, y) => x - y);
  const most = reach[Math.floor(0.97 * (reach.length - 1))];
  return niceCeil(Math.max(most * 1.08, (Math.max(Math.abs(mE), Math.abs(mN)) + sigma) * 1.15, 0.02));
}

/**
 * The alignment scatter plot as SVG markup: one dot per field-star centroid at its offset from
 * the Gaia position, in arcsec, east to the left and north up, a cross at zero and a dashed
 * circle of 1-sigma radius around the median offset. Built from numbers only.
 * @param {object} alignment result of fieldstars.js alignment()
 * @param {{ size?: number }} [opts]
 * @returns {string} '' when there is nothing to plot
 */
export function scatterSvg(alignment, opts = {}) {
  const a = alignment || {};
  const pts = (Array.isArray(a.points) ? a.points : []).filter((p) => p && isNum(p.dEast) && isNum(p.dNorth));
  if (!pts.length) return '';
  const size = isNum(opts.size) && opts.size > 60 ? opts.size : 168;
  const pad = 13;
  const sigma = isNum(a.sigma) && a.sigma > 0 ? a.sigma : 0;
  const mE = isNum(a.medianEast) ? a.medianEast : 0;
  const mN = isNum(a.medianNorth) ? a.medianNorth : 0;
  const range = scatterRange(a);
  const c = size / 2;
  const half = size / 2 - pad;
  const k = half / range;
  const X = (east) => c - east * k;
  const Y = (north) => c - north * k;
  const tick = Number((range / 2).toPrecision(2));
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" `
    + `aria-label="Offsets of ${pts.length} field-star centroids from their Gaia positions, in arcsec. `
    + `Median ${mE.toFixed(2)} east, ${mN.toFixed(2)} north; scatter ${sigma.toFixed(2)} per axis.">`);
  out.push(`<rect x="${px(pad)}" y="${px(pad)}" width="${px(2 * half)}" height="${px(2 * half)}" fill="none" stroke="${STONE}" stroke-width="1"/>`);
  out.push(`<path d="M${px(pad)} ${px(c)}H${px(size - pad)}M${px(c)} ${px(pad)}V${px(size - pad)}" stroke="${STONE}" stroke-width="1" stroke-opacity="0.7"/>`);
  for (const s of [-1, 1]) {
    out.push(`<path d="M${px(X(s * tick))} ${px(c - 3)}v6M${px(c - 3)} ${px(Y(s * tick))}h6" stroke="${PAPER}" stroke-width="1" stroke-opacity="0.75"/>`);
  }
  for (const p of pts) {
    const inside = Math.abs(p.dEast) <= range && Math.abs(p.dNorth) <= range;
    const e = Math.max(-range, Math.min(range, p.dEast));
    const n = Math.max(-range, Math.min(range, p.dNorth));
    out.push(inside
      ? `<circle cx="${px(X(e))}" cy="${px(Y(n))}" r="2" fill="${PAPER}" fill-opacity="0.82"/>`
      : `<circle cx="${px(X(e))}" cy="${px(Y(n))}" r="2.5" fill="none" stroke="${PAPER}" stroke-width="1"/>`);
  }
  if (sigma > 0) {
    out.push(`<circle cx="${px(X(mE))}" cy="${px(Y(mN))}" r="${px(sigma * k)}" fill="none" stroke="${PAPER}" stroke-width="1.2" stroke-dasharray="4 3"/>`);
  }
  const label = 'font-family="Consolas, Menlo, monospace" font-size="10" fill="' + PAPER + '" fill-opacity="0.8"';
  out.push(`<text x="${px(pad / 2)}" y="${px(c + 3.5)}" text-anchor="middle" ${label}>E</text>`);
  out.push(`<text x="${px(c)}" y="${px(pad - 3)}" text-anchor="middle" ${label}>N</text>`);
  out.push(`<text x="${px(size - pad)}" y="${px(size - 2.5)}" text-anchor="end" ${label}>&#177;${range}&#8243;</text>`);
  out.push('</svg>');
  return out.join('');
}

/** The spacing of the tick marks in scatterSvg, arcsec (half of the frame's half-width). */
export function scatterTick(alignment) {
  return Number((scatterRange(alignment) / 2).toPrecision(2));
}

/** Counts for the one-line summary under the buttons: comparisons made and how many are flagged. */
export function tally(measurements) {
  let compared = 0;
  let flagged = 0;
  let measured = 0;
  const missing = [];
  for (const m of measurements || []) {
    if (!m) continue;
    if (m.noData) {
      missing.push((m.target && (m.target.name || m.target.id)) || 'one target');
      continue;
    }
    measured++;
    for (const r of [...toRows(m), ...(m.field ? fieldRows(m.field) : [])]) {
      if (r.sigma === null) continue;
      compared++;
      if (r.flag) flagged++;
    }
  }
  return { measured, missing, compared, flagged };
}

function listWords(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** The sentence shown when a run ends. */
export function summaryText(measurements, { cancelled = false, total = null } = {}) {
  const t = tally(measurements);
  const parts = [];
  if (total !== null) {
    if (cancelled) parts.push(`Cancelled after ${t.measured + t.missing.length} of ${total} targets. The report holds what was measured.`);
    else parts.push(`Measured ${t.measured} of ${total} targets.`);
  } else if (measurements.length === 1 && measurements[0] && !measurements[0].noData) {
    const m = measurements[0];
    const n = (m.passes || []).reduce((sum, p) => sum + (p.nExposures || 0), 0);
    const name = (m.target && m.target.name) || 'this field';
    parts.push(cancelled
      ? `Cancelled. ${name}: what was done by then is below.`
      : `Measured ${name} on D${m.det}: ${n} exposures in ${(m.passes || []).length} pass${(m.passes || []).length === 1 ? '' : 'es'}.`);
  }
  if (t.missing.length) parts.push(`${listWords(t.missing)} returned no data.`);
  if (t.compared) {
    parts.push(t.flagged
      ? `${t.flagged} of ${t.compared} comparisons differ${t.flagged === 1 ? 's' : ''} by more than 3 sigma.`
      : `All ${t.compared} comparisons agree within 3 sigma.`);
  }
  return parts.join(' ');
}

function coordText(t) {
  if (!t || !isNum(t.ra) || !isNum(t.dec)) return '';
  return `RA ${t.ra.toFixed(5)}, Dec ${t.dec >= 0 ? '+' : '−'}${Math.abs(t.dec).toFixed(5)}`;
}

// ---- DOM ------------------------------------------------------------------------------------------

function h(doc, tag, attrs, ...children) {
  const el = doc.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === false || value === null || value === undefined) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child.nodeType ? child : doc.createTextNode(String(child)));
  }
  return el;
}

function tableEl(doc, rows, caption) {
  const body = h(doc, 'tbody');
  let group = '';
  for (const r of rows) {
    if (r.group !== group) {
      group = r.group;
      body.append(h(doc, 'tr', { class: 'tbq-group' }, h(doc, 'th', { colspan: 4, scope: 'colgroup', text: group })));
    }
    const sig = h(doc, 'td', { class: 'tbq-sig' });
    if (r.flag) sig.append(h(doc, 'span', { class: 'tbq-flag', 'aria-hidden': 'true' }), h(doc, 'span', { class: 'tbq-sr', text: 'More than 3 sigma: ' }));
    sig.append(r.sigmaText || '');
    body.append(h(doc, 'tr', r.flag ? { 'data-flag': '1' } : null,
      h(doc, 'th', { scope: 'row', text: r.label }),
      h(doc, 'td', { text: r.measured, colspan: r.reference ? null : 2 }),
      r.reference ? h(doc, 'td', { class: 'tbq-ref', text: r.reference }) : null,
      sig));
  }
  return h(doc, 'table', { class: 'tbq-table' },
    h(doc, 'caption', { text: caption }),
    h(doc, 'colgroup', null, h(doc, 'col', { class: 'tbq-c-q' }), h(doc, 'col', { class: 'tbq-c-m' }), h(doc, 'col', { class: 'tbq-c-r' }), h(doc, 'col', { class: 'tbq-c-s' })),
    h(doc, 'thead', null, h(doc, 'tr', null,
      h(doc, 'th', { scope: 'col', text: 'Quantity' }), h(doc, 'th', { scope: 'col', text: 'Measured' }),
      h(doc, 'th', { scope: 'col', text: 'Catalogue' }), h(doc, 'th', { scope: 'col', class: 'tbq-th-s', title: 'Difference in sigma', 'aria-label': 'Difference in sigma', text: 'σ' }))),
    body);
}

function notesEl(doc, rows) {
  const notes = rows.filter((r) => r.note);
  if (!notes.length) return null;
  return h(doc, 'details', { class: 'tbq-notes' },
    h(doc, 'summary', { text: `Notes on ${notes.length === 1 ? 'one row' : `${notes.length} rows`}` }),
    h(doc, 'ul', null, notes.map((r) => h(doc, 'li', null, h(doc, 'b', { text: `${r.label}: ` }), r.note))));
}

function cardEl(doc, m, index) {
  const name = (m.target && (m.target.name || m.target.id)) || `Target ${index + 1}`;
  const card = h(doc, 'article', { class: 'tbq-card' });
  const head = h(doc, 'div', { class: 'tbq-card-head' }, h(doc, 'h3', { class: 'tbq-name', text: name }));
  card.append(head);
  if (m.noData) {
    const where = [coordText(m.target), isNum(m.det) ? `D${m.det}` : ''].filter(Boolean).join(' · ');
    if (where) head.append(h(doc, 'p', { class: 'tbq-meta tbq-n', text: where }));
    card.append(h(doc, 'p', { class: 'tbq-none', text: `No data: ${m.reason || 'no SPHEREx exposures arrived for this target'}. Nothing was measured.` }));
    return card;
  }
  const passes = m.passes || [];
  const nExp = passes.reduce((sum, p) => sum + (p.nExposures || 0), 0);
  head.append(h(doc, 'p', { class: 'tbq-meta' },
    h(doc, 'span', { class: 'tbq-n', text: [coordText(m.target), isNum(m.det) ? `D${m.det}` : ''].filter(Boolean).join(' · ') })));
  if (passes.length) {
    head.append(h(doc, 'p', { class: 'tbq-meta', text: `${nExp} exposures in ${passes.length} pass${passes.length === 1 ? '' : 'es'}: ${passes.map((p) => p.label).join(', ')}` }));
  }
  if (m.quality && m.quality.synthetic) head.append(h(doc, 'p', { class: 'tbq-meta', text: 'Synthetic test frames, not observations.' }));
  if (m.cancelled) card.append(h(doc, 'p', { class: 'tbq-none', text: 'Cancelled before it finished. The rows below are what was done by then.' }));
  if (m.partial) card.append(h(doc, 'p', { class: 'tbq-none', text: `Partial data: ${m.partial}.` }));
  const rows = toRows(m);
  card.append(tableEl(doc, rows, `${name}: measured against catalogue`));
  const notes = notesEl(doc, rows);
  if (notes) card.append(notes);

  if (m.field) {
    card.append(h(doc, 'h4', { class: 'tbq-sub', text: 'Field stars: the control' }));
    const a = m.field.alignment || {};
    const nt = m.field.nullTest || {};
    const svg = scatterSvg(a);
    const verdicts = h(doc, 'div', { class: 'tbq-verdicts' });
    if (a.verdict) verdicts.append(h(doc, 'p', null, h(doc, 'b', { text: 'Alignment. ' }), a.verdict));
    if (nt.verdict) verdicts.append(h(doc, 'p', null, h(doc, 'b', { text: 'Null test. ' }), nt.verdict));
    if (!a.verdict && !nt.verdict) verdicts.append(h(doc, 'p', { class: 'tbq-none', text: m.field.reason || a.reason || 'The field-star tests could not be run here.' }));
    if (svg) {
      const holder = h(doc, 'div');
      holder.innerHTML = svg; // numbers only, built by scatterSvg above
      const caption = `Each dot is one centroid minus its Gaia position. East is left; ticks every ${scatterTick(a)} arcsec. Dashed circle: 1 sigma, ${isNum(a.sigma) ? a.sigma.toFixed(2) : '?'} arcsec per axis.`;
      card.append(h(doc, 'div', { class: 'tbq-field' }, h(doc, 'figure', { class: 'tbq-plot' }, holder, h(doc, 'figcaption', { text: caption })), verdicts));
    } else {
      card.append(verdicts);
    }
    const fr = fieldRows(m.field);
    card.append(tableEl(doc, fr, `${name}: field-star controls`));
    const fnotes = notesEl(doc, fr);
    if (fnotes) card.append(fnotes);
  }
  return card;
}

/**
 * Add the Validation panel to the app.
 * @param {object} app the plugin host
 * @param {object} [options] for the demo and tests: targetsModule, targets, idleMs, maxMs,
 *   settleMs, gaiaWaitMs, order
 * @returns {{ dispose(): void } | undefined}
 */
export function install(app, options = {}) {
  if (!app || typeof app.addPanel !== 'function') return undefined;
  if (typeof document === 'undefined') return undefined;
  const doc = document;
  ensureValidateStyles(doc);

  const targetsModule = options.targetsModule || coreTargets;
  const tourTargets = Array.isArray(options.targets) ? options.targets : challengeTargets(targetsModule);
  const waits = { ...TOUR_DEFAULTS };
  for (const key of Object.keys(waits)) if (isNum(options[key])) waits[key] = options[key];

  let results = [];
  let runInfo = { total: null, cancelled: false };
  let controller = null;
  let busy = false;
  let disposed = false;
  let view = null;
  const offs = [];

  const meta_ = () => ({ version: app.version || '', generatedAt: new Date() });

  function setStatus(text, { busy: isBusy = false, fraction = null } = {}) {
    if (!view) return;
    view.status.textContent = text || '';
    view.status.classList.toggle('is-busy', !!isBusy);
    const f = fraction === null ? (isBusy ? 0.02 : 0) : Math.max(0, Math.min(1, fraction));
    view.fill.style.width = `${Math.round(f * 1000) / 10}%`;
    view.bar.setAttribute('aria-valuenow', String(Math.round(f * 100)));
    view.bar.hidden = !isBusy;
  }

  function refreshLoaded() {
    if (!view || disposed) return;
    const c = collectContext(app, { targetsModule, useSelection: true });
    const s = c.summary;
    if (!c.ok) {
      view.loaded.textContent = s.name ? `${s.name}: no exposures loaded yet.` : TEXT.nothingLoaded;
    } else {
      const others = s.dets.filter((d) => d !== s.det);
      view.loaded.textContent = `Loaded now: ${s.name || 'unnamed position'}, D${s.det}, ${s.nLayers} exposures`
        + `${others.length ? ` (also D${others.join(', D')})` : ''}, ${s.nStars} Gaia stars.`
        + `${s.selected ? ' The source you selected will be measured, not the field centre.' : ''}`;
    }
    if (!busy) view.measure.disabled = !c.ok;
  }

  function setBusy(on, trigger) {
    busy = on;
    if (!view) return;
    const hadFocus = doc.activeElement === view.measure || doc.activeElement === view.tour || doc.activeElement === view.cancel;
    view.tour.disabled = on || !tourTargets.length;
    view.measure.disabled = on;
    view.cancel.hidden = !on;
    view.root.setAttribute('aria-busy', on ? 'true' : 'false');
    if (on && hadFocus) view.cancel.focus();
    if (!on) {
      refreshLoaded();
      if (hadFocus && trigger && !trigger.disabled) trigger.focus();
    }
  }

  function renderResults() {
    if (!view) return;
    view.results.replaceChildren(...results.map((m, i) => cardEl(doc, m, i)));
    view.exportBox.hidden = !results.length;
    view.copyBox.hidden = true;
    view.exportStatus.textContent = '';
  }

  async function onMeasure() {
    if (busy || disposed) return;
    controller = new AbortController();
    const signal = controller.signal;
    setBusy(true, view.measure);
    setStatus('Collecting what is loaded', { busy: true });
    let out = null;
    try {
      out = await measureLoaded(app, {
        targetsModule, signal, useSelection: true, gaiaWaitMs: Math.min(2500, waits.gaiaWaitMs),
        onProgress: (p) => setStatus(`${STEP_TEXT[p.step] || 'Measuring'}`, { busy: true, fraction: p.step === 'field stars' ? 0.06 : 0.12 + 0.88 * (p.done / Math.max(1, p.total)) }),
      });
    } catch (err) {
      out = { ok: false, reason: `The measurement failed: ${err && err.message ? err.message : err}` };
    }
    if (disposed) return;
    if (out.ok) {
      results = [out.measurement];
      runInfo = { total: null, cancelled: !!out.measurement.cancelled };
      renderResults();
      setBusy(false, view.measure);
      setStatus(summaryText(results, runInfo));
    } else {
      setBusy(false, view.measure);
      setStatus(out.reason || 'Nothing could be measured.');
    }
    controller = null;
  }

  async function onTour() {
    if (busy || disposed || !tourTargets.length) return;
    controller = new AbortController();
    const signal = controller.signal;
    results = [];
    renderResults();
    setBusy(true, view.tour);
    const n = tourTargets.length;
    const onStatus = (s) => {
      const lead = `Target ${s.index + 1} of ${s.total}, ${s.target.name}`;
      if (s.phase === 'load') setStatus(`${lead}: asking the archive for D${s.det} exposures`, { busy: true, fraction: s.index / n });
      else if (s.phase === 'frames') {
        const part = s.loadTotal > 0 ? s.count / s.loadTotal : 0;
        setStatus(`${lead}: ${s.count} of ${s.loadTotal} exposures in`, { busy: true, fraction: (s.index + 0.6 * part) / n });
      } else {
        const part = s.step === 'field stars' ? 0 : s.done / Math.max(1, s.steps);
        setStatus(`${lead}: ${(STEP_TEXT[s.step] || 'measuring').toLowerCase()}`, { busy: true, fraction: (s.index + 0.6 + 0.4 * part) / n });
      }
    };
    let out = { results: [], total: n, cancelled: false };
    try {
      out = await runTour(app, {
        targetsModule, targets: tourTargets, signal, ...waits, onStatus,
        onResult: (m) => {
          if (disposed) return;
          results = results.concat([m]);
          renderResults();
        },
      });
    } catch (err) {
      out = { results, total: n, cancelled: false, error: err && err.message ? err.message : String(err) };
    }
    if (disposed) return;
    runInfo = { total: n, cancelled: !!out.cancelled };
    setBusy(false, view.tour);
    setStatus(out.error ? `The run stopped: ${out.error}` : summaryText(results, runInfo));
    controller = null;
  }

  function onCancel() {
    if (!controller) return;
    setStatus('Cancelling: finishing the step in hand', { busy: true });
    try {
      controller.abort();
    } catch {
      // nothing to cancel
    }
  }

  function showBox(text, message) {
    view.copyBox.hidden = false;
    view.copyBox.value = text;
    view.exportStatus.textContent = message;
    try {
      view.copyBox.focus();
      view.copyBox.select();
    } catch {
      // focus is a convenience
    }
  }

  async function onCopy() {
    if (!results.length || disposed) return;
    let text = '';
    try {
      text = toMarkdown(results, meta_());
    } catch (err) {
      view.exportStatus.textContent = `The report could not be written: ${err && err.message ? err.message : err}`;
      return;
    }
    let ok = false;
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch {
      ok = false;
    }
    if (disposed) return;
    if (!ok) {
      showBox(text, TEXT.copyBlocked);
      try {
        ok = typeof doc.execCommand === 'function' && doc.execCommand('copy');
      } catch {
        ok = false;
      }
      if (ok) view.copyBox.hidden = true;
    }
    if (ok) {
      view.exportStatus.textContent = `Copied: ${text.split('\n').length} lines of Markdown.`;
      try {
        view.copy.focus();
      } catch {
        // focus is a convenience
      }
    }
  }

  function onDownload() {
    if (!results.length || disposed) return;
    let text = '';
    try {
      text = JSON.stringify(toJson(results, meta_()), null, 2);
    } catch (err) {
      view.exportStatus.textContent = `The JSON could not be written: ${err && err.message ? err.message : err}`;
      return;
    }
    const name = `tombaugh-validation-${new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-')}.json`;
    try {
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const link = h(doc, 'a', { href: url, download: name, hidden: true });
      view.root.append(link);
      link.click();
      link.remove();
      setTimeout(() => {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // already gone
        }
      }, 5000);
      view.copyBox.hidden = true;
      view.exportStatus.textContent = `Saved ${name}, ${Math.max(1, Math.round(text.length / 1024))} kB.`;
    } catch {
      showBox(text, TEXT.downloadBlocked);
    }
  }

  const guard = (fn) => (event) => {
    try {
      const p = fn(event);
      if (p && typeof p.catch === 'function') p.catch((err) => console.warn('[tombaugh] validation:', err && err.message ? err.message : err));
    } catch (err) {
      console.warn('[tombaugh] validation:', err && err.message ? err.message : err);
    }
  };

  function render(container) {
    const count = tourTargets.length;
    const word = NUMBER_WORDS[count] || String(count);
    const measure = h(doc, 'button', { type: 'button', class: 'tbq-btn tbq-btn-solid', text: 'Measure this field' });
    const tour = h(doc, 'button', { type: 'button', class: 'tbq-btn', text: `Run the ${word} challenge target${count === 1 ? '' : 's'}`, disabled: !count });
    const cancel = h(doc, 'button', { type: 'button', class: 'tbq-btn', text: 'Cancel', hidden: true });
    const loaded = h(doc, 'p', { class: 'tbq-meta', text: TEXT.nothingLoaded });
    const status = h(doc, 'p', { class: 'tbq-status', role: 'status', 'aria-live': 'polite' });
    const fill = h(doc, 'span');
    const bar = h(doc, 'div', { class: 'tbq-bar', role: 'progressbar', 'aria-label': 'Progress of the measurement', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': 0, hidden: true }, fill);
    const resultsEl = h(doc, 'div', { class: 'tbq-results' });
    const copy = h(doc, 'button', { type: 'button', class: 'tbq-btn tbq-btn-small', text: 'Copy report (Markdown)' });
    const download = h(doc, 'button', { type: 'button', class: 'tbq-btn tbq-btn-small', text: 'Download JSON' });
    const exportStatus = h(doc, 'p', { class: 'tbq-status', role: 'status', 'aria-live': 'polite' });
    const copyBox = h(doc, 'textarea', { class: 'tbq-copybox', readonly: true, hidden: true, spellcheck: 'false', 'aria-label': 'The report as text' });
    const exportBox = h(doc, 'div', { class: 'tbq-export', hidden: true },
      h(doc, 'div', { class: 'tbq-actions' }, copy, download), exportStatus, copyBox,
      h(doc, 'p', { class: 'tbq-how', text: TEXT.how }));
    const root = h(doc, 'div', { class: 'tbq', 'aria-busy': 'false' },
      h(doc, 'p', { class: 'tbq-lede', text: TEXT.lede }),
      h(doc, 'div', { class: 'tbq-actions' }, measure, tour, cancel),
      h(doc, 'div', { class: 'tbq-run' }, loaded, status, bar),
      resultsEl, exportBox);
    measure.addEventListener('click', guard(onMeasure));
    tour.addEventListener('click', guard(onTour));
    cancel.addEventListener('click', guard(onCancel));
    copy.addEventListener('click', guard(onCopy));
    download.addEventListener('click', guard(onDownload));
    container.replaceChildren(root);
    view = { root, measure, tour, cancel, loaded, status, bar, fill, results: resultsEl, exportBox, copy, download, exportStatus, copyBox };
    renderResults();
    refreshLoaded();
    return {
      update: () => refreshLoaded(),
      dispose: () => stop(),
    };
  }

  function stop() {
    if (disposed) return;
    disposed = true;
    try {
      if (controller) controller.abort();
    } catch {
      // nothing to cancel
    }
    controller = null;
    for (const off of offs.splice(0)) {
      try {
        off();
      } catch {
        // ignore
      }
    }
    if (view && view.root) view.root.remove();
    view = null;
  }

  if (typeof app.on === 'function') {
    for (const event of ['target', 'frames', 'select']) {
      try {
        const off = app.on(event, guard(() => {
          if (!busy) refreshLoaded();
        }));
        if (typeof off === 'function') offs.push(off);
      } catch {
        // an app without this event still gets the panel
      }
    }
  }

  let panel = null;
  try {
    panel = app.addPanel({ id: meta.id, title: meta.title, order: isNum(options.order) ? options.order : 70, render });
  } catch (err) {
    console.warn('[tombaugh] validation panel could not be added:', err && err.message ? err.message : err);
    stop();
    return undefined;
  }
  return {
    dispose() {
      stop();
      try {
        if (panel && typeof panel.remove === 'function') panel.remove();
      } catch {
        // already removed
      }
    },
  };
}
