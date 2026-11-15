// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// Rigid-body model of the SPHEREx focal plane (CONTRACT-S3.md): all six detectors expose at
// once, so the pointing of detectors 2..6 follows from the header of detector 1 by a constant
// rotation. Good to about 12 arcsec in boresight and 16 arcmin in roll: enough to decide which
// exposures cover a sky position (with a margin), never enough for astrometry.
//
//   M[1..6]                              constant 3x3 matrices, row-major (M[1] = identity)
//   FP_CRPIX = 1020.5, FP_SCALE_DEG = 6.155 / 3600, FP_NPIX = 2040
//   attitudeFromWcs({ crval: [ra, dec], pc: [pc11, pc12, pc21, pc22] }) -> [ux, uy, b]
//       ux = sky direction of the detector +x pixel axis, uy = of +y (made orthogonal to ux),
//       b = boresight (unit vector of CRVAL); each a [x, y, z] unit vector (ICRS).
//   rotateTriad(triad1, det) -> triad of detector `det`:  A_d[j] = sum_i M_d[i][j] * A_1[i]
//   detectorWcs(triad1, det, scaleDeg = FP_SCALE_DEG, shape = DET_SHAPE[det])
//       -> { crval: [ra, dec], pc: [pc11, pc12, pc21, pc22], crpix: [1020.5, 1020.5] }
//       The handedness (sign of the PC determinant) is whatever the triad has; it is derived,
//       never assumed.
//   DET_SHAPE[1..6] = [kx, ka, kc]       measured pixel shape of each detector (see below)
//   skyToDetPix(wcs, ra, dec) -> [x, y] | null     1-based pixels, plain TAN (no SIP); null when
//                                                  the point is more than 60 degrees away
//   detPixToSky(wcs, x, y)   -> [ra, dec]
//
// Vectors: x towards RA 0, y towards RA 90, z towards the north pole. PC is in degrees per
// pixel (CDELT = 1): (xi, eta) = PC * (x - CRPIX1, y - CRPIX2), xi east, eta north.

const D2R = Math.PI / 180;

export const FP_CRPIX = 1020.5;
export const FP_NPIX = 2040;
export const FP_SCALE_DEG = 6.155 / 3600;

export const M1 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
export const M2 = [0.99735647, -0.027309166, 0.067337072, 0.027302803, 0.999626694, 0.001014964, -0.067339653, 0.00082621, 0.997729767];
export const M3 = [0.989315981, -0.056487661, 0.134398784, 0.056463232, 0.998396681, 0.003996431, -0.134409049, 0.003634857, 0.990919268];
export const M4 = [0.999998155, -0.00191638, -0.00013151, 0.001916425, 0.999998106, 0.000338182, 0.000130862, -0.000338433, 0.999999934];
export const M5 = [0.997285546, -0.029928082, 0.067274435, 0.029907691, 0.999551806, 0.001310473, -0.067283503, 0.000705107, 0.997733648];
export const M6 = [0.989178966, -0.058822169, 0.134405825, 0.058773226, 0.998261946, 0.004335336, -0.134427235, 0.003611041, 0.990916888];

/** M[det] for det = 1..6 (index 0 is unused). */
export const M = [null, M1, M2, M3, M4, M5, M6];

// Pixel shape of each detector. The real PC matrices are not scaled rotations: the y pixel axis
// of the outer detectors is skewed by 2.2 degrees against the perpendicular of the x axis
// (detectors 1 and 4: -2.2, 2 and 5: 0, 3 and 6: +2.2) and the scales differ by a few 1e-3.
// Ignoring that would misplace a target by up to 39 pixels at the top and bottom detector edges.
// With ux, uy the orthonormal triad axes and S the nominal scale (6.155 arcsec):
//   first PC column  (sky step per +x pixel) = S * kx * ux
//   second PC column (sky step per +y pixel) = S * (ka * ux + kc * uy)
// Measured from the real headers in CONTRACT-S3.md: detectors 1..5 from exposure
// 2026W25_2A_0279_1, detector 6 from 2025W30_1B_0009_1. Detector 1 gives the same numbers to
// 4e-4 in the two other exposures (11 months apart), so these are instrument constants.
export const DET_SHAPE = [
  null,
  [1.00056, -0.038496, 0.998896],
  [0.996629, -0.000878, 0.998808],
  [1.001138, 0.038452, 0.999043],
  [1.000417, -0.038087, 0.999774],
  [1.001078, 0, 1.001078],
  [1.004731, 0.040041, 1.000002],
];

function normalize(v) {
  const n = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / n, v[1] / n, v[2] / n];
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Unit vector of (ra, dec) and the local east and north unit vectors there. */
export function skyBasis(ra, dec) {
  const sr = Math.sin(ra * D2R);
  const cr = Math.cos(ra * D2R);
  const sd = Math.sin(dec * D2R);
  const cd = Math.cos(dec * D2R);
  return {
    b: [cd * cr, cd * sr, sd],
    e: [-sr, cr, 0],
    n: [-sd * cr, -sd * sr, cd],
  };
}

/** [ra, dec] in degrees (ra in [0, 360)) of a direction vector. */
export function vectorToSky(v) {
  let ra = Math.atan2(v[1], v[0]) / D2R;
  if (ra < 0) ra += 360;
  if (ra >= 360) ra -= 360;
  return [ra, Math.atan2(v[2], Math.hypot(v[0], v[1])) / D2R];
}

/** Attitude triad [ux, uy, b] of a detector from its CRVAL and PC matrix. */
export function attitudeFromWcs({ crval, pc }) {
  const { b, e, n } = skyBasis(crval[0], crval[1]);
  const [pc11, pc12, pc21, pc22] = pc;
  const ux = normalize([pc11 * e[0] + pc21 * n[0], pc11 * e[1] + pc21 * n[1], pc11 * e[2] + pc21 * n[2]]);
  const raw = [pc12 * e[0] + pc22 * n[0], pc12 * e[1] + pc22 * n[1], pc12 * e[2] + pc22 * n[2]];
  const along = dot(raw, ux);
  const uy = normalize([raw[0] - along * ux[0], raw[1] - along * ux[1], raw[2] - along * ux[2]]);
  return [ux, uy, b];
}

/** Triad of detector `det` from the triad of detector 1. */
export function rotateTriad(triad1, det) {
  const m = M[det];
  if (!m) throw new Error(`No such SPHEREx detector: ${det}`);
  const out = [];
  for (let j = 0; j < 3; j++) {
    const v = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      const w = m[3 * i + j];
      v[0] += w * triad1[i][0];
      v[1] += w * triad1[i][1];
      v[2] += w * triad1[i][2];
    }
    out.push(v);
  }
  return out;
}

/**
 * Approximate WCS (plain TAN, reference pixel at the detector centre) of detector `det`.
 * Pass shape = [1, 0, 1] for an ideal square-pixel detector.
 */
export function detectorWcs(triad1, det, scaleDeg = FP_SCALE_DEG, shape = DET_SHAPE[det]) {
  const [ux, uy, bRaw] = rotateTriad(triad1, det);
  const [kx, ka, kc] = shape || [1, 0, 1];
  const crval = vectorToSky(bRaw);
  const { e, n } = skyBasis(crval[0], crval[1]);
  const uxE = dot(ux, e);
  const uxN = dot(ux, n);
  const uyE = dot(uy, e);
  const uyN = dot(uy, n);
  return {
    crval,
    pc: [scaleDeg * kx * uxE, scaleDeg * (ka * uxE + kc * uyE), scaleDeg * kx * uxN, scaleDeg * (ka * uxN + kc * uyN)],
    crpix: [FP_CRPIX, FP_CRPIX],
  };
}

/**
 * Sky -> 1-based detector pixel through a plain gnomonic (TAN) projection, ignoring SIP.
 * Returns null when the point is more than 60 degrees from CRVAL (or behind the tangent plane).
 */
export function skyToDetPix(wcs, ra, dec) {
  const { b, e, n } = skyBasis(wcs.crval[0], wcs.crval[1]);
  const t = skyBasis(ra, dec).b;
  const cosc = dot(t, b);
  if (!(cosc >= 0.5)) return null;
  const xi = dot(t, e) / cosc / D2R; // degrees east
  const eta = dot(t, n) / cosc / D2R; // degrees north
  const [pc11, pc12, pc21, pc22] = wcs.pc;
  const det = pc11 * pc22 - pc12 * pc21;
  if (!(Math.abs(det) > 0)) return null;
  const crpix = wcs.crpix || [FP_CRPIX, FP_CRPIX];
  return [crpix[0] + (pc22 * xi - pc12 * eta) / det, crpix[1] + (pc11 * eta - pc21 * xi) / det];
}

/** 1-based detector pixel -> [ra, dec] through the same plain TAN projection. */
export function detPixToSky(wcs, x, y) {
  const { b, e, n } = skyBasis(wcs.crval[0], wcs.crval[1]);
  const crpix = wcs.crpix || [FP_CRPIX, FP_CRPIX];
  const dx = x - crpix[0];
  const dy = y - crpix[1];
  const [pc11, pc12, pc21, pc22] = wcs.pc;
  const xi = (pc11 * dx + pc12 * dy) * D2R;
  const eta = (pc21 * dx + pc22 * dy) * D2R;
  return vectorToSky([b[0] + xi * e[0] + eta * n[0], b[1] + xi * e[1] + eta * n[1], b[2] + xi * e[2] + eta * n[2]]);
}
