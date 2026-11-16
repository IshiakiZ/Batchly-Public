// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// Per-pixel wavelength lookup. SPHEREx images are taken through linear variable filters, so
// every detector pixel has its own wavelength and bandwidth. The file describes this with a
// FITS "-TAB" alternate WCS ('W'): cutout pixel -> detector pixel (linear), then a bilinear
// lookup in the WCS-WAVE table (see readWaveTable in fits.js).
//
// A table is { x, y, values, nx, ny, nk } with values[k + nk * (ix + nx * iy)], k = 0
// wavelength (um), k = 1 bandwidth (um). x and y are the detector coordinates (1-based) of the
// table nodes; they are not evenly spaced in real files (..., 817, 1021, 1224, ...).

/**
 * Locate `v` in a monotonic index vector. Returns [i, t] so that the value lies a fraction t
 * of the way from node i to node i + 1. Outside the table the result is clamped to the first or
 * last node (no extrapolation). A NaN coordinate gives t = NaN.
 */
function bracket(vec, n, v) {
  if (n < 2) return [0, 0];
  if (Number.isNaN(v)) return [0, NaN];
  const ascending = vec[n - 1] >= vec[0];
  const first = vec[0];
  const last = vec[n - 1];
  if (ascending ? v <= first : v >= first) return [0, 0];
  if (ascending ? v >= last : v <= last) return [n - 2, 1];
  // Binary search for the interval [vec[lo], vec[lo + 1]] that contains v.
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (ascending ? vec[mid] <= v : vec[mid] >= v) lo = mid;
    else hi = mid;
  }
  const span = vec[lo + 1] - vec[lo];
  return [lo, span === 0 ? 0 : (v - vec[lo]) / span];
}

function plane(table, k, ix, tx, iy, ty) {
  const nk = table.nk || 2;
  const { nx, values } = table;
  if (k >= nk) return NaN;
  const ix1 = Math.min(ix + 1, nx - 1);
  const iy1 = Math.min(iy + 1, table.ny - 1);
  const v00 = values[k + nk * (ix + nx * iy)];
  const v10 = values[k + nk * (ix1 + nx * iy)];
  const v01 = values[k + nk * (ix + nx * iy1)];
  const v11 = values[k + nk * (ix1 + nx * iy1)];
  // Weights of exactly 0 skip their node so that a NaN neighbour cannot leak into a node value.
  const a = tx === 0 ? v00 : tx === 1 ? v10 : (1 - tx) * v00 + tx * v10;
  const b = tx === 0 ? v01 : tx === 1 ? v11 : (1 - tx) * v01 + tx * v11;
  return ty === 0 ? a : ty === 1 ? b : (1 - ty) * a + ty * b;
}

/**
 * Wavelength and bandwidth at a detector position.
 * @param {object} table  from readWaveTable
 * @param {number} detX   1-based detector column (1..2040), may be fractional
 * @param {number} detY   1-based detector row
 * @returns {{ wave: number, bandwidth: number }} micrometres; clamped to the table edges.
 */
export function waveAt(table, detX, detY) {
  const [ix, tx] = bracket(table.x, table.nx, detX);
  const [iy, ty] = bracket(table.y, table.ny, detY);
  return { wave: plane(table, 0, ix, tx, iy, ty), bandwidth: plane(table, 1, ix, tx, iy, ty) };
}

/** Bandwidth (um) at a 1-based detector position. Same lookup as waveAt. */
export function bandwidthAt(table, detX, detY) {
  return waveAt(table, detX, detY).bandwidth;
}

function headerGet(header, key) {
  return header instanceof Map ? header.get(key) : header[key];
}

/**
 * Linear map from a cutout FITS pixel (1-based) to the detector pixel (1-based) along one axis:
 *   det = CRVALnW + CDELTnW * (p - CRPIXnW)
 * In real files CRVALnW = 1 and CDELTnW = 1, so det = p - CRPIXnW + 1. If the 'W' keys are
 * missing, the 'A' alternate WCS (LINEAR, 0-based detector coordinate) is used instead.
 */
function detectorAxis(header, axis) {
  const num = (key, fallback) => {
    const v = headerGet(header, key);
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  };
  let crpix = num(`CRPIX${axis}W`);
  if (crpix !== undefined) {
    return { crpix, crval: num(`CRVAL${axis}W`, 1), cdelt: num(`CDELT${axis}W`, 1) };
  }
  crpix = num(`CRPIX${axis}A`);
  if (crpix !== undefined) {
    return { crpix, crval: num(`CRVAL${axis}A`, 0) + 1, cdelt: num(`CDELT${axis}A`, 1) };
  }
  throw new Error(`FITS header has no CRPIX${axis}W / CRPIX${axis}A: cannot locate the cutout on the detector`);
}

/**
 * Detector coordinates (1-based) of a 0-based cutout pixel.
 * @returns {[number, number]}
 */
export function detectorXY(header, x, y) {
  const ax = detectorAxis(header, 1);
  const ay = detectorAxis(header, 2);
  return [ax.crval + ax.cdelt * (x + 1 - ax.crpix), ay.crval + ay.cdelt * (y + 1 - ay.crpix)];
}

function planeMap(table, header, nx, ny, k) {
  const ax = detectorAxis(header, 1);
  const ay = detectorAxis(header, 2);
  // The lookup is separable: bracket each column and each row once.
  const colI = new Int32Array(nx);
  const colT = new Float64Array(nx);
  for (let x = 0; x < nx; x++) {
    const [i, t] = bracket(table.x, table.nx, ax.crval + ax.cdelt * (x + 1 - ax.crpix));
    colI[x] = i;
    colT[x] = t;
  }
  const out = new Float32Array(nx * ny);
  for (let y = 0; y < ny; y++) {
    const [iy, ty] = bracket(table.y, table.ny, ay.crval + ay.cdelt * (y + 1 - ay.crpix));
    for (let x = 0; x < nx; x++) out[y * nx + x] = plane(table, k, colI[x], colT[x], iy, ty);
  }
  return out;
}

/**
 * Wavelength (um) of every pixel of a cutout, row-major like the image.
 * @param {object} table   from readWaveTable
 * @param {Map} header     IMAGE header (the Map from parseHeaderBlock / parseMef)
 * @param {number} nx      NAXIS1
 * @param {number} ny      NAXIS2
 * @returns {Float32Array}
 */
export function waveMap(table, header, nx, ny) {
  return planeMap(table, header, nx, ny, 0);
}

/** Bandwidth (um) of every pixel of a cutout, row-major like the image. */
export function bandwidthMap(table, header, nx, ny) {
  return planeMap(table, header, nx, ny, 1);
}
