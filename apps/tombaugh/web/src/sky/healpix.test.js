// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

import test from 'node:test';
import assert from 'node:assert/strict';
import { faceToVec, nestToXY, pixelVec, pixelBounds, pixelsInDisc, tileMesh, gridIndices, tilePath, radecToVec, vecToRadec } from './healpix.js';

const close = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${a} vs ${b}`);

test('base pixel centres match the HEALPix definition', () => {
  // North polar cap faces are centred at dec = asin(2/3), ra = 45 + 90 k.
  const dec = (Math.asin(2 / 3) * 180) / Math.PI;
  for (let f = 0; f < 4; f += 1) {
    const p = vecToRadec(pixelVec(0, f, 0.5, 0.5));
    close(p.ra, 45 + 90 * f);
    close(p.dec, dec);
  }
  // Equatorial faces are centred on the equator at ra = 0, 90, 180, 270.
  for (let f = 4; f < 8; f += 1) {
    const p = vecToRadec(pixelVec(0, f, 0.5, 0.5));
    close(p.ra, ((f - 4) * 90) % 360);
    close(p.dec, 0);
  }
  for (let f = 8; f < 12; f += 1) {
    const p = vecToRadec(pixelVec(0, f, 0.5, 0.5));
    close(p.ra, 45 + 90 * (f - 8));
    close(p.dec, -dec);
  }
});

test('corners: north of a polar face is the pole, x runs east, y runs west', () => {
  close(vecToRadec(faceToVec(0, 1, 1)).dec, 90);
  close(vecToRadec(faceToVec(8, 0, 0)).dec, -90);
  // Face 4 is centred at ra 0: its east corner (x=1, y=0) is at ra 45, west corner at ra 315.
  const east = vecToRadec(faceToVec(4, 1, 0));
  const west = vecToRadec(faceToVec(4, 0, 1));
  close(east.ra, 45);
  close(east.dec, 0);
  close(west.ra, 315);
  close(west.dec, 0);
  close(vecToRadec(faceToVec(4, 1, 1)).dec, (Math.asin(2 / 3) * 180) / Math.PI);
});

test('nested numbering puts x in the even bits and y in the odd bits', () => {
  assert.deepEqual(nestToXY(1, 0), { face: 0, ix: 0, iy: 0 });
  assert.deepEqual(nestToXY(1, 1), { face: 0, ix: 1, iy: 0 });
  assert.deepEqual(nestToXY(1, 2), { face: 0, ix: 0, iy: 1 });
  assert.deepEqual(nestToXY(1, 3), { face: 0, ix: 1, iy: 1 });
  assert.deepEqual(nestToXY(3, 5 * 64 + 0b100111), { face: 5, ix: 0b011, iy: 0b101 });
  // A deep order, past 32-bit pixel numbers.
  const deep = nestToXY(18, 11 * 4 ** 18 + 3);
  assert.equal(deep.face, 11);
  assert.equal(deep.ix, 1);
  assert.equal(deep.iy, 1);
});

test('children tile their parent and all pixels have nearly equal size', () => {
  const parent = pixelBounds(2, 37);
  for (let c = 0; c < 4; c += 1) {
    const child = pixelBounds(3, 37 * 4 + c);
    const dot = parent.center[0] * child.center[0] + parent.center[1] * child.center[1] + parent.center[2] * child.center[2];
    assert.ok(Math.acos(dot) < parent.radius, 'child centre lies inside the parent disc');
  }
  // 768 pixels of order 3 share the sphere: the enclosing discs are all of the same scale.
  const radii = [];
  for (let i = 0; i < 768; i += 37) radii.push(pixelBounds(3, i).radius);
  assert.ok(Math.max(...radii) / Math.min(...radii) < 2.2);
});

test('pixelsInDisc finds the pixel under a direction and covers the sky', () => {
  assert.equal(pixelsInDisc(3, radecToVec(10, 20), Math.PI).length, 768);
  const dir = pixelVec(5, 4321, 0.5, 0.5);
  const near = pixelsInDisc(5, dir, 0.001);
  assert.ok(near.includes(4321));
  assert.ok(near.length < 12);
  // A wider disc holds more, and always includes the narrow set.
  const wide = pixelsInDisc(5, dir, 0.2);
  assert.ok(wide.length > near.length);
  for (const p of near) assert.ok(wide.includes(p));
});

test('tileMesh lays the picture out with south at the top-left', () => {
  const n = 2;
  const mesh = tileMesh(0, 4, n);
  assert.equal(mesh.length, 5 * 9);
  const vert = (i, j) => {
    const at = 5 * (j * (n + 1) + i);
    return { p: vecToRadec([mesh[at], mesh[at + 1], mesh[at + 2]]), u: mesh[at + 3], v: mesh[at + 4] };
  };
  const south = vert(0, 0);
  assert.deepEqual([south.u, south.v], [0, 0]);
  assert.ok(south.p.dec < -41);
  const east = vert(n, 0); // x = 1, y = 0
  assert.deepEqual([east.u, east.v], [0, 1]);
  close(east.p.ra, 45, 1e-4);
  const west = vert(0, n);
  assert.deepEqual([west.u, west.v], [1, 0]);
  close(west.p.ra, 315, 1e-4);
  const north = vert(n, n);
  assert.deepEqual([north.u, north.v], [1, 1]);
  assert.ok(north.p.dec > 41);
  // A sub-rectangle of an atlas picture.
  const sub = tileMesh(0, 4, 1, 0.25, 0.5, 0.125, 0.25);
  assert.deepEqual([sub[3], sub[4]], [0.25, 0.5]);
  assert.deepEqual([sub[18], sub[19]], [0.375, 0.75]);
});

test('gridIndices, tilePath and coordinate helpers', () => {
  assert.deepEqual(gridIndices(1), [0, 1, 2, 1, 3, 2]);
  assert.equal(gridIndices(4).length, 96);
  assert.deepEqual(gridIndices(1, 10), [10, 11, 12, 11, 13, 12]);
  assert.equal(tilePath(3, 312), 'Norder3/Dir0/Npix312');
  assert.equal(tilePath(7, 123456), 'Norder7/Dir120000/Npix123456');
  const p = vecToRadec(radecToVec(269.452, 4.693));
  close(p.ra, 269.452);
  close(p.dec, 4.693);
});
