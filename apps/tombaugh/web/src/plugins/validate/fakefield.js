// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// A small made-up field with a known answer, for the unit tests and the standalone demo of the
// validation plugin. NOTHING HERE IS REAL DATA. It builds native-pixel frames (6.15 arcsec
// pixels, TAN WCS without distortion, a different roll, pointing and wavelength per exposure)
// that go through the real core/reproject.js, so the measurement code is exercised on the same
// kind of input the app gives it. The full, byte-accurate synthetic sky lives in
// proxy/fixtures/synth.js; tools/validate-synthetic.mjs runs the chain on that one.

import { propagate, offsetBy } from '../../core/astrometry.js';
import { makeWcs, makeGrid } from '../../core/wcs.js';
import { reproject } from '../../core/reproject.js';
import { DETECTORS } from '../../core/frames.js';

const PIXEL_ARCSEC = 6.15;
const UJY_PER_MJYSR_PIX = 889;
const D2R = Math.PI / 180;
const GAIA_EPOCH = 2016.0;
const BIT_HOT = 10;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng) {
  const u1 = Math.max(rng(), 1e-12);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * rng());
}

/** Error function, Abramowitz and Stegun 7.1.26. */
function erf(x) {
  const s = x < 0 ? -1 : 1;
  const z = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * z);
  const poly = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  return s * (1 - poly * Math.exp(-z * z));
}

/** PC matrix for a roll angle (position angle of the detector +y axis, east of north). */
function rollToPc(rollDeg) {
  const s = PIXEL_ARCSEC / 3600;
  const c = Math.cos(rollDeg * D2R);
  const sn = Math.sin(rollDeg * D2R);
  return [[-s * c, s * sn], [s * sn, s * c]];
}

/**
 * Build the field.
 *
 * Options: ra0, dec0 (deg), fov (arcmin), dets (detectors to make frames for), passMjds (one
 * start date per survey pass), exposuresPerPass, seed, nStars, noise (false for noiseless
 * frames), mover / variable (false to leave them out), moverPm ([pmra, pmdec] mas/yr),
 * moverParallax (mas), variableFactor (brightness of the variable in the second pass relative
 * to the others), moverFactor (the same for the central star, 1 = constant), badPixels (false to
 * leave out flagged hot pixels).
 *
 * Returns { grid, frames, gaia: { epoch, stars }, truth, target }:
 *   frames   native Frame objects as api.js decodeFrame gives them
 *   gaia     the catalogue as the /gaia endpoint gives it (positions at 2016.0)
 *   truth    { mover: { star, pmra, pmdec, total, paDeg }, variable: { star, factor, passIndex },
 *              crowded: [ids], edge: id, passMjds }
 *   target   { ra, dec, name } of the mover at the middle of the survey (or the field centre)
 */
export function makeFakeField(options = {}) {
  const {
    ra0 = 150.0, dec0 = 20.0, fov = 4, dets = [3], passMjds = [60836, 61018, 61200],
    exposuresPerPass = 8, seed = 11, nStars = 14, noise = true, mover = true, variable = true,
    moverPm = [-800, 10360], moverParallax = 0, variableFactor = 2, badPixels = true, moverFactor = 1,
  } = options;
  const rng = mulberry32(seed);
  const grid = makeGrid(ra0, dec0, fov);
  const half = (fov * 60) / 2; // arcsec
  const midMjd = passMjds[Math.floor(passMjds.length / 2)] + 1;

  // ---- catalogue ------------------------------------------------------------------------------
  const stars = [];
  const placed = []; // { e, n } arcsec at the middle of the survey, for spacing
  const farFrom = (e, n, d) => placed.every((p) => Math.hypot(p.e - e, p.n - n) > d);
  const addStar = (id, e, n, flux, pmra, pmdec, extra = {}) => {
    // (e, n) is where the star is at midMjd; the catalogue holds where it was at 2016.0.
    const now = offsetBy(ra0, dec0, e, n);
    const years = 2000 + (midMjd - 51544.5) / 365.25 - GAIA_EPOCH;
    const then = offsetBy(now.ra, now.dec, (-pmra * years) / 1000, (-pmdec * years) / 1000);
    const star = {
      id, ra: then.ra, dec: then.dec, pmra, pmdec, parallax: extra.parallax ?? null,
      gmag: Number((23.9 - 2.5 * Math.log10(flux) - 2).toFixed(3)),
    };
    stars.push(star);
    placed.push({ e, n });
    return { star, flux, alpha: extra.alpha ?? -1 + 1.2 * rng(), scaleAt: extra.scaleAt || null };
  };

  const sources = [];
  const truth = { passMjds: passMjds.slice(), crowded: [], edge: null, mover: null, variable: null };
  if (mover) {
    const src = addStar('fake-mover', 0, 0, 16000, moverPm[0], moverPm[1], {
      parallax: moverParallax || null, alpha: -0.6,
      scaleAt: moverFactor !== 1 ? (mjd) => (passMjds.length > 1 && Math.abs(mjd - passMjds[1]) < 40 ? moverFactor : 1) : null,
    });
    sources.push(src);
    const total = Math.hypot(moverPm[0], moverPm[1]);
    truth.mover = {
      star: src.star, pmra: moverPm[0], pmdec: moverPm[1], total,
      paDeg: ((Math.atan2(moverPm[0], moverPm[1]) / D2R) + 360) % 360,
    };
  }
  if (variable) {
    const src = addStar('fake-variable', 0.25 * half, 0.3 * half, 5000, 3, -5, {
      alpha: -0.4,
      scaleAt: (mjd) => (passMjds.length > 1 && Math.abs(mjd - passMjds[1]) < 40 ? variableFactor : 1),
    });
    sources.push(src);
    truth.variable = { star: src.star, factor: variableFactor, passIndex: 1 };
  }
  for (let i = 0; i < nStars; i++) {
    let e = 0;
    let n = 0;
    for (let attempt = 0; attempt < 200; attempt++) {
      e = (rng() - 0.5) * 2 * 0.74 * half;
      n = (rng() - 0.5) * 2 * 0.74 * half;
      if (farFrom(e, n, 26)) break;
    }
    const flux = 1500 * Math.pow(12, rng());
    sources.push(addStar(`fake-star-${String(i + 1).padStart(2, '0')}`, e, n, flux, (rng() - 0.5) * 30, (rng() - 0.5) * 30));
  }
  // A close pair (must be rejected as crowded) and a star on the rim (rejected by the margin).
  for (let attempt = 0; attempt < 400; attempt++) {
    const e = (rng() - 0.5) * 2 * 0.6 * half;
    const n = (rng() - 0.5) * 2 * 0.6 * half;
    if (!farFrom(e, n, 34)) continue;
    sources.push(addStar('fake-pair-a', e, n, 6000, 2, 2));
    sources.push(addStar('fake-pair-b', e + 8, n + 3, 5000, -2, 1));
    truth.crowded = ['fake-pair-a', 'fake-pair-b'];
    break;
  }
  sources.push(addStar('fake-edge', 0.97 * half, -0.1 * half, 9000, 1, 1));
  truth.edge = 'fake-edge';

  // ---- frames -----------------------------------------------------------------------------------
  const nPix = Math.ceil(((fov * 60 * 1.42) / PIXEL_ARCSEC) / 2) * 2 + 1;
  const fwhm = 7.5;
  const sigmaPix = fwhm / 2.3548 / PIXEL_ARCSEC;
  const root2 = Math.SQRT2 * sigmaPix;
  const reach = Math.ceil(4 * sigmaPix) + 1;
  const frames = [];
  const baseRoll = [222, 41, 224, 43, 221];
  passMjds.forEach((start, passIndex) => {
    for (let k = 0; k < exposuresPerPass; k++) {
      const mjd = start + k * 0.14 + (rng() - 0.5) * 0.01;
      const rollDeg = baseRoll[passIndex % baseRoll.length] + (rng() - 0.5) * 6;
      const pointing = offsetBy(ra0, dec0, (rng() - 0.5) * PIXEL_ARCSEC * 1.6, (rng() - 0.5) * PIXEL_ARCSEC * 1.6);
      const step = passIndex % 2 === 0 ? k : exposuresPerPass - 1 - k;
      const frac = (step + 0.5) / exposuresPerPass;
      for (const det of dets) {
        const band = DETECTORS[det - 1] || DETECTORS[2];
        const waveCenter = band.min * Math.pow(band.max / band.min, 0.04 + 0.92 * frac);
        const wcs = {
          crpix: [(nPix + 1) / 2, (nPix + 1) / 2], crval: [pointing.ra, pointing.dec],
          pc: rollToPc(rollDeg), cdelt: [1, 1], sip: null,
        };
        const w = makeWcs(wcs);
        const count = nPix * nPix;
        const signal = new Float64Array(count);
        const zodi = new Float32Array(count).fill(0.3);
        const wave = new Float32Array(count);
        const flags = new Int32Array(count);
        for (let y = 0; y < nPix; y++) {
          for (let x = 0; x < nPix; x++) {
            wave[y * nPix + x] = waveCenter * (1 - 0.0006 * (y - (nPix - 1) / 2));
            signal[y * nPix + x] = 0.3 + 0.02;
          }
        }
        for (const src of sources) {
          const pos = propagate({ ...src.star, epoch: GAIA_EPOCH }, mjd);
          const [px, py] = w.skyToPix(pos.ra, pos.dec);
          if (!(px > -reach && px < nPix + reach && py > -reach && py < nPix + reach)) continue;
          const atWave = waveCenter * (1 - 0.0006 * (py - (nPix - 1) / 2));
          const flux = src.flux * Math.pow(atWave / 1.6, src.alpha) * (src.scaleAt ? src.scaleAt(mjd) : 1);
          const cx = Math.round(px);
          const cy = Math.round(py);
          for (let y = Math.max(0, cy - reach); y <= Math.min(nPix - 1, cy + reach); y++) {
            const fy = 0.5 * (erf((y + 0.5 - py) / root2) - erf((y - 0.5 - py) / root2));
            for (let x = Math.max(0, cx - reach); x <= Math.min(nPix - 1, cx + reach); x++) {
              const fx = 0.5 * (erf((x + 0.5 - px) / root2) - erf((x - 0.5 - px) / root2));
              signal[y * nPix + x] += (flux * fx * fy) / UJY_PER_MJYSR_PIX;
            }
          }
        }
        const image = new Float32Array(count);
        const variance = new Float32Array(count);
        for (let i = 0; i < count; i++) {
          const v = 0.0006 + 0.0005 * Math.max(signal[i], 0);
          variance[i] = v;
          image[i] = signal[i] + (noise ? Math.sqrt(v) * gaussian(rng) : 0);
          if (badPixels && rng() < 0.0015) {
            flags[i] |= 1 << BIT_HOT;
            image[i] = 80 + 400 * rng();
          }
        }
        frames.push({
          id: `fake/${passIndex + 1}/${k}/D${det}`, det, nx: nPix, ny: nPix, mjd, exptime: 113.58,
          release: passIndex === passMjds.length - 1 ? 'qr3' : 'dr1', obsid: `FAKE_${passIndex + 1}_${k}`,
          version: 'fake-1', wcs, image, variance, zodi, flags, wave, waveCenter, bwCenter: waveCenter / 41,
          psfFwhm: fwhm,
        });
      }
    }
  });
  frames.sort((a, b) => a.mjd - b.mjd || a.det - b.det);

  let target = { ra: ra0, dec: dec0, name: 'Fake field' };
  if (truth.mover) {
    const now = propagate({ ...truth.mover.star, epoch: GAIA_EPOCH }, midMjd);
    target = { ra: now.ra, dec: now.dec, name: 'Fake mover' };
  }
  return { grid, frames, gaia: { epoch: GAIA_EPOCH, stars }, truth, target };
}

/** Reproject the frames of a fake field onto its grid, grouped by detector. */
export function fakeLayers(field) {
  const byDet = new Map();
  for (const frame of field.frames) {
    if (!byDet.has(frame.det)) byDet.set(frame.det, []);
    byDet.get(frame.det).push(reproject(frame, field.grid, {}));
  }
  return byDet;
}
