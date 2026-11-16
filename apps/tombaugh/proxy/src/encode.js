// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// TBF1: the compact binary frame the proxy sends to the browser instead of a 4 MB FITS file.
//
//   bytes 0..3    ASCII "TBF1"
//   bytes 4..7    uint32 LE: N = byte length of the JSON header, space-padded so that 8 + N is a
//                 multiple of 8
//   bytes 8..8+N  UTF-8 JSON header (see CONTRACT.md)
//   then          raw little-endian arrays, contiguous, in the order image, variance, zodi,
//                 flags, wave, at the offsets (from the start of the file) listed in
//                 header.arrays. All offsets are multiples of 4.

import { parseMef, findHdu, readImage, readWaveTable } from './fits.js';
import { waveAt, waveMap, detectorXY } from './wavetab.js';

const MAGIC = [0x54, 0x42, 0x46, 0x31]; // "TBF1"
const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

const DTYPES = {
  f4: { ctor: Float32Array, bytes: 4, get: 'getFloat32', set: 'setFloat32' },
  i4: { ctor: Int32Array, bytes: 4, get: 'getInt32', set: 'setInt32' },
  f8: { ctor: Float64Array, bytes: 8, get: 'getFloat64', set: 'setFloat64' },
  i2: { ctor: Int16Array, bytes: 2, get: 'getInt16', set: 'setInt16' },
  u1: { ctor: Uint8Array, bytes: 1, get: 'getUint8', set: 'setUint8' },
};

function toBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw new TypeError('expected a Uint8Array or ArrayBuffer');
}

const finiteOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const stringOrNull = (v) => (v === undefined || v === null ? null : String(v));

/**
 * Pull release, detector and observation id out of an IRSA uri such as
 * ibe/data/spherex/qr3/level2/2026W25_2A/l2b-v27-2026-273/2/level2_2026W25_2A_0279_1D2_spx_l2b-v27-2026-273.fits
 * @returns {{ release: string|null, det: number|null, obsid: string|null }}
 */
export function parseFrameId(id) {
  const text = String(id ?? '');
  const release = /(?:^|\/)spherex\/([^/]+)\//.exec(text);
  const file = /level2_(.+?)D([1-6])_spx/.exec(text);
  const dir = /\/([1-6])\/level2_/.exec(text);
  return {
    release: release ? release[1] : null,
    det: file ? Number(file[2]) : dir ? Number(dir[1]) : null,
    obsid: file ? file[1] : null,
  };
}

/** Collect SIP coefficients PREFIX_p_q into { "p_q": value }. */
function sipCoefficients(header, prefix) {
  const out = {};
  const re = new RegExp(`^${prefix}_(\\d+)_(\\d+)$`);
  for (const [key, value] of header) {
    const m = re.exec(key);
    if (m && typeof value === 'number' && Number.isFinite(value)) out[`${m[1]}_${m[2]}`] = value;
  }
  return out;
}

/**
 * Celestial WCS of an image header in the shape used by the TBF1 header and by
 * web/src/core/wcs.js: { crpix, crval, pc, cdelt, sip }. crpix is the FITS 1-based CRPIX.
 * `sip` is null unless CTYPE1 carries the -SIP suffix. A CDi_j matrix, if that is what the
 * header has, is returned as pc with cdelt = [1, 1].
 */
export function headerToWcs(header) {
  const num = (key, fallback) => {
    const v = header.get(key);
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  };
  let pc;
  let cdelt;
  if (header.has('PC1_1') || header.has('PC1_2') || header.has('PC2_1') || header.has('PC2_2') || !header.has('CD1_1')) {
    pc = [
      [num('PC1_1', 1), num('PC1_2', 0)],
      [num('PC2_1', 0), num('PC2_2', 1)],
    ];
    cdelt = [num('CDELT1', 1), num('CDELT2', 1)];
  } else {
    pc = [
      [num('CD1_1', 0), num('CD1_2', 0)],
      [num('CD2_1', 0), num('CD2_2', 0)],
    ];
    cdelt = [1, 1];
  }
  let sip = null;
  if (String(header.get('CTYPE1') ?? '').includes('-SIP')) {
    sip = {
      aOrder: num('A_ORDER', 0),
      bOrder: num('B_ORDER', 0),
      apOrder: num('AP_ORDER', 0),
      bpOrder: num('BP_ORDER', 0),
      a: sipCoefficients(header, 'A'),
      b: sipCoefficients(header, 'B'),
      ap: sipCoefficients(header, 'AP'),
      bp: sipCoefficients(header, 'BP'),
    };
  }
  return {
    crpix: [num('CRPIX1', 0), num('CRPIX2', 0)],
    crval: [num('CRVAL1', 0), num('CRVAL2', 0)],
    pc,
    cdelt,
    sip,
  };
}

function requireHdu(hdus, name) {
  const hdu = findHdu(hdus, name);
  if (!hdu) {
    throw new Error(`buildFrame: no ${name} extension (found ${hdus.map((h) => h.name).join(', ')})`);
  }
  return hdu;
}

function writeArray(out, dv, offset, array, dtype) {
  const { bytes, set } = DTYPES[dtype];
  if (LITTLE_ENDIAN) {
    out.set(new Uint8Array(array.buffer, array.byteOffset, array.byteLength), offset);
  } else {
    for (let i = 0; i < array.length; i++) dv[set](offset + i * bytes, array[i], true);
  }
}

/**
 * Turn the leading part of a SPHEREx Level-2 cutout into a TBF1 frame.
 *
 * @param {object} args
 * @param {string} args.id          the IRSA uri of the frame (path without host)
 * @param {Uint8Array} args.u8      FITS bytes through the ZODI HDU (readUntilPsf output); a
 *                                  complete file works too
 * @param {object} [args.waveTable] the detector's WCS-WAVE table from readWaveTable. May be
 *                                  omitted only if `u8` still contains the WCS-WAVE extension.
 * @returns {Uint8Array} TBF1 bytes
 */
export function buildFrame({ id, u8, waveTable }) {
  const bytes = toBytes(u8);
  const hdus = parseMef(bytes);
  const imageHdu = requireHdu(hdus, 'IMAGE');
  const h = imageHdu.header;
  const nx = h.get('NAXIS1');
  const ny = h.get('NAXIS2');
  if (h.get('NAXIS') !== 2 || !(nx > 0) || !(ny > 0)) {
    throw new Error('buildFrame: IMAGE extension is not a 2-D image');
  }
  const count = nx * ny;

  let table = waveTable;
  if (!table) {
    const waveHdu = findHdu(hdus, 'WCS-WAVE');
    if (!waveHdu) throw new Error('buildFrame: no wavelength table given and no WCS-WAVE extension in the bytes');
    table = readWaveTable(bytes, waveHdu);
  }

  const read = (name, Ctor) => {
    const hdu = name === 'IMAGE' ? imageHdu : requireHdu(hdus, name);
    if (hdu.header.get('NAXIS1') !== nx || hdu.header.get('NAXIS2') !== ny) {
      throw new Error(`buildFrame: ${name} is not ${nx} x ${ny} like IMAGE`);
    }
    const data = readImage(bytes, hdu);
    return data instanceof Ctor ? data : Ctor.from(data);
  };
  const planes = [
    { name: 'image', dtype: 'f4', data: read('IMAGE', Float32Array) },
    { name: 'variance', dtype: 'f4', data: read('VARIANCE', Float32Array) },
    { name: 'zodi', dtype: 'f4', data: read('ZODI', Float32Array) },
    { name: 'flags', dtype: 'i4', data: read('FLAGS', Int32Array) },
    { name: 'wave', dtype: 'f4', data: waveMap(table, h, nx, ny) },
  ];

  const fromId = parseFrameId(id);
  const primary = hdus[0].header;
  // 0-based pixel (0, 0) is FITS pixel (1, 1); the array centre is ((nx-1)/2, (ny-1)/2).
  const detXY0 = detectorXY(h, 0, 0);
  const [cx, cy] = detectorXY(h, (nx - 1) / 2, (ny - 1) / 2);
  const centre = waveAt(table, cx, cy);
  const obsid = h.get('OBSID');
  const det = h.get('DETECTOR');

  const header = {
    v: 1,
    id: String(id ?? ''),
    release: fromId.release,
    obsid: obsid !== undefined && obsid !== null ? String(obsid) : fromId.obsid,
    version: stringOrNull(primary.get('VERSION') ?? h.get('VERSION')),
    det: typeof det === 'number' ? det : fromId.det,
    nx,
    ny,
    mjd: finiteOrNull(h.get('MJD-AVG')) ?? finiteOrNull(h.get('MJD-OBS')),
    exptime: finiteOrNull(h.get('XPOSURE')) ?? finiteOrNull(h.get('EXPTIME')),
    dateObs: stringOrNull(h.get('DATE-OBS')),
    bunit: stringOrNull(h.get('BUNIT')),
    psfFwhm: finiteOrNull(h.get('PSF_FWHM')),
    wcs: headerToWcs(h),
    detXY0,
    waveCenter: finiteOrNull(centre.wave),
    bwCenter: finiteOrNull(centre.bandwidth),
    arrays: planes.map((p) => ({ name: p.name, dtype: p.dtype, offset: 0, length: count })),
  };

  // The JSON contains the array offsets, and the offsets depend on the JSON length. Grow the
  // padded length N until the JSON (with its final offsets) fits; this settles in a few passes.
  const encoder = new TextEncoder();
  let n = 0;
  let json;
  for (;;) {
    let offset = 8 + n;
    for (let i = 0; i < planes.length; i++) {
      header.arrays[i].offset = offset;
      offset += count * DTYPES[planes[i].dtype].bytes;
    }
    json = encoder.encode(JSON.stringify(header));
    const need = Math.ceil((8 + json.length) / 8) * 8 - 8;
    if (need <= n) break;
    n = need;
  }

  const last = planes.length - 1;
  const total = header.arrays[last].offset + count * DTYPES[planes[last].dtype].bytes;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  out.set(MAGIC, 0);
  dv.setUint32(4, n, true);
  out.fill(0x20, 8, 8 + n); // JSON.parse ignores trailing spaces
  out.set(json, 8);
  for (let i = 0; i < planes.length; i++) {
    writeArray(out, dv, header.arrays[i].offset, planes[i].data, planes[i].dtype);
  }
  return out;
}

/**
 * Decode TBF1 bytes into a Frame (same shape as web/src/api.js):
 * { id, det, nx, ny, mjd, exptime, release, obsid, version, dateObs, bunit, psfFwhm, wcs,
 *   detXY0, waveCenter, bwCenter, image, variance, zodi, flags, wave }.
 *
 * On little-endian machines the typed arrays are views into the input buffer when their byte
 * offset is suitably aligned, otherwise (and on big-endian machines) they are copies.
 *
 * @param {Uint8Array|ArrayBuffer} input
 */
export function decodeFrame(input) {
  const u8 = toBytes(input);
  if (u8.length < 8 || MAGIC.some((b, i) => u8[i] !== b)) {
    throw new Error('Not a TBF1 frame: bad magic bytes');
  }
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const n = dv.getUint32(4, true);
  if (8 + n > u8.length) throw new Error('TBF1 frame is truncated inside its header');
  let header;
  try {
    header = JSON.parse(new TextDecoder().decode(u8.subarray(8, 8 + n)));
  } catch (err) {
    throw new Error(`TBF1 frame has an unreadable header: ${err.message}`);
  }
  if (!header || header.v !== 1 || !Array.isArray(header.arrays)) {
    throw new Error(`Unsupported TBF1 header version ${header && header.v}`);
  }

  const { arrays, v: _version, ...frame } = header;
  for (const spec of arrays) {
    const dtype = DTYPES[spec.dtype];
    if (!dtype) throw new Error(`TBF1 array ${spec.name}: unknown dtype ${spec.dtype}`);
    const byteLength = spec.length * dtype.bytes;
    if (!Number.isInteger(spec.offset) || spec.offset < 8 + n || spec.offset + byteLength > u8.length) {
      throw new Error(`TBF1 array ${spec.name} lies outside the frame (truncated download?)`);
    }
    const absolute = u8.byteOffset + spec.offset;
    if (LITTLE_ENDIAN && absolute % dtype.bytes === 0) {
      frame[spec.name] = new dtype.ctor(u8.buffer, absolute, spec.length);
    } else if (LITTLE_ENDIAN) {
      // slice() copies into a fresh buffer, which is always aligned.
      frame[spec.name] = new dtype.ctor(u8.slice(spec.offset, spec.offset + byteLength).buffer);
    } else {
      const out = new dtype.ctor(spec.length);
      for (let i = 0; i < spec.length; i++) out[i] = dv[dtype.get](spec.offset + i * dtype.bytes, true);
      frame[spec.name] = out;
    }
  }
  return frame;
}
