// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// fieldstars.js - what the ordinary stars of a field say about the measurement chain.
//
// Two tests that need no famous target:
//
//   alignment  Every usable Gaia star is centroided in every per-pass stack and compared with
//              where Gaia says it should be on that date. The median offset and its scatter
//              are the astrometric accuracy of the whole chain: the frame WCS, the reprojection
//              onto the grid, the stacking and the centroiding.
//   null test  The same centroids give a proper motion per star. Stars that Gaia says move less
//              than 50 mas/yr must come out consistent with zero. The scatter of their measured
//              motions is the empirical error of a proper motion in this field.
//
// Pure functions: no DOM, no network. Offsets are arcsec, east and north positive; proper
// motions are mas/yr; pixels are grid pixels (0-based, x towards west, y towards north).

import {
  propagate, centroid, fitMotion, tangentOffset,
} from '../../core/astrometry.js';
import { gridSkyToPix, gridPixToSky } from '../../core/wcs.js';
import { splitPasses, medianMjd, passLabel } from '../../core/frames.js';
import { stackLayers, normalizeBackground } from '../../core/stack.js';

/** One SPHEREx pixel, arcsec. */
export const NATIVE_PIXEL_ARCSEC = 6.15;
/** Stars with a Gaia proper motion below this (mas/yr) are "not moving" for the null test. */
export const LOW_PM_LIMIT = 50;
/** Epoch of Gaia DR3 positions (Julian year). */
export const GAIA_EPOCH = 2016.0;

const CORE = {
  propagate, centroid, fitMotion, tangentOffset, gridSkyToPix, gridPixToSky,
  splitPasses, medianMjd, passLabel, stackLayers, normalizeBackground,
};

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Median of the finite values (NaN if there are none). */
export function median(values) {
  const a = [];
  for (const v of values || []) if (isNum(v)) a.push(v);
  if (!a.length) return NaN;
  a.sort((p, q) => p - q);
  const h = a.length >> 1;
  return a.length % 2 ? a[h] : 0.5 * (a[h - 1] + a[h]);
}

/** Robust scatter: 1.4826 x median absolute deviation, the Gaussian-equivalent sigma. */
export function robustSigma(values) {
  const m = median(values);
  if (!isNum(m)) return NaN;
  const dev = [];
  for (const v of values || []) if (isNum(v)) dev.push(Math.abs(v - m));
  return 1.4826 * median(dev);
}

/**
 * One stack per survey pass from the layers of ONE detector.
 * Each layer has its own sky level removed first (stack.js normalizeBackground), then the pass
 * is combined with a sigma-clipped inverse-variance mean.
 * Returns [{ index, label, mjd, mjdMin, mjdMax, nExposures, det, image, variance, mask, count }]
 * in time order; `mjd` is the median date of the pass.
 */
export function buildPassStacks(layers, opts = {}) {
  const L = { ...CORE, ...(opts.lib || {}) };
  const { gapDays = 45, clip = 3, normalize = true } = opts;
  const passes = L.splitPasses(layers || [], gapDays);
  return passes.map((pass, index) => {
    const list = normalize ? L.normalizeBackground(pass) : pass;
    const st = L.stackLayers(list, { method: 'wmean', clip });
    let lo = Infinity;
    let hi = -Infinity;
    for (const l of pass) {
      if (l.mjd < lo) lo = l.mjd;
      if (l.mjd > hi) hi = l.mjd;
    }
    return {
      index, label: L.passLabel(pass), mjd: L.medianMjd(pass), mjdMin: lo, mjdMax: hi,
      nExposures: pass.length, det: pass[0] ? pass[0].det : 0,
      image: st.image, variance: st.variance, mask: st.mask, count: st.count,
    };
  });
}

function starList(stars) {
  if (Array.isArray(stars)) return stars;
  if (stars && Array.isArray(stars.stars)) return stars.stars;
  return [];
}

/**
 * Choose the reference stars of a field.
 *
 * A star is usable when
 *   - it has a position, and at the middle date of the passes it lies on the grid at least
 *     `marginPix` grid pixels from the edge (room for the centroid window);
 *   - it is isolated: no other catalogue star within `isolationArcsec` (default three SPHEREx
 *     pixels, 18.45 arcsec) that is brighter than it, or fainter by less than `contrastMag`
 *     magnitudes (default 1: a neighbour with over 40 percent of its light would pull the
 *     centroid). A neighbour of unknown brightness counts as a hazard.
 * Whether it is bright enough and unflagged is decided per pass by measureFieldStars, from the
 * image itself. The brightest `maxStars` survivors are kept.
 *
 * @param {object} grid  { ra0, dec0, n, scale }
 * @param {Array|{stars:Array}} stars  Gaia stars { id, ra, dec, pmra, pmdec, parallax, gmag }
 * @param {Array} stacks  per-pass stacks (only their dates are used here)
 * @returns {{ selected: Array<{ star, x, y, ra, dec }>, rejected: { noPosition, outside, crowded, surplus },
 *             refMjd: number, nCatalogue: number }}
 */
export function selectReferenceStars(grid, stars, stacks, opts = {}) {
  const L = { ...CORE, ...(opts.lib || {}) };
  const {
    epoch = GAIA_EPOCH, marginPix = 8, isolationArcsec = 3 * NATIVE_PIXEL_ARCSEC, contrastMag = 1,
    maxStars = 80,
  } = opts;
  const list = starList(stars);
  const rejected = { noPosition: 0, outside: 0, crowded: 0, surplus: 0 };
  const dates = (stacks || []).map((s) => s.mjd).filter(isNum);
  const refMjd = dates.length ? dates.reduce((a, b) => a + b, 0) / dates.length : NaN;
  const out = { selected: [], rejected, refMjd, nCatalogue: list.length };
  if (!grid || !(grid.n > 0) || !isNum(refMjd)) return out;

  const placed = [];
  for (const star of list) {
    if (!star || !isNum(star.ra) || !isNum(star.dec)) { rejected.noPosition++; continue; }
    const pos = L.propagate({ ...star, epoch: isNum(star.epoch) ? star.epoch : epoch }, refMjd);
    const [x, y] = L.gridSkyToPix(grid, pos.ra, pos.dec);
    if (!isNum(x) || !isNum(y)) { rejected.noPosition++; continue; }
    placed.push({ star, x, y, ra: pos.ra, dec: pos.dec });
  }
  const n = grid.n;
  const rIso = isolationArcsec / grid.scale;
  const candidates = [];
  for (const p of placed) {
    if (!(p.x >= marginPix && p.y >= marginPix && p.x <= n - 1 - marginPix && p.y <= n - 1 - marginPix)) {
      rejected.outside++;
      continue;
    }
    let crowded = false;
    for (const q of placed) {
      if (q === p) continue;
      if (Math.hypot(q.x - p.x, q.y - p.y) > rIso) continue;
      if (!isNum(q.star.gmag) || !isNum(p.star.gmag) || q.star.gmag < p.star.gmag + contrastMag) { crowded = true; break; }
    }
    if (crowded) { rejected.crowded++; continue; }
    candidates.push(p);
  }
  candidates.sort((a, b) => (isNum(a.star.gmag) ? a.star.gmag : 99) - (isNum(b.star.gmag) ? b.star.gmag : 99));
  if (candidates.length > maxStars) {
    rejected.surplus = candidates.length - maxStars;
    candidates.length = maxStars;
  }
  out.selected = candidates;
  return out;
}

/** True when the 3 x 3 pixels around (x, y) are all usable and well covered in a stack. */
function coreIsClean(stack, n, x, y) {
  const cx = Math.round(x);
  const cy = Math.round(y);
  if (cx < 1 || cy < 1 || cx > n - 2 || cy > n - 2) return false;
  const need = stack.count && stack.nExposures > 1 ? 0.5 * stack.nExposures : 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const i = (cy + dy) * n + cx + dx;
      if (stack.mask && stack.mask[i]) return false;
      if (!Number.isFinite(stack.image[i])) return false;
      if (need > 0 && stack.count[i] < need) return false;
    }
  }
  return true;
}

/**
 * Centroid every reference star in every pass and compare with Gaia.
 *
 * @param {{ grid: object, stacks?: Array, layers?: Array, stars: Array|{stars:Array,epoch?:number}, epoch?: number }} input
 *   Give per-pass stacks (buildPassStacks) or the layers of one detector to stack here.
 * @param {object} [opts] selection options of selectReferenceStars, plus
 *   box (centroid half-window, grid pixels, default 5), minSnr (default 8), minValidFrac
 *   (default 0.85), maxOffsetArcsec (default one SPHEREx pixel: a centroid further than that
 *   from the prediction is another object), lowPmLimit (default 50 mas/yr), and floorArcsec:
 *   an error added in quadrature to every position before the motions are fitted. The default
 *   'auto' uses the per-axis robust scatter of all the offsets about their median (when there
 *   are at least five), because on bright stars the noise-propagated centroid error is a few
 *   hundredths of an arcsecond while the real scatter, set by the undersampled PSF, is larger.
 *   The value used is returned as stats.floorArcsec.
 * @returns {object} stats:
 *   { ok, reason?, scaleArcsec, epoch, nCatalogue, nSelected, nMeasured, floorArcsec, rejected: { noPosition,
 *     outside, crowded, surplus, masked, faint, mismatch }, passes: [{ index, label, mjd, nExposures }],
 *     stars: [{ id, gmag, gaiaPmra, gaiaPmdec, gaiaTotal, lowPm, x, y,
 *               offsets: [{ pass, mjd, dEast, dNorth, sigma, snr, ra, dec }],
 *               motion: { pmra, pmdec, errPmra, errPmdec, total, errTotal, n } | null }] }
 *   offsets are measured minus Gaia-predicted, arcsec. `motion` is the proper motion fitted to
 *   the measured positions alone (null with fewer than two passes).
 */
export function measureFieldStars(input = {}, opts = {}) {
  const L = { ...CORE, ...(opts.lib || {}) };
  const {
    box = 5, minSnr = 8, minValidFrac = 0.85, maxOffsetArcsec = NATIVE_PIXEL_ARCSEC, floorArcsec = 'auto',
    lowPmLimit = LOW_PM_LIMIT,
  } = opts;
  const grid = input.grid;
  const epoch = isNum(input.epoch) ? input.epoch
    : input.stars && isNum(input.stars.epoch) ? input.stars.epoch
      : isNum(opts.epoch) ? opts.epoch : GAIA_EPOCH;
  const stats = {
    ok: false, scaleArcsec: grid ? grid.scale : NaN, epoch, nCatalogue: starList(input.stars).length,
    nSelected: 0, nMeasured: 0, floorArcsec: 0,
    rejected: { noPosition: 0, outside: 0, crowded: 0, surplus: 0, masked: 0, faint: 0, mismatch: 0 },
    passes: [], stars: [],
  };
  if (!grid || !(grid.n > 0)) return { ...stats, reason: 'No grid: nothing is loaded' };
  let stacks = input.stacks;
  if (!stacks && input.layers) {
    try {
      stacks = buildPassStacks(input.layers, opts);
    } catch (err) {
      return { ...stats, reason: `Could not stack the passes: ${err && err.message}` };
    }
  }
  if (!stacks || !stacks.length) return { ...stats, reason: 'No exposures to stack' };
  stats.passes = stacks.map((s) => ({ index: s.index, label: s.label, mjd: s.mjd, nExposures: s.nExposures }));
  if (!stats.nCatalogue) return { ...stats, reason: 'No Gaia stars are loaded for this field' };

  const sel = selectReferenceStars(grid, input.stars, stacks, { ...opts, epoch });
  Object.assign(stats.rejected, sel.rejected);
  stats.nSelected = sel.selected.length;
  const n = grid.n;

  const kept = [];
  for (const cand of sel.selected) {
    const star = cand.star;
    const at = { ...star, epoch: isNum(star.epoch) ? star.epoch : epoch };
    const offsets = [];
    const why = { masked: 0, faint: 0, mismatch: 0 };
    for (const stack of stacks) {
      const pred = L.propagate(at, stack.mjd);
      const [px, py] = L.gridSkyToPix(grid, pred.ra, pred.dec);
      if (!isNum(px) || !isNum(py)) { why.masked++; continue; }
      if (!coreIsClean(stack, n, px, py)) { why.masked++; continue; }
      let c = null;
      try {
        c = L.centroid(stack.image, stack.mask, n, px, py, { box });
      } catch {
        c = null;
      }
      if (!c || !c.ok || !(c.snr >= minSnr)) { why.faint++; continue; }
      if (isNum(c.validFrac) && c.validFrac < minValidFrac) { why.masked++; continue; }
      const [mra, mdec] = L.gridPixToSky(grid, c.x, c.y);
      const off = L.tangentOffset(mra, mdec, pred.ra, pred.dec);
      if (!isNum(off.dEast) || !isNum(off.dNorth) || Math.hypot(off.dEast, off.dNorth) > maxOffsetArcsec) { why.mismatch++; continue; }
      let statPix = Math.sqrt(((isNum(c.xErr) ? c.xErr : 0) ** 2 + (isNum(c.yErr) ? c.yErr : 0) ** 2) / 2);
      if (!(statPix > 0)) statPix = 1.5 / Math.max(c.snr, 1); // Cramer-Rao scale for a 2.4 pixel FWHM
      offsets.push({
        pass: stack.index, mjd: stack.mjd, dEast: off.dEast, dNorth: off.dNorth,
        sigma: statPix * grid.scale, snr: c.snr, ra: mra, dec: mdec,
      });
    }
    if (!offsets.length) {
      // Say why the star was lost: the reason that occurred in most passes.
      const top = Object.keys(why).sort((a, b) => why[b] - why[a])[0];
      stats.rejected[top]++;
      continue;
    }
    kept.push({ cand, offsets });
  }

  // The error floor: what the centroids actually scatter by, beyond their noise.
  let floor = isNum(floorArcsec) && floorArcsec >= 0 ? floorArcsec : 0;
  if (floorArcsec === 'auto') {
    const east = [];
    const north = [];
    for (const k of kept) for (const o of k.offsets) { east.push(o.dEast); north.push(o.dNorth); }
    if (east.length >= 5) {
      const se = robustSigma(east);
      const sn = robustSigma(north);
      floor = Math.sqrt((se * se + sn * sn) / 2);
    }
  }
  stats.floorArcsec = isNum(floor) ? floor : 0;

  for (const { cand, offsets } of kept) {
    const star = cand.star;
    for (const o of offsets) o.sigma = Math.hypot(o.sigma, stats.floorArcsec);
    let motion = null;
    if (offsets.length >= 2) {
      try {
        const fit = L.fitMotion(offsets.map((o) => ({ mjd: o.mjd, ra: o.ra, dec: o.dec, sigma: o.sigma })));
        if (fit && isNum(fit.pmra) && isNum(fit.pmdec)) {
          motion = {
            pmra: fit.pmra, pmdec: fit.pmdec, errPmra: fit.errPmra, errPmdec: fit.errPmdec,
            total: fit.total, errTotal: fit.errTotal, n: fit.n,
          };
        }
      } catch {
        motion = null;
      }
    }
    const gaiaPmra = isNum(star.pmra) ? star.pmra : null;
    const gaiaPmdec = isNum(star.pmdec) ? star.pmdec : null;
    const gaiaTotal = gaiaPmra === null || gaiaPmdec === null ? null : Math.hypot(gaiaPmra, gaiaPmdec);
    stats.stars.push({
      id: star.id != null ? String(star.id) : '', gmag: isNum(star.gmag) ? star.gmag : null,
      gaiaPmra, gaiaPmdec, gaiaTotal, lowPm: gaiaTotal !== null && gaiaTotal < lowPmLimit,
      x: cand.x, y: cand.y, offsets, motion,
    });
  }
  stats.nMeasured = stats.stars.length;
  stats.ok = stats.nMeasured > 0;
  if (!stats.ok) stats.reason = 'No field star could be measured: none is isolated, bright and unflagged';
  return stats;
}

function arcsecText(v) {
  if (!isNum(v)) return 'unknown';
  return `${Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2)} arcsec`;
}

/**
 * Astrometric accuracy of the whole chain from the field-star offsets.
 *
 * @param {object} stats result of measureFieldStars
 * @param {{ toleranceArcsec?: number }} [opts] the median offset and the scatter must both be
 *   under this for a "pass". Default a quarter of a SPHEREx pixel, 1.54 arcsec.
 * @returns {{ ok, reason?, n, nStars, medianEast, medianNorth, medianOffset, scatterEast,
 *   scatterNorth, sigma, errMedian, medianRadial, sigmaPix, medianOffsetPix, perPass:
 *   [{ pass, label, n, medianEast, medianNorth }], toleranceArcsec, pass, verdict, points:
 *   [{ dEast, dNorth, pass, id }] }}
 *   sigma is the per-axis robust scatter (rms of the east and north values); errMedian is the
 *   standard error of the median per axis; *Pix values are in SPHEREx pixels (6.15 arcsec).
 */
export function alignment(stats, opts = {}) {
  const { toleranceArcsec = NATIVE_PIXEL_ARCSEC / 4 } = opts;
  const points = [];
  for (const s of (stats && stats.stars) || []) {
    for (const o of s.offsets || []) points.push({ dEast: o.dEast, dNorth: o.dNorth, pass: o.pass, id: s.id });
  }
  const n = points.length;
  const nStars = stats && stats.stars ? stats.stars.length : 0;
  const base = { ok: false, n, nStars, toleranceArcsec, points };
  if (n < 3) {
    const reason = stats && stats.reason ? stats.reason : `Only ${n} usable field-star measurement${n === 1 ? '' : 's'}; three are needed`;
    return { ...base, reason, verdict: `Not measured. ${reason}.` };
  }
  const east = points.map((p) => p.dEast);
  const north = points.map((p) => p.dNorth);
  const medianEast = median(east);
  const medianNorth = median(north);
  const scatterEast = robustSigma(east);
  const scatterNorth = robustSigma(north);
  const sigma = Math.sqrt((scatterEast * scatterEast + scatterNorth * scatterNorth) / 2);
  const medianOffset = Math.hypot(medianEast, medianNorth);
  const errMedian = (1.2533 * sigma) / Math.sqrt(n);
  const medianRadial = median(points.map((p) => Math.hypot(p.dEast - medianEast, p.dNorth - medianNorth)));
  const perPass = ((stats && stats.passes) || []).map((p) => {
    const mine = points.filter((q) => q.pass === p.index);
    return {
      pass: p.index, label: p.label, n: mine.length,
      medianEast: median(mine.map((q) => q.dEast)), medianNorth: median(mine.map((q) => q.dNorth)),
    };
  });
  const pass = medianOffset <= toleranceArcsec && sigma <= toleranceArcsec;
  const verdict = pass
    ? `Aligned. ${nStars} field star${nStars === 1 ? '' : 's'} sit a median ${arcsecText(medianOffset)} `
      + `(${(medianOffset / NATIVE_PIXEL_ARCSEC).toFixed(2)} SPHEREx pixel) from where Gaia predicts, `
      + `with a scatter of ${arcsecText(sigma)} per axis.`
    : `Misaligned beyond a quarter pixel. Median offset ${arcsecText(medianOffset)}, scatter ${arcsecText(sigma)} per axis, `
      + `from ${nStars} field star${nStars === 1 ? '' : 's'}; the tolerance is ${arcsecText(toleranceArcsec)} for both.`;
  return {
    ...base, ok: true, medianEast, medianNorth, medianOffset, scatterEast, scatterNorth, sigma,
    errMedian, medianRadial, sigmaPix: sigma / NATIVE_PIXEL_ARCSEC,
    medianOffsetPix: medianOffset / NATIVE_PIXEL_ARCSEC, perPass, pass, verdict,
  };
}

function masText(v) {
  if (!isNum(v)) return 'unknown';
  const r = Math.round(v);
  return `${r < 0 ? '\u2212' : ''}${Math.abs(r)} mas/yr`;
}

/** Inverse-variance weighted mean of { v, e }, its error inflated when the values scatter more than their errors. */
function weightedMean(items) {
  let sw = 0;
  let swx = 0;
  let n = 0;
  for (const { v, e } of items) {
    if (!isNum(v) || !(e > 0) || !isNum(e)) continue;
    const w = 1 / (e * e);
    sw += w;
    swx += w * v;
    n++;
  }
  if (!(sw > 0)) return { mean: NaN, err: NaN, n: 0 };
  const mean = swx / sw;
  let chi2 = 0;
  for (const { v, e } of items) if (isNum(v) && e > 0 && isNum(e)) chi2 += ((v - mean) / e) ** 2;
  const inflate = n > 1 ? Math.max(1, Math.sqrt(chi2 / (n - 1))) : 1;
  return { mean, err: inflate / Math.sqrt(sw), n };
}

/**
 * Null test: the measured proper motions of stars that Gaia says are not moving.
 *
 * @param {object} stats result of measureFieldStars
 * @param {{ limit?: number }} [opts] Gaia proper motion below which a star counts (default 50 mas/yr)
 * @returns {{ ok, reason?, limit, n, meanPmra, meanPmdec, errMeanPmra, errMeanPmdec, zPmra, zPmdec,
 *   medianPmra, medianPmdec, scatterPmra, scatterPmdec, scatter, medianFormalErr, chi2, dof,
 *   reducedChi2, fracWithin2Sigma, detectable3Sigma, consistent, verdict, points: [{ pmra, pmdec,
 *   errPmra, errPmdec, id }] }}
 *   mean* is the inverse-variance weighted mean of the measured motions and errMean* its error
 *   (inflated when the stars scatter more than their own errors say); z is their ratio, and
 *   `consistent` is true when both are within three. scatter is the per-axis robust scatter of
 *   the measured motions (plain rms about the median for fewer than five stars): the empirical
 *   1-sigma error of one proper motion in this field. chi2 is against zero with each star's
 *   own error.
 */
export function nullTest(stats, opts = {}) {
  const { limit = LOW_PM_LIMIT } = opts;
  const points = [];
  for (const s of (stats && stats.stars) || []) {
    if (!s.motion || !isNum(s.motion.pmra) || !isNum(s.motion.pmdec)) continue;
    if (s.gaiaTotal === null || !(s.gaiaTotal < limit)) continue;
    points.push({ pmra: s.motion.pmra, pmdec: s.motion.pmdec, errPmra: s.motion.errPmra, errPmdec: s.motion.errPmdec, id: s.id });
  }
  const n = points.length;
  const base = { ok: false, limit, n, points };
  if (n < 3) {
    const passes = (stats && stats.passes) || [];
    const reason = passes.length < 2
      ? 'Only one survey pass is loaded; a motion needs two'
      : `Only ${n} slow field star${n === 1 ? '' : 's'} measured in two passes; three are needed`;
    return { ...base, reason, verdict: `Not measured. ${reason}.` };
  }
  const ra = points.map((p) => p.pmra);
  const dec = points.map((p) => p.pmdec);
  const medianPmra = median(ra);
  const medianPmdec = median(dec);
  const spread = (values, med) => (n >= 5 ? robustSigma(values) : Math.sqrt(values.reduce((a, v) => a + (v - med) ** 2, 0) / (n - 1)));
  const scatterPmra = spread(ra, medianPmra);
  const scatterPmdec = spread(dec, medianPmdec);
  const scatter = Math.sqrt((scatterPmra * scatterPmra + scatterPmdec * scatterPmdec) / 2);
  const mra = weightedMean(points.map((p) => ({ v: p.pmra, e: p.errPmra })));
  const mdec = weightedMean(points.map((p) => ({ v: p.pmdec, e: p.errPmdec })));
  const zPmra = mra.err > 0 ? mra.mean / mra.err : 0;
  const zPmdec = mdec.err > 0 ? mdec.mean / mdec.err : 0;
  let chi2 = 0;
  let dof = 0;
  let within = 0;
  const formal = [];
  for (const p of points) {
    for (const [v, e] of [[p.pmra, p.errPmra], [p.pmdec, p.errPmdec]]) {
      if (!(e > 0) || !isNum(e)) continue;
      const z = v / e;
      chi2 += z * z;
      dof++;
      if (Math.abs(z) <= 2) within++;
      formal.push(e);
    }
  }
  const consistent = isNum(zPmra) && isNum(zPmdec) && Math.abs(zPmra) <= 3 && Math.abs(zPmdec) <= 3;
  const worst = Math.max(Math.abs(zPmra), Math.abs(zPmdec));
  const verdict = consistent
    ? `No motion, as expected. ${n} stars that Gaia says move under ${limit} mas/yr have a mean measured motion of `
      + `${masText(mra.mean)} east and ${masText(mdec.mean)} north, within ${worst.toFixed(1)} `
      + `sigma of zero. One star scatters by ${masText(scatter)} per axis, so a single object must move faster than about `
      + `${masText(3 * scatter)} to be called moving here.`
    : `The slow stars appear to drift. ${n} stars that Gaia says move under ${limit} mas/yr have a mean measured motion of `
      + `${masText(mra.mean)} east and ${masText(mdec.mean)} north, ${worst.toFixed(1)} `
      + 'sigma from zero. That points to a registration shift between passes, and motions measured in this field carry it.';
  return {
    ...base, ok: true, meanPmra: mra.mean, meanPmdec: mdec.mean, errMeanPmra: mra.err, errMeanPmdec: mdec.err,
    zPmra, zPmdec, medianPmra, medianPmdec, scatterPmra, scatterPmdec, scatter,
    medianFormalErr: median(formal), chi2, dof, reducedChi2: dof > 0 ? chi2 / dof : NaN,
    fracWithin2Sigma: dof > 0 ? within / dof : NaN, detectable3Sigma: 3 * scatter, consistent, verdict,
  };
}
