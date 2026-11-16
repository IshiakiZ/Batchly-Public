// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

// photometry.js imports makeWcs from ./wcs.js (another module's file). These tests inject their
// own linear WCS, so they must run even if that file is absent or broken: this resolve hook
// substitutes a stub only when './wcs.js' cannot be resolved, and is a no-op otherwise.
register(`data:text/javascript,${encodeURIComponent(`
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (/(^|\\/)wcs\\.js$/.test(specifier)) {
      return {
        url: 'data:text/javascript,export function makeWcs() { throw new Error("wcs.js is missing: pass opts.wcsFactory"); }',
        shortCircuit: true,
      };
    }
    throw err;
  }
}`)}`);

const {
  aperturePhot, extractSpectrum, binSpectrum, lightCurve, fitSpectrumModel, fluxToABmag,
  saturationRadius, wingPhot, wingPoints,
  MJYSR_TO_UJY_PER_PIX, PHOT_BAD_MASK, PHOT_BAD_BITS,
} = await import('./photometry.js');
const { channelOf, channelRange } = await import('./frames.js');

function rng(seed) {
  let a = seed >>> 0;
  const u = () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const g = () => Math.sqrt(-2 * Math.log(u() || 1e-12)) * Math.cos(2 * Math.PI * u());
  return { u, g };
}

// Error function (Abramowitz & Stegun 7.1.26, |error| < 1.5e-7), to integrate a Gaussian PSF
// over each pixel so that the injected flux is exactly conserved.
function erf(x) {
  const s = x < 0 ? -1 : 1;
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}

// A linear stand-in for the frame WCS: 6.15 arcsec pixels, pixel (0, 0) at (RA0, DEC0).
const RA0 = 150;
const DEC0 = 20;
const PIX_DEG = 6.15 / 3600;
const wcsFactory = (wcs) => ({
  skyToPix: (ra, dec) => [(ra - wcs.ra0) / PIX_DEG, (dec - wcs.dec0) / PIX_DEG],
  pixToSky: (x, y) => [wcs.ra0 + x * PIX_DEG, wcs.dec0 + y * PIX_DEG],
});
const skyOf = (x, y) => [RA0 + x * PIX_DEG, DEC0 + y * PIX_DEG];

const PSF_FWHM = 7.46; // arcsec, as in real headers: barely more than one 6.15 arcsec pixel
const PSF_SIGMA = PSF_FWHM / 6.15 / 2.3548; // pixels
const SKY = 0.05;   // residual sky, MJy/sr
const ZODI = 0.13;  // zodiacal light, MJy/sr (in `image` and in `zodi`)
const NOISE = 0.01; // per pixel

/** Native frame with one Gaussian source of total `flux` (MJy/sr x pixels) at (x0, y0). */
function makeFrame({ nx = 41, ny = 41, x0 = 20.3, y0 = 19.6, flux = 20, sigma = PSF_SIGMA, seed = 1, noise = NOISE, wave0 = 2.0, mjd = 61000, det = 3, id = 'f' }) {
  const r = rng(seed);
  const image = new Float32Array(nx * ny);
  const a = 1 / (Math.SQRT2 * sigma);
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      const fx = 0.5 * (erf((x + 0.5 - x0) * a) - erf((x - 0.5 - x0) * a));
      const fy = 0.5 * (erf((y + 0.5 - y0) * a) - erf((y - 0.5 - y0) * a));
      image[y * nx + x] = SKY + ZODI + flux * fx * fy + noise * r.g();
    }
  }
  const wave = new Float32Array(nx * ny);
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) wave[y * nx + x] = wave0 * (1 - 0.0002 * (y - 20));
  return {
    id, det, nx, ny, mjd, exptime: 113.6, release: 'qr3', obsid: 'test',
    wcs: { ra0: RA0, dec0: DEC0 },
    image, variance: new Float32Array(nx * ny).fill(noise * noise), zodi: new Float32Array(nx * ny).fill(ZODI),
    flags: new Int32Array(nx * ny), wave, waveCenter: wave0, bwCenter: wave0 / 41, psfFwhm: PSF_FWHM,
  };
}

test('unit conversion constant', () => {
  assert.equal(MJYSR_TO_UJY_PER_PIX, 889);
  // 1 MJy/sr over a 6.15 arcsec square pixel, in microjansky.
  const sr = (6.15 / 206264.806) ** 2;
  assert.ok(Math.abs(1e12 * sr - MJYSR_TO_UJY_PER_PIX) / MJYSR_TO_UJY_PER_PIX < 0.005);
  assert.deepEqual(PHOT_BAD_BITS, [0, 1, 2, 6, 9, 10, 11, 15, 17, 19, 25, 26, 27]);
  assert.equal(PHOT_BAD_MASK, PHOT_BAD_BITS.reduce((m, b) => m + 2 ** b, 0));
  assert.equal(PHOT_BAD_MASK & (1 << 21), 0, 'SOURCE is not a defect');
});

test('aperturePhot recovers an injected Gaussian source within 3 percent', () => {
  const flux = 20;
  const truth = flux * MJYSR_TO_UJY_PER_PIX;
  // Different sub-pixel positions: the result must not depend on where in a pixel the star sits.
  for (const [x0, y0] of [[20.3, 19.6], [20.0, 20.0], [20.5, 20.5], [19.77, 20.12]]) {
    const frame = makeFrame({ x0, y0, flux });
    const p = aperturePhot(frame, ...skyOf(x0, y0), { wcsFactory });
    assert.equal(p.ok, true);
    assert.equal(p.flagged, false);
    assert.ok(Math.abs(p.flux_uJy / truth - 1) < 0.03, `default aperture at ${x0},${y0}: ${p.flux_uJy / truth}`);
    assert.ok(Math.abs(p.x - x0) < 1e-6 && Math.abs(p.y - y0) < 1e-6);
    assert.ok(Math.abs(p.bg - SKY) < 0.004, `local background ${p.bg}`);
    assert.ok(p.apcor > 0.85 && p.apcor <= 1, `aperture correction ${p.apcor}`);
    // A wide aperture collects everything, with or without the correction.
    const wide = aperturePhot(frame, ...skyOf(x0, y0), { wcsFactory, rPix: 3, rIn: 5, rOut: 8 });
    assert.ok(Math.abs(wide.flux_uJy / truth - 1) < 0.015, `wide aperture: ${wide.flux_uJy / truth}`);
    assert.ok(wide.err_uJy > p.err_uJy, 'more pixels, more noise');
    const wideRaw = aperturePhot(frame, ...skyOf(x0, y0), { wcsFactory, rPix: 3, rIn: 5, rOut: 8, apCorr: false });
    assert.equal(wideRaw.apcor, 1);
    assert.ok(Math.abs(wideRaw.flux_uJy / truth - 1) < 0.015, `wide aperture, uncorrected: ${wideRaw.flux_uJy / truth}`);
  }
});

test('the aperture correction removes the pixel-phase dependence of a small aperture', () => {
  // Noise-free star stepped across a pixel: without the correction the default aperture loses
  // about 5%, by an amount that depends on the sub-pixel position.
  const raw = [];
  const corrected = [];
  for (let k = 0; k < 11; k++) {
    const x0 = 20 + k / 10;
    const y0 = 20 + ((k * 3) % 10) / 10;
    const frame = makeFrame({ x0, y0, flux: 20, noise: 1e-9 });
    raw.push(aperturePhot(frame, ...skyOf(x0, y0), { wcsFactory, apCorr: false }).flux_uJy / (20 * 889));
    corrected.push(aperturePhot(frame, ...skyOf(x0, y0), { wcsFactory }).flux_uJy / (20 * 889));
  }
  const spread = (v) => Math.max(...v) - Math.min(...v);
  assert.ok(Math.min(...raw) < 0.97 && spread(raw) > 0.01, `uncorrected ${Math.min(...raw)}..${Math.max(...raw)}`);
  assert.ok(corrected.every((c) => Math.abs(c - 1) < 0.003), `corrected ${Math.min(...corrected)}..${Math.max(...corrected)}`);
  // A frame without a PSF width is measured uncorrected rather than guessed at.
  const frame = makeFrame({});
  frame.psfFwhm = undefined;
  assert.equal(aperturePhot(frame, ...skyOf(20.3, 19.6), { wcsFactory }).apcor, 1);
});

test('aperturePhot error bar matches the scatter of repeated measurements', () => {
  const fluxes = [];
  const errs = [];
  for (let k = 0; k < 300; k++) {
    const p = aperturePhot(makeFrame({ seed: 100 + k, flux: 5 }), ...skyOf(20.3, 19.6), { wcsFactory });
    fluxes.push(p.flux_uJy);
    errs.push(p.err_uJy);
  }
  const mean = fluxes.reduce((a, b) => a + b, 0) / fluxes.length;
  const scatter = Math.sqrt(fluxes.reduce((a, b) => a + (b - mean) ** 2, 0) / (fluxes.length - 1));
  const meanErr = errs.reduce((a, b) => a + b, 0) / errs.length;
  assert.ok(scatter / meanErr > 0.8 && scatter / meanErr < 1.25, `scatter ${scatter} vs quoted ${meanErr}`);
  // About sqrt(8 pixels) x noise, plus a little for the background.
  const expected = NOISE * Math.sqrt(Math.PI * 1.6 * 1.6) * MJYSR_TO_UJY_PER_PIX;
  assert.ok(meanErr > 0.8 * expected && meanErr < 1.5 * expected, `quoted ${meanErr}, rough expectation ${expected}`);
  // Blank sky: flux consistent with zero.
  const blank = aperturePhot(makeFrame({ flux: 0, seed: 7 }), ...skyOf(12, 28), { wcsFactory });
  assert.ok(Math.abs(blank.flux_uJy) < 4 * blank.err_uJy);
});

test('aperturePhot: zodi, flags, edges, wavelength', () => {
  const frame = makeFrame({});
  const [ra, dec] = skyOf(20.3, 19.6);
  const base = aperturePhot(frame, ra, dec, { wcsFactory });

  // Zodi is subtracted before measuring: the local background is the residual sky only.
  const withZodi = aperturePhot(frame, ra, dec, { wcsFactory, subtractZodi: false });
  assert.ok(Math.abs(withZodi.bg - (SKY + ZODI)) < 0.004);
  assert.ok(Math.abs(withZodi.flux_uJy - base.flux_uJy) < 1e-3 * base.flux_uJy, 'a flat zodi cancels either way');

  // A bad flag inside the aperture flags the point; the SOURCE bit does not; a bad pixel in the
  // annulus is simply left out of the background.
  frame.flags[20 * 41 + 20] = 1 << 21;
  assert.equal(aperturePhot(frame, ra, dec, { wcsFactory }).flagged, false);
  frame.flags[20 * 41 + 20] = 1 << 10; // HOT
  assert.equal(aperturePhot(frame, ra, dec, { wcsFactory }).flagged, true);
  assert.equal(aperturePhot(frame, ra, dec, { wcsFactory, badMask: 0 }).flagged, false);
  frame.flags[20 * 41 + 20] = 0;
  frame.flags[20 * 41 + 25] = 1 << 10;
  frame.image[20 * 41 + 25] = 500;
  const hotAnnulus = aperturePhot(frame, ra, dec, { wcsFactory });
  assert.equal(hotAnnulus.flagged, false);
  assert.ok(Math.abs(hotAnnulus.flux_uJy - base.flux_uJy) < 0.01 * base.flux_uJy);
  frame.image[19 * 41 + 20] = NaN; // a dead pixel in the aperture
  const dead = aperturePhot(frame, ra, dec, { wcsFactory });
  assert.equal(dead.flagged, true);
  assert.equal(dead.ok, true);

  // Off the frame or partly off: not ok, and nothing thrown.
  for (const [x, y] of [[0.5, 20], [20, 40.2], [-30, 5], [39.5, 39.5]]) {
    const p = aperturePhot(makeFrame({}), ...skyOf(x, y), { wcsFactory });
    assert.equal(p.ok, false, `aperture at ${x},${y}`);
    assert.ok(Number.isNaN(p.flux_uJy));
  }
  assert.equal(aperturePhot(makeFrame({}), ...skyOf(1.2, 1.2), { wcsFactory, rPix: 1.6 }).ok, true, 'just inside');
  assert.equal(aperturePhot(makeFrame({}), NaN, dec, { wcsFactory }).ok, false);
  assert.equal(aperturePhot(null, ra, dec, { wcsFactory }).ok, false);
  assert.equal(aperturePhot(makeFrame({}), ra, dec, { wcsFactory: () => { throw new Error('bad wcs'); } }).ok, false);

  // Wavelength and bandwidth at the position, time and detector passed through.
  assert.ok(Math.abs(base.wave - 2.0 * (1 - 0.0002 * (19.6 - 20))) < 1e-5, `wave ${base.wave}`);
  assert.ok(Math.abs(base.bw - base.wave / 41) < 1e-6);
  assert.equal(base.mjd, 61000);
  assert.equal(base.det, 3);
  assert.equal(base.id, 'f');
});

test('extractSpectrum: one point per frame, sorted by wavelength, optional track', () => {
  const frames = [2.3, 1.7, 2.0, 1.9].map((w, k) => makeFrame({ wave0: w, seed: k + 1, mjd: 61000 + k, id: `f${k}` }));
  // One frame does not contain the position at all.
  frames.push(makeFrame({ x0: -50, y0: -50, wave0: 2.1, id: 'off' }));
  frames[4].wcs = { ra0: RA0 + 1, dec0: DEC0 };
  const [ra, dec] = skyOf(20.3, 19.6);
  const pts = extractSpectrum(frames, ra, dec, { wcsFactory });
  assert.equal(pts.length, 4);
  assert.deepEqual(pts.map((p) => p.id), ['f1', 'f3', 'f2', 'f0']);
  for (const p of pts) assert.ok(Math.abs(p.flux_uJy / (20 * 889) - 1) < 0.03);
  const all = extractSpectrum(frames, ra, dec, { wcsFactory, keepFailed: true });
  assert.equal(all.length, 5);
  assert.equal(all[4].ok, false, 'failed points sort last');
  // Following a moving target: the track overrides the position per frame.
  const moved = extractSpectrum(frames.slice(0, 4), 0, 0, { wcsFactory, track: () => ({ ra, dec }) });
  assert.equal(moved.length, 4);
  assert.deepEqual(extractSpectrum([], ra, dec, { wcsFactory }), []);
});

test('binSpectrum: weighted mean per channel, flagged points and outliers rejected', () => {
  const r = rng(42);
  const pts = [];
  const [lo, hi] = [1.63, 2.41];
  for (let k = 0; k < 170; k++) {
    const wave = lo * Math.pow(hi / lo, (k + 0.5) / 170);
    const err = 4 + 4 * r.u();
    pts.push({ flux_uJy: 100 + err * r.g(), err_uJy: err, wave, bw: 0.04, mjd: 61000 + k, det: 3, flagged: false, ok: true });
  }
  const clean = binSpectrum(pts);
  assert.equal(clean.length, 17);
  pts[5].flux_uJy = 5000; pts[5].flagged = true;       // flagged: ignored
  pts[25].flux_uJy = 100 + 30 * pts[25].err_uJy;       // 30 sigma outlier: rejected
  pts[45].flux_uJy = NaN;                              // not a measurement
  pts[65].ok = false; pts[65].flux_uJy = 1e6;
  const bins = binSpectrum(pts);
  assert.equal(bins.length, 17);
  let chi2 = 0;
  for (let b = 0; b < 17; b++) {
    const bin = bins[b];
    assert.equal(bin.det, 3);
    assert.equal(bin.ch, b);
    assert.equal(channelOf(3, bin.wave), b);
    assert.ok(Math.abs(bin.bw - (channelRange(3, b)[1] - channelRange(3, b)[0])) < 1e-9);
    assert.ok(bin.err_uJy > 1 && bin.err_uJy < 4, `error of the mean ${bin.err_uJy}`);
    assert.ok(Math.abs(bin.flux_uJy - 100) < 4.5 * bin.err_uJy, `bin ${b}: ${bin.flux_uJy} +- ${bin.err_uJy}`);
    assert.equal(bin.flagged, false);
    chi2 += ((bin.flux_uJy - 100) / bin.err_uJy) ** 2;
    if (b > 0) assert.ok(bin.wave > bins[b - 1].wave);
  }
  assert.ok(chi2 / 17 < 2.5, `binned chi2 per bin ${chi2 / 17}`);
  assert.equal(bins[channelOf(3, pts[25].wave)].nRejected, 1);
  assert.equal(bins.reduce((s, b) => s + b.n, 0), 170 - 4);
  // Detector inferred from the wavelength when missing; one bin per detector on request.
  const noDet = pts.map(({ det, ...p }) => p);
  assert.equal(binSpectrum(noDet).length, 17);
  const broad = binSpectrum(pts, { perChannel: false });
  assert.equal(broad.length, 1);
  assert.equal(broad[0].ch, -1);
  assert.ok(Math.abs(broad[0].flux_uJy - 100) < 2);
  assert.deepEqual(binSpectrum([]), []);
});

test('lightCurve: brightness changes show despite every point being a different colour', () => {
  const r = rng(8);
  const pts = [];
  for (let pass = 0; pass < 3; pass++) {
    for (let k = 0; k < 28; k++) {
      // Two detectors, a steep spectrum, pass 1 is 50% brighter.
      const det = k % 2 ? 3 : 4;
      const [lo, hi] = det === 3 ? [1.63, 2.41] : [2.42, 3.82];
      const wave = lo * Math.pow(hi / lo, ((k * 0.618 + pass * 0.3) % 1));
      const flux = 400 * Math.pow(wave / 2, -1.8) * (pass === 1 ? 1.5 : 1);
      const err = 6;
      pts.push({ flux_uJy: flux + err * r.g(), err_uJy: err, wave, bw: 0.05, mjd: 60830 + 182 * pass + k * 0.1, det, flagged: false, ok: true });
    }
  }
  pts.push({ flux_uJy: 9999, err_uJy: 6, wave: 2.0, mjd: 60831, det: 3, flagged: true, ok: true });
  const lc = lightCurve(pts);
  assert.equal(lc.length, 84, 'flagged point left out');
  for (let k = 1; k < lc.length; k++) assert.ok(lc[k].mjd >= lc[k - 1].mjd, 'sorted by time');
  const med = (pass) => {
    const v = lc.filter((p) => Math.floor((p.mjd - 60830 + 1) / 182) === pass).map((p) => p.ratio).sort((a, b) => a - b);
    return v[v.length >> 1];
  };
  // The raw fluxes span a factor of several because of colour alone...
  const raw = pts.filter((p) => !p.flagged && p.mjd < 60900).map((p) => p.flux_uJy);
  assert.ok(Math.max(...raw) / Math.min(...raw) > 3);
  // ...but relative to the smooth spectrum the quiet passes sit at 1 and the bright one at 1.5.
  assert.ok(Math.abs(med(0) - 1) < 0.05, `pass 0 ratio ${med(0)}`);
  assert.ok(Math.abs(med(1) - 1.5) < 0.08, `pass 1 ratio ${med(1)}`);
  assert.ok(Math.abs(med(2) - 1) < 0.05, `pass 2 ratio ${med(2)}`);
  assert.ok(lc.every((p) => p.err > 0 && p.wave > 0 && Number.isFinite(p.model_uJy)));

  const model = fitSpectrumModel(pts);
  assert.deepEqual([...model.dets.keys()].sort(), [3, 4]);
  assert.ok(Math.abs(model.evaluate(2.0, 3) / 400 - 1) < 0.05);
  assert.ok(Number.isNaN(model.evaluate(1.0, 1)), 'no model where there is no data');
  const curve = model.curve(10);
  assert.equal(curve.length, 20);
  assert.ok(curve.every((c) => c.flux_uJy > 0));
  assert.deepEqual(lightCurve([]), []);
  assert.deepEqual(lightCurve([{ flux_uJy: 5, err_uJy: 1, wave: 2, mjd: 1, det: 3, ok: true }]), [], 'one point: no model');
});

/** A bright star with real-looking wings whose core the pipeline has flagged as saturated. */
function saturatedFrame({ x0, y0, flux, wave0, mjd, seed, rCore = 2.2 }) {
  // Core plus a broad halo holding 12% of the light, so there is something to measure outside.
  const core = makeFrame({ nx: 45, ny: 45, x0, y0, flux: 0.88 * flux, seed, wave0, mjd, noise: 0.01 });
  const halo = makeFrame({ nx: 45, ny: 45, x0, y0, flux: 0.12 * flux, sigma: 3.2, seed: seed + 500, wave0, mjd, noise: 0 });
  for (let i = 0; i < core.image.length; i++) core.image[i] += halo.image[i] - SKY - ZODI;
  for (let y = 0; y < core.ny; y++) {
    for (let x = 0; x < core.nx; x++) {
      if (Math.hypot(x - x0, y - y0) > rCore) continue;
      const i = y * core.nx + x;
      core.flags[i] = (1 << 0) | (1 << 2) | (1 << 26) | (1 << 21);
      core.image[i] = 14 + 3 * Math.sin(i); // what a saturated ramp leaves behind: not the star
    }
  }
  return core;
}

test('a saturated star: the flagged core is found and the wings carry its light curve', () => {
  const [x0, y0] = [22.3, 21.6];
  const frames = [];
  const truth = [];
  for (let k = 0; k < 60; k++) {
    const mjd = 60800 + k * 8;
    const vary = 1 + 0.4 * Math.sin((2 * Math.PI * (mjd - 60800)) / 245); // a Mira-like swing
    const wave0 = 1.63 * Math.pow(2.41 / 1.63, (k * 0.618) % 1);
    const colour = Math.pow(wave0 / 2, -1.2);
    truth.push({ mjd, vary });
    frames.push(saturatedFrame({ x0: x0 + 0.3 * Math.sin(k), y0: y0 + 0.3 * Math.cos(k * 1.7), flux: 4000 * colour * vary, wave0, mjd, seed: 100 + k }));
  }
  // The frames are dithered: each has its own WCS zero point so the star stays at one sky position.
  const [ra, dec] = skyOf(x0, y0);
  frames.forEach((f, k) => {
    f.wcs = { ra0: RA0 - 0.3 * Math.sin(k) * PIX_DEG, dec0: DEC0 - 0.3 * Math.cos(k * 1.7) * PIX_DEG };
  });

  const r = saturationRadius(frames[0], x0 + 0.3 * Math.sin(0), y0 + 0.3 * Math.cos(0));
  assert.ok(r >= 1.5 && r <= 3.5, `core radius ${r}`);
  assert.equal(saturationRadius(makeFrame({}), 20.3, 19.6), 0, 'a clean star has no core');

  const pts = extractSpectrum(frames, ra, dec, { wcsFactory });
  assert.equal(pts.length, 60);
  assert.ok(pts.every((p) => p.flagged && p.sat && p.wingOk), 'every core is flagged, every ring is usable');
  assert.ok(pts.every((p) => p.wingR1 === pts[0].wingR1 && p.wingR2 === pts[0].wingR2), 'one ring for all frames');
  assert.ok(pts[0].wingR1 >= 2.5 && pts[0].wingR1 <= 4.5, `ring starts at ${pts[0].wingR1}`);
  assert.equal(binSpectrum(pts).length, 0, 'no absolute spectrum from a saturated core');

  const lc = lightCurve(pts);
  assert.equal(lc.length, 60);
  assert.ok(lc.every((p) => p.method === 'wings'));
  // The ratio follows the injected variation (up to one overall factor).
  const scale = lc.reduce((a, p, k) => a + p.ratio / truth[k].vary, 0) / lc.length;
  let worst = 0;
  lc.forEach((p, k) => { worst = Math.max(worst, Math.abs(p.ratio / scale / truth[k].vary - 1)); });
  assert.ok(worst < 0.08, `largest departure from the injected light curve: ${worst}`);
  const swing = Math.max(...lc.map((p) => p.ratio)) / Math.min(...lc.map((p) => p.ratio));
  assert.ok(swing > 1.9 && swing < 2.8, `peak to trough ${swing} (injected 2.33)`);

  // An unsaturated source is left alone, and a few cosmic-ray hits do not make it "saturated".
  const clean = [];
  for (let k = 0; k < 20; k++) clean.push(makeFrame({ seed: 300 + k, wave0: 1.7 + 0.03 * k, mjd: 60800 + k }));
  for (let k = 0; k < 4; k++) clean[k].flags[20 * 41 + 20] = 1;
  const cp = extractSpectrum(clean, ...skyOf(20.3, 19.6), { wcsFactory });
  assert.ok(cp.every((p) => !p.sat));
  assert.equal(wingPoints(cp), null);
  assert.ok(lightCurve(cp).every((p) => p.method === 'aperture'));

  const w = wingPhot(frames[0], ra, dec, 3.5, 6, { wcsFactory });
  assert.ok(w.ok && w.flux_uJy > 0 && w.err_uJy > 0 && w.good > 0.95);
  assert.equal(wingPhot(frames[0], ...skyOf(1, 1), 3.5, 6, { wcsFactory }).ok, false, 'ring off the frame');
});

test('a saturated star with a ragged core: frames that lose part of the ring stay on the same scale', () => {
  const [x0, y0] = [22.3, 21.6];
  const build = (ragged) => {
    const frames = [];
    for (let k = 0; k < 40; k++) {
      const dx = 0.3 * Math.sin(k);
      const dy = 0.3 * Math.cos(k * 1.7);
      const f = saturatedFrame({ x0: x0 + dx, y0: y0 + dy, flux: 4000, wave0: 1.7 + 0.01 * k, mjd: 60800 + k * 5, seed: 700 + k });
      f.wcs = { ra0: RA0 - dx * PIX_DEG, dec0: DEC0 - dy * PIX_DEG };
      if (ragged && k % 2 === 1) {
        // Every other frame the flagged region spills outward on one side (a bleed), eating the
        // inner part of the ring there. The star itself has not changed.
        for (let y = 0; y < f.ny; y++) {
          for (let x = 0; x < f.nx; x++) {
            const r = Math.hypot(x - (x0 + dx), y - (y0 + dy));
            if (r > 2.2 && r < 4.6 && x > x0 + dx + 0.5) f.flags[y * f.nx + x] |= 1 << 26;
          }
        }
      }
      frames.push(f);
    }
    return frames;
  };
  const [ra, dec] = skyOf(x0, y0);
  const spread = (pts) => {
    const v = pts.filter((p) => p.wingOk).map((p) => p.wing_uJy);
    const odd = v.filter((_, k) => k % 2 === 1);
    const even = v.filter((_, k) => k % 2 === 0);
    const mean = (a) => a.reduce((s, t) => s + t, 0) / a.length;
    return { n: v.length, step: mean(odd) / mean(even) };
  };
  const clean = spread(extractSpectrum(build(false), ra, dec, { wcsFactory }));
  assert.ok(Math.abs(clean.step - 1) < 0.02, `clean frames: odd/even ${clean.step}`);
  const ragged = spread(extractSpectrum(build(true), ra, dec, { wcsFactory }));
  assert.ok(ragged.n >= 36, `usable ragged frames: ${ragged.n}`);
  // A plain mean of the surviving ring pixels would read the ragged frames about 20% low.
  assert.ok(Math.abs(ragged.step - 1) < 0.05, `ragged frames against whole ones: ${ragged.step}`);
});

test('a heavily saturated star whose core is blank (NaN) still gets a light curve from its wings', () => {
  const [x0, y0] = [22.3, 21.6];
  const frames = [];
  const truth = [];
  for (let k = 0; k < 40; k++) {
    const mjd = 60800 + k * 9;
    const vary = 1 + 0.35 * Math.sin((2 * Math.PI * k) / 27);
    truth.push(vary);
    const f = saturatedFrame({ x0, y0, flux: 9000 * vary, wave0: 1.63 * Math.pow(2.41 / 1.63, (k * 0.618) % 1), mjd, seed: 900 + k, rCore: 3.4 });
    // three frames in four the pipeline leaves the core without any value at all
    if (k % 4 !== 0) for (let i = 0; i < f.image.length; i++) if (f.flags[i] & (1 << 26)) f.image[i] = NaN;
    frames.push(f);
  }
  const [ra, dec] = skyOf(x0, y0);
  const pts = extractSpectrum(frames, ra, dec, { wcsFactory });
  assert.equal(pts.length, 40, 'blank-core frames are kept for their wings');
  assert.equal(pts.filter((p) => p.ok).length, 10);
  assert.ok(pts.every((p) => p.sat && p.wingOk && p.wave > 0));
  assert.equal(binSpectrum(pts).length, 0);
  const lc = lightCurve(pts);
  assert.equal(lc.length, 40);
  const scale = lc.reduce((a, p, k) => a + p.ratio / truth[k], 0) / lc.length;
  let worst = 0;
  lc.forEach((p, k) => { worst = Math.max(worst, Math.abs(p.ratio / scale / truth[k] - 1)); });
  assert.ok(worst < 0.08, `largest departure from the injected light curve: ${worst}`);
  // keepFailed keeps the old contract: one point per frame, failed ones included once
  assert.equal(extractSpectrum(frames, ra, dec, { wcsFactory, keepFailed: true }).length, 40);
  // a blank patch that is not a saturated star (no wings to speak of) adds nothing
  const dark = [];
  for (let k = 0; k < 10; k++) {
    const f = makeFrame({ seed: 40 + k, flux: 0, wave0: 1.7 + 0.03 * k, mjd: 60800 + k });
    for (let y = 17; y <= 23; y++) for (let x = 17; x <= 23; x++) { f.image[y * f.nx + x] = NaN; f.flags[y * f.nx + x] = 1 << 6; }
    dark.push(f);
  }
  const dp = extractSpectrum(dark, ...skyOf(20.3, 19.6), { wcsFactory });
  assert.ok(lightCurve(dp).length === 0, 'no light curve from a dead patch');
});

test('lightCurve: a deep field with a molecular band the polynomial cannot follow', () => {
  // 240 measurements over 480 days, wavelengths in no order, a deep notch at 1.9 um, and a
  // slow 30% swing in brightness.
  let seed = 11;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const band = (w) => 1 - 0.6 * Math.exp(-0.5 * ((w - 1.9) / 0.035) ** 2);
  const make = (n, tOf, wOf) => {
    const pts = [];
    for (let k = 0; k < n; k++) {
      const mjd = tOf(k);
      const wave = wOf(k);
      const vary = 1 + 0.3 * Math.sin((2 * Math.PI * (mjd - 60800)) / 245);
      const flux = 5000 * Math.pow(wave / 2, -1) * band(wave) * vary * (1 + 0.02 * (rnd() - 0.5));
      pts.push({ flux_uJy: flux, err_uJy: 0.02 * flux, wave, bw: 0.04, mjd, det: 3, flagged: false, ok: true, vary });
    }
    return pts;
  };
  const deep = make(240, (k) => 60800 + k * 2, () => 1.64 + 0.78 * rnd());
  const lc = lightCurve(deep);
  assert.equal(lc.length, 240);
  assert.ok(lc.every((p) => p.refined));
  const byMjd = new Map(deep.map((p) => [p.mjd, p.vary]));
  const scale = lc.reduce((a, p) => a + p.ratio / byMjd.get(p.mjd), 0) / lc.length;
  const dev = lc.map((p) => Math.abs(p.ratio / scale / byMjd.get(p.mjd) - 1)).sort((a, b) => a - b);
  assert.ok(dev[Math.floor(0.9 * dev.length)] < 0.12, `90% of points within ${dev[Math.floor(0.9 * dev.length)]} of the injected curve`);
  // In the notch the polynomial alone is off by tens of percent.
  const notch = lc.filter((p) => Math.abs(p.wave - 1.9) < 0.03);
  assert.ok(notch.length >= 5);
  for (const p of notch) assert.ok(Math.abs(p.ratio / scale / byMjd.get(p.mjd) - 1) < 0.25, `notch point off by ${p.ratio / scale / byMjd.get(p.mjd) - 1}`);

  // Two passes, wavelength marching with time inside each: a change between the passes must
  // survive (the time part of the split carries it), whether or not the step runs.
  const twoPass = make(120, (k) => (k < 60 ? 60800 + k * 0.2 : 60980 + (k - 60) * 0.2), (k) => 1.64 + 0.78 * ((k % 60) / 60));
  for (const p of twoPass) if (p.mjd > 60900) p.flux_uJy *= 1.5;
  const lc2 = lightCurve(twoPass);
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const up = mean(lc2.filter((p) => p.mjd > 60900).map((p) => p.ratio)) / mean(lc2.filter((p) => p.mjd < 60900).map((p) => p.ratio));
  const want = 1.5 * mean(twoPass.filter((p) => p.mjd > 60900).map((p) => p.vary)) / mean(twoPass.filter((p) => p.mjd < 60900).map((p) => p.vary));
  assert.ok(Math.abs(up / want - 1) < 0.06, `second pass against first: ${up}, injected ${want}`);
  // One pass: wavelength and time are the same thing, so the step does not run.
  const onePass = make(60, (k) => 60800 + k * 0.2, (k) => 1.64 + 0.78 * (k / 60));
  assert.ok(lightCurve(onePass).every((p) => !p.refined));
});

test('fluxToABmag', () => {
  assert.ok(Math.abs(fluxToABmag(3631e6)) < 1e-3); // 3631 Jy is magnitude 0
  assert.ok(Math.abs(fluxToABmag(1) - 23.9) < 1e-12);
  assert.ok(Math.abs(fluxToABmag(100) - 18.9) < 1e-12);
  assert.ok(Number.isNaN(fluxToABmag(0)));
  assert.ok(Number.isNaN(fluxToABmag(-3)));
  assert.ok(Number.isNaN(fluxToABmag(NaN)));
});
