// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  M, M1, DET_SHAPE, FP_CRPIX, FP_SCALE_DEG, attitudeFromWcs, rotateTriad, detectorWcs, skyToDetPix, detPixToSky, skyBasis,
} from './focalplane.js';

const D2R = Math.PI / 180;

/** Angular separation in arcsec. */
function sepArcsec(ra1, dec1, ra2, dec2) {
  const a = skyBasis(ra1, dec1).b;
  const b = skyBasis(ra2, dec2).b;
  const cross = Math.hypot(a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]);
  const dotp = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return (Math.atan2(cross, dotp) / D2R) * 3600;
}

// Real headers (CONTRACT-S3.md): exposure 2026W25_2A_0279_1, all detectors.
const REAL = {
  1: { crval: [203.245672412, 57.074776311], pc: [0.0013519433669, -0.0010984482376, -0.0010481759429, -0.00130936657274] },
  2: { crval: [208.4483499, 54.5491081503], pc: [0.00123274981054, -0.00118000897293, -0.00117635107879, -0.00123440903284] },
  3: { crval: [212.893828568, 51.7466916852], pc: [0.0011252118048, -0.00124393014935, -0.00128984687451, -0.00117239798481] },
  4: { crval: [203.212883655, 57.0640758254], pc: [0.00135024354054, -0.00110069678127, -0.00104996614764, -0.00130940273357] },
  5: { crval: [208.424186819, 54.5389522846], pc: [0.00123557648256, -0.00118440073813, -0.00118440073813, -0.00123557648256] },
};
// DR1 exposure 2025W30_1B_0009_1, eleven months earlier.
const DR1_D1 = { crval: [3.40805287656, 65.3983156426], pc: [-0.00131533332266, -0.00104090943207, -0.00109339332625, 0.0013551177306] };
const DR1_D6 = { crval: [351.124600326, 60.0652606581], pc: [-0.00116649208456, -0.00130157242042, -0.00126102056953, 0.0011107466594] };
// 2026W25_2A_0506_2 detector 1 (southern sky).
const SOUTH_D1 = { crval: [111.292339525, -63.3167406276], pc: [0.000194530094885, -0.00170381333933, -0.00169955469884, -0.00012945991451] };

test('matrices: M1 is the identity and M2..M6 are rotations to 1e-6', () => {
  assert.deepEqual(M1, [1, 0, 0, 0, 1, 0, 0, 0, 1]);
  for (let d = 2; d <= 6; d++) {
    const m = M[d];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        let s = 0;
        for (let k = 0; k < 3; k++) s += m[3 * i + k] * m[3 * j + k];
        assert.ok(Math.abs(s - (i === j ? 1 : 0)) < 1e-6, `M${d} row ${i}.${j} = ${s}`);
      }
    }
    const det =
      m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
    assert.ok(Math.abs(det - 1) < 1e-6, `det M${d} = ${det}`);
  }
});

test('attitudeFromWcs: orthonormal triad, b is CRVAL, ux follows the first PC column', () => {
  for (const wcs of [REAL[1], DR1_D1, SOUTH_D1]) {
    const [ux, uy, b] = attitudeFromWcs(wcs);
    const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
    for (const v of [ux, uy, b]) assert.ok(Math.abs(dot(v, v) - 1) < 1e-12);
    assert.ok(Math.abs(dot(ux, uy)) < 1e-12);
    assert.ok(Math.abs(dot(ux, b)) < 1e-12);
    assert.ok(Math.abs(dot(uy, b)) < 1e-12);
    const { b: b0, e, n } = skyBasis(wcs.crval[0], wcs.crval[1]);
    assert.ok(Math.abs(dot(b, b0) - 1) < 1e-12);
    const scale = Math.hypot(wcs.pc[0], wcs.pc[2]);
    assert.ok(Math.abs(dot(ux, e) - wcs.pc[0] / scale) < 1e-12);
    assert.ok(Math.abs(dot(ux, n) - wcs.pc[2] / scale) < 1e-12);
  }
});

test('real exposure 2026W25_2A_0279_1: D2..D5 predicted from the D1 header', () => {
  const triad = attitudeFromWcs(REAL[1]);
  for (const det of [2, 3, 4, 5]) {
    const predicted = detectorWcs(triad, det);
    const truth = REAL[det];
    const sep = sepArcsec(predicted.crval[0], predicted.crval[1], truth.crval[0], truth.crval[1]);
    assert.ok(sep < 1, `D${det} boresight off by ${sep.toFixed(3)} arcsec`);
    for (let k = 0; k < 4; k++) {
      assert.ok(Math.abs(predicted.pc[k] - truth.pc[k]) < 2e-5, `D${det} PC[${k}] ${predicted.pc[k]} vs ${truth.pc[k]}`);
    }
    assert.deepEqual(predicted.crpix, [1020.5, 1020.5]);
  }
  // Detector 1 from itself: same boresight, same axes, nominal scale.
  const self = detectorWcs(triad, 1);
  assert.ok(sepArcsec(self.crval[0], self.crval[1], REAL[1].crval[0], REAL[1].crval[1]) < 1e-6);
  for (let k = 0; k < 4; k++) assert.ok(Math.abs(self.pc[k] - REAL[1].pc[k]) < 1e-8);
});

test('the pixel-shape constants matter: an ideal square-pixel model misses the 2.2 degree skew', () => {
  const triad = attitudeFromWcs(REAL[1]);
  const ideal = detectorWcs(triad, 3, FP_SCALE_DEG, [1, 0, 1]);
  const worst = Math.max(...ideal.pc.map((v, k) => Math.abs(v - REAL[3].pc[k])));
  assert.ok(worst > 4e-5, 'without the skew the second PC column is off by more than 4e-5');
  // In pixels: the top edge centre of detector 3, ideal model against the real header.
  const real = { ...REAL[3], crpix: [FP_CRPIX, FP_CRPIX] };
  const [ra, dec] = detPixToSky(real, 1020.5, 2040);
  const off = skyToDetPix(ideal, ra, dec);
  assert.ok(Math.abs(off[0] - 1020.5) > 30, `ideal model is ${Math.abs(off[0] - 1020.5).toFixed(1)} px off at the edge`);
  const good = skyToDetPix(detectorWcs(triad, 3), ra, dec);
  assert.ok(Math.hypot(good[0] - 1020.5, good[1] - 2040) < 3, `shaped model: ${good}`);
  // Same exposure-independent constants on two other exposures of detector 1.
  for (const other of [DR1_D1, SOUTH_D1]) {
    const pc = detectorWcs(attitudeFromWcs(other), 1).pc;
    for (let k = 0; k < 4; k++) assert.ok(Math.abs(pc[k] - other.pc[k]) < 1.5e-6, `PC[${k}] ${pc[k]} vs ${other.pc[k]}`);
  }
  assert.equal(DET_SHAPE.length, 7);
});

test('DR1 exposure 2025W30_1B_0009_1: D6 boresight within 15 arcsec, PC within 2e-5', () => {
  const predicted = detectorWcs(attitudeFromWcs(DR1_D1), 6);
  const sep = sepArcsec(predicted.crval[0], predicted.crval[1], DR1_D6.crval[0], DR1_D6.crval[1]);
  assert.ok(sep < 15, `D6 boresight off by ${sep.toFixed(2)} arcsec`);
  for (let k = 0; k < 4; k++) assert.ok(Math.abs(predicted.pc[k] - DR1_D6.pc[k]) < 2e-5, `PC[${k}]`);
});

test('handedness is derived from the header, not assumed', () => {
  const detOf = (pc) => pc[0] * pc[3] - pc[1] * pc[2];
  for (const wcs of [REAL[1], DR1_D1, SOUTH_D1]) {
    assert.ok(detOf(wcs.pc) < 0, 'the real headers used here are left-handed (sky parity)');
    for (let det = 1; det <= 6; det++) assert.ok(detOf(detectorWcs(attitudeFromWcs(wcs), det).pc) < 0);
  }
  // A mirrored attitude (x axis flipped) must come out mirrored for every detector.
  const mirrored = { crval: REAL[1].crval, pc: [-REAL[1].pc[0], REAL[1].pc[1], -REAL[1].pc[2], REAL[1].pc[3]] };
  assert.ok(detOf(mirrored.pc) > 0);
  for (let det = 1; det <= 6; det++) {
    const pc = detectorWcs(attitudeFromWcs(mirrored), det).pc;
    assert.ok(detOf(pc) > 0, `D${det} lost the handedness`);
    assert.ok(Math.abs(Math.sqrt(Math.abs(detOf(pc))) / FP_SCALE_DEG - 1) < 5e-3);
  }
});

test('rotateTriad keeps the triad orthonormal and moves D2/D3 3.9 and 7.7 degrees along +x', () => {
  const triad = attitudeFromWcs(REAL[1]);
  const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
  const b1 = triad[2];
  const expected = { 2: 3.86, 3: 7.73, 4: 0.02, 5: 3.86, 6: 7.73 };
  for (let det = 2; det <= 6; det++) {
    const [ux, uy, b] = rotateTriad(triad, det);
    assert.ok(Math.abs(dot(ux, uy)) < 1e-6 && Math.abs(dot(ux, b)) < 1e-6 && Math.abs(dot(uy, b)) < 1e-6);
    const angle = Math.acos(Math.min(1, dot(b, b1))) / D2R;
    assert.ok(Math.abs(angle - expected[det]) < 0.03, `D${det} is ${angle.toFixed(3)} deg from D1`);
    if (det === 2 || det === 3) assert.ok(dot(b, triad[0]) > 0.06, 'offset is along +x of detector 1');
  }
  assert.throws(() => rotateTriad(triad, 7), /detector/);
});

test('skyToDetPix / detPixToSky round trip to 1e-6 pixel, including across RA = 0 and near a pole', () => {
  const cases = [REAL[2], DR1_D1, SOUTH_D1, { crval: [359.99, 89.2], pc: [0.0012, -0.0012, -0.0012, -0.0012] }];
  for (const base of cases) {
    const wcs = { ...base, crpix: [FP_CRPIX, FP_CRPIX] };
    for (const [x, y] of [[1, 1], [2040, 1], [1, 2040], [2040, 2040], [1020.5, 1020.5], [333.25, 1777.75], [-500, 2600]]) {
      const [ra, dec] = detPixToSky(wcs, x, y);
      assert.ok(ra >= 0 && ra < 360);
      const back = skyToDetPix(wcs, ra, dec);
      assert.ok(Math.abs(back[0] - x) < 1e-6 && Math.abs(back[1] - y) < 1e-6, `${x},${y} -> ${back}`);
    }
    const centre = detPixToSky(wcs, FP_CRPIX, FP_CRPIX);
    assert.ok(sepArcsec(centre[0], centre[1], base.crval[0], base.crval[1]) < 1e-6);
  }
});

test('skyToDetPix returns null beyond 60 degrees and behind the tangent plane', () => {
  const wcs = { ...REAL[2], crpix: [FP_CRPIX, FP_CRPIX] };
  assert.equal(skyToDetPix(wcs, REAL[2].crval[0] + 180, -REAL[2].crval[1]), null);
  assert.equal(skyToDetPix(wcs, REAL[2].crval[0], REAL[2].crval[1] - 61), null);
  assert.notEqual(skyToDetPix(wcs, REAL[2].crval[0], REAL[2].crval[1] - 59), null);
  assert.equal(skyToDetPix(wcs, NaN, 0), null);
});

test('real cutout fact: 210.80227, 54.34895 lands near detector pixel (1676, 539) of D2', () => {
  // IRSA's 59 x 59 cutout of this file starts at x0 = 1647, y0 = 510, target on its pixel 30.
  const wcs = { ...REAL[2], crpix: [FP_CRPIX, FP_CRPIX] };
  const [x, y] = skyToDetPix(wcs, 210.80227, 54.34895);
  assert.ok(Math.abs(x - 1676) < 4, `x = ${x}`);
  assert.ok(Math.abs(y - 539) < 4, `y = ${y}`);
  // The same through the D1 header and the rigid-body model: within the search margin.
  const viaD1 = skyToDetPix(detectorWcs(attitudeFromWcs(REAL[1]), 2), 210.80227, 54.34895);
  assert.ok(Math.abs(viaD1[0] - 1676) < 8 && Math.abs(viaD1[1] - 539) < 8, `via D1: ${viaD1}`);
});
