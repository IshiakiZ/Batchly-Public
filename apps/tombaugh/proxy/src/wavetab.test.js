// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

import test from 'node:test';
import assert from 'node:assert/strict';

import { waveAt, bandwidthAt, waveMap, bandwidthMap, detectorXY } from './wavetab.js';

const close = (actual, expected, tol, message) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${message ?? 'value'}: ${actual} is not within ${tol} of ${expected}`);

// Index vectors of the real WCS-WAVE table (note the uneven step 1021 -> 1224).
const NODES = [1, 205, 409, 613, 817, 1021, 1224, 1428, 1632, 1836, 2040];

/** Hand-built table in the readWaveTable shape, filled from analytic functions of (x, y). */
function makeTable(wave, bandwidth, xs = NODES, ys = NODES) {
  const nx = xs.length;
  const ny = ys.length;
  const values = new Float32Array(2 * nx * ny);
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      values[2 * (ix + nx * iy)] = wave(xs[ix], ys[iy]);
      values[2 * (ix + nx * iy) + 1] = bandwidth(xs[ix], ys[iy]);
    }
  }
  return { x: Int32Array.from(xs), y: Int32Array.from(ys), values, nx, ny, nk: 2 };
}

// Detector-2-like table carrying the real numbers quoted in the contract: the first VALUES
// entries are 1.6677 (wavelength at x=1, y=1), 0.03979 (its bandwidth), 1.66112 (x=205, y=1);
// along y = 1 the wavelength dips to about 1.6501 at the centre column and returns to 1.6675.
const ROW1 = [1.6677, 1.66112, 1.6563, 1.6529, 1.6508, 1.6501, 1.6508, 1.6529, 1.6563, 1.6611, 1.6675];
const realLike = makeTable(
  (x, y) => ROW1[NODES.indexOf(x)] * Math.pow(1.095 / 1.6677, (y - 1) / 2039),
  (x, y) => (ROW1[NODES.indexOf(x)] * Math.pow(1.095 / 1.6677, (y - 1) / 2039)) / 41.912,
);

// The image header keys that locate a cutout on the detector, from the real file.
const REAL_HEADER = new Map([
  ['NAXIS1', 59], ['NAXIS2', 59],
  ['CTYPE1W', 'WAVE-TAB'], ['CTYPE2W', 'WAVE-TAB'],
  ['CRPIX1W', -1645.0], ['CRPIX2W', -508.0], ['CDELT1W', 1], ['CDELT2W', 1], ['CRVAL1W', 1], ['CRVAL2W', 1],
  ['CTYPE1A', 'LINEAR'], ['CTYPE2A', 'LINEAR'],
  ['CRPIX1A', -1645.0], ['CRPIX2A', -508.0], ['CRVAL1A', 0.0], ['CRVAL2A', 0.0],
]);

test('the real table numbers come back at the first nodes', () => {
  assert.equal(realLike.values[0], Math.fround(1.6677));
  assert.equal(realLike.values[2], Math.fround(1.66112));
  close(realLike.values[1], 0.03979, 1e-5, 'first bandwidth');

  const first = waveAt(realLike, 1, 1);
  close(first.wave, 1.6677, 1e-6, 'wave at (1, 1)');
  close(first.bandwidth, 0.03979, 1e-5, 'bandwidth at (1, 1)');
  close(waveAt(realLike, 205, 1).wave, 1.66112, 1e-6, 'wave at (205, 1)');
  close(waveAt(realLike, 409, 1).wave, 1.6563, 1e-6);
  close(waveAt(realLike, 1021, 1).wave, 1.6501, 1e-6, 'smile minimum');
  close(waveAt(realLike, 2040, 1).wave, 1.6675, 1e-6);
  close(waveAt(realLike, 1, 2040).wave, 1.095, 1e-6, 'far end of the detector');
  // Halfway between the first two nodes along x.
  close(waveAt(realLike, 103, 1).wave, (1.6677 + 1.66112) / 2, 1e-6);
  // A quarter of the way: 1 + 51 = 52.
  close(waveAt(realLike, 52, 1).wave, 1.6677 + 0.25 * (1.66112 - 1.6677), 1e-6);
});

test('waveAt reproduces every table node exactly', () => {
  for (let iy = 0; iy < 11; iy++) {
    for (let ix = 0; ix < 11; ix++) {
      const { wave, bandwidth } = waveAt(realLike, NODES[ix], NODES[iy]);
      assert.equal(wave, realLike.values[2 * (ix + 11 * iy)], `wave node ${ix},${iy}`);
      assert.equal(bandwidth, realLike.values[2 * (ix + 11 * iy) + 1], `bandwidth node ${ix},${iy}`);
      assert.equal(bandwidthAt(realLike, NODES[ix], NODES[iy]), bandwidth);
    }
  }
});

test('waveAt interpolates bilinearly, also across the uneven node spacing', () => {
  // A function that is linear in x and in y (with a cross term) is reproduced exactly by
  // bilinear interpolation inside every cell, whatever the node spacing.
  const f = (x, y) => 5 - 0.001 * x - 0.0015 * y + 2e-7 * x * y;
  const g = (x, y) => 0.01 + 1e-5 * x + 2e-5 * y;
  const table = makeTable(f, g);
  // Note: within a cell bilinear interpolation of a bilinear function is exact only if the
  // function is bilinear on that cell, which x*y is.
  const points = [[1, 1], [2, 3], [103.5, 77.25], [1020.5, 1020.5], [1021, 1224], [1122.5, 1326], [1223.9, 1224.1], [1676, 539], [2039.5, 2039.5], [2040, 2040], [300, 2040], [2040, 5]];
  for (const [x, y] of points) {
    const { wave, bandwidth } = waveAt(table, x, y);
    close(wave, f(x, y), 2e-6, `wave at ${x},${y}`);
    close(bandwidth, g(x, y), 1e-7, `bandwidth at ${x},${y}`);
  }
  // Centre of a cell = mean of its four corners.
  const corners = [waveAt(realLike, 613, 817), waveAt(realLike, 817, 817), waveAt(realLike, 613, 1021), waveAt(realLike, 817, 1021)];
  const mean = corners.reduce((s, c) => s + c.wave, 0) / 4;
  close(waveAt(realLike, 715, 919).wave, mean, 1e-6);
  // Within the 1021..1224 cell (203 wide, not 204) the weights follow the true spacing.
  const a = waveAt(realLike, 1021, 1).wave;
  const b = waveAt(realLike, 1224, 1).wave;
  close(waveAt(realLike, 1021 + 203 * 0.3, 1).wave, a + 0.3 * (b - a), 1e-6);
});

test('waveAt clamps outside the table and tolerates bad input', () => {
  assert.equal(waveAt(realLike, -50, 1).wave, waveAt(realLike, 1, 1).wave);
  assert.equal(waveAt(realLike, 0.5, 0.5).wave, waveAt(realLike, 1, 1).wave);
  assert.equal(waveAt(realLike, 5000, 1).wave, waveAt(realLike, 2040, 1).wave);
  assert.equal(waveAt(realLike, 700, -3).wave, waveAt(realLike, 700, 1).wave);
  assert.equal(waveAt(realLike, 700, 2040.5).wave, waveAt(realLike, 700, 2040).wave);
  assert.equal(waveAt(realLike, 1e9, 1e9).wave, waveAt(realLike, 2040, 2040).wave);
  assert.ok(Number.isNaN(waveAt(realLike, NaN, 5).wave));
  assert.ok(Number.isNaN(waveAt(realLike, 5, NaN).bandwidth));

  // Wavelength decreases monotonically with detector y at fixed x, as in detector 2.
  let previous = Infinity;
  for (let y = 1; y <= 2040; y += 7) {
    const w = waveAt(realLike, 1500, y).wave;
    assert.ok(w < previous, `not monotonic at y = ${y}`);
    previous = w;
  }
});

test('waveAt handles small, descending and single-plane tables', () => {
  // 2 x 3 table with a descending y index vector.
  const table = makeTable((x, y) => x + 10 * y, () => 0.5, [0, 10], [30, 20, 10]);
  close(waveAt(table, 5, 25).wave, 5 + 250, 1e-4);
  close(waveAt(table, 10, 12).wave, 10 + 120, 1e-4);
  assert.equal(waveAt(table, 0, 99).wave, 300); // clamped to the first node (y = 30)
  assert.equal(waveAt(table, 0, -99).wave, 100);

  // One node along x: no interpolation in that direction.
  const column = makeTable((x, y) => y, () => 1, [7], [1, 3]);
  close(waveAt(column, 123, 2).wave, 2, 1e-6);

  // A table with only the wavelength plane has no bandwidth.
  const single = { x: Int32Array.from([1, 3]), y: Int32Array.from([1, 3]), values: Float32Array.from([1, 2, 3, 4]), nx: 2, ny: 2, nk: 1 };
  const got = waveAt(single, 2, 2);
  close(got.wave, 2.5, 1e-6);
  assert.ok(Number.isNaN(got.bandwidth));

  // nk defaults to 2 when a table object lacks it (the contract's shape has no nk).
  const { nk: _nk, ...bare } = realLike;
  assert.equal(waveAt(bare, 205, 1).wave, Math.fround(1.66112));
});

test('detectorXY applies the W alternate WCS of the real header', () => {
  // det = CRVAL1W + CDELT1W * (p - CRPIX1W) = p + 1646: FITS pixel (1, 1) is detector (1647, 510).
  assert.deepEqual(detectorXY(REAL_HEADER, 0, 0), [1647, 510]);
  assert.deepEqual(detectorXY(REAL_HEADER, 29, 29), [1676, 539]);
  assert.deepEqual(detectorXY(REAL_HEADER, 58, 58), [1705, 568]);
  assert.deepEqual(detectorXY(REAL_HEADER, 28.5, 0.25), [1675.5, 510.25]);
});

test('waveMap gives the wavelength of every cutout pixel', () => {
  const nx = 59;
  const ny = 59;
  const map = waveMap(realLike, REAL_HEADER, nx, ny);
  const bw = bandwidthMap(realLike, REAL_HEADER, nx, ny);
  assert.ok(map instanceof Float32Array);
  assert.equal(map.length, nx * ny);
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      const expected = waveAt(realLike, x + 1647, y + 510);
      assert.equal(map[y * nx + x], Math.fround(expected.wave), `pixel ${x},${y}`);
      assert.equal(bw[y * nx + x], Math.fround(expected.bandwidth));
    }
  }
  // Row-major: wavelength changes mostly along y (index step nx), slightly along x.
  const alongY = Math.abs(map[nx * 58 + 29] - map[29]);
  const alongX = Math.abs(map[nx * 29 + 58] - map[nx * 29]);
  assert.ok(alongY > 5 * alongX, `along y ${alongY}, along x ${alongX}`);
  assert.ok(map[29] > map[nx * 58 + 29], 'wavelength falls with y');
  // Detector rows 510..568 of a table running 1.667 -> 1.095 um: about 1.49 um.
  assert.ok(map.every((w) => w > 1.45 && w < 1.52));

  // Non-square cutouts keep x and y straight.
  const wide = waveMap(realLike, REAL_HEADER, 7, 3);
  assert.equal(wide.length, 21);
  assert.equal(wide[2 * 7 + 6], Math.fround(waveAt(realLike, 6 + 1647, 2 + 510).wave));
});

test('waveMap honours CDELT/CRVAL, falls back to the A keys, and reports a header without either', () => {
  // A binned, offset axis description: det = 101 + 2 * (p - 0.5).
  const odd = new Map([['CRPIX1W', 0.5], ['CRVAL1W', 101], ['CDELT1W', 2], ['CRPIX2W', 1], ['CRVAL2W', 300], ['CDELT2W', -1]]);
  assert.deepEqual(detectorXY(odd, 0, 0), [102, 300]);
  assert.deepEqual(detectorXY(odd, 3, 10), [108, 290]);
  const map = waveMap(realLike, odd, 4, 11);
  assert.equal(map[10 * 4 + 3], Math.fround(waveAt(realLike, 108, 290).wave));

  // Only the 'A' (0-based detector pixel) keys: same answer as the W keys.
  const onlyA = new Map([['CRPIX1A', -1645.0], ['CRPIX2A', -508.0], ['CRVAL1A', 0.0], ['CRVAL2A', 0.0]]);
  assert.deepEqual(detectorXY(onlyA, 0, 0), [1647, 510]);
  assert.deepEqual(Array.from(waveMap(realLike, onlyA, 5, 5)), Array.from(waveMap(realLike, REAL_HEADER, 5, 5)));

  // Plain objects work as headers too.
  assert.deepEqual(detectorXY({ CRPIX1W: -1645, CRPIX2W: -508 }, 0, 0), [1647, 510]);

  assert.throws(() => waveMap(realLike, new Map([['NAXIS1', 59]]), 59, 59), /CRPIX1W/);
});
