// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// "Injection test" plugin: plant a simulated body in the real frames and see whether Tombaugh
// finds it. This is how a survey states what it could have seen. A non-detection then becomes
// a number: "a body brighter than X at this distance would have been recovered here".
//
//   panel   preset / distance / brightness controls, "Plant it" and "Find the limit"
//   view    while a body is planted: 'inject' ("Injected"), the residual movie of the doctored
//           layers, every frame captioned SIMULATED SOURCE, with a ring at the true position
//   tool    a toolbar button (group 'extra') that opens the panel; lit while a body is planted
//
// The science lives in blackbody.js (how bright), inject.js (where, and adding the light) and
// recover.js (running the tool's own pipeline on the doctored layers). This file is the DOM
// part plus two pure helpers, buildInjectedMovie and curveSvg, that the demo and tests can call.
//
// Nothing here modifies the loaded layers: the planted body exists only in copies, and
// "Remove" (or choosing a new target) drops them.

import { fitSkyModel, residualPassStacks, residualLayer, findCandidates } from '../../core/skymodel.js';
import { shiftAndStack, hopArcsec, keplerRate } from '../../core/distance.js';
import { gridPixToSky } from '../../core/wcs.js';
import { DETECTORS } from '../../core/frames.js';
import { robustStats } from '../../core/stretch.js';
import { mjdToIso } from '../../core/time.js';
import { PRESETS, presetById, bodyFlux_uJy, fluxParts_uJy, scaledSpectrum, REF_WAVE_UM } from './blackbody.js';
import { planTrack, trackOnGrid, injectIntoLayers, referenceWave, NATIVE_PIX_ARCSEC } from './inject.js';
import {
  recover, detectionCurve, limitDetail, limitSentences, formatFlux, passIndices, passPositions,
} from './recover.js';
import { ensureInjectStyles } from './inject.css.js';

export const meta = {
  id: 'inject',
  title: 'Injection test',
  description: 'Plants a simulated body in the loaded frames and measures how faint a body Tombaugh would still recover in this patch.',
};

export const VIEW_ID = 'inject';
// Every frame of the Injected view carries these words, first in the caption note and first in
// the title, so that they survive truncation and no screenshot can pass for a discovery.
export const WATERMARK = 'SIMULATED SOURCE planted as a test. Not a detection.';
export const WATERMARK_OFF_FIELD = 'SIMULATED SOURCE, off the field in this pass. Not real.';
const LIB = { fitSkyModel, residualPassStacks, residualLayer, findCandidates, shiftAndStack };
const THRESHOLD = 5;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const TEXT = Object.freeze({
  lede: 'Plant a simulated body in these frames and see whether Tombaugh finds it. Repeating that at many brightnesses gives the faintest body it would catch in this patch.',
  honest: 'This tests the tool. It does not detect anything. The planted body exists only in a copy of the frames and every image of it is labelled as simulated.',
  noData: 'Load a target first. The test needs the exposures of one detector.',
  fewLayers: 'The test needs at least four exposures of this spot; fewer are loaded.',
  staticNote: 'At this distance the body shifts by less than a pixel between passes, so the sky model takes it for a fixed star and removes most of it. It has to be far brighter to be noticed by that small shift. In the ordinary images it would simply look like a faint star.',
  faintNote: 'To see what a recoverable body looks like, choose "Set brightness" and raise it.',
});

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// ---- pure helpers ------------------------------------------------------------------------------

/** Map a slider position 0..1000 to a value on a log scale and back. */
export function logScale(min, max) {
  const a = Math.log(min), b = Math.log(max);
  return {
    toValue: (pos) => Math.exp(a + (b - a) * Math.min(1000, Math.max(0, pos)) / 1000),
    toPos: (value) => Math.round(1000 * (Math.log(Math.min(max, Math.max(min, value))) - a) / (b - a)),
  };
}

function fmtInt(v) {
  return Math.round(v).toLocaleString('en-US');
}

/** A distance for people: "500 AU", "474,000 AU (2.3 pc)". */
export function formatDistance(au) {
  if (!isNum(au)) return '?';
  const rounded = Number(au.toPrecision(3));
  const text = `${fmtInt(rounded)} AU`;
  return rounded >= 20000 ? `${text} (${(rounded / 206264.806).toPrecision(2)} pc)` : text;
}

/** An angle for people: "13.8 arcmin", "41 arcsec", "0.9 arcsec". */
export function formatAngle(arcsec) {
  if (!isNum(arcsec)) return '?';
  if (arcsec >= 5400) return `${(arcsec / 3600).toFixed(1)} degrees`;
  if (arcsec >= 90) return `${(arcsec / 60).toFixed(1)} arcmin`;
  if (arcsec >= 10) return `${Math.round(arcsec)} arcsec`;
  if (arcsec < 0.05) return 'less than 0.1 arcsec';
  return `${arcsec.toFixed(1)} arcsec`;
}

function passLabel(mjd) {
  if (!isNum(mjd)) return '';
  const d = new Date((mjd - 40587) * 86400000);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function detLabel(det) {
  const d = DETECTORS.find((x) => x.det === det);
  return d ? `detector ${det} (${d.min.toFixed(2)} to ${d.max.toFixed(2)} µm)` : 'this detector';
}

function waveText(w) {
  return isNum(w) ? `${Number(w.toFixed(2))} µm` : 'this wavelength';
}

/**
 * Where to plant: the clicked source if there is one inside the grid, otherwise the quietest of
 * eight spots on a ring a quarter of the field from the centre (the target itself usually sits
 * in the middle, and a body planted on a bright star says little).
 * @returns {{ x: number, y: number, picked: boolean }}
 */
export function chooseSpot(layers, grid, selection) {
  const n = grid.n;
  const margin = Math.min(8, Math.floor(n / 4));
  if (selection && isNum(selection.x) && isNum(selection.y)
    && selection.x >= margin && selection.x <= n - 1 - margin && selection.y >= margin && selection.y <= n - 1 - margin) {
    return { x: selection.x, y: selection.y, picked: true };
  }
  const c = (n - 1) / 2;
  const r = Math.max(4, 0.24 * n);
  const layer = layers[0];
  let best = null;
  for (let k = 0; k < 8; k++) {
    const a = (Math.PI / 4) * k + 0.4;
    const x = c + r * Math.cos(a), y = c + r * Math.sin(a);
    let sum = 0, cnt = 0;
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const xx = Math.round(x) + dx, yy = Math.round(y) + dy;
        if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
        const i = yy * n + xx;
        const v = layer && layer.image ? layer.image[i] : 0;
        if (!Number.isFinite(v) || (layer.mask && layer.mask[i])) { sum += 1e3; cnt++; continue; }
        sum += Math.abs(v); cnt++;
      }
    }
    const score = cnt ? sum / cnt : Infinity;
    if (!best || score < best.score) best = { x, y, score };
  }
  return { x: best.x, y: best.y, picked: false };
}

/**
 * Plant one body and build the "Injected" movie: one residual stack per survey pass of the
 * doctored layers, plus the verdict of recover() at the true position. No DOM.
 *
 * @param {Array<object>} layers real layers of one detector (not modified)
 * @param {object} grid
 * @param {{ distAU: number, fluxAt: (wave_um: number) => number, flux_uJy: number, refWave: number,
 *           spot: { x: number, y: number }, motion?: object|string }} params
 * @param {object} [lib] core functions; defaults to the real ones
 * @returns {Promise<{ frames: Array<object>, result: object|null, baseline: object|null, nOnGrid: number, nLayers: number,
 *   nPasses: number, track: Array<object>, hopArcsec: number, message: string }>}
 *   frames are MovieFrames of CONTRACT-PLUGINS.md with `simulated: true` and `simMarkers`.
 */
export async function buildInjectedMovie(layers, grid, params, lib = LIB, opts = {}) {
  const L = (layers || []).filter((l) => l && l.image);
  const empty = { frames: [], result: null, nOnGrid: 0, nLayers: L.length, nPasses: 0, track: [], hopArcsec: NaN, message: '' };
  if (!grid || !L.length) return { ...empty, message: TEXT.noData };
  if (L.length < 4) return { ...empty, message: TEXT.fewLayers };
  const mjds = L.map((l) => l.mjd);
  const first = mjds.reduce((a, b) => Math.min(a, b), Infinity);
  const [ra, dec] = gridPixToSky(grid, params.spot.x, params.spot.y);
  const track = planTrack({
    ra, dec, distAU: params.distAU, mjds, refMjd: first, motion: params.motion === undefined ? 'circular' : params.motion,
  });
  const positions = trackOnGrid(track, grid, L);
  const nativePix = L[0].frame ? NATIVE_PIX_ARCSEC : 0;
  const doctored = injectIntoLayers(L, grid, { track: positions, fluxAt: params.fluxAt, nativePixArcsec: nativePix });
  const model = lib.fitSkyModel(doctored);
  const result = await recover(doctored, grid, { positions }, lib, { model, threshold: THRESHOLD, signal: opts.signal });
  // The same question asked of the untouched frames: if something is already there, a
  // "recovery" at this spot would not be the planted body's doing.
  let baseline = null;
  try { baseline = await recover(L, grid, { positions }, lib, { threshold: THRESHOLD, signal: opts.signal }); } catch (err) {
    if (err && err.name === 'AbortError') throw err;
  }
  const passes = passIndices(doctored);
  const perPass = passPositions(positions, passes);
  let stacks = [];
  try { stacks = lib.residualPassStacks(model, doctored) || []; } catch { stacks = []; }
  const sig = [];
  for (const s of stacks) {
    const r = robustStats(s.image, s.mask);
    if (r && r.sigma > 0) sig.push(r.sigma);
  }
  sig.sort((a, b) => a - b);
  const sigma = sig.length ? sig[sig.length >> 1] : 1;
  const range = [-6 * sigma, 6 * sigma];
  const det = L[0].det;
  const frames = stacks.map((s, i) => {
    const members = L.filter((_, k) => passes.index[k] === i);
    const lo = members.reduce((a, l) => Math.min(a, l.mjd), Infinity);
    const hi = members.reduce((a, l) => Math.max(a, l.mjd), -Infinity);
    const here = perPass.find((p) => p.passIndex === i);
    let simMarkers = [];
    if (here) {
      const sky = gridPixToSky(grid, here.x, here.y);
      simMarkers = [{ ra: sky[0], dec: sky[1], kind: 'simulated', label: 'SIMULATED' }];
    }
    const d0 = mjdToIso(lo).slice(0, 10), d1 = mjdToIso(hi).slice(0, 10);
    const label = s.label || passLabel(s.mjd);
    return {
      image: s.image, mask: s.mask, range, diverging: true, mjd: s.mjd, pass: i, passLabel: label,
      short: `Simulated · pass ${i + 1} · ${label}`,
      simulated: true, simMarkers,
      caption: {
        title: `SIMULATED · residual · pass ${i + 1} of ${stacks.length} · ${label}`,
        date: d0 === d1 ? d0 : `${d0} to ${d1}`,
        wave: detLabel(det).replace(/^detector (\d) \((.*)\)$/, 'D$1 · $2'),
        note: here ? WATERMARK : WATERMARK_OFF_FIELD,
      },
    };
  });
  return {
    frames, result, baseline, nOnGrid: result ? result.nOnGrid : 0, nLayers: L.length, nPasses: passes.count,
    track, hopArcsec: hopArcsec(params.distAU), message: '', det, spot: params.spot,
  };
}

/**
 * What happened to the planted body, in plain sentences.
 * @returns {string[]}
 */
export function plantedSentences(out, params) {
  if (!out || out.message) return [out && out.message ? out.message : TEXT.noData];
  const lines = [];
  const hop = out.hopArcsec;
  const hopText = isNum(hop) && hop > 0 ? ` It hops ${formatAngle(hop)} between passes six months apart.` : '';
  lines.push(`Planted a simulated body of ${formatFlux(params.flux_uJy)} µJy at ${waveText(params.refWave)}, ${formatDistance(params.distAU)} away. It is in view in ${out.nOnGrid} of ${out.nLayers} exposures.${hopText}`);
  const r = out.result;
  if (!r || !isNum(r.snr)) {
    lines.push('The detection pipeline could not be run on these frames.');
    return lines;
  }
  const how = r.method === 'stack' ? 'in the stack along its true track' : 'in a pass residual';
  const other = r.method === 'stack' && r.residual ? ` (best pass residual: ${r.residual.snr.toFixed(1)} sigma)`
    : r.method === 'residual' && r.stack ? ` (stack along the track: ${r.stack.snr.toFixed(1)} sigma)` : '';
  const b = out.baseline;
  if (b && (b.detected || b.snr >= 3)) {
    // Something is already there. Say so before anything that sounds like success.
    lines.push(`Careful: this spot already shows ${isNum(b.snr) ? `${b.snr.toFixed(1)} sigma` : 'a flagged change'} without the planted body, so what happens here says little about the body. Plant it somewhere emptier.`);
    return lines;
  }
  if (r.method === 'candidate') {
    lines.push(`Recovered: the blind candidate list flags it, although the reading at the exact position is only ${r.snr.toFixed(1)} sigma.`);
  } else if (r.detected) {
    lines.push(`Recovered at ${r.snr.toFixed(1)} sigma ${how}${other}.`);
    if (r.blind === true) lines.push('The blind candidate list flags it too, without being told where to look.');
    else if (r.blind === false) lines.push('The blind candidate list does not flag it: it is found only because we know where to look.');
  } else {
    lines.push(`Not recovered: ${r.snr.toFixed(1)} sigma at the planted position, ${THRESHOLD} needed.`);
  }
  if (isNum(hop) && isNum(out.gridScale) && hop < 2 * out.gridScale) lines.push(TEXT.staticNote);
  else if (!r.detected) lines.push(TEXT.faintNote);
  return lines;
}

function esc(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * The completeness curve as an SVG string (no DOM, no libraries).
 * @param {{ points: Array<object>, limit?: object, blindLimit?: object, refWave?: number,
 *           compare?: { label: string, flux_uJy: number } }} data  points from detectionCurve
 * @param {{ width?: number, height?: number }} [size]
 */
export function curveSvg(data, { width = 340, height = 214 } = {}) {
  const INK = '#171715', PAPER = '#F7F2E7', SIGNAL = '#E53C27', STONE = '#77766E';
  const NUM = 'Consolas, &quot;Cascadia Mono&quot;, Menlo, &quot;DejaVu Sans Mono&quot;, monospace';
  const pts = ((data && data.points) || []).filter((p) => p && p.flux_uJy > 0 && isNum(p.completeness));
  const m = { l: 38, r: 12, t: 12, b: 40 };
  const w = width - m.l - m.r, h = height - m.t - m.b;
  const refWave = data && isNum(data.refWave) ? data.refWave : REF_WAVE_UM;
  const head = `<svg class="tbj-chart" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Fraction of planted bodies recovered against brightness">`;
  if (!pts.length) {
    return `${head}<rect x="${m.l}" y="${m.t}" width="${w}" height="${h}" fill="none" stroke="${STONE}" stroke-opacity="0.5"/>`
      + `<text x="${m.l + w / 2}" y="${m.t + h / 2}" fill="${PAPER}" fill-opacity="0.68" font-family="-apple-system, BlinkMacSystemFont, Segoe UI Variable Text, Segoe UI, Inter, Roboto, Helvetica Neue, Arial, sans-serif" font-size="12" text-anchor="middle">No result yet</text></svg>`;
  }
  let lo = Math.log10(pts[0].flux_uJy), hi = lo;
  for (const p of pts) { lo = Math.min(lo, Math.log10(p.flux_uJy)); hi = Math.max(hi, Math.log10(p.flux_uJy)); }
  const cmp = data.compare && data.compare.flux_uJy > 0 ? Math.log10(data.compare.flux_uJy) : NaN;
  const cmpInside = isNum(cmp) && cmp > lo - 1.2 && cmp < hi + 1.2;
  if (cmpInside) { lo = Math.min(lo, cmp); hi = Math.max(hi, cmp); }
  const pad = Math.max(0.12, 0.06 * (hi - lo));
  lo -= pad; hi += pad;
  const X = (f) => m.l + ((Math.log10(f) - lo) / (hi - lo)) * w;
  const Y = (c) => m.t + (1 - c) * h;
  const f1 = (v) => v.toFixed(1);
  const out = [head];
  // horizontal guides and y labels
  for (const [c, label] of [[0, '0'], [0.5, '50'], [1, '100%']]) {
    out.push(`<line x1="${m.l}" x2="${m.l + w}" y1="${f1(Y(c))}" y2="${f1(Y(c))}" stroke="${STONE}" stroke-opacity="${c === 0.5 ? 0.9 : 0.45}" stroke-width="1"${c === 0.5 ? ' stroke-dasharray="3 3"' : ''}/>`);
    out.push(`<text x="${m.l - 6}" y="${f1(Y(c) + 3.5)}" fill="${PAPER}" fill-opacity="0.68" font-family="${NUM}" font-size="10" text-anchor="end">${label}</text>`);
  }
  // decade ticks
  for (let d = Math.ceil(lo); d <= Math.floor(hi); d++) {
    const x = X(Math.pow(10, d));
    const label = d >= 0 ? Math.pow(10, d).toLocaleString('en-US') : Math.pow(10, d).toFixed(-d);
    out.push(`<line x1="${f1(x)}" x2="${f1(x)}" y1="${m.t + h}" y2="${m.t + h + 4}" stroke="${STONE}" stroke-width="1"/>`);
    out.push(`<text x="${f1(x)}" y="${m.t + h + 15}" fill="${PAPER}" fill-opacity="0.68" font-family="${NUM}" font-size="10" text-anchor="middle">${label}</text>`);
  }
  out.push(`<text x="${m.l + w / 2}" y="${height - 6}" fill="${PAPER}" fill-opacity="0.68" font-family="-apple-system, BlinkMacSystemFont, Segoe UI Variable Text, Segoe UI, Inter, Roboto, Helvetica Neue, Arial, sans-serif" font-size="11" text-anchor="middle">brightness at ${esc(Number(refWave.toFixed(2)))} µm, µJy</text>`);
  // blind candidate-list curve
  const blind = pts.filter((p) => isNum(p.blindCompleteness));
  if (blind.length > 1) {
    out.push(`<polyline fill="none" stroke="${STONE}" stroke-width="1.5" stroke-dasharray="4 3" points="${blind.map((p) => `${f1(X(p.flux_uJy))},${f1(Y(p.blindCompleteness))}`).join(' ')}"/>`);
  }
  // recovered at the planted position
  for (const p of pts) {
    if (isNum(p.lo) && isNum(p.hi)) {
      out.push(`<line x1="${f1(X(p.flux_uJy))}" x2="${f1(X(p.flux_uJy))}" y1="${f1(Y(p.lo))}" y2="${f1(Y(p.hi))}" stroke="${PAPER}" stroke-opacity="0.4" stroke-width="1"/>`);
    }
  }
  out.push(`<polyline fill="none" stroke="${PAPER}" stroke-width="1.5" stroke-linejoin="round" points="${pts.map((p) => `${f1(X(p.flux_uJy))},${f1(Y(p.completeness))}`).join(' ')}"/>`);
  for (const p of pts) {
    out.push(`<circle cx="${f1(X(p.flux_uJy))}" cy="${f1(Y(p.completeness))}" r="2.6" fill="${PAPER}"><title>${esc(formatFlux(p.flux_uJy))} µJy: ${p.detected} of ${p.n} recovered</title></circle>`);
  }
  // the comparison body
  if (cmpInside) {
    // The curve runs along the bottom at the faint end and along the top at the bright end, so
    // the label goes where the curve is not.
    // The curve rises to the right, so the free corners are the top left and the bottom right:
    // a label at the top reads leftward from its line, one at the bottom rightward, unless the
    // plot edge leaves no room for it.
    const x = X(data.compare.flux_uJy);
    let nearest = pts[0];
    for (const p of pts) if (Math.abs(Math.log10(p.flux_uJy) - cmp) < Math.abs(Math.log10(nearest.flux_uJy) - cmp)) nearest = p;
    const top = !(nearest.completeness > 0.5);
    const text = `${data.compare.label}, ${formatFlux(data.compare.flux_uJy)} µJy`;
    const room = text.length * 5.4 + 8;
    let anchor = top ? 'end' : 'start';
    if (anchor === 'end' && x - m.l < room) anchor = 'start';
    if (anchor === 'start' && m.l + w - x < room && x - m.l >= room) anchor = 'end';
    const ty = top ? m.t + 11 : m.t + h - 8;
    out.push(`<line x1="${f1(x)}" x2="${f1(x)}" y1="${m.t}" y2="${m.t + h}" stroke="${PAPER}" stroke-opacity="0.55" stroke-width="1" stroke-dasharray="1 3"/>`);
    out.push(`<text x="${f1(x + (anchor === 'start' ? 5 : -5))}" y="${ty}" fill="${PAPER}" fill-opacity="0.85" font-family="-apple-system, BlinkMacSystemFont, Segoe UI Variable Text, Segoe UI, Inter, Roboto, Helvetica Neue, Arial, sans-serif" font-size="10" text-anchor="${anchor}">${esc(text)}</text>`);
  } else if (isNum(cmp)) {
    const left = cmp < lo;
    const x = left ? m.l + 5 : m.l + w - 5;
    out.push(`<text x="${x}" y="${left ? m.t + 11 : m.t + h - 8}" fill="${PAPER}" fill-opacity="0.85" font-family="-apple-system, BlinkMacSystemFont, Segoe UI Variable Text, Segoe UI, Inter, Roboto, Helvetica Neue, Arial, sans-serif" font-size="10" text-anchor="${left ? 'start' : 'end'}">${left ? '← ' : ''}${esc(data.compare.label)}, ${esc(formatFlux(data.compare.flux_uJy))} µJy${left ? '' : ' →'}</text>`);
  }
  // the limit
  if (data.limit && data.limit.status === 'ok') {
    // The curve rises to the right, so the space above and to the left of the crossing is free;
    // near the left edge the label goes below and to the right instead.
    const x = X(data.limit.flux_uJy);
    const roomLeft = x - m.l > 62;
    out.push(`<line x1="${f1(x)}" x2="${f1(x)}" y1="${f1(Y(0.5))}" y2="${m.t + h}" stroke="${SIGNAL}" stroke-width="1.5"/>`);
    out.push(`<circle cx="${f1(x)}" cy="${f1(Y(0.5))}" r="3.2" fill="${INK}" stroke="${SIGNAL}" stroke-width="1.5"/>`);
    out.push(`<text x="${f1(x + (roomLeft ? -8 : 8))}" y="${f1(Y(0.5) + (roomLeft ? -7 : 16))}" fill="${SIGNAL}" font-family="${NUM}" font-size="12" text-anchor="${roomLeft ? 'end' : 'start'}">${esc(formatFlux(data.limit.flux_uJy))} µJy</text>`);
  }
  out.push('</svg>');
  return out.join('');
}

// ---- DOM ---------------------------------------------------------------------------------------

function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

let uid = 0;

/**
 * Install the plugin. Returns { dispose() }.
 * Uses app.addPanel (required), and app.addTool, app.addView, app.addOverlay, app.store, app.on,
 * app.selection, app.toast when present.
 */
export function install(app) {
  if (!app || typeof app.addPanel !== 'function' || typeof document === 'undefined') return { dispose() {} };
  ensureInjectStyles(document);
  const id = `tbj${++uid}`;

  const first = PRESETS[0];
  const st = {
    preset: first.id,
    distAU: first.model.dist_AU,
    mode: 'physical',
    radius_km: first.model.radius_km, T_K: first.model.T_K, albedo: first.model.albedo,
    methane: !!first.model.methane, window: first.model.window || null,
    flux_uJy: 300,
    planted: null,          // { params, out, prevView }
    sweep: null,            // { controller }
    curve: null,            // { curve, limit, blindLimit, compare, refWave, det }
    lastDet: null,
  };
  let viewHandle = null;
  let removeOverlay = null;
  let tool = null;
  let panel = null;
  let ui = null;
  const offs = [];
  let disposed = false;

  const dist = logScale(30, 100000);
  const flux = logScale(0.01, 1e6);
  const radius = logScale(10, 200000);
  const temp = logScale(20, 2000);

  // Event handlers must never throw (CONTRACT-PLUGINS.md), including the async ones.
  const safe = (fn) => (...args) => {
    try {
      const r = fn(...args);
      if (r && typeof r.catch === 'function') r.catch((err) => console.warn('[tombaugh] injection test', err));
      return r;
    } catch (err) {
      console.warn('[tombaugh] injection test', err);
      return undefined;
    }
  };

  function layersNow() {
    try { return (app.layers ? app.layers() : []) || []; } catch { return []; }
  }
  function gridNow() {
    try { return app.grid ? app.grid() : null; } catch { return null; }
  }
  function refNow(layers) {
    const r = referenceWave(layers);
    return isNum(r.wave) ? r : { wave: REF_WAVE_UM, min: NaN, max: NaN, preferred: true };
  }
  function modelNow() {
    return {
      radius_km: st.radius_km, T_K: st.T_K, albedo: st.albedo, dist_AU: st.distAU,
      methane: st.methane, window: st.window,
    };
  }
  /** Brightness and spectrum of the body as currently set. */
  function sourceNow(refWave) {
    const model = modelNow();
    if (st.mode === 'physical') {
      return { flux_uJy: bodyFlux_uJy(model, refWave), fluxAt: (w) => bodyFlux_uJy(model, w), model };
    }
    return { flux_uJy: st.flux_uJy, fluxAt: scaledSpectrum(model, st.flux_uJy, refWave), model };
  }
  /** The body the limit is compared with in the result sentence. */
  function compareNow(refWave) {
    const preset = presetById(st.preset);
    if (st.mode === 'physical' && preset) {
      return { short: preset.short, label: preset.label.replace(/ at .*$/, ''), flux_uJy: bodyFlux_uJy(modelNow(), refWave), caveat: preset.caveat };
    }
    if (st.mode === 'physical') {
      return {
        short: `A body ${fmtInt(st.radius_km)} km in radius at ${formatDistance(st.distAU)}`, label: 'this body',
        flux_uJy: bodyFlux_uJy(modelNow(), refWave), caveat: 'a blackbody plus reflected sunlight with a grey albedo',
      };
    }
    const px = PRESETS[0];
    return { short: px.short, label: 'Planet X', flux_uJy: bodyFlux_uJy(px.model, refWave), caveat: px.caveat };
  }

  // ---- panel ---------------------------------------------------------------------------------

  function render(container) {
    const root = el('div', { class: 'tbj' });
    const lede = el('p', { class: 'tbj-lede', text: TEXT.lede });

    // preset
    const presetSel = el('select', { id: `${id}-preset` },
      ...PRESETS.map((p) => el('option', { value: p.id, text: p.label })),
      el('option', { value: 'custom', text: 'Custom' }));
    const presetField = el('div', { class: 'tbj-field' }, el('label', { class: 'tbj-label', for: `${id}-preset`, text: 'Body' }), presetSel);

    // distance
    const distOut = el('output', { class: 'tbj-value', for: `${id}-dist` });
    const distIn = el('input', { id: `${id}-dist`, type: 'range', min: '0', max: '1000', step: '1' });
    const distNote = el('p', { class: 'tbj-small' });
    const distField = el('div', { class: 'tbj-field' },
      el('div', { class: 'tbj-row' }, el('label', { for: `${id}-dist`, text: 'Distance from the Sun' }), distOut), distIn, distNote);

    // brightness mode
    const modePhys = el('input', { type: 'radio', name: `${id}-mode`, value: 'physical' });
    const modeDirect = el('input', { type: 'radio', name: `${id}-mode`, value: 'direct' });
    const seg = el('div', { class: 'tbj-seg', role: 'radiogroup', 'aria-label': 'How the brightness is set' },
      el('label', null, modePhys, 'Size and temperature'),
      el('label', null, modeDirect, 'Set brightness'));

    const slider = (key, label) => {
      const out = el('output', { class: 'tbj-value', for: `${id}-${key}` });
      const input = el('input', { id: `${id}-${key}`, type: 'range', min: '0', max: '1000', step: '1' });
      const field = el('div', { class: 'tbj-field' }, el('div', { class: 'tbj-row' }, el('label', { for: `${id}-${key}`, text: label }), out), input);
      return { field, input, out };
    };
    const rad = slider('radius', 'Radius');
    const tmp = slider('temp', 'Temperature');
    const alb = slider('albedo', 'Albedo');
    alb.input.setAttribute('max', '100');
    const methaneIn = el('input', { type: 'checkbox', id: `${id}-methane` });
    const methane = el('label', { class: 'tbj-check', for: `${id}-methane` }, methaneIn, 'Methane band at 3.3 µm');
    const physBox = el('div', { class: 'tbj-field', style: 'gap: 10px' }, rad.field, tmp.field, alb.field, methane);
    const flx = slider('flux', 'Brightness');
    const directBox = el('div', { class: 'tbj-field' }, flx.field);
    const brightNote = el('p', { class: 'tbj-small', 'aria-live': 'polite' });

    const body = el('fieldset', { class: 'tbj-group' }, presetField, distField,
      el('div', { class: 'tbj-field' }, el('span', { class: 'tbj-label', text: 'Brightness' }), seg), physBox, directBox, brightNote);

    // plant
    const plantBtn = el('button', { type: 'button', class: 'tbj-btn tbj-btn-solid', text: 'Plant it' });
    const removeBtn = el('button', { type: 'button', class: 'tbj-btn', text: 'Remove', hidden: true });
    const plantBox = el('div', { class: 'tbj-result', hidden: true, 'aria-live': 'polite' });
    const plantGroup = el('div', { class: 'tbj-group' },
      el('span', { class: 'tbj-label', text: 'One body' }),
      el('p', { class: 'tbj-small', text: 'Adds the body to a copy of every exposure where it would appear, then shows the residual movie of that copy. Click a spot in the image first to choose where.' }),
      el('div', { class: 'tbj-actions' }, plantBtn, removeBtn), plantBox);

    // sweep
    const sweepBtn = el('button', { type: 'button', class: 'tbj-btn tbj-btn-solid', text: 'Find the limit' });
    const cancelBtn = el('button', { type: 'button', class: 'tbj-btn', text: 'Cancel', hidden: true });
    const barFill = el('span');
    const bar = el('div', { class: 'tbj-bar', role: 'progressbar', 'aria-label': 'Injection test progress', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' }, barFill);
    const barText = el('p', { class: 'tbj-small tbj-num' });
    const progress = el('div', { class: 'tbj-progress', hidden: true }, bar, barText);
    const sweepBox = el('div', { class: 'tbj-result', hidden: true, 'aria-live': 'polite' });
    const sweepGroup = el('div', { class: 'tbj-group' },
      el('span', { class: 'tbj-label', text: 'Many bodies' }),
      el('p', { class: 'tbj-small', text: 'Plants ten bodies at this distance at each of eight or more brightnesses, runs the search on every copy, and counts how many come back.' }),
      el('div', { class: 'tbj-actions' }, sweepBtn, cancelBtn), progress, sweepBox);

    const foot = el('p', { class: 'tbj-small tbj-foot', text: TEXT.honest });
    root.append(lede, body, plantGroup, sweepGroup, foot);
    container.append(root);

    // ---- readouts ----
    function syncControls() {
      presetSel.value = st.preset;
      distIn.value = String(dist.toPos(st.distAU));
      distOut.textContent = formatDistance(st.distAU);
      distIn.setAttribute('aria-valuetext', formatDistance(st.distAU));
      const hop = hopArcsec(st.distAU);
      const drift = keplerRate(st.distAU);
      distNote.textContent = `Hops ${formatAngle(hop)} between passes six months apart; drifts ${formatAngle(drift)} a year on a circular orbit.`;
      modePhys.checked = st.mode === 'physical';
      modeDirect.checked = st.mode === 'direct';
      physBox.hidden = st.mode !== 'physical';
      directBox.hidden = st.mode !== 'direct';
      rad.input.value = String(radius.toPos(st.radius_km));
      rad.out.textContent = `${fmtInt(Number(st.radius_km.toPrecision(3)))} km`;
      rad.input.setAttribute('aria-valuetext', rad.out.textContent);
      tmp.input.value = String(temp.toPos(st.T_K));
      tmp.out.textContent = `${fmtInt(Number(st.T_K.toPrecision(3)))} K`;
      tmp.input.setAttribute('aria-valuetext', tmp.out.textContent);
      alb.input.value = String(Math.round(st.albedo * 100));
      alb.out.textContent = st.albedo.toFixed(2);
      methaneIn.checked = !!st.methane;
      const ref = refNow(layersNow());
      flx.input.value = String(flux.toPos(st.flux_uJy));
      flx.out.textContent = `${formatFlux(st.flux_uJy)} µJy`;
      flx.input.setAttribute('aria-valuetext', `${formatFlux(st.flux_uJy)} microjansky`);
      flx.field.querySelector('label').textContent = `Brightness at ${waveText(ref.wave)}`;
      if (st.mode === 'physical') {
        const parts = fluxParts_uJy(modelNow(), ref.wave);
        const bits = [];
        if (parts.reflected > 0) bits.push(`${formatFlux(parts.reflected)} reflected sunlight`);
        if (parts.thermal > 1e-6 * Math.max(parts.total, 1e-30)) bits.push(`${formatFlux(parts.thermal)} own heat`);
        const preset = presetById(st.preset);
        brightNote.textContent = `That makes ${formatFlux(parts.total)} µJy at ${waveText(ref.wave)}${bits.length > 1 ? ` (${bits.join(', ')})` : ''}. An estimate: ${preset ? preset.caveat : 'a blackbody plus reflected sunlight with a grey albedo'}.`;
      } else {
        brightNote.textContent = ref.preferred
          ? 'The spectrum keeps the shape of the body chosen above.'
          : `These exposures do not reach 4.5 µm, so brightness is quoted at ${waveText(ref.wave)}, the middle of what is loaded.`;
      }
    }

    function custom() {
      st.preset = 'custom';
    }

    presetSel.addEventListener('change', safe(() => {
      const p = presetById(presetSel.value);
      st.preset = p ? p.id : 'custom';
      if (p) {
        st.distAU = p.model.dist_AU;
        st.radius_km = p.model.radius_km; st.T_K = p.model.T_K; st.albedo = p.model.albedo || 0;
        st.methane = !!p.model.methane; st.window = p.model.window || null;
        st.mode = 'physical';
      }
      syncControls();
    }));
    distIn.addEventListener('input', safe(() => { st.distAU = Number(dist.toValue(Number(distIn.value)).toPrecision(3)); custom(); syncControls(); }));
    rad.input.addEventListener('input', safe(() => { st.radius_km = Number(radius.toValue(Number(rad.input.value)).toPrecision(3)); custom(); syncControls(); }));
    tmp.input.addEventListener('input', safe(() => { st.T_K = Number(temp.toValue(Number(tmp.input.value)).toPrecision(3)); st.window = null; custom(); syncControls(); }));
    alb.input.addEventListener('input', safe(() => { st.albedo = Number(alb.input.value) / 100; custom(); syncControls(); }));
    methaneIn.addEventListener('change', safe(() => { st.methane = methaneIn.checked; custom(); syncControls(); }));
    flx.input.addEventListener('input', safe(() => { st.flux_uJy = Number(flux.toValue(Number(flx.input.value)).toPrecision(2)); syncControls(); }));
    modePhys.addEventListener('change', safe(() => { if (modePhys.checked) { st.mode = 'physical'; syncControls(); } }));
    modeDirect.addEventListener('change', safe(() => {
      if (!modeDirect.checked) return;
      // start the hand-set brightness from where the physical model left it, if that is on the slider
      const f = bodyFlux_uJy(modelNow(), refNow(layersNow()).wave);
      if (st.mode === 'physical' && f >= 0.01 && f <= 1e6) st.flux_uJy = Number(f.toPrecision(2));
      st.mode = 'direct';
      syncControls();
    }));

    // ---- plant ----
    function showPlanted() {
      const p = st.planted;
      removeBtn.hidden = !p;
      plantBtn.textContent = p ? 'Plant again' : 'Plant it';
      plantBox.replaceChildren();
      if (!p) { plantBox.hidden = true; return; }
      plantBox.hidden = false;
      plantBox.append(el('span', { class: 'tbj-tag', text: 'SIMULATED' }));
      if (!p.out) {
        plantBox.append(el('p', { text: 'Planting and running the search…' }));
        return;
      }
      const lines = plantedSentences({ ...p.out, gridScale: (gridNow() || {}).scale }, p.params);
      lines.forEach((line, i) => plantBox.append(el('p', { class: i === 1 ? 'tbj-headline' : (i > 1 ? 'tbj-small' : ''), text: line })));
    }

    function paramsFor(layers, grid) {
      const ref = refNow(layers);
      const src = sourceNow(ref.wave);
      let selection = null;
      try { selection = app.selection ? app.selection() : null; } catch { selection = null; }
      return { distAU: st.distAU, fluxAt: src.fluxAt, flux_uJy: src.flux_uJy, refWave: ref.wave, spot: chooseSpot(layers, grid, selection) };
    }

    async function buildView(ctx) {
      if (!st.planted) return [];
      const layers = (ctx && ctx.layers) || layersNow();
      const grid = (ctx && ctx.grid) || gridNow();
      try {
        // the spot is chosen once per planting; the brightness follows the detector being shown
        const params = { ...paramsFor(layers, grid), spot: st.planted.params.spot || undefined };
        if (!params.spot) params.spot = chooseSpot(layers, grid, null);
        const out = await buildInjectedMovie(layers, grid, params, LIB);
        if (!st.planted) return [];
        st.planted.params = params;
        st.planted.out = out;
        showPlanted();
        return out.frames;
      } catch (err) {
        console.warn('[tombaugh] injection test: planting failed', err);
        if (st.planted) { st.planted.out = { message: 'The body could not be planted in these frames.' }; showPlanted(); }
        return [];
      }
    }

    function unplant({ restoreView = true } = {}) {
      const p = st.planted;
      st.planted = null;
      if (removeOverlay) { try { removeOverlay(); } catch { /* host already gone */ } removeOverlay = null; }
      if (viewHandle) { try { viewHandle.remove(); } catch { /* host already gone */ } viewHandle = null; }
      if (restoreView && p && p.prevView && app.store) {
        try { if (app.store.get().view !== p.prevView) app.store.set({ view: p.prevView }); } catch { /* ignore */ }
      }
      if (tool) tool.setActive(false);
      showPlanted();
    }

    const plant = safe(async () => {
      const layers = layersNow();
      const grid = gridNow();
      if (!grid || !layers.length) { toast(TEXT.noData); return; }
      if (layers.length < 4) { toast(TEXT.fewLayers); return; }
      let prevView = st.planted ? st.planted.prevView : null;
      try { if (!prevView && app.store) prevView = app.store.get().view; } catch { prevView = null; }
      if (prevView === VIEW_ID) prevView = 'residual';
      unplant({ restoreView: false });
      st.planted = { params: paramsFor(layers, grid), out: null, prevView };
      showPlanted();
      if (tool) tool.setActive(true);
      if (typeof app.addOverlay === 'function') {
        removeOverlay = app.addOverlay((frame) => (frame && frame.simulated && Array.isArray(frame.simMarkers) ? { markers: frame.simMarkers } : null));
      }
      if (typeof app.addView === 'function' && app.store) {
        viewHandle = app.addView({
          id: VIEW_ID, label: 'Injected',
          title: 'Residual movie of a copy of the frames with a simulated body planted in it. Not real data.',
          build: buildView,
        });
        try { app.store.set({ view: VIEW_ID, t: 0 }); } catch { /* ignore */ }
      } else {
        await buildView(null);       // no view host: still report whether it was recovered
      }
    });
    plantBtn.addEventListener('click', plant);
    removeBtn.addEventListener('click', safe(() => unplant()));

    // ---- sweep ----
    function showSweep() {
      sweepBox.replaceChildren();
      const c = st.curve;
      if (!c) { sweepBox.hidden = true; return; }
      sweepBox.hidden = false;
      if (c.message) { sweepBox.append(el('p', { text: c.message })); return; }
      const s = limitSentences({
        limit: c.limit, blindLimit: c.blindLimit, nPasses: c.curve.nPasses, nExposures: c.curve.nLayers,
        distAU: c.distAU, refWave: c.refWave, compare: c.compare,
      });
      sweepBox.append(el('p', { class: 'tbj-headline', text: s.headline }));
      if (s.comparison) sweepBox.append(el('p', { text: s.comparison }));
      const chart = el('div');
      chart.innerHTML = curveSvg({ points: c.curve.points, limit: c.limit, blindLimit: c.blindLimit, refWave: c.refWave, compare: c.compare });
      sweepBox.append(chart);
      const legend = el('div', { class: 'tbj-legend' },
        el('span', null, el('i'), 'recovered at the planted position'),
        el('span', null, el('i', { class: 'tbj-dash' }), 'flagged by the blind candidate list'),
        c.limit.status === 'ok' ? el('span', null, el('i', { class: 'tbj-lim' }), 'half recovered') : null);
      sweepBox.append(legend);
      if (s.blind) sweepBox.append(el('p', { class: 'tbj-small', text: s.blind }));
      const hop = hopArcsec(c.distAU);
      if (isNum(hop) && hop < 2 * c.gridScale) sweepBox.append(el('p', { class: 'tbj-small', text: TEXT.staticNote }));
      const left = c.curve.excluded > 0
        ? ` ${c.curve.excluded} of the test positions ${c.curve.excluded === 1 ? 'was' : 'were'} left out because something there already changes without a planted body.`
        : '';
      sweepBox.append(el('p', { class: 'tbj-small', text: `${c.detText}. On average each planted body was in view in ${Math.round(c.curve.meanOnGrid)} of ${c.curve.nLayers} exposures.${left} ${s.caveat}` }));
    }

    function setBusy(busy) {
      sweepBtn.disabled = busy;
      cancelBtn.hidden = !busy;
      progress.hidden = !busy;
      if (!busy) { barFill.style.width = '0'; bar.setAttribute('aria-valuenow', '0'); barText.textContent = ''; }
    }

    const sweep = safe(async () => {
      if (st.sweep) return;
      const layers = layersNow();
      const grid = gridNow();
      if (!grid || !layers.length) { toast(TEXT.noData); return; }
      if (layers.length < 4) { toast(TEXT.fewLayers); return; }
      const ref = refNow(layers);
      const src = sourceNow(ref.wave);
      const shape = scaledSpectrum(src.model, 1, ref.wave);
      const controller = new AbortController();
      st.sweep = { controller };
      setBusy(true);
      barText.textContent = 'Planting the first set of bodies…';
      const distAU = st.distAU;
      const compare = compareNow(ref.wave);
      const det = layers[0].det;
      try {
        const curve = await detectionCurve(layers, grid, {
          lib: LIB, distAU, motion: 'circular', spectrum: shape, positions: 10, steps: 8, seed: 1,
          threshold: THRESHOLD, nativePixArcsec: layers[0].frame ? NATIVE_PIX_ARCSEC : 0, signal: controller.signal,
          onProgress: ({ done, total, flux_uJy, point }) => {
            const pct = Math.round((100 * done) / Math.max(total, 1));
            barFill.style.width = `${pct}%`;
            bar.setAttribute('aria-valuenow', String(pct));
            barText.textContent = `Brightness ${done} of ${total}: ${formatFlux(flux_uJy)} µJy, ${point.detected} of ${point.n} recovered`;
          },
        });
        if (disposed) return;
        st.curve = curve.points.length
          ? {
            curve, limit: limitDetail(curve, 0.5), blindLimit: limitDetail(curve, 0.5, 'blindCompleteness'),
            compare, refWave: ref.wave, distAU, gridScale: grid.scale, detText: `Run on ${detLabel(det)}`,
          }
          : { message: 'No place could be found to plant test bodies in these frames.' };
      } catch (err) {
        if (err && err.name === 'AbortError') {
          st.curve = { message: 'Cancelled. Nothing was changed.' };
        } else {
          console.warn('[tombaugh] injection test: sweep failed', err);
          st.curve = { message: 'The test stopped on an error and gave no result.' };
        }
      } finally {
        st.sweep = null;
        if (!disposed) { setBusy(false); showSweep(); }
      }
    });
    sweepBtn.addEventListener('click', sweep);
    cancelBtn.addEventListener('click', safe(() => { if (st.sweep) st.sweep.controller.abort(); }));

    function toast(message) {
      try { if (app.toast) app.toast(message, { kind: 'info' }); } catch { /* ignore */ }
      plantBox.hidden = false;
      plantBox.replaceChildren(el('p', { text: message }));
    }

    syncControls();
    showPlanted();
    showSweep();
    ui = {
      update: safe(() => { syncControls(); }),
      reset: safe(() => {
        if (st.sweep) st.sweep.controller.abort();
        unplant({ restoreView: false });
        st.curve = null;
        showSweep();
        syncControls();
      }),
      staleSweep: safe(() => {
        if (st.sweep) st.sweep.controller.abort();
        st.curve = null;
        showSweep();
        syncControls();
      }),
      unplant,
      root,
    };
    return {
      update: ui.update,
      dispose() { root.remove(); },
    };
  }

  panel = app.addPanel({ id: 'inject', title: meta.title, order: 80, render });
  if (typeof app.addTool === 'function') {
    tool = app.addTool({
      id: 'inject', label: 'Inject', group: 'extra',
      title: 'Injection test: plant a simulated body and see whether Tombaugh finds it',
      onClick: () => { if (panel && panel.show) panel.show(); },
    });
    if (tool && typeof tool.setActive !== 'function') tool.setActive = () => {};
  }

  try { st.lastDet = app.store ? app.store.get().det : null; } catch { st.lastDet = null; }
  if (typeof app.on === 'function') {
    // A new target: the planted body and any measured limit belong to the old patch.
    offs.push(app.on('target', () => { if (ui) ui.reset(); }));
    // A different detector: the limit was measured on other exposures. The planted body is
    // replanted by the view itself when the host rebuilds the movie.
    offs.push(app.on('state', () => {
      let det = null;
      try { det = app.store ? app.store.get().det : null; } catch { det = null; }
      if (st.lastDet !== null && st.lastDet !== undefined && det !== st.lastDet && ui) ui.staleSweep();
      st.lastDet = det;
    }));
    offs.push(app.on('frames', () => { if (ui) ui.update(); }));
  }

  return {
    dispose() {
      disposed = true;
      if (st.sweep) st.sweep.controller.abort();
      for (const off of offs) { try { if (typeof off === 'function') off(); } catch { /* ignore */ } }
      if (ui) ui.unplant({ restoreView: true });
      if (removeOverlay) { try { removeOverlay(); } catch { /* ignore */ } }
      if (viewHandle) { try { viewHandle.remove(); } catch { /* ignore */ } }
      if (tool && tool.remove) { try { tool.remove(); } catch { /* ignore */ } }
      if (panel && panel.remove) { try { panel.remove(); } catch { /* ignore */ } }
    },
  };
}
