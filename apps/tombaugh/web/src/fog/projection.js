// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// Mollweide all-sky projection and the coordinate rotations the fog map needs.
// Pure maths, no DOM. All angles in degrees.
//
// Map units: x in [-2, 2] (positive to the right), y in [-1, 1] (positive north). The sky fills
// the ellipse (x/2)^2 + y^2 <= 1, a 2:1 oval. Right ascension increases to the LEFT (the sky as
// seen from inside), with `ra0` at the centre (default 180) and ra0 +/- 180 on the limb.
//
//   mollweideForward(ra, dec, ra0 = 180) -> [x, y]
//   mollweideInverse(x, y, ra0 = 180)    -> [ra, dec] | null   (null outside the ellipse)
//   mollweideXY(lambda, dec)             -> [x, y]   raw form: lambda = screen longitude in deg,
//                                           positive to the right, not wrapped (so a polygon can
//                                           be laid out continuously across the limb)
//   screenLongitude(ra, ra0 = 180)       -> lambda in (-180, 180]
//   eqToGal(ra, dec) -> [l, b];  galToEq(l, b) -> [ra, dec]       (J2000 / IAU 1958 pole)
//   eclToEq(lon, lat) -> [ra, dec];  eqToEcl(ra, dec) -> [lon, lat]  (J2000 mean obliquity)
//   wrap360(deg) -> [0, 360);  wrap180(deg) -> [-180, 180);  angSepDeg(ra1, dec1, ra2, dec2)

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const HALF_PI = Math.PI / 2;

/** Mean obliquity of the ecliptic at J2000.0 (IAU 1976), degrees. */
export const OBLIQUITY_J2000_DEG = 23.4392911;
/** North galactic pole, J2000 (Hipparcos definition of the IAU 1958 system), degrees. */
export const NGP_RA_DEG = 192.85948;
export const NGP_DEC_DEG = 27.12825;
/** Galactic longitude of the north celestial pole, degrees. */
export const L_NCP_DEG = 122.93192;

export function wrap360(deg) {
  const r = ((deg % 360) + 360) % 360;
  return r >= 360 ? 0 : r;
}

export function wrap180(deg) {
  return wrap360(deg + 180) - 180;
}

/**
 * Co-angle eps of the Mollweide auxiliary angle theta (theta = 90 deg - eps, eps in radians)
 * for a latitude given by its distance from the pole, d = 90 deg - |dec|, in degrees.
 *
 * The usual equation 2 theta + sin 2 theta = pi sin(dec) has a double root at the poles, where
 * Newton's method stalls and the subtraction loses every digit. Written in terms of eps and d it
 * becomes  2 eps - sin 2 eps = 2 pi sin^2(d / 2),  which is free of cancellation and convex on
 * [0, pi/2], so Newton converges from the asymptotic starting value eps^3 = 3 pi d^2 / 8.
 */
function coAuxAngle(dDeg) {
  if (!(dDeg > 0)) return 0;
  if (dDeg >= 90) return HALF_PI;
  const d = dDeg * D2R;
  const s = Math.sin(d / 2);
  const c = 2 * Math.PI * s * s;
  let e = Math.min(HALF_PI, Math.cbrt((3 * Math.PI * d * d) / 8));
  for (let i = 0; i < 40; i++) {
    const g = twoEpsMinusSin(e) - c;
    const se = Math.sin(e);
    const gp = 4 * se * se;
    if (gp < 1e-300) break;
    let next = e - g / gp;
    if (next > HALF_PI) next = HALF_PI;
    if (next < 0) next = e / 2;
    const step = Math.abs(next - e);
    e = next;
    if (step <= 4e-16 * e) break;
  }
  return e;
}

// 2e - sin(2e) without cancellation for small e.
function twoEpsMinusSin(e) {
  const u = 2 * e;
  if (u < 0.1) {
    const u2 = u * u;
    return u * u2 * (1 / 6 - u2 * (1 / 120 - u2 * (1 / 5040 - u2 / 362880)));
  }
  return u - Math.sin(u);
}

/** Raw Mollweide: screen longitude (deg, positive right, any range) and declination -> [x, y]. */
export function mollweideXY(lambdaDeg, decDeg) {
  const dec = Math.max(-90, Math.min(90, decDeg));
  if (dec === 0) return [lambdaDeg / 90, 0];
  const e = coAuxAngle(90 - Math.abs(dec));
  const y = Math.cos(e);
  return [(lambdaDeg / 90) * Math.sin(e), dec < 0 ? -y : y];
}

/** Screen longitude of a right ascension: 0 at ra0, positive to the right, RA increasing left. */
export function screenLongitude(raDeg, ra0 = 180) {
  const l = -wrap180(raDeg - ra0);
  return l === 0 ? 0 : l; // avoid -0
}

/** Equatorial (ra, dec) -> map [x, y]. */
export function mollweideForward(raDeg, decDeg, ra0 = 180) {
  return mollweideXY(screenLongitude(raDeg, ra0), decDeg);
}

/** Map [x, y] -> equatorial [ra, dec], or null when the point is outside the sky ellipse. */
export function mollweideInverse(x, y, ra0 = 180) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const ay = Math.abs(y);
  if (ay > 1) return null;
  const e = Math.acos(ay); // co-angle of theta
  const se = Math.sin(e);
  let lambda;
  if (se < 1e-12) {
    if (Math.abs(x) > 1e-9) return null;
    lambda = 0;
  } else {
    lambda = (x * 90) / se;
    if (Math.abs(lambda) > 180 + 1e-9) return null;
    lambda = Math.max(-180, Math.min(180, lambda));
  }
  // 2 sin^2(d / 2) = (2e - sin 2e) / pi, d = distance from the pole.
  const h = Math.sqrt(Math.min(1, twoEpsMinusSin(e) / (2 * Math.PI)));
  const d = 2 * Math.asin(h) * R2D;
  const dec = y < 0 ? d - 90 : 90 - d;
  return [wrap360(ra0 - lambda), dec];
}

// Unit-vector helpers.
function toVec(lonDeg, latDeg) {
  const lon = lonDeg * D2R;
  const lat = latDeg * D2R;
  const c = Math.cos(lat);
  return [c * Math.cos(lon), c * Math.sin(lon), Math.sin(lat)];
}

function fromVec(x, y, z) {
  const lat = Math.atan2(z, Math.hypot(x, y)) * R2D;
  return [wrap360(Math.atan2(y, x) * R2D), lat];
}

/** Equatorial J2000 -> galactic [l, b]. */
export function eqToGal(raDeg, decDeg) {
  const dec = decDeg * D2R;
  const da = (raDeg - NGP_RA_DEG) * D2R;
  const sg = Math.sin(NGP_DEC_DEG * D2R);
  const cg = Math.cos(NGP_DEC_DEG * D2R);
  const sd = Math.sin(dec);
  const cd = Math.cos(dec);
  const sb = sg * sd + cg * cd * Math.cos(da);
  const y = cd * Math.sin(da); // cos b sin(lNCP - l)
  const x = cg * sd - sg * cd * Math.cos(da); // cos b cos(lNCP - l)
  const b = Math.atan2(sb, Math.hypot(x, y)) * R2D;
  return [wrap360(L_NCP_DEG - Math.atan2(y, x) * R2D), b];
}

/** Galactic (l, b) -> equatorial J2000 [ra, dec]. */
export function galToEq(lDeg, bDeg) {
  const b = bDeg * D2R;
  const dl = (L_NCP_DEG - lDeg) * D2R;
  const sg = Math.sin(NGP_DEC_DEG * D2R);
  const cg = Math.cos(NGP_DEC_DEG * D2R);
  const sb = Math.sin(b);
  const cb = Math.cos(b);
  const sd = sg * sb + cg * cb * Math.cos(dl);
  const y = cb * Math.sin(dl); // cos dec sin(ra - raNGP)
  const x = cg * sb - sg * cb * Math.cos(dl); // cos dec cos(ra - raNGP)
  const dec = Math.atan2(sd, Math.hypot(x, y)) * R2D;
  return [wrap360(NGP_RA_DEG + Math.atan2(y, x) * R2D), dec];
}

/** Ecliptic (lon, lat) J2000 -> equatorial [ra, dec]: rotation about the x axis by the obliquity. */
export function eclToEq(lonDeg, latDeg) {
  const [x, y, z] = toVec(lonDeg, latDeg);
  const se = Math.sin(OBLIQUITY_J2000_DEG * D2R);
  const ce = Math.cos(OBLIQUITY_J2000_DEG * D2R);
  return fromVec(x, y * ce - z * se, y * se + z * ce);
}

/** Equatorial J2000 -> ecliptic [lon, lat]. */
export function eqToEcl(raDeg, decDeg) {
  const [x, y, z] = toVec(raDeg, decDeg);
  const se = Math.sin(OBLIQUITY_J2000_DEG * D2R);
  const ce = Math.cos(OBLIQUITY_J2000_DEG * D2R);
  return fromVec(x, y * ce + z * se, -y * se + z * ce);
}

/** Angular separation in degrees (stable at all separations). */
export function angSepDeg(ra1, dec1, ra2, dec2) {
  const a = toVec(ra1, dec1);
  const b = toVec(ra2, dec2);
  const cx = a[1] * b[2] - a[2] * b[1];
  const cy = a[2] * b[0] - a[0] * b[2];
  const cz = a[0] * b[1] - a[1] * b[0];
  return Math.atan2(Math.hypot(cx, cy, cz), a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) * R2D;
}
