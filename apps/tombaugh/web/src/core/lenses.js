// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

// Spectral lenses: maps of how strongly each pixel absorbs in a molecular band.
//
// A lens compares the brightness inside an absorption band with the continuum on either side:
//     depth = 1 - band / continuum          (0 = no absorption, 1 = completely dark in the band)
// Because the wavelength varies across every SPHEREx frame, exposures are sorted into the band
// and continuum windows PIXEL BY PIXEL using each layer's wavelength map, not frame by frame.
//
// Band and continuum are measured in different exposures, taken at different times. If the
// source changed or moved between survey passes, a plain average over all exposures would
// compare a "bright epoch" band with a "faint epoch" continuum and invent an absorption. So
// the windows are averaged per pass first, and the passes are then combined with the SAME
// weights for band and continuum: a pass in which the source was twice as bright contributes
// twice as much to both, and the ratio is unaffected.
//
// Give the lens background-normalised layers (stack.js normalizeBackground): a sky offset adds to
// band and continuum alike and would dilute the depth.

import { DETECTORS, splitPasses } from './frames.js';
import { stackLayers } from './stack.js';

/**
 * The lenses. `band` and `continuum` are wavelength windows in micrometres; `dets` are the
 * detectors that have to be loaded. kind 'depth' maps 1 - band/continuum, kind 'ratio' maps
 * band/continuum (one continuum window, used as the denominator), kind 'rgb' is a colour image.
 */
export const LENSES = [
  {
    id: 'methane',
    kind: 'depth',
    label: 'Methane (3.3 µm)',
    description: 'Depth of the 3.3 µm methane band. Cold brown dwarfs and giant planets absorb strongly here; ordinary stars do not.',
    band: [3.15, 3.45],
    continuum: [[2.9, 3.05], [3.6, 3.8]],
    dets: [4],
  },
  {
    id: 'cold',
    kind: 'ratio',
    label: 'Cold-object contrast (4.6 / 3.3 µm)',
    description: 'Brightness at 4.5–4.8 µm divided by brightness at 3.2–3.5 µm. Methane removes the light at 3.3 µm while 4.6 µm stays clear, so a cold object stands well above 1.',
    band: [4.5, 4.8],
    continuum: [[3.2, 3.5]],
    dets: [4, 6],
  },
  {
    id: 'water',
    kind: 'depth',
    label: 'Water ice (3.05 µm)',
    description: 'Depth of the 3 µm water band: ice on cold grains and icy bodies, steam in the coolest stellar atmospheres.',
    band: [2.95, 3.15],
    continuum: [[2.6, 2.8], [3.5, 3.7]],
    dets: [4],
  },
  {
    id: 'co2',
    kind: 'depth',
    label: 'CO₂ ice (4.27 µm)',
    description: 'Depth of the 4.27 µm carbon dioxide ice band, a marker of cold, shielded material.',
    band: [4.20, 4.33],
    // The red window runs past the nominal end of detector 5 (4.41 um); the part that detector 5
    // covers is enough, so detector 6 is not requested just for this sliver.
    continuum: [[4.05, 4.15], [4.38, 4.45]],
    dets: [5],
  },
  {
    id: 'co',
    kind: 'depth',
    label: 'CO (4.67 µm)',
    description: 'Depth of the 4.67 µm carbon monoxide band: ice in cold clouds, gas in cool stellar atmospheres.',
    band: [4.62, 4.72],
    continuum: [[4.45, 4.55], [4.80, 4.90]],
    dets: [6],
  },
  {
    id: 'rgb',
    kind: 'rgb',
    label: 'Three-detector colour',
    description: 'Blue 1.1–1.6 µm (detector 2), green 2.4–3.8 µm (detector 4), red 4.4–5.0 µm (detector 6): the infrared colour of everything in the field.',
    band: [1.10, 5.00],
    continuum: [],
    dets: [2, 4, 6],
    rgb: { r: 6, g: 4, b: 2 },
  },
];

function resolveLens(lens) {
  return typeof lens === 'string' ? LENSES.find((l) => l.id === lens) || null : lens || null;
}

/**
 * Detectors a lens needs, ascending, so the loader can fetch them. Accepts a lens or its id.
 * Uses lens.dets when present, otherwise every detector overlapping one of the windows.
 */
export function lensNeeds(lens) {
  const l = resolveLens(lens);
  if (!l) return [];
  if (Array.isArray(l.dets) && l.dets.length) return [...new Set(l.dets)].sort((a, b) => a - b);
  const windows = [l.band, ...(l.continuum || [])].filter(Boolean);
  return DETECTORS.filter((d) => windows.some(([lo, hi]) => hi >= d.min && lo <= d.max)).map((d) => d.det);
}

function layersOf(layersByDet, det) {
  if (!layersByDet) return [];
  const v = layersByDet instanceof Map ? layersByDet.get(det) : layersByDet[det];
  return Array.isArray(v) ? v : [];
}

/**
 * Inverse-variance weighted mean brightness of each pixel within each wavelength window.
 * A sample contributes to a window when the layer's wavelength AT THAT PIXEL lies in it.
 * Returns one { flux, variance, wave } (Float64Array each, NaN where the window has no sample)
 * per window; `wave` is the weighted mean wavelength of the samples used.
 */
function windowMeans(layers, windows, npix) {
  const acc = windows.map(() => ({
    sw: new Float64Array(npix), swv: new Float64Array(npix), swl: new Float64Array(npix),
  }));
  const nw = windows.length;
  for (const layer of layers) {
    const { image, variance, wave } = layer;
    const mask = layer.mask || null;
    if (!image || !variance || !wave) continue;
    for (let i = 0; i < npix; i++) {
      if (mask !== null && mask[i] !== 0) continue;
      const w = wave[i];
      for (let k = 0; k < nw; k++) {
        if (w >= windows[k][0] && w < windows[k][1]) {
          const v = image[i];
          const s2 = variance[i];
          if (v - v === 0 && s2 > 0 && s2 !== Infinity) {
            const iw = 1 / s2;
            acc[k].sw[i] += iw;
            acc[k].swv[i] += iw * v;
            acc[k].swl[i] += iw * w;
          }
        }
      }
    }
  }
  return acc.map(({ sw, swv, swl }) => {
    const flux = new Float64Array(npix);
    const variance = new Float64Array(npix);
    for (let i = 0; i < npix; i++) {
      if (sw[i] > 0) {
        flux[i] = swv[i] / sw[i];
        variance[i] = 1 / sw[i];
        swl[i] /= sw[i];
      } else {
        flux[i] = NaN;
        variance[i] = NaN;
        swl[i] = NaN;
      }
    }
    return { flux, variance, wave: swl };
  });
}

function percentileRange(image, mask, lo, hi) {
  const vals = [];
  for (let i = 0; i < image.length; i++) {
    const v = image[i];
    if ((mask && mask[i]) || v - v !== 0) continue;
    vals.push(v);
  }
  if (!vals.length) return [0, 1];
  const sorted = Float64Array.from(vals).sort();
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))))];
  const a = at(lo);
  const b = at(hi);
  return b > a ? [a, b] : [a, a + 1];
}

/** Pool per-pass window means back into one mean over all passes (inverse-variance weights). */
function poolWindows(perPass, npix) {
  if (perPass.length === 1) return perPass[0];
  return perPass[0].map((_, k) => {
    const flux = new Float64Array(npix);
    const variance = new Float64Array(npix);
    const wave = new Float64Array(npix);
    for (let i = 0; i < npix; i++) {
      let sw = 0, swv = 0, swl = 0;
      for (const pass of perPass) {
        const v = pass[k].variance[i];
        if (v > 0) { sw += 1 / v; swv += pass[k].flux[i] / v; swl += pass[k].wave[i] / v; }
      }
      flux[i] = sw > 0 ? swv / sw : NaN;
      variance[i] = sw > 0 ? 1 / sw : NaN;
      wave[i] = sw > 0 ? swl / sw : NaN;
    }
    return { flux, variance, wave };
  });
}

/**
 * Continuum under the band at pixel i from one set of continuum window means.
 * With data on both sides of the band: the straight line between the nearest blue and the
 * nearest red window, evaluated at the band's mean wavelength `lamB` (so a sloped spectrum
 * does not fake an absorption). With one side only: that side as it is.
 * Writes [continuum, variance, number of sides used (0, 1 or 2)] into `out`.
 */
function continuumAt(cont, blue, red, i, lamB, out) {
  let kb = -1;
  let kr = -1;
  for (const k of blue) if (cont[k].variance[i] > 0) { kb = k; break; }
  for (const k of red) if (cont[k].variance[i] > 0) { kr = k; break; }
  if (kb >= 0 && kr >= 0 && cont[kr].wave[i] > cont[kb].wave[i]) {
    const f = (lamB - cont[kb].wave[i]) / (cont[kr].wave[i] - cont[kb].wave[i]);
    out[0] = (1 - f) * cont[kb].flux[i] + f * cont[kr].flux[i];
    out[1] = (1 - f) * (1 - f) * cont[kb].variance[i] + f * f * cont[kr].variance[i];
    out[2] = 2;
  } else if (kb >= 0 || kr >= 0) {
    const k = kb >= 0 ? kb : kr;
    out[0] = cont[k].flux[i];
    out[1] = cont[k].variance[i];
    out[2] = 1;
  } else {
    out[0] = NaN;
    out[1] = NaN;
    out[2] = 0;
  }
}

/**
 * Apply a lens to the loaded layers.
 *
 *   layersByDet  Map<det, Layer[]> (a plain object keyed by detector works too); all layers on
 *                the same grid. Detectors the lens does not need are ignored.
 *
 * kind 'depth' (methane, water, co2, co):
 *   band      = weighted mean of the samples whose wavelength lies in lens.band
 *   continuum = the same for each continuum window, interpolated linearly to the band's mean
 *               wavelength when there is a window on each side (see continuumAt)
 *   Both are measured per survey pass and the passes combined with common weights
 *   1 / (band variance + continuum variance), using the passes that have the band and both
 *   sides of the continuum at that pixel. If no pass is complete, all exposures are pooled
 *   instead (less robust for sources that changed, but better than nothing).
 *   image     = 1 - band / continuum
 *   mask      = 1 where the continuum is detected at less than `minSnr` (default 3) sigma, or
 *               the band or the continuum has no data
 * kind 'ratio' (cold): image = band / continuum, combined over passes in the same way. Where
 *   the continuum (denominator) is below 3 sigma it is replaced by its 3 sigma upper limit,
 *   which makes the ratio a lower limit (`limit` = 1 there): the objects this lens is for are
 *   often invisible at 3.3 um. Masked where the band (numerator) is below `minSnr` sigma.
 * kind 'rgb': a colour composite of the stacks of three detectors; `image` is their mean and
 *   `rgba` the Uint8ClampedArray from rgbComposite.
 *
 * Returns { image: Float32Array, mask: Uint8Array, label } plus kind, sigma (1 sigma error of
 * the image), band and continuum (the two brightness maps, MJy/sr), and limit / rgba as above.
 * Options: minSnr (3), gapDays (45, the gap that separates survey passes).
 */
export function lensImage(lens, layersByDet, { minSnr = 3, gapDays = 45 } = {}) {
  const l = resolveLens(lens);
  if (!l) return { image: new Float32Array(0), mask: new Uint8Array(0), label: '' };
  const dets = lensNeeds(l);
  const layers = dets.flatMap((d) => layersOf(layersByDet, d));
  const npix = layers.length ? layers[0].image.length : 0;
  const image = new Float32Array(npix);
  const mask = new Uint8Array(npix);
  const sigma = new Float32Array(npix);
  const out = { image, mask, label: l.label, kind: l.kind || 'depth', sigma };

  if (l.kind === 'rgb') {
    const pick = l.rgb || { r: dets[2], g: dets[1], b: dets[0] };
    const stacks = ['r', 'g', 'b'].map((c) => {
      const ls = layersOf(layersByDet, pick[c]);
      return ls.length ? stackLayers(ls) : { image: new Float32Array(npix).fill(NaN), mask: new Uint8Array(npix).fill(1) };
    });
    for (let i = 0; i < npix; i++) {
      let s = 0;
      let k = 0;
      for (const st of stacks) if (!st.mask[i]) { s += st.image[i]; k++; }
      image[i] = k ? s / k : NaN;
      mask[i] = k ? 0 : 1;
    }
    out.rgba = rgbComposite(stacks[0], stacks[1], stacks[2]);
    out.label = `${l.label}: red D${pick.r}, green D${pick.g}, blue D${pick.b}`;
    return out;
  }

  // Window means per survey pass (layers without a time form one extra group), and pooled.
  const windows = [l.band, ...l.continuum];
  const groups = splitPasses(layers, gapDays);
  const undated = layers.filter((layer) => !Number.isFinite(layer.mjd));
  if (undated.length) groups.push(undated);
  if (!groups.length) groups.push([]);
  const perPass = groups.map((pass) => windowMeans(pass, windows, npix));
  const pooled = poolWindows(perPass, npix);
  const contOf = perPass.map((w) => w.slice(1));
  const pooledCont = pooled.slice(1);

  // Continuum windows on the blue and on the red side of the band, nearest first.
  const centre = 0.5 * (l.band[0] + l.band[1]);
  const mid = l.continuum.map(([a, b]) => 0.5 * (a + b));
  const order = mid.map((_, k) => k).sort((a, b) => Math.abs(mid[a] - centre) - Math.abs(mid[b] - centre));
  const isRatio = l.kind === 'ratio';
  const blue = isRatio ? order : order.filter((k) => mid[k] < centre);
  const red = isRatio ? [] : order.filter((k) => mid[k] >= centre);
  const sidesNeeded = blue.length && red.length ? 2 : 1;

  const bandMap = new Float32Array(npix);
  const contMap = new Float32Array(npix);
  const limit = isRatio ? new Uint8Array(npix) : null;
  out.band = bandMap;
  out.continuum = contMap;
  if (limit) out.limit = limit;
  const c = new Float64Array(3);

  for (let i = 0; i < npix; i++) {
    // Combine the complete passes with weights common to band and continuum.
    let sw = 0, sB = 0, sC = 0, svB = 0, svC = 0;
    for (let p = 0; p < perPass.length; p++) {
      const vB = perPass[p][0].variance[i];
      if (!(vB > 0)) continue;
      continuumAt(contOf[p], blue, red, i, perPass[p][0].wave[i], c);
      if (c[2] < sidesNeeded || !(c[1] > 0)) continue;
      const w = 1 / (vB + c[1]);
      sw += w;
      sB += w * perPass[p][0].flux[i];
      sC += w * c[0];
      svB += w * w * vB;
      svC += w * w * c[1];
    }
    let B, vB, C, vC;
    if (sw > 0) {
      B = sB / sw; vB = svB / (sw * sw); C = sC / sw; vC = svC / (sw * sw);
    } else {
      B = pooled[0].flux[i];
      vB = pooled[0].variance[i];
      continuumAt(pooledCont, blue, red, i, pooled[0].wave[i], c);
      C = c[0];
      vC = c[1];
    }
    bandMap[i] = B;
    contMap[i] = C;

    if (isRatio) {
      // band = numerator, continuum = denominator
      if (!(vB > 0) || !(vC > 0) || !(B >= minSnr * Math.sqrt(vB))) {
        image[i] = NaN;
        sigma[i] = NaN;
        mask[i] = 1;
        continue;
      }
      const floor = 3 * Math.sqrt(vC);
      const d = C >= floor ? C : floor;
      if (C < floor) limit[i] = 1;
      image[i] = B / d;
      sigma[i] = Math.sqrt(vB / (d * d) + (C >= floor ? B * B * vC / (d * d * d * d) : 0));
      continue;
    }
    if (!(vB > 0) || !(vC > 0) || !(C >= minSnr * Math.sqrt(vC))) {
      image[i] = NaN;
      sigma[i] = NaN;
      mask[i] = 1;
      continue;
    }
    image[i] = 1 - B / C;
    sigma[i] = Math.sqrt(vB / (C * C) + B * B * vC / (C * C * C * C));
  }
  return out;
}

/**
 * Colour composite of three images on the same grid.
 *
 *   r, g, b   Float32Array, or { image, mask } (a stack or a layer)
 *   ranges    [[rMin, rMax], [gMin, gMax], [bMin, bMax]] or { r, g, b }; a missing range is set
 *             from that image's 1st and 99.5th percentiles
 *   options   Q (asinh softening, default 8: larger shows fainter detail), and
 *             preserveColor (default false).
 *
 * Each channel is scaled to x = (v - min) / (max - min). By default each channel then gets its
 * own asinh stretch, asinh(Q x) / asinh(Q). With preserveColor the stretch is applied to the
 * mean intensity I = (xr + xg + xb) / 3 and all three channels are multiplied by the same factor
 * asinh(Q I) / (asinh(Q) I), rescaled together if one would saturate (Lupton et al. 2004), so
 * the ratio between channels, the colour, survives in bright sources instead of washing out to
 * white. Missing pixels are black. Returns Uint8ClampedArray(n*n*4), alpha 255, in the same
 * row order as the inputs.
 */
export function rgbComposite(r, g, b, ranges, { Q = 8, preserveColor = false } = {}) {
  const chans = [r, g, b].map((c) => (c && c.image ? c : { image: c, mask: null }));
  const npix = chans[0].image ? chans[0].image.length : 0;
  const given = Array.isArray(ranges) ? ranges : ranges ? [ranges.r, ranges.g, ranges.b] : [];
  const rng = chans.map((c, k) => {
    const g2 = given[k];
    if (g2 && Number.isFinite(g2[0]) && Number.isFinite(g2[1]) && g2[1] > g2[0]) return g2;
    return percentileRange(c.image, c.mask, 1, 99.5);
  });
  const out = new Uint8ClampedArray(npix * 4);
  const norm = 1 / Math.asinh(Q);
  const x = [0, 0, 0];
  for (let i = 0; i < npix; i++) {
    for (let k = 0; k < 3; k++) {
      const c = chans[k];
      const v = c.image[i];
      x[k] = (c.mask && c.mask[i]) || v - v !== 0 ? 0 : Math.max(0, (v - rng[k][0]) / (rng[k][1] - rng[k][0]));
    }
    if (preserveColor) {
      const I = (x[0] + x[1] + x[2]) / 3;
      const f = I > 0 ? Math.asinh(Q * I) * norm / I : 0;
      const peak = Math.max(x[0], x[1], x[2]) * f;
      const s = peak > 1 ? f / peak : f;
      for (let k = 0; k < 3; k++) out[i * 4 + k] = 255 * x[k] * s;
    } else {
      for (let k = 0; k < 3; k++) out[i * 4 + k] = 255 * Math.min(1, Math.asinh(Q * x[k]) * norm);
    }
    out[i * 4 + 3] = 255;
  }
  return out;
}
