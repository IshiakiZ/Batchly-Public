// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// healpix.js: the small part of HEALPix (nested scheme) the sky view needs to place HiPS picture
// tiles on the sphere. Pure functions, no DOM.
//
// A HiPS tile of order k is one HEALPix pixel of that order. Its picture is square: the pixel's
// south corner is the picture's top-left, west is top-right, east is bottom-left and north is
// bottom-right (HiPS 1.0, section 4.2: sub-pixels follow the nested z-order from the top-left).
//
// Formulas: Gorski et al. 2005 (ApJ 622, 759) and the reference healpix_base "xyf2loc" routine.

const JRLL = [2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4];
const JPLL = [1, 3, 5, 7, 0, 2, 4, 6, 1, 3, 5, 7];
const HALF_PI = Math.PI / 2;

/**
 * A point of base face `face` (0..11) at face coordinates x, y in [0, 1] -> unit vector [x, y, z]
 * in the tile frame (equatorial for the surveys used here). x runs towards north-east, y towards
 * north-west; (0,0) is the face's south corner and (1,1) its north corner.
 */
export function faceToVec(face, x, y, out = [0, 0, 0]) {
  const jr = JRLL[face] - x - y;
  let nr;
  let z;
  let sth;
  if (jr < 1) {
    nr = jr;
    const tmp = (nr * nr) / 3;
    z = 1 - tmp;
    sth = Math.sqrt(tmp * (2 - tmp));
  } else if (jr > 3) {
    nr = 4 - jr;
    const tmp = (nr * nr) / 3;
    z = tmp - 1;
    sth = Math.sqrt(tmp * (2 - tmp));
  } else {
    nr = 1;
    z = ((2 - jr) * 2) / 3;
    sth = Math.sqrt(Math.max(0, 1 - z * z));
  }
  let tmp = JPLL[face] * nr + x - y;
  if (tmp < 0) tmp += 8;
  if (tmp >= 8) tmp -= 8;
  const phi = nr < 1e-15 ? 0 : (0.5 * HALF_PI * tmp) / nr;
  out[0] = sth * Math.cos(phi);
  out[1] = sth * Math.sin(phi);
  out[2] = z;
  return out;
}

/** Split a nested pixel number of the given order into { face, ix, iy }. */
export function nestToXY(order, ipix) {
  const nside = 2 ** order;
  const perFace = nside * nside;
  const face = Math.floor(ipix / perFace);
  let rest = ipix - face * perFace;
  let ix = 0;
  let iy = 0;
  // De-interleave: x in the even bits, y in the odd bits. Done arithmetically so that orders
  // above 15 (pixel numbers past 2^31) still work.
  for (let bit = 0; bit < order; bit += 1) {
    const pair = rest % 4;
    rest = (rest - pair) / 4;
    if (pair & 1) ix += 2 ** bit;
    if (pair & 2) iy += 2 ** bit;
  }
  return { face, ix, iy };
}

/**
 * A point inside nested pixel `ipix` of `order`, at fractional position fx, fy in [0, 1]
 * (0,0 = south corner, 1,0 = east, 0,1 = west, 1,1 = north) -> unit vector.
 */
export function pixelVec(order, ipix, fx, fy, out) {
  const { face, ix, iy } = nestToXY(order, ipix);
  const nside = 2 ** order;
  return faceToVec(face, (ix + fx) / nside, (iy + fy) / nside, out);
}

const angle = (a, b) => {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return Math.acos(Math.max(-1, Math.min(1, dot)));
};

const boundsCache = new Map();

/** { center: unit vector, radius: radians } of a disc that encloses the pixel. Cached. */
export function pixelBounds(order, ipix) {
  const key = order * 1e12 + ipix;
  let b = boundsCache.get(key);
  if (b) return b;
  const center = pixelVec(order, ipix, 0.5, 0.5);
  let radius = 0;
  for (const [fx, fy] of [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0], [0, 0.5], [1, 0.5], [0.5, 1]]) {
    radius = Math.max(radius, angle(center, pixelVec(order, ipix, fx, fy)));
  }
  b = { center, radius: radius * 1.08 };
  if (boundsCache.size > 20000) boundsCache.clear();
  boundsCache.set(key, b);
  return b;
}

/**
 * The nested pixels of `order` that touch the disc of `radius` radians around unit vector `dir`.
 * Walks down from the twelve base pixels, dropping every branch that is out of view.
 */
export function pixelsInDisc(order, dir, radius, limit = 4000) {
  const out = [];
  const walk = (o, ipix) => {
    if (out.length >= limit) return;
    const b = pixelBounds(o, ipix);
    if (angle(b.center, dir) > radius + b.radius) return;
    if (o === order) {
      out.push(ipix);
      return;
    }
    for (let c = 0; c < 4; c += 1) walk(o + 1, ipix * 4 + c);
  };
  for (let face = 0; face < 12; face += 1) walk(0, face);
  return out;
}

/**
 * Mesh for one tile: (n+1)^2 vertices as [x, y, z, u, v] with u, v the position in the tile's
 * picture (u to the right, v down, both 0..1). Returns a Float32Array of length 5 (n+1)^2.
 */
export function tileMesh(order, ipix, n = 4, u0 = 0, v0 = 0, du = 1, dv = 1) {
  const { face, ix, iy } = nestToXY(order, ipix);
  const nside = 2 ** order;
  const out = new Float32Array(5 * (n + 1) * (n + 1));
  const vec = [0, 0, 0];
  let at = 0;
  for (let j = 0; j <= n; j += 1) {
    for (let i = 0; i <= n; i += 1) {
      const fx = i / n;
      const fy = j / n;
      faceToVec(face, (ix + fx) / nside, (iy + fy) / nside, vec);
      out[at] = vec[0];
      out[at + 1] = vec[1];
      out[at + 2] = vec[2];
      // The picture's x axis runs south -> west (the pixel's y), its y axis south -> east (x).
      out[at + 3] = u0 + fy * du;
      out[at + 4] = v0 + fx * dv;
      at += 5;
    }
  }
  return out;
}

/** Triangle indices for an n x n grid of quads laid out as tileMesh does, offset by `base` vertices. */
export function gridIndices(n, base = 0, out = [], ) {
  const row = n + 1;
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const a = base + j * row + i;
      out.push(a, a + 1, a + row, a + 1, a + row + 1, a + row);
    }
  }
  return out;
}

/** HiPS tile address: "Norder3/Dir0/Npix312" (no extension). */
export function tilePath(order, ipix) {
  return `Norder${order}/Dir${Math.floor(ipix / 10000) * 10000}/Npix${ipix}`;
}

/** Unit vector for right ascension and declination in degrees. */
export function radecToVec(ra, dec, out = [0, 0, 0]) {
  const a = (ra * Math.PI) / 180;
  const d = (dec * Math.PI) / 180;
  const c = Math.cos(d);
  out[0] = c * Math.cos(a);
  out[1] = c * Math.sin(a);
  out[2] = Math.sin(d);
  return out;
}

/** { ra, dec } in degrees (ra in 0..360) of a unit vector. */
export function vecToRadec(v) {
  const ra = (Math.atan2(v[1], v[0]) * 180) / Math.PI;
  return { ra: (ra + 360) % 360, dec: (Math.asin(Math.max(-1, Math.min(1, v[2]))) * 180) / Math.PI };
}
