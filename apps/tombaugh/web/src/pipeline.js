// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

// View-mode pipeline: pure functions that turn aligned layers into a list of "movie frames"
//   { image, mask, range, caption: { title, date, wave, note }, diverging?, rgb?, mjd, pass, short }
// No DOM. The science functions come in through `lib` (the flattened exports of web/src/core/*),
// so this file imports nothing and can be tested with small stand-ins. Simple operations have
// local fallbacks so the basic views keep working when a core module is missing.

export const VIEW_INFO = [
  {
    id: 'passes',
    label: 'Passes',
    hint: 'One deep frame per survey pass, six months apart. Stars stay put; anything that moved or changed jumps. Click a source to measure it.',
    about:
      'SPHEREx returns to each spot roughly every six months. Here all exposures of one pass are aligned, background-matched and stacked into one deep frame, so the movie has one frame per pass. Stars stay put; anything that moved or changed brightness between passes jumps.',
    topic: 'flicker',
  },
  {
    id: 'exposures',
    label: 'Exposures',
    hint: 'Every single exposure in time order. Each one is a different wavelength, so it flickers.',
    about:
      'The naive flipbook: every single exposure in time order. SPHEREx images this spot through a filter whose colour changes across the detector, so each exposure sees it at a different wavelength. Stars change brightness from frame to frame for that reason alone, which is why this view flickers and why the other views exist.',
    topic: 'flicker',
  },
  {
    id: 'matched',
    label: 'Matched',
    hint: 'Only exposures taken at nearly the same wavelength, stacked per pass. Flicker-free.',
    about:
      'Only exposures in one of the 17 spectral channels of this detector are kept, then stacked per pass. Because every frame is at nearly the same wavelength, a brightness change here is a real change in the sky, not a change of colour.',
    topic: 'flicker',
  },
  {
    id: 'residual',
    label: 'Residual',
    hint: 'What is left after subtracting the sky predicted from all visits. Movers and variables remain.',
    about:
      'Predicted-sky subtraction. For every pixel, a smooth spectrum is fitted through all exposures of this detector. That gives a prediction of what the unchanging sky should look like at each exposure’s wavelength; subtracting it leaves the residual. A steady star cancels. A mover leaves a bright spot where it is and a dark one where the model expected it; a variable star brightens and fades in place.',
    topic: 'residual',
  },
  {
    id: 'diff',
    label: 'Difference',
    hint: 'One pass minus another. Steady sources cancel; changes remain as bright and dark spots.',
    about:
      'A plain difference image: the stack of pass B minus the stack of pass A. Steady sources cancel, a mover shows as a dark and bright pair, and a variable shows as a single spot. It is simple and honest, but the two passes sample slightly different wavelengths, so bright stars can leave faint residue.',
    topic: 'residual',
  },
  {
    id: 'lens',
    label: 'Lens',
    hint: 'A molecular lens: how deep an absorption band is at every pixel, or a three-detector colour image.',
    about:
      'A spectral lens compares the brightness inside a molecular absorption band with the continuum on either side, pixel by pixel. Sources with that molecule in their atmosphere or ice light up. The colour lens instead combines three detectors into one image.',
    topic: 'lens',
  },
  {
    id: 'distance',
    label: 'Distance',
    hint: 'Shift and stack along the path a body at the chosen distance would take across the sky.',
    about:
      'The distance dial. A body in the outer solar system appears to slide across the sky mostly because Earth moves around the Sun, and the size of that slide depends on its distance. The dial shifts every exposure along the path a body at the chosen distance would follow and stacks them: stars smear, and anything truly at that distance sharpens into a point.',
    topic: 'distance',
  },
];

export const DETECTOR_RANGES = [
  { det: 1, min: 0.75, max: 1.09 },
  { det: 2, min: 1.1, max: 1.62 },
  { det: 3, min: 1.63, max: 2.41 },
  { det: 4, min: 2.42, max: 3.82 },
  { det: 5, min: 3.83, max: 4.41 },
  { det: 6, min: 4.42, max: 5.0 },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MICRON = 'µm';
const ARCSEC = '″';

// ---------------------------------------------------------------------------------------------
// Small pure helpers (dates, statistics) with no dependency on core.
// ---------------------------------------------------------------------------------------------

export function mjdToDate(mjd) {
  return new Date((mjd - 40587) * 86400000);
}

export function fmtDay(mjd) {
  if (!Number.isFinite(mjd)) return '';
  return mjdToDate(mjd).toISOString().slice(0, 10);
}

export function fmtDateTime(mjd) {
  if (!Number.isFinite(mjd)) return '';
  return mjdToDate(mjd).toISOString().slice(0, 16).replace('T', ' ');
}

export function fmtMonth(mjd) {
  if (!Number.isFinite(mjd)) return '';
  const d = mjdToDate(mjd);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function fmtWave(wave, digits = 3) {
  return Number.isFinite(wave) ? `${wave.toFixed(digits)} ${MICRON}` : '';
}

export function fmtDistance(distAU) {
  if (!Number.isFinite(distAU)) return 'infinity';
  if (distAU >= 100) return `${Math.round(distAU).toLocaleString('en-US')} AU`;
  return `${distAU.toFixed(1)} AU`;
}

function medianOf(values) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : 0.5 * (v[mid - 1] + v[mid]);
}

function sampleValid(data, mask, maxSamples = 20000) {
  const n = data.length;
  const step = Math.max(1, Math.floor(n / maxSamples));
  const out = [];
  for (let i = 0; i < n; i += step) {
    if (mask && mask[i]) continue;
    const v = data[i];
    if (Number.isFinite(v)) out.push(v);
  }
  out.sort((a, b) => a - b);
  return out;
}

function quantileSorted(sorted, p) {
  if (!sorted.length) return NaN;
  const pos = Math.min(sorted.length - 1, Math.max(0, (p / 100) * (sorted.length - 1)));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function localAutoRange(data, mask, { lo = 0.5, hi = 99.7 } = {}) {
  const sorted = sampleValid(data, mask);
  if (!sorted.length) return [0, 1];
  let vmin = quantileSorted(sorted, lo);
  let vmax = quantileSorted(sorted, hi);
  if (!(vmax > vmin)) vmax = vmin + (Math.abs(vmin) || 1) * 1e-3;
  return [vmin, vmax];
}

function localRobustStats(data, mask) {
  const sorted = sampleValid(data, mask);
  if (!sorted.length) return { median: NaN, sigma: NaN };
  const median = quantileSorted(sorted, 50);
  const dev = sorted.map((v) => Math.abs(v - median)).sort((a, b) => a - b);
  return { median, sigma: 1.4826 * quantileSorted(dev, 50) };
}

function localSplitPasses(items, gapDays = 45, maxSpanDays = 120) {
  const sorted = [...items].sort((a, b) => a.mjd - b.mjd);
  const runs = [];
  let current = [];
  for (const item of sorted) {
    if (current.length && item.mjd - current[current.length - 1].mjd > gapDays) {
      runs.push(current);
      current = [];
    }
    current.push(item);
  }
  if (current.length) runs.push(current);
  // A run longer than maxSpanDays is cut into seasons (see core/frames.js splitPasses).
  const passes = [];
  for (const run of runs) {
    const t0 = run[0].mjd;
    const span = run[run.length - 1].mjd - t0;
    if (!(span > maxSpanDays)) {
      passes.push(run);
      continue;
    }
    const k = Math.ceil(span / 90);
    const seasons = Array.from({ length: k }, () => []);
    for (const item of run) seasons[Math.min(k - 1, Math.floor(((item.mjd - t0) / span) * k))].push(item);
    for (const season of seasons) if (season.length) passes.push(season);
  }
  return passes;
}

function localStack(layers) {
  const n = layers.length ? layers[0].image.length : 0;
  const image = new Float32Array(n);
  const variance = new Float32Array(n);
  const count = new Uint16Array(n);
  const mask = new Uint8Array(n);
  const wsum = new Float64Array(n);
  const sum = new Float64Array(n);
  for (const layer of layers) {
    const img = layer.image;
    const varr = layer.variance;
    const m = layer.mask;
    for (let i = 0; i < n; i++) {
      if (m && m[i]) continue;
      const v = img[i];
      if (!Number.isFinite(v)) continue;
      const vv = varr ? varr[i] : NaN;
      const w = Number.isFinite(vv) && vv > 0 ? 1 / vv : 1;
      sum[i] += w * v;
      wsum[i] += w;
      count[i] += 1;
    }
  }
  for (let i = 0; i < n; i++) {
    if (count[i] > 0 && wsum[i] > 0) {
      image[i] = sum[i] / wsum[i];
      variance[i] = 1 / wsum[i];
    } else {
      image[i] = NaN;
      variance[i] = NaN;
      mask[i] = 1;
    }
  }
  return { image, variance, count, mask };
}

function localSubtract(a, b) {
  const n = a.image.length;
  const image = new Float32Array(n);
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const bad = (a.mask && a.mask[i]) || (b.mask && b.mask[i]) || !Number.isFinite(a.image[i]) || !Number.isFinite(b.image[i]);
    if (bad) {
      image[i] = NaN;
      mask[i] = 1;
    } else image[i] = a.image[i] - b.image[i];
  }
  return { image, mask };
}

// ---------------------------------------------------------------------------------------------
// Adapters over core signatures (the only place that knows how core functions are called).
// ---------------------------------------------------------------------------------------------

function autoRange(lib, data, mask, opts) {
  if (lib.autoRange) {
    try {
      const r = lib.autoRange(data, mask, opts || {});
      if (Array.isArray(r) && Number.isFinite(r[0]) && Number.isFinite(r[1]) && r[1] > r[0]) return [r[0], r[1]];
    } catch {
      // fall through
    }
  }
  return localAutoRange(data, mask, opts);
}

function robustStats(lib, data, mask) {
  if (lib.robustStats) {
    try {
      const s = lib.robustStats(data, mask);
      if (s && Number.isFinite(s.sigma)) return s;
    } catch {
      // fall through
    }
  }
  return localRobustStats(data, mask);
}

export function splitPasses(lib, items) {
  if (lib.splitPasses) {
    try {
      const passes = lib.splitPasses(items);
      if (Array.isArray(passes)) return passes.filter((p) => p && p.length);
    } catch {
      // fall through
    }
  }
  return localSplitPasses(items);
}

function stack(lib, layers, opts) {
  if (lib.stackLayers) {
    try {
      const s = lib.stackLayers(layers, opts || {});
      if (s && s.image) return s;
    } catch {
      // fall through
    }
  }
  return localStack(layers);
}

function subtract(lib, a, b) {
  if (lib.subtractImages) {
    try {
      const d = lib.subtractImages(a, b);
      if (d && d.image) return d;
    } catch {
      // fall through
    }
  }
  return localSubtract(a, b);
}

function backgroundOf(lib, layer) {
  if (lib.backgroundLevel) {
    try {
      const b = lib.backgroundLevel(layer);
      if (Number.isFinite(b)) return b;
    } catch {
      // fall through
    }
  }
  return localRobustStats(layer.image, layer.mask).median;
}

/** Layers with their robust sky level removed, so stacks and flipbooks share a zero point. */
export function normalizeLayers(lib, layers) {
  if (lib.normalizeBackground) {
    try {
      const out = lib.normalizeBackground(layers);
      if (Array.isArray(out) && out.length === layers.length && out.every((l) => l && l.image)) return out;
    } catch {
      // fall through
    }
  }
  return layers.map((layer) => {
    const bg = backgroundOf(lib, layer);
    if (!Number.isFinite(bg) || bg === 0) return layer;
    const image = new Float32Array(layer.image.length);
    for (let i = 0; i < image.length; i++) image[i] = layer.image[i] - bg;
    return { ...layer, image };
  });
}

export function layerWave(layer) {
  if (layer.frame && Number.isFinite(layer.frame.waveCenter)) return layer.frame.waveCenter;
  if (Number.isFinite(layer.waveCenter)) return layer.waveCenter;
  const w = layer.wave;
  if (w && w.length) {
    const n = Math.round(Math.sqrt(w.length));
    const c = w[(n >> 1) * n + (n >> 1)];
    if (Number.isFinite(c)) return c;
    for (let i = 0; i < w.length; i++) if (Number.isFinite(w[i])) return w[i];
  }
  return NaN;
}

function detRange(lib, det) {
  const list = Array.isArray(lib.DETECTORS) && lib.DETECTORS.length ? lib.DETECTORS : DETECTOR_RANGES;
  return list.find((d) => d.det === det) || DETECTOR_RANGES.find((d) => d.det === det) || null;
}

export function channelOfLayer(lib, layer) {
  const wave = layerWave(layer);
  const det = layer.det ?? (layer.frame ? layer.frame.det : undefined);
  if (lib.channelOf) {
    try {
      const ch = lib.channelOf(det, wave);
      if (Number.isInteger(ch)) return ch;
    } catch {
      // fall through
    }
  }
  const r = detRange(lib, det);
  if (!r || !Number.isFinite(wave)) return -1;
  const f = (Math.log(wave) - Math.log(r.min)) / (Math.log(r.max) - Math.log(r.min));
  return Math.min(16, Math.max(0, Math.floor(f * 17)));
}

export function channelRange(lib, det, ch) {
  if (lib.channelRange) {
    try {
      const r = lib.channelRange(det, ch);
      if (Array.isArray(r) && Number.isFinite(r[0]) && Number.isFinite(r[1])) return r;
    } catch {
      // fall through
    }
  }
  const r = detRange(lib, det);
  if (!r) return [NaN, NaN];
  const a = Math.log(r.min);
  const b = Math.log(r.max);
  return [Math.exp(a + ((b - a) * ch) / 17), Math.exp(a + ((b - a) * (ch + 1)) / 17)];
}

function detWaveLabel(lib, det) {
  const r = detRange(lib, det);
  return r ? `D${det} · ${r.min.toFixed(2)}–${r.max.toFixed(2)} ${MICRON}` : `D${det}`;
}

function sigmaOf(lib, image, mask) {
  const s = robustStats(lib, image, mask).sigma;
  return Number.isFinite(s) && s > 0 ? s : NaN;
}

/** One shared display range for a set of frames so that blinking compares like with like. */
function commonRange(lib, frames) {
  const los = [];
  const his = [];
  for (const f of frames) {
    const [lo, hi] = autoRange(lib, f.image, f.mask);
    los.push(lo);
    his.push(hi);
  }
  const lo = medianOf(los);
  let hi = medianOf(his);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1];
  if (!(hi > lo)) hi = lo + 1;
  return [lo, hi];
}

function symmetricRange(lib, frames, k = 6) {
  const sig = medianOf(frames.map((f) => sigmaOf(lib, f.image, f.mask)));
  if (Number.isFinite(sig) && sig > 0) return [-k * sig, k * sig];
  let peak = 0;
  for (const f of frames) {
    const [lo, hi] = autoRange(lib, f.image, f.mask);
    peak = Math.max(peak, Math.abs(lo), Math.abs(hi));
  }
  peak = peak || 1;
  return [-peak, peak];
}

// ---------------------------------------------------------------------------------------------
// Pass grouping
// ---------------------------------------------------------------------------------------------

/**
 * Split layers into survey passes and describe each one.
 * -> [{ index, layers, mjd, mjd0, mjd1, label, dates }]
 */
export function describePasses(lib, layers) {
  const passes = splitPasses(lib, layers);
  return passes.map((group, index) => {
    const mjds = group.map((l) => l.mjd);
    const mjd0 = Math.min(...mjds);
    const mjd1 = Math.max(...mjds);
    const mjd = mjds.reduce((a, b) => a + b, 0) / mjds.length;
    const d0 = fmtDay(mjd0);
    const d1 = fmtDay(mjd1);
    return {
      index,
      layers: group,
      mjd,
      mjd0,
      mjd1,
      label: fmtMonth(mjd),
      dates: d0 === d1 ? d0 : `${d0} to ${d1}`,
    };
  });
}

function passTitle(pass, total) {
  return `Pass ${pass.index + 1} of ${total} · ${pass.label}`;
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function emptyMovie(view, reason, extra = {}) {
  return { view, frames: [], empty: reason, notes: [], candidates: [], passes: [], ...extra };
}

// ---------------------------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------------------------

function buildPasses(ctx, lib) {
  const layers = normalizeLayers(lib, ctx.layers);
  const passes = describePasses(lib, layers);
  const frames = passes.map((pass) => {
    const s = stack(lib, pass.layers);
    return {
      image: s.image,
      mask: s.mask,
      variance: s.variance,
      range: null,
      mjd: pass.mjd,
      pass: pass.index,
      passLabel: pass.label,
      layers: pass.layers,
      short: `Pass ${pass.index + 1} · ${pass.label}`,
      caption: {
        title: passTitle(pass, passes.length),
        date: pass.dates,
        wave: detWaveLabel(lib, ctx.det),
        note: `${plural(pass.layers.length, 'exposure')} stacked`,
      },
    };
  });
  const range = commonRange(lib, frames);
  for (const f of frames) f.range = range;
  const notes = [];
  if (passes.length === 1) notes.push('Only one survey pass covers this spot so far, so there is nothing to blink against yet.');
  return { view: 'passes', frames, empty: null, notes, candidates: [], passes };
}

function buildExposures(ctx, lib) {
  const layers = normalizeLayers(lib, ctx.layers);
  const passes = describePasses(lib, layers);
  const frames = [];
  for (const pass of passes) {
    for (const layer of pass.layers) {
      const wave = layerWave(layer);
      const k = frames.length + 1;
      frames.push({
        image: layer.image,
        mask: layer.mask,
        variance: layer.variance,
        range: null,
        mjd: layer.mjd,
        pass: pass.index,
        passLabel: pass.label,
        layers: [layer],
        short: `#${k} · ${fmtDay(layer.mjd)} · ${fmtWave(wave, 2)}`,
        caption: {
          title: `Exposure ${k} of ${layers.length}`,
          date: fmtDateTime(layer.mjd),
          wave: fmtWave(wave),
          note: 'Each exposure is a different wavelength, which is why this view flickers',
        },
      });
    }
  }
  const range = commonRange(lib, frames);
  for (const f of frames) f.range = range;
  return { view: 'exposures', frames, empty: null, notes: [], candidates: [], passes };
}

/** Choose the layers of channel `ch`, widening to neighbouring channels until at least two. */
export function selectChannel(lib, layers, ch) {
  const chans = layers.map((l) => channelOfLayer(lib, l));
  let radius = 0;
  let picked = [];
  for (; radius <= 16; radius++) {
    picked = layers.filter((_, i) => chans[i] >= 0 && Math.abs(chans[i] - ch) <= radius);
    if (picked.length >= 2) break;
  }
  if (picked.length < 2) {
    picked = layers.slice();
    radius = 16;
  }
  const used = picked.map((l) => channelOfLayer(lib, l)).filter((c) => c >= 0);
  const lo = used.length ? Math.min(...used) : ch;
  const hi = used.length ? Math.max(...used) : ch;
  return { layers: picked, radius: Math.min(radius, 16), chLo: Math.min(lo, ch), chHi: Math.max(hi, ch) };
}

function buildMatched(ctx, lib) {
  const ch = Number.isInteger(ctx.ch) ? ctx.ch : 8;
  const sel = selectChannel(lib, ctx.layers, ch);
  const layers = normalizeLayers(lib, sel.layers);
  const passes = describePasses(lib, layers);
  const [w0] = channelRange(lib, ctx.det, sel.chLo);
  const [, w1] = channelRange(lib, ctx.det, sel.chHi);
  const waveLabel =
    sel.chLo === sel.chHi
      ? `channel ${ch + 1} · ${w0.toFixed(3)}–${w1.toFixed(3)} ${MICRON}`
      : `channels ${sel.chLo + 1}–${sel.chHi + 1} · ${w0.toFixed(3)}–${w1.toFixed(3)} ${MICRON}`;
  const frames = passes.map((pass) => {
    const s = stack(lib, pass.layers);
    return {
      image: s.image,
      mask: s.mask,
      variance: s.variance,
      range: null,
      mjd: pass.mjd,
      pass: pass.index,
      passLabel: pass.label,
      layers: pass.layers,
      short: `Pass ${pass.index + 1} · ${pass.label}`,
      caption: {
        title: passTitle(pass, passes.length),
        date: pass.dates,
        wave: waveLabel,
        note: `${plural(pass.layers.length, 'exposure')} at matched wavelength`,
      },
    };
  });
  const range = commonRange(lib, frames);
  for (const f of frames) f.range = range;
  const notes = [];
  if (sel.radius > 0) {
    notes.push(
      `Channel ${ch + 1} has fewer than two exposures of this spot, so channels ${sel.chLo + 1}–${sel.chHi + 1} are combined.`,
    );
  }
  if (passes.length === 1) notes.push('All matching exposures fall in one survey pass, so there is a single frame.');
  return { view: 'matched', frames, empty: null, notes, candidates: [], passes, channels: [sel.chLo, sel.chHi] };
}

/** Fit the per-pixel sky model to background-normalised layers (see prepareResidual). */
export function fitModel(lib, layers) {
  if (!lib.fitSkyModel) return null;
  return lib.fitSkyModel(layers, {});
}

/**
 * Everything the residual view and the candidate list need, computed once per detector load:
 * -> { model, candidates } (model null when the fit is unavailable).
 */
export function prepareResidual(lib, layers, grid) {
  if (!lib.fitSkyModel || !lib.residualLayer || !layers || layers.length < 4) return { model: null, candidates: [] };
  const norm = normalizeLayers(lib, layers);
  const model = fitModel(lib, norm);
  if (!model) return { model: null, candidates: [] };
  return { model, candidates: findChangeCandidates(lib, model, norm, grid) };
}

function residualOf(lib, model, layer) {
  const r = lib.residualLayer(model, layer);
  return { ...layer, image: r.image, mask: r.mask || layer.mask, snr: r.snr || null };
}

function peaksOf(score, n, { threshold = 5, max = 12, border = 2, kind = null, minSep = 3 } = {}) {
  const found = [];
  for (let y = border; y < n - border; y++) {
    for (let x = border; x < n - border; x++) {
      const v = score[y * n + x];
      if (!(v >= threshold)) continue;
      let isMax = true;
      for (let dy = -2; dy <= 2 && isMax; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (!dx && !dy) continue;
          const w = score[(y + dy) * n + (x + dx)];
          if (w > v || (w === v && (dy < 0 || (dy === 0 && dx < 0)))) {
            isMax = false;
            break;
          }
        }
      }
      if (isMax) found.push({ x, y, score: v, kind: kind ? kind[y * n + x] : 0 });
    }
  }
  found.sort((a, b) => b.score - a.score);
  const kept = [];
  for (const c of found) {
    if (kept.every((k) => Math.hypot(k.x - c.x, k.y - c.y) >= minSep)) kept.push(c);
    if (kept.length >= max) break;
  }
  return kept;
}

const COMPASS_8 = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
const KIND_LABEL = { 0: 'changed', 1: 'varies', 2: 'moved', varies: 'varies', moved: 'moved', variable: 'varies', mover: 'moved' };

/**
 * Candidates for change: uses core findCandidates when present, otherwise peaks of the
 * changeMap significance. -> [{ ra, dec, x, y, score, kind: 'varies' | 'moved' | 'changed', label }]
 */
export function findChangeCandidates(lib, model, layers, grid, { max = 12 } = {}) {
  let raw = null;
  if (lib.findCandidates) {
    try {
      const out = lib.findCandidates(model, layers, { max: Math.max(40, max * 4) });
      const list = Array.isArray(out) ? out : out && Array.isArray(out.candidates) ? out.candidates : null;
      if (list) raw = list;
    } catch {
      raw = null;
    }
  }
  if (!raw && lib.changeMap) {
    try {
      const map = lib.changeMap(model, layers);
      if (map && map.score) raw = peaksOf(map.score, grid.n, { kind: map.kind, max });
    } catch {
      raw = null;
    }
  }
  if (!raw) return [];
  const out = [];
  for (const c of raw) {
    let { ra, dec, x, y } = c;
    if ((!Number.isFinite(ra) || !Number.isFinite(dec)) && lib.gridPixToSky && Number.isFinite(x) && Number.isFinite(y)) {
      [ra, dec] = lib.gridPixToSky(grid, x, y);
    }
    if ((!Number.isFinite(x) || !Number.isFinite(y)) && lib.gridSkyToPix && Number.isFinite(ra)) {
      [x, y] = lib.gridSkyToPix(grid, ra, dec);
    }
    if (!Number.isFinite(ra) || !Number.isFinite(dec)) continue;
    const score = Math.abs(Number.isFinite(c.score) ? c.score : Number.isFinite(c.snr) ? c.snr : Number.isFinite(c.significance) ? c.significance : NaN);
    const kind = KIND_LABEL[c.kind] || 'changed';
    // Which way a saturated star's halo shifted, as a compass word.
    let towards = '';
    if (c.saturated && c.shift && lib.gridPixToSky && Number.isFinite(c.shift.dx) && Number.isFinite(c.shift.dy)) {
      try {
        const [ra2, dec2] = lib.gridPixToSky(grid, x + 4 * c.shift.dx, y + 4 * c.shift.dy);
        const east = (((ra2 - ra + 540) % 360) - 180) * Math.cos((dec * Math.PI) / 180);
        const north = dec2 - dec;
        const pa = ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360;
        towards = COMPASS_8[Math.round(pa / 45) % 8];
      } catch {
        towards = '';
      }
    }
    out.push({
      ...c,
      towards,
      ra,
      dec,
      x,
      y,
      score,
      kind,
      sign: Number.isFinite(c.snr) ? Math.sign(c.snr) : 0,
      passLabel: typeof c.label === 'string' ? c.label : '',
      label: `${kind} · ${Number.isFinite(score) ? score.toFixed(1) : '?'}σ`,
    });
  }
  return clusterCandidates(out, grid, max);
}

/**
 * A mover leaves a bright and a dark lobe in every pass, and a bright star leaves several
 * peaks. Peaks closer than about 30 arcsec are one object: keep the strongest, count the rest,
 * and call the group 'moved' if any member is.
 */
export function clusterCandidates(list, grid, max = 12, radiusArcsec = 30) {
  const sorted = [...list].sort((a, b) => (b.score || 0) - (a.score || 0));
  const radiusPix = radiusArcsec / (grid && grid.scale ? grid.scale : 3.075);
  const groups = [];
  for (const c of sorted) {
    const home = groups.find((g) => g.members.some((m) => Math.hypot(m.x - c.x, m.y - c.y) <= radiusPix));
    if (home) {
      home.members.push(c);
      // A saturated star's verdict comes from its whole halo and is not overruled by a lump in it.
      if (c.kind === 'moved' && !home.lead.saturated) home.kind = 'moved';
    } else groups.push({ lead: c, kind: c.kind, members: [c] });
  }
  return groups.slice(0, max).map((g) => ({
    ...g.lead,
    kind: g.kind,
    peaks: g.members.length + (g.lead.saturated && g.lead.peaks > 1 ? g.lead.peaks - 1 : 0),
    label: `${g.kind} · ${Number.isFinite(g.lead.score) ? g.lead.score.toFixed(1) : '?'}σ`,
  }));
}

function buildResidual(ctx, lib) {
  if (!lib.fitSkyModel || !lib.residualLayer) {
    return emptyMovie('residual', 'Predicted-sky subtraction is not available in this build.');
  }
  if (ctx.layers.length < 4) {
    return emptyMovie('residual', 'Predicted-sky subtraction needs at least four exposures of this spot; fewer are loaded.');
  }
  const layers = normalizeLayers(lib, ctx.layers);
  const model = ctx.model || fitModel(lib, layers);
  if (!model) return emptyMovie('residual', 'The sky model could not be fitted for this field.');
  const passes = describePasses(lib, layers);
  const frames = [];
  if (ctx.perExposure) {
    for (const pass of passes) {
      for (const layer of pass.layers) {
        const r = residualOf(lib, model, layer);
        const k = frames.length + 1;
        const wave = layerWave(layer);
        frames.push({
          image: r.image,
          mask: r.mask,
          range: null,
          diverging: true,
          mjd: layer.mjd,
          pass: pass.index,
          passLabel: pass.label,
          layers: [layer],
          short: `#${k} · ${fmtDay(layer.mjd)} · ${fmtWave(wave, 2)}`,
          caption: {
            title: `Residual · exposure ${k} of ${layers.length}`,
            date: fmtDateTime(layer.mjd),
            wave: fmtWave(wave),
            note: 'Observed minus predicted sky at this wavelength',
          },
        });
      }
    }
  } else {
    let stacks = null;
    if (lib.residualPassStacks) {
      try {
        const out = lib.residualPassStacks(model, layers);
        if (Array.isArray(out) && out.length === passes.length && out.every((s) => s && s.image)) stacks = out;
      } catch {
        stacks = null;
      }
    }
    passes.forEach((pass, i) => {
      const s = stacks ? stacks[i] : stack(lib, pass.layers.map((layer) => residualOf(lib, model, layer)));
      frames.push({
        image: s.image,
        mask: s.mask,
        variance: s.variance,
        range: null,
        diverging: true,
        mjd: pass.mjd,
        pass: pass.index,
        passLabel: pass.label,
        layers: pass.layers,
        snr: s.snr || null,
        short: `Pass ${pass.index + 1} · ${pass.label}`,
        caption: {
          title: `Residual · pass ${pass.index + 1} of ${passes.length} · ${pass.label}`,
          date: pass.dates,
          wave: detWaveLabel(lib, ctx.det),
          note: `Observed minus predicted sky, ${plural(pass.layers.length, 'exposure')} stacked`,
        },
      });
    });
  }
  // Wide enough that noise stays dark on the two-sided colormap and only real residue shows.
  const range = symmetricRange(lib, frames, ctx.perExposure ? 8 : 12);
  for (const f of frames) f.range = range;
  const candidates = ctx.candidates || findChangeCandidates(lib, model, layers, ctx.grid);
  const markers = candidates.map((c, i) => ({ ra: c.ra, dec: c.dec, kind: 'candidate', label: String(i + 1) }));
  for (const f of frames) f.markers = markers;
  const notes = [];
  if (passes.length === 1) notes.push('With a single pass the model and the data share the same epoch, so only fast changes show.');
  return { view: 'residual', frames, empty: null, notes, candidates, passes, model };
}

function buildDiff(ctx, lib) {
  const layers = normalizeLayers(lib, ctx.layers);
  const passes = describePasses(lib, layers);
  if (passes.length < 2) {
    return emptyMovie('diff', 'Only one survey pass covers this spot so far, so there is nothing to subtract yet.', { passes });
  }
  const last = passes.length - 1;
  let a = Number.isInteger(ctx.diffA) && ctx.diffA >= 0 && ctx.diffA <= last ? ctx.diffA : 0;
  let b = Number.isInteger(ctx.diffB) && ctx.diffB >= 0 && ctx.diffB <= last ? ctx.diffB : last;
  if (a === b) {
    if (b === last) a = last - 1 >= 0 ? (a === 0 ? 0 : last - 1) : 0;
    if (a === b) b = a === last ? last - 1 : last;
  }
  const sa = stack(lib, passes[a].layers);
  const sb = stack(lib, passes[b].layers);
  const d = subtract(lib, sb, sa);
  const frame = {
    image: d.image,
    mask: d.mask,
    range: null,
    diverging: true,
    mjd: passes[b].mjd,
    pass: 0,
    passLabel: `${passes[b].label} − ${passes[a].label}`,
    short: `Pass ${b + 1} − pass ${a + 1}`,
    caption: {
      title: `Pass ${b + 1} minus pass ${a + 1}`,
      date: `${passes[b].label} − ${passes[a].label}`,
      wave: detWaveLabel(lib, ctx.det),
      note: `Positive means brighter in pass ${b + 1}`,
    },
  };
  frame.range = symmetricRange(lib, [frame], 12);
  return { view: 'diff', frames: [frame], empty: null, notes: [], candidates: [], passes, pair: [a, b] };
}

/** Detectors a lens needs (core lensNeeds when present, else lens.dets). */
export function lensDetectors(lib, lensId) {
  const lens = (lib.LENSES || []).find((l) => l.id === lensId);
  if (!lens) return [];
  if (lib.lensNeeds) {
    try {
      const d = lib.lensNeeds(lens);
      const list = Array.isArray(d) ? d : d && Array.isArray(d.dets) ? d.dets : null;
      if (list && list.length) return [...new Set(list)].sort((x, y) => x - y);
    } catch {
      // fall through
    }
  }
  return Array.isArray(lens.dets) ? [...new Set(lens.dets)].sort((x, y) => x - y) : [];
}

function getDetLayers(layersByDet, det) {
  if (!layersByDet) return null;
  if (layersByDet instanceof Map) return layersByDet.get(det) || null;
  return layersByDet[det] || null;
}

function lensFrame(ctx, lib, lens, dets, byDet, label) {
  const kind = lens.kind || (lens.id === 'rgb' ? 'rgb' : 'depth');
  if (lib.lensImage) {
    const out = lib.lensImage(lens, new Map(dets.map((d) => [d, getDetLayers(byDet, d)])));
    if (out && (out.image || out.rgba)) {
      const order = [...dets].sort((x, y) => y - x);
      if (out.rgba) {
        return { rgba: out.rgba, image: out.image, mask: out.mask, kind: 'rgb', range: null, note: `Red D${order[0]}, green D${order[1]}, blue D${order[2]}` };
      }
      return {
        image: out.image,
        mask: out.mask,
        kind: out.kind || kind,
        label: out.label || label,
        range: null,
        note: (out.kind || kind) === 'ratio' ? 'Band brightness divided by continuum brightness' : 'Absorption depth: 1 \u2212 band / continuum',
      };
    }
  }
  if (kind !== 'rgb' || !lib.rgbComposite || dets.length < 3) return null;
  // Fallback colour composite: longest wavelength detector to red.
  const order = [...dets].sort((x, y) => y - x).slice(0, 3);
  const stacks = order.map((d) => stack(lib, normalizeLayers(lib, getDetLayers(byDet, d))));
  const ranges = stacks.map((s) => autoRange(lib, s.image, s.mask, { lo: 1, hi: 99.5 }));
  const rgba = lib.rgbComposite(stacks[0].image, stacks[1].image, stacks[2].image, ranges);
  return {
    rgb: { r: stacks[0].image, g: stacks[1].image, b: stacks[2].image, ranges },
    rgba,
    image: stacks[1].image,
    mask: stacks[1].mask,
    kind: 'rgb',
    range: ranges[1],
    note: `Red D${order[0]}, green D${order[1]}, blue D${order[2]}`,
  };
}

function buildLens(ctx, lib) {
  const lenses = lib.LENSES || [];
  if (!lenses.length) return emptyMovie('lens', 'Spectral lenses are not available in this build.');
  const lens = lenses.find((l) => l.id === ctx.lens) || lenses[0];
  const dets = lensDetectors(lib, lens.id);
  const byDet = ctx.layersByDet || new Map();
  const missing = dets.filter((d) => {
    const l = getDetLayers(byDet, d);
    return !l || !l.length;
  });
  if (missing.length) {
    return emptyMovie('lens', `The ${lens.label} lens needs detector${missing.length > 1 ? 's' : ''} ${missing.map((d) => `D${d}`).join(', ')}.`, {
      needs: missing,
      lens,
    });
  }
  const all = [];
  for (const d of dets) for (const l of getDetLayers(byDet, d)) all.push(l);
  const passes = describePasses(lib, all);
  const frames = [];
  const makeFrame = (pass, sub) => {
    let made = null;
    try {
      made = lensFrame(ctx, lib, lens, dets, sub, lens.label);
    } catch {
      made = null;
    }
    if (!made) return;
    frames.push({
      image: made.image,
      mask: made.mask,
      rgb: made.rgb || null,
      rgba: made.rgba || null,
      range: made.range,
      diverging: made.kind === 'depth',
      lensKind: made.kind,
      mjd: pass ? pass.mjd : all.reduce((a, l) => a + l.mjd, 0) / all.length,
      pass: pass ? pass.index : 0,
      passLabel: pass ? pass.label : 'All passes',
      short: pass ? `Pass ${pass.index + 1} · ${pass.label}` : 'All passes',
      caption: {
        title: `${lens.label}${pass ? ` · pass ${pass.index + 1} of ${passes.length}` : ''}`,
        date: pass ? pass.dates : `${fmtDay(Math.min(...all.map((l) => l.mjd)))} to ${fmtDay(Math.max(...all.map((l) => l.mjd)))}`,
        wave: Array.isArray(lens.band) ? `${lens.band[0].toFixed(2)}–${lens.band[1].toFixed(2)} ${MICRON} band` : dets.map((d) => `D${d}`).join(' + '),
        note: made.note || 'Absorption depth: 1 − band / continuum',
      },
    });
  };
  if (passes.length >= 2) {
    for (const pass of passes) {
      const inPass = new Set(pass.layers);
      const sub = new Map(dets.map((d) => [d, getDetLayers(byDet, d).filter((l) => inPass.has(l))]));
      if (dets.every((d) => sub.get(d).length > 0)) makeFrame(pass, sub);
    }
  }
  if (!frames.length) makeFrame(null, new Map(dets.map((d) => [d, getDetLayers(byDet, d)])));
  if (!frames.length) return emptyMovie('lens', `The ${lens.label} lens could not be computed for this field.`, { lens });
  const depth = frames.filter((f) => f.lensKind === 'depth');
  if (depth.length) {
    let peak = 0;
    for (const f of depth) {
      const [lo, hi] = autoRange(lib, f.image, f.mask, { lo: 1, hi: 99.5 });
      peak = Math.max(peak, Math.abs(lo), Math.abs(hi));
    }
    peak = Math.min(1, Math.max(0.2, peak || 0.5));
    for (const f of depth) f.range = [-peak, peak];
  }
  const ratio = frames.filter((f) => f.lensKind === 'ratio');
  if (ratio.length) {
    const range = commonRange(lib, ratio);
    for (const f of ratio) f.range = range;
  }
  return { view: 'lens', frames, empty: null, notes: [], candidates: [], passes, lens };
}

/**
 * Offsets in arcsec (east, north) of a body at distAU, seen at (ra, dec) at the reference
 * epoch, for each mjd: zero at refMjd. Uses core trackThrough when present, else predictedTrack.
 * -> { offsets: [{ dEast, dNorth }], track }
 */
export function trackOffsets(lib, ra, dec, distAU, mjds, refMjd) {
  const all = [...mjds, refMjd];
  if (lib.trackThrough) {
    const track = lib.trackThrough(ra, dec, distAU, all, { refIndex: all.length - 1 });
    return { offsets: track.slice(0, mjds.length).map((p) => ({ dEast: p.dEast, dNorth: p.dNorth })), track: track.slice(0, mjds.length) };
  }
  const track = lib.predictedTrack(ra, dec, distAU, all);
  const ref = track[track.length - 1];
  const cosd = Math.cos((ref.dec * Math.PI) / 180);
  const offsets = [];
  for (let i = 0; i < mjds.length; i++) {
    let dra = track[i].ra - ref.ra;
    if (dra > 180) dra -= 360;
    if (dra < -180) dra += 360;
    offsets.push({ dEast: dra * cosd * 3600, dNorth: (track[i].dec - ref.dec) * 3600 });
  }
  return { offsets, track: track.slice(0, mjds.length) };
}

/** Largest hop in arcsec between consecutive passes for a body at distAU. */
export function passHop(lib, ra, dec, distAU, passes) {
  if (!Number.isFinite(distAU)) return 0;
  if (passes.length >= 2 && (lib.trackThrough || lib.predictedTrack)) {
    try {
      const mjds = passes.map((p) => p.mjd);
      const { offsets } = trackOffsets(lib, ra, dec, distAU, mjds, mjds[0]);
      let hop = 0;
      for (let i = 1; i < offsets.length; i++) {
        hop = Math.max(hop, Math.hypot(offsets[i].dEast - offsets[i - 1].dEast, offsets[i].dNorth - offsets[i - 1].dNorth));
      }
      if (Number.isFinite(hop)) return hop;
    } catch {
      // fall through
    }
  }
  if (lib.hopArcsec) {
    try {
      const h = lib.hopArcsec(distAU);
      if (Number.isFinite(h)) return h;
    } catch {
      // fall through
    }
  }
  return (2 / distAU) * 206264.8;
}

function buildDistance(ctx, lib) {
  const layers = normalizeLayers(lib, ctx.layers);
  const passes = describePasses(lib, layers);
  const still = stack(lib, layers);
  const fieldArcsec = ctx.grid.n * ctx.grid.scale;
  const frames = [
    {
      image: still.image,
      mask: still.mask,
      range: null,
      mjd: layers.reduce((a, l) => a + l.mjd, 0) / layers.length,
      pass: 0,
      passLabel: 'Stars held still',
      short: 'Stars held still',
      caption: {
        title: 'Stars held still',
        date: `${fmtDay(Math.min(...layers.map((l) => l.mjd)))} to ${fmtDay(Math.max(...layers.map((l) => l.mjd)))}`,
        wave: detWaveLabel(lib, ctx.det),
        note: `${plural(layers.length, 'exposure')} stacked with no shift (infinite distance)`,
      },
    },
  ];
  const notes = [];
  const dist = ctx.dist;
  let hop = 0;
  let used = layers.length;
  if (!Number.isFinite(dist)) {
    notes.push('The dial is at infinity: nothing is shifted. Slide it inward to follow a body at that distance.');
  } else if (!(lib.predictedTrack || lib.trackThrough) || !lib.shiftAndStack) {
    notes.push('Shift-and-stack is not available in this build.');
  } else {
    const centre = ctx.center || { ra: ctx.grid.ra0, dec: ctx.grid.dec0 };
    hop = passHop(lib, centre.ra, centre.dec, dist, passes);
    // Reference epoch: the middle of the best-covered pass.
    const refPass = passes.reduce((best, p) => (p.layers.length > best.layers.length ? p : best), passes[0]);
    const { offsets } = trackOffsets(lib, centre.ra, centre.dec, dist, layers.map((l) => l.mjd), refPass.mjd);
    const limit = fieldArcsec / 2 - 2 * ctx.grid.scale;
    const keep = [];
    const keepOffsets = [];
    let maxShift = 0;
    layers.forEach((layer, i) => {
      const r = Math.hypot(offsets[i].dEast, offsets[i].dNorth);
      if (r <= limit) {
        keep.push(layer);
        keepOffsets.push(offsets[i]);
        maxShift = Math.max(maxShift, r);
      }
    });
    used = keep.length;
    if (keep.length) {
      let s = null;
      try {
        s = lib.shiftAndStack(keep, ctx.grid, keepOffsets, {});
      } catch {
        s = null;
      }
      if (s && s.image) {
        frames.push({
          image: s.image,
          mask: s.mask,
          range: null,
          mjd: refPass.mjd,
          pass: 1,
          passLabel: `Tracking ${fmtDistance(dist)}`,
          short: `Tracking ${fmtDistance(dist)}`,
          caption: {
            title: `Tracking a body at ${fmtDistance(dist)}`,
            date: `reference ${fmtDay(refPass.mjd)}`,
            wave: detWaveLabel(lib, ctx.det),
            note: `${plural(keep.length, 'exposure')} shifted by up to ${maxShift.toFixed(1)}${ARCSEC} and stacked`,
          },
        });
      } else {
        notes.push('The shifted stack could not be computed for this distance.');
      }
    }
    if (hop > limit && passes.length > 1) {
      notes.push(
        `At ${fmtDistance(dist)} a body hops about ${Math.round(hop)}${ARCSEC} between passes, more than this ${Math.round(fieldArcsec)}${ARCSEC} field can hold. ` +
          `Only the ${plural(used, 'exposure')} that stay inside the field are combined (reference pass ${refPass.index + 1}). ` +
          'To follow it across passes, widen the field or re-centre on each pass.',
      );
    } else if (used < layers.length) {
      notes.push(`${layers.length - used} of ${layers.length} exposures would shift outside the field and are left out.`);
    }
  }
  const range = commonRange(lib, [frames[0]]);
  for (const f of frames) f.range = range;
  return { view: 'distance', frames, empty: null, notes, candidates: [], passes, hop, used, fieldArcsec };
}

const BUILDERS = {
  passes: buildPasses,
  exposures: buildExposures,
  matched: buildMatched,
  residual: buildResidual,
  diff: buildDiff,
  lens: buildLens,
  distance: buildDistance,
};

/**
 * buildMovie(view, ctx, lib) -> { view, frames, empty, notes, candidates, passes, ... }
 *
 * ctx: { layers, grid, det, ch, lens, dist, diffA, diffB, perExposure, model, candidates,
 *        layersByDet, center }.  `empty` is a plain-language reason when there are no frames.
 */
export function buildMovie(view, ctx, lib = {}) {
  const build = BUILDERS[view] || buildPasses;
  if (view !== 'lens' && (!ctx || !ctx.layers || !ctx.layers.length)) {
    return emptyMovie(view, 'No exposures are loaded for this detector.');
  }
  return build(ctx, lib);
}

/** Group consecutive frames by pass for the timeline: [{ pass, label, start, end }]. */
export function timelineGroups(frames) {
  const groups = [];
  frames.forEach((f, i) => {
    const last = groups[groups.length - 1];
    if (last && last.pass === f.pass) last.end = i;
    else groups.push({ pass: f.pass, label: f.passLabel || '', start: i, end: i });
  });
  return groups;
}

// ---------------------------------------------------------------------------------------------
// Gaia ghosts
// ---------------------------------------------------------------------------------------------

/**
 * Where Gaia says each star should be on a frame's date, and whether the image agrees.
 * stars: [{ ra, dec, pmra, pmdec, parallax, gmag, epoch }] -> [{ ra, dec, label?, moved, star }]
 */
export function gaiaGhosts(lib, stars, frame, grid, { max = 80, measure = true, tolArcsec = 3.2 } = {}) {
  if (!stars || !stars.length || !lib.gridSkyToPix) return [];
  const out = [];
  const n = grid.n;
  for (const star of stars) {
    if (out.length >= max) break;
    let pos = { ra: star.ra, dec: star.dec };
    if (lib.propagate && Number.isFinite(frame.mjd)) {
      try {
        pos = lib.propagate(
          { ra: star.ra, dec: star.dec, pmra: star.pmra || 0, pmdec: star.pmdec || 0, parallax: star.parallax || 0, epoch: star.epoch ?? 2016.0 },
          frame.mjd,
        );
      } catch {
        pos = { ra: star.ra, dec: star.dec };
      }
    }
    const [x, y] = lib.gridSkyToPix(grid, pos.ra, pos.dec);
    if (!(x >= 0 && y >= 0 && x <= n - 1 && y <= n - 1)) continue;
    let moved = false;
    if (measure && lib.centroid && frame.image && !frame.diverging && !frame.rgb && x > 3 && y > 3 && x < n - 4 && y < n - 4) {
      try {
        const c = lib.centroid(frame.image, frame.mask, n, x, y, { box: 5 });
        if (c && c.ok && c.flux > 0) {
          const off = Math.hypot(c.x - x, c.y - y) * grid.scale;
          moved = off > tolArcsec && off < 5 * grid.scale;
        }
      } catch {
        moved = false;
      }
    }
    const pm = Math.hypot(star.pmra || 0, star.pmdec || 0);
    const ghost = { ra: pos.ra, dec: pos.dec, moved, star };
    if (pm >= 200) ghost.label = `${(pm / 1000).toFixed(pm >= 1000 ? 1 : 2)}${ARCSEC}/yr`;
    out.push(ghost);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Click analysis: spectrum, light curve, motion
// ---------------------------------------------------------------------------------------------

/** Spectrum and light curve at a sky position from the native frames of all loaded detectors. */
export function measureSpectrum(lib, frames, ra, dec, opts = {}) {
  if (!lib.extractSpectrum) return { points: [], binned: [], curve: [], ok: false };
  const points = lib.extractSpectrum(frames, ra, dec, opts && typeof opts.track === 'function' ? { track: opts.track } : {}) || [];
  let binned = [];
  let curve = [];
  try {
    if (lib.binSpectrum) binned = lib.binSpectrum(points, { perChannel: true }) || [];
  } catch {
    binned = [];
  }
  try {
    if (lib.lightCurve) curve = lib.lightCurve(points) || [];
  } catch {
    curve = [];
  }
  return { points, binned, curve, ok: points.some((p) => p && p.ok !== false && Number.isFinite(p.flux_uJy)) };
}

/**
 * Is the source that was followed from pass to pass the catalogue star next to it?
 *   'none'        no Gaia star with a proper motion nearby
 *   'unmeasured'  no motion could be measured (one pass, or the source was lost)
 *   'consistent'  the measured motion agrees with the star's within 3 sigma
 *   'different'   it does not, by more than 0.5 arcsec a year as well: a mover that Gaia does
 *                 not list, seen next to (or blended with) a star that Gaia does list
 * The error used is the fit's own, with a floor of 0.3 arcsec/yr for what the fit does not
 * know about (frame registration, blending with neighbours).
 * -> { verdict, diff, err } with diff and err in mas/yr (NaN when not applicable).
 */
export function compareWithGaia(motion) {
  const m = motion && motion.measured;
  const g = motion && motion.gaia;
  if (!g || g.total === null || !Number.isFinite(g.pmra) || !Number.isFinite(g.pmdec)) return { verdict: 'none', diff: NaN, err: NaN };
  if (!m || !Number.isFinite(m.pmra) || !Number.isFinite(m.pmdec)) return { verdict: 'unmeasured', diff: NaN, err: NaN };
  const diff = Math.hypot(m.pmra - g.pmra, m.pmdec - g.pmdec);
  const fitErr = Math.hypot(Number.isFinite(m.errPmra) ? m.errPmra : 0, Number.isFinite(m.errPmdec) ? m.errPmdec : 0);
  const err = Math.max(300, fitErr);
  return { verdict: diff > 3 * err && diff > 500 ? 'different' : 'consistent', diff, err };
}

/**
 * The entry of the built-in target table that is at (ra, dec) on date mjd, if any: each target
 * is carried to that date with its own proper motion and parallax and must then lie within
 * `tolArcsec` (default 5, most of one SPHEREx pixel). So a source is called "Barnard's
 * Star" only when it is where Barnard's Star is on that date. -> the target or null.
 */
export function knownTargetAt(lib, ra, dec, mjd, tolArcsec = 5) {
  if (!Array.isArray(lib.TARGETS) || !lib.positionNow || !lib.separationArcsec || !Number.isFinite(mjd)) return null;
  let best = null;
  let bestSep = tolArcsec;
  for (const t of lib.TARGETS) {
    try {
      const pos = lib.positionNow(t, mjd);
      const sep = lib.separationArcsec(ra, dec, pos.ra, pos.dec);
      if (sep <= bestSep) {
        best = t;
        bestSep = sep;
      }
    } catch {
      // a target that cannot be propagated is not a match
    }
  }
  return best;
}

/**
 * Where to point the photometry aperture at each date, for a source that moves enough to
 * leave it: the Gaia star's own track when the source is that star and moves at least
 * 0.3 arcsec a year, the fitted straight line when the source is a mover Gaia does not list.
 * -> { track: (mjd) => { ra, dec }, kind: 'gaia' | 'fit' } or null (aperture stays put).
 */
export function photometryTrack(lib, motion, verdict) {
  if (!motion) return null;
  const m = motion.measured;
  if (verdict === 'different' && m && Number.isFinite(m.ra0) && Number.isFinite(m.mjd0) && lib.offsetBy) {
    return {
      kind: 'fit',
      track: (mjd) => {
        const t = (mjd - m.mjd0) / 365.25;
        return lib.offsetBy(m.ra0, m.dec0, (m.pmra / 1000) * t, (m.pmdec / 1000) * t);
      },
    };
  }
  const g = motion.gaia;
  if (verdict !== 'different' && g && g.star && g.total >= 300 && lib.propagate) {
    const star = g.star;
    const src = { ra: star.ra, dec: star.dec, pmra: star.pmra || 0, pmdec: star.pmdec || 0, parallax: star.parallax || 0, epoch: star.epoch ?? 2016.0 };
    return {
      kind: 'gaia',
      track: (mjd) => {
        try {
          const pos = lib.propagate(src, mjd);
          return { ra: pos.ra, dec: pos.dec };
        } catch {
          return null;
        }
      },
    };
  }
  return null;
}

/**
 * Follow a source through the per-pass stacks, starting near (ra, dec), and fit its motion.
 * -> { track: [{ mjd, ra, dec, w }], measured: fitMotion result | null, gaia: { pmra, pmdec, total, star } | null }
 */
export function measureMotion(lib, layers, grid, ra, dec, { stars = [], startMjd = null, tolArcsec = 8 } = {}) {
  const result = { track: [], measured: null, gaia: null, saturated: false };
  if (!lib.centroid || !lib.gridSkyToPix || !lib.gridPixToSky || !layers || !layers.length) return result;
  const passes = describePasses(lib, normalizeLayers(lib, layers));
  if (!passes.length) return result;
  const stacks = passes.map((p) => stack(lib, p.layers));
  const n = grid.n;
  // Begin with the pass nearest in time to the frame the user clicked, then walk outward so a
  // fast mover is followed from one pass to the next.
  let start = 0;
  if (Number.isFinite(startMjd)) {
    let best = Infinity;
    passes.forEach((p, i) => {
      const d = Math.abs(p.mjd - startMjd);
      if (d < best) {
        best = d;
        start = i;
      }
    });
  }
  const [x0, y0] = lib.gridSkyToPix(grid, ra, dec);
  const found = new Array(passes.length).fill(null);
  const locate = (i, x, y) => {
    const near = (c) => c && c.ok && Number.isFinite(c.x) && Number.isFinite(c.y) && Math.hypot(c.x - x, c.y - y) < 6;
    try {
      // A saturated star has a masked core: the ordinary centroid would settle on one side of
      // the hole, so such a source is located from its wings instead.
      const core = lib.maskedCoreRadius ? lib.maskedCoreRadius(stacks[i].image, stacks[i].mask, n, x, y) : 0;
      if (core > 0 && lib.centroidWings) {
        const w = lib.centroidWings(stacks[i].image, stacks[i].mask, n, x, y);
        return near(w) ? w : null;
      }
      const c = lib.centroid(stacks[i].image, stacks[i].mask, n, x, y, { box: 5 });
      if (near(c)) return c;
    } catch {
      // ignore
    }
    return null;
  };
  found[start] = locate(start, x0, y0);
  let prev = found[start] || { x: x0, y: y0 };
  for (let i = start + 1; i < passes.length; i++) {
    found[i] = locate(i, prev.x, prev.y);
    if (found[i]) prev = found[i];
  }
  prev = found[start] || { x: x0, y: y0 };
  for (let i = start - 1; i >= 0; i--) {
    found[i] = locate(i, prev.x, prev.y);
    if (found[i]) prev = found[i];
  }
  passes.forEach((p, i) => {
    if (!found[i]) return;
    const [r, d] = lib.gridPixToSky(grid, found[i].x, found[i].y);
    const errPix = Math.hypot(Number.isFinite(found[i].xErr) ? found[i].xErr : 0.15, Number.isFinite(found[i].yErr) ? found[i].yErr : 0.15) / Math.SQRT2;
    const sigma = Math.max(0.15, errPix * grid.scale); // arcsec, with a floor for undersampling
    const point = { mjd: p.mjd, ra: r, dec: d, sigma, err_arcsec: sigma, w: 1 / (sigma * sigma), snr: found[i].snr };
    if (found[i].method === 'wings') {
      point.method = 'wings';
      result.saturated = true;
    }
    result.track.push(point);
  });
  if (result.track.length >= 2 && lib.fitMotion) {
    try {
      let m = null;
      if (result.track.length >= 4 && lib.fitMotionWithParallax) m = lib.fitMotionWithParallax(result.track);
      if (!m || !Number.isFinite(m.pmra)) m = lib.fitMotion(result.track);
      if (m && Number.isFinite(m.pmra) && Number.isFinite(m.pmdec)) result.measured = m;
    } catch {
      result.measured = null;
    }
  }
  if (stars && stars.length && lib.matchGaia) {
    const at = result.track.length ? result.track[0] : { ra, dec, mjd: passes[start].mjd };
    try {
      const star = lib.matchGaia(stars, at.ra, at.dec, at.mjd, tolArcsec);
      if (star) {
        const pmra = Number.isFinite(star.pmra) ? star.pmra : null;
        const pmdec = Number.isFinite(star.pmdec) ? star.pmdec : null;
        result.gaia = { pmra, pmdec, total: pmra === null || pmdec === null ? null : Math.hypot(pmra, pmdec), star };
      }
    } catch {
      result.gaia = null;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------------------------
// Display only: closing the holes that flagged pixels leave in bright stars
// ---------------------------------------------------------------------------------------------

/**
 * A copy of an image in which small enclosed holes (masked or non-finite pixels: a saturated
 * star core, a cosmic-ray hit) are filled from their rims, for DISPLAY ONLY. Measurements keep
 * using the original image and mask.
 *
 * A hole is filled when it does not touch the edge of the image and covers at most `maxFrac`
 * of it (default 8%, enough for the core of a first-magnitude star in a 4 arcmin view), so the sky a detector never covered stays empty. Filling works inward
 * ring by ring: a pixel takes the mean of its already-known neighbours, which gives a
 * saturated star a flat top at the level of its rim instead of a hatched patch.
 *
 * -> { image, mask, filled } where mask marks only what is still missing and `filled` counts
 *    the pixels filled, or null when there was nothing to fill.
 */
export function fillMaskedForDisplay(image, mask, n, { maxFrac = 0.08 } = {}) {
  if (!image || !(n > 0)) return null;
  const ny = Math.floor(image.length / n);
  const total = n * ny;
  const missing = new Uint8Array(total);
  let any = 0;
  for (let i = 0; i < total; i++) {
    if ((mask && mask[i]) || !Number.isFinite(image[i])) {
      missing[i] = 1;
      any++;
    }
  }
  if (!any) return null;
  const label = new Int32Array(total); // 0 = not visited
  const stack = new Int32Array(total);
  const out = new Float32Array(image);
  const still = new Uint8Array(missing);
  const limit = Math.max(1, Math.floor(maxFrac * total));
  let filled = 0;
  let next = 0;
  for (let start = 0; start < total; start++) {
    if (!missing[start] || label[start]) continue;
    next += 1;
    // Flood fill one hole (4-connected), remembering its pixels.
    let top = 0;
    stack[top++] = start;
    label[start] = next;
    const members = [];
    let touchesEdge = false;
    while (top > 0) {
      const i = stack[--top];
      members.push(i);
      const x = i % n;
      const y = (i - x) / n;
      if (x === 0 || y === 0 || x === n - 1 || y === ny - 1) touchesEdge = true;
      if (x > 0 && missing[i - 1] && !label[i - 1]) { label[i - 1] = next; stack[top++] = i - 1; }
      if (x < n - 1 && missing[i + 1] && !label[i + 1]) { label[i + 1] = next; stack[top++] = i + 1; }
      if (y > 0 && missing[i - n] && !label[i - n]) { label[i - n] = next; stack[top++] = i - n; }
      if (y < ny - 1 && missing[i + n] && !label[i + n]) { label[i + n] = next; stack[top++] = i + n; }
    }
    if (touchesEdge || members.length > limit) continue;
    // Fill inward, one ring at a time.
    let todo = members;
    for (let round = 0; round < 64 && todo.length; round++) {
      const values = [];
      const later = [];
      for (const i of todo) {
        const x = i % n;
        const y = (i - x) / n;
        let sum = 0, count = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const xx = x + dx, yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= n || yy >= ny) continue;
            const j = yy * n + xx;
            if (still[j]) continue;
            sum += out[j];
            count++;
          }
        }
        if (count) values.push([i, sum / count]);
        else later.push(i);
      }
      if (!values.length) break;
      for (const [i, v] of values) {
        out[i] = v;
        still[i] = 0;
        filled++;
      }
      todo = later;
    }
  }
  if (!filled) return null;
  return { image: out, mask: still, filled };
}
