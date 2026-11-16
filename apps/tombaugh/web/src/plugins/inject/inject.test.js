// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  erf, addGaussian, ujyPerMJySr, effectiveFwhmArcsec, circularMotion, planTrack, trackOnGrid,
  injectIntoLayers, injectIntoFrames, referenceWave, MJYSR_TO_UJY_PER_NATIVE_PIX,
} from './inject.js';
import { makeGrid, gridSkyToPix, gridPixToSky, makeWcs } from '../../core/wcs.js';
import { parallaxOffset } from '../../core/ephemeris.js';
import { hopArcsec, keplerRate } from '../../core/distance.js';
import { separationArcsec } from '../../core/astrometry.js';
import { reproject } from '../../core/reproject.js';

// ---- helpers -----------------------------------------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rng) {
  const u = Math.max(rng(), 1e-12), v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Layers of pure noise on a grid, each at its own (flat) wavelength. */
function noiseLayers(grid, mjds, { sigma = 0.02, seed = 1, waves } = {}) {
  const rng = mulberry32(seed);
  const N = grid.n * grid.n;
  return mjds.map((mjd, i) => {
    const image = new Float32Array(N);
    for (let k = 0; k < N; k++) image[k] = sigma * gauss(rng);
    return {
      frame: null, mjd, det: 6, image,
      variance: new Float32Array(N).fill(sigma * sigma),
      wave: new Float32Array(N).fill(waves ? waves[i] : 4.5),
      mask: new Uint8Array(N),
    };
  });
}

/** Sum and flux-weighted centroid of (after - before) inside radius r of (x0, y0). */
function measureDelta(after, before, n, x0, y0, r) {
  let sum = 0, sx = 0, sy = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (Math.hypot(x - x0, y - y0) > r) continue;
      const d = after[y * n + x] - before[y * n + x];
      sum += d; sx += d * x; sy += d * y;
    }
  }
  return { sum, x: sx / sum, y: sy / sum };
}

const grid = makeGrid(150, 20, 4);                 // 79 x 79 at 3.075 arcsec

// ---- small pieces ------------------------------------------------------------------------------

test('erf matches tabulated values', () => {
  // Abramowitz and Stegun table 7.1
  assert.ok(Math.abs(erf(0.5) - 0.5204998778) < 1e-9);
  assert.ok(Math.abs(erf(1) - 0.8427007929) < 1e-9);
  assert.ok(Math.abs(erf(2) - 0.9953222650) < 1e-9);
  assert.ok(Math.abs(erf(3) - 0.9999779095) < 1e-9);
  assert.equal(erf(0), 0);
  assert.equal(erf(-1), -erf(1));
  assert.equal(erf(10), 1);
  assert.ok(Math.abs(erf(2.4999) - erf(2.5001)) < 1e-6);        // the two branches join smoothly
});

test('unit conversion: 889 uJy per MJy/sr per 6.15 arcsec pixel, scaled by pixel area', () => {
  assert.equal(MJYSR_TO_UJY_PER_NATIVE_PIX, 889);
  assert.equal(ujyPerMJySr(6.15), 889);
  assert.ok(Math.abs(ujyPerMJySr(3.075) - 889 / 4) < 1e-9);
  // cross-check from first principles: (6.15 / 206264.806)^2 sr * 1e6 Jy/sr = 8.890e-4 Jy
  const sr = (6.15 / 206264.80624709636) ** 2;
  assert.ok(Math.abs(sr * 1e12 - 889) < 0.5);
});

test('addGaussian integrates over pixels: unit total, correct centre pixel', () => {
  const n = 41;
  const img = new Float32Array(n * n);
  const sigma = 1.04;
  const frac = addGaussian(img, n, n, 20.3, 19.6, sigma, 5, null);
  assert.ok(Math.abs(frac - 1) < 1e-6);
  let sum = 0;
  for (const v of img) sum += v;
  assert.ok(Math.abs(sum - 5) < 1e-5);
  // the pixel (20, 20) holds the integral over [19.5, 20.5] x [19.5, 20.5]
  const k = 1 / (Math.SQRT2 * sigma);
  const fx = 0.5 * (erf((20.5 - 20.3) * k) - erf((19.5 - 20.3) * k));
  const fy = 0.5 * (erf((20.5 - 19.6) * k) - erf((19.5 - 19.6) * k));
  assert.ok(Math.abs(img[20 * n + 20] - 5 * fx * fy) < 1e-6);
  // and that is NOT the point-sampled value for a narrow profile
  const narrow = new Float32Array(n * n);
  addGaussian(narrow, n, n, 20, 20, 0.4, 1, null);
  const sampled = 1 / (2 * Math.PI * 0.4 * 0.4);                   // 0.995: would overshoot badly
  assert.ok(narrow[20 * n + 20] < 0.8 * sampled);
  let s2 = 0;
  for (const v of narrow) s2 += v;
  assert.ok(Math.abs(s2 - 1) < 1e-6);
});

test('addGaussian skips masked and missing pixels and reports what landed', () => {
  const n = 21;
  const img = new Float32Array(n * n);
  img[10 * n + 10] = NaN;
  const mask = new Uint8Array(n * n);
  mask[10 * n + 11] = 1;
  const frac = addGaussian(img, n, n, 10, 10, 1.0, 1, mask);
  assert.ok(Number.isNaN(img[10 * n + 10]));
  assert.equal(img[10 * n + 11], 0);
  assert.ok(frac < 0.9 && frac > 0.5);
  assert.equal(addGaussian(img, n, n, NaN, 10, 1, 1, null), 0);
  assert.equal(addGaussian(img, n, n, 500, 500, 1, 1, null), 0);
});

test('effective width after a native pixel and bilinear resampling', () => {
  // sigma^2 = (7.5/2.3548)^2 + 6.15^2/12 + 6.15^2/6 = 10.144 + 3.152 + 6.304 = 19.600 -> 10.43 arcsec
  assert.ok(Math.abs(effectiveFwhmArcsec(7.5, 6.15) - 10.425) < 0.01);
  assert.equal(effectiveFwhmArcsec(7.5, 0), 7.5);
});

// ---- tracks ------------------------------------------------------------------------------------

test('planTrack: a body at infinity does not move; apparent anchor is honoured', () => {
  const mjds = [60850, 61030, 61215];
  const far = planTrack({ ra: 150, dec: 20, distAU: Infinity, mjds });
  for (const p of far) assert.ok(separationArcsec(p.ra, p.dec, 150, 20) < 1e-6);
  const near = planTrack({ ra: 150, dec: 20, distAU: 500, mjds });
  assert.equal(near.length, 3);
  assert.ok(separationArcsec(near[0].ra, near[0].dec, 150, 20) < 1e-3, 'appears at the anchor on the reference date');
  assert.ok(Math.abs(near[0].dEast) < 1e-3 && Math.abs(near[0].dNorth) < 1e-3);
  const late = planTrack({ ra: 150, dec: 20, distAU: 500, mjds, refMjd: 61030 });
  assert.ok(separationArcsec(late[1].ra, late[1].dec, 150, 20) < 1e-3);
  assert.deepEqual(planTrack({ ra: 1, dec: 2, distAU: 500, mjds: [] }), []);
});

test('planTrack: heliocentric anchor reproduces the ephemeris parallax exactly', () => {
  const mjds = [60850.2, 60900.7, 61031.1, 61215.9];
  const t = planTrack({ ra: 210.8, dec: 54.35, distAU: 800, mjds, anchor: 'heliocentric' });
  mjds.forEach((mjd, i) => {
    const e = parallaxOffset(210.8, 54.35, 800, mjd);
    assert.ok(separationArcsec(t[i].ra, t[i].dec, e.ra, e.dec) < 1e-6);
    assert.equal(t[i].mjd, mjd);
  });
});

test('planTrack: the yearly parallax loop spans 2 AU / distance', () => {
  // Over a year the Earth swings 2 AU, so a body at 500 AU swings 2 atan(1/500) = 825 arcsec
  // along the ecliptic, wherever it is. Sample a year in 3-day steps and take the widest pair.
  const mjds = [];
  for (let d = 0; d <= 366; d += 3) mjds.push(60800 + d);
  for (const [ra, dec, dist] of [[150, 20, 500], [30, -40, 500], [270, 66, 2000]]) {
    const t = planTrack({ ra, dec, distAU: dist, mjds, anchor: 'heliocentric' });
    let widest = 0;
    for (let i = 0; i < t.length; i++) {
      for (let j = i + 1; j < t.length; j++) {
        widest = Math.max(widest, separationArcsec(t[i].ra, t[i].dec, t[j].ra, t[j].dec));
      }
    }
    assert.ok(Math.abs(widest / hopArcsec(dist) - 1) < 0.02, `${ra},${dec}: ${widest} vs ${hopArcsec(dist)}`);
  }
});

test('planTrack: own motion adds a steady drift', () => {
  const mjds = [60800, 60800 + 365.25];
  const t = planTrack({
    ra: 150, dec: 20, distAU: Infinity, mjds, motion: { raRate_arcsecPerYr: 30, decRate_arcsecPerYr: -40 },
  });
  assert.ok(Math.abs(t[1].dEast - 30) < 0.01);
  assert.ok(Math.abs(t[1].dNorth + 40) < 0.01);
  assert.ok(Math.abs(separationArcsec(t[0].ra, t[0].dec, t[1].ra, t[1].dec) - 50) < 0.01);
});

test('circularMotion: Kepler rate along the ecliptic, prograde', () => {
  const m = circularMotion(0, 0, 500);                 // the equinox: the ecliptic crosses at 23.44 deg
  const rate = keplerRate(500);                        // 1,296,000 / 500^1.5 = 115.9 arcsec/yr
  assert.ok(Math.abs(rate - 115.92) < 0.01);
  assert.ok(Math.abs(Math.hypot(m.raRate_arcsecPerYr, m.decRate_arcsecPerYr) - rate) < 1e-9);
  assert.ok(Math.abs(m.raRate_arcsecPerYr - rate * Math.cos(23.4392911111 * Math.PI / 180)) < 1e-6);
  assert.ok(Math.abs(m.decRate_arcsecPerYr - rate * Math.sin(23.4392911111 * Math.PI / 180)) < 1e-6);
  const s = circularMotion(90, 23.4392911111, 500);    // the solstice: motion is due east
  assert.ok(Math.abs(s.raRate_arcsecPerYr - rate) < 1e-6 && Math.abs(s.decRate_arcsecPerYr) < 1e-6);
  assert.deepEqual(circularMotion(10, 10, Infinity), { raRate_arcsecPerYr: 0, decRate_arcsecPerYr: 0 });
  // 'circular' as a motion string: after one year at 500 AU, seen from the same side of the
  // Earth's orbit, the body has drifted by the Kepler rate
  const t = planTrack({ ra: 150, dec: 20, distAU: 500, mjds: [60850, 60850 + 365.25], motion: 'circular' });
  const moved = separationArcsec(t[0].ra, t[0].dec, t[1].ra, t[1].dec);
  assert.ok(Math.abs(moved - rate) < 3, `drift ${moved}`);
});

// ---- injection into layers ---------------------------------------------------------------------

test('injectIntoLayers: flux to 2 percent, position to 0.05 pixel, inputs untouched', () => {
  const mjds = [60850, 60851, 61030, 61031, 61215, 61216];
  const layers = noiseLayers(grid, mjds, { seed: 7 });
  const before = layers.map((l) => ({
    image: new Float32Array(l.image), variance: new Float32Array(l.variance),
    wave: new Float32Array(l.wave), mask: new Uint8Array(l.mask),
  }));
  const frozenKeys = layers.map((l) => Object.keys(l).join());
  // a body at 20,000 AU: hops 20 arcsec between passes, well inside the field
  const [ra, dec] = gridPixToSky(grid, 44.37, 33.81);
  const track = planTrack({ ra, dec, distAU: 20000, mjds });
  const flux = 5000;                                               // microjansky
  const out = injectIntoLayers(layers, grid, { track, fluxAt: () => flux });

  assert.equal(out.length, layers.length);
  const unit = ujyPerMJySr(grid.scale);
  out.forEach((layer, i) => {
    assert.notEqual(layer, layers[i]);
    assert.notEqual(layer.image, layers[i].image);
    assert.equal(layer.variance, layers[i].variance, 'variance is shared, not copied');
    assert.equal(layer.wave, layers[i].wave);
    assert.equal(layer.mask, layers[i].mask);
    assert.equal(layer.mjd, layers[i].mjd);
    // inputs untouched
    assert.deepEqual(layers[i].image, before[i].image);
    assert.deepEqual(layers[i].variance, before[i].variance);
    assert.deepEqual(layers[i].wave, before[i].wave);
    assert.deepEqual(layers[i].mask, before[i].mask);
    assert.equal(Object.keys(layers[i]).join(), frozenKeys[i]);
    assert.equal(layers[i].injected, undefined);

    const [tx, ty] = gridSkyToPix(grid, track[i].ra, track[i].dec);
    const rec = layer.injected[0];
    assert.ok(Math.abs(rec.x - tx) < 1e-9 && Math.abs(rec.y - ty) < 1e-9);
    assert.equal(rec.onGrid, true);
    assert.equal(rec.flux_uJy, flux);
    assert.ok(Math.abs(rec.deposited - 1) < 1e-6);
    const m = measureDelta(layer.image, layers[i].image, grid.n, tx, ty, 6);
    assert.ok(Math.abs(m.sum * unit / flux - 1) < 0.02, `aperture flux ${m.sum * unit}`);
    assert.ok(Math.hypot(m.x - tx, m.y - ty) < 0.05, `centroid off by ${Math.hypot(m.x - tx, m.y - ty)}`);
  });
  // the track really moved between passes
  const a = out[0].injected[0], b = out[2].injected[0];
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) > 3);
});

test('injectIntoLayers: profile width follows fwhmArcsec and nativePixArcsec', () => {
  const layers = noiseLayers(grid, [60850], { sigma: 0 });
  const track = [{ x: 39.2, y: 40.6 }];
  const width = (out) => {
    const img = out[0].image;
    let s = 0, r2 = 0;
    for (let y = 0; y < grid.n; y++) {
      for (let x = 0; x < grid.n; x++) {
        const v = img[y * grid.n + x];
        s += v; r2 += v * ((x - 39.2) ** 2 + (y - 40.6) ** 2);
      }
    }
    // second moment of a pixel-integrated Gaussian = sigma^2 + 1/12 per axis
    return Math.sqrt(r2 / s / 2 - 1 / 12) * 2.3548200450309493 * grid.scale;
  };
  const bare = injectIntoLayers(layers, grid, { track, fluxAt: () => 1000 });
  assert.ok(Math.abs(width(bare) - 7.5) < 0.05, `bare ${width(bare)}`);
  const wide = injectIntoLayers(layers, grid, { track, fluxAt: () => 1000, nativePixArcsec: 6.15 });
  assert.ok(Math.abs(width(wide) - 10.425) < 0.05, `resampled ${width(wide)}`);
  const custom = injectIntoLayers(layers, grid, { track, fluxAt: () => 1000, fwhmArcsec: 12 });
  assert.ok(Math.abs(width(custom) - 12) < 0.05);
});

test('injectIntoLayers: brightness follows each layer\'s own wavelength at the source', () => {
  const mjds = [60850, 60851, 60852];
  const layers = noiseLayers(grid, mjds, { sigma: 0, waves: [4.45, 4.6, 4.9] });
  // a wavelength gradient inside one layer: the source must read it where it sits
  for (let y = 0; y < grid.n; y++) for (let x = 0; x < grid.n; x++) layers[2].wave[y * grid.n + x] = 4.4 + 0.005 * y;
  const seen = [];
  const fluxAt = (w) => { seen.push(w); return 1000 * w; };
  const out = injectIntoLayers(layers, grid, { track: mjds.map(() => ({ x: 30, y: 50 })), fluxAt });
  assert.ok(Math.abs(seen[0] - 4.45) < 1e-6 && Math.abs(seen[1] - 4.6) < 1e-6);
  assert.ok(Math.abs(seen[2] - (4.4 + 0.005 * 50)) < 1e-6);
  const unit = ujyPerMJySr(grid.scale);
  out.forEach((layer, i) => {
    let sum = 0;
    for (const v of layer.image) sum += v;
    assert.ok(Math.abs(sum * unit / (1000 * seen[i]) - 1) < 1e-4);
    assert.ok(Math.abs(layer.injected[0].wave - seen[i]) < 1e-9);
  });
});

test('injectIntoLayers: a body off the grid is not in that layer; several sources at once', () => {
  const mjds = [60850, 61030];
  const layers = noiseLayers(grid, mjds, { seed: 3 });
  const [ra, dec] = gridPixToSky(grid, 39, 39);
  // 500 AU: the hop to the next pass is 13.7 arcmin, far outside a 4 arcmin field
  const track = planTrack({ ra, dec, distAU: 500, mjds });
  const out = injectIntoLayers(layers, grid, { track, fluxAt: () => 2000 });
  assert.equal(out[0].injected[0].onGrid, true);
  assert.equal(out[1].injected[0].onGrid, false);
  assert.equal(out[1].injected[0].flux_uJy, 0);
  assert.deepEqual(out[1].image, layers[1].image);
  assert.notDeepEqual(out[0].image, layers[0].image);

  const two = injectIntoLayers(layers, grid, {
    sources: [
      { id: 'a', track: [{ x: 20, y: 20 }, { x: 20, y: 20 }], fluxAt: () => 1000 },
      { id: 'b', track: [{ x: 55, y: 60 }, { x: 55, y: 60 }], fluxAt: () => 3000 },
    ],
  });
  assert.deepEqual(two[0].injected.map((r) => r.id), ['a', 'b']);
  const unit = ujyPerMJySr(grid.scale);
  const a = measureDelta(two[0].image, layers[0].image, grid.n, 20, 20, 6);
  const b = measureDelta(two[0].image, layers[0].image, grid.n, 55, 60, 6);
  assert.ok(Math.abs(a.sum * unit / 1000 - 1) < 0.02);
  assert.ok(Math.abs(b.sum * unit / 3000 - 1) < 0.02);
  // injecting again appends to the record instead of replacing it
  const again = injectIntoLayers(two, grid, { track: [{ x: 40, y: 40 }, { x: 40, y: 40 }], fluxAt: () => 500 });
  assert.equal(again[0].injected.length, 3);
  assert.equal(two[0].injected.length, 2);
});

test('injectIntoLayers: masked pixels stay masked and untouched; no sources is a plain copy', () => {
  const layers = noiseLayers(grid, [60850], { seed: 5 });
  layers[0].mask[40 * grid.n + 40] = 1;
  layers[0].image[40 * grid.n + 41] = NaN;
  const kept = layers[0].image[40 * grid.n + 40];
  const out = injectIntoLayers(layers, grid, { track: [{ x: 40, y: 40 }], fluxAt: () => 1e5 });
  assert.equal(out[0].image[40 * grid.n + 40], kept);
  assert.ok(Number.isNaN(out[0].image[40 * grid.n + 41]));
  assert.ok(out[0].injected[0].deposited < 1);
  const copy = injectIntoLayers(layers, grid, {});
  assert.deepEqual(copy[0].image, layers[0].image);
  assert.notEqual(copy[0].image, layers[0].image);
  assert.deepEqual(copy[0].injected, []);
  // a spectrum that throws or returns nonsense never breaks the injection
  const bad = injectIntoLayers(layers, grid, { track: [{ x: 40, y: 40 }], fluxAt: () => { throw new Error('x'); } });
  assert.deepEqual(bad[0].image, layers[0].image);
});

test('trackOnGrid matches tracks to layers by date when the lists differ', () => {
  const layers = [{ mjd: 61030 }, { mjd: 60850 }];
  const track = [{ mjd: 60850, ra: grid.ra0, dec: grid.dec0 }, { mjd: 61030, x: 5, y: 6 }, { mjd: 62000, x: 1, y: 1 }];
  const pos = trackOnGrid(track, grid, layers);
  assert.equal(pos[0].x, 5);
  assert.ok(Math.abs(pos[1].x - 39) < 1e-6 && Math.abs(pos[1].y - 39) < 1e-6);
  const none = trackOnGrid([{ mjd: 50000, x: 1, y: 1 }], grid, [{ mjd: 60000 }]);
  assert.equal(none[0].onGrid, false);
});

// ---- injection into native frames --------------------------------------------------------------

function nativeFrame(rotRad, mjd) {
  const nx = 59, ny = 59, s = 6.15 / 3600;
  const c = Math.cos(rotRad), sn = Math.sin(rotRad);
  return {
    id: 'synthetic', det: 6, nx, ny, mjd, exptime: 113.6, release: 'test', obsid: 'x',
    wcs: { crpix: [30, 30], crval: [150, 20], pc: [[-s * c, s * sn], [s * sn, s * c]], cdelt: [1, 1], sip: null },
    image: new Float32Array(nx * ny), variance: new Float32Array(nx * ny).fill(1e-3),
    zodi: new Float32Array(nx * ny), flags: new Int32Array(nx * ny),
    wave: new Float32Array(nx * ny).fill(4.6), waveCenter: 4.6, bwCenter: 0.04, psfFwhm: 7.5,
  };
}

test('injectIntoFrames: flux to 2 percent, position to 0.05 pixel, inputs untouched', () => {
  const frames = [nativeFrame(0.3, 60850), nativeFrame(-1.1, 60851)];
  const ra = 150 + 9.3 / 3600 / Math.cos(20 * Math.PI / 180), dec = 20 - 4.4 / 3600;
  const out = injectIntoFrames(frames, { track: [{ ra, dec }, { ra, dec }], fluxAt: (w) => 800 * w });
  out.forEach((f, i) => {
    assert.notEqual(f.image, frames[i].image);
    assert.ok(frames[i].image.every((v) => v === 0), 'input frame untouched');
    assert.equal(frames[i].injected, undefined);
    assert.equal(f.wave, frames[i].wave);
    const [tx, ty] = makeWcs(frames[i].wcs).skyToPix(ra, dec);
    const m = measureDelta(f.image, frames[i].image, f.nx, tx, ty, 5);
    assert.ok(Math.abs(m.sum * 889 / (800 * 4.6) - 1) < 0.02, `flux ${m.sum * 889}`);
    assert.ok(Math.hypot(m.x - tx, m.y - ty) < 0.05);
    assert.ok(Math.abs(f.injected[0].wave - 4.6) < 1e-6);
    assert.equal(f.injected[0].onGrid, true);
  });
  // a broken WCS is skipped, not thrown
  const broken = injectIntoFrames([{ ...frames[0], wcs: null }], { track: [{ ra, dec }], fluxAt: () => 1 });
  assert.deepEqual(broken[0].image, frames[0].image);
});

test('frames route and layers route agree after reprojection', () => {
  // Plant the same body in native frames (then reproject) and directly on the grid with the
  // resampling response switched on. Averaged over rolls and sub-pixel phases the two give the
  // same total and the same width, which is the justification for nativePixArcsec.
  const unit = ujyPerMJySr(grid.scale);
  let sumA = 0, sumB = 0, m2A = 0, m2B = 0;
  const K = 24;
  for (let k = 0; k < K; k++) {
    const frame = nativeFrame(k * 0.37, 60850 + k);
    const ra = 150 + (Math.sin(k * 1.7) * 12 / 3600) / Math.cos(20 * Math.PI / 180);
    const dec = 20 + Math.cos(k * 2.3) * 12 / 3600;
    const track = [{ ra, dec }];
    const viaFrame = reproject(injectIntoFrames([frame], { track, fluxAt: () => 4000 })[0], grid, {});
    const blank = reproject(frame, grid, {});
    const viaGrid = injectIntoLayers([blank], grid, { track, fluxAt: () => 4000, nativePixArcsec: 6.15 })[0];
    const [gx, gy] = gridSkyToPix(grid, ra, dec);
    for (const [img, isA] of [[viaFrame.image, true], [viaGrid.image, false]]) {
      let s = 0, r2 = 0;
      for (let y = 0; y < grid.n; y++) {
        for (let x = 0; x < grid.n; x++) {
          const v = img[y * grid.n + x];
          if (!(v === v)) continue;
          s += v; r2 += v * ((x - gx) ** 2 + (y - gy) ** 2);
        }
      }
      if (isA) { sumA += s * unit; m2A += r2 / s; } else { sumB += s * unit; m2B += r2 / s; }
    }
  }
  assert.ok(Math.abs(sumA / K / 4000 - 1) < 0.02, `frame route flux ${sumA / K}`);
  assert.ok(Math.abs(sumB / K / 4000 - 1) < 0.02, `grid route flux ${sumB / K}`);
  assert.ok(Math.abs(Math.sqrt(m2A / m2B) - 1) < 0.05, `width ratio ${Math.sqrt(m2A / m2B)}`);
});

test('referenceWave: 4.5 um when the layers reach it, otherwise the middle of the band', () => {
  const mk = (w) => ({ wave: new Float32Array(9).fill(w) });
  const d6 = referenceWave([mk(4.45), mk(4.7), mk(4.95)]);
  assert.equal(d6.wave, 4.5);
  assert.equal(d6.preferred, true);
  const d3 = referenceWave([mk(1.7), mk(2.0), mk(2.35)]);
  assert.equal(d3.wave, 2);
  assert.equal(d3.preferred, false);
  assert.ok(Math.abs(d3.min - 1.7) < 1e-6 && Math.abs(d3.max - 2.35) < 1e-6);
  assert.ok(Number.isNaN(referenceWave([]).wave));
  assert.ok(Number.isNaN(referenceWave([{ wave: new Float32Array(9).fill(NaN) }]).wave));
});
