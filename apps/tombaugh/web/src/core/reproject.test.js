// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// Tests for reproject.js. Run: node --test web/src/core/reproject.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reproject, reprojectMany, mapGridToFrame } from './reproject.js';
import { makeWcs, makeGrid, gridPixToSky, gridSkyToPix, tanProject, tanDeproject } from './wcs.js';
import { DEFAULT_BAD_MASK } from './flags.js';

const D2R = Math.PI / 180;

// WCS of a real SPHEREx Level-2 cutout (CONTRACT.md), 59 x 59 pixels around RA 210.80227,
// Dec 54.34895.
const REAL_WCS = {
  crpix: [-625.5, 511.5],
  crval: [208.4483499, 54.5491081503],
  pc: [
    [0.00123274981054, -0.00118000897293],
    [-0.00117635107879, -0.00123440903284],
  ],
  cdelt: [1, 1],
  sip: {
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

// A synthetic SPHEREx-like WCS: 6.15 arcsec pixels, rotated 37 degrees, normal parity, reference
// pixel far outside the array, SIP with zeroth to third order terms and no AP/BP.
function rotatedSipWcs() {
  const th = 37 * D2R;
  const s = 6.15 / 3600;
  return {
    crpix: [-300.5, 420.5],
    crval: [150, 30],
    pc: [
      [-s * Math.cos(th), s * Math.sin(th)],
      [s * Math.sin(th), s * Math.cos(th)],
    ],
    cdelt: [1, 1],
    sip: {
      a: { '0_0': 0.7, '1_0': 3e-4, '0_1': -2e-4, '2_0': 4e-6, '1_1': -3e-6, '0_2': 2e-6, '3_0': 3e-10, '1_2': -2e-10 },
      b: { '0_0': -1.2, '1_0': -1e-4, '0_1': 2e-4, '2_0': -2e-6, '1_1': 5e-6, '0_2': 1e-6, '0_3': -4e-10, '2_1': 1e-10 },
    },
  };
}

/** Build a Frame whose image is skyFn(ra, dec) + zodi evaluated at every native pixel centre. */
function makeFrame({ wcs, nx, ny, skyFn, zodi = 0.13, variance = 0.001, wave = null }) {
  const w = makeWcs(wcs);
  const np = nx * ny;
  const frame = {
    id: 'synthetic', det: 2, nx, ny, mjd: 61210.79, exptime: 113.6, release: 'test', obsid: 'test',
    wcs,
    image: new Float32Array(np),
    variance: new Float32Array(np).fill(variance),
    zodi: new Float32Array(np).fill(zodi),
    flags: new Int32Array(np),
    wave: new Float32Array(np),
    waveCenter: 1.3, bwCenter: 0.03, psfFwhm: 7.46,
  };
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      const [ra, dec] = w.pixToSky(x, y);
      frame.image[y * nx + x] = skyFn(ra, dec) + zodi;
      frame.wave[y * nx + x] = wave ? wave(x, y) : 1.6 - 0.0003 * y + 0.00001 * x;
    }
  }
  return frame;
}

function close(actual, expected, tol, msg) {
  assert.ok(Math.abs(actual - expected) <= tol, `${msg || 'value'}: got ${actual}, expected ${expected} +/- ${tol}`);
}

// ---------------------------------------------------------------------------------------------
// Geometry of the pixel map
// ---------------------------------------------------------------------------------------------

test('grid-to-frame map equals gridPixToSky followed by skyToPix', () => {
  for (const wcs of [REAL_WCS, rotatedSipWcs()]) {
    const w = makeWcs(wcs);
    const [ra0, dec0] = w.pixToSky(29, 29);
    const grid = makeGrid(ra0, dec0, 4);
    const map = mapGridToFrame(wcs, grid, { exact: true });
    assert.equal(map.exact, true);
    let worst = 0;
    for (let y = 0; y < grid.n; y += 3) {
      for (let x = 0; x < grid.n; x += 3) {
        const [ra, dec] = gridPixToSky(grid, x, y);
        const [px, py] = w.skyToPix(ra, dec);
        const o = y * grid.n + x;
        worst = Math.max(worst, Math.abs(map.x[o] - px), Math.abs(map.y[o] - py));
      }
    }
    assert.ok(worst < 1e-7, `exact map differs from the trigonometric route by ${worst} pixel`);
    // The grid centre is the frame pixel we built the grid on.
    const c = (grid.n - 1) / 2;
    const [cx, cy] = w.skyToPix(...gridPixToSky(grid, c, c));
    close(cx, 29, 1e-7);
    close(cy, 29, 1e-7);
  }
});

test('lattice-interpolated map is within 0.01 native pixel of the exact map', () => {
  const cases = [
    { name: 'real header, 4 arcmin', wcs: REAL_WCS, fov: 4 },
    { name: 'real header, 10 arcmin', wcs: REAL_WCS, fov: 10 },
    { name: 'rotated synthetic SIP, 6 arcmin', wcs: rotatedSipWcs(), fov: 6 },
    { name: 'rotated synthetic SIP, 10 arcmin', wcs: rotatedSipWcs(), fov: 10 },
  ];
  for (const c of cases) {
    const w = makeWcs(c.wcs);
    const [ra0, dec0] = w.pixToSky(29.4, 28.7);
    const grid = makeGrid(ra0, dec0, c.fov);
    const fast = mapGridToFrame(c.wcs, grid);
    const exact = mapGridToFrame(c.wcs, grid, { exact: true });
    assert.equal(fast.exact, false, `${c.name}: the lattice should be accepted`);
    let worst = 0;
    for (let i = 0; i < fast.x.length; i++) {
      worst = Math.max(worst, Math.abs(fast.x[i] - exact.x[i]), Math.abs(fast.y[i] - exact.y[i]));
    }
    assert.ok(worst < 0.01, `${c.name}: lattice error ${worst} pixel`);
    assert.ok(worst < 0.003, `${c.name}: lattice error ${worst} pixel should be near its 0.002 self-check`);
    assert.ok(fast.latticeError <= 0.002);
  }
  // On the real header the error is far below the tolerance.
  const w = makeWcs(REAL_WCS);
  const grid = makeGrid(...w.pixToSky(29, 29), 10);
  const fast = mapGridToFrame(REAL_WCS, grid);
  const exact = mapGridToFrame(REAL_WCS, grid, { exact: true });
  let worst = 0;
  for (let i = 0; i < fast.x.length; i++) {
    worst = Math.max(worst, Math.abs(fast.x[i] - exact.x[i]), Math.abs(fast.y[i] - exact.y[i]));
  }
  assert.equal(fast.step, 16);
  assert.ok(worst < 1e-3, `real header lattice error ${worst}`);
});

test('a wildly distorted WCS falls back to a finer lattice or the exact map', () => {
  const wcs = rotatedSipWcs();
  // Large quadratic terms: 5e-4 pix/pix^2 makes a 16-grid-pixel lattice wrong by ~0.01 pixel.
  wcs.crpix = [20.5, 30.5];
  wcs.sip = { a: { '2_0': 5e-4, '0_2': -4e-4 }, b: { '1_1': 6e-4, '0_2': 3e-4 } };
  const w = makeWcs(wcs);
  const grid = makeGrid(...w.pixToSky(30, 30), 4);
  const fast = mapGridToFrame(wcs, grid);
  const exact = mapGridToFrame(wcs, grid, { exact: true });
  assert.ok(fast.step < 16, `expected refinement, got step ${fast.step}`);
  let worst = 0;
  for (let i = 0; i < fast.x.length; i++) {
    worst = Math.max(worst, Math.abs(fast.x[i] - exact.x[i]), Math.abs(fast.y[i] - exact.y[i]));
  }
  assert.ok(worst < 0.01, `error after fallback ${worst}`);
});

// ---------------------------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------------------------

test('aligned frame: constant and linear images are reproduced exactly, orientation is right', () => {
  // North-up native frame with 6.15 arcsec pixels centred on the grid centre; the grid has
  // exactly half the pixel size, so grid pixel g maps to native pixel c_nat + (g - c_grid) / 2.
  const s = 6.15 / 3600;
  const nx = 41;
  const ny = 41;
  const wcs = { crpix: [21, 21], crval: [80, -20], pc: [[-s, 0], [0, s]], cdelt: [1, 1], sip: null };
  const frame = makeFrame({ wcs, nx, ny, skyFn: () => 0, zodi: 0 });
  // Ramp: 100 + 2 x + 5 y in native pixels (x toward west, y toward north).
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) frame.image[y * nx + x] = 100 + 2 * x + 5 * y;
  const grid = { ra0: 80, dec0: -20, n: 61, scale: 3.075 };
  const layer = reproject(frame, grid, { exact: true });
  const c = 30;
  for (let gy = 0; gy < grid.n; gy += 5) {
    for (let gx = 0; gx < grid.n; gx += 5) {
      const o = gy * grid.n + gx;
      assert.equal(layer.mask[o], 0);
      const px = 20 + (gx - c) / 2;
      const py = 20 + (gy - c) / 2;
      // Tangent-plane curvature over 1.5 arcmin is ~1e-7 pixel; float32 storage dominates.
      close(layer.image[o], 100 + 2 * px + 5 * py, 2e-4, `ramp at grid (${gx}, ${gy})`);
    }
  }
  // East (grid x = 0) must show the native west-to-east gradient: smaller native x.
  assert.ok(layer.image[c * grid.n + 0] < layer.image[c * grid.n + grid.n - 1]);
  // North (larger grid y) is larger native y.
  assert.ok(layer.image[(grid.n - 1) * grid.n + c] > layer.image[0 * grid.n + c]);
  // Lattice path gives the same answer.
  const fast = reproject(frame, grid);
  for (let o = 0; o < grid.n * grid.n; o++) close(fast.image[o], layer.image[o], 1e-3);
  // Constant surface brightness stays constant: no flux scaling when the pixel size changes.
  frame.image.fill(7.25);
  const flat = reproject(frame, grid);
  for (let o = 0; o < grid.n * grid.n; o++) assert.equal(flat.image[o], 7.25);
});

test('Gaussian source in a rotated SIP frame lands on the expected grid pixel', () => {
  const wcs = rotatedSipWcs();
  const w = makeWcs(wcs);
  const nx = 80;
  const ny = 72;
  // Grid centred near (not on) the frame centre; source 20 arcsec east, 30 arcsec north of it.
  const [gra, gdec] = w.pixToSky(41.3, 34.6);
  const grid = makeGrid(gra, gdec, 4);
  const [sra, sdec] = tanDeproject(20 / 3600, 30 / 3600, grid.ra0, grid.dec0);
  const peak = 50;
  const bg = 1.0;
  const zodi = 0.13;
  const sigma = 3 * 6.15; // arcsec; three native pixels, so the source is well sampled
  const model = (ra, dec) => {
    const [xi, eta] = tanProject(ra, dec, sra, sdec);
    const r2 = (xi * 3600) ** 2 + (eta * 3600) ** 2;
    return bg + peak * Math.exp(-r2 / (2 * sigma * sigma));
  };
  const frame = makeFrame({ wcs, nx, ny, skyFn: model, zodi });

  for (const opts of [{}, { exact: true }]) {
    const layer = reproject(frame, grid, opts);
    assert.equal(layer.frame, frame);
    assert.equal(layer.mjd, frame.mjd);
    assert.equal(layer.det, 2);
    assert.equal(layer.image.length, grid.n * grid.n);
    assert.ok(layer.image instanceof Float32Array && layer.variance instanceof Float32Array);
    assert.ok(layer.wave instanceof Float32Array && layer.mask instanceof Uint8Array);
    assert.equal(layer.zodiSubtracted, true);

    // Expected position: east is LEFT of centre (smaller x), north is larger y.
    const c = (grid.n - 1) / 2;
    const [ex, ey] = gridSkyToPix(grid, sra, sdec);
    close(ex, c - 20 / grid.scale, 1e-6, 'expected x');
    close(ey, c + 30 / grid.scale, 1e-6, 'expected y');

    // Flux-weighted centroid of the background-subtracted source.
    let sx = 0;
    let sy = 0;
    let sf = 0;
    let max = -Infinity;
    let maxAt = -1;
    let worstModel = 0;
    for (let y = 0; y < grid.n; y++) {
      for (let x = 0; x < grid.n; x++) {
        const o = y * grid.n + x;
        if (layer.mask[o]) continue;
        const v = layer.image[o];
        assert.ok(Number.isFinite(v) && Number.isFinite(layer.variance[o]) && Number.isFinite(layer.wave[o]));
        if (v > max) {
          max = v;
          maxAt = o;
        }
        if (Math.hypot(x - ex, y - ey) <= 14) {
          const f = v - bg;
          sx += f * x;
          sy += f * y;
          sf += f;
        }
        const truth = model(...gridPixToSky(grid, x, y));
        worstModel = Math.max(worstModel, Math.abs(v - truth));
      }
    }
    const cx = sx / sf;
    const cy = sy / sf;
    assert.ok(Math.hypot(cx - ex, cy - ey) < 0.1, `centroid (${cx}, ${cy}) vs expected (${ex}, ${ey})`);
    assert.ok(Math.abs(cx - ex) < 0.03 && Math.abs(cy - ey) < 0.03, `centroid offset ${cx - ex}, ${cy - ey}`);
    // The brightest grid pixel sits by the source. Bilinear interpolation peaks at a native
    // pixel centre, which can be up to 0.71 native pixel (1.4 grid pixels) from the true
    // position, and the nearest grid pixel adds up to 0.71 more.
    const peakOffset = Math.hypot((maxAt % grid.n) - ex, Math.floor(maxAt / grid.n) - ey);
    assert.ok(peakOffset < 2.2, `brightest pixel is ${peakOffset} grid pixels from the source`);
    // Peak surface brightness preserved (bilinear smoothing costs at most a few percent).
    const peakOut = max - bg;
    assert.ok(Math.abs(peakOut - peak) / peak < 0.03, `peak ${peakOut} vs ${peak}`);
    assert.ok(peakOut <= peak * 1.0001, 'interpolation never overshoots');
    // Everywhere, the layer agrees with the analytic sky at the grid pixel's own position.
    assert.ok(worstModel < 0.03 * peak, `worst deviation from the analytic sky: ${worstModel}`);
    // Most of the grid is covered by this frame.
    assert.ok(layer.coverage > 0.8 && layer.coverage <= 1, `coverage ${layer.coverage}`);
  }
});

test('zodi subtraction on and off, variance modes, wavelength interpolation', () => {
  const wcs = rotatedSipWcs();
  const w = makeWcs(wcs);
  const nx = 70;
  const ny = 70;
  const frame = makeFrame({ wcs, nx, ny, skyFn: () => 2.0, zodi: 0.5, variance: 0.004 });
  const grid = makeGrid(...w.pixToSky(34.5, 34.5), 3);
  const withZ = reproject(frame, grid);
  const noZ = reproject(frame, grid, { subtractZodi: false });
  const prop = reproject(frame, grid, { variance: 'propagate' });
  assert.equal(withZ.zodiSubtracted, true);
  assert.equal(noZ.zodiSubtracted, false);
  const map = mapGridToFrame(wcs, grid, { exact: true });
  let sawInterior = false;
  for (let o = 0; o < grid.n * grid.n; o++) {
    assert.equal(withZ.mask[o], 0, 'grid lies inside the frame');
    close(withZ.image[o], 2.0, 1e-5);
    close(noZ.image[o], 2.5, 1e-5);
    close(withZ.variance[o], 0.004, 1e-7, 'interpolated variance of a flat variance map');
    // Exact single-pixel variance: sum w^2 = ((1-fx)^2 + fx^2) ((1-fy)^2 + fy^2), between 1/4 and 1.
    const fx = map.x[o] - Math.floor(map.x[o]);
    const fy = map.y[o] - Math.floor(map.y[o]);
    const expected = 0.004 * ((1 - fx) ** 2 + fx ** 2) * ((1 - fy) ** 2 + fy ** 2);
    close(prop.variance[o], expected, 2e-5, 'propagated variance');
    assert.ok(prop.variance[o] <= 0.004 * 1.0001 && prop.variance[o] >= 0.001 * 0.999);
    // Wavelength is a linear function of native pixel, so bilinear interpolation is exact.
    close(withZ.wave[o], 1.6 - 0.0003 * map.y[o] + 0.00001 * map.x[o], 2e-6, 'wave');
    sawInterior = true;
  }
  assert.ok(sawInterior);
  // Inputs are untouched.
  close(frame.image[0], 2.5, 1e-6);
  close(frame.zodi[0], 0.5, 1e-6);
});

test('mask propagation: flagged, non-finite and off-frame pixels', () => {
  const wcs = rotatedSipWcs();
  const w = makeWcs(wcs);
  const nx = 40;
  const ny = 36;
  const frame = makeFrame({ wcs, nx, ny, skyFn: () => 3.0, zodi: 0.2 });
  const HOT = 1 << 10;
  const SOURCE = 1 << 21;
  const GHOST = 1 << 22;
  const idx = (x, y) => y * nx + x;
  frame.flags[idx(20, 18)] = HOT; // bad
  frame.image[idx(20, 18)] = 1e6; // and wildly wrong, to prove it cannot leak
  frame.flags[idx(10, 10)] = SOURCE; // not a defect
  frame.flags[idx(11, 10)] = SOURCE | GHOST; // advisory only
  frame.image[idx(30, 25)] = NaN; // bad
  frame.variance[idx(8, 28)] = Infinity; // bad
  frame.zodi[idx(31, 9)] = NaN; // bad while zodi is being subtracted
  frame.flags[idx(25, 5)] = (1 << 27) | SOURCE; // snowball: bad
  const isBad = (x, y) =>
    (x === 20 && y === 18) || (x === 30 && y === 25) || (x === 8 && y === 28) || (x === 31 && y === 9) || (x === 25 && y === 5);

  // Grid deliberately larger than the frame so that part of it is off-frame.
  const grid = makeGrid(...w.pixToSky(19.5, 17.5), 5);
  const map = mapGridToFrame(wcs, grid, { exact: true });

  for (const opts of [{}, { exact: true }]) {
    const layer = reproject(frame, grid, opts);
    let nOff = 0;
    let nBad = 0;
    let nGood = 0;
    for (let o = 0; o < grid.n * grid.n; o++) {
      const ix = Math.floor(map.x[o] + 0.5);
      const iy = Math.floor(map.y[o] + 0.5);
      // Skip grid pixels whose nearest-pixel decision is within the lattice error of a boundary.
      const edge = Math.min(
        Math.abs(map.x[o] + 0.5 - Math.round(map.x[o] + 0.5)),
        Math.abs(map.y[o] + 0.5 - Math.round(map.y[o] + 0.5)),
      );
      if (edge < 0.005) continue;
      const inside = ix >= 0 && ix < nx && iy >= 0 && iy < ny;
      const expectMask = !inside || isBad(ix, iy);
      assert.equal(layer.mask[o], expectMask ? 1 : 0, `mask at grid index ${o} (native ${ix}, ${iy})`);
      if (!inside) {
        nOff++;
        assert.ok(Number.isNaN(layer.image[o]) && Number.isNaN(layer.variance[o]) && Number.isNaN(layer.wave[o]));
      } else if (expectMask) {
        nBad++;
        assert.ok(Number.isNaN(layer.image[o]) && Number.isNaN(layer.variance[o]));
        assert.ok(Number.isFinite(layer.wave[o]), 'wavelength is still known under a flagged pixel');
      } else {
        nGood++;
        // Good neighbours of a bad pixel are interpolated from the remaining good ones only.
        close(layer.image[o], 3.0, 1e-4, `value at grid index ${o}`);
        close(layer.variance[o], 0.001, 1e-7);
        assert.ok(Number.isFinite(layer.wave[o]));
      }
    }
    assert.ok(nOff > 500, `off-frame pixels: ${nOff}`);
    // Each bad native pixel covers about 4 grid pixels (grid pixels are half the size).
    assert.ok(nBad >= 5 * 2 && nBad <= 5 * 6, `masked by bad native pixels: ${nBad}`);
    assert.ok(nGood > 3000);
    close(layer.coverage, layer.mask.reduce((s, m) => s + (1 - m), 0) / (grid.n * grid.n), 1e-12);
  }

  // badMask = 0 keeps flagged pixels (the hot one now shows its absurd value); NaN stays masked.
  const loose = reproject(frame, grid, { badMask: 0 });
  let sawHot = false;
  for (let o = 0; o < grid.n * grid.n; o++) {
    if (!loose.mask[o] && loose.image[o] > 1000) sawHot = true;
    if (Math.floor(map.x[o] + 0.5) === 30 && Math.floor(map.y[o] + 0.5) === 25) {
      const edge = Math.min(Math.abs(map.x[o] - 29.5), Math.abs(map.x[o] - 30.5), Math.abs(map.y[o] - 24.5), Math.abs(map.y[o] - 25.5));
      if (edge > 0.005) assert.equal(loose.mask[o], 1);
    }
  }
  assert.ok(sawHot);

  // A custom mask that also rejects SOURCE pixels masks more.
  const strict = reproject(frame, grid, { badMask: DEFAULT_BAD_MASK | SOURCE });
  const count = (l) => l.mask.reduce((s, m) => s + m, 0);
  assert.ok(count(strict) > count(reproject(frame, grid)));

  // Without zodi subtraction a NaN in the zodi model no longer matters.
  const noZ = reproject(frame, grid, { subtractZodi: false });
  assert.ok(count(noZ) < count(reproject(frame, grid)));

  // `fill` controls what masked pixels hold.
  const zeroFill = reproject(frame, grid, { fill: 0 });
  for (let o = 0; o < grid.n * grid.n; o++) if (zeroFill.mask[o]) assert.equal(zeroFill.image[o], 0);
});

test('frames that miss the grid, or are incomplete, do not throw', () => {
  const wcs = rotatedSipWcs();
  const frame = makeFrame({ wcs, nx: 20, ny: 20, skyFn: () => 1, zodi: 0 });
  // Grid 2 degrees away: everything masked.
  const far = reproject(frame, makeGrid(152.5, 30, 4));
  assert.equal(far.coverage, 0);
  assert.ok(far.mask.every((m) => m === 1));
  assert.ok(far.image.every((v) => Number.isNaN(v)));
  // Grid on the opposite side of the sky.
  const opposite = reproject(frame, makeGrid(330, -30, 4));
  assert.equal(opposite.coverage, 0);
  // Optional arrays missing: still works; variance unknown, wavelength from waveCenter.
  const w = makeWcs(wcs);
  const bare = { nx: 20, ny: 20, wcs, image: frame.image, mjd: 1, det: 3, waveCenter: 2.2 };
  const layer = reproject(bare, makeGrid(...w.pixToSky(9.5, 9.5), 1));
  assert.ok(layer.coverage > 0.9);
  const o = layer.mask.indexOf(0);
  close(layer.image[o], 1, 1e-6);
  assert.ok(Number.isNaN(layer.variance[o]));
  close(layer.wave[o], 2.2, 1e-6);
  // Programming errors are reported clearly.
  assert.throws(() => reproject(null, makeGrid(0, 0, 1)), TypeError);
  assert.throws(() => reproject({ nx: 2, ny: 2, wcs }, makeGrid(0, 0, 1)), TypeError);
});

test('real header: a point at the cutout centre reprojects to the grid centre', () => {
  const nx = 59;
  const ny = 59;
  const sra = 210.80227;
  const sdec = 54.34895;
  const sigma = 2.5 * 6.15;
  const model = (ra, dec) => {
    const [xi, eta] = tanProject(ra, dec, sra, sdec);
    return 0.89 + 51.6 * Math.exp(-((xi * 3600) ** 2 + (eta * 3600) ** 2) / (2 * sigma * sigma));
  };
  const frame = makeFrame({ wcs: REAL_WCS, nx, ny, skyFn: model, zodi: 0.13 });
  const grid = makeGrid(sra, sdec, 4);
  const layer = reproject(frame, grid);
  const c = (grid.n - 1) / 2;
  let sx = 0;
  let sy = 0;
  let sf = 0;
  for (let y = 0; y < grid.n; y++) {
    for (let x = 0; x < grid.n; x++) {
      const o = y * grid.n + x;
      if (layer.mask[o] || Math.hypot(x - c, y - c) > 14) continue;
      const f = layer.image[o] - 0.89;
      sx += f * x;
      sy += f * y;
      sf += f;
    }
  }
  close(sx / sf, c, 0.05, 'centroid x');
  close(sy / sf, c, 0.05, 'centroid y');
  close(layer.image[c * grid.n + c], 0.89 + 51.6, 0.03 * 51.6, 'peak');
  // A 59-pixel cutout (6.05 arcmin) rotated by ~44 degrees still covers the 4 arcmin grid.
  assert.equal(layer.coverage, 1);
});

// ---------------------------------------------------------------------------------------------
// reprojectMany
// ---------------------------------------------------------------------------------------------

test('reprojectMany: order, progress, failed frames, yielding and abort', async () => {
  const wcs = rotatedSipWcs();
  const w = makeWcs(wcs);
  const grid = makeGrid(...w.pixToSky(29.5, 29.5), 4);
  const frames = [];
  for (let i = 0; i < 40; i++) {
    const f = makeFrame({ wcs, nx: 60, ny: 60, skyFn: () => i, zodi: 0 });
    f.mjd = 61000 + i;
    frames.push(f);
  }
  frames.splice(7, 0, { nx: 60, ny: 60, wcs: null, image: new Float32Array(3600), mjd: 0 }); // broken WCS
  frames.splice(20, 0, null); // not a frame at all

  const progress = [];
  let ticks = 0;
  const timer = setInterval(() => ticks++, 0);
  const layers = await reprojectMany(frames, grid, { subtractZodi: false }, (p) => progress.push({ ...p }));
  clearInterval(timer);

  assert.equal(layers.length, 40);
  layers.forEach((l, i) => {
    assert.equal(l.mjd, 61000 + i, 'input order is kept');
    close(l.image[Math.floor((grid.n * grid.n) / 2)], i, 1e-6);
  });
  const last = progress[progress.length - 1];
  assert.deepEqual(last, { done: 42, total: 42, failed: 2, phase: 'reproject' });
  for (let i = 1; i < progress.length; i++) assert.ok(progress[i].done > progress[i - 1].done);
  // Every intermediate progress report corresponds to a real yield to the event loop.
  if (progress.length > 1) assert.ok(ticks >= 1, 'the event loop ran while reprojecting');

  // Results are identical to calling reproject directly.
  const direct = reproject(frames[3], grid, { subtractZodi: false });
  assert.deepEqual(layers[3].image, direct.image);

  // Empty input and a throwing progress handler are harmless.
  assert.deepEqual(await reprojectMany([], grid), []);
  const again = await reprojectMany(frames.slice(0, 3), grid, {}, () => {
    throw new Error('handler bug');
  });
  assert.equal(again.length, 3);

  // Abort.
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(reprojectMany(frames, grid, { signal: controller.signal }), { name: 'AbortError' });
});
