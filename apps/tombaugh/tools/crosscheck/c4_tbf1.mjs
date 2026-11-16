// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// Check 4, Node half: TBF1 frames. For every synthetic file:
//   <name>.tbf1            buildFrame({ id, u8 }) on the complete file
//   <name>.tbf1.<array>    the arrays our own decodeFrame returns (raw little-endian)
//   c4_<name>.json         the non-array fields decodeFrame returns, the web decoder's view
//                          (web/src/api.js decodeFrame) of the same scalars, and whether the
//                          production path gives the same bytes: buildFrame on the bytes cut at
//                          the end of ZODI (what readUntilPsf returns) with the wavelength table
//                          passed separately.

import fs from 'node:fs';
import { parseMef, findHdu, readWaveTable } from '../../proxy/src/fits.js';
import { buildFrame, decodeFrame } from '../../proxy/src/encode.js';
import { CASES, outPath, readBytes, writeJson, writeRaw, log } from './lib.mjs';

let webDecode = null;
try {
  webDecode = (await import('../../web/src/api.js')).decodeFrame;
} catch {
  webDecode = null;
}

const ARRAYS = ['image', 'variance', 'zodi', 'flags', 'wave'];

for (const c of CASES) {
  const u8 = readBytes(`${c.name}.fits`);
  const tbf = buildFrame({ id: c.id, u8 });
  fs.writeFileSync(outPath(`${c.name}.tbf1`), tbf);

  const frame = decodeFrame(tbf);
  const fields = {};
  for (const [k, v] of Object.entries(frame)) if (!ARRAYS.includes(k)) fields[k] = v;
  for (const a of ARRAYS) writeRaw(`${c.name}.tbf1.${a}`, frame[a]);

  // Production path: bytes through ZODI only + the detector's wavelength table.
  const hdus = parseMef(u8);
  const zodi = findHdu(hdus, 'ZODI');
  const head = u8.slice(0, zodi.dataOffset + zodi.paddedDataBytes);
  const table = readWaveTable(u8, findHdu(hdus, 'WCS-WAVE'));
  const tbf2 = buildFrame({ id: c.id, u8: head, waveTable: table });
  const sameBytes = tbf2.length === tbf.length && tbf2.every((b, i) => b === tbf[i]);

  let web = null;
  if (webDecode) {
    const copy = tbf.slice();
    const wf = webDecode(copy.buffer);
    web = { nx: wf.nx, ny: wf.ny, mjd: wf.mjd, det: wf.det, wcs: wf.wcs, arraysEqual: ARRAYS.every((a) => wf[a] && wf[a].length === frame[a].length && wf[a].every((v, i) => Object.is(v, frame[a][i]) || v === frame[a][i])) };
  }
  writeJson(`c4_${c.name}.json`, { name: c.name, bytes: tbf.length, fields, truncatedPathSameBytes: sameBytes, headBytes: head.length, web });
  log(`check 4: ${c.name}.tbf1, ${tbf.length} bytes; cut-at-ZODI path identical: ${sameBytes}`);
}
