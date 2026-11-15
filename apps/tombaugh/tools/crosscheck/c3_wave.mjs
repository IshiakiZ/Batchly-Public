// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// Check 3, Node half: the -TAB wavelength lookup (proxy/src/wavetab.js) and the `wave` array
// that buildFrame puts into a TBF1 frame.
//
// Output per synthetic case <name>:
//   <name>.wave.bin, <name>.bw.bin   waveMap / bandwidthMap for every cutout pixel (float32)
//   <name>.tbfwave.bin               the `wave` array decoded from the TBF1 frame (float32)
//   c3_<name>.json                   detXY0, waveCenter, bwCenter, plus waveAt on a lattice over
//                                    the whole detector (every table node, half-way points,
//                                    fractional pixels, and points outside the table to show the
//                                    clamping)

import { parseMef, findHdu, readWaveTable } from '../../proxy/src/fits.js';
import { waveAt, waveMap, bandwidthMap, detectorXY } from '../../proxy/src/wavetab.js';
import { buildFrame, decodeFrame } from '../../proxy/src/encode.js';
import { CASES, readBytes, writeJson, writeRaw, linspace, log } from './lib.mjs';

for (const c of CASES) {
  const u8 = readBytes(`${c.name}.fits`);
  const hdus = parseMef(u8);
  const image = findHdu(hdus, 'IMAGE');
  const table = readWaveTable(u8, findHdu(hdus, 'WCS-WAVE'));
  const nx = image.header.get('NAXIS1');
  const ny = image.header.get('NAXIS2');
  writeRaw(`${c.name}.wave.bin`, waveMap(table, image.header, nx, ny));
  writeRaw(`${c.name}.bw.bin`, bandwidthMap(table, image.header, nx, ny));

  const frame = decodeFrame(buildFrame({ id: c.id, u8 }));
  writeRaw(`${c.name}.tbfwave.bin`, frame.wave);

  // Whole detector, 1-based detector coordinates.
  const coords = new Set([...table.x]);
  for (let i = 0; i + 1 < table.nx; i++) coords.add((table.x[i] + table.x[i + 1]) / 2);
  for (const v of linspace(1, 2040, 60)) coords.add(v);
  for (const v of [0.5, 1.25, 2039.75, 2040.5]) coords.add(v); // pixel edges, inside and just outside
  const axis = [...coords].sort((a, b) => a - b);
  const outside = [-50, 0, 2041, 2100]; // beyond the table: our lookup clamps
  const lat = { x: [], y: [], wave: [], bw: [] };
  for (const y of axis) for (const x of axis) {
    const r = waveAt(table, x, y);
    lat.x.push(x); lat.y.push(y); lat.wave.push(r.wave); lat.bw.push(r.bandwidth);
  }
  const clamp = { x: [], y: [], wave: [], bw: [] };
  for (const y of [...outside, 700.5]) for (const x of [...outside, 1300.25]) {
    if (x === 1300.25 && y === 700.5) continue;
    const r = waveAt(table, x, y);
    clamp.x.push(x); clamp.y.push(y); clamp.wave.push(r.wave); clamp.bw.push(r.bandwidth);
  }
  writeJson(`c3_${c.name}.json`, {
    name: c.name, det: c.args.det, nx, ny,
    detXY0: detectorXY(image.header, 0, 0),
    frame: { detXY0: frame.detXY0, waveCenter: frame.waveCenter, bwCenter: frame.bwCenter, nx: frame.nx, ny: frame.ny },
    lattice: lat, clamp,
  });
  log(`check 3: ${c.name}: ${nx} x ${ny} wavelength map, ${lat.x.length} detector lattice points`);
}
