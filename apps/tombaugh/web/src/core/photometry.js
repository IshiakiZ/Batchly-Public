// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

// Aperture photometry on NATIVE frames, spectra and light curves.
//
// Photometry is done on the original detector pixels, not on the resampled grid: resampling
// correlates neighbouring pixels, which would make the summed variance wrong. Each native frame
// gives one flux at one wavelength, so ~84 frames per detector trace out a spectrum; and because
// every exposure is a different colour, brightness changes over time are measured relative to
// a smooth fit of that spectrum (lightCurve).
//
// SPHEREx is undersampled: the PSF (FWHM about 7.5 arcsec) is barely wider than a pixel (6.15
// arcsec). The default 1.6 pixel aperture therefore misses about 5% of a star's light, and the
// exact amount changes by a percent or two with where inside a pixel the star happens to sit,
// which differs in every exposure. aperturePhot corrects for this: it computes the fraction of
// a Gaussian PSF of the frame's own width (frame.psfFwhm), integrated over pixels exactly as
// the detector does, that the same weighted aperture would catch at the same sub-pixel
// position, and divides by it. The correction assumes a point source and a Gaussian core; the
// real PSF has faint wings, so absolute fluxes can still be low by a few percent, while ratios
// within one source (colours, band depths, light curves) are much less affected.

import { makeWcs } from './wcs.js';
import { DETECTORS, channelOf, channelRange, detOf } from './frames.js';
import { medianInPlace } from './stack.js';

/** 1 MJy/sr over one 6.15 arcsec SPHEREx pixel, in microjansky. */
export const MJYSR_TO_UJY_PER_PIX = 889;

/** Flag bits that make a pixel unusable for science (contract default). */
export const PHOT_BAD_BITS = [0, 1, 2, 6, 9, 10, 11, 15, 17, 19, 25, 26, 27];
export const PHOT_BAD_MASK = PHOT_BAD_BITS.reduce((m, b) => m | (1 << b), 0);

const MAD_TO_SIGMA = 1.4826;
const SUB = 5; // sub-pixel sampling per axis for the aperture edge
const PIXEL_ARCSEC = 6.15;
const FWHM_TO_SIGMA = 1 / (2 * Math.sqrt(2 * Math.LN2));

/** Error function (Abramowitz & Stegun 7.1.26, absolute error below 1.5e-7). */
function erf(x) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x < 0 ? -y : y;
}

/** Fraction of a 1-D Gaussian (centre c, 1/(sqrt2 sigma) = a) falling in pixel k (k-0.5..k+0.5). */
function pixelFraction(k, c, a) {
  return 0.5 * (erf((k + 0.5 - c) * a) - erf((k - 0.5 - c) * a));
}

function failed(frame, extra) {
  return {
    flux_uJy: NaN, err_uJy: NaN, wave: NaN, bw: NaN,
    mjd: frame ? frame.mjd : NaN, det: frame ? frame.det : 0, id: frame ? frame.id : undefined,
    flagged: true, ok: false, ...extra,
  };
}

/** Bilinear sample of a row-major array at fractional pixel (x, y); nearest pixel at the edges. */
function sampleAt(arr, nx, ny, x, y) {
  if (!arr) return NaN;
  const x0 = Math.min(nx - 1, Math.max(0, Math.floor(x)));
  const y0 = Math.min(ny - 1, Math.max(0, Math.floor(y)));
  const x1 = Math.min(nx - 1, x0 + 1);
  const y1 = Math.min(ny - 1, y0 + 1);
  const fx = Math.min(1, Math.max(0, x - x0));
  const fy = Math.min(1, Math.max(0, y - y0));
  const a = arr[y0 * nx + x0];
  const b = arr[y0 * nx + x1];
  const c = arr[y1 * nx + x0];
  const d = arr[y1 * nx + x1];
  const v = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  return Number.isFinite(v) ? v : arr[Math.round(Math.min(ny - 1, Math.max(0, y))) * nx + Math.round(Math.min(nx - 1, Math.max(0, x)))];
}

/**
 * Aperture photometry of one sky position on one native frame.
 *
 *   1. (ra, dec) -> pixel with the frame's TAN-SIP WCS.
 *   2. Sum (image - zodi) over a circular aperture of radius rPix. Edge pixels count by the
 *      fraction of their area inside the circle, measured on a 5 x 5 sub-pixel lattice.
 *   3. Local background = sigma-clipped median of the unflagged pixels in the annulus
 *      rIn..rOut, subtracted per aperture pixel.
 *   4. Convert MJy/sr x pixels to microjansky (889 uJy per MJy/sr per pixel).
 *   5. Error^2 = sum of (pixel fraction)^2 x pipeline variance over the aperture
 *              + (aperture area)^2 x (pi/2) x annulus scatter^2 / annulus pixels
 *      (the second term is the uncertainty of the median background).
 *   6. Point-source aperture correction (see the top of this file): divide flux and error by
 *      `apcor`, the fraction of a pixel-integrated Gaussian PSF of FWHM frame.psfFwhm (arcsec)
 *      that these aperture weights catch at this sub-pixel position. Skipped (apcor = 1) when
 *      the frame has no PSF width or opts.apCorr is false.
 *
 * Returns { flux_uJy, err_uJy, wave, bw, mjd, flagged, ok } plus det, id, x, y (0-based pixel
 * position), bg (MJy/sr), nAnnulus, npix (aperture area in pixels), apcor.
 *   ok       false when the position is not finite or the aperture is not entirely on the frame
 *   flagged  true when any aperture pixel has a bad flag bit or a non-finite value
 *   wave/bw  wavelength at the position (bilinear in frame.wave) and the channel bandwidth
 *            there (frame.bwCenter scaled by wave / waveCenter: constant resolving power)
 *
 * Options: rPix = 1.6, rIn = 3.5, rOut = 6 (pixels), badMask (default PHOT_BAD_MASK),
 * subtractZodi (default true), apCorr (default true), wcsFactory (default makeWcs; for tests
 * and custom WCS).
 */
export function aperturePhot(frame, ra, dec, opts = {}) {
  const {
    rPix = 1.6, rIn = 3.5, rOut = 6, badMask = PHOT_BAD_MASK, subtractZodi = true,
    apCorr = true, wcsFactory = makeWcs,
  } = opts;
  if (!frame || !frame.image || !(frame.nx > 0) || !(frame.ny > 0)) return failed(frame);
  const { nx, ny, image } = frame;
  const variance = frame.variance || null;
  const zodi = subtractZodi ? frame.zodi || null : null;
  const flags = frame.flags || null;

  let x0 = NaN;
  let y0 = NaN;
  try {
    [x0, y0] = wcsFactory(frame.wcs).skyToPix(ra, dec);
  } catch {
    return failed(frame);
  }
  if (!Number.isFinite(x0) || !Number.isFinite(y0)) return failed(frame);
  // The aperture circle must lie inside the pixel array (pixel k covers k - 0.5 .. k + 0.5).
  if (x0 - rPix < -0.5 || y0 - rPix < -0.5 || x0 + rPix > nx - 0.5 || y0 + rPix > ny - 0.5) {
    return failed(frame, { x: x0, y: y0 });
  }

  // ---- Local background from the annulus ------------------------------------------------------
  const xa = Math.max(0, Math.floor(x0 - rOut));
  const xb = Math.min(nx - 1, Math.ceil(x0 + rOut));
  const ya = Math.max(0, Math.floor(y0 - rOut));
  const yb = Math.min(ny - 1, Math.ceil(y0 + rOut));
  const ann = new Float64Array((xb - xa + 1) * (yb - ya + 1));
  const buf = new Float64Array(ann.length);
  let nAnn = 0;
  for (let y = ya; y <= yb; y++) {
    for (let x = xa; x <= xb; x++) {
      const r2 = (x - x0) * (x - x0) + (y - y0) * (y - y0);
      if (r2 < rIn * rIn || r2 >= rOut * rOut) continue;
      const i = y * nx + x;
      if (flags && (flags[i] & badMask) !== 0) continue;
      const v = image[i] - (zodi ? zodi[i] : 0);
      if (Number.isFinite(v)) ann[nAnn++] = v;
    }
  }
  let bg = 0;
  let bgSigma = 0;
  for (let round = 0; round < 5 && nAnn > 0; round++) {
    for (let j = 0; j < nAnn; j++) buf[j] = ann[j];
    bg = medianInPlace(buf, nAnn);
    for (let j = 0; j < nAnn; j++) buf[j] = Math.abs(ann[j] - bg);
    bgSigma = MAD_TO_SIGMA * medianInPlace(buf, nAnn);
    const lim = 3 * bgSigma;
    let kept = 0;
    for (let j = 0; j < nAnn; j++) if (Math.abs(ann[j] - bg) <= lim) ann[kept++] = ann[j];
    if (kept === nAnn || kept < 5) break;
    nAnn = kept;
  }

  // ---- Aperture sum with sub-pixel edge weights -----------------------------------------------
  let sum = 0;
  let area = 0;
  let varSum = 0;
  let caught = 0; // fraction of the model PSF inside the weighted aperture
  let flagged = false;
  const r2max = rPix * rPix;
  const psfSigma = frame.psfFwhm > 0 && Number.isFinite(frame.psfFwhm)
    ? frame.psfFwhm / PIXEL_ARCSEC * FWHM_TO_SIGMA : 0;
  const psfA = psfSigma > 0 ? 1 / (Math.SQRT2 * psfSigma) : 0;
  for (let y = Math.floor(y0 - rPix); y <= Math.ceil(y0 + rPix); y++) {
    for (let x = Math.floor(x0 - rPix); x <= Math.ceil(x0 + rPix); x++) {
      let inside = 0;
      for (let sy = 0; sy < SUB; sy++) {
        const dy = y + (sy + 0.5) / SUB - 0.5 - y0;
        for (let sx = 0; sx < SUB; sx++) {
          const dx = x + (sx + 0.5) / SUB - 0.5 - x0;
          if (dx * dx + dy * dy <= r2max) inside++;
        }
      }
      if (!inside) continue;
      const f = inside / (SUB * SUB);
      if (x < 0 || y < 0 || x >= nx || y >= ny) { flagged = true; continue; }
      const i = y * nx + x;
      const v = image[i] - (zodi ? zodi[i] : 0);
      if (!Number.isFinite(v)) { flagged = true; continue; }
      if (flags && (flags[i] & badMask) !== 0) flagged = true;
      sum += f * v;
      area += f;
      if (psfA > 0) caught += f * pixelFraction(x, x0, psfA) * pixelFraction(y, y0, psfA);
      const pv = variance ? variance[i] : NaN;
      varSum += f * f * (pv > 0 && Number.isFinite(pv) ? pv : bgSigma * bgSigma);
    }
  }
  if (!(area > 0)) return failed(frame, { x: x0, y: y0 });

  const apcor = apCorr && caught > 0.2 ? caught : 1; // below 0.2 the model clearly does not apply
  const net = (sum - bg * area) / apcor;
  const bgVar = nAnn > 0 ? area * area * (Math.PI / 2) * bgSigma * bgSigma / nAnn : 0;
  const wave = sampleAt(frame.wave, nx, ny, x0, y0);
  const waveAt = Number.isFinite(wave) && wave > 0 ? wave : frame.waveCenter;
  let bw = frame.bwCenter;
  if (bw > 0 && frame.waveCenter > 0 && waveAt > 0) bw = bw * waveAt / frame.waveCenter;
  return {
    flux_uJy: net * MJYSR_TO_UJY_PER_PIX,
    err_uJy: Math.sqrt(varSum + bgVar) / apcor * MJYSR_TO_UJY_PER_PIX,
    wave: waveAt,
    bw: Number.isFinite(bw) ? bw : NaN,
    mjd: frame.mjd,
    det: frame.det,
    id: frame.id,
    flagged,
    ok: true,
    x: x0,
    y: y0,
    bg,
    nAnnulus: nAnn,
    npix: area,
    apcor,
  };
}

/**
 * Spectrum of one sky position: aperture photometry on every native frame, sorted by
 * wavelength. Frames on which the aperture falls off the array are left out (set
 * opts.keepFailed to keep them, with ok = false and NaN flux).
 *
 * opts are passed to aperturePhot. opts.track, if given, is a function mjd -> { ra, dec } that
 * overrides the position per frame, so a fast-moving star can be followed.
 */
export function extractSpectrum(frames, ra, dec, opts = {}) {
  const points = [];
  for (const frame of frames || []) {
    if (!frame) continue;
    let r = ra;
    let d = dec;
    if (typeof opts.track === 'function') {
      const pos = opts.track(frame.mjd);
      if (pos && Number.isFinite(pos.ra) && Number.isFinite(pos.dec)) { r = pos.ra; d = pos.dec; }
    }
    const p = aperturePhot(frame, r, d, opts);
    if (p.ok || opts.keepFailed) points.push(p);
  }
  points.sort((a, b) => (Number.isFinite(a.wave) ? a.wave : Infinity) - (Number.isFinite(b.wave) ? b.wave : Infinity));
  return points;
}

function usablePoint(p) {
  return p && p.ok !== false && !p.flagged && Number.isFinite(p.flux_uJy) && p.err_uJy > 0
    && Number.isFinite(p.err_uJy) && p.wave > 0 && Number.isFinite(p.wave);
}

function pointDet(p) {
  return p.det >= 1 && p.det <= DETECTORS.length ? p.det : detOf(p.wave);
}

/**
 * Bin a spectrum. With perChannel (default) there is one output point per spectral channel
 * (17 per detector) that has data; with perChannel = false, one point per detector.
 *
 * Per bin: drop flagged and failed points; reject points more than 4 sigma from the bin median,
 * where sigma^2 = the point's own error^2 + any excess scatter of the bin (MAD-based, so real
 * spectral slope across the bin or pixel-phase jitter is not mistaken for outliers); then take
 * the inverse-variance weighted mean. The error is the error of that mean, inflated by
 * sqrt(chi2 / (n - 1)) when the points scatter more than their errors say.
 *
 * Output points: { wave (weighted mean), bw (bin width in um), flux_uJy, err_uJy, mjd (mean),
 * det, ch (channel, or -1), n, nRejected, flagged: false, ok: true }, sorted by wavelength.
 */
export function binSpectrum(points, { perChannel = true } = {}) {
  const bins = new Map();
  for (const p of points || []) {
    if (!usablePoint(p)) continue;
    const det = pointDet(p);
    const ch = perChannel ? channelOf(det, p.wave) : -1;
    const key = det * 100 + ch;
    if (!bins.has(key)) bins.set(key, { det, ch, pts: [] });
    bins.get(key).pts.push(p);
  }
  const out = [];
  for (const { det, ch, pts } of bins.values()) {
    const n0 = pts.length;
    const buf = new Float64Array(n0);
    for (let j = 0; j < n0; j++) buf[j] = pts[j].flux_uJy;
    const med = medianInPlace(buf, n0);
    let meanVar = 0;
    for (let j = 0; j < n0; j++) {
      buf[j] = Math.abs(pts[j].flux_uJy - med);
      meanVar += pts[j].err_uJy * pts[j].err_uJy / n0;
    }
    const sigma = MAD_TO_SIGMA * medianInPlace(buf, n0);
    const excess = n0 >= 3 ? Math.max(0, sigma * sigma - meanVar) : 0;
    const kept = n0 >= 3
      ? pts.filter((p) => (p.flux_uJy - med) ** 2 <= 16 * (p.err_uJy * p.err_uJy + excess))
      : pts;

    let sw = 0, swf = 0, swl = 0, smjd = 0;
    for (const p of kept) {
      const w = 1 / (p.err_uJy * p.err_uJy);
      sw += w;
      swf += w * p.flux_uJy;
      swl += w * p.wave;
      smjd += p.mjd;
    }
    const flux = swf / sw;
    let chi2 = 0;
    for (const p of kept) chi2 += ((p.flux_uJy - flux) / p.err_uJy) ** 2;
    const inflate = kept.length > 1 ? Math.max(1, Math.sqrt(chi2 / (kept.length - 1))) : 1;
    const range = perChannel ? channelRange(det, ch) : [DETECTORS[det - 1].min, DETECTORS[det - 1].max];
    out.push({
      wave: swl / sw,
      bw: range[1] - range[0],
      flux_uJy: flux,
      err_uJy: inflate / Math.sqrt(sw),
      mjd: smjd / kept.length,
      det,
      ch,
      n: kept.length,
      nRejected: n0 - kept.length,
      flagged: false,
      ok: true,
    });
  }
  out.sort((a, b) => a.wave - b.wave);
  return out;
}

/**
 * Robust weighted polynomial fit y(x) of the given order (0..2): iteratively reweighted least
 * squares with Huber weights and a hard cut at 3.5 robust sigma. Returns the coefficients
 * (length 3, zero-padded).
 */
function robustPolyFit(x, y, w, order) {
  const n = x.length;
  const g = new Float64Array(n).fill(1);
  const buf = new Float64Array(n);
  let c = [0, 0, 0];
  for (let round = 0; round < 5; round++) {
    // Normal equations A c = b for the monomial basis, solved by Gaussian elimination.
    const K = order + 1;
    const A = Array.from({ length: K }, () => new Float64Array(K + 1));
    for (let i = 0; i < n; i++) {
      const wi = w[i] * g[i];
      if (!(wi > 0)) continue;
      const xi = x[i];
      const pow = [1, xi, xi * xi, xi * xi * xi, xi * xi * xi * xi];
      for (let r = 0; r < K; r++) {
        for (let q = 0; q < K; q++) A[r][q] += wi * pow[r + q];
        A[r][K] += wi * y[i] * pow[r];
      }
    }
    for (let r = 1; r < K; r++) A[r][r] += 1e-9 * A[0][0]; // keeps degenerate inputs solvable
    let ok = true;
    for (let col = 0; col < K && ok; col++) {
      let piv = col;
      for (let r = col + 1; r < K; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
      if (!(Math.abs(A[piv][col]) > 0)) { ok = false; break; }
      [A[col], A[piv]] = [A[piv], A[col]];
      for (let r = 0; r < K; r++) {
        if (r === col) continue;
        const f = A[r][col] / A[col][col];
        for (let q = col; q <= K; q++) A[r][q] -= f * A[col][q];
      }
    }
    if (!ok) break;
    c = [0, 0, 0];
    for (let r = 0; r < K; r++) c[r] = A[r][K] / A[r][r];

    // Robust weights from the normalised residuals.
    for (let i = 0; i < n; i++) buf[i] = (y[i] - (c[0] + x[i] * (c[1] + x[i] * c[2]))) * Math.sqrt(w[i]);
    const z = Float64Array.from(buf);
    const med = medianInPlace(buf, n);
    for (let i = 0; i < n; i++) buf[i] = Math.abs(z[i] - med);
    const S = Math.max(1, MAD_TO_SIGMA * medianInPlace(buf, n));
    for (let i = 0; i < n; i++) {
      const t = Math.abs(z[i] - med) / S;
      g[i] = t > 3.5 ? 0 : t <= 1.345 ? 1 : 1.345 / t;
    }
  }
  return c;
}

/**
 * Smooth model of a point spectrum: for each detector, a robust low-order polynomial in
 * ln(wavelength) through the unflagged points (order 2 with >= 8 points, 1 with >= 4, 0 with
 * >= 2). The robust fit follows the majority, so a pass in which the source was brighter
 * stands out against the model instead of bending it.
 *
 * Returns { dets: Map<det, { lnw0, coeffs, n, min, max }>, evaluate(wave, det?) -> uJy (NaN
 * where there is no model), curve(perDet = 24) -> [{ wave, flux_uJy, det }] for plotting }.
 */
export function fitSpectrumModel(points) {
  const groups = new Map();
  for (const p of points || []) {
    if (!usablePoint(p)) continue;
    const det = pointDet(p);
    if (!groups.has(det)) groups.set(det, []);
    groups.get(det).push(p);
  }
  const dets = new Map();
  for (const [det, pts] of groups) {
    if (pts.length < 2) continue;
    const ln = pts.map((p) => Math.log(p.wave));
    const lnw0 = ln.reduce((a, b) => a + b, 0) / ln.length;
    const x = Float64Array.from(ln, (v) => v - lnw0);
    const y = Float64Array.from(pts, (p) => p.flux_uJy);
    const w = Float64Array.from(pts, (p) => 1 / (p.err_uJy * p.err_uJy));
    const order = pts.length >= 8 ? 2 : pts.length >= 4 ? 1 : 0;
    let min = Infinity;
    let max = -Infinity;
    for (const p of pts) { if (p.wave < min) min = p.wave; if (p.wave > max) max = p.wave; }
    dets.set(det, { lnw0, coeffs: robustPolyFit(x, y, w, order), n: pts.length, min, max });
  }
  function evaluate(wave, det) {
    const m = dets.get(det >= 1 ? det : detOf(wave));
    if (!m || !(wave > 0)) return NaN;
    const t = Math.log(wave) - m.lnw0;
    return m.coeffs[0] + t * (m.coeffs[1] + t * m.coeffs[2]);
  }
  function curve(perDet = 24) {
    const out = [];
    for (const [det, m] of [...dets.entries()].sort((a, b) => a[0] - b[0])) {
      for (let k = 0; k < perDet; k++) {
        const wave = m.min * Math.pow(m.max / m.min, perDet > 1 ? k / (perDet - 1) : 0);
        out.push({ wave, flux_uJy: evaluate(wave, det), det });
      }
    }
    return out;
  }
  return { dets, evaluate, curve };
}

/**
 * Light curve of a source whose every measurement is at a different wavelength: divide each
 * flux by the smooth spectrum model (fitSpectrumModel) at its wavelength. A steady source gives
 * ratio 1 at all times whatever its colour; a variable one departs from 1.
 *
 * Returns [{ mjd, ratio, err, wave, det, flux_uJy, model_uJy }] sorted by time. Flagged and
 * failed points are left out, as are points where the model is not positive (the ratio is
 * meaningless for an undetected source).
 */
export function lightCurve(points) {
  const model = fitSpectrumModel(points);
  const out = [];
  for (const p of points || []) {
    if (!usablePoint(p)) continue;
    const det = pointDet(p);
    const m = model.evaluate(p.wave, det);
    if (!(m > 0) || !Number.isFinite(m)) continue;
    out.push({
      mjd: p.mjd, ratio: p.flux_uJy / m, err: p.err_uJy / m, wave: p.wave, det,
      flux_uJy: p.flux_uJy, model_uJy: m,
    });
  }
  out.sort((a, b) => a.mjd - b.mjd);
  return out;
}

/** AB magnitude of a flux density in microjansky (NaN for zero or negative flux). */
export function fluxToABmag(uJy) {
  return uJy > 0 ? 23.9 - 2.5 * Math.log10(uJy) : NaN;
}
