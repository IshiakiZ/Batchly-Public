// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// Check 6, Node half: where the Earth is, where a star is at a date, what parallax does, and
// the time helpers. Runs web/src/core/ephemeris.js (earthPosition, parallaxOffset),
// astrometry.js (propagate), targets.js (TARGETS) and time.js on fixed inputs -> c6_ephem.json.

import { earthPosition, parallaxOffset } from '../../web/src/core/ephemeris.js';
import { propagate } from '../../web/src/core/astrometry.js';
import { TARGETS } from '../../web/src/core/targets.js';
import { mjdToYear, yearToMjd, mjdToIso, isoToMjd, mjdToDate } from '../../web/src/core/time.js';
import { writeJson, linspace, log } from './lib.mjs';

// 200 dates from 2025-01-01 (MJD 60676) to 2027-12-31 (MJD 61770), not on round numbers.
const mjds = linspace(60676.13, 61770.87, 200);
const out = { mjds };

out.earth = mjds.map((m) => earthPosition(m));

// ---- propagate ------------------------------------------------------------------------------------

const barnard = TARGETS.find((t) => t.id === 'barnard');
const star = { ra: barnard.ra, dec: barnard.dec, pmra: barnard.pmra, pmdec: barnard.pmdec, parallax: barnard.parallax, epoch: barnard.epoch };
const RV = -110.6; // km/s, Barnard's Star; only used in the rows that say so
out.barnard = {
  star,
  rv: RV,
  epochs: [2016.0, 2026.5].map((year) => {
    const mjd = yearToMjd(year);
    return {
      year,
      mjd,
      // rv absent (= 0), annual parallax off: the barycentric direction
      noRv: propagate(star, mjd, { parallax: false }),
      // rv given: perspective acceleration included
      withRv: propagate({ ...star, rv: RV }, mjd, { parallax: false }),
    };
  }),
  // annual parallax on (default), rv absent, on the 200 dates
  apparent: mjds.map((m) => propagate(star, m)),
  barycentric: mjds.map((m) => propagate(star, m, { parallax: false })),
};

// Every target with a proper motion, to 2026.5, parallax off, rv absent.
out.targets = TARGETS.filter((t) => t.pmra || t.pmdec).map((t) => {
  const s = { ra: t.ra, dec: t.dec, pmra: t.pmra, pmdec: t.pmdec, parallax: t.parallax, epoch: t.epoch };
  return { id: t.id, star: s, at: 2026.5, result: propagate(s, yearToMjd(2026.5), { parallax: false }) };
});

// ---- parallaxOffset -------------------------------------------------------------------------------

const bodies = [
  { ra: 269.452075, dec: 4.693391, dist: 500 },   // towards Barnard's Star
  { ra: 270.0, dec: 66.5607, dist: 500 },         // north ecliptic pole: a circle
  { ra: 0.001, dec: -0.5, dist: 500 },            // straddles RA = 0
  { ra: 45.0, dec: -80.0, dist: 500 },            // far south, large cos(dec) factor
  { ra: 123.4, dec: 20.0, dist: 30 },             // Neptune's distance: the shift is degrees
  { ra: 200.0, dec: -10.0, dist: 100000 },        // Oort-cloud distance
];
out.parallax = bodies.map((b) => ({
  ...b,
  results: mjds.map((m) => {
    const r = parallaxOffset(b.ra, b.dec, b.dist, m);
    return [r.dra_arcsec, r.ddec_arcsec, r.ra, r.dec, r.distGeoAU];
  }),
}));

// ---- time -----------------------------------------------------------------------------------------

const isoStrings = ['2026-06-19T19:01:07.407', '2025-05-01T00:00:00', '2000-01-01T12:00:00', '2016-01-01T12:00:00', '2027-12-31T23:59:59.999', '2024-02-29T06:30:00', '2025-06-10'];
out.time = {
  years: mjds.map((m) => mjdToYear(m)),
  backToMjd: mjds.map((m) => yearToMjd(mjdToYear(m))),
  iso: mjds.map((m) => mjdToIso(m)),
  date: mjds.map((m) => mjdToDate(m).toISOString()),
  isoStrings,
  isoMjd: isoStrings.map((s) => isoToMjd(s)),
  epochs: [2000.0, 2016.0, 2026.5].map((y) => ({ year: y, mjd: yearToMjd(y) })),
};

writeJson('c6_ephem.json', out);
log(`check 6: ${mjds.length} dates, ${out.targets.length} targets with proper motion, ${bodies.length} bodies`);
