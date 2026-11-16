// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// Tests for wcs.js. Run: node --test web/src/core/wcs.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeWcs,
  tanProject,
  tanDeproject,
  angSep,
  makeGrid,
  gridSkyToPix,
  gridPixToSky,
  parseCoord,
  formatCoord,
  normRa,
  tangentBasis,
} from './wcs.js';

const D2R = Math.PI / 180;

// WCS of a real SPHEREx Level-2 cutout (detector 2, 59 x 59 pixels, centred on RA 210.80227,
// Dec 54.34895), copied from CONTRACT.md.
const REAL_WCS = {
  crpix: [-625.5, 511.5],
  crval: [208.4483499, 54.5491081503],
  pc: [
    [0.00123274981054, -0.00118000897293],
    [-0.00117635107879, -0.00123440903284],
  ],
  cdelt: [1, 1],
  sip: {
    aOrder: 3,
    bOrder: 3,
    apOrder: 3,
    bpOrder: 3,
    a: {
      '0_0': 0.0905846568112, '0_1': 0.00142149437078, '0_2': -2.32575728759e-9,
      '0_3': 2.12692602413e-11, '1_0': -0.00040775220791, '1_1': 3.95116388931e-6,
      '1_2': 6.08925674497e-10, '2_0': -7.40546138386e-9, '2_1': 9.58797339985e-12,
      '3_0': 6.24932043516e-10,
    },
    b: {
      '0_0': -1.14138384439, '0_1': -0.00037568269309, '0_2': 1.94165517112e-6,
      '0_3': 4.94514136332e-10, '1_0': -0.000119205208267, '1_1': 1.73252607291e-8,
      '1_2': -2.05541848269e-11, '2_0': 6.56833753216e-6, '2_1': 6.30028459135e-10,
      '3_0': -1.56259036826e-11,
    },
    ap: {
      '0_0': -0.092314618979, '0_1': -0.00142224960004, '0_2': 1.10099113746e-8,
      '0_3': -1.97302284155e-11, '1_0': 0.000402194977753, '1_1': -3.93833797294e-6,
      '1_2': -5.84194146156e-10, '2_0': 1.65539043149e-8, '2_1': -6.46051676537e-12,
      '3_0': -5.97770072336e-10,
    },
    bp: {
      '0_0': 1.13669351605, '0_1': 0.000370299612606, '0_2': -1.93170896437e-6,
      '0_3': -4.85997193773e-10, '1_0': 0.000120546016558, '1_1': 3.10385882354e-10,
      '1_2': 2.18904853902e-11, '2_0': -6.55630767898e-6, '2_1': -5.51398355215e-10,
      '3_0': 1.53023228315e-11,
    },
  },
};

function close(actual, expected, tol, msg) {
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `${msg || 'value'}: got ${actual}, expected ${expected} +/- ${tol}`,
  );
}

// ---------------------------------------------------------------------------------------------
// Real data
// ---------------------------------------------------------------------------------------------

test('real SPHEREx header: FITS pixel (30,30) = JS pixel (29,29) lands on the cutout centre', () => {
  const w = makeWcs(REAL_WCS);
  const [ra, dec] = w.pixToSky(29, 29);
  close(ra, 210.8023, 0.003, 'RA');
  close(dec, 54.349, 0.003, 'Dec');
  // Tighter: IRSA centres the cutout on the pixel nearest the request, so the requested
  // position must fall inside the central pixel. An off-by-one or a dropped SIP term fails this.
  const [px, py] = w.skyToPix(210.80227, 54.34895);
  assert.ok(Math.abs(px - 29) < 0.5 && Math.abs(py - 29) < 0.5, `target at pixel ${px}, ${py}`);
  assert.ok(angSep(ra, dec, 210.80227, 54.34895) * 3600 < 0.75 * 6.15);
});

test('real SPHEREx header: forward transform matches an independent hand evaluation', () => {
  const w = makeWcs(REAL_WCS);
  const x = 12;
  const y = 47;
  // Written out long-hand from the SIP paper, deliberately not sharing code with wcs.js.
  const u = x + 1 - REAL_WCS.crpix[0];
  const v = y + 1 - REAL_WCS.crpix[1];
  let f = u;
  let g = v;
  for (const [k, c] of Object.entries(REAL_WCS.sip.a)) {
    const [p, q] = k.split('_').map(Number);
    f += c * u ** p * v ** q;
  }
  for (const [k, c] of Object.entries(REAL_WCS.sip.b)) {
    const [p, q] = k.split('_').map(Number);
    g += c * u ** p * v ** q;
  }
  const xi = (REAL_WCS.pc[0][0] * f + REAL_WCS.pc[0][1] * g) * D2R;
  const eta = (REAL_WCS.pc[1][0] * f + REAL_WCS.pc[1][1] * g) * D2R;
  // Gnomonic deprojection through unit vectors (a different route from the atan2 formulas).
  const a0 = REAL_WCS.crval[0] * D2R;
  const d0 = REAL_WCS.crval[1] * D2R;
  const C = [Math.cos(d0) * Math.cos(a0), Math.cos(d0) * Math.sin(a0), Math.sin(d0)];
  const E = [-Math.sin(a0), Math.cos(a0), 0];
  const N = [-Math.sin(d0) * Math.cos(a0), -Math.sin(d0) * Math.sin(a0), Math.cos(d0)];
  const P = [0, 1, 2].map((i) => C[i] + xi * E[i] + eta * N[i]);
  const norm = Math.hypot(P[0], P[1], P[2]);
  const raRef = normRa(Math.atan2(P[1], P[0]) / D2R);
  const decRef = Math.asin(P[2] / norm) / D2R;
  const [ra, dec] = w.pixToSky(x, y);
  close(ra, raRef, 1e-10, 'RA');
  close(dec, decRef, 1e-10, 'Dec');
});

test('real SPHEREx header: pixel scale is 6.15 arcsec within 1 percent, normal sky parity', () => {
  const w = makeWcs(REAL_WCS);
  close(w.pixelScale, 6.15, 0.0615, 'pixelScale');
  assert.equal(w.parity, -1);
  // Measured on the sky, including the SIP first-order terms.
  const [ra0, dec0] = w.pixToSky(29, 29);
  const [ra1, dec1] = w.pixToSky(30, 29);
  const [ra2, dec2] = w.pixToSky(29, 30);
  close(angSep(ra0, dec0, ra1, dec1) * 3600, 6.15, 0.0615, 'step along x');
  close(angSep(ra0, dec0, ra2, dec2) * 3600, 6.15, 0.0615, 'step along y');
  // Direction of a pixel step on the sky follows the columns of PC: +x is east and south,
  // +y is west and south. Only approximately, because 1.4 degrees from the tangent point the
  // local east/north axes are rotated by the convergence of meridians (about 2 degrees) and
  // the SIP terms change the scale by a few tenths of a percent.
  const cosd = Math.cos(dec0 * D2R);
  const ex = [(ra1 - ra0) * cosd, dec1 - dec0];
  const ey = [(ra2 - ra0) * cosd, dec2 - dec0];
  const tol = 0.08 * 0.0017;
  close(ex[0], REAL_WCS.pc[0][0], tol, 'd(xi)/dx');
  close(ex[1], REAL_WCS.pc[1][0], tol, 'd(eta)/dx');
  close(ey[0], REAL_WCS.pc[0][1], tol, 'd(xi)/dy');
  close(ey[1], REAL_WCS.pc[1][1], tol, 'd(eta)/dy');
  assert.ok(ex[0] > 0 && ex[1] < 0, '+x points east and south');
  assert.ok(ey[0] < 0 && ey[1] < 0, '+y points west and south');
  // Handedness measured on the sky: (east, north) cross product of the x and y steps is
  // negative for an image that is not mirrored (east is left when north is up).
  assert.ok(ex[0] * ey[1] - ex[1] * ey[0] < 0);
});

test('real SPHEREx header: pixToSky / skyToPix round-trips to 1e-5 pixel over the 59 x 59 cutout', () => {
  const w = makeWcs(REAL_WCS);
  assert.equal(w.hasSip, true);
  assert.equal(w.hasInverseSip, true);
  let worst = 0;
  for (let y = -0.5; y <= 58.5; y += 0.5) {
    for (let x = -0.5; x <= 58.5; x += 0.5) {
      const [ra, dec] = w.pixToSky(x, y);
      const [bx, by] = w.skyToPix(ra, dec);
      worst = Math.max(worst, Math.abs(bx - x), Math.abs(by - y));
    }
  }
  assert.ok(worst < 1e-5, `worst round trip ${worst} pixel`);
  assert.ok(worst < 1e-8, `Newton refinement should do far better than AP/BP alone: ${worst}`);
});

test('inverse without AP/BP (pure Newton) agrees with the AP/BP-seeded inverse', () => {
  const noInv = { ...REAL_WCS, sip: { a: REAL_WCS.sip.a, b: REAL_WCS.sip.b } };
  const w1 = makeWcs(REAL_WCS);
  const w2 = makeWcs(noInv);
  assert.equal(w2.hasInverseSip, false);
  for (const [x, y] of [[0, 0], [58, 0], [0, 58], [58, 58], [29.3, 17.8], [-200, 900], [1500, -300]]) {
    const [ra, dec] = w1.pixToSky(x, y);
    const p1 = w1.skyToPix(ra, dec);
    const p2 = w2.skyToPix(ra, dec);
    close(p1[0], x, 1e-6, 'x via AP/BP + Newton');
    close(p1[1], y, 1e-6, 'y via AP/BP + Newton');
    close(p2[0], x, 1e-6, 'x via Newton only');
    close(p2[1], y, 1e-6, 'y via Newton only');
  }
});

test('the real AP/BP alone are only approximate, which is why Newton refinement is needed', () => {
  // Apply AP/BP by hand and compare with the true inverse.
  const w = makeWcs(REAL_WCS);
  const x = 5;
  const y = 50;
  const plane = w.pixToPlane(x, y, new Float64Array(2));
  const pc = REAL_WCS.pc;
  const det = pc[0][0] * pc[1][1] - pc[0][1] * pc[1][0];
  const U = (pc[1][1] * plane[0] - pc[0][1] * plane[1]) / det;
  const V = (-pc[1][0] * plane[0] + pc[0][0] * plane[1]) / det;
  let u = U;
  let v = V;
  for (const [k, c] of Object.entries(REAL_WCS.sip.ap)) {
    const [p, q] = k.split('_').map(Number);
    u += c * U ** p * V ** q;
  }
  for (const [k, c] of Object.entries(REAL_WCS.sip.bp)) {
    const [p, q] = k.split('_').map(Number);
    v += c * U ** p * V ** q;
  }
  const ex = Math.abs(u + REAL_WCS.crpix[0] - 1 - x);
  const ey = Math.abs(v + REAL_WCS.crpix[1] - 1 - y);
  assert.ok(Math.max(ex, ey) < 0.05, `AP/BP should be a decent first guess (${ex}, ${ey})`);
  assert.ok(Math.max(ex, ey) > 1e-7, 'AP/BP are not exact; if they were this test would be moot');
});

// ---------------------------------------------------------------------------------------------
// Conventions on simple WCSs
// ---------------------------------------------------------------------------------------------

test('0-based pixels: FITS CRPIX (10, 20) is JS pixel (9, 19)', () => {
  const s = 6.15 / 3600;
  const w = makeWcs({ crpix: [10, 20], crval: [123.4, -45.6], pc: [[1, 0], [0, 1]], cdelt: [-s, s], sip: null });
  const [ra, dec] = w.pixToSky(9, 19);
  close(ra, 123.4, 1e-12, 'RA at CRPIX');
  close(dec, -45.6, 1e-12, 'Dec at CRPIX');
  const [x, y] = w.skyToPix(123.4, -45.6);
  close(x, 9, 1e-9);
  close(y, 19, 1e-9);
  // CDELT1 < 0: RA decreases with x (east is left). Dec increases with y.
  const [ra1, dec1] = w.pixToSky(10, 19);
  assert.ok(ra1 < ra);
  close((ra - ra1) * Math.cos(-45.6 * D2R), s, s * 1e-3, 'one pixel west');
  const [, dec2] = w.pixToSky(9, 20);
  close(dec2 - dec, s, s * 1e-6, 'one pixel north');
  close(dec1, dec, 1e-6, 'row is nearly constant Dec');
  assert.equal(w.parity, -1);
  close(w.pixelScale, 6.15, 1e-9);
  assert.equal(w.hasSip, false);
});

test('SIP zeroth and first order terms are honoured', () => {
  const s = 0.001;
  const base = { crpix: [100, 100], crval: [10, 20], pc: [[-s, 0], [0, s]], cdelt: [1, 1] };
  // A_0_0 = 2 shifts f by +2 pixels, so the pixel that lands on CRVAL is 2 pixels lower in x.
  const w = makeWcs({ ...base, sip: { a: { '0_0': 2 }, b: { '0_0': -3 } } });
  const [ra, dec] = w.pixToSky(99 - 2, 99 + 3);
  close(ra, 10, 1e-12);
  close(dec, 20, 1e-12);
  const [x, y] = w.skyToPix(10, 20);
  close(x, 97, 1e-9);
  close(y, 102, 1e-9);
  // A_1_0 = 0.01 magnifies the x scale by 1 percent.
  const w2 = makeWcs({ ...base, sip: { a: { '1_0': 0.01 }, b: {} } });
  const [raA] = w2.pixToSky(99, 99);
  const [raB] = w2.pixToSky(199, 99);
  close((raA - raB) * Math.cos(20 * D2R), 100 * 1.01 * s, 2e-6, 'magnified step');
  // Keys with a prefix are accepted too.
  const w3 = makeWcs({ ...base, sip: { a: { A_0_0: 2 }, b: { B_0_0: -3 } } });
  close(w3.skyToPix(10, 20)[0], 97, 1e-9);
});

test('a cd matrix or missing pc/cdelt/sip are handled; missing crpix throws', () => {
  const s = 0.002;
  const w = makeWcs({ crpix: [1, 1], crval: [0, 0], cd: [[-s, 0], [0, s]] });
  const [ra, dec] = w.pixToSky(1, 1);
  close(ra, 360 - s, 1e-9);
  close(dec, s, 1e-9);
  const wi = makeWcs({ crpix: [1, 1], crval: [50, 0] });
  close(wi.pixToSky(0, 0)[0], 50, 1e-12);
  assert.throws(() => makeWcs(null), TypeError);
  assert.throws(() => makeWcs({ crval: [1, 2] }), TypeError);
  // A singular matrix must not throw; the inverse is simply undefined.
  const bad = makeWcs({ crpix: [1, 1], crval: [0, 0], pc: [[0, 0], [0, 0]], cdelt: [1, 1] });
  assert.ok(Number.isNaN(bad.skyToPix(0.1, 0.1)[0]));
});

test('strong synthetic SIP still inverts to 1e-6 pixel', () => {
  const th = 37 * D2R;
  const s = 6.15 / 3600;
  const w = makeWcs({
    crpix: [-300.5, 420.5],
    crval: [150, 30],
    pc: [[-s * Math.cos(th), s * Math.sin(th)], [s * Math.sin(th), s * Math.cos(th)]],
    cdelt: [1, 1],
    sip: {
      a: { '0_0': 0.7, '1_0': 3e-4, '0_1': -2e-4, '2_0': 4e-6, '1_1': -3e-6, '0_2': 2e-6, '3_0': 3e-10, '1_2': -2e-10 },
      b: { '0_0': -1.2, '1_0': -1e-4, '0_1': 2e-4, '2_0': -2e-6, '1_1': 5e-6, '0_2': 1e-6, '0_3': -4e-10, '2_1': 1e-10 },
    },
  });
  let worst = 0;
  for (let y = 0; y < 100; y += 7) {
    for (let x = 0; x < 100; x += 7) {
      const [ra, dec] = w.pixToSky(x, y);
      const [bx, by] = w.skyToPix(ra, dec);
      worst = Math.max(worst, Math.abs(bx - x), Math.abs(by - y));
    }
  }
  assert.ok(worst < 1e-6, `worst ${worst}`);
});

// ---------------------------------------------------------------------------------------------
// Gnomonic projection
// ---------------------------------------------------------------------------------------------

test('tanProject: east is +xi, north is +eta, known values', () => {
  const t1 = Math.tan(1 * D2R) / D2R;
  let [xi, eta] = tanProject(11, 0, 10, 0);
  close(xi, t1, 1e-12, 'one degree east on the equator');
  close(eta, 0, 1e-12);
  [xi, eta] = tanProject(10, 1, 10, 0);
  close(xi, 0, 1e-12);
  close(eta, t1, 1e-12, 'one degree north');
  [xi, eta] = tanProject(200, 61, 200, 60);
  close(eta, t1, 1e-12);
  // Same declination, larger RA, northern sky: east, and slightly north because parallels curve.
  [xi, eta] = tanProject(201, 60, 200, 60);
  assert.ok(xi > 0 && eta > 0);
  close(xi, Math.cos(60 * D2R), 1e-3);
  // The tangent point itself.
  assert.deepEqual(tanProject(33, -12, 33, -12), [0, 0]);
  // More than 90 degrees away: no projection.
  assert.ok(Number.isNaN(tanProject(190, 0, 10, 0)[0]));
  assert.ok(Number.isNaN(tanProject(10, 0, 10, 90)[0]));
});

test('gnomonic round trips near the poles', () => {
  for (const dec0 of [89.5, 89.999, 90, -89.9, -90]) {
    for (const ra0 of [0, 123.456, 359.9]) {
      for (const [xi, eta] of [[0, 0], [0.3, -0.2], [-0.7, 0.9], [1.5, 1.5], [1e-7, -1e-7]]) {
        const [ra, dec] = tanDeproject(xi, eta, ra0, dec0);
        assert.ok(ra >= 0 && ra < 360 && Math.abs(dec) <= 90);
        const [xi2, eta2] = tanProject(ra, dec, ra0, dec0);
        close(xi2, xi, 1e-11, `xi at dec0=${dec0}`);
        close(eta2, eta, 1e-11, `eta at dec0=${dec0}`);
      }
    }
  }
  // Stepping over the north pole: eta beyond the pole flips RA by 180 degrees.
  const [ra, dec] = tanDeproject(0, 1, 40, 89.5);
  close(ra, 220, 1e-9);
  close(dec, 90 - (Math.atan(1 * D2R) / D2R - 0.5), 1e-9);
});

test('gnomonic round trips across RA = 0/360', () => {
  for (const ra0 of [0, 0.01, 359.99, 359.999999]) {
    for (const [ra, dec] of [[359.9, 10.1], [0.1, 9.9], [0, 10], [359.999, 10.001], [0.5, 10.5]]) {
      const [xi, eta] = tanProject(ra, dec, ra0, 10);
      assert.ok(Math.abs(xi) < 1 && Math.abs(eta) < 1, 'small offsets stay small across the wrap');
      const [ra2, dec2] = tanDeproject(xi, eta, ra0, 10);
      assert.ok(ra2 >= 0 && ra2 < 360);
      close(angSep(ra, dec, ra2, dec2), 0, 1e-11, 'round trip');
    }
  }
  // East of RA 359.9 is RA 0.1: xi must be positive.
  assert.ok(tanProject(0.1, 0, 359.9, 0)[0] > 0);
  assert.ok(tanProject(359.9, 0, 0.1, 0)[0] < 0);
  // WCS whose reference point sits on the wrap.
  const s = 6.15 / 3600;
  const w = makeWcs({ crpix: [30, 30], crval: [359.999, 5], pc: [[-s, 0], [0, s]], cdelt: [1, 1], sip: null });
  for (const x of [0, 29, 58]) {
    const [ra, dec] = w.pixToSky(x, 10);
    assert.ok(ra >= 0 && ra < 360);
    const [bx, by] = w.skyToPix(ra, dec);
    close(bx, x, 1e-8);
    close(by, 10, 1e-8);
  }
  assert.ok(w.pixToSky(0, 29)[0] < 1, 'east of the wrap');
  assert.ok(w.pixToSky(58, 29)[0] > 359, 'west of the wrap');
});

test('tangentBasis is orthonormal and consistent with tanDeproject', () => {
  const b = tangentBasis(77, -33);
  const dot = (i, j) => b[i * 3] * b[j * 3] + b[i * 3 + 1] * b[j * 3 + 1] + b[i * 3 + 2] * b[j * 3 + 2];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) close(dot(i, j), i === j ? 1 : 0, 1e-15);
  const xi = 0.4 * D2R;
  const eta = -0.25 * D2R;
  const p = [0, 1, 2].map((k) => b[6 + k] + xi * b[k] + eta * b[3 + k]);
  const ra = normRa(Math.atan2(p[1], p[0]) / D2R);
  const dec = Math.atan2(p[2], Math.hypot(p[0], p[1])) / D2R;
  const [ra2, dec2] = tanDeproject(0.4, -0.25, 77, -33);
  close(ra, ra2, 1e-12);
  close(dec, dec2, 1e-12);
});

test('angSep: tiny, ordinary, polar and antipodal separations', () => {
  close(angSep(10, 20, 10, 21), 1, 1e-13);
  close(angSep(10, 0, 11, 0), 1, 1e-13);
  close(angSep(359.5, 0, 0.5, 0), 1, 1e-13, 'across the wrap');
  close(angSep(0, 90, 123, -90), 180, 1e-12);
  close(angSep(0, 0, 180, 0), 180, 1e-12);
  close(angSep(42, 89, 222, 89), 2, 1e-12, 'over the pole');
  assert.equal(angSep(123.456, -45.678, 123.456, -45.678), 0);
  // One milliarcsecond in Dec, and one in RA at Dec 60.
  const mas = 1 / 3.6e6;
  close(angSep(200, 60, 200, 60 + mas) / mas, 1, 1e-6);
  close(angSep(200, 60, 200 + mas / Math.cos(60 * D2R), 60) / mas, 1, 1e-6);
  // One microarcsecond still resolves.
  close(angSep(200, 60, 200, 60 + mas / 1000) / (mas / 1000), 1, 1e-3);
});

// ---------------------------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------------------------

test('makeGrid: size, defaults, normalisation', () => {
  const g = makeGrid(269.45, 4.69, 4);
  assert.equal(g.scale, 3.075);
  assert.equal(g.n, 79); // 240 / 3.075 = 78.05, rounded up so the field is at least 4 arcmin
  assert.equal(g.ra0, 269.45);
  assert.equal(g.dec0, 4.69);
  assert.ok(g.n * g.scale >= 240);
  assert.equal(makeGrid(10, 10, 10).n, 196);
  assert.equal(makeGrid(10, 10, 2, 6).n, 20);
  assert.equal(makeGrid(-10, 10, 2).ra0, 350);
  assert.deepEqual(Object.keys(g).sort(), ['dec0', 'n', 'ra0', 'scale']);
});

test('grid convention: centre, east is left (x decreases with RA), y increases north', () => {
  const g = makeGrid(150, 30, 4);
  const c = (g.n - 1) / 2;
  const [ra, dec] = gridPixToSky(g, c, c);
  close(ra, 150, 1e-12);
  close(dec, 30, 1e-12);
  // x = 0 is the EAST edge: larger RA.
  assert.ok(gridPixToSky(g, 0, c)[0] > 150);
  assert.ok(gridPixToSky(g, g.n - 1, c)[0] < 150);
  // y = 0 is the SOUTH edge.
  assert.ok(gridPixToSky(g, c, 0)[1] < 30);
  assert.ok(gridPixToSky(g, c, g.n - 1)[1] > 30);
  // Exact contract formula: xi_arcsec = -(x - c) * scale, eta_arcsec = (y - c) * scale.
  const x = 7;
  const y = 61;
  const [r2, d2] = gridPixToSky(g, x, y);
  const [xi, eta] = tanProject(r2, d2, 150, 30);
  close(xi * 3600, -(x - c) * g.scale, 1e-8);
  close(eta * 3600, (y - c) * g.scale, 1e-8);
  // A star 10 arcsec east and 20 arcsec north of centre.
  const [rs, ds] = tanDeproject(10 / 3600, 20 / 3600, 150, 30);
  const [px, py] = gridSkyToPix(g, rs, ds);
  close(px, c - 10 / 3.075, 1e-8);
  close(py, c + 20 / 3.075, 1e-8);
});

test('grid round trips, including across RA = 0 and near the pole', () => {
  for (const [ra0, dec0] of [[150, 30], [0.001, -5], [359.9995, 62], [45, 89.97], [300, -89.99]]) {
    const g = makeGrid(ra0, dec0, 6);
    for (const [x, y] of [[0, 0], [g.n - 1, 0], [0, g.n - 1], [g.n - 1, g.n - 1], [12.25, 80.75]]) {
      const [ra, dec] = gridPixToSky(g, x, y);
      const [bx, by] = gridSkyToPix(g, ra, dec);
      close(bx, x, 1e-7, `x at ${ra0}, ${dec0}`);
      close(by, y, 1e-7, `y at ${ra0}, ${dec0}`);
    }
  }
});

// ---------------------------------------------------------------------------------------------
// parseCoord / formatCoord
// ---------------------------------------------------------------------------------------------

function expectCoord(text, ra, dec, tol = 1e-6) {
  const c = parseCoord(text);
  assert.ok(c, `"${text}" should parse`);
  close(c.ra, ra, tol, `RA of "${text}"`);
  close(c.dec, dec, tol, `Dec of "${text}"`);
}

test('parseCoord: decimal degrees', () => {
  expectCoord('269.45 4.69', 269.45, 4.69, 1e-12);
  expectCoord('269.45, 4.69', 269.45, 4.69, 1e-12);
  expectCoord('269.45,4.69', 269.45, 4.69, 1e-12);
  expectCoord('  269.45   -4.69  ', 269.45, -4.69, 1e-12);
  expectCoord('+269.45 +4.69', 269.45, 4.69, 1e-12);
  expectCoord('10 20', 10, 20, 1e-12); // two bare numbers are degrees, not hours
  expectCoord('0 0', 0, 0);
  expectCoord('0.5 -90', 0.5, -90);
  expectCoord('360 0', 0, 0);
  expectCoord('210.80227d 54.34895d', 210.80227, 54.34895, 1e-12);
  expectCoord('210.80227° +54.34895°', 210.80227, 54.34895, 1e-12);
  expectCoord('ra=210.80227, dec=54.34895', 210.80227, 54.34895, 1e-12);
  expectCoord('(210.80227, 54.34895)', 210.80227, 54.34895, 1e-12);
  expectCoord('133.795129 −7.245147', 133.795129, -7.245147, 1e-12); // unicode minus
  expectCoord('.5 -.25', 0.5, -0.25, 1e-12);
});

test('parseCoord: sexagesimal', () => {
  expectCoord('08h55m10.831s -7d14m42.53s', 133.795129, -7.245147);
  expectCoord('17 57 48.5 +04 41 36', 269.4520833, 4.6933333);
  expectCoord('17h57m48.5s +04d41m36s', 269.4520833, 4.6933333);
  expectCoord('17:57:48.5 +04:41:36', 269.4520833, 4.6933333);
  expectCoord('17:57:48.5, +04:41:36', 269.4520833, 4.6933333);
  expectCoord('17 57 48.5 04 41 36', 269.4520833, 4.6933333); // no sign: split in the middle
  expectCoord('17h 57m 48.5s +04d 41m 36s', 269.4520833, 4.6933333);
  expectCoord('17h57m48.5s+04d41m36s', 269.4520833, 4.6933333);
  expectCoord('17H57M48.5S -04D41M36S', 269.4520833, -4.6933333);
  expectCoord('17h57m48.5s +04°41′36″', 269.4520833, 4.6933333);
  expectCoord('17h57m48.5s +04°41\'36"', 269.4520833, 4.6933333);
  expectCoord('17h57.8m +04d41.6m', 269.45, 4.6933333);
  expectCoord('17.5h -10', 262.5, -10);
  expectCoord('00:00:00 -00:30:00', 0, -0.5); // sign applies to the whole angle
  expectCoord('00 00 00.0 -00 00 01', 0, -1 / 3600);
  expectCoord('23:59:59.99 +89:59:59.9', 359.9999583, 89.9999722);
  expectCoord('269d27m07.5s +04d41m36s', 269.4520833, 4.6933333); // RA given in degrees
  expectCoord('RA 17:57:48.5 Dec +04:41:36', 269.4520833, 4.6933333);
  expectCoord('17:57:48.5 4.69333', 269.4520833, 4.69333); // mixed
  expectCoord('10 20 30 40', 155, 30.6666667); // hh mm, dd mm: the balanced split wins
  expectCoord('J085510.83-071442.5', 133.795125, -7.2451389);
  expectCoord('085510.83-071442.5', 133.795125, -7.2451389);
});

test('parseCoord: rejects nonsense and out-of-range values', () => {
  for (const bad of [
    '', '   ', 'hello', 'Barnard\'s Star', 'M 31', '269.45', '10 20 30', '1 2 3 4 5',
    '400 10', '-10 20', '10 91', '10 -90.01', '25h00m00s +10d00m00s', '24:00:01 +10:00:00',
    '17:61:00 +04:41:36', '17:57:60 +04:41:36', '17:57:48.5 +04:41:61', '17:57:48.5 +91:00:00',
    '17h57m48.5s +04h41m36s', '10,20,30', '1e3 5', '10.5.2 3', 'NaN NaN', '12 34 56 78 9 10 11',
    '17.5:30:00 +10:00:00', '10 20 30 40 50',
  ]) {
    assert.equal(parseCoord(bad), null, `"${bad}" should be rejected`);
  }
  assert.equal(parseCoord(null), null);
  assert.equal(parseCoord(undefined), null);
  assert.equal(parseCoord(12.5), null);
  assert.equal(parseCoord('1'.repeat(200)), null);
});

test('formatCoord: layout, rounding carry and round trip through parseCoord', () => {
  const f = formatCoord(269.4520833, 4.6933333);
  assert.equal(f.hms, '17h57m48.50s');
  assert.equal(f.dms, '+04d41m36.0s');
  assert.equal(f.deg, '269.45208 +4.69333');
  const g = formatCoord(133.795129, -7.245147);
  assert.equal(g.hms, '08h55m10.83s');
  assert.equal(g.dms, '-07d14m42.5s');
  assert.equal(g.deg, '133.79513 -7.24515');
  // Carries: 59.999 s must roll over, not print "60.00".
  assert.equal(formatCoord(15 * (1 - 1e-9), 0).hms, '01h00m00.00s');
  assert.equal(formatCoord(359.99999999, 0).hms, '00h00m00.00s');
  assert.equal(formatCoord(359.99999999, 0).deg, '0.00000 +0.00000');
  assert.equal(formatCoord(0, -0.99999999).dms, '-01d00m00.0s');
  assert.equal(formatCoord(0, -1e-9).dms, '+00d00m00.0s'); // no "-00d00m00.0s"
  assert.equal(formatCoord(0, -0.5).dms, '-00d30m00.0s');
  assert.equal(formatCoord(0, 90).dms, '+90d00m00.0s');
  assert.equal(formatCoord(-10, 0).deg, '350.00000 +0.00000');
  assert.deepEqual(formatCoord(NaN, 0), { hms: '--', dms: '--', deg: '--' });
  // Round trip.
  for (const [ra, dec] of [[269.4520833, 4.6933333], [0.0001, -89.9999], [359.123456, 54.34895], [133.795129, -7.245147]]) {
    const s = formatCoord(ra, dec);
    const a = parseCoord(`${s.hms} ${s.dms}`);
    close(a.ra, ra, 0.01 * 15 / 3600 / 2 + 1e-9, 'hms round trip');
    close(a.dec, dec, 0.1 / 3600 / 2 + 1e-9, 'dms round trip');
    const b = parseCoord(s.deg);
    close(b.ra, ra, 5.1e-6);
    close(b.dec, dec, 5.1e-6);
  }
});
