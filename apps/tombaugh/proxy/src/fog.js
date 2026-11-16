// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// Fog of war: a shared all-sky tally of which patches anyone has opened with this tool.
// One object in the proxy cache, key 'fog/nside32.bin': 12,288 uint16 visit counts, little-endian,
// indexed by HEALPix NESTED pixel at nside 32 (cells about 1.8 deg across). 24,576 bytes.
//
// Environment-neutral: typed arrays and DataView only. Imports nothing.
//
// Contract API:
//   fogRead(cache)          -> Promise<Uint16Array(12288)>   zeros if the object is missing or malformed
//   fogMark(cache, ra, dec) -> Promise<{ cell, count }>      read, increment (saturating at 65535),
//                                                            write back as application/octet-stream
//   cache = { get(key) -> Promise<Uint8Array|null>, put(key, u8, contentType) -> Promise<void> }
// Optional extras:
//   fogStats(counts) -> { opened, total, fraction }
//   fogCell(ra, dec) -> cell index, or -1 if ra/dec are not usable (use it to answer 400 early)
//   fogEncode(counts) -> Uint8Array(24576) little-endian;  fogDecode(bytes) -> Uint16Array(12288)
//   ang2pixNest(nside, raDeg, decDeg): this file's own copy of the HEALPix routine (the browser
//     has the same algorithm in web/src/fog/healpix.js; the two are tested against the same values)
//   FOG_KEY, FOG_NSIDE, FOG_NPIX, FOG_BYTES, FOG_MAX, FOG_CONTENT_TYPE
//
// Behaviour the handler should know about:
// - fogMark throws RangeError when ra or dec is not a finite number or dec is outside [-90, 90]
//   (ra is wrapped into [0, 360)). Nothing is written in that case.
// - Errors thrown by cache.get / cache.put propagate. fogMark never writes after a failed read, so
//   a storage hiccup cannot replace the shared map with an empty one.
// - Marks made through the same cache object in one process are queued, so they do not lose
//   increments. Across processes it is plain read-modify-write: a lost increment under a race is
//   accepted by the contract, and each write is always a complete, well-formed array.

export const FOG_KEY = 'fog/nside32.bin';
export const FOG_NSIDE = 32;
export const FOG_NPIX = 12 * FOG_NSIDE * FOG_NSIDE; // 12288
export const FOG_BYTES = 2 * FOG_NPIX; // 24576
export const FOG_MAX = 65535;
export const FOG_CONTENT_TYPE = 'application/octet-stream';

const D2R = Math.PI / 180;

// Spread the low 16 bits of v into the even bits of a 32-bit integer.
function spreadBits(v) {
  v &= 0xffff;
  v = (v | (v << 8)) & 0x00ff00ff;
  v = (v | (v << 4)) & 0x0f0f0f0f;
  v = (v | (v << 2)) & 0x33333333;
  v = (v | (v << 1)) & 0x55555555;
  return v;
}

function xyf2nest(nside, ix, iy, face) {
  return face * nside * nside + ((spreadBits(ix) | (spreadBits(iy) << 1)) >>> 0);
}

/**
 * HEALPix NESTED pixel index of the direction (ra, dec) in degrees, nside a power of two
 * (up to 32768). Gorski et al. 2005, face/x/y formulation. Returns -1 for non-finite input.
 */
export function ang2pixNest(nside, raDeg, decDeg) {
  if (!Number.isInteger(nside) || nside < 1 || nside > 32768 || (nside & (nside - 1)) !== 0) {
    throw new RangeError(`HEALPix nside must be a power of two up to 32768, got ${nside}`);
  }
  if (!Number.isFinite(raDeg) || !Number.isFinite(decDeg)) return -1;
  const dec = Math.max(-90, Math.min(90, decDeg));
  const z = Math.sin(dec * D2R);
  const za = Math.abs(z);
  let tt = (((raDeg % 360) + 360) % 360) / 90; // longitude in units of 90 deg, [0, 4)
  if (tt >= 4) tt = 0;

  if (za <= 2 / 3) {
    // Equatorial belt.
    const t1 = nside * (0.5 + tt);
    const t2 = nside * z * 0.75;
    const jp = Math.floor(t1 - t2); // ascending edge line
    const jm = Math.floor(t1 + t2); // descending edge line
    const ifp = Math.floor(jp / nside);
    const ifm = Math.floor(jm / nside);
    let face;
    if (ifp === ifm) face = (ifp & 3) + 4;
    else if (ifp < ifm) face = ifp & 3;
    else face = (ifm & 3) + 8;
    return xyf2nest(nside, jm & (nside - 1), nside - (jp & (nside - 1)) - 1, face);
  }

  // Polar caps.
  const ntt = Math.min(3, Math.floor(tt));
  const tp = tt - ntt;
  const tmp = za < 0.99
    ? nside * Math.sqrt(3 * (1 - za))
    : (nside * Math.cos(dec * D2R)) / Math.sqrt((1 + za) / 3);
  const jp = Math.min(nside - 1, Math.floor(tp * tmp));
  const jm = Math.min(nside - 1, Math.floor((1 - tp) * tmp));
  return z >= 0
    ? xyf2nest(nside, nside - jm - 1, nside - jp - 1, ntt)
    : xyf2nest(nside, jp, jm, ntt + 8);
}

/** Fog cell of a position, or -1 when ra/dec are not finite numbers or dec is outside [-90, 90]. */
export function fogCell(ra, dec) {
  if (typeof ra !== 'number' || typeof dec !== 'number') return -1;
  if (!Number.isFinite(ra) || !Number.isFinite(dec) || dec < -90 || dec > 90) return -1;
  return ang2pixNest(FOG_NSIDE, ra, dec);
}

/** Stored bytes -> counts. Anything that is not exactly 24,576 bytes decodes to all zeros. */
export function fogDecode(bytes) {
  const counts = new Uint16Array(FOG_NPIX);
  let u8 = null;
  if (bytes instanceof Uint8Array) u8 = bytes;
  else if (bytes instanceof ArrayBuffer) u8 = new Uint8Array(bytes);
  else if (ArrayBuffer.isView(bytes)) u8 = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (!u8 || u8.byteLength !== FOG_BYTES) return counts;
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  for (let i = 0; i < FOG_NPIX; i++) counts[i] = view.getUint16(2 * i, true);
  return counts;
}

/** Counts -> 24,576 little-endian bytes (a fresh buffer). Values are clamped to 0..65535. */
export function fogEncode(counts) {
  const u8 = new Uint8Array(FOG_BYTES);
  const view = new DataView(u8.buffer);
  const n = counts ? Math.min(FOG_NPIX, counts.length >>> 0) : 0;
  for (let i = 0; i < n; i++) {
    const v = Number(counts[i]);
    view.setUint16(2 * i, v > 0 ? Math.min(FOG_MAX, Math.floor(v)) : 0, true);
  }
  return u8;
}

/** The shared visit counts; zeros if nothing has been stored yet or the object is malformed. */
export async function fogRead(cache) {
  return fogDecode(await cache.get(FOG_KEY));
}

// One queue of pending marks per cache object, so marks in the same process run one at a time.
const queues = new WeakMap();

async function markCell(cache, cell) {
  const counts = fogDecode(await cache.get(FOG_KEY));
  const count = Math.min(FOG_MAX, counts[cell] + 1);
  counts[cell] = count;
  await cache.put(FOG_KEY, fogEncode(counts), FOG_CONTENT_TYPE);
  return { cell, count };
}

/** Record one visit to the patch containing (ra, dec). Returns the cell and its new count. */
export function fogMark(cache, ra, dec) {
  const cell = fogCell(ra, dec);
  if (cell < 0) {
    return Promise.reject(new RangeError('fogMark needs ra and dec in degrees, with dec between -90 and 90'));
  }
  const canQueue = cache !== null && (typeof cache === 'object' || typeof cache === 'function');
  const previous = (canQueue && queues.get(cache)) || Promise.resolve();
  const run = previous.then(() => markCell(cache, cell));
  if (canQueue) {
    // The queue itself never rejects, so one failed mark does not block the next.
    const tail = run.then(() => {}, () => {});
    queues.set(cache, tail);
  }
  return run;
}

/** How much of the sky has been opened: cells with a non-zero count. */
export function fogStats(counts) {
  const total = counts ? counts.length >>> 0 : 0;
  let opened = 0;
  for (let i = 0; i < total; i++) if (counts[i] > 0) opened++;
  return { opened, total, fraction: total ? opened / total : 0 };
}
