// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// astrometry.js - where a star is at a given date, where a blob of light is in an image, and how
// fast something moved between the two.
//
// CONVENTIONS
// -----------
// * Angles are degrees; small offsets are arcsec; proper motions are mas/yr; parallax is mas.
// * `pmra` is mu_alpha* = d(RA)/dt * cos(Dec): the true on-sky rate towards EAST. This is what
//   Gaia, Hipparcos and SIMBAD publish. Positive pmra moves a star to larger RA.
// * `pmdec` is positive towards NORTH.
// * Times are MJD (UTC). Catalogue epochs are Julian years: epoch = 2000 + (MJD - 51544.5) / 365.25,
//   so J2000.0 = MJD 51544.5 and the Gaia DR3 epoch J2016.0 = MJD 57388.5. (The 69 s difference
//   between UTC and the TCB/TT scale of catalogue epochs is 2e-6 yr and is ignored.)
// * Position angles are measured from north through east, 0..360.
// * "East offset" always means on-sky arcsec (already multiplied by cos dec).
// * Pixels are 0-based, x = column, y = row, index = y * n + x (see CONTRACT.md).
//
// Self-contained on purpose: the few spherical-trig helpers needed are implemented here instead
// of being imported from wcs.js. The only import is the Earth ephemeris, for parallax.

import { earthPosition, parallaxFactors } from './ephemeris.js';

const DEG = Math.PI / 180;
const ARCSEC = DEG / 3600;
const MAS = ARCSEC / 1000;

/** MJD of J2000.0. */
const MJD_J2000 = 51544.5;
/** Reference epoch of Gaia DR3 positions (Julian year). */
export const GAIA_DR3_EPOCH = 2016.0;
/** 1 AU/yr in km/s (IAU 2012 au, Julian year): converts radial velocity to AU/yr. */
const AU_PER_YR_KMS = 4.740470464;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function wrap360(a) {
  const r = a % 360;
  return r < 0 ? r + 360 : r;
}

function wrap180(a) {
  return wrap360(a + 180) - 180;
}

// ---- time ---------------------------------------------------------------------------------------

/** Julian epoch (decimal year) of an MJD: J2000.0 = MJD 51544.5, 365.25 days per year. */
export function yearFromMjd(mjd) {
  return 2000 + (mjd - MJD_J2000) / 365.25;
}

/** MJD of a Julian epoch (decimal year). */
export function mjdFromYear(year) {
  return MJD_J2000 + (year - 2000) * 365.25;
}

// ---- spherical helpers --------------------------------------------------------------------------

function unitVector(ra, dec) {
  const a = ra * DEG, d = dec * DEG;
  const cd = Math.cos(d);
  return [cd * Math.cos(a), cd * Math.sin(a), Math.sin(d)];
}

function vectorToRaDec(v) {
  return {
    ra: wrap360(Math.atan2(v[1], v[0]) / DEG),
    dec: Math.atan2(v[2], Math.hypot(v[0], v[1])) / DEG,
  };
}

/**
 * Angular separation in arcsec. Vincenty's formula: accurate from milliarcseconds to 180 deg.
 */
export function separationArcsec(ra1, dec1, ra2, dec2) {
  const d1 = dec1 * DEG, d2 = dec2 * DEG, da = (ra2 - ra1) * DEG;
  const s1 = Math.sin(d1), c1 = Math.cos(d1), s2 = Math.sin(d2), c2 = Math.cos(d2);
  const sda = Math.sin(da), cda = Math.cos(da);
  const num = Math.hypot(c2 * sda, c1 * s2 - s1 * c2 * cda);
  const den = s1 * s2 + c1 * c2 * cda;
  return Math.atan2(num, den) / ARCSEC;
}

/**
 * Position angle of point 2 as seen from point 1, degrees east of north, 0..360.
 * (Due north = 0, due east = 90.) Meeus, Astronomical Algorithms, eq. 17.2 rearranged.
 */
export function positionAngle(ra1, dec1, ra2, dec2) {
  const d1 = dec1 * DEG, d2 = dec2 * DEG, da = (ra2 - ra1) * DEG;
  const y = Math.sin(da) * Math.cos(d2);
  const x = Math.cos(d1) * Math.sin(d2) - Math.sin(d1) * Math.cos(d2) * Math.cos(da);
  return wrap360(Math.atan2(y, x) / DEG);
}

/**
 * Move from (ra, dec) by dEast and dNorth arcsec along a great circle: the point at angular
 * distance hypot(dEast, dNorth) in position angle atan2(dEast, dNorth). Exact at any size and
 * the exact inverse of separationArcsec + positionAngle. Positive dEast increases RA.
 * @returns {{ ra: number, dec: number }}
 */
export function offsetBy(ra, dec, dEastArcsec, dNorthArcsec) {
  const dist = Math.hypot(dEastArcsec, dNorthArcsec) * ARCSEC;
  if (!(dist > 0)) return { ra: wrap360(ra), dec };
  const pa = Math.atan2(dEastArcsec, dNorthArcsec);
  const d1 = dec * DEG;
  const sd = Math.sin(d1) * Math.cos(dist) + Math.cos(d1) * Math.sin(dist) * Math.cos(pa);
  const y = Math.sin(pa) * Math.sin(dist) * Math.cos(d1);
  const x = Math.cos(dist) - Math.sin(d1) * sd;
  return {
    ra: wrap360(ra + Math.atan2(y, x) / DEG),
    dec: Math.asin(Math.max(-1, Math.min(1, sd))) / DEG,
  };
}

/**
 * Gnomonic (tangent-plane) offset of (ra, dec) from the tangent point (ra0, dec0), in arcsec.
 * dEast is positive towards increasing RA, dNorth towards increasing Dec. This is the same
 * projection as wcs.js tanProject, so the numbers line up with Grid pixels:
 *   x = (n - 1) / 2 - dEast / scale,   y = (n - 1) / 2 + dNorth / scale.
 * @returns {{ dEast: number, dNorth: number }} NaN beyond 90 deg from the tangent point.
 */
export function tangentOffset(ra, dec, ra0, dec0) {
  const d0 = dec0 * DEG, d = dec * DEG, da = wrap180(ra - ra0) * DEG;
  const sd0 = Math.sin(d0), cd0 = Math.cos(d0), sd = Math.sin(d), cd = Math.cos(d);
  const cosc = sd0 * sd + cd0 * cd * Math.cos(da);
  if (!(cosc > 1e-12)) return { dEast: NaN, dNorth: NaN };
  const h = Math.sin(da / 2);
  return {
    dEast: (cd * Math.sin(da)) / cosc / ARCSEC,
    // cos d0 sin d - sin d0 cos d cos da, written to avoid cancellation for tiny offsets
    dNorth: (Math.sin((dec - dec0) * DEG) + 2 * sd0 * cd * h * h) / cosc / ARCSEC,
  };
}

// ---- propagate ----------------------------------------------------------------------------------

/**
 * Position of a star at a given date from its catalogue position, proper motion and parallax.
 *
 * Proper motion uses the standard model of stellar motion (ESA SP-1200, Hipparcos and Tycho
 * Catalogues vol. 1, section 1.5.5; the same model Gaia uses): the star moves uniformly in a
 * straight line through space. With p the unit vector to the star at the catalogue epoch, q and
 * r the local east and north unit vectors, and t the elapsed Julian years,
 *     b(t) = p * (1 + zeta * t) + (q * pmra + r * pmdec) * t,     u(t) = b / |b|
 * where zeta = radial velocity * parallax / (4.74047 km/s per AU/yr) is the fractional change of
 * distance per year (0 unless star.rv is given, in km/s). Because the motion is applied as a
 * vector and renormalised there is no cos(dec) singularity, no RA wrap problem, and a
 * 10 arcsec/yr star over 30 years is handled exactly. (The naive "add pm * t to RA and Dec"
 * recipe happens to be good to 2 mas for Barnard's Star over 26 years because it sits near the
 * equator, but it degrades as tan(dec) and fails outright near the poles. The radial-velocity
 * term matters more: -110 km/s moves Barnard's Star 0.16 arcsec in 16 years.)
 *
 * Parallax: the apparent direction from the Earth is normalise(u - parallax(t) * E(mjd)) with E
 * the heliocentric Earth position in AU and the parallax in radians, scaled by 1 / |b| because
 * the distance changes along the track. This is the parallax ellipse; see ephemeris.js for the
 * sign conventions and for the (negligible here) Sun-versus-barycentre caveat.
 *
 * @param {{ ra: number, dec: number, pmra?: number|null, pmdec?: number|null,
 *           parallax?: number|null, epoch?: number|null, rv?: number|null }} star
 *   ra, dec in degrees at `epoch` (Julian year; defaults to 2016.0, the Gaia DR3 epoch, because
 *   the /gaia endpoint puts the epoch on the response rather than on each star);
 *   pmra = mu_alpha* and pmdec in mas/yr; parallax in mas. Missing or null values count as zero.
 * @param {number} mjd MJD (UTC)
 * @param {{ parallax?: boolean }} [opts] parallax = false gives the barycentric direction.
 * @returns {{ ra: number, dec: number }} degrees, ra in [0, 360). NaN if the input is unusable.
 */
export function propagate(star, mjd, { parallax = true } = {}) {
  if (!star || !isNum(star.ra) || !isNum(star.dec) || !isNum(mjd)) return { ra: NaN, dec: NaN };
  const epoch = isNum(star.epoch) ? star.epoch : GAIA_DR3_EPOCH;
  const t = yearFromMjd(mjd) - epoch;
  const mua = (isNum(star.pmra) ? star.pmra : 0) * MAS;
  const mud = (isNum(star.pmdec) ? star.pmdec : 0) * MAS;
  const plx = isNum(star.parallax) && star.parallax > 0 ? star.parallax * MAS : 0;
  const zeta = isNum(star.rv) ? (star.rv / AU_PER_YR_KMS) * plx : 0;

  const a = star.ra * DEG, d = star.dec * DEG;
  const sa = Math.sin(a), ca = Math.cos(a), sd = Math.sin(d), cd = Math.cos(d);
  const p = [cd * ca, cd * sa, sd];
  const q = [-sa, ca, 0];                 // east
  const r = [-sd * ca, -sd * sa, cd];     // north
  const f = 1 + zeta * t;
  const b = [
    p[0] * f + (q[0] * mua + r[0] * mud) * t,
    p[1] * f + (q[1] * mua + r[1] * mud) * t,
    p[2] * f + (q[2] * mua + r[2] * mud) * t,
  ];
  const len = Math.hypot(b[0], b[1], b[2]);
  if (!(len > 0)) return { ra: NaN, dec: NaN };
  let u = [b[0] / len, b[1] / len, b[2] / len];

  if (parallax && plx > 0) {
    const E = earthPosition(mjd);
    const k = plx / len;
    u = [u[0] - k * E[0], u[1] - k * E[1], u[2] - k * E[2]];
  }
  return vectorToRaDec(u);
}

// ---- centroid -----------------------------------------------------------------------------------

function medianOf(values) {
  const n = values.length;
  if (n === 0) return NaN;
  const s = Float64Array.from(values).sort();
  return n % 2 ? s[(n - 1) / 2] : 0.5 * (s[n / 2 - 1] + s[n / 2]);
}

/**
 * Sub-pixel position of a source near (x0, y0).
 *
 * Method: the local background is the median of the unmasked pixels in the outer part of the
 * window (robust to the source itself and to neighbours), the noise is 1.4826 * MAD of the same
 * pixels, and the centre is the fixed point of the Gaussian-windowed first moment
 *     x <- x + sum w_i (I_i - bg) (x_i - x) / sum w_i (I_i - bg),   w_i = exp(-r_i^2 / 2 s^2)
 * iterated until it moves less than `tol` pixels (the windowed centroid of SExtractor's
 * XWIN/YWIN, Bertin & Arnouts 1996, without their factor 2 so that it converges for any ratio of
 * window to source width). The window follows the centre, so the answer does not depend on which
 * pixel the first guess fell in, and a neighbour a few pixels away is weighted down.
 *
 * ok is false, and x, y are the input guess, when: fewer than `minValidFrac` of the window
 * pixels are usable; the background-subtracted windowed sum is not positive; the centre walks
 * out of the window; or the windowed signal-to-noise is below `minSnr`.
 *
 * @param {ArrayLike<number>} image row-major, `n` columns (rows = image.length / n)
 * @param {ArrayLike<number>|null} mask same shape, non-zero = unusable (may be null)
 * @param {number} n number of columns (Grid layers are n x n)
 * @param {number} x0 first guess, 0-based pixel
 * @param {number} y0 first guess, 0-based pixel
 * @param {{ box?: number, sigma?: number, maxIter?: number, tol?: number, minSnr?: number,
 *           minValidFrac?: number, noise?: number }} [opts]
 *   box: HALF-width of the square window in pixels; the window is (2*box+1)^2 pixels. Default 5
 *     (33 arcsec across on the default 3.075 arcsec grid: room for a 7.5 arcsec PSF and its sky).
 *   sigma: Gaussian window sigma in pixels, default max(1, box / 4) = 1.25: close to the PSF
 *     sigma on the default grid (1.04 px), where the windowed centroid reaches the Cramer-Rao
 *     bound, and narrow enough that a neighbour 6 px away has no pull.
 *   noise: per-pixel noise if known (same units as image); default is measured from the window.
 * @returns {{ x: number, y: number, flux: number, ok: boolean, snr: number, background: number,
 *             noise: number, xErr: number, yErr: number, fluxErr: number, peak: number,
 *             iterations: number, validFrac: number }}
 *   flux is the background-subtracted sum (image units x pixels) inside the aperture radius
 *   used to separate source from sky (max(box - 2, 0.6 * box) pixels); no aperture correction.
 *   xErr, yErr are 1-sigma noise-propagated errors in pixels (NaN if not computable).
 */
export function centroid(image, mask, n, x0, y0, opts = {}) {
  const box = isNum(opts.box) && opts.box >= 1 ? Math.round(opts.box) : 5;
  const sigma = isNum(opts.sigma) && opts.sigma > 0 ? opts.sigma : Math.max(1, box / 4);
  const maxIter = isNum(opts.maxIter) ? opts.maxIter : 40;
  const tol = isNum(opts.tol) ? opts.tol : 1e-3;
  const minSnr = isNum(opts.minSnr) ? opts.minSnr : 4;
  const minValidFrac = isNum(opts.minValidFrac) ? opts.minValidFrac : 0.5;

  const out = {
    x: x0, y: y0, flux: 0, ok: false, snr: 0, background: NaN, noise: NaN,
    xErr: NaN, yErr: NaN, fluxErr: NaN, peak: NaN, iterations: 0, validFrac: 0,
  };
  if (!image || !(n > 0) || !isNum(x0) || !isNum(y0)) return out;
  const ny = Math.floor(image.length / n);
  const rAp = Math.max(box - 2, 0.6 * box);
  const inv2s2 = 1 / (2 * sigma * sigma);
  const side = 2 * box + 1;
  const px = new Float64Array(side * side);
  const py = new Float64Array(side * side);
  const pv = new Float64Array(side * side);

  let x = x0, y = y0;
  let iterations = 0;
  // Outer loop: re-cut the window if the centre drifts more than a pixel from where it was cut.
  for (let pass = 0; pass < 4; pass++) {
    const cx = Math.round(x), cy = Math.round(y);
    let m = 0;
    for (let yy = cy - box; yy <= cy + box; yy++) {
      if (yy < 0 || yy >= ny) continue;
      for (let xx = cx - box; xx <= cx + box; xx++) {
        if (xx < 0 || xx >= n) continue;
        const i = yy * n + xx;
        if (mask && mask[i]) continue;
        const v = image[i];
        if (!Number.isFinite(v)) continue;
        px[m] = xx; py[m] = yy; pv[m] = v; m++;
      }
    }
    out.validFrac = m / (side * side);
    if (out.validFrac < minValidFrac || m < 9) return out;

    // Background and noise from the outer part of the window.
    const sky = [];
    for (let k = 0; k < m; k++) if (Math.hypot(px[k] - x, py[k] - y) > rAp) sky.push(pv[k]);
    if (sky.length < 8) { sky.length = 0; for (let k = 0; k < m; k++) sky.push(pv[k]); }
    const bg = medianOf(sky);
    let noise = 1.4826 * medianOf(sky.map((v) => Math.abs(v - bg)));
    if (isNum(opts.noise) && opts.noise > 0) noise = opts.noise;
    out.background = bg;
    out.noise = noise;

    let moved = false;
    for (let it = 0; it < maxIter; it++) {
      let sw = 0, sx = 0, sy = 0;
      for (let k = 0; k < m; k++) {
        const dx = px[k] - x, dy = py[k] - y;
        const w = Math.exp(-(dx * dx + dy * dy) * inv2s2) * (pv[k] - bg);
        sw += w; sx += w * dx; sy += w * dy;
      }
      iterations++;
      if (!(sw > 0)) { out.iterations = iterations; return out; }
      let dx = sx / sw, dy = sy / sw;
      const step = Math.hypot(dx, dy);
      if (step > 1) { dx /= step; dy /= step; }   // never jump more than a pixel at a time
      x += dx; y += dy;
      if (Math.abs(x - x0) > box || Math.abs(y - y0) > box) { out.iterations = iterations; return out; }
      if (step < tol) break;
      if (pass < 3 && (Math.abs(x - cx) > 1 || Math.abs(y - cy) > 1)) { moved = true; break; }
    }
    if (moved) continue;

    // Converged in this window: signal-to-noise, flux and error estimate.
    let sw = 0, sw2 = 0, flux = 0, nAp = 0, peak = -Infinity;
    let gx = 0, gy = 0, vx = 0, vy = 0;
    const is2 = 1 / (sigma * sigma);
    for (let k = 0; k < m; k++) {
      const dx = px[k] - x, dy = py[k] - y;
      const d = pv[k] - bg;
      const w = Math.exp(-(dx * dx + dy * dy) * inv2s2);
      sw += w * d; sw2 += w * w;
      // Error propagation of the fixed point g(x) = sum w d (x_i - x) = 0:
      //   dg/dx = -sum w d (1 - dx^2 / s^2),   var(g) = noise^2 sum w^2 dx^2.
      gx += w * d * (1 - dx * dx * is2); gy += w * d * (1 - dy * dy * is2);
      vx += w * w * dx * dx; vy += w * w * dy * dy;
      if (dx * dx + dy * dy <= rAp * rAp) { flux += d; nAp++; if (d > peak) peak = d; }
    }
    out.iterations = iterations;
    out.flux = flux;
    out.peak = peak;
    out.fluxErr = noise * Math.sqrt(nAp);
    out.snr = noise > 0 ? sw / (noise * Math.sqrt(sw2)) : (sw > 0 ? Infinity : 0);
    out.xErr = gx > 0 ? (noise * Math.sqrt(vx)) / gx : NaN;
    out.yErr = gy > 0 ? (noise * Math.sqrt(vy)) / gy : NaN;
    if (!(out.snr >= minSnr)) return out;
    out.x = x; out.y = y; out.ok = true;
    return out;
  }
  out.iterations = iterations;
  return out;
}

/**
 * Rule-of-thumb 1-sigma centroid error per axis, in pixels, for a Gaussian PSF in
 * background-limited noise: the Cramer-Rao bound sigma_x = sqrt(2) * sigma_psf / SNR
 * = 0.60 * FWHM / SNR (King 1983, PASP 95, 163; Condon 1997, PASP 109, 166), with SNR the
 * matched-filter signal-to-noise that centroid() returns. A floor is added in quadrature for
 * what noise does not describe: SPHEREx is undersampled (7.5 arcsec FWHM on 6.15 arcsec pixels)
 * and layers have been bilinearly resampled, so do not trust positions to better than a few
 * hundredths of a pixel whatever the SNR.
 * @param {number} snr signal-to-noise of the detection
 * @param {number} [fwhmPix] PSF FWHM in the pixels of the image measured (default 2.44 =
 *   7.5 arcsec on the 3.075 arcsec grid)
 * @param {{ floor?: number }} [opts] systematic floor in pixels, default 0.05
 * @returns {number} pixels; Infinity when snr is not positive
 */
export function centroidError(snr, fwhmPix = 2.44, { floor = 0.05 } = {}) {
  if (!(snr > 0) || !(fwhmPix > 0)) return Infinity;
  const stat = (Math.SQRT2 * fwhmPix) / (2.3548200450309493 * snr);
  return Math.hypot(stat, floor);
}

// ---- motion fit ---------------------------------------------------------------------------------

/** Solve A x = b for a small dense system (Gauss-Jordan, partial pivoting); also inverts A. */
function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => {
    const r = new Float64Array(2 * n + 1);
    for (let j = 0; j < n; j++) r[j] = row[j];
    r[n + i] = 1;
    r[2 * n] = b[i];
    return r;
  });
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (!(Math.abs(M[piv][c]) > 1e-300)) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    const d = M[c][c];
    for (let j = 0; j <= 2 * n; j++) M[c][j] /= d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c];
      if (f === 0) continue;
      for (let j = 0; j <= 2 * n; j++) M[r][j] -= f * M[c][j];
    }
  }
  return {
    x: M.map((r) => r[2 * n]),
    inv: M.map((r) => Array.from(r.subarray(n, 2 * n))),
  };
}

function emptyMotion(n) {
  return {
    pmra: NaN, pmdec: NaN, total: NaN, paDeg: NaN, errTotal: NaN, n,
    errPmra: NaN, errPmdec: NaN, errPaDeg: NaN, ra0: NaN, dec0: NaN, mjd0: NaN,
    chi2: NaN, dof: 0, rmsArcsec: NaN, parallax: null, errParallax: null,
  };
}

/**
 * Shared engine for fitMotion and fitMotionWithParallax.
 *
 * Model, in the tangent plane about the weighted mean position (ra0, dec0), with t in Julian
 * years from the weighted mean date mjd0 and offsets in arcsec:
 *     east_i  = e0 + pmra  * t_i [+ parallax * pra_i ]
 *     north_i = n0 + pmdec * t_i [+ parallax * pdec_i]
 * solved by weighted linear least squares (normal equations). pra, pdec are the parallax
 * factors of ephemeris.js at each date.
 *
 * Weights: point.sigma (arcsec, 1-sigma per axis) if present, giving w = 1 / sigma^2; otherwise
 * point.w, read as an inverse variance in arcsec^-2; otherwise 1.
 * Errors: if every point carried a sigma or w, the formal errors of the fit are used, inflated by
 * sqrt(chi2 / dof) when the scatter is larger than the weights claim. If no point carried a
 * weight, errors come from the scatter alone (chi2 / dof with unit weights), and are NaN when
 * there are no degrees of freedom (two points define a line exactly: no error estimate exists).
 */
function fitTangentModel(points, withParallax) {
  const pts = [];
  let allWeighted = true;
  for (const p of points || []) {
    if (!p || !isNum(p.mjd) || !isNum(p.ra) || !isNum(p.dec)) continue;
    let w = 1;
    if (isNum(p.sigma) && p.sigma > 0) w = 1 / (p.sigma * p.sigma);
    else if (isNum(p.w) && p.w > 0) w = p.w;
    else if (isNum(p.w) && p.w <= 0) continue;   // explicit zero weight: skip the point
    else allWeighted = false;
    pts.push({ mjd: p.mjd, ra: p.ra, dec: p.dec, w });
  }
  const n = pts.length;
  const out = emptyMotion(n);
  if (n < 2) return out;

  // Reference point and date: weighted means (position via unit vectors, so RA wrap is harmless).
  let sw = 0, mx = 0, my = 0, mz = 0, mt = 0;
  for (const p of pts) {
    const u = unitVector(p.ra, p.dec);
    sw += p.w; mx += p.w * u[0]; my += p.w * u[1]; mz += p.w * u[2]; mt += p.w * p.mjd;
  }
  const ref = vectorToRaDec([mx, my, mz]);
  const mjd0 = mt / sw;
  out.ra0 = ref.ra; out.dec0 = ref.dec; out.mjd0 = mjd0;

  const np = withParallax ? 5 : 4;   // e0, n0, pmra, pmdec [, parallax]
  const N = Array.from({ length: np }, () => new Array(np).fill(0));
  const rhs = new Array(np).fill(0);
  const rows = [];
  for (const p of pts) {
    const off = tangentOffset(p.ra, p.dec, ref.ra, ref.dec);
    if (!isNum(off.dEast) || !isNum(off.dNorth)) continue;
    const t = (p.mjd - mjd0) / 365.25;
    const f = withParallax ? parallaxFactors(ref.ra, ref.dec, p.mjd) : null;
    const rowE = [1, 0, t, 0], rowN = [0, 1, 0, t];
    if (withParallax) { rowE.push(f.pra); rowN.push(f.pdec); }
    rows.push({ row: rowE, y: off.dEast, w: p.w }, { row: rowN, y: off.dNorth, w: p.w });
  }
  for (const { row, y, w } of rows) {
    for (let i = 0; i < np; i++) {
      rhs[i] += w * row[i] * y;
      for (let j = 0; j < np; j++) N[i][j] += w * row[i] * row[j];
    }
  }
  // Refuse a degenerate design (all points at one date, or parallax not separable from motion).
  let span = 0;
  for (const p of pts) span = Math.max(span, Math.abs(p.mjd - mjd0));
  if (!(span > 0)) return out;
  const sol = solveLinear(N, rhs);
  if (!sol) return out;
  if (withParallax) {
    // Condition check (variance inflation factor): parallax must not be (nearly) a combination
    // of an offset and a straight line, as it is when all the data sit in only two passes.
    const ok = sol.inv[4][4] > 0 && sol.inv[4][4] * N[4][4] < 1e3;
    if (!ok) return out;
  }

  let chi2 = 0, ss = 0;
  for (const { row, y, w } of rows) {
    let model = 0;
    for (let i = 0; i < np; i++) model += row[i] * sol.x[i];
    chi2 += w * (y - model) * (y - model);
    ss += (y - model) * (y - model);
  }
  const dof = rows.length - np;
  let scale;
  if (allWeighted) scale = dof > 0 ? Math.max(1, chi2 / dof) : 1;
  else scale = dof > 0 ? chi2 / dof : NaN;

  const pmra = sol.x[2] * 1000, pmdec = sol.x[3] * 1000;          // arcsec/yr -> mas/yr
  const vA = sol.inv[2][2] * scale * 1e6, vD = sol.inv[3][3] * scale * 1e6;
  const cAD = sol.inv[2][3] * scale * 1e6;
  const total = Math.hypot(pmra, pmdec);
  out.pmra = pmra; out.pmdec = pmdec; out.total = total;
  out.paDeg = wrap360(Math.atan2(pmra, pmdec) / DEG);
  out.errPmra = Math.sqrt(vA); out.errPmdec = Math.sqrt(vD);
  if (total > 0) {
    // First-order propagation to the speed and to the direction.
    out.errTotal = Math.sqrt(Math.max(0, pmra * pmra * vA + pmdec * pmdec * vD + 2 * pmra * pmdec * cAD)) / total;
    out.errPaDeg = Math.sqrt(Math.max(0, pmdec * pmdec * vA + pmra * pmra * vD - 2 * pmra * pmdec * cAD)) / (total * total) / DEG;
  } else {
    out.errTotal = Math.sqrt((vA + vD) / 2);
  }
  out.chi2 = chi2; out.dof = dof;
  out.rmsArcsec = Math.sqrt(ss / rows.length);
  if (withParallax) {
    out.parallax = sol.x[4] * 1000;
    out.errParallax = Math.sqrt(sol.inv[4][4] * scale) * 1000;
  }
  return out;
}

/**
 * Proper motion from a set of dated positions: weighted straight-line fit in the tangent plane.
 * @param {Array<{ mjd: number, ra: number, dec: number, w?: number, sigma?: number }>} points
 *   w is an inverse variance in arcsec^-2 (or give sigma in arcsec instead). See fitTangentModel
 *   for how errors are derived.
 * @returns {{ pmra: number, pmdec: number, total: number, paDeg: number, errTotal: number, n: number,
 *   errPmra: number, errPmdec: number, errPaDeg: number, ra0: number, dec0: number, mjd0: number,
 *   chi2: number, dof: number, rmsArcsec: number, parallax: null, errParallax: null }}
 *   pmra (= mu_alpha*, east) and pmdec (north) in mas/yr, total speed in mas/yr, paDeg the
 *   direction of motion east of north. (ra0, dec0) at mjd0 is the fitted reference: the object
 *   sits within the fit residual of it at that date. All NaN (with n set) if fewer than two
 *   usable points or no time span. Note the fit absorbs parallax into the motion: with SPHEREx's
 *   six-monthly passes the parallax shift alternates sign and biases a two-pass motion by up to
 *   4 * parallax per year. Use fitMotionWithParallax when three or more passes exist.
 */
export function fitMotion(points) {
  return fitTangentModel(points, false);
}

/**
 * Like fitMotion but also solves for the parallax (mas) when the data allow it: the points must
 * span at least three epochs (groups of dates separated by more than `gapDays`, the same rule
 * as frames.js splitPasses), because within two passes the parallax shift is indistinguishable
 * from extra proper motion. Falls back to the plain fitMotion result (parallax: null) otherwise.
 * @param {Array<{ mjd: number, ra: number, dec: number, w?: number, sigma?: number }>} points
 * @param {{ gapDays?: number }} [opts] default 45
 * @returns same shape as fitMotion, with parallax and errParallax in mas when fitted.
 */
export function fitMotionWithParallax(points, { gapDays = 45 } = {}) {
  const usable = (points || []).filter((p) => p && isNum(p.mjd) && isNum(p.ra) && isNum(p.dec));
  const dates = usable.map((p) => p.mjd).sort((a, b) => a - b);
  let epochs = dates.length ? 1 : 0;
  for (let i = 1; i < dates.length; i++) if (dates[i] - dates[i - 1] > gapDays) epochs++;
  if (epochs >= 3) {
    const fit = fitTangentModel(points, true);
    if (isNum(fit.pmra) && isNum(fit.parallax)) return fit;
  }
  return fitTangentModel(points, false);
}

// ---- catalogue matching -------------------------------------------------------------------------

/**
 * Nearest catalogue star to (ra, dec) at date mjd, with every star first moved to that date.
 * @param {Array<object>} stars as returned by the /gaia endpoint (ra, dec, pmra, pmdec, parallax);
 *   a star without its own `epoch` is taken to be at opts.epoch (default 2016.0, Gaia DR3).
 * @param {number} ra  deg @param {number} dec deg @param {number} mjd MJD (UTC)
 * @param {number} tolArcsec matching radius
 * @param {{ epoch?: number, parallax?: boolean }} [opts]
 * @returns {{ star: object, sepArcsec: number, ra: number, dec: number, index: number } | null}
 *   the winning star, its separation and its position at mjd.
 */
export function matchGaiaDetailed(stars, ra, dec, mjd, tolArcsec, opts = {}) {
  if (!Array.isArray(stars) || !isNum(ra) || !isNum(dec)) return null;
  const epoch = isNum(opts.epoch) ? opts.epoch : GAIA_DR3_EPOCH;
  const parallax = opts.parallax !== false;
  let best = null;
  for (let i = 0; i < stars.length; i++) {
    const s = stars[i];
    if (!s || !isNum(s.ra) || !isNum(s.dec)) continue;
    const at = isNum(s.epoch) ? s : { ...s, epoch };
    const pos = propagate(at, mjd, { parallax });
    const sep = separationArcsec(ra, dec, pos.ra, pos.dec);
    if (sep <= tolArcsec && (!best || sep < best.sepArcsec)) {
      best = { star: s, sepArcsec: sep, ra: pos.ra, dec: pos.dec, index: i };
    }
  }
  return best;
}

/**
 * Contract form of the matcher: returns the matching star object itself (the same reference that
 * is in `stars`), or null. Use matchGaiaDetailed for the separation and propagated position.
 */
export function matchGaia(stars, ra, dec, mjd, tolArcsec, opts = {}) {
  const m = matchGaiaDetailed(stars, ra, dec, mjd, tolArcsec, opts);
  return m ? m.star : null;
}
