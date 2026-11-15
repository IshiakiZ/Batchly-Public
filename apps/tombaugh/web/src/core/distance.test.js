// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hopArcsec, distanceFromHop, keplerRate, heliocentricFromApparent, predictedTrack, trackThrough,
  trackOffsets, shiftAndStack, dialSweep, focusPeak,
} from './distance.js';
import { sunElongation, earthBaselineBetween } from './ephemeris.js';
import { separationArcsec, positionAngle } from './astrometry.js';

function makeRng(seed) {
  let a = seed >>> 0;
  const uniform = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const gauss = () => Math.sqrt(-2 * Math.log(1 - uniform())) * Math.cos(2 * Math.PI * uniform());
  return { uniform, gauss };
}

/** Dates in [from, to) when the direction is 90 deg from the Sun (where SPHEREx can look). */
function quadratures(ra, dec, from, to) {
  const out = [];
  let prev = sunElongation(ra, dec, from) - 90;
  for (let mjd = from + 1; mjd < to; mjd += 1) {
    const cur = sunElongation(ra, dec, mjd) - 90;
    if (prev * cur < 0) out.push(mjd - 1 + prev / (prev - cur));
    prev = cur;
  }
  return out;
}

// The WISE 0855-0714 field: ecliptic latitude -24 deg, at quadrature twice a year like most of
// the sky.
const RA0 = 133.795129, DEC0 = -7.245147;
const PSF_SIGMA = 7.5 / 2.3548 / 3.075;   // grid pixels

test('hopArcsec, distanceFromHop and keplerRate', () => {
  // 2 AU / 500 AU = 0.004 rad = 13.75 arcmin
  assert.ok(Math.abs(hopArcsec(500) / 60 - 13.75) < 0.01, `${hopArcsec(500) / 60}`);
  assert.ok(Math.abs(hopArcsec(10000) - 41.25) < 0.01);
  assert.ok(Math.abs(hopArcsec(30) / 3600 - 3.82) < 0.01);
  assert.equal(hopArcsec(Infinity), 0);
  assert.ok(Math.abs(hopArcsec(500, 1) - hopArcsec(500) / 2) < 0.01);
  assert.ok(Math.abs(distanceFromHop(hopArcsec(730)) - 730) < 1e-6);
  assert.equal(distanceFromHop(0), Infinity);
  // Kepler: Earth 360 deg/yr, Neptune (30.07 AU, 164.8 yr) 2.18 deg/yr, 500 AU 116 arcsec/yr
  assert.ok(Math.abs(keplerRate(1) - 1296000) < 1e-6);
  assert.ok(Math.abs(keplerRate(30.07) / 3600 - 360 / 164.8) < 0.01);
  assert.ok(Math.abs(keplerRate(500) - 115.9) < 0.1);
  assert.equal(keplerRate(Infinity), 0);
  // the hop dwarfs the orbital motion over the same six months
  assert.ok(hopArcsec(500) > 10 * keplerRate(500) / 2);
});

test('predictedTrack: hop between opposite quadratures is 2 AU / d', () => {
  const q = quadratures(RA0, DEC0, 60800, 61200);
  assert.ok(q.length >= 2, 'two quadratures a year');
  assert.ok(Math.abs(q[1] - q[0] - 182.6) < 12, `quadratures ${q[1] - q[0]} days apart`);
  for (const d of [500, 2000, 10000]) {
    const tr = predictedTrack(RA0, DEC0, d, [q[0], q[1]]);
    const hop = separationArcsec(tr[0].ra, tr[0].dec, tr[1].ra, tr[1].dec);
    const base = earthBaselineBetween(q[0], q[1]);
    assert.ok(Math.abs(hop - hopArcsec(d, base)) / hop < 0.002, `d=${d}: ${hop} vs ${hopArcsec(d, base)}`);
    if (d === 500) assert.ok(hop / 60 > 13 && hop / 60 < 14, `hop at 500 AU ${hop / 60} arcmin`);
    // the tangent-plane offsets in the track say the same thing
    const span = Math.hypot(tr[0].dEast - tr[1].dEast, tr[0].dNorth - tr[1].dNorth);
    assert.ok(Math.abs(span - hop) / hop < 1e-3);
    // each apparent position is displaced from the heliocentric one by about 1 AU / d
    for (const p of tr) {
      const off = separationArcsec(RA0, DEC0, p.ra, p.dec);
      assert.ok(Math.abs(off - 206264.8 / d) / off < 0.03, `offset ${off}`);
    }
  }
  // at infinity nothing moves
  const far = predictedTrack(RA0, DEC0, Infinity, [q[0], q[1]]);
  assert.ok(separationArcsec(far[0].ra, far[0].dec, RA0, DEC0) < 1e-9);
  assert.ok(separationArcsec(far[1].ra, far[1].dec, RA0, DEC0) < 1e-9);
  assert.equal(far[0].dEast, 0);
});

test('predictedTrack: the body is displaced away from the Earth-side, i.e. towards the Sun-side', () => {
  // At quadrature the Sun is 90 deg from the target. The Earth is displaced from the Sun in the
  // direction opposite to the Sun as seen from Earth, so a nearby body appears shifted TOWARDS
  // the Sun's position on the sky. Check the position angle of the shift against the direction
  // to the Sun.
  const q = quadratures(RA0, DEC0, 60800, 61200);
  for (const mjd of q.slice(0, 2)) {
    const [p] = predictedTrack(RA0, DEC0, 1000, [mjd]);
    const paShift = positionAngle(RA0, DEC0, p.ra, p.dec);
    // direction to the Sun from the target position: brute-force the Sun's RA/Dec from elongation
    let best = 0, bestPa = 0;
    for (let pa = 0; pa < 360; pa += 0.5) {
      // a point 1 deg from the target at this PA; the Sun is on the side where elongation drops
      const dRa = Math.sin(pa * Math.PI / 180) / Math.cos(DEC0 * Math.PI / 180);
      const dDec = Math.cos(pa * Math.PI / 180);
      const drop = 90 - sunElongation(RA0 + dRa, DEC0 + dDec, mjd);
      if (drop > best) { best = drop; bestPa = pa; }
    }
    const diff = Math.abs(((paShift - bestPa + 540) % 360) - 180);
    assert.ok(diff < 2, `shift PA ${paShift}, Sun-ward PA ${bestPa}`);
  }
});

test('predictedTrack: own motion, reference epoch, and trackThrough', () => {
  const mjds = [61000, 61100, 61182.625, 61365.25];
  // pure heliocentric drift at infinity: exactly rate * time, eastward means RA increases
  const tr = predictedTrack(RA0, DEC0, Infinity, mjds, { motion: { raRate_arcsecPerYr: 100, decRate_arcsecPerYr: -50 } });
  assert.ok(separationArcsec(tr[0].ra, tr[0].dec, RA0, DEC0) < 1e-9, 'reference epoch is mjds[0]');
  assert.ok(Math.abs(tr[3].dEast - 100) < 1e-3 && Math.abs(tr[3].dNorth - -50) < 1e-3, `${tr[3].dEast}, ${tr[3].dNorth}`);
  assert.ok(tr[3].ra > RA0 && tr[3].dec < DEC0);
  // explicit reference epoch
  const tr2 = predictedTrack(RA0, DEC0, Infinity, mjds, { motion: { raRate_arcsecPerYr: 100, decRate_arcsecPerYr: 0, refMjd: 61365.25 } });
  assert.ok(Math.abs(tr2[0].dEast - -100) < 1e-3);
  assert.ok(Math.abs(tr2[3].dEast) < 1e-9);

  // heliocentricFromApparent inverts the parallax exactly
  for (const d of [5, 40, 500, 20000]) {
    const [p] = predictedTrack(RA0, DEC0, d, [61100]);
    const h = heliocentricFromApparent(p.ra, p.dec, d, 61100);
    assert.ok(separationArcsec(h.ra, h.dec, RA0, DEC0) < 1e-6, `d=${d}`);
    assert.ok(Math.abs(h.distGeoAU - p.distGeoAU) < 1e-9);
  }
  assert.deepEqual(heliocentricFromApparent(10, 20, Infinity, 61100), { ra: 10, dec: 20, distGeoAU: Infinity });

  // trackThrough passes through the anchor in the reference exposure
  for (const refIndex of [0, 2]) {
    const t = trackThrough(RA0, DEC0, 3000, mjds, { refIndex });
    assert.ok(separationArcsec(t[refIndex].ra, t[refIndex].dec, RA0, DEC0) < 1e-6);
    assert.ok(Math.hypot(t[refIndex].dEast, t[refIndex].dNorth) < 1e-6);
    // 100 days (refIndex 0) or 83 days (refIndex 2) away the Earth has moved over an AU
    assert.ok(Math.hypot(t[1].dEast, t[1].dNorth) > 30, `moved ${Math.hypot(t[1].dEast, t[1].dNorth)}`);
    // exactly one year after mjds[0] the Earth is back, and so is the body
    if (refIndex === 0) assert.ok(Math.hypot(t[3].dEast, t[3].dNorth) < 2);
  }
  // offsets for the stacker are anchored: zero for the anchor layer, same hop
  const t = trackThrough(RA0, DEC0, 3000, mjds);
  const grid = { ra0: RA0, dec0: DEC0, n: 129, scale: 3.075 };
  const off = trackOffsets(t, grid);
  assert.equal(off[0].dEast, 0);
  assert.equal(off[0].dNorth, 0);
  assert.ok(Math.abs(off[3].dEast - t[3].dEast) < 1e-3 && Math.abs(off[3].dNorth - t[3].dNorth) < 1e-3);
  const off2 = trackOffsets(t, grid, { anchor: 3 });
  assert.ok(Math.abs(off2[0].dEast + off[3].dEast) < 1e-9);
  assert.deepEqual(trackOffsets([], grid), []);
});

// ---- synthetic layers ---------------------------------------------------------------------------

/**
 * Build layers on a Grid: unit-variance white noise, optional fixed stars, and a body at
 * distance trueDist that appears at the grid centre in the first exposure.
 */
function makeScene({ n = 129, scale = 3.075, passes = 3, perPass = 4, trueDist = 4000, bodyAmp = 3, starAmp = 60, seed = 1 }) {
  const rng = makeRng(seed);
  const grid = { ra0: RA0, dec0: DEC0, n, scale };
  const q = quadratures(RA0, DEC0, 60800, 60800 + 190 * (passes + 1));
  const mjds = [];
  for (let p = 0; p < passes; p++) for (let k = 0; k < perPass; k++) mjds.push(q[p] + (k - (perPass - 1) / 2) * 1.5);
  const track = trackThrough(RA0, DEC0, trueDist, mjds);
  const offsets = trackOffsets(track, grid);
  const c = (n - 1) / 2;
  const star = { x: c + 14, y: c - 10 };   // on a pixel centre, so its peak sample is its amplitude
  const layers = mjds.map((mjd, i) => {
    const image = new Float32Array(n * n);
    const variance = new Float32Array(n * n).fill(1);
    const mask = new Uint8Array(n * n);
    // body: east is -x, north is +y
    const bx = c - offsets[i].dEast / scale, by = c + offsets[i].dNorth / scale;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        let v = rng.gauss();
        v += bodyAmp * Math.exp(-((x - bx) ** 2 + (y - by) ** 2) / (2 * PSF_SIGMA * PSF_SIGMA));
        if (starAmp) v += starAmp * Math.exp(-((x - star.x) ** 2 + (y - star.y) ** 2) / (2 * PSF_SIGMA * PSF_SIGMA));
        image[y * n + x] = v;
      }
    }
    return { mjd, det: 3, image, variance, mask, wave: null, frame: null };
  });
  return { grid, layers, mjds, offsets, track, star, c };
}

function peakIn(arr, n, cx, cy, r) {
  let best = -Infinity;
  for (let y = Math.round(cy) - r; y <= Math.round(cy) + r; y++) {
    for (let x = Math.round(cx) - r; x <= Math.round(cx) + r; x++) {
      const v = arr[y * n + x];
      if (Number.isFinite(v) && v > best) best = v;
    }
  }
  return best;
}

test('scene sanity: the injected body really hops by 2 AU / d between passes', () => {
  const s = makeScene({ trueDist: 4000, passes: 3, perPass: 4 });
  const hop = Math.hypot(s.offsets[4].dEast - s.offsets[0].dEast, s.offsets[4].dNorth - s.offsets[0].dNorth);
  assert.ok(Math.abs(hop - hopArcsec(4000)) < 8, `hop ${hop} vs ${hopArcsec(4000)}`);
  // third pass comes back to (nearly) where the first one was: a year later, same side
  const back = Math.hypot(s.offsets[8].dEast - s.offsets[0].dEast, s.offsets[8].dNorth - s.offsets[0].dNorth);
  assert.ok(back < 0.1 * hop, `returns to within ${back} arcsec`);
  // within one pass (4.5 days here) the body barely moves: quadrature is the turning point of
  // the parallax, apart from a slow drift proportional to sin(ecliptic latitude)
  const within = Math.hypot(s.offsets[3].dEast - s.offsets[0].dEast, s.offsets[3].dNorth - s.offsets[0].dNorth);
  assert.ok(within < 3, `within-pass motion ${within} arcsec`);
});

test('shiftAndStack: whole-pixel shifts are exact and the direction is right', () => {
  const n = 21, grid = { ra0: 10, dec0: 20, n, scale: 3 };
  const mk = (x, y) => {
    const image = new Float32Array(n * n);
    image[y * n + x] = 100;
    return { image, variance: new Float32Array(n * n).fill(1), mask: new Uint8Array(n * n) };
  };
  // Layer 0: source at the centre. Layer 1: the source sits 6 arcsec EAST (2 px towards -x) and
  // 3 arcsec NORTH (1 px towards +y) of the centre.
  const layers = [mk(10, 10), mk(8, 11)];
  const st = shiftAndStack(layers, grid, [{ dEast: 0, dNorth: 0 }, { dEast: 6, dNorth: 3 }]);
  assert.equal(st.image[10 * n + 10], 100, 'both copies land on the centre pixel');
  assert.equal(st.count[10 * n + 10], 2);
  assert.ok(Math.abs(st.variance[10 * n + 10] - 0.5) < 1e-6);
  assert.equal(st.image[11 * n + 8], 0);
  // without the shift the two copies stay apart at half height
  const plain = shiftAndStack(layers, grid, []);
  assert.equal(plain.image[10 * n + 10], 50);
  assert.equal(plain.image[11 * n + 8], 50);
  // pixels that the shifted layer cannot cover come from one layer only
  assert.equal(st.count[0 * n + 20], 2);     // output (20, 0) reads layer pixel (18, 1): inside
  assert.equal(st.count[20 * n + 0], 1);     // output (0, 20) reads layer pixel (-2, 21): outside
  assert.equal(st.mask[10 * n + 10], 0);
  // half-pixel shift: bilinear average of two neighbours
  const half = shiftAndStack([mk(10, 10)], grid, [{ dEast: 1.5, dNorth: 0 }]);
  assert.ok(Math.abs(half.image[10 * n + 10] - 50) < 1e-4 && Math.abs(half.image[10 * n + 11] - 50) < 1e-4);
  assert.ok(Math.abs(half.variance[10 * n + 10] - 0.5) < 1e-6, 'variance of an average of two pixels');
});

test('shiftAndStack: masks, bad values, missing variance, bad offsets never throw', () => {
  const n = 15, grid = { ra0: 10, dec0: 20, n, scale: 3 };
  const rng = makeRng(5);
  const mk = () => {
    const image = new Float32Array(n * n).map(() => rng.gauss());
    return { image, variance: new Float32Array(n * n).fill(1), mask: new Uint8Array(n * n) };
  };
  const a = mk(), b = mk(), c = mk();
  a.mask[7 * n + 7] = 1;
  b.image[7 * n + 7] = NaN;
  c.variance[7 * n + 7] = 0;
  let st = shiftAndStack([a, b, c], grid, [{ dEast: 0, dNorth: 0 }, { dEast: 0, dNorth: 0 }, { dEast: 0, dNorth: 0 }]);
  assert.equal(st.count[7 * n + 7], 0);
  assert.equal(st.mask[7 * n + 7], 1);
  assert.ok(Number.isNaN(st.image[7 * n + 7]));
  assert.equal(st.count[3 * n + 3], 3);
  // a masked pixel poisons the bilinear samples that touch it, not the rest
  st = shiftAndStack([a], grid, [{ dEast: 1.5, dNorth: 0 }]);
  assert.equal(st.mask[7 * n + 7], 1);
  assert.equal(st.mask[7 * n + 5], 0);
  // no variance array: falls back to the scatter of the image (about 1)
  const noVar = { image: mk().image, mask: new Uint8Array(n * n) };
  st = shiftAndStack([noVar], grid, [{ dEast: 0, dNorth: 0 }]);
  assert.ok(st.variance[3 * n + 3] > 0.4 && st.variance[3 * n + 3] < 2.5, `fallback variance ${st.variance[3 * n + 3]}`);
  // non-finite offset drops that layer; empty input gives an all-masked result
  st = shiftAndStack([a, b], grid, [{ dEast: NaN, dNorth: 0 }, { dEast: 0, dNorth: 0 }]);
  assert.equal(st.count[3 * n + 3], 1);
  st = shiftAndStack([], grid, []);
  assert.equal(st.mask[0], 1);
  assert.equal(st.image.length, n * n);
  // region option leaves the rest masked
  st = shiftAndStack([a, b], grid, [], { region: { x0: 2, x1: 4, y0: 2, y1: 4 } });
  assert.equal(st.mask[3 * n + 3], 0);
  assert.equal(st.mask[8 * n + 8], 1);
});

test('shiftAndStack refocuses a moving source: S/N grows as sqrt(N), fixed stars smear', () => {
  // Per exposure the body peaks at 2.5 sigma per pixel (matched-filter S/N 4.6): marginal alone.
  const AMP = 2.5;
  const results = [];
  for (const perPass of [1, 4, 16]) {
    const s = makeScene({ trueDist: 4000, passes: 4, perPass, bodyAmp: AMP, starAmp: 60, seed: 11 + perPass });
    const N = s.layers.length;
    const focused = shiftAndStack(s.layers, s.grid, s.offsets);
    const unshifted = shiftAndStack(s.layers, s.grid, []);
    const n = s.grid.n;
    results.push({
      N,
      body: peakIn(focused.snr, n, s.c, s.c, 1),
      bodyUnshifted: peakIn(unshifted.snr, n, s.c, s.c, 1),
      bodyFlux: peakIn(focused.image, n, s.c, s.c, 1),
      starSharp: peakIn(unshifted.image, n, s.star.x, s.star.y, 2),
      starSmeared: peakIn(focused.image, n, s.star.x, s.star.y, 2),
      noise: focused.noise,
    });
  }
  for (const r of results) {
    // matched-filter S/N of a Gaussian of amplitude A in unit noise is A * sqrt(pi) * sigma per
    // exposure: 4.6 here, times sqrt(N) when the stack is in focus
    const expected = AMP * Math.sqrt(Math.PI) * PSF_SIGMA * Math.sqrt(r.N);
    assert.ok(Math.abs(r.body - expected) < 0.2 * expected + 1.5, `N=${r.N}: S/N ${r.body}, expected ${expected}`);
    // the snr map of pure noise has unit scatter: variances are propagated honestly
    assert.ok(r.noise > 0.8 && r.noise < 1.25, `N=${r.N}: snr map scatter ${r.noise}`);
    // unshifted, only the passes that share the first pass's viewpoint add up: half the signal
    assert.ok(r.bodyUnshifted < 0.75 * r.body + 1.5, `N=${r.N}: unshifted ${r.bodyUnshifted} vs focused ${r.body}`);
    // the star: sharp at infinity, split into one copy per viewpoint when the dial is at 4000 AU
    assert.ok(Math.abs(r.starSharp - 60) < 6, `star peak ${r.starSharp}`);
    assert.ok(r.starSmeared < 0.62 * r.starSharp, `N=${r.N}: smeared star ${r.starSmeared} vs ${r.starSharp}`);
  }
  // sqrt(N) growth: 4 -> 16 -> 64 exposures doubles the S/N each time
  const g1 = results[1].body / results[0].body, g2 = results[2].body / results[1].body;
  assert.ok(g1 > 1.6 && g1 < 2.5, `4 -> 16 exposures: S/N ratio ${g1}`);
  assert.ok(g2 > 1.7 && g2 < 2.3, `16 -> 64 exposures: S/N ratio ${g2}`);
  assert.ok(results[2].body > 30, `64 exposures: S/N ${results[2].body}`);
  // and the stacked flux is the injected amplitude (bilinear resampling costs a little)
  assert.ok(results[2].bodyFlux > 0.8 * AMP && results[2].bodyFlux < 1.1 * AMP, `stacked peak ${results[2].bodyFlux}`);
});

test('shiftAndStack: clipping removes the smeared stars but keeps the body', () => {
  const s = makeScene({ trueDist: 4000, passes: 4, perPass: 6, bodyAmp: 1.5, starAmp: 60, seed: 3 });
  const n = s.grid.n;
  const plain = shiftAndStack(s.layers, s.grid, s.offsets);
  const clipped = shiftAndStack(s.layers, s.grid, s.offsets, { clip: 3 });
  // unclipped: a half-height copy of the star where it sits in half the layers
  assert.ok(peakIn(plain.image, n, s.star.x, s.star.y, 2) > 20);
  // In half the layers the star is at star.xy, in the other half displaced by the hop. With 4
  // passes the two viewpoints split the samples 50/50, so the median cannot choose: use 5 passes
  // (3 + 2) to give the sky a majority.
  const s5 = makeScene({ trueDist: 4000, passes: 5, perPass: 4, bodyAmp: 1.5, starAmp: 60, seed: 4 });
  const c5 = shiftAndStack(s5.layers, s5.grid, s5.offsets, { clip: 3 });
  const p5 = shiftAndStack(s5.layers, s5.grid, s5.offsets);
  // the minority copy of the star (2 of 5 passes) is rejected
  const hopPx = { x: -(s5.offsets[4].dEast) / s5.grid.scale, y: s5.offsets[4].dNorth / s5.grid.scale };
  const ghostX = s5.star.x - hopPx.x, ghostY = s5.star.y - hopPx.y;
  const ghostPlain = peakIn(p5.image, n, ghostX, ghostY, 2);
  const ghostClipped = peakIn(c5.image, n, ghostX, ghostY, 2);
  assert.ok(ghostPlain > 15, `unclipped ghost ${ghostPlain}`);
  assert.ok(ghostClipped < 3, `clipped ghost ${ghostClipped}`);
  // the body survives clipping at full strength
  const bodyPlain = peakIn(p5.snr, n, s5.c, s5.c, 1), bodyClipped = peakIn(c5.snr, n, s5.c, s5.c, 1);
  assert.ok(bodyClipped > 0.8 * bodyPlain && bodyClipped > 8, `body S/N ${bodyClipped} (plain ${bodyPlain})`);
  assert.ok(clipped.image.length === n * n);
});

test('dialSweep peaks at the injected distance', () => {
  const s = makeScene({ trueDist: 4000, passes: 4, perPass: 6, bodyAmp: 1.2, starAmp: 0, seed: 21 });
  const distances = [1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 6000, 8000, 12000, 20000, Infinity];
  const curve = dialSweep(s.layers, s.grid, (d) => trackThrough(RA0, DEC0, d, s.mjds), distances);
  assert.equal(curve.length, distances.length);
  const best = focusPeak(curve);
  assert.equal(best.distAU, 4000, `focus curve peaks at ${best.distAU}: ${curve.map((c) => c.peakSnr.toFixed(1)).join(' ')}`);
  // expected in-focus S/N: 1.2 * sqrt(pi) * sigma * sqrt(24) = 11
  assert.ok(best.peakSnr > 8 && best.peakSnr < 14, `peak S/N ${best.peakSnr}`);
  assert.ok(Math.abs(best.x - s.c) <= 1 && Math.abs(best.y - s.c) <= 1, 'peak is where the body was anchored');
  assert.ok(Math.abs(best.spanArcsec - hopArcsec(4000)) < 8);
  // neighbours on the grid of distances are clearly lower, and far-off distances are at the
  // level of half the exposures (the passes that share a viewpoint still line up) or less
  const at = (d) => curve.find((c) => c.distAU === d).peakSnr;
  assert.ok(at(3500) < 0.85 * best.peakSnr && at(4500) < 0.85 * best.peakSnr, `3500: ${at(3500)}, 4500: ${at(4500)}`);
  assert.ok(at(1500) < 0.8 * best.peakSnr && at(Infinity) < 0.8 * best.peakSnr);
  // calibration: pure noise has unit scatter, so the noise factor is close to 1
  assert.ok(curve[0].noise > 0.85 && curve[0].noise < 1.2, `noise ${curve[0].noise}`);
  // infinity means no shift at all
  assert.equal(curve[curve.length - 1].spanArcsec, 0);
});

test('dialSweep: no body, no peak; accepts ready-made offsets; survives bad input', () => {
  const s = makeScene({ trueDist: 4000, passes: 4, perPass: 4, bodyAmp: 0, starAmp: 0, seed: 77 });
  const distances = [2000, 3000, 4000, 6000, Infinity];
  const curve = dialSweep(s.layers, s.grid, (d) => trackThrough(RA0, DEC0, d, s.mjds), distances);
  for (const c of curve) assert.ok(c.peakSnr < 4.5, `noise-only peak ${c.peakSnr} at ${c.distAU}`);
  // offsets instead of sky positions
  const viaOffsets = dialSweep(s.layers, s.grid, (d) => trackOffsets(trackThrough(RA0, DEC0, d, s.mjds), s.grid), distances);
  for (let i = 0; i < curve.length; i++) assert.ok(Math.abs(curve[i].peakSnr - viaOffsets[i].peakSnr) < 1e-6);
  // a track maker that throws or returns nothing yields an unshifted stack, not an exception
  const odd = dialSweep(s.layers, s.grid, () => { throw new Error('nope'); }, [1000]);
  assert.equal(odd.length, 1);
  assert.ok(Number.isFinite(odd[0].peakSnr));
  assert.deepEqual(dialSweep([], s.grid, () => [], []), []);
  assert.deepEqual(dialSweep(s.layers, null, () => [], [1]), []);
  assert.equal(focusPeak([]), null);
});
