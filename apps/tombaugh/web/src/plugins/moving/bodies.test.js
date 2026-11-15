// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BODIES,
  CATALOGUE,
  HYPOTHETICAL,
  bodyQuery,
  eclipticPrograde,
  findBody,
  hypotheticalEphemeris,
  kindLabel,
} from './bodies.js';
import { makeEphemeris, positionAt, apparentRate } from './track.js';
import { angSep } from '../../core/wcs.js';
import { keplerRate } from '../../core/distance.js';
import { horizonsCommand, validateBody } from '../../../../proxy/src/horizons.js';

test('every catalogue entry is complete and written in the team voice', () => {
  const ids = new Set();
  const kinds = new Set(['dwarf planet', 'asteroid', 'comet', 'interstellar comet', 'centaur', 'hypothetical']);
  for (const b of CATALOGUE) {
    assert.ok(b.id && !ids.has(b.id), `unique id ${b.id}`);
    ids.add(b.id);
    assert.ok(b.name && b.name.length <= 20, b.id);
    assert.ok(kinds.has(b.kind), `${b.id} kind ${b.kind}`);
    assert.notEqual(kindLabel(b.kind), 'Solar-system body');
    assert.ok(b.stepHours > 0);
    for (const text of [b.blurb, b.lookFor]) {
      assert.ok(typeof text === 'string' && text.length > 20 && text.length < 220, `${b.id}: ${text}`);
      assert.ok(!text.includes('!'), `${b.id}: no exclamation marks`);
      assert.ok(!/\b(amazing|incredible|stunning|revolutionary|unprecedented|breathtaking|awesome|spectacular|best|greatest)\b/i.test(text), `${b.id}: no hype`);
      assert.ok(/[.]$/.test(text), `${b.id}: ends with a full stop`);
    }
    assert.ok(Array.isArray(b.bands));
    for (const band of b.bands) {
      assert.ok(band.wave >= 0.75 && band.wave <= 5.0, `${b.id} band ${band.wave} inside the SPHEREx range`);
      assert.ok(band.label && band.what);
    }
  }
  assert.ok(BODIES.length >= 13);
  assert.equal(CATALOGUE[CATALOGUE.length - 1], HYPOTHETICAL);
  assert.equal(HYPOTHETICAL.command, null);
});

test('catalogue commands are exactly what the proxy would send to Horizons', () => {
  for (const b of BODIES) {
    assert.equal(validateBody(b.command), b.command, `${b.id}: the command passes the proxy's validation`);
    assert.equal(horizonsCommand(b.command), b.command, `${b.id}: the command is passed through unchanged`);
    assert.equal(horizonsCommand(b.name), b.command, `${b.id}: the friendly name maps to the same command`);
  }
  const byId = Object.fromEntries(BODIES.map((b) => [b.id, b.command]));
  assert.equal(byId.pluto, '999');
  assert.equal(byId.eris, '136199;');
  assert.equal(byId.makemake, '136472;');
  assert.equal(byId.haumea, '136108;');
  assert.equal(byId.gonggong, '225088;');
  assert.equal(byId.quaoar, '50000;');
  assert.equal(byId.orcus, '90482;');
  assert.equal(byId.vesta, '4;');
  assert.equal(byId.pallas, '2;');
  assert.equal(byId.hygiea, '10;');
  assert.equal(byId.chiron, '2060;');
  assert.equal(byId.atlas3i, 'DES=C/2025 N1;');
});

test('the bodies named in the brief say what to look for', () => {
  const get = (id) => BODIES.find((b) => b.id === id);
  assert.match(get('pluto').lookFor, /[Mm]ethane ice/);
  assert.deepEqual(get('pluto').bands.map((b) => b.wave).filter((w) => w > 2), [2.3, 3.3]);
  assert.match(get('atlas3i').lookFor, /4\.27/);
  assert.equal(get('atlas3i').kind, 'interstellar comet');
  assert.equal(get('atlas3i').coma, true);
  assert.ok(get('atlas3i').bands.some((b) => b.wave === 4.27));
  assert.equal(get('ceres').bright, true);
  assert.match(get('ceres').blurb, /saturate/);
  assert.match(get('ceres').lookFor, /3 um hydration/);
  for (const id of ['eris', 'makemake']) {
    assert.equal(get(id).faint, true);
    assert.match(get(id).lookFor, /stack/);
    assert.match(get(id).lookFor, /[Mm]ethane/);
  }
  assert.match(get('sedna').lookFor, /too faint/);
  assert.match(get('sedna').lookFor, /limit/);
});

test('findBody and bodyQuery', () => {
  assert.equal(findBody('pluto').id, 'pluto');
  assert.equal(findBody('  PLUTO ').id, 'pluto');
  assert.equal(findBody('3I/ATLAS').id, 'atlas3i');
  assert.equal(findBody('3i').id, 'atlas3i');
  assert.equal(findBody('C/2025 N1').id, 'atlas3i');
  assert.equal(findBody('DES=C/2025 N1;').id, 'atlas3i');
  assert.equal(findBody('136199').id, 'eris');
  assert.equal(findBody('136199;').id, 'eris');
  assert.equal(findBody('999').id, 'pluto');
  assert.equal(findBody('4;').id, 'vesta');
  assert.equal(findBody('4'), null); // a major-body id for Horizons, not asteroid 4
  assert.equal(findBody('hypothetical body').id, 'hypothetical');
  assert.equal(findBody('Varuna'), null);
  assert.equal(findBody(''), null);
  assert.equal(findBody(null), null);

  assert.deepEqual(bodyQuery('Eris'), { body: '136199;', entry: findBody('eris') });
  assert.deepEqual(bodyQuery('  Varuna  '), { body: 'Varuna', entry: null });
  assert.deepEqual(bodyQuery('2003   VB12'), { body: '2003 VB12', entry: null });
  assert.equal(bodyQuery('Hypothetical body').entry.id, 'hypothetical');
});

test('eclipticPrograde points along the ecliptic', () => {
  // At the vernal equinox the ecliptic climbs to the north-east at the obliquity angle.
  const v = eclipticPrograde(0, 0);
  assert.ok(Math.abs(v.paDeg - (90 - 23.4393)) < 1e-3, `pa ${v.paDeg}`);
  assert.ok(Math.abs(Math.hypot(v.east, v.north) - 1) < 1e-12);
  // At the summer solstice point (RA 90, Dec +23.44) it runs due east.
  const s = eclipticPrograde(90, 23.4393);
  assert.ok(Math.abs(s.paDeg - 90) < 1e-3, `pa ${s.paDeg}`);
  // At the autumn equinox it descends to the south-east.
  const a = eclipticPrograde(180, 0);
  assert.ok(Math.abs(a.paDeg - (90 + 23.4393)) < 1e-3, `pa ${a.paDeg}`);
  // At the ecliptic pole there is no direction; it still returns a unit vector.
  const p = eclipticPrograde(270, 66.5607);
  assert.ok(Math.abs(Math.hypot(p.east, p.north) - 1) < 1e-9);
});

test('hypotheticalEphemeris has the /ephemeris shape and passes through the given position', () => {
  const out = hypotheticalEphemeris({ ra: 52.3, dec: 11.7, distAU: 500, refMjd: 61000, startMjd: 60770, endMjd: 61370 });
  assert.equal(out.body, 'hypothetical');
  assert.equal(out.hypothetical, true);
  assert.equal(out.center, 'geocentric');
  assert.match(out.source, /model/);
  assert.equal(out.name, 'Hypothetical body at 500 AU');
  assert.equal(out.samples.length, 601);
  assert.equal(out.samples[0][0], 60770);
  assert.equal(out.samples[600][0], 61370);
  for (const s of out.samples) {
    assert.equal(s.length, 5);
    assert.equal(s[4], null);
    assert.ok(s[3] > 498.9 && s[3] < 501.1, `delta ${s[3]}`);
  }
  const eph = makeEphemeris(out);
  const at = positionAt(eph, 61000);
  assert.ok(angSep(at.ra, at.dec, 52.3, 11.7) * 3600 < 0.02, 'appears where asked on the reference date');
  // The parallax loop: an ellipse 2 x 412 arcsec long (1 AU seen from 500 AU). Somewhere in the
  // year the body is a good part of that away from where it started.
  let moved = 0;
  for (let mjd = 61000; mjd < 61366; mjd += 3) {
    const p = positionAt(eph, mjd);
    moved = Math.max(moved, angSep(p.ra, p.dec, 52.3, 11.7) * 3600);
  }
  assert.ok(moved > 400 && moved < 830, `moved ${moved} arcsec`);
  // and a year later it is back (no drift)
  const year = positionAt(eph, 61365.25);
  assert.ok(angSep(year.ra, year.dec, 52.3, 11.7) * 3600 < 5, 'closes after one year');
  JSON.stringify(out);
});

test('hypotheticalEphemeris: circular-orbit drift adds the Kepler rate along the ecliptic', () => {
  const base = { ra: 52.3, dec: 11.7, distAU: 500, refMjd: 60770, startMjd: 60770, endMjd: 60770 + 365.25 * 1.5 };
  const still = makeEphemeris(hypotheticalEphemeris(base));
  const moving = hypotheticalEphemeris({ ...base, drift: 'circular' });
  const eph = makeEphemeris(moving);
  const rate = keplerRate(500);
  assert.ok(Math.abs(rate - 115.9) < 0.1);
  assert.ok(Math.abs(moving.params.driftArcsecPerYr - rate) < 1e-9);
  // After exactly one year the parallax cancels and only the drift is left.
  const a = positionAt(still, 60770 + 365.25);
  const b = positionAt(eph, 60770 + 365.25);
  const sep = angSep(a.ra, a.dec, b.ra, b.dec) * 3600;
  assert.ok(Math.abs(sep - rate) < 2, `drift after a year ${sep} vs ${rate}`);
  // explicit position angle and explicit rates
  const north = hypotheticalEphemeris({ ...base, drift: 'circular', driftPaDeg: 0 });
  assert.ok(Math.abs(north.params.drift.decRate_arcsecPerYr - rate) < 1e-9);
  assert.ok(Math.abs(north.params.drift.raRate_arcsecPerYr) < 1e-9);
  const custom = hypotheticalEphemeris({ ...base, drift: { raRate_arcsecPerYr: 30, decRate_arcsecPerYr: -40 } });
  assert.equal(custom.params.driftArcsecPerYr, 50);
});

test('hypotheticalEphemeris: a nearer body moves faster', () => {
  const far = makeEphemeris(hypotheticalEphemeris({ ra: 200, dec: -5, distAU: 800, startMjd: 60770, endMjd: 61135 }));
  const near = makeEphemeris(hypotheticalEphemeris({ ra: 200, dec: -5, distAU: 80, startMjd: 60770, endMjd: 61135 }));
  let maxFar = 0;
  let maxNear = 0;
  for (let mjd = 60780; mjd < 61130; mjd += 5) {
    maxFar = Math.max(maxFar, apparentRate(far, mjd).arcsecPerHour);
    maxNear = Math.max(maxNear, apparentRate(near, mjd).arcsecPerHour);
  }
  assert.ok(maxNear > 8 * maxFar, `near ${maxNear} far ${maxFar}`);
  assert.ok(maxNear < 6, `an 80 AU body moves a few arcsec per hour at most (${maxNear})`);
});

test('hypotheticalEphemeris rejects unusable input with a readable message', () => {
  const ok = { ra: 10, dec: 10, distAU: 100, startMjd: 60770, endMjd: 60800 };
  for (const bad of [{ ra: NaN }, { dec: 95 }, { distAU: 1 }, { distAU: -5 }, { distAU: Infinity }, { endMjd: 60000 }]) {
    assert.throws(() => hypotheticalEphemeris({ ...ok, ...bad }), RangeError, JSON.stringify(bad));
  }
  assert.throws(() => hypotheticalEphemeris(), RangeError);
  // defaults: from the start of the survey to now
  const out = hypotheticalEphemeris({ ra: 10, dec: 10, distAU: 100, now: Date.UTC(2026, 10, 15) });
  assert.equal(out.samples[0][0], 60770);
  assert.ok(Math.abs(out.samples[out.samples.length - 1][0] - 61359) < 1e-6);
  assert.equal(out.name, 'Hypothetical body at 100 AU');
  assert.equal(hypotheticalEphemeris({ ...ok, distAU: 42.57 }).name, 'Hypothetical body at 42.6 AU');
});
