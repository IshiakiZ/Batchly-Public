// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// Shared helpers for the three plots (spectrum, light curve, motion meter).
//
// The file has two halves:
//   1. Pure math (ticks, scales, number and date formatting, unit conversion, small statistics).
//      No DOM access; everything here is unit-tested in svg.test.js under Node.
//   2. Tiny DOM helpers (create SVG/HTML elements, tooltip, hover tracking, resize watching).
//      They only touch `document` / `window` when they are called, never at import time, so the
//      module imports cleanly in Node.
//
// A few constants duplicate web/src/core (DETECTORS, splitPasses, MJD conversion) on purpose: the
// plots module is self-contained and has no imports outside web/src/plots/.

// ---------------------------------------------------------------------------------------------
// Brand and palette
// ---------------------------------------------------------------------------------------------

export const INK = '#171715';
export const PAPER = '#F7F2E7';
export const STONE = '#77766E';
export const SIGNAL = '#E53C27';

export const FONT_NUM = 'Consolas, "Cascadia Mono", Menlo, "DejaVu Sans Mono", monospace';
export const FONT_TXT = 'Arial, Helvetica, sans-serif';

/** Survey-pass colours. The first three are colour-blind safe against each other for scattered
 * marks on Ink (checked for all pairs under protan/deutan simulation); the fourth is told apart
 * by its diamond marker as well, and later passes fold into a neutral "later" slot. */
export const PASS_COLORS = ['#3987E5', '#C98500', '#199E70', '#D55181'];
export const PASS_LATER_COLOR = '#A8A69C';

/** Wavelength colour ramp for the light curve: short = blue, long = amber, pale in the middle.
 * It avoids red so that Signal keeps its meaning. */
export const WAVE_RAMP = [
  { t: 0, rgb: [57, 135, 229] },
  { t: 0.5, rgb: [207, 200, 182] },
  { t: 1, rgb: [217, 138, 28] },
];

export const WAVE_MIN = 0.7;
export const WAVE_MAX = 5.1;

/** SPHEREx detector bands in micrometres (same numbers as core/frames.js DETECTORS). */
export const DETECTORS = [
  { det: 1, min: 0.75, max: 1.09 },
  { det: 2, min: 1.10, max: 1.62 },
  { det: 3, min: 1.63, max: 2.41 },
  { det: 4, min: 2.42, max: 3.82 },
  { det: 5, min: 3.83, max: 4.41 },
  { det: 6, min: 4.42, max: 5.00 },
];

/** Molecular features marked on the spectrum (micrometres). */
export const FEATURES = [
  { id: 'h2o14', label: 'H2O', wave: 1.4, note: 'Water vapour, 1.4 um' },
  { id: 'h2o19', label: 'H2O', wave: 1.9, note: 'Water vapour, 1.9 um' },
  { id: 'ice', label: 'ice', wave: 3.05, note: 'Water ice, 3.05 um' },
  { id: 'ch4', label: 'CH4', wave: 3.3, note: 'Methane, 3.3 um. PAH emission from dusty galaxies falls at 3.3 um too.' },
  { id: 'co2', label: 'CO2', wave: 4.27, note: 'Carbon dioxide, 4.27 um' },
  { id: 'co', label: 'CO', wave: 4.67, note: 'Carbon monoxide, 4.67 um' },
];

// ---------------------------------------------------------------------------------------------
// Pure math: small utilities
// ---------------------------------------------------------------------------------------------

export function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** [min, max] of the finite values, or null when there are none. */
export function extent(values) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (!isNum(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return lo <= hi ? [lo, hi] : null;
}

/** Linear-interpolated quantile (q in 0..1) of the finite values; NaN when empty. */
export function quantile(values, q) {
  const a = [];
  for (const v of values) if (isNum(v)) a.push(v);
  if (!a.length) return NaN;
  a.sort((x, y) => x - y);
  const pos = clamp(q, 0, 1) * (a.length - 1);
  const i = Math.floor(pos);
  const f = pos - i;
  return i + 1 < a.length ? a[i] * (1 - f) + a[i + 1] * f : a[i];
}

/**
 * Weighted mean with an honest error: the formal error 1/sqrt(sum w) is inflated by
 * sqrt(chi2_red) when the scatter is larger than the quoted errors. Points without a usable
 * error fall back to an unweighted mean with the standard error of the mean.
 * @returns {{ mean:number, err:number, n:number, chi2red:number }}
 */
export function weightedMean(values, errs) {
  const v = [];
  const e = [];
  for (let i = 0; i < values.length; i++) {
    if (!isNum(values[i])) continue;
    v.push(values[i]);
    e.push(errs && isNum(errs[i]) && errs[i] > 0 ? errs[i] : NaN);
  }
  const n = v.length;
  if (!n) return { mean: NaN, err: NaN, n: 0, chi2red: NaN };
  const weighted = e.every((x) => isNum(x));
  if (weighted) {
    let sw = 0;
    let swv = 0;
    for (let i = 0; i < n; i++) {
      const w = 1 / (e[i] * e[i]);
      sw += w;
      swv += w * v[i];
    }
    const mean = swv / sw;
    let chi2 = 0;
    for (let i = 0; i < n; i++) chi2 += ((v[i] - mean) / e[i]) ** 2;
    const chi2red = n > 1 ? chi2 / (n - 1) : 1;
    const err = Math.sqrt(1 / sw) * Math.sqrt(Math.max(1, chi2red));
    return { mean, err, n, chi2red };
  }
  let s = 0;
  for (const x of v) s += x;
  const mean = s / n;
  let ss = 0;
  for (const x of v) ss += (x - mean) ** 2;
  const err = n > 1 ? Math.sqrt(ss / (n - 1) / n) : NaN;
  return { mean, err, n, chi2red: NaN };
}

/** Sort items by .mjd and split them where the gap exceeds gapDays (same rule as core/frames.js). */
export function splitPasses(items, gapDays = 45) {
  const sorted = (items || []).filter((p) => p && isNum(p.mjd)).sort((a, b) => a.mjd - b.mjd);
  const out = [];
  let cur = null;
  let last = -Infinity;
  for (const it of sorted) {
    if (!cur || it.mjd - last > gapDays) {
      cur = [];
      out.push(cur);
    }
    cur.push(it);
    last = it.mjd;
  }
  return out;
}

/** Detector number (1-6) for a wavelength, or 0 when it falls outside every band. Gaps between
 * bands are assigned to the nearer band so that edge channels still get a detector. */
export function detectorOf(wave) {
  if (!isNum(wave)) return 0;
  let best = 0;
  let bestDist = 0.03;
  for (const d of DETECTORS) {
    if (wave >= d.min && wave <= d.max) return d.det;
    const dist = wave < d.min ? d.min - wave : wave - d.max;
    if (dist < bestDist) {
      bestDist = dist;
      best = d.det;
    }
  }
  return best;
}

/** Position angle in degrees, measured from north through east, 0..360. */
export function positionAngle(pmra, pmdec) {
  if (!isNum(pmra) || !isNum(pmdec) || (pmra === 0 && pmdec === 0)) return NaN;
  const pa = (Math.atan2(pmra, pmdec) * 180) / Math.PI;
  return (pa + 360) % 360;
}

// ---------------------------------------------------------------------------------------------
// Pure math: ticks and scales
// ---------------------------------------------------------------------------------------------

/** A "nice" step (1, 2 or 5 times a power of ten) that divides span into about `count` parts
 * (the nearest nice step, so the tick count can be one or two off). */
export function niceStep(span, count = 5) {
  if (!isNum(span) || span <= 0) return 1;
  const raw = span / Math.max(1, count);
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  const nice = f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10;
  return nice * pow;
}

function stepDecimals(step) {
  return clamp(-Math.floor(Math.log10(step) + 1e-9), 0, 12);
}

/** Tick values on multiples of a nice step inside [min, max] (order of min/max does not matter). */
export function niceTicks(min, max, count = 5) {
  if (!isNum(min) || !isNum(max)) return [];
  if (min > max) [min, max] = [max, min];
  if (min === max) return [min];
  const step = niceStep(max - min, count);
  const dec = stepDecimals(step);
  const eps = step * 1e-9;
  const out = [];
  const i0 = Math.ceil((min - eps) / step);
  const i1 = Math.floor((max + eps) / step);
  for (let i = i0; i <= i1; i++) {
    const v = Number((i * step).toFixed(dec));
    out.push(v === 0 ? 0 : v);
  }
  return out;
}

/** [lo, hi] widened outwards to multiples of the nice step. */
export function niceDomain(min, max, count = 5) {
  if (!isNum(min) || !isNum(max)) return [0, 1];
  if (min > max) [min, max] = [max, min];
  if (min === max) {
    const pad = min === 0 ? 1 : Math.abs(min) * 0.1;
    return [min - pad, max + pad];
  }
  const step = niceStep(max - min, count);
  const dec = stepDecimals(step);
  const eps = step * 1e-9;
  return [
    Number((Math.floor((min + eps) / step) * step).toFixed(dec)),
    Number((Math.ceil((max - eps) / step) * step).toFixed(dec)),
  ];
}

/** Tick values for a logarithmic axis: decades, plus 2 and 5 when the range is short. */
export function logTicks(min, max) {
  if (!isNum(min) || !isNum(max) || min <= 0 || max <= 0) return [];
  if (min > max) [min, max] = [max, min];
  const e0 = Math.floor(Math.log10(min) + 1e-9);
  const e1 = Math.ceil(Math.log10(max) - 1e-9);
  const decades = Math.log10(max / min);
  const mult = decades > 3.05 ? [1] : decades > 1.6 ? [1, 3] : [1, 2, 5];
  const out = [];
  for (let e = e0; e <= e1; e++) {
    for (const m of mult) {
      const v = Number((m * 10 ** e).toPrecision(12));
      if (v >= min * (1 - 1e-9) && v <= max * (1 + 1e-9)) out.push(v);
    }
  }
  if (out.length < 2) return niceTicks(min, max, 4).filter((v) => v > 0);
  return out;
}

/** Linear scale. s(v) maps domain to range; s.invert goes back. Either end may be reversed. */
export function linearScale(d0, d1, r0, r1) {
  const span = d1 - d0 || 1;
  const s = (v) => r0 + ((v - d0) / span) * (r1 - r0);
  s.invert = (p) => d0 + ((p - r0) / (r1 - r0 || 1)) * span;
  s.domain = [d0, d1];
  s.range = [r0, r1];
  return s;
}

/** Logarithmic scale. Non-positive inputs map to NaN (the caller treats NaN as "not drawable"). */
export function logScale(d0, d1, r0, r1) {
  const l0 = Math.log10(d0);
  const l1 = Math.log10(d1);
  const span = l1 - l0 || 1;
  const s = (v) => (v > 0 ? r0 + ((Math.log10(v) - l0) / span) * (r1 - r0) : NaN);
  s.invert = (p) => 10 ** (l0 + ((p - r0) / (r1 - r0 || 1)) * span);
  s.domain = [d0, d1];
  s.range = [r0, r1];
  return s;
}

// ---------------------------------------------------------------------------------------------
// Pure math: number formatting
// ---------------------------------------------------------------------------------------------

function fixNegZero(s) {
  return /^-0(\.0*)?$/.test(s) ? s.slice(1) : s;
}

/** Fixed decimals; a negative `dec` rounds to tens, hundreds, ... (formatFixed(10128, -2) = "10100"). */
export function formatFixed(v, dec) {
  if (!isNum(v)) return '-';
  if (dec >= 0) return fixNegZero(v.toFixed(Math.min(dec, 12)));
  const p = 10 ** -dec;
  return fixNegZero(String(Math.round(v / p) * p));
}

/** Axis tick label with just enough decimals for the tick step. */
export function formatTick(v, step) {
  if (!isNum(v)) return '';
  const s = isNum(step) && step > 0 ? step : Math.abs(v) || 1;
  return formatFixed(v, stepDecimals(s));
}

/** Label for a log-axis tick: no trailing zeros, no exponent between 1e-6 and 1e9. */
export function formatLogTick(v) {
  if (!isNum(v)) return '';
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-6 || a >= 1e9)) return v.toExponential(0).replace('e+', 'e');
  return fixNegZero(String(Number(v.toPrecision(6))));
}

/** A number to `sig` significant figures without exponent and without trailing zeros.
 * Large values are rounded to an integer ("1235", not "1.23e3"). */
export function formatNumber(v, sig = 3) {
  if (!isNum(v)) return '-';
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 10 ** sig) return fixNegZero(String(Math.round(v)));
  if (a < 1e-6) return v.toExponential(Math.max(0, sig - 1));
  return fixNegZero(String(Number(v.toPrecision(sig))));
}

/** Decimal places that show an uncertainty to one significant figure (two when it starts with 1).
 * With sig = 2 the uncertainty always keeps two figures (used in tooltips).
 * Negative results mean rounding to tens, hundreds, ... */
export function errorDecimals(err, sig = 1) {
  if (!isNum(err) || err <= 0) return null;
  const e = Math.floor(Math.log10(err) + 1e-12);
  if (sig >= 2) return clamp(-e + (sig - 1), -9, 9);
  const round1 = Math.round(err / 10 ** e);
  // 0.96 rounds up to 1.0, which then keeps a second digit like any error starting with 1.
  const two = round1 === 1 || round1 === 10;
  const exp = round1 === 10 ? e + 1 : e;
  return clamp(-exp + (two ? 1 : 0), -9, 9);
}

/** "10.1 \u00B1 0.6" style pair. Returns { value, err, dec, text }. Without a usable error the
 * value is shown to three significant figures and err is ''. */
export function formatWithError(v, err, sig = 1) {
  const dec = errorDecimals(err, sig);
  if (dec === null) {
    const value = formatNumber(v, 3);
    return { value, err: '', dec: null, text: value };
  }
  const value = formatFixed(v, dec);
  const e = formatFixed(err, dec);
  return { value, err: e, dec, text: `${value} \u00B1 ${e}` };
}

// ---------------------------------------------------------------------------------------------
// Pure math: flux units
// ---------------------------------------------------------------------------------------------

/** Pick microJy, mJy or Jy for an axis whose largest value is maxAbs_uJy.
 * @returns {{ unit:'uJy'|'mJy'|'Jy', label:string, factor:number }} multiply microJy by factor */
export function fluxUnit(maxAbs_uJy) {
  const a = Math.abs(maxAbs_uJy);
  if (isNum(a) && a >= 1e6) return { unit: 'Jy', label: 'Jy', factor: 1e-6 };
  if (isNum(a) && a >= 1000) return { unit: 'mJy', label: 'mJy', factor: 1e-3 };
  return { unit: 'uJy', label: 'µJy', factor: 1 };
}

/** AB magnitude of a flux density in microJy (3631 Jy zero point); NaN for flux <= 0. */
export function uJyToAbMag(flux_uJy) {
  return isNum(flux_uJy) && flux_uJy > 0 ? 23.9 - 2.5 * Math.log10(flux_uJy) : NaN;
}

export function abMagToUJy(mag) {
  return isNum(mag) ? 10 ** ((23.9 - mag) / 2.5) : NaN;
}

/** First-order magnitude error for flux +/- err. */
export function abMagErr(flux_uJy, err_uJy) {
  if (!isNum(flux_uJy) || !isNum(err_uJy) || flux_uJy <= 0) return NaN;
  return (2.5 / Math.LN10) * (err_uJy / flux_uJy);
}

// ---------------------------------------------------------------------------------------------
// Pure math: dates
// ---------------------------------------------------------------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MJD_UNIX_EPOCH = 40587;

export function mjdToDate(mjd) {
  return new Date((mjd - MJD_UNIX_EPOCH) * 86400000);
}

export function dateToMjd(date) {
  return date.getTime() / 86400000 + MJD_UNIX_EPOCH;
}

function pad2(n) {
  return n < 10 ? `0${n}` : String(n);
}

/** "Jun 2025" (UTC). */
export function formatMonthYear(mjd) {
  if (!isNum(mjd)) return '';
  const d = mjdToDate(mjd);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "19 Jun 2025" (UTC). */
export function formatDayMonthYear(mjd) {
  if (!isNum(mjd)) return '';
  const d = mjdToDate(mjd);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "2025-06-19" (UTC). */
export function formatIsoDate(mjd) {
  if (!isNum(mjd)) return '';
  const d = mjdToDate(mjd);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** "2025-06-19 19:01" (UTC). */
export function formatIsoMinute(mjd) {
  if (!isNum(mjd)) return '';
  const d = mjdToDate(mjd + 0.5 / 1440);
  return `${formatIsoDate(mjd + 0.5 / 1440)} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

/**
 * Calendar ticks for a time axis between two MJDs.
 * Short spans get day ticks labelled with the day of the month ("14", "18") and a caption such
 * as "Jun 2025"; long spans get month ticks ("Jun", "Sep") and a caption such as "2025".
 * @returns {{ unit:'day'|'month', ticks:Array<{mjd:number,label:string}>, caption:string }}
 */
export function timeTicks(mjd0, mjd1, maxTicks = 4) {
  if (!isNum(mjd0) || !isNum(mjd1)) return { unit: 'day', ticks: [], caption: '' };
  if (mjd0 > mjd1) [mjd0, mjd1] = [mjd1, mjd0];
  const span = mjd1 - mjd0;
  const max = Math.max(1, maxTicks);
  const d0 = mjdToDate(mjd0);
  const d1 = mjdToDate(mjd1);
  const y0 = d0.getUTCFullYear();
  const y1 = d1.getUTCFullYear();

  if (span <= 62) {
    let step = 1;
    for (const s of [1, 2, 5, 10, 20]) {
      step = s;
      if (Math.floor(span / s) + 1 <= max) break;
    }
    const ticks = [];
    for (let t = Math.ceil(mjd0 / step - 1e-9) * step; t <= mjd1 + 1e-9; t += step) {
      ticks.push({ mjd: t, label: String(mjdToDate(t).getUTCDate()) });
    }
    const a = formatMonthYear(mjd0);
    const b = formatMonthYear(mjd1);
    let caption = a;
    if (a !== b) {
      caption = y0 === y1
        ? `${MONTHS[d0.getUTCMonth()]}–${MONTHS[d1.getUTCMonth()]} ${y0}`
        : `${a} – ${b}`;
    }
    return { unit: 'day', ticks, caption };
  }

  const months = span / 30.44;
  let step = 1;
  for (const s of [1, 2, 3, 6, 12, 24, 60, 120]) {
    step = s;
    if (months / s <= max) break;
  }
  const ticks = [];
  let y = y0;
  let m = Math.floor(d0.getUTCMonth() / step) * step;
  for (let guard = 0; guard < 400; guard++) {
    const t = dateToMjd(new Date(Date.UTC(y, m, 1)));
    if (t > mjd1 + 1e-9) break;
    if (t >= mjd0 - 1e-9) {
      const first = ticks.length === 0;
      const label = step >= 12 ? String(y) : (first || m === 0) && y0 !== y1 ? `${MONTHS[m]} ${y}` : MONTHS[m];
      ticks.push({ mjd: t, label });
    }
    m += step;
    while (m >= 12) {
      m -= 12;
      y += 1;
    }
  }
  const caption = y0 === y1 ? String(y0) : `${y0}–${y1}`;
  return { unit: 'month', ticks, caption };
}

// ---------------------------------------------------------------------------------------------
// Pure math: colour and text
// ---------------------------------------------------------------------------------------------

/** CSS colour for a wavelength on the blue -> pale -> amber ramp (0.75 um to 5.0 um). */
export function waveColor(wave, min = 0.75, max = 5.0) {
  const t = isNum(wave) ? clamp((wave - min) / (max - min), 0, 1) : 0.5;
  let a = WAVE_RAMP[0];
  let b = WAVE_RAMP[WAVE_RAMP.length - 1];
  for (let i = 0; i + 1 < WAVE_RAMP.length; i++) {
    if (t >= WAVE_RAMP[i].t && t <= WAVE_RAMP[i + 1].t) {
      a = WAVE_RAMP[i];
      b = WAVE_RAMP[i + 1];
      break;
    }
  }
  const f = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
  const c = a.rgb.map((v, i) => Math.round(v + (b.rgb[i] - v) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/** Colour and marker shape for survey pass number i (0-based). */
export function passStyle(i) {
  if (i < 3) return { color: PASS_COLORS[i], shape: 'circle' };
  if (i === 3) return { color: PASS_COLORS[3], shape: 'diamond' };
  return { color: PASS_LATER_COLOR, shape: 'square' };
}

/** One CSV cell: numbers as-is, text quoted when it contains a comma, quote or newline. */
export function csvCell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  if (typeof v === 'boolean') return v ? '1' : '0';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Split "CH4" into [{ text:'CH', sub:false }, { text:'4', sub:true }] for subscript rendering. */
export function chemParts(label) {
  const out = [];
  const re = /([A-Za-z]+)(\d+)|([^A-Za-z]+|[A-Za-z]+)/g;
  let m;
  while ((m = re.exec(String(label)))) {
    if (m[1]) {
      out.push({ text: m[1], sub: false }, { text: m[2], sub: true });
    } else {
      out.push({ text: m[3], sub: false });
    }
  }
  return out;
}

/** File-name-safe slug of a title. */
export function slug(text) {
  const s = String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s.slice(0, 48) || 'source';
}

// ---------------------------------------------------------------------------------------------
// DOM helpers (browser only; nothing below runs at import time)
// ---------------------------------------------------------------------------------------------

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Create an SVG element with attributes and optionally append it to a parent. */
export function svgEl(name, attrs, parent) {
  const node = document.createElementNS(SVG_NS, name);
  if (attrs) {
    for (const k in attrs) {
      const v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === 'text') node.textContent = String(v);
      else node.setAttribute(k, String(v));
    }
  }
  if (parent) parent.appendChild(node);
  return node;
}

/** Create an HTML element with attributes ('text' sets textContent) and optionally append it. */
export function htmlEl(tag, attrs, parent) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const k in attrs) {
      const v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === 'text') node.textContent = String(v);
      else if (k === 'class') node.className = String(v);
      else node.setAttribute(k, v === true ? '' : String(v));
    }
  }
  if (parent) parent.appendChild(node);
  return node;
}

export function clearNode(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** Round a coordinate to a tenth of a pixel to keep the markup short. */
export function px(v) {
  return Math.round(v * 10) / 10;
}

/** SVG <text> with chemical subscripts ("CH4" draws the 4 lowered and smaller). */
export function chemText(parent, label, attrs) {
  const t = svgEl('text', attrs, parent);
  let lowered = false;
  for (const part of chemParts(label)) {
    const span = svgEl('tspan', { text: part.text }, t);
    if (part.sub) {
      span.setAttribute('dy', '2.5');
      span.setAttribute('font-size', '0.78em');
      lowered = true;
    } else if (lowered) {
      span.setAttribute('dy', '-2.5');
      lowered = false;
    }
  }
  return t;
}

/** Marker path centred on (x, y): circle is handled by the caller; this draws diamond or square. */
export function markerPath(shape, x, y, r) {
  if (shape === 'diamond') {
    const s = r * 1.25;
    return `M${px(x)} ${px(y - s)}L${px(x + s)} ${px(y)}L${px(x)} ${px(y + s)}L${px(x - s)} ${px(y)}Z`;
  }
  const s = r * 0.9;
  return `M${px(x - s)} ${px(y - s)}h${px(2 * s)}v${px(2 * s)}h${px(-2 * s)}Z`;
}

export function prefersReducedMotion() {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Call cb(width) when the element's content width changes. Returns a function that stops
 * watching. Uses ResizeObserver, with a window resize listener as fallback.
 */
export function watchWidth(element, cb) {
  let last = -1;
  const check = () => {
    const w = Math.round(element.clientWidth || 0);
    if (w > 0 && Math.abs(w - last) >= 1) {
      last = w;
      cb(w);
    }
  };
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(check);
    ro.observe(element);
    return () => ro.disconnect();
  }
  window.addEventListener('resize', check);
  check();
  return () => window.removeEventListener('resize', check);
}

/**
 * A tooltip that lives inside `host` (which must be position: relative). show(lines, x, y)
 * takes an array of strings or { text, cls } and host-relative pixel coordinates.
 */
export function createTooltip(host) {
  const tip = htmlEl('div', { class: 'tbp-tip', role: 'status', 'aria-live': 'off' }, host);
  tip.hidden = true;
  return {
    el: tip,
    show(lines, x, y) {
      clearNode(tip);
      for (const line of lines) {
        if (line === null || line === undefined || line === '') continue;
        const spec = typeof line === 'string' ? { text: line } : line;
        htmlEl('div', { class: spec.cls || 'tbp-tip-line', text: spec.text }, tip);
      }
      tip.hidden = false;
      const hw = host.clientWidth;
      const tw = tip.offsetWidth;
      const th = tip.offsetHeight;
      let left = x + 12;
      if (left + tw > hw - 2) left = x - 12 - tw;
      left = clamp(left, 2, Math.max(2, hw - tw - 2));
      let top = y - th - 10;
      if (top < 2) top = y + 14;
      tip.style.left = `${Math.round(left)}px`;
      tip.style.top = `${Math.round(top)}px`;
    },
    hide() {
      tip.hidden = true;
    },
  };
}

/**
 * Pointer and keyboard hover over a set of targets in an SVG whose viewBox equals its pixel size.
 * getTargets() returns [{ x, y, bias?, ... }] in SVG pixels; onPick(target) is called with the
 * nearest one within `radius` px (bias < 1 makes a target easier to pick), or null on leave.
 * Arrow keys step through targets in x order when the SVG has focus.
 */
export function attachHover(svg, getTargets, onPick, radius = 28) {
  let current = null;
  const pick = (t) => {
    if (t === current) return;
    current = t;
    onPick(t);
  };
  const locate = (ev) => {
    const rect = svg.getBoundingClientRect();
    const vb = svg.viewBox && svg.viewBox.baseVal;
    const sx = vb && vb.width && rect.width ? vb.width / rect.width : 1;
    const sy = vb && vb.height && rect.height ? vb.height / rect.height : 1;
    const mx = (ev.clientX - rect.left) * sx;
    const my = (ev.clientY - rect.top) * sy;
    let best = null;
    let bestD = radius * radius;
    for (const t of getTargets()) {
      const dx = t.x - mx;
      const dy = t.y - my;
      const d = (dx * dx + dy * dy) * (t.bias || 1);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    pick(best);
  };
  const leave = () => pick(null);
  const key = (ev) => {
    if (ev.key === 'Escape') {
      pick(null);
      return;
    }
    if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
    const list = getTargets().filter((t) => !t.skipKeys).sort((a, b) => a.x - b.x || a.y - b.y);
    if (!list.length) return;
    ev.preventDefault();
    let i = list.indexOf(current);
    if (i < 0) i = ev.key === 'ArrowRight' ? -1 : list.length;
    i = clamp(i + (ev.key === 'ArrowRight' ? 1 : -1), 0, list.length - 1);
    pick(list[i]);
  };
  svg.addEventListener('pointermove', locate);
  svg.addEventListener('pointerdown', locate);
  svg.addEventListener('pointerleave', leave);
  svg.addEventListener('blur', leave);
  svg.addEventListener('keydown', key);
  return {
    reset: leave,
    destroy() {
      svg.removeEventListener('pointermove', locate);
      svg.removeEventListener('pointerdown', locate);
      svg.removeEventListener('pointerleave', leave);
      svg.removeEventListener('blur', leave);
      svg.removeEventListener('keydown', key);
    },
  };
}
