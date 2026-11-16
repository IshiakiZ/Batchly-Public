// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// FITS multi-extension reader for SPHEREx Level-2 cutouts. Pure JS, Web-standard APIs only.
//
// FITS in one paragraph: a file is a sequence of HDUs. Each HDU is a header made of 80-byte
// ASCII "cards" ending with an END card, padded with spaces to a multiple of 2880 bytes,
// followed by big-endian binary data padded with zeros to a multiple of 2880 bytes. Pixel and
// row numbering in headers is 1-based; everything this module returns is 0-based JS arrays in
// the same order as the file (row-major, FITS axis 1 varying fastest).

export const FITS_BLOCK = 2880;
const CARD = 80;

// Safety valve for readUntilPsf: a SPHEREx cutout is about 4 MB, of which we want ~130 kB.
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;

/** Accept Uint8Array, ArrayBuffer or any ArrayBufferView; return a Uint8Array view (no copy). */
function toBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw new TypeError('FITS: expected a Uint8Array or ArrayBuffer');
}

function ascii(u8, start, end) {
  return String.fromCharCode.apply(null, u8.subarray(start, end));
}

/** Short printable excerpt of the bytes at `offset`, for error messages. */
function excerpt(u8, offset) {
  let s = '';
  const end = Math.min(u8.length, offset + 60);
  for (let i = offset; i < end; i++) {
    const c = u8[i];
    s += c >= 0x20 && c <= 0x7e ? String.fromCharCode(c) : '.';
  }
  return s.trim();
}

function notFitsError(u8, offset) {
  const where = offset === 0 ? 'content' : `bytes at offset ${offset}`;
  return new Error(`Not a FITS file: ${where} start with "${excerpt(u8, offset)}"`);
}

/** True when the 8 bytes at `offset` are a keyword that may legally open an HDU header. */
function startsHdu(u8, offset) {
  const key = ascii(u8, offset, offset + 8);
  return key === 'SIMPLE  ' || key === 'XTENSION';
}

const NUMBER_RE = /^[+-]?(\d+\.?\d*|\.\d+)([EeDd][+-]?\d+)?$/;

/**
 * Parse the value field of a card (columns 11-80).
 * Returns { value, isString }. Value is string | number | boolean | null (null = no value).
 */
function parseValue(field) {
  let i = 0;
  while (i < field.length && field[i] === ' ') i++;
  if (i >= field.length) return { value: null, isString: false };

  if (field[i] === "'") {
    // Character string: runs to the next single quote; a doubled quote '' is a literal quote.
    // Leading blanks are significant, trailing blanks are not (FITS 4.0, section 4.2.1).
    let s = '';
    let j = i + 1;
    while (j < field.length) {
      const c = field[j];
      if (c === "'") {
        if (field[j + 1] === "'") {
          s += "'";
          j += 2;
          continue;
        }
        break; // closing quote; whatever follows is a comment
      }
      s += c;
      j++;
    }
    return { value: s.replace(/ +$/, ''), isString: true };
  }

  // Anything else: the value ends at the comment separator.
  const slash = field.indexOf('/', i);
  const raw = (slash < 0 ? field.slice(i) : field.slice(i, slash)).trim();
  if (raw === '') return { value: null, isString: false };
  if (raw === 'T') return { value: true, isString: false };
  if (raw === 'F') return { value: false, isString: false };
  if (NUMBER_RE.test(raw)) {
    // Fortran double-precision exponents (1.0D-3) are legal in FITS.
    return { value: Number(raw.replace(/[Dd]/, 'E')), isString: false };
  }
  return { value: raw, isString: false }; // complex numbers and oddities stay as text
}

/**
 * Parse one HDU header starting at `offset`.
 *
 * @param {Uint8Array} u8
 * @param {number} [offset=0]
 * @returns {{ cards: Map<string, string|number|boolean|null>, headerBytes: number,
 *             dataBytes: number, paddedDataBytes: number } | null}
 *   null means "need more bytes": the buffer ends before the END card. `headerBytes` is the
 *   padded header length (multiple of 2880). Throws if the bytes at `offset` are not a FITS
 *   header at all (first keyword neither SIMPLE nor XTENSION).
 */
export function parseHeaderBlock(u8, offset = 0) {
  u8 = toBytes(u8);
  const n = u8.length;
  if (offset + 8 > n) return null;
  if (!startsHdu(u8, offset)) throw notFitsError(u8, offset);

  const cards = new Map();
  let pos = offset;
  let lastStringKey = null; // for the CONTINUE long-string convention
  for (;;) {
    if (pos + CARD > n) return null;
    const key = ascii(u8, pos, pos + 8).trimEnd();
    if (key === 'END') {
      pos += CARD;
      break;
    }
    const hasValue = u8[pos + 8] === 0x3d && u8[pos + 9] === 0x20; // "= " in columns 9-10
    if (hasValue && key !== '' && key !== 'COMMENT' && key !== 'HISTORY') {
      const { value, isString } = parseValue(ascii(u8, pos + 10, pos + CARD));
      // Keywords are unique in a valid header; if one repeats, the first occurrence wins.
      if (!cards.has(key)) {
        cards.set(key, value);
        lastStringKey = isString ? key : null;
      } else {
        lastStringKey = null;
      }
    } else if (key === 'CONTINUE' && lastStringKey !== null) {
      // Long strings: the previous value ends with '&' and continues in this card.
      const prev = cards.get(lastStringKey);
      const { value, isString } = parseValue(ascii(u8, pos + 8, pos + CARD));
      if (isString && typeof prev === 'string' && prev.endsWith('&')) {
        cards.set(lastStringKey, prev.slice(0, -1) + value);
      } else {
        lastStringKey = null;
      }
    } else {
      lastStringKey = null; // COMMENT, HISTORY, blank, HIERARCH: ignored
    }
    pos += CARD;
  }

  const headerBytes = Math.ceil((pos - offset) / FITS_BLOCK) * FITS_BLOCK;

  // Data size (FITS 4.0 eq. 2): |BITPIX|/8 * GCOUNT * (PCOUNT + NAXIS1 * ... * NAXISn).
  // NAXIS = 0 means no data at all (the product over zero axes is taken as 0, not 1).
  const bitpix = cards.get('BITPIX');
  const naxis = cards.get('NAXIS');
  if (typeof bitpix !== 'number' || typeof naxis !== 'number') {
    throw new Error(`FITS header at offset ${offset} has no BITPIX/NAXIS`);
  }
  let dataBytes = 0;
  if (naxis > 0) {
    let product = 1;
    // Random-groups primaries have NAXIS1 = 0 and GROUPS = T; NAXIS1 is then skipped.
    const first = cards.get('GROUPS') === true && cards.get('NAXIS1') === 0 ? 2 : 1;
    for (let i = first; i <= naxis; i++) {
      const len = cards.get(`NAXIS${i}`);
      if (typeof len !== 'number') throw new Error(`FITS header at offset ${offset} has no NAXIS${i}`);
      product *= len;
    }
    const pcount = typeof cards.get('PCOUNT') === 'number' ? cards.get('PCOUNT') : 0;
    const gcount = typeof cards.get('GCOUNT') === 'number' ? cards.get('GCOUNT') : 1;
    dataBytes = (Math.abs(bitpix) / 8) * gcount * (pcount + product);
  }
  const paddedDataBytes = Math.ceil(dataBytes / FITS_BLOCK) * FITS_BLOCK;
  return { cards, headerBytes, dataBytes, paddedDataBytes };
}

function hduName(cards, index) {
  const extname = cards.get('EXTNAME');
  if (typeof extname === 'string' && extname.trim() !== '') return extname.trim();
  return index === 0 ? 'PRIMARY' : '';
}

/**
 * List the HDUs of a (possibly truncated) multi-extension FITS file.
 *
 * @param {Uint8Array|ArrayBuffer} u8
 * @returns {Array<{ index: number, name: string, type: string, header: Map, headerOffset: number,
 *                   headerBytes: number, dataOffset: number, dataBytes: number,
 *                   paddedDataBytes: number }>}
 *   `name` is EXTNAME ('PRIMARY' for HDU 0). `type` is 'PRIMARY', 'IMAGE', 'BINTABLE', ...
 *   A buffer cut after some HDU (as returned by readUntilPsf) simply yields fewer HDUs; an HDU
 *   whose data are cut short is still listed and readImage reports the truncation.
 */
export function parseMef(u8) {
  u8 = toBytes(u8);
  const hdus = [];
  let offset = 0;
  while (offset + 8 <= u8.length) {
    // After the last HDU a file may hold padding or special records: stop quietly there.
    if (offset > 0 && !startsHdu(u8, offset)) break;
    const parsed = parseHeaderBlock(u8, offset);
    if (parsed === null) break; // header cut short
    const index = hdus.length;
    const xtension = parsed.cards.get('XTENSION');
    hdus.push({
      index,
      name: hduName(parsed.cards, index),
      type: index === 0 ? 'PRIMARY' : String(xtension ?? '').trim(),
      header: parsed.cards,
      headerOffset: offset,
      headerBytes: parsed.headerBytes,
      dataOffset: offset + parsed.headerBytes,
      dataBytes: parsed.dataBytes,
      paddedDataBytes: parsed.paddedDataBytes,
    });
    offset += parsed.headerBytes + parsed.paddedDataBytes;
  }
  if (hdus.length === 0) {
    if (u8.length >= 8) throw new Error('FITS file is truncated inside its primary header');
    throw new Error(`Not a FITS file: only ${u8.length} bytes`);
  }
  return hdus;
}

/** Find an HDU by EXTNAME (case-insensitive). Returns undefined when absent. */
export function findHdu(hdus, name) {
  const want = name.toUpperCase();
  return hdus.find((h) => h.name.toUpperCase() === want);
}

function dataView(u8, hdu) {
  if (hdu.dataOffset + hdu.dataBytes > u8.length) {
    throw new Error(
      `FITS HDU ${hdu.name || hdu.index}: data truncated (need ${hdu.dataOffset + hdu.dataBytes} bytes, have ${u8.length})`,
    );
  }
  return new DataView(u8.buffer, u8.byteOffset + hdu.dataOffset, hdu.dataBytes);
}

/**
 * Read the data of an image HDU into a native typed array (row-major, index = y * NAXIS1 + x).
 *
 * BITPIX -32 -> Float32Array, 32 -> Int32Array, 16 -> Int16Array, 8 -> Uint8Array,
 * -64 and 64 -> Float64Array. When BSCALE/BZERO are present and not the identity, the physical
 * value BZERO + BSCALE * stored is returned as floating point (Float32Array for 8/16/-32 bit
 * data, Float64Array otherwise so that unsigned 32-bit data stay exact) and integer pixels equal
 * to BLANK become NaN.
 *
 * @param {Uint8Array|ArrayBuffer} u8  the whole file (or its leading part)
 * @param {object} hdu                 an entry from parseMef
 */
export function readImage(u8, hdu) {
  u8 = toBytes(u8);
  const h = hdu.header;
  if (hdu.type !== 'PRIMARY' && hdu.type !== 'IMAGE') {
    throw new Error(`FITS HDU ${hdu.name || hdu.index} is a ${hdu.type}, not an image`);
  }
  const bitpix = h.get('BITPIX');
  const dv = dataView(u8, hdu);
  const count = hdu.dataBytes / (Math.abs(bitpix) / 8);

  const bscale = typeof h.get('BSCALE') === 'number' ? h.get('BSCALE') : 1;
  const bzero = typeof h.get('BZERO') === 'number' ? h.get('BZERO') : 0;
  const scaled = bscale !== 1 || bzero !== 0;
  const blank = typeof h.get('BLANK') === 'number' ? h.get('BLANK') : null;
  // DataView getters with littleEndian = false: FITS is always big-endian.
  const scale = (out, get, step, isInt) => {
    for (let i = 0; i < count; i++) {
      const raw = get(i * step);
      out[i] = isInt && blank !== null && raw === blank ? NaN : bzero + bscale * raw;
    }
    return out;
  };
  const copy = (out, get, step) => {
    for (let i = 0; i < count; i++) out[i] = get(i * step);
    return out;
  };

  switch (bitpix) {
    case -32: {
      const get = (o) => dv.getFloat32(o, false);
      return scaled ? scale(new Float32Array(count), get, 4, false) : copy(new Float32Array(count), get, 4);
    }
    case 32: {
      const get = (o) => dv.getInt32(o, false);
      return scaled ? scale(new Float64Array(count), get, 4, true) : copy(new Int32Array(count), get, 4);
    }
    case 16: {
      const get = (o) => dv.getInt16(o, false);
      return scaled ? scale(new Float32Array(count), get, 2, true) : copy(new Int16Array(count), get, 2);
    }
    case -64: {
      const get = (o) => dv.getFloat64(o, false);
      return scaled ? scale(new Float64Array(count), get, 8, false) : copy(new Float64Array(count), get, 8);
    }
    case 8: {
      const get = (o) => dv.getUint8(o);
      return scaled ? scale(new Float32Array(count), get, 1, true) : copy(new Uint8Array(count), get, 1);
    }
    case 64: {
      // No native 64-bit integer array is useful downstream; values above 2^53 lose precision.
      const get = (o) => Number(dv.getBigInt64(o, false));
      return scaled ? scale(new Float64Array(count), get, 8, true) : copy(new Float64Array(count), get, 8);
    }
    default:
      throw new Error(`FITS HDU ${hdu.name || hdu.index}: unsupported BITPIX ${bitpix}`);
  }
}

// Bytes per element of each binary-table TFORM type code (FITS 4.0, table 18).
const TFORM_BYTES = { L: 1, B: 1, I: 2, J: 4, K: 8, A: 1, E: 4, D: 8, C: 8, M: 16, P: 8, Q: 16 };
const TFORM_RE = /^(\d*)([LXBIJKAEDCMPQ])/;

/**
 * Describe the columns of a BINTABLE from TFIELDS / TTYPEn / TFORMn / TDIMn.
 * `offset` is the byte offset of the column inside a row; `dim` is TDIMn as an array or null.
 */
export function tableColumns(header) {
  const tfields = header.get('TFIELDS');
  if (typeof tfields !== 'number') throw new Error('FITS table header has no TFIELDS');
  const cols = [];
  let offset = 0;
  for (let i = 1; i <= tfields; i++) {
    const form = String(header.get(`TFORM${i}`) ?? '').trim();
    const m = TFORM_RE.exec(form);
    if (!m) throw new Error(`FITS table: cannot parse TFORM${i} = '${form}'`);
    const repeat = m[1] === '' ? 1 : Number(m[1]);
    const type = m[2];
    // X is a bit array (repeat bits, rounded up to bytes); P/Q descriptors ignore the repeat.
    const bytes =
      type === 'X' ? Math.ceil(repeat / 8) : type === 'P' || type === 'Q' ? TFORM_BYTES[type] : repeat * TFORM_BYTES[type];
    const tdim = header.get(`TDIM${i}`);
    let dim = null;
    if (typeof tdim === 'string') {
      const parts = tdim.replace(/[()\s]/g, '').split(',').map(Number);
      if (parts.length > 0 && parts.every((v) => Number.isInteger(v) && v > 0)) dim = parts;
    }
    cols.push({ index: i, name: String(header.get(`TTYPE${i}`) ?? '').trim(), type, repeat, offset, bytes, dim });
    offset += bytes;
  }
  const rowBytes = header.get('NAXIS1');
  if (offset !== rowBytes) {
    throw new Error(`FITS table: TFORM columns add up to ${offset} bytes but NAXIS1 = ${rowBytes}`);
  }
  return cols;
}

/** Read the `repeat` numeric elements of one column of one row into a plain array. */
function readNumericCell(dv, rowOffset, col) {
  const out = new Array(col.repeat);
  const base = rowOffset + col.offset;
  for (let i = 0; i < col.repeat; i++) {
    switch (col.type) {
      case 'J': out[i] = dv.getInt32(base + 4 * i, false); break;
      case 'E': out[i] = dv.getFloat32(base + 4 * i, false); break;
      case 'D': out[i] = dv.getFloat64(base + 8 * i, false); break;
      case 'I': out[i] = dv.getInt16(base + 2 * i, false); break;
      case 'B': out[i] = dv.getUint8(base + i); break;
      case 'K': out[i] = Number(dv.getBigInt64(base + 8 * i, false)); break;
      default:
        throw new Error(`FITS table: column ${col.name} has non-numeric type ${col.type}`);
    }
  }
  return out;
}

/**
 * Read the SPHEREx WCS-WAVE lookup table (FITS "-TAB" coordinate table, one row):
 *   X      index vector along detector x (real files: 11 int32, 1..2040)
 *   Y      index vector along detector y
 *   VALUES coordinate array, TDIM = (nk, nx, ny): values[k + nk * (ix + nx * iy)],
 *          k = 0 wavelength (um), k = 1 bandwidth (um)
 * Sizes come from TFORMn / TDIMn, nothing is hard-coded.
 *
 * @returns {{ x: Int32Array, y: Int32Array, values: Float32Array, nx: number, ny: number, nk: number }}
 */
export function readWaveTable(u8, hdu) {
  u8 = toBytes(u8);
  const h = hdu.header;
  if (String(h.get('XTENSION') ?? '').trim() !== 'BINTABLE') {
    throw new Error(`FITS HDU ${hdu.name || hdu.index} is not a binary table`);
  }
  if (!(h.get('NAXIS2') >= 1)) throw new Error(`FITS table ${hdu.name}: no rows`);
  const cols = tableColumns(h);
  const find = (name) => {
    const col = cols.find((c) => c.name.toUpperCase() === name);
    if (!col) throw new Error(`FITS table ${hdu.name}: no column ${name} (has ${cols.map((c) => c.name).join(', ')})`);
    return col;
  };
  const colX = find('X');
  const colY = find('Y');
  const colV = find('VALUES');
  const dv = dataView(u8, hdu);

  const x = Int32Array.from(readNumericCell(dv, 0, colX), Math.round);
  const y = Int32Array.from(readNumericCell(dv, 0, colY), Math.round);
  const values = Float32Array.from(readNumericCell(dv, 0, colV));
  const nx = x.length;
  const ny = y.length;

  let nk;
  if (colV.dim) {
    // TDIM lists axes fastest-first: (nk, nx, ny).
    if (colV.dim.length !== 3 || colV.dim[1] !== nx || colV.dim[2] !== ny) {
      throw new Error(`FITS table ${hdu.name}: TDIM (${colV.dim.join(',')}) does not match X (${nx}) and Y (${ny})`);
    }
    nk = colV.dim[0];
  } else {
    nk = values.length / (nx * ny);
  }
  if (!Number.isInteger(nk) || nk < 1 || nk * nx * ny !== values.length) {
    throw new Error(`FITS table ${hdu.name}: VALUES has ${values.length} elements for a ${nx} x ${ny} grid`);
  }
  return { x, y, values, nx, ny, nk };
}

/** Wrap a ReadableStream (or any async iterable of chunks) as { read, cancel }. */
function chunkSource(stream) {
  if (stream && typeof stream.getReader === 'function') {
    const reader = stream.getReader();
    return {
      read: () => reader.read(),
      cancel: async () => {
        try { await reader.cancel(); } catch { /* already closed or errored */ }
        try { reader.releaseLock(); } catch { /* ignore */ }
      },
    };
  }
  if (stream && typeof stream[Symbol.asyncIterator] === 'function') {
    const it = stream[Symbol.asyncIterator]();
    return {
      read: () => it.next(),
      cancel: async () => {
        try { if (it.return) await it.return(); } catch { /* ignore */ }
      },
    };
  }
  throw new TypeError('readUntilPsf: expected a ReadableStream of Uint8Array chunks');
}

/**
 * Read a SPHEREx cutout stream only as far as needed.
 *
 * The 3.9 MB EPSF table sits between the four small image HDUs and the wavelength table, and
 * IRSA has no Range support, so the only way to skip it is to stop reading. Headers are parsed
 * as bytes arrive, at whatever positions the chunks happen to split them. Reading stops, and
 * the stream is cancelled, at the first of:
 *   - the end of the ZODI HDU's padded data (known as soon as the ZODI header is parsed), so
 *     nothing of the HDU that follows ZODI is needed, whatever it is called;
 *   - the header of an EPSF extension, should one ever appear before ZODI.
 * The result is the bytes before that point: exactly "primary + IMAGE + FLAGS + VARIANCE +
 * ZODI" for a real file. If the stream ends first, everything read is returned.
 *
 * @param {ReadableStream<Uint8Array>} stream  (an async iterable of chunks works too)
 * @param {{ maxBytes?: number }} [options]
 * @returns {Promise<Uint8Array>} a fresh, exactly sized Uint8Array
 * @throws if the content is not FITS (for example an HTML error page) or is empty.
 */
export async function readUntilPsf(stream, { maxBytes = DEFAULT_MAX_BYTES } = {}) {
  const source = chunkSource(stream);
  let buf = new Uint8Array(1 << 18);
  let len = 0;
  let next = 0; // offset of the next HDU header that has not been parsed yet
  let wantLen = FITS_BLOCK; // do not try to parse that header before this many bytes are in
  let stopAt = -1; // end of the ZODI HDU's padded data, once its header has been parsed
  let parsing = true; // false once bytes that are not an HDU header follow some HDU
  let checkedMagic = false;
  let cut = -1;

  try {
    while (cut < 0) {
      const { done, value } = await source.read();
      if (done) break;
      if (!value) continue;
      const chunk = toBytes(value);
      if (chunk.length === 0) continue;
      if (len + chunk.length > maxBytes) {
        throw new Error(`FITS stream exceeds ${maxBytes} bytes before the EPSF extension`);
      }
      if (len + chunk.length > buf.length) {
        const grown = new Uint8Array(Math.max(buf.length * 2, len + chunk.length));
        grown.set(buf.subarray(0, len));
        buf = grown;
      }
      buf.set(chunk, len);
      len += chunk.length;

      const have = buf.subarray(0, len);
      // Fail fast on an HTML or JSON error page: eight bytes are enough to tell.
      if (!checkedMagic && len >= 8) {
        if (!startsHdu(have, 0)) throw notFitsError(have, 0);
        checkedMagic = true;
      }

      // Parse every header that is now complete. A header occupies whole 2880-byte blocks, so
      // a parse is attempted only when another full block of it has arrived (not once per
      // chunk). `next` may point beyond `len` while the data of the current HDU are still
      // arriving; nothing happens until the stream gets there.
      while (parsing && cut < 0 && stopAt < 0 && len >= wantLen) {
        if (next > 0 && !startsHdu(have, next)) {
          parsing = false; // trailing non-HDU records: just read to the end
          break;
        }
        const parsed = parseHeaderBlock(have, next);
        if (parsed === null) {
          // END not reached yet: wait for the next block of this header.
          wantLen = next + (Math.floor((len - next) / FITS_BLOCK) + 1) * FITS_BLOCK;
          break;
        }
        const name = hduName(parsed.cards, next === 0 ? 0 : 1).toUpperCase();
        if (name === 'EPSF') {
          cut = next; // the big table starts here: stop before it
        } else {
          next += parsed.headerBytes + parsed.paddedDataBytes;
          wantLen = next + FITS_BLOCK;
          if (name === 'ZODI') stopAt = next; // ZODI is the last HDU we need
        }
      }
      if (stopAt >= 0 && len >= stopAt) cut = stopAt;
    }
  } catch (err) {
    await source.cancel();
    throw err;
  }

  await source.cancel();
  if (cut >= 0) return buf.slice(0, cut);

  // The stream ended before the stop point: return what there is, if it is FITS at all.
  if (len === 0) throw new Error('Not a FITS file: empty response');
  if (len < 8 || !startsHdu(buf, 0)) throw notFitsError(buf.subarray(0, len), 0);
  return buf.slice(0, len);
}
