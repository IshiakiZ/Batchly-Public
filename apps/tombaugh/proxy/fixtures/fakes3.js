// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// An in-memory fake of the public SPHEREx S3 bucket, for tests. NOTHING HERE IS REAL DATA:
// every FITS header written by this module carries SYNTHETC = T.
//
//   createFakeS3({ base, pageSize })      -> bucket with a fetch-compatible `fetchImpl`
//       bucket.put(key, object)           object = Uint8Array | { size, read(start, endExcl) }
//       bucket.requests                   log of every request ({ kind, key|prefix, start, end,
//                                         bytes, status }); bucket.resetStats(), bucket.summary()
//       bucket.addFault({ match, status | error | hang, times })   failure injection
//       latencyMs > 0: requests are answered in rounds; bucket.rounds counts round trips
//     It answers ListObjectsV2 (XML, delimiter '/', pagination with continuation tokens) and
//     GET with a Range header (206 + Content-Range, 416, 404 NoSuchKey), like the real bucket.
//
//   makeFakeLevel2(options)               -> a complete, lazily generated full-size (2040 x
//       2040) Level-2 file in the measured layout: PRIMARY, IMAGE, FLAGS (tile-compressed,
//       RICE_1, one tile per row), VARIANCE, ZODI, EPSF, WCS-WAVE. Pixels come from
//       deterministic functions (`file.truth`), so nothing like 65 MB is ever allocated: only
//       the headers, the 16 kB descriptor table and the compressed FLAGS tiles are kept.
//
//   makeFakeSurvey(bucket, { dirs })      -> fills the bucket with directories of exposures
//       that follow great-circle scans; every file serves a realistic primary + IMAGE header
//       (bytes 0..28799). Returns the truth (true WCS of every detector of every exposure).
//
//   level2HeaderBytes(options)            -> the first 28800 bytes of such a file.

import { riceCompressInt32 } from '../src/rice.js';
import { attitudeFromWcs, detectorWcs, skyBasis, vectorToSky, FP_SCALE_DEG } from '../src/focalplane.js';
import { detectorWaveTable, syntheticSip } from './synth.js';

export const FAKE_BASE = 'https://nasa-irsa-spherex.s3.amazonaws.com';
const BLOCK = 2880;
const NPIX = 2040;
const D2R = Math.PI / 180;

// ---------------------------------------------------------------------------------------------
// Deterministic random numbers
// ---------------------------------------------------------------------------------------------

function mix32(h) {
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

function hash3(a, b, c) {
  let h = mix32((0x9e3779b9 ^ (a | 0)) + 0x9e3779b9);
  h = mix32((h ^ (b | 0)) + 0x9e3779b9);
  return mix32((h ^ (c | 0)) + 0x9e3779b9);
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------------------------
// The bucket
// ---------------------------------------------------------------------------------------------

function xmlEscape(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function headerValue(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(name);
  for (const [k, v] of Object.entries(headers)) if (k.toLowerCase() === name) return v;
  return null;
}

function abortError() {
  const err = new Error('This operation was aborted');
  err.name = 'AbortError';
  return err;
}

export function createFakeS3({ base = FAKE_BASE, pageSize = 1000, latencyMs = 0 } = {}) {
  const objects = new Map();
  let sorted = null;
  const requests = [];
  const faults = [];
  // With latencyMs > 0 every request waits for the end of the current "round": requests that
  // arrive while a round is open are answered together when it closes, so the number of rounds
  // is the number of sequential round trips a client needed.
  const state = { latencyMs, rounds: 0, open: null };
  const nextRound = () => {
    if (!state.open) {
      state.rounds += 1;
      state.open = new Promise((resolve) => {
        setTimeout(() => {
          state.open = null;
          resolve();
        }, state.latencyMs);
      });
    }
    return state.open;
  };

  const sortedKeys = () => {
    if (!sorted) sorted = [...objects.keys()].sort(); // code-unit order = byte order for ASCII keys
    return sorted;
  };

  function listResponse(params) {
    const prefix = params.get('prefix') || '';
    const delimiter = params.get('delimiter') || '';
    const maxKeys = Math.max(1, Math.min(pageSize, Number(params.get('max-keys')) || 1000));
    const token = params.get('continuation-token');
    // Entries in key order; a common prefix appears once, at the position of its first key.
    const entries = [];
    let lastPrefix = null;
    for (const key of sortedKeys()) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      const cut = delimiter ? rest.indexOf(delimiter) : -1;
      if (cut >= 0) {
        const common = prefix + rest.slice(0, cut + delimiter.length);
        if (common !== lastPrefix) entries.push({ prefix: common });
        lastPrefix = common;
      } else {
        entries.push({ key, size: objects.get(key).size });
      }
    }
    let from = 0;
    if (token !== null) {
      // Tokens are opaque and contain characters that must be URL-encoded by the client.
      const m = /^tok\+\/=(\d+)=$/.exec(token);
      if (!m) return new Response('<Error><Code>InvalidArgument</Code></Error>', { status: 400 });
      from = Number(m[1]);
    }
    const page = entries.slice(from, from + maxKeys);
    const truncated = from + maxKeys < entries.length;
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">';
    xml += `<Name>nasa-irsa-spherex</Name><Prefix>${xmlEscape(prefix)}</Prefix><KeyCount>${page.length}</KeyCount>`;
    xml += `<MaxKeys>${maxKeys}</MaxKeys><Delimiter>${xmlEscape(delimiter)}</Delimiter><IsTruncated>${truncated}</IsTruncated>`;
    if (truncated) xml += `<NextContinuationToken>tok+/=${from + maxKeys}=</NextContinuationToken>`;
    for (const e of page) {
      if (e.key !== undefined) {
        xml += `<Contents><Key>${xmlEscape(e.key)}</Key><LastModified>2026-10-01T00:00:00.000Z</LastModified>`;
        xml += `<ETag>&quot;0123456789abcdef&quot;</ETag><Size>${e.size}</Size><StorageClass>STANDARD</StorageClass></Contents>`;
      }
    }
    for (const e of page) {
      if (e.prefix !== undefined) xml += `<CommonPrefixes><Prefix>${xmlEscape(e.prefix)}</Prefix></CommonPrefixes>`;
    }
    xml += '</ListBucketResult>';
    requests.push({ kind: 'list', prefix, bytes: xml.length, status: 200 });
    return new Response(xml, { status: 200, headers: { 'content-type': 'application/xml' } });
  }

  function objectResponse(key, init) {
    const object = objects.get(key);
    if (!object) {
      requests.push({ kind: 'get', key, bytes: 0, status: 404 });
      return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<Error><Code>NoSuchKey</Code><Key>${xmlEscape(key)}</Key></Error>`, {
        status: 404,
        headers: { 'content-type': 'application/xml' },
      });
    }
    const range = headerValue(init && init.headers, 'range');
    if (!range) {
      if (object.size > 1 << 20) return new Response('refusing to send a whole large object in a test', { status: 400 });
      requests.push({ kind: 'get', key, start: 0, end: object.size - 1, bytes: object.size, status: 200 });
      return new Response(object.read(0, object.size), { status: 200 });
    }
    const m = /^bytes=(\d+)-(\d+)$/.exec(range);
    if (!m) return new Response('<Error><Code>InvalidRange</Code></Error>', { status: 400 });
    const start = Number(m[1]);
    const end = Math.min(Number(m[2]), object.size - 1);
    if (start >= object.size || end < start) {
      requests.push({ kind: 'range', key, start, end, bytes: 0, status: 416 });
      return new Response('<Error><Code>InvalidRange</Code></Error>', {
        status: 416,
        headers: { 'content-range': `bytes */${object.size}` },
      });
    }
    const body = object.read(start, end + 1);
    if (body.length !== end - start + 1) throw new Error(`fake S3 object ${key} returned ${body.length} bytes for ${start}-${end}`);
    requests.push({ kind: 'range', key, start, end, bytes: body.length, status: 206 });
    return new Response(body, {
      status: 206,
      headers: { 'content-range': `bytes ${start}-${end}/${object.size}`, 'content-length': String(body.length) },
    });
  }

  async function fetchImpl(url, init = {}) {
    const signal = init && init.signal;
    if (signal && signal.aborted) throw abortError();
    const u = new URL(String(url));
    if (u.origin !== new URL(base).origin) throw new TypeError(`fake S3: unexpected host ${u.origin}`);
    const key = decodeURIComponent(u.pathname.slice(1));
    const isList = key === '' && u.searchParams.get('list-type') === '2';
    const req = { url: String(url), key, isList, prefix: isList ? u.searchParams.get('prefix') || '' : null, range: headerValue(init.headers, 'range') };

    for (const fault of faults) {
      if (fault.times <= 0) continue;
      const hit = typeof fault.match === 'function' ? fault.match(req) : fault.match.test(isList ? `list:${req.prefix}` : key);
      if (!hit) continue;
      fault.times -= 1;
      fault.hits = (fault.hits || 0) + 1;
      requests.push({ kind: 'fault', key, prefix: req.prefix, bytes: 0, status: fault.status || 0 });
      if (fault.hang) {
        return new Promise((resolve, reject) => {
          if (signal) signal.addEventListener('abort', () => reject(abortError()), { once: true });
        });
      }
      if (fault.error) throw new TypeError('fetch failed');
      if (fault.body !== undefined) return new Response(fault.body, { status: fault.status || 200, headers: fault.headers || {} });
      return new Response('<?xml version="1.0" encoding="UTF-8"?>\n<Error><Code>SlowDown</Code><Message>Please reduce your request rate.</Message></Error>', {
        status: fault.status || 503,
      });
    }

    if (state.latencyMs > 0) await nextRound();
    else await Promise.resolve(); // always asynchronous, like a network
    if (signal && signal.aborted) throw abortError();
    if (isList) return listResponse(u.searchParams);
    return objectResponse(key, init);
  }

  return {
    base,
    fetchImpl,
    requests,
    faults,
    put(key, object) {
      if (object instanceof Uint8Array) {
        const bytes = object;
        objects.set(key, { size: bytes.length, read: (start, end) => bytes.slice(start, end) });
      } else {
        objects.set(key, object);
      }
      sorted = null;
    },
    delete(key) {
      sorted = null;
      return objects.delete(key);
    },
    has: (key) => objects.has(key),
    get: (key) => objects.get(key),
    keys: () => sortedKeys().slice(),
    addFault(fault) {
      const f = { times: 1, ...fault };
      faults.push(f);
      return f;
    },
    clearFaults() {
      faults.length = 0;
    },
    resetStats() {
      requests.length = 0;
      state.rounds = 0;
    },
    /** Number of sequential round trips since resetStats (only counted when latencyMs > 0). */
    get rounds() {
      return state.rounds;
    },
    setLatency(ms) {
      state.latencyMs = ms;
    },
    /** { lists, ranges, bytes, faults } over the request log (bytes = body bytes of 206 answers). */
    summary() {
      const out = { lists: 0, ranges: 0, bytes: 0, faults: 0, notFound: 0 };
      for (const r of requests) {
        if (r.kind === 'list') out.lists += 1;
        else if (r.kind === 'fault') out.faults += 1;
        else if (r.status === 404) out.notFound += 1;
        else if (r.kind === 'range' && r.status === 206) {
          out.ranges += 1;
          out.bytes += r.bytes;
        }
      }
      return out;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// FITS header writing
// ---------------------------------------------------------------------------------------------

/** Marks a number that must be written as a FITS real even when it is integer-valued. */
export const real = (value) => ({ real: value });

function formatReal(v) {
  if (!Number.isFinite(v)) throw new Error(`cannot write ${v} in a FITS header`);
  let s = String(v).replace('e', 'E').replace('E+', 'E');
  if (!s.includes('.') && !s.includes('E')) s += '.0';
  return s;
}

/** One 80-character card. `value === undefined` writes a commentary card (COMMENT, HISTORY). */
export function fitsCard(key, value, comment) {
  let s;
  if (value === undefined) {
    s = key.padEnd(8) + (comment || '');
  } else {
    let v;
    if (typeof value === 'string') v = `'${value.replace(/'/g, "''").padEnd(8)}'`.padEnd(20);
    else if (typeof value === 'boolean') v = (value ? 'T' : 'F').padStart(20);
    else if (value && typeof value === 'object') v = formatReal(value.real).padStart(20);
    else if (Number.isInteger(value)) v = String(value).padStart(20);
    else v = formatReal(value).padStart(20);
    s = `${key.padEnd(8)}= ${v}${comment ? ` / ${comment}` : ''}`;
  }
  if (s.length > 80) s = s.slice(0, 80);
  return s.padEnd(80);
}

/** Cards ([key, value, comment] triples) -> header bytes with END, padded to 2880 with spaces. */
export function fitsHeader(cards) {
  let text = '';
  for (const c of cards) text += fitsCard(c[0], c[1], c[2]);
  text += 'END'.padEnd(80);
  const padded = Math.ceil(text.length / BLOCK) * BLOCK;
  text = text.padEnd(padded);
  const out = new Uint8Array(padded);
  for (let i = 0; i < padded; i++) out[i] = text.charCodeAt(i);
  return out;
}

/** Grow a card list to exactly `total` cards (END included) by inserting filler at `at`. */
function padCards(cards, total, at, label) {
  const missing = total - 1 - cards.length;
  if (missing < 0) throw new Error(`fake header ${label}: ${cards.length + 1} cards do not fit in ${total}`);
  const filler = [];
  for (let i = 0; i < missing; i++) {
    filler.push(i % 3 === 0 ? ['HISTORY', undefined, ` synthetic ${label} filler card ${i}`] : [`FILL${String(i).padStart(4, '0')}`, i * 1.5, 'filler']);
  }
  return [...cards.slice(0, at), ...filler, ...cards.slice(at)];
}

const FLAG_NAMES = [
  [0, 'TRANSIENT'], [1, 'OVERFLOW'], [2, 'SUR_ERROR'], [6, 'NONFUNC'], [7, 'DICHROIC'], [9, 'MISSING_DATA'],
  [10, 'HOT'], [11, 'COLD'], [12, 'FULLSAMPLE'], [14, 'PHANMISS'], [15, 'NONLINEAR'], [17, 'PERSIST'],
  [19, 'OUTLIER'], [20, 'CROSSTALK'], [21, 'SOURCE'], [22, 'GHOST'], [23, 'GHOST_FPA'], [24, 'GHOST_EXT'],
  [25, 'STREAK'], [26, 'BLOOM'], [27, 'SNOWBALL'], [28, 'HALO'],
];

function sipCards(sip) {
  const cards = [];
  const block = (name, order, coeffs) => {
    cards.push([`${name}_ORDER`, order, 'SIP polynomial order']);
    for (const key of Object.keys(coeffs).sort()) cards.push([`${name}_${key}`, real(coeffs[key]), 'SIP coefficient']);
  };
  block('A', sip.aOrder, sip.a);
  block('B', sip.bOrder, sip.b);
  block('AP', sip.apOrder, sip.ap);
  block('BP', sip.bpOrder, sip.bp);
  return cards;
}

function celestialCards({ crval, pc, sip }) {
  const cards = [
    ['WCSAXES', 2, 'Number of coordinate axes'],
    ['CRPIX1', real(1020.5), 'Pixel coordinate of reference point'],
    ['CRPIX2', real(1020.5), 'Pixel coordinate of reference point'],
    ['PC1_1', real(pc[0]), 'Coordinate transformation matrix element'],
    ['PC1_2', real(pc[1]), 'Coordinate transformation matrix element'],
    ['PC2_1', real(pc[2]), 'Coordinate transformation matrix element'],
    ['PC2_2', real(pc[3]), 'Coordinate transformation matrix element'],
    ['CDELT1', real(1), '[deg] Coordinate increment at reference point'],
    ['CDELT2', real(1), '[deg] Coordinate increment at reference point'],
    ['CUNIT1', 'deg', 'Units of coordinate increment and value'],
    ['CUNIT2', 'deg', 'Units of coordinate increment and value'],
    ['CTYPE1', sip ? 'RA---TAN-SIP' : 'RA---TAN', 'TAN (gnomonic) projection + SIP distortions'],
    ['CTYPE2', sip ? 'DEC--TAN-SIP' : 'DEC--TAN', 'TAN (gnomonic) projection + SIP distortions'],
    ['CRVAL1', real(crval[0]), '[deg] Coordinate value at reference point'],
    ['CRVAL2', real(crval[1]), '[deg] Coordinate value at reference point'],
    ['LONPOLE', real(180), '[deg] Native longitude of celestial pole'],
    ['LATPOLE', real(crval[1]), '[deg] Native latitude of celestial pole'],
    ['RADESYS', 'ICRS', 'Equatorial coordinate system'],
  ];
  return cards;
}

function primaryCards(version = '7.0.5') {
  return [
    ['SIMPLE', true, 'conforms to FITS standard'],
    ['BITPIX', 8, 'array data type'],
    ['NAXIS', 0, 'number of array dimensions'],
    ['EXTEND', true],
    ['VERSION', version, 'pipeline version'],
    ['SYNTHETC', true, 'synthetic test data, NOT a real observation'],
  ];
}

/**
 * Cards of the IMAGE header of a full Level-2 file. Card positions imitate the real file:
 * DETECTOR is the 11th card, CRPIX1 the 92nd, and the header has `total` cards (292 in the
 * measured file, 25920 bytes) including END.
 */
function imageCards({ det, obsid, crval, pc, mjd, sip, total = 292, checksum = false }) {
  const head = [
    ['XTENSION', 'IMAGE', 'Image extension'],
    ['BITPIX', -32, 'array data type'],
    ['NAXIS', 2, 'number of array dimensions'],
    ['NAXIS1', NPIX],
    ['NAXIS2', NPIX],
    ['PCOUNT', 0, 'number of parameters'],
    ['GCOUNT', 1, 'number of groups'],
    ['EXTNAME', 'IMAGE', 'extension name'],
    ['BUNIT', 'MJy / sr'],
    ['SYNTHETC', true, 'synthetic test data, NOT a real observation'],
    ['DETECTOR', det, 'detector number'],
    ['OBSID', obsid, 'observation id'],
    ['EXPIDN', 202625201027912, 'exposure id'],
  ];
  const wcs = celestialCards({ crval, pc, sip });
  const exposure = 113.5826 / 86400;
  const tail = [
    ['PSF_FWHM', real(7.46070125580342), '[arcsec]'],
    ...(sip ? sipCards(sip) : []),
    ['DATE-OBS', '2026-06-19T19:01:07.407', 'ISO-8601 time of observation'],
    ['MJD-OBS', real(mjd - exposure / 2), '[d] MJD of observation start'],
    ['MJD-AVG', real(mjd), '[d] MJD at the mid-point of the exposure'],
    ['MJD-END', real(mjd + exposure / 2), '[d] MJD of observation end'],
    ['XPOSURE', real(113.5826), '[s] exposure time'],
    ['TIMESYS', 'UTC', 'time scale'],
    ['WCSNAMEW', 'Approximated per-pixel wavelength and bandwidth'],
    ['CTYPE1W', 'WAVE-TAB'], ['CTYPE2W', 'WAVE-TAB'], ['CUNIT1W', 'um'], ['CUNIT2W', 'um'],
    ['CRPIX1W', real(1), 'reference pixel'], ['CRPIX2W', real(1), 'reference pixel'],
    ['CDELT1W', 1], ['CDELT2W', 1], ['CRVAL1W', 1], ['CRVAL2W', 1], ['PV1_3W', 1], ['PV2_3W', 2],
    ['PS1_0W', 'WCS-WAVE'], ['PS2_0W', 'WCS-WAVE'], ['PS1_1W', 'VALUES'], ['PS2_1W', 'VALUES'],
    ['PS1_2W', 'X'], ['PS2_2W', 'Y'],
    ['CTYPE1A', 'LINEAR'], ['CTYPE2A', 'LINEAR'],
    ['CRPIX1A', real(1), 'reference pixel'], ['CRPIX2A', real(1), 'reference pixel'],
    ['CRVAL1A', real(0)], ['CRVAL2A', real(0)],
    ...(checksum ? [['CHECKSUM', 'ZZZZZZZZZZZZZZZZ', 'HDU checksum'], ['DATASUM', '1234567890', 'data unit checksum']] : []),
  ];
  // Filler: bring CRPIX1 to card index 91 (as in the real file), the rest before the time cards.
  let cards = [...head];
  const beforeWcs = Math.max(0, 91 - 1 - cards.length); // WCSAXES sits just before CRPIX1
  for (let i = 0; i < beforeWcs && cards.length + wcs.length + tail.length + 1 < total; i++) {
    cards.push([`L2 ${String(i).padStart(4, '0')}`.replace(' ', '_'), i, 'synthetic level-2 keyword']);
  }
  cards = [...cards, ...wcs];
  const at = cards.length + 1; // after PSF_FWHM
  return padCards([...cards, ...tail], total, at, 'IMAGE');
}

/** The first 28800 bytes (primary + IMAGE header) of a fake Level-2 file. */
export function level2HeaderBytes({ det = 1, obsid = '2026W25_2A_0001_1', crval, pc, mjd = 61210.5, sip = syntheticSip(), total = 292 }) {
  const primary = fitsHeader(primaryCards());
  const image = fitsHeader(imageCards({ det, obsid, crval, pc, mjd, sip, total }));
  const out = new Uint8Array(primary.length + image.length);
  out.set(primary, 0);
  out.set(image, primary.length);
  return out;
}

// ---------------------------------------------------------------------------------------------
// A complete, lazily generated Level-2 file
// ---------------------------------------------------------------------------------------------

const f32 = new Float32Array(1);
const scratch = new DataView(new ArrayBuffer(4));

/** Deterministic pixel functions of a fake file (x, y are 1-based detector pixels). */
function makeTruth(seed) {
  const image = (x, y) => {
    const h = hash3(seed, x, y);
    if (h % 997 === 0) return NaN; // real images contain NaN pixels
    f32[0] = 0.5 + 0.0003 * x + 0.0002 * y + (h & 0xffff) / 65536;
    return f32[0];
  };
  const variance = (x, y) => {
    f32[0] = 0.001 + 1e-7 * x + 2e-7 * y + (hash3(seed + 1, x, y) & 0xfff) * 1e-8;
    return f32[0];
  };
  const zodi = (x, y) => {
    f32[0] = 0.13 + 2e-6 * x + 1e-5 * y;
    return f32[0];
  };
  const flags = (x, y) => {
    if (y % 97 === 0) return 0; // some rows are entirely clean
    let v = 0;
    if (hash3(seed + 2, x >> 3, y >> 2) % 9 === 0) v |= 1 << 21; // SOURCE, in patches
    const h = hash3(seed + 3, x, y);
    if (h % 211 === 0) v |= (1 << 28) | (1 << 21); // HALO + SOURCE
    if (h % 1999 === 0) v |= 1 << (h >>> 27); // any bit 0..31, including the sign bit
    if (x % 512 === 7) v |= 1 << 6; // a NONFUNC column
    return v;
  };
  const flagsRow = (y) => {
    const row = new Int32Array(NPIX);
    for (let x = 1; x <= NPIX; x++) row[x - 1] = flags(x, y);
    return row;
  };
  const window = (fn, Ctor) => (x0, y0, nx, ny) => {
    const out = new Ctor(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) out[j * nx + i] = fn(x0 + i, y0 + j);
    return out;
  };
  return {
    image, variance, zodi, flags, flagsRow,
    imageWindow: window(image, Float32Array),
    varianceWindow: window(variance, Float32Array),
    zodiWindow: window(zodi, Float32Array),
    flagsWindow: window(flags, Int32Array),
  };
}

/** Segment that serves big-endian float32 (or int32) pixels computed on demand. */
function pixelSegment(fn, length, integer = false) {
  return {
    length,
    fill(dst, dstOff, segOff, len) {
      const firstPixel = Math.floor(segOff / 4);
      const lastPixel = Math.floor((segOff + len - 1) / 4);
      for (let p = firstPixel; p <= lastPixel; p++) {
        if (p >= NPIX * NPIX) break; // zero padding after the last pixel
        const value = fn((p % NPIX) + 1, Math.floor(p / NPIX) + 1);
        if (integer) scratch.setInt32(0, value, false);
        else scratch.setFloat32(0, value, false);
        for (let k = 0; k < 4; k++) {
          const at = p * 4 + k - segOff;
          if (at >= 0 && at < len) dst[dstOff + at] = scratch.getUint8(k);
        }
      }
    },
  };
}

function bytesSegment(bytes, length = bytes.length) {
  return {
    length,
    fill(dst, dstOff, segOff, len) {
      const end = Math.min(bytes.length, segOff + len);
      if (end > segOff) dst.set(bytes.subarray(segOff, end), dstOff);
    },
  };
}

const zeroSegment = (length) => ({ length, fill() {} });
const pad2880 = (n) => Math.ceil(n / BLOCK) * BLOCK;

/**
 * A complete fake Level-2 file.
 *
 * options: det, obsid, version, crval [ra, dec], pc [pc11, pc12, pc21, pc22], mjd, seed, sip
 *   (default: the real detector-2 coefficients with a fitted inverse; null for plain TAN),
 *   imageCards / flagsCards / varianceCards / zodiCards: header card counts including END
 *   (defaults 292 / 204 / 120 / 123 as measured), heapOrder 'sequential' | 'reversed',
 *   heapGap (junk bytes between tiles), theapGap (unused bytes between the descriptor table
 *   and the heap, announced by a THEAP card), checksum (add CHECKSUM/DATASUM cards).
 *
 * @returns {{ size: number, read(start, endExclusive): Uint8Array, truth, layout, tiles }}
 */
export function makeFakeLevel2(options = {}) {
  const {
    det = 2,
    obsid = '2026W25_2A_0279_1',
    crval = [208.4483499, 54.5491081503],
    pc = [0.00123274981054, -0.00118000897293, -0.00117635107879, -0.00123440903284],
    mjd = 61210.79311303,
    seed = 1,
    sip = syntheticSip(),
    imageCards: nImage = 292,
    flagsCards: nFlags = 204,
    varianceCards: nVariance = 120,
    zodiCards: nZodi = 123,
    heapOrder = 'sequential',
    heapGap = 0,
    theapGap = 0,
    checksum = false,
    flagsPlain = false,
    primaryVersion = '7.0.5',
  } = options;
  const truth = makeTruth(seed);
  const dataBytes = NPIX * NPIX * 4; // 16,646,400 = 5780 blocks exactly

  // FLAGS: compress every row, lay the tiles out in the heap, write the descriptor table.
  const tiles = new Array(NPIX);
  let maxLen = 0;
  for (let y = 1; y <= NPIX; y++) {
    tiles[y - 1] = riceCompressInt32(truth.flagsRow(y), 32);
    if (tiles[y - 1].length > maxLen) maxLen = tiles[y - 1].length;
  }
  const order = [...Array(NPIX).keys()];
  if (heapOrder === 'reversed') order.reverse();
  if (heapOrder === 'shuffled') order.sort((a, b) => hash3(seed, a, 77) - hash3(seed, b, 77));
  const heapOffsets = new Int32Array(NPIX);
  let heapSize = 0;
  for (const row of order) {
    heapOffsets[row] = heapSize;
    heapSize += tiles[row].length + heapGap;
  }
  const table = new Uint8Array(NPIX * 8); // row r: int32 BE nbytes, int32 BE heap offset
  const tv = new DataView(table.buffer);
  for (let r = 0; r < NPIX; r++) {
    tv.setInt32(r * 8, tiles[r].length, false);
    tv.setInt32(r * 8 + 4, heapOffsets[r], false);
  }
  const pcount = theapGap + heapSize;
  const heapSegment = {
    length: heapSize,
    fill(dst, dstOff, segOff, len) {
      for (let r = 0; r < NPIX; r++) {
        const a = heapOffsets[r];
        const b = a + tiles[r].length;
        const from = Math.max(a, segOff);
        const to = Math.min(b, segOff + len);
        if (to > from) dst.set(tiles[r].subarray(from - a, to - a), dstOff + from - segOff);
      }
      if (heapGap > 0) {
        // junk between tiles, so that reading a neighbour's bytes cannot go unnoticed
        for (let r = 0; r < NPIX; r++) {
          const a = heapOffsets[r] + tiles[r].length;
          for (let o = Math.max(a, segOff); o < Math.min(a + heapGap, segOff + len); o++) dst[dstOff + o - segOff] = 0xa5;
        }
      }
    },
  };

  const wcsInfo = { crval, pc, sip };
  const imageHeader = fitsHeader(imageCards({ det, obsid, crval, pc, mjd, sip, total: nImage, checksum }));
  const flagsHeader = fitsHeader(
    padCards(
      [
        ['XTENSION', 'BINTABLE', 'binary table extension'],
        ['BITPIX', 8, 'array data type'],
        ['NAXIS', 2, 'number of array dimensions'],
        ['NAXIS1', 8, 'width of table in bytes'],
        ['NAXIS2', NPIX, 'number of rows in table'],
        ['PCOUNT', pcount, 'size of special data area'],
        ['GCOUNT', 1, 'one data group'],
        ['TFIELDS', 1, 'number of fields in each row'],
        ['TTYPE1', 'COMPRESSED_DATA', 'label for field 1'],
        ['TFORM1', `1PB(${maxLen})`, 'data format of field: variable length array'],
        ...(theapGap > 0 ? [['THEAP', NPIX * 8 + theapGap, 'byte offset of the heap']] : []),
        ['ZIMAGE', true, 'extension contains compressed image'],
        ['ZTENSION', 'IMAGE', 'Image extension'],
        ['ZBITPIX', 32, 'data type of original image'],
        ['ZNAXIS', 2, 'dimension of original image'],
        ['ZNAXIS1', NPIX, 'length of original image axis'],
        ['ZNAXIS2', NPIX, 'length of original image axis'],
        ['ZPCOUNT', 0],
        ['ZGCOUNT', 1],
        ['ZTILE1', NPIX, 'size of tiles to be compressed'],
        ['ZTILE2', 1, 'size of tiles to be compressed'],
        ['ZCMPTYPE', 'RICE_1', 'compression algorithm'],
        ['ZNAME1', 'BLOCKSIZE', 'compression block size'],
        ['ZVAL1', 32, 'pixels per block'],
        ['ZNAME2', 'BYTEPIX', 'bytes per pixel (1, 2, 4, or 8)'],
        ['ZVAL2', 4, 'bytes per pixel (1, 2, 4, or 8)'],
        ['EXTNAME', 'FLAGS', 'extension name'],
        ['SYNTHETC', true, 'synthetic test data, NOT a real observation'],
        ...FLAG_NAMES.map(([bit, name]) => [`MSKN${String(bit).padStart(4, '0')}`, name, `flag bit ${bit}`]),
        ...celestialCards({ crval, pc, sip: null }),
        ...(checksum ? [['ZHECKSUM', 'YYYYYYYYYYYYYYYY'], ['CHECKSUM', 'XXXXXXXXXXXXXXXX']] : []),
      ],
      nFlags,
      60,
      'FLAGS',
    ),
  );
  const planeHeader = (name, bunit, total, bitpix = -32) =>
    fitsHeader(
      padCards(
        [
          ['XTENSION', 'IMAGE', 'Image extension'],
          ['BITPIX', bitpix, 'array data type'],
          ['NAXIS', 2, 'number of array dimensions'],
          ['NAXIS1', NPIX],
          ['NAXIS2', NPIX],
          ['PCOUNT', 0, 'number of parameters'],
          ['GCOUNT', 1, 'number of groups'],
          ['EXTNAME', name, 'extension name'],
          ['BUNIT', bunit],
          ['SYNTHETC', true, 'synthetic test data, NOT a real observation'],
          ...celestialCards(wcsInfo),
          ...(sip ? sipCards(sip) : []),
          ['CRPIX1A', real(1)], ['CRPIX2A', real(1)],
        ],
        total,
        10,
        name,
      ),
    );
  const varianceHeader = planeHeader('VARIANCE', 'MJy2 / sr2', nVariance);
  const zodiHeader = planeHeader('ZODI', 'MJy / sr', nZodi);
  const epsfHeader = fitsHeader(
    padCards(
      [
        ['XTENSION', 'BINTABLE'], ['BITPIX', 8], ['NAXIS', 2], ['NAXIS1', 8752], ['NAXIS2', 441],
        ['PCOUNT', 0], ['GCOUNT', 1], ['TFIELDS', 1], ['TTYPE1', 'PSF'], ['TFORM1', '2188E'], ['EXTNAME', 'EPSF'],
      ],
      60,
      11,
      'EPSF',
    ),
  );
  const table11 = detectorWaveTable(det);
  const waveHeader = fitsHeader([
    ['XTENSION', 'BINTABLE', 'binary table extension'], ['BITPIX', 8], ['NAXIS', 2], ['NAXIS1', 1056], ['NAXIS2', 1],
    ['PCOUNT', 0], ['GCOUNT', 1], ['TFIELDS', 3],
    ['TTYPE1', 'X'], ['TFORM1', '11J'], ['TTYPE2', 'Y'], ['TFORM2', '11J'],
    ['TTYPE3', 'VALUES'], ['TFORM3', '242E'], ['TDIM3', '(2,11,11)'], ['EXTNAME', 'WCS-WAVE'],
  ]);
  const waveData = new Uint8Array(BLOCK);
  const wv = new DataView(waveData.buffer);
  for (let i = 0; i < 11; i++) {
    wv.setInt32(4 * i, table11.x[i], false);
    wv.setInt32(44 + 4 * i, table11.y[i], false);
  }
  for (let i = 0; i < 242; i++) wv.setFloat32(88 + 4 * i, table11.values[i], false);

  // Assemble the segments and remember where everything is.
  const segments = [];
  const layout = {};
  let offset = 0;
  const add = (seg) => {
    segments.push({ start: offset, ...seg });
    offset += seg.length;
  };
  const primary = fitsHeader(primaryCards(primaryVersion));
  add(bytesSegment(primary));
  layout.image = { headerOffset: offset, headerBytes: imageHeader.length, dataOffset: offset + imageHeader.length };
  add(bytesSegment(imageHeader));
  add(pixelSegment(truth.image, pad2880(dataBytes)));
  layout.flags = {
    headerOffset: offset,
    headerBytes: flagsHeader.length,
    tableOffset: offset + flagsHeader.length,
    heapOffset: offset + flagsHeader.length + table.length + theapGap,
    pcount,
  };
  if (flagsPlain) {
    const plain = planeHeader('FLAGS', 'bitmask', nFlags, 32);
    layout.flags = { headerOffset: offset, headerBytes: plain.length, dataOffset: offset + plain.length, plain: true };
    add(bytesSegment(plain));
    add(pixelSegment(truth.flags, pad2880(dataBytes), true));
  } else {
    add(bytesSegment(flagsHeader));
    add(bytesSegment(table));
    if (theapGap > 0) add(zeroSegment(theapGap));
    add(heapSegment);
    add(zeroSegment(pad2880(table.length + pcount) - table.length - pcount));
  }
  layout.variance = { headerOffset: offset, headerBytes: varianceHeader.length, dataOffset: offset + varianceHeader.length };
  add(bytesSegment(varianceHeader));
  add(pixelSegment(truth.variance, pad2880(dataBytes)));
  layout.zodi = { headerOffset: offset, headerBytes: zodiHeader.length, dataOffset: offset + zodiHeader.length };
  add(bytesSegment(zodiHeader));
  add(pixelSegment(truth.zodi, pad2880(dataBytes)));
  layout.epsf = { headerOffset: offset };
  add(bytesSegment(epsfHeader));
  add(zeroSegment(pad2880(8752 * 441)));
  layout.wave = { headerOffset: offset };
  add(bytesSegment(waveHeader));
  add(bytesSegment(waveData));
  const size = offset;

  function read(start, end) {
    const from = Math.max(0, start);
    const to = Math.min(size, end);
    const out = new Uint8Array(Math.max(0, to - from));
    for (const seg of segments) {
      const a = Math.max(seg.start, from);
      const b = Math.min(seg.start + seg.length, to);
      if (b > a) seg.fill(out, a - from, a - seg.start, b - a);
    }
    return out;
  }

  return { size, read, truth, layout, tiles, det, obsid, waveTable: table11, wcs: { crpix: [1020.5, 1020.5], crval, pc, sip } };
}

// ---------------------------------------------------------------------------------------------
// A fake survey: directories of exposures along great-circle scans
// ---------------------------------------------------------------------------------------------

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function unit(v) {
  const n = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / n, v[1] / n, v[2] / n];
}

/** Rotate vector v about unit axis k by `angle` radians (Rodrigues). */
function rotateAbout(v, k, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const kv = cross(k, v);
  const kd = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
  return [0, 1, 2].map((i) => v[i] * c + kv[i] * s + k[i] * kd * (1 - c));
}

/**
 * Fill `bucket` with a fake survey.
 *
 * dirs: [{ release, dir, version, n, seed, poleRa, poleDec, mjd0, step = 3.3 (deg along the
 *          scan per exposure), cross = 4 (deg of cross-scan scatter), hand = -1 (sign of the PC
 *          determinant), missing = 0.03 (fraction of sequence numbers without any file),
 *          missingDet = 0.01 (chance that one detector of an exposure has no file),
 *          centre: [ra, dec] (optional: start the scan there) }]
 *
 * Every exposure gets a random attitude on the great circle perpendicular to the pole, a D1
 * header, and D2..D6 headers derived with the same rigid-body matrices as the index plus a
 * perturbation of a few arcsec in pointing, a few arcmin in roll and 1e-3 in scale.
 *
 * @returns {{ dirs: [{ release, dir, version, prefix, exposures: [{ suffix, obsid, mjd,
 *             dets: number (bit mask of existing files), wcs: { 1..6: { crval, pc, crpix } } }] }] }}
 */
export function makeFakeSurvey(bucket, { dirs }) {
  const truth = { dirs: [] };
  const sip = syntheticSip();
  for (const spec of dirs) {
    const {
      release, dir, version, n, seed = 1, poleRa = 0, poleDec = 0, mjd0 = 61000, step = 3.3, cross: crossScan = 4,
      hand = -1, missing = 0.03, missingDet = 0.01, centre = null,
    } = spec;
    const rand = mulberry32(seed);
    const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
    const pole = skyBasis(poleRa, poleDec).b;
    let a1 = unit(cross(pole, Math.abs(pole[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]));
    if (centre) {
      const c = skyBasis(centre[0], centre[1]).b;
      const along = c[0] * pole[0] + c[1] * pole[1] + c[2] * pole[2];
      a1 = unit([c[0] - along * pole[0], c[1] - along * pole[1], c[2] - along * pole[2]]);
    }
    const a2 = cross(pole, a1);
    const prefix = `${release}/level2/${dir}/${version}/`;
    const exposures = [];
    let seq = 0;
    let sub = 4;
    for (let j = 0; exposures.length < n; j++) {
      // Sequence numbers NNNN with sub-exposures M = 1..4; some numbers do not exist at all.
      sub += 1;
      if (sub > 4 || rand() < 0.2) {
        sub = 1;
        seq += rand() < missing ? 2 : 1;
      }
      const suffix = `${String(seq).padStart(4, '0')}_${sub}`;
      const theta = (j * step + (rand() - 0.5) * 1.5) * D2R;
      const delta = (rand() - 0.5) * 2 * crossScan * D2R;
      const onCircle = [0, 1, 2].map((i) => Math.cos(theta) * a1[i] + Math.sin(theta) * a2[i]);
      const b = unit([0, 1, 2].map((i) => Math.cos(delta) * onCircle[i] + Math.sin(delta) * pole[i]));
      // Detector x axis: across the scan, with a random roll of up to +-25 degrees.
      const acrossRaw = [0, 1, 2].map((i) => pole[i] - (pole[0] * b[0] + pole[1] * b[1] + pole[2] * b[2]) * b[i]);
      const ux = unit(rotateAbout(unit(acrossRaw), b, (rand() - 0.5) * 50 * D2R));
      const bxu = cross(b, ux);
      const uy = hand < 0 ? bxu.map((v) => -v) : bxu; // ux x uy = -b for the usual sky parity
      const mjd = mjd0 + (j * 165) / 86400;
      // Detector 1: exactly the model (its header is what the index stores).
      const triad = [ux, uy, b];
      const wcs = {};
      wcs[1] = detectorWcs(triad, 1);
      const triad1 = attitudeFromWcs(wcs[1]);
      for (let det = 2; det <= 6; det++) {
        const model = detectorWcs(triad1, det);
        // Perturb: a few arcsec of pointing, a few arcmin of roll, 1e-3 of scale.
        const [mx, my, mb] = attitudeFromWcs(model);
        const sx = ((gauss() * 4) / 3600) * D2R;
        const sy = ((gauss() * 4) / 3600) * D2R;
        const b2 = unit([0, 1, 2].map((i) => mb[i] + sx * mx[i] + sy * my[i]));
        const roll = gauss() * (5 / 60) * D2R;
        const cr = Math.cos(roll);
        const sr = Math.sin(roll);
        const scale = 1 + gauss() * 1e-3;
        // Rotate the model's PC columns (east/north components) by the roll and rescale.
        const [p11, p12, p21, p22] = model.pc;
        wcs[det] = {
          crval: vectorToSky(b2),
          pc: [scale * (cr * p11 - sr * p21), scale * (cr * p12 - sr * p22), scale * (sr * p11 + cr * p21), scale * (sr * p12 + cr * p22)],
          crpix: [1020.5, 1020.5],
        };
      }
      let dets = 0;
      for (let det = 1; det <= 6; det++) if (!(rand() < missingDet)) dets |= 1 << (det - 1);
      const obsid = `${dir}_${suffix}`;
      for (let det = 1; det <= 6; det++) {
        if (!((dets >> (det - 1)) & 1)) continue;
        const key = `${prefix}${det}/level2_${obsid}D${det}_spx_${version}.fits`;
        const w = wcs[det];
        let cached = null;
        bucket.put(key, {
          size: 64546560,
          read(start, end) {
            if (!cached) cached = level2HeaderBytes({ det, obsid, crval: w.crval, pc: w.pc, mjd, sip });
            const out = new Uint8Array(Math.max(0, end - start));
            if (start < cached.length) out.set(cached.subarray(start, Math.min(end, cached.length)));
            cached = null; // do not keep 28 kB per file alive
            return out;
          },
        });
      }
      exposures.push({ suffix, obsid, mjd, dets, wcs });
    }
    truth.dirs.push({ release, dir, version, prefix, exposures });
  }
  return truth;
}

export { FP_SCALE_DEG };
