// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// Check 5, Node half: RICE_1 tile compression (proxy/src/rice.js).
//
// Forward: read the tile-compressed HDU that Astropy wrote (rice_astropy.fits) exactly as
// CONTRACT-S3.md describes: binary table row r holds a big-endian (int32 nbytes, int32
// heapOffset) descriptor; the heap begins at dataStart + NAXIS1 * NAXIS2; every tile is one image
// row. Decode each row with riceDecompressInt32 and write the image (rice_decoded_js.i4).
//
// Reverse: compress every row of the original image (rice_original.i4) with riceCompressInt32
// and write the tiles (rice_js_heap.bin + lengths in c5_node.json), for Astropy to decode.
// Also counted here: how many of our tiles are byte-identical to the tiles Astropy/CFITSIO wrote.

import fs from 'node:fs';
import { parseMef } from '../../proxy/src/fits.js';
import { outPath, readBytes, writeJson, writeRaw, log } from './lib.mjs';

let rice = null;
try {
  rice = await import('../../proxy/src/rice.js');
} catch (err) {
  writeJson('c5_node.json', { missing: true, error: String(err && err.message ? err.message : err) });
  log('check 5: proxy/src/rice.js cannot be imported; skipped');
  process.exit(0);
}
const { riceDecompressInt32, riceCompressInt32 } = rice;

const u8 = readBytes('rice_astropy.fits');
const hdus = parseMef(u8);
const hdu = hdus.find((h) => h.header.get('ZIMAGE') === true);
if (!hdu) throw new Error('no tile-compressed HDU in rice_astropy.fits');
const h = hdu.header;
const facts = {
  ZCMPTYPE: h.get('ZCMPTYPE'), ZBITPIX: h.get('ZBITPIX'), ZNAXIS1: h.get('ZNAXIS1'), ZNAXIS2: h.get('ZNAXIS2'),
  ZTILE1: h.get('ZTILE1'), ZTILE2: h.get('ZTILE2'), ZVAL1: h.get('ZVAL1'), ZVAL2: h.get('ZVAL2'),
  NAXIS1: h.get('NAXIS1'), NAXIS2: h.get('NAXIS2'), PCOUNT: h.get('PCOUNT'), TFORM1: h.get('TFORM1'),
  THEAP: h.get('THEAP') ?? null, dataOffset: hdu.dataOffset, dataBytes: hdu.dataBytes,
};
const nx = facts.ZTILE1;
const rows = facts.NAXIS2;
const blockSize = facts.ZVAL1 ?? 32;
if (facts.ZCMPTYPE !== 'RICE_1' || facts.ZBITPIX !== 32 || facts.ZTILE2 !== 1 || facts.NAXIS1 !== 8 || !/^1PB/.test(String(facts.TFORM1))) {
  throw new Error(`unexpected compressed layout: ${JSON.stringify(facts)}`);
}

const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
const heapStart = hdu.dataOffset + (facts.THEAP ?? facts.NAXIS1 * facts.NAXIS2);
const decoded = new Int32Array(nx * rows);
const astropyTiles = [];
let heapUsed = 0;
const t0 = performance.now();
for (let r = 0; r < rows; r++) {
  const nbytes = dv.getInt32(hdu.dataOffset + 8 * r, false);
  const offset = dv.getInt32(hdu.dataOffset + 8 * r + 4, false);
  const tile = u8.subarray(heapStart + offset, heapStart + offset + nbytes);
  astropyTiles.push(tile);
  heapUsed = Math.max(heapUsed, offset + nbytes);
  decoded.set(riceDecompressInt32(tile, nx, blockSize), r * nx);
}
const decodeMs = performance.now() - t0;
writeRaw('rice_decoded_js.i4', decoded);

// Reverse direction.
const ob = readBytes('rice_original.i4');
const original = new Int32Array(ob.buffer.slice(ob.byteOffset, ob.byteOffset + ob.byteLength));
const lengths = [];
const parts = [];
let identical = 0;
let selfRoundTrip = 0;
let total = 0;
const t1 = performance.now();
for (let r = 0; r < rows; r++) {
  const row = original.subarray(r * nx, (r + 1) * nx);
  const tile = riceCompressInt32(row, blockSize);
  parts.push(tile);
  lengths.push(tile.length);
  total += tile.length;
  const theirs = astropyTiles[r];
  if (theirs.length === tile.length && theirs.every((b, i) => b === tile[i])) identical++;
  const back = riceDecompressInt32(tile, nx, blockSize);
  if (back.every((v, i) => v === row[i])) selfRoundTrip++;
}
const encodeMs = performance.now() - t1;
const heap = new Uint8Array(total);
let pos = 0;
for (const p of parts) { heap.set(p, pos); pos += p.length; }
fs.writeFileSync(outPath('rice_js_heap.bin'), heap);

writeJson('c5_node.json', {
  missing: false, facts, rows, nx, heapUsed, heapBytesJs: total, lengths,
  identicalTiles: identical, selfRoundTripRows: selfRoundTrip,
  decodeMs: Math.round(decodeMs), encodeMs: Math.round(encodeMs),
});
log(`check 5: decoded ${rows} tiles in ${Math.round(decodeMs)} ms; compressed ${rows} rows in ${Math.round(encodeMs)} ms; ${identical} tiles byte-identical to Astropy's`);
