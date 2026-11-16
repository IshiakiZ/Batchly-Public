// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// frame.js: the pure half of the export plugin. No DOM, imports in Node unchanged.
//
//   renderFrameRgba(frame, { stretch = 'asinh', colormap, out }) -> { data: Uint8ClampedArray(n*n*4), n }
//       Draws a MovieFrame the way the viewer does, without the viewer: stretch over frame.range
//       (asinh by default; two-sided frames are always linear, as in the shell, so zero stays
//       neutral), gray colormap, blue-black-red centred on zero when frame.diverging, masked or
//       non-finite pixels in a flat dark colour, colour frames from frame.rgba or frame.rgb.
//       Grid arrays have row 0 in the south, so rows are flipped: the output is north up, east
//       left. `colormap` is optional: a function t (0..1) -> [r, g, b] used instead of gray.
//   upscaleNearest(rgba, n, size, out) -> Uint8ClampedArray(size*size*4)    crisp enlargement
//   frameSize(frame) -> n;  frameCaption(frame) -> { title, date, wave, note } as strings
//   exportFileName({ target, view, ext, suffix }) -> 'tombaugh_<name-or-coords>_<view>[_suffix].ext'
//   spectrumCsv(points) -> text with columns wave_um, flux_uJy, err_uJy, mjd, det, flagged
//   shareLink(href, state, index) -> URL text;  formatCoords(ra, dec);  formatBytes(n)
//   dataUrlToBytes(dataUrl) -> { bytes, type } | null;  defaultFps(frameCount)

export const MASK_RGB = [34, 34, 31]; // between Ink and Stone, the same as the viewer
export const MASK_RGB_LIGHT = [186, 182, 170]; // for colormaps whose empty sky is light
export const STRETCHES = ['linear', 'asinh', 'log', 'sqrt'];
export const CSV_HEADER = 'wave_um,flux_uJy,err_uJy,mjd,det,flagged';
export const MICRON = 'µm';

const ASINH_A = 10;
const ASINH_NORM = Math.asinh(ASINH_A);
const LOG_A = 1000;
const LOG_NORM = Math.log1p(LOG_A);

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp01 = (t) => (t > 0 ? (t < 1 ? t : 1) : 0); // NaN -> 0

/** Stretch a clamped 0..1 value. Same curves as web/src/core/stretch.js. */
export function stretchUnit(t, mode) {
  const u = clamp01(t);
  switch (mode) {
    case 'asinh':
      return Math.asinh(u * ASINH_A) / ASINH_NORM;
    case 'log':
      return Math.log1p(u * LOG_A) / LOG_NORM;
    case 'sqrt':
      return Math.sqrt(u);
    default:
      return u;
  }
}

// Blue - black - red, zero in the middle: the viewer's residual map.
const DIVERGING_STOPS = [
  [0, 176, 222, 255],
  [0.2, 74, 150, 245],
  [0.38, 22, 62, 150],
  [0.5, 8, 8, 9],
  [0.62, 150, 30, 18],
  [0.8, 235, 76, 40],
  [1, 255, 214, 176],
];

/** Colour of the diverging map at t in 0..1 (0.5 = zero = black). */
export function divergingRgb(t) {
  const u = clamp01(t);
  let i = 1;
  while (i < DIVERGING_STOPS.length - 1 && u > DIVERGING_STOPS[i][0]) i++;
  const a = DIVERGING_STOPS[i - 1];
  const b = DIVERGING_STOPS[i];
  const f = b[0] > a[0] ? (u - a[0]) / (b[0] - a[0]) : 0;
  return [Math.round(a[1] + (b[1] - a[1]) * f), Math.round(a[2] + (b[2] - a[2]) * f), Math.round(a[3] + (b[3] - a[3]) * f)];
}

const LUT_SIZE = 1025; // odd, so that zero lands exactly on the neutral middle entry
let divergingLut = null;
function getDivergingLut() {
  if (!divergingLut) {
    divergingLut = new Uint8Array(LUT_SIZE * 3);
    for (let i = 0; i < LUT_SIZE; i++) divergingLut.set(divergingRgb(i / (LUT_SIZE - 1)), i * 3);
  }
  return divergingLut;
}

const GRAY_LUT = new Uint8Array(256 * 3);
for (let i = 0; i < 256; i++) GRAY_LUT[i * 3] = GRAY_LUT[i * 3 + 1] = GRAY_LUT[i * 3 + 2] = i;
const mapLuts = new WeakMap();

/** 256-entry r, g, b table for a colormap function; gray when there is none or it misbehaves. */
function colormapLut(colormap) {
  if (typeof colormap !== 'function') return GRAY_LUT;
  let lut = mapLuts.get(colormap);
  if (!lut) {
    lut = new Uint8Array(256 * 3);
    try {
      for (let i = 0; i < 256; i++) {
        const c = colormap(i / 255);
        lut[i * 3] = c[0];
        lut[i * 3 + 1] = c[1];
        lut[i * 3 + 2] = c[2];
      }
    } catch {
      lut = GRAY_LUT;
    }
    mapLuts.set(colormap, lut);
  }
  return lut;
}

/** Side length of a MovieFrame's square arrays (0 if it has none). */
export function frameSize(frame) {
  if (!frame) return 0;
  if (frame.rgba && frame.rgba.length >= 4) return Math.floor(Math.sqrt(frame.rgba.length / 4) + 1e-9);
  const arr = frame.image || (frame.rgb && (frame.rgb.r || frame.rgb.g || frame.rgb.b));
  if (!arr || !arr.length) return 0;
  return Math.floor(Math.sqrt(arr.length) + 1e-9);
}

/** True when a MovieFrame has something that can be drawn. */
export function isDrawable(frame) {
  return frameSize(frame) > 0;
}

function percentileRange(image, mask, total, lo, hi, absolute) {
  const tmp = new Float32Array(total);
  let m = 0;
  for (let i = 0; i < total; i++) {
    const v = image[i];
    if ((mask && mask[i]) || v - v !== 0) continue;
    tmp[m++] = absolute ? Math.abs(v) : v;
  }
  if (!m) return absolute ? [-1, 1] : [0, 1];
  const sorted = tmp.subarray(0, m).sort();
  const at = (p) => {
    const pos = (p / 100) * (m - 1);
    const i = Math.floor(pos);
    return i + 1 < m ? sorted[i] + (sorted[i + 1] - sorted[i]) * (pos - i) : sorted[i];
  };
  if (absolute) {
    let top = at(hi);
    if (!(top > 0)) top = sorted[m - 1] > 0 ? sorted[m - 1] : 1;
    return [-top, top];
  }
  let a = at(lo);
  let b = at(hi);
  if (!(b > a)) {
    a = sorted[0];
    b = sorted[m - 1];
  }
  if (!(b > a)) b = a + (Math.abs(a) || 1) * 0.5;
  return [a, b];
}

/** The range actually drawn: frame.range when usable, else percentiles of the good pixels. */
export function displayRange(frame, image, mask, total, diverging) {
  const r = frame && frame.range;
  let a = r ? Number(r[0]) : NaN;
  let b = r ? Number(r[1]) : NaN;
  if (!Number.isFinite(a) || !Number.isFinite(b)) [a, b] = percentileRange(image, mask, total, 0.5, 99.7, diverging);
  if (diverging) {
    const m = Math.max(Math.abs(a), Math.abs(b)) || 1;
    return [-m, m];
  }
  if (b < a) [a, b] = [b, a];
  if (b === a) b = a + (Math.abs(a) || 1) * 1e-6;
  return [a, b];
}

/**
 * MovieFrame -> RGBA, north up. Never throws on bad pixels; a frame with nothing drawable gives
 * a 1 x 1 dark image.
 */
export function renderFrameRgba(frame, { stretch = 'asinh', colormap = null, out = null } = {}) {
  const n = frameSize(frame);
  if (!n) return { data: new Uint8ClampedArray([MASK_RGB[0], MASK_RGB[1], MASK_RGB[2], 255]), n: 1 };
  const total = n * n;
  const data = out && out.length === total * 4 ? out : new Uint8ClampedArray(total * 4);
  const mode = STRETCHES.includes(stretch) ? stretch : 'asinh';
  const mask = frame.mask && frame.mask.length >= total ? frame.mask : null;
  const scalar = !frame.rgba && !(frame.rgb && (frame.rgb.r || frame.rgb.g || frame.rgb.b));
  const mapLut = scalar && !frame.diverging ? colormapLut(colormap) : GRAY_LUT;
  // Where empty sky is drawn light, a dark "missing" colour would read as a source.
  const lightSky = 0.2126 * mapLut[0] + 0.7152 * mapLut[1] + 0.0722 * mapLut[2] > 140;
  const [mr, mg, mb] = lightSky ? MASK_RGB_LIGHT : MASK_RGB;

  // Colour frame already composed by the pipeline (grid order, row 0 = south).
  if (frame.rgba && frame.rgba.length >= total * 4) {
    const src = frame.rgba;
    for (let y = 0; y < n; y++) {
      const srow = y * n;
      const drow = (n - 1 - y) * n;
      for (let x = 0; x < n; x++) {
        const s = (srow + x) * 4;
        const d = (drow + x) * 4;
        if ((mask && mask[srow + x]) || src[s + 3] === 0) {
          data[d] = mr;
          data[d + 1] = mg;
          data[d + 2] = mb;
        } else {
          data[d] = src[s];
          data[d + 1] = src[s + 1];
          data[d + 2] = src[s + 2];
        }
        data[d + 3] = 255;
      }
    }
    return { data, n };
  }

  // Colour frame from three scalar planes.
  if (frame.rgb && (frame.rgb.r || frame.rgb.g || frame.rgb.b)) {
    const planes = [frame.rgb.r, frame.rgb.g, frame.rgb.b];
    const ranges = planes.map((plane, c) => {
      if (!plane || plane.length < total) return [0, 1];
      const given = frame.rgb.ranges && frame.rgb.ranges[c];
      return displayRange({ range: given }, plane, mask, total, false);
    });
    for (let y = 0; y < n; y++) {
      const srow = y * n;
      const drow = (n - 1 - y) * n;
      for (let x = 0; x < n; x++) {
        const s = srow + x;
        const d = (drow + x) * 4;
        let bad = !!(mask && mask[s]);
        const px = [0, 0, 0];
        for (let c = 0; c < 3 && !bad; c++) {
          const plane = planes[c];
          if (!plane || plane.length < total) continue; // a missing plane stays black
          const v = plane[s];
          if (v - v !== 0) bad = true;
          else px[c] = Math.round(255 * stretchUnit((v - ranges[c][0]) / (ranges[c][1] - ranges[c][0]), mode));
        }
        if (bad) {
          data[d] = mr;
          data[d + 1] = mg;
          data[d + 2] = mb;
        } else {
          data[d] = px[0];
          data[d + 1] = px[1];
          data[d + 2] = px[2];
        }
        data[d + 3] = 255;
      }
    }
    return { data, n };
  }

  // Scalar frame.
  const image = frame.image;
  const diverging = !!frame.diverging;
  const [vmin, vmax] = displayRange(frame, image, mask, total, diverging);
  const span = vmax - vmin;
  const lut = diverging ? getDivergingLut() : null;
  for (let y = 0; y < n; y++) {
    const srow = y * n;
    const drow = (n - 1 - y) * n;
    for (let x = 0; x < n; x++) {
      const v = image[srow + x];
      const d = (drow + x) * 4;
      data[d + 3] = 255;
      if ((mask && mask[srow + x]) || v - v !== 0) {
        data[d] = mr;
        data[d + 1] = mg;
        data[d + 2] = mb;
        continue;
      }
      if (diverging) {
        const s = clamp01(Math.abs(v) / vmax); // linear: zero stays neutral, noise is not amplified
        const t = v < 0 ? 0.5 - 0.5 * s : 0.5 + 0.5 * s;
        const j = ((t * (LUT_SIZE - 1) + 0.5) | 0) * 3;
        data[d] = lut[j];
        data[d + 1] = lut[j + 1];
        data[d + 2] = lut[j + 2];
      } else {
        const j = Math.round(255 * stretchUnit((v - vmin) / span, mode)) * 3;
        data[d] = mapLut[j];
        data[d + 1] = mapLut[j + 1];
        data[d + 2] = mapLut[j + 2];
      }
    }
  }
  return { data, n };
}

/** Nearest-neighbour enlargement of a square RGBA image to size x size. */
export function upscaleNearest(rgba, n, size, out = null) {
  const s = Math.max(1, Math.round(size));
  const dst = out && out.length === s * s * 4 && out.byteOffset % 4 === 0 ? out : new Uint8ClampedArray(s * s * 4);
  if (rgba.byteOffset % 4 !== 0) rgba = rgba.slice(0, n * n * 4); // 32-bit views need alignment
  const src32 = new Uint32Array(rgba.buffer, rgba.byteOffset, n * n);
  const dst32 = new Uint32Array(dst.buffer, dst.byteOffset, s * s);
  const col = new Int32Array(s);
  for (let x = 0; x < s; x++) col[x] = Math.min(n - 1, Math.floor(((x + 0.5) * n) / s));
  let lastRow = -1;
  for (let y = 0; y < s; y++) {
    const sy = Math.min(n - 1, Math.floor(((y + 0.5) * n) / s));
    const drow = y * s;
    if (sy === lastRow) {
      dst32.copyWithin(drow, drow - s, drow); // same source row as the line above
      continue;
    }
    const srow = sy * n;
    for (let x = 0; x < s; x++) dst32[drow + x] = src32[srow + col[x]];
    lastRow = sy;
  }
  return dst;
}

// ---------------------------------------------------------------------------------------------
// Text

function pad2(v) {
  return v < 10 ? `0${v}` : String(v);
}

/** MJD -> 'YYYY-MM-DD' or 'YYYY-MM-DD HH:MM' (UTC); '' when not a usable number. */
export function mjdToText(mjd, withTime = false) {
  if (!isNum(mjd)) return '';
  const d = new Date(Math.round((mjd - 40587) * 86400000));
  if (Number.isNaN(d.getTime())) return '';
  const day = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  return withTime ? `${day} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}` : day;
}

const text = (v) => (v === null || v === undefined ? '' : String(v).trim());

/** Caption of a MovieFrame as plain strings (numbers are formatted, missing parts are ''). */
export function frameCaption(frame) {
  const c = (frame && frame.caption) || {};
  let date = typeof c.date === 'number' ? mjdToText(c.date, true) : text(c.date);
  if (!date && frame && isNum(frame.mjd)) date = mjdToText(frame.mjd);
  const wave = typeof c.wave === 'number' ? (isNum(c.wave) ? `${c.wave.toFixed(3)} ${MICRON}` : '') : text(c.wave);
  return { title: text(c.title), date, wave, note: text(c.note) };
}

/** 'RA 269.4521 Dec +4.6934' with degree signs; '' when either is missing. */
export function formatCoords(ra, dec) {
  if (!isNum(ra) || !isNum(dec)) return '';
  return `RA ${ra.toFixed(4)}°  Dec ${dec >= 0 ? '+' : '−'}${Math.abs(dec).toFixed(4)}°`;
}

export function formatBytes(bytes) {
  if (!isNum(bytes) || bytes < 0) return '';
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1e6) return `${Math.round(bytes / 1000)} kB`;
  return `${(bytes / 1e6).toFixed(bytes < 1e7 ? 2 : 1)} MB`;
}

/** Lower-case ASCII slug for file names: "Barnard's Star" -> "barnards-star". */
export function slug(value, max = 40) {
  let s = text(value);
  try {
    s = s.normalize('NFKD');
  } catch {
    // very old engines: keep the text as it is
  }
  s = s
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’`]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9.+]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  if (s.length > max) s = s.slice(0, max).replace(/[-.]+$/g, '');
  return s;
}

/** '269.4521+4.6934' (always signed declination); '' when either is missing. */
export function coordSlug(ra, dec) {
  if (!isNum(ra) || !isNum(dec)) return '';
  return `${ra.toFixed(4)}${dec >= 0 ? '+' : '-'}${Math.abs(dec).toFixed(4)}`;
}

/** tombaugh_<name-or-coords>_<view>[_suffix].<ext> */
export function exportFileName({ target = null, view = '', ext = 'png', suffix = '' } = {}) {
  const who = (target && slug(target.name)) || (target && coordSlug(target.ra, target.dec)) || 'sky';
  const parts = ['tombaugh', who];
  const v = slug(view, 24);
  if (v) parts.push(v);
  const s = slug(suffix, 24);
  if (s) parts.push(s);
  return `${parts.join('_')}.${slug(ext, 8) || 'bin'}`;
}

// ---------------------------------------------------------------------------------------------
// Data

// Upper wavelength edge of detectors 1..5 (um); longer is detector 6.
const DET_EDGES = [1.095, 1.625, 2.415, 3.825, 4.415];

function detectorOf(wave) {
  if (!isNum(wave) || wave < 0.7 || wave > 5.1) return '';
  let det = 1;
  for (const edge of DET_EDGES) if (wave > edge) det++;
  return det;
}

function csvNumber(v, digits) {
  if (!isNum(v)) return '';
  return String(Number(v.toPrecision(digits)));
}

/**
 * Spectrum points -> CSV. One row per point that has a wavelength, in the order given.
 * Columns: wave_um, flux_uJy, err_uJy, mjd, det, flagged (1 or 0). Missing numbers are empty.
 * `det` is taken from the point, else from its wavelength.
 */
export function spectrumCsv(points) {
  const rows = [CSV_HEADER];
  for (const p of Array.isArray(points) ? points : []) {
    if (!p || !isNum(p.wave)) continue;
    const det = isNum(p.det) ? Math.round(p.det) : detectorOf(p.wave);
    rows.push(
      [
        csvNumber(p.wave, 7),
        csvNumber(p.flux_uJy, 7),
        csvNumber(p.err_uJy, 5),
        isNum(p.mjd) ? p.mjd.toFixed(5) : '',
        det,
        p.flagged ? 1 : 0,
      ].join(','),
    );
  }
  return `${rows.join('\n')}\n`;
}

/** Number of data rows spectrumCsv would write. */
export function spectrumRowCount(points) {
  let n = 0;
  for (const p of Array.isArray(points) ? points : []) if (p && isNum(p.wave)) n++;
  return n;
}

// URL state keys of CONTRACT.md and the values the shell leaves out of the address.
const URL_DEFAULTS = { ra: null, dec: null, name: '', fov: 4, det: 3, view: 'passes', ch: 8, lens: 'methane', dist: Infinity, stretch: 'asinh', gaia: true, flags: false };

/**
 * A link to what is on screen: the page address with the URL state keys taken from `state`
 * (the shell writes its address a moment after the state changes, so the state wins; keys the
 * state does not have are left as the address has them; default values are left out) and the
 * frame index as `t`. Returns '' when the page has no http(s) address.
 */
export function shareLink(href, state = null, index = null) {
  let url;
  try {
    url = new URL(href);
  } catch {
    return '';
  }
  if (!/^https?:$/.test(url.protocol)) return '';
  const st = state && typeof state === 'object' ? state : {};
  for (const key of Object.keys(URL_DEFAULTS)) {
    if (!(key in st) || st[key] === undefined) continue;
    const v = st[key];
    let out = '';
    if (typeof v === 'number' && Number.isFinite(v)) out = key === 'ra' || key === 'dec' ? String(Number(v.toFixed(5))) : String(v);
    else if (typeof v === 'boolean') out = v ? '1' : '0';
    else if (typeof v === 'string') out = v;
    const isDefault = v === URL_DEFAULTS[key] || (key === 'dist' && !(v > 0));
    if (out === '' || isDefault) url.searchParams.delete(key);
    else url.searchParams.set(key, out);
  }
  if (isNum(index)) {
    if (index > 0) url.searchParams.set('t', String(Math.round(index)));
    else url.searchParams.delete('t');
  }
  url.hash = '';
  return url.toString();
}

/** data: URL (base64 or percent-encoded) -> bytes and media type; null when it is not one. */
export function dataUrlToBytes(dataUrl) {
  if (typeof dataUrl !== 'string') return null;
  const m = /^data:([^;,]*)((?:;[^;,]*)*),/.exec(dataUrl);
  if (!m) return null;
  const body = dataUrl.slice(m[0].length);
  try {
    if (/;base64$/i.test(m[2])) {
      const bin = atob(body);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return { bytes, type: m[1] || 'application/octet-stream' };
    }
    return { bytes: new TextEncoder().encode(decodeURIComponent(body)), type: m[1] || 'text/plain' };
  } catch {
    return null;
  }
}

/** A sensible playback speed for a movie of this many frames: blink slowly, flip fast. */
export function defaultFps(frameCount) {
  if (!(frameCount > 6)) return 2;
  return frameCount > 30 ? 8 : 4;
}
