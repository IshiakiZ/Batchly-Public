// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// Check 1, Node half: write synthetic SPHEREx-style files with makeSyntheticMef and dump what
// OUR reader (parseMef, readImage, readWaveTable, tableColumns) makes of them.
//
// Output per case <name>:
//   <name>.fits               the file itself (Astropy opens this)
//   <name>.hdu<i>.bin         readImage result of image HDU i, raw little-endian
//   c1_<name>.json            per HDU: name, type, offsets, sizes, every header card we parsed,
//                             the typed-array class readImage returned, table columns, and the
//                             wavelength table as numbers
//
// Reverse direction: the file astropy-written.fits (made by c1_write.py with Astropy, with
// header constructs and pixel types our own writer never produces) is read and dumped the same
// way, as c1_astropy-written.json.

import fs from 'node:fs';
import { makeSyntheticMef } from '../../proxy/fixtures/synth.js';
import { parseMef, readImage, readWaveTable, tableColumns } from '../../proxy/src/fits.js';
import { CASES, outPath, readBytes, writeJson, writeRaw, log } from './lib.mjs';

function dumpFile(name, mef) {
  const hdus = parseMef(mef);
  const dump = { name, bytes: mef.length, hdus: [] };
  for (const hdu of hdus) {
    const entry = {
      index: hdu.index,
      name: hdu.name,
      type: hdu.type,
      headerOffset: hdu.headerOffset,
      headerBytes: hdu.headerBytes,
      dataOffset: hdu.dataOffset,
      dataBytes: hdu.dataBytes,
      paddedDataBytes: hdu.paddedDataBytes,
      cards: Object.fromEntries(hdu.header),
    };
    if ((hdu.type === 'IMAGE' || hdu.type === 'PRIMARY') && hdu.dataBytes > 0) {
      const data = readImage(mef, hdu);
      entry.array = data.constructor.name;
      entry.length = data.length;
      entry.file = `${name}.hdu${hdu.index}.bin`;
      writeRaw(entry.file, data);
    }
    if (hdu.type === 'BINTABLE') {
      entry.columns = tableColumns(hdu.header);
      if (hdu.name === 'WCS-WAVE') {
        const t = readWaveTable(mef, hdu);
        entry.waveTable = { nx: t.nx, ny: t.ny, nk: t.nk, x: Array.from(t.x), y: Array.from(t.y), values: Array.from(t.values) };
      }
    }
    dump.hdus.push(entry);
  }
  writeJson(`c1_${name}.json`, dump);
  log(`check 1: ${name}.fits, ${mef.length} bytes, ${hdus.length} HDUs`);
}

for (const c of CASES) {
  const mef = makeSyntheticMef(c.args);
  fs.writeFileSync(outPath(`${c.name}.fits`), mef);
  dumpFile(c.name, mef);
}

if (fs.existsSync(outPath('astropy-written.fits'))) {
  dumpFile('astropy-written', readBytes('astropy-written.fits'));
} else {
  log('check 1: astropy-written.fits not found (run c1_write.py first); reverse direction skipped');
}
