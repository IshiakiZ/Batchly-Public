// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// recover.js - did the tool find the body we planted? Pure functions, no DOM.
//
// The second half of injection and recovery. inject.js has added a simulated body to copies of
// the real layers; here Tombaugh's own detection pipeline is run on those doctored layers and
// asked two questions at the places where the body was put:
//
//   (a) residual   Fit the static-sky model (core/skymodel.js fitSkyModel), stack the residuals
//                  of each survey pass (residualPassStacks) and read the significance at the
//                  body's position in that pass. This is what the "residual" view shows.
//   (b) stack      Shift every exposure's residual back along the body's true track and average
//                  (core/distance.js shiftAndStack), as the distance dial does at the right
//                  distance, and read the matched-filter significance where the body lands,
//                  divided by the measured scatter of that map (the dial's own calibration).
//
// The body counts as recovered when either reaches the threshold (5 sigma by default). That is
// the best case: we look exactly where we know the body is, along exactly the right track. A
// blind search has to clear the same bar over every pixel and every trial distance, so its
// limit is somewhat worse. When core's findCandidates is supplied, each result also says
// whether the tool's own blind candidate list flagged the body (`blind`); a flag there counts
// as recovered too (it matters for bodies that barely move, whose residual is a dipole with
// nothing at its centre).
//
// Real frames contain real things that change. A test position where the pipeline already
// reports something WITHOUT any planted body would count as "recovered" at every brightness,
// so detectionCurve first runs the pipeline on the untouched layers and leaves such positions
// out (`excluded`).
//
// The model is fitted to the doctored layers, so anything the fit does to a real faint mover
// (absorbing part of it into the "static" sky, for instance) happens to the fake as well. That
// is the point of doing it this way.
//
// The core functions are passed in (`lib`) so that tests can use the real modules or fakes.
// Everything long-running is async, yields to the event loop between steps and stops when an
// AbortSignal fires.

import { trackOnGrid, injectIntoLayers, planTrack, addGaussian, ujyPerMJySr, effectiveFwhmArcsec, DEFAULT_FWHM_ARCSEC } from './inject.js';
import { gridPixToSky } from '../../core/wcs.js';

const FWHM_TO_SIGMA = 1 / 2.3548200450309493;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// ---- small utilities ---------------------------------------------------------------------------

/** Deterministic 32-bit generator (mulberry32): returns a function giving uniform [0, 1). */
export function seededRandom(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function abortError() {
  if (typeof DOMException === 'function') return new DOMException('The injection test was cancelled.', 'AbortError');
  const e = new Error('The injection test was cancelled.');
  e.name = 'AbortError';
  return e;
}

function checkAbort(signal) {
  if (signal && signal.aborted) throw abortError();
}

const defaultPause = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Pass index of every layer: a new pass starts after a gap of more than gapDays. */
export function passIndices(layers, gapDays = 45) {
  const order = (layers || []).map((l, i) => ({ i, mjd: l ? l.mjd : NaN })).filter((o) => isNum(o.mjd));
  order.sort((p, q) => p.mjd - q.mjd);
  const index = new Int32Array((layers || []).length).fill(-1);
  let pass = -1;
  let last = -Infinity;
  for (const o of order) {
    if (pass < 0 || o.mjd - last > gapDays) pass++;
    index[o.i] = pass;
    last = o.mjd;
  }
  return { index, count: pass + 1 };
}

function median(values) {
  const v = Float64Array.from(values).sort();
  if (!v.length) return NaN;
  const h = v.length >> 1;
  return v.length % 2 ? v[h] : 0.5 * (v[h - 1] + v[h]);
}

/** 1.4826 * MAD of the finite values of `data` inside a pixel box. */
function robustSigmaBox(data, n, box) {
  const vals = [];
  for (let y = box.y0; y <= box.y1; y++) {
    for (let x = box.x0; x <= box.x1; x++) {
      const v = data[y * n + x];
      if (Number.isFinite(v)) vals.push(v);
    }
  }
  if (vals.length < 8) return NaN;
  const med = median(vals);
  return 1.4826 * median(vals.map((v) => Math.abs(v - med)));
}

/** Wilson score interval for k successes in n trials (z = 1: about 68 percent). */
export function wilson(k, n, z = 1) {
  if (!(n > 0)) return [0, 1];
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

// ---- recovery ----------------------------------------------------------------------------------

/** Per-layer pixel positions of a truth: uses truth.positions, else derives them from truth.track. */
function positionsOf(truth, grid, layers) {
  if (truth && Array.isArray(truth.positions) && truth.positions.length === layers.length) return truth.positions;
  return trackOnGrid(truth ? truth.track : null, grid, layers);
}

/** Mean on-grid position of the body in each pass: [{ passIndex, x, y, count, spread }]. */
export function passPositions(positions, passes) {
  const acc = [];
  for (let p = 0; p < passes.count; p++) acc.push({ passIndex: p, x: 0, y: 0, count: 0, spread: 0, pts: [] });
  positions.forEach((q, i) => {
    const p = passes.index[i];
    if (p < 0 || !q || !q.onGrid) return;
    acc[p].x += q.x; acc[p].y += q.y; acc[p].count++; acc[p].pts.push(q);
  });
  return acc.filter((a) => a.count > 0).map((a) => {
    const x = a.x / a.count, y = a.y / a.count;
    let spread = 0;
    for (const q of a.pts) spread = Math.max(spread, Math.hypot(q.x - x, q.y - y));
    return { passIndex: a.passIndex, x, y, count: a.count, spread };
  });
}

/**
 * Run the detection pipeline once on (doctored) layers and judge several planted bodies.
 *
 * @param {Array<object>} layers Layer[] on `grid`, one detector, already containing the fakes
 * @param {{ n: number, scale: number, ra0?: number, dec0?: number }} grid
 * @param {Array<{ track?: Array<object>, positions?: Array<{ x: number, y: number, onGrid: boolean }>, id?: any }>} truths
 *   where each body really is: a planTrack() track, or per-layer pixel positions (trackOnGrid)
 * @param {{ fitSkyModel: Function, residualPassStacks?: Function, residualLayer?: Function,
 *           findCandidates?: Function, shiftAndStack?: Function }} lib  core functions
 * @param {{ threshold?: number, gapDays?: number, box?: number, matchRadius?: number,
 *           psfFwhmArcsec?: number, model?: object, signal?: AbortSignal, pause?: Function }} [opts]
 *   threshold: significance needed, default 5. box: half-width in pixels of the region used to
 *   calibrate the shift-and-stack map, default 12. matchRadius: how close (pixels) a blind
 *   candidate must be to count as the body, default 2.5. model: a sky model to reuse.
 * @returns {Promise<Array<object>>} one result per truth:
 *   { detected, snr, where: { x, y, ra, dec, passIndex? } | null,
 *     method: 'residual' | 'stack' | 'candidate' | 'none',
 *     residual: { snr, x, y, passIndex, count } | null, stack: { snr, raw, noise, x, y, count } | null,
 *     blind: boolean | null, nOnGrid, threshold }
 *   snr is the larger of the two methods' significances at the true position (NaN if neither
 *   could be evaluated); `where` is the pixel that significance was read from. detected is
 *   snr >= threshold, or a flag from the blind candidate list within matchRadius of the true
 *   position in the right pass (method 'candidate' when that is the only evidence).
 */
export async function recoverMany(layers, grid, truths, lib = {}, opts = {}) {
  const { threshold = 5, gapDays = 45, box = 12, matchRadius = 2.5, signal } = opts;
  const pause = typeof opts.pause === 'function' ? opts.pause : defaultPause;
  const n = grid.n;
  const list = Array.isArray(truths) ? truths : [];
  const L = Array.isArray(layers) ? layers : [];
  checkAbort(signal);
  if (!L.length || typeof lib.fitSkyModel !== 'function') {
    return list.map(() => ({
      detected: false, snr: NaN, where: null, method: 'none', residual: null, stack: null, blind: null,
      nOnGrid: 0, threshold,
    }));
  }

  const passes = passIndices(L, gapDays);
  const model = opts.model || lib.fitSkyModel(L);
  await pause();
  checkAbort(signal);

  // (a) pass residual stacks, and the tool's own blind candidate list
  let stacks = null;
  if (typeof lib.residualPassStacks === 'function') {
    try { stacks = lib.residualPassStacks(model, L, { gapDays }); } catch { stacks = null; }
    if (!Array.isArray(stacks) || stacks.length !== passes.count) stacks = null;
  }
  let candidates = null;
  if (stacks && typeof lib.findCandidates === 'function') {
    try { candidates = lib.findCandidates(model, L, { stacks, minSnr: threshold, max: 400 }); } catch { candidates = null; }
  }
  await pause();
  checkAbort(signal);

  // (b) per-exposure residuals for shift-and-stack
  let residuals = null;
  if (typeof lib.shiftAndStack === 'function') {
    if (typeof lib.residualLayer === 'function') {
      residuals = L.map((layer) => {
        const r = lib.residualLayer(model, layer);
        return { image: r.image, variance: layer.variance, mask: r.mask, mjd: layer.mjd };
      });
    } else {
      residuals = L;                       // no model subtraction available: stack the layers as they are
    }
    await pause();
    checkAbort(signal);
  }

  const out = [];
  for (let t = 0; t < list.length; t++) {
    const pos = positionsOf(list[t], grid, L);
    const perPass = passPositions(pos, passes);
    const nOnGrid = pos.reduce((s, q) => s + (q && q.onGrid ? 1 : 0), 0);

    let residual = null;
    let blind = candidates ? false : null;
    let flag = null;
    if (stacks) {
      for (const pp of perPass) {
        const st = stacks[pp.passIndex];
        const x = Math.min(n - 1, Math.max(0, Math.round(pp.x)));
        const y = Math.min(n - 1, Math.max(0, Math.round(pp.y)));
        const i = y * n + x;
        const s = st && st.snr && !(st.mask && st.mask[i]) ? st.snr[i] : NaN;
        if (isNum(s) && (!residual || s > residual.snr)) residual = { snr: s, x, y, passIndex: pp.passIndex, count: pp.count };
        if (candidates) {
          for (const c of candidates) {
            if (c.passIndex === pp.passIndex && c.snr > 0 && Math.hypot(c.x - pp.x, c.y - pp.y) <= matchRadius) {
              blind = true;
              if (!flag || c.snr > flag.snr) flag = { snr: c.snr, x: c.x, y: c.y, passIndex: c.passIndex };
            }
          }
        }
      }
    }

    let stack = null;
    // Where the stacked body should land: its position in the exposure where it sits farthest
    // from the grid edge (the stack is noisier near the edge), moved to the pixel centre so
    // that the reading does not depend on sub-pixel phase.
    let anchor = null;
    let anchorEdge = -Infinity;
    for (const q of pos) {
      if (!q || !q.onGrid) continue;
      const e = Math.min(q.x, q.y, n - 1 - q.x, n - 1 - q.y);
      if (e > anchorEdge) { anchorEdge = e; anchor = q; }
    }
    if (residuals && anchor) {
      const X0 = Math.min(n - 1, Math.max(0, Math.round(anchor.x)));
      const Y0 = Math.min(n - 1, Math.max(0, Math.round(anchor.y)));
      const offsets = pos.map((q) => (q && q.onGrid
        ? { dEast: -(q.x - X0) * grid.scale, dNorth: (q.y - Y0) * grid.scale }
        : { dEast: NaN, dNorth: NaN }));
      const region = {
        x0: Math.max(0, X0 - box), x1: Math.min(n - 1, X0 + box),
        y0: Math.max(0, Y0 - box), y1: Math.min(n - 1, Y0 + box),
      };
      let st = null;
      try {
        st = lib.shiftAndStack(residuals, grid, offsets, { region, psfFwhmArcsec: opts.psfFwhmArcsec });
      } catch { st = null; }
      if (st) {
        const i = Y0 * n + X0;
        let map = st.snr;
        if (!map && st.image && st.variance) {
          map = new Float32Array(n * n).fill(NaN);
          for (let k = 0; k < map.length; k++) {
            if (st.variance[k] > 0 && !(st.mask && st.mask[k])) map[k] = st.image[k] / Math.sqrt(st.variance[k]);
          }
        }
        if (map) {
          const raw = map[i];
          let noise = robustSigmaBox(map, n, region);
          if (!(noise > 0)) noise = isNum(st.noise) && st.noise > 0 ? st.noise : 1;
          if (isNum(raw)) stack = { snr: raw / noise, raw, noise, x: X0, y: Y0, count: st.count ? st.count[i] : nOnGrid };
        }
      }
    }

    const rs = residual ? residual.snr : NaN;
    const ss = stack ? stack.snr : NaN;
    let method = 'none';
    let best = NaN;
    let at = null;
    if (isNum(rs) && (!isNum(ss) || rs >= ss)) { method = 'residual'; best = rs; at = residual; }
    else if (isNum(ss)) { method = 'stack'; best = ss; at = stack; }
    // Flagged by the candidate list although the reading at the exact position is low.
    if (flag && !(best >= threshold)) { method = 'candidate'; at = flag; }
    let where = null;
    if (at) {
      where = { x: at.x, y: at.y };
      if (isNum(grid.ra0) && isNum(grid.dec0)) {
        const sky = gridPixToSky(grid, at.x, at.y);
        where.ra = sky[0]; where.dec = sky[1];
      }
      if (method !== 'stack') where.passIndex = at.passIndex;
    }
    out.push({
      detected: (isNum(best) && best >= threshold) || blind === true,
      snr: best, where, method, residual, stack, blind, nOnGrid, threshold,
    });
    if (t % 4 === 3) { await pause(); checkAbort(signal); }
  }
  return out;
}

/**
 * Judge one planted body. Same as recoverMany for a single truth.
 * @returns {Promise<{ detected: boolean, snr: number, where: object|null, method: string }>}
 *   plus the per-method details listed at recoverMany.
 */
export async function recover(layers, grid, truth, lib = {}, opts = {}) {
  const r = await recoverMany(layers, grid, [truth], lib, opts);
  return r[0];
}

// ---- expectation -------------------------------------------------------------------------------

/**
 * The best a matched filter could do in white noise: the n-sigma point-source flux if a body sat
 * in every one of `layers`, each pixel independent with the layer's median variance:
 *     sigma_F = 1 / sqrt( sum over layers of  sum(P^2) / variance ),
 * P the pixel-integrated PSF with unit sum. Returned in microjansky. A yardstick to compare the
 * measured limit against, and the starting guess for the flux sweep; real layers have correlated
 * noise, stars and a sky model that eats part of a faint mover, so the measured limit is higher.
 * @param {Array<object>} layers @param {{ n: number, scale: number }} grid
 * @param {{ nSigma?: number, fwhmArcsec?: number, nativePixArcsec?: number, count?: number }} [opts]
 *   count: pretend only this many of the layers contain the body (scales the result).
 */
export function analyticLimit_uJy(layers, grid, opts = {}) {
  const { nSigma = 5, fwhmArcsec = DEFAULT_FWHM_ARCSEC, nativePixArcsec = 0 } = opts;
  const eff = nativePixArcsec > 0 ? effectiveFwhmArcsec(fwhmArcsec, nativePixArcsec) : fwhmArcsec;
  const sigmaPix = (eff * FWHM_TO_SIGMA) / grid.scale;
  const m = 2 * Math.ceil(5 * sigmaPix + 1) + 1;
  const kernel = new Float32Array(m * m);
  addGaussian(kernel, m, m, (m - 1) / 2, (m - 1) / 2, sigmaPix, 1, null);
  let p2 = 0;
  for (const v of kernel) p2 += v * v;
  let sum = 0;
  let used = 0;
  for (const layer of layers || []) {
    if (!layer || !layer.image) continue;
    const N = layer.image.length;
    const step = Math.max(1, Math.floor(N / 4000));
    const vals = [];
    if (layer.variance && layer.variance.length >= N) {
      for (let i = 0; i < N; i += step) {
        const v = layer.variance[i];
        if (v > 0 && Number.isFinite(v) && !(layer.mask && layer.mask[i])) vals.push(v);
      }
    }
    let variance = vals.length ? median(vals) : NaN;
    if (!(variance > 0)) {
      const px = [];
      for (let i = 0; i < N; i += step) {
        const v = layer.image[i];
        if (Number.isFinite(v) && !(layer.mask && layer.mask[i])) px.push(v);
      }
      if (px.length < 8) continue;
      const med = median(px);
      const s = 1.4826 * median(px.map((v) => Math.abs(v - med)));
      variance = s * s;
    }
    if (!(variance > 0)) continue;
    sum += p2 / variance;
    used++;
  }
  if (!(sum > 0)) return NaN;
  let limit = (nSigma * ujyPerMJySr(grid.scale)) / Math.sqrt(sum);
  if (opts.count > 0 && used > 0) limit *= Math.sqrt(used / opts.count);
  return limit;
}

// ---- completeness curve ------------------------------------------------------------------------

/**
 * Choose where to plant the test bodies: `count` tracks whose anchor (a random exposure and a
 * random pixel at least `margin` from the edge, unmasked in that exposure) is drawn from a
 * seeded generator, kept at least `minSep` pixels from every other test body in every exposure
 * so that they can all be planted at once without touching.
 * @returns {Array<{ id: number, anchorIndex: number, track: Array<object>, positions: Array<object>, nOnGrid: number }>}
 */
export function planFakes(layers, grid, opts = {}) {
  const { count = 6, seed = 1, distAU = 500, motion = 'circular', minSep = 10 } = opts;
  const n = grid.n;
  const margin = Math.min(isNum(opts.margin) ? opts.margin : 8, Math.floor((n - 1) / 2));
  const rng = seededRandom(seed);
  const mjds = layers.map((l) => l.mjd);
  const fakes = [];
  let tries = 0;
  while (fakes.length < count && tries < count * 60) {
    tries++;
    const anchorIndex = Math.min(layers.length - 1, Math.floor(rng() * layers.length));
    const x = margin + rng() * (n - 1 - 2 * margin);
    const y = margin + rng() * (n - 1 - 2 * margin);
    const layer = layers[anchorIndex];
    const pix = Math.round(y) * n + Math.round(x);
    if (layer.mask && layer.mask[pix]) continue;
    if (!Number.isFinite(layer.image[pix])) continue;
    const [ra, dec] = gridPixToSky(grid, x, y);
    const track = planTrack({ ra, dec, distAU, mjds, motion, refMjd: mjds[anchorIndex] });
    const positions = trackOnGrid(track, grid, layers);
    let clash = false;
    for (const f of fakes) {
      for (let i = 0; i < positions.length && !clash; i++) {
        const a = positions[i], b = f.positions[i];
        if (a.onGrid && b.onGrid && Math.hypot(a.x - b.x, a.y - b.y) < minSep) clash = true;
      }
      if (clash) break;
    }
    if (clash) continue;
    const nOnGrid = positions.reduce((s, q) => s + (q.onGrid ? 1 : 0), 0);
    fakes.push({ id: fakes.length, anchorIndex, track, positions, nOnGrid });
  }
  return fakes;
}

function summarise(flux, results) {
  const n = results.length;
  const k = results.filter((r) => r.detected).length;
  const hasBlind = results.some((r) => r.blind !== null);
  const kb = results.filter((r) => r.blind === true).length;
  const [lo, hi] = wilson(k, n);
  const snrs = results.map((r) => r.snr).filter(isNum);
  return {
    flux_uJy: flux, n, detected: k, completeness: n ? k / n : NaN, lo, hi,
    blind: hasBlind ? kb : null, blindCompleteness: hasBlind && n ? kb / n : NaN,
    medianSnr: snrs.length ? median(snrs) : NaN,
  };
}

/**
 * Completeness against brightness: plant test bodies at a set of brightnesses, run the
 * detection pipeline on each doctored copy of the layers, and record the fraction recovered.
 *
 * At each brightness all the test bodies (`positions` of them, at seeded random places and
 * anchored to random exposures) are planted together and judged with one pipeline run. The same
 * places are used at every brightness, so the curve reflects brightness and not luck of
 * position. Brightness is the flux at `refWave`; in an exposure at another wavelength the body
 * has flux * spectrum(wave).
 *
 * @param {Array<object>} layers real layers of one detector on `grid` (not modified)
 * @param {object} grid
 * @param {{ lib: object, distAU?: number, motion?: object|string, spectrum?: (wave_um: number) => number,
 *           fluxes?: number[], fluxMin?: number, fluxMax?: number, steps?: number, positions?: number,
 *           seed?: number, margin?: number, minSep?: number, threshold?: number, fwhmArcsec?: number,
 *           nativePixArcsec?: number, adaptive?: boolean, maxExtra?: number, signal?: AbortSignal,
 *           onProgress?: Function, pause?: Function }} opts
 *   lib: the core functions (see recoverMany). spectrum: relative brightness against wavelength,
 *   1 at the reference wavelength; default flat. fluxes, or fluxMin..fluxMax in `steps` (default
 *   8) logarithmic steps, in microjansky; with neither, the range is centred on the white-noise
 *   expectation. adaptive (default true): if the range turns out not to bracket the curve, add
 *   up to maxExtra (default 4) steps a factor of two beyond each end.
 *   onProgress({ done, total, flux_uJy, point }) after each brightness. baseline (default true):
 *   first run the pipeline on the untouched layers and drop test positions where it already
 *   reports something; `excluded` in the result counts them.
 * @returns {Promise<{ points: Array<object>, trials: Array<object>, fakes: Array<object>, threshold: number,
 *   distAU: number, nLayers: number, nPasses: number, expected_uJy: number, meanOnGrid: number, excluded: number }>}
 *   points sorted by flux: { flux_uJy, n, detected, completeness, lo, hi, blind, blindCompleteness,
 *   medianSnr }. Rejects with an AbortError (carrying `partial`) when the signal fires.
 */
export async function detectionCurve(layers, grid, opts = {}) {
  const {
    lib = {}, distAU = 500, motion = 'circular', steps = 8, positions = 6, seed = 1,
    threshold = 5, fwhmArcsec = DEFAULT_FWHM_ARCSEC, nativePixArcsec = 0, adaptive = true, maxExtra = 4,
    signal, onProgress,
  } = opts;
  const pause = typeof opts.pause === 'function' ? opts.pause : defaultPause;
  const spectrum = typeof opts.spectrum === 'function' ? opts.spectrum : () => 1;
  const L = Array.isArray(layers) ? layers.filter((l) => l && l.image) : [];
  checkAbort(signal);
  const passes = passIndices(L);
  let fakes = L.length ? planFakes(L, grid, { count: positions, seed, distAU, motion, margin: opts.margin, minSep: opts.minSep }) : [];
  // Leave out positions where the untouched frames already show something.
  let excluded = 0;
  if (fakes.length && opts.baseline !== false) {
    const base = await recoverMany(L, grid, fakes, lib, { threshold, signal, pause, psfFwhmArcsec: opts.psfFwhmArcsec });
    const clean = fakes.filter((f, i) => !base[i].detected);
    excluded = fakes.length - clean.length;
    fakes = clean;
  }
  const meanOnGrid = fakes.length ? fakes.reduce((s, f) => s + f.nOnGrid, 0) / fakes.length : 0;
  const expected = analyticLimit_uJy(L, grid, { nSigma: threshold, fwhmArcsec, nativePixArcsec, count: Math.max(1, meanOnGrid) });
  const result = {
    points: [], trials: [], fakes, threshold, distAU, nLayers: L.length, nPasses: passes.count,
    expected_uJy: expected, meanOnGrid, excluded,
  };
  if (!fakes.length) return result;

  let fluxes;
  let fixed = false;
  if (Array.isArray(opts.fluxes) && opts.fluxes.length) {
    fluxes = opts.fluxes.filter((f) => f > 0 && isNum(f)).sort((a, b) => a - b);
    fixed = true;
  } else {
    const centre = isNum(expected) && expected > 0 ? expected : 100;
    const lo = opts.fluxMin > 0 ? opts.fluxMin : centre / 3;
    const hi = opts.fluxMax > lo ? opts.fluxMax : centre * 24;
    fixed = opts.fluxMin > 0 && opts.fluxMax > 0;
    const k = Math.max(2, Math.floor(steps));
    fluxes = Array.from({ length: k }, (_, i) => lo * Math.pow(hi / lo, i / (k - 1)));
  }
  const extraBudget = adaptive && !fixed ? Math.max(0, maxExtra) : 0;
  let total = fluxes.length;
  let done = 0;

  const runOne = async (flux) => {
    checkAbort(signal);
    const doctored = injectIntoLayers(L, grid, {
      sources: fakes.map((f) => ({ id: f.id, track: f.positions, fluxAt: (w) => flux * spectrum(w) })),
      fwhmArcsec, nativePixArcsec,
    });
    await pause();
    const results = await recoverMany(doctored, grid, fakes, lib, { threshold, signal, pause, psfFwhmArcsec: opts.psfFwhmArcsec });
    const point = summarise(flux, results);
    result.points.push(point);
    result.points.sort((a, b) => a.flux_uJy - b.flux_uJy);
    results.forEach((r, i) => result.trials.push({ flux_uJy: flux, fake: fakes[i].id, ...r }));
    done++;
    if (typeof onProgress === 'function') {
      try { onProgress({ done, total, flux_uJy: flux, point }); } catch { /* a progress callback must not stop the run */ }
    }
    await pause();
    return point;
  };

  try {
    for (const flux of fluxes) await runOne(flux);
    // Not bracketed? Push outward a factor of two at a time.
    let up = 0;
    while (up < extraBudget && result.points[result.points.length - 1].completeness < 0.999) {
      total++; up++;
      await runOne(result.points[result.points.length - 1].flux_uJy * 2);
    }
    let down = 0;
    while (down < extraBudget && result.points[0].completeness > 0.001) {
      total++; down++;
      await runOne(result.points[0].flux_uJy / 2);
    }
  } catch (err) {
    if (err && err.name === 'AbortError') err.partial = result;
    throw err;
  }
  return result;
}

/** Non-decreasing fit to completeness against flux (pool adjacent violators, weighted by trials). */
function monotone(points) {
  const blocks = points.map((p) => ({ w: Math.max(1, p.n || 1), v: p.completeness, k: 1 }));
  const st = [];
  for (const b of blocks) {
    st.push({ ...b });
    while (st.length > 1 && st[st.length - 2].v > st[st.length - 1].v) {
      const b2 = st.pop(), b1 = st.pop();
      const w = b1.w + b2.w;
      st.push({ w, v: (b1.v * b1.w + b2.v * b2.w) / w, k: b1.k + b2.k });
    }
  }
  const out = [];
  for (const b of st) for (let i = 0; i < b.k; i++) out.push(b.v);
  return out;
}

/**
 * Where the completeness curve crosses `level`, with what happened at the ends.
 * @param {{ points: Array<object> } | Array<{ flux_uJy: number, completeness: number, n?: number }>} curve
 * @param {number} [level] default 0.5
 * @param {string} [key] 'completeness' (default) or 'blindCompleteness'
 * @returns {{ status: 'ok' | 'below' | 'above' | 'empty', flux_uJy: number, min_uJy: number, max_uJy: number }}
 *   ok: bracketed, flux_uJy interpolated linearly in log flux on the monotone curve.
 *   below: already at or above `level` at the faintest flux tried (the limit is below min_uJy).
 *   above: never reaches `level` (the limit is above max_uJy).   flux_uJy is NaN unless ok.
 */
export function limitDetail(curve, level = 0.5, key = 'completeness') {
  const raw = Array.isArray(curve) ? curve : (curve && curve.points) || [];
  const pts = raw
    .filter((p) => p && p.flux_uJy > 0 && isNum(p[key]))
    .map((p) => ({ flux_uJy: p.flux_uJy, completeness: p[key], n: p.n }))
    .sort((a, b) => a.flux_uJy - b.flux_uJy);
  if (!pts.length) return { status: 'empty', flux_uJy: NaN, min_uJy: NaN, max_uJy: NaN };
  const min_uJy = pts[0].flux_uJy, max_uJy = pts[pts.length - 1].flux_uJy;
  const c = monotone(pts);
  if (c[0] >= level) return { status: 'below', flux_uJy: NaN, min_uJy, max_uJy };
  for (let i = 1; i < pts.length; i++) {
    if (c[i] >= level) {
      const f = (level - c[i - 1]) / (c[i] - c[i - 1]);
      const lx = Math.log(pts[i - 1].flux_uJy) + f * (Math.log(pts[i].flux_uJy) - Math.log(pts[i - 1].flux_uJy));
      return { status: 'ok', flux_uJy: Math.exp(lx), min_uJy, max_uJy };
    }
  }
  return { status: 'above', flux_uJy: NaN, min_uJy, max_uJy };
}

/**
 * The flux at which completeness reaches `level` (default 0.5), interpolated in log flux.
 * NaN when the curve does not bracket the level; use limitDetail to learn on which side.
 */
export function limitingFlux(curve, level = 0.5) {
  return limitDetail(curve, level).flux_uJy;
}

// ---- words -------------------------------------------------------------------------------------

/** A flux in microjansky to two significant figures, with thousands separators: "310", "0.021". */
export function formatFlux(uJy) {
  if (!isNum(uJy)) return '?';
  if (uJy === 0) return '0';
  const a = Math.abs(uJy);
  const digits = Math.max(0, 1 - Math.floor(Math.log10(a)));
  const rounded = Number(a.toPrecision(2));
  const text = rounded >= 1000
    ? Math.round(rounded).toLocaleString('en-US')
    : rounded.toFixed(Math.min(digits, 6));
  return (uJy < 0 ? '-' : '') + text;
}

/** A ratio as plain words: "15,000 times", "40 times", "2.5 times". */
export function formatTimes(ratio) {
  if (!isNum(ratio) || ratio <= 0) return '?';
  const r = Number(ratio.toPrecision(2));
  if (r >= 1000) return `${Math.round(r).toLocaleString('en-US')} times`;
  if (r >= 10) return `${Math.round(r)} times`;
  return `${r.toFixed(1).replace(/\.0$/, '')} times`;
}

function plural(n, word, many) {
  return `${n.toLocaleString('en-US')} ${n === 1 ? word : (many || `${word}s`)}`;
}

/**
 * The result of a sweep as plain sentences. Never claims more than was measured.
 * @param {{ limit: object, nPasses: number, nExposures: number, distAU: number, refWave: number,
 *           compare?: { short: string, flux_uJy: number, caveat?: string }, blindLimit?: object }} p
 *   limit / blindLimit: limitDetail() results.
 * @returns {{ headline: string, comparison: string, blind: string, caveat: string }}
 */
export function limitSentences({ limit, nPasses, nExposures, distAU, refWave, compare, blindLimit }) {
  const um = `${Number(refWave).toFixed(refWave >= 10 ? 0 : 1).replace(/\.0$/, '')} µm`;
  const where = `In this patch, with ${plural(nPasses, 'pass', 'passes')} and ${plural(nExposures, 'exposure')}`;
  const dist = isNum(distAU) ? ` at ${Math.round(distAU).toLocaleString('en-US')} AU` : '';
  let headline;
  let ref = NaN;
  if (!limit || limit.status === 'empty') {
    headline = 'The test could not be run on these frames.';
  } else if (limit.status === 'ok') {
    ref = limit.flux_uJy;
    headline = `${where}, Tombaugh recovers a planted body${dist} brighter than ${formatFlux(ref)} µJy at ${um} at least half of the time.`;
  } else if (limit.status === 'below') {
    ref = limit.min_uJy;
    headline = `${where}, Tombaugh recovered most planted bodies${dist} even at ${formatFlux(ref)} µJy at ${um}, the faintest tried. The limit is below that.`;
  } else {
    ref = limit.max_uJy;
    headline = `${where}, Tombaugh recovered fewer than half of the planted bodies${dist} even at ${formatFlux(ref)} µJy at ${um}, the brightest tried. The limit is above that.`;
  }

  let comparison = '';
  if (compare && isNum(compare.flux_uJy) && compare.flux_uJy > 0 && isNum(ref)) {
    const f = compare.flux_uJy;
    const would = `${compare.short} would be about ${formatFlux(f)} µJy there`;
    const ratio = ref / f;
    if (limit.status === 'above') {
      comparison = ratio > 1.5
        ? `${would}: more than ${formatTimes(ratio)} too faint.`
        : `${would}. This test did not reach deep enough to say whether it would be seen.`;
    } else if (limit.status === 'below') {
      comparison = ratio < 1 / 1.5
        ? `${would}: brighter than anything this test failed to recover, so it would probably have been seen.`
        : `${would}. This test did not go faint enough to say whether it would be seen.`;
    } else if (ratio > 1.5) {
      comparison = `${would}: about ${formatTimes(ratio)} too faint.`;
    } else if (ratio < 1 / 1.5) {
      comparison = `${would}: about ${formatTimes(1 / ratio)} brighter than the limit, so it would probably have been recovered here.`;
    } else {
      comparison = `${would}: close to the limit. It could go either way.`;
    }
    if (compare.caveat) comparison += ` (Estimate: ${compare.caveat}.)`;
  }

  let blind = '';
  if (blindLimit && blindLimit.status === 'ok') {
    blind = `Without being told where to look, the candidate list flags it above about ${formatFlux(blindLimit.flux_uJy)} µJy.`;
  } else if (blindLimit && blindLimit.status === 'above') {
    blind = `Without being told where to look, the candidate list flagged fewer than half of them at any brightness tried.`;
  }

  const caveat = 'This is a test of the tool, not a detection. "Recovered" means 5 sigma or more at the planted position, in a pass residual or in a stack along the true track, or a flag from the candidate list there: the best case for a search.';
  return { headline, comparison, blind, caveat };
}
