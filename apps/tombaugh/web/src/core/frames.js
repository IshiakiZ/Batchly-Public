// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

// Bookkeeping for SPHEREx exposures: which detector and spectral channel a wavelength belongs
// to, and which survey pass an exposure belongs to.
//
// SPHEREx has six detectors behind linear variable filters. Each detector covers 17 spectral
// channels (102 in total), and the channels have constant resolving power, so their edges are
// evenly spaced in ln(wavelength) inside the detector's range. The survey revisits a sky
// position roughly every six months; the exposures of one visit form a "pass".

/** Detector wavelength ranges in micrometres (from the build contract). */
export const DETECTORS = [
  { det: 1, min: 0.75, max: 1.09, channels: 17 },
  { det: 2, min: 1.10, max: 1.62, channels: 17 },
  { det: 3, min: 1.63, max: 2.41, channels: 17 },
  { det: 4, min: 2.42, max: 3.82, channels: 17 },
  { det: 5, min: 3.83, max: 4.41, channels: 17 },
  { det: 6, min: 4.42, max: 5.00, channels: 17 },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MJD_UNIX_EPOCH = 40587; // MJD of 1970-01-01T00:00 UTC

function detector(det) {
  return DETECTORS[det - 1] && DETECTORS[det - 1].det === det ? DETECTORS[det - 1] : null;
}

/**
 * Detector whose range contains `wave` (um). Wavelengths in the small gaps between detectors,
 * or outside 0.75-5.0 um, go to the nearest detector. Returns 0 for a non-finite wavelength.
 */
export function detOf(wave) {
  if (!(wave > 0) || !Number.isFinite(wave)) return 0;
  let best = 0;
  let bestDist = Infinity;
  for (const d of DETECTORS) {
    if (wave >= d.min && wave <= d.max) return d.det;
    const dist = wave < d.min ? d.min - wave : wave - d.max;
    if (dist < bestDist) { bestDist = dist; best = d.det; }
  }
  return best;
}

/**
 * Spectral channel index 0..16 of a wavelength within a detector. Channels are log-spaced, the
 * lower edge is inclusive, and wavelengths outside the nominal range are clamped to the first or
 * last channel (real frames reach slightly past the nominal edges). Returns -1 if the detector
 * number or the wavelength is not usable.
 */
export function channelOf(det, wave) {
  const d = detector(det);
  if (!d || !(wave > 0) || !Number.isFinite(wave)) return -1;
  const f = Math.log(wave / d.min) / Math.log(d.max / d.min);
  // The tiny epsilon makes channelOf(det, channelRange(det, ch)[0]) === ch despite rounding.
  const ch = Math.floor(f * d.channels + 1e-9);
  return ch < 0 ? 0 : ch >= d.channels ? d.channels - 1 : ch;
}

/** Wavelength range [min, max] in um of channel `ch` (0..16) of detector `det`. */
export function channelRange(det, ch) {
  const d = detector(det);
  if (!d || !(ch >= 0 && ch < d.channels)) return [NaN, NaN];
  const step = Math.log(d.max / d.min) / d.channels;
  return [d.min * Math.exp(step * ch), ch === d.channels - 1 ? d.max : d.min * Math.exp(step * (ch + 1))];
}

/** Central (log-mean) wavelength of a channel in um. */
export function channelCenter(det, ch) {
  const [a, b] = channelRange(det, ch);
  return Math.sqrt(a * b);
}

/**
 * Split exposures into survey passes. Items need a numeric `.mjd`; they are sorted by time and a
 * new pass starts wherever two consecutive exposures are more than `gapDays` apart. Items
 * without a finite `.mjd` are dropped. The input array is not modified.
 *
 * Near the ecliptic poles (the deep fields) SPHEREx comes back every orbit and there is no gap
 * at all: a year and a half of data would be one "pass" with nothing to compare it with. A run
 * longer than `maxSpanDays` (default 120) is therefore cut into equal seasons of at most 90
 * days. An ordinary pass lasts days to a few weeks and is never cut.
 */
export function splitPasses(items, gapDays = 45, maxSpanDays = 120) {
  const sorted = [];
  for (const it of items || []) if (it && Number.isFinite(it.mjd)) sorted.push(it);
  sorted.sort((a, b) => a.mjd - b.mjd);
  const runs = [];
  let current = null;
  let last = -Infinity;
  for (const it of sorted) {
    if (!current || it.mjd - last > gapDays) {
      current = [];
      runs.push(current);
    }
    current.push(it);
    last = it.mjd;
  }
  const passes = [];
  for (const run of runs) {
    const t0 = run[0].mjd;
    const span = run[run.length - 1].mjd - t0;
    if (!(span > maxSpanDays)) {
      passes.push(run);
      continue;
    }
    const k = Math.ceil(span / SEASON_DAYS);
    const seasons = Array.from({ length: k }, () => []);
    for (const it of run) seasons[Math.min(k - 1, Math.floor(((it.mjd - t0) / span) * k))].push(it);
    for (const season of seasons) if (season.length) passes.push(season);
  }
  return passes;
}

/** Longest season a long continuous run is cut into (days). */
export const SEASON_DAYS = 90;

/** Median MJD of a list of items with `.mjd` (NaN for an empty list). */
export function medianMjd(items) {
  const t = [];
  for (const it of items || []) if (it && Number.isFinite(it.mjd)) t.push(it.mjd);
  if (!t.length) return NaN;
  t.sort((a, b) => a - b);
  const h = t.length >> 1;
  return t.length % 2 ? t[h] : 0.5 * (t[h - 1] + t[h]);
}

/**
 * Short human label for a pass, e.g. "Jun 2025", from the median MJD of its exposures.
 * Accepts an array of items with `.mjd`, or a plain MJD number.
 */
export function passLabel(items) {
  const mjd = typeof items === 'number' ? items : medianMjd(items);
  if (!Number.isFinite(mjd)) return '';
  const d = new Date((mjd - MJD_UNIX_EPOCH) * 86400000); // MJD (UTC days) -> Unix milliseconds
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * Representative wavelength (um) of a layer: the wavelength at the centre of the grid, which is
 * where the user's target sits. Falls back to the frame's centre wavelength, then to the mean
 * of the usable pixels.
 */
export function layerWave(layer) {
  const wave = layer && layer.wave;
  if (wave && wave.length) {
    const n = Math.round(Math.sqrt(wave.length));
    const c = wave[(n >> 1) * n + (n >> 1)];
    if (c > 0 && Number.isFinite(c)) return c;
  }
  const fc = layer && layer.frame && layer.frame.waveCenter;
  if (fc > 0 && Number.isFinite(fc)) return fc;
  if (wave) {
    let s = 0;
    let k = 0;
    for (let i = 0; i < wave.length; i++) {
      const w = wave[i];
      if (w > 0 && Number.isFinite(w)) { s += w; k++; }
    }
    if (k) return s / k;
  }
  return NaN;
}

/**
 * Group the layers of one detector for the movie views.
 *   passes     one array of layers per survey pass, in time order
 *   byChannel  Map from spectral channel (0..16, ascending) to the layers whose wavelength at the
 *              grid centre falls in that channel, each list in time order
 * Call it once per detector: channel numbers repeat from detector to detector.
 */
export function groupLayers(layers) {
  const passes = splitPasses(layers);
  const found = new Map();
  for (const pass of passes) {
    for (const layer of pass) {
      const ch = channelOf(layer.det, layerWave(layer));
      if (ch < 0) continue;
      if (!found.has(ch)) found.set(ch, []);
      found.get(ch).push(layer);
    }
  }
  const byChannel = new Map([...found.entries()].sort((a, b) => a[0] - b[0]));
  return { passes, byChannel };
}
