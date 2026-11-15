// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// Our own exposure index, built from the FITS headers in the public S3 bucket, so that "which
// exposures cover this sky position" is answered in milliseconds without IRSA's TAP service.
// Design: CONTRACT-S3.md, "Index design". Storage goes through the proxy cache object
// (get(key) -> Uint8Array|null, put(key, u8, contentType)); nothing else is kept between calls
// except the optional in-memory `memo` Map the caller passes to searchIndex.
//
// What the integrator calls:
//
//   searchIndex(cache, ra, dec, { margin = 16, dets = [1..6], maxPerDet = 0, memo })
//     -> { frames: [{ id, det, mjd, release, obsid, x, y }], counts: [{ det, total, returned }],
//          dirsSearched, dirsIndexed, dirsTotal, dirsFailed, complete }
//     frames are sorted by mjd then det; id is the IRSA uri; x, y the predicted 1-based
//     detector pixel of the target (0.1 px rounding, good to a few pixels: plain TAN, no SIP).
//     With maxPerDet > 0 a detector with more frames is thinned evenly along its time-ordered
//     list (first and last kept); counts says how many there were.
//
//   indexBuildStep(cache, { release, dir, version? }, { fetchImpl, maxExposures = 900, concurrency = 32 })
//     -> { release, dir, part, parts, n, done }
//     One bounded unit of work for one week directory: makes list.json if missing, builds the
//     first missing part (one Range request per exposure), and when every part exists writes
//     all.bin + meta.json and merges the meta into manifest.json. part = -1 when nothing had to
//     be read. Idempotent; safe to run concurrently for different directories.
//
//   searchIndexMoving(cache, samples, { margin, dets, maxPerDet, memo })
//     Same for a solar-system body: samples = ephemeris [{ mjd, ra, dec }] sorted by mjd. Every
//     frame also carries ra, dec = the body's interpolated position at that exposure.
//
//   indexBuildNext(cache, { fetchImpl, offset = 0, ... }) -> step result | { done: true, idle: true }
//     Convenience: runs indexBuildStep for the (offset+1)-th directory that is not in the
//     manifest yet. Several workers can use different offsets.
//
//   refreshDirs(cache, { fetchImpl, force = false }) -> [{ release, dir, prefix, version }]
//     The directory list (dirs.json), re-listed from S3 when older than 6 hours or forced.
//   indexStatus(cache, { fetchImpl, offline = false })
//     -> { dirs: [{ release, dir, version, n, parts, partsDone, done }], exposures,
//          exposuresDone, complete, manifestBuiltAt }
//   rebuildManifest(cache, { fetchImpl, offline = false }) -> { builtAt, dirs: [meta...] }
//   readExposureHeader(key, opts) -> { mjd, crval1, crval2, pc11, pc12, pc21, pc22 }
//   encodePart(part) / decodePart(u8)       the TBX1 container
//
// Cache objects (all under index/v1/):
//   dirs.json                     { fetchedAt, dirs: [{ release, dir, prefix, version }] }
//   <release>/<dir>/list.json     { release, dir, version, partSize, exposures: ["0001_1", ...],
//                                   dets: [63, ...] | null }   exposures = the detector-1 files,
//                                   sorted; dets[i] = bit mask of the detectors (bit d-1) that
//                                   have a file for exposure i
//   <release>/<dir>/part-<k>.bin  TBX1 (below): exposures [k*partSize, (k+1)*partSize)
//   <release>/<dir>/all.bin       TBX1 with every exposure of the directory (written with meta)
//   <release>/<dir>/meta.json     { release, dir, version, n, parts, partSize, mjdMin, mjdMax,
//                                   bad, cells: "<base64 of 81 bytes>", all: true, builtAt }
//   manifest.json                 { builtAt, dirs: [meta...] }
//
// TBX1 container, little-endian:
//   bytes 0..3    ASCII "TBX1"
//   bytes 4..7    uint32: N = byte length of the JSON header, space-padded so 8 + N is a
//                 multiple of 8
//   bytes 8..8+N  JSON { v: 1, release, dir, version, start, count, exposures: [...], dets }
//   then          Float64Array(count * 7): rows mjd, crval1, crval2, pc11, pc12, pc21, pc22 of
//                 detector 1; a row of NaN when the header could not be read
//
// Coverage bitmap (meta.cells): 648 bits, bit index = floor(ra / 10) + 36 * floor((dec + 90) / 10),
// bit i lives in byte i >> 3 at position i & 7. Bands above +80 and below -80 degrees count as
// one cell each (all 36 bits set). A bit is set when a detector 1, 2 or 3 footprint may touch
// the cell (detectors 4-6 see the same sky).

import { parseHeaderBlock } from './fits.js';
import { rangeGet, listKeys, listReleaseDirs, parseKey, makeKey, keyToId, mapLimit, releaseRank } from './s3.js';
import { M, DET_SHAPE, FP_CRPIX, FP_NPIX, FP_SCALE_DEG, attitudeFromWcs, detectorWcs, detPixToSky } from './focalplane.js';

export const INDEX_ROOT = 'index/v1';
export const DIRS_KEY = `${INDEX_ROOT}/dirs.json`;
export const MANIFEST_KEY = `${INDEX_ROOT}/manifest.json`;
export const HEADER_BYTES = 28800; // primary (2880) + IMAGE header (25920) of a Level-2 file
export const ROW = 7;

const D2R = Math.PI / 180;
const DIRS_MAX_AGE_MS = 6 * 3600 * 1000;
const MAGIC = [0x54, 0x42, 0x58, 0x31]; // "TBX1"
const CELL_BYTES = 81; // 648 bits
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const dirBase = (release, dir) => `${INDEX_ROOT}/${release}/${dir}`;
const listKeyOf = (release, dir) => `${dirBase(release, dir)}/list.json`;
const metaKeyOf = (release, dir) => `${dirBase(release, dir)}/meta.json`;
const allKeyOf = (release, dir) => `${dirBase(release, dir)}/all.bin`;
const partKeyOf = (release, dir, k) => `${dirBase(release, dir)}/part-${k}.bin`;

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------

async function getJson(cache, key) {
  const u8 = await cache.get(key);
  if (!u8) return null;
  try {
    return JSON.parse(decoder.decode(u8));
  } catch {
    return null;
  }
}

async function putBytes(cache, key, bytes, type) {
  const ok = await cache.put(key, bytes, type);
  if (ok === false) {
    const err = new Error(`exposure index: the cache refused to store ${key}`);
    err.retryable = true;
    throw err;
  }
}

const putJson = (cache, key, value) => putBytes(cache, key, encoder.encode(JSON.stringify(value)), 'application/json');

function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function fromBase64(text) {
  try {
    const s = atob(String(text || ''));
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  } catch {
    return new Uint8Array(0);
  }
}

// ---------------------------------------------------------------------------------------------
// Reading one exposure header
// ---------------------------------------------------------------------------------------------

/**
 * Pointing and time of one Level-2 file from a single Range request for bytes 0..28799 (more
 * is read only if the IMAGE header turns out to be longer). MJD-AVG, falling back to MJD-OBS.
 * If the reference pixel is not the detector centre, CRVAL is moved there.
 */
export async function readExposureHeader(key, opts = {}) {
  let { bytes } = await rangeGet(key, 0, HEADER_BYTES - 1, opts);
  let image = null;
  for (let round = 0; ; round++) {
    const primary = parseHeaderBlock(bytes, 0);
    if (primary) image = parseHeaderBlock(bytes, primary.headerBytes + primary.paddedDataBytes);
    if (image) break;
    if (round >= 3) throw new Error(`exposure index: no complete IMAGE header in the first ${bytes.length} bytes of ${key}`);
    const more = await rangeGet(key, bytes.length, bytes.length + HEADER_BYTES - 1, opts);
    if (more.bytes.length === 0) throw new Error(`exposure index: ${key} ends inside its IMAGE header`);
    const joined = new Uint8Array(bytes.length + more.bytes.length);
    joined.set(bytes, 0);
    joined.set(more.bytes, bytes.length);
    bytes = joined;
  }
  const h = image.cards;
  const num = (name) => {
    const v = h.get(name);
    return typeof v === 'number' && Number.isFinite(v) ? v : NaN;
  };
  let mjd = num('MJD-AVG');
  if (!Number.isFinite(mjd)) mjd = num('MJD-OBS');
  let crval = [num('CRVAL1'), num('CRVAL2')];
  let pc;
  if (h.has('PC1_1') || !h.has('CD1_1')) {
    const c1 = Number.isFinite(num('CDELT1')) ? num('CDELT1') : 1;
    const c2 = Number.isFinite(num('CDELT2')) ? num('CDELT2') : 1;
    pc = [c1 * num('PC1_1'), c1 * num('PC1_2'), c2 * num('PC2_1'), c2 * num('PC2_2')];
  } else {
    pc = [num('CD1_1'), num('CD1_2'), num('CD2_1'), num('CD2_2')];
  }
  const crpix = [num('CRPIX1'), num('CRPIX2')];
  const all = [mjd, crval[0], crval[1], pc[0], pc[1], pc[2], pc[3], crpix[0], crpix[1]];
  if (!all.every(Number.isFinite)) throw new Error(`exposure index: ${key} lacks MJD / CRVAL / PC / CRPIX cards`);
  if (Math.abs(crpix[0] - FP_CRPIX) > 0.01 || Math.abs(crpix[1] - FP_CRPIX) > 0.01) {
    crval = detPixToSky({ crval, pc, crpix }, FP_CRPIX, FP_CRPIX);
  }
  return { mjd, crval1: crval[0], crval2: crval[1], pc11: pc[0], pc12: pc[1], pc21: pc[2], pc22: pc[3] };
}

// ---------------------------------------------------------------------------------------------
// TBX1 container
// ---------------------------------------------------------------------------------------------

/**
 * @param {{ release, dir, version, start: number, exposures: string[], rows: Float64Array,
 *           dets?: ArrayLike<number>|null }} part   rows has exposures.length * 7 numbers
 * @returns {Uint8Array}
 */
export function encodePart({ release, dir, version, start = 0, exposures, rows, dets = null }) {
  const count = exposures.length;
  if (rows.length !== count * ROW) throw new Error(`encodePart: ${rows.length} numbers for ${count} exposures`);
  const header = { v: 1, release, dir, version, start, count, exposures: Array.from(exposures), dets: dets ? Array.from(dets) : null };
  const json = encoder.encode(JSON.stringify(header));
  const n = Math.ceil((8 + json.length) / 8) * 8 - 8;
  const out = new Uint8Array(8 + n + count * ROW * 8);
  const dv = new DataView(out.buffer);
  out.set(MAGIC, 0);
  dv.setUint32(4, n, true);
  out.fill(0x20, 8, 8 + n);
  out.set(json, 8);
  for (let i = 0; i < rows.length; i++) dv.setFloat64(8 + n + i * 8, rows[i], true);
  return out;
}

/** Inverse of encodePart: { v, release, dir, version, start, count, exposures, dets, rows }. */
export function decodePart(input) {
  const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (u8.length < 8 || MAGIC.some((b, i) => u8[i] !== b)) throw new Error('Not a TBX1 index part: bad magic bytes');
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const n = dv.getUint32(4, true);
  if (8 + n > u8.length) throw new Error('TBX1 index part is truncated inside its header');
  const header = JSON.parse(decoder.decode(u8.subarray(8, 8 + n)));
  if (!header || header.v !== 1 || !Array.isArray(header.exposures) || header.exposures.length !== header.count) {
    throw new Error('TBX1 index part has an unusable header');
  }
  if (8 + n + header.count * ROW * 8 > u8.length) throw new Error('TBX1 index part is truncated inside its rows');
  const rows = new Float64Array(header.count * ROW);
  for (let i = 0; i < rows.length; i++) rows[i] = dv.getFloat64(8 + n + i * 8, true);
  return { ...header, dets: Array.isArray(header.dets) ? header.dets : null, rows };
}

// ---------------------------------------------------------------------------------------------
// Coverage bitmap
// ---------------------------------------------------------------------------------------------

/** Bit index of the 10-degree cell containing (ra, dec). */
export function cellOf(ra, dec) {
  const r = ((ra % 360) + 360) % 360;
  const ira = Math.min(35, Math.floor(r / 10));
  const idec = Math.min(17, Math.max(0, Math.floor((dec + 90) / 10)));
  return ira + 36 * idec;
}

const setBit = (bits, i) => {
  bits[i >> 3] |= 1 << (i & 7);
};
const hasBit = (bits, i) => (i >> 3) < bits.length && ((bits[i >> 3] >> (i & 7)) & 1) === 1;

// Lattice points are at most 0.62 degrees from any point of the footprint (2040 px * 6.16
// arcsec / 4 per step, half a diagonal), and the approximate WCS is good to an arcminute, so
// marking the cells of the 3 x 3 points at +-0.75 degrees around every lattice point cannot
// miss a cell that the true footprint touches.
const CELL_REACH_DEG = 0.75;

function markAround(bits, ra, dec) {
  for (let j = -1; j <= 1; j++) {
    const d = Math.max(-90, Math.min(90, dec + j * CELL_REACH_DEG));
    const band = Math.min(17, Math.max(0, Math.floor((d + 90) / 10)));
    if (d >= 80 || d < -80) {
      for (let i = 0; i < 36; i++) setBit(bits, i + 36 * band); // polar caps are one cell
      continue;
    }
    const reach = CELL_REACH_DEG / Math.cos(d * D2R); // at most 4.3 degrees below 80
    for (let i = -1; i <= 1; i++) setBit(bits, cellOf(ra + i * reach, d));
  }
}

/** Coverage bitmap (81 bytes) of the detector 1-3 footprints of every readable row. */
export function coverageCells(rows) {
  const bits = new Uint8Array(CELL_BYTES);
  const n = Math.floor(rows.length / ROW);
  for (let r = 0; r < n; r++) {
    const o = r * ROW;
    if (!Number.isFinite(rows[o]) || !Number.isFinite(rows[o + 1]) || !Number.isFinite(rows[o + 6])) continue;
    const triad = attitudeFromWcs({ crval: [rows[o + 1], rows[o + 2]], pc: [rows[o + 3], rows[o + 4], rows[o + 5], rows[o + 6]] });
    for (let det = 1; det <= 3; det++) {
      const wcs = detectorWcs(triad, det);
      for (let iy = 0; iy < 5; iy++) {
        for (let ix = 0; ix < 5; ix++) {
          const [ra, dec] = detPixToSky(wcs, 0.5 + (ix * FP_NPIX) / 4, 0.5 + (iy * FP_NPIX) / 4);
          markAround(bits, ra, dec);
        }
      }
    }
  }
  return bits;
}

// ---------------------------------------------------------------------------------------------
// Directory list
// ---------------------------------------------------------------------------------------------

/**
 * The week directories to index. Uses index/v1/dirs.json when it is younger than 6 hours
 * (opts.maxAgeMs), otherwise lists the bucket again (only new directories cost a request each)
 * and stores the result. With force = true the bucket is always listed. If S3 cannot be reached
 * and an older list exists, the older list is returned (unless forced).
 */
export async function refreshDirs(cache, opts = {}) {
  const { force = false, maxAgeMs = DIRS_MAX_AGE_MS, now = Date.now } = opts;
  const stored = await getJson(cache, DIRS_KEY);
  const usable = stored && Array.isArray(stored.dirs) ? stored : null;
  if (usable && !force) {
    const age = now() - Date.parse(usable.fetchedAt);
    if (Number.isFinite(age) && age >= 0 && age < maxAgeMs) return usable.dirs;
  }
  let dirs;
  try {
    dirs = await listReleaseDirs({ ...opts, known: usable ? usable.dirs : null });
    if (dirs.length === 0) throw new Error('exposure index: the bucket lists no Level-2 directories');
  } catch (err) {
    if (usable && !force) return usable.dirs;
    throw err;
  }
  await putJson(cache, DIRS_KEY, { fetchedAt: new Date(now()).toISOString(), dirs });
  return dirs;
}

/** dirs.json as stored, or null: never touches the network. */
async function storedDirs(cache) {
  const stored = await getJson(cache, DIRS_KEY);
  return stored && Array.isArray(stored.dirs) ? stored.dirs : null;
}

async function currentDirs(cache, opts) {
  if (opts && opts.offline) return storedDirs(cache);
  try {
    return await refreshDirs(cache, opts);
  } catch (err) {
    const stored = await storedDirs(cache);
    if (stored) return stored;
    throw err;
  }
}

// ---------------------------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------------------------

async function buildList(entry, opts) {
  const { release, dir, version } = entry;
  const { maxExposures = 900, detMasks = true } = opts;
  const prefix = `${release}/level2/${dir}/${version}/`;
  const detList = detMasks ? [1, 2, 3, 4, 5, 6] : [1];
  const listings = await Promise.all(detList.map((det) => listKeys(`${prefix}${det}/`, opts)));
  const masks = new Map();
  listings.forEach((keys, i) => {
    const det = detList[i];
    for (const { key } of keys) {
      let p;
      try {
        p = parseKey(key);
      } catch {
        continue; // not a Level-2 file name
      }
      if (p.release !== release || p.dir !== dir || p.version !== version || p.det !== det) continue;
      masks.set(p.suffix, (masks.get(p.suffix) || 0) | (1 << (det - 1)));
    }
  });
  const exposures = [...masks.keys()].filter((s) => masks.get(s) & 1).sort();
  return {
    release,
    dir,
    version,
    partSize: Math.max(1, Math.floor(maxExposures)),
    exposures,
    dets: detMasks ? exposures.map((s) => masks.get(s)) : null,
  };
}

async function loadPart(cache, list, k) {
  const u8 = await cache.get(partKeyOf(list.release, list.dir, k));
  if (!u8) return null;
  try {
    const part = decodePart(u8);
    const start = k * list.partSize;
    const count = Math.min(list.partSize, list.exposures.length - start);
    if (part.version !== list.version || part.start !== start || part.count !== count) return null;
    if (part.exposures[0] !== list.exposures[start] || part.exposures[count - 1] !== list.exposures[start + count - 1]) return null;
    return part;
  } catch {
    return null;
  }
}

function isTransient(err) {
  return Boolean(err && err.retryable) || (err && err.code === 'UPSTREAM');
}

async function buildPart(list, k, opts) {
  const { concurrency = 32 } = opts;
  const { release, dir, version } = list;
  const start = k * list.partSize;
  const count = Math.min(list.partSize, list.exposures.length - start);
  const rows = new Float64Array(count * ROW).fill(NaN);
  const readOne = async (i) => {
    const key = makeKey({ release, dir, version, det: 1, suffix: list.exposures[start + i] });
    const h = await readExposureHeader(key, opts);
    rows.set([h.mjd, h.crval1, h.crval2, h.pc11, h.pc12, h.pc21, h.pc22], i * ROW);
  };
  let failed = [];
  await mapLimit(Array.from({ length: count }, (_, i) => i), concurrency, async (i) => {
    try {
      await readOne(i);
    } catch (err) {
      failed.push({ i, err });
    }
  });
  if (failed.some((f) => isTransient(f.err))) {
    // Second chance, gently, for what may pass (throttling, timeouts). A file that answered
    // but is not a Level-2 FITS file is not asked again.
    const again = failed.filter((f) => isTransient(f.err));
    failed = failed.filter((f) => !isTransient(f.err));
    await mapLimit(again, 4, async ({ i }) => {
      try {
        await readOne(i);
      } catch (err) {
        failed.push({ i, err });
      }
    });
  }
  // A file that is unreadable becomes a NaN row. Many transient failures mean S3 itself is in
  // trouble: writing those as NaN would poison the index for good, so the step fails instead.
  const transient = failed.filter((f) => isTransient(f.err)).length;
  const allowed = opts.maxTransientFailures ?? Math.max(3, Math.ceil(count * 0.02));
  if (transient > allowed || (transient > 0 && transient === count)) {
    const err = new Error(
      `exposure index: ${transient} of ${count} headers of ${release}/${dir} part ${k} could not be read (${failed[0].err.message})`,
    );
    err.retryable = true;
    err.code = 'UPSTREAM';
    throw err;
  }
  return {
    release,
    dir,
    version,
    start,
    exposures: list.exposures.slice(start, start + count),
    dets: list.dets ? list.dets.slice(start, start + count) : null,
    rows,
    bad: failed.length,
  };
}

async function mergeIntoManifest(cache, metas) {
  const manifest = (await getJson(cache, MANIFEST_KEY)) || {};
  const byDir = new Map();
  for (const m of Array.isArray(manifest.dirs) ? manifest.dirs : []) byDir.set(`${m.release}/${m.dir}`, m);
  for (const m of metas) byDir.set(`${m.release}/${m.dir}`, m);
  const out = { builtAt: new Date().toISOString(), dirs: sortMetas([...byDir.values()]) };
  await putJson(cache, MANIFEST_KEY, out);
  return out;
}

function sortMetas(metas) {
  return metas.sort((a, b) => (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : a.release < b.release ? -1 : a.release > b.release ? 1 : 0));
}

async function finalizeDir(cache, list, parts, opts) {
  const n = list.exposures.length;
  const rows = new Float64Array(n * ROW);
  let offset = 0;
  for (const p of parts) {
    rows.set(p.rows, offset);
    offset += p.rows.length;
  }
  let mjdMin = Infinity;
  let mjdMax = -Infinity;
  let bad = 0;
  for (let i = 0; i < n; i++) {
    const mjd = rows[i * ROW];
    if (!Number.isFinite(mjd) || !Number.isFinite(rows[i * ROW + 1])) {
      bad += 1;
      continue;
    }
    if (mjd < mjdMin) mjdMin = mjd;
    if (mjd > mjdMax) mjdMax = mjd;
  }
  const { release, dir, version } = list;
  await putBytes(
    cache,
    allKeyOf(release, dir),
    encodePart({ release, dir, version, start: 0, exposures: list.exposures, rows, dets: list.dets }),
    'application/octet-stream',
  );
  const meta = {
    release,
    dir,
    version,
    n,
    parts: parts.length,
    partSize: list.partSize,
    mjdMin: Number.isFinite(mjdMin) ? mjdMin : null,
    mjdMax: Number.isFinite(mjdMax) ? mjdMax : null,
    bad,
    cells: toBase64(coverageCells(rows)),
    all: true,
    builtAt: new Date().toISOString(),
  };
  await putJson(cache, metaKeyOf(release, dir), meta);
  if (opts.updateManifest !== false) await mergeIntoManifest(cache, [meta]);
  return meta;
}

/**
 * One unit of index building for one directory; see the top of this file.
 * opts: fetchImpl and the other s3.js options; maxExposures (part size, fixed when list.json is
 * first written); concurrency (parallel header reads); detMasks (default true: also list
 * detectors 2-6 so that the search never returns a file that does not exist);
 * updateManifest (default true).
 * Throws (retryable) when S3 cannot be listed or too many headers fail; a single unreadable
 * file never throws.
 */
export async function indexBuildStep(cache, target, opts = {}) {
  const { release, dir } = target;
  let version = target.version || null;
  if (!version) {
    const dirs = (await storedDirs(cache)) || (await refreshDirs(cache, opts));
    let entry = dirs.find((d) => d.release === release && d.dir === dir);
    if (!entry) entry = (await refreshDirs(cache, { ...opts, force: true })).find((d) => d.release === release && d.dir === dir);
    if (!entry) throw new Error(`exposure index: no directory ${release}/${dir} in the bucket`);
    version = entry.version;
  }

  let list = await getJson(cache, listKeyOf(release, dir));
  if (!list || list.version !== version || !Array.isArray(list.exposures) || !(list.partSize >= 1)) {
    list = await buildList({ release, dir, version }, opts);
    await putJson(cache, listKeyOf(release, dir), list);
  }
  const n = list.exposures.length;
  const parts = Math.ceil(n / list.partSize);
  const result = (part, done) => ({ release, dir, part, parts, n, done });

  const meta = await getJson(cache, metaKeyOf(release, dir));
  if (meta && meta.version === version && meta.n === n && meta.parts === parts) return result(-1, true);

  const have = [];
  let k = 0;
  for (; k < parts; k++) {
    const p = await loadPart(cache, list, k);
    if (!p) break;
    have.push(p);
  }
  let built = -1;
  if (k < parts) {
    const part = await buildPart(list, k, opts);
    await putBytes(cache, partKeyOf(release, dir, k), encodePart(part), 'application/octet-stream');
    have.push(part);
    built = k;
    for (let j = k + 1; j < parts; j++) {
      const p = await loadPart(cache, list, j);
      if (!p) return result(built, false);
      have.push(p);
    }
  }
  await finalizeDir(cache, list, have, opts);
  return result(built, true);
}

/**
 * Run one build step for a directory that is not in the manifest yet (the offset-th such
 * directory, so parallel workers can take different ones). Resolves { done: true, idle: true }
 * when every directory is indexed.
 */
export async function indexBuildNext(cache, opts = {}) {
  const dirs = await currentDirs(cache, opts);
  if (!dirs) throw new Error('exposure index: no directory list yet');
  const manifest = await getJson(cache, MANIFEST_KEY);
  const inManifest = new Set();
  for (const m of manifest && Array.isArray(manifest.dirs) ? manifest.dirs : []) inManifest.add(`${m.release}/${m.dir}/${m.version}`);
  const todo = dirs.filter((d) => !inManifest.has(`${d.release}/${d.dir}/${d.version}`));
  if (todo.length === 0) return { done: true, idle: true, remaining: 0 };
  const pick = todo[Math.min(todo.length - 1, Math.max(0, opts.offset | 0))];
  const step = await indexBuildStep(cache, pick, opts);
  return { ...step, remaining: todo.length - (step.done ? 1 : 0) };
}

// ---------------------------------------------------------------------------------------------
// Status and manifest
// ---------------------------------------------------------------------------------------------

/**
 * Progress of the index. Cheap: manifest.json and dirs.json, plus list/meta/parts only for
 * directories that are not in the manifest (16 at a time). Directories that turn out to be
 * finished but missing from the manifest are merged into it.
 */
export async function indexStatus(cache, opts = {}) {
  const manifest = await getJson(cache, MANIFEST_KEY);
  const metas = manifest && Array.isArray(manifest.dirs) ? manifest.dirs : [];
  const dirs = (await currentDirs(cache, opts)) || metas.map((m) => ({ release: m.release, dir: m.dir, version: m.version }));
  const byDir = new Map(metas.map((m) => [`${m.release}/${m.dir}`, m]));
  const healed = [];
  let exposuresDone = 0;
  const rows = await mapLimit(dirs, opts.statusConcurrency || 16, async (d) => {
    const base = { release: d.release, dir: d.dir, version: d.version };
    const known = byDir.get(`${d.release}/${d.dir}`);
    if (known && known.version === d.version) {
      exposuresDone += known.n;
      return { ...base, n: known.n, parts: known.parts, partsDone: known.parts, done: true };
    }
    const list = await getJson(cache, listKeyOf(d.release, d.dir));
    if (!list || list.version !== d.version || !Array.isArray(list.exposures)) {
      return { ...base, n: null, parts: null, partsDone: 0, done: false };
    }
    const n = list.exposures.length;
    const parts = Math.ceil(n / list.partSize);
    const meta = await getJson(cache, metaKeyOf(d.release, d.dir));
    if (meta && meta.version === d.version && meta.n === n) {
      healed.push(meta);
      exposuresDone += n;
      return { ...base, n, parts, partsDone: parts, done: true };
    }
    let partsDone = 0;
    for (let k = 0; k < parts; k++) {
      const p = await loadPart(cache, list, k);
      if (!p) continue;
      partsDone += 1;
      exposuresDone += p.count;
    }
    return { ...base, n, parts, partsDone, done: false };
  });
  if (healed.length > 0) {
    try {
      await mergeIntoManifest(cache, healed);
    } catch {
      // status must not fail because the cache is read-only right now
    }
  }
  let exposures = 0;
  for (const r of rows) if (r.n !== null) exposures += r.n;
  return {
    dirs: rows,
    exposures,
    exposuresDone,
    complete: rows.length > 0 && rows.every((r) => r.done),
    manifestBuiltAt: manifest ? manifest.builtAt || null : null,
  };
}

/**
 * Rebuild manifest.json from the meta.json of every directory in dirs.json. A directory
 * without a meta (or whose meta belongs to another processing version) is simply absent.
 */
export async function rebuildManifest(cache, opts = {}) {
  const dirs = await currentDirs(cache, opts);
  if (!dirs) throw new Error('exposure index: no directory list yet');
  const metas = await mapLimit(dirs, opts.statusConcurrency || 16, async (d) => {
    const meta = await getJson(cache, metaKeyOf(d.release, d.dir));
    return meta && meta.version === d.version && typeof meta.cells === 'string' ? meta : null;
  });
  const manifest = { builtAt: new Date().toISOString(), dirs: sortMetas(metas.filter(Boolean)) };
  await putJson(cache, MANIFEST_KEY, manifest);
  return manifest;
}

// ---------------------------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------------------------

const MEMO_MAX_BYTES = 64 * 1024 * 1024;

function memoGet(memo, key, maxAgeMs) {
  if (!memo) return undefined;
  const entry = memo.get(key);
  if (!entry) return undefined;
  if (maxAgeMs !== undefined && Date.now() - entry.at > maxAgeMs) {
    memo.delete(key);
    return undefined;
  }
  memo.delete(key); // re-insert: most recently used goes last
  memo.set(key, entry);
  return entry.value;
}

function memoPut(memo, key, value, bytes, maxBytes) {
  if (!memo) return;
  memo.delete(key);
  memo.set(key, { value, bytes, at: Date.now() });
  let total = 0;
  for (const e of memo.values()) total += e.bytes;
  for (const [k, e] of memo) {
    if (total <= maxBytes) break;
    if (k === key) continue;
    memo.delete(k);
    total -= e.bytes;
  }
}

/** A decoded part in search form: per exposure its mjd and the 9 numbers of the D1 triad. */
function searchPart(part) {
  const count = part.count;
  const mjd = new Float64Array(count);
  const triad = new Float64Array(count * 9).fill(NaN);
  const rows = part.rows;
  for (let i = 0; i < count; i++) {
    const o = i * ROW;
    mjd[i] = rows[o];
    let ok = true;
    for (let k = 0; k < ROW; k++) if (!Number.isFinite(rows[o + k])) ok = false;
    if (!ok) continue;
    const [ux, uy, b] = attitudeFromWcs({ crval: [rows[o + 1], rows[o + 2]], pc: [rows[o + 3], rows[o + 4], rows[o + 5], rows[o + 6]] });
    triad.set(ux, i * 9);
    triad.set(uy, i * 9 + 3);
    triad.set(b, i * 9 + 6);
  }
  const dets = part.dets ? Uint8Array.from(part.dets) : null;
  let textBytes = 0;
  for (const s of part.exposures) textBytes += 2 * s.length + 24;
  return { count, exposures: part.exposures, mjd, triad, dets, bytes: count * 81 + textBytes + 200 };
}

async function loadDirForSearch(cache, meta, memo, maxBytes) {
  const memoKey = `dir:${meta.release}/${meta.dir}/${meta.version}/${meta.n}`;
  const hit = memoGet(memo, memoKey);
  if (hit) return hit;
  let parts = null;
  if (meta.all) {
    const u8 = await cache.get(allKeyOf(meta.release, meta.dir));
    if (u8) {
      try {
        const part = decodePart(u8);
        if (part.version === meta.version && part.count === meta.n) parts = [searchPart(part)];
      } catch {
        parts = null;
      }
    }
  }
  if (!parts) {
    const loaded = await mapLimit(Array.from({ length: meta.parts }, (_, k) => k), 6, async (k) => {
      const u8 = await cache.get(partKeyOf(meta.release, meta.dir, k));
      if (!u8) return null;
      try {
        const part = decodePart(u8);
        return part.version === meta.version ? searchPart(part) : null;
      } catch {
        return null;
      }
    });
    if (loaded.some((p) => !p)) return null;
    parts = loaded;
  }
  let bytes = 0;
  for (const p of parts) bytes += p.bytes;
  const value = { parts };
  memoPut(memo, memoKey, value, bytes, maxBytes);
  return value;
}

async function loadManifestForSearch(cache, memo, ttlMs, maxBytes) {
  const hit = memoGet(memo, 'manifest', ttlMs);
  if (hit) return hit;
  const [manifest, dirs] = await Promise.all([getJson(cache, MANIFEST_KEY), storedDirs(cache)]);
  let metas = manifest && Array.isArray(manifest.dirs) ? manifest.dirs.filter((m) => m && typeof m.cells === 'string') : [];
  if (dirs) {
    const current = new Set(dirs.map((d) => `${d.release}/${d.dir}/${d.version}`));
    metas = metas.filter((m) => current.has(`${m.release}/${m.dir}/${m.version}`));
  }
  // One copy per week directory: a DR beats a QR, then the higher number.
  const best = new Map();
  for (const m of metas) {
    const prev = best.get(m.dir);
    if (!prev || releaseRank(m.release) > releaseRank(prev.release)) best.set(m.dir, m);
  }
  const list = [...best.values()].map((m) => ({ meta: m, cells: fromBase64(m.cells) }));
  const value = { dirs: list, dirsTotal: dirs ? dirs.length : list.length };
  memoPut(memo, 'manifest', value, 400 * list.length + 1000, maxBytes);
  return value;
}

// Quick rejections. A detector's corner is 2.47 degrees from its centre; detectors 3 and 6 sit
// 7.73 degrees from detector 1.
const COS_FOCAL_PLANE = Math.cos(11 * D2R);
const COS_DETECTOR = Math.cos(2.8 * D2R);

/** Evenly thin a time-ordered list to `keep` items, always keeping the first and the last. */
function thin(list, keep) {
  if (!(keep > 0) || list.length <= keep) return list;
  if (keep === 1) return [list[list.length >> 1]];
  const out = [];
  for (let j = 0; j < keep; j++) out.push(list[Math.round((j * (list.length - 1)) / (keep - 1))]);
  return out;
}

/**
 * Which exposures cover (ra, dec)? See the top of this file for the result.
 * opts: margin (pixels a target must be inside the detector edge, default 16), dets (default
 * all six), maxPerDet (0 = no limit), memo (a Map kept by the caller: in-memory LRU of decoded
 * directories and of the manifest), memoMaxBytes (default 64 MB), manifestTtlMs (how long a
 * memoised manifest is trusted, default 30 s).
 * Never touches the network: only the cache.
 */
export async function searchIndex(cache, ra, dec, opts = {}) {
  if (!Number.isFinite(ra) || !Number.isFinite(dec) || dec < -90 || dec > 90) {
    throw new RangeError('searchIndex: ra and dec must be finite numbers in degrees');
  }
  const cd = Math.cos(dec * D2R);
  const fixed = [cd * Math.cos(ra * D2R), cd * Math.sin(ra * D2R), Math.sin(dec * D2R)];
  const cell = cellOf(ra, dec);
  return runSearch(cache, opts, { fixed, select: (d) => hasBit(d.cells, cell) });
}

/** The cell of (ra, dec) and its 8 neighbours (RA wraps, Dec does not). */
function cellNeighbourhood(ra, dec, into) {
  const c = cellOf(ra, dec);
  const ira = c % 36;
  const idec = (c - ira) / 36;
  for (let dj = -1; dj <= 1; dj++) {
    const j = idec + dj;
    if (j < 0 || j > 17) continue;
    for (let di = -1; di <= 1; di++) into.add(((ira + di + 36) % 36) + 36 * j);
  }
}

/** Index of the last sample with mjd <= t (samples sorted by mjd); -1 when t is before all. */
function lastAtOrBefore(mjds, t) {
  let lo = 0;
  let hi = mjds.length - 1;
  if (!(t >= mjds[0])) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (mjds[mid] <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Which exposures caught a moving body? `samples` is its ephemeris [{ mjd, ra, dec }] sorted by
 * mjd (RA may wrap through 0/360). For every indexed exposure whose mjd lies inside the sampled
 * span, the body's position is interpolated to the exposure's mjd (linearly between the two
 * neighbouring samples, on unit vectors, renormalised) and tested against the footprints
 * exactly as searchIndex does. Same options and same result as searchIndex; every frame also
 * has `ra`, `dec`: the interpolated position at that exposure (rounded to 1e-6 deg), for
 * centring the cutout.
 *
 * A directory is searched when its coverage bitmap contains the cell (or one of the 8
 * neighbouring cells) of the body's position at a sample within one day of the directory's
 * [mjdMin, mjdMax]; the samples just outside that window are included, so sparse sampling
 * cannot skip a directory.
 */
export async function searchIndexMoving(cache, samples, opts = {}) {
  if (!Array.isArray(samples) || samples.length < 2) {
    throw new RangeError('searchIndexMoving: need at least two ephemeris samples');
  }
  const n = samples.length;
  const mjds = new Float64Array(n);
  const vec = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const { mjd, ra, dec } = samples[i];
    if (!Number.isFinite(mjd) || !Number.isFinite(ra) || !Number.isFinite(dec) || dec < -90 || dec > 90) {
      throw new RangeError(`searchIndexMoving: sample ${i} is not { mjd, ra, dec } in days and degrees`);
    }
    if (i > 0 && mjd < mjds[i - 1]) throw new RangeError('searchIndexMoving: samples must be sorted by mjd');
    mjds[i] = mjd;
    const cd = Math.cos(dec * D2R);
    vec[3 * i] = cd * Math.cos(ra * D2R);
    vec[3 * i + 1] = cd * Math.sin(ra * D2R);
    vec[3 * i + 2] = Math.sin(dec * D2R);
  }
  const select = (d) => {
    const { mjdMin, mjdMax } = d.meta;
    if (!Number.isFinite(mjdMin) || !Number.isFinite(mjdMax)) return false;
    if (mjdMax < mjds[0] || mjdMin > mjds[n - 1]) return false; // no exposure inside the span
    const first = Math.max(0, lastAtOrBefore(mjds, mjdMin - 1));
    const last = Math.min(n - 1, lastAtOrBefore(mjds, mjdMax + 1) + 1);
    const cells = new Set();
    for (let i = first; i <= last; i++) cellNeighbourhood(samples[i].ra, samples[i].dec, cells);
    for (const c of cells) if (hasBit(d.cells, c)) return true;
    return false;
  };
  return runSearch(cache, opts, { moving: { mjds, vec }, select });
}

async function runSearch(cache, opts, target) {
  const {
    margin = 16,
    dets = [1, 2, 3, 4, 5, 6],
    maxPerDet = 0,
    memo = null,
    memoMaxBytes = MEMO_MAX_BYTES,
    manifestTtlMs = 30000,
  } = opts;
  const detList = [...new Set(dets)].filter((d) => Number.isInteger(d) && d >= 1 && d <= 6).sort();
  const { dirs: manifestDirs, dirsTotal } = await loadManifestForSearch(cache, memo, manifestTtlMs, memoMaxBytes);

  const wanted = manifestDirs.filter(target.select);
  const loaded = await mapLimit(wanted, 8, (d) => loadDirForSearch(cache, d.meta, memo, memoMaxBytes));

  // Target unit vector: fixed, or interpolated per exposure for a moving body.
  const moving = target.moving || null;
  let tx = 0;
  let ty = 0;
  let tz = 0;
  if (!moving) [tx, ty, tz] = target.fixed;
  const mjds = moving ? moving.mjds : null;
  const vec = moving ? moving.vec : null;
  const t0 = moving ? mjds[0] : 0;
  const t1 = moving ? mjds[mjds.length - 1] : 0;
  let seg = 0; // sample interval of the previous exposure: exposures are nearly time-ordered

  const lo = margin;
  const hi = FP_NPIX + 1 - margin;
  const scale = FP_SCALE_DEG * D2R; // radians per pixel
  // Per detector: the rotation matrix and the inverse of the pixel shape.
  const nd = detList.length;
  const mats = detList.map((d) => M[d]);
  const invKx = detList.map((d) => 1 / (DET_SHAPE[d][0] * scale));
  const ka = detList.map((d) => DET_SHAPE[d][1] * scale);
  const invKc = detList.map((d) => 1 / (DET_SHAPE[d][2] * scale));
  const perDet = detList.map(() => []);

  let dirsFailed = 0;
  for (let w = 0; w < wanted.length; w++) {
    const data = loaded[w];
    if (!data) {
      dirsFailed += 1;
      continue;
    }
    const meta = wanted[w].meta;
    for (const part of data.parts) {
      const T = part.triad;
      const masks = part.dets;
      for (let i = 0, o = 0; i < part.count; i++, o += 9) {
        if (moving) {
          const t = part.mjd[i];
          if (!(t >= t0 && t <= t1)) continue; // outside the ephemeris (or an unreadable row)
          if (!(mjds[seg] <= t && t <= mjds[seg + 1])) seg = Math.min(mjds.length - 2, lastAtOrBefore(mjds, t));
          const span = mjds[seg + 1] - mjds[seg];
          const f = span > 0 ? (t - mjds[seg]) / span : 0;
          const a = 3 * seg;
          const vx = vec[a] + f * (vec[a + 3] - vec[a]);
          const vy = vec[a + 1] + f * (vec[a + 4] - vec[a + 1]);
          const vz = vec[a + 2] + f * (vec[a + 5] - vec[a + 2]);
          const norm = Math.sqrt(vx * vx + vy * vy + vz * vz);
          if (!(norm > 0)) continue; // antipodal samples: no direction in between
          tx = vx / norm;
          ty = vy / norm;
          tz = vz / norm;
        }
        // Target in the frame of detector 1: (t.ux, t.uy, t.b). NaN rows fail the comparison.
        const p2 = tx * T[o + 6] + ty * T[o + 7] + tz * T[o + 8];
        if (!(p2 > COS_FOCAL_PLANE)) continue;
        const p0 = tx * T[o] + ty * T[o + 1] + tz * T[o + 2];
        const p1 = tx * T[o + 3] + ty * T[o + 4] + tz * T[o + 5];
        const mask = masks ? masks[i] : 63;
        for (let k = 0; k < nd; k++) {
          const m = mats[k];
          // A_d[j] = sum_i M[i][j] A_1[i], so t.A_d[j] = sum_i M[i][j] (t.A_1[i]).
          const q2 = m[2] * p0 + m[5] * p1 + m[8] * p2;
          if (q2 < COS_DETECTOR) continue;
          const gx = (m[0] * p0 + m[3] * p1 + m[6] * p2) / q2; // gnomonic coordinates (radians)
          const gy = (m[1] * p0 + m[4] * p1 + m[7] * p2) / q2; // along ux_d and uy_d
          const dy = gy * invKc[k];
          const dx = (gx - ka[k] * dy) * invKx[k];
          const x = FP_CRPIX + dx;
          const y = FP_CRPIX + dy;
          if (x < lo || x > hi || y < lo || y > hi) continue;
          const det = detList[k];
          if (!((mask >> (det - 1)) & 1)) continue; // that detector has no file for this exposure
          const suffix = part.exposures[i];
          const frame = {
            id: keyToId(makeKey({ release: meta.release, dir: meta.dir, version: meta.version, det, suffix })),
            det,
            mjd: part.mjd[i],
            release: meta.release,
            obsid: `${meta.dir}_${suffix}`,
            x: Math.round(x * 10) / 10,
            y: Math.round(y * 10) / 10,
          };
          if (moving) {
            let raDeg = Math.atan2(ty, tx) / D2R;
            if (raDeg < 0) raDeg += 360;
            frame.ra = Math.round(raDeg * 1e6) / 1e6;
            if (frame.ra >= 360) frame.ra = 0;
            frame.dec = Math.round((Math.atan2(tz, Math.sqrt(tx * tx + ty * ty)) / D2R) * 1e6) / 1e6;
          }
          perDet[k].push(frame);
        }
      }
    }
  }

  const byTime = (a, b) => a.mjd - b.mjd || a.det - b.det || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const counts = [];
  let frames = [];
  for (let k = 0; k < nd; k++) {
    const list = perDet[k].sort(byTime);
    const kept = thin(list, maxPerDet);
    counts.push({ det: detList[k], total: list.length, returned: kept.length });
    frames = frames.concat(kept);
  }
  frames.sort(byTime);
  const dirsIndexed = manifestDirs.length;
  return {
    frames,
    counts,
    dirsSearched: wanted.length - dirsFailed,
    dirsIndexed,
    dirsTotal,
    dirsFailed,
    complete: dirsTotal > 0 && dirsIndexed >= dirsTotal && dirsFailed === 0,
  };
}
