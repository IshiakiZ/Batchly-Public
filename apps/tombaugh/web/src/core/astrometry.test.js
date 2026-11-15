// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  propagate, centroid, centroidWings, maskedCoreRadius, centroidError, fitMotion, fitMotionWithParallax, matchGaia,
  matchGaiaDetailed, separationArcsec, positionAngle, offsetBy, tangentOffset,
  yearFromMjd, mjdFromYear, GAIA_DR3_EPOCH,
} from './astrometry.js';
import { parallaxFactors } from './ephemeris.js';

const DEG = Math.PI / 180;

/** Deterministic PRNG (mulberry32) and Gaussian deviates, so the noisy tests never flake. */
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

// Approximate catalogue values (SIMBAD / Gaia DR3).
const BARNARD_2000 = { ra: 269.452075, dec: 4.693391, pmra: -802.8, pmdec: 10362.5, parallax: 547.0, epoch: 2000.0 };

test('epochs: J2000.0 = MJD 51544.5, Julian years', () => {
  assert.equal(yearFromMjd(51544.5), 2000);
  assert.equal(mjdFromYear(2000), 51544.5);
  assert.equal(mjdFromYear(2016.0), 57388.5);          // Gaia DR3 epoch, JD 2457389.0
  assert.equal(GAIA_DR3_EPOCH, 2016.0);
  assert.ok(Math.abs(yearFromMjd(mjdFromYear(2026.5)) - 2026.5) < 1e-12);
  assert.ok(Math.abs(yearFromMjd(61210.79) - 2026.464) < 0.001);   // the real 2026-06-19 frame
});

test('separation, position angle and offsetBy agree on which way is east', () => {
  // 10 arcsec due east of a point at dec 60: RA grows by 10 / cos(60) = 20 arcsec.
  const e = offsetBy(100, 60, 10, 0);
  assert.ok(Math.abs((e.ra - 100) * 3600 - 20) < 1e-3);
  assert.ok(Math.abs(e.dec - 60) * 3600 < 1e-3);
  assert.ok(Math.abs(positionAngle(100, 60, e.ra, e.dec) - 90) < 0.01);
  assert.ok(Math.abs(separationArcsec(100, 60, e.ra, e.dec) - 10) < 1e-9);
  // north
  const nn = offsetBy(100, 60, 0, 30);
  assert.ok(Math.abs((nn.dec - 60) * 3600 - 30) < 1e-9);
  assert.ok(positionAngle(100, 60, nn.ra, nn.dec) < 1e-6);
  // west and south
  assert.ok(Math.abs(positionAngle(100, 60, 99.99, 60) - 270) < 0.01);
  assert.ok(Math.abs(positionAngle(100, 60, 100, 59.99) - 180) < 1e-9);
  // round trip at a large offset, across RA = 0
  const far = offsetBy(359.9, -30, 3000, -2000);
  assert.ok(far.ra < 1 && far.ra > 0);
  assert.ok(Math.abs(separationArcsec(359.9, -30, far.ra, far.dec) - Math.hypot(3000, 2000)) < 1e-6);
  assert.ok(Math.abs(positionAngle(359.9, -30, far.ra, far.dec) - (Math.atan2(3000, -2000) / DEG)) < 1e-6);
  // tangentOffset has the same handedness and matches for small offsets
  const t = tangentOffset(e.ra, e.dec, 100, 60);
  assert.ok(Math.abs(t.dEast - 10) < 1e-3 && Math.abs(t.dNorth) < 1e-3);
  // known pair: Epsilon Indi A to B is about 400 arcsec, roughly east
  const sep = separationArcsec(330.8402, -56.7860, 331.0438, -56.7827);
  assert.ok(sep > 395 && sep < 410, `Eps Indi A-B ${sep}`);
});

test("Barnard's Star: 2000.0 -> 2026.5 is 274.6 arcsec north", () => {
  const p = propagate(BARNARD_2000, mjdFromYear(2026.5), { parallax: false });
  const north = (p.dec - BARNARD_2000.dec) * 3600;
  assert.ok(Math.abs(north - 274.6) < 0.1, `moved ${north} arcsec north`);
  const east = (p.ra - BARNARD_2000.ra) * 3600 * Math.cos(p.dec * DEG);
  assert.ok(Math.abs(east - -0.8028 * 26.5) < 0.05, `moved ${east} arcsec east`);   // i.e. WEST
  assert.ok(p.ra < BARNARD_2000.ra, 'negative pmra decreases RA');
  const sep = separationArcsec(BARNARD_2000.ra, BARNARD_2000.dec, p.ra, p.dec);
  assert.ok(Math.abs(sep - 10.39355 * 26.5) < 0.05, `total ${sep}`);
  const pa = positionAngle(BARNARD_2000.ra, BARNARD_2000.dec, p.ra, p.dec);
  assert.ok(Math.abs(pa - 355.57) < 0.02, `PA ${pa}`);
});

test("Barnard's Star: 2000.0 position carried to 2016.0 lands on Gaia DR3", () => {
  // Gaia DR3 4472832130942575872 at epoch 2016.0: RA 269.44850, Dec +4.73942.
  // (The task brief quoted Dec +4.73798; that is 5.3 arcsec from where ANY propagation of the
  // stated 2000.0 position and proper motion must land, 4.693391 + 16 * 10.3625 / 3600 = 4.73945,
  // and from Gaia's own value. See docs/DEVIATIONS.md.)
  const p = propagate(BARNARD_2000, mjdFromYear(2016.0), { parallax: false });
  const sep = separationArcsec(p.ra, p.dec, 269.44850, 4.73942);
  assert.ok(sep < 0.5, `separation from Gaia DR3 ${sep} arcsec`);
  // and the other way: Gaia DR3 carried back to 2000.0 lands on the catalogue J2000 position
  const gaia = { ra: 269.44850252, dec: 4.73942005, pmra: -801.551, pmdec: 10362.394, parallax: 546.98 };
  const back = propagate(gaia, mjdFromYear(2000.0), { parallax: false });   // epoch defaults to 2016.0
  assert.ok(separationArcsec(back.ra, back.dec, BARNARD_2000.ra, BARNARD_2000.dec) < 0.5);
  // epoch itself is a fixed point
  const same = propagate(BARNARD_2000, mjdFromYear(2000.0), { parallax: false });
  assert.ok(separationArcsec(same.ra, same.dec, BARNARD_2000.ra, BARNARD_2000.dec) < 1e-9);
});

test('propagate: parallax ellipse matches the parallax factors', () => {
  let maxShift = 0;
  for (let mjd = 60800; mjd < 61170; mjd += 13) {
    const without = propagate(BARNARD_2000, mjd, { parallax: false });
    const withP = propagate(BARNARD_2000, mjd);        // parallax on by default
    const f = parallaxFactors(without.ra, without.dec, mjd);
    const dE = (withP.ra - without.ra) * 3600 * Math.cos(without.dec * DEG);
    const dN = (withP.dec - without.dec) * 3600;
    assert.ok(Math.abs(dE - 0.547 * f.pra) < 1e-4, `east ${dE} vs ${0.547 * f.pra}`);
    assert.ok(Math.abs(dN - 0.547 * f.pdec) < 1e-4, `north ${dN} vs ${0.547 * f.pdec}`);
    maxShift = Math.max(maxShift, Math.hypot(dE, dN));
  }
  assert.ok(maxShift > 0.5 && maxShift < 0.547 * 1.02, `largest parallax shift ${maxShift}`);
  // no parallax given: the flag changes nothing
  const s = { ra: 10, dec: 20, pmra: 5, pmdec: 5, parallax: null, epoch: 2016 };
  assert.deepEqual(propagate(s, 61000), propagate(s, 61000, { parallax: false }));
});

test('propagate: RA wrap, high declination, missing values', () => {
  // crosses RA = 0 going east
  const s = { ra: 359.9995, dec: 60, pmra: 10000, pmdec: 0, epoch: 2016.0 };
  const p = propagate(s, mjdFromYear(2017.0), { parallax: false });
  assert.ok(p.ra >= 0 && p.ra < 0.01, `ra ${p.ra}`);
  assert.ok(Math.abs(separationArcsec(s.ra, s.dec, p.ra, p.dec) - 10) < 1e-3);
  // crosses going west
  const w = propagate({ ra: 0.0005, dec: -45, pmra: -8000, pmdec: 0, epoch: 2016.0 }, mjdFromYear(2018.0), { parallax: false });
  assert.ok(w.ra > 359.99 && w.ra < 360);
  // a star 5 arcsec from the pole moving at 10 arcsec/yr sails past it: still exactly mu * t
  const pole = { ra: 30, dec: 90 - 5 / 3600, pmra: 0, pmdec: 10000, epoch: 2016.0 };
  const q = propagate(pole, mjdFromYear(2017.0), { parallax: false });
  assert.ok(Math.abs(separationArcsec(pole.ra, pole.dec, q.ra, q.dec) - 10) < 1e-6);
  assert.ok(Math.abs(q.dec - (90 - 5 / 3600)) < 1e-6, 'ends 5 arcsec beyond the pole');
  assert.ok(Math.abs(((q.ra - 210 + 540) % 360) - 180) < 1e-3, `ra flipped by 12h: ${q.ra}`);
  // general direction: displacement has the position angle of the proper motion
  const g = { ra: 200, dec: -70, pmra: 3000, pmdec: -4000, epoch: 2000.0 };
  const g2 = propagate(g, mjdFromYear(2030.0), { parallax: false });
  assert.ok(Math.abs(separationArcsec(g.ra, g.dec, g2.ra, g2.dec) - 150) < 0.001);
  assert.ok(Math.abs(positionAngle(g.ra, g.dec, g2.ra, g2.dec) - (Math.atan2(3000, -4000) / DEG)) < 0.001);
  // nulls and missing fields are zero motion; garbage gives NaN, not an exception
  const still = propagate({ ra: 12, dec: 34, pmra: null, pmdec: null, parallax: null }, 61000);
  assert.deepEqual(still, { ra: 12, dec: 34 });
  assert.ok(Number.isNaN(propagate({ ra: NaN, dec: 1 }, 61000).ra));
  assert.ok(Number.isNaN(propagate(null, 61000).ra));
  // radial velocity is optional and small: Barnard's Star, -110 km/s, 0.16 arcsec in 16 years
  const rv = propagate({ ...BARNARD_2000, rv: -110.5 }, mjdFromYear(2016.0), { parallax: false });
  const no = propagate(BARNARD_2000, mjdFromYear(2016.0), { parallax: false });
  const d = separationArcsec(rv.ra, rv.dec, no.ra, no.dec);
  assert.ok(d > 0.1 && d < 0.25, `perspective acceleration ${d}`);
});

// ---- centroid -----------------------------------------------------------------------------------

function gaussianImage(n, sources, noise, rng, bg = 0) {
  const img = new Float32Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let v = bg + (noise ? noise * rng.gauss() : 0);
      for (const s of sources) {
        const r2 = (x - s.x) ** 2 + (y - s.y) ** 2;
        v += s.amp * Math.exp(-r2 / (2 * s.sigma * s.sigma));
      }
      img[y * n + x] = v;
    }
  }
  return img;
}

test('centroid recovers an injected Gaussian to 0.05 pixel with noise', () => {
  const rng = makeRng(42);
  const n = 41;
  let worst = 0;
  let sumZ2 = 0, count = 0;
  for (let trial = 0; trial < 40; trial++) {
    const tx = 20 + (rng.uniform() - 0.5) * 6, ty = 20 + (rng.uniform() - 0.5) * 6;
    // amplitude 100, noise 1, PSF sigma 1.04 px (7.5 arcsec FWHM on the 3.075 arcsec grid),
    // on a background pedestal of 7. Expected error sqrt(2) sigma / SNR = 0.008 px per axis.
    const img = gaussianImage(n, [{ x: tx, y: ty, amp: 100, sigma: 1.04 }], 1, rng, 7);
    // start up to 1.5 pixels off
    const c = centroid(img, null, n, tx + (rng.uniform() - 0.5) * 3, ty + (rng.uniform() - 0.5) * 3);
    assert.ok(c.ok, 'bright source is found');
    const err = Math.hypot(c.x - tx, c.y - ty);
    worst = Math.max(worst, err);
    assert.ok(Math.abs(c.background - 7) < 0.5, `background ${c.background}`);
    assert.ok(Math.abs(c.noise - 1) < 0.35, `noise ${c.noise}`);
    // total flux of the Gaussian is 2 pi sigma^2 amp = 679.6; the aperture holds nearly all of it
    assert.ok(Math.abs(c.flux - 679.6) < 40, `flux ${c.flux}`);
    assert.ok(c.snr > 30);
    sumZ2 += ((c.x - tx) / c.xErr) ** 2 + ((c.y - ty) / c.yErr) ** 2;
    count += 2;
  }
  assert.ok(worst < 0.05, `worst centroid error ${worst} px`);
  // the reported errors describe the scatter (reduced chi-square near 1)
  const red = sumZ2 / count;
  assert.ok(red > 0.5 && red < 2.0, `reduced chi2 of centroid errors ${red}`);
});

test('centroid: noiseless image is recovered almost exactly, on native-scale PSFs too', () => {
  for (const sigma of [0.55, 1.04, 1.8]) {
    const img = gaussianImage(31, [{ x: 14.37, y: 16.81, amp: 10, sigma }], 0, null, 2);
    const c = centroid(img, null, 31, 15, 16);
    assert.ok(c.ok);
    // an undersampled PSF (sigma 0.55 px) sampled at pixel centres carries a small pixel-phase error
    const tol = sigma < 1 ? 0.03 : 0.003;
    assert.ok(Math.abs(c.x - 14.37) < tol && Math.abs(c.y - 16.81) < tol, `sigma ${sigma}: ${c.x}, ${c.y}`);
  }
});

test('centroid: weak signal, masked box, bad pixels and neighbours', () => {
  const rng = makeRng(7);
  const n = 41;
  // pure noise: not ok, and the guess is returned untouched
  let falsePositives = 0;
  for (let i = 0; i < 30; i++) {
    const noiseOnly = gaussianImage(n, [], 1, rng, 3);
    const c = centroid(noiseOnly, null, n, 20, 20);
    if (c.ok) falsePositives++;
    else assert.deepEqual([c.x, c.y], [20, 20]);
  }
  assert.ok(falsePositives <= 1, `${falsePositives} false positives in 30 noise images`);

  const img = gaussianImage(n, [{ x: 20.3, y: 19.6, amp: 40, sigma: 1.04 }], 1, rng, 3);
  // mostly masked window
  const mask = new Uint8Array(n * n).fill(1);
  for (let y = 18; y <= 22; y++) for (let x = 18; x <= 22; x++) mask[y * n + x] = 0;
  const m = centroid(img, mask, n, 20, 20);
  assert.equal(m.ok, false);
  assert.ok(m.validFrac < 0.5);
  // a few masked or NaN pixels are tolerated
  const mask2 = new Uint8Array(n * n);
  mask2[17 * n + 23] = 1; mask2[24 * n + 16] = 1;
  const img2 = Float32Array.from(img);
  img2[16 * n + 16] = NaN; img2[23 * n + 24] = Infinity;
  const c2 = centroid(img2, mask2, n, 20, 20);
  assert.ok(c2.ok);
  assert.ok(Math.hypot(c2.x - 20.3, c2.y - 19.6) < 0.1);
  // near the image edge: window is clipped, fewer than half the pixels exist
  assert.equal(centroid(img, null, n, 0, 0).ok, false);
  // garbage arguments
  assert.equal(centroid(null, null, n, 5, 5).ok, false);
  assert.equal(centroid(img, null, n, NaN, 5).ok, false);
  // a brighter neighbour 6 px away does not capture the centroid
  const pair = gaussianImage(n, [{ x: 20.3, y: 19.6, amp: 40, sigma: 1.04 }, { x: 26.3, y: 19.6, amp: 80, sigma: 1.04 }], 1, rng, 3);
  const cp = centroid(pair, null, n, 20, 20);
  assert.ok(cp.ok && Math.hypot(cp.x - 20.3, cp.y - 19.6) < 0.1, `with neighbour: ${cp.x}, ${cp.y}`);
});

test('centroidWings: a saturated star is located from its wings, whatever the shape of the hole', () => {
  const n = 61;
  const rng = makeRng(77);
  let worst = 0;
  for (let trial = 0; trial < 24; trial++) {
    const tx = 30 + (rng.uniform() - 0.5) * 2;
    const ty = 30 + (rng.uniform() - 0.5) * 2;
    // Core plus power-law-like wings (two wide Gaussians), on a sloping-free background.
    const img = gaussianImage(n, [
      { x: tx, y: ty, amp: 4000, sigma: 1.1 },
      { x: tx, y: ty, amp: 60, sigma: 3.5 },
      { x: tx, y: ty, amp: 6, sigma: 8 },
    ], 0.05, rng, 0.2);
    const mask = new Uint8Array(n * n);
    // The flagged core: a ragged blob, off-centre, with a bleed column on one side.
    const cx = tx + 0.4, cy = ty - 0.3, rc = 3 + (trial % 3);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const inBlob = Math.hypot(x - cx, y - cy) < rc || (Math.abs(x - Math.round(tx)) < 1 && y > ty && y < ty + rc + 3);
        if (inBlob) { mask[y * n + x] = 1; img[y * n + x] = NaN; }
      }
    }
    const rCore = maskedCoreRadius(img, mask, n, tx, ty);
    assert.ok(rCore >= rc - 1.5 && rCore <= rc + 3.5, `core radius ${rCore} for a blob of ${rc}`);
    const guessX = tx + (rng.uniform() - 0.5) * 3;
    const guessY = ty + (rng.uniform() - 0.5) * 3;
    const c = centroidWings(img, mask, n, guessX, guessY);
    assert.equal(c.ok, true, `trial ${trial}: ${JSON.stringify({ snr: c.snr, it: c.iterations })}`);
    assert.equal(c.method, 'wings');
    worst = Math.max(worst, Math.hypot(c.x - tx, c.y - ty));
    assert.ok(c.xErr >= 0.15 && c.yErr >= 0.15);
    // The ordinary centroid has no business here: it fails or lands on a wing.
    const plain = centroid(img, mask, n, guessX, guessY);
    assert.ok(!plain.ok || Math.hypot(plain.x - tx, plain.y - ty) > 0.5);
  }
  assert.ok(worst < 0.3, `worst error ${worst} px`);

  // Not masked at the centre: say so and leave it to centroid().
  const clean = gaussianImage(n, [{ x: 30, y: 30, amp: 100, sigma: 1.2 }], 0.05, rng);
  assert.equal(maskedCoreRadius(clean, null, n, 30, 30), 0);
  assert.equal(centroidWings(clean, null, n, 30, 30).ok, false);
  // A masked hole in empty sky has no wings to measure.
  const empty = gaussianImage(n, [], 0.05, rng);
  const hole = new Uint8Array(n * n);
  for (let y = 27; y <= 33; y++) for (let x = 27; x <= 33; x++) hole[y * n + x] = 1;
  assert.equal(centroidWings(empty, hole, n, 30, 30).ok, false);
});

test('centroidError: 0.6 FWHM / SNR with a floor', () => {
  assert.ok(Math.abs(centroidError(100, 2.44, { floor: 0 }) - 0.6006 * 2.44 / 100) < 1e-4);
  assert.ok(Math.abs(centroidError(1e9) - 0.05) < 1e-6);
  assert.equal(centroidError(0), Infinity);
  assert.ok(centroidError(5) > centroidError(50));
});

// ---- motion -------------------------------------------------------------------------------------

test('fitMotion: exact recovery, signs and position angle', () => {
  const star = { ra: 269.4485, dec: 4.7394, pmra: -801.6, pmdec: 10362.4, epoch: 2016.0 };
  const pts = [2025.45, 2025.95, 2026.45].map((y) => {
    const p = propagate(star, mjdFromYear(y), { parallax: false });
    return { mjd: mjdFromYear(y), ra: p.ra, dec: p.dec };
  });
  const fit = fitMotion(pts);
  assert.equal(fit.n, 3);
  assert.ok(Math.abs(fit.pmra - -801.6) < 0.05, `pmra ${fit.pmra}`);
  assert.ok(Math.abs(fit.pmdec - 10362.4) < 0.05, `pmdec ${fit.pmdec}`);
  assert.ok(Math.abs(fit.total - Math.hypot(801.6, 10362.4)) < 0.05);
  assert.ok(Math.abs(fit.paDeg - 355.577) < 0.01, `PA ${fit.paDeg}`);
  assert.ok(fit.rmsArcsec < 1e-4);
  assert.ok(Math.abs(fit.mjd0 - mjdFromYear(2025.95)) < 1e-6);
  // two points: slope is exact, but there is no way to estimate an error without weights
  const two = fitMotion(pts.slice(0, 2));
  assert.ok(Math.abs(two.pmdec - 10362.4) < 0.1);
  assert.ok(Number.isNaN(two.errTotal));
  // with weights the two-point error is the formal one: sigma 0.5" each, 0.5 yr apart
  const twoW = fitMotion(pts.slice(0, 2).map((p) => ({ ...p, w: 4 })));
  assert.ok(Math.abs(twoW.errPmdec - 1000 * Math.SQRT2) < 1, `formal error ${twoW.errPmdec}`);
  // an eastward mover near RA 0 at high declination
  const s2 = { ra: 0.001, dec: 75, pmra: -5000, pmdec: -1200, epoch: 2025.0 };
  const pts2 = [2025.0, 2025.5, 2026.0, 2026.5].map((y) => ({ mjd: mjdFromYear(y), ...propagate(s2, mjdFromYear(y), { parallax: false }) }));
  const f2 = fitMotion(pts2);
  // (components are along east and north AT THE FITTED REFERENCE POSITION; 3.75 arcsec of travel
  // at dec 75 turns the local north by 14 arcsec, worth 0.3 mas/yr here: physics, not error)
  assert.ok(Math.abs(f2.pmra - -5000) < 0.5 && Math.abs(f2.pmdec - -1200) < 0.5, `${f2.pmra}, ${f2.pmdec}`);
  assert.ok(Math.abs(f2.total - Math.hypot(5000, 1200)) < 0.01, `speed ${f2.total}`);
  // degenerate inputs
  assert.ok(Number.isNaN(fitMotion([]).total));
  assert.ok(Number.isNaN(fitMotion([pts[0]]).total));
  assert.ok(Number.isNaN(fitMotion([pts[0], { ...pts[0] }]).total));   // no time span
  assert.equal(fitMotion([pts[0], { mjd: NaN, ra: 1, dec: 1 }]).n, 1);
});

test('fitMotion recovers 10.36 arcsec/yr from three epochs with 0.5 arcsec scatter, within errors', () => {
  const rng = makeRng(2026);
  const star = { ra: 269.4485, dec: 4.7394, pmra: -801.6, pmdec: 10362.4, epoch: 2016.0 };
  const truth = Math.hypot(801.6, 10362.4);
  const epochs = [2025.45, 2025.95, 2026.45];
  let within1 = 0, within3 = 0, trials = 200, sumErr = 0;
  for (let k = 0; k < trials; k++) {
    const pts = epochs.map((y) => {
      const p = propagate(star, mjdFromYear(y), { parallax: false });
      const q = offsetBy(p.ra, p.dec, 0.5 * rng.gauss(), 0.5 * rng.gauss());
      return { mjd: mjdFromYear(y), ra: q.ra, dec: q.dec, sigma: 0.5 };
    });
    const fit = fitMotion(pts);
    assert.ok(fit.errTotal > 600 && fit.errTotal < 2500, `errTotal ${fit.errTotal}`);
    const z = Math.abs(fit.total - truth) / fit.errTotal;
    if (z < 1) within1++;
    if (z < 3) within3++;
    sumErr += fit.errTotal;
    if (k === 0) {
      // the single headline case: recovered within 3 sigma, and the error is honest (0.7 arcsec/yr)
      assert.ok(z < 3, `recovered ${fit.total} +- ${fit.errTotal}, truth ${truth}`);
      assert.ok(Math.abs(fit.total - truth) < 2500);
      const dpa = Math.abs(((fit.paDeg - 355.577 + 540) % 360) - 180);
      assert.ok(dpa < 3 * fit.errPaDeg, `PA ${fit.paDeg} +- ${fit.errPaDeg}`);
    }
  }
  // errors behave like 1-sigma errors over many realisations
  assert.ok(within3 >= trials * 0.97, `${within3}/${trials} within 3 sigma`);
  assert.ok(within1 > trials * 0.5 && within1 < trials * 0.9, `${within1}/${trials} within 1 sigma`);
  // formal error for sigma 0.5" at t = -0.5, 0, +0.5 yr is 0.5 / sqrt(0.5) = 0.707 arcsec/yr,
  // inflated a little when the scatter happens to be large
  assert.ok(sumErr / trials > 700 && sumErr / trials < 1100, `mean error ${sumErr / trials}`);
});

test('fitMotionWithParallax separates parallax from motion over three passes', () => {
  const rng = makeRng(99);
  const star = { ra: 133.795129, dec: -7.245147, pmra: -8118, pmdec: 680, parallax: 439, epoch: 2014.3 };
  // five SPHEREx-like passes, a few exposures each
  const mjds = [];
  for (const y of [2025.40, 2025.90, 2026.40, 2026.90, 2027.40]) for (const d of [-4, 0, 4]) mjds.push(mjdFromYear(y) + d);
  const clean = mjds.map((mjd) => ({ mjd, ...propagate(star, mjd) }));
  const fit = fitMotionWithParallax(clean);
  assert.ok(Math.abs(fit.parallax - 439) < 1, `parallax ${fit.parallax}`);
  assert.ok(Math.abs(fit.pmra - -8118) < 2 && Math.abs(fit.pmdec - 680) < 2, `${fit.pmra}, ${fit.pmdec}`);
  // ignoring parallax biases the motion measurably; solving for it does better
  const plain = fitMotion(clean);
  assert.equal(plain.parallax, null);
  assert.ok(Math.hypot(plain.pmra + 8118, plain.pmdec - 680) > Math.hypot(fit.pmra + 8118, fit.pmdec - 680));
  // noisy: 0.3 arcsec per point; parallax recovered within 3 sigma
  const noisy = clean.map((p) => {
    const q = offsetBy(p.ra, p.dec, 0.3 * rng.gauss(), 0.3 * rng.gauss());
    return { mjd: p.mjd, ra: q.ra, dec: q.dec, sigma: 0.3 };
  });
  const nf = fitMotionWithParallax(noisy);
  assert.ok(Math.abs(nf.parallax - 439) < 3 * nf.errParallax, `parallax ${nf.parallax} +- ${nf.errParallax}`);
  assert.ok(nf.errParallax > 30 && nf.errParallax < 400);
  // only two passes: parallax cannot be separated, falls back to a plain motion fit
  const twoPass = clean.slice(0, 6);
  const fb = fitMotionWithParallax(twoPass);
  assert.equal(fb.parallax, null);
  assert.ok(Number.isFinite(fb.pmra));
  // two points: plain fit
  assert.equal(fitMotionWithParallax(clean.slice(0, 2)).parallax, null);
});

test('matchGaia propagates every star to the frame date', () => {
  const stars = [
    { id: 'field-1', ra: 269.4700, dec: 4.7600, pmra: 2.1, pmdec: -3.3, parallax: 1.2, gmag: 14 },
    { id: 'barnard', ra: 269.44850252, dec: 4.73942005, pmra: -801.551, pmdec: 10362.394, parallax: 546.98, gmag: 8.2 },
    { id: 'no-pm', ra: 269.4300, dec: 4.7700, pmra: null, pmdec: null, parallax: null, gmag: 17 },
    { id: 'broken', ra: null, dec: 4.77 },
  ];
  const mjd = mjdFromYear(2026.5);
  const now = propagate({ ...stars[1], epoch: 2016.0 }, mjd);
  // by 2026.5 Barnard's Star is 109 arcsec north of its Gaia position
  assert.ok(Math.abs(separationArcsec(stars[1].ra, stars[1].dec, now.ra, now.dec) - 109.1) < 1);
  assert.equal(matchGaia(stars, now.ra, now.dec, mjd, 3), stars[1]);
  // ...and nothing is left at the 2016.0 catalogue position
  assert.equal(matchGaia(stars, stars[1].ra, stars[1].dec, mjd, 10), null);
  // at the catalogue epoch it matches where the catalogue says
  assert.equal(matchGaia(stars, stars[1].ra, stars[1].dec, mjdFromYear(2016.0), 1), stars[1]);
  // stars without proper motion still match; nearest wins
  assert.equal(matchGaia(stars, 269.4300, 4.7700, mjd, 2).id, 'no-pm');
  const d = matchGaiaDetailed(stars, 269.4700, 4.7600 + 1 / 3600, mjd, 5);
  assert.equal(d.star.id, 'field-1');
  assert.equal(d.index, 0);
  assert.ok(Math.abs(d.sepArcsec - 1) < 0.1);
  // explicit epoch option and empty input
  assert.equal(matchGaia(stars, stars[1].ra, stars[1].dec, mjd, 1, { epoch: 2026.5, parallax: false }), stars[1]);
  assert.equal(matchGaia([], 1, 2, mjd, 5), null);
  assert.equal(matchGaia(null, 1, 2, mjd, 5), null);
});
