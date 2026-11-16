// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  recover, recoverMany, detectionCurve, limitingFlux, limitDetail, analyticLimit_uJy, planFakes,
  passIndices, passPositions, wilson, seededRandom, formatFlux, formatTimes, limitSentences,
} from './recover.js';
import { planTrack, trackOnGrid, injectIntoLayers, ujyPerMJySr } from './inject.js';
import { makeGrid, gridPixToSky } from '../../core/wcs.js';
import { fitSkyModel, residualPassStacks, residualLayer, findCandidates } from '../../core/skymodel.js';
import { shiftAndStack } from '../../core/distance.js';

const lib = { fitSkyModel, residualPassStacks, residualLayer, findCandidates, shiftAndStack };
const noPause = () => Promise.resolve();

// ---- synthetic data ----------------------------------------------------------------------------
// Three survey passes of 14 exposures each, taken when the field (RA 150, Dec +20) is 90 degrees
// from the Sun as SPHEREx always is (MJD 60811, 60997, 61176: May 2025, Nov 2025, May 2026).
// Pure white noise of 0.02 MJy/sr per pixel, each exposure at its own wavelength in detector 6.

const grid = makeGrid(150, 20, 4);
const SIGMA = 0.02;
const QUADRATURES = [60811.25, 60996.75, 61176.5];
const MJDS = [];
for (const q of QUADRATURES) for (let i = 0; i < 14; i++) MJDS.push(q - 2 + i * 0.3);

function makeLayers(seed = 5) {
  const rng = seededRandom(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(rng(), 1e-12))) * Math.cos(2 * Math.PI * rng());
  const N = grid.n * grid.n;
  return MJDS.map((mjd, i) => {
    const image = new Float32Array(N);
    for (let k = 0; k < N; k++) image[k] = SIGMA * gauss();
    const wave = 4.42 + 0.58 * (((i * 7) % 14) + 0.5) / 14;
    return {
      frame: null, mjd, det: 6, image,
      variance: new Float32Array(N).fill(SIGMA * SIGMA),
      wave: new Float32Array(N).fill(wave),
      mask: new Uint8Array(N),
    };
  });
}

const LAYERS = makeLayers();
// A body at 20,000 AU hops 20 arcsec between passes; a drift of 27 arcsec a year keeps the third
// pass off the first, so every pass sees it somewhere new.
const MOTION = { raRate_arcsecPerYr: 25, decRate_arcsecPerYr: 10 };

function truthAt(x, y, distAU = 20000, motion = MOTION) {
  const [ra, dec] = gridPixToSky(grid, x, y);
  const track = planTrack({ ra, dec, distAU, mjds: MJDS, motion });
  return { track, positions: trackOnGrid(track, grid, LAYERS) };
}

// ---- helpers -----------------------------------------------------------------------------------

test('passIndices splits on gaps and passPositions averages the on-grid points', () => {
  const p = passIndices(LAYERS);
  assert.equal(p.count, 3);
  assert.equal(p.index[0], 0);
  assert.equal(p.index[14], 1);
  assert.equal(p.index[41], 2);
  // unordered input still gets time-ordered pass numbers
  const shuffled = passIndices([{ mjd: 61176 }, { mjd: 60811 }, { mjd: 60997 }, { mjd: NaN }]);
  assert.deepEqual(Array.from(shuffled.index), [2, 0, 1, -1]);
  const pos = LAYERS.map((_, i) => ({ x: 10 + Math.floor(i / 14), y: 20, onGrid: i !== 0 && i < 28 }));
  const pp = passPositions(pos, p);
  assert.equal(pp.length, 2, 'a pass with no on-grid point is left out');
  assert.equal(pp[0].count, 13);
  assert.equal(pp[0].x, 10);
  assert.equal(pp[1].x, 11);
});

test('wilson interval', () => {
  const [lo, hi] = wilson(4, 8);
  assert.ok(lo > 0.3 && lo < 0.5 && hi > 0.5 && hi < 0.7);
  assert.ok(Math.abs((lo + hi) / 2 - 0.5) < 1e-12);
  assert.equal(wilson(0, 8)[0], 0);
  assert.ok(wilson(0, 8)[1] > 0.05);
  assert.equal(wilson(8, 8)[1], 1);
  assert.deepEqual(wilson(0, 0), [0, 1]);
});

test('seededRandom is deterministic', () => {
  const a = seededRandom(42), b = seededRandom(42), c = seededRandom(43);
  const va = [a(), a(), a()], vb = [b(), b(), b()], vc = [c(), c(), c()];
  assert.deepEqual(va, vb);
  assert.notDeepEqual(va, vc);
  assert.ok(va.every((v) => v >= 0 && v < 1));
});

test('analyticLimit: white-noise matched filter, worked by hand', () => {
  // PSF sigma = 7.5 / 2.3548 / 3.075 = 1.0358 pixels. For a Gaussian integrated over pixels
  // sum(P^2) is close to 1 / (4 pi (sigma^2 + 1/12)) = 1 / 14.53, so one exposure has
  // sigma_F = 0.02 * sqrt(14.53) = 0.0762 MJy/sr pix = 16.9 uJy (222.25 uJy per MJy/sr per pixel),
  // and 42 exposures give 5 sigma = 5 * 16.9 / sqrt(42) = 13.1 uJy.
  const lim = analyticLimit_uJy(LAYERS, grid);
  assert.ok(Math.abs(ujyPerMJySr(grid.scale) - 222.25) < 1e-9);
  assert.ok(Math.abs(lim / 13.1 - 1) < 0.04, `got ${lim}`);
  assert.ok(Math.abs(analyticLimit_uJy(LAYERS.slice(0, 14), grid) / (lim * Math.sqrt(3)) - 1) < 1e-6);
  assert.ok(Math.abs(analyticLimit_uJy(LAYERS, grid, { count: 14 }) / (lim * Math.sqrt(3)) - 1) < 1e-6);
  assert.ok(Math.abs(analyticLimit_uJy(LAYERS, grid, { nSigma: 10 }) / (2 * lim) - 1) < 1e-9);
  assert.ok(analyticLimit_uJy(LAYERS, grid, { nativePixArcsec: 6.15 }) > 1.25 * lim, 'a wider PSF is harder');
  assert.ok(Number.isNaN(analyticLimit_uJy([], grid)));
  // falls back to the image scatter when a layer has no variance
  const bare = LAYERS.map((l) => ({ ...l, variance: null }));
  assert.ok(Math.abs(analyticLimit_uJy(bare, grid) / lim - 1) < 0.05);
});

// ---- recovery with the real pipeline -----------------------------------------------------------

test('a bright planted body is recovered, where it was put', async () => {
  const truth = truthAt(30.3, 44.6);
  const doctored = injectIntoLayers(LAYERS, grid, { track: truth.track, fluxAt: () => 300 });
  const r = await recover(doctored, grid, truth, lib, { pause: noPause });
  assert.equal(r.detected, true);
  assert.ok(r.snr > 20, `snr ${r.snr}`);
  assert.ok(['residual', 'stack'].includes(r.method));
  assert.equal(r.nOnGrid, 42);
  assert.ok(r.residual.snr > 10 && r.stack.snr > 20);
  assert.equal(r.blind, true, 'the blind candidate list flags it too');
  // `where` is one of the true positions, to the nearest pixel
  const near = truth.positions.some((p) => Math.hypot(p.x - r.where.x, p.y - r.where.y) < 0.8);
  assert.ok(near);
  assert.ok(Number.isFinite(r.where.ra) && Number.isFinite(r.where.dec));
  // a truth given only as a sky track works as well
  const r2 = await recover(doctored, grid, { track: truth.track }, lib, { pause: noPause });
  assert.equal(r2.detected, true);
  assert.ok(Math.abs(r2.snr - r.snr) < 1e-9);
});

test('a very faint planted body, and no body at all, are not recovered', async () => {
  const truth = truthAt(30.3, 44.6);
  const faint = injectIntoLayers(LAYERS, grid, { track: truth.track, fluxAt: () => 1 });
  const r = await recover(faint, grid, truth, lib, { pause: noPause });
  assert.equal(r.detected, false);
  assert.ok(r.snr < 4);
  assert.equal(r.blind, false);
  const none = await recover(LAYERS, grid, truth, lib, { pause: noPause });
  assert.equal(none.detected, false);
  assert.ok(Math.abs(none.stack.snr) < 4 && none.residual.snr < 4);
});

test('significance grows in proportion to brightness', async () => {
  const truth = truthAt(52.2, 31.4);
  const snr = [];
  for (const flux of [100, 200]) {
    const d = injectIntoLayers(LAYERS, grid, { track: truth.track, fluxAt: () => flux });
    snr.push((await recover(d, grid, truth, lib, { pause: noPause })).stack.snr);
  }
  assert.ok(snr[1] / snr[0] > 1.6 && snr[1] / snr[0] < 2.4, `ratio ${snr[1] / snr[0]}`);
});

test('a body that is on the grid in one pass only is still judged, from that pass', async () => {
  // 500 AU: the hop to the next pass is 13.7 arcmin, the field is 4 arcmin across
  const truth = truthAt(40, 40, 500, 'circular');
  const onGrid = truth.positions.filter((p) => p.onGrid).length;
  assert.ok(onGrid >= 10 && onGrid <= 28, `on grid in ${onGrid} exposures`);
  const d = injectIntoLayers(LAYERS, grid, { track: truth.track, fluxAt: () => 400 });
  const r = await recover(d, grid, truth, lib, { pause: noPause });
  assert.equal(r.nOnGrid, onGrid);
  assert.equal(r.detected, true);
});

test('noise alone almost never passes: 120 empty positions', async () => {
  const model = fitSkyModel(LAYERS);
  let worst = -Infinity;
  let hits = 0;
  const all = [];
  for (let seed = 1; seed <= 12; seed++) {
    const fakes = planFakes(LAYERS, grid, { count: 10, seed, distAU: 20000, motion: MOTION });
    const res = await recoverMany(LAYERS, grid, fakes, lib, { model, pause: noPause });
    for (const r of res) {
      if (r.detected) hits++;
      worst = Math.max(worst, r.snr);
      all.push(r.stack.snr);
    }
  }
  assert.equal(all.length, 120);
  assert.ok(hits <= 1, `${hits} false recoveries, worst ${worst}`);
  // the calibrated stack significance is close to unit normal on empty sky
  const mean = all.reduce((s, v) => s + v, 0) / all.length;
  const sd = Math.sqrt(all.reduce((s, v) => s + (v - mean) ** 2, 0) / all.length);
  assert.ok(Math.abs(mean) < 0.35 && sd > 0.75 && sd < 1.4, `mean ${mean}, sd ${sd}`);
});

// ---- recovery with stand-in core functions ------------------------------------------------------

test('recover runs on simple fakes of the core functions', async () => {
  // model = per-pixel mean of the layers of the OTHER passes is too clever for a fake; use the
  // plain per-pixel median over all layers, and an integer-shift mean for shiftAndStack that
  // returns only the contract fields (image, variance, count, mask).
  const fake = {
    fitSkyModel(layers) {
      const N = layers[0].image.length;
      const med = new Float32Array(N);
      const buf = new Float64Array(layers.length);
      for (let i = 0; i < N; i++) {
        for (let l = 0; l < layers.length; l++) buf[l] = layers[l].image[i];
        const s = Float64Array.from(buf).sort();
        med[i] = s[s.length >> 1];
      }
      return { med };
    },
    residualLayer(model, layer) {
      const image = new Float32Array(layer.image.length);
      for (let i = 0; i < image.length; i++) image[i] = layer.image[i] - model.med[i];
      return { image, mask: layer.mask };
    },
    shiftAndStack(layers, g, offsets) {
      const n = g.n;
      const image = new Float32Array(n * n).fill(NaN), variance = new Float32Array(n * n).fill(NaN);
      const count = new Uint16Array(n * n), mask = new Uint8Array(n * n).fill(1);
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          let s = 0, v = 0, c = 0;
          layers.forEach((layer, l) => {
            const o = offsets[l];
            if (!Number.isFinite(o.dEast)) return;
            const xx = x + Math.round(-o.dEast / g.scale), yy = y + Math.round(o.dNorth / g.scale);
            if (xx < 0 || yy < 0 || xx >= n || yy >= n) return;
            s += layer.image[yy * n + xx]; v += layer.variance[yy * n + xx]; c++;
          });
          if (c) { image[y * n + x] = s / c; variance[y * n + x] = v / (c * c); count[y * n + x] = c; mask[y * n + x] = 0; }
        }
      }
      return { image, variance, count, mask };
    },
  };
  const truth = truthAt(30.3, 44.6);
  const bright = injectIntoLayers(LAYERS, grid, { track: truth.track, fluxAt: () => 400 });
  const r = await recover(bright, grid, truth, fake, { pause: noPause });
  assert.equal(r.detected, true);
  assert.equal(r.method, 'stack');
  assert.equal(r.residual, null, 'no residualPassStacks was supplied');
  assert.equal(r.blind, null, 'no findCandidates was supplied');
  const faint = injectIntoLayers(LAYERS, grid, { track: truth.track, fluxAt: () => 1 });
  assert.equal((await recover(faint, grid, truth, fake, { pause: noPause })).detected, false);
  // with nothing at all to run, the answer is an honest "not evaluated"
  const none = await recover(bright, grid, truth, {}, { pause: noPause });
  assert.equal(none.detected, false);
  assert.equal(none.method, 'none');
  assert.ok(Number.isNaN(none.snr));
});

// ---- completeness curve ------------------------------------------------------------------------

test('detectionCurve: rises from none to all, monotonic within noise, limit near 5 sigma', async () => {
  const progress = [];
  const curve = await detectionCurve(LAYERS, grid, {
    lib, distAU: 20000, motion: MOTION, positions: 8, seed: 3, pause: noPause,
    onProgress: (p) => progress.push(p),
  });
  const pts = curve.points;
  assert.ok(pts.length >= 8);
  assert.equal(progress.length, pts.length);
  assert.equal(progress[progress.length - 1].done, pts.length);
  assert.equal(curve.nLayers, 42);
  assert.equal(curve.nPasses, 3);
  assert.equal(curve.fakes.length, 8);
  assert.equal(curve.trials.length, 8 * pts.length);
  for (let i = 1; i < pts.length; i++) assert.ok(pts[i].flux_uJy > pts[i - 1].flux_uJy, 'sorted by flux');
  // none at the faint end, all at the bright end
  assert.ok(pts[0].completeness <= 0.125, `faint end ${pts[0].completeness}`);
  assert.equal(pts[pts.length - 1].completeness, 1);
  // monotonic within noise: never drops by more than one body in eight
  for (let i = 1; i < pts.length; i++) {
    assert.ok(pts[i].completeness >= pts[i - 1].completeness - 0.13, `dip at ${pts[i].flux_uJy}`);
    assert.ok(pts[i].medianSnr > pts[i - 1].medianSnr - 0.5);
  }
  // error bars bracket the point
  for (const p of pts) assert.ok(p.lo <= p.completeness && p.completeness <= p.hi);
  // the 50 percent limit sits within a factor of two of 5 sigma of the stacked white noise
  const limit = limitingFlux(curve, 0.5);
  assert.ok(Math.abs(curve.expected_uJy / 13.1 - 1) < 0.05, `expected ${curve.expected_uJy}`);
  assert.ok(limit > curve.expected_uJy / 2 && limit < curve.expected_uJy * 2, `limit ${limit} vs ${curve.expected_uJy}`);
  // the blind candidate list needs a brighter body than a look at the known position
  const blind = limitDetail(curve, 0.5, 'blindCompleteness');
  assert.equal(blind.status, 'ok');
  assert.ok(blind.flux_uJy > limit);
  // the inputs were not modified
  const fresh = makeLayers();
  LAYERS.forEach((l, i) => { assert.deepEqual(l.image, fresh[i].image); assert.equal(l.injected, undefined); });
});

test('detectionCurve is deterministic for a seed and honours an explicit flux list', async () => {
  const opts = { lib, distAU: 20000, motion: MOTION, positions: 4, seed: 11, pause: noPause, fluxes: [200, 5, 40] };
  const a = await detectionCurve(LAYERS, grid, opts);
  const b = await detectionCurve(LAYERS, grid, opts);
  assert.deepEqual(a.points, b.points);
  assert.deepEqual(a.points.map((p) => p.flux_uJy), [5, 40, 200]);
  assert.equal(a.points[0].detected, 0);
  assert.equal(a.points[2].detected, 4);
  const c = await detectionCurve(LAYERS, grid, { ...opts, seed: 12 });
  assert.notDeepEqual(c.fakes.map((f) => f.positions[0].x), a.fakes.map((f) => f.positions[0].x));
  // a spectrum scales the planted flux at each exposure's wavelength
  const dim = await detectionCurve(LAYERS, grid, { ...opts, fluxes: [200], spectrum: () => 0.01 });
  assert.equal(dim.points[0].detected, 0);
});

test('detectionCurve can be cancelled', async () => {
  const pre = new AbortController();
  pre.abort();
  await assert.rejects(
    detectionCurve(LAYERS, grid, { lib, distAU: 20000, positions: 2, signal: pre.signal, pause: noPause }),
    (err) => err.name === 'AbortError',
  );
  const ctl = new AbortController();
  let seen = 0;
  await assert.rejects(
    detectionCurve(LAYERS, grid, {
      lib, distAU: 20000, motion: MOTION, positions: 2, signal: ctl.signal,
      onProgress: () => { seen++; ctl.abort(); },
    }),
    (err) => err.name === 'AbortError' && err.partial && err.partial.points.length === 1,
  );
  assert.equal(seen, 1);
  // recover honours the signal too
  await assert.rejects(recover(LAYERS, grid, truthAt(30, 30), lib, { signal: pre.signal }), (e) => e.name === 'AbortError');
});

test('detectionCurve on nothing returns an empty curve', async () => {
  const c = await detectionCurve([], grid, { lib, pause: noPause });
  assert.deepEqual(c.points, []);
  assert.equal(limitDetail(c).status, 'empty');
  assert.ok(Number.isNaN(limitingFlux(c)));
});

test('planFakes keeps test bodies apart and inside the margin', () => {
  const fakes = planFakes(LAYERS, grid, { count: 10, seed: 2, distAU: 20000, motion: MOTION, margin: 8, minSep: 10 });
  assert.equal(fakes.length, 10);
  for (const f of fakes) {
    const a = f.positions[f.anchorIndex];
    assert.ok(a.x >= 8 && a.x <= grid.n - 9 && a.y >= 8 && a.y <= grid.n - 9);
    assert.equal(f.positions.length, 42);
  }
  for (let i = 0; i < fakes.length; i++) {
    for (let j = i + 1; j < fakes.length; j++) {
      for (let k = 0; k < 42; k++) {
        const p = fakes[i].positions[k], q = fakes[j].positions[k];
        if (p.onGrid && q.onGrid) assert.ok(Math.hypot(p.x - q.x, p.y - q.y) >= 10);
      }
    }
  }
});

// ---- limit and wording -------------------------------------------------------------------------

test('limitingFlux interpolates in log flux and reports unbracketed curves', () => {
  const curve = [
    { flux_uJy: 10, completeness: 0, n: 8 },
    { flux_uJy: 100, completeness: 0.25, n: 8 },
    { flux_uJy: 1000, completeness: 0.75, n: 8 },
    { flux_uJy: 10000, completeness: 1, n: 8 },
  ];
  // halfway between 100 and 1000 in the log: 316
  assert.ok(Math.abs(limitingFlux(curve, 0.5) - Math.sqrt(100 * 1000)) < 1e-6);
  assert.ok(Math.abs(limitingFlux({ points: curve }, 0.25) - 100) < 1e-9);
  assert.ok(limitingFlux(curve, 0.9) > 1000 && limitingFlux(curve, 0.9) < 10000);
  // order of the points does not matter
  assert.ok(Math.abs(limitingFlux(curve.slice().reverse(), 0.5) - 316.2277660168) < 1e-6);
  // a noisy dip is smoothed before interpolating: [0, 0.75, 0.5, 1] -> [0, 0.625, 0.625, 1]
  const dip = [
    { flux_uJy: 1, completeness: 0, n: 8 }, { flux_uJy: 10, completeness: 0.75, n: 8 },
    { flux_uJy: 100, completeness: 0.5, n: 8 }, { flux_uJy: 1000, completeness: 1, n: 8 },
  ];
  assert.ok(Math.abs(limitingFlux(dip, 0.5) - Math.pow(10, 0.5 / 0.625)) < 1e-6);
  const above = limitDetail([{ flux_uJy: 5, completeness: 0 }, { flux_uJy: 50, completeness: 0.25 }]);
  assert.equal(above.status, 'above');
  assert.equal(above.max_uJy, 50);
  assert.ok(Number.isNaN(above.flux_uJy));
  const below = limitDetail([{ flux_uJy: 5, completeness: 0.75 }, { flux_uJy: 50, completeness: 1 }]);
  assert.equal(below.status, 'below');
  assert.equal(below.min_uJy, 5);
  assert.equal(limitDetail([]).status, 'empty');
});

test('numbers in words', () => {
  assert.equal(formatFlux(312.4), '310');
  assert.equal(formatFlux(1234), '1,200');
  assert.equal(formatFlux(15234), '15,000');
  assert.equal(formatFlux(7.43), '7.4');
  assert.equal(formatFlux(45.2), '45');
  assert.equal(formatFlux(0.138), '0.14');
  assert.equal(formatFlux(0.0213), '0.021');
  assert.equal(formatFlux(0), '0');
  assert.equal(formatFlux(NaN), '?');
  assert.equal(formatTimes(15234), '15,000 times');
  assert.equal(formatTimes(41.9), '42 times');
  assert.equal(formatTimes(2.54), '2.5 times');
  assert.equal(formatTimes(3), '3 times');
});

test('limitSentences say what was measured and no more', () => {
  const base = { nPasses: 3, nExposures: 252, distAU: 500, refWave: 4.5 };
  const planet = { short: 'A Neptune-size planet at 500 AU', flux_uJy: 7.4, caveat: 'grey albedo' };
  const ok = limitSentences({
    ...base, limit: { status: 'ok', flux_uJy: 312, min_uJy: 10, max_uJy: 2000 }, compare: planet,
    blindLimit: { status: 'ok', flux_uJy: 900 },
  });
  assert.equal(ok.headline, 'In this patch, with 3 passes and 252 exposures, Tombaugh recovers a planted body at 500 AU brighter than 310 µJy at 4.5 µm at least half of the time.');
  assert.equal(ok.comparison, 'A Neptune-size planet at 500 AU would be about 7.4 µJy there: about 42 times too faint. (Estimate: grey albedo.)');
  assert.match(ok.blind, /candidate list flags it above about 900 µJy/);
  assert.match(ok.caveat, /not a detection/);

  const bright = limitSentences({
    ...base, limit: { status: 'ok', flux_uJy: 100, min_uJy: 10, max_uJy: 2000 },
    compare: { short: 'A 250 K brown dwarf at 2.3 pc', flux_uJy: 450 },
  });
  assert.match(bright.comparison, /about 4\.5 times brighter than the limit, so it would probably have been recovered here\.$/);
  const close = limitSentences({
    ...base, limit: { status: 'ok', flux_uJy: 100, min_uJy: 10, max_uJy: 2000 }, compare: { short: 'X', flux_uJy: 90 },
  });
  assert.match(close.comparison, /close to the limit/);

  const above = limitSentences({ ...base, limit: { status: 'above', flux_uJy: NaN, min_uJy: 10, max_uJy: 2000 }, compare: planet });
  assert.match(above.headline, /fewer than half .* even at 2,000 µJy .* The limit is above that\./);
  assert.match(above.comparison, /more than 270 times too faint/);
  const below = limitSentences({ ...base, limit: { status: 'below', flux_uJy: NaN, min_uJy: 10, max_uJy: 2000 }, compare: planet });
  assert.match(below.headline, /The limit is below that\./);
  assert.match(below.comparison, /did not go faint enough/);
  const single = limitSentences({ ...base, nPasses: 1, nExposures: 1, limit: { status: 'ok', flux_uJy: 50, min_uJy: 1, max_uJy: 99 } });
  assert.match(single.headline, /with 1 pass and 1 exposure,/);
  assert.equal(single.comparison, '');
  assert.match(limitSentences({ ...base, limit: { status: 'empty' } }).headline, /could not be run/);

  for (const s of [ok, bright, close, above, below, single]) {
    for (const text of Object.values(s)) assert.ok(!text.includes('!'), 'no exclamation marks');
  }
});

// ---- the plugin's own pure helpers (index.js) ---------------------------------------------------

test('the Injected movie: every frame is watermarked and the inputs stay clean', async () => {
  const { buildInjectedMovie, plantedSentences, chooseSpot, WATERMARK, WATERMARK_OFF_FIELD, meta } = await import('./index.js');
  assert.equal(meta.id, 'inject');
  const spot = chooseSpot(LAYERS, grid, null);
  assert.ok(spot.x > 8 && spot.x < grid.n - 9 && spot.y > 8 && spot.y < grid.n - 9 && spot.picked === false);
  assert.deepEqual(chooseSpot(LAYERS, grid, { x: 20, y: 30 }), { x: 20, y: 30, picked: true });
  assert.equal(chooseSpot(LAYERS, grid, { x: 1, y: 30 }).picked, false, 'a click at the very edge is not used');

  const params = { distAU: 500, flux_uJy: 400, fluxAt: () => 400, refWave: 4.5, spot };
  const out = await buildInjectedMovie(LAYERS, grid, params, lib);
  assert.equal(out.frames.length, 3);
  assert.equal(out.nLayers, 42);
  assert.equal(out.nPasses, 3);
  assert.equal(out.result.detected, true);
  let withMarker = 0;
  for (const f of out.frames) {
    assert.equal(f.simulated, true);
    assert.equal(f.diverging, true);
    assert.equal(f.image.length, grid.n * grid.n);
    assert.match(f.caption.title, /^SIMULATED · residual · pass \d of 3 · /);
    assert.ok(f.caption.note === WATERMARK || f.caption.note === WATERMARK_OFF_FIELD);
    assert.match(f.caption.note, /^SIMULATED SOURCE/);
    if (f.simMarkers.length) {
      withMarker++;
      assert.equal(f.caption.note, WATERMARK);
      assert.equal(f.simMarkers[0].label, 'SIMULATED');
      assert.notEqual(f.simMarkers[0].kind, 'candidate', 'never drawn as a real candidate');
    } else {
      assert.equal(f.caption.note, WATERMARK_OFF_FIELD);
    }
  }
  assert.ok(withMarker >= 1 && withMarker < 3, 'at 500 AU the body is off the field in at least one pass');
  const fresh = makeLayers();
  LAYERS.forEach((l, i) => { assert.deepEqual(l.image, fresh[i].image); assert.equal(l.injected, undefined); });

  const said = plantedSentences({ ...out, gridScale: grid.scale }, params);
  assert.match(said[0], /^Planted a simulated body of 400 µJy at 4\.5 µm, 500 AU away\. It is in view in \d+ of 42 exposures\. It hops 13\.8 arcmin/);
  assert.match(said[1], /^Recovered at \d+\.\d sigma/);
  for (const line of said) assert.ok(!line.includes('!'));

  // The same 100 uJy is recovered at 500 AU but not at 2.3 pc, where the body shifts by a
  // quarter of a pixel between passes and the sky model takes it for a star. The panel says why.
  const dim = { ...params, flux_uJy: 100, fluxAt: () => 100 };
  const nearBody = await buildInjectedMovie(LAYERS, grid, dim, lib);
  assert.equal(nearBody.result.detected, true);
  const far = await buildInjectedMovie(LAYERS, grid, { ...dim, distAU: 474000 }, lib);
  assert.equal(far.result.detected, false);
  assert.equal(far.nOnGrid, 42);
  const farSaid = plantedSentences({ ...far, gridScale: grid.scale }, { ...dim, distAU: 474000 });
  assert.match(farSaid[1], /^Not recovered/);
  assert.match(farSaid[2], /takes it for a fixed star/);

  // too few exposures: an explanation, no frames, no throw
  const few = await buildInjectedMovie(LAYERS.slice(0, 3), grid, params, lib);
  assert.deepEqual(few.frames, []);
  assert.match(few.message, /at least four exposures/);
});

test('curveSvg draws a self-contained chart in brand colours', async () => {
  const { curveSvg } = await import('./index.js');
  const points = [
    { flux_uJy: 10, completeness: 0, lo: 0, hi: 0.1, n: 10, detected: 0, blindCompleteness: 0 },
    { flux_uJy: 40, completeness: 0.3, lo: 0.18, hi: 0.45, n: 10, detected: 3, blindCompleteness: 0 },
    { flux_uJy: 160, completeness: 1, lo: 0.9, hi: 1, n: 10, detected: 10, blindCompleteness: 0.4 },
    { flux_uJy: 640, completeness: 1, lo: 0.9, hi: 1, n: 10, detected: 10, blindCompleteness: 1 },
  ];
  const svg = curveSvg({
    points, limit: limitDetail(points), refWave: 4.5, compare: { label: 'Planet X <b>', flux_uJy: 7.4 },
  });
  assert.match(svg, /^<svg /);
  assert.match(svg, /<\/svg>$/);
  assert.ok(!svg.includes('NaN') && !svg.includes('undefined') && !svg.includes('Infinity'));
  for (const colour of ['#F7F2E7', '#E53C27', '#77766E']) assert.ok(svg.includes(colour), colour);
  assert.ok(svg.includes('Consolas'));
  assert.ok(svg.includes('brightness at 4.5 µm, µJy'));
  assert.ok(svg.includes('Planet X &lt;b&gt;'), 'labels are escaped');
  assert.equal((svg.match(/<circle /g) || []).length, 5, 'four points and the limit marker');
  assert.match(curveSvg({ points: [] }), /No result yet/);
  // a comparison far off the scale becomes an arrow at the edge instead of stretching the axis
  const far = curveSvg({ points, limit: limitDetail(points), compare: { label: 'Dwarf planet', flux_uJy: 0.001 } });
  assert.ok(far.includes('← Dwarf planet, 0.0010 µJy'));
  // the label keeps off the curve: leftward at the top where the curve is still low, rightward
  // at the bottom where it has risen, and never off the edge of the plot
  const label = (flux) => curveSvg({ points, compare: { label: 'Planet X', flux_uJy: flux } }, { width: 600 }).match(/text-anchor="(start|end)">Planet X/)[1];
  assert.equal(label(60), 'end', 'faint side, room to the left');
  assert.equal(label(11), 'start', 'faint side, at the left edge');
  assert.equal(label(200), 'start', 'bright side, room to the right');
  assert.equal(label(630), 'end', 'bright side, at the right edge');
});

// ---- things already in the frames, and candidate-list flags ------------------------------------

test('a flag from the candidate list counts as recovered even when the exact position reads low', async () => {
  const N = grid.n * grid.n;
  const flat = () => ({ snr: new Float32Array(N), image: new Float32Array(N), mask: new Uint8Array(N) });
  const fake = {
    fitSkyModel: () => ({}),
    residualPassStacks: () => [flat(), flat(), flat()],
    findCandidates: () => [
      { x: 31, y: 46, snr: 9, passIndex: 0 },        // 1.6 pixels from the body, same pass: a match
      { x: 31, y: 46, snr: -9, passIndex: 0 },       // a negative ghost is not the body
      { x: 60, y: 60, snr: 20, passIndex: 0 },       // somewhere else
    ],
  };
  const truth = { positions: LAYERS.map((_, i) => ({ x: 30, y: 45, onGrid: i < 14 })) };
  const r = await recover(LAYERS, grid, truth, fake, { pause: noPause });
  assert.equal(r.detected, true);
  assert.equal(r.method, 'candidate');
  assert.equal(r.blind, true);
  assert.equal(r.snr, 0);
  assert.deepEqual([r.where.x, r.where.y, r.where.passIndex], [31, 46, 0]);
  // the same candidate in another pass, or too far away, is not a match
  const other = { ...fake, findCandidates: () => [{ x: 31, y: 46, snr: 9, passIndex: 1 }, { x: 34, y: 45, snr: 9, passIndex: 0 }] };
  const r2 = await recover(LAYERS, grid, truth, other, { pause: noPause });
  assert.equal(r2.detected, false);
  assert.equal(r2.blind, false);
});

test('test positions where the untouched frames already show something are left out', async () => {
  // Put a "real" moving source into the data exactly where the first test body would go.
  const opts = { lib, distAU: 20000, motion: MOTION, positions: 5, seed: 21, pause: noPause, fluxes: [3, 300] };
  const fakes = planFakes(LAYERS, grid, { count: 5, seed: 21, distAU: 20000, motion: MOTION });
  const real = injectIntoLayers(LAYERS, grid, { track: fakes[0].positions, fluxAt: () => 500 })
    .map((l) => ({ ...l, injected: undefined }));
  const curve = await detectionCurve(real, grid, opts);
  assert.equal(curve.excluded, 1);
  assert.equal(curve.fakes.length, 4);
  assert.equal(curve.points[0].n, 4);
  assert.equal(curve.points[0].detected, 0, 'nothing is "recovered" at 3 uJy once the occupied spot is dropped');
  assert.equal(curve.points[1].detected, 4);
  // without the baseline check the occupied spot would be counted as recovered at any brightness
  const naive = await detectionCurve(real, grid, { ...opts, baseline: false });
  assert.equal(naive.excluded, 0);
  assert.equal(naive.points[0].detected, 1);
  // clean frames exclude nothing
  assert.equal((await detectionCurve(LAYERS, grid, opts)).excluded, 0);
});

test('planting on a spot that already changes is called out, not reported as a success', async () => {
  const { buildInjectedMovie, plantedSentences } = await import('./index.js');
  const spot = { x: 30.3, y: 44.6 };
  const params = { distAU: 20000, flux_uJy: 300, fluxAt: () => 300, refWave: 4.5, spot, motion: MOTION };
  const clean = await buildInjectedMovie(LAYERS, grid, params, lib);
  assert.equal(clean.baseline.detected, false);
  assert.match(plantedSentences({ ...clean, gridScale: grid.scale }, params)[1], /^Recovered at/);
  // the same track already holds a bright source in the "real" data
  const occupied = injectIntoLayers(LAYERS, grid, { track: clean.track, fluxAt: () => 500 });
  const out = await buildInjectedMovie(occupied, grid, params, lib);
  assert.equal(out.baseline.detected, true);
  const said = plantedSentences({ ...out, gridScale: grid.scale }, params);
  assert.match(said[1], /^Careful: this spot already shows \d+\.\d sigma without the planted body/);
  assert.equal(said.length, 2);
  assert.ok(!said.join(' ').includes('Recovered'));
});
