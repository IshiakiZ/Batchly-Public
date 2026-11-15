// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

// mapping.js: turns measurements into notes and into words. Pure: no DOM, no audio, imports
// nothing; runs in Node for tests. synth.js plays what this file returns.
//
//   spectrumToNotes(points, opts)   -> { notes, duration, median, kind: 'spectrum' }
//     points: [{ wave (um), flux_uJy, err_uJy }]. One note per point, short wavelengths first.
//     time      wavelength, linearly: 0.75 um at 0 s to 5 um at 4 s, so a given wavelength
//               always sounds at the same moment whatever the source
//     pitch     flux relative to the spectrum's own median, on a log scale, snapped to a
//               pentatonic scale over three octaves: the median sits mid-range, four times
//               brighter is the top note, four times fainter (or anything at or below zero)
//               the bottom, so one scale step is a 20 percent change in flux. The mapping is
//               the same for every source. Brighter is never lower, so an absorption dip is
//               heard as a drop.
//     loudness  signal-to-noise: sure points are loud, doubtful ones quiet. Quoted errors are
//               first widened if neighbouring points scatter more than they allow.
//   lightCurveToNotes(points, opts) -> { notes, duration, passes, kind: 'lightcurve' }
//     points: [{ mjd, ratio, err }]. A slower melody in time order; survey passes are
//     separated by a rest instead of six months of silence. A factor of two in brightness is
//     two octaves; a steady source repeats one note. (The ratio is measured at the clicked
//     position, so a source that moves away from it also fades.)
//   note = { t, dur, freq, gain, step, timbre, ...source values }   t and dur in seconds
//   describeSpectrum(points), describeLightCurve(points) -> one or two plain sentences for
//     screen readers and for anyone who would rather read than listen.

export const SWEEP = Object.freeze({ waveMin: 0.75, waveMax: 5.0, seconds: 4 });

/** Major pentatonic, semitones above the root. Any two notes of it sound fine together. */
export const PENTATONIC = Object.freeze([0, 2, 4, 7, 9]);
/** E3. Three octaves up from here stays inside what small speakers and most ears handle. */
export const BASE_HZ = 164.81;
/** Scale steps 0..15: three octaves of five notes, plus the top root. */
export const TOP_STEP = 15;
/** Flux relative to the median that reaches the top (and, inverted, the bottom) note. */
export const FLUX_SPAN = 4;
export const MIN_GAIN = 0.12;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function median(values) {
  const v = values.filter(isNum).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : 0.5 * (v[m - 1] + v[m]);
}

/** Frequency in Hz of a scale step (0 = E3, 5 = E4, 15 = E6). Steps are clamped to 0..15. */
export function stepToHz(step) {
  const s = clamp(Math.round(isNum(step) ? step : 0), 0, TOP_STEP);
  const octave = Math.floor(s / PENTATONIC.length);
  return BASE_HZ * 2 ** (octave + PENTATONIC[s % PENTATONIC.length] / 12);
}

/**
 * Scale step for a brightness ratio (value / reference). ratio 1 is mid-range (step 8), `span`
 * times brighter is step 15, `span` times fainter is step 0. Non-decreasing in ratio.
 * Zero, negative and non-finite ratios give the bottom step.
 */
export function ratioToStep(ratio, span = FLUX_SPAN) {
  if (!isNum(ratio) || ratio <= 0) return 0;
  const x = clamp(Math.log(ratio) / Math.log(span > 1 ? span : FLUX_SPAN), -1, 1);
  return clamp(Math.round(((x + 1) / 2) * TOP_STEP), 0, TOP_STEP);
}

/** Loudness 0.12..1 from signal-to-noise: S/N 1 or less is quietest, 30 or more is full. */
export function snrToGain(snr) {
  if (!isNum(snr)) return 0.7; // no error bar: neither sure nor doubtful
  return MIN_GAIN + (1 - MIN_GAIN) * clamp(Math.log10(Math.max(1, snr)) / Math.log10(30), 0, 1);
}

/** Seconds into the sweep at which a wavelength sounds. Increasing in wavelength, clamped. */
export function waveToTime(wave, sweep = SWEEP) {
  if (!isNum(wave)) return 0;
  const f = (wave - sweep.waveMin) / (sweep.waveMax - sweep.waveMin);
  return clamp(f, 0, 1) * sweep.seconds;
}

function cleanSpectrum(points) {
  const out = [];
  if (!Array.isArray(points)) return out;
  for (const p of points) {
    if (!p || !isNum(p.wave) || !isNum(p.flux_uJy) || p.ok === false || p.flagged === true) continue;
    out.push({ wave: p.wave, flux: p.flux_uJy, err: isNum(p.err_uJy) && p.err_uJy > 0 ? p.err_uJy : null });
  }
  out.sort((a, b) => a.wave - b.wave);
  return out;
}

/**
 * Honest error bars. Each point is compared with the mean of its two neighbours; if the points
 * jump about more than their quoted errors allow (a variable source measured on different
 * days does this), every error is scaled up to match, never down. Points that came without an
 * error get the scatter measured this way. The median makes real narrow features harmless.
 */
function calibrate(pts) {
  return calibration(pts).points;
}

/** -> { points, scale }: the calibrated points and the factor applied to the quoted errors. */
function calibration(pts) {
  if (pts.length < 8) return { points: pts, scale: 1 };
  const z = [];
  const jumps = [];
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs(pts[i].flux - 0.5 * (pts[i - 1].flux + pts[i + 1].flux));
    jumps.push(d);
    const a = pts[i - 1].err;
    const b = pts[i].err;
    const c = pts[i + 1].err;
    if (a !== null && b !== null && c !== null) z.push(d / Math.sqrt(b * b + 0.25 * (a * a + c * c)));
  }
  const scale = z.length >= 6 ? Math.max(1, 1.4826 * median(z)) : 1;
  const fallback = (1.4826 * median(jumps)) / Math.sqrt(1.5);
  if (scale === 1 && pts.every((p) => p.err !== null)) return { points: pts, scale };
  return { points: pts.map((p) => (p.err !== null ? { ...p, err: p.err * scale } : { ...p, err: fallback > 0 ? fallback : null, estimated: true })), scale };
}

/**
 * Drops isolated one-point spikes, up or down: a point far from the median of its four
 * nearest neighbours while those neighbours agree with each other. A source that varies
 * between survey passes produces such points (a channel seen only in the bright pass), and
 * they would otherwise read as peaks or dips. A band several channels wide is kept, because
 * its points disagree with their neighbours together. Used for the description only (which
 * is deliberately coarse); every point is still played.
 */
export function despike(pts) {
  if (!Array.isArray(pts) || pts.length < 7) return pts || [];
  const keep = pts.filter((p, i) => {
    const near = [];
    for (let j = Math.max(0, i - 2); j <= Math.min(pts.length - 1, i + 2); j++) if (j !== i) near.push(pts[j].flux);
    if (near.length < 3) return true;
    const mid = median(near);
    const spread = 1.4826 * median(near.map((v) => Math.abs(v - mid)));
    return Math.abs(p.flux - mid) <= 5 * Math.max(p.err ?? 0, spread, 0.03 * Math.abs(mid));
  });
  return keep.length >= pts.length * 0.6 ? keep : pts;
}

/** Averages neighbours until at most `max` points remain (inverse-variance when possible). */
function thin(pts, max) {
  if (pts.length <= max) return pts;
  const size = Math.ceil(pts.length / max);
  const out = [];
  for (let i = 0; i < pts.length; i += size) {
    const g = pts.slice(i, i + size);
    const weighted = g.every((p) => p.err !== null);
    let sw = 0;
    let sf = 0;
    let sl = 0;
    for (const p of g) {
      const w = weighted ? 1 / (p.err * p.err) : 1;
      sw += w;
      sf += w * p.flux;
      sl += w * p.wave;
    }
    out.push({ wave: sl / sw, flux: sf / sw, err: weighted ? Math.sqrt(1 / sw) : null, estimated: g.some((p) => p.estimated) });
  }
  return out;
}

/** The level a point is compared with: the median of its neighbours a few points away. */
function localContinuum(pts, i) {
  const near = [];
  for (let j = Math.max(0, i - 7); j <= Math.min(pts.length - 1, i + 7); j++) {
    if (Math.abs(j - i) >= 3) near.push(pts[j].flux);
  }
  return near.length >= 3 ? median(near) : NaN;
}

/**
 * spectrumToNotes(points, { sweep = SWEEP, span = FLUX_SPAN, maxNotes = 128 })
 * -> { kind: 'spectrum', notes, duration, median }
 * note = { t, dur, freq, gain, step, timbre, wave, flux, snr, dip }
 * `dip` marks a point well below its surroundings; such notes use a triangle wave and ring a
 * little longer, so an absorption band stands out as well as dropping in pitch.
 */
export function spectrumToNotes(points, { sweep = SWEEP, span = FLUX_SPAN, maxNotes = 128 } = {}) {
  const pts = thin(calibrate(cleanSpectrum(points)), Math.max(8, maxNotes));
  const positive = pts.filter((p) => p.flux > 0).map((p) => p.flux);
  let ref = median(positive);
  if (!(ref > 0)) ref = 1;
  const notes = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const t = waveToTime(p.wave, sweep);
    const next = i + 1 < pts.length ? waveToTime(pts[i + 1].wave, sweep) - t : 0.2;
    const step = ratioToStep(p.flux / ref, span);
    // An error estimated from the scatter is good enough to judge a dip, not to set loudness.
    const snr = p.err !== null && !p.estimated ? p.flux / p.err : null;
    const cont = localContinuum(pts, i);
    const dip = isNum(cont) && cont > 0 && p.flux < 0.7 * cont && (p.err === null || cont - p.flux > 2 * p.err);
    notes.push({
      t,
      dur: clamp(next * 1.8, 0.07, 0.3) * (dip ? 1.4 : 1),
      freq: stepToHz(step),
      gain: snrToGain(snr),
      step,
      timbre: dip ? 'triangle' : 'sine',
      wave: p.wave,
      flux: p.flux,
      snr,
      dip,
    });
  }
  const last = notes[notes.length - 1];
  return { kind: 'spectrum', notes, duration: last ? Math.max(sweep.seconds, last.t + last.dur) : 0, median: ref };
}

/** Splits time-sorted items with .mjd into survey passes at gaps longer than gapDays. */
export function splitPasses(items, gapDays = 45) {
  const passes = [];
  for (const item of items) {
    const current = passes[passes.length - 1];
    if (!current || item.mjd - current[current.length - 1].mjd > gapDays) passes.push([item]);
    else current.push(item);
  }
  return passes;
}

function cleanLightCurve(points) {
  const out = [];
  if (!Array.isArray(points)) return out;
  for (const p of points) {
    if (!p || !isNum(p.mjd) || !isNum(p.ratio)) continue;
    out.push({ mjd: p.mjd, ratio: p.ratio, err: isNum(p.err) && p.err > 0 ? p.err : null });
  }
  out.sort((a, b) => a.mjd - b.mjd);
  return out;
}

function thinCurve(pass, max) {
  if (pass.length <= max) return pass;
  const size = Math.ceil(pass.length / max);
  const out = [];
  for (let i = 0; i < pass.length; i += size) {
    const g = pass.slice(i, i + size);
    const ratio = median(g.map((p) => p.ratio)); // median: one cosmic ray should not sing
    const errs = g.map((p) => p.err).filter((e) => e !== null);
    out.push({
      mjd: g.reduce((s, p) => s + p.mjd, 0) / g.length,
      ratio,
      err: errs.length === g.length ? median(errs) / Math.sqrt(g.length) : null,
    });
  }
  return out;
}

/**
 * lightCurveToNotes(points, { noteSeconds = 0.22, restSeconds = 0.7, maxNotes = 48,
 *   gapDays = 45, stepsPerDoubling = 10 })
 * -> { kind: 'lightcurve', notes, duration, passes }
 * note = { t, dur, freq, gain, step, timbre, mjd, ratio, pass }
 * Notes follow in time order at an even pace within a pass. ratio 1 is step 8; each doubling
 * moves stepsPerDoubling steps (two octaves), so a 10 percent change is about one step.
 */
export function lightCurveToNotes(points, { noteSeconds = 0.22, restSeconds = 0.7, maxNotes = 48, gapDays = 45, stepsPerDoubling = 10 } = {}) {
  const passes = splitPasses(cleanLightCurve(points), gapDays);
  const perPass = Math.max(4, Math.floor(maxNotes / Math.max(1, passes.length)));
  const notes = [];
  let t = 0;
  passes.forEach((pass, k) => {
    if (k > 0) t += restSeconds;
    for (const p of thinCurve(pass, perPass)) {
      const step = p.ratio > 0 ? clamp(Math.round(8 + Math.log2(p.ratio) * stepsPerDoubling), 0, TOP_STEP) : 0;
      notes.push({
        t,
        dur: noteSeconds * 1.5,
        freq: stepToHz(step),
        gain: snrToGain(p.err !== null ? p.ratio / p.err : null),
        step,
        timbre: 'triangle',
        mjd: p.mjd,
        ratio: p.ratio,
        pass: k,
      });
      t += noteSeconds;
    }
  });
  const last = notes[notes.length - 1];
  return { kind: 'lightcurve', notes, duration: last ? last.t + last.dur : 0, passes: passes.length };
}

// ---------------------------------------------------------------------------------------------
// Words

const micron = (wave) => (wave >= 1 ? wave.toFixed(1) : wave.toFixed(2).replace(/0$/, ''));
const percent = (fraction) => {
  const v = Math.abs(fraction) * 100;
  return String(v >= 20 ? Math.min(95, Math.round(v / 5) * 5) : Math.max(1, Math.round(v)));
};

/**
 * Three-point running mean, so one noisy point is not announced as a feature. Points are
 * weighted by their errors when all three have one, so a doubtful point cannot pull its
 * neighbours; `err` becomes the error of the mean.
 */
function smooth(pts) {
  return pts.map((p, i) => {
    const g = pts.slice(Math.max(0, i - 1), i + 2);
    if (g.some((q) => q.err === null)) return { ...p, flux: g.reduce((s, q) => s + q.flux, 0) / g.length, err: null };
    let sw = 0;
    let sf = 0;
    for (const q of g) {
      const w = 1 / (q.err * q.err);
      sw += w;
      sf += w * q.flux;
    }
    return { ...p, flux: sf / sw, err: Math.sqrt(1 / sw) };
  });
}

/**
 * The deepest dip in a smoothed spectrum: the point furthest below the lower of the highest
 * levels on either side of it (its rim). recoverWave is where the flux is first back at the
 * rim level. -> { wave, depth, recoverWave } | null
 */
export function findDip(points) {
  const pts = smooth(calibrate(despike(cleanSpectrum(points))));
  const n = pts.length;
  if (n < 7) return null;
  const leftMax = new Array(n).fill(-Infinity);
  const rightMax = new Array(n).fill(-Infinity);
  const rightArg = new Array(n).fill(-1);
  for (let i = 1; i < n; i++) leftMax[i] = Math.max(leftMax[i - 1], pts[i - 1].flux);
  for (let i = n - 2; i >= 0; i--) {
    if (pts[i + 1].flux >= rightMax[i + 1]) {
      rightMax[i] = pts[i + 1].flux;
      rightArg[i] = i + 1;
    } else {
      rightMax[i] = rightMax[i + 1];
      rightArg[i] = rightArg[i + 1];
    }
  }
  let best = null;
  for (let i = 2; i < n - 2; i++) {
    const rim = Math.min(leftMax[i], rightMax[i]);
    if (!(rim > 0)) continue;
    const depth = 1 - Math.max(0, pts[i].flux) / rim;
    const noise = pts[i].err ?? 0; // already the error of the three-point mean
    if (depth < 0.15 || rim - pts[i].flux < 4 * noise) continue;
    if (!best || depth > best.depth) best = { wave: pts[i].wave, depth, rim, index: i };
  }
  if (!best) return null;
  // Recovery: the first point past the dip that is back at the level of its rim.
  let j = best.index + 1;
  while (j < n - 1 && pts[j].flux < best.rim) j++;
  return { wave: best.wave, depth: best.depth, recoverWave: pts[j].wave };
}

/**
 * describeSpectrum(points) -> a short description, for example
 * "Brightest near 1.6 micrometres, a dip of 40 percent near 3.3 micrometres, rising again at
 * 4.5. 102 points from 0.75 to 5.0 micrometres."
 */
export function describeSpectrum(points) {
  const all = cleanSpectrum(points);
  const quoted = despike(all);
  const { points: raw, scale } = calibration(quoted);
  if (raw.length < 3) return 'No spectrum has been measured for this source yet.';
  const pts = smooth(raw);
  let peak = pts[0];
  for (const p of pts) if (p.flux > peak.flux) peak = p;
  const coverage = `${all.length} points from ${micron(all[0].wave)} to ${micron(all[all.length - 1].wave)} micrometres.`;
  if (!(peak.flux > 0)) return `No clear signal: the flux is at or below zero everywhere. ${coverage}`;
  const snrs = quoted.filter((p) => p.err !== null).map((p) => p.flux / p.err);
  const faint = snrs.length >= 3 && median(snrs) < 3;
  const dropped = all.length - quoted.length;
  let caveat = '';
  if (faint) caveat = ' Faint: most points are close to the noise, so take the shape loosely.';
  else if (scale > 3) caveat = ' The points scatter more than their error bars allow, as they do for a source that varies, so take the shape loosely.';
  else if (dropped > 0) caveat = ` ${dropped} ${dropped === 1 ? 'point stands' : 'points stand'} apart from the neighbouring ones and ${dropped === 1 ? 'is' : 'are'} left out of this description; a source that varies or moves between passes does that.`;
  // Name a brightest wavelength only if it stands clear of the typical level: the highest
  // point of a flat, noisy spectrum is an accident, not a peak.
  const level = median(pts.map((p) => p.flux));
  const peakClear = peak.err !== null ? peak.flux - level > 4 * peak.err : peak.flux > 1.15 * level;
  const parts = peakClear ? [`Brightest near ${micron(peak.wave)} micrometres`] : [];
  const dip = findDip(points);
  if (dip) {
    parts.push(`a dip of ${percent(dip.depth)} percent near ${micron(dip.wave)} micrometres`);
    if (dip.recoverWave > dip.wave) parts.push(`rising again at ${micron(dip.recoverWave)}`);
  } else {
    const third = Math.max(1, Math.floor(pts.length / 3));
    const mean = (list) => list.reduce((s, p) => s + p.flux, 0) / list.length;
    const blue = mean(pts.slice(0, third));
    const red = mean(pts.slice(-third));
    if (blue > 0 && red > 1.5 * blue) parts.push('brightening towards longer wavelengths');
    else if (red > 0 && blue > 1.5 * red) parts.push('fading towards longer wavelengths');
    else if (blue <= 0 || red <= 0) parts.push(blue > red ? 'fading to nothing at longer wavelengths' : 'with no signal at the shortest wavelengths');
    else parts.push(peakClear ? 'about as bright at both ends' : 'No clear peak: about as bright at both ends');
  }
  const text = parts.join(', ');
  return `${text[0].toUpperCase()}${text.slice(1)}. ${coverage}${caveat}`;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "June 2025" for an MJD (UTC), by integer arithmetic. */
export function monthYear(mjd) {
  if (!isNum(mjd)) return '';
  const a = Math.floor(mjd + 2400001) + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor((146097 * b) / 4);
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * d) / 4);
  const m = Math.floor((5 * e + 2) / 153);
  return `${MONTHS[m + 2 - 12 * Math.floor(m / 10)]} ${100 * b + d - 4800 + Math.floor(m / 10)}`;
}

/**
 * describeLightCurve(points) -> for example "3 survey passes, 60 measurements. Brightest in
 * December 2025: 2.0 times the level of June 2025, the faintest pass."
 */
export function describeLightCurve(points) {
  const pts = cleanLightCurve(points);
  if (pts.length < 2) return 'No light curve has been measured for this source yet.';
  const passes = splitPasses(pts).map((pass) => {
    const ratio = median(pass.map((p) => p.ratio));
    // Error of the pass level: the larger of the scatter (robust) and the quoted errors.
    const scatter = (1.4826 * median(pass.map((p) => Math.abs(p.ratio - ratio)))) / Math.sqrt(pass.length);
    const errs = pass.map((p) => p.err).filter((e) => e !== null);
    const quoted = errs.length === pass.length ? median(errs) / Math.sqrt(pass.length) : 0;
    return { mjd: median(pass.map((p) => p.mjd)), ratio, err: Math.max(scatter, quoted), n: pass.length };
  });
  const head = `${passes.length} survey ${passes.length === 1 ? 'pass' : 'passes'}, ${pts.length} measurements.`;
  if (passes.length < 2) return `${head} One pass cannot show a change from visit to visit.`;
  let hi = passes[0];
  let lo = passes[0];
  for (const p of passes) {
    if (p.ratio > hi.ratio) hi = p;
    if (p.ratio < lo.ratio) lo = p;
  }
  if (!(lo.ratio > 0)) return `${head} The brightness drops to nothing in ${monthYear(lo.mjd)}.`;
  const factor = hi.ratio / lo.ratio;
  if (factor < 1.1) return `${head} Steady: the passes agree to within ${Math.max(1, Math.round((factor - 1) * 100))} percent.`;
  const noise = Math.hypot(hi.err, lo.err);
  if (pts.length > 2 && hi.ratio - lo.ratio < 3 * noise) {
    return `${head} No change that stands clear of the noise: the passes differ by ${percent(factor - 1)} percent, which the scatter within a pass can explain.`;
  }
  const amount = factor >= 1.95 ? `${factor.toFixed(1)} times the level` : `${percent(factor - 1)} percent above the level`;
  return `${head} Brightest in ${monthYear(hi.mjd)}: ${amount} of ${monthYear(lo.mjd)}, the faintest pass.`;
}
