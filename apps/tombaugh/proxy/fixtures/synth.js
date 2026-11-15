// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// Synthetic SPHEREx Level-2 cutouts for tests and for the dev server. NOTHING HERE IS REAL
// DATA: every file written by this module carries a SYNTHETC = T card and a COMMENT saying so.
//
// The files are byte-accurate FITS in the layout of a real IRSA cutout so that they exercise the
// same code paths: primary HDU with VERSION, IMAGE / FLAGS / VARIANCE / ZODI images, an EPSF
// binary table (much smaller than the real 3.9 MB one, but in the same place), and the WCS-WAVE
// lookup table. The celestial WCS is TAN-SIP referenced to the centre of the 2040 x 2040
// detector, so CRPIX lies far outside the cutout exactly as in real files.
//
// Pure JS, Web-standard APIs only (the dev server and the synthetic proxy backend import it).

import { waveAt } from '../src/wavetab.js';

export const PIXEL_ARCSEC = 6.15;
export const DETECTOR_SIZE = 2040;
export const MJYSR_TO_UJY_PER_PIX = 889; // 1 MJy/sr over one 6.15 arcsec pixel, in microJy
const DET_CENTER = 1020.5; // FITS (1-based) coordinate of the detector centre = WCS reference pixel
const D2R = Math.PI / 180;
const FITS_BLOCK = 2880;

// FLAGS bit indices used here (see CONTRACT.md for the full list).
const BIT_TRANSIENT = 0;
const BIT_NONFUNC = 6;
const BIT_HOT = 10;
const BIT_COLD = 11;
const BIT_SOURCE = 21;

// ---------------------------------------------------------------------------------------------
// Deterministic random numbers
// ---------------------------------------------------------------------------------------------

function mix32(h) {
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Hash a list of integers to an unsigned 32-bit integer. */
function hashInts(...values) {
  let h = 0x9e3779b9;
  for (const v of values) h = mix32((h ^ (v | 0)) + 0x9e3779b9);
  return h >>> 0;
}

/** Hash to a uniform number in [0, 1). */
function hashUnit(...values) {
  return hashInts(...values) / 4294967296;
}

/** Standard normal deviate that depends only on its integer arguments (Box-Muller). */
function hashGauss(...values) {
  const u1 = (hashInts(...values, 1) + 0.5) / 4294967296;
  const u2 = hashInts(...values, 2) / 4294967296;
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Small seeded PRNG (mulberry32): returns a function giving uniform numbers in [0, 1). */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Error function, Abramowitz & Stegun 7.1.26 (absolute error below 1.5e-7). */
function erf(x) {
  const s = x < 0 ? -1 : 1;
  const z = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * z);
  const poly = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  return s * (1 - poly * Math.exp(-z * z));
}

// ---------------------------------------------------------------------------------------------
// TAN-SIP world coordinates (the WCS helper used for rendering)
// ---------------------------------------------------------------------------------------------

const wrap360 = (deg) => ((deg % 360) + 360) % 360;

/** Gnomonic projection of (ra, dec) about (ra0, dec0): [xi, eta] in degrees, xi east, eta north. */
export function tanProject(ra, dec, ra0, dec0) {
  const dra = (ra - ra0) * D2R;
  const sd = Math.sin(dec * D2R);
  const cd = Math.cos(dec * D2R);
  const s0 = Math.sin(dec0 * D2R);
  const c0 = Math.cos(dec0 * D2R);
  const cosc = s0 * sd + c0 * cd * Math.cos(dra);
  if (!(cosc > 0)) return [NaN, NaN]; // on or behind the horizon of the tangent point
  return [(cd * Math.sin(dra)) / cosc / D2R, (c0 * sd - s0 * cd * Math.cos(dra)) / cosc / D2R];
}

/** Inverse of tanProject: [ra, dec] in degrees, ra in [0, 360). */
export function tanDeproject(xiDeg, etaDeg, ra0, dec0) {
  const x = xiDeg * D2R;
  const y = etaDeg * D2R;
  const s0 = Math.sin(dec0 * D2R);
  const c0 = Math.cos(dec0 * D2R);
  const d = c0 - y * s0;
  return [wrap360(ra0 + Math.atan2(x, d) / D2R), Math.atan2(s0 + y * c0, Math.hypot(x, d)) / D2R];
}

/** { "p_q": c } -> [[p, q, c], ...] */
function polyTerms(coeffs) {
  const terms = [];
  for (const [key, c] of Object.entries(coeffs || {})) {
    const [p, q] = key.split('_').map(Number);
    if (Number.isInteger(p) && Number.isInteger(q) && Number.isFinite(c) && c !== 0) terms.push([p, q, c]);
  }
  return terms;
}

/** Evaluate sum c u^p v^q and its partial derivatives. Returns [f, df/du, df/dv]. */
function polyEval(terms, u, v) {
  let f = 0;
  let fu = 0;
  let fv = 0;
  for (const [p, q, c] of terms) {
    const up = Math.pow(u, p);
    const vq = Math.pow(v, q);
    f += c * up * vq;
    if (p > 0) fu += c * p * Math.pow(u, p - 1) * vq;
    if (q > 0) fv += c * q * up * Math.pow(v, q - 1);
  }
  return [f, fu, fv];
}

/**
 * TAN-SIP transform for a wcs object shaped like the TBF1 header:
 * { crpix: [1-based], crval, pc, cdelt, sip: { a, b, ap, bp, ... } | null }.
 *
 * Forward (FITS SIP convention, all polynomial terms honoured including order 0 and 1):
 *   u = x_fits - CRPIX1, v = y_fits - CRPIX2
 *   u' = u + sum A_p_q u^p v^q,  v' = v + sum B_p_q u^p v^q
 *   (xi, eta) = CDELT * PC * (u', v')   [degrees]   then TAN deprojection about CRVAL.
 * The inverse starts from the AP/BP polynomials (when present) and is then refined by Newton
 * iteration on the forward polynomial, so skyToPix is the exact inverse of pixToSky.
 *
 * @returns {{ pixToSky(x, y): [number, number], skyToPix(ra, dec): [number, number],
 *             pixToPlane(x, y): [number, number] }}  pixels are 0-based (FITS pixel - 1)
 */
export function makeTanSip(wcs) {
  const [crpix1, crpix2] = wcs.crpix;
  const [ra0, dec0] = wcs.crval;
  const cdelt = wcs.cdelt || [1, 1];
  const cd11 = cdelt[0] * wcs.pc[0][0];
  const cd12 = cdelt[0] * wcs.pc[0][1];
  const cd21 = cdelt[1] * wcs.pc[1][0];
  const cd22 = cdelt[1] * wcs.pc[1][1];
  const det = cd11 * cd22 - cd12 * cd21;
  const i11 = cd22 / det;
  const i12 = -cd12 / det;
  const i21 = -cd21 / det;
  const i22 = cd11 / det;
  const sip = wcs.sip || null;
  const A = polyTerms(sip && sip.a);
  const B = polyTerms(sip && sip.b);
  const AP = polyTerms(sip && sip.ap);
  const BP = polyTerms(sip && sip.bp);

  function pixToPlane(x, y) {
    const u = x + 1 - crpix1;
    const v = y + 1 - crpix2;
    const up = u + polyEval(A, u, v)[0];
    const vp = v + polyEval(B, u, v)[0];
    return [cd11 * up + cd12 * vp, cd21 * up + cd22 * vp];
  }

  function pixToSky(x, y) {
    const [xi, eta] = pixToPlane(x, y);
    return tanDeproject(xi, eta, ra0, dec0);
  }

  function skyToPix(ra, dec) {
    const [xi, eta] = tanProject(ra, dec, ra0, dec0);
    const U = i11 * xi + i12 * eta; // undistorted offsets u', v'
    const V = i21 * xi + i22 * eta;
    let u = U + polyEval(AP, U, V)[0];
    let v = V + polyEval(BP, U, V)[0];
    for (let iter = 0; iter < 30 && (A.length > 0 || B.length > 0); iter++) {
      const [a, au, av] = polyEval(A, u, v);
      const [b, bu, bv] = polyEval(B, u, v);
      const f1 = u + a - U;
      const f2 = v + b - V;
      const j11 = 1 + au;
      const j22 = 1 + bv;
      const jdet = j11 * j22 - av * bu;
      const du = (f1 * j22 - f2 * av) / jdet;
      const dv = (f2 * j11 - f1 * bu) / jdet;
      u -= du;
      v -= dv;
      if (Math.abs(du) + Math.abs(dv) < 1e-11) break;
    }
    return [u + crpix1 - 1, v + crpix2 - 1];
  }

  return { pixToSky, skyToPix, pixToPlane };
}

/**
 * Least-squares inverse SIP polynomials for a forward pair (A, B), fitted on a grid covering
 * the detector: u = u' + sum AP_p_q u'^p v'^q, v = v' + sum BP_p_q u'^p v'^q.
 */
export function fitInverseSip(a, b, order, { half = 1020, steps = 41 } = {}) {
  const A = polyTerms(a);
  const B = polyTerms(b);
  const terms = [];
  for (let p = 0; p <= order; p++) for (let q = 0; q <= order - p; q++) terms.push([p, q]);
  const m = terms.length;
  const S = 1000; // scale offsets to order unity so the normal equations stay well conditioned
  const N = Array.from({ length: m }, () => new Float64Array(m));
  const rhsU = new Float64Array(m);
  const rhsV = new Float64Array(m);
  const row = new Float64Array(m);
  for (let iy = 0; iy < steps; iy++) {
    for (let ix = 0; ix < steps; ix++) {
      const u = -half + (2 * half * ix) / (steps - 1);
      const v = -half + (2 * half * iy) / (steps - 1);
      const U = u + polyEval(A, u, v)[0];
      const V = v + polyEval(B, u, v)[0];
      for (let k = 0; k < m; k++) row[k] = Math.pow(U / S, terms[k][0]) * Math.pow(V / S, terms[k][1]);
      for (let i = 0; i < m; i++) {
        rhsU[i] += row[i] * (u - U);
        rhsV[i] += row[i] * (v - V);
        for (let j = 0; j < m; j++) N[i][j] += row[i] * row[j];
      }
    }
  }
  const solU = solveLinear(N, rhsU);
  const solV = solveLinear(N, rhsV);
  const ap = {};
  const bp = {};
  terms.forEach(([p, q], k) => {
    const scale = Math.pow(S, p + q);
    ap[`${p}_${q}`] = solU[k] / scale;
    bp[`${p}_${q}`] = solV[k] / scale;
  });
  return { ap, bp };
}

/** Solve M x = rhs by Gaussian elimination with partial pivoting (M and rhs are not modified). */
function solveLinear(M, rhs) {
  const n = rhs.length;
  const a = M.map((r, i) => [...r, rhs[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    for (let r = col + 1; r < n; r++) {
      const f = a[r][col] / a[col][col];
      for (let c = col; c <= n; c++) a[r][c] -= f * a[col][c];
    }
  }
  const x = new Float64Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let s = a[r][n];
    for (let c = r + 1; c < n; c++) s -= a[r][c] * x[c];
    x[r] = s / a[r][r];
  }
  return x;
}

// Forward distortion of the synthetic detectors: the coefficients measured in a real detector-2
// file (CONTRACT.md), so the terms have realistic sizes (0.1 to 7 pixels across the detector).
const SIP_A = {
  '0_0': 0.0905846568112, '0_1': 0.00142149437078, '0_2': -2.32575728759e-9, '0_3': 2.12692602413e-11,
  '1_0': -0.00040775220791, '1_1': 3.95116388931e-6, '1_2': 6.08925674497e-10,
  '2_0': -7.40546138386e-9, '2_1': 9.58797339985e-12, '3_0': 6.24932043516e-10,
};
const SIP_B = {
  '0_0': -1.14138384439, '0_1': -0.00037568269309, '0_2': 1.94165517112e-6, '0_3': 4.94514136332e-10,
  '1_0': -0.000119205208267, '1_1': 1.73252607291e-8, '1_2': -2.05541848269e-11,
  '2_0': 6.56833753216e-6, '2_1': 6.30028459135e-10, '3_0': -1.56259036826e-11,
};

let cachedSip = null;

/** SIP block of every synthetic frame: real forward terms plus a fitted, consistent inverse. */
export function syntheticSip() {
  if (!cachedSip) {
    const { ap, bp } = fitInverseSip(SIP_A, SIP_B, 3);
    cachedSip = { aOrder: 3, bOrder: 3, apOrder: 3, bpOrder: 3, a: { ...SIP_A }, b: { ...SIP_B }, ap, bp };
  }
  return cachedSip;
}

/**
 * PC matrix (degrees per pixel, CDELT = 1) for a roll angle. `rollDeg` is the position angle,
 * east of north, of the detector +y axis on the sky. Sky parity is the usual one (determinant
 * negative): at roll 0, +x points west and +y points north. The real file in CONTRACT.md has
 * roll 223.7 deg in this convention.
 */
export function rollToPc(rollDeg) {
  const s = PIXEL_ARCSEC / 3600;
  const c = Math.cos(rollDeg * D2R);
  const sn = Math.sin(rollDeg * D2R);
  return [
    [-s * c, s * sn],
    [s * sn, s * c],
  ];
}

/**
 * Sky position of the detector centre (CRVAL) such that the sky point (ra, dec) falls on the
 * 1-based detector pixel (detX, detY). Closed form: with (x, y) the tangent-plane offset of that
 * pixel in radians, sin(dec) = (sin(dec0) + y cos(dec0)) / sqrt(1 + x^2 + y^2) gives dec0, and
 * ra0 follows from ra - ra0 = atan2(x, cos(dec0) - y sin(dec0)).
 */
export function pointingFor({ ra, dec, detX, detY, rollDeg, sip = syntheticSip() }) {
  const probe = makeTanSip({ crpix: [DET_CENTER, DET_CENTER], crval: [0, 0], pc: rollToPc(rollDeg), cdelt: [1, 1], sip });
  const [xi, eta] = probe.pixToPlane(detX - 1, detY - 1);
  const x = xi * D2R;
  const y = eta * D2R;
  const norm = Math.sqrt(1 + x * x + y * y);
  const b = y / norm;
  const g = 1 / norm;
  // sin(dec) = g sin(dec0) + b cos(dec0) = R sin(dec0 + phi). Away from the poles the principal
  // arcsine is the answer; within a degree or so of a pole the other branch can be the one
  // that lies in [-90, 90], so both are tried and the one that reproduces (ra, dec) is kept.
  const angle = Math.asin(Math.max(-1, Math.min(1, Math.sin(dec * D2R) / Math.hypot(b, g))));
  const phi = Math.atan2(b, g);
  let best = null;
  for (const dec0 of [angle - phi, Math.PI - angle - phi]) {
    if (Math.abs(dec0) > Math.PI / 2) continue;
    const ra0 = ra - Math.atan2(x, Math.cos(dec0) - y * Math.sin(dec0)) / D2R;
    const [gotRa, gotDec] = tanDeproject(xi, eta, ra0, dec0 / D2R);
    const error = Math.abs(gotDec - dec) + Math.abs((((gotRa - ra + 540) % 360) - 180) * Math.cos(dec * D2R));
    if (!best || error < best.error) best = { crval: [wrap360(ra0), dec0 / D2R], error };
  }
  // Very close to a pole a pixel far from the detector's central meridian cannot reach the
  // target's declination whatever dec0 is: there is then no solution for this roll angle.
  if (!best || !(best.error < 1e-6)) {
    throw new Error(`No pointing puts RA ${ra}, Dec ${dec} on detector pixel (${detX}, ${detY}) at roll ${rollDeg}`);
  }
  return best.crval;
}

// ---------------------------------------------------------------------------------------------
// Detector wavelength tables
// ---------------------------------------------------------------------------------------------

const WAVE_NODES = [1, 205, 409, 613, 817, 1021, 1224, 1428, 1632, 1836, 2040]; // as in real files
const DETECTOR_BANDS = [[0.75, 1.09], [1.10, 1.62], [1.63, 2.41], [2.42, 3.82], [3.83, 4.41], [4.42, 5.00]];
const RESOLVING_POWER = [41.91, 41.91, 41.91, 38, 110, 130];
const SMILE = 0.0106; // fractional wavelength drop from the detector edge to its centre column
const PSF_FWHM_ARCSEC = [7.42, 7.4607, 7.52, 7.6, 7.74, 7.9];
const NOISE_SCALE = [1, 1, 1, 1.1, 1.6, 2];
const waveTables = new Map();

/**
 * Wavelength table of a detector in the readWaveTable shape { x, y, values, nx, ny, nk }.
 *
 * Modelled on the real detector-2 table: wavelength falls monotonically (geometrically) with
 * detector y, from a little above the nominal band at y = 1 to a little below it at y = 2040
 * (detector 2: 1.6677 -> 1.095 um at the edge columns), with a parabolic "smile" along x that
 * lowers the wavelength by about 1 % at the centre column. Bandwidth = wavelength / R with
 * R about 40 for detectors 1-4 and about 120 for detectors 5-6.
 */
export function detectorWaveTable(det) {
  if (!(det >= 1 && det <= 6) || !Number.isInteger(det)) throw new Error(`No such SPHEREx detector: ${det}`);
  let table = waveTables.get(det);
  if (!table) {
    const [lo, hi] = DETECTOR_BANDS[det - 1];
    const top = hi * (1.6677 / 1.62);
    const bottom = lo * (1.095 / 1.1);
    const n = WAVE_NODES.length;
    const values = new Float32Array(2 * n * n);
    for (let iy = 0; iy < n; iy++) {
      const base = top * Math.pow(bottom / top, (WAVE_NODES[iy] - 1) / (DETECTOR_SIZE - 1));
      for (let ix = 0; ix < n; ix++) {
        const r = (WAVE_NODES[ix] - DET_CENTER) / (DET_CENTER - 1);
        const wave = base * (1 - SMILE * (1 - r * r));
        values[2 * (ix + n * iy)] = wave;
        values[2 * (ix + n * iy) + 1] = wave / RESOLVING_POWER[det - 1];
      }
    }
    table = { x: Int32Array.from(WAVE_NODES), y: Int32Array.from(WAVE_NODES), values, nx: n, ny: n, nk: 2 };
    waveTables.set(det, table);
  }
  return table;
}

// ---------------------------------------------------------------------------------------------
// Spectra and backgrounds
// ---------------------------------------------------------------------------------------------

/** Planck function B_nu up to a constant: wavelength in um, temperature in K. */
function planckNu(wave, teff) {
  return 1 / (wave * wave * wave * Math.expm1(14387.77 / (wave * teff)));
}

/**
 * Flux density in microJy of a source spectrum at a wavelength (um). A spectrum is
 *   a number             flat spectrum, microJy
 *   a function           (wave_um) => microJy
 *   a descriptor object  { fluxUJy, refWave = 1.6, teff = 5000, scale = 1, bands = [] }:
 *                        a blackbody of temperature teff normalised to fluxUJy at refWave, times
 *                        scale, times (1 - depth * gaussian(center, sigma)) for every band
 *                        (negative depth makes an emission bump).
 */
export function evalSpectrum(spectrum, wave) {
  if (typeof spectrum === 'function') return spectrum(wave);
  if (typeof spectrum === 'number') return spectrum;
  if (!spectrum) return 0;
  const { fluxUJy = 1000, refWave = 1.6, teff = 5000, scale = 1, bands = [] } = spectrum;
  let f = (fluxUJy * scale * planckNu(wave, teff)) / planckNu(refWave, teff);
  for (const band of bands) {
    const z = (wave - band.center) / band.sigma;
    f *= 1 - band.depth * Math.exp(-0.5 * z * z);
  }
  return f;
}

/**
 * Zodiacal light surface brightness (MJy/sr): scattered sunlight falling with wavelength plus
 * thermal emission rising beyond 3.5 um, with a mild seasonal modulation.
 */
export function zodiModel(wave, mjd = 60836) {
  const seasonal = 1 + 0.08 * Math.sin((2 * Math.PI * (mjd - 60700)) / 365.25);
  return seasonal * (0.14 * Math.pow(wave / 1.3, -1.4) + 0.012 * Math.exp(1.5 * (wave - 3)));
}

const DIFFUSE_SKY = 0.02; // MJy/sr of smooth non-zodiacal background, present in IMAGE only

// ---------------------------------------------------------------------------------------------
// FITS writing
// ---------------------------------------------------------------------------------------------

/** Marks a number that must be written as a FITS real even when it is integer-valued. */
const real = (value) => ({ real: value });

function formatReal(x) {
  if (!Number.isFinite(x)) throw new Error(`Cannot write ${x} into a FITS header`);
  let s = String(x);
  const e = s.indexOf('e');
  if (e >= 0) {
    // JS writes 1e-7 and 2.5e+21; FITS wants a decimal point and an upper-case E.
    let mantissa = s.slice(0, e);
    if (!mantissa.includes('.')) mantissa += '.0';
    const exp = Number(s.slice(e + 1));
    s = `${mantissa}E${exp < 0 ? '-' : '+'}${String(Math.abs(exp)).padStart(2, '0')}`;
  } else if (!s.includes('.')) {
    s += '.0';
  }
  return s;
}

/** One 80-character header card in FITS fixed format. */
function card(key, value, comment) {
  let field;
  if (typeof value === 'string') {
    // Quotes are doubled; the string is padded to at least 8 characters inside the quotes.
    field = `'${value.replace(/'/g, "''").padEnd(8)}'`.padEnd(20);
  } else if (typeof value === 'boolean') {
    field = (value ? 'T' : 'F').padStart(20);
  } else if (value && typeof value === 'object') {
    field = formatReal(value.real).padStart(20);
  } else if (Number.isInteger(value)) {
    field = String(value).padStart(20);
  } else {
    field = formatReal(value).padStart(20);
  }
  let text = `${key.padEnd(8)}= ${field}`;
  if (text.length > 80 || key.length > 8) throw new Error(`FITS card too long: ${key}`);
  if (comment) text = `${text} / ${comment}`.slice(0, 80);
  return text.padEnd(80);
}

const commentCard = (text) => `COMMENT ${text}`.slice(0, 80).padEnd(80);

/** Header cards -> bytes, with the END card and space padding to a multiple of 2880. */
function headerBlock(cards) {
  const all = [...cards, 'END'.padEnd(80)];
  const out = new Uint8Array(Math.ceil((all.length * 80) / FITS_BLOCK) * FITS_BLOCK).fill(0x20);
  all.forEach((text, i) => {
    for (let c = 0; c < 80; c++) out[i * 80 + c] = text.charCodeAt(c) & 0x7f;
  });
  return out;
}

/** Typed array -> big-endian bytes, zero-padded to a multiple of 2880. */
function dataBlock(array) {
  const bytes = array.BYTES_PER_ELEMENT;
  const out = new Uint8Array(Math.ceil((array.length * bytes) / FITS_BLOCK) * FITS_BLOCK);
  const dv = new DataView(out.buffer);
  if (array instanceof Float32Array) {
    for (let i = 0; i < array.length; i++) dv.setFloat32(i * 4, array[i], false);
  } else if (array instanceof Int32Array) {
    for (let i = 0; i < array.length; i++) dv.setInt32(i * 4, array[i], false);
  } else {
    throw new Error('dataBlock: unsupported array type');
  }
  return out;
}

/**
 * Binary table HDU. columns: [{ name, type: 'J' | 'E', repeat, dim?, unit? }];
 * rows: array of rows, each an array with one array of `repeat` numbers per column.
 */
function bintableHdu(extname, columns, rows, extraCards = []) {
  const rowBytes = columns.reduce((sum, c) => sum + 4 * c.repeat, 0);
  const cards = [
    card('XTENSION', 'BINTABLE', 'binary table extension'),
    card('BITPIX', 8, 'array data type'),
    card('NAXIS', 2, 'number of array dimensions'),
    card('NAXIS1', rowBytes, 'length of dimension 1'),
    card('NAXIS2', rows.length, 'length of dimension 2'),
    card('PCOUNT', 0, 'number of group parameters'),
    card('GCOUNT', 1, 'number of groups'),
    card('TFIELDS', columns.length, 'number of table fields'),
  ];
  columns.forEach((c, i) => {
    cards.push(card(`TTYPE${i + 1}`, c.name));
    cards.push(card(`TFORM${i + 1}`, `${c.repeat}${c.type}`));
    if (c.unit) cards.push(card(`TUNIT${i + 1}`, c.unit));
    if (c.dim) cards.push(card(`TDIM${i + 1}`, `(${c.dim.join(',')})`));
  });
  cards.push(card('EXTNAME', extname, 'extension name'), ...extraCards);

  const data = new Uint8Array(Math.ceil((rowBytes * rows.length) / FITS_BLOCK) * FITS_BLOCK);
  const dv = new DataView(data.buffer);
  let offset = 0;
  for (const row of rows) {
    columns.forEach((c, ci) => {
      const cell = row[ci];
      for (let k = 0; k < c.repeat; k++) {
        if (c.type === 'J') dv.setInt32(offset, cell[k], false);
        else dv.setFloat32(offset, cell[k], false);
        offset += 4;
      }
    });
  }
  return concat([headerBlock(cards), data]);
}

function concat(parts) {
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

const tableHdus = new Map();

/** WCS-WAVE extension bytes of a detector: one row, X (11J), Y (11J), VALUES (242E, TDIM (2,11,11)). */
function waveTableHdu(det) {
  const key = `wave${det}`;
  if (!tableHdus.has(key)) {
    const t = detectorWaveTable(det);
    tableHdus.set(
      key,
      bintableHdu(
        'WCS-WAVE',
        [
          { name: 'X', type: 'J', repeat: t.nx },
          { name: 'Y', type: 'J', repeat: t.ny },
          { name: 'VALUES', type: 'E', repeat: t.values.length, unit: 'um', dim: [2, t.nx, t.ny] },
        ],
        [[t.x, t.y, t.values]],
      ),
    );
  }
  return tableHdus.get(key);
}

/**
 * EPSF extension bytes of a detector: a reduced stand-in for the real 441 x 8752-byte table.
 * 121 detector zones, each with a 21 x 21 oversampled Gaussian PSF (about 215 kB in total).
 */
function epsfHdu(det) {
  const key = `epsf${det}`;
  if (!tableHdus.has(key)) {
    const zones = 11;
    const size = 21;
    const oversample = 5;
    const sigma0 = (PSF_FWHM_ARCSEC[det - 1] / 2.3548 / PIXEL_ARCSEC) * oversample;
    const rows = [];
    for (let zy = 0; zy < zones; zy++) {
      for (let zx = 0; zx < zones; zx++) {
        const xc = ((zx + 0.5) * DETECTOR_SIZE) / zones + 0.5;
        const yc = ((zy + 0.5) * DETECTOR_SIZE) / zones + 0.5;
        // The PSF broadens slightly towards the detector corners.
        const sigma = sigma0 * (1 + 0.08 * (((xc - DET_CENTER) / 1020) ** 2 + ((yc - DET_CENTER) / 1020) ** 2));
        const psf = new Float32Array(size * size);
        let sum = 0;
        for (let j = 0; j < size; j++) {
          for (let i = 0; i < size; i++) {
            const v = Math.exp(-0.5 * ((i - 10) ** 2 + (j - 10) ** 2) / (sigma * sigma));
            psf[j * size + i] = v;
            sum += v;
          }
        }
        for (let k = 0; k < psf.length; k++) psf[k] /= sum;
        rows.push([[zy * zones + zx], [xc], [yc], psf]);
      }
    }
    tableHdus.set(
      key,
      bintableHdu(
        'EPSF',
        [
          { name: 'ZONE_ID', type: 'J', repeat: 1 },
          { name: 'X_CENTER', type: 'E', repeat: 1, unit: 'pix' },
          { name: 'Y_CENTER', type: 'E', repeat: 1, unit: 'pix' },
          { name: 'PSF', type: 'E', repeat: size * size, dim: [size, size] },
        ],
        rows,
        [card('OVERSAMP', oversample, 'PSF oversampling factor')],
      ),
    );
  }
  return tableHdus.get(key);
}

// ---------------------------------------------------------------------------------------------
// Frame bookkeeping
// ---------------------------------------------------------------------------------------------

const EXPOSURE_S = 113.5826; // XPOSURE of a real frame
const FRAME_S = 115.118; // MJD-END minus MJD-OBS of a real frame

function mjdToDate(mjd) {
  return new Date(Math.round((mjd - 40587) * 86400000)); // MJD 40587 = 1970-01-01
}

/** Year and week label in the style of SPHEREx observation ids (2026-06-19 -> 2026, 25). */
function obsWeek(mjd) {
  const d = mjdToDate(mjd);
  const year = d.getUTCFullYear();
  const dayOfYear = Math.floor((d.getTime() - Date.UTC(year, 0, 1)) / 86400000);
  return { year, week: Math.floor(dayOfYear / 7) + 1 };
}

/** EXPIDN as in real files: obsid 2026W25_2A_0279_1 on detector 2 -> 202625201027912. */
function expidnFor(obsid, det, mjd) {
  const m = /^(\d{4})W(\d{2})_(\d)([A-Z])_(\d{4})_(\d)$/.exec(obsid);
  if (!m) return Math.round(mjd * 1e5) * 10 + det;
  const letter = String(m[4].charCodeAt(0) - 64).padStart(2, '0');
  return Number(`${m[1]}${m[2]}${m[3]}${letter}${m[5]}${m[6]}${det}`);
}

function wcsCards({ crpix, crval, pc, sip, x0, y0 }) {
  const cards = [
    card('WCSAXES', 2, 'number of World Coordinate System axes'),
    card('CTYPE1', 'RA---TAN-SIP', 'TAN (gnomonic) projection + SIP distortions'),
    card('CTYPE2', 'DEC--TAN-SIP', 'TAN (gnomonic) projection + SIP distortions'),
    card('CUNIT1', 'deg'),
    card('CUNIT2', 'deg'),
    card('RADESYS', 'ICRS', 'equatorial coordinate system'),
    card('CRPIX1', real(crpix[0]), 'pixel coordinate of reference point'),
    card('CRPIX2', real(crpix[1]), 'pixel coordinate of reference point'),
    card('CRVAL1', real(crval[0]), '[deg] coordinate value at reference point'),
    card('CRVAL2', real(crval[1]), '[deg] coordinate value at reference point'),
    card('CDELT1', real(1), '[deg] coordinate increment at reference point'),
    card('CDELT2', real(1), '[deg] coordinate increment at reference point'),
    card('PC1_1', real(pc[0][0]), 'coordinate transformation matrix element'),
    card('PC1_2', real(pc[0][1]), 'coordinate transformation matrix element'),
    card('PC2_1', real(pc[1][0]), 'coordinate transformation matrix element'),
    card('PC2_2', real(pc[1][1]), 'coordinate transformation matrix element'),
    card('LONPOLE', real(180), '[deg] native longitude of celestial pole'),
    card('LATPOLE', real(crval[1]), '[deg] native latitude of celestial pole'),
  ];
  for (const [prefix, coeffs, order] of [
    ['A', sip.a, sip.aOrder],
    ['B', sip.b, sip.bOrder],
    ['AP', sip.ap, sip.apOrder],
    ['BP', sip.bp, sip.bpOrder],
  ]) {
    cards.push(card(`${prefix}_ORDER`, order, 'SIP polynomial order'));
    for (let p = 0; p <= order; p++) {
      for (let q = 0; q <= order - p; q++) {
        const c = coeffs[`${p}_${q}`];
        if (c !== undefined) cards.push(card(`${prefix}_${p}_${q}`, real(c), 'SIP distortion coefficient'));
      }
    }
  }
  // Alternate WCS 'W': cutout pixel -> 1-based detector pixel -> wavelength via the WCS-WAVE
  // table (-TAB). Detector pixel = CRVALnW + CDELTnW * (p - CRPIXnW) = p + x0 - 1.
  cards.push(
    card('WCSNAMEW', 'Approximated per-pixel wavelength and bandwidth'),
    card('CTYPE1W', 'WAVE-TAB'),
    card('CTYPE2W', 'WAVE-TAB'),
    card('CUNIT1W', 'um'),
    card('CUNIT2W', 'um'),
    card('CRPIX1W', real(2 - x0)),
    card('CRPIX2W', real(2 - y0)),
    card('CDELT1W', 1),
    card('CDELT2W', 1),
    card('CRVAL1W', 1),
    card('CRVAL2W', 1),
    card('PV1_3W', 1, 'wavelength is element 1 of the coordinate array'),
    card('PV2_3W', 2, 'bandwidth is element 2 of the coordinate array'),
    card('PS1_0W', 'WCS-WAVE', 'table extension name'),
    card('PS2_0W', 'WCS-WAVE', 'table extension name'),
    card('PS1_1W', 'VALUES', 'coordinate array column'),
    card('PS2_1W', 'VALUES', 'coordinate array column'),
    card('PS1_2W', 'X', 'index vector column'),
    card('PS2_2W', 'Y', 'index vector column'),
    // Alternate WCS 'A': 0-based detector pixel coordinates.
    card('WCSNAMEA', 'Detector pixel coordinates (0-based)'),
    card('CTYPE1A', 'LINEAR'),
    card('CTYPE2A', 'LINEAR'),
    card('CRPIX1A', real(2 - x0)),
    card('CRPIX2A', real(2 - y0)),
    card('CRVAL1A', real(0)),
    card('CRVAL2A', real(0)),
  );
  return cards;
}

function imageHdu({ extname, bitpix, nx, ny, bunit, shared, data }) {
  const cards = [
    card('XTENSION', 'IMAGE', 'image extension'),
    card('BITPIX', bitpix, 'array data type'),
    card('NAXIS', 2, 'number of array dimensions'),
    card('NAXIS1', nx),
    card('NAXIS2', ny),
    card('PCOUNT', 0, 'number of parameters'),
    card('GCOUNT', 1, 'number of groups'),
    card('EXTNAME', extname, 'extension name'),
  ];
  if (bunit) cards.push(card('BUNIT', bunit));
  cards.push(...shared);
  return concat([headerBlock(cards), dataBlock(data)]);
}

// ---------------------------------------------------------------------------------------------
// makeSyntheticMef
// ---------------------------------------------------------------------------------------------

/**
 * Build one synthetic SPHEREx Level-2 cutout (complete seven-HDU FITS file).
 *
 * @param {object} o
 * @param {number} o.ra, o.dec     cutout centre, degrees (ICRS)
 * @param {number} [o.size=0.1]    cutout width in degrees (0.1 -> 59 x 59 pixels)
 * @param {number} [o.det=2]       detector 1-6
 * @param {number} [o.mjd]         start of the exposure (MJD-OBS, the /search `mjd`); MJD-AVG
 *                                 is 57.6 s later
 * @param {number} [o.rollDeg]     position angle (east of north) of the detector +y axis
 * @param {Array}  [o.sources]     [{ ra, dec, spectrum | fluxUJy, catalog? }], positions at this
 *                                 epoch; spectrum as in evalSpectrum. catalog: false leaves the
 *                                 SOURCE flag unset under that source.
 * @param {number} [o.seed=1]      noise / cosmic-ray seed
 * Pointing, one of:
 * @param {number[]} [o.crval]     sky position [ra, dec] of the detector centre, or
 * @param {number} [o.detX], [o.detY]  1-based detector pixel on which (ra, dec) falls
 *                                 (default 1676, 539 as in the real file of CONTRACT.md)
 * Extras: o.obsid, o.version ('7.0.5'), o.noise (true), o.badPixels (true).
 *
 * The cutout is clipped at the detector edges like a real one (NAXIS1/2 shrink); an Error is
 * thrown if (ra, dec) is not on the detector at all.
 * @returns {Uint8Array}
 */
export function makeSyntheticMef(o) {
  const {
    ra, dec, size = 0.1, det = 2, mjd = 61210.79244684, rollDeg = 223.7, sources = [], seed = 1,
    detX = 1676, detY = 539, version = '7.0.5', noise = true, badPixels = true,
  } = o;
  if (!Number.isFinite(ra) || !Number.isFinite(dec)) throw new Error('makeSyntheticMef: ra and dec are required');
  const table = detectorWaveTable(det);
  const sip = syntheticSip();
  const pc = rollToPc(rollDeg);
  const crval = o.crval ? [wrap360(o.crval[0]), o.crval[1]] : pointingFor({ ra, dec, detX, detY, rollDeg, sip });

  // Where the requested centre falls on the detector (1-based), and the cutout box around it.
  const detector = makeTanSip({ crpix: [DET_CENTER, DET_CENTER], crval, pc, cdelt: [1, 1], sip });
  const [tx0, ty0] = detector.skyToPix(ra, dec);
  const tx = tx0 + 1;
  const ty = ty0 + 1;
  const n = Math.max(1, Math.min(DETECTOR_SIZE, Math.round((size * 3600) / PIXEL_ARCSEC)));
  const wantX0 = Math.round(tx - (n - 1) / 2);
  const wantY0 = Math.round(ty - (n - 1) / 2);
  const x0 = Math.max(1, wantX0); // detector pixel of cutout FITS pixel (1, 1)
  const y0 = Math.max(1, wantY0);
  const nx = Math.min(DETECTOR_SIZE, wantX0 + n - 1) - x0 + 1;
  const ny = Math.min(DETECTOR_SIZE, wantY0 + n - 1) - y0 + 1;
  if (!(nx > 0 && ny > 0)) {
    throw new Error(`Synthetic frame does not cover RA ${ra}, Dec ${dec} (detector pixel ${tx.toFixed(1)}, ${ty.toFixed(1)})`);
  }

  // Cutout pixel p (1-based) is detector pixel p + x0 - 1, so u = p - (DET_CENTER + 1 - x0).
  const crpix = [DET_CENTER + 1 - x0, DET_CENTER + 1 - y0];
  const cutout = makeTanSip({ crpix, crval, pc, cdelt: [1, 1], sip });
  const mjdAvg = mjd + FRAME_S / 2 / 86400;
  const fwhm = PSF_FWHM_ARCSEC[det - 1];
  const sigma = fwhm / 2.3548 / PIXEL_ARCSEC; // Gaussian sigma in pixels

  const count = nx * ny;
  const signal = new Float64Array(count);
  const zodi = new Float32Array(count);
  const flags = new Int32Array(count);
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      const z = zodiModel(waveAt(table, x0 + x, y0 + y).wave, mjdAvg);
      zodi[y * nx + x] = z;
      signal[y * nx + x] = z + DIFFUSE_SKY;
    }
  }

  // Sources: pixel-integrated Gaussian PSF at the true sky position, with the flux the source
  // has at the wavelength of the detector position it lands on.
  const reach = Math.ceil(4 * sigma) + 1;
  const root2 = Math.SQRT2 * sigma;
  for (const s of sources) {
    const [px, py] = cutout.skyToPix(s.ra, s.dec);
    if (!(px > -reach - 1 && px < nx + reach && py > -reach - 1 && py < ny + reach)) continue;
    const wave = waveAt(table, x0 + px, y0 + py).wave;
    const flux = evalSpectrum(s.spectrum ?? s.fluxUJy ?? s.flux ?? 0, wave);
    if (!(flux > 0)) continue;
    const cx = Math.round(px);
    const cy = Math.round(py);
    for (let y = Math.max(0, cy - reach); y <= Math.min(ny - 1, cy + reach); y++) {
      const fy = 0.5 * (erf((y + 0.5 - py) / root2) - erf((y - 0.5 - py) / root2));
      for (let x = Math.max(0, cx - reach); x <= Math.min(nx - 1, cx + reach); x++) {
        const fx = 0.5 * (erf((x + 0.5 - px) / root2) - erf((x - 0.5 - px) / root2));
        signal[y * nx + x] += (flux * fx * fy) / MJYSR_TO_UJY_PER_PIX;
        if (s.catalog !== false && (x - px) ** 2 + (y - py) ** 2 <= 4) flags[y * nx + x] |= 1 << BIT_SOURCE;
      }
    }
  }

  // Noise and defects. Noise and fixed defects are functions of the detector pixel, so two
  // cutouts of the same exposure agree where they overlap.
  const image = new Float32Array(count);
  const variance = new Float32Array(count);
  const noiseScale = NOISE_SCALE[det - 1];
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      const i = y * nx + x;
      const X = x0 + x;
      const Y = y0 + y;
      const v = (0.0006 + 0.0005 * Math.max(signal[i], 0)) * noiseScale * noiseScale;
      variance[i] = v;
      image[i] = signal[i] + (noise ? Math.sqrt(v) * hashGauss(seed, det, X, Y) : 0);
      if (!badPixels) continue;
      const defect = hashUnit(0xbad, det, X, Y); // fixed to the detector, the same in every exposure
      const wild = hashUnit(0xf00d, det, X, Y);
      if (defect < 0.0012) {
        flags[i] |= 1 << BIT_HOT;
        image[i] = 150 + 2000 * wild;
      } else if (defect < 0.0018) {
        flags[i] |= 1 << BIT_COLD;
        image[i] = -20 - 30 * wild;
      } else if (defect < 0.0022) {
        flags[i] |= 1 << BIT_NONFUNC;
        image[i] = NaN;
        variance[i] = NaN;
      } else if (hashUnit(seed, 0xc05, det, X, Y) < 0.0006) {
        flags[i] |= 1 << BIT_TRANSIENT; // cosmic ray: different in every exposure
        image[i] += 25 + 400 * wild;
      }
    }
  }

  const { year, week } = obsWeek(mjd);
  const obsid = o.obsid || `${year}W${String(week).padStart(2, '0')}_1A_0001_1`;
  const shared = [
    card('SYNTHETC', true, 'SYNTHETIC test data, not a real observation'),
    commentCard('Synthetic SPHEREx-style frame made by Tombaugh (proxy/fixtures/synth.js).'),
    commentCard('This is NOT real data. Do not use it for science.'),
    card('TELESCOP', 'SPHEREx'),
    card('INSTRUME', 'SPHEREx'),
    card('DETECTOR', det, 'detector number'),
    card('OBSID', obsid, 'observation identifier'),
    card('EXPIDN', expidnFor(obsid, det, mjd), 'exposure identifier'),
    card('DATE-OBS', mjdToDate(mjd).toISOString().slice(0, 23), 'UTC start of exposure'),
    card('MJD-OBS', real(Number(mjd.toFixed(8))), '[d] MJD at start of exposure'),
    card('MJD-AVG', real(Number(mjdAvg.toFixed(8))), '[d] MJD at middle of exposure'),
    card('MJD-END', real(Number((mjd + FRAME_S / 86400).toFixed(9))), '[d] MJD at end of exposure'),
    card('XPOSURE', real(EXPOSURE_S), '[s] exposure time'),
    card('TIMESYS', 'UTC'),
    card('PSF_FWHM', real(fwhm), '[arcsec] PSF full width at half maximum'),
    ...wcsCards({ crpix, crval, pc, sip, x0, y0 }),
  ];

  const primary = headerBlock([
    card('SIMPLE', true, 'conforms to FITS standard'),
    card('BITPIX', 8, 'array data type'),
    card('NAXIS', 0, 'number of array dimensions'),
    card('EXTEND', true),
    card('VERSION', version, 'pipeline version'),
    commentCard('Synthetic SPHEREx-style file made by Tombaugh. NOT real data.'),
  ]);

  return concat([
    primary,
    imageHdu({ extname: 'IMAGE', bitpix: -32, nx, ny, bunit: 'MJy / sr', shared, data: image }),
    imageHdu({ extname: 'FLAGS', bitpix: 32, nx, ny, bunit: null, shared, data: flags }),
    imageHdu({ extname: 'VARIANCE', bitpix: -32, nx, ny, bunit: 'MJy2 / sr2', shared, data: variance }),
    imageHdu({ extname: 'ZODI', bitpix: -32, nx, ny, bunit: 'MJy / sr', shared, data: zodi }),
    epsfHdu(det),
    waveTableHdu(det),
  ]);
}

// ---------------------------------------------------------------------------------------------
// syntheticSky
// ---------------------------------------------------------------------------------------------

const SKY_EPOCH_MJD = 60836.0; // 2025-06-10: epoch of the catalogue positions below
const GAIA_EPOCH_MJD = 57388.5; // J2016.0
const PASS_START_MJD = [60834.2, 61016.7, 61199.1]; // June 2025, December 2025, June 2026
const PASS_RELEASE = ['dr1', 'dr1', 'qr3'];
const PASS_ROLL_DEG = [223.7, 43.7, 222.4]; // the spacecraft flips between half-year passes
const EXPOSURES_PER_PASS = 14;
const VARIABLE_PERIOD_D = 366;
const FIELD_STARS = 25;
const SKY_QUANTUM = 1e5; // field centres are rounded to 1e-5 deg so they survive a trip through an id

const skyCache = new Map();

// Identity-matrix WCS: pixToPlane then returns the SIP-distorted offsets (u', v') in pixels.
const SIP_PROBE = makeTanSip({ crpix: [DET_CENTER, DET_CENTER], crval: [0, 0], pc: [[1, 0], [0, 1]], cdelt: [1, 1], sip: syntheticSip() });

function fieldKey(ra, dec) {
  const raInt = Math.round(wrap360(ra) * SKY_QUANTUM) % (360 * SKY_QUANTUM);
  const decInt = Math.round(Math.max(-90, Math.min(90, dec)) * SKY_QUANTUM);
  return { raInt, decInt };
}

/** Processing-version path segment of synthetic ids; it carries the field centre. */
function procSegment(raInt, decInt) {
  return `l2b-syn-r${String(raInt).padStart(8, '0')}-d${decInt < 0 ? 'm' : 'p'}${String(Math.abs(decInt)).padStart(7, '0')}`;
}

/**
 * Decode a synthetic frame id. Returns { ra, dec, det, obsid } or null if the id was not made
 * by syntheticSky.
 */
export function parseSyntheticId(id) {
  const text = String(id ?? '');
  const field = /l2b-syn-r(\d{8})-d([pm])(\d{7})/.exec(text);
  const file = /level2_(.+?)D([1-6])_spx/.exec(text);
  if (!field || !file) return null;
  return {
    ra: Number(field[1]) / SKY_QUANTUM,
    dec: ((field[2] === 'm' ? -1 : 1) * Number(field[3])) / SKY_QUANTUM,
    det: Number(file[2]),
    obsid: file[1],
  };
}

/**
 * A deterministic fake sky around (ra, dec) and the exposures that "observed" it.
 *
 * Contents: about 25 field stars with smooth blackbody spectra and small proper motions; a fast
 * mover (10.4 arcsec/yr, crossing the field centre in December 2025); a variable star whose
 * brightness doubles between the June and December passes; and a cold methane-like object, faint
 * in the near infrared, with a deep absorption dip at 3.3 um and bright at 4.5 um (not in the
 * Gaia-like catalogue). Three passes, 14 exposures per detector per pass (252 frames), each
 * with its own roll angle and with the field centre on a different detector row.
 *
 * @returns {{
 *   ra: number, dec: number,
 *   frameRefs: Array<{ id: string, det: number, mjd: number, release: string, obsid: string }>,
 *   exposures: Array<object>,                    // frameRefs plus rollDeg, crval, detX, detY, pass, seed
 *   sourcesAt(mjd: number): Array<{ id, kind, ra, dec, spectrum }>,
 *   mefFor(id: string, cutout?: { ra?: number, dec?: number, size?: number }): Uint8Array,
 *   gaia(): { epoch: 2016.0, stars: Array<object> },   // shaped like the /gaia response
 *   objects: Array<object>                       // the truth: tangent-plane offsets, motions, spectra
 * }}
 */
export function syntheticSky(ra, dec) {
  const { raInt, decInt } = fieldKey(ra, dec);
  const key = `${raInt}_${decInt}`;
  const cached = skyCache.get(key);
  if (cached) return cached;

  const ra0 = raInt / SKY_QUANTUM;
  const dec0 = decInt / SKY_QUANTUM;
  const seed = hashInts(raInt, decInt, 0x70b);
  const rng = mulberry32(seed);

  // Objects live in the tangent plane of the field centre: xi east, eta north, arcsec at
  // SKY_EPOCH_MJD, with linear proper motion in arcsec/yr.
  const variableMin = PASS_START_MJD[0] + 3.5; // faintest in the middle of the first pass
  const objects = [
    {
      id: 'mover', kind: 'mover', xi: 0.4, eta: -5.18, pmE: -0.8, pmN: 10.37,
      spectrum: { fluxUJy: 18000, refWave: 1.6, teff: 3200 },
    },
    {
      id: 'variable', kind: 'variable', xi: 41, eta: 27, pmE: 0.004, pmN: -0.006,
      spectrum: { fluxUJy: 4000, refWave: 1.6, teff: 3400 },
      // 1.0 at the June passes, 2.0 at the December pass.
      scaleAt: (mjd) => 1.5 - 0.5 * Math.cos((2 * Math.PI * (mjd - variableMin)) / VARIABLE_PERIOD_D),
    },
    {
      id: 'methane', kind: 'methane', xi: -36, eta: -31, pmE: 0.12, pmN: -0.21, inGaia: false,
      spectrum: {
        fluxUJy: 2600, refWave: 4.5, teff: 900,
        bands: [
          { center: 3.3, sigma: 0.2, depth: 0.93 }, // CH4 fundamental
          { center: 2.25, sigma: 0.12, depth: 0.5 },
          { center: 1.67, sigma: 0.07, depth: 0.4 },
        ],
      },
    },
  ];
  // Field stars keep clear of each other (10 arcsec) and of the three special objects
  // (16 arcsec), including everywhere the mover goes during the survey.
  const keepOut = [];
  for (const o of objects) {
    for (const years of [0, 0.5, 1, 1.5]) keepOut.push({ xi: o.xi + o.pmE * years, eta: o.eta + o.pmN * years, radius: 16 });
  }
  for (let i = 0; i < FIELD_STARS; i++) {
    let xi = 0;
    let eta = 0;
    for (let attempt = 0; attempt < 60; attempt++) {
      // Centrally concentrated so that a 2-4 arcmin view is not empty.
      const r = 8 + 382 * Math.pow(rng(), 0.75);
      const theta = 2 * Math.PI * rng();
      xi = r * Math.sin(theta);
      eta = r * Math.cos(theta);
      if (keepOut.every((k) => Math.hypot(k.xi - xi, k.eta - eta) > k.radius)) break;
    }
    keepOut.push({ xi, eta, radius: 10 });
    objects.push({
      id: `star${String(i + 1).padStart(2, '0')}`, kind: 'star', xi, eta,
      pmE: (rng() - 0.5) * 0.04, pmN: (rng() - 0.5) * 0.04,
      spectrum: { fluxUJy: 200 * Math.pow(125, rng()), refWave: 1.6, teff: 3200 + 5800 * rng() ** 2 },
    });
  }

  const positionAt = (o, mjd) => {
    const years = (mjd - SKY_EPOCH_MJD) / 365.25;
    return tanDeproject((o.xi + o.pmE * years) / 3600, (o.eta + o.pmN * years) / 3600, ra0, dec0);
  };

  function sourcesAt(mjd) {
    return objects.map((o) => {
      const [sra, sdec] = positionAt(o, mjd);
      const spectrum = o.scaleAt ? { ...o.spectrum, scale: o.scaleAt(mjd) } : o.spectrum;
      return { id: o.id, kind: o.kind, ra: sra, dec: sdec, spectrum };
    });
  }

  // Exposure plan. Detectors d and d + 3 look at the same sky through a dichroic, so they share
  // exposure times and pointings. The field centre steps across the detector rows (and therefore
  // across the wavelengths of each detector) during a pass, in opposite directions on
  // alternating passes.
  const proc = procSegment(raInt, decInt);
  const exposures = [];
  for (let pass = 0; pass < PASS_START_MJD.length; pass++) {
    for (let group = 0; group < 3; group++) {
      // Keep the field at least 150 pixels from the detector centre column so that CRPIX1 is
      // always outside the cutout, as it is in practice for almost every real cutout.
      const side = rng() < 0.5 ? -1 : 1;
      const xBase = DET_CENTER + side * (220 + 560 * rng());
      for (let k = 0; k < EXPOSURES_PER_PASS; k++) {
        const step = pass % 2 === 0 ? k : EXPOSURES_PER_PASS - 1 - k;
        const mjd = Number((PASS_START_MJD[pass] + group * 2.3 + k * 0.1372 + (rng() - 0.5) * 0.008).toFixed(8));
        let rollDeg = PASS_ROLL_DEG[pass] + (rng() - 0.5) * 7;
        const detY = 80 + (step + 0.5 + (rng() - 0.5) * 0.7) * (1880 / EXPOSURES_PER_PASS);
        const detX = xBase + (rng() - 0.5) * 90;
        // Within about two degrees of a celestial pole most roll angles cannot place the field
        // on the wanted pixel (see pointingFor). The roll that points the pixel's offset from
        // the detector centre along the meridian always can, so it is used there instead.
        let crval;
        try {
          crval = pointingFor({ ra: ra0, dec: dec0, detX, detY, rollDeg });
        } catch {
          const [u, v] = SIP_PROBE.pixToPlane(detX - 1, detY - 1); // distorted pixel offsets
          rollDeg = wrap360(Math.atan2(u, v) / D2R + (dec0 < 0 ? 180 : 0));
          crval = pointingFor({ ra: ra0, dec: dec0, detX, detY, rollDeg });
        }
        const { year, week } = obsWeek(mjd);
        const dir = `${year}W${String(week).padStart(2, '0')}_${pass + 1}${'ABC'[group]}`;
        const obsid = `${dir}_${String(1 + pass * 300 + group * 100 + k * 3).padStart(4, '0')}_1`;
        for (const det of [group + 1, group + 4]) {
          const release = PASS_RELEASE[pass];
          exposures.push({
            id: `ibe/data/spherex/${release}/level2/${dir}/${proc}/${det}/level2_${obsid}D${det}_spx_${proc}.fits`,
            det, mjd, release, obsid, pass, rollDeg, crval, detX, detY,
            seed: hashInts(seed, pass, group, k, det),
          });
        }
      }
    }
  }
  exposures.sort((a, b) => a.mjd - b.mjd || a.det - b.det);
  const byId = new Map(exposures.map((e) => [e.id, e]));
  const frameRefs = exposures.map(({ id, det, mjd, release, obsid }) => ({ id, det, mjd, release, obsid }));

  function mefFor(id, cutout = {}) {
    const e = byId.get(id);
    if (!e) throw new Error(`Unknown synthetic frame id: ${id}`);
    return makeSyntheticMef({
      ra: cutout.ra ?? ra0,
      dec: cutout.dec ?? dec0,
      size: cutout.size ?? 0.1,
      det: e.det,
      mjd: e.mjd,
      rollDeg: e.rollDeg,
      crval: e.crval,
      sources: sourcesAt(e.mjd + FRAME_S / 2 / 86400),
      seed: e.seed,
      obsid: e.obsid,
    });
  }

  function gaia() {
    const stars = objects
      .map((o, index) => ({ o, index }))
      .filter(({ o }) => o.inGaia !== false)
      .map(({ o, index }) => {
        const [sra, sdec] = positionAt(o, GAIA_EPOCH_MJD);
        // Rough G magnitude from the blackbody flux at 0.64 um (zero point 3229 Jy), at the mean
        // brightness for the variable.
        const jy = evalSpectrum({ ...o.spectrum, scale: o.scaleAt ? 1.5 : 1 }, 0.64) * 1e-6;
        return {
          id: `99${String(hashInts(seed, index)).padStart(10, '0')}${String(index).padStart(3, '0')}`,
          ra: Number(sra.toFixed(8)),
          dec: Number(sdec.toFixed(8)),
          pmra: Number((o.pmE * 1000).toFixed(3)), // mas/yr, mu_alpha* (includes cos dec)
          pmdec: Number((o.pmN * 1000).toFixed(3)),
          parallax: null, // the synthetic sky has no parallax
          gmag: Number((-2.5 * Math.log10(jy / 3229)).toFixed(3)),
        };
      })
      .sort((a, b) => a.gmag - b.gmag);
    return { epoch: 2016.0, stars };
  }

  const sky = { ra: ra0, dec: dec0, frameRefs, exposures, sourcesAt, mefFor, gaia, objects };
  if (skyCache.size >= 16) skyCache.delete(skyCache.keys().next().value);
  skyCache.set(key, sky);
  return sky;
}

/**
 * Regenerate the FITS bytes of a synthetic frame from its id alone (the id encodes the field).
 * `cutout` = { ra, dec, size } as in the /cutout request; defaults to the field centre, 0.1 deg.
 */
export function syntheticMef(id, cutout = {}) {
  const parsed = parseSyntheticId(id);
  if (!parsed) throw new Error(`Not a synthetic frame id: ${id}`);
  return syntheticSky(parsed.ra, parsed.dec).mefFor(id, cutout);
}
