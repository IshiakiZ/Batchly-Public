// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

import test from 'node:test';
import assert from 'node:assert/strict';

import { parseHeaderBlock, parseMef, findHdu, readImage, readWaveTable, readUntilPsf, tableColumns } from './fits.js';
import { makeSyntheticMef, detectorWaveTable } from '../fixtures/synth.js';

// --- a tiny, independent FITS writer (raw card text, so the reader is not tested against the
// --- fixture writer alone) ------------------------------------------------------------------

const BLOCK = 2880;

/** Raw 80-character cards -> header bytes with END and space padding. */
function header(cards) {
  const all = [...cards, 'END'];
  const out = new Uint8Array(Math.ceil((all.length * 80) / BLOCK) * BLOCK).fill(0x20);
  all.forEach((text, i) => {
    assert.ok(text.length <= 80, `card too long: ${text}`);
    for (let c = 0; c < text.length; c++) out[i * 80 + c] = text.charCodeAt(c);
  });
  return out;
}

/** Fill a zero-padded data block with a DataView writer. */
function data(byteLength, write) {
  const out = new Uint8Array(Math.ceil(byteLength / BLOCK) * BLOCK);
  write(new DataView(out.buffer));
  return out;
}

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

const kv = (key, value, comment = '') => `${key.padEnd(8)}= ${String(value).padStart(20)}${comment ? ` / ${comment}` : ''}`;

const PRIMARY = header([kv('SIMPLE', 'T'), kv('BITPIX', 8), kv('NAXIS', 0), kv('EXTEND', 'T'), "VERSION = '7.0.5   '"]);

/** ReadableStream over `bytes` that hands out chunks of the given sizes (cycled) and records use. */
function chunkedStream(bytes, sizes) {
  const stats = { pulled: 0, chunks: 0, cancelled: false };
  let pos = 0;
  let k = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (pos >= bytes.length) {
        controller.close();
        return;
      }
      const size = sizes[k++ % sizes.length];
      const chunk = bytes.slice(pos, pos + size);
      pos += chunk.length;
      stats.pulled = pos;
      stats.chunks++;
      controller.enqueue(chunk);
    },
    cancel() {
      stats.cancelled = true;
    },
  });
  return { stream, stats };
}

// --- parseHeaderBlock ------------------------------------------------------------------------

test('parseHeaderBlock parses strings, numbers, booleans and comments', () => {
  const u8 = header([
    kv('SIMPLE', 'T', 'conforms to FITS standard'),
    kv('BITPIX', -32, 'array data type'),
    kv('NAXIS', 2),
    kv('NAXIS1', 59),
    kv('NAXIS2', 41, 'rows / not columns'),
    "BUNIT   = 'MJy / sr'           / surface brightness, with a / in the comment",
    "OBSID   = '2026W25_2A_0279_1'  / observation identifier",
    "OBJECT  = 'Barnard''s Star'    / embedded quote",
    "QUOTED  = '''tis'' / odd'      / quotes at both ends and a slash inside",
    "PADDED  = '  lead  '           / leading blanks are significant",
    "EMPTY   = ''                   / empty string",
    'CRPIX1  =               -625.5 / [pix] reference pixel',
    'A_0_2   =   -2.32575728759E-09',
    'DEXP    =             1.5D+02 / Fortran double exponent',
    'LOWER   =               2.5e-3',
    'EXPIDN  =      202625201027912 / fifteen-digit integer',
    'PLUS    =                  +17',
    'DOT     =                   3.',
    'FLAGGED =                    F / a false logical',
    'NOVALUE =                      / undefined value',
    'FREE    = 42 /free format, comment hugging the value',
    'COMMENT = this is not a value',
    'COMMENT plain commentary',
    'HISTORY made by a test',
    '',
    "LONGSTR = 'first half, &'",
    "CONTINUE  'second half'       / continued string",
    'DUP     =                    1',
    'DUP     =                    2',
    'HIERARCH ESO DET CHIP = 3',
  ]);
  const parsed = parseHeaderBlock(u8, 0);
  assert.ok(parsed);
  const c = parsed.cards;
  assert.equal(c.get('SIMPLE'), true);
  assert.equal(c.get('BITPIX'), -32);
  assert.equal(c.get('NAXIS2'), 41);
  assert.equal(c.get('BUNIT'), 'MJy / sr');
  assert.equal(c.get('OBSID'), '2026W25_2A_0279_1');
  assert.equal(c.get('OBJECT'), "Barnard's Star");
  assert.equal(c.get('QUOTED'), "'tis' / odd");
  assert.equal(c.get('PADDED'), '  lead');
  assert.equal(c.get('EMPTY'), '');
  assert.equal(c.get('CRPIX1'), -625.5);
  assert.equal(c.get('A_0_2'), -2.32575728759e-9);
  assert.equal(c.get('DEXP'), 150);
  assert.equal(c.get('LOWER'), 0.0025);
  assert.equal(c.get('EXPIDN'), 202625201027912);
  assert.equal(c.get('PLUS'), 17);
  assert.equal(c.get('DOT'), 3);
  assert.equal(c.get('FLAGGED'), false);
  assert.equal(c.get('NOVALUE'), null);
  assert.equal(c.get('FREE'), 42);
  assert.equal(c.get('LONGSTR'), 'first half, second half');
  assert.equal(c.get('DUP'), 1, 'first occurrence wins');
  assert.ok(!c.has('COMMENT') && !c.has('HISTORY') && !c.has('HIERARCH') && !c.has('END'));

  assert.equal(parsed.headerBytes, 2880);
  assert.equal(parsed.dataBytes, 59 * 41 * 4);
  assert.equal(parsed.paddedDataBytes, 4 * 2880); // 9676 bytes -> 4 blocks
});

test('parseHeaderBlock sizes: empty primary, multi-block header, PCOUNT and GCOUNT', () => {
  assert.deepEqual(
    [parseHeaderBlock(PRIMARY, 0).headerBytes, parseHeaderBlock(PRIMARY, 0).dataBytes, parseHeaderBlock(PRIMARY, 0).paddedDataBytes],
    [2880, 0, 0],
  );

  // 36 cards + END do not fit in one block.
  const many = [kv('SIMPLE', 'T'), kv('BITPIX', 16), kv('NAXIS', 1), kv('NAXIS1', 1440)];
  for (let i = 0; i < 32; i++) many.push(kv(`KEY${i}`, i));
  const big = parseHeaderBlock(header(many), 0);
  assert.equal(big.headerBytes, 5760);
  assert.equal(big.dataBytes, 2880);
  assert.equal(big.paddedDataBytes, 2880);
  assert.equal(big.cards.get('KEY31'), 31);

  // |BITPIX|/8 * GCOUNT * (PCOUNT + NAXIS1 * NAXIS2)
  const table = parseHeaderBlock(
    header(["XTENSION= 'BINTABLE'", kv('BITPIX', 8), kv('NAXIS', 2), kv('NAXIS1', 8752), kv('NAXIS2', 441), kv('PCOUNT', 100), kv('GCOUNT', 2)]),
    0,
  );
  assert.equal(table.dataBytes, 2 * (100 + 8752 * 441));
  assert.equal(table.paddedDataBytes % 2880, 0);
  assert.ok(table.paddedDataBytes >= table.dataBytes && table.paddedDataBytes - table.dataBytes < 2880);

  // The real EPSF table: 8752 * 441 = 3,859,632 bytes -> 3,862,080 padded, as measured.
  const epsf = parseHeaderBlock(
    header(["XTENSION= 'BINTABLE'", kv('BITPIX', 8), kv('NAXIS', 2), kv('NAXIS1', 8752), kv('NAXIS2', 441), kv('PCOUNT', 0), kv('GCOUNT', 1)]),
    0,
  );
  assert.equal(epsf.paddedDataBytes, 3862080);
  // ... which leaves exactly two header blocks between the measured offsets 126720 and 3994560.
  assert.equal(3994560 - 126720 - epsf.paddedDataBytes, 2 * 2880);
});

test('parseHeaderBlock honours the offset and returns null until END is in the buffer', () => {
  const image = header(["XTENSION= 'IMAGE   '", kv('BITPIX', -32), kv('NAXIS', 2), kv('NAXIS1', 3), kv('NAXIS2', 2), "EXTNAME = 'IMAGE   '"]);
  const file = concat(PRIMARY, image);
  const parsed = parseHeaderBlock(file, 2880);
  assert.equal(parsed.cards.get('EXTNAME'), 'IMAGE');
  assert.equal(parsed.dataBytes, 24);

  // END is the 7th card of the extension: it is complete at byte 2880 + 7 * 80.
  const endComplete = 2880 + 7 * 80;
  for (const cut of [2880, 2881, 2887, 2888, 2960, endComplete - 80, endComplete - 1]) {
    assert.equal(parseHeaderBlock(file.subarray(0, cut), 2880), null, `cut at ${cut}`);
  }
  assert.ok(parseHeaderBlock(file.subarray(0, endComplete), 2880), 'complete as soon as END has arrived');
  // Works on a view with a non-zero byteOffset too.
  const shifted = new Uint8Array(file.length + 3);
  shifted.set(file, 3);
  assert.equal(parseHeaderBlock(shifted.subarray(3), 2880).cards.get('NAXIS1'), 3);
});

test('parseHeaderBlock and parseMef reject content that is not FITS', () => {
  const html = new TextEncoder().encode('<!DOCTYPE html><html><body><h1>502 Bad Gateway</h1></body></html>');
  assert.throws(() => parseHeaderBlock(html, 0), /Not a FITS file.*DOCTYPE/);
  assert.throws(() => parseMef(html), /Not a FITS file/);
  assert.throws(() => parseMef(new Uint8Array(3)), /Not a FITS file/);
  assert.throws(() => parseMef(PRIMARY.subarray(0, 200)), /truncated/);
});

// --- parseMef / readImage --------------------------------------------------------------------

test('parseMef and readImage convert big-endian data of every supported BITPIX', () => {
  const f32 = [1.5, -2.25, NaN, 3.4028234663852886e38, 0, 51.6];
  const i32 = [0, 1, -1, 2097152, -2147483648, 2147483647];
  const i16 = [-32768, 0, 32767, 100];
  const f64 = [Math.PI, -1e-300];
  const file = concat(
    PRIMARY,
    header(["XTENSION= 'IMAGE   '", kv('BITPIX', -32), kv('NAXIS', 2), kv('NAXIS1', 3), kv('NAXIS2', 2), kv('PCOUNT', 0), kv('GCOUNT', 1), "EXTNAME = 'IMAGE   '"]),
    data(24, (dv) => f32.forEach((v, i) => dv.setFloat32(i * 4, v, false))),
    header(["XTENSION= 'IMAGE   '", kv('BITPIX', 32), kv('NAXIS', 2), kv('NAXIS1', 3), kv('NAXIS2', 2), "EXTNAME = 'FLAGS   '"]),
    data(24, (dv) => i32.forEach((v, i) => dv.setInt32(i * 4, v, false))),
    header(["XTENSION= 'IMAGE   '", kv('BITPIX', 16), kv('NAXIS', 1), kv('NAXIS1', 4), "EXTNAME = 'RAW16   '"]),
    data(8, (dv) => i16.forEach((v, i) => dv.setInt16(i * 2, v, false))),
    header(["XTENSION= 'IMAGE   '", kv('BITPIX', 16), kv('NAXIS', 1), kv('NAXIS1', 4), kv('BSCALE', '1.0'), kv('BZERO', '32768.0'), kv('BLANK', 100), "EXTNAME = 'UINT16  '"]),
    data(8, (dv) => i16.forEach((v, i) => dv.setInt16(i * 2, v, false))),
    header(["XTENSION= 'IMAGE   '", kv('BITPIX', -64), kv('NAXIS', 1), kv('NAXIS1', 2), "EXTNAME = 'DOUBLE  '"]),
    data(16, (dv) => f64.forEach((v, i) => dv.setFloat64(i * 8, v, false))),
    header(["XTENSION= 'IMAGE   '", kv('BITPIX', -32), kv('NAXIS', 1), kv('NAXIS1', 2), kv('BSCALE', '2.0'), kv('BZERO', '-1.0'), "EXTNAME = 'SCALED  '"]),
    data(8, (dv) => [1.5, 4].forEach((v, i) => dv.setFloat32(i * 4, v, false))),
    header(["XTENSION= 'IMAGE   '", kv('BITPIX', -32), kv('NAXIS', 1), kv('NAXIS1', 2), kv('BSCALE', '1.0'), kv('BZERO', '0.0'), "EXTNAME = 'TRIVIAL '"]),
    data(8, (dv) => [1.5, 4].forEach((v, i) => dv.setFloat32(i * 4, v, false))),
  );

  const hdus = parseMef(file);
  assert.deepEqual(hdus.map((h) => h.name), ['PRIMARY', 'IMAGE', 'FLAGS', 'RAW16', 'UINT16', 'DOUBLE', 'SCALED', 'TRIVIAL']);
  assert.deepEqual(hdus.map((h) => h.dataOffset), [2880, 5760, 11520, 17280, 23040, 28800, 34560, 40320]);
  assert.equal(hdus[0].dataBytes, 0);
  assert.equal(hdus[1].dataBytes, 24);
  assert.equal(hdus[1].header.get('NAXIS1'), 3);
  assert.equal(hdus[0].header.get('VERSION'), '7.0.5');

  const image = readImage(file, hdus[1]);
  assert.ok(image instanceof Float32Array);
  assert.deepEqual(Array.from(image), Array.from(new Float32Array(f32)));

  const flags = readImage(file, findHdu(hdus, 'flags'));
  assert.ok(flags instanceof Int32Array);
  assert.deepEqual(Array.from(flags), i32);

  const raw16 = readImage(file, findHdu(hdus, 'RAW16'));
  assert.ok(raw16 instanceof Int16Array);
  assert.deepEqual(Array.from(raw16), i16);

  // Unsigned 16-bit convention: physical = 32768 + stored; BLANK becomes NaN.
  const uint16 = readImage(file, findHdu(hdus, 'UINT16'));
  assert.ok(uint16 instanceof Float32Array);
  assert.deepEqual(Array.from(uint16), [0, 32768, 65535, NaN]);

  const dbl = readImage(file, findHdu(hdus, 'DOUBLE'));
  assert.ok(dbl instanceof Float64Array);
  assert.deepEqual(Array.from(dbl), f64);

  assert.deepEqual(Array.from(readImage(file, findHdu(hdus, 'SCALED'))), [2, 7]);
  const trivial = readImage(file, findHdu(hdus, 'TRIVIAL'));
  assert.ok(trivial instanceof Float32Array);
  assert.deepEqual(Array.from(trivial), [1.5, 4]);

  // ArrayBuffer input and a view with a byte offset behave the same.
  assert.deepEqual(Array.from(readImage(file.buffer, parseMef(file.buffer)[2])), i32);
  const shifted = new Uint8Array(file.length + 5);
  shifted.set(file, 5);
  assert.deepEqual(Array.from(readImage(shifted.subarray(5), parseMef(shifted.subarray(5))[2])), i32);

  // A file cut inside the data of an HDU still lists it, and readImage says what is wrong.
  const cut = file.subarray(0, hdus[2].dataOffset + 10);
  const cutHdus = parseMef(cut);
  assert.equal(cutHdus.length, 3);
  assert.throws(() => readImage(cut, cutHdus[2]), /truncated/);
  // A file cut inside a header lists the HDUs before it.
  assert.equal(parseMef(file.subarray(0, hdus[2].headerOffset + 100)).length, 2);
});

test('a synthetic SPHEREx MEF round-trips through parseMef and readImage', () => {
  const sources = [{ ra: 210.80227, dec: 54.34895, fluxUJy: 20000 }];
  const mef = makeSyntheticMef({ ra: 210.80227, dec: 54.34895, size: 0.1, det: 2, mjd: 61210.79244684, rollDeg: 223.7, sources, seed: 7 });
  assert.equal(mef.length % 2880, 0);

  const hdus = parseMef(mef);
  assert.deepEqual(hdus.map((h) => h.name), ['PRIMARY', 'IMAGE', 'FLAGS', 'VARIANCE', 'ZODI', 'EPSF', 'WCS-WAVE']);
  assert.deepEqual(hdus.map((h) => h.type), ['PRIMARY', 'IMAGE', 'IMAGE', 'IMAGE', 'IMAGE', 'BINTABLE', 'BINTABLE']);
  // HDUs are contiguous, block aligned, and account for every byte.
  let expected = 0;
  for (const h of hdus) {
    assert.equal(h.headerOffset, expected);
    assert.equal(h.headerOffset % 2880, 0);
    assert.equal(h.dataOffset % 2880, 0);
    expected = h.dataOffset + h.paddedDataBytes;
  }
  assert.equal(expected, mef.length);

  assert.equal(hdus[0].dataBytes, 0);
  assert.equal(hdus[0].header.get('VERSION'), '7.0.5');
  assert.equal(hdus[0].header.get('NAXIS'), 0);
  const [image, flags, variance, zodi] = [1, 2, 3, 4].map((i) => readImage(mef, hdus[i]));
  for (const h of hdus.slice(1, 5)) {
    assert.equal(h.header.get('NAXIS1'), 59);
    assert.equal(h.header.get('NAXIS2'), 59);
    assert.equal(h.dataBytes, 59 * 59 * 4);
  }
  assert.deepEqual([1, 2, 3, 4].map((i) => hdus[i].header.get('BITPIX')), [-32, 32, -32, -32]);
  assert.equal(hdus[1].header.get('BUNIT'), 'MJy / sr');
  assert.equal(hdus[3].header.get('BUNIT'), 'MJy2 / sr2');
  assert.ok(image instanceof Float32Array && variance instanceof Float32Array && zodi instanceof Float32Array);
  assert.ok(flags instanceof Int32Array);
  assert.equal(image.length, 3481);

  // The EPSF table sits between ZODI and WCS-WAVE and dominates the file, like the real one.
  assert.ok(hdus[5].dataBytes > 150000);
  assert.ok(hdus[5].headerOffset === hdus[4].dataOffset + hdus[4].paddedDataBytes);
  assert.ok(hdus[6].headerOffset > hdus[5].dataOffset);
  assert.equal(hdus[6].header.get('NAXIS1'), 1056);
  assert.equal(hdus[6].header.get('NAXIS2'), 1);
  assert.throws(() => readImage(mef, hdus[5]), /not an image/);

  // Sanity of the pixel values: zodi is smooth and positive, the source stands out, non-finite
  // pixels are flagged NONFUNC (bit 6).
  assert.ok(zodi.every((v) => v > 0.05 && v < 0.5));
  assert.ok(Math.max(...Array.from(image).filter(Number.isFinite)) > 5);
  image.forEach((v, i) => {
    if (!Number.isFinite(v)) assert.ok(flags[i] & (1 << 6), `non-finite pixel ${i} is not flagged`);
  });

  // The wavelength table read back from the bytes equals the table that was written.
  const table = readWaveTable(mef, hdus[6]);
  const truth = detectorWaveTable(2);
  assert.deepEqual(Array.from(table.x), Array.from(truth.x));
  assert.deepEqual(Array.from(table.y), Array.from(truth.y));
  assert.deepEqual(Array.from(table.values), Array.from(truth.values));
  assert.deepEqual([table.nx, table.ny, table.nk], [11, 11, 2]);
});

// --- readWaveTable ---------------------------------------------------------------------------

const REAL_NODES = [1, 205, 409, 613, 817, 1021, 1224, 1428, 1632, 1836, 2040];

function waveTableHdu({ x, y, values, tdim, valuesForm, extraColumn = false }) {
  const rowBytes = 4 * x.length + 4 * y.length + 4 * values.length + (extraColumn ? 10 : 0);
  const cards = ["XTENSION= 'BINTABLE'", kv('BITPIX', 8), kv('NAXIS', 2), kv('NAXIS1', rowBytes), kv('NAXIS2', 1), kv('PCOUNT', 0), kv('GCOUNT', 1)];
  const cols = [];
  if (extraColumn) cols.push(["'NOTE    '", "'10A     '"]);
  cols.push(["'X       '", `'${x.length}J'`], ["'Y       '", `'${y.length}J'`], ["'VALUES  '", `'${valuesForm ?? `${values.length}E`}'`]);
  cards.push(kv('TFIELDS', cols.length));
  cols.forEach(([name, form], i) => {
    cards.push(`TTYPE${i + 1}  = ${name}`, `TFORM${i + 1}  = ${form}`);
  });
  if (tdim) cards.push(`TDIM${cols.length}   = '${tdim}'`);
  cards.push("EXTNAME = 'WCS-WAVE'");
  const body = data(rowBytes, (dv) => {
    let o = extraColumn ? 10 : 0;
    for (const v of x) { dv.setInt32(o, v, false); o += 4; }
    for (const v of y) { dv.setInt32(o, v, false); o += 4; }
    for (const v of values) { dv.setFloat32(o, v, false); o += 4; }
  });
  return concat(header(cards), body);
}

test('readWaveTable reads the real WCS-WAVE layout (11J, 11J, 242E, TDIM (2,11,11))', () => {
  const values = new Float32Array(242);
  for (let k = 0; k < 242; k++) values[k] = 1 + k / 1000;
  values.set([1.6677, 0.03979, 1.66112]); // first entries of the real detector-2 table
  const file = concat(PRIMARY, waveTableHdu({ x: REAL_NODES, y: REAL_NODES, values, tdim: '(2,11,11)' }));
  const hdus = parseMef(file);
  const hdu = findHdu(hdus, 'WCS-WAVE');
  assert.equal(hdu.header.get('NAXIS1'), 1056); // 44 + 44 + 968, as in real files
  assert.equal(hdu.dataBytes, 1056);

  const cols = tableColumns(hdu.header);
  assert.deepEqual(cols.map((c) => [c.name, c.type, c.repeat, c.offset]), [['X', 'J', 11, 0], ['Y', 'J', 11, 44], ['VALUES', 'E', 242, 88]]);
  assert.deepEqual(cols[2].dim, [2, 11, 11]);

  const table = readWaveTable(file, hdu);
  assert.ok(table.x instanceof Int32Array && table.y instanceof Int32Array && table.values instanceof Float32Array);
  assert.deepEqual(Array.from(table.x), REAL_NODES);
  assert.deepEqual(Array.from(table.y), REAL_NODES);
  assert.deepEqual([table.nx, table.ny, table.nk], [11, 11, 2]);
  assert.equal(table.values.length, 242);
  assert.equal(table.values[0], Math.fround(1.6677));
  assert.equal(table.values[1], Math.fround(0.03979));
  assert.equal(table.values[2], Math.fround(1.66112));
  assert.deepEqual(Array.from(table.values), Array.from(values));
});

test('readWaveTable derives sizes from TFORM/TDIM instead of assuming 11 x 11', () => {
  const x = [1, 1021, 2040];
  const y = [1, 500, 1500, 2040];
  const values = Float32Array.from({ length: 24 }, (_, k) => k * 0.5);
  // An unrelated leading column shifts the byte offsets of X, Y and VALUES.
  const file = concat(PRIMARY, waveTableHdu({ x, y, values, tdim: '(2,3,4)', extraColumn: true }));
  const table = readWaveTable(file, parseMef(file)[1]);
  assert.deepEqual([table.nx, table.ny, table.nk], [3, 4, 2]);
  assert.deepEqual(Array.from(table.x), x);
  assert.deepEqual(Array.from(table.y), y);
  assert.deepEqual(Array.from(table.values), Array.from(values));

  // Without TDIM the number of planes follows from the repeat count.
  const noDim = concat(PRIMARY, waveTableHdu({ x, y, values }));
  assert.equal(readWaveTable(noDim, parseMef(noDim)[1]).nk, 2);

  // Inconsistent shapes are reported, not silently misread.
  const bad = concat(PRIMARY, waveTableHdu({ x, y, values, tdim: '(2,4,3)' }));
  assert.throws(() => readWaveTable(bad, parseMef(bad)[1]), /TDIM/);
  const image = concat(PRIMARY, header(["XTENSION= 'IMAGE   '", kv('BITPIX', 8), kv('NAXIS', 0)]));
  assert.throws(() => readWaveTable(image, parseMef(image)[1]), /not a binary table/);
});

// --- readUntilPsf ----------------------------------------------------------------------------

const SYNTH = makeSyntheticMef({ ra: 269.4521, dec: 4.6934, size: 0.1, det: 3, sources: [{ ra: 269.4521, dec: 4.6934, fluxUJy: 5000 }], seed: 3 });
const SYNTH_HDUS = parseMef(SYNTH);
const ZODI_END = SYNTH_HDUS[4].dataOffset + SYNTH_HDUS[4].paddedDataBytes;

test('readUntilPsf returns exactly the bytes through ZODI for awkward chunkings', async () => {
  assert.equal(ZODI_END, SYNTH_HDUS[5].headerOffset);
  const chunkings = [[7], [79], [80], [81], [1000], [2879], [2880], [2881], [4097], [65536], [SYNTH.length], [1, 2879, 3, 77, 2880, 5000, 13]];
  for (const sizes of chunkings) {
    const { stream, stats } = chunkedStream(SYNTH, sizes);
    const head = await readUntilPsf(stream);
    assert.equal(head.length, ZODI_END, `chunks of ${sizes}`);
    assert.deepEqual(head, SYNTH.subarray(0, ZODI_END), `chunks of ${sizes}`);
    assert.ok(stats.cancelled || stats.pulled === SYNTH.length, `stream not cancelled for chunks of ${sizes}`);
    if (sizes[0] <= 5000) {
      // Stopped at the end of ZODI: at most a few chunks of slack, nothing like the whole table.
      assert.ok(stats.cancelled, `stream not cancelled for chunks of ${sizes}`);
      assert.ok(stats.pulled <= ZODI_END + 3 * Math.max(...sizes), `read ${stats.pulled} bytes for chunks of ${sizes}`);
      assert.ok(stats.pulled < SYNTH.length - 150000);
    }
    // The result is a self-contained buffer that parses to the five leading HDUs.
    assert.equal(head.byteOffset, 0);
    assert.equal(head.buffer.byteLength, ZODI_END);
    assert.deepEqual(parseMef(head).map((h) => h.name), ['PRIMARY', 'IMAGE', 'FLAGS', 'VARIANCE', 'ZODI']);
  }
});

test('readUntilPsf survives one-byte chunks', async () => {
  // A small file keeps this quick: primary, IMAGE, ZODI, EPSF, WCS-WAVE.
  const img = (name) =>
    concat(
      header(["XTENSION= 'IMAGE   '", kv('BITPIX', -32), kv('NAXIS', 2), kv('NAXIS1', 2), kv('NAXIS2', 2), `EXTNAME = '${name.padEnd(8)}'`]),
      data(16, (dv) => [1, 2, 3, 4].forEach((v, i) => dv.setFloat32(i * 4, v, false))),
    );
  const epsf = concat(
    header(["XTENSION= 'BINTABLE'", kv('BITPIX', 8), kv('NAXIS', 2), kv('NAXIS1', 100), kv('NAXIS2', 200), kv('PCOUNT', 0), kv('GCOUNT', 1), kv('TFIELDS', 1), "TTYPE1  = 'PSF     '", "TFORM1  = '25E     '", "EXTNAME = 'EPSF    '"]),
    data(20000, () => {}),
  );
  const file = concat(PRIMARY, img('IMAGE'), img('ZODI'), epsf, waveTableHdu({ x: [1, 2040], y: [1, 2040], values: new Float32Array(8), tdim: '(2,2,2)' }));
  const end = 2880 + 2 * 5760;
  const { stream, stats } = chunkedStream(file, [1]);
  const head = await readUntilPsf(stream);
  assert.deepEqual(head, file.subarray(0, end));
  assert.ok(stats.cancelled);
  assert.ok(stats.pulled <= end + 2, `read ${stats.pulled} bytes`);
});

test('readUntilPsf stops at any HDU after ZODI and at EPSF wherever it is', async () => {
  const img = (name) =>
    concat(
      header(["XTENSION= 'IMAGE   '", kv('BITPIX', -32), kv('NAXIS', 2), kv('NAXIS1', 2), kv('NAXIS2', 2), `EXTNAME = '${name.padEnd(8)}'`]),
      data(16, () => {}),
    );
  // Something that is not called EPSF follows ZODI.
  const renamed = concat(PRIMARY, img('IMAGE'), img('ZODI'), img('PSFNEW'), img('EXTRA'));
  assert.equal((await readUntilPsf(chunkedStream(renamed, [100]).stream)).length, 2880 + 2 * 5760);
  // Garbage after ZODI is never looked at.
  const junk = concat(PRIMARY, img('IMAGE'), img('ZODI'), new Uint8Array(30000).fill(0x41));
  const junkRead = chunkedStream(junk, [100]);
  assert.equal((await readUntilPsf(junkRead.stream)).length, 2880 + 2 * 5760);
  assert.ok(junkRead.stats.cancelled && junkRead.stats.pulled < 2880 + 2 * 5760 + 500);
  // EPSF before ZODI: reading stops there (the 3.9 MB table can only be skipped by stopping).
  const early = concat(PRIMARY, img('IMAGE'), img('EPSF'), img('ZODI'));
  const earlyRead = chunkedStream(early, [100]);
  assert.equal((await readUntilPsf(earlyRead.stream)).length, 2880 + 5760);
  assert.ok(earlyRead.stats.cancelled);
  // Bytes that are not an HDU in the middle of a file: everything is returned for the caller to judge.
  const broken = concat(PRIMARY, img('IMAGE'), new Uint8Array(5000).fill(0x41));
  assert.deepEqual(await readUntilPsf(chunkedStream(broken, [100]).stream), broken);
});

test('readUntilPsf returns everything when the stream ends early', async () => {
  // No EPSF at all: the file ends after ZODI.
  const noPsf = SYNTH.subarray(0, ZODI_END);
  assert.deepEqual(await readUntilPsf(chunkedStream(noPsf, [3000]).stream), noPsf);
  // Cut in the middle of the VARIANCE data, in the middle of a header, and inside the primary.
  for (const cut of [SYNTH_HDUS[3].dataOffset + 1234, SYNTH_HDUS[2].headerOffset + 999, 500]) {
    const part = SYNTH.subarray(0, cut);
    const got = await readUntilPsf(chunkedStream(part, [777]).stream);
    assert.deepEqual(got, part, `cut at ${cut}`);
  }
  // Works with fetch-style bodies and with async iterables of chunks.
  assert.equal((await readUntilPsf(new Response(SYNTH).body)).length, ZODI_END);
  async function* chunks() {
    for (let i = 0; i < SYNTH.length; i += 5000) yield SYNTH.subarray(i, i + 5000);
  }
  assert.equal((await readUntilPsf(chunks())).length, ZODI_END);
});

test('readUntilPsf throws a clear error for content that is not FITS', async () => {
  const html = new TextEncoder().encode(`<html><head><title>503 Service Unavailable</title></head><body>${'x'.repeat(20000)}</body></html>`);
  const long = chunkedStream(html, [512]);
  await assert.rejects(readUntilPsf(long.stream), /Not a FITS file.*<html>/);
  assert.ok(long.stats.cancelled, 'stream should be cancelled');
  assert.ok(long.stats.pulled <= 2048, 'should fail on the first bytes, not after reading everything');

  const json = new TextEncoder().encode('{"error":"nope"}');
  await assert.rejects(readUntilPsf(chunkedStream(json, [4]).stream), /Not a FITS file.*error/);
  await assert.rejects(readUntilPsf(chunkedStream(new Uint8Array(0), [4]).stream), /empty/);
  await assert.rejects(readUntilPsf(chunkedStream(new TextEncoder().encode('SIM'), [4]).stream), /Not a FITS file/);
  await assert.rejects(readUntilPsf(chunkedStream(SYNTH, [4096]).stream, { maxBytes: 20000 }), /exceeds/);
  await assert.rejects(readUntilPsf(42), TypeError);
});
