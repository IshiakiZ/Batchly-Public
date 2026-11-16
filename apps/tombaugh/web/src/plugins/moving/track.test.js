// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  EXPOSURE_SECONDS,
  PIXEL_ARCSEC,
  apparentRate,
  attachPositions,
  dateRangeLabel,
  dayLabel,
  exposureSmear,
  makeEphemeris,
  medianOf,
  monthLabel,
  pathPointAt,
  planSentence,
  positionAt,
  skyPath,
  splitVisits,
  summarizeTrack,
  trackSamples,
} from './track.js';
import { angSep } from '../../core/wcs.js';
import { predictedTrack } from '../../core/distance.js';

const DEG = Math.PI / 180;

/** A body moving along a great circle at a constant rate, plus a yearly parallax-like wobble. */
function truth(mjd, { ra0 = 305.2, dec0 = -23.4, rateArcsecPerHour = 3.1, paDeg = 255, wobbleArcsec = 0 } = {}) {
  const t = mjd - 60888;
  const along = (rateArcsecPerHour * 24 * t) / 3600; // deg
  const w = (wobbleArcsec / 3600) * Math.sin((2 * Math.PI * t) / 365.25);
  const dE = along * Math.sin(paDeg * DEG) + w;
  const dN = along * Math.cos(paDeg * DEG) + 0.4 * w;
  // small-field offset on the sphere (exact enough for a truth model: it is the same function
  // that generates the samples and the check values)
  const dec = dec0 + dN;
  const ra = ra0 + dE / Math.cos(((dec0 + dec) / 2) * DEG);
  return { ra: ((ra % 360) + 360) % 360, dec };
}

function sampled(opts, { start = 60880, end = 60900, stepHours = 12 } = {}) {
  const rows = [];
  for (let mjd = start; mjd <= end + 1e-9; mjd += stepHours / 24) {
    const p = truth(mjd, opts);
    rows.push([mjd, p.ra, p.dec, 34.3 + 0.001 * (mjd - start), 14.4]);
  }
  return rows;
}

test('makeEphemeris accepts the proxy answer, bare rows and track objects', () => {
  const rows = sampled({});
  const a = makeEphemeris({ name: 'Pluto (999)', source: 'JPL Horizons', center: 'geocentric', samples: rows });
  assert.equal(a.n, rows.length);
  assert.equal(a.name, 'Pluto (999)');
  assert.equal(a.source, 'JPL Horizons');
  assert.equal(a.mjdMin, 60880);
  assert.equal(a.mjdMax, 60900);
  const b = makeEphemeris(rows);
  assert.equal(b.n, a.n);
  const c = makeEphemeris(rows.map(([mjd, ra, dec, delta]) => ({ mjd, ra, dec, distGeoAU: delta })));
  assert.equal(c.n, a.n);
  assert.equal(c.delta[0], 34.3);
  assert.ok(Number.isNaN(c.mag[0]));
  // unit vectors are unit
  for (let i = 0; i < a.n; i++) assert.ok(Math.abs(Math.hypot(a.ux[i], a.uy[i], a.uz[i]) - 1) < 1e-12);
});

test('makeEphemeris sorts, drops bad rows and duplicate times, and never throws', () => {
  const eph = makeEphemeris([
    [60890, 10, 5, 3, null],
    [60888, 9, 5, 3, 17.2],
    [60889, NaN, 5],
    [60888, 9.5, 5],
    null,
    [60891, 370, 5],
    [60892, 11, 95],
    ['x', 1, 2],
  ]);
  assert.deepEqual(Array.from(eph.mjd), [60888, 60890, 60891]);
  assert.equal(eph.ra[0], 9);
  assert.equal(eph.ra[2], 10); // 370 wrapped
  assert.ok(Number.isNaN(eph.mag[1]));
  assert.equal(makeEphemeris(null).n, 0);
  assert.equal(makeEphemeris({}).n, 0);
  assert.equal(makeEphemeris(undefined).n, 0);
});

test('positionAt reproduces the samples and interpolates a Pluto-like path to milliarcseconds', () => {
  const opts = { wobbleArcsec: 3600 };
  const eph = makeEphemeris(sampled(opts));
  for (let i = 0; i < eph.n; i++) {
    const p = positionAt(eph, eph.mjd[i]);
    assert.ok(angSep(p.ra, p.dec, eph.ra[i], eph.dec[i]) * 3600 < 1e-6);
    assert.equal(p.inside, true);
  }
  let worst = 0;
  for (let mjd = 60881.03; mjd < 60899; mjd += 0.317) {
    const p = positionAt(eph, mjd);
    const t = truth(mjd, opts);
    worst = Math.max(worst, angSep(p.ra, p.dec, t.ra, t.dec) * 3600);
  }
  assert.ok(worst < 0.01, `worst error ${worst} arcsec`);
});

test('cubic interpolation beats a straight chord on a curved comet path', () => {
  // A fast, curving path: 150 arcsec/hour with a strong wobble, sampled every 12 hours.
  const opts = { ra0: 246.7, dec0: -16.8, rateArcsecPerHour: 150, paDeg: 280, wobbleArcsec: 40000 };
  const eph = makeEphemeris(sampled(opts, { start: 60880, end: 60900, stepHours: 12 }));
  let worst = 0;
  let worstChord = 0;
  for (let mjd = 60883.25; mjd < 60897; mjd += 0.5) { // mid-interval: the worst place
    const p = positionAt(eph, mjd);
    const t = truth(mjd, opts);
    worst = Math.max(worst, angSep(p.ra, p.dec, t.ra, t.dec) * 3600);
    const a = truth(mjd - 0.25, opts);
    const b = truth(mjd + 0.25, opts);
    worstChord = Math.max(worstChord, angSep((a.ra + b.ra) / 2, (a.dec + b.dec) / 2, t.ra, t.dec) * 3600);
  }
  assert.ok(worst < 0.2, `cubic error ${worst} arcsec`);
  assert.ok(worst < worstChord / 5, `cubic ${worst} vs chord ${worstChord}`);
});

test('positionAt is safe across RA 0/360 and near the pole', () => {
  const wrap = makeEphemeris([[60000, 359.9, 10], [60001, 359.97, 10], [60002, 0.04, 10], [60003, 0.11, 10]]);
  const mid = positionAt(wrap, 60001.5);
  assert.ok(mid.ra > 359.99 || mid.ra < 0.02, `ra ${mid.ra}`);
  assert.ok(Math.abs(mid.dec - 10) < 1e-3);
  // over the pole: RA jumps by 180 deg, the unit vector does not care
  const pole = makeEphemeris([[60000, 10, 89.0], [60001, 10, 89.6], [60002, 190, 89.8], [60003, 190, 89.2]]);
  const p = positionAt(pole, 60001.5);
  assert.ok(p.dec > 89.6, `dec ${p.dec}`);
  assert.ok(Number.isFinite(p.ra));
});

test('positionAt outside the table clamps and says so; delta and mag interpolate linearly', () => {
  const eph = makeEphemeris([[60000, 10, 5, 30, 14], [60002, 10.2, 5.1, 32, null], [60004, 10.4, 5.2, 34, 15]]);
  const before = positionAt(eph, 59990);
  assert.equal(before.inside, false);
  assert.ok(Math.abs(before.ra - 10) < 1e-9);
  const after = positionAt(eph, 60010);
  assert.equal(after.inside, false);
  assert.ok(Math.abs(after.ra - 10.4) < 1e-9);
  const mid = positionAt(eph, 60001);
  assert.equal(mid.delta, 31);
  assert.equal(mid.mag, 14); // the only known neighbour
  assert.equal(positionAt(eph, 60003).mag, 15);
  // degenerate tables
  const one = makeEphemeris([[60000, 10, 5, 30, 14]]);
  assert.deepEqual(positionAt(one, 60000), { ra: 10, dec: 5, delta: 30, mag: 14, inside: true });
  assert.ok(Number.isNaN(positionAt(makeEphemeris([]), 60000).ra));
  assert.ok(Number.isNaN(positionAt(eph, NaN).ra));
});

test('apparentRate recovers speed and direction', () => {
  for (const [rate, pa] of [[3.1, 255], [40, 30], [0.5, 180], [150, 359]]) {
    const eph = makeEphemeris(sampled({ rateArcsecPerHour: rate, paDeg: pa, dec0: 20 }));
    const r = apparentRate(eph, 60890.3);
    assert.ok(Math.abs(r.arcsecPerHour - rate) / rate < 0.002, `rate ${r.arcsecPerHour} vs ${rate}`);
    const dpa = Math.abs(((r.paDeg - pa + 540) % 360) - 180);
    assert.ok(dpa < 0.2, `pa ${r.paDeg} vs ${pa}`);
    assert.ok(Math.abs(Math.hypot(r.east, r.north) - r.arcsecPerHour) < 1e-9);
  }
  // due east means RA increases
  const east = apparentRate(makeEphemeris(sampled({ rateArcsecPerHour: 10, paDeg: 90, dec0: 0 })), 60890);
  assert.ok(east.east > 9.9 && Math.abs(east.north) < 0.1);
  // ends of the table and degenerate input
  const eph = makeEphemeris(sampled({}));
  assert.ok(Number.isFinite(apparentRate(eph, 60880).arcsecPerHour));
  assert.ok(Number.isFinite(apparentRate(eph, 60900).arcsecPerHour));
  assert.ok(Number.isNaN(apparentRate(makeEphemeris([[1, 2, 3]]), 1).arcsecPerHour));
  assert.ok(Number.isNaN(apparentRate(null, 1).arcsecPerHour));
});

test('exposureSmear: Pluto does not trail, a near comet does', () => {
  const pluto = exposureSmear(3.1);
  assert.ok(Math.abs(pluto.arcsec - (3.1 * EXPOSURE_SECONDS) / 3600) < 1e-12);
  assert.ok(Math.abs(pluto.pixels - 0.0159) < 0.0005, `pixels ${pluto.pixels}`);
  assert.equal(pluto.trails, false);
  const comet = exposureSmear(150);
  assert.ok(comet.pixels > 0.7 && comet.pixels < 0.8);
  assert.equal(comet.trails, true);
  assert.equal(exposureSmear(-150).trails, true);
  assert.ok(Number.isNaN(exposureSmear(NaN).pixels));
  assert.equal(exposureSmear(100, 3600).arcsec, 100);
  assert.equal(PIXEL_ARCSEC, 6.15);
});

test('splitVisits splits on gaps over 20 days and sorts', () => {
  const items = [60900, 60890, 60891, 60915, 61070, 61071.5, 61250].map((mjd) => ({ mjd }));
  const visits = splitVisits(items);
  assert.deepEqual(visits.map((v) => v.map((f) => f.mjd)), [[60890, 60891, 60900, 60915], [61070, 61071.5], [61250]]);
  // 15-day gap stays together at the default, splits with a tighter gap
  assert.equal(splitVisits(items, 10).length, 4);
  assert.deepEqual(splitVisits([]), []);
  assert.deepEqual(splitVisits(null), []);
});

test('attachPositions uses the ephemeris inside the table and the proxy position outside', () => {
  const eph = makeEphemeris(sampled({}));
  const { frames, dropped } = attachPositions([
    { id: 'b', det: 2, mjd: 60891.2, ra: 1, dec: 1 },
    { id: 'a', det: 1, mjd: 60885.7 },
    { id: 'c', det: 3, mjd: 61000, ra: 300, dec: -20 },   // outside the table: proxy position kept
    { id: 'd', det: 4, mjd: 61001 },                      // outside and no position: dropped
    { id: 'e', det: 5 },
    null,
  ], eph);
  assert.equal(dropped, 3);
  assert.deepEqual(frames.map((f) => f.id), ['a', 'b', 'c']);
  const t = truth(60891.2, {});
  assert.ok(angSep(frames[1].ra, frames[1].dec, t.ra, t.dec) * 3600 < 0.01);
  assert.ok(frames[1].delta > 34.3);
  assert.equal(frames[2].ra, 300);
  assert.ok(Number.isNaN(frames[2].delta));
});

function plutoLikeCase() {
  // Three visits, six months apart, 3.1 arcsec/hour.
  const eph = makeEphemeris(sampled({}, { start: 60880, end: 61260, stepHours: 12 }));
  const frames = [];
  const visits = [[60895, 70], [61075, 72], [61255, 70]];
  let k = 0;
  for (const [start, n] of visits) {
    for (let i = 0; i < n; i++) frames.push({ id: `f${k++}`, det: 1 + (i % 6), mjd: start + i * 0.02 });
  }
  return { eph, frames: attachPositions(frames, eph).frames };
}

test('summarizeTrack counts per detector and per visit', () => {
  const { eph, frames } = plutoLikeCase();
  const s = summarizeTrack(eph, frames);
  assert.equal(s.total, 212);
  assert.equal(s.visits.length, 3);
  assert.deepEqual(s.visits.map((v) => v.n), [70, 72, 70]);
  assert.deepEqual(s.visits.map((v) => v.label), ['Aug 2025', 'Feb 2026', 'Aug 2026']);
  assert.equal(Object.values(s.perDet).reduce((a, b) => a + b, 0), 212);
  assert.deepEqual(s.visits[1].perDet, { 1: 12, 2: 12, 3: 12, 4: 12, 5: 12, 6: 12 });
  assert.ok(Math.abs(s.arcsecPerHour - 3.1) < 0.02, `rate ${s.arcsecPerHour}`);
  assert.ok(Math.abs(s.smearPixels - 0.016) < 0.001);
  assert.equal(s.trails, false);
  assert.ok(Math.abs(s.medianMag - 14.4) < 1e-9);
  assert.ok(s.medianDelta > 34.3 && s.medianDelta < 34.7);
  assert.ok(s.visits[0].mjdStart === 60895 && s.visits[0].mjdEnd > 60896);
  const t = truth(s.visits[0].mjdMid, {});
  assert.ok(angSep(s.visits[0].ra, s.visits[0].dec, t.ra, t.dec) * 3600 < 0.01);
  assert.ok(Math.abs(s.visits[0].paDeg - 255) < 0.5);
});

test('summarizeTrack with nothing', () => {
  const s = summarizeTrack(makeEphemeris(sampled({})), []);
  assert.equal(s.total, 0);
  assert.deepEqual(s.visits, []);
  assert.ok(Number.isNaN(s.arcsecPerHour));
  assert.equal(s.trails, false);
  assert.equal(summarizeTrack(null, null).total, 0);
});

test('planSentence reads like the brief', () => {
  const { eph, frames } = plutoLikeCase();
  const text = planSentence('Pluto', summarizeTrack(eph, frames));
  assert.equal(
    text,
    'Pluto was inside 212 exposures across 3 visits: Aug 2025, Feb 2026, Aug 2026. It moved 3.1 arcsec per hour, 0.02 pixel during one exposure.',
  );
  assert.equal(planSentence('Sedna', summarizeTrack(eph, [])), 'No SPHEREx exposure contained Sedna.');
  assert.equal(planSentence('', null), 'No SPHEREx exposure contained this body.');
  const one = planSentence('Ceres', summarizeTrack(eph, frames.slice(0, 1)));
  assert.match(one, /^Ceres was inside 1 exposure in 1 visit: Aug 2025\./);
  assert.ok(!/!/.test(text));
});

test('planSentence warns when the body trails', () => {
  const eph = makeEphemeris(sampled({ rateArcsecPerHour: 150, paDeg: 280 }));
  const frames = attachPositions([{ id: 'a', det: 1, mjd: 60890 }, { id: 'b', det: 2, mjd: 60890.1 }], eph).frames;
  const s = summarizeTrack(eph, frames);
  assert.equal(s.trails, true);
  const text = planSentence('3I/ATLAS', s);
  assert.match(text, /It moved 150 arcsec per hour, 0\.77 pixel during one exposure\./);
  assert.match(text, /enough to trail/);
});

test('trackSamples rounds, thins and keeps both ends', () => {
  const eph = makeEphemeris(sampled({}, { start: 60770, end: 61370, stepHours: 12 }));
  const all = trackSamples(eph);
  assert.equal(all.length, eph.n);
  assert.equal(all[0].length, 3);
  assert.equal(all[0][0], 60770);
  const thin = trackSamples(eph, { max: 100 });
  assert.ok(thin.length <= 102 && thin.length >= 50, `length ${thin.length}`);
  assert.equal(thin[0][0], 60770);
  assert.equal(thin[thin.length - 1][0], 61370);
  for (let i = 1; i < thin.length; i++) assert.ok(thin[i][0] > thin[i - 1][0]);
  assert.ok(JSON.stringify(thin).length < 100 * 40);
  assert.deepEqual(trackSamples(makeEphemeris([])), []);
});

test('skyPath unwraps RA and reports extents; pathPointAt lands on the path', () => {
  const eph = makeEphemeris([[60000, 358, 10], [60010, 359.5, 10.5], [60020, 1, 11], [60030, 2.5, 11.5]]);
  const path = skyPath(eph);
  assert.equal(path.points.length, 4);
  // x grows with RA, monotonic through the wrap
  for (let i = 1; i < 4; i++) assert.ok(path.points[i].x > path.points[i - 1].x);
  assert.ok(path.xMax - path.xMin < 5, 'no 360-degree tear');
  assert.ok(Math.abs(path.xMax + path.xMin) < 1e-9, 'centred');
  assert.equal(path.yMin, 10);
  assert.equal(path.yMax, 11.5);
  const p = pathPointAt(eph, path, 60020);
  assert.ok(Math.abs(p.x - path.points[2].x) < 1e-9);
  assert.ok(Math.abs(p.y - 11) < 1e-9);
  // thinning keeps the last point
  const long = skyPath(makeEphemeris(sampled({}, { start: 60770, end: 61370 })), { maxPoints: 50 });
  assert.ok(long.points.length <= 52);
  assert.equal(long.points[long.points.length - 1].mjd, 61370);
  assert.deepEqual(skyPath(makeEphemeris([])).points, []);
});

test('labels', () => {
  assert.equal(monthLabel(60888), 'Aug 2025');
  assert.equal(dayLabel(60888), '2025 Aug 1');
  assert.equal(dateRangeLabel(60888, 60888.4), '2025 Aug 1');
  assert.equal(dateRangeLabel(60888, 60899), '2025 Aug 1 to 12');
  assert.equal(dateRangeLabel(60888, 60925), '2025 Aug 1 to Sep 7');
  assert.equal(dateRangeLabel(60888, 61075), '2025 Aug 1 to 2026 Feb 4');
  assert.equal(monthLabel(NaN), '');
  assert.equal(medianOf([3, NaN, 1, 2]), 2);
  assert.equal(medianOf([4, 1, 2, 3]), 2.5);
  assert.ok(Number.isNaN(medianOf([])));
});

test('works with a locally computed track for a hypothetical body', () => {
  // core/distance.js: a body 500 AU away seen from the moving Earth traces a parallax loop.
  const mjds = [];
  for (let mjd = 60770; mjd <= 61370; mjd += 2) mjds.push(mjd);
  const track = predictedTrack(120, 15, 500, mjds);
  const eph = makeEphemeris(track);
  assert.equal(eph.n, mjds.length);
  assert.ok(eph.delta[0] > 498 && eph.delta[0] < 502);
  // parallax of 1 AU at 500 AU is 412 arcsec; over a year the body moves about twice that
  let far = 0;
  for (let i = 0; i < eph.n; i++) far = Math.max(far, angSep(eph.ra[i], eph.dec[i], 120, 15) * 3600);
  assert.ok(far > 300 && far < 500, `loop radius ${far}`);
  // interpolation between 2-day samples against the exact model
  const exact = predictedTrack(120, 15, 500, [60901.3])[0];
  const p = positionAt(eph, 60901.3);
  assert.ok(angSep(p.ra, p.dec, exact.ra, exact.dec) * 3600 < 0.01);
  const r = apparentRate(eph, 60901.3);
  assert.ok(r.arcsecPerHour > 0.01 && r.arcsecPerHour < 0.5, `rate ${r.arcsecPerHour}`);
});
