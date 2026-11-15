// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// HEALPix, NESTED scheme, for nside a power of two (1 .. 32768).
// Algorithm: Gorski et al. 2005 (ApJ 622, 759) in the face/x/y ("xyf") formulation used by
// healpix_base. A pixel is (face 0..11, ix, iy) with ix growing to the north-east and iy to the
// north-west inside its base face; the nested index is face * nside^2 + interleave(ix, iy), ix in
// the even bits.
//
// Contract API:
//   ang2pixNest(nside, raDeg, decDeg) -> ipix            (-1 if ra/dec are not finite)
//   pix2angNest(nside, ipix)          -> [raDeg, decDeg]  pixel centre, ra in [0, 360)
//   cellCorners(nside, ipix, steps=1) -> [[ra, dec], ...] 4 * steps boundary points, in the order
//       S corner -> E corner -> N corner -> W corner (the start corner of each edge is included,
//       its end corner is not). steps = 1 gives exactly the four corners.
// Optional extras:
//   npix(nside), cellSizeDeg(nside), isValidNside(nside)
//   neighboursNest(nside, ipix) -> [SW, W, NW, N, NE, E, SE, S], -1 where no neighbour exists
//       (the eight points on the sphere where only three cells meet)
//   xyf2nest(nside, ix, iy, face), nest2xyf(nside, ipix) -> [ix, iy, face]
//   xyf2loc(x, y, face) -> [raDeg, decDeg] for continuous face coordinates x, y in [0, 1]
// Longitude phi is right ascension and z = sin(dec), so this works for any spherical frame.

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const TWO_THIRDS = 2 / 3;

// Ring offset and longitude offset of each base face.
const JRLL = [2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4];
const JPLL = [1, 3, 5, 7, 0, 2, 4, 6, 1, 3, 5, 7];

export function isValidNside(nside) {
  return Number.isInteger(nside) && nside >= 1 && nside <= 32768 && (nside & (nside - 1)) === 0;
}

function checkNside(nside) {
  if (!isValidNside(nside)) throw new RangeError(`HEALPix nside must be a power of two up to 32768, got ${nside}`);
}

/** Number of pixels on the sphere. */
export function npix(nside) {
  return 12 * nside * nside;
}

/** Side of a square with the same area as one pixel, in degrees (1.83 at nside 32). */
export function cellSizeDeg(nside) {
  return Math.sqrt((4 * Math.PI) / npix(nside)) * R2D;
}

// Spread the low 16 bits of v into the even bits of a 32-bit integer.
function spreadBits(v) {
  v &= 0xffff;
  v = (v | (v << 8)) & 0x00ff00ff;
  v = (v | (v << 4)) & 0x0f0f0f0f;
  v = (v | (v << 2)) & 0x33333333;
  v = (v | (v << 1)) & 0x55555555;
  return v;
}

// Inverse of spreadBits: gather the even bits of v.
function compressBits(v) {
  v &= 0x55555555;
  v = (v | (v >>> 1)) & 0x33333333;
  v = (v | (v >>> 2)) & 0x0f0f0f0f;
  v = (v | (v >>> 4)) & 0x00ff00ff;
  v = (v | (v >>> 8)) & 0x0000ffff;
  return v;
}

export function xyf2nest(nside, ix, iy, face) {
  return face * nside * nside + ((spreadBits(ix) | (spreadBits(iy) << 1)) >>> 0);
}

export function nest2xyf(nside, ipix) {
  const n2 = nside * nside;
  const face = Math.floor(ipix / n2);
  const p = ipix - face * n2;
  return [compressBits(p), compressBits(p >>> 1), face];
}

/** Nested pixel index containing the direction (ra, dec), degrees. */
export function ang2pixNest(nside, raDeg, decDeg) {
  checkNside(nside);
  if (!Number.isFinite(raDeg) || !Number.isFinite(decDeg)) return -1;
  const dec = Math.max(-90, Math.min(90, decDeg));
  const z = Math.sin(dec * D2R);
  const za = Math.abs(z);
  let tt = (((raDeg % 360) + 360) % 360) / 90; // longitude in units of 90 deg, [0, 4)
  if (tt >= 4) tt = 0;

  if (za <= TWO_THIRDS) {
    // Equatorial belt: count the diagonal lines crossed going north-east and south-east.
    const t1 = nside * (0.5 + tt);
    const t2 = nside * z * 0.75;
    const jp = Math.floor(t1 - t2); // index of the ascending edge line
    const jm = Math.floor(t1 + t2); // index of the descending edge line
    const ifp = Math.floor(jp / nside);
    const ifm = Math.floor(jm / nside);
    let face;
    if (ifp === ifm) face = (ifp & 3) + 4;
    else if (ifp < ifm) face = ifp & 3;
    else face = (ifm & 3) + 8;
    const ix = jm & (nside - 1);
    const iy = nside - (jp & (nside - 1)) - 1;
    return xyf2nest(nside, ix, iy, face);
  }

  // Polar caps.
  const ntt = Math.min(3, Math.floor(tt));
  const tp = tt - ntt;
  // sqrt(3 (1 - |z|)) loses digits close to the pole; use cos(dec) there instead.
  const tmp = za < 0.99
    ? nside * Math.sqrt(3 * (1 - za))
    : (nside * Math.cos(dec * D2R)) / Math.sqrt((1 + za) / 3);
  const jp = Math.min(nside - 1, Math.floor(tp * tmp));
  const jm = Math.min(nside - 1, Math.floor((1 - tp) * tmp));
  return z >= 0
    ? xyf2nest(nside, nside - jm - 1, nside - jp - 1, ntt)
    : xyf2nest(nside, jp, jm, ntt + 8);
}

/** Direction of a point given by continuous face coordinates x, y in [0, 1]. */
export function xyf2loc(x, y, face) {
  const jr = JRLL[face] - x - y;
  let nr;
  let decDeg;
  if (jr < 1) {
    nr = jr;
    const tmp = (nr * nr) / 3;
    decDeg = Math.atan2(1 - tmp, Math.sqrt(tmp * (2 - tmp))) * R2D;
  } else if (jr > 3) {
    nr = 4 - jr;
    const tmp = (nr * nr) / 3;
    decDeg = Math.atan2(tmp - 1, Math.sqrt(tmp * (2 - tmp))) * R2D;
  } else {
    nr = 1;
    decDeg = Math.asin((2 - jr) * TWO_THIRDS) * R2D;
  }
  let tmp = JPLL[face] * nr + x - y;
  if (tmp < 0) tmp += 8;
  if (tmp >= 8) tmp -= 8;
  const raDeg = nr < 1e-15 ? 0 : (45 * tmp) / nr;
  return [raDeg >= 360 ? raDeg - 360 : raDeg, decDeg];
}

/** Centre of a nested pixel, [raDeg, decDeg]. */
export function pix2angNest(nside, ipix) {
  checkNside(nside);
  const [ix, iy, face] = nest2xyf(nside, ipix);
  return xyf2loc((ix + 0.5) / nside, (iy + 0.5) / nside, face);
}

/**
 * Points along the boundary of a pixel: S -> E -> N -> W, `steps` points per edge.
 * A corner that sits exactly on a pole is returned with ra = 0.
 */
export function cellCorners(nside, ipix, steps = 1) {
  checkNside(nside);
  const n = Math.max(1, Math.floor(steps));
  const [ix, iy, face] = nest2xyf(nside, ipix);
  const x0 = ix / nside;
  const y0 = iy / nside;
  const d = 1 / nside;
  const out = [];
  for (let i = 0; i < n; i++) out.push(xyf2loc(x0 + (d * i) / n, y0, face)); // S -> E
  for (let i = 0; i < n; i++) out.push(xyf2loc(x0 + d, y0 + (d * i) / n, face)); // E -> N
  for (let i = 0; i < n; i++) out.push(xyf2loc(x0 + d - (d * i) / n, y0 + d, face)); // N -> W
  for (let i = 0; i < n; i++) out.push(xyf2loc(x0, y0 + d - (d * i) / n, face)); // W -> S
  return out;
}

// Neighbour tables from healpix_base. Directions: SW, W, NW, N, NE, E, SE, S.
const NB_XOFFSET = [-1, -1, 0, 1, 1, 1, 0, -1];
const NB_YOFFSET = [0, 1, 1, 1, 0, -1, -1, -1];
const NB_FACE = [
  [8, 9, 10, 11, -1, -1, -1, -1, 10, 11, 8, 9], // S
  [5, 6, 7, 4, 8, 9, 10, 11, 9, 10, 11, 8], // SE
  [-1, -1, -1, -1, 5, 6, 7, 4, -1, -1, -1, -1], // E
  [4, 5, 6, 7, 11, 8, 9, 10, 11, 8, 9, 10], // SW
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], // same face
  [1, 2, 3, 0, 0, 1, 2, 3, 5, 6, 7, 4], // NE
  [-1, -1, -1, -1, 7, 4, 5, 6, -1, -1, -1, -1], // W
  [3, 0, 1, 2, 3, 0, 1, 2, 4, 5, 6, 7], // NW
  [2, 3, 0, 1, -1, -1, -1, -1, 0, 1, 2, 3], // N
];
const NB_SWAP = [
  [0, 0, 3], // S
  [0, 0, 6], // SE
  [0, 0, 0], // E
  [0, 0, 5], // SW
  [0, 0, 0], // same face
  [5, 0, 0], // NE
  [0, 0, 0], // W
  [6, 0, 0], // NW
  [3, 0, 0], // N
];

/** The eight neighbours of a nested pixel: [SW, W, NW, N, NE, E, SE, S]; -1 where none exists. */
export function neighboursNest(nside, ipix) {
  checkNside(nside);
  const [ix, iy, face] = nest2xyf(nside, ipix);
  const out = new Array(8);
  for (let i = 0; i < 8; i++) {
    let x = ix + NB_XOFFSET[i];
    let y = iy + NB_YOFFSET[i];
    let nb = 4;
    if (x < 0) { x += nside; nb -= 1; } else if (x >= nside) { x -= nside; nb += 1; }
    if (y < 0) { y += nside; nb -= 3; } else if (y >= nside) { y -= nside; nb += 3; }
    const f = NB_FACE[nb][face];
    if (f < 0) { out[i] = -1; continue; }
    const bits = NB_SWAP[nb][face >> 2];
    if (bits & 1) x = nside - x - 1;
    if (bits & 2) y = nside - y - 1;
    if (bits & 4) { const t = x; x = y; y = t; }
    out[i] = xyf2nest(nside, x, y, f);
  }
  return out;
}
