// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  fetchCutoutFromS3, fetchWaveTableFromS3, s3FileInfo, wcsFromHeader, skyToPixel, pixelToSky, cutoutWindow, CutoutError,
} from './s3cutout.js';
import { parseMef, parseHeaderBlock, readImage } from './fits.js';
import { buildFrame, decodeFrame } from './encode.js';
import { waveAt } from './wavetab.js';
import { createFakeS3, makeFakeLevel2, level2HeaderBytes } from '../fixtures/fakes3.js';
import { makeTanSip, syntheticSip } from '../fixtures/synth.js';

const KEY = 'qr3/level2/2026W25_2A/l2b-v27-2026-273/2/level2_2026W25_2A_0279_1D2_spx_l2b-v27-2026-273.fits';
const ID = `ibe/data/spherex/${KEY}`;
const KEY_B = 'qr3/level2/2026W25_2A/l2b-v27-2026-273/2/level2_2026W25_2A_0280_1D2_spx_l2b-v27-2026-273.fits';
const ID_B = `ibe/data/spherex/${KEY_B}`;
const ROW_BYTES = 2040 * 4;
const fast = { backoffMs: 1, timeoutMs: 5000 };

// One default file (the real detector-2 pointing and SIP of 2026W25_2A_0279_1) shared by most tests.
const FILE = makeFakeLevel2({ seed: 11 });
const WCS = wcsFromHeader(parseHeaderBlock(FILE.read(2880, 28800), 0).cards);

function bucketWith(files, options) {
  const s3 = createFakeS3(options);
  for (const [key, file] of Object.entries(files)) s3.put(key, file);
  return s3;
}

function sameArray(actual, expected, label) {
  assert.equal(actual.length, expected.length, `${label}: length`);
  for (let i = 0; i < expected.length; i++) {
    if (!Object.is(actual[i], expected[i])) assert.fail(`${label}: element ${i} is ${actual[i]}, expected ${expected[i]}`);
  }
}

/** Parse a cutout and compare every plane with the generating functions of the fake file. */
function checkCutout(u8, file, win) {
  const hdus = parseMef(u8);
  assert.deepEqual(hdus.map((h) => h.name), ['PRIMARY', 'IMAGE', 'FLAGS', 'VARIANCE', 'ZODI']);
  assert.deepEqual(hdus.map((h) => h.type), ['PRIMARY', 'IMAGE', 'IMAGE', 'IMAGE', 'IMAGE']);
  assert.equal(u8.length % 2880, 0);
  assert.equal(hdus[4].dataOffset + hdus[4].paddedDataBytes, u8.length, 'file ends with the ZODI data');
  for (const h of hdus.slice(1)) {
    assert.equal(h.header.get('NAXIS1'), win.nx, `${h.name} NAXIS1`);
    assert.equal(h.header.get('NAXIS2'), win.ny, `${h.name} NAXIS2`);
  }
  const { x0, y0, nx, ny } = win;
  const image = readImage(u8, hdus[1]);
  const flags = readImage(u8, hdus[2]);
  assert.ok(image instanceof Float32Array && flags instanceof Int32Array);
  sameArray(image, file.truth.imageWindow(x0, y0, nx, ny), 'IMAGE');
  sameArray(flags, file.truth.flagsWindow(x0, y0, nx, ny), 'FLAGS');
  sameArray(readImage(u8, hdus[3]), file.truth.varianceWindow(x0, y0, nx, ny), 'VARIANCE');
  sameArray(readImage(u8, hdus[4]), file.truth.zodiWindow(x0, y0, nx, ny), 'ZODI');
  return hdus;
}

/** Bytes the careful or speculative path must transfer for a window of a default-layout file. */
function expectedBytes(file, win) {
  const rows = (win.ny - 1) * ROW_BYTES + win.nx * 4;
  let heap = 0;
  for (let y = win.y0; y < win.y0 + win.ny; y++) heap += file.tiles[y - 1].length;
  return 28800 + (17280 + 16320) + 3 * rows + heap + 2 * 11520;
}

test('TAN-SIP: the real header puts 210.80227, 54.34895 on the pixel IRSA cut around', () => {
  // Real D2 CRVAL / PC / forward SIP of 2026W25_2A_0279_1 (CONTRACT.md). IRSA's 59 x 59 cutout
  // starts at detector pixel (1647, 510) and has the target on its pixel 30: detector (1676, 539).
  const [x, y] = skyToPixel(WCS, 210.80227, 54.34895);
  assert.equal(Math.round(x), 1676, `x = ${x}`);
  assert.equal(Math.round(y), 539, `y = ${y}`);
  const win = cutoutWindow(x, y, 0.1, 2040, 2040);
  assert.deepEqual(win, { x0: 1647, y0: 510, x1: 1705, y1: 568, nx: 59, ny: 59, n: 59 });
  // CONTRACT.md test vector: FITS pixel (30, 30) of that cutout maps to 210.8023, 54.3490.
  const [ra, dec] = pixelToSky(WCS, 30 + 1646, 30 + 509);
  assert.ok(Math.abs(ra - 210.8023) < 0.003 && Math.abs(dec - 54.349) < 0.003, `${ra}, ${dec}`);
});

test('TAN-SIP: inverse is exact, agrees with an independent implementation, works without SIP', () => {
  const other = makeTanSip({
    crpix: [1020.5, 1020.5], crval: FILE.wcs.crval, cdelt: [1, 1], sip: syntheticSip(),
    pc: [[FILE.wcs.pc[0], FILE.wcs.pc[1]], [FILE.wcs.pc[2], FILE.wcs.pc[3]]],
  });
  for (const [x, y] of [[1, 1], [2040, 1], [1, 2040], [2040, 2040], [1020.5, 1020.5], [1676.3, 538.8], [77.7, 1903.1]]) {
    const [ra, dec] = pixelToSky(WCS, x, y);
    const back = skyToPixel(WCS, ra, dec);
    assert.ok(Math.abs(back[0] - x) < 1e-7 && Math.abs(back[1] - y) < 1e-7, `${x},${y} -> ${back}`);
    const [ra2, dec2] = other.pixToSky(x - 1, y - 1); // that one is 0-based
    assert.ok(Math.abs(ra2 - ra) * Math.cos(dec * Math.PI / 180) < 1e-9 && Math.abs(dec2 - dec) < 1e-9);
  }
  // Bad AP/BP must not matter: Newton iteration on A/B fixes the first guess.
  const rough = { ...WCS, ap: [], bp: [] };
  const [ra, dec] = pixelToSky(WCS, 1900.25, 150.75);
  const viaRough = skyToPixel(rough, ra, dec);
  assert.ok(Math.abs(viaRough[0] - 1900.25) < 1e-7 && Math.abs(viaRough[1] - 150.75) < 1e-7);
  // Plain TAN header.
  const plain = wcsFromHeader(parseHeaderBlock(level2HeaderBytes({ crval: [10, -70], pc: [-0.0017, 0, 0, 0.0017], sip: null }), 2880).cards);
  assert.equal(plain.a.length, 0);
  const p = skyToPixel(plain, ...pixelToSky(plain, 500, 1500));
  assert.ok(Math.abs(p[0] - 500) < 1e-8 && Math.abs(p[1] - 1500) < 1e-8);
  assert.equal(skyToPixel(plain, 190, 70), null, 'the far side of the sky has no pixel');
});

test('cutoutWindow: size, centring, clipping, OUTSIDE', () => {
  assert.equal(cutoutWindow(1000, 1000, 0.1, 2040, 2040).n, 59);
  assert.equal(cutoutWindow(1000, 1000, 0.02, 2040, 2040).n, 12);
  assert.equal(cutoutWindow(1000, 1000, 0.2, 2040, 2040).n, 117);
  assert.equal(cutoutWindow(1000, 1000, 0.0001, 2040, 2040).n, 3);
  assert.deepEqual(cutoutWindow(1000.4, 999.6, 0.005, 2040, 2040), { x0: 999, y0: 999, x1: 1001, y1: 1001, nx: 3, ny: 3, n: 3 });
  // Even size: the window is centred on the position as well as whole pixels allow.
  const even = cutoutWindow(100.5, 100.49, (4 * 6.15) / 3600, 2040, 2040);
  assert.deepEqual([even.x0, even.x1, even.y0, even.y1], [99, 102, 99, 102]);
  const corner = cutoutWindow(1.2, 2040.4, 0.1, 2040, 2040);
  assert.deepEqual([corner.x0, corner.nx, corner.y0, corner.y1, corner.ny], [1, 30, 2011, 2040, 30]);
  for (const [x, y] of [[0.49, 5], [2040.5, 5], [5, 0.4], [5, 2040.6], [NaN, 5]]) {
    assert.throws(() => cutoutWindow(x, y, 0.1, 2040, 2040), (err) => err instanceof CutoutError && err.code === 'OUTSIDE');
  }
});

test('interior cutout: pixel-exact, right headers, 8 Range requests in 4 rounds (careful path)', async () => {
  const s3 = bucketWith({ [KEY]: FILE }, { latencyMs: 15 });
  const stats = {};
  const u8 = await fetchCutoutFromS3(ID, 210.80227, 54.34895, 0.1, { fetchImpl: s3.fetchImpl, stats, ...fast });
  const win = { x0: 1647, y0: 510, nx: 59, ny: 59 };
  assert.deepEqual(stats.window, win);
  const hdus = checkCutout(u8, FILE, win);

  // Requests and bytes.
  const summary = s3.summary();
  assert.equal(summary.ranges, 8);
  assert.equal(stats.requests, 8);
  assert.equal(summary.bytes, expectedBytes(FILE, win));
  assert.equal(stats.bytes, summary.bytes);
  assert.equal(stats.path, 'careful');
  assert.deepEqual(stats.fallbacks, []);
  assert.equal(stats.total, FILE.size);
  assert.equal(s3.rounds, 4, 'header|flags, rows|heap|variance header, variance rows|zodi header, zodi rows');
  console.log(`  careful path: ${summary.ranges} Range requests, ${summary.bytes} bytes, ${s3.rounds} round trips (59 x 59 window; synthetic FLAGS tiles average ${Math.round(FILE.tiles.reduce((a, t) => a + t.length, 0) / 2040)} bytes, real ones 5200)`);

  // IMAGE header: NAXIS and CRPIX rewritten exactly as IRSA does, everything else byte-identical.
  const h = hdus[1].header;
  assert.equal(h.get('CRPIX1'), -625.5);
  assert.equal(h.get('CRPIX2'), 511.5);
  assert.equal(h.get('CRPIX1W'), -1645);
  assert.equal(h.get('CRPIX2W'), -508);
  assert.equal(h.get('CRPIX1A'), -1645);
  assert.equal(h.get('CRPIX2A'), -508);
  const original = FILE.read(2880, 28800);
  const edited = u8.subarray(hdus[1].headerOffset, hdus[1].headerOffset + hdus[1].headerBytes);
  assert.equal(edited.length, original.length);
  const changed = [];
  for (let c = 0; c < original.length / 80; c++) {
    const a = String.fromCharCode(...original.subarray(c * 80, c * 80 + 80));
    const b = String.fromCharCode(...edited.subarray(c * 80, c * 80 + 80));
    if (a !== b) changed.push(a.slice(0, 8).trim());
  }
  assert.deepEqual(changed.sort(), ['CRPIX1', 'CRPIX1A', 'CRPIX1W', 'CRPIX2', 'CRPIX2A', 'CRPIX2W', 'NAXIS1', 'NAXIS2']);
  assert.match(String.fromCharCode(...edited.subarray(3 * 80, 4 * 80)), /^NAXIS1  = {19}59 /);
  // The primary header is copied as it is.
  assert.deepEqual(u8.subarray(0, 2880), FILE.read(0, 2880));

  // FLAGS: plain int32 image with the bit definitions and the same WCS as IMAGE.
  const f = hdus[2].header;
  assert.equal(f.get('XTENSION'), 'IMAGE');
  assert.equal(f.get('BITPIX'), 32);
  assert.equal(f.get('MSKN0021'), 'SOURCE');
  assert.equal(f.get('MSKN0000'), 'TRANSIENT');
  for (const key of ['CRPIX1', 'CRPIX2', 'CRVAL1', 'CRVAL2', 'PC1_1', 'PC1_2', 'PC2_1', 'PC2_2', 'CTYPE1', 'A_ORDER', 'A_0_0', 'BP_3_0', 'CRPIX1W', 'CRPIX2W', 'MJD-AVG']) {
    assert.equal(f.get(key), h.get(key), `FLAGS ${key}`);
  }
  for (const key of ['ZIMAGE', 'ZCMPTYPE', 'ZBITPIX', 'TFORM1', 'TTYPE1', 'TFIELDS', 'ZNAME1', 'ZVAL1', 'ZTILE1', 'BUNIT']) {
    assert.equal(f.has(key), false, `FLAGS must not carry ${key}`);
  }
  // VARIANCE and ZODI: same rewrite.
  for (const k of [3, 4]) {
    assert.equal(hdus[k].header.get('CRPIX1'), -625.5);
    assert.equal(hdus[k].header.get('CRPIX2'), 511.5);
    assert.equal(hdus[k].header.get('CRPIX1A'), -1645);
    assert.equal(hdus[k].header.get('BUNIT'), k === 3 ? 'MJy2 / sr2' : 'MJy / sr');
  }

  // The WCS of the cutout maps the target back to its pixel.
  const cut = wcsFromHeader(h);
  const [px, py] = skyToPixel(cut, 210.80227, 54.34895);
  assert.ok(Math.abs(px - (stats.target[0] - 1646)) < 1e-6 && Math.abs(py - (stats.target[1] - 509)) < 1e-6);
  assert.equal(Math.round(px), 30);
  assert.equal(Math.round(py), 30);
  const [ra, dec] = pixelToSky(cut, 30, 30);
  assert.ok(Math.abs(ra - 210.80227) < 0.002 && Math.abs(dec - 54.34895) < 0.002);
});

test('the cutout goes through the real buildFrame / decodeFrame unchanged', async () => {
  const s3 = bucketWith({ [KEY]: FILE });
  const opts = { fetchImpl: s3.fetchImpl, ...fast };
  const stats = {};
  const u8 = await fetchCutoutFromS3(ID, 210.80227, 54.34895, 0.1, { ...opts, stats });
  const waveTable = await fetchWaveTableFromS3(ID, { ...opts, total: stats.total });
  const frame = decodeFrame(buildFrame({ id: ID, u8, waveTable }));
  assert.equal(frame.id, ID);
  assert.equal(frame.release, 'qr3');
  assert.equal(frame.obsid, '2026W25_2A_0279_1');
  assert.equal(frame.det, 2);
  assert.equal(frame.version, '7.0.5');
  assert.equal(frame.nx, 59);
  assert.equal(frame.ny, 59);
  assert.equal(frame.mjd, 61210.79311303);
  assert.equal(frame.exptime, 113.5826);
  assert.equal(frame.bunit, 'MJy / sr');
  assert.deepEqual(frame.detXY0, [1647, 510]);
  assert.deepEqual(frame.wcs.crpix, [-625.5, 511.5]);
  assert.deepEqual(frame.wcs.crval, FILE.wcs.crval);
  assert.equal(frame.wcs.sip.aOrder, 3);
  sameArray(frame.image, FILE.truth.imageWindow(1647, 510, 59, 59), 'frame.image');
  sameArray(frame.flags, FILE.truth.flagsWindow(1647, 510, 59, 59), 'frame.flags');
  sameArray(frame.variance, FILE.truth.varianceWindow(1647, 510, 59, 59), 'frame.variance');
  sameArray(frame.zodi, FILE.truth.zodiWindow(1647, 510, 59, 59), 'frame.zodi');
  // Wavelengths: the detector pixel of every cutout pixel looked up in the table.
  const centre = waveAt(waveTable, 1647 + 29, 510 + 29);
  assert.ok(Math.abs(frame.waveCenter - centre.wave) < 1e-6);
  assert.ok(Math.abs(frame.wave[0] - waveAt(waveTable, 1647, 510).wave) < 1e-6);
  assert.ok(Math.abs(frame.wave[58 * 59 + 58] - waveAt(waveTable, 1705, 568).wave) < 1e-6);
  assert.ok(frame.waveCenter > 1.09 && frame.waveCenter < 1.67, 'detector 2 band');
});

test('windows at each edge and at the corners are clipped like IRSA and stay pixel-exact', async () => {
  const s3 = bucketWith({ [KEY]: FILE });
  const cases = [
    { name: 'left', pix: [3.2, 1000.4], win: { x0: 1, y0: 971, nx: 32, ny: 59 } },
    { name: 'right', pix: [2039.6, 700.1], win: { x0: 2011, y0: 671, nx: 30, ny: 59 } },
    { name: 'bottom', pix: [1200.3, 1.4], win: { x0: 1171, y0: 1, nx: 59, ny: 30 } },
    { name: 'top', pix: [444.4, 2040.2], win: { x0: 415, y0: 2011, nx: 59, ny: 30 } },
    { name: 'corner 1,1', pix: [0.6, 0.6], win: { x0: 1, y0: 1, nx: 30, ny: 30 } },
    { name: 'corner 2040,2040', pix: [2040.4, 2040.4], win: { x0: 2011, y0: 2011, nx: 30, ny: 30 } },
    { name: 'corner 2040,1', pix: [2038.7, 2.2], win: { x0: 2010, y0: 1, nx: 31, ny: 31 } },
    { name: 'tiny', pix: [1020.5, 1020.5], size: 0.001, win: { x0: 1020, y0: 1020, nx: 3, ny: 3 } },
    { name: 'large', pix: [600.2, 1500.9], size: 0.2, win: { x0: 542, y0: 1443, nx: 117, ny: 117 } },
  ];
  for (const c of cases) {
    const [ra, dec] = pixelToSky(WCS, c.pix[0], c.pix[1]);
    const stats = {};
    s3.resetStats();
    const u8 = await fetchCutoutFromS3(ID, ra, dec, c.size ?? 0.1, { fetchImpl: s3.fetchImpl, stats, ...fast });
    assert.deepEqual(stats.window, c.win, c.name);
    const hdus = checkCutout(u8, FILE, c.win);
    assert.equal(s3.summary().ranges, 8, c.name);
    assert.equal(s3.summary().bytes, expectedBytes(FILE, c.win), `${c.name}: bytes`);
    // Detector pixel of the cutout's first pixel, as wavetab.js derives it from CRPIXnW.
    assert.equal(1 - hdus[1].header.get('CRPIX1W') + 1, c.win.x0, c.name);
    assert.equal(1 - hdus[1].header.get('CRPIX2W') + 1, c.win.y0, c.name);
    const back = skyToPixel(wcsFromHeader(hdus[1].header), ra, dec);
    assert.ok(Math.abs(back[0] - (c.pix[0] - c.win.x0 + 1)) < 1e-6 && Math.abs(back[1] - (c.pix[1] - c.win.y0 + 1)) < 1e-6, c.name);
  }
});

test('a position off the detector throws OUTSIDE (and costs two small requests)', async () => {
  const s3 = bucketWith({ [KEY]: FILE });
  for (const pix of [[-3, 1000], [2045, 1000], [1000, 0.2], [1000, 2041], [-4000, 9000]]) {
    const [ra, dec] = pixelToSky(WCS, pix[0], pix[1]);
    s3.resetStats();
    await assert.rejects(
      fetchCutoutFromS3(ID, ra, dec, 0.1, { fetchImpl: s3.fetchImpl, ...fast }),
      (err) => err instanceof CutoutError && err.code === 'OUTSIDE' && err.retryable === false,
    );
    assert.equal(s3.summary().ranges, 2);
    assert.ok(s3.summary().bytes <= 28800 + 33600);
  }
  await assert.rejects(fetchCutoutFromS3(ID, FILE.wcs.crval[0] + 180, -FILE.wcs.crval[1], 0.1, { fetchImpl: s3.fetchImpl, ...fast }), (err) => err.code === 'OUTSIDE');
});

test('speculative path: with a layout memo the second cutout needs 2 round trips', async () => {
  const fileB = makeFakeLevel2({ seed: 12, obsid: '2026W25_2A_0280_1', crval: [150.1, 2.2], pc: [-0.0012, 0.0012, 0.0012, 0.0012], mjd: 61211.5 });
  const s3 = bucketWith({ [KEY]: FILE, [KEY_B]: fileB }, { latencyMs: 15 });
  const layoutMemo = new Map();
  const first = {};
  checkCutout(await fetchCutoutFromS3(ID, 210.80227, 54.34895, 0.1, { fetchImpl: s3.fetchImpl, layoutMemo, stats: first, ...fast }), FILE, {
    x0: 1647, y0: 510, nx: 59, ny: 59,
  });
  assert.equal(first.path, 'careful');
  assert.deepEqual([...layoutMemo.keys()], ['l2b-v27-2026-273/D2']);
  assert.deepEqual(layoutMemo.get('l2b-v27-2026-273/D2'), {
    headBytes: 28800, flagsOffset: 16675200, flagsHeaderBytes: 17280, flagsTableBytes: 16320, varianceHeaderBytes: 11520, zodiHeaderBytes: 11520,
  });

  // Another file of the same version and detector (its FLAGS heap has another size, so its
  // VARIANCE and ZODI offsets differ): everything after the headers in one parallel round.
  const wcsB = wcsFromHeader(parseHeaderBlock(fileB.read(2880, 28800), 0).cards);
  const [ra, dec] = pixelToSky(wcsB, 301.3, 1777.8);
  const stats = {};
  s3.resetStats();
  const u8 = await fetchCutoutFromS3(ID_B, ra, dec, 0.1, { fetchImpl: s3.fetchImpl, layoutMemo, stats, ...fast });
  const win = { x0: 272, y0: 1749, nx: 59, ny: 59 };
  assert.deepEqual(stats.window, win);
  checkCutout(u8, fileB, win);
  assert.equal(stats.path, 'speculative');
  assert.deepEqual(stats.fallbacks, []);
  assert.equal(s3.summary().ranges, 8);
  assert.equal(s3.summary().bytes, expectedBytes(fileB, win));
  assert.equal(s3.rounds, 2, 'header|flags, then everything else');
  assert.notEqual(fileB.layout.variance.headerOffset, FILE.layout.variance.headerOffset);
  console.log(`  speculative path: ${s3.summary().ranges} Range requests, ${s3.summary().bytes} bytes, ${s3.rounds} round trips`);
});

test('fallback: a file whose headers have other sizes than the memo says is still read correctly', async () => {
  // Longer IMAGE header (28800 bytes: the first request no longer holds all of it), longer
  // FLAGS and VARIANCE headers, shorter ZODI header. Every speculative read is wrong.
  const odd = makeFakeLevel2({ seed: 13, imageCards: 330, flagsCards: 250, varianceCards: 150, zodiCards: 80 });
  assert.equal(odd.layout.image.headerBytes, 28800);
  assert.equal(odd.layout.flags.headerBytes, 20160);
  assert.equal(odd.layout.variance.headerBytes, 14400);
  assert.equal(odd.layout.zodi.headerBytes, 8640);
  const s3 = bucketWith({ [KEY]: FILE, [KEY_B]: odd }, { latencyMs: 5 });
  const layoutMemo = new Map();
  await fetchCutoutFromS3(ID, 210.80227, 54.34895, 0.1, { fetchImpl: s3.fetchImpl, layoutMemo, ...fast });

  const stats = {};
  s3.resetStats();
  const u8 = await fetchCutoutFromS3(ID_B, 210.80227, 54.34895, 0.1, { fetchImpl: s3.fetchImpl, layoutMemo, stats, ...fast });
  const win = { x0: 1647, y0: 510, nx: 59, ny: 59 };
  checkCutout(u8, odd, win);
  assert.equal(stats.path, 'speculative');
  assert.deepEqual(stats.fallbacks.sort(), ['flags-header', 'variance-rows', 'zodi']);
  assert.ok(stats.requests > 8 && stats.requests <= 14, `${stats.requests} requests`);
  // The memo now describes the odd layout: the next cutout of that file is clean again.
  assert.deepEqual(layoutMemo.get('l2b-v27-2026-273/D2'), {
    headBytes: 31680, flagsOffset: odd.layout.flags.headerOffset, flagsHeaderBytes: 20160, flagsTableBytes: 16320, varianceHeaderBytes: 14400, zodiHeaderBytes: 8640,
  });
  const again = {};
  s3.resetStats();
  checkCutout(await fetchCutoutFromS3(ID_B, 210.80227, 54.34895, 0.1, { fetchImpl: s3.fetchImpl, layoutMemo, stats: again, ...fast }), odd, win);
  assert.deepEqual(again.fallbacks, []);
  assert.equal(again.requests, 8);
  assert.equal(s3.rounds, 2);

  // The careful path (no memo) copes with the odd layout too.
  const careful = {};
  checkCutout(await fetchCutoutFromS3(ID_B, 210.80227, 54.34895, 0.1, { fetchImpl: s3.fetchImpl, stats: careful, ...fast }), odd, win);
  assert.equal(careful.path, 'careful');
  assert.deepEqual(careful.fallbacks, ['flags-header']);
});

test('unusual FLAGS storage: reversed heap with gaps, THEAP, scattered tiles, uncompressed image', async () => {
  const variants = {
    reversed: makeFakeLevel2({ seed: 21, heapOrder: 'reversed', heapGap: 7 }),
    theap: makeFakeLevel2({ seed: 22, theapGap: 4000 }),
    shuffled: makeFakeLevel2({ seed: 23, heapOrder: 'shuffled' }),
    plain: makeFakeLevel2({ seed: 24, flagsPlain: true }),
  };
  const win = { x0: 1647, y0: 510, nx: 59, ny: 59 };
  for (const [name, file] of Object.entries(variants)) {
    const s3 = bucketWith({ [KEY]: file });
    const stats = {};
    const u8 = await fetchCutoutFromS3(ID, 210.80227, 54.34895, 0.1, { fetchImpl: s3.fetchImpl, stats, ...fast });
    const hdus = checkCutout(u8, file, win);
    assert.equal(hdus[2].header.get('BITPIX'), 32, name);
    if (name === 'shuffled') {
      assert.deepEqual(stats.fallbacks, ['flags-scattered']);
      assert.equal(stats.requests, 7 + 59, 'one request per tile when they are scattered');
    } else {
      assert.equal(stats.requests, 8, name);
    }
    if (name === 'theap') assert.equal(hdus[2].header.has('THEAP'), false);
  }
});

test('CHECKSUM / DATASUM cards are dropped because they would be wrong', async () => {
  const file = makeFakeLevel2({ seed: 31, checksum: true });
  const s3 = bucketWith({ [KEY]: file });
  const hdus = checkCutout(await fetchCutoutFromS3(ID, 210.80227, 54.34895, 0.05, { fetchImpl: s3.fetchImpl, ...fast }), file, {
    x0: 1662, y0: 525, nx: 29, ny: 29,
  });
  for (const h of hdus.slice(1)) {
    for (const key of ['CHECKSUM', 'DATASUM', 'ZHECKSUM']) assert.equal(h.header.has(key), false, `${h.name} ${key}`);
  }
});

test('error codes: NOT_FOUND, BAD_ID, UPSTREAM (retryable or not); transient errors are retried', async () => {
  const s3 = bucketWith({ [KEY]: FILE });
  const opts = { fetchImpl: s3.fetchImpl, ...fast };
  await assert.rejects(fetchCutoutFromS3(ID_B, 210.8, 54.3, 0.1, opts), (err) => err instanceof CutoutError && err.code === 'NOT_FOUND' && err.status === 404 && !err.retryable);
  await assert.rejects(fetchCutoutFromS3('ibe/data/spherex/../../etc/passwd', 1, 2, 0.1, opts), (err) => err instanceof CutoutError && err.code === 'BAD_ID');
  await assert.rejects(fetchCutoutFromS3(ID, NaN, 2, 0.1, opts), (err) => err instanceof CutoutError && err.code === 'BAD_ID');

  // One 503 and one network error on different requests: retried, the cutout succeeds.
  s3.addFault({ match: (req) => req.range === 'bytes=0-28799', status: 503, times: 1 });
  s3.addFault({ match: (req) => /^bytes=1\d{7}-/.test(req.range || '') && !req.range.startsWith('bytes=16675200'), error: true, times: 1 });
  const stats = {};
  checkCutout(await fetchCutoutFromS3(ID, 210.80227, 54.34895, 0.1, { ...opts, stats }), FILE, { x0: 1647, y0: 510, nx: 59, ny: 59 });
  assert.equal(stats.requests, 8);
  assert.equal(s3.faults.every((f) => f.times === 0), true, 'both faults were hit');

  // S3 down for good: UPSTREAM, retryable.
  s3.clearFaults();
  s3.addFault({ match: /./, status: 503, times: 1000 });
  await assert.rejects(fetchCutoutFromS3(ID, 210.80227, 54.34895, 0.1, { ...opts, retries: 1 }), (err) => err instanceof CutoutError && err.code === 'UPSTREAM' && err.retryable === true);
  s3.clearFaults();

  // Something that is not a FITS file: UPSTREAM, not retryable.
  const junk = createFakeS3();
  junk.put(KEY, new Uint8Array(100000).fill(0x41));
  await assert.rejects(fetchCutoutFromS3(ID, 210.8, 54.3, 0.1, { fetchImpl: junk.fetchImpl, ...fast }), (err) => err.code === 'UPSTREAM' && err.retryable === false);
  // A truncated file (ends inside the IMAGE data).
  const cut = createFakeS3();
  cut.put(KEY, { size: 5000000, read: (a, b) => FILE.read(a, Math.min(b, 5000000)) });
  await assert.rejects(fetchCutoutFromS3(ID, 210.80227, 54.34895, 0.1, { fetchImpl: cut.fetchImpl, ...fast }), (err) => err.code === 'UPSTREAM');
});

test('a corrupt FLAGS tile is reported, not decoded into garbage', async () => {
  const s3 = createFakeS3();
  const heap = FILE.layout.flags.heapOffset;
  s3.put(KEY, {
    size: FILE.size,
    read(start, end) {
      const out = FILE.read(start, end);
      // overwrite part of the heap (the tiles of rows near 510..568 live there)
      for (let o = Math.max(start, heap + 1500000); o < Math.min(end, heap + 1900000); o++) out[o - start] = 0xff;
      return out;
    },
  });
  await assert.rejects(fetchCutoutFromS3(ID, 210.80227, 54.34895, 0.1, { fetchImpl: s3.fetchImpl, ...fast }), (err) => err.code === 'UPSTREAM' && /FLAGS row/.test(err.message));
});

test('fetchWaveTableFromS3: the last 5760 bytes, one request when the size is known', async () => {
  const s3 = bucketWith({ [KEY]: FILE });
  const opts = { fetchImpl: s3.fetchImpl, ...fast };
  const table = await fetchWaveTableFromS3(ID, { ...opts, total: FILE.size });
  assert.equal(s3.summary().ranges, 1);
  assert.equal(s3.summary().bytes, 5760);
  assert.deepEqual(Array.from(table.x), [1, 205, 409, 613, 817, 1021, 1224, 1428, 1632, 1836, 2040]);
  assert.deepEqual(Array.from(table.y), Array.from(table.x));
  assert.equal(table.nx, 11);
  assert.equal(table.ny, 11);
  assert.equal(table.nk, 2);
  sameArray(table.values, FILE.waveTable.values, 'wave values');
  assert.ok(Math.abs(waveAt(table, 1, 1).wave - 1.6677) < 2e-3, 'detector 2 starts near 1.667 um');

  s3.resetStats();
  const again = await fetchWaveTableFromS3(ID, opts);
  sameArray(again.values, table.values, 'wave values (size probed)');
  assert.equal(s3.summary().ranges, 2);
  assert.equal(s3.summary().bytes, 80 + 5760);

  // A file with trailing blocks after the table: found by searching the tail.
  const padded = createFakeS3();
  padded.put(KEY, { size: FILE.size + 2880, read: (a, b) => {
    const out = new Uint8Array(b - a);
    out.set(FILE.read(a, Math.min(b, FILE.size)));
    return out;
  } });
  sameArray((await fetchWaveTableFromS3(ID, { fetchImpl: padded.fetchImpl, ...fast })).values, table.values, 'wave values (padded file)');

  await assert.rejects(fetchWaveTableFromS3(ID_B, opts), (err) => err.code === 'NOT_FOUND');
  const junk = createFakeS3();
  junk.put(KEY, new Uint8Array(100000).fill(0x20));
  await assert.rejects(fetchWaveTableFromS3(ID, { fetchImpl: junk.fetchImpl, ...fast }), (err) => err.code === 'UPSTREAM' && /WCS-WAVE/.test(err.message));
});

test('s3FileInfo reads the basics from one request', async () => {
  const s3 = bucketWith({ [KEY]: FILE });
  const info = await s3FileInfo(ID, { fetchImpl: s3.fetchImpl, ...fast });
  assert.equal(s3.summary().ranges, 1);
  assert.deepEqual(info, {
    id: ID,
    key: KEY,
    url: `https://nasa-irsa-spherex.s3.amazonaws.com/${KEY}`,
    size: FILE.size,
    release: 'qr3',
    dir: '2026W25_2A',
    version: 'l2b-v27-2026-273',
    det: 2,
    obsid: '2026W25_2A_0279_1',
    suffix: '0279_1',
    mjd: 61210.79311303,
    exptime: 113.5826,
    dateObs: '2026-06-19T19:01:07.407',
    softwareVersion: '7.0.5',
    naxis: [2040, 2040],
    crval: [208.4483499, 54.5491081503],
  });
  await assert.rejects(s3FileInfo(ID_B, { fetchImpl: s3.fetchImpl, ...fast }), (err) => err.code === 'NOT_FOUND');
});
