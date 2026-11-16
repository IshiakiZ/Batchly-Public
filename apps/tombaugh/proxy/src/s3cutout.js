// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// Cutouts straight from the full 65 MB Level-2 files in the public S3 bucket, with HTTP Range
// requests: the pixel path that does not depend on IRSA's cutout service.
//
// What the integrator calls:
//
//   fetchCutoutFromS3(id, ra, dec, sizeDeg, { fetchImpl, layoutMemo, stats, ...s3 options })
//     -> Promise<Uint8Array>: a small uncompressed multi-extension FITS with the HDUs PRIMARY,
//        IMAGE, FLAGS, VARIANCE, ZODI: what IRSA's cutout service returns up to the ZODI
//        extension, so buildFrame({ id, u8, waveTable }) from encode.js takes it unchanged.
//     layoutMemo: an optional Map the caller keeps between calls. It remembers the header sizes
//        of each processing version and detector so that later files need only two round trips.
//     stats: an optional object that is filled with { requests, bytes, path, fallbacks, total,
//        window: { x0, y0, nx, ny }, target: [x, y] }.
//     Errors are CutoutError with a `code`:
//        'OUTSIDE'    the position is not on this detector (no retry will help)
//        'NOT_FOUND'  the file does not exist in the bucket (HTTP 404)
//        'BAD_ID'     the id does not have the shape of a SPHEREx Level-2 file (or ra/dec are
//                     not numbers): a caller error, nothing was requested
//        'UPSTREAM'   everything else (S3 errors after retries, timeouts, unexpected file
//                     structure); `retryable` says whether trying again later may help
//
//   fetchWaveTableFromS3(id, { fetchImpl, total }) -> the WCS-WAVE table of that file in the
//     shape readWaveTable returns ({ x, y, values, nx, ny, nk }). The table is identical for
//     every file of a detector: fetch once per detector and keep it. Pass `total` (the file
//     size) when known to save the size probe.
//
//   s3FileInfo(id, opts) -> { id, key, url, size, release, dir, version, det, obsid, suffix,
//     mjd, exptime, dateObs, softwareVersion, naxis: [nx, ny], crval: [ra, dec] } from one
//     Range request for the first 28800 bytes.
//
// Also exported for tests and reuse: wcsFromHeader, skyToPixel, pixelToSky (full TAN-SIP,
// 1-based FITS pixels), cutoutWindow.
//
// File layout (CONTRACT-S3.md; offsets of the measured file, everything is verified by
// parsing, nothing is assumed beyond a first guess):
//   PRIMARY   0            header 2880, no data
//   IMAGE     2880         header 25920; float32 big-endian 2040 x 2040 from byte 28800
//   FLAGS     16,675,200   header 17280; BINTABLE with 2040 rows of (int32 nbytes, int32 heap
//                          offset), then the heap of RICE_1 tiles, one tile per image row
//   VARIANCE  after FLAGS  header 11520; float32 2040 x 2040      (offset depends on PCOUNT)
//   ZODI      after that   header 11520; float32 2040 x 2040
//   EPSF, WCS-WAVE         not read here (WCS-WAVE: last 5760 bytes, see fetchWaveTableFromS3)
//
// Round trips for one cutout (8 Range requests):
//   careful path (first file of a version/detector): 4 rounds
//     1. bytes 0..28799 (primary + IMAGE header)  |  FLAGS header + descriptor table (guess)
//     2. IMAGE rows  |  FLAGS heap tiles  |  VARIANCE header
//     3. VARIANCE rows  |  ZODI header
//     4. ZODI rows
//   speculative path (header sizes known from layoutMemo): 2 rounds
//     1. as above
//     2. IMAGE rows | FLAGS heap | VARIANCE header | VARIANCE rows | ZODI header | ZODI rows
//   Every speculative read is checked against the parsed headers (offset, header length,
//   XTENSION = 'IMAGE', EXTNAME, NAXIS, BITPIX) and repeated at the right place when wrong.
//
// Pixel rows: an image row is NAXIS1 * 4 bytes (8160). One contiguous range is read from the
// first needed pixel of the first row to the last needed pixel of the last row.

import { parseHeaderBlock, readWaveTable, tableColumns } from './fits.js';
import { rangeGet, idToKey, parseKey, mapLimit, S3_BASE } from './s3.js';
import { riceDecompressInt32 } from './rice.js';

const BLOCK = 2880;
const CARD = 80;
const D2R = Math.PI / 180;
const HEAD_BYTES = 28800; // primary + IMAGE header of the measured files
const PIXEL_ARCSEC = 6.15; // cutout size in pixels = size / 6.15 arcsec, as IRSA does
const DEFAULT_LAYOUT = { headBytes: HEAD_BYTES, flagsOffset: 16675200, flagsHeaderBytes: 17280, flagsTableBytes: 16320 };
const PLANE_HEADER_GUESS = 11520;
const WAVE_TAIL_BYTES = 5760; // WCS-WAVE: 2880 header + 2880 data at the very end of the file

const pad2880 = (n) => Math.ceil(n / BLOCK) * BLOCK;

export class CutoutError extends Error {
  constructor(message, { code = 'UPSTREAM', status = 0, retryable = false } = {}) {
    super(message);
    this.name = 'CutoutError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

const formatError = (message) => new CutoutError(message, { code: 'UPSTREAM', retryable: false });

/** Map any error to a CutoutError with one of the documented codes. */
function asCutoutError(err, what) {
  if (err instanceof CutoutError) return err;
  const code = err && (err.code === 'NOT_FOUND' || err.code === 'BAD_ID' || err.code === 'OUTSIDE') ? err.code : 'UPSTREAM';
  const out = new CutoutError(`${what}: ${(err && err.message) || err}`, {
    code,
    status: (err && err.status) || 0,
    retryable: code === 'UPSTREAM' && Boolean(err && err.retryable),
  });
  out.cause = err;
  return out;
}

/** Keep a background promise from becoming an unhandled rejection; it is still awaited later. */
function background(promise) {
  promise.catch(() => {});
  return promise;
}

const settle = (promise) => promise.then((value) => ({ ok: true, value }), (error) => ({ ok: false, error }));

function concat(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

// ---------------------------------------------------------------------------------------------
// TAN-SIP (1-based FITS pixels)
// ---------------------------------------------------------------------------------------------

function sipTerms(cards, prefix) {
  const terms = [];
  const re = new RegExp(`^${prefix}_(\\d+)_(\\d+)$`);
  for (const [key, value] of cards) {
    const m = re.exec(key);
    if (m && typeof value === 'number' && Number.isFinite(value) && value !== 0) terms.push([Number(m[1]), Number(m[2]), value]);
  }
  return terms;
}

/** [f, df/du, df/dv] of sum c u^p v^q. */
function polyEval(terms, u, v) {
  let f = 0;
  let fu = 0;
  let fv = 0;
  for (let i = 0; i < terms.length; i++) {
    const p = terms[i][0];
    const q = terms[i][1];
    const c = terms[i][2];
    const up = Math.pow(u, p);
    const vq = Math.pow(v, q);
    f += c * up * vq;
    if (p > 0) fu += c * p * Math.pow(u, p - 1) * vq;
    if (q > 0) fv += c * q * up * Math.pow(v, q - 1);
  }
  return [f, fu, fv];
}

/**
 * Celestial WCS of an image header (the Map from parseHeaderBlock):
 * { crpix, crval, cd: [cd11, cd12, cd21, cd22] (degrees per pixel, CDELT folded in),
 *   a, b, ap, bp: SIP terms [[p, q, coefficient], ...] (empty without -SIP) }.
 */
export function wcsFromHeader(cards) {
  const num = (key, fallback) => {
    const v = cards.get(key);
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  };
  let cd;
  if (cards.has('PC1_1') || cards.has('PC1_2') || cards.has('PC2_1') || cards.has('PC2_2') || !cards.has('CD1_1')) {
    const c1 = num('CDELT1', 1);
    const c2 = num('CDELT2', 1);
    cd = [c1 * num('PC1_1', 1), c1 * num('PC1_2', 0), c2 * num('PC2_1', 0), c2 * num('PC2_2', 1)];
  } else {
    cd = [num('CD1_1', 0), num('CD1_2', 0), num('CD2_1', 0), num('CD2_2', 0)];
  }
  const crpix = [num('CRPIX1', NaN), num('CRPIX2', NaN)];
  const crval = [num('CRVAL1', NaN), num('CRVAL2', NaN)];
  if (![...crpix, ...crval, ...cd].every(Number.isFinite) || cd[0] * cd[3] - cd[1] * cd[2] === 0) {
    throw formatError('IMAGE header has no usable celestial WCS (CRPIX / CRVAL / PC)');
  }
  const ctype = String(cards.get('CTYPE1') ?? '');
  if (ctype && !ctype.includes('TAN')) throw formatError(`unsupported projection ${ctype}`);
  const sip = ctype.includes('-SIP');
  return {
    crpix,
    crval,
    cd,
    a: sip ? sipTerms(cards, 'A') : [],
    b: sip ? sipTerms(cards, 'B') : [],
    ap: sip ? sipTerms(cards, 'AP') : [],
    bp: sip ? sipTerms(cards, 'BP') : [],
  };
}

function basis(ra, dec) {
  const sr = Math.sin(ra * D2R);
  const cr = Math.cos(ra * D2R);
  const sd = Math.sin(dec * D2R);
  const cd = Math.cos(dec * D2R);
  return { b: [cd * cr, cd * sr, sd], e: [-sr, cr, 0], n: [-sd * cr, -sd * sr, cd] };
}

/**
 * Sky -> FITS pixel (1-based) through the full TAN-SIP inverse: gnomonic projection about
 * CRVAL, inverse CD matrix, the AP/BP polynomials as a first guess, then Newton iteration on
 * the forward A/B polynomials (so the result inverts pixelToSky to 1e-9 pixel whatever the
 * quality of AP/BP). Returns null when the point is 90 degrees or more from CRVAL.
 */
export function skyToPixel(wcs, ra, dec) {
  const { b, e, n } = basis(wcs.crval[0], wcs.crval[1]);
  const t = basis(ra, dec).b;
  const cosc = t[0] * b[0] + t[1] * b[1] + t[2] * b[2];
  if (!(cosc > 1e-6)) return null;
  const xi = (t[0] * e[0] + t[1] * e[1] + t[2] * e[2]) / cosc / D2R;
  const eta = (t[0] * n[0] + t[1] * n[1] + t[2] * n[2]) / cosc / D2R;
  const [c11, c12, c21, c22] = wcs.cd;
  const det = c11 * c22 - c12 * c21;
  const U = (c22 * xi - c12 * eta) / det; // undistorted pixel offsets u', v'
  const V = (c11 * eta - c21 * xi) / det;
  let u = U + polyEval(wcs.ap, U, V)[0];
  let v = V + polyEval(wcs.bp, U, V)[0];
  if (wcs.a.length > 0 || wcs.b.length > 0) {
    for (let iter = 0; iter < 30; iter++) {
      const [a, au, av] = polyEval(wcs.a, u, v);
      const [bb, bu, bv] = polyEval(wcs.b, u, v);
      const f1 = u + a - U;
      const f2 = v + bb - V;
      const j11 = 1 + au;
      const j22 = 1 + bv;
      const jdet = j11 * j22 - av * bu;
      if (!(Math.abs(jdet) > 1e-12)) break;
      const du = (f1 * j22 - f2 * av) / jdet;
      const dv = (f2 * j11 - f1 * bu) / jdet;
      u -= du;
      v -= dv;
      if (Math.abs(du) + Math.abs(dv) < 1e-10) break;
    }
  }
  if (!Number.isFinite(u) || !Number.isFinite(v)) return null;
  return [u + wcs.crpix[0], v + wcs.crpix[1]];
}

/** FITS pixel (1-based) -> [ra, dec] in degrees through TAN-SIP (forward A/B polynomials). */
export function pixelToSky(wcs, x, y) {
  const u = x - wcs.crpix[0];
  const v = y - wcs.crpix[1];
  const up = u + polyEval(wcs.a, u, v)[0];
  const vp = v + polyEval(wcs.b, u, v)[0];
  const xi = (wcs.cd[0] * up + wcs.cd[1] * vp) * D2R;
  const eta = (wcs.cd[2] * up + wcs.cd[3] * vp) * D2R;
  const { b, e, n } = basis(wcs.crval[0], wcs.crval[1]);
  const vx = b[0] + xi * e[0] + eta * n[0];
  const vy = b[1] + xi * e[1] + eta * n[1];
  const vz = b[2] + xi * e[2] + eta * n[2];
  let ra = Math.atan2(vy, vx) / D2R;
  if (ra < 0) ra += 360;
  return [ra, Math.atan2(vz, Math.hypot(vx, vy)) / D2R];
}

/**
 * The pixel window of a cutout: n = max(3, round(size / 6.15 arcsec)) pixels on a side, centred
 * on the target pixel (xt, yt) (1-based, fractional), clipped to the W x H detector.
 * Throws CutoutError code 'OUTSIDE' when the target is not on the detector.
 * @returns {{ x0, y0, x1, y1, nx, ny, n }} 1-based inclusive pixel ranges
 */
export function cutoutWindow(xt, yt, sizeDeg, W, H) {
  if (!(xt >= 0.5 && xt < W + 0.5 && yt >= 0.5 && yt < H + 0.5)) {
    throw new CutoutError(`the position falls outside this detector (pixel ${Number(xt).toFixed(1)}, ${Number(yt).toFixed(1)})`, {
      code: 'OUTSIDE',
      status: 404,
    });
  }
  const size = Number.isFinite(sizeDeg) && sizeDeg > 0 ? sizeDeg : 0;
  const n = Math.min(Math.max(W, H), Math.max(3, Math.round((size * 3600) / PIXEL_ARCSEC)));
  const x0 = Math.max(1, Math.round(xt - (n - 1) / 2));
  const y0 = Math.max(1, Math.round(yt - (n - 1) / 2));
  const x1 = Math.min(W, Math.round(xt - (n - 1) / 2) + n - 1);
  const y1 = Math.min(H, Math.round(yt - (n - 1) / 2) + n - 1);
  return { x0, y0, x1, y1, nx: x1 - x0 + 1, ny: y1 - y0 + 1, n };
}

// ---------------------------------------------------------------------------------------------
// FITS header editing
// ---------------------------------------------------------------------------------------------

function cardKey(card) {
  let end = 8;
  while (end > 0 && card[end - 1] === 0x20) end--;
  return String.fromCharCode.apply(null, card.subarray(0, end));
}

/** The 80-byte cards of a header (END and padding excluded) as subarrays of `buf`. */
function splitCards(buf) {
  const cards = [];
  for (let pos = 0; pos + CARD <= buf.length; pos += CARD) {
    const card = buf.subarray(pos, pos + CARD);
    const key = cardKey(card);
    if (key === 'END') return cards;
    cards.push({ key, bytes: card });
  }
  throw formatError('FITS header without END');
}

function textCard(text) {
  const s = text.length > CARD ? text.slice(0, CARD) : text.padEnd(CARD);
  const out = new Uint8Array(CARD);
  for (let i = 0; i < CARD; i++) out[i] = s.charCodeAt(i) & 0x7f;
  return out;
}

function formatReal(v) {
  let s = String(v).replace('e', 'E').replace('E+', 'E');
  if (!s.includes('.') && !s.includes('E')) s += '.0';
  return s;
}

/** A numeric card with a new value; the comment of the old card (if any) is kept. */
function numberCard(key, valueText, oldBytes) {
  let comment = '';
  if (oldBytes) {
    const old = String.fromCharCode.apply(null, oldBytes);
    const slash = old.indexOf('/', 10);
    if (slash >= 0) comment = old.slice(slash + 1).trim();
  }
  return textCard(`${key.padEnd(8)}= ${valueText.padStart(20)}${comment ? ` / ${comment}` : ''}`);
}

const stringCard = (key, value, comment) => textCard(`${key.padEnd(8)}= ${`'${value.padEnd(8)}'`.padEnd(20)}${comment ? ` / ${comment}` : ''}`);

function assembleHeader(cardBytes) {
  const out = new Uint8Array(pad2880((cardBytes.length + 1) * CARD)).fill(0x20);
  let pos = 0;
  for (const c of cardBytes) {
    out.set(c, pos);
    pos += CARD;
  }
  out.set([0x45, 0x4e, 0x44], pos); // "END"
  return out;
}

const CRPIX_RE = /^CRPIX([12])[A-Z]?$/;
const CHECKSUM_KEYS = new Set(['CHECKSUM', 'DATASUM', 'ZHECKSUM', 'ZDATASUM']);

/**
 * Cards of an image header rewritten for a window starting at detector pixel (x0, y0):
 * NAXIS1/NAXIS2 = window size; CRPIX1 and CRPIX2 of the primary and of every alternate WCS
 * (CRPIX1W, CRPIX1A, ...) shifted by -(x0 - 1), -(y0 - 1); CHECKSUM/DATASUM dropped (they
 * would be wrong); every other card byte-identical.
 */
function windowCards(header, win) {
  const out = [];
  for (const card of splitCards(header.buf)) {
    const { key } = card;
    if (CHECKSUM_KEYS.has(key)) continue;
    const value = header.cards.get(key);
    const m = CRPIX_RE.exec(key);
    if (key === 'NAXIS1') out.push({ key, bytes: numberCard(key, String(win.nx), card.bytes) });
    else if (key === 'NAXIS2') out.push({ key, bytes: numberCard(key, String(win.ny), card.bytes) });
    else if (m && typeof value === 'number' && Number.isFinite(value)) {
      const shifted = value - ((m[1] === '1' ? win.x0 : win.y0) - 1);
      out.push({ key, bytes: numberCard(key, formatReal(shifted), card.bytes) });
    } else out.push(card);
  }
  return out;
}

const IMAGE_STRUCTURE = new Set(['XTENSION', 'SIMPLE', 'BITPIX', 'NAXIS', 'NAXIS1', 'NAXIS2', 'PCOUNT', 'GCOUNT', 'EXTNAME', 'EXTEND']);
const NOT_FOR_FLAGS = new Set([...IMAGE_STRUCTURE, 'BUNIT', 'BSCALE', 'BZERO', 'BLANK', 'DATAMIN', 'DATAMAX']);
const TABLE_KEY_RE = /^(TFIELDS|THEAP|T(TYPE|FORM|UNIT|DIM|SCAL|ZERO|NULL|DISP)\d+)$/;
const COMPRESSION_KEY_RE = /^Z(IMAGE|TENSION|SIMPLE|EXTEND|BLOCKED|BITPIX|NAXIS\d*|PCOUNT|GCOUNT|TILE\d+|CMPTYPE|NAME\d+|VAL\d+|QUANTIZ|DITHER0|MASKCMP|BLANK)$/;
const COMMENTARY = new Set(['', 'COMMENT', 'HISTORY']);

/**
 * Header of the FLAGS HDU of the cutout: a plain IMAGE extension, BITPIX 32, then every WCS and
 * metadata card of the (already rewritten) IMAGE header, so FLAGS has exactly the WCS of IMAGE,
 * then the cards that only the original FLAGS header has and that are not about the table or
 * the compression (the bit definitions MSKNnnnn and so on).
 */
function flagsCards(flagsHeader, imageWindowCards, win) {
  const out = [
    stringCard('XTENSION', 'IMAGE', 'Image extension'),
    numberCard('BITPIX', '32'),
    numberCard('NAXIS', '2'),
    numberCard('NAXIS1', String(win.nx)),
    numberCard('NAXIS2', String(win.ny)),
    numberCard('PCOUNT', '0'),
    numberCard('GCOUNT', '1'),
    stringCard('EXTNAME', 'FLAGS', 'extension name'),
  ];
  const seen = new Set();
  for (const card of imageWindowCards) {
    if (NOT_FOR_FLAGS.has(card.key) || COMMENTARY.has(card.key)) continue;
    seen.add(card.key);
    out.push(card.bytes);
  }
  for (const card of splitCards(flagsHeader.buf)) {
    const { key } = card;
    if (seen.has(key) || NOT_FOR_FLAGS.has(key) || COMMENTARY.has(key) || CHECKSUM_KEYS.has(key)) continue;
    if (TABLE_KEY_RE.test(key) || COMPRESSION_KEY_RE.test(key) || CRPIX_RE.test(key)) continue;
    seen.add(key);
    out.push(card.bytes);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------

/**
 * Parse the header that starts at file offset `offset`. `buf` holds bytes from that offset
 * (or is null: `guess` bytes are read). More is read while the END card is missing.
 * @returns {{ cards, headerBytes, dataBytes, paddedDataBytes, buf }} buf starts at `offset`
 */
async function completeHeader(get, offset, buf, guess) {
  let bytes = buf;
  if (!bytes || bytes.length < CARD) bytes = await get(offset, offset + Math.max(BLOCK, guess) - 1);
  for (let round = 0; round < 12; round++) {
    let parsed;
    try {
      parsed = parseHeaderBlock(bytes, 0);
    } catch (err) {
      throw formatError(`no FITS header at byte ${offset}: ${err.message}`);
    }
    if (parsed) return { ...parsed, buf: bytes };
    const more = await get(offset + bytes.length, offset + bytes.length + 4 * BLOCK - 1);
    if (more.length === 0) throw formatError(`file ends inside the header at byte ${offset}`);
    bytes = concat(bytes, more);
  }
  throw formatError(`header at byte ${offset} has no END within ${bytes.length} bytes`);
}

function checkImageHdu(header, name, W, H) {
  const c = header.cards;
  const bitpix = c.get('BITPIX');
  if (c.get('XTENSION') !== 'IMAGE') throw formatError(`${name}: expected an IMAGE extension, found ${c.get('XTENSION')}`);
  if (name && String(c.get('EXTNAME') ?? '').toUpperCase() !== name) throw formatError(`expected the ${name} extension, found ${c.get('EXTNAME')}`);
  if (c.get('NAXIS') !== 2 || ![-32, -64, 32, 16].includes(bitpix)) throw formatError(`${name}: unsupported image (NAXIS ${c.get('NAXIS')}, BITPIX ${bitpix})`);
  if (W !== undefined && (c.get('NAXIS1') !== W || c.get('NAXIS2') !== H)) {
    throw formatError(`${name}: ${c.get('NAXIS1')} x ${c.get('NAXIS2')} does not match IMAGE (${W} x ${H})`);
  }
  if ((c.has('BSCALE') && c.get('BSCALE') !== 1) || (c.has('BZERO') && c.get('BZERO') !== 0)) {
    // Scaled planes pass through unchanged: the header keeps BSCALE/BZERO and readImage applies them.
  }
  return Math.abs(bitpix) / 8;
}

/** How the FLAGS extension stores its pixels. */
function flagsLayout(header, W, H) {
  const c = header.cards;
  if (c.get('XTENSION') === 'IMAGE') {
    const bpp = checkImageHdu(header, 'FLAGS', W, H);
    if (c.get('BITPIX') !== 32) throw formatError(`FLAGS: unsupported BITPIX ${c.get('BITPIX')}`);
    return { compressed: false, bpp };
  }
  if (c.get('XTENSION') !== 'BINTABLE' || c.get('ZIMAGE') !== true) throw formatError('FLAGS is neither an image nor a tile-compressed image');
  if (String(c.get('EXTNAME') ?? '').toUpperCase() !== 'FLAGS') throw formatError(`expected the FLAGS extension, found ${c.get('EXTNAME')}`);
  const cmp = String(c.get('ZCMPTYPE') ?? '');
  if (cmp !== 'RICE_1' && cmp !== 'RICE_ONE') throw formatError(`FLAGS: unsupported compression ${cmp}`);
  if (c.get('ZBITPIX') !== 32 || c.get('ZNAXIS') !== 2) throw formatError(`FLAGS: unsupported ZBITPIX ${c.get('ZBITPIX')} / ZNAXIS ${c.get('ZNAXIS')}`);
  if (c.get('ZNAXIS1') !== W || c.get('ZNAXIS2') !== H) throw formatError(`FLAGS: ${c.get('ZNAXIS1')} x ${c.get('ZNAXIS2')} does not match IMAGE`);
  const tile1 = c.has('ZTILE1') ? c.get('ZTILE1') : W;
  const tile2 = c.has('ZTILE2') ? c.get('ZTILE2') : 1;
  if (tile1 !== W || tile2 !== 1) throw formatError(`FLAGS: unsupported tiling ${tile1} x ${tile2} (need one tile per row)`);
  let blockSize = 32;
  let bytePix = 4;
  for (let i = 1; c.has(`ZNAME${i}`); i++) {
    const name = String(c.get(`ZNAME${i}`)).toUpperCase();
    if (name === 'BLOCKSIZE') blockSize = c.get(`ZVAL${i}`);
    if (name === 'BYTEPIX') bytePix = c.get(`ZVAL${i}`);
  }
  if (bytePix !== 4 || !(blockSize >= 1)) throw formatError(`FLAGS: unsupported BYTEPIX ${bytePix} / BLOCKSIZE ${blockSize}`);
  const cols = tableColumns(c);
  const col = cols.find((k) => k.name.toUpperCase() === 'COMPRESSED_DATA') || cols[0];
  if (!col || (col.type !== 'P' && col.type !== 'Q')) throw formatError('FLAGS: no variable-length COMPRESSED_DATA column');
  const rowBytes = c.get('NAXIS1');
  const rows = c.get('NAXIS2');
  if (rows !== H) throw formatError(`FLAGS: ${rows} table rows for ${H} image rows`);
  const tableBytes = rowBytes * rows;
  const theap = typeof c.get('THEAP') === 'number' ? c.get('THEAP') : tableBytes;
  const pcount = typeof c.get('PCOUNT') === 'number' ? c.get('PCOUNT') : 0;
  return { compressed: true, blockSize, rowBytes, tableBytes, theap, heapBytes: tableBytes + pcount - theap, colOffset: col.offset, wide: col.type === 'Q' };
}

async function cutout(key, id, ra, dec, sizeDeg, opts) {
  const { layoutMemo = null } = opts;
  const info = parseKey(key);
  const memoKey = `${info.version}/D${info.det}`;
  const known = layoutMemo && typeof layoutMemo.get === 'function' ? layoutMemo.get(memoKey) || null : null;
  const st = { requests: 0, bytes: 0, path: known ? 'speculative' : 'careful', fallbacks: [], total: null, window: null, target: null };
  const get = async (start, end) => {
    const r = await rangeGet(key, start, end, opts);
    st.requests += 1;
    st.bytes += r.bytes.length;
    if (r.total !== null) st.total = r.total;
    return r.bytes;
  };
  const finish = () => {
    if (opts.stats && typeof opts.stats === 'object') Object.assign(opts.stats, st);
  };

  try {
    // ---- Round 1: primary + IMAGE header, and (at its usual place) FLAGS header + table.
    const guess = { ...DEFAULT_LAYOUT, ...(known || {}) };
    const flagsSpec = settle(get(guess.flagsOffset, guess.flagsOffset + guess.flagsHeaderBytes + guess.flagsTableBytes - 1));
    const head = await get(0, guess.headBytes - 1);
    const primary = await completeHeader(get, 0, head, HEAD_BYTES);
    if (primary.paddedDataBytes !== 0) throw formatError('primary HDU has data: not a SPHEREx Level-2 file');
    const imageOffset = primary.headerBytes;
    const image = await completeHeader(get, imageOffset, primary.buf.length > imageOffset ? primary.buf.subarray(imageOffset) : null, HEAD_BYTES - BLOCK);
    const bpp = checkImageHdu(image, 'IMAGE');
    const W = image.cards.get('NAXIS1');
    const H = image.cards.get('NAXIS2');
    if (!(W >= 1 && H >= 1)) throw formatError('IMAGE has no pixels');
    const imageData = imageOffset + image.headerBytes;
    const flagsOffset = imageData + image.paddedDataBytes;

    const wcs = wcsFromHeader(image.cards);
    const target = skyToPixel(wcs, ra, dec);
    if (!target) throw new CutoutError('the position is nowhere near this exposure', { code: 'OUTSIDE', status: 404 });
    st.target = target;
    const win = cutoutWindow(target[0], target[1], sizeDeg, W, H);
    st.window = { x0: win.x0, y0: win.y0, nx: win.nx, ny: win.ny };
    const { x0, y0, x1, y1, nx, ny } = win;

    // Byte range of the window's rows in a W x H plane that starts at dataOffset: from the
    // first needed pixel of row y0 to the last needed pixel of row y1.
    const rowsOf = (dataOffset, bytesPerPixel) =>
      get(dataOffset + ((y0 - 1) * W + (x0 - 1)) * bytesPerPixel, dataOffset + ((y1 - 1) * W + x1) * bytesPerPixel - 1);

    // ---- Round 2 begins: IMAGE rows.
    const imageRows = background(rowsOf(imageData, bpp));

    // FLAGS header (from round 1 when it was where expected).
    const flagsHeaderP = background(
      (async () => {
        const spec = await flagsSpec;
        let buf = null;
        if (spec.ok && guess.flagsOffset === flagsOffset) buf = spec.value;
        else st.fallbacks.push('flags-header');
        return completeHeader(get, flagsOffset, buf, DEFAULT_LAYOUT.flagsHeaderBytes + DEFAULT_LAYOUT.flagsTableBytes);
      })(),
    );

    // FLAGS pixels: descriptor rows, then the heap range that covers the needed tiles.
    const flagsP = background(
      (async () => {
        const header = await flagsHeaderP;
        const lay = flagsLayout(header, W, H);
        const out = new Int32Array(nx * ny);
        const dataOffset = flagsOffset + header.headerBytes;
        if (!lay.compressed) {
          const rows = await rowsOf(dataOffset, 4);
          const dv = new DataView(rows.buffer, rows.byteOffset, rows.byteLength);
          for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) out[j * nx + i] = dv.getInt32((j * W + i) * 4, false);
          return { header, lay, pixels: out };
        }
        // Descriptor table rows y0..y1 (0-based y0-1..y1-1): usually already in the buffer.
        const first = (y0 - 1) * lay.rowBytes;
        const last = y1 * lay.rowBytes;
        let table;
        if (header.buf.length >= header.headerBytes + last) table = header.buf.subarray(header.headerBytes + first, header.headerBytes + last);
        else {
          st.fallbacks.push('flags-table');
          table = await get(dataOffset + first, dataOffset + last - 1);
        }
        if (table.length < last - first) throw formatError('FLAGS descriptor table is cut short');
        const tv = new DataView(table.buffer, table.byteOffset, table.byteLength);
        const lengths = new Array(ny);
        const offsets = new Array(ny);
        let lo = Infinity;
        let hi = -Infinity;
        let sum = 0;
        for (let j = 0; j < ny; j++) {
          const at = j * lay.rowBytes + lay.colOffset;
          // 'P' descriptor: int32 element count, int32 heap offset; 'Q': the same in int64.
          const len = lay.wide ? Number(tv.getBigInt64(at, false)) : tv.getInt32(at, false);
          const off = lay.wide ? Number(tv.getBigInt64(at + 8, false)) : tv.getInt32(at + 4, false);
          if (!(len > 0) || !(off >= 0) || off + len > lay.heapBytes) {
            throw formatError(`FLAGS row ${y0 + j}: bad tile descriptor (${len} bytes at heap offset ${off})`);
          }
          lengths[j] = len;
          offsets[j] = off;
          if (off < lo) lo = off;
          if (off + len > hi) hi = off + len;
          sum += len;
        }
        const heapOffset = dataOffset + lay.theap;
        let tileOf;
        if (hi - lo <= 2 * sum + 65536) {
          // The usual case: tiles of consecutive rows are stored back to back.
          const heap = await get(heapOffset + lo, heapOffset + hi - 1);
          if (heap.length < hi - lo) throw formatError('FLAGS heap is cut short');
          tileOf = (j) => heap.subarray(offsets[j] - lo, offsets[j] - lo + lengths[j]);
        } else {
          // Tiles scattered over the heap: read them one by one.
          st.fallbacks.push('flags-scattered');
          const tiles = await mapLimit(lengths, 8, (len, j) => get(heapOffset + offsets[j], heapOffset + offsets[j] + len - 1));
          tileOf = (j) => tiles[j];
        }
        for (let j = 0; j < ny; j++) {
          let row;
          try {
            row = riceDecompressInt32(tileOf(j), W, lay.blockSize);
          } catch (err) {
            throw formatError(`FLAGS row ${y0 + j}: ${err.message}`);
          }
          out.set(row.subarray(x0 - 1, x1), j * nx);
        }
        return { header, lay, pixels: out };
      })(),
    );

    // Header of one float plane (VARIANCE or ZODI) at `offset`; `buf` may hold bytes read
    // speculatively from that offset.
    const planeHeader = async (name, offset, buf, headerGuess) => {
      const header = await completeHeader(get, offset, buf, headerGuess || PLANE_HEADER_GUESS);
      const planeBpp = checkImageHdu(header, name, W, H);
      return { header, bpp: planeBpp, dataOffset: offset + header.headerBytes, next: offset + header.headerBytes + header.paddedDataBytes };
    };
    // Speculative read of a plane: header and rows requested together, assuming the header
    // length; the assumption is checked against the parsed header and the rows are read again
    // when it was wrong.
    const planeSpeculative = async (name, offset, headerGuess) => {
      const specHeader = settle(get(offset, offset + headerGuess - 1));
      const specRows = settle(rowsOf(offset + headerGuess, 4));
      const h = await specHeader;
      const info = await planeHeader(name, offset, h.ok ? h.value : null, headerGuess);
      const r = await specRows;
      let rows = null;
      if (r.ok && info.header.headerBytes === headerGuess && info.bpp === 4) rows = r.value;
      else {
        st.fallbacks.push(`${name.toLowerCase()}-rows`);
        rows = await rowsOf(info.dataOffset, info.bpp);
      }
      return { ...info, rows };
    };

    const planesP = background(
      (async () => {
        const flagsHeader = await flagsHeaderP;
        const varianceOffset = flagsOffset + flagsHeader.headerBytes + flagsHeader.paddedDataBytes;
        const careful = async (name, offset) => {
          const info = await planeHeader(name, offset, null, null);
          return { info, rows: background(rowsOf(info.dataOffset, info.bpp)) };
        };
        if (!known || !known.varianceHeaderBytes || !known.zodiHeaderBytes) {
          // Careful path: each header is parsed before anything that depends on it is read;
          // the VARIANCE rows and the ZODI header travel together.
          const v = await careful('VARIANCE', varianceOffset);
          const z = await careful('ZODI', v.info.next);
          return { variance: { ...v.info, rows: await v.rows }, zodi: { ...z.info, rows: await z.rows } };
        }
        const zodiGuess = varianceOffset + known.varianceHeaderBytes + pad2880(W * H * 4);
        const zodiSpec = settle(planeSpeculative('ZODI', zodiGuess, known.zodiHeaderBytes));
        const variance = await planeSpeculative('VARIANCE', varianceOffset, known.varianceHeaderBytes);
        const zs = await zodiSpec;
        if (zs.ok && variance.next === zodiGuess) return { variance, zodi: zs.value };
        st.fallbacks.push('zodi');
        const z = await careful('ZODI', variance.next);
        return { variance, zodi: { ...z.info, rows: await z.rows } };
      })(),
    );

    const [imageBytes, flags, planes] = await Promise.all([imageRows, flagsP, planesP]);
    const { variance, zodi } = planes;

    // ---- Assemble the cutout file.
    const imageCards = windowCards(image, win);
    const headers = [
      primary.buf.subarray(0, primary.headerBytes),
      assembleHeader(imageCards.map((c) => c.bytes)),
      assembleHeader(flagsCards(flags.header, imageCards, win)),
      assembleHeader(windowCards(variance.header, win).map((c) => c.bytes)),
      assembleHeader(windowCards(zodi.header, win).map((c) => c.bytes)),
    ];
    const dataBytes = [0, nx * ny * bpp, nx * ny * 4, nx * ny * variance.bpp, nx * ny * zodi.bpp];
    let size = 0;
    for (let i = 0; i < headers.length; i++) size += headers[i].length + pad2880(dataBytes[i]);
    const out = new Uint8Array(size);
    let pos = 0;
    // Rows were read from pixel (x0, y0): pixel (x0 + i, y0 + j) is at ((j * W) + i) * bpp.
    const copyWindow = (rows, bytesPerPixel, name) => {
      if (rows.length < ((ny - 1) * W + nx) * bytesPerPixel) throw formatError(`${name} pixel rows are cut short`);
      for (let j = 0; j < ny; j++) {
        const from = j * W * bytesPerPixel;
        out.set(rows.subarray(from, from + nx * bytesPerPixel), pos + j * nx * bytesPerPixel);
      }
    };
    out.set(headers[0], pos);
    pos += headers[0].length;
    out.set(headers[1], pos);
    pos += headers[1].length;
    copyWindow(imageBytes, bpp, 'IMAGE'); // already big-endian: copied as they are
    pos += pad2880(dataBytes[1]);
    out.set(headers[2], pos);
    pos += headers[2].length;
    const dv = new DataView(out.buffer);
    for (let i = 0; i < flags.pixels.length; i++) dv.setInt32(pos + 4 * i, flags.pixels[i], false);
    pos += pad2880(dataBytes[2]);
    out.set(headers[3], pos);
    pos += headers[3].length;
    copyWindow(variance.rows, variance.bpp, 'VARIANCE');
    pos += pad2880(dataBytes[3]);
    out.set(headers[4], pos);
    pos += headers[4].length;
    copyWindow(zodi.rows, zodi.bpp, 'ZODI');

    if (layoutMemo && typeof layoutMemo.set === 'function') {
      layoutMemo.set(memoKey, {
        headBytes: imageData,
        flagsOffset,
        flagsHeaderBytes: flags.header.headerBytes,
        flagsTableBytes: flags.lay.compressed ? flags.lay.tableBytes : DEFAULT_LAYOUT.flagsTableBytes,
        varianceHeaderBytes: variance.header.headerBytes,
        zodiHeaderBytes: zodi.header.headerBytes,
      });
    }
    finish();
    return out;
  } catch (err) {
    finish();
    throw err;
  }
}

/**
 * Cut a window around (ra, dec) out of a full Level-2 file in S3. See the top of this file.
 * @param {string} id       IRSA uri ('ibe/data/spherex/<key>')
 * @param {number} ra       degrees
 * @param {number} dec      degrees
 * @param {number} sizeDeg  cutout width in degrees (0.1 gives 59 x 59 pixels)
 * @param {object} [opts]   fetchImpl, layoutMemo, stats, and the s3.js options (timeoutMs
 *                          default 20 s per request, retries default 3, backoffMs, signal)
 * @returns {Promise<Uint8Array>}
 */
export async function fetchCutoutFromS3(id, ra, dec, sizeDeg, opts = {}) {
  let key;
  try {
    key = idToKey(id);
    if (!Number.isFinite(ra) || !Number.isFinite(dec)) throw new CutoutError('ra and dec must be numbers in degrees', { code: 'BAD_ID', status: 400 });
    return await cutout(key, id, ra, dec, sizeDeg, opts);
  } catch (err) {
    throw asCutoutError(err, 'S3 cutout');
  }
}

// ---------------------------------------------------------------------------------------------
// Wavelength table and file info
// ---------------------------------------------------------------------------------------------

function waveHduAt(bytes, offset) {
  if (offset < 0 || offset + CARD > bytes.length) return null;
  // "XTENSION" must open the header
  const magic = [0x58, 0x54, 0x45, 0x4e, 0x53, 0x49, 0x4f, 0x4e];
  for (let i = 0; i < 8; i++) if (bytes[offset + i] !== magic[i]) return null;
  let parsed;
  try {
    parsed = parseHeaderBlock(bytes, offset);
  } catch {
    return null;
  }
  if (!parsed || String(parsed.cards.get('EXTNAME') ?? '').toUpperCase() !== 'WCS-WAVE') return null;
  if (offset + parsed.headerBytes + parsed.dataBytes > bytes.length) return null;
  return { index: 6, name: 'WCS-WAVE', type: 'BINTABLE', header: parsed.cards, dataOffset: offset + parsed.headerBytes, dataBytes: parsed.dataBytes };
}

/**
 * The WCS-WAVE lookup table of a file: its last HDU, 2880 bytes of header and 2880 of data at
 * the very end. One Range request when `opts.total` (the file size) is given, otherwise a
 * small first request finds the size. If the table is not exactly there, the last 28800 bytes
 * are searched for it.
 */
export async function fetchWaveTableFromS3(id, opts = {}) {
  try {
    const key = idToKey(id);
    let total = Number.isInteger(opts.total) && opts.total > 0 ? opts.total : null;
    if (total === null) {
      total = (await rangeGet(key, 0, CARD - 1, opts)).total;
      if (total === null) throw formatError('S3 did not report the file size (no Content-Range)');
    }
    if (total < WAVE_TAIL_BYTES) throw formatError(`file of ${total} bytes is too small for a Level-2 file`);
    let bytes = (await rangeGet(key, total - WAVE_TAIL_BYTES, total - 1, opts)).bytes;
    let hdu = waveHduAt(bytes, 0);
    if (!hdu) {
      const start = Math.max(0, total - HEAD_BYTES);
      bytes = (await rangeGet(key, start, total - 1, opts)).bytes;
      // HDUs start on 2880-byte boundaries of the file.
      for (let fileOffset = Math.floor((total - 2 * BLOCK) / BLOCK) * BLOCK; fileOffset >= start && !hdu; fileOffset -= BLOCK) {
        hdu = waveHduAt(bytes, fileOffset - start);
      }
    }
    if (!hdu) throw formatError('no WCS-WAVE extension at the end of the file');
    try {
      return readWaveTable(bytes, hdu);
    } catch (err) {
      throw formatError(err.message);
    }
  } catch (err) {
    throw asCutoutError(err, 'S3 wavelength table');
  }
}

/** Basic facts about a file from its first 28800 bytes (one Range request). */
export async function s3FileInfo(id, opts = {}) {
  try {
    const key = idToKey(id);
    const parts = parseKey(key);
    const first = await rangeGet(key, 0, HEAD_BYTES - 1, opts);
    const get = async (start, end) => (await rangeGet(key, start, end, opts)).bytes;
    const primary = await completeHeader(get, 0, first.bytes, HEAD_BYTES);
    const offset = primary.headerBytes + primary.paddedDataBytes;
    const image = await completeHeader(get, offset, primary.buf.length > offset ? primary.buf.subarray(offset) : null, HEAD_BYTES - BLOCK);
    const c = image.cards;
    const num = (name) => (typeof c.get(name) === 'number' && Number.isFinite(c.get(name)) ? c.get(name) : null);
    const text = (v) => (v === undefined || v === null ? null : String(v));
    return {
      id: `ibe/data/spherex/${key}`,
      key,
      url: `${String(opts.base || S3_BASE).replace(/\/+$/, '')}/${key}`,
      size: first.total,
      ...parts,
      mjd: num('MJD-AVG') ?? num('MJD-OBS'),
      exptime: num('XPOSURE') ?? num('EXPTIME'),
      dateObs: text(c.get('DATE-OBS')),
      softwareVersion: text(primary.cards.get('VERSION') ?? c.get('VERSION')),
      naxis: [num('NAXIS1'), num('NAXIS2')],
      crval: [num('CRVAL1'), num('CRVAL2')],
    };
  } catch (err) {
    throw asCutoutError(err, 'S3 file info');
  }
}
