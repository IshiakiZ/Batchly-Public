// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// Display statistics and intensity stretches.
//
// CONVENTIONS
// * `data` is any numeric array-like (normally Float32Array). `mask` is an optional array-like
//   of the same length where a truthy value means "ignore this pixel"; pass null for none.
//   Non-finite values are always ignored. Nothing here throws on bad pixels and nothing
//   modifies its inputs (statistics work on a copy).
// * Percentiles use p in 0..100 with linear interpolation between order statistics (the numpy
//   default), so percentile(.., 50) is the usual median.
// * With no usable pixels, statistics are NaN and ranges fall back to [0, 1].
// * stretchValue maps a value to 0..1: first t = clamp((v - vmin) / (vmax - vmin), 0, 1), then
//     linear: t
//     sqrt:   sqrt(t)
//     log:    ln(1 + 1000 t) / ln(1001)
//     asinh:  asinh(t / 0.1) / asinh(1 / 0.1)   (softening = 10 percent of the range: linear
//             for faint pixels, logarithmic for bright ones)
//   NaN maps to 0, +Infinity to 1, -Infinity to 0. All modes are monotonic non-decreasing.

export const STRETCH_MODES = ['linear', 'asinh', 'log', 'sqrt'];
export const ASINH_SOFTENING = 0.1; // fraction of (vmax - vmin)
export const LOG_CONTRAST = 1000;

const ASINH_NORM = Math.asinh(1 / ASINH_SOFTENING);
const LOG_NORM = Math.log1p(LOG_CONTRAST);

/** Copy the usable values (finite, not masked) into a fresh typed array. */
function validValues(data, mask) {
  const n = data ? data.length : 0;
  const out = data instanceof Float32Array ? new Float32Array(n) : new Float64Array(n);
  let m = 0;
  if (mask) {
    for (let i = 0; i < n; i++) {
      const v = data[i];
      if (!mask[i] && v - v === 0) out[m++] = v; // v - v === 0 only for finite numbers
    }
  } else {
    for (let i = 0; i < n; i++) {
      const v = data[i];
      if (v - v === 0) out[m++] = v;
    }
  }
  return out.subarray(0, m);
}

/** Quickselect (Hoare partition): after the call a[k] is the k-th smallest and a[k+1..] >= a[k]. */
function select(a, k) {
  let lo = 0;
  let hi = a.length - 1;
  while (hi > lo) {
    const pivot = a[(lo + hi) >> 1];
    let i = lo;
    let j = hi;
    while (i <= j) {
      while (a[i] < pivot) i++;
      while (a[j] > pivot) j--;
      if (i <= j) {
        const t = a[i];
        a[i] = a[j];
        a[j] = t;
        i++;
        j--;
      }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else break;
  }
  return a[k];
}

/** Percentile of a scratch array that may be reordered. */
function percentileOfScratch(a, p) {
  const m = a.length;
  if (m === 0) return NaN;
  const pp = Math.min(100, Math.max(0, Number.isFinite(p) ? p : 50));
  const rank = (pp / 100) * (m - 1);
  const k = Math.floor(rank);
  const frac = rank - k;
  const vk = select(a, k);
  if (frac === 0 || k + 1 >= m) return vk;
  let next = Infinity;
  for (let i = k + 1; i < m; i++) if (a[i] < next) next = a[i];
  return vk + (next - vk) * frac;
}

/** Percentile of a sorted array. */
function percentileOfSorted(a, p) {
  const m = a.length;
  if (m === 0) return NaN;
  const pp = Math.min(100, Math.max(0, Number.isFinite(p) ? p : 50));
  const rank = (pp / 100) * (m - 1);
  const k = Math.floor(rank);
  const frac = rank - k;
  return k + 1 < m ? a[k] + (a[k + 1] - a[k]) * frac : a[k];
}

/** p-th percentile (0..100) of the usable pixels; NaN if there are none. */
export function percentile(data, mask, p) {
  return percentileOfScratch(validValues(data, mask), p);
}

/**
 * Robust location and scale: { median, sigma } with sigma = 1.4826 * MAD (the Gaussian-
 * equivalent standard deviation). Also returns `mad` and `n`, the number of usable pixels.
 */
export function robustStats(data, mask) {
  const a = validValues(data, mask);
  const n = a.length;
  if (n === 0) return { median: NaN, sigma: NaN, mad: NaN, n: 0 };
  const median = percentileOfScratch(a, 50);
  for (let i = 0; i < n; i++) a[i] = Math.abs(a[i] - median);
  const mad = percentileOfScratch(a, 50);
  return { median, sigma: 1.4826 * mad, mad, n };
}

/** Make sure a display range is finite and has vmax > vmin. */
function fixRange(vmin, vmax) {
  if (!Number.isFinite(vmin) || !Number.isFinite(vmax)) return [0, 1];
  if (vmax < vmin) {
    const t = vmin;
    vmin = vmax;
    vmax = t;
  }
  if (vmax === vmin) {
    const pad = Math.max(Math.abs(vmin) * 1e-3, 1e-6);
    return [vmin - pad, vmax + pad];
  }
  return [vmin, vmax];
}

/**
 * Display range from percentiles: [vmin, vmax] = the `lo` and `hi` percentiles of the usable
 * pixels. Always returns a finite range with vmax > vmin ([0, 1] when nothing is usable).
 */
export function autoRange(data, mask, { lo = 0.5, hi = 99.7 } = {}) {
  const a = validValues(data, mask);
  if (a.length === 0) return [0, 1];
  a.sort();
  return fixRange(percentileOfSorted(a, lo), percentileOfSorted(a, hi));
}

/**
 * IRAF-style zscale display range (as in DS9 and astropy's ZScaleInterval): sort a sample of
 * about `nSamples` pixels, fit a straight line to value against rank with iterative rejection,
 * and stretch the slope by 1 / contrast about the median. Good for sky-dominated images.
 */
export function zscaleRange(
  data,
  mask,
  { contrast = 0.25, nSamples = 1000, maxReject = 0.5, minPixels = 5, krej = 2.5, maxIterations = 5 } = {},
) {
  const all = validValues(data, mask);
  if (all.length === 0) return [0, 1];
  let samples = all;
  if (all.length > nSamples) {
    const stride = all.length / nSamples;
    samples = new Float64Array(nSamples);
    for (let i = 0; i < nSamples; i++) samples[i] = all[Math.floor(i * stride)];
  }
  samples.sort();
  const npix = samples.length;
  let vmin = samples[0];
  let vmax = samples[npix - 1];
  if (npix < minPixels) return fixRange(vmin, vmax);

  const minpix = Math.max(minPixels, Math.floor(npix * maxReject));
  const ngrow = Math.max(1, Math.floor(npix * 0.01));
  const bad = new Uint8Array(npix);
  const grown = new Uint8Array(npix);
  let ngood = npix;
  let lastNgood = npix + 1;
  let slope = 0;
  let intercept = 0;
  for (let iter = 0; iter < maxIterations; iter++) {
    if (ngood >= lastNgood || ngood < minpix) break;
    // Least-squares line through the good points: value = intercept + slope * rank.
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let sxy = 0;
    let cnt = 0;
    for (let i = 0; i < npix; i++) {
      if (bad[i]) continue;
      sx += i;
      sy += samples[i];
      sxx += i * i;
      sxy += i * samples[i];
      cnt++;
    }
    const den = cnt * sxx - sx * sx;
    slope = den !== 0 ? (cnt * sxy - sx * sy) / den : 0;
    intercept = (sy - slope * sx) / cnt;
    // Scatter of the good points about the fit.
    let s1 = 0;
    let s2 = 0;
    for (let i = 0; i < npix; i++) {
      if (bad[i]) continue;
      const r = samples[i] - (intercept + slope * i);
      s1 += r;
      s2 += r * r;
    }
    const mean = s1 / cnt;
    const threshold = krej * Math.sqrt(Math.max(0, s2 / cnt - mean * mean));
    for (let i = 0; i < npix; i++) {
      const r = samples[i] - (intercept + slope * i);
      if (r < -threshold || r > threshold) bad[i] = 1;
    }
    // Grow the rejected regions by ngrow pixels (box convolution, like IRAF).
    const half = ngrow >> 1;
    grown.fill(0);
    for (let i = 0; i < npix; i++) {
      if (!bad[i]) continue;
      const a = Math.max(0, i - half);
      const b = Math.min(npix - 1, i + (ngrow - 1 - half));
      for (let j = a; j <= b; j++) grown[j] = 1;
    }
    bad.set(grown);
    lastNgood = ngood;
    ngood = 0;
    for (let i = 0; i < npix; i++) if (!bad[i]) ngood++;
  }
  if (ngood >= minpix) {
    if (contrast > 0) slope /= contrast;
    const centre = (npix - 1) >> 1;
    const median = percentileOfSorted(samples, 50);
    vmin = Math.max(vmin, median - (centre - 1) * slope);
    vmax = Math.min(vmax, median + (npix - centre) * slope);
  }
  return fixRange(vmin, vmax);
}

/** Apply the shape of a stretch to t already clamped to 0..1. */
function shape(t, mode) {
  switch (mode) {
    case 'asinh':
      return Math.asinh(t / ASINH_SOFTENING) / ASINH_NORM;
    case 'log':
      return Math.log1p(LOG_CONTRAST * t) / LOG_NORM;
    case 'sqrt':
      return Math.sqrt(t);
    default:
      return t;
  }
}

/**
 * Map a value to 0..1 for display. mode: 'linear' | 'asinh' | 'log' | 'sqrt' (anything else is
 * linear). NaN gives 0. A degenerate range (vmax <= vmin or non-finite) gives 0.
 */
export function stretchValue(v, vmin, vmax, mode) {
  const span = vmax - vmin;
  if (!(span > 0) || span === Infinity) return 0;
  let t = (v - vmin) / span;
  if (!(t > 0)) return 0; // also catches NaN
  if (t > 1) t = 1;
  const s = shape(t, mode);
  return s > 1 ? 1 : s;
}

/**
 * Stretch a whole image into `out` (Float32Array of the same length, created if omitted).
 * Masked or non-finite pixels give 0. Convenience for renderers; same maths as stretchValue.
 */
export function stretchImage(data, mask, vmin, vmax, mode, out) {
  const n = data.length;
  const res = out || new Float32Array(n);
  for (let i = 0; i < n; i++) {
    res[i] = mask && mask[i] ? 0 : stretchValue(data[i], vmin, vmax, mode);
  }
  return res;
}
