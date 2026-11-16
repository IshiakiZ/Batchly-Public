// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ang2pixNest, pix2angNest, cellCorners, npix, cellSizeDeg, neighboursNest,
  xyf2nest, nest2xyf, xyf2loc, isValidNside,
} from './healpix.js';

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

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

// Uniform random direction on the sphere.
function randomDir(rand) {
  const ra = rand() * 360;
  const dec = Math.asin(2 * rand() - 1) * R2D;
  return [ra, dec];
}

function vec(ra, dec) {
  const c = Math.cos(dec * D2R);
  return [c * Math.cos(ra * D2R), c * Math.sin(ra * D2R), Math.sin(dec * D2R)];
}

function unvec(v) {
  const r = Math.hypot(v[0], v[1], v[2]);
  let ra = Math.atan2(v[1], v[0]) * R2D;
  if (ra < 0) ra += 360;
  return [ra, Math.asin(v[2] / r) * R2D];
}

function sep(a, b) {
  const va = vec(a[0], a[1]);
  const vb = vec(b[0], b[1]);
  const dot = va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2];
  const cx = va[1] * vb[2] - va[2] * vb[1];
  const cy = va[2] * vb[0] - va[0] * vb[2];
  const cz = va[0] * vb[1] - va[1] * vb[0];
  return Math.atan2(Math.hypot(cx, cy, cz), dot) * R2D;
}

function close(actual, expected, tol, msg) {
  assert.ok(Math.abs(actual - expected) <= tol, `${msg || ''} expected ${expected}, got ${actual}`);
}

test('npix, cell size and nside validation', () => {
  assert.equal(npix(1), 12);
  assert.equal(npix(32), 12288);
  close(cellSizeDeg(32), 1.8323, 1e-3);
  assert.ok(isValidNside(1) && isValidNside(32) && isValidNside(8192));
  assert.ok(!isValidNside(0) && !isValidNside(3) && !isValidNside(2.5) && !isValidNside(65536));
  assert.throws(() => ang2pixNest(3, 0, 0), RangeError);
  assert.throws(() => pix2angNest(12, 0), RangeError);
});

test('bit interleaving round trips', () => {
  for (const nside of [1, 2, 16, 1024, 32768]) {
    const rand = mulberry32(nside);
    for (let k = 0; k < 500; k++) {
      const ix = Math.floor(rand() * nside);
      const iy = Math.floor(rand() * nside);
      const face = Math.floor(rand() * 12);
      const p = xyf2nest(nside, ix, iy, face);
      assert.ok(Number.isInteger(p) && p >= 0 && p < npix(nside));
      assert.deepEqual(nest2xyf(nside, p), [ix, iy, face]);
    }
  }
  // ix in the even bits, iy in the odd bits.
  assert.equal(xyf2nest(4, 1, 0, 0), 1);
  assert.equal(xyf2nest(4, 0, 1, 0), 2);
  assert.equal(xyf2nest(4, 3, 3, 0), 15);
  assert.equal(xyf2nest(4, 0, 0, 5), 80);
});

test('nside 1 pixel centres match the published table', () => {
  const z = [2 / 3, 2 / 3, 2 / 3, 2 / 3, 0, 0, 0, 0, -2 / 3, -2 / 3, -2 / 3, -2 / 3];
  const phi = [45, 135, 225, 315, 0, 90, 180, 270, 45, 135, 225, 315];
  for (let p = 0; p < 12; p++) {
    const [ra, dec] = pix2angNest(1, p);
    close(ra, phi[p], 1e-10, `phi of pixel ${p}`);
    close(Math.sin(dec * D2R), z[p], 1e-12, `z of pixel ${p}`);
  }
});

test('nside 2 pixel centres match the ring latitudes and nested order', () => {
  // Face 0 (pixels 0-3): S, E, W, N sub-pixels; face 4 (pixels 16-19) straddles ra = 0.
  const table = [
    [0, 45, 1 / 3], [1, 67.5, 2 / 3], [2, 22.5, 2 / 3], [3, 45, 11 / 12],
    [16, 0, -1 / 3], [17, 22.5, 0], [18, 337.5, 0], [19, 0, 1 / 3],
    [32, 45, -11 / 12], [35, 45, -1 / 3], [47, 315, -1 / 3],
  ];
  for (const [p, phi, z] of table) {
    const [ra, dec] = pix2angNest(2, p);
    close(ra, phi, 1e-10, `phi of pixel ${p}`);
    close(Math.sin(dec * D2R), z, 1e-12, `z of pixel ${p}`);
  }
  // Ring structure at nside 2: z = 11/12, 2/3, 1/3, 0, -1/3, -2/3, -11/12 with 4,8,8,8,8,8,4 pixels.
  const counts = new Map();
  for (let p = 0; p < 48; p++) {
    const zc = Math.round(Math.sin(pix2angNest(2, p)[1] * D2R) * 12);
    counts.set(zc, (counts.get(zc) || 0) + 1);
  }
  assert.deepEqual([...counts.entries()].sort((a, b) => b[0] - a[0]),
    [[11, 4], [8, 8], [4, 8], [0, 8], [-4, 8], [-8, 8], [-11, 4]]);
});

test('known directions fall in the right base faces', () => {
  assert.ok(ang2pixNest(1, 0, 90) <= 3, 'north pole is in faces 0-3');
  assert.ok(ang2pixNest(1, 123.4, 89.999) <= 3);
  assert.ok(ang2pixNest(1, 0, -90) >= 8, 'south pole is in faces 8-11');
  assert.equal(ang2pixNest(1, 10, 80), 0);
  assert.equal(ang2pixNest(1, 100, 80), 1);
  assert.equal(ang2pixNest(1, 190, 80), 2);
  assert.equal(ang2pixNest(1, 280, 80), 3);
  assert.equal(ang2pixNest(1, 0, 0), 4);
  assert.equal(ang2pixNest(1, 359.9, 0), 4);
  assert.equal(ang2pixNest(1, 90, 0), 5);
  assert.equal(ang2pixNest(1, 180, 0), 6);
  assert.equal(ang2pixNest(1, 270, 0), 7);
  assert.equal(ang2pixNest(1, 45, -80), 8);
  assert.equal(ang2pixNest(1, 315, -80), 11);
  // Just either side of the belt/cap boundary at phi = 45 (centre line of face 0).
  assert.equal(ang2pixNest(1, 45, 41.0), 0);
  assert.equal(ang2pixNest(1, 45, 42.5), 0);
  // The five challenge targets at nside 32 round trip through their own cell.
  for (const [ra, dec] of [[269.45, 4.69], [331.04, -56.78], [133.8, -7.25], [76.96, 30.4], [248.17, 66.75]]) {
    const p = ang2pixNest(32, ra, dec);
    assert.ok(sep([ra, dec], pix2angNest(32, p)) < 1.6, 'target lies near its cell centre');
  }
});

test('every pixel centre maps back to its own index', () => {
  for (const nside of [1, 2, 4, 8, 32]) {
    const n = npix(nside);
    for (let p = 0; p < n; p++) {
      const [ra, dec] = pix2angNest(nside, p);
      assert.ok(ra >= 0 && ra < 360 && dec > -90 && dec < 90);
      const q = ang2pixNest(nside, ra, dec);
      if (q !== p) assert.fail(`nside ${nside}: centre of ${p} (${ra}, ${dec}) mapped to ${q}`);
    }
  }
});

test('pixel centres are symmetric and balanced', () => {
  for (const nside of [4, 32]) {
    const n = npix(nside);
    const sum = [0, 0, 0];
    for (let p = 0; p < n; p++) {
      const [ra, dec] = pix2angNest(nside, p);
      const v = vec(ra, dec);
      sum[0] += v[0]; sum[1] += v[1]; sum[2] += v[2];
    }
    assert.ok(Math.hypot(...sum) < 1e-9 * n, 'centres sum to zero');
  }
});

test('longitude wrapping and bad input', () => {
  const p = ang2pixNest(32, 10, 20);
  assert.equal(ang2pixNest(32, 370, 20), p);
  assert.equal(ang2pixNest(32, -350, 20), p);
  assert.equal(ang2pixNest(32, 10 + 3600, 20), p);
  assert.equal(ang2pixNest(32, NaN, 0), -1);
  assert.equal(ang2pixNest(32, 0, Infinity), -1);
  const n = npix(32);
  for (const [ra, dec] of [[0, 90], [0, -90], [360, 0], [-1e-20, 0], [359.9999999999, 41.8103148957786],
    [0, 41.8103148957786], [90, -41.8103148957786], [180, 95], [270, -95]]) {
    const q = ang2pixNest(32, ra, dec);
    assert.ok(Number.isInteger(q) && q >= 0 && q < n, `(${ra}, ${dec}) -> ${q}`);
  }
});

test('random points always map inside [0, npix) and close to the cell centre', () => {
  for (const nside of [1, 2, 8, 32, 1024]) {
    const rand = mulberry32(1000 + nside);
    const n = npix(nside);
    const maxSep = 1.2 * cellSizeDeg(nside);
    for (let k = 0; k < 20000; k++) {
      const [ra, dec] = randomDir(rand);
      const p = ang2pixNest(nside, ra, dec);
      if (!(Number.isInteger(p) && p >= 0 && p < n)) assert.fail(`(${ra}, ${dec}) -> ${p}`);
      const d = sep([ra, dec], pix2angNest(nside, p));
      if (d > maxSep) assert.fail(`nside ${nside}: (${ra}, ${dec}) is ${d} deg from the centre of ${p}`);
    }
  }
});

test('pixels have equal area: Monte Carlo counts', () => {
  for (const [nside, total] of [[1, 240000], [4, 400000], [32, 1500000]]) {
    const rand = mulberry32(77 + nside);
    const n = npix(nside);
    const counts = new Uint32Array(n);
    for (let k = 0; k < total; k++) {
      const [ra, dec] = randomDir(rand);
      counts[ang2pixNest(nside, ra, dec)]++;
    }
    const expected = total / n;
    const sigma = Math.sqrt(expected);
    let chi2 = 0;
    let worst = 0;
    for (let p = 0; p < n; p++) {
      const dev = (counts[p] - expected) / sigma;
      chi2 += dev * dev;
      worst = Math.max(worst, Math.abs(dev));
    }
    const dof = n - 1;
    assert.ok(worst < 6, `nside ${nside}: worst pixel deviates by ${worst.toFixed(2)} sigma`);
    assert.ok(Math.abs(chi2 - dof) < 5 * Math.sqrt(2 * dof) + 5,
      `nside ${nside}: chi2 ${chi2.toFixed(1)} for ${dof} degrees of freedom`);
  }
});

test('pixels have equal area: boundary integral in the (phi, z) plane', () => {
  // The cylindrical map (phi, z) preserves area, so the shoelace area of a finely sampled
  // boundary must equal 4 pi / npix. Cells that touch a pole are skipped (phi is undefined there).
  for (const nside of [2, 4, 8]) {
    const want = (4 * Math.PI) / npix(nside);
    let tested = 0;
    for (let p = 0; p < npix(nside); p++) {
      const pts = cellCorners(nside, p, 48);
      if (pts.some(([, dec]) => Math.abs(dec) > 89.999999)) continue;
      const [ra0] = pix2angNest(nside, p);
      const xy = pts.map(([ra, dec]) => {
        let d = ra - ra0;
        d -= 360 * Math.round(d / 360);
        return [d * D2R, Math.sin(dec * D2R)];
      });
      let area = 0;
      for (let i = 0; i < xy.length; i++) {
        const a = xy[i];
        const b = xy[(i + 1) % xy.length];
        area += a[0] * b[1] - b[0] * a[1];
      }
      area = Math.abs(area) / 2;
      close(area / want, 1, 2e-3, `nside ${nside} pixel ${p} area ratio`);
      tested++;
    }
    assert.equal(tested, npix(nside) - 8, 'all but the eight polar cells tested');
  }
});

test('cellCorners returns the cell boundary', () => {
  // Base face 0 at nside 1: S (45, 0), E (90, z 2/3), N pole, W (0, z 2/3).
  const c = cellCorners(1, 0);
  assert.equal(c.length, 4);
  close(c[0][0], 45, 1e-10); close(c[0][1], 0, 1e-10);
  close(c[1][0], 90, 1e-10); close(Math.sin(c[1][1] * D2R), 2 / 3, 1e-12);
  close(c[2][1], 90, 1e-10);
  close(c[3][0], 0, 1e-10); close(Math.sin(c[3][1] * D2R), 2 / 3, 1e-12);
  // Base face 4: S (0, z -2/3), E (45, 0), N (0, z 2/3), W (315, 0).
  const e = cellCorners(1, 4);
  close(Math.sin(e[0][1] * D2R), -2 / 3, 1e-12);
  close(e[1][0], 45, 1e-10); close(e[1][1], 0, 1e-10);
  close(Math.sin(e[2][1] * D2R), 2 / 3, 1e-12);
  close(e[3][0], 315, 1e-10); close(e[3][1], 0, 1e-10);
  assert.equal(cellCorners(8, 100, 5).length, 20);

  // Boundary points pulled slightly towards the centre are inside the cell; pushed slightly
  // away from it they are outside.
  for (const nside of [1, 4, 8, 32]) {
    const n = npix(nside);
    const stride = nside === 32 ? 7 : 1;
    for (let p = 0; p < n; p += stride) {
      const centre = vec(...pix2angNest(nside, p));
      for (const pt of cellCorners(nside, p, 4)) {
        const b = vec(pt[0], pt[1]);
        const inside = unvec(b.map((v, i) => v + 1e-4 * (centre[i] - v)));
        const outside = unvec(b.map((v, i) => v - 1e-4 * (centre[i] - v)));
        if (ang2pixNest(nside, inside[0], inside[1]) !== p) assert.fail(`nside ${nside} pixel ${p}: boundary point (${pt}) not on the boundary (inside test)`);
        if (ang2pixNest(nside, outside[0], outside[1]) === p) assert.fail(`nside ${nside} pixel ${p}: boundary point (${pt}) not on the boundary (outside test)`);
      }
    }
  }
});

test('adjacent cells share corners (the tiling has no gaps)', () => {
  // Every corner of every cell is a corner of 3 or 4 cells in total; exactly 8 points have 3.
  const nside = 8;
  const seen = new Map();
  for (let p = 0; p < npix(nside); p++) {
    for (const [ra, dec] of cellCorners(nside, p)) {
      const v = vec(ra, dec).map((x) => Math.round(x * 1e9) / 1e9 + 0);
      const key = v.join(',');
      seen.set(key, (seen.get(key) || 0) + 1);
    }
  }
  let three = 0;
  for (const count of seen.values()) {
    assert.ok(count === 3 || count === 4, `corner shared by ${count} cells`);
    if (count === 3) three++;
  }
  assert.equal(three, 8);
  assert.equal(seen.size, npix(nside) + 2, 'Euler: V = F + 2 for a quad mesh with 8 three-valent vertices');
});

test('neighbours: across each edge and corner, and symmetric', () => {
  // Directions: SW, W, NW, N, NE, E, SE, S as offsets in (ix, iy).
  const dx = [-1, -1, 0, 1, 1, 1, 0, -1];
  const dy = [0, 1, 1, 1, 0, -1, -1, -1];
  for (const nside of [2, 4, 8, 32]) {
    const n = npix(nside);
    let missing = 0;
    for (let p = 0; p < n; p++) {
      const nb = neighboursNest(nside, p);
      assert.equal(nb.length, 8);
      const [ix, iy, face] = nest2xyf(nside, p);
      const centre = vec(...pix2angNest(nside, p));
      for (let i = 0; i < 8; i++) {
        const q = nb[i];
        if (q < 0) { missing++; continue; }
        assert.ok(q !== p && q < n);
        if (!neighboursNest(nside, q).includes(p)) assert.fail(`nside ${nside}: ${q} is a neighbour of ${p} but not the reverse`);
        const b = vec(...xyf2loc((ix + 0.5 + 0.5 * dx[i]) / nside, (iy + 0.5 + 0.5 * dy[i]) / nside, face));
        if (i % 2 === 0) {
          // Edge neighbour: step from the centre through the edge midpoint and a little beyond.
          const beyond = unvec(b.map((v, k) => v + 1e-3 * (v - centre[k])));
          const got = ang2pixNest(nside, beyond[0], beyond[1]);
          if (got !== q) assert.fail(`nside ${nside} pixel ${p} direction ${i}: table says ${q}, geometry says ${got}`);
        } else {
          // Corner neighbour: it touches this cell at that corner only, so it has the corner
          // among its own corners and is not one of the four edge neighbours.
          const touches = cellCorners(nside, q).some(([ra, dec]) => {
            const c = vec(ra, dec);
            return Math.hypot(c[0] - b[0], c[1] - b[1], c[2] - b[2]) < 1e-9;
          });
          if (!touches) assert.fail(`nside ${nside} pixel ${p} direction ${i}: ${q} does not touch the corner`);
          assert.ok(![nb[0], nb[2], nb[4], nb[6]].includes(q), 'corner neighbour is not an edge neighbour');
        }
      }
      assert.equal(new Set(nb.filter((q) => q >= 0)).size, nb.filter((q) => q >= 0).length, 'neighbours are distinct');
    }
    assert.equal(missing, 24, 'eight three-cell corners, three cells each');
  }
});
