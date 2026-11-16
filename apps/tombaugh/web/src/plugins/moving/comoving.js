// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

// The co-moving pipeline: follow a solar-system body through SPHEREx exposures. Pure, no DOM.
//
// THE IDEA. Every exposure is a snapshot at a known time, and the body is somewhere else in
// each one. We are handed native frames, each cut out around where the body was at that
// exposure's time. Each frame is resampled onto a small north-up grid centred on ITS OWN body
// position; then all those layers are treated as if they shared one grid. In that shared
// grid the body sits still at the centre, and the stars, which really are still, land in a
// different place in every layer. A sigma-clipped stack keeps the body and rejects the stars.
//
// THE CO-MOVING GRID IS NOT A SKY GRID. Its pixels are offsets from the body: east is left,
// north is up, `scale` arcsec per pixel, the body at pixel ((n-1)/2, (n-1)/2). To make that
// impossible to miss, the common grid returned here has ra0 = 0 and dec0 = 0 and
// `comoving: true`: read through gridPixToSky, a pixel's "RA" and "Dec" are its east and north
// offsets from the body in degrees, not a place on the sky. (Each layer does carry the real
// grid it was resampled on, as `layer.grid`, and the body position as `layer.body`.)
//
// WHAT CLIPPING CAN AND CANNOT DO. A star is rejected at a pixel when it covers that pixel in
// a minority of the layers. That needs the body to have moved by more than a star's width
// between exposures. Within one visit a slow body (Sedna: under 1 arcsec per hour) barely
// moves from one exposure to the next, so stars along its path are only smeared, not removed;
// stacks over several visits, months apart, do much better. The star-fixed comparison stack
// shows the opposite case: stars sharp, body smeared along its track or doubled.
//
// Photometry is done on the NATIVE frames (core/photometry.js), never on resampled layers,
// because resampling correlates neighbouring pixels. The signal-to-noise of a stack is
// therefore measured empirically: the same aperture is dropped on many empty places of the
// stack and the scatter of those sums is the noise.

import { makeGrid } from '../../core/wcs.js';
import { reproject } from '../../core/reproject.js';
import { stackLayers, backgroundLevel, medianInPlace } from '../../core/stack.js';
import { aperturePhot, binSpectrum, MJYSR_TO_UJY_PER_PIX } from '../../core/photometry.js';
import { DETECTORS, splitPasses } from '../../core/frames.js';
import { robustStats } from '../../core/stretch.js';

export const NATIVE_PIXEL_ARCSEC = 6.15;
export const DEFAULT_SCALE_ARCSEC = 3.075;
export const DEFAULT_FOV_ARCMIN = 4;
export const VISIT_GAP_DAYS = 20;
/** The caption note every co-moving frame carries. */
export const COMOVING_NOTE = 'frame follows the body; stars streak';
export const STARFIXED_NOTE = 'frame fixed on the stars; the body moves';

/** Flag bits: 1 OVERFLOW and 15 NONLINEAR mean the pixel saturated; 21 SOURCE marks a known source. */
export const SATURATED_MASK = (1 << 1) | (1 << 15);
export const SOURCE_MASK = 1 << 21;

const MAD_TO_SIGMA = 1.4826;
const FWHM_TO_SIGMA = 1 / (2 * Math.sqrt(2 * Math.LN2));
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function abortError() {
  const err = new Error('Co-moving pipeline cancelled');
  err.name = 'AbortError';
  err.aborted = true;
  return err;
}

function nowMs() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}

/** Let the page breathe: resolves on the next macrotask; rejects if the signal was aborted. */
async function breathe(signal) {
  await new Promise((resolve) => setTimeout(resolve, 0));
  if (signal && signal.aborted) throw abortError();
}

function median(values) {
  const a = Float64Array.from(values);
  return medianInPlace(a, a.length);
}

// ---------------------------------------------------------------------------------------------
// Grids and layers
// ---------------------------------------------------------------------------------------------

/**
 * The common body-centred grid: { ra0: 0, dec0: 0, n, scale, comoving: true }.
 * Its "sky coordinates" are offsets from the body (see the top of this file). Pass `n` to
 * force a size (to match the shell's current grid); otherwise it is as large as makeGrid makes
 * a field of `fovArcmin`.
 */
export function comovingGrid(fovArcmin = DEFAULT_FOV_ARCMIN, scale = DEFAULT_SCALE_ARCSEC, n) {
  const g = makeGrid(0, 0, fovArcmin, scale);
  return { ra0: 0, dec0: 0, n: n > 0 ? Math.floor(n) : g.n, scale: g.scale, comoving: true };
}

/**
 * One co-moving layer: `frame` resampled onto a north-up grid centred on (ra, dec), the body's
 * position at that exposure. Returns a core Layer { frame, mjd, det, image, variance, wave, mask }
 * plus { body: { ra, dec }, grid (the real sky grid used), background (the sky level removed,
 * MJy/sr), coverage }. Zodiacal light is subtracted by reproject; `subtractBackground`
 * (default true) also removes the layer's own robust sky level, so that exposures at different
 * wavelengths, whose leftover backgrounds differ, can be clipped against each other.
 */
export function comovingLayer(frame, ra, dec, { fovArcmin = DEFAULT_FOV_ARCMIN, scale = DEFAULT_SCALE_ARCSEC, n, subtractBackground = true } = {}) {
  const grid = makeGrid(ra, dec, fovArcmin, scale);
  if (n > 0) grid.n = Math.floor(n);
  const layer = reproject(frame, grid, { subtractZodi: true });
  let background = 0;
  if (subtractBackground) {
    background = backgroundLevel(layer);
    if (background !== 0) {
      const img = layer.image;
      for (let i = 0; i < img.length; i++) img[i] -= background; // NaN stays NaN
    }
  }
  layer.body = { ra, dec };
  layer.grid = grid;
  layer.background = background;
  return layer;
}

/**
 * Build co-moving layers for many frames without freezing the page.
 *
 * items: [{ frame, ra, dec }] where (ra, dec) is the body's position at frame.mjd.
 * opts: fovArcmin, scale, n, subtractBackground (as comovingLayer), signal (AbortSignal),
 *       onProgress({ done, total, failed, phase: 'align' }).
 * Returns Promise<{ layers, failed, grid }>: layers in time order, `failed` = frames that could
 * not be resampled or have no usable pixel, grid = the common body-centred grid (comovingGrid).
 * Yields to the event loop whenever about 12 ms of work has piled up. Rejects with an
 * AbortError when the signal fires.
 */
export async function buildComovingLayers(items, opts = {}) {
  const { signal = null, onProgress = null } = opts;
  const total = items ? items.length : 0;
  const list = (items || []).filter((it) => it && it.frame && isNum(it.ra) && isNum(it.dec));
  const layers = [];
  let failed = total - list.length; // unusable entries count as done and failed from the start
  let last = nowMs();
  const report = (done) => {
    if (typeof onProgress !== 'function') return;
    try {
      onProgress({ done: done + (total - list.length), total, failed, phase: 'align' });
    } catch {
      // a broken progress handler must not stop the work
    }
  };
  for (let i = 0; i < list.length; i++) {
    if (signal && signal.aborted) throw abortError();
    try {
      const layer = comovingLayer(list[i].frame, list[i].ra, list[i].dec, opts);
      if (layer.coverage > 0 || layer.mask.some((m) => m === 0)) layers.push(layer);
      else failed++;
    } catch {
      failed++;
    }
    if (i + 1 < list.length && nowMs() - last >= 12) {
      report(i + 1);
      await breathe(signal);
      last = nowMs();
    }
  }
  layers.sort((a, b) => a.mjd - b.mjd);
  report(list.length);
  const n = layers.length ? Math.round(Math.sqrt(layers[0].image.length)) : undefined;
  return { layers, failed, grid: comovingGrid(opts.fovArcmin, opts.scale, opts.n || n) };
}

// ---------------------------------------------------------------------------------------------
// Stacks
// ---------------------------------------------------------------------------------------------

/**
 * Stack co-moving layers. 'wmean' with sigma clipping (default clip 3) rejects whatever is
 * present in a minority of layers at a pixel: the stars. 'median' does the same job without a
 * threshold and is the safer choice for fewer than about five layers.
 * Returns core stackLayers' { image, variance, count, mask } plus { n: number of layers, method, clip }.
 */
export function stackComoving(layers, { method = 'wmean', clip = 3 } = {}) {
  const list = layers || [];
  const stack = stackLayers(list, { method, clip });
  return { ...stack, n: list.length, method, clip };
}

function detBand(det) {
  const d = DETECTORS.find((x) => x.det === det);
  return d ? [d.min, d.max] : [NaN, NaN];
}

function describeGroup(layers) {
  let mjdStart = Infinity;
  let mjdEnd = -Infinity;
  let waveMin = Infinity;
  let waveMax = -Infinity;
  const mjds = [];
  const dets = new Set();
  for (const l of layers) {
    if (isNum(l.mjd)) {
      mjds.push(l.mjd);
      if (l.mjd < mjdStart) mjdStart = l.mjd;
      if (l.mjd > mjdEnd) mjdEnd = l.mjd;
    }
    const w = l.frame && isNum(l.frame.waveCenter) ? l.frame.waveCenter : NaN;
    if (isNum(w)) {
      if (w < waveMin) waveMin = w;
      if (w > waveMax) waveMax = w;
    }
    if (l.det >= 1 && l.det <= 6) dets.add(l.det);
  }
  return {
    n: layers.length,
    mjdStart: mjds.length ? mjdStart : NaN,
    mjdEnd: mjds.length ? mjdEnd : NaN,
    mjdMid: mjds.length ? median(mjds) : NaN,
    waveMin: waveMin <= waveMax ? waveMin : NaN,
    waveMax: waveMin <= waveMax ? waveMax : NaN,
    dets: [...dets].sort((a, b) => a - b),
  };
}

/**
 * Split co-moving layers by visit (gaps over `gapDays`, default 20) and detector.
 * Returns { visits: Layer[][], groups: [{ key: 'v0d3', visit, det, layers, n, mjdStart, mjdEnd,
 * mjdMid, waveMin, waveMax, band: [min, max] }] } with groups ordered by visit, then detector.
 */
export function groupComoving(layers, { gapDays = VISIT_GAP_DAYS } = {}) {
  const visits = splitPasses(layers || [], gapDays);
  const groups = [];
  visits.forEach((items, visit) => {
    for (let det = 1; det <= 6; det++) {
      const sel = items.filter((l) => l.det === det);
      if (!sel.length) continue;
      groups.push({ key: `v${visit}d${det}`, visit, det, layers: sel, band: detBand(det), ...describeGroup(sel) });
    }
  });
  return { visits, groups };
}

/**
 * Every stack the view needs, built cooperatively:
 *   groups  one per visit and detector (the movie frames), each with `stack` and `snr`
 *   visits  one per visit, all detectors together ("white light")
 *   dets    one per detector, all visits together
 *   deep    everything together: the deepest image, the one to quote a detection or a limit from
 * Each entry: { key, visit (index or -1), det (or 0), layers, n, mjdStart, mjdEnd, mjdMid,
 *               waveMin, waveMax, band, stack, snr } with snr = centralSnr(stack).
 * Stacks of fewer than `minClip` layers (default 5) use the median, because sigma clipping has
 * nothing to compare against; the rest use the clipped weighted mean.
 * opts: gapDays, clip (3), minClip (5), scale, psfFwhm, signal.
 */
export async function comovingStacks(layers, opts = {}) {
  const { gapDays = VISIT_GAP_DAYS, clip = 3, minClip = 5, signal = null } = opts;
  const list = layers || [];
  const scale = opts.scale || (list[0] && list[0].grid ? list[0].grid.scale : DEFAULT_SCALE_ARCSEC);
  const psfFwhm = opts.psfFwhm || median(list.map((l) => (l.frame && l.frame.psfFwhm > 0 ? l.frame.psfFwhm : 7.5))) || 7.5;
  const build = (entry) => {
    const method = entry.layers.length < minClip ? 'median' : 'wmean';
    const stack = stackComoving(entry.layers, { method, clip });
    const n = Math.round(Math.sqrt(stack.image.length));
    return { ...entry, stack, snr: centralSnr(stack, { n, scale, psfFwhm }) };
  };
  const { visits, groups } = groupComoving(list, { gapDays });
  const out = { groups: [], visits: [], dets: [], deep: null, scale, psfFwhm };
  for (const g of groups) {
    out.groups.push(build(g));
    await breathe(signal);
  }
  for (let v = 0; v < visits.length; v++) {
    out.visits.push(build({ key: `v${v}`, visit: v, det: 0, layers: visits[v], band: [0.75, 5.0], ...describeGroup(visits[v]) }));
    await breathe(signal);
  }
  for (let det = 1; det <= 6; det++) {
    const sel = list.filter((l) => l.det === det);
    if (!sel.length) continue;
    out.dets.push(build({ key: `d${det}`, visit: -1, det, layers: sel, band: detBand(det), ...describeGroup(sel) }));
    await breathe(signal);
  }
  if (list.length) out.deep = build({ key: 'deep', visit: -1, det: 0, layers: list, band: [0.75, 5.0], ...describeGroup(list) });
  return out;
}

/**
 * The comparison: the same exposures stacked on ONE fixed sky grid, as the ordinary movie does.
 * Stars are sharp; the body is smeared along its track, or doubled if the exposures cluster at
 * two times. No sigma clipping by default (clip = 0), because clipping would simply delete
 * the moving body, which is the thing we want to show smeared.
 *
 * items: [{ frame, ra, dec }] of one visit. opts: fovArcmin, scale, n, center ({ ra, dec };
 * default: the body's position at the median exposure time), clip, method, subtractBackground.
 * Returns { stack, grid, layers, track: [{ mjd, x, y }] (the body's grid pixel in every
 * exposure), trailPixels (length of that track in grid pixels), trailArcsec }.
 */
export function starFixedStack(items, { fovArcmin = DEFAULT_FOV_ARCMIN, scale = DEFAULT_SCALE_ARCSEC, n, center = null, clip = 0, method = 'wmean', subtractBackground = true } = {}) {
  const list = (items || []).filter((it) => it && it.frame && isNum(it.ra) && isNum(it.dec))
    .slice().sort((a, b) => a.frame.mjd - b.frame.mjd);
  let c = center;
  if (!c || !isNum(c.ra) || !isNum(c.dec)) {
    const mid = list[list.length >> 1];
    c = mid ? { ra: mid.ra, dec: mid.dec } : { ra: 0, dec: 0 };
  }
  const grid = makeGrid(c.ra, c.dec, fovArcmin, scale);
  if (n > 0) grid.n = Math.floor(n);
  const layers = [];
  const track = [];
  const half = (grid.n - 1) / 2;
  const k = 3600 / grid.scale;
  for (const it of list) {
    let layer;
    try {
      layer = reproject(it.frame, grid, { subtractZodi: true });
    } catch {
      continue;
    }
    if (subtractBackground) {
      const bg = backgroundLevel(layer);
      if (bg !== 0) for (let i = 0; i < layer.image.length; i++) layer.image[i] -= bg;
      layer.background = bg;
    }
    layers.push(layer);
    // Exact gnomonic offset of the body from the grid centre, in grid pixels.
    const d = it.dec * Math.PI / 180;
    const d0 = grid.dec0 * Math.PI / 180;
    const da = (it.ra - grid.ra0) * Math.PI / 180;
    const cosc = Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(da);
    const xi = (Math.cos(d) * Math.sin(da)) / cosc * 180 / Math.PI;
    const eta = (Math.cos(d0) * Math.sin(d) - Math.sin(d0) * Math.cos(d) * Math.cos(da)) / cosc * 180 / Math.PI;
    track.push({ mjd: it.frame.mjd, x: half - xi * k, y: half + eta * k });
  }
  let trailPixels = 0;
  if (track.length > 1) {
    // Extent of the track, not its summed length: exposures are not visited in spatial order
    // when the body reverses, and the extent is what the eye sees as the smear.
    let best = 0;
    for (let i = 0; i < track.length; i++) {
      for (let j = i + 1; j < track.length; j++) {
        const dd = Math.hypot(track[i].x - track[j].x, track[i].y - track[j].y);
        if (dd > best) best = dd;
      }
    }
    trailPixels = best;
  }
  const stack = stackLayers(layers, { method, clip });
  return { stack: { ...stack, n: layers.length, method, clip }, grid, layers, track, trailPixels, trailArcsec: trailPixels * grid.scale };
}

// ---------------------------------------------------------------------------------------------
// Signal-to-noise of the central source in a stack
// ---------------------------------------------------------------------------------------------

/**
 * FWHM in arcsec that a point source has in a stack of resampled layers: the optical PSF,
 * broadened by the 6.15 arcsec detector pixel (a box: variance w^2/12) and by bilinear
 * resampling between native pixels (on average a further w^2/6). For the measured PSF of 7.5
 * arcsec this gives 10.4 arcsec.
 */
export function expectedStackFwhm(psfFwhm = 7.5) {
  const pix2 = NATIVE_PIXEL_ARCSEC * NATIVE_PIXEL_ARCSEC;
  const f = psfFwhm > 0 && Number.isFinite(psfFwhm) ? psfFwhm : 7.5;
  return Math.sqrt(f * f + 8 * Math.LN2 * pix2 * (1 / 12 + 1 / 6));
}

/** Aperture weights (3 x 3 sub-pixel edges) for a circle of radius r around a fractional centre. */
function apertureTemplate(r, fracX, fracY) {
  const cells = [];
  const R = Math.ceil(r + 1);
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      let inside = 0;
      for (let sy = 0; sy < 3; sy++) {
        const yy = dy + (sy + 0.5) / 3 - 0.5 - fracY;
        for (let sx = 0; sx < 3; sx++) {
          const xx = dx + (sx + 0.5) / 3 - 0.5 - fracX;
          if (xx * xx + yy * yy <= r * r) inside++;
        }
      }
      if (inside) cells.push([dx, dy, inside / 9]);
    }
  }
  return cells;
}

/**
 * Signal-to-noise of the source at the centre of a stack (or at x0, y0).
 *
 *   signal  sum over a circular aperture of radius rArcsec (default 9.84 = 1.6 native pixels)
 *           of (image - background), background = median of an annulus (3.5 to 7 native pixels)
 *   noise   the same aperture dropped on a lattice of other places in the image; the noise is
 *           1.4826 x the median absolute deviation of those sums. This is honest about the
 *           correlated noise that resampling creates and about leftover stars. With fewer than
 *           eight usable places it falls back to the propagated variance, scaled up for the
 *           correlation ('variance' in `method`).
 *
 * Returns { snr, flux_uJy, err_uJy, limit3_uJy (3 x err: the upper limit to quote when nothing
 * is there), net (MJy/sr x grid pixels), noise, background, peak (MJy/sr above background),
 * dx_arcsec, dy_arcsec (flux-weighted centroid offset from the centre; east and north positive),
 * nRef, method, apcor, ok }.
 * flux_uJy assumes a point source: it is divided by the fraction of a Gaussian of the expected
 * stack FWHM (expectedStackFwhm(psfFwhm)) that falls inside the aperture.
 * ok is false when the aperture is not fully on unmasked pixels; snr is then NaN.
 */
export function centralSnr(stack, opts = {}) {
  const image = stack && stack.image;
  const bad = { snr: NaN, flux_uJy: NaN, err_uJy: NaN, limit3_uJy: NaN, net: NaN, noise: NaN, background: NaN, peak: NaN, dx_arcsec: NaN, dy_arcsec: NaN, nRef: 0, method: 'none', apcor: NaN, ok: false };
  if (!image || !image.length) return bad;
  const n = opts.n > 0 ? opts.n : Math.round(Math.sqrt(image.length));
  if (n * n !== image.length) return bad;
  const scale = opts.scale > 0 ? opts.scale : DEFAULT_SCALE_ARCSEC;
  const mask = stack.mask || null;
  const variance = stack.variance || null;
  const cx = isNum(opts.x0) ? opts.x0 : (n - 1) / 2;
  const cy = isNum(opts.y0) ? opts.y0 : (n - 1) / 2;
  const r = (opts.rArcsec > 0 ? opts.rArcsec : 1.6 * NATIVE_PIXEL_ARCSEC) / scale;
  const rIn = (opts.rInArcsec > 0 ? opts.rInArcsec : 3.5 * NATIVE_PIXEL_ARCSEC) / scale;
  const rOut = Math.min((opts.rOutArcsec > 0 ? opts.rOutArcsec : 7 * NATIVE_PIXEL_ARCSEC) / scale, n / 2 - 1);
  const usable = (i) => (mask === null || mask[i] === 0) && image[i] - image[i] === 0;

  // Background: clipped median of the annulus.
  const ann = [];
  const x0 = Math.max(0, Math.floor(cx - rOut));
  const x1 = Math.min(n - 1, Math.ceil(cx + rOut));
  const y0 = Math.max(0, Math.floor(cy - rOut));
  const y1 = Math.min(n - 1, Math.ceil(cy + rOut));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      if (d2 < rIn * rIn || d2 > rOut * rOut) continue;
      const i = y * n + x;
      if (usable(i)) ann.push(image[i]);
    }
  }
  let background = 0;
  if (ann.length >= 5) {
    let vals = Float64Array.from(ann);
    for (let round = 0; round < 4; round++) {
      const buf = Float64Array.from(vals);
      const med = medianInPlace(buf, buf.length);
      const dev = Float64Array.from(vals, (v) => Math.abs(v - med));
      const lim = 3 * MAD_TO_SIGMA * medianInPlace(dev, dev.length);
      background = med;
      const kept = vals.filter((v) => Math.abs(v - med) <= lim);
      if (!(lim > 0) || kept.length === vals.length || kept.length < 5) break;
      vals = kept;
    }
  }

  // Aperture sum at an arbitrary centre; null when any aperture pixel is unusable.
  const ix = Math.round(cx);
  const iy = Math.round(cy);
  const template = apertureTemplate(r, cx - ix, cy - iy);
  let area = 0;
  for (const c of template) area += c[2];
  const sumAt = (px, py) => {
    let s = 0;
    for (const [dx, dy, w] of template) {
      const x = px + dx;
      const y = py + dy;
      if (x < 0 || y < 0 || x >= n || y >= n) return null;
      const i = y * n + x;
      if (!usable(i)) return null;
      s += w * image[i];
    }
    return s;
  };
  const raw = sumAt(ix, iy);
  if (raw === null) return { ...bad, background };

  // Reference apertures on a lattice, clear of the source.
  const step = Math.max(2, Math.ceil(2 * r));
  const keepOut = Math.max(rIn, 2.5 * r);
  const refs = [];
  for (let py = iy % step; py < n; py += step) {
    for (let px = ix % step; px < n; px += step) {
      if (Math.hypot(px - ix, py - iy) < keepOut) continue;
      const s = sumAt(px, py);
      if (s !== null) refs.push(s);
    }
  }
  let noise;
  let method;
  let offset = background * area;
  if (refs.length >= 8) {
    const buf = Float64Array.from(refs);
    const med = medianInPlace(buf, buf.length);
    const dev = Float64Array.from(refs, (v) => Math.abs(v - med));
    noise = MAD_TO_SIGMA * medianInPlace(dev, dev.length);
    offset = med; // the typical sum of an empty aperture: a better zero point than the annulus
    method = 'empirical';
  } else {
    let vs = 0;
    for (const [dx, dy, w] of template) {
      const v = variance ? variance[(iy + dy) * n + ix + dx] : NaN;
      vs += w * w * (v > 0 && Number.isFinite(v) ? v : 0);
    }
    // Neighbouring grid pixels share native pixels: a sum over an aperture has about
    // (native pixel / grid pixel) times the naive error.
    noise = Math.sqrt(vs) * Math.max(1, NATIVE_PIXEL_ARCSEC / scale);
    method = 'variance';
  }
  const net = raw - offset;

  // Peak and centroid inside the aperture.
  let peak = -Infinity;
  let sw = 0;
  let swx = 0;
  let swy = 0;
  const level = offset / area;
  for (const [dx, dy, w] of template) {
    const v = image[(iy + dy) * n + ix + dx] - level;
    if (v > peak) peak = v;
    if (v > 0) {
      sw += w * v;
      swx += w * v * (ix + dx);
      swy += w * v * (iy + dy);
    }
  }
  const sigmaStack = expectedStackFwhm(opts.psfFwhm) * FWHM_TO_SIGMA / scale; // grid pixels
  const apcor = 1 - Math.exp(-(r * r) / (2 * sigmaStack * sigmaStack));
  const conv = MJYSR_TO_UJY_PER_PIX * (scale / NATIVE_PIXEL_ARCSEC) ** 2 / apcor;
  return {
    snr: noise > 0 ? net / noise : NaN,
    flux_uJy: net * conv,
    err_uJy: noise * conv,
    limit3_uJy: 3 * noise * conv,
    net,
    noise,
    background: level,
    peak,
    dx_arcsec: sw > 0 ? -(swx / sw - cx) * scale : NaN, // east is toward smaller x
    dy_arcsec: sw > 0 ? (swy / sw - cy) * scale : NaN,
    nRef: refs.length,
    method,
    apcor,
    ok: true,
  };
}

// ---------------------------------------------------------------------------------------------
// Radial profile and extendedness (for comets)
// ---------------------------------------------------------------------------------------------

/**
 * Azimuthally averaged profile of a stack around its centre.
 * Returns [{ r (arcsec, mean radius of the ring), value (MJy/sr above the background), err
 * (standard error of that mean from the scatter in the ring), noise (what the sky alone would
 * give for a ring of that many pixels), npix }], rings `binArcsec` wide (default: one grid
 * pixel) out to rMaxArcsec (default 45). The background level and the sky noise per pixel come
 * from the pixels beyond `bgInnerArcsec` (default 50) out to the edge of the image; a coma that
 * still has light out there is underestimated.
 */
export function radialProfile(stack, { n, scale = DEFAULT_SCALE_ARCSEC, rMaxArcsec = 45, binArcsec, bgInnerArcsec = 50, x0, y0 } = {}) {
  const image = stack && stack.image;
  if (!image || !image.length) return [];
  const size = n > 0 ? n : Math.round(Math.sqrt(image.length));
  const mask = stack.mask || null;
  const cx = isNum(x0) ? x0 : (size - 1) / 2;
  const cy = isNum(y0) ? y0 : (size - 1) / 2;
  const bin = (binArcsec > 0 ? binArcsec : scale) / scale;
  const rMax = Math.min(rMaxArcsec / scale, size / 2);
  const bgIn = Math.min(bgInnerArcsec / scale, size / 2 - 2);
  const nb = Math.max(1, Math.ceil(rMax / bin));
  const sum = new Float64Array(nb);
  const sum2 = new Float64Array(nb);
  const sumR = new Float64Array(nb);
  const cnt = new Uint32Array(nb);
  const bg = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const v = image[i];
      if ((mask !== null && mask[i] !== 0) || v - v !== 0) continue;
      const d = Math.hypot(x - cx, y - cy);
      if (d >= bgIn) bg.push(v);
      const b = Math.floor(d / bin);
      if (b >= nb) continue;
      sum[b] += v;
      sum2[b] += v * v;
      sumR[b] += d;
      cnt[b]++;
    }
  }
  const level = bg.length ? median(bg) : 0;
  const sigmaPix = bg.length > 4 ? MAD_TO_SIGMA * median(bg.map((v) => Math.abs(v - level))) : NaN;
  // Resampled pixels are not independent: about (native / grid)^2 of them share one native pixel.
  const perSample = Math.max(1, (NATIVE_PIXEL_ARCSEC / scale) ** 2);
  const out = [];
  for (let b = 0; b < nb; b++) {
    if (!cnt[b]) continue;
    const mean = sum[b] / cnt[b];
    const varr = Math.max(0, sum2[b] / cnt[b] - mean * mean);
    out.push({
      r: (sumR[b] / cnt[b]) * scale,
      value: mean - level,
      err: cnt[b] > 1 ? Math.sqrt(varr / (cnt[b] - 1)) : NaN,
      noise: sigmaPix / Math.sqrt(Math.max(1, cnt[b] / perSample)),
      npix: cnt[b],
    });
  }
  return out;
}

/**
 * Is the central source wider than a star?
 *
 * Two measurements from the radial profile, each compared with what a point source would give
 * in a stack (a Gaussian of expectedStackFwhm(psfFwhm)):
 *   fwhm    twice the radius where the profile falls to half its central value
 *   growth  flux inside 3 native pixels divided by flux inside 1.5 native pixels (a coma keeps
 *           growing with aperture; a star has almost all its light inside the smaller one)
 * `extended` is true when either exceeds its point-source value by `factor` (default 1.3) and
 * the central pixel stands at least `minSnr` (default 5) above the sky noise.
 *
 * Returns { extended, fwhm_arcsec, expected_arcsec, ratio, growth, expectedGrowth, growthRatio,
 * peak, peakSnr, measurable }. measurable = false means the source is too faint to say.
 */
export function extendedness(profile, { psfFwhm = 7.5, factor = 1.3, minSnr = 5 } = {}) {
  const expected = expectedStackFwhm(psfFwhm);
  const none = { extended: false, fwhm_arcsec: NaN, expected_arcsec: expected, ratio: NaN, growth: NaN, expectedGrowth: NaN, growthRatio: NaN, peak: NaN, peakSnr: NaN, measurable: false };
  if (!Array.isArray(profile) || profile.length < 4) return none;
  const peak = profile[0].value;
  const peakSigma = profile[0].noise;
  const peakSnr = peakSigma > 0 ? peak / peakSigma : peak > 0 ? Infinity : 0;
  if (!(peak > 0) || !(peakSnr >= minSnr)) return { ...none, peak, peakSnr };

  let rHalf = NaN;
  for (let i = 1; i < profile.length; i++) {
    if (profile[i].value <= peak / 2) {
      const a = profile[i - 1];
      const b = profile[i];
      const t = a.value === b.value ? 0 : (a.value - peak / 2) / (a.value - b.value);
      rHalf = a.r + t * (b.r - a.r);
      break;
    }
  }
  if (!isNum(rHalf)) rHalf = profile[profile.length - 1].r; // never drops to half: very wide

  // Curve of growth from the profile: sum of ring mean x ring area.
  const fluxWithin = (rLim) => {
    let s = 0;
    for (const p of profile) if (p.r <= rLim) s += p.value * p.npix;
    return s;
  };
  const r1 = 1.5 * NATIVE_PIXEL_ARCSEC;
  const r2 = 3 * NATIVE_PIXEL_ARCSEC;
  const f1 = fluxWithin(r1);
  const f2 = fluxWithin(r2);
  const growth = f1 > 0 ? f2 / f1 : NaN;
  const s = expected * FWHM_TO_SIGMA;
  const g = (rr) => 1 - Math.exp(-(rr * rr) / (2 * s * s));
  const expectedGrowth = g(r2) / g(r1);
  const fwhm = 2 * rHalf;
  const ratio = fwhm / expected;
  const growthRatio = growth / expectedGrowth;
  return {
    extended: ratio >= factor || growthRatio >= factor,
    fwhm_arcsec: fwhm,
    expected_arcsec: expected,
    ratio,
    growth,
    expectedGrowth,
    growthRatio,
    peak,
    peakSnr,
    measurable: true,
  };
}

// ---------------------------------------------------------------------------------------------
// Spectrum of the body
// ---------------------------------------------------------------------------------------------

/** True when any pixel within `radius` of (x, y) on the frame has one of `bits` set. */
function flagNear(frame, x, y, radius, bits) {
  const flags = frame.flags;
  if (!flags || !isNum(x) || !isNum(y)) return false;
  const { nx, ny } = frame;
  const xa = Math.max(0, Math.floor(x - radius));
  const xb = Math.min(nx - 1, Math.ceil(x + radius));
  const ya = Math.max(0, Math.floor(y - radius));
  const yb = Math.min(ny - 1, Math.ceil(y + radius));
  for (let py = ya; py <= yb; py++) {
    for (let px = xa; px <= xb; px++) {
      if ((px - x) * (px - x) + (py - y) * (py - y) > radius * radius) continue;
      if ((flags[py * nx + px] & bits) !== 0) return true;
    }
  }
  return false;
}

/**
 * Spectrum of the body: aperture photometry on every NATIVE frame at the body's position in
 * that frame, one point per exposure, then binned by spectral channel across all six detectors.
 *
 * Quality cut. A point is left out of the binned spectrum when
 *   'off-frame'  the aperture is not entirely on the cutout
 *   'saturated'  a pixel within the aperture has the OVERFLOW or NONLINEAR flag
 *   'flagged'    a pixel within the aperture has another bad flag or is not finite
 *   'star'       a background star sits within about 2 pixels of the body in that exposure.
 *                Found two ways: (a) the pipeline's SOURCE flag (a pixel mapped to a known
 *                catalogue source; the body itself is not in that catalogue) within 2 pixels
 *                of the body, used only when it marks fewer than half of the frames (in a
 *                crowded field it marks nearly everything and says nothing); (b) the flux
 *                stands more than `starSigma` (default 4) robust sigma above the frames
 *                nearest in wavelength on the same detector. Comparing with neighbours in
 *                wavelength, not with the whole set, keeps a real absorption band from being
 *                mistaken for bad frames: a band is shared by every exposure at that colour.
 *   'outlier'    the same test, but too faint (a bad pixel or a star in the sky annulus)
 *
 * items: [{ frame, ra, dec }]. opts: starSigma (4), window (8 neighbours), useSourceFlag (true),
 * starRadius (2 native pixels), phot (options for core aperturePhot).
 * Returns { points (every exposure, sorted by wavelength, each with `rejected`: null or the
 * reason), kept, binned (core binSpectrum of the kept points, per channel), perDet (the same,
 * one point per detector), counts: { total, used, offFrame, saturated, flagged, star, outlier },
 * sourceFlagUsed }.
 */
export function bodySpectrum(items, opts = {}) {
  const { starSigma = 4, window = 8, useSourceFlag = true, starRadius = 2, phot = {} } = opts;
  const rPix = phot.rPix > 0 ? phot.rPix : 1.6;
  const points = [];
  const counts = { total: 0, used: 0, offFrame: 0, saturated: 0, flagged: 0, star: 0, outlier: 0 };
  for (const it of items || []) {
    if (!it || !it.frame) continue;
    counts.total++;
    const p = aperturePhot(it.frame, it.ra, it.dec, phot);
    p.rejected = null;
    p.sourceNear = false;
    if (!p.ok) {
      p.rejected = 'off-frame';
    } else if (flagNear(it.frame, p.x, p.y, rPix + 0.5, SATURATED_MASK)) {
      p.rejected = 'saturated';
    } else if (p.flagged || !isNum(p.flux_uJy) || !(p.err_uJy > 0)) {
      p.rejected = 'flagged';
    } else {
      p.sourceNear = flagNear(it.frame, p.x, p.y, starRadius, SOURCE_MASK);
    }
    points.push(p);
  }

  // (a) SOURCE flag near the body, if it discriminates.
  const good = points.filter((p) => !p.rejected);
  const nearCount = good.filter((p) => p.sourceNear).length;
  const sourceFlagUsed = useSourceFlag && nearCount > 0 && nearCount < good.length / 2;
  if (sourceFlagUsed) for (const p of good) if (p.sourceNear) p.rejected = 'star';

  // (b) Robust comparison with the exposures nearest in wavelength, per detector.
  for (let det = 1; det <= 6; det++) {
    const sel = points.filter((p) => !p.rejected && p.det === det).sort((a, b) => a.wave - b.wave);
    if (sel.length < 6) continue;
    const resid = new Float64Array(sel.length);
    const half = Math.max(2, Math.floor(window / 2));
    for (let i = 0; i < sel.length; i++) {
      let a = Math.max(0, i - half);
      let b = Math.min(sel.length - 1, i + half);
      // keep the window full near the ends
      if (b - a < 2 * half) {
        if (a === 0) b = Math.min(sel.length - 1, a + 2 * half);
        else a = Math.max(0, b - 2 * half);
      }
      const near = [];
      for (let j = a; j <= b; j++) if (j !== i) near.push(sel[j].flux_uJy);
      resid[i] = sel[i].flux_uJy - median(near);
    }
    const center = median(resid);
    const scatter = MAD_TO_SIGMA * median(Array.from(resid, (v) => Math.abs(v - center)));
    for (let i = 0; i < sel.length; i++) {
      const sigma = Math.max(scatter, sel[i].err_uJy);
      if (!(sigma > 0)) continue;
      const z = (resid[i] - center) / sigma;
      if (z > starSigma) sel[i].rejected = 'star';
      else if (z < -starSigma) sel[i].rejected = 'outlier';
    }
  }

  for (const p of points) {
    if (!p.rejected) counts.used++;
    else if (p.rejected === 'off-frame') counts.offFrame++;
    else counts[p.rejected]++;
  }
  points.sort((a, b) => (isNum(a.wave) ? a.wave : Infinity) - (isNum(b.wave) ? b.wave : Infinity));
  const kept = points.filter((p) => !p.rejected);
  return {
    points,
    kept,
    binned: binSpectrum(kept, { perChannel: true }),
    perDet: binSpectrum(kept, { perChannel: false }),
    counts,
    sourceFlagUsed,
  };
}

/**
 * Depth of an absorption (or strength of an emission) band in a binned spectrum:
 * 1 - (mean flux within `halfWidth` of `wave`) / (mean flux in the two flanks, 1.5 to 4 half
 * widths away on either side). Positive = absorption, negative = emission.
 * Returns { depth, err, band_uJy, continuum_uJy, nBand, nContinuum } or null when either part
 * has no points.
 */
export function bandDepth(binned, wave, halfWidth = 0.12) {
  const inBand = [];
  const cont = [];
  for (const p of binned || []) {
    if (!p || !isNum(p.flux_uJy) || !isNum(p.wave)) continue;
    const d = Math.abs(p.wave - wave);
    if (d <= halfWidth) inBand.push(p);
    else if (d >= 1.5 * halfWidth && d <= 4 * halfWidth) cont.push(p);
  }
  if (!inBand.length || !cont.length) return null;
  const wmean = (list) => {
    let sw = 0;
    let s = 0;
    for (const p of list) {
      const w = p.err_uJy > 0 ? 1 / (p.err_uJy * p.err_uJy) : 1;
      sw += w;
      s += w * p.flux_uJy;
    }
    return { mean: s / sw, err: Math.sqrt(1 / sw) };
  };
  const b = wmean(inBand);
  const c = wmean(cont);
  if (!(c.mean !== 0)) return null;
  const depth = 1 - b.mean / c.mean;
  const err = Math.abs(b.mean / c.mean) * Math.hypot(b.err / (b.mean || 1), c.err / c.mean);
  return { depth, err, band_uJy: b.mean, continuum_uJy: c.mean, nBand: inBand.length, nContinuum: cont.length };
}

// ---------------------------------------------------------------------------------------------
// Movie frames
// ---------------------------------------------------------------------------------------------

/** Display range for a stack: sky noise at the bottom, the central source inside the top. */
export function stackRange(stack) {
  const st = robustStats(stack.image, stack.mask);
  if (!isNum(st.median) || !isNum(st.sigma)) return [0, 1];
  const sigma = st.sigma > 0 ? st.sigma : Math.max(Math.abs(st.median) * 1e-3, 1e-6);
  const n = Math.round(Math.sqrt(stack.image.length));
  let top = st.median + 12 * sigma;
  // Let the central source set the top if it is brighter, so a bright body is not burnt out.
  const c = Math.floor((n - 1) / 2);
  for (let y = c - 2; y <= c + 3; y++) {
    for (let x = c - 2; x <= c + 3; x++) {
      if (x < 0 || y < 0 || x >= n || y >= n) continue;
      const v = stack.image[y * n + x];
      if (v - v === 0 && v > top) top = v;
    }
  }
  return [st.median - 2 * sigma, top];
}

function fmtBand(band) {
  return isNum(band[0]) && isNum(band[1]) ? `${band[0].toFixed(2)}-${band[1].toFixed(2)} um` : '';
}

/**
 * Turn stack entries (comovingStacks().groups or similar) into the shell's MovieFrame objects:
 * { image, mask, range, caption: { title, date, wave, note }, mjd, key, comoving: true }.
 * The caption carries the body name, the date range, the detector band, the number of
 * exposures, and the note "frame follows the body; stars streak".
 * opts: name, visitCount (for "visit 2 of 3"), dateLabel(mjdA, mjdB) -> string, note.
 */
export function movieFrames(entries, { name = 'Body', visitCount = 0, dateLabel = null, note = COMOVING_NOTE } = {}) {
  const frames = [];
  for (const e of entries || []) {
    if (!e || !e.stack || !e.stack.image) continue;
    const label = e.det >= 1 ? `D${e.det} ${fmtBand(e.band)}` : `all detectors ${fmtBand(e.band)}`;
    const count = `${e.n} ${e.n === 1 ? 'exposure' : 'exposures'}`;
    const visit = e.visit >= 0 && visitCount > 1 ? ` · visit ${e.visit + 1} of ${visitCount}` : '';
    const date = typeof dateLabel === 'function' ? dateLabel(e.mjdStart, e.mjdEnd) : '';
    frames.push({
      image: e.stack.image,
      mask: e.stack.mask,
      range: stackRange(e.stack),
      caption: { title: `${name}${visit}`, date, wave: `${label} · ${count}`, note },
      short: e.det >= 1 ? `D${e.det}` : 'all',
      mjd: e.mjdMid,
      pass: e.visit >= 0 ? e.visit : 0,
      key: e.key,
      comoving: true,
      // the wavelengths in this stack, for the shell's wavelength ruler
      ...(Array.isArray(e.band) && e.band.length === 2 && e.band.every(isNum) ? { band: [e.band[0], e.band[1]] } : {}),
    });
  }
  return frames;
}

// ---------------------------------------------------------------------------------------------
// What to tell the user
// ---------------------------------------------------------------------------------------------

function fmtFlux(uJy) {
  if (!isNum(uJy)) return 'unknown';
  const a = Math.abs(uJy);
  if (a >= 1e6) return `${(uJy / 1e6).toPrecision(3)} Jy`;
  if (a >= 1000) return `${(uJy / 1000).toPrecision(3)} mJy`;
  return `${a >= 100 ? uJy.toFixed(0) : a >= 10 ? uJy.toFixed(0) : uJy.toFixed(1)} microJy`;
}

/** Median signal-to-noise per exposure of the points kept in a spectrum; NaN when there are none. */
export function singleExposureSnr(spectrum) {
  const kept = spectrum && Array.isArray(spectrum.kept) ? spectrum.kept : [];
  const v = kept.filter((p) => isNum(p.flux_uJy) && p.err_uJy > 0).map((p) => p.flux_uJy / p.err_uJy);
  return v.length ? median(v) : NaN;
}

/**
 * The honest summary of a run, as short sentences: [{ kind: 'ok' | 'info' | 'warn', text }].
 *
 *   name          the body
 *   planned       how many exposures contained it; loaded: how many were downloaded
 *   deep          the entry of the deepest stack (comovingStacks().deep), or null
 *   spectrum      the result of bodySpectrum, or null
 *   ext           the result of extendedness for a body that may have a coma, or null
 *   hypothetical  true for a body that is not known to exist: the wording never claims a
 *                 detection, and the upper limit is always given
 *
 * Thresholds: a source needs S/N 5 in the stack to be called detected; between 3 and 5 it is a
 * hint; a body counts as visible in single exposures from a median S/N of 5 per exposure.
 */
export function verdict({ name = 'This body', planned = 0, loaded = 0, deep = null, spectrum = null, ext = null, hypothetical = false } = {}) {
  const out = [];
  if (hypothetical) {
    out.push({ kind: 'warn', text: 'This is a search for something not known to exist. Nothing here is a detection of a new body.' });
  }
  if (!(planned > 0)) {
    out.push({ kind: 'info', text: hypothetical ? 'No SPHEREx exposure contained the predicted track.' : 'No SPHEREx exposure contained this body.' });
    return out;
  }
  if (!(loaded > 0) || !deep || !deep.snr || !deep.snr.ok) {
    out.push({ kind: 'warn', text: loaded > 0 ? 'The exposures were loaded, but the body falls on unusable pixels in the stack.' : `None of the ${planned} exposures could be loaded.` });
    return out;
  }
  const s = deep.snr;
  const snr = s.snr;
  const snrText = isNum(snr) ? (Math.abs(snr) >= 100 ? snr.toFixed(0) : snr.toFixed(1)) : 'unknown';
  const limit = `3-sigma upper limit ${fmtFlux(s.limit3_uJy)} for a point source, averaged over the ${deep.dets && deep.dets.length === 1 ? 'detector' : 'detectors'} loaded`;
  const single = singleExposureSnr(spectrum);
  const counts = spectrum ? spectrum.counts : null;

  if (hypothetical) {
    if (snr >= 5) {
      out.push({ kind: 'info', text: `The stack of ${deep.n} exposures has S/N ${snrText} at the predicted position (${fmtFlux(s.flux_uJy)}). That is not a discovery: a faint star or galaxy lying on the track looks the same. Check each visit and detector separately.` });
    } else {
      out.push({ kind: 'info', text: `Nothing at the predicted position: the stack of ${deep.n} exposures has S/N ${snrText} there. ${limit[0].toUpperCase()}${limit.slice(1)}.` });
    }
  } else if (snr >= 5 && single >= 5) {
    out.push({ kind: 'ok', text: `${name} is visible in single exposures (typical S/N ${single.toFixed(0)}); the stack of ${deep.n} reaches S/N ${snrText}.` });
  } else if (snr >= 5) {
    out.push({ kind: 'ok', text: `${name} is too faint for single exposures${isNum(single) ? ` (typical S/N ${single.toFixed(1)})` : ''}; the stack of ${deep.n} reaches S/N ${snrText}.` });
  } else if (snr >= 3) {
    out.push({ kind: 'info', text: `${name} is too faint for single exposures; the stack reaches S/N ${snrText}. That is a hint, not a detection.` });
  } else {
    out.push({ kind: 'info', text: `${name} is not detected: the stack of ${deep.n} exposures reaches S/N ${snrText} at its position. ${limit[0].toUpperCase()}${limit.slice(1)}.` });
  }

  if (counts) {
    if (counts.saturated > 0) {
      out.push({ kind: 'warn', text: `Saturated in ${counts.saturated} ${counts.saturated === 1 ? 'frame' : 'frames'}; ${counts.saturated === 1 ? 'it is' : 'they are'} left out of the spectrum.` });
    }
    if (counts.star > 0) {
      out.push({ kind: 'info', text: `${counts.star} ${counts.star === 1 ? 'exposure' : 'exposures'} left out of the spectrum because a background star sat within two pixels of the body.` });
    }
    const other = counts.flagged + counts.outlier + counts.offFrame;
    if (other > 0) {
      out.push({ kind: 'info', text: `${other} more left out for flagged pixels or because the body was at the edge of the detector.` });
    }
  }
  if (ext && ext.measurable && snr >= 5) {
    out.push(ext.extended
      ? { kind: 'ok', text: `Wider than a star: ${ext.fwhm_arcsec.toFixed(0)} arcsec across at half maximum, where a point source gives ${ext.expected_arcsec.toFixed(1)}.` }
      : { kind: 'info', text: `As sharp as a star: ${ext.fwhm_arcsec.toFixed(1)} arcsec across at half maximum (a point source gives ${ext.expected_arcsec.toFixed(1)}). No coma at this depth.` });
  }
  return out;
}
