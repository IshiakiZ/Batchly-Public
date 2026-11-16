// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// Colour maps, intensity stretches and the scalar-image -> RGBA renderer. No DOM, importable in Node.
//
// Contract:  COLORMAPS: { gray, heat, viridis, diverging };  applyColormap(name, t) -> [r, g, b]
// Extras:    COLORMAPS.grayinv, COLORMAP_NAMES, colormapLut, STRETCHES, stretchValue,
//            divergingValue, autoRange, displayRange, renderScalar, MASK_RGB, MASK_RGB_LIGHT,
//            isLightMap, maskColorFor
//
// Each COLORMAPS entry is a function t -> [r, g, b] (t in 0..1, integers 0..255) carrying
// `.id`, `.label`, `.stops` and `.diverging`, so it works both as a lookup table and as a menu item.

const clamp01 = (t) => (t > 0 ? (t < 1 ? t : 1) : 0); // NaN -> 0

function sampleStops(stops, t) {
  t = clamp01(t);
  let i = 1;
  while (i < stops.length - 1 && t > stops[i][0]) i++;
  const a = stops[i - 1];
  const b = stops[i];
  const span = b[0] - a[0];
  const f = span > 0 ? (t - a[0]) / span : 0;
  return [
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
    Math.round(a[3] + (b[3] - a[3]) * f),
  ];
}

function makeMap(id, label, stops, diverging = false) {
  const fn = (t) => sampleStops(stops, t);
  fn.id = id;
  fn.label = label;
  fn.stops = stops;
  fn.diverging = diverging;
  return fn;
}

export const COLORMAPS = {
  gray: makeMap('gray', 'Gray', [
    [0, 0, 0, 0],
    [1, 255, 255, 255],
  ]),
  grayinv: makeMap('grayinv', 'Inverted gray', [
    [0, 255, 255, 255],
    [1, 0, 0, 0],
  ]),
  heat: makeMap('heat', 'Heat', [
    [0, 0, 0, 0],
    [0.28, 138, 20, 12],
    [0.52, 229, 78, 24],
    [0.74, 250, 164, 44],
    [0.9, 255, 228, 132],
    [1, 255, 255, 246],
  ]),
  // Nine samples of viridis (van der Walt & Smith), linearly interpolated.
  viridis: makeMap('viridis', 'Viridis', [
    [0, 68, 1, 84],
    [0.125, 71, 44, 122],
    [0.25, 59, 81, 139],
    [0.375, 44, 113, 142],
    [0.5, 33, 144, 141],
    [0.625, 39, 173, 129],
    [0.75, 92, 200, 99],
    [0.875, 170, 220, 50],
    [1, 253, 231, 37],
  ]),
  // Blue - black - red. t = 0.5 is zero: black, so "nothing left over" looks like empty sky.
  diverging: makeMap(
    'diverging',
    'Residual (blue-black-red)',
    [
      [0, 176, 222, 255],
      [0.2, 74, 150, 245],
      [0.38, 22, 62, 150],
      [0.5, 8, 8, 9],
      [0.62, 150, 30, 18],
      [0.8, 235, 76, 40],
      [1, 255, 214, 176],
    ],
    true,
  ),
};

export const COLORMAP_NAMES = Object.keys(COLORMAPS);

/** Colour for a normalised value t in 0..1. Unknown names fall back to gray; NaN maps to t = 0. */
export function applyColormap(name, t) {
  const map = COLORMAPS[name] || COLORMAPS.gray;
  return map(t);
}

const lutCache = new Map();

/** A cached lookup table: Uint8ClampedArray(size * 3) of r, g, b for t = i / (size - 1). */
export function colormapLut(name, size = 256) {
  const id = COLORMAPS[name] ? name : 'gray';
  const key = `${id}:${size}`;
  let lut = lutCache.get(key);
  if (!lut) {
    lut = new Uint8ClampedArray(size * 3);
    const map = COLORMAPS[id];
    for (let i = 0; i < size; i++) {
      const c = map(i / (size - 1));
      lut[i * 3] = c[0];
      lut[i * 3 + 1] = c[1];
      lut[i * 3 + 2] = c[2];
    }
    lutCache.set(key, lut);
  }
  return lut;
}

export const STRETCHES = ['linear', 'asinh', 'log', 'sqrt'];

const ASINH_A = 10;
const ASINH_NORM = Math.asinh(ASINH_A);
const LOG_A = 1000;
const LOG_NORM = Math.log1p(LOG_A);

function modeCode(mode) {
  return mode === 'asinh' ? 1 : mode === 'log' ? 2 : mode === 'sqrt' ? 3 : 0;
}

// t already clamped to 0..1
function stretchUnit(t, code) {
  switch (code) {
    case 1:
      return Math.asinh(t * ASINH_A) / ASINH_NORM;
    case 2:
      return Math.log1p(t * LOG_A) / LOG_NORM;
    case 3:
      return Math.sqrt(t);
    default:
      return t;
  }
}

/** Map a value to 0..1. mode: 'linear' | 'asinh' | 'log' | 'sqrt'. Non-finite input gives 0. */
export function stretchValue(v, vmin, vmax, mode = 'linear') {
  const span = vmax - vmin;
  if (!(span > 0)) return v > vmin ? 1 : 0;
  return stretchUnit(clamp01((v - vmin) / span), modeCode(mode));
}

/** Symmetric stretch for residuals: 0 -> 0.5, +vmax -> 1, -vmax -> 0, stretch applied to |v|. */
export function divergingValue(v, vmax, mode = 'linear') {
  if (!(vmax > 0) || !(v === v)) return 0.5;
  const s = stretchUnit(clamp01(Math.abs(v) / vmax), modeCode(mode));
  return v < 0 ? 0.5 - 0.5 * s : 0.5 + 0.5 * s;
}

function finiteSorted(image, mask, abs) {
  const tmp = new Float32Array(image.length);
  let m = 0;
  for (let i = 0; i < image.length; i++) {
    const v = image[i];
    if (mask && mask[i]) continue;
    if (v - v !== 0) continue; // NaN or +-Infinity
    tmp[m++] = abs ? Math.abs(v) : v;
  }
  return tmp.subarray(0, m).sort();
}

function quantile(sorted, p) {
  const m = sorted.length;
  if (!m) return NaN;
  const pos = (Math.min(Math.max(p, 0), 100) / 100) * (m - 1);
  const i = Math.floor(pos);
  const f = pos - i;
  return i + 1 < m ? sorted[i] + (sorted[i + 1] - sorted[i]) * f : sorted[i];
}

/**
 * Percentile display range over unmasked, finite pixels. Returns [vmin, vmax] with vmax > vmin.
 * With diverging: true the range is symmetric, [-m, m], m = the `hi` percentile of |v|.
 */
export function autoRange(image, mask, { lo = 0.5, hi = 99.7, diverging = false } = {}) {
  if (!image || !image.length) return diverging ? [-1, 1] : [0, 1];
  const sorted = finiteSorted(image, mask, diverging);
  if (!sorted.length) return diverging ? [-1, 1] : [0, 1];
  if (diverging) {
    let m = quantile(sorted, hi);
    if (!(m > 0)) m = sorted[sorted.length - 1] > 0 ? sorted[sorted.length - 1] : 1;
    return [-m, m];
  }
  let a = quantile(sorted, lo);
  let b = quantile(sorted, hi);
  if (!(b > a)) {
    a = sorted[0];
    b = sorted[sorted.length - 1];
  }
  if (!(b > a)) {
    const pad = Math.abs(a) > 0 ? Math.abs(a) * 0.5 : 0.5;
    a -= pad;
    b += pad;
  }
  return [a, b];
}

/** The range actually drawn: unchanged for ordinary maps, symmetric about zero for diverging ones. */
export function displayRange(range, diverging) {
  let a = Number(range && range[0]);
  let b = Number(range && range[1]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return diverging ? [-1, 1] : [0, 1];
  if (diverging) {
    const m = Math.max(Math.abs(a), Math.abs(b)) || 1;
    return [-m, m];
  }
  if (b < a) [a, b] = [b, a];
  if (b === a) b = a + (Math.abs(a) || 1) * 1e-6;
  return [a, b];
}

/** Flat colour used under the hatch for missing pixels (between Ink and Stone; never a data colour). */
export const MASK_RGB = [34, 34, 31];
/** The same for maps whose background is light (inverted gray), where a dark pixel would read as a source. */
export const MASK_RGB_LIGHT = [186, 182, 170];

/** True when the low end of a colormap is light, i.e. empty sky is drawn bright. */
export function isLightMap(name) {
  const map = COLORMAPS[name] || COLORMAPS.gray;
  const c = map(map.diverging ? 0.5 : 0); // where empty sky sits
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] > 140;
}

/** Missing-pixel colour to use with a colormap. */
export function maskColorFor(name) {
  return isLightMap(name) ? MASK_RGB_LIGHT : MASK_RGB;
}

const LUT_SIZE = 1024;

/**
 * Render an n x n scalar image to RGBA bytes.
 *   image      Float32Array(n*n), grid order (row 0 = south)
 *   mask       optional Uint8Array(n*n), non-zero = unusable
 *   range      [vmin, vmax] (made symmetric about zero when diverging)
 *   stretch    'linear' | 'asinh' | 'log' | 'sqrt'
 *   colormap   key of COLORMAPS
 *   diverging  centre the map on zero
 *   flipY      write row 0 of the array at the BOTTOM of the output (north up). Default true.
 *   out        optional Uint8ClampedArray(n*n*4) to fill
 *   missing    optional Uint8Array(n*n) filled, in OUTPUT order, with 1 where the pixel is masked
 *              or non-finite
 *   maskRgb    colour for missing pixels; default maskColorFor(colormap)
 * Returns the RGBA array. Missing pixels get the mask colour, never a colour from the map.
 */
export function renderScalar({
  image,
  mask = null,
  n,
  range,
  stretch = 'linear',
  colormap = 'gray',
  diverging = false,
  flipY = true,
  out = null,
  missing = null,
  maskRgb = null,
}) {
  const total = n * n;
  const rgba = out && out.length === total * 4 ? out : new Uint8ClampedArray(total * 4);
  const lut = colormapLut(colormap, LUT_SIZE);
  const top = LUT_SIZE - 1;
  const [vmin, vmax] = displayRange(range, diverging);
  const span = vmax - vmin;
  const code = modeCode(stretch);
  const useMask = mask && mask.length >= total ? mask : null;
  const have = image && image.length >= total;
  const [mr, mg, mb] = maskRgb || maskColorFor(colormap);
  for (let y = 0; y < n; y++) {
    const src = y * n;
    const dst = (flipY ? n - 1 - y : y) * n;
    for (let x = 0; x < n; x++) {
      const v = have ? image[src + x] : NaN;
      const o = (dst + x) * 4;
      if ((useMask && useMask[src + x]) || v - v !== 0) {
        rgba[o] = mr;
        rgba[o + 1] = mg;
        rgba[o + 2] = mb;
        rgba[o + 3] = 255;
        if (missing) missing[dst + x] = 1;
        continue;
      }
      let t;
      if (diverging) {
        const s = stretchUnit(clamp01(Math.abs(v) / vmax), code);
        t = v < 0 ? 0.5 - 0.5 * s : 0.5 + 0.5 * s;
      } else {
        t = stretchUnit(clamp01((v - vmin) / span), code);
      }
      const j = ((t * top + 0.5) | 0) * 3;
      rgba[o] = lut[j];
      rgba[o + 1] = lut[j + 1];
      rgba[o + 2] = lut[j + 2];
      rgba[o + 3] = 255;
      if (missing) missing[dst + x] = 0;
    }
  }
  return rgba;
}
