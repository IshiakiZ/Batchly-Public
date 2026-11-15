// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

// Plugin "moving": follow a solar-system body through SPHEREx exposures.
//
// SPHEREx images every part of the sky about every six months, and a body that moves is in a
// different place in every exposure, so a fixed-position movie never shows it. This plugin asks
// where the body was at each moment (an ephemeris from JPL Horizons through the proxy, or the
// parallax model for a hypothetical body), asks the proxy's exposure index which exposures
// contained it, shows that plan, and only then downloads the cutouts, each centred on the body.
// The frames are stacked in the body's own frame (comoving.js): the body stays sharp at the
// centre while the stars streak past and average away. A spectrum comes from aperture
// photometry on the native frames.
//
// What it adds to the shell: a tool button (group 'view'), a side panel "Solar system", and a
// view 'comoving' ("Follow body") whose movie frames are the co-moving stacks.
//
// Proxy routes used (see proxy/src/horizons.js and the exposure index):
//   GET  /ephemeris?body=<name>&start=<mjd>&end=<mjd>&step=<hours>
//   POST /track   { samples: [[mjd, ra, dec], ...] }  ->  { frames: [{ id, det, mjd, ra, dec, ... }] }
//   GET  /cutout?id&ra&dec&size   (existing), with the body's position at that exposure as centre
// through app.api.ephemeris / app.api.track when the shell's API client has them, otherwise
// with fetch against app.api.baseUrl.

import { CATALOGUE, HYPOTHETICAL, bodyQuery, hypotheticalEphemeris, kindLabel } from './bodies.js';
import {
  SURVEY_START_MJD, attachPositions, dateRangeLabel, dayLabel, makeEphemeris, monthLabel, pathPointAt,
  planSentence, positionAt, skyPath, summarizeTrack, trackSamples,
} from './track.js';
import {
  COMOVING_NOTE, DEFAULT_SCALE_ARCSEC, STARFIXED_NOTE, bandDepth, bodySpectrum, buildComovingLayers,
  comovingGrid, comovingStacks, extendedness, movieFrames, radialProfile, stackRange, starFixedStack, verdict,
} from './comoving.js';
import { ensureMovingStyles } from './moving.css.js';
import { makeGrid, parseCoord } from '../../core/wcs.js';
import { DETECTORS } from '../../core/frames.js';
import { cutoutSizeDeg } from '../../loader.js';

export const meta = {
  id: 'moving',
  title: 'Solar system',
  description: 'Follow a moving solar-system body through SPHEREx exposures and stack them in its own frame.',
};

/** Most exposures downloaded for one body; more are thinned evenly per detector. */
export const MAX_EXPOSURES = 360;
const VIEW_ID = 'comoving';
const SVG_NS = 'http://www.w3.org/2000/svg';
const INK = '#171715';
const PAPER = '#F7F2E7';
const SIGNAL = '#E53C27';
const STONE = '#77766E';
const MUTED = '#ADA99E';
const FONT_NUM = 'Consolas, "SFMono-Regular", Menlo, "DejaVu Sans Mono", monospace';
const FONT_TXT = 'Arial, Helvetica, sans-serif';
const TOOL_ICON = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.3">'
  + '<ellipse cx="8" cy="8" rx="6.5" ry="3" transform="rotate(-24 8 8)"/><circle cx="12.6" cy="5.2" r="1.5" fill="currentColor" stroke="none"/></svg>';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const mjdNow = () => Date.now() / 86400000 + 40587;

/** Display text: the data modules write "um" and "microJy" in plain ASCII. */
function pretty(text) {
  return String(text || '').replace(/(\d|\s)um\b/g, '$1µm').replace(/microJy/g, 'µJy');
}

function isAbort(err) {
  return !!err && (err.aborted === true || err.name === 'AbortError');
}

// ---------------------------------------------------------------------------------------------
// Data access (no DOM)
// ---------------------------------------------------------------------------------------------

/**
 * The three calls the plugin makes, on top of the shell's API client.
 *   ephemeris(body, startMjd, endMjd, stepHours, { signal })  -> the /ephemeris answer
 *   track(samples, { dets, maxPerDet, signal })               -> the /track answer
 *   cutout(id, ra, dec, size, { signal })                     -> Frame
 * Uses api.ephemeris / api.track when they exist (same argument order as above); otherwise
 * fetches `${api.baseUrl}/ephemeris` and `${api.baseUrl}/track` itself. Errors carry `message`
 * and, where the proxy sent them, `code` ('AMBIGUOUS', 'NOT_FOUND', ...), `matches`, `status`
 * and `retryable`.
 */
export function createMovingService(api, { fetchImpl } = {}) {
  const base = String((api && api.baseUrl) || '').replace(/\/+$/, '');
  const doFetch = (...args) => (fetchImpl || globalThis.fetch)(...args);

  async function call(path, init) {
    let response;
    try {
      response = await doFetch(`${base}/${path}`, init);
    } catch (err) {
      if (isAbort(err)) throw Object.assign(new Error('Request cancelled'), { aborted: true, name: 'AbortError' });
      throw Object.assign(new Error('The Tombaugh data service could not be reached.'), { retryable: true });
    }
    let body = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    if (!response.ok) {
      const err = new Error(body && typeof body.error === 'string' ? body.error : `The data service answered ${response.status}.`);
      err.status = response.status;
      err.code = body && body.code ? String(body.code) : '';
      err.matches = body && typeof body.matches === 'string' ? body.matches : '';
      err.retryable = body && typeof body.retryable === 'boolean' ? body.retryable : response.status >= 500;
      throw err;
    }
    if (!body) throw Object.assign(new Error('The data service sent an unreadable answer.'), { retryable: true });
    return body;
  }

  return {
    ephemeris(body, startMjd, endMjd, stepHours, { signal } = {}) {
      if (api && typeof api.ephemeris === 'function') return api.ephemeris(body, startMjd, endMjd, stepHours, { signal });
      const q = new URLSearchParams({ body, start: String(startMjd), end: String(endMjd), step: String(stepHours) });
      return call(`ephemeris?${q.toString()}`, { method: 'GET', signal });
    },
    track(samples, { dets, maxPerDet, signal } = {}) {
      if (api && typeof api.track === 'function') return api.track(samples, { dets, maxPerDet, signal });
      const payload = { samples };
      if (Array.isArray(dets) && dets.length) payload.dets = dets;
      if (maxPerDet > 0) payload.maxPerDet = maxPerDet;
      return call('track', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal });
    },
    cutout(id, ra, dec, size, opts) {
      return api.cutout(id, ra, dec, size, opts);
    },
  };
}

/** Keep at most `max` exposure references, thinned evenly in time within each detector. */
export function thinRefs(refs, max = MAX_EXPOSURES) {
  const list = (refs || []).slice().sort((a, b) => a.mjd - b.mjd);
  if (list.length <= max) return list;
  const keepEvery = list.length / max;
  const out = [];
  for (let det = 0; det <= 6; det++) {
    const sel = list.filter((r) => (r.det >= 1 && r.det <= 6 ? r.det : 0) === det);
    const want = Math.max(1, Math.floor(sel.length / keepEvery));
    for (let i = 0; i < want && sel.length; i++) out.push(sel[Math.min(sel.length - 1, Math.floor((i + 0.5) * sel.length / want))]);
  }
  return [...new Set(out)].sort((a, b) => a.mjd - b.mjd).slice(0, max);
}

/**
 * Download cutouts with bounded concurrency, retries and cancellation.
 * refs: [{ id, ra, dec, ... }]; cutout(id, ra, dec, size, { signal }) -> Promise<Frame>.
 * A 404 means the archive has no file for that exposure: counted in `skipped`, not retried.
 * Other failures are retried `retries` times with growing pauses, then counted in `failed`.
 * Resolves to { loaded: [{ ref, frame }], failed, skipped } in time order; rejects with an
 * AbortError when the signal fires. onProgress({ done, total, failed, skipped }).
 */
export async function loadCutouts(refs, { cutout, size, concurrency = 6, retries = 2, backoffMs = 400, signal = null, onProgress = null, sleep = null } = {}) {
  const list = refs || [];
  const wait = sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const loaded = [];
  let next = 0;
  let done = 0;
  let failed = 0;
  let skipped = 0;
  const aborted = () => Object.assign(new Error('Download cancelled'), { name: 'AbortError', aborted: true });
  const report = () => {
    if (typeof onProgress !== 'function') return;
    try {
      onProgress({ done, total: list.length, failed, skipped });
    } catch {
      // a broken progress handler must not stop the download
    }
  };
  async function one(ref) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (signal && signal.aborted) throw aborted();
      try {
        const frame = await cutout(ref.id, ref.ra, ref.dec, size, { signal });
        if (frame && frame.image) return { ref, frame };
        throw Object.assign(new Error('empty frame'), { retryable: false });
      } catch (err) {
        if (isAbort(err) || (signal && signal.aborted)) throw aborted();
        if (err && err.status === 404) return 'skipped';
        if ((err && err.retryable === false) || attempt === retries) return 'failed';
        await wait(backoffMs * 3 ** attempt);
      }
    }
    return 'failed';
  }
  async function worker() {
    while (next < list.length) {
      const ref = list[next++];
      const result = await one(ref);
      if (result === 'skipped') skipped++;
      else if (result === 'failed') failed++;
      else loaded.push(result);
      done++;
      report();
    }
  }
  report();
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, list.length)) }, worker));
  loaded.sort((a, b) => a.frame.mjd - b.frame.mjd);
  return { loaded, failed, skipped };
}

// ---------------------------------------------------------------------------------------------
// Small DOM helpers
// ---------------------------------------------------------------------------------------------

function h(doc, tag, attrs, ...children) {
  const el = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c.nodeType ? c : doc.createTextNode(String(c)));
  }
  return el;
}

function s(doc, tag, attrs, parent, text) {
  const el = doc.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v !== null && v !== undefined) el.setAttribute(k, String(v));
  if (text !== undefined) el.textContent = text;
  if (parent) parent.appendChild(el);
  return el;
}

function clear(node) {
  while (node && node.firstChild) node.removeChild(node.firstChild);
}

function fmtFlux(uJy) {
  if (!isNum(uJy)) return '';
  const a = Math.abs(uJy);
  if (a >= 1000) return `${(uJy / 1000).toPrecision(3)} mJy`;
  return `${a >= 10 ? uJy.toFixed(0) : uJy.toFixed(1)} µJy`;
}

function niceTicks(lo, hi, count = 4) {
  const span = hi - lo;
  if (!(span > 0)) return [lo];
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((v) => v >= raw) || 10 * mag;
  const out = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------------------------

/** Paint a stack (n x n, row 0 = south) on a canvas: north up, east left, asinh stretch. */
function drawStack(canvas, image, mask, n, range) {
  canvas.width = n;
  canvas.height = n;
  let ctx = null;
  try {
    ctx = canvas.getContext('2d');
  } catch {
    ctx = null;
  }
  if (!ctx) return;
  const out = ctx.createImageData(n, n);
  const [lo, hi] = range;
  const k = 6;
  const norm = Math.asinh(k);
  const span = hi > lo ? hi - lo : 1;
  for (let y = 0; y < n; y++) {
    const srcRow = (n - 1 - y) * n;
    for (let x = 0; x < n; x++) {
      const i = srcRow + x;
      const o = (y * n + x) * 4;
      const v = image[i];
      if ((mask && mask[i]) || v - v !== 0) {
        out.data[o] = 9; out.data[o + 1] = 9; out.data[o + 2] = 8; out.data[o + 3] = 255;
        continue;
      }
      let t = (v - lo) / span;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const g = Math.asinh(t * k) / norm;
      out.data[o] = 23 + (247 - 23) * g;
      out.data[o + 1] = 23 + (242 - 23) * g;
      out.data[o + 2] = 21 + (231 - 21) * g;
      out.data[o + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
}

/** Reticle, compass, scale bar and (for the star-fixed view) the body's track, over the stack. */
function drawOverlay(doc, svg, { n, scale, track = null, centred = true }) {
  clear(svg);
  svg.setAttribute('viewBox', '0 0 100 100');
  const u = 100 / n; // viewBox units per grid pixel
  const toX = (x) => (x + 0.5) * u;
  const toY = (y) => (n - 1 - y + 0.5) * u;
  if (track && track.length > 1) {
    const pts = track.map((p) => `${toX(p.x).toFixed(2)},${toY(p.y).toFixed(2)}`).join(' ');
    s(doc, 'polyline', { points: pts, fill: 'none', stroke: SIGNAL, 'stroke-width': 0.5, 'stroke-dasharray': '1.2 1.2', opacity: 0.9 }, svg);
    for (const p of [track[0], track[track.length - 1]]) s(doc, 'circle', { cx: toX(p.x), cy: toY(p.y), r: 0.9, fill: SIGNAL }, svg);
  }
  if (centred) {
    const c = 50;
    const a = 4.2;
    const b = 9;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      s(doc, 'line', { x1: c + dx * a, y1: c + dy * a, x2: c + dx * b, y2: c + dy * b, stroke: SIGNAL, 'stroke-width': 0.6 }, svg);
    }
  }
  const label = { fill: PAPER, 'font-family': FONT_TXT, 'font-size': 4.2, opacity: 0.85 };
  s(doc, 'text', { ...label, x: 50, y: 5.4, 'text-anchor': 'middle' }, svg, 'N');
  s(doc, 'text', { ...label, x: 2, y: 51.5 }, svg, 'E');
  const bar = (30 / scale) * u;
  s(doc, 'line', { x1: 4, y1: 95, x2: 4 + bar, y2: 95, stroke: PAPER, 'stroke-width': 0.7, opacity: 0.85 }, svg);
  s(doc, 'text', { ...label, x: 4, y: 92.5, 'font-family': FONT_NUM, 'font-size': 3.8 }, svg, '30″');
}

/** The body's path over the survey with the visits marked. RA increases to the left. */
function drawTrack(doc, svg, eph, summary) {
  clear(svg);
  const W = 320;
  const H = 150;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const path = skyPath(eph);
  if (!path.points.length) return '';
  const pad = { l: 26, r: 26, t: 22, b: 24 };
  const xSpan = Math.max(path.xMax - path.xMin, 1e-5);
  const ySpan = Math.max(path.yMax - path.yMin, 1e-5);
  const k = Math.min((W - pad.l - pad.r) / xSpan, (H - pad.t - pad.b) / ySpan);
  const xMid = 0.5 * (path.xMin + path.xMax);
  const yMid = 0.5 * (path.yMin + path.yMax);
  const cx = pad.l + (W - pad.l - pad.r) / 2;
  const cy = pad.t + (H - pad.t - pad.b) / 2;
  const X = (x) => cx - (x - xMid) * k; // larger RA to the left
  const Y = (y) => cy - (y - yMid) * k;
  s(doc, 'polyline', {
    points: path.points.map((p) => `${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' '),
    fill: 'none', stroke: STONE, 'stroke-width': 1.2, 'stroke-linejoin': 'round',
  }, svg);
  // start and end
  const first = path.points[0];
  const last = path.points[path.points.length - 1];
  const small = { fill: MUTED, 'font-family': FONT_NUM, 'font-size': 9 };
  s(doc, 'circle', { cx: X(first.x), cy: Y(first.y), r: 2, fill: STONE }, svg);
  const anchorOf = (px) => (px > W - 70 ? 'end' : px < 70 ? 'start' : 'middle');
  const visitPts = (summary ? summary.visits : []).map((v) => pathPointAt(eph, path, v.mjdMid)).filter(Boolean);
  // An end label is dropped when a visit label would sit on top of it.
  const clearOfVisits = (px, py) => visitPts.every((p) => Math.hypot(X(p.x) - px, Y(p.y) - py) > 62);
  if (clearOfVisits(X(first.x), Y(first.y))) {
    s(doc, 'text', { ...small, x: X(first.x), y: Math.min(H - 4, Y(first.y) + 13), 'text-anchor': anchorOf(X(first.x)) }, svg, monthLabel(first.mjd));
  }
  // arrow head at the end
  const prev = path.points[Math.max(0, path.points.length - 4)];
  const ang = Math.atan2(Y(last.y) - Y(prev.y), X(last.x) - X(prev.x));
  const ax = X(last.x);
  const ay = Y(last.y);
  const tip = (da, len) => `${(ax - len * Math.cos(ang + da)).toFixed(1)},${(ay - len * Math.sin(ang + da)).toFixed(1)}`;
  s(doc, 'polygon', { points: `${ax.toFixed(1)},${ay.toFixed(1)} ${tip(0.45, 7)} ${tip(-0.45, 7)}`, fill: STONE }, svg);
  if (clearOfVisits(ax, ay)) {
    s(doc, 'text', { ...small, x: ax, y: Math.min(H - 4, ay + 13), 'text-anchor': anchorOf(ax) }, svg, monthLabel(last.mjd));
  }
  // visits
  const visits = summary ? summary.visits : [];
  let lastLabelX = -Infinity;
  for (const v of visits) {
    const p = pathPointAt(eph, path, v.mjdMid);
    if (!p) continue;
    const px = X(p.x);
    const py = Y(p.y);
    s(doc, 'circle', { cx: px, cy: py, r: 3.6, fill: SIGNAL, stroke: INK, 'stroke-width': 1 }, svg);
    if (Math.abs(px - lastLabelX) > 44) {
      s(doc, 'text', { fill: PAPER, 'font-family': FONT_TXT, 'font-size': 10, x: px, y: Math.max(10, py - 8), 'text-anchor': anchorOf(px) }, svg, v.label);
      lastLabelX = px;
    }
  }
  // compass and span
  s(doc, 'text', { ...small, x: 6, y: 12 }, svg, 'E ←');
  s(doc, 'text', { ...small, x: W - 6, y: 12, 'text-anchor': 'end' }, svg, 'N ↑');
  const span = Math.hypot(path.xMax - path.xMin, path.yMax - path.yMin);
  const spanText = span >= 1 ? `${span.toFixed(1)}°` : span >= 1 / 60 ? `${(span * 60).toFixed(0)}′` : `${(span * 3600).toFixed(0)}″`;
  s(doc, 'text', { ...small, x: W - 6, y: H - 6, 'text-anchor': 'end' }, svg, `path spans ${spanText}`);
  return `Path of the body on the sky from ${monthLabel(first.mjd)} to ${monthLabel(last.mjd)}, spanning ${spanText}, with ${visits.length} SPHEREx ${visits.length === 1 ? 'visit' : 'visits'} marked.`;
}

/** Compact spectrum: per-exposure points, channel means with error bars, expected bands marked. */
function drawSpectrum(doc, svg, { kept, binned, bands }) {
  clear(svg);
  const W = 400;
  const H = 210;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const m = { l: 40, r: 8, t: 32, b: 30 };
  const x0 = 0.7;
  const x1 = 5.1;
  const X = (w) => m.l + ((w - x0) / (x1 - x0)) * (W - m.l - m.r);
  const use = binned.length ? binned : kept;
  if (!use.length) {
    s(doc, 'text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', fill: MUTED, 'font-family': FONT_TXT, 'font-size': 13 }, svg, 'No usable photometry for a spectrum.');
    return 'No usable photometry for a spectrum.';
  }
  let lo = 0;
  let hi = -Infinity;
  for (const p of use) {
    const e = isNum(p.err_uJy) ? p.err_uJy : 0;
    if (p.flux_uJy - e < lo) lo = p.flux_uJy - e;
    if (p.flux_uJy + e > hi) hi = p.flux_uJy + e;
  }
  if (!(hi > lo)) hi = lo + 1;
  const padY = 0.08 * (hi - lo);
  hi += padY;
  if (lo < 0) lo -= padY;
  const unit = Math.max(Math.abs(hi), Math.abs(lo)) >= 2000 ? 1000 : 1;
  const Y = (f) => H - m.b - ((f - lo) / (hi - lo)) * (H - m.t - m.b);
  const text = { fill: MUTED, 'font-family': FONT_NUM, 'font-size': 10 };

  // detector bands
  for (const d of DETECTORS) {
    if (d.det % 2 === 1) s(doc, 'rect', { x: X(d.min), y: m.t, width: X(d.max) - X(d.min), height: H - m.t - m.b, fill: PAPER, opacity: 0.045 }, svg);
    s(doc, 'text', { ...text, x: (X(d.min) + X(d.max)) / 2, y: H - m.b - 4, 'text-anchor': 'middle', fill: STONE, 'font-size': 9 }, svg, `D${d.det}`);
  }
  // axes
  s(doc, 'line', { x1: m.l, y1: H - m.b, x2: W - m.r, y2: H - m.b, stroke: STONE, 'stroke-width': 1 }, svg);
  s(doc, 'line', { x1: m.l, y1: m.t, x2: m.l, y2: H - m.b, stroke: STONE, 'stroke-width': 1 }, svg);
  for (const w of [1, 2, 3, 4, 5]) {
    s(doc, 'line', { x1: X(w), y1: H - m.b, x2: X(w), y2: H - m.b + 4, stroke: STONE }, svg);
    s(doc, 'text', { ...text, x: X(w), y: H - m.b + 15, 'text-anchor': 'middle' }, svg, String(w));
  }
  s(doc, 'text', { ...text, x: W - m.r, y: H - 3, 'text-anchor': 'end', 'font-family': FONT_TXT }, svg, 'wavelength, µm');
  for (const v of niceTicks(lo, hi, 4)) {
    s(doc, 'line', { x1: m.l - 4, y1: Y(v), x2: W - m.r, y2: Y(v), stroke: v === 0 ? STONE : PAPER, opacity: v === 0 ? 0.8 : 0.08 }, svg);
    s(doc, 'text', { ...text, x: m.l - 7, y: Y(v) + 3.5, 'text-anchor': 'end' }, svg, String(Math.round((v / unit) * 100) / 100));
  }
  s(doc, 'text', { ...text, x: 4, y: m.t - 14, 'font-family': FONT_TXT }, svg, unit === 1000 ? 'flux, mJy' : 'flux, µJy');

  // expected bands
  let lastX = -Infinity;
  let row = 0;
  for (const b of (bands || []).slice().sort((p, q) => p.wave - q.wave)) {
    const bx = X(b.wave);
    s(doc, 'line', { x1: bx, y1: m.t, x2: bx, y2: H - m.b, stroke: SIGNAL, 'stroke-width': 1, 'stroke-dasharray': '3 3', opacity: 0.9 }, svg);
    row = bx - lastX < 48 ? (row + 1) % 2 : 0;
    lastX = bx;
    const t = s(doc, 'text', { x: bx, y: m.t - 4 - row * 11, 'text-anchor': 'middle', fill: PAPER, 'font-family': FONT_TXT, 'font-size': 10 }, svg, pretty(b.label));
    s(doc, 'title', {}, t, pretty(b.what));
  }
  // per-exposure points
  for (const p of kept) {
    if (!isNum(p.flux_uJy) || p.flux_uJy < lo || p.flux_uJy > hi) continue;
    s(doc, 'circle', { cx: X(p.wave), cy: Y(p.flux_uJy), r: 1.3, fill: STONE, opacity: 0.75 }, svg);
  }
  // channel means
  for (const p of binned) {
    const px = X(p.wave);
    if (isNum(p.err_uJy) && p.err_uJy > 0) {
      s(doc, 'line', { x1: px, y1: Y(Math.min(hi, p.flux_uJy + p.err_uJy)), x2: px, y2: Y(Math.max(lo, p.flux_uJy - p.err_uJy)), stroke: PAPER, 'stroke-width': 1 }, svg);
    }
    s(doc, 'circle', { cx: px, cy: Y(p.flux_uJy), r: 2.6, fill: PAPER, stroke: INK, 'stroke-width': 0.6 }, svg);
  }
  const fluxes = binned.map((p) => p.flux_uJy);
  return binned.length
    ? `Spectrum from ${kept.length} exposures in ${binned.length} channels, ${binned[0].wave.toFixed(2)} to ${binned[binned.length - 1].wave.toFixed(2)} micrometres, ${fmtFlux(Math.min(...fluxes))} to ${fmtFlux(Math.max(...fluxes))}.`
    : `Spectrum from ${kept.length} exposures.`;
}

// ---------------------------------------------------------------------------------------------
// The plugin
// ---------------------------------------------------------------------------------------------

export function install(app) {
  if (!app || typeof app.addPanel !== 'function' || !app.api) return { dispose() {} };
  const service = createMovingService(app.api);
  const warn = (what, err) => {
    try {
      console.warn(`[tombaugh] moving: ${what}`, err);
    } catch {
      // no console
    }
  };
  /** Wrap an event handler: it never throws, and a rejected promise is only logged. */
  const safe = (fn) => (...args) => {
    try {
      const r = fn(...args);
      if (r && typeof r.catch === 'function') r.catch((err) => warn('handler failed', err));
    } catch (err) {
      warn('handler failed', err);
    }
  };

  const st = {
    phase: 'idle',        // idle | ephemeris | track | plan | empty | loading | stacking | done | error
    token: 0,
    controller: null,
    chosen: null,         // catalogue entry, or null for typed text
    name: '',
    hypothetical: false,
    response: null,
    eph: null,
    refs: [],
    summary: null,
    planText: '',
    indexNote: '',
    progress: { done: 0, total: 0, failed: 0, skipped: 0, label: '' },
    loadStats: null,
    items: [],
    itemOf: new Map(),    // frame -> item
    spectrum: null,
    analyses: new Map(),  // 'n:scale' -> { n, scale, stacks, entries, profile, ext, fixed: Map }
    selected: 0,
    compare: false,
    error: null,
  };
  let ui = null;
  let disposed = false;

  const fov = () => {
    let f = 4;
    try {
      const v = app.store && app.store.get ? app.store.get().fov : 4;
      if ([2, 4, 6, 10].includes(v)) f = v;
    } catch {
      f = 4;
    }
    return f;
  };
  const panelDims = () => {
    const g = makeGrid(0, 0, fov(), DEFAULT_SCALE_ARCSEC);
    return { n: g.n, scale: g.scale };
  };

  function cancelWork() {
    st.token++;
    if (st.controller) {
      try {
        st.controller.abort();
      } catch {
        // already gone
      }
    }
    st.controller = null;
  }

  function resetRun() {
    st.response = null;
    st.eph = null;
    st.refs = [];
    st.summary = null;
    st.planText = '';
    st.indexNote = '';
    st.items = [];
    st.itemOf = new Map();
    st.spectrum = null;
    st.analyses = new Map();
    st.selected = 0;
    st.loadStats = null;
    st.error = null;
    st.progress = { done: 0, total: 0, failed: 0, skipped: 0, label: '' };
  }

  // ---- the run -------------------------------------------------------------------------------

  async function follow({ entry = null, text = '', hypo = null }) {
    cancelWork();
    resetRun();
    const token = st.token;
    const controller = new AbortController();
    st.controller = controller;
    const stale = () => disposed || token !== st.token;
    st.chosen = entry;
    st.hypothetical = !!hypo;
    st.name = hypo ? HYPOTHETICAL.name : entry ? entry.name : text;
    st.phase = 'ephemeris';
    render();
    try {
      let response;
      if (hypo) {
        response = hypotheticalEphemeris({ ...hypo, startMjd: SURVEY_START_MJD, endMjd: Math.ceil(mjdNow()) });
        st.name = response.name;
      } else {
        const query = bodyQuery(entry ? entry.command : text);
        const step = entry ? entry.stepHours : 12;
        response = await service.ephemeris(query.body, SURVEY_START_MJD, Math.ceil(mjdNow()), step, { signal: controller.signal });
        if (stale()) return;
        if (!entry && response && typeof response.name === 'string' && response.name) st.name = response.name;
      }
      const eph = makeEphemeris(response);
      if (eph.n < 2) throw new Error('The ephemeris came back empty.');
      st.response = response;
      st.eph = eph;
      st.phase = 'track';
      render();
      let answer;
      let fallbackNote = '';
      try {
        answer = await service.track(trackSamples(eph), { signal: controller.signal });
      } catch (err) {
        if (stale() || isAbort(err)) return;
        // Without the exposure index (the practice sky has none) a body that stays within a
        // fraction of a detector can still be followed: ask the ordinary fixed-position search
        // for the middle of its path. Cutouts the body is not on simply fail and are skipped.
        const path = skyPath(eph);
        const span = Math.hypot(path.xMax - path.xMin, path.yMax - path.yMin);
        if (!(span < 0.5) || typeof app.api.search !== 'function') throw err;
        const mid = positionAt(eph, 0.5 * (eph.mjdMin + eph.mjdMax));
        const found = await app.api.search(mid.ra, mid.dec, { signal: controller.signal });
        if (stale()) return;
        answer = { frames: (found && Array.isArray(found.frames) ? found.frames : []).map((f) => ({ ...f, ra: undefined, dec: undefined })) };
        fallbackNote = 'The exposure index was not available, so these are the exposures of the middle of the track; the body moves little enough to be on nearly all of them.';
      }
      if (stale()) return;
      const { frames } = attachPositions(answer && Array.isArray(answer.frames) ? answer.frames : [], eph);
      st.refs = frames;
      st.indexNote = fallbackNote || (answer && answer.complete === false ? 'The exposure index is still being built, so more exposures may appear later.' : '');
      st.summary = summarizeTrack(eph, frames);
      st.planText = planSentence(st.name, st.summary);
      st.phase = frames.length ? 'plan' : 'empty';
      render();
    } catch (err) {
      if (stale() || isAbort(err)) return;
      st.error = describeError(err);
      st.phase = 'error';
      render();
    }
  }

  function describeError(err) {
    const code = err && err.code ? String(err.code) : '';
    const message = err && err.message ? String(err.message) : 'Something went wrong.';
    if (code === 'AMBIGUOUS') return { text: message, matches: err.matches || '', retry: false };
    if (code === 'NOT_FOUND' || (err && err.status === 404)) return { text: message || 'Horizons does not know a body by that name.', matches: '', retry: false };
    if (err instanceof RangeError) return { text: message, matches: '', retry: false };
    if (err && err.status === 503) {
      return { text: `${message} Following a real body needs the live data service: JPL Horizons for its positions and the exposure index of the real survey. A hypothetical body still works here.`, matches: '', retry: false };
    }
    return { text: message, matches: '', retry: !(err && err.retryable === false) };
  }

  async function loadExposures() {
    if (st.phase !== 'plan' || !st.refs.length) return;
    const token = st.token;
    const controller = new AbortController();
    st.controller = controller;
    const stale = () => disposed || token !== st.token;
    const refs = thinRefs(st.refs, MAX_EXPOSURES);
    st.phase = 'loading';
    st.progress = { done: 0, total: refs.length, failed: 0, skipped: 0, label: 'Downloading cutouts' };
    render();
    try {
      const result = await loadCutouts(refs, {
        cutout: service.cutout,
        size: cutoutSizeDeg(fov()),
        signal: controller.signal,
        onProgress: (p) => {
          st.progress = { ...p, label: 'Downloading cutouts' };
          renderProgress();
        },
      });
      if (stale()) return;
      st.loadStats = { asked: refs.length, of: st.refs.length, loaded: result.loaded.length, failed: result.failed, skipped: result.skipped };
      st.items = result.loaded.map(({ ref, frame }) => {
        // The frame's own mid-exposure time is the one that counts for the position.
        const p = positionAt(st.eph, frame.mjd);
        return p.inside && isNum(p.ra) ? { frame, ra: p.ra, dec: p.dec } : { frame, ra: ref.ra, dec: ref.dec };
      });
      st.itemOf = new Map(st.items.map((it) => [it.frame, it]));
      if (!st.items.length) {
        st.phase = 'done';
        render();
        return;
      }
      st.phase = 'stacking';
      st.progress = { done: 0, total: st.items.length, failed: 0, skipped: 0, label: 'Aligning on the body' };
      render();
      st.spectrum = bodySpectrum(st.items);
      const dims = panelDims();
      await analyse(dims.n, dims.scale, controller.signal, (p) => {
        st.progress = { done: p.done, total: p.total, failed: p.failed, skipped: 0, label: 'Aligning on the body' };
        renderProgress();
      });
      if (stale()) return;
      st.selected = 0;
      st.phase = 'done';
      render();
      publishSpectrum();
      refreshShellView();
    } catch (err) {
      if (stale() || isAbort(err)) return;
      st.error = describeError(err);
      st.phase = 'error';
      render();
    }
  }

  /** Layers, stacks and profile for one grid size; cached, so the panel and the shell view share. */
  async function analyse(n, scale, signal, onProgress) {
    const key = `${n}:${scale}`;
    const hit = st.analyses.get(key);
    if (hit) return hit;
    const { layers } = await buildComovingLayers(st.items, { fovArcmin: fov(), scale, n, signal, onProgress });
    const stacks = await comovingStacks(layers, { scale, signal });
    const many = stacks.visits.length > 1;
    const entries = [];
    if (stacks.deep) entries.push({ ...stacks.deep, label: `All ${stacks.deep.n} exposures` });
    if (many) for (const v of stacks.visits) entries.push({ ...v, label: `${monthLabel(v.mjdMid)}, all detectors (${v.n})` });
    if (many) for (const d of stacks.dets) entries.push({ ...d, label: `D${d.det}, all visits (${d.n})` });
    for (const g of stacks.groups) entries.push({ ...g, label: `${many ? `${monthLabel(g.mjdMid)}, ` : ''}D${g.det} (${g.n})` });
    let profile = [];
    let ext = null;
    if (stacks.deep) {
      profile = radialProfile(stacks.deep.stack, { n, scale });
      ext = extendedness(profile, { psfFwhm: stacks.psfFwhm });
    }
    const result = { n, scale, stacks, entries, profile, ext, fixed: new Map() };
    st.analyses.set(key, result);
    return result;
  }

  /** Star-fixed comparison for an entry: its largest single visit on one fixed sky grid. */
  function fixedFor(analysis, entry) {
    if (analysis.fixed.has(entry.key)) return analysis.fixed.get(entry.key);
    let layers = entry.layers;
    if (entry.visit < 0) {
      const byVisit = new Map();
      for (const g of analysis.stacks.groups) {
        const sel = g.layers.filter((l) => layers.includes(l));
        byVisit.set(g.visit, (byVisit.get(g.visit) || []).concat(sel));
      }
      layers = [...byVisit.values()].sort((a, b) => b.length - a.length)[0] || layers;
    }
    const items = layers.map((l) => st.itemOf.get(l.frame)).filter(Boolean);
    let out = null;
    try {
      out = starFixedStack(items, { fovArcmin: fov(), scale: analysis.scale, n: analysis.n });
      out.n = items.length;
      out.mjdStart = Math.min(...items.map((it) => it.frame.mjd));
      out.mjdEnd = Math.max(...items.map((it) => it.frame.mjd));
    } catch (err) {
      warn('star-fixed stack failed', err);
    }
    analysis.fixed.set(entry.key, out);
    return out;
  }

  function publishSpectrum() {
    if (!st.spectrum || typeof app.showSpectrum !== 'function') return;
    try {
      app.showSpectrum({ points: st.spectrum.kept, binned: st.spectrum.binned, title: `${st.name}, followed across ${st.items.length} exposures` });
    } catch (err) {
      warn('showSpectrum failed', err);
    }
  }

  // ---- the shell view ------------------------------------------------------------------------

  async function buildView(ctx) {
    if (!st.items.length) return [];
    const grid = ctx && ctx.grid ? ctx.grid : null;
    const dims = grid && grid.n > 0 && grid.scale > 0 ? { n: grid.n, scale: grid.scale } : panelDims();
    const analysis = await analyse(dims.n, dims.scale, null, null);
    const visitCount = analysis.stacks.visits.length;
    const list = [...analysis.stacks.groups];
    if (analysis.stacks.deep && list.length > 1) list.push(analysis.stacks.deep);
    const frames = [];
    for (const entry of list) {
      const [frame] = movieFrames([entry], { name: st.name, visitCount, dateLabel: dateRangeLabel });
      if (!frame) continue;
      frame.caption.wave = pretty(frame.caption.wave);
      frame.grid = comovingGrid(fov(), dims.scale, dims.n); // offsets from the body, not sky
      frames.push(frame);
      if (st.compare) {
        const fixed = fixedFor(analysis, entry);
        if (fixed && fixed.stack && fixed.stack.image) {
          frames.push({
            image: fixed.stack.image,
            mask: fixed.stack.mask,
            range: frame.range,
            caption: { title: frame.caption.title, date: dateRangeLabel(fixed.mjdStart, fixed.mjdEnd), wave: frame.caption.wave.replace(/· \d+ exposures?$/, `· ${fixed.n} ${fixed.n === 1 ? 'exposure' : 'exposures'}`), note: STARFIXED_NOTE },
            short: `${frame.short} fixed`,
            mjd: frame.mjd,
            pass: frame.pass,
            key: `${entry.key}-fixed`,
            grid: fixed.grid,
            comoving: false,
          });
        }
      }
    }
    return frames;
  }

  function refreshShellView() {
    try {
      if (typeof app.rebuildView === 'function') {
        app.rebuildView(VIEW_ID);
        return;
      }
      const store = app.store;
      if (!store || typeof store.get !== 'function' || typeof store.set !== 'function') return;
      if (store.get().view !== VIEW_ID) return;
      // The shell rebuilds a movie when the view changes; two changes in one tick leave it on
      // our view with fresh frames.
      store.set({ view: 'passes' });
      store.set({ view: VIEW_ID, t: 0 });
    } catch (err) {
      warn('could not refresh the view', err);
    }
  }

  function openInViewer() {
    try {
      const store = app.store;
      const target = typeof app.target === 'function' ? app.target() : null;
      if (!target && typeof app.goTo === 'function' && st.summary && st.summary.visits.length) {
        // The shell needs a field to be loaded before it shows any view: use where the body was
        // in the visit with the most exposures.
        const v = st.summary.visits.slice().sort((a, b) => b.n - a.n)[0];
        app.goTo({ ra: v.ra, dec: v.dec, name: `${st.name}, ${v.label}` });
      }
      if (store && typeof store.set === 'function') store.set({ view: VIEW_ID, t: 0 });
    } catch (err) {
      warn('could not open the view', err);
    }
  }

  // ---- panel ---------------------------------------------------------------------------------

  function renderPanel(container) {
    const doc = container.ownerDocument;
    ensureMovingStyles(doc);
    const el = (tag, attrs, ...children) => h(doc, tag, attrs, ...children);
    const uid = `tbm-${Math.random().toString(36).slice(2, 8)}`;

    const input = el('input', { class: 'tbm-input', id: `${uid}-q`, type: 'text', autocomplete: 'off', spellcheck: 'false', placeholder: 'Name, number or designation', maxlength: '40' });
    const form = el('form', { class: 'tbm-search', role: 'search', onsubmit: safe((e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      const q = bodyQuery(text);
      if (q.entry && q.entry.local) {
        showHypo(true);
        return;
      }
      showHypo(false);
      follow({ entry: q.entry, text });
    }) }, input, el('button', { class: 'tbm-btn tbm-btn-primary', type: 'submit' }, 'Follow'));

    const chips = el('div', { class: 'tbm-chips', role: 'group', 'aria-label': 'Bodies to follow' });
    const chipOf = new Map();
    for (const b of CATALOGUE) {
      const chip = el('button', {
        class: `tbm-chip${b.local ? ' tbm-chip-hypo' : ''}`, type: 'button', 'aria-pressed': 'false',
        title: `${kindLabel(b.kind)}. ${pretty(b.blurb)}`,
        onclick: safe(() => {
          input.value = b.local ? '' : b.name;
          if (b.local) {
            cancelWork();
            resetRun();
            st.chosen = b;
            st.name = b.name;
            st.hypothetical = true;
            st.phase = 'idle';
            showHypo(true);
            render();
          } else {
            showHypo(false);
            follow({ entry: b });
          }
        }),
      }, b.name);
      chipOf.set(b.id, chip);
      chips.append(chip);
    }

    // hypothetical body form
    const hpPos = el('input', { class: 'tbm-input', id: `${uid}-pos`, type: 'text', autocomplete: 'off', spellcheck: 'false', placeholder: 'e.g. 52.30 +11.70' });
    const hpDist = el('input', { class: 'tbm-input', id: `${uid}-dist`, type: 'number', min: '2', max: '100000', step: 'any', value: '500', inputmode: 'decimal' });
    const hpDrift = el('input', { type: 'checkbox', id: `${uid}-drift` });
    const hpMsg = el('p', { class: 'tbm-status tbm-status-error', role: 'alert', hidden: true });
    const hypoForm = el('form', { class: 'tbm-card', hidden: true, 'aria-label': 'Hypothetical body', onsubmit: safe((e) => {
      e.preventDefault();
      hpMsg.hidden = true;
      const pos = parseCoord(hpPos.value);
      const distAU = Number(hpDist.value);
      if (!pos) {
        hpMsg.textContent = 'Give a position as RA and Dec, in degrees or as hours and degrees.';
        hpMsg.hidden = false;
        hpPos.focus();
        return;
      }
      if (!(distAU >= 2)) {
        hpMsg.textContent = 'Give a distance of at least 2 AU.';
        hpMsg.hidden = false;
        hpDist.focus();
        return;
      }
      follow({ entry: HYPOTHETICAL, hypo: { ra: pos.ra, dec: pos.dec, distAU, drift: hpDrift.checked ? 'circular' : 'none' } });
    }) },
    el('p', { class: 'tbm-warning' }, 'A search for something not known to exist. The tool follows where such a body would have been and reports what the stack shows there: a signal-to-noise and an upper limit, never a discovery.'),
    el('div', { class: 'tbm-hypo' },
      el('div', { class: 'tbm-wide' }, el('label', { class: 'tbm-label', for: `${uid}-pos` }, 'Position seen from Earth at mid-survey (RA Dec)'), hpPos),
      el('div', null, el('label', { class: 'tbm-label', for: `${uid}-dist` }, 'Distance from the Sun, AU'), hpDist),
      el('div', { style: 'align-self:end' }, el('button', { class: 'tbm-btn tbm-btn-primary', type: 'submit' }, 'Search this track')),
      el('label', { class: 'tbm-check tbm-wide', for: `${uid}-drift` }, hpDrift, el('span', null, 'Add the drift of a circular orbit at that distance, prograde along the ecliptic. Without it the body only shows the yearly parallax loop.')),
    ),
    hpMsg);

    function showHypo(on) {
      hypoForm.hidden = !on;
      if (on && !hpPos.value) {
        try {
          const t = typeof app.target === 'function' ? app.target() : null;
          if (t && isNum(t.ra) && isNum(t.dec)) hpPos.value = `${t.ra.toFixed(5)} ${t.dec >= 0 ? '+' : ''}${t.dec.toFixed(5)}`;
        } catch {
          // no target
        }
      }
    }

    // body card
    const cardName = el('span', { class: 'tbm-name' });
    const cardKind = el('span', { class: 'tbm-kind' });
    const cardBlurb = el('p');
    const cardLook = el('p', { class: 'tbm-look' });
    const card = el('section', { class: 'tbm-card', hidden: true, 'aria-label': 'Chosen body' }, el('div', { class: 'tbm-card-head' }, cardName, cardKind), cardBlurb, cardLook);

    const status = el('p', { class: 'tbm-status', role: 'status', 'aria-live': 'polite' });
    const matches = el('pre', { class: 'tbm-matches', hidden: true, tabindex: '0', 'aria-label': 'Bodies Horizons knows by that name' });
    const retryBtn = el('button', { class: 'tbm-btn tbm-btn-small', type: 'button', hidden: true, onclick: safe(() => {
      if (st.hypothetical) return;
      follow({ entry: st.chosen, text: st.chosen ? '' : st.name });
    }) }, 'Try again');

    // plan
    const planText = el('p', { class: 'tbm-plan-text' });
    const planMeta = el('p', { class: 'tbm-caption' });
    const visitsBody = el('tbody');
    const visitsTable = el('table', { class: 'tbm-visits' },
      el('thead', null, el('tr', null, el('th', { scope: 'col' }, 'Visit'), el('th', { scope: 'col' }, 'Dates'), el('th', { scope: 'col', class: 'tbm-r' }, 'Exp.'), el('th', { scope: 'col' }, 'Per detector 1 to 6'))),
      visitsBody);
    const trackSvg = s(doc, 'svg', { class: 'tbm-track', role: 'img' });
    const trackCap = el('p', { class: 'tbm-figcap' }, 'Path on the sky over the survey. Red dots: SPHEREx visits. East is left.');
    const loadBtn = el('button', { class: 'tbm-btn tbm-btn-primary', type: 'button', onclick: safe(() => loadExposures()) }, 'Load exposures');
    const cancelBtn = el('button', { class: 'tbm-btn', type: 'button', hidden: true, onclick: safe(() => {
      cancelWork();
      st.phase = st.refs.length ? 'plan' : 'idle';
      render();
    }) }, 'Cancel');
    const loadNote = el('span', { class: 'tbm-caption' });
    const bar = el('div', { class: 'tbm-progress-bar' });
    const progress = el('div', { class: 'tbm-progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0', 'aria-label': 'Loading exposures', hidden: true }, bar);
    const progressText = el('p', { class: 'tbm-caption tbm-num', hidden: true });
    const plan = el('section', { class: 'tbm-card', hidden: true, 'aria-label': 'Plan' }, planText, planMeta, visitsTable,
      el('figure', { style: 'margin:0' }, trackSvg, trackCap),
      el('div', { class: 'tbm-actions' }, loadBtn, cancelBtn, loadNote), progress, progressText);

    // result
    const canvas = el('canvas', { class: 'tbm-canvas', role: 'img', 'aria-label': 'Co-moving stack' });
    const overlay = s(doc, 'svg', { class: 'tbm-overlay', 'aria-hidden': 'true' });
    const stage = el('div', { class: 'tbm-stage' }, canvas, overlay);
    const select = el('select', { class: 'tbm-select', 'aria-label': 'Which exposures to stack', onchange: safe(() => {
      st.selected = Number(select.value) || 0;
      renderResult();
    }) });
    const step = (d) => safe(() => {
      const a = st.analyses.get(currentKey());
      if (!a || !a.entries.length) return;
      st.selected = (st.selected + d + a.entries.length) % a.entries.length;
      renderResult();
    });
    const prevBtn = el('button', { class: 'tbm-btn tbm-btn-small', type: 'button', 'aria-label': 'Previous stack', onclick: step(-1) }, '‹');
    const nextBtn = el('button', { class: 'tbm-btn tbm-btn-small', type: 'button', 'aria-label': 'Next stack', onclick: step(1) }, '›');
    const setCompare = (on) => safe(() => {
      if (st.compare === on) return;
      st.compare = on;
      renderResult();
      refreshShellView();
    });
    const followBtn = el('button', { class: 'tbm-btn tbm-btn-small', type: 'button', 'aria-pressed': 'true', title: 'Each exposure centred on the body before stacking', onclick: setCompare(false) }, 'Follow body');
    const fixedBtn = el('button', { class: 'tbm-btn tbm-btn-small', type: 'button', 'aria-pressed': 'false', title: 'The same exposures stacked on a fixed patch of sky, for comparison', onclick: setCompare(true) }, 'Fixed on stars');
    const stackCap = el('p', { class: 'tbm-caption', 'aria-live': 'polite' });
    const viewerBtn = el('button', { class: 'tbm-btn tbm-btn-small', type: 'button', hidden: true, title: 'Play these stacks as a movie in the main viewer', onclick: safe(() => openInViewer()) }, 'Open in the viewer');
    const verdictList = el('ul', { class: 'tbm-verdict' });
    const specSvg = s(doc, 'svg', { class: 'tbm-spectrum', role: 'img' });
    const specCap = el('p', { class: 'tbm-figcap' });
    const bandList = el('ul', { class: 'tbm-verdict' });
    const result = el('section', { class: 'tbm-card', hidden: true, 'aria-label': 'Result' },
      verdictList,
      el('div', { class: 'tbm-stack' },
        stage,
        el('div', { style: 'display:flex;flex-direction:column;gap:8px;min-width:0' },
          el('div', { class: 'tbm-nav' }, prevBtn, select, nextBtn),
          el('div', { class: 'tbm-nav' }, el('span', { class: 'tbm-seg', role: 'group', 'aria-label': 'Frame of the stack' }, followBtn, fixedBtn), viewerBtn),
          stackCap)),
      el('figure', { style: 'margin:0' }, specSvg, specCap),
      bandList);

    const foot = el('p', { class: 'tbm-foot' });
    const root = el('div', { class: 'tbm' },
      el('p', { class: 'tbm-lede' }, 'A planet, asteroid or comet is somewhere else in every exposure. Pick one and the tool follows it: every exposure that happened to contain it, centred on the body and stacked, so the body stays sharp while the stars streak past.'),
      el('div', null, el('label', { class: 'tbm-label', for: `${uid}-q` }, 'Follow a body'), form),
      chips, hypoForm, card, el('div', null, status, matches, retryBtn), plan, result, foot);
    container.append(root);

    ui = {
      doc, root, input, chipOf, hypoForm, card, cardName, cardKind, cardBlurb, cardLook, status, matches, retryBtn,
      plan, planText, planMeta, visitsBody, visitsTable, trackSvg, trackCap, loadBtn, cancelBtn, loadNote, progress, bar, progressText,
      result, canvas, overlay, select, followBtn, fixedBtn, stackCap, viewerBtn, verdictList, specSvg, specCap, bandList, foot,
    };
    render();
    return {
      update: () => render(),
      dispose: () => {
        ui = null;
        root.remove();
      },
    };
  }

  const currentKey = () => {
    const d = panelDims();
    return st.analyses.has(`${d.n}:${d.scale}`) ? `${d.n}:${d.scale}` : st.analyses.keys().next().value;
  };

  function render() {
    if (!ui || disposed) return;
    const { doc } = ui;
    const el = (tag, attrs, ...children) => h(doc, tag, attrs, ...children);
    const busy = st.phase === 'ephemeris' || st.phase === 'track';

    for (const [id, chip] of ui.chipOf) chip.setAttribute('aria-pressed', st.chosen && st.chosen.id === id ? 'true' : 'false');

    // body card
    const showCard = st.phase !== 'idle' || (st.chosen && !st.chosen.local);
    ui.card.hidden = !showCard || !st.name;
    if (!ui.card.hidden) {
      ui.cardName.textContent = st.name;
      const kind = st.chosen ? kindLabel(st.chosen.kind) : 'From JPL Horizons';
      ui.cardKind.textContent = kind;
      ui.cardKind.className = `tbm-kind${st.hypothetical ? ' tbm-kind-hypo' : ''}`;
      ui.cardBlurb.textContent = st.chosen ? pretty(st.chosen.blurb) : 'Not in the built-in list: looked up by name in the Horizons small-body index.';
      clear(ui.cardLook);
      if (st.chosen) ui.cardLook.append(el('b', null, 'With SPHEREx: '), pretty(st.chosen.lookFor));
      ui.cardLook.hidden = !st.chosen;
    }

    // status line
    ui.matches.hidden = true;
    ui.retryBtn.hidden = true;
    ui.status.className = 'tbm-status';
    let statusText = '';
    if (st.phase === 'ephemeris') statusText = st.hypothetical ? 'Computing the track from the parallax model…' : `Asking JPL Horizons where ${st.name} was…`;
    else if (st.phase === 'track') statusText = 'Asking the exposure index which exposures contained it…';
    else if (st.phase === 'error' && st.error) {
      statusText = st.error.text;
      ui.status.className = 'tbm-status tbm-status-error';
      if (st.error.matches) {
        ui.matches.textContent = st.error.matches;
        ui.matches.hidden = false;
      }
      ui.retryBtn.hidden = !st.error.retry || st.hypothetical;
    } else if (st.phase === 'empty') statusText = st.planText;
    ui.status.textContent = statusText;
    // Empty: keep the live region in the page for screen readers, but out of the layout.
    ui.status.parentElement.className = statusText ? '' : 'tbm-sr';
    ui.root.setAttribute('aria-busy', busy || st.phase === 'loading' || st.phase === 'stacking' ? 'true' : 'false');

    // plan
    const hasPlan = ['plan', 'loading', 'stacking', 'done'].includes(st.phase) && st.summary && st.summary.total > 0;
    ui.plan.hidden = !hasPlan && st.phase !== 'empty';
    if (!ui.plan.hidden) {
      const sum = st.summary;
      ui.planText.textContent = st.phase === 'empty' ? '' : st.planText;
      ui.planText.hidden = st.phase === 'empty';
      const bits = [];
      if (sum && isNum(sum.medianDelta)) bits.push(`${sum.medianDelta >= 100 ? sum.medianDelta.toFixed(0) : sum.medianDelta.toFixed(1)} AU from Earth`);
      if (sum && isNum(sum.medianMag)) bits.push(`magnitude ${sum.medianMag.toFixed(1)}`);
      const src = st.response && st.response.source ? st.response.source : '';
      if (src) bits.push(`positions: ${src}, ${st.response.center || 'geocentric'}`);
      if (st.indexNote) bits.push(st.indexNote);
      ui.planMeta.textContent = bits.join(' · ');
      ui.planMeta.hidden = !bits.length;
      clear(ui.visitsBody);
      ui.visitsTable.hidden = !(sum && sum.visits.length);
      for (const v of sum ? sum.visits : []) {
        ui.visitsBody.append(el('tr', null,
          el('td', null, v.label),
          el('td', { class: 'tbm-num' }, dateRangeLabel(v.mjdStart, v.mjdEnd)),
          el('td', { class: 'tbm-num tbm-r' }, String(v.n)),
          el('td', { class: 'tbm-dets' }, [1, 2, 3, 4, 5, 6].map((d) => String(v.perDet[d]).padStart(2, ' ')).join(' '))));
      }
      const label = drawTrack(doc, ui.trackSvg, st.eph, sum);
      ui.trackSvg.setAttribute('aria-label', label || 'Path of the body on the sky');
      const n = st.refs.length;
      const take = Math.min(n, MAX_EXPOSURES);
      ui.loadBtn.textContent = `Load ${take} ${take === 1 ? 'exposure' : 'exposures'}`;
      ui.loadBtn.hidden = st.phase !== 'plan';
      ui.cancelBtn.hidden = !(st.phase === 'loading' || st.phase === 'stacking');
      let note = '';
      if (st.phase === 'plan') {
        // A cutout is five float32 arrays of (size / 6.15 arcsec)^2 pixels.
        const side = (cutoutSizeDeg(fov()) * 3600) / 6.15;
        const mb = Math.max(1, Math.round((take * side * side * 20) / 1e6));
        note = n > MAX_EXPOSURES ? `of ${n}, thinned evenly in time per detector. About ${mb} MB.` : `Nothing has been downloaded yet. About ${mb} MB.`;
      } else if (st.loadStats) {
        const ls = st.loadStats;
        const parts = [`${ls.loaded} of ${ls.asked} exposures loaded`];
        if (ls.skipped) parts.push(`${ls.skipped} not in the archive`);
        if (ls.failed) parts.push(`${ls.failed} failed`);
        if (ls.of > ls.asked) parts.push(`${ls.of - ls.asked} left out by thinning`);
        note = `${parts.join(', ')}.`;
      }
      ui.loadNote.textContent = note;
    }
    renderProgress();

    // result
    ui.result.hidden = st.phase !== 'done';
    if (st.phase === 'done') renderResult();

    // footer
    ui.foot.textContent = st.hypothetical
      ? 'Track from the parallax model in core/distance.js, seen from the centre of the Earth. SPHEREx Level 2 spectral images (IRSA).'
      : 'Positions from JPL Horizons, seen from the centre of the Earth; SPHEREx is in low Earth orbit, which matters by less than a pixel beyond about 2 AU. SPHEREx Level 2 spectral images (IRSA).';
  }

  function renderProgress() {
    if (!ui) return;
    const on = st.phase === 'loading' || st.phase === 'stacking';
    ui.progress.hidden = !on;
    ui.progressText.hidden = !on;
    if (!on) return;
    const p = st.progress;
    const pct = p.total > 0 ? Math.round((100 * p.done) / p.total) : 0;
    ui.bar.style.width = `${pct}%`;
    ui.progress.setAttribute('aria-valuenow', String(pct));
    ui.progress.setAttribute('aria-label', p.label || 'Working');
    const extra = [];
    if (p.skipped) extra.push(`${p.skipped} not in the archive`);
    if (p.failed) extra.push(`${p.failed} failed`);
    ui.progressText.textContent = `${p.label}: ${p.done} of ${p.total}${extra.length ? ` (${extra.join(', ')})` : ''}`;
  }

  function renderResult() {
    if (!ui || st.phase !== 'done') return;
    const { doc } = ui;
    const el = (tag, attrs, ...children) => h(doc, tag, attrs, ...children);
    const analysis = st.analyses.get(currentKey()) || null;
    const deep = analysis ? analysis.stacks.deep : null;
    const wantsComa = !!(st.chosen && st.chosen.coma);

    clear(ui.verdictList);
    const lines = verdict({
      name: st.name,
      planned: st.summary ? st.summary.total : 0,
      loaded: st.items.length,
      deep,
      spectrum: st.spectrum,
      ext: wantsComa && analysis ? analysis.ext : null,
      hypothetical: st.hypothetical,
    });
    for (const line of lines) ui.verdictList.append(el('li', { class: `tbm-v-${line.kind}` }, pretty(line.text)));

    const has = !!(analysis && analysis.entries.length);
    ui.canvas.parentElement.hidden = !has;
    ui.select.parentElement.parentElement.hidden = !has;
    if (has) {
      if (st.selected >= analysis.entries.length) st.selected = 0;
      if (ui.select.options.length !== analysis.entries.length || ui.select.dataset.key !== currentKey() + st.token) {
        clear(ui.select);
        analysis.entries.forEach((e, i) => ui.select.append(el('option', { value: String(i) }, e.label)));
        ui.select.dataset.key = currentKey() + st.token;
      }
      ui.select.value = String(st.selected);
      const entry = analysis.entries[st.selected];
      const range = stackRange(entry.stack);
      ui.followBtn.setAttribute('aria-pressed', st.compare ? 'false' : 'true');
      ui.fixedBtn.setAttribute('aria-pressed', st.compare ? 'true' : 'false');
      const band = entry.det >= 1 ? `D${entry.det} ${entry.band[0].toFixed(2)}–${entry.band[1].toFixed(2)} µm` : 'all detectors';
      clear(ui.stackCap);
      if (st.compare) {
        const fixed = fixedFor(analysis, entry);
        if (fixed && fixed.stack && fixed.stack.image) {
          drawStack(ui.canvas, fixed.stack.image, fixed.stack.mask, analysis.n, range);
          drawOverlay(doc, ui.overlay, { n: analysis.n, scale: analysis.scale, track: fixed.track, centred: false });
          const moved = fixed.trailArcsec;
          ui.stackCap.append(el('b', null, st.name), ` · ${dateRangeLabel(fixed.mjdStart, fixed.mjdEnd)} · ${band} · ${fixed.n} ${fixed.n === 1 ? 'exposure' : 'exposures'}. `,
            `${STARFIXED_NOTE}: it crossed ${moved >= 100 ? moved.toFixed(0) : moved.toFixed(1)}″ (${(moved / 6.15).toFixed(1)} pixels) along the dashed line${entry.visit < 0 && analysis.stacks.visits.length > 1 ? ', in the visit with the most exposures' : ''}.`);
          ui.canvas.setAttribute('aria-label', `Star-fixed stack of ${fixed.n} exposures: stars sharp, ${st.name} smeared along its track`);
        }
      } else {
        drawStack(ui.canvas, entry.stack.image, entry.stack.mask, analysis.n, range);
        drawOverlay(doc, ui.overlay, { n: analysis.n, scale: analysis.scale });
        const sn = entry.snr && entry.snr.ok && isNum(entry.snr.snr) ? ` · S/N ${Math.abs(entry.snr.snr) >= 100 ? entry.snr.snr.toFixed(0) : entry.snr.snr.toFixed(1)} at the centre` : '';
        ui.stackCap.append(el('b', null, st.name), ` · ${dateRangeLabel(entry.mjdStart, entry.mjdEnd)} · ${band} · ${entry.n} ${entry.n === 1 ? 'exposure' : 'exposures'}${sn}. `, `${COMOVING_NOTE}.`);
        ui.canvas.setAttribute('aria-label', `Co-moving stack of ${entry.n} exposures centred on ${st.name}`);
      }
    }
    ui.viewerBtn.hidden = !(has && viewHandle && app.store && typeof app.store.set === 'function');

    // spectrum
    const spec = st.spectrum || { kept: [], binned: [] };
    const bands = st.chosen && Array.isArray(st.chosen.bands) ? st.chosen.bands : [];
    const label = drawSpectrum(doc, ui.specSvg, { kept: spec.kept, binned: spec.binned, bands });
    ui.specSvg.setAttribute('aria-label', label);
    ui.specCap.textContent = spec.binned.length
      ? `Spectrum of ${st.name} from aperture photometry at its position in each of ${spec.kept.length} exposures. Grey: single exposures. White: channel means.${bands.length ? ' Dashed: features to look for.' : ''}`
      : '';
    clear(ui.bandList);
    const seen = new Set();
    for (const b of bands) {
      if (seen.has(b.wave)) continue;
      seen.add(b.wave);
      const d = bandDepth(spec.binned, b.wave, Math.max(0.1, 0.035 * b.wave));
      if (!d || !isNum(d.depth) || !isNum(d.err)) continue;
      const sig = d.err > 0 ? Math.abs(d.depth) / d.err : 0;
      const pm = `± ${Math.max(1, Math.round(100 * d.err))}%`;
      let text;
      if (!(d.continuum_uJy > 0) || d.err > 0.3) {
        // The spectrum around the feature is itself barely measured: a depth would be noise.
        text = `${pretty(b.what)}: the spectrum is too faint here to say.`;
      } else if (sig >= 3 && d.depth > 0) text = `${pretty(b.what)}: ${(100 * d.depth).toFixed(0)}% ${pm} below its surroundings.`;
      else if (sig >= 3) text = `${pretty(b.what)}: ${(1 - d.depth).toFixed(1)} times its surroundings, in emission.`;
      else text = `${pretty(b.what)}: no measurable feature (${(100 * d.depth).toFixed(0)}% ${pm}).`;
      ui.bandList.append(el('li', { class: sig >= 3 ? 'tbm-v-ok' : '' }, text));
    }
  }

  // ---- registration --------------------------------------------------------------------------

  let panel = null;
  let tool = null;
  let viewHandle = null;
  try {
    panel = app.addPanel({ id: 'moving', title: 'Solar system', order: 70, render: renderPanel });
  } catch (err) {
    warn('panel could not be added', err);
  }
  try {
    if (typeof app.addTool === 'function') {
      tool = app.addTool({
        id: 'moving', label: 'Solar system', title: 'Follow a moving solar-system body', icon: TOOL_ICON, group: 'view',
        onClick: safe(() => {
          if (panel && typeof panel.show === 'function') panel.show();
        }),
      });
    }
  } catch (err) {
    warn('tool could not be added', err);
  }
  try {
    if (typeof app.addView === 'function') {
      viewHandle = app.addView({
        id: VIEW_ID,
        label: 'Follow body',
        title: 'Stacks that follow a solar-system body: it stays at the centre while the stars streak',
        build: buildView,
      });
    }
  } catch (err) {
    warn('view could not be added', err);
  }

  return {
    /** For tests and the demo: the current state, read-only by convention. */
    state: () => st,
    follow: (spec) => follow(spec || {}),
    load: () => loadExposures(),
    dispose() {
      disposed = true;
      cancelWork();
      for (const handle of [viewHandle, tool, panel]) {
        try {
          if (handle && typeof handle.remove === 'function') handle.remove();
        } catch (err) {
          warn('clean-up failed', err);
        }
      }
      ui = null;
    },
  };
}
