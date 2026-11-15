// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildFrame, decodeFrame, headerToWcs, parseFrameId } from './encode.js';
import { parseMef, findHdu, readImage, readWaveTable, readUntilPsf } from './fits.js';
import { waveAt, waveMap } from './wavetab.js';
import { makeSyntheticMef } from '../fixtures/synth.js';

const REAL_ID =
  'ibe/data/spherex/qr3/level2/2026W25_2A/l2b-v27-2026-273/2/level2_2026W25_2A_0279_1D2_spx_l2b-v27-2026-273.fits';

const RA = 210.80227;
const DEC = 54.34895;
const MEF = makeSyntheticMef({
  ra: RA, dec: DEC, size: 0.1, det: 2, mjd: 61210.79244684, rollDeg: 223.7, seed: 11, obsid: '2026W25_2A_0279_1',
  sources: [
    { ra: RA, dec: DEC, fluxUJy: 30000 },
    { ra: RA + 0.02, dec: DEC - 0.015, spectrum: { fluxUJy: 4000, teff: 4000 } },
  ],
});
const HDUS = parseMef(MEF);
const TABLE = readWaveTable(MEF, findHdu(HDUS, 'WCS-WAVE'));
const HEAD = MEF.slice(0, HDUS[5].headerOffset); // what readUntilPsf returns: bytes through ZODI
const IMAGE_HEADER = HDUS[1].header;

/** Same bits, including NaN payloads. */
function assertSameBits(actual, expected, label) {
  assert.equal(actual.constructor, expected.constructor, `${label}: array type`);
  assert.equal(actual.length, expected.length, `${label}: length`);
  const a = new Uint8Array(actual.buffer, actual.byteOffset, actual.byteLength);
  const b = new Uint8Array(expected.buffer, expected.byteOffset, expected.byteLength);
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) assert.fail(`${label}: byte ${i} differs`);
  }
}

/** Overwrite a header card (found by its keyword) in a copy of the file. */
function patchCard(bytes, hduIndex, key, newCard) {
  const out = bytes.slice();
  const hdu = parseMef(bytes)[hduIndex];
  const dec = new TextDecoder();
  for (let pos = hdu.headerOffset; pos < hdu.dataOffset; pos += 80) {
    if (dec.decode(out.subarray(pos, pos + 8)).trimEnd() === key) {
      out.set(new TextEncoder().encode(newCard.padEnd(80)), pos);
      return out;
    }
  }
  throw new Error(`no ${key} card in HDU ${hduIndex}`);
}

test('buildFrame writes the TBF1 layout of the contract', async () => {
  // The same bytes whether they come from a slice or from the stream reader.
  assert.deepEqual(await readUntilPsf(new Response(MEF).body), HEAD);

  const tbf = buildFrame({ id: REAL_ID, u8: HEAD, waveTable: TABLE });
  assert.ok(tbf instanceof Uint8Array);
  assert.equal(new TextDecoder().decode(tbf.subarray(0, 4)), 'TBF1');
  const dv = new DataView(tbf.buffer, tbf.byteOffset, tbf.byteLength);
  const n = dv.getUint32(4, true);
  assert.equal((8 + n) % 8, 0, 'data start must be a multiple of 8');

  const text = new TextDecoder().decode(tbf.subarray(8, 8 + n));
  assert.match(text, /^\{.*\} *$/s, 'JSON padded with spaces only');
  const header = JSON.parse(text);

  assert.deepEqual(Object.keys(header), [
    'v', 'id', 'release', 'obsid', 'version', 'det', 'nx', 'ny', 'mjd', 'exptime', 'dateObs', 'bunit', 'psfFwhm',
    'wcs', 'detXY0', 'waveCenter', 'bwCenter', 'arrays',
  ]);
  assert.deepEqual(header.arrays.map((a) => [a.name, a.dtype, a.length]), [
    ['image', 'f4', 3481], ['variance', 'f4', 3481], ['zodi', 'f4', 3481], ['flags', 'i4', 3481], ['wave', 'f4', 3481],
  ]);
  // Arrays start right after the header, are contiguous, 4-byte aligned, and fill the file.
  let offset = 8 + n;
  for (const a of header.arrays) {
    assert.equal(a.offset, offset, `${a.name} offset`);
    assert.equal(a.offset % 4, 0);
    offset += a.length * 4;
  }
  assert.equal(tbf.length, offset);

  // Little-endian payload, read here with explicit DataView calls.
  const image = readImage(MEF, HDUS[1]);
  const flags = readImage(MEF, HDUS[2]);
  const imageOffset = header.arrays[0].offset;
  const flagsOffset = header.arrays[3].offset;
  for (const i of [0, 1, 58, 59, 1740, 3480]) {
    assert.ok(Object.is(dv.getFloat32(imageOffset + 4 * i, true), image[i]), `image[${i}]`);
    assert.equal(dv.getInt32(flagsOffset + 4 * i, true), flags[i], `flags[${i}]`);
  }
});

test('buildFrame fills every header field from the FITS headers', () => {
  const frame = decodeFrame(buildFrame({ id: REAL_ID, u8: HEAD, waveTable: TABLE }));
  assert.equal(frame.id, REAL_ID);
  assert.equal(frame.release, 'qr3');
  assert.equal(frame.obsid, '2026W25_2A_0279_1');
  assert.equal(frame.version, '7.0.5');
  assert.equal(frame.det, 2);
  assert.equal(frame.nx, 59);
  assert.equal(frame.ny, 59);
  assert.equal(frame.mjd, IMAGE_HEADER.get('MJD-AVG'));
  assert.ok(Math.abs(frame.mjd - 61210.79311303) < 2e-6, 'MJD-AVG, not MJD-OBS');
  assert.equal(frame.exptime, 113.5826);
  assert.equal(frame.dateObs, '2026-06-19T19:01:07.407');
  assert.equal(frame.bunit, 'MJy / sr');
  assert.equal(frame.psfFwhm, IMAGE_HEADER.get('PSF_FWHM'));
  assert.ok(Math.abs(frame.psfFwhm - 7.46) < 0.01);

  // WCS: straight from the header, CRPIX kept 1-based.
  const { wcs } = frame;
  assert.deepEqual(wcs.crpix, [IMAGE_HEADER.get('CRPIX1'), IMAGE_HEADER.get('CRPIX2')]);
  assert.deepEqual(wcs.crval, [IMAGE_HEADER.get('CRVAL1'), IMAGE_HEADER.get('CRVAL2')]);
  assert.deepEqual(wcs.pc, [
    [IMAGE_HEADER.get('PC1_1'), IMAGE_HEADER.get('PC1_2')],
    [IMAGE_HEADER.get('PC2_1'), IMAGE_HEADER.get('PC2_2')],
  ]);
  assert.deepEqual(wcs.cdelt, [1, 1]);
  assert.deepEqual([wcs.sip.aOrder, wcs.sip.bOrder, wcs.sip.apOrder, wcs.sip.bpOrder], [3, 3, 3, 3]);
  for (const [name, prefix] of [['a', 'A'], ['b', 'B'], ['ap', 'AP'], ['bp', 'BP']]) {
    const keys = Object.keys(wcs.sip[name]);
    assert.equal(keys.length, 10, `${prefix}: ten coefficients for order 3`);
    for (const key of keys) {
      assert.match(key, /^\d_\d$/);
      assert.equal(wcs.sip[name][key], IMAGE_HEADER.get(`${prefix}_${key}`), `${prefix}_${key}`);
    }
  }
  assert.equal(wcs.sip.a['0_0'], 0.0905846568112);
  assert.equal(wcs.sip.b['2_0'], 6.56833753216e-6);
  assert.ok(!('order' in wcs.sip.a) && !('ORDER' in wcs.sip.a));

  // Detector placement and wavelength.
  assert.deepEqual(frame.detXY0, [2 - IMAGE_HEADER.get('CRPIX1W'), 2 - IMAGE_HEADER.get('CRPIX2W')]);
  assert.deepEqual(frame.detXY0, [1021.5 - wcs.crpix[0], 1021.5 - wcs.crpix[1]], 'consistent with CRPIX');
  const centre = waveAt(TABLE, frame.detXY0[0] + 29, frame.detXY0[1] + 29);
  assert.equal(frame.waveCenter, centre.wave);
  assert.equal(frame.bwCenter, centre.bandwidth);
  assert.equal(Math.fround(frame.waveCenter), frame.wave[29 * 59 + 29], 'centre of the wave array');
  assert.ok(frame.waveCenter > 1.09 && frame.waveCenter < 1.67);
  assert.ok(Math.abs(frame.waveCenter / frame.bwCenter - 41.9) < 0.5);
  assert.ok(!('arrays' in frame));
});

test('decodeFrame is the exact inverse of buildFrame', () => {
  const tbf = buildFrame({ id: REAL_ID, u8: HEAD, waveTable: TABLE });
  const frame = decodeFrame(tbf);
  const expected = {
    image: readImage(MEF, findHdu(HDUS, 'IMAGE')),
    variance: readImage(MEF, findHdu(HDUS, 'VARIANCE')),
    zodi: readImage(MEF, findHdu(HDUS, 'ZODI')),
    flags: readImage(MEF, findHdu(HDUS, 'FLAGS')),
    wave: waveMap(TABLE, IMAGE_HEADER, 59, 59),
  };
  assert.ok(frame.image instanceof Float32Array && frame.variance instanceof Float32Array);
  assert.ok(frame.zodi instanceof Float32Array && frame.wave instanceof Float32Array);
  assert.ok(frame.flags instanceof Int32Array);
  for (const name of Object.keys(expected)) assertSameBits(frame[name], expected[name], name);

  // The synthetic frame has NaN pixels and flagged pixels; both survive.
  assert.ok(frame.image.some((v) => Number.isNaN(v)), 'fixture should contain a NaN pixel');
  assert.ok(frame.flags.some((v) => v & (1 << 21)), 'SOURCE bit');
  assert.ok(frame.flags.some((v) => v & ~(1 << 21)), 'some defect bit');

  // ArrayBuffer input.
  const fromBuffer = decodeFrame(tbf.buffer.slice(tbf.byteOffset, tbf.byteOffset + tbf.byteLength));
  assertSameBits(fromBuffer.image, expected.image, 'image from ArrayBuffer');
  assert.equal(fromBuffer.obsid, frame.obsid);

  // Misaligned input: the frame sits at odd offsets inside a larger buffer.
  for (const shift of [1, 2, 3, 5]) {
    const big = new Uint8Array(tbf.length + 16);
    big.set(tbf, shift);
    const shifted = decodeFrame(big.subarray(shift, shift + tbf.length));
    for (const name of Object.keys(expected)) {
      assertSameBits(shifted[name], expected[name], `${name} at shift ${shift}`);
      assert.equal(shifted[name].byteOffset % 4, 0, 'typed arrays must be aligned');
    }
    assert.deepEqual(shifted.wcs, frame.wcs);
  }

  // Building twice gives identical bytes.
  assert.deepEqual(buildFrame({ id: REAL_ID, u8: HEAD, waveTable: TABLE }), tbf);
});

test('buildFrame works for other sizes and for a complete file without a separate table', () => {
  for (const size of [0.02, 0.05, 0.2]) {
    const mef = makeSyntheticMef({ ra: RA, dec: DEC, size, det: 5, seed: 2, sources: [{ ra: RA, dec: DEC, fluxUJy: 9000 }] });
    const hdus = parseMef(mef);
    const n = hdus[1].header.get('NAXIS1');
    assert.equal(n, Math.round((size * 3600) / 6.15));
    // No waveTable argument: the WCS-WAVE extension of the complete file is used.
    const tbf = buildFrame({ id: 'x', u8: mef });
    const frame = decodeFrame(tbf);
    assert.deepEqual([frame.nx, frame.ny, frame.det], [n, n, 5]);
    assert.equal(frame.image.length, n * n);
    assert.equal(tbf.length % 4, 0);
    assertSameBits(frame.wave, waveMap(readWaveTable(mef, hdus[6]), hdus[1].header, n, n), 'wave');
    assert.ok(frame.waveCenter > 3.7 && frame.waveCenter < 4.6, 'detector 5 wavelengths');
    // An id that is not an IRSA uri: release unknown, obsid and det still come from the header.
    assert.equal(frame.release, null);
    assert.equal(frame.det, 5);
    assert.match(frame.obsid, /^2026W25_/);
  }
});

test('buildFrame fallbacks: MJD-OBS, no SIP, values from the id, CD matrix', () => {
  // Blank out MJD-AVG: mjd falls back to MJD-OBS.
  let bytes = patchCard(HEAD, 1, 'MJD-AVG', '');
  assert.equal(decodeFrame(buildFrame({ id: REAL_ID, u8: bytes, waveTable: TABLE })).mjd, IMAGE_HEADER.get('MJD-OBS'));

  // CTYPE without -SIP: sip is null even though coefficient cards are present.
  bytes = patchCard(HEAD, 1, 'CTYPE1', "CTYPE1  = 'RA---TAN'");
  bytes = patchCard(bytes, 1, 'CTYPE2', "CTYPE2  = 'DEC--TAN'");
  const plain = decodeFrame(buildFrame({ id: REAL_ID, u8: bytes, waveTable: TABLE }));
  assert.equal(plain.wcs.sip, null);
  assert.deepEqual(plain.wcs.crpix, [IMAGE_HEADER.get('CRPIX1'), IMAGE_HEADER.get('CRPIX2')]);

  // OBSID and DETECTOR missing from the header: taken from the uri.
  bytes = patchCard(HEAD, 1, 'OBSID', '');
  bytes = patchCard(bytes, 1, 'DETECTOR', '');
  const other = 'ibe/data/spherex/dr1/level2/2025W23_1B/l2b-v20-2025-200/4/level2_2025W23_1B_0101_3D4_spx_l2b-v20-2025-200.fits';
  const fromId = decodeFrame(buildFrame({ id: other, u8: bytes, waveTable: TABLE }));
  assert.deepEqual([fromId.release, fromId.obsid, fromId.det], ['dr1', '2025W23_1B_0101_3', 4]);

  // A header with CDi_j instead of PCi_j.
  const cd = headerToWcs(new Map([
    ['CTYPE1', 'RA---TAN'], ['CRPIX1', 10], ['CRPIX2', 20], ['CRVAL1', 30], ['CRVAL2', 40],
    ['CD1_1', -0.001], ['CD1_2', 0.0002], ['CD2_1', 0.0003], ['CD2_2', 0.001], ['CDELT1', 5],
  ]));
  assert.deepEqual(cd, { crpix: [10, 20], crval: [30, 40], pc: [[-0.001, 0.0002], [0.0003, 0.001]], cdelt: [1, 1], sip: null });
  // Defaults: identity PC, unit CDELT.
  assert.deepEqual(headerToWcs(new Map([['CRPIX1', 1], ['CRPIX2', 2], ['CDELT1', -0.5], ['CDELT2', 0.5]])), {
    crpix: [1, 2], crval: [0, 0], pc: [[1, 0], [0, 1]], cdelt: [-0.5, 0.5], sip: null,
  });
});

test('parseFrameId understands IRSA uris', () => {
  assert.deepEqual(parseFrameId(REAL_ID), { release: 'qr3', det: 2, obsid: '2026W25_2A_0279_1' });
  assert.deepEqual(parseFrameId(`https://irsa.ipac.caltech.edu/${REAL_ID}?center=1,2d&size=0.1`), {
    release: 'qr3', det: 2, obsid: '2026W25_2A_0279_1',
  });
  assert.deepEqual(parseFrameId('nonsense'), { release: null, det: null, obsid: null });
  assert.deepEqual(parseFrameId(undefined), { release: null, det: null, obsid: null });
});

test('buildFrame and decodeFrame report unusable input clearly', () => {
  assert.throws(() => buildFrame({ id: REAL_ID, u8: HEAD }), /wavelength table/);
  assert.throws(() => buildFrame({ id: REAL_ID, u8: HEAD.subarray(0, HDUS[4].headerOffset), waveTable: TABLE }), /no ZODI/);
  assert.throws(() => buildFrame({ id: REAL_ID, u8: HEAD.subarray(0, HDUS[4].dataOffset + 100), waveTable: TABLE }), /truncated/);
  assert.throws(() => buildFrame({ id: REAL_ID, u8: new TextEncoder().encode('<html>oops</html>'), waveTable: TABLE }), /Not a FITS file/);

  const tbf = buildFrame({ id: REAL_ID, u8: HEAD, waveTable: TABLE });
  assert.throws(() => decodeFrame(MEF), /Not a TBF1 frame/);
  assert.throws(() => decodeFrame(new Uint8Array(4)), /Not a TBF1 frame/);
  assert.throws(() => decodeFrame(tbf.subarray(0, 100)), /truncated/);
  assert.throws(() => decodeFrame(tbf.subarray(0, tbf.length - 4)), /outside the frame/);
  const wrongVersion = tbf.slice();
  wrongVersion.set(new TextEncoder().encode('{"v":2'), 8);
  assert.throws(() => decodeFrame(wrongVersion), /Unsupported TBF1/);
});
