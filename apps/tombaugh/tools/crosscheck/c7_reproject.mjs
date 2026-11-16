// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// Check 7, Node half: reprojection onto the north-up Grid (web/src/core/reproject.js).
//
// For every synthetic frame (decoded from its TBF1 file, as the browser would get it):
//   grid = makeGrid(ra, dec, fov)                       the common grid of the viewer
//   reproject(frame, grid)                              default: fast lattice geometry
//   reproject(frame, grid, { exact: true })             per-pixel geometry
//   reproject(frame, grid, { subtractZodi: false })
//   reproject(frame, grid, { variance: 'propagate' })
//   mapGridToFrame(wcs, grid) / { exact: true }         native pixel position of every grid pixel
// Arrays go to <name>.rp.<what>.bin (float32 / uint8 / float64), the grid and the bad-pixel mask
// value to c7_<name>.json.

import { makeGrid } from '../../web/src/core/wcs.js';
import { reproject, mapGridToFrame } from '../../web/src/core/reproject.js';
import { DEFAULT_BAD_MASK } from '../../web/src/core/flags.js';
import { decodeFrame } from '../../proxy/src/encode.js';
import { CASES, readBytes, writeJson, writeRaw, log } from './lib.mjs';

for (const c of CASES) {
  const frame = decodeFrame(readBytes(`${c.name}.tbf1`));
  const grid = makeGrid(c.args.ra, c.args.dec, c.fov);
  const variants = {
    fast: reproject(frame, grid),
    exact: reproject(frame, grid, { exact: true }),
    nozodi: reproject(frame, grid, { subtractZodi: false, exact: true }),
    prop: reproject(frame, grid, { variance: 'propagate', exact: true }),
  };
  for (const [key, layer] of Object.entries(variants)) {
    writeRaw(`${c.name}.rp.${key}.image.bin`, layer.image);
    writeRaw(`${c.name}.rp.${key}.variance.bin`, layer.variance);
    writeRaw(`${c.name}.rp.${key}.wave.bin`, layer.wave);
    writeRaw(`${c.name}.rp.${key}.mask.bin`, layer.mask);
  }
  const mapFast = mapGridToFrame(frame.wcs, grid);
  const mapExact = mapGridToFrame(frame.wcs, grid, { exact: true });
  writeRaw(`${c.name}.rp.mapfast.x.bin`, mapFast.x);
  writeRaw(`${c.name}.rp.mapfast.y.bin`, mapFast.y);
  writeRaw(`${c.name}.rp.mapexact.x.bin`, mapExact.x);
  writeRaw(`${c.name}.rp.mapexact.y.bin`, mapExact.y);
  writeJson(`c7_${c.name}.json`, {
    name: c.name, grid, badMask: DEFAULT_BAD_MASK,
    fast: { step: mapFast.step, exact: mapFast.exact, latticeError: mapFast.latticeError },
    coverage: variants.fast.coverage, zodiSubtracted: variants.fast.zodiSubtracted,
    mjd: variants.fast.mjd, det: variants.fast.det,
  });
  log(`check 7: ${c.name}: grid ${grid.n} x ${grid.n} at ${grid.scale} arcsec, coverage ${(variants.fast.coverage * 100).toFixed(1)} %, lattice step ${mapFast.step}`);
}
