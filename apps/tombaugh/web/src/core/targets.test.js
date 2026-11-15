// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

import test from 'node:test';
import assert from 'node:assert/strict';
import { TARGETS, CHALLENGE_TARGET_IDS, positionNow, findTarget, motionSummary } from './targets.js';
import { mjdFromYear, separationArcsec, positionAngle } from './astrometry.js';

const byId = (id) => TARGETS.find((t) => t.id === id);

test('TARGETS: the five challenge targets come first and every entry is well formed', () => {
  assert.deepEqual(CHALLENGE_TARGET_IDS, ['barnard', 'eps-indi-b', 'wise0855', 'rw-aur', 'r-dra']);
  assert.deepEqual(TARGETS.slice(0, 5).map((t) => t.id), CHALLENGE_TARGET_IDS);
  assert.ok(TARGETS.length >= 8);
  const ids = new Set();
  for (const t of TARGETS) {
    assert.ok(!ids.has(t.id), `duplicate id ${t.id}`);
    ids.add(t.id);
    assert.match(t.id, /^[a-z0-9-]+$/);
    assert.ok(typeof t.name === 'string' && t.name.length > 0);
    assert.ok(t.ra >= 0 && t.ra < 360, `${t.id} ra`);
    assert.ok(t.dec >= -90 && t.dec <= 90, `${t.id} dec`);
    assert.ok(t.epoch >= 1990 && t.epoch <= 2030, `${t.id} epoch`);
    for (const k of ['pmra', 'pmdec', 'parallax']) assert.ok(Number.isFinite(t[k]), `${t.id} ${k}`);
    assert.ok(t.parallax >= 0);
    assert.ok(Number.isInteger(t.det) && t.det >= 1 && t.det <= 6, `${t.id} det`);
    assert.ok([2, 4, 6, 10].includes(t.fov), `${t.id} fov`);
    assert.ok(typeof t.blurb === 'string' && t.blurb.length > 20 && !t.blurb.includes('\n'));
    assert.ok(typeof t.why === 'string' && t.why.length > 20 && !t.why.includes('\n'));
    // direct voice: no exclamation marks, no hype words
    assert.doesNotMatch(`${t.blurb} ${t.why}`, /!|amazing|incredible|stunning|revolution|unlock|breathtaking|mind-blowing/i);
    assert.equal(typeof t.challenge, 'boolean');
    assert.ok(typeof t.kind === 'string');
  }
});

test('TARGETS: values match the brief', () => {
  const b = byId('barnard');
  assert.deepEqual([b.ra, b.dec, b.epoch, b.pmra, b.pmdec, b.parallax, b.det, b.fov],
    [269.452075, 4.693391, 2000.0, -802.8, 10362.5, 547.0, 3, 4]);
  const w = byId('wise0855');
  // 08h55m10.831s -07d14m42.53s
  assert.ok(Math.abs(w.ra - (8 + 55 / 60 + 10.831 / 3600) * 15) < 1e-6);
  assert.ok(Math.abs(w.dec - -(7 + 14 / 60 + 42.53 / 3600)) < 1e-6);
  assert.deepEqual([w.epoch, w.pmra, w.pmdec, w.parallax, w.det, w.fov], [2014.3, -8118, 680, 439, 6, 4]);
  const e = byId('eps-indi-b');
  assert.deepEqual([e.ra, e.dec, e.pmra, e.pmdec, e.parallax, e.det, e.fov], [331.0438, -56.7827, 3960.9, -2539.2, 274.8, 6, 6]);
  assert.deepEqual([byId('rw-aur').det, byId('rw-aur').fov, byId('r-dra').det, byId('r-dra').fov], [2, 4, 3, 4]);
  // the numbers quoted in the blurbs are the numbers in the table
  assert.ok(Math.abs(motionSummary(b).arcsecPerYr - 10.39) < 0.01);
  assert.ok(Math.abs(motionSummary(b).pixPerYr - 1.69) < 0.01);
  assert.ok(Math.abs(motionSummary(e).arcsecPerYr - 4.70) < 0.01);
  assert.ok(Math.abs(motionSummary(w).arcsecPerYr - 8.15) < 0.01);
  assert.ok(Math.abs(motionSummary(byId('proxima')).arcsecPerYr - 3.86) < 0.01);
  assert.ok(Math.abs(motionSummary(byId('luhman16')).arcsecPerYr - 2.78) < 0.01);
  assert.ok(Math.abs(motionSummary(byId('teegarden')).arcsecPerYr - 5.12) < 0.01);
  assert.ok(Math.abs(motionSummary(byId('teegarden')).paDeg - 138) < 1, 'south-east');
  assert.equal(motionSummary(byId('m101')).arcsecPerYr, 0);
});

test('positionNow uses propagate: movers move, the galaxy does not', () => {
  const mjd = mjdFromYear(2026.5);
  const b = byId('barnard');
  const p = positionNow(b, mjd, { parallax: false });
  assert.ok(Math.abs((p.dec - b.dec) * 3600 - 274.6) < 0.1);
  assert.ok(Math.abs(separationArcsec(b.ra, b.dec, p.ra, p.dec) - 10.3935 * 26.5) < 0.1);
  // default includes parallax: within 0.56 arcsec of the parallax-free position
  const pp = positionNow(b, mjd);
  const shift = separationArcsec(p.ra, p.dec, pp.ra, pp.dec);
  assert.ok(shift > 0.01 && shift < 0.56, `parallax shift ${shift}`);
  // WISE 0855 from 2014.3 to 2026.5: 12.2 yr at 8.146 arcsec/yr = 99.4 arcsec, nearly due west
  const w = byId('wise0855');
  const pw = positionNow(w, mjd, { parallax: false });
  assert.ok(Math.abs(separationArcsec(w.ra, w.dec, pw.ra, pw.dec) - 99.4) < 0.2);
  const pa = positionAngle(w.ra, w.dec, pw.ra, pw.dec);
  assert.ok(Math.abs(pa - 274.8) < 0.5, `PA ${pa}`);
  assert.ok(pw.ra < w.ra, 'west is decreasing RA');
  // at its own epoch a target is where the table says
  const at = positionNow(w, mjdFromYear(2014.3), { parallax: false });
  assert.ok(separationArcsec(w.ra, w.dec, at.ra, at.dec) < 1e-6);
  // M101 and R Dra stay put
  for (const id of ['m101', 'r-dra']) {
    const t = byId(id);
    const q = positionNow(t, mjd);
    assert.ok(separationArcsec(t.ra, t.dec, q.ra, q.dec) < 1e-6, id);
  }
  // every target gives a finite position
  for (const t of TARGETS) {
    const q = positionNow(t, mjd);
    assert.ok(Number.isFinite(q.ra) && Number.isFinite(q.dec), t.id);
    // nothing in the list moves more than 5 arcmin from its catalogue position
    assert.ok(separationArcsec(t.ra, t.dec, q.ra, q.dec) < 300, t.id);
  }
});

test('findTarget: ids, names, aliases, sloppy typing', () => {
  const cases = {
    barnard: ['barnard', "Barnard's Star", 'barnards star', 'BARNARD', 'GJ 699', 'gj699', 'Barnads Star', 'barnard star'],
    'eps-indi-b': ['eps-indi-b', 'Epsilon Indi Ba,Bb', 'eps indi b', 'Epsilon Indi B', 'ε Indi B', 'eps indi', 'epsilon indi bab'],
    wise0855: ['wise0855', 'WISE 0855-0714', 'WISE 0855', 'wise j0855-0714', 'W0855'],
    'rw-aur': ['rw-aur', 'RW Aurigae', 'RW Aur', 'rw aurigea'],
    'r-dra': ['r-dra', 'R Draconis', 'R Dra', 'r draconis'],
    proxima: ['proxima', 'Proxima Centauri', 'proxima cen', 'proxma centauri', 'Alpha Centauri C'],
    luhman16: ['luhman16', 'Luhman 16', 'Luhman 16AB', 'WISE J1049-5319', 'luhmann 16'],
    teegarden: ['teegarden', "Teegarden's Star", 'teegardens star', 'tegarden'],
    m101: ['m101', 'M 101', 'Messier 101', 'pinwheel', 'Pinwheel Galaxy', 'NGC 5457'],
  };
  for (const [id, names] of Object.entries(cases)) {
    for (const name of names) {
      const t = findTarget(name);
      assert.ok(t, `"${name}" not found`);
      assert.equal(t.id, id, `"${name}" resolved to ${t.id}`);
    }
  }
  // things that are not in the list, including near-misses that are different objects
  for (const name of ['', ' ', 'a', 'Vega', 'M31', 'M 100', 'WISE 0856', 'Epsilon Indi A', 'Luhman 17', 'R Leo', '269.45 4.69', null, undefined, 42]) {
    assert.equal(findTarget(name), null, `"${name}" should not match`);
  }
});
