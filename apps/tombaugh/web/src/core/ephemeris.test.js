// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  earthPosition, earthEclipticOfDate, earthEclipticJ2000, parallaxOffset, parallaxFactors,
  sunElongation, earthBaselineBetween, OBLIQUITY_J2000_DEG, ARCSEC_PER_RAD,
} from './ephemeris.js';

const DEG = Math.PI / 180;
const norm = (v) => Math.hypot(v[0], v[1], v[2]);
const wrap180 = (a) => ((((a + 180) % 360) + 360) % 360) - 180;

/** MJD (UTC) of a calendar date; Date.UTC ignores leap seconds exactly as MJD UTC does. */
function mjdOf(y, m, d, h = 0, min = 0) {
  return Date.UTC(y, m - 1, d, h, min) / 86400000 + 40587;
}

// ---- Independent reference: Kepler orbit of the Earth-Moon barycentre -------------------------
// E. M. Standish (JPL), "Keplerian Elements for Approximate Positions of the Major Planets",
// Table 1 (valid 1800-2050), mean ecliptic and equinox of J2000. Stated accuracy for the EM
// barycentre is about 20 arcsec (1e-4 AU); the Earth itself is up to 3.1e-5 AU from the
// barycentre. This shares no code and no coefficients with ephemeris.js.
function keplerEarth(mjd) {
  const T = (mjd + 69.184 / 86400 - 51544.5) / 36525;
  const a = 1.00000261 + 0.00000562 * T;
  const e = 0.01671123 - 0.00004392 * T;
  const I = (-0.00001531 - 0.01294668 * T) * DEG;
  const L = (100.46457166 + 35999.37244981 * T) * DEG;
  const peri = (102.93768193 + 0.32327364 * T) * DEG;
  const node = 0;
  const w = peri - node;
  let M = (L - peri) % (2 * Math.PI);
  let Ecc = M + e * Math.sin(M);
  for (let i = 0; i < 12; i++) Ecc -= (Ecc - e * Math.sin(Ecc) - M) / (1 - e * Math.cos(Ecc));
  const xp = a * (Math.cos(Ecc) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(Ecc);
  const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(node), sO = Math.sin(node);
  const cI = Math.cos(I), sI = Math.sin(I);
  const xe = (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp;
  const ye = (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp;
  const ze = sw * sI * xp + cw * sI * yp;
  const eps = 23.43928 * DEG;
  return [xe, ye * Math.cos(eps) - ze * Math.sin(eps), ye * Math.sin(eps) + ze * Math.cos(eps)];
}

test('VSOP series reproduces Meeus example 25.b (1992 Oct 13.0 TD)', () => {
  // Meeus, Astronomical Algorithms 2nd ed., example 25.b, complete VSOP87:
  // L = 19.907372 deg, B = -0.000179 deg, R = 0.99760775 AU at JDE 2448908.5.
  const e = earthEclipticOfDate(2448908.5);
  const dLarcsec = wrap180(e.lon - 19.907372) * 3600;
  const dBarcsec = (e.lat - -0.000179) * 3600;
  assert.ok(Math.abs(dLarcsec) < 1.0, `longitude off by ${dLarcsec} arcsec`);
  assert.ok(Math.abs(dBarcsec) < 0.3, `latitude off by ${dBarcsec} arcsec`);
  assert.ok(Math.abs(e.r - 0.99760775) < 5e-7, `radius off by ${e.r - 0.99760775} AU`);
});

test('Sun of date agrees with the Astronomical Almanac low-precision formulae', () => {
  // Astronomical Almanac, section C, "Low precision formulas for the Sun" (0.01 deg, 1950-2050):
  // n = JD - 2451545.0; L = 280.460 + 0.9856474 n; g = 357.528 + 0.9856003 n;
  // lambda = L + 1.915 sin g + 0.020 sin 2g;  R = 1.00014 - 0.01671 cos g - 0.00014 cos 2g.
  for (const jd of [2451545.0, 2455000.5, 2457389.0, 2460800.5, 2461000.5, 2461200.5, 2461400.5]) {
    const n = jd - 2451545.0;
    const g = (357.528 + 0.9856003 * n) * DEG;
    const lam = 280.460 + 0.9856474 * n + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g);
    const R = 1.00014 - 0.01671 * Math.cos(g) - 0.00014 * Math.cos(2 * g);
    const e = earthEclipticOfDate(jd);
    assert.ok(Math.abs(wrap180(e.lon + 180 - lam)) < 0.02, `jd ${jd}: Sun longitude differs`);
    assert.ok(Math.abs(e.r - R) < 3e-4, `jd ${jd}: radius differs`);
  }
});

test('Earth-Sun distance: 0.9833 AU at perihelion (early January), 1.0167 AU at aphelion (early July)', () => {
  // 2026 perihelion Jan 3 about 17h UTC, aphelion Jul 6 about 17h UTC.
  const peri = norm(earthPosition(mjdOf(2026, 1, 3, 17)));
  const aph = norm(earthPosition(mjdOf(2026, 7, 6, 17)));
  assert.ok(Math.abs(peri - 0.9833) < 1e-4, `perihelion distance ${peri}`);
  assert.ok(Math.abs(aph - 1.0167) < 1e-4, `aphelion distance ${aph}`);

  // The extremes of the year fall on those dates (within 1.5 days; the Moon shifts them).
  let minR = Infinity, minMjd = 0, maxR = 0, maxMjd = 0;
  for (let mjd = mjdOf(2025, 12, 1); mjd < mjdOf(2026, 12, 1); mjd += 0.05) {
    const r = norm(earthPosition(mjd));
    if (r < minR) { minR = r; minMjd = mjd; }
    if (r > maxR) { maxR = r; maxMjd = mjd; }
  }
  assert.ok(Math.abs(minMjd - mjdOf(2026, 1, 3, 17)) < 1.5, `perihelion found at MJD ${minMjd}`);
  assert.ok(Math.abs(maxMjd - mjdOf(2026, 7, 6, 17)) < 1.5, `aphelion found at MJD ${maxMjd}`);
  assert.ok(minR > 0.98325 && minR < 0.98335);
  assert.ok(maxR > 1.01660 && maxR < 1.01675);
});

test('Sun direction at the March equinox is RA 0h, Dec 0', () => {
  // 2000 March 20, 07:35 UTC. Close to J2000, so precession (11 arcsec), aberration (20 arcsec)
  // and nutation (17 arcsec) all fit inside a 0.02 deg tolerance.
  const E = earthPosition(mjdOf(2000, 3, 20, 7, 35));
  const ra = Math.atan2(-E[1], -E[0]) / DEG;
  const dec = Math.asin(-E[2] / norm(E)) / DEG;
  assert.ok(Math.abs(wrap180(ra)) < 0.02, `Sun RA ${ra}`);
  assert.ok(Math.abs(dec) < 0.02, `Sun Dec ${dec}`);
});

test('J2000 frame: by the 2026 equinox precession has carried the equinox 0.366 deg', () => {
  // 2026 March 20, 14:46 UTC: the apparent Sun is at longitude 0 OF DATE. In the fixed J2000
  // frame the geometric Sun is then at -(general precession over 26.22 yr at 50.29 arcsec/yr)
  // + 20.5 arcsec of aberration = 359.639 deg, give or take nutation (under 0.005 deg).
  // This catches a precession applied with the wrong sign (which would give 0.37 or 0.73 deg off).
  const mjd = mjdOf(2026, 3, 20, 14, 46);
  const e = earthEclipticJ2000(mjd);
  const sunLon = (e.lon + 180) % 360;
  const years = (mjd - 51544.5) / 365.25;
  const expected = 360 - (years * 50.29) / 3600 + 20.5 / 3600;
  assert.ok(Math.abs(wrap180(sunLon - expected)) < 0.012, `Sun J2000 longitude ${sunLon}, expected ${expected}`);
  // and the equatorial vector is consistent with that longitude
  const E = earthPosition(mjd);
  const eps = OBLIQUITY_J2000_DEG * DEG;
  const ye = E[1] * Math.cos(eps) + E[2] * Math.sin(eps);
  const lonFromVec = (Math.atan2(-ye, -E[0]) / DEG + 360) % 360;
  assert.ok(Math.abs(wrap180(lonFromVec - sunLon)) < 1e-9);
});

test('ecliptic of date tilts the right way against the J2000 ecliptic', () => {
  // The JPL elements give the orbit an inclination I = -0.01294668 deg per century with node 0:
  // heliocentric latitude = asin(sin I sin lon). Around 2026 that is about -12.5 arcsec at
  // longitude 90 and +12.5 arcsec at 270. A sign error in the precession would flip it.
  for (const mjd of [mjdOf(2026, 12, 21), mjdOf(2026, 6, 21), mjdOf(2025, 9, 1), mjdOf(2027, 2, 10)]) {
    const e = earthEclipticJ2000(mjd);
    const T = (mjd - 51544.5) / 36525;
    const I = (-0.00001531 - 0.01294668 * T) * DEG;
    const expectArcsec = Math.asin(Math.sin(I) * Math.sin(e.lon * DEG)) / DEG * 3600;
    assert.ok(Math.abs(e.lat * 3600 - expectArcsec) < 2.5,
      `latitude ${e.lat * 3600} arcsec, Kepler says ${expectArcsec}`);
  }
});

test('earthPosition agrees with an independent Kepler orbit (JPL elements)', () => {
  let worst = 0;
  const dates = [];
  for (let y = 1995; y <= 2035; y += 1) for (const m of [1, 4, 7, 10]) dates.push(mjdOf(y, m, 11, 6));
  for (let mjd = mjdOf(2025, 5, 1); mjd < mjdOf(2027, 6, 1); mjd += 9.37) dates.push(mjd);
  for (const mjd of dates) {
    const a = earthPosition(mjd), b = keplerEarth(mjd);
    const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    if (d > worst) worst = d;
    assert.ok(d < 2.5e-4, `MJD ${mjd}: differs from Kepler by ${d} AU`);
    assert.ok(Math.abs(norm(a) - norm(b)) < 1.2e-4, `MJD ${mjd}: radius differs`);
  }
  // Not an accuracy claim for ephemeris.js: this is the accuracy of the Kepler reference.
  assert.ok(worst > 0);
});

test('known vector: J2000.0 itself', () => {
  // Heliocentric Earth at JD 2451545.0 TT is about (-0.17713, +0.88743, +0.38474) AU (JPL
  // Horizons, ICRF; five figures quoted from memory, hence the loose 2e-4 AU tolerance).
  const E = earthPosition(51544.5 - 69.184 / 86400 + 5 / 86400); // TT-UTC was 64.184 s in 2000
  assert.ok(Math.abs(E[0] - -0.17713) < 2e-4, `x ${E[0]}`);
  assert.ok(Math.abs(E[1] - 0.88743) < 2e-4, `y ${E[1]}`);
  assert.ok(Math.abs(E[2] - 0.38474) < 2e-4, `z ${E[2]}`);
});

test('parallaxOffset reduces to parallaxFactors in the small-angle (stellar) limit', () => {
  const cases = [[269.452, 4.693], [133.795, -7.245], [331.04, -56.78], [10, 85], [200, -70]];
  for (const [ra, dec] of cases) {
    for (const mjd of [60850.2, 60941.7, 61033.1, 61210.8]) {
      const plx = 0.547; // arcsec
      const off = parallaxOffset(ra, dec, ARCSEC_PER_RAD / plx, mjd);
      const f = parallaxFactors(ra, dec, mjd);
      assert.ok(Math.abs(off.dra_arcsec - plx * f.pra) < 2e-5, `east ${off.dra_arcsec} vs ${plx * f.pra}`);
      assert.ok(Math.abs(off.ddec_arcsec - plx * f.pdec) < 2e-5, `north ${off.ddec_arcsec} vs ${plx * f.pdec}`);
      // the factors never exceed the Earth-Sun distance
      assert.ok(Math.hypot(f.pra, f.pdec) < 1.02);
    }
  }
});

test('parallaxOffset: sign convention and exactness at planetary distances', () => {
  // A body towards RA 0, Dec 0 seen when the Earth is on the +y side (RA 6h side) of the Sun
  // must appear displaced towards -y, i.e. to smaller RA: WEST, negative dra.
  let mjd = mjdOf(2026, 1, 1);
  for (; mjd < mjdOf(2027, 1, 1); mjd += 1) {
    const E = earthPosition(mjd);
    if (E[1] > 0.9 && Math.abs(E[0]) < 0.2) break;
  }
  const E = earthPosition(mjd);
  const off = parallaxOffset(0, 0, 40, mjd);
  assert.ok(off.dra_arcsec < 0, 'Earth to the east of the Sun shifts the body west');
  // exact: tan(shift in RA) = -Ey / (d - Ex)
  const expectRa = Math.atan2(-E[1], 40 - E[0]) / DEG;
  assert.ok(Math.abs(off.dra_arcsec / 3600 - expectRa) < 1e-9);
  assert.ok(Math.abs(off.dra_arcsec) > 3600, 'at 40 AU the shift is over a degree');
  // returned apparent position is consistent with the offsets
  assert.ok(Math.abs(wrap180(off.ra - off.dra_arcsec / 3600)) < 1e-9);
  assert.ok(Math.abs(off.dec - off.ddec_arcsec / 3600) < 1e-9);
  // geocentric distance
  assert.ok(Math.abs(off.distGeoAU - Math.hypot(40 - E[0], E[1], E[2])) < 1e-12);
  // infinity: no shift, no NaN
  const inf = parallaxOffset(123, 45, Infinity, mjd);
  assert.equal(inf.dra_arcsec, 0);
  assert.equal(inf.ddec_arcsec, 0);
});

test('hop at 500 AU between opposite quadratures is 13-14 arcmin', () => {
  // A target in the ecliptic plane and one near the ecliptic pole.
  for (const [ra, dec] of [[0, 0], [120, 20.2], [270, 66.56], [133.795, -7.245]]) {
    // find two consecutive dates where the Sun is 90 deg away (on opposite sides)
    const quads = [];
    let prev = sunElongation(ra, dec, 60800) - 90;
    for (let mjd = 60801; mjd < 60800 + 400 && quads.length < 2; mjd += 1) {
      const cur = sunElongation(ra, dec, mjd) - 90;
      if (prev === 0 || prev * cur < 0) quads.push(mjd - 1 + prev / (prev - cur));
      prev = cur;
    }
    let m1, m2;
    if (quads.length === 2) [m1, m2] = quads;
    else { m1 = 60850; m2 = m1 + 182.6; } // near the ecliptic pole every date is a quadrature
    assert.ok(Math.abs(sunElongation(ra, dec, m1) - 90) < 2.5);
    assert.ok(Math.abs(sunElongation(ra, dec, m2) - 90) < 2.5);
    const a = parallaxOffset(ra, dec, 500, m1), b = parallaxOffset(ra, dec, 500, m2);
    const ua = [Math.cos(a.dec * DEG) * Math.cos(a.ra * DEG), Math.cos(a.dec * DEG) * Math.sin(a.ra * DEG), Math.sin(a.dec * DEG)];
    const ub = [Math.cos(b.dec * DEG) * Math.cos(b.ra * DEG), Math.cos(b.dec * DEG) * Math.sin(b.ra * DEG), Math.sin(b.dec * DEG)];
    const hopArcmin = Math.acos(ua[0] * ub[0] + ua[1] * ub[1] + ua[2] * ub[2]) / DEG * 60;
    assert.ok(hopArcmin > 13 && hopArcmin < 14, `hop ${hopArcmin} arcmin at (${ra}, ${dec})`);
    // and it equals baseline / distance
    const base = earthBaselineBetween(m1, m2);
    assert.ok(base > 1.95 && base < 2.04, `baseline ${base}`);
    assert.ok(Math.abs(hopArcmin - (base / 500) / DEG * 60) < 0.1);
  }
});

test('sunElongation and earthBaselineBetween basics', () => {
  const mjd = 61000.25;
  const E = earthPosition(mjd);
  const sunRa = (Math.atan2(-E[1], -E[0]) / DEG + 360) % 360;
  const sunDec = Math.asin(-E[2] / norm(E)) / DEG;
  assert.ok(sunElongation(sunRa, sunDec, mjd) < 1e-6);
  assert.ok(Math.abs(sunElongation(sunRa + 180, -sunDec, mjd) - 180) < 1e-6);
  assert.equal(earthBaselineBetween(mjd, mjd), 0);
  // one sidereal year later the Earth is back where it started
  assert.ok(earthBaselineBetween(mjd, mjd + 365.25636) < 3e-4);
  // non-finite input does not throw
  assert.ok(Number.isNaN(earthPosition(NaN)[0]));
});
