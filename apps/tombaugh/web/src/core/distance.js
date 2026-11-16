// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// distance.js - the "distance dial".
//
// THE PHYSICS
// -----------
// SPHEREx sits in a dawn-dusk orbit and always looks about 90 degrees away from the Sun. A given
// patch of sky is therefore observed when the Earth is at one of the two points of its orbit
// where the patch is at quadrature, and those two points are six months and about 2 AU apart,
// on opposite sides of the Sun. Successive survey passes see the patch alternately from each.
//
// A star is so far away that 2 AU makes no visible difference (Barnard's Star, the second
// nearest system, shifts 1.1 arcsec: a sixth of a SPHEREx pixel). A body inside the solar system
// is another matter. Seen from two points 2 AU apart, something at heliocentric distance d
// appears to hop against the stars by
//
//     hop  =  2 AU / d  radians   =   412,530 arcsec / d[AU]
//
// which is 13.75 arcmin at 500 AU, 3.4 arcmin at 2000 AU, 41 arcsec (7 pixels) at 10,000 AU and
// 3.8 degrees at 30 AU. The hop is far larger than the body's own orbital motion: a circular
// orbit at 500 AU covers only 116 arcsec per year (keplerRate), against a hop of 825 arcsec every
// six months. So to first order a distant body does not drift across the sky, it jumps back and
// forth between two places, and the size of the jump IS its distance.
//
// The dial turns that around. Pick a trial distance d. For each exposure compute where a body at
// that distance would appear (predictedTrack: exact vector geometry using the Earth ephemeris),
// shift every exposure back by that amount, and average (shiftAndStack). If something real is
// out there at distance d, its images from all passes land on the same pixels and add up, and
// its signal-to-noise grows as the square root of the number of exposures. At the wrong distance
// the images miss each other and it stays buried. Sweeping d and recording the peak
// signal-to-noise gives a focus curve (dialSweep) that peaks at the true distance, like focusing
// a lens. With the dial at infinity nothing is shifted and the fixed stars are sharp; off
// infinity the stars do not move on the sky, so the shifts smear each one into one copy per pass.
// That smearing is expected, not a bug, and it is why the dial should be fed residual layers
// (sky model already subtracted) rather than raw ones.
//
// Two refinements, both handled by the exact geometry and needing no special cases here:
// * Away from the ecliptic the Earth's velocity is not along the line of sight at quadrature, so
//   the body also drifts during a pass, by up to 2 pi sin(ecliptic latitude) / d radians per
//   year (0.36 arcsec per day at 4000 AU and latitude 24 deg). Each exposure gets its own shift.
// * Near the ecliptic poles a patch is always about 90 deg from the Sun and is observed all year
//   round; a nearby body then traces its whole parallax ellipse instead of hopping between two
//   points. Same code, same dial.
//
// Practical limit: the hop has to fit inside the cutout. With a field of view F the dial is
// useful for d > 2 AU / F: beyond about 690 AU for a 10 arcmin field, 1700 AU for 4 arcmin.
// The proxy clamps cutouts to 0.2 deg (12 arcmin), so nothing nearer than about 570 AU can be
// followed across passes without fetching a second field.
//
// CONVENTIONS
// -----------
// Degrees, MJD (UTC), AU, arcsec (CONTRACT.md). East offsets are on-sky arcsec, positive towards
// increasing RA. On a Grid, east is towards DEcreasing x and north towards increasing y:
//     x = (n - 1) / 2 - east / scale,    y = (n - 1) / 2 + north / scale.

import { parallaxOffset, earthPosition, ARCSEC_PER_RAD } from './ephemeris.js';
import { offsetBy, tangentOffset } from './astrometry.js';

const DEG = Math.PI / 180;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function wrap360(a) {
  const r = a % 360;
  return r < 0 ? r + 360 : r;
}

// ---- geometry -----------------------------------------------------------------------------------

/**
 * Apparent hop of a body at heliocentric distance distAU between two viewpoints baselineAU
 * apart, the body lying on the perpendicular bisector of the baseline (quadrature geometry):
 * hop = 2 atan(baseline / 2d), which is baseline / d for anything beyond a few AU.
 * @param {number} distAU
 * @param {number} [baselineAU] default 2 (opposite sides of the Earth's orbit)
 * @returns {number} arcsec; 0 at infinity
 */
export function hopArcsec(distAU, baselineAU = 2) {
  if (!(distAU > 0)) return NaN;
  if (!Number.isFinite(distAU)) return 0;
  return 2 * Math.atan(baselineAU / (2 * distAU)) * ARCSEC_PER_RAD;
}

/** Inverse of hopArcsec: the distance (AU) at which the hop has the given size. */
export function distanceFromHop(hop_arcsec, baselineAU = 2) {
  if (!(hop_arcsec > 0)) return Infinity;
  return baselineAU / (2 * Math.tan(hop_arcsec / ARCSEC_PER_RAD / 2));
}

/**
 * Mean angular rate of a circular heliocentric orbit of radius distAU, as seen from the Sun.
 * Kepler's third law in solar units: period P = a^1.5 years, so the rate is
 * 360 * 3600 / a^1.5 arcsec per year (times sqrt(M) for a central mass M in solar masses).
 * Only the magnitude: the direction depends on the unknown orbit orientation. The UI can offer
 * it as the "circular orbit" default for motion.raRate/decRate, to be pointed in some direction.
 * 116 arcsec/yr at 500 AU, 7900 arcsec/yr (2.2 deg) at 30 AU.
 * @returns {number} arcsec per year; 0 at infinity
 */
export function keplerRate(distAU, massSolar = 1) {
  if (!(distAU > 0)) return NaN;
  if (!Number.isFinite(distAU)) return 0;
  return (1296000 * Math.sqrt(massSolar)) / Math.pow(distAU, 1.5);
}

/**
 * Inverse of the parallax: given where a body APPEARS from the Earth at one date and an assumed
 * heliocentric distance, find its heliocentric direction. With g the unit vector of the apparent
 * direction and E the Earth's position, the body is at E + rho * g where |E + rho g| = d:
 *     rho = -E.g + sqrt((E.g)^2 - |E|^2 + d^2).
 * @returns {{ ra: number, dec: number, distGeoAU: number }} NaN if the distance is inside the
 *   Earth's orbit in a way that has no solution; the input direction for an infinite distance.
 */
export function heliocentricFromApparent(ra, dec, distAU, mjd) {
  if (!(distAU > 0) || !Number.isFinite(distAU)) return { ra: wrap360(ra), dec, distGeoAU: Infinity };
  const a = ra * DEG, d = dec * DEG;
  const g = [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)];
  const E = earthPosition(mjd);
  const b = E[0] * g[0] + E[1] * g[1] + E[2] * g[2];
  const disc = b * b - (E[0] * E[0] + E[1] * E[1] + E[2] * E[2]) + distAU * distAU;
  if (!(disc >= 0)) return { ra: NaN, dec: NaN, distGeoAU: NaN };
  const rho = -b + Math.sqrt(disc);
  const P = [E[0] + rho * g[0], E[1] + rho * g[1], E[2] + rho * g[2]];
  return {
    ra: wrap360(Math.atan2(P[1], P[0]) / DEG),
    dec: Math.atan2(P[2], Math.hypot(P[0], P[1])) / DEG,
    distGeoAU: rho,
  };
}

/**
 * Where a body appears from the Earth at each date, if it sits at heliocentric direction
 * (ra, dec) and heliocentric distance distAU.
 *
 * (ra, dec) is the direction from the SUN at the reference epoch: mjds[0], or motion.refMjd.
 * Optional `motion` adds the body's own heliocentric drift along a great circle at a constant
 * rate: { raRate_arcsecPerYr, decRate_arcsecPerYr, refMjd }. raRate is the on-sky eastward rate
 * (it already includes cos dec, like a proper motion); decRate is northward. The heliocentric
 * distance is held fixed (circular orbit). An infinite, zero or non-finite distAU means "at
 * infinity": the track stays at (ra, dec) plus the drift.
 *
 * The apparent direction is the exact vector difference body - Earth (ephemeris.parallaxOffset),
 * valid from 1 AU outward, not the small-angle parallax formula.
 *
 * @param {number} ra deg @param {number} dec deg @param {number} distAU
 * @param {ArrayLike<number>} mjds dates, MJD (UTC)
 * @param {{ motion?: { raRate_arcsecPerYr?: number, decRate_arcsecPerYr?: number, refMjd?: number } }} [opts]
 * @returns {Array<{ mjd: number, ra: number, dec: number, dEast: number, dNorth: number, distGeoAU: number }>}
 *   ra, dec: apparent position. dEast, dNorth: the same thing as a tangent-plane offset in
 *   arcsec from the (ra, dec) passed in, for plotting the parallax loop. For stacking use
 *   trackOffsets, which measures offsets in the Grid's own tangent plane from an anchor.
 */
export function predictedTrack(ra, dec, distAU, mjds, { motion } = {}) {
  const list = Array.from(mjds || []);
  const rateE = motion && isNum(motion.raRate_arcsecPerYr) ? motion.raRate_arcsecPerYr : 0;
  const rateN = motion && isNum(motion.decRate_arcsecPerYr) ? motion.decRate_arcsecPerYr : 0;
  const refMjd = motion && isNum(motion.refMjd) ? motion.refMjd : list[0];
  return list.map((mjd) => {
    let h = { ra, dec };
    if (rateE !== 0 || rateN !== 0) {
      const t = (mjd - refMjd) / 365.25;
      h = offsetBy(ra, dec, rateE * t, rateN * t);
    }
    const app = parallaxOffset(h.ra, h.dec, distAU, mjd);
    const off = tangentOffset(app.ra, app.dec, ra, dec);
    return { mjd, ra: app.ra, dec: app.dec, dEast: off.dEast, dNorth: off.dNorth, distGeoAU: app.distGeoAU };
  });
}

/**
 * The track of a body that APPEARS at (ra, dec) in the exposure mjds[refIndex], for an assumed
 * distance. This is the form the UI wants: "suppose the thing I see here, in this frame, is at
 * d AU; where is it in the other frames?". Solves for the heliocentric direction at the
 * reference date (heliocentricFromApparent) and then calls predictedTrack.
 * dEast, dNorth in the result are offsets from the apparent anchor (ra, dec): zero at refIndex.
 * @param {{ refIndex?: number, motion?: object }} [opts]
 */
export function trackThrough(ra, dec, distAU, mjds, { refIndex = 0, motion } = {}) {
  const list = Array.from(mjds || []);
  if (list.length === 0) return [];
  const ref = list[Math.max(0, Math.min(list.length - 1, refIndex))];
  const h = heliocentricFromApparent(ra, dec, distAU, ref);
  const track = predictedTrack(h.ra, h.dec, distAU, list, { motion: { ...(motion || {}), refMjd: ref } });
  for (const p of track) {
    const off = tangentOffset(p.ra, p.dec, ra, dec);
    p.dEast = off.dEast; p.dNorth = off.dNorth;
  }
  return track;
}

/**
 * Convert a track (sky positions) into the per-layer offsets shiftAndStack wants: how far the
 * body is, in each layer, from where it should land in the stack. Offsets are measured in the
 * Grid's tangent plane (the same projection the layers were resampled with), relative to an
 * anchor: a track index (default 0: the body lands where it appears in the first layer) or an
 * explicit { ra, dec }. Without a grid the tangent point is the anchor itself.
 * @param {Array<{ ra: number, dec: number }>} track
 * @param {{ ra0: number, dec0: number }|null} grid
 * @param {{ anchor?: number | { ra: number, dec: number } }} [opts]
 * @returns {Array<{ dEast: number, dNorth: number }>} arcsec
 */
export function trackOffsets(track, grid, { anchor = 0 } = {}) {
  const pts = Array.from(track || []);
  if (pts.length === 0) return [];
  const a = typeof anchor === 'number' ? pts[Math.max(0, Math.min(pts.length - 1, anchor))] : anchor;
  const ra0 = grid && isNum(grid.ra0) ? grid.ra0 : a.ra;
  const dec0 = grid && isNum(grid.dec0) ? grid.dec0 : a.dec;
  const base = tangentOffset(a.ra, a.dec, ra0, dec0);
  return pts.map((p) => {
    const o = tangentOffset(p.ra, p.dec, ra0, dec0);
    return { dEast: o.dEast - base.dEast, dNorth: o.dNorth - base.dNorth };
  });
}

// ---- shift and stack ----------------------------------------------------------------------------

/** Robust sigma (1.4826 * MAD about the median) of the finite, unmasked values; subsampled. */
function robustSigma(data, mask) {
  const step = Math.max(1, Math.floor(data.length / 20000));
  const vals = [];
  for (let i = 0; i < data.length; i += step) {
    if (mask && mask[i]) continue;
    const v = data[i];
    if (Number.isFinite(v)) vals.push(v);
  }
  if (vals.length < 5) return NaN;
  const s = Float64Array.from(vals).sort();
  const med = s[s.length >> 1];
  const dev = s.map((v) => Math.abs(v - med)).sort();
  return 1.4826 * dev[dev.length >> 1];
}

/** 1-D Gaussian kernel, unit sum, radius ceil(3.5 sigma). */
function gaussKernel(sigma) {
  const r = Math.max(1, Math.ceil(3.5 * sigma));
  const k = new Float64Array(2 * r + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma)); sum += k[i + r]; }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  return k;
}

/** Separable convolution of an n x n array with a 1-D kernel along x then y; zero outside. */
function convolveSeparable(src, n, kernel) {
  const r = (kernel.length - 1) / 2;
  const tmp = new Float32Array(n * n);
  const out = new Float32Array(n * n);
  for (let y = 0; y < n; y++) {
    const row = y * n;
    for (let x = 0; x < n; x++) {
      let s = 0;
      const lo = Math.max(-r, -x), hi = Math.min(r, n - 1 - x);
      for (let k = lo; k <= hi; k++) s += kernel[k + r] * src[row + x + k];
      tmp[row + x] = s;
    }
  }
  for (let y = 0; y < n; y++) {
    const lo = Math.max(-r, -y), hi = Math.min(r, n - 1 - y);
    for (let x = 0; x < n; x++) {
      let s = 0;
      for (let k = lo; k <= hi; k++) s += kernel[k + r] * tmp[(y + k) * n + x];
      out[y * n + x] = s;
    }
  }
  return out;
}

// Per-layer derived arrays, cached so that turning the dial does not redo the convolutions.
const layerCache = new WeakMap();

/**
 * For one layer: a clean variance array, a validity mask, and the matched-filter images
 *   psi = P (*) (I / var),   phi = P^2 (*) (1 / var)
 * where P is the PSF (unit-sum Gaussian of sigma `sigmaPix`) and masked pixels contribute zero
 * to both. psi / sqrt(phi) is the signal-to-noise of a point source centred on a pixel and
 * psi / phi its best-fit flux; sums of psi and phi over layers stack optimally. This is the
 * psi/phi formulation used for shift-and-stack searches by KBMOD (Whidden et al. 2019,
 * AJ 157, 119), after the matched filter of e.g. Szalay, Connolly & Szokoly 1999, AJ 117, 68.
 */
function prepareLayer(layer, n, sigmaPix) {
  const hit = layerCache.get(layer);
  if (hit && hit.image === layer.image && hit.varianceIn === layer.variance && hit.maskIn === layer.mask
    && hit.sigmaPix === sigmaPix && hit.n === n) return hit;
  const N = n * n;
  const image = layer.image;
  const valid = new Uint8Array(N);
  const variance = new Float32Array(N);
  const hasVar = layer.variance && layer.variance.length >= N;
  let fallback = NaN;
  if (!hasVar) {
    const s = robustSigma(image, layer.mask);
    fallback = s > 0 ? s * s : NaN;
  }
  const a = new Float32Array(N), b = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    if (layer.mask && layer.mask[i]) continue;
    const v = image[i];
    const vv = hasVar ? layer.variance[i] : fallback;
    if (!Number.isFinite(v) || !(vv > 0) || !Number.isFinite(vv)) continue;
    valid[i] = 1; variance[i] = vv;
    a[i] = v / vv; b[i] = 1 / vv;
  }
  const k1 = gaussKernel(sigmaPix);
  const k2 = k1.map((v) => v * v);          // P^2 is separable too: the product of squared kernels
  const entry = {
    image, varianceIn: layer.variance, maskIn: layer.mask, sigmaPix, n,
    valid, variance, psi: convolveSeparable(a, n, k1), phi: convolveSeparable(b, n, k2),
  };
  layerCache.set(layer, entry);
  return entry;
}

function medianInPlace(scratch, m) {
  const s = scratch.subarray(0, m).sort();
  return m % 2 ? s[(m - 1) / 2] : 0.5 * (s[m / 2 - 1] + s[m / 2]);
}

/**
 * Core of shiftAndStack over a rectangular region of the output grid.
 * Returns region-sized arrays (width rw, height rh, origin x0, y0).
 */
function stackRegion(layers, grid, offsets, region, clip, sigmaPix) {
  const n = grid.n, scale = grid.scale;
  const x0 = region.x0, y0 = region.y0;
  const rw = region.x1 - region.x0 + 1, rh = region.y1 - region.y0 + 1;
  const M = rw * rh;
  const image = new Float32Array(M).fill(NaN);
  const variance = new Float32Array(M).fill(NaN);
  const snr = new Float32Array(M).fill(NaN);
  const count = new Uint16Array(M);
  const mask = new Uint8Array(M).fill(1);

  // Per-layer shift parameters. A body offset east by dEast sits at smaller x, and one offset
  // north by dNorth at larger y, so output pixel (x, y) reads layer pixel (x + sx, y + sy) with
  // sx = -dEast / scale, sy = +dNorth / scale.
  const EPS = 1e-6;
  const used = [];
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    const off = offsets && offsets[i];
    if (!layer || !layer.image || layer.image.length < n * n) continue;
    const dE = off && isNum(off.dEast) ? off.dEast : (off ? NaN : 0);
    const dN = off && isNum(off.dNorth) ? off.dNorth : (off ? NaN : 0);
    if (!isNum(dE) || !isNum(dN)) continue;         // no usable offset: leave the layer out
    const sx = -dE / scale, sy = dN / scale;
    let ix = Math.floor(sx), iy = Math.floor(sy);
    let fx = sx - ix, fy = sy - iy;
    if (fx < EPS) fx = 0; else if (fx > 1 - EPS) { fx = 0; ix += 1; }   // whole-pixel shifts stay exact
    if (fy < EPS) fy = 0; else if (fy > 1 - EPS) { fy = 0; iy += 1; }
    used.push({ prep: prepareLayer(layer, n, sigmaPix), ix, iy, fx, fy });
  }
  const L = used.length;
  if (L === 0) return { image, variance, snr, count, mask, rw, rh, x0, y0 };

  // Row buffers: one sample per layer per pixel of the current output row.
  const bv = new Float32Array(L * rw);    // interpolated value
  const bw = new Float32Array(L * rw);    // weight 1 / (interpolated variance); 0 = no sample
  const bt = new Float32Array(L * rw);    // true variance of the interpolated value
  const bpsi = new Float32Array(L * rw);
  const bphi = new Float32Array(L * rw);
  const scratch = new Float64Array(L);

  for (let ry = 0; ry < rh; ry++) {
    const y = y0 + ry;
    bw.fill(0); bpsi.fill(0); bphi.fill(0);
    for (let l = 0; l < L; l++) {
      const { prep, ix, iy, fx, fy } = used[l];
      const ya = y + iy, yb = ya + 1;
      const needB = fy > 0;
      const rowAok = ya >= 0 && ya < n, rowBok = yb >= 0 && yb < n;
      if (!rowAok && !(needB && rowBok)) continue;
      const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
      const img = prep.image, vr = prep.variance, ok = prep.valid, psi = prep.psi, phi = prep.phi;
      const base = l * rw;
      for (let rx = 0; rx < rw; rx++) {
        const xa = x0 + rx + ix, xb = xa + 1;
        const colAok = xa >= 0 && xa < n, colBok = xb >= 0 && xb < n;
        const i00 = ya * n + xa, i10 = i00 + 1, i01 = i00 + n, i11 = i01 + 1;
        const in00 = rowAok && colAok, in10 = rowAok && colBok, in01 = rowBok && colAok, in11 = rowBok && colBok;

        // Matched-filter images are defined everywhere (zero where there is no data).
        let ps = 0, ph = 0;
        if (in00) { ps += w00 * psi[i00]; ph += w00 * phi[i00]; }
        if (w10 > 0 && in10) { ps += w10 * psi[i10]; ph += w10 * phi[i10]; }
        if (w01 > 0 && in01) { ps += w01 * psi[i01]; ph += w01 * phi[i01]; }
        if (w11 > 0 && in11) { ps += w11 * psi[i11]; ph += w11 * phi[i11]; }
        bpsi[base + rx] = ps; bphi[base + rx] = ph;

        // Image sample: every pixel that carries weight must exist and be unmasked.
        if (!(in00 && ok[i00])) continue;
        let v = w00 * img[i00], vlin = w00 * vr[i00], vtrue = w00 * w00 * vr[i00];
        if (w10 > 0) { if (!(in10 && ok[i10])) continue; v += w10 * img[i10]; vlin += w10 * vr[i10]; vtrue += w10 * w10 * vr[i10]; }
        if (w01 > 0) { if (!(in01 && ok[i01])) continue; v += w01 * img[i01]; vlin += w01 * vr[i01]; vtrue += w01 * w01 * vr[i01]; }
        if (w11 > 0) { if (!(in11 && ok[i11])) continue; v += w11 * img[i11]; vlin += w11 * vr[i11]; vtrue += w11 * w11 * vr[i11]; }
        bv[base + rx] = v; bw[base + rx] = 1 / vlin; bt[base + rx] = vtrue;
      }
    }

    for (let rx = 0; rx < rw; rx++) {
      const o = ry * rw + rx;
      // ---- image: inverse-variance weighted mean, optional clipping about the median ----
      let useClip = false, med = 0;
      if (clip > 0) {
        let m = 0;
        for (let l = 0; l < L; l++) if (bw[l * rw + rx] > 0) scratch[m++] = bv[l * rw + rx];
        if (m >= 3) { med = medianInPlace(scratch, m); useClip = true; }
      }
      let sw = 0, swv = 0, sw2t = 0, c = 0;
      for (let l = 0; l < L; l++) {
        const k = l * rw + rx;
        const w = bw[k];
        if (!(w > 0)) continue;
        if (useClip) {
          const tol = clip * Math.sqrt(bt[k]);
          if (bv[k] - med > tol || med - bv[k] > tol) continue;
        }
        sw += w; swv += w * bv[k]; sw2t += w * w * bt[k]; c++;
      }
      if (c > 0 && sw > 0) {
        image[o] = swv / sw;
        variance[o] = sw2t / (sw * sw);
        count[o] = c;
        mask[o] = 0;
      }
      // ---- matched-filter signal-to-noise: sum psi / sqrt(sum phi) ----
      let lo = -Infinity, hi = Infinity;
      if (clip > 0) {
        let m = 0;
        for (let l = 0; l < L; l++) {
          const k = l * rw + rx;
          if (bphi[k] > 0) scratch[m++] = bpsi[k] / Math.sqrt(bphi[k]);
        }
        if (m >= 3) { const mz = medianInPlace(scratch, m); lo = mz - clip; hi = mz + clip; }
      }
      let sp = 0, sf = 0;
      for (let l = 0; l < L; l++) {
        const k = l * rw + rx;
        const ph = bphi[k];
        if (!(ph > 0)) continue;
        const z = bpsi[k] / Math.sqrt(ph);
        if (z < lo || z > hi) continue;
        sp += bpsi[k]; sf += ph;
      }
      if (sf > 0 && c > 0) snr[o] = sp / Math.sqrt(sf);
    }
  }
  return { image, variance, snr, count, mask, rw, rh, x0, y0 };
}

function psfSigmaPix(grid, opts) {
  const fwhm = isNum(opts.psfFwhmArcsec) && opts.psfFwhmArcsec > 0 ? opts.psfFwhmArcsec : 7.5;
  return Math.max(0.6, fwhm / 2.3548200450309493 / grid.scale);
}

/**
 * Shift every layer so that a body following a track stays on the same pixels, then average.
 *
 * offsetsArcsec[i] = { dEast, dNorth } says where the body is in layer i relative to where it
 * should land in the stack (see trackOffsets). Layer i is resampled at that displacement, i.e.
 * its content is moved by MINUS the offset, with bilinear interpolation (whole-pixel shifts are
 * exact copies). A missing entry means no shift; a non-finite one drops the layer. A sample is
 * used only if every pixel it interpolates between is inside the layer and unmasked with a
 * finite value and positive variance. Layers without a variance array get a uniform variance
 * from the robust scatter of their image.
 *
 * image: inverse-variance weighted mean of the shifted layers (weights from the linearly
 *   interpolated variance, so they do not depend on the sub-pixel phase of the shift).
 * variance: variance of that mean for independent input pixels, sum W^2 var_true / (sum W)^2.
 * count: number of layers contributing to each pixel.   mask: 1 where count is 0.
 * snr: matched-filter signal-to-noise of a point source centred on each pixel, stacked over
 *   layers as sum psi / sqrt(sum phi) (see prepareLayer). Unlike image / sqrt(variance) it does
 *   not depend on the sub-pixel phase of the shifts, so focus curves are smooth. It assumes
 *   independent pixel noise: layers made by reproject() are oversampled 2x, which correlates
 *   neighbouring pixels and inflates this by up to about 2. `noise` reports the robust scatter
 *   of the snr map (1 when the variances are honest); divide by it for calibrated numbers.
 * Masked pixels hold NaN in image, variance and snr.
 *
 * @param {Array<{ image: Float32Array, variance?: Float32Array, mask?: Uint8Array }>} layers
 * @param {{ n: number, scale: number }} grid
 * @param {Array<{ dEast: number, dNorth: number }>} offsetsArcsec one per layer
 * @param {{ clip?: number, psfFwhmArcsec?: number, region?: { x0: number, x1: number, y0: number, y1: number } }} [opts]
 *   clip: if > 0, reject samples more than clip sigma from the per-pixel median before averaging
 *     (needs 3 or more samples). Removes the smeared copies of fixed stars when a body's images
 *     are spread over many layers. Default 0 (off).
 *   psfFwhmArcsec: PSF width for the matched filter, default 7.5 (SPHEREx).
 *   region: restrict the work to these inclusive pixel bounds; the rest of the output is masked.
 * @returns {{ image: Float32Array, variance: Float32Array, count: Uint16Array, mask: Uint8Array,
 *             snr: Float32Array, noise: number }}  all n * n, row-major, y increasing north
 */
export function shiftAndStack(layers, grid, offsetsArcsec, opts = {}) {
  const n = grid && grid.n > 0 ? grid.n : 0;
  const N = n * n;
  const empty = {
    image: new Float32Array(N).fill(NaN), variance: new Float32Array(N).fill(NaN),
    count: new Uint16Array(N), mask: new Uint8Array(N).fill(1),
    snr: new Float32Array(N).fill(NaN), noise: NaN,
  };
  if (!n || !(grid.scale > 0) || !Array.isArray(layers)) return empty;
  const clip = isNum(opts.clip) && opts.clip > 0 ? opts.clip : 0;
  const full = { x0: 0, x1: n - 1, y0: 0, y1: n - 1 };
  let region = full;
  if (opts.region) {
    region = {
      x0: Math.max(0, Math.floor(opts.region.x0)), x1: Math.min(n - 1, Math.ceil(opts.region.x1)),
      y0: Math.max(0, Math.floor(opts.region.y0)), y1: Math.min(n - 1, Math.ceil(opts.region.y1)),
    };
    if (region.x1 < region.x0 || region.y1 < region.y0) return empty;
  }
  const r = stackRegion(layers, grid, offsetsArcsec || [], region, clip, psfSigmaPix(grid, opts));
  let out;
  if (r.rw === n && r.rh === n) {
    out = { image: r.image, variance: r.variance, count: r.count, mask: r.mask, snr: r.snr };
  } else {
    out = empty;
    for (let ry = 0; ry < r.rh; ry++) {
      const src = ry * r.rw, dst = (r.y0 + ry) * n + r.x0;
      out.image.set(r.image.subarray(src, src + r.rw), dst);
      out.variance.set(r.variance.subarray(src, src + r.rw), dst);
      out.count.set(r.count.subarray(src, src + r.rw), dst);
      out.mask.set(r.mask.subarray(src, src + r.rw), dst);
      out.snr.set(r.snr.subarray(src, src + r.rw), dst);
    }
  }
  out.noise = robustSigma(out.snr, out.mask);
  return out;
}

/**
 * Focus curve: for each trial distance, shift-and-stack along the predicted track and record
 * the peak signal-to-noise inside a small box around the place the body should land.
 *
 * @param {Array<object>} layers Grid layers (ideally residuals; see the header)
 * @param {{ n: number, scale: number, ra0: number, dec0: number }} grid
 * @param {(distAU: number) => Array<object>} trackMaker called once per distance; returns one
 *   entry per layer, either sky positions [{ ra, dec }] (e.g. from trackThrough; converted with
 *   trackOffsets in the grid's tangent plane, anchored on the first layer unless opts.anchor is
 *   given) or ready-made offsets [{ dEast, dNorth }]. Typical use:
 *     const mjds = layers.map((l) => l.mjd);
 *     dialSweep(layers, grid, (d) => trackThrough(grid.ra0, grid.dec0, d, mjds), distances)
 * @param {ArrayLike<number>} distances AU; Infinity is allowed and means "no shift"
 * @param {{ box?: number, center?: { x: number, y: number }, clip?: number, psfFwhmArcsec?: number,
 *           calibrate?: boolean, anchor?: number | { ra: number, dec: number } }} [opts]
 *   box: half-width in grid pixels of the search box (default 4: 9 x 9 pixels, 28 arcsec).
 *   center: where the body should land, grid pixels (default the grid centre).
 *   calibrate: divide by the robust scatter of the unshifted full-frame snr map so that
 *     correlated or mis-scaled noise does not inflate the curve (default true).
 * @returns {Array<{ distAU: number, peakSnr: number, rawSnr: number, x: number, y: number,
 *                   flux: number, noise: number, spanArcsec: number }>}
 *   peakSnr is the calibrated peak (rawSnr / noise), x, y the pixel where it occurs, flux the
 *   stacked image value there, spanArcsec the largest shift applied between any two layers (the
 *   hop at that distance for these dates). peakSnr is NaN when the box holds no data.
 */
export function dialSweep(layers, grid, trackMaker, distances, opts = {}) {
  const out = [];
  if (!grid || !(grid.n > 0) || !Array.isArray(layers) || typeof trackMaker !== 'function') return out;
  const n = grid.n;
  const box = isNum(opts.box) && opts.box >= 0 ? Math.round(opts.box) : 4;
  const cx = opts.center && isNum(opts.center.x) ? opts.center.x : (n - 1) / 2;
  const cy = opts.center && isNum(opts.center.y) ? opts.center.y : (n - 1) / 2;
  const region = {
    x0: Math.max(0, Math.round(cx) - box), x1: Math.min(n - 1, Math.round(cx) + box),
    y0: Math.max(0, Math.round(cy) - box), y1: Math.min(n - 1, Math.round(cy) + box),
  };
  if (region.x1 < region.x0 || region.y1 < region.y0) return out;
  const clip = isNum(opts.clip) && opts.clip > 0 ? opts.clip : 0;
  const sigmaPix = psfSigmaPix(grid, opts);

  let noise = 1;
  if (opts.calibrate !== false) {
    const flat = stackRegion(layers, grid, [], { x0: 0, x1: n - 1, y0: 0, y1: n - 1 }, clip, sigmaPix);
    const s = robustSigma(flat.snr, flat.mask);
    if (s > 0) noise = s;
  }

  for (const d of Array.from(distances || [])) {
    let track = [];
    try { track = trackMaker(d) || []; } catch { track = []; }
    let offsets = track;
    if (track.length && track[0] && isNum(track[0].ra) && isNum(track[0].dec)) {
      offsets = trackOffsets(track, grid, { anchor: opts.anchor === undefined ? 0 : opts.anchor });
    }
    const r = stackRegion(layers, grid, offsets, region, clip, sigmaPix);
    let best = -Infinity, bi = -1;
    for (let i = 0; i < r.snr.length; i++) {
      const v = r.snr[i];
      if (Number.isFinite(v) && v > best) { best = v; bi = i; }
    }
    const last = offsets.length ? offsets[offsets.length - 1] : null;
    out.push({
      distAU: d,
      peakSnr: bi >= 0 ? best / noise : NaN,
      rawSnr: bi >= 0 ? best : NaN,
      x: bi >= 0 ? r.x0 + (bi % r.rw) : NaN,
      y: bi >= 0 ? r.y0 + Math.floor(bi / r.rw) : NaN,
      flux: bi >= 0 ? r.image[bi] : NaN,
      noise,
      spanArcsec: last && isNum(last.dEast) ? maxSpan(offsets) : NaN,
    });
  }
  return out;
}

/** Largest separation between any two offsets of a track: the hop actually applied, arcsec. */
function maxSpan(offsets) {
  let best = 0;
  for (let i = 0; i < offsets.length; i++) {
    for (let j = i + 1; j < offsets.length; j++) {
      const d = Math.hypot(offsets[i].dEast - offsets[j].dEast, offsets[i].dNorth - offsets[j].dNorth);
      if (d > best) best = d;
    }
  }
  return best;
}

/**
 * The entry of a focus curve with the highest peakSnr (null for an empty or all-NaN curve).
 * @param {Array<{ distAU: number, peakSnr: number }>} curve as returned by dialSweep
 */
export function focusPeak(curve) {
  let best = null;
  for (const c of curve || []) {
    if (c && Number.isFinite(c.peakSnr) && (!best || c.peakSnr > best.peakSnr)) best = c;
  }
  return best;
}
