// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// Resample a native SPHEREx frame onto the common north-up Grid.
//
// CONVENTIONS
// * Frame arrays are row-major, index = y * nx + x, 0-based pixels whose integer coordinates are
//   pixel centres; the frame covers -0.5 <= x < nx - 0.5 and the same in y.
// * Grid arrays are n * n, index = y * n + x. x increases toward WEST (east is left), y increases
//   toward NORTH (row 0 is the southern edge). See wcs.js for the exact formula.
// * For every grid pixel centre the matching native pixel position is found through the frame's
//   full TAN-SIP solution, then the frame is sampled by bilinear interpolation.
// * Surface brightness (MJy/sr) is an intensive quantity, so resampling needs NO flux scaling.
// * Bad native pixel = non-finite image, variance, wave (or zodi when it is being subtracted),
//   or (flags & badMask) != 0.
// * A grid pixel is masked (mask = 1, image and variance = NaN) when its NEAREST native pixel is
//   bad or when it falls outside the frame. Otherwise the value is the bilinear average of the
//   good neighbours among the four, with weights renormalised, so a single dead pixel does not
//   bleed into its surroundings and the half-pixel rim of the frame is still usable.
//   Guarantee: mask = 0 implies finite image, variance and wave.
// * Variance: by default the variance image is interpolated with the same weights as the image.
//   That keeps it smooth and never underestimates the per-pixel noise, but be aware that
//   neighbouring grid pixels share native pixels, so their noise is CORRELATED: do not add grid
//   variances over an aperture and expect the right error (photometry runs on native frames).
//   `variance: 'propagate'` gives the exact single-pixel variance sum(w^2 var) / sum(w)^2 instead.
// * `wave` is interpolated from all in-frame neighbours, flagged or not, because wavelength is
//   set by geometry; it is NaN only off the frame.
//
// SPEED. The grid-to-frame mapping is two tangent planes related by a 3 x 3 rotation (no
// per-pixel trigonometry) followed by the inverse SIP. It is evaluated exactly on a lattice of
// every 16th grid pixel and interpolated bilinearly in between; the interpolation error is
// measured at every lattice cell centre and if it exceeds 0.002 native pixel the lattice is
// refined to every 4th pixel, and failing that every pixel is computed exactly. For real
// SPHEREx headers the lattice error is about 1e-4 pixel (see reproject.test.js).

import { makeWcs, tangentBasis } from './wcs.js';
import { DEFAULT_BAD_MASK } from './flags.js';

const ARCSEC2RAD = Math.PI / (180 * 3600);
const R2D = 180 / Math.PI;
const LATTICE_STEPS = [16, 4];
const LATTICE_TOLERANCE = 0.002; // native pixels

// Scratch buffers, reused between calls (reproject is synchronous, so this is safe).
let scratchBad = new Uint8Array(0);
let scratchSrc = new Float32Array(0);
let scratchX = new Float64Array(0);
let scratchY = new Float64Array(0);
let scratchLatX = new Float64Array(0);
let scratchLatY = new Float64Array(0);
const pair = new Float64Array(2);

/**
 * Exact map from fractional grid pixel (gx, gy) to native frame pixel, written into out[0..1].
 * `w` is the object returned by makeWcs.
 */
function makeGridToFrame(w, grid) {
  const g = tangentBasis(grid.ra0, grid.dec0);
  const f = tangentBasis(w.crval[0], w.crval[1]);
  // m[r][c] = (frame basis vector r) . (grid basis vector c); rows/cols are E, N, C.
  const m = new Float64Array(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      m[r * 3 + c] = f[r * 3] * g[c * 3] + f[r * 3 + 1] * g[c * 3 + 1] + f[r * 3 + 2] * g[c * 3 + 2];
    }
  }
  const m00 = m[0];
  const m01 = m[1];
  const m02 = m[2];
  const m10 = m[3];
  const m11 = m[4];
  const m12 = m[5];
  const m20 = m[6];
  const m21 = m[7];
  const m22 = m[8];
  const centre = (grid.n - 1) / 2;
  const s = grid.scale * ARCSEC2RAD;
  return function gridToFrame(gx, gy, out) {
    const xi = -(gx - centre) * s; // radians, east positive
    const eta = (gy - centre) * s; // radians, north positive
    const Z = m20 * xi + m21 * eta + m22;
    if (!(Z > 1e-9)) {
      out[0] = NaN;
      out[1] = NaN;
      return out;
    }
    const X = m00 * xi + m01 * eta + m02;
    const Y = m10 * xi + m11 * eta + m12;
    return w.planeToPix((X / Z) * R2D, (Y / Z) * R2D, out);
  };
}

/** Try to fill X, Y by lattice interpolation with step S. Returns the measured error or -1. */
function fillByLattice(toFrame, n, S, X, Y) {
  const L = Math.max(1, Math.ceil((n - 1) / S));
  const L1 = L + 1;
  const nodes = L1 * L1;
  if (scratchLatX.length < nodes) {
    scratchLatX = new Float64Array(nodes);
    scratchLatY = new Float64Array(nodes);
  }
  const lx = scratchLatX;
  const ly = scratchLatY;
  for (let j = 0; j < L1; j++) {
    for (let i = 0; i < L1; i++) {
      toFrame(i * S, j * S, pair);
      const a = j * L1 + i;
      lx[a] = pair[0];
      ly[a] = pair[1];
      if (!(pair[0] - pair[0] === 0) || !(pair[1] - pair[1] === 0)) return -1;
    }
  }
  // Bilinear interpolation is worst at the cell centre; measure it there for every cell.
  let err = 0;
  for (let j = 0; j < L; j++) {
    for (let i = 0; i < L; i++) {
      const a = j * L1 + i;
      toFrame((i + 0.5) * S, (j + 0.5) * S, pair);
      const ex = Math.abs(0.25 * (lx[a] + lx[a + 1] + lx[a + L1] + lx[a + L1 + 1]) - pair[0]);
      const ey = Math.abs(0.25 * (ly[a] + ly[a + 1] + ly[a + L1] + ly[a + L1 + 1]) - pair[1]);
      if (!(ex <= LATTICE_TOLERANCE) || !(ey <= LATTICE_TOLERANCE)) return -1;
      if (ex > err) err = ex;
      if (ey > err) err = ey;
    }
  }
  const invS = 1 / S;
  for (let y = 0; y < n; y++) {
    const j = Math.min(L - 1, Math.floor(y * invS));
    const ty = (y - j * S) * invS;
    const row = y * n;
    for (let i = 0; i < L; i++) {
      const a = j * L1 + i;
      const b = a + L1;
      const xl = lx[a] + (lx[b] - lx[a]) * ty;
      const xr = lx[a + 1] + (lx[b + 1] - lx[a + 1]) * ty;
      const yl = ly[a] + (ly[b] - ly[a]) * ty;
      const yr = ly[a + 1] + (ly[b + 1] - ly[a + 1]) * ty;
      const dx = (xr - xl) * invS;
      const dy = (yr - yl) * invS;
      const xStart = i * S;
      const xEnd = i === L - 1 ? n : Math.min(n, xStart + S);
      for (let x = xStart, k = 0; x < xEnd; x++, k++) {
        X[row + x] = xl + dx * k;
        Y[row + x] = yl + dy * k;
      }
    }
  }
  return err;
}

/** Fill X, Y (length >= n*n) with the native pixel position of every grid pixel centre. */
function fillPixelMap(w, grid, X, Y, exact) {
  const n = grid.n;
  const toFrame = makeGridToFrame(w, grid);
  if (!exact) {
    for (const S of LATTICE_STEPS) {
      const err = fillByLattice(toFrame, n, S, X, Y);
      if (err >= 0) return { exact: false, step: S, latticeError: err };
    }
  }
  for (let y = 0; y < n; y++) {
    const row = y * n;
    for (let x = 0; x < n; x++) {
      toFrame(x, y, pair);
      X[row + x] = pair[0];
      Y[row + x] = pair[1];
    }
  }
  return { exact: true, step: 1, latticeError: 0 };
}

/**
 * Native frame pixel position of every grid pixel centre.
 * Returns { x: Float64Array(n*n), y: Float64Array(n*n), exact, step, latticeError } where
 * x[gy * n + gx], y[gy * n + gx] are 0-based native pixel coordinates (NaN if unmappable).
 * `{ exact: true }` forces the per-pixel computation (used to validate the fast path).
 */
export function mapGridToFrame(wcs, grid, { exact = false } = {}) {
  const nn = grid.n * grid.n;
  const x = new Float64Array(nn);
  const y = new Float64Array(nn);
  const info = fillPixelMap(makeWcs(wcs), grid, x, y, exact);
  return { x, y, ...info };
}

/**
 * Resample `frame` onto `grid`. Returns a Layer
 *   { frame, mjd, det, image, variance, wave, mask }   (Float32Array(n*n) x3, Uint8Array(n*n))
 * plus the extras { n, coverage (fraction of unmasked pixels), zodiSubtracted }.
 * Options: subtractZodi (default true), badMask (default DEFAULT_BAD_MASK),
 * variance: 'interp' (default) | 'propagate', exact: force exact per-pixel geometry,
 * fill: value written to masked image/variance pixels (default NaN).
 */
export function reproject(frame, grid, opts) {
  const {
    subtractZodi = true,
    badMask = DEFAULT_BAD_MASK,
    variance: varianceMode = 'interp',
    exact = false,
    fill = NaN,
  } = opts || {};
  if (!frame || !grid) throw new TypeError('reproject: frame and grid are required');
  const nx = frame.nx | 0;
  const ny = frame.ny | 0;
  const np = nx * ny;
  const n = grid.n | 0;
  const nn = n * n;
  const img = frame.image;
  if (!(np > 0) || !img || img.length < np) throw new TypeError('reproject: frame has no image');
  if (!(n > 0)) throw new TypeError('reproject: grid.n must be positive');
  const vr = frame.variance && frame.variance.length >= np ? frame.variance : null;
  const zd = subtractZodi && frame.zodi && frame.zodi.length >= np ? frame.zodi : null;
  const fl = frame.flags && frame.flags.length >= np ? frame.flags : null;
  const wv = frame.wave && frame.wave.length >= np ? frame.wave : null;
  const waveConst = Number.isFinite(frame.waveCenter) ? frame.waveCenter : NaN;
  const mask32 = badMask | 0;

  if (scratchBad.length < np) {
    scratchBad = new Uint8Array(np);
    scratchSrc = new Float32Array(np);
  }
  if (scratchX.length < nn) {
    scratchX = new Float64Array(nn);
    scratchY = new Float64Array(nn);
  }
  const bad = scratchBad;
  const src = scratchSrc;
  const X = scratchX;
  const Y = scratchY;

  // Per-frame preparation: bad-pixel map and the (zodi-subtracted) source image.
  // (v - v === 0) is true exactly for finite v.
  for (let i = 0; i < np; i++) {
    const v = img[i];
    let b = 0;
    let s = v;
    if (!(v - v === 0)) b = 1;
    else if (vr !== null && !(vr[i] - vr[i] === 0)) b = 1;
    else if (fl !== null && (fl[i] & mask32) !== 0) b = 1;
    else if (wv !== null && !(wv[i] - wv[i] === 0)) b = 1;
    if (zd !== null) {
      const z = zd[i];
      if (z - z === 0) s = v - z;
      else b = 1;
    }
    bad[i] = b;
    src[i] = s;
  }

  fillPixelMap(makeWcs(frame.wcs), grid, X, Y, exact);

  const image = new Float32Array(nn);
  const variance = new Float32Array(nn);
  const wave = new Float32Array(nn);
  const mask = new Uint8Array(nn);
  const propagate = varianceMode === 'propagate';
  const nxm1 = nx - 1;
  const nym1 = ny - 1;
  const xMax = nx - 0.5; // the frame covers -0.5 <= x < nx - 0.5
  const yMax = ny - 0.5;
  let good = 0;

  for (let o = 0; o < nn; o++) {
    const px = X[o];
    const py = Y[o];
    if (!(px >= -0.5 && px < xMax && py >= -0.5 && py < yMax)) {
      // Off the frame (or unmappable: NaN fails every comparison).
      image[o] = fill;
      variance[o] = fill;
      wave[o] = NaN;
      mask[o] = 1;
      continue;
    }
    // px + 1 >= 0.5 here, so integer truncation is floor(); x0 may be -1 on the left rim.
    const x0 = ((px + 1) | 0) - 1;
    const y0 = ((py + 1) | 0) - 1;
    const fx = px - x0;
    const fy = py - y0;
    const gx = 1 - fx;
    const gy = 1 - fy;
    const i00 = y0 * nx + x0;
    if (x0 >= 0 && y0 >= 0 && x0 < nxm1 && y0 < nym1) {
      const i10 = i00 + 1;
      const i01 = i00 + nx;
      const i11 = i01 + 1;
      if ((bad[i00] | bad[i10] | bad[i01] | bad[i11]) === 0) {
        // Fast path: all four neighbours inside the frame and good (so the nearest is good).
        const w00 = gx * gy;
        const w10 = fx * gy;
        const w01 = gx * fy;
        const w11 = fx * fy;
        image[o] = w00 * src[i00] + w10 * src[i10] + w01 * src[i01] + w11 * src[i11];
        if (vr === null) variance[o] = NaN;
        else if (propagate) {
          variance[o] = w00 * w00 * vr[i00] + w10 * w10 * vr[i10] + w01 * w01 * vr[i01] + w11 * w11 * vr[i11];
        } else {
          variance[o] = w00 * vr[i00] + w10 * vr[i10] + w01 * vr[i01] + w11 * vr[i11];
        }
        wave[o] = wv === null ? waveConst : w00 * wv[i00] + w10 * wv[i10] + w01 * wv[i01] + w11 * wv[i11];
        good++;
        continue;
      }
    }
    // Slow path: frame edge or at least one bad neighbour.
    let sw = 0;
    let si = 0;
    let sv = 0;
    let swWave = 0;
    let sWave = 0;
    for (let k = 0; k < 4; k++) {
      const xx = x0 + (k & 1);
      const yy = y0 + (k >> 1);
      if (xx < 0 || xx >= nx || yy < 0 || yy >= ny) continue;
      const wgt = (k & 1 ? fx : gx) * (k >> 1 ? fy : gy);
      const i = yy * nx + xx;
      if (wv !== null) {
        const wl = wv[i];
        if (wl - wl === 0) {
          swWave += wgt;
          sWave += wgt * wl;
        }
      }
      if (bad[i] !== 0) continue;
      sw += wgt;
      si += wgt * src[i];
      if (vr !== null) sv += (propagate ? wgt * wgt : wgt) * vr[i];
    }
    wave[o] = wv === null ? waveConst : swWave > 0 ? sWave / swWave : NaN;
    const ix = (px + 0.5) | 0; // nearest native pixel (px + 0.5 >= 0, so truncation is floor)
    const iy = (py + 0.5) | 0;
    if (bad[iy * nx + ix] !== 0 || !(sw > 0)) {
      image[o] = fill;
      variance[o] = fill;
      mask[o] = 1;
    } else {
      image[o] = si / sw;
      variance[o] = vr === null ? NaN : sv / (propagate ? sw * sw : sw);
      good++;
    }
  }

  return {
    frame,
    mjd: frame.mjd,
    det: frame.det,
    image,
    variance,
    wave,
    mask,
    n,
    coverage: good / nn,
    zodiSubtracted: zd !== null,
  };
}

function nowMs() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}

/**
 * Reproject many frames without freezing the page: yields to the event loop (zero timeout)
 * whenever about 12 ms of work has accumulated, i.e. every few frames.
 * Returns Promise<Layer[]> in input order. A frame that cannot be reprojected (broken WCS,
 * missing image) is skipped, never thrown; it is counted in `failed`.
 * onProgress({ done, total, failed, phase: 'reproject' }) is called at every yield and at the end.
 * opts are those of reproject, plus `signal` (AbortSignal): when aborted the promise rejects
 * with an AbortError.
 */
export async function reprojectMany(frames, grid, opts, onProgress) {
  const list = Array.isArray(frames) ? frames : Array.from(frames || []);
  const total = list.length;
  const signal = opts && opts.signal ? opts.signal : null;
  const layers = [];
  let failed = 0;
  let last = nowMs();
  const report = (done) => {
    if (typeof onProgress !== 'function') return;
    try {
      onProgress({ done, total, failed, phase: 'reproject' });
    } catch {
      // a broken progress handler must not stop the work
    }
  };
  for (let i = 0; i < total; i++) {
    if (signal && signal.aborted) {
      const err = new Error('reprojectMany aborted');
      err.name = 'AbortError';
      throw err;
    }
    try {
      layers.push(reproject(list[i], grid, opts));
    } catch {
      failed++;
    }
    if (i + 1 < total && nowMs() - last >= 12) {
      report(i + 1);
      await new Promise((resolve) => setTimeout(resolve, 0));
      last = nowMs();
    }
  }
  report(total);
  return layers;
}
