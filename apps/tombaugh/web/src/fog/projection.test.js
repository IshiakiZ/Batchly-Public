// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mollweideForward, mollweideInverse, mollweideXY, screenLongitude,
  eqToGal, galToEq, eclToEq, eqToEcl, wrap360, wrap180, angSepDeg,
  OBLIQUITY_J2000_DEG,
} from './projection.js';
import {
  eclipticLine, galacticLine, meridianLine, parallelLine, BRIGHT_STARS, FOG_TARGETS,
} from './skylines.js';
import { ang2pixNest } from './healpix.js';
import { fogGeometry } from './fogmap.js';

const D2R = Math.PI / 180;

function close(actual, expected, tol, msg) {
  assert.ok(Math.abs(actual - expected) <= tol, `${msg || ''} expected ${expected}, got ${actual}`);
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('wrap helpers', () => {
  assert.equal(wrap360(370), 10);
  assert.equal(wrap360(-10), 350);
  assert.equal(wrap360(360), 0);
  assert.equal(wrap360(-1e-20), 0);
  assert.equal(wrap180(190), -170);
  assert.equal(wrap180(180), -180);
  assert.equal(wrap180(-180), -180);
  assert.equal(wrap180(179), 179);
});

test('Mollweide: known points and orientation', () => {
  // Centre of the map.
  assert.deepEqual(mollweideForward(180, 0), [0, 0]);
  // RA increases to the left; north is up.
  assert.ok(mollweideForward(200, 0)[0] < 0, 'RA 200 is left of RA 180');
  assert.ok(mollweideForward(160, 0)[0] > 0, 'RA 160 is right of RA 180');
  assert.ok(mollweideForward(180, 30)[1] > 0, 'north is up');
  close(mollweideForward(270, 0)[0], -1, 1e-12);
  close(mollweideForward(90, 0)[0], 1, 1e-12);
  // Limb: RA 0 / 360 on the equator at x = +/-2.
  close(Math.abs(mollweideForward(0, 0)[0]), 2, 1e-12);
  close(mollweideForward(0.001, 0)[0], 2, 1e-4);
  close(mollweideForward(359.999, 0)[0], -2, 1e-4);
  // Poles.
  const np = mollweideForward(77, 90);
  close(np[0], 0, 1e-12); close(np[1], 1, 1e-12);
  const sp = mollweideForward(300, -90);
  close(sp[0], 0, 1e-12); close(sp[1], -1, 1e-12);
  // Selectable centre.
  assert.deepEqual(mollweideForward(0, 0, 0), [0, 0]);
  close(mollweideForward(90, 0, 0)[0], -1, 1e-12);
  close(mollweideForward(266.4, 0, 266.4)[0], 0, 1e-12);
  assert.equal(screenLongitude(190), -10);
  assert.equal(screenLongitude(350, 0), 10);
});

test('Mollweide: auxiliary angle satisfies its equation at every latitude', () => {
  for (const dec of [0, 1e-9, 0.5, 10, 30, 45, 60, 75, 85, 89, 89.9, 89.999, 89.99999, 89.9999999, 90]) {
    for (const sign of [1, -1]) {
      const [, y] = mollweideXY(0, sign * dec);
      const theta = Math.asin(y);
      const lhs = 2 * theta + Math.sin(2 * theta);
      const rhs = Math.PI * Math.sin(sign * dec * D2R);
      close(lhs, rhs, 1e-12, `dec ${sign * dec}:`);
    }
  }
  // Independent check by bisection of the textbook equation.
  for (const dec of [5, 30, 60, 88]) {
    let lo = 0;
    let hi = Math.PI / 2;
    for (let i = 0; i < 80; i++) {
      const mid = (lo + hi) / 2;
      if (2 * mid + Math.sin(2 * mid) < Math.PI * Math.sin(dec * D2R)) lo = mid; else hi = mid;
    }
    close(Math.asin(mollweideXY(0, dec)[1]), lo, 1e-9, `dec ${dec}:`);
  }
  // Monotonic in latitude right up to the pole.
  let prev = -2;
  for (let dec = -90; dec <= 90; dec += 0.25) {
    const y = mollweideXY(0, dec)[1];
    assert.ok(y > prev, `y increases with dec at ${dec}`);
    prev = y;
  }
});

test('Mollweide: equal area', () => {
  // Fraction of the ellipse area north of a parallel equals the spherical cap fraction.
  for (const dec of [10, 30, 45, 60, 80, 89]) {
    const y = mollweideXY(0, dec)[1];
    const theta = Math.asin(y);
    // Area of ellipse (semi-axes 2, 1) above y: 2 * (pi/2 - theta - sin(theta) cos(theta)).
    const frac = (2 * (Math.PI / 2 - theta - Math.sin(theta) * Math.cos(theta))) / (2 * Math.PI);
    const cap = (1 - Math.sin(dec * D2R)) / 2;
    close(frac, cap, 1e-12, `dec ${dec}:`);
  }
});

test('Mollweide: forward/inverse round trips', () => {
  const rand = mulberry32(42);
  for (const ra0 of [180, 0, 266.4, 37.5]) {
    for (let k = 0; k < 5000; k++) {
      const ra = rand() * 360;
      const dec = Math.asin(2 * rand() - 1) / D2R;
      const [x, y] = mollweideForward(ra, dec, ra0);
      assert.ok((x / 2) ** 2 + y ** 2 <= 1 + 1e-12, 'inside the ellipse');
      const back = mollweideInverse(x, y, ra0);
      assert.ok(back, `(${ra}, ${dec}) inverts`);
      const tol = Math.abs(dec) > 89 ? 1e-5 : 1e-8;
      if (angSepDeg(ra, dec, back[0], back[1]) > tol) assert.fail(`round trip of (${ra}, ${dec}) gave (${back})`);
    }
  }
  // Close to the poles and on the limb.
  for (const dec of [89.5, 89.99, 89.9999, -89.99, -89.9999]) {
    for (const ra of [0.5, 90, 181, 359.5]) {
      const [x, y] = mollweideForward(ra, dec);
      const back = mollweideInverse(x, y);
      assert.ok(back && angSepDeg(ra, dec, back[0], back[1]) < 1e-5, `(${ra}, ${dec}) -> (${back})`);
    }
  }
  const pole = mollweideInverse(0, 1);
  close(pole[1], 90, 1e-9);
  close(mollweideInverse(0, -1)[1], -90, 1e-9);
  // Inverse then forward.
  for (let k = 0; k < 2000; k++) {
    const x = 4 * rand() - 2;
    const y = 2 * rand() - 1;
    const sky = mollweideInverse(x, y);
    if ((x / 2) ** 2 + y ** 2 > 1 + 1e-9) {
      assert.equal(sky, null, 'outside the ellipse');
    } else if (sky) {
      const [fx, fy] = mollweideForward(sky[0], sky[1]);
      // The limb meridian appears on both sides; compare |x| there.
      if (Math.abs(Math.abs(x) - Math.abs(fx)) > 1e-9 || Math.abs(y - fy) > 1e-9) {
        assert.fail(`inverse/forward of (${x}, ${y}) gave (${fx}, ${fy})`);
      }
    }
  }
  assert.equal(mollweideInverse(1.99, 0.5), null);
  assert.equal(mollweideInverse(0, 1.01), null);
  assert.equal(mollweideInverse(NaN, 0), null);
  assert.equal(mollweideInverse(0.1, 1), null);
});

test('galactic: known points', () => {
  // Galactic centre direction (l = 0, b = 0).
  const gc = galToEq(0, 0);
  close(gc[0], 266.405, 2e-3); close(gc[1], -28.936, 2e-3);
  const [l, b] = eqToGal(266.405, -28.936);
  close(wrap180(l), 0, 2e-3); close(b, 0, 2e-3);
  // North galactic pole.
  const ngp = galToEq(123, 90);
  close(ngp[0], 192.859, 1e-3); close(ngp[1], 27.128, 1e-3);
  close(eqToGal(192.859, 27.128)[1], 90, 1e-3);
  // North celestial pole.
  const ncp = eqToGal(0, 90);
  close(ncp[0], 122.932, 1e-3); close(ncp[1], 27.128, 1e-3);
  // Anticentre is opposite the centre.
  const ac = galToEq(180, 0);
  close(ac[0], 86.405, 2e-3); close(ac[1], 28.936, 2e-3);
  // Sagittarius A*: l = 359.944, b = -0.046.
  const sgr = eqToGal(266.41683, -29.00781);
  close(sgr[0], 359.944, 2e-3); close(sgr[1], -0.046, 2e-3);
  // Large Magellanic Cloud: l about 280.5, b about -32.9.
  const lmc = eqToGal(80.894, -69.756);
  close(lmc[0], 280.47, 0.05); close(lmc[1], -32.89, 0.05);
});

test('galactic: round trips', () => {
  const rand = mulberry32(7);
  for (let k = 0; k < 5000; k++) {
    const ra = rand() * 360;
    const dec = Math.asin(2 * rand() - 1) / D2R;
    const [l, b] = eqToGal(ra, dec);
    assert.ok(l >= 0 && l < 360 && b >= -90 && b <= 90);
    const back = galToEq(l, b);
    if (angSepDeg(ra, dec, back[0], back[1]) > 1e-9) assert.fail(`(${ra}, ${dec}) -> (${back})`);
  }
  // Rotations preserve separations.
  const a = eqToGal(10, 20);
  const c = eqToGal(50, -30);
  close(angSepDeg(a[0], a[1], c[0], c[1]), angSepDeg(10, 20, 50, -30), 1e-10);
});

test('ecliptic: obliquity and known points', () => {
  close(OBLIQUITY_J2000_DEG, 23.4393, 1e-4);
  // Summer solstice point: longitude 90 -> RA 90, Dec +obliquity.
  const s = eclToEq(90, 0);
  close(s[0], 90, 1e-9); close(s[1], 23.4393, 1e-4);
  const w = eclToEq(270, 0);
  close(w[0], 270, 1e-9); close(w[1], -23.4393, 1e-4);
  // Equinoxes are shared.
  const v = eclToEq(0, 0);
  close(wrap180(v[0]), 0, 1e-9); close(v[1], 0, 1e-9);
  const au = eclToEq(180, 0);
  close(au[0], 180, 1e-9); close(au[1], 0, 1e-9);
  // North ecliptic pole (the SPHEREx deep field): RA 270, Dec 66.5607.
  const nep = eclToEq(0, 90);
  close(nep[0], 270, 1e-6); close(nep[1], 66.5607, 1e-4);
  const sep = eclToEq(0, -90);
  close(sep[0], 90, 1e-6); close(sep[1], -66.5607, 1e-4);
  // Round trips.
  const rand = mulberry32(9);
  for (let k = 0; k < 3000; k++) {
    const ra = rand() * 360;
    const dec = Math.asin(2 * rand() - 1) / D2R;
    const [lon, lat] = eqToEcl(ra, dec);
    const back = eclToEq(lon, lat);
    if (angSepDeg(ra, dec, back[0], back[1]) > 1e-9) assert.fail(`(${ra}, ${dec}) -> (${back})`);
  }
  // Regulus sits close to the ecliptic (latitude about +0.46).
  close(eqToEcl(152.093, 11.967)[1], 0.46, 0.05);
});

test('angular separation', () => {
  close(angSepDeg(0, 0, 90, 0), 90, 1e-12);
  close(angSepDeg(10, 90, 200, -90), 180, 1e-9);
  close(angSepDeg(359.5, 0, 0.5, 0), 1, 1e-10);
  close(angSepDeg(120, 45, 120, 45), 0, 1e-12);
});

test('sky lines and landmarks', () => {
  const ecl = eclipticLine(1);
  assert.equal(ecl.length, 361);
  for (const [ra, dec] of ecl) {
    assert.ok(Math.abs(dec) <= OBLIQUITY_J2000_DEG + 1e-9);
    close(eqToEcl(ra, dec)[1], 0, 1e-9);
  }
  const gal = galacticLine(0, 2);
  assert.equal(gal.length, 181);
  for (const [ra, dec] of gal) close(eqToGal(ra, dec)[1], 0, 1e-9);
  for (const [ra, dec] of galacticLine(-5, 10)) close(eqToGal(ra, dec)[1], -5, 1e-9);
  // Consecutive points are evenly spaced along the great circle.
  for (let i = 1; i < gal.length; i++) close(angSepDeg(...gal[i - 1], ...gal[i]), 2, 1e-9);
  const mer = meridianLine(30, 90, 5);
  assert.deepEqual(mer[0], [30, -90]);
  assert.deepEqual(mer[mer.length - 1], [30, 90]);
  const par = parallelLine(-30, 10);
  assert.equal(par.length, 37);
  assert.ok(par.every(([, dec]) => dec === -30));

  assert.ok(BRIGHT_STARS.length >= 40);
  for (let i = 0; i < BRIGHT_STARS.length; i++) {
    const s = BRIGHT_STARS[i];
    assert.ok(s.name && s.ra >= 0 && s.ra < 360 && s.dec >= -90 && s.dec <= 90 && Number.isFinite(s.mag));
    if (i) assert.ok(s.mag >= BRIGHT_STARS[i - 1].mag, 'sorted brightest first');
  }
  assert.equal(BRIGHT_STARS[0].name, 'Sirius');
  const names = new Set(BRIGHT_STARS.map((s) => s.name));
  for (const n of ['Sirius', 'Canopus', 'Arcturus', 'Vega', 'Capella', 'Rigel', 'Procyon', 'Betelgeuse',
    'Achernar', 'Altair', 'Aldebaran', 'Antares', 'Spica', 'Pollux', 'Fomalhaut', 'Deneb', 'Regulus', 'Polaris']) {
    assert.ok(names.has(n), `${n} is listed`);
  }
  assert.equal(names.size, BRIGHT_STARS.length, 'no duplicates');
  // Sanity of a few positions against well-known separations.
  const star = (n) => BRIGHT_STARS.find((s) => s.name === n);
  const d = (a, b) => angSepDeg(star(a).ra, star(a).dec, star(b).ra, star(b).dec);
  close(d('Betelgeuse', 'Rigel'), 18.6, 0.3);
  close(d('Castor', 'Pollux'), 4.5, 0.2);
  close(d('Dubhe', 'Merak'), 5.4, 0.2);
  close(d('Vega', 'Altair'), 34.2, 0.4);
  close(d('Vega', 'Deneb'), 23.8, 0.4);
  close(d('Acrux', 'Gacrux'), 6.0, 0.2);
  close(d('Sirius', 'Procyon'), 25.7, 0.4);
  assert.ok(90 - star('Polaris').dec < 1);
  // Milky Way stars lie near the galactic plane; Arcturus does not.
  assert.ok(Math.abs(eqToGal(star('Deneb').ra, star('Deneb').dec)[1]) < 5);
  assert.ok(Math.abs(eqToGal(star('Acrux').ra, star('Acrux').dec)[1]) < 5);
  assert.ok(eqToGal(star('Arcturus').ra, star('Arcturus').dec)[1] > 60);

  assert.deepEqual(FOG_TARGETS.map((t) => [t.ra, t.dec]),
    [[269.45, 4.69], [331.04, -56.78], [133.8, -7.25], [76.96, 30.4], [248.17, 66.75]]);
  assert.ok(FOG_TARGETS.every((t) => t.id && t.name && t.short));
});

// The fog map draws every HEALPix cell as a 12-point polygon in Mollweide map units. These tests
// check the drawing geometry itself: the polygons cover the oval exactly once.
function polygonArea(arr) {
  let area = 0;
  const n = arr.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += arr[2 * i] * arr[2 * j + 1] - arr[2 * j] * arr[2 * i + 1];
  }
  return Math.abs(area) / 2;
}

function pointInPolygon(x, y, arr) {
  let inside = false;
  const n = arr.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = arr[2 * i];
    const yi = arr[2 * i + 1];
    const xj = arr[2 * j];
    const yj = arr[2 * j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function distToPolygon(x, y, arr) {
  let best = Infinity;
  const n = arr.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ax = arr[2 * j];
    const ay = arr[2 * j + 1];
    const dx = arr[2 * i] - ax;
    const dy = arr[2 * i + 1] - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
  }
  return best;
}

test('fog map cells tile the Mollweide oval: equal areas, no gaps, no overlaps', () => {
  for (const ra0 of [180, 0, 266.4]) {
    const geo = fogGeometry(ra0);
    const n = 12288;
    const len = geo.poly.length / n; // numbers per cell outline
    assert.ok(Number.isInteger(len) && len >= 16);
    // Mollweide is equal-area and so is HEALPix: every cell covers 2 pi / 12288 map units^2,
    // counting both halves of a cell cut by the limb. No overlaps: the areas add up to the oval.
    const want = (2 * Math.PI) / n;
    let total = 0;
    let worst = 0;
    for (let cell = 0; cell < n; cell++) {
      let area = polygonArea(geo.poly.subarray(cell * len, (cell + 1) * len));
      const second = geo.extra.get(cell);
      if (second) area += polygonArea(second);
      total += area;
      worst = Math.max(worst, Math.abs(area / want - 1));
    }
    close(total / (2 * Math.PI), 1, 2e-4, `ra0 ${ra0}: total area ratio`);
    assert.ok(worst < 0.03, `ra0 ${ra0}: worst cell area is off by ${(100 * worst).toFixed(2)}%`);
    assert.ok(geo.extra.size > 30 && geo.extra.size < 400, `${geo.extra.size} cells straddle the limb`);
    // All outline points stay inside the oval.
    for (let i = 0; i < geo.poly.length; i += 2) {
      const r = (geo.poly[i] / 2) ** 2 + geo.poly[i + 1] ** 2;
      if (r > 1 + 1e-5) assert.fail(`outline point outside the oval: ${geo.poly[i]}, ${geo.poly[i + 1]}`);
    }

    // No gaps, and hit-testing agrees with the drawing: a point of the map lies inside the drawn
    // polygon of the cell that inverse projection + ang2pixNest assigns to it. The outline is a
    // polygon, not the true curve, so a point may miss by a hair: at most 0.003 map units, which
    // is under one pixel on a 1200 px wide map.
    const rand = mulberry32(31 + ra0);
    let checked = 0;
    let misses = 0;
    let worstMiss = 0;
    while (checked < 40000) {
      const x = 4 * rand() - 2;
      const y = 2 * rand() - 1;
      const sky = mollweideInverse(x, y, ra0);
      if (!sky) continue;
      checked++;
      const cell = ang2pixNest(32, sky[0], sky[1]);
      const main = geo.poly.subarray(cell * len, (cell + 1) * len);
      const second = geo.extra.get(cell);
      if (pointInPolygon(x, y, main) || (second && pointInPolygon(x, y, second))) continue;
      misses++;
      const d = Math.min(distToPolygon(x, y, main), second ? distToPolygon(x, y, second) : Infinity);
      worstMiss = Math.max(worstMiss, d);
    }
    assert.ok(worstMiss < 0.003, `ra0 ${ra0}: a point misses its cell polygon by ${worstMiss} map units`);
    assert.ok(misses < checked * 0.01, `ra0 ${ra0}: ${misses} of ${checked} points fell outside their polygon`);
    if (process.env.FOG_VERBOSE) console.log(`ra0 ${ra0}: worst area ${(100 * worst).toFixed(3)}%, ${misses}/${checked} misses, worst ${worstMiss.toExponential(2)}`);
  }
});
