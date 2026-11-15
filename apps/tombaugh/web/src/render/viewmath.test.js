// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  tanProject,
  tanDeproject,
  gridSkyToPix,
  gridPixToSky,
  letterbox,
  defaultView,
  maxZoomFor,
  clampView,
  pixelScale,
  gridToCanvas,
  canvasToGrid,
  skyToCanvas,
  canvasToSky,
  imageRect,
  zoomAbout,
  panBy,
  nearestPixel,
  pickScaleBar,
  formatAngle,
  formatValue,
  formatDeg,
  mjdToIso,
  maskRuns,
} from './viewmath.js';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b} (tol ${tol})`);

const grid = { ra0: 269.45, dec0: 4.69, n: 80, scale: 3.075 };
const view = (g, extra = {}) => ({ n: g.n, size: 600, ox: 20, oy: 10, ...defaultView(g.n), ...extra });

test('tangent projection round-trips, also near the pole and across RA = 0', () => {
  const cases = [
    [269.45, 4.69, 269.47, 4.71],
    [0.01, 89.2, 359.6, 89.25],
    [359.99, -30, 0.02, -30.03],
    [120, -75, 120.3, -75.1],
  ];
  for (const [ra0, dec0, ra, dec] of cases) {
    const [xi, eta] = tanProject(ra, dec, ra0, dec0);
    const [ra2, dec2] = tanDeproject(xi, eta, ra0, dec0);
    const dra = ((ra2 - ra + 540) % 360) - 180;
    close(dra, 0, 1e-9, 'ra');
    close(dec2, dec, 1e-9, 'dec');
  }
});

test('tangent projection: centre maps to zero, east is +xi, north is +eta, far side is NaN', () => {
  const [xi0, eta0] = tanProject(10, 20, 10, 20);
  close(xi0, 0, 1e-12);
  close(eta0, 0, 1e-12);
  const [xiE] = tanProject(10.01, 20, 10, 20);
  assert.ok(xiE > 0);
  // 0.01 deg of RA at dec 20 is 0.01 * cos(20 deg) on the sky
  close(xiE, 0.01 * Math.cos((20 * Math.PI) / 180), 1e-7);
  const [, etaN] = tanProject(10, 20.01, 10, 20);
  close(etaN, 0.01, 1e-7);
  const far = tanProject(190, -20, 10, 20);
  assert.ok(Number.isNaN(far[0]) && Number.isNaN(far[1]));
});

test('grid convention: centre pixel is (n-1)/2, x decreases to the east, y increases to the north', () => {
  const c = (grid.n - 1) / 2;
  const [x0, y0] = gridSkyToPix(grid, grid.ra0, grid.dec0);
  close(x0, c, 1e-9);
  close(y0, c, 1e-9);
  // 30.75 arcsec north = 10 pixels up in y
  const [xn, yn] = gridSkyToPix(grid, grid.ra0, grid.dec0 + 30.75 / 3600);
  close(xn, c, 1e-6);
  close(yn, c + 10, 1e-4);
  // east (larger RA) = smaller x
  const dRa = 30.75 / 3600 / Math.cos((grid.dec0 * Math.PI) / 180);
  const [xe, ye] = gridSkyToPix(grid, grid.ra0 + dRa, grid.dec0);
  close(xe, c - 10, 1e-4);
  close(ye, c, 1e-3);
  // contract formula, inverted
  const [ra, dec] = gridPixToSky(grid, c - 4, c + 7);
  const [xi, eta] = tanProject(ra, dec, grid.ra0, grid.dec0);
  close(xi * 3600, -(c - 4 - c) * grid.scale, 1e-6);
  close(eta * 3600, (c + 7 - c) * grid.scale, 1e-6);
});

test('sky <-> grid round trip over the whole raster', () => {
  for (const g of [grid, { ra0: 0.001, dec0: -88.9, n: 200, scale: 3.075 }, { ra0: 180, dec0: 0, n: 59, scale: 6.15 }]) {
    for (const [x, y] of [[0, 0], [g.n - 1, 0], [0, g.n - 1], [g.n - 1, g.n - 1], [12.3, 45.6], [-0.5, g.n - 0.5]]) {
      const [ra, dec] = gridPixToSky(g, x, y);
      assert.ok(ra >= 0 && ra < 360);
      const [x2, y2] = gridSkyToPix(g, ra, dec);
      close(x2, x, 1e-6, 'x');
      close(y2, y, 1e-6, 'y');
    }
  }
});

test('grid <-> canvas round trip at several zooms and offsets', () => {
  for (const extra of [{}, { zoom: 3, cx: 20.5, cy: 61.25 }, { zoom: 11.7, cx: 70, cy: 9 }]) {
    const t = view(grid, extra);
    for (const [x, y] of [[0, 0], [79, 79], [39.5, 39.5], [3.25, 70.5]]) {
      const [u, v] = gridToCanvas(t, x, y);
      const [x2, y2] = canvasToGrid(t, u, v);
      close(x2, x, 1e-9);
      close(y2, y, 1e-9);
    }
  }
});

test('sky <-> canvas round trip', () => {
  const t = view(grid, { zoom: 2.5, cx: 30, cy: 50 });
  for (const [u, v] of [[20, 10], [320, 310], [619.5, 609.5], [123.4, 567.8]]) {
    const [ra, dec] = canvasToSky(grid, t, u, v);
    const [u2, v2] = skyToCanvas(grid, t, ra, dec);
    close(u2, u, 1e-5);
    close(v2, v, 1e-5);
  }
});

test('orientation: north is up and east is left on the canvas', () => {
  const t = view(grid);
  const [uc, vc] = skyToCanvas(grid, t, grid.ra0, grid.dec0);
  close(uc, t.ox + t.size / 2, 1e-6, 'centre u');
  close(vc, t.oy + t.size / 2, 1e-6, 'centre v');
  const [un, vn] = skyToCanvas(grid, t, grid.ra0, grid.dec0 + 0.01);
  assert.ok(vn < vc, 'a point north of centre is nearer the top');
  close(un, uc, 1e-3);
  const [us, vs] = skyToCanvas(grid, t, grid.ra0, grid.dec0 - 0.01);
  assert.ok(vs > vc, 'a point south of centre is nearer the bottom');
  close(us, uc, 1e-3);
  const [ue, ve] = skyToCanvas(grid, t, grid.ra0 + 0.01, grid.dec0);
  assert.ok(ue < uc, 'a point east of centre (larger RA) is to the left');
  close(ve, vc, 0.05);
  const [uw] = skyToCanvas(grid, t, grid.ra0 - 0.01, grid.dec0);
  assert.ok(uw > uc, 'a point west of centre is to the right');
  // array row 0 (south) is drawn at the bottom, column 0 (east) at the left
  const [u00, v00] = gridToCanvas(t, 0, 0);
  const [u11, v11] = gridToCanvas(t, grid.n - 1, grid.n - 1);
  assert.ok(v00 > v11 && u00 < u11);
  const [raL] = canvasToSky(grid, t, t.ox + 5, t.oy + t.size / 2);
  const [raR] = canvasToSky(grid, t, t.ox + t.size - 5, t.oy + t.size / 2);
  assert.ok(raL > raR, 'RA increases to the left');
});

test('orientation holds in the southern sky and next to RA = 0', () => {
  const g = { ra0: 0.002, dec0: -62, n: 100, scale: 3.075 };
  const t = view(g);
  const [uc, vc] = skyToCanvas(g, t, g.ra0, g.dec0);
  const [, vn] = skyToCanvas(g, t, g.ra0, g.dec0 + 0.01);
  const [ue] = skyToCanvas(g, t, g.ra0 + 0.01, g.dec0);
  const [uw] = skyToCanvas(g, t, 359.995, g.dec0);
  assert.ok(vn < vc && ue < uc && uw > uc);
});

test('whole image exactly fills the viewport at zoom 1; pixel scale follows zoom', () => {
  const t = view(grid);
  const r = imageRect(t);
  close(r.x, t.ox, 1e-9);
  close(r.y, t.oy, 1e-9);
  close(r.w, t.size, 1e-9);
  close(r.h, t.size, 1e-9);
  close(pixelScale(t), 7.5, 1e-12);
  close(pixelScale({ ...t, zoom: 4 }), 30, 1e-12);
  // pixel (0, n-1) is the top-left cell: its centre is half a cell inside the corner
  const [u, v] = gridToCanvas(t, 0, grid.n - 1);
  close(u, t.ox + 3.75, 1e-9);
  close(v, t.oy + 3.75, 1e-9);
});

test('zoomAbout keeps the point under the cursor fixed', () => {
  const t = view(grid, { zoom: 2, cx: 30, cy: 45 });
  const u = 250, v = 333;
  const before = canvasToGrid(t, u, v);
  const nv = zoomAbout(t, u, v, 1.7);
  close(nv.zoom, 3.4, 1e-12);
  const after = canvasToGrid({ ...t, ...nv }, u, v);
  close(after[0], before[0], 1e-9);
  close(after[1], before[1], 1e-9);
});

test('zoom and pan are limited: never below 1x, never past the image edge', () => {
  const t = view(grid);
  const out = zoomAbout(t, 100, 100, 0.2);
  assert.deepEqual(out, defaultView(grid.n));
  const maxed = zoomAbout(t, 320, 310, 1e6);
  assert.equal(maxed.zoom, maxZoomFor(grid.n));
  // pan far to the right at 4x: clamps so the image edge meets the viewport edge
  const z = { ...t, zoom: 4, cx: 39.5, cy: 39.5 };
  const p = panBy(z, 1e5, -1e5);
  const r = imageRect({ ...z, ...p });
  close(r.x, t.ox, 1e-6, 'left edge');
  close(r.y + r.h, t.oy + t.size, 1e-6, 'bottom edge');
  // at 1x panning does nothing
  assert.deepEqual(panBy(t, 80, -40), defaultView(grid.n));
  // garbage in, sane view out
  assert.deepEqual(clampView(grid.n, { zoom: NaN, cx: NaN, cy: Infinity }), defaultView(grid.n));
});

test('panBy moves the image with the pointer', () => {
  const t = view(grid, { zoom: 4, cx: 39.5, cy: 39.5 });
  const [u0, v0] = gridToCanvas(t, 40, 40);
  const nv = panBy(t, 30, -20);
  const [u1, v1] = gridToCanvas({ ...t, ...nv }, 40, 40);
  close(u1 - u0, 30, 1e-9);
  close(v1 - v0, -20, 1e-9);
});

test('letterbox centres the largest square', () => {
  assert.deepEqual(letterbox(800, 600), { ox: 100, oy: 0, size: 600 });
  assert.deepEqual(letterbox(360, 500), { ox: 0, oy: 70, size: 360 });
  assert.deepEqual(letterbox(0, 0), { ox: 0, oy: 0, size: 0 });
});

test('nearestPixel', () => {
  assert.equal(nearestPixel(80, 0.4, 0.49), 0);
  assert.equal(nearestPixel(80, 2.6, 1.2), 80 + 3);
  assert.equal(nearestPixel(80, -0.6, 3), -1);
  assert.equal(nearestPixel(80, 79.6, 3), -1);
  assert.equal(nearestPixel(80, NaN, 3), -1);
});

test('scale bar picks round lengths', () => {
  // 80 px grid at 3.075"/px in a 600 px viewport: 0.41 arcsec per CSS px, bar up to 150 px
  const a = pickScaleBar(3.075 / 7.5, 150);
  assert.equal(a.arcsec, 60);
  assert.equal(a.label, '1 arcmin');
  close(a.px, 60 / (3.075 / 7.5), 1e-9);
  assert.equal(pickScaleBar(1, 35).arcsec, 30);
  assert.equal(pickScaleBar(1, 29).arcsec, 10);
  assert.equal(pickScaleBar(1, 130).label, '2 arcmin');
  assert.equal(pickScaleBar(2.5, 130).label, '5 arcmin');
  assert.equal(pickScaleBar(0.02, 130).label, '2 arcsec');
  assert.equal(pickScaleBar(0, 100), null);
  for (const s of [0.01, 0.1, 0.41, 1, 3, 10]) {
    const b = pickScaleBar(s, 120);
    assert.ok(b.px <= 120 + 1e-9, `bar fits at ${s}`);
  }
  assert.equal(formatAngle(10), '10 arcsec');
  assert.equal(formatAngle(120), '2 arcmin');
  assert.equal(formatAngle(3600), '1 deg');
});

test('number and date formatting', () => {
  assert.equal(formatValue(51.6), '51.6');
  assert.equal(formatValue(0.89), '0.890');
  assert.equal(formatValue(-0.0312), '-0.0312');
  assert.equal(formatValue(1234.4), '1234');
  assert.equal(formatValue(0), '0');
  assert.equal(formatValue(NaN), '-');
  assert.equal(formatValue(null), '-');
  assert.equal(formatValue(2.5e6), '2.5e6');
  assert.equal(formatDeg(269.452134, -4.6934), '269.45213 -4.69340');
  assert.equal(formatDeg(NaN, 1), '');
  assert.equal(mjdToIso(61210.79311303), '2026-06-19');
  assert.equal(mjdToIso(61210.79311303, true), '2026-06-19 19:02');
  assert.equal(mjdToIso(NaN), '');
});

test('maskRuns merges runs and flips rows for display', () => {
  const n = 4;
  const m = new Uint8Array(n * n);
  m[0] = 1; m[1] = 1; // row 0 (south), x 0..1
  m[3] = 1; //          row 0, x 3
  m[2 * n + 2] = 7; //  row 2, x 2
  assert.deepEqual(Array.from(maskRuns(m, n)), [0, 3, 2, 3, 3, 1, 2, 1, 1]);
  assert.deepEqual(Array.from(maskRuns(m, n, false)), [0, 0, 2, 3, 0, 1, 2, 2, 1]);
  assert.equal(maskRuns(null, n).length, 0);
  assert.equal(maskRuns(new Uint8Array(16), n).length, 0);
});
