// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// inject.js - plant a simulated body into real exposures. Pure functions, no DOM.
//
// "Injection and recovery" is how a survey measures what it could have found: add a fake source
// of known brightness to the real data, with the real noise, stars and artefacts still there, run
// the normal detection pipeline, and see whether the fake comes out. This file does the planting:
//
//   planTrack           where a body at a chosen heliocentric distance appears at each exposure
//                       date (parallax hop from the Earth ephemeris plus its own orbital drift)
//   injectIntoLayers    add the body to reprojected layers on the common grid
//   injectIntoFrames    add the body to native detector frames (through the frame WCS)
//
// The inputs are never modified: new layer / frame objects with a fresh image array are returned,
// and every one carries an `injected` list saying exactly what was added and where. Variance,
// wavelength and mask arrays are shared with the originals.
//
// No noise is added. Near the detection limit a source is far fainter than the sky under it, so
// its own photon noise is negligible, and the noise that decides whether it is found is already
// in the real frame.

import { predictedTrack, heliocentricFromApparent, keplerRate } from '../../core/distance.js';
import { tangentOffset } from '../../core/astrometry.js';
import { gridSkyToPix, makeWcs } from '../../core/wcs.js';

/** 1 MJy/sr over one native 6.15 arcsec SPHEREx pixel is 889 microjansky (CONTRACT.md). */
export const MJYSR_TO_UJY_PER_NATIVE_PIX = 889;
export const NATIVE_PIX_ARCSEC = 6.15;
export const DEFAULT_FWHM_ARCSEC = 7.5;
const FWHM_TO_SIGMA = 1 / 2.3548200450309493;
const DEG = Math.PI / 180;
const OBLIQUITY_DEG = 23.4392911111;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Microjansky carried by 1 MJy/sr over one pixel of the given size. */
export function ujyPerMJySr(pixArcsec) {
  const r = pixArcsec / NATIVE_PIX_ARCSEC;
  return MJYSR_TO_UJY_PER_NATIVE_PIX * r * r;
}

/**
 * Width of a point source after it has been through a native pixel and bilinear resampling.
 * A reprojected layer does not show the bare PSF: the light was first integrated over a native
 * pixel (a box of width p, variance p^2/12) and then interpolated bilinearly onto the grid (a
 * triangle of half-width p, variance p^2/6). Averaged over sub-pixel phase the result is the
 * PSF convolved with both, so the variances add. For the 7.5 arcsec SPHEREx PSF and 6.15 arcsec
 * pixels this gives 10.4 arcsec. Planting the bare PSF on the grid would make the fake sharper,
 * and so easier to find, than a real body.
 */
export function effectiveFwhmArcsec(fwhmArcsec = DEFAULT_FWHM_ARCSEC, nativePixArcsec = NATIVE_PIX_ARCSEC) {
  const s = fwhmArcsec * FWHM_TO_SIGMA;
  const p = nativePixArcsec > 0 ? nativePixArcsec : 0;
  return Math.sqrt(s * s + (p * p) / 12 + (p * p) / 6) / FWHM_TO_SIGMA;
}

/** Error function: Maclaurin series below 2.5, continued fraction for erfc above. Error below 1e-12. */
export function erf(x) {
  if (!isNum(x)) return x > 0 ? 1 : x < 0 ? -1 : NaN;
  const a = Math.abs(x);
  if (a > 6) return x > 0 ? 1 : -1;
  if (a < 1e-8) return (2 / Math.sqrt(Math.PI)) * x;
  let y;
  if (a < 2.5) {
    // Maclaurin series: erf(a) = 2/sqrt(pi) * sum (-1)^k a^(2k+1) / (k! (2k+1))
    let term = a;
    let sum = a;
    for (let k = 1; k < 80; k++) {
      term *= -(a * a) / k;
      const add = term / (2 * k + 1);
      sum += add;
      if (Math.abs(add) < 1e-17 * Math.abs(sum)) break;
    }
    y = (2 / Math.sqrt(Math.PI)) * sum;
  } else {
    // Continued fraction for erfc (Lentz), converges fast for a > 2
    let f = a;
    for (let k = 60; k >= 1; k--) f = a + (k / 2) / f;
    y = 1 - Math.exp(-a * a) / (Math.sqrt(Math.PI) * f);
  }
  return x > 0 ? y : -y;
}

// ---- where the body is -------------------------------------------------------------------------

/**
 * Drift of a circular, prograde, low-inclination orbit at heliocentric distance distAU: the
 * Kepler rate (distance.js keplerRate: 116 arcsec/yr at 500 AU) pointed along increasing
 * ecliptic longitude at (ra, dec). The real direction depends on an orbit nobody knows; this is
 * the plain default. Returns the `motion` object predictedTrack wants.
 */
export function circularMotion(ra, dec, distAU) {
  const rate = keplerRate(distAU);
  if (!(rate > 0) || !isNum(rate)) return { raRate_arcsecPerYr: 0, decRate_arcsecPerYr: 0 };
  const a = ra * DEG, d = dec * DEG, e = OBLIQUITY_DEG * DEG;
  const r = [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)];
  const k = [0, -Math.sin(e), Math.cos(e)];                         // ecliptic north pole
  let t = [k[1] * r[2] - k[2] * r[1], k[2] * r[0] - k[0] * r[2], k[0] * r[1] - k[1] * r[0]];
  const len = Math.hypot(t[0], t[1], t[2]);
  if (!(len > 1e-9)) return { raRate_arcsecPerYr: rate, decRate_arcsecPerYr: 0 };
  t = [t[0] / len, t[1] / len, t[2] / len];
  const east = [-Math.sin(a), Math.cos(a), 0];
  const north = [-Math.sin(d) * Math.cos(a), -Math.sin(d) * Math.sin(a), Math.cos(d)];
  return {
    raRate_arcsecPerYr: rate * (t[0] * east[0] + t[1] * east[1] + t[2] * east[2]),
    decRate_arcsecPerYr: rate * (t[0] * north[0] + t[1] * north[1] + t[2] * north[2]),
  };
}

/**
 * Where a body at heliocentric distance distAU appears at each date.
 *
 * (ra, dec) is where the body APPEARS from the Earth at the reference date `refMjd` (default
 * mjds[0]); that is what "plant it here, in this exposure" means. With anchor: 'heliocentric',
 * (ra, dec) is instead its direction from the Sun at the reference date. The geometry is exact
 * (core/distance.js predictedTrack -> core/ephemeris.js parallaxOffset: body vector minus Earth
 * vector), so it holds at 30 AU as well as at 100,000 AU. An infinite distance gives a body
 * that does not move.
 *
 * motion: the body's own drift, { raRate_arcsecPerYr, decRate_arcsecPerYr } (east rate already
 * includes cos dec), or the string 'circular' for circularMotion(), or nothing for none.
 *
 * @returns {Array<{ mjd: number, ra: number, dec: number, dEast: number, dNorth: number, distGeoAU: number }>}
 *   one entry per date; dEast / dNorth are tangent-plane arcsec from (ra, dec).
 */
export function planTrack({ ra, dec, distAU, mjds, motion, refMjd, anchor = 'apparent' }) {
  const list = Array.from(mjds || []);
  if (!list.length) return [];
  const ref = isNum(refMjd) ? refMjd : list[0];
  const finite = distAU > 0 && Number.isFinite(distAU);
  let h = { ra, dec };
  if (anchor !== 'heliocentric' && finite) h = heliocentricFromApparent(ra, dec, distAU, ref);
  let mot = motion === 'circular' ? circularMotion(h.ra, h.dec, distAU) : motion;
  mot = mot && typeof mot === 'object' ? { ...mot, refMjd: ref } : { refMjd: ref };
  const track = predictedTrack(h.ra, h.dec, finite ? distAU : Infinity, list, { motion: mot });
  return track.map((p) => {
    const off = tangentOffset(p.ra, p.dec, ra, dec);
    return { mjd: p.mjd, ra: p.ra, dec: p.dec, dEast: off.dEast, dNorth: off.dNorth, distGeoAU: p.distGeoAU };
  });
}

/** The track entry that belongs to exposure i taken at `mjd` (by index, else by nearest date). */
function trackEntry(track, i, mjd) {
  if (!track || !track.length) return null;
  const direct = track[i];
  if (direct && (!isNum(direct.mjd) || !isNum(mjd) || Math.abs(direct.mjd - mjd) < 1e-6)) return direct;
  if (!isNum(mjd)) return direct || null;
  let best = null;
  let bestDt = 0.5;                                               // days: beyond this, not this exposure
  for (const p of track) {
    if (!p || !isNum(p.mjd)) continue;
    const dt = Math.abs(p.mjd - mjd);
    if (dt < bestDt) { bestDt = dt; best = p; }
  }
  return best;
}

/**
 * Grid pixel of the body in every layer: [{ x, y, onGrid, mjd, ra, dec }] (x, y fractional,
 * 0-based; NaN where the track has no entry for that layer). Track entries may also carry
 * ready-made pixel positions { x, y }, which are used as they are.
 */
export function trackOnGrid(track, grid, layers) {
  const n = grid.n;
  return (layers || []).map((layer, i) => {
    const p = trackEntry(track, i, layer ? layer.mjd : NaN);
    if (!p) return { x: NaN, y: NaN, onGrid: false, mjd: layer ? layer.mjd : NaN, ra: NaN, dec: NaN };
    let x = p.x, y = p.y;
    if (!isNum(x) || !isNum(y)) [x, y] = gridSkyToPix(grid, p.ra, p.dec);
    const onGrid = isNum(x) && isNum(y) && x >= -0.5 && x <= n - 0.5 && y >= -0.5 && y <= n - 0.5;
    return { x, y, onGrid, mjd: layer ? layer.mjd : NaN, ra: p.ra, dec: p.dec };
  });
}

// ---- adding the light --------------------------------------------------------------------------

/**
 * Add a Gaussian of total `sum` (in image units times pixels) centred on (x0, y0) to an nx x ny
 * image, integrating the profile over each pixel exactly (differences of error functions) rather
 * than sampling it at pixel centres. Pixels that are masked or not finite are left alone.
 * @returns {number} the fraction of `sum` that actually landed on usable pixels
 */
export function addGaussian(image, nx, ny, x0, y0, sigmaPix, sum, mask) {
  if (!isNum(x0) || !isNum(y0) || !(sigmaPix > 0) || !isNum(sum)) return 0;
  const reach = Math.ceil(5 * sigmaPix + 1);
  const xa = Math.max(0, Math.floor(x0) - reach), xb = Math.min(nx - 1, Math.ceil(x0) + reach);
  const ya = Math.max(0, Math.floor(y0) - reach), yb = Math.min(ny - 1, Math.ceil(y0) + reach);
  if (xb < xa || yb < ya) return 0;
  const k = 1 / (Math.SQRT2 * sigmaPix);
  const wx = new Float64Array(xb - xa + 1);
  for (let x = xa; x <= xb; x++) wx[x - xa] = 0.5 * (erf((x + 0.5 - x0) * k) - erf((x - 0.5 - x0) * k));
  let got = 0;
  for (let y = ya; y <= yb; y++) {
    const wy = 0.5 * (erf((y + 0.5 - y0) * k) - erf((y - 0.5 - y0) * k));
    if (wy === 0) continue;
    const row = y * nx;
    for (let x = xa; x <= xb; x++) {
      const i = row + x;
      if (mask && mask[i]) continue;
      const v = image[i];
      if (v - v !== 0) continue;                                   // NaN or infinite: missing
      const w = wx[x - xa] * wy;
      image[i] = v + sum * w;
      got += w;
    }
  }
  return got;
}

/** Wavelength at (x, y): the nearest pixel with a usable value within two pixels, else NaN. */
function waveNear(wave, nx, ny, x, y) {
  if (!wave) return NaN;
  const cx = Math.min(nx - 1, Math.max(0, Math.round(x)));
  const cy = Math.min(ny - 1, Math.max(0, Math.round(y)));
  let best = NaN;
  let bestD = Infinity;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const xx = cx + dx, yy = cy + dy;
      if (xx < 0 || yy < 0 || xx >= nx || yy >= ny) continue;
      const w = wave[yy * nx + xx];
      const d = dx * dx + dy * dy;
      if (w > 0 && Number.isFinite(w) && d < bestD) { bestD = d; best = w; }
    }
  }
  return best;
}

function sourceList(opts) {
  const o = opts || {};
  const list = Array.isArray(o.sources) && o.sources.length ? o.sources : [{ track: o.track, fluxAt: o.fluxAt }];
  return list.filter((s) => s && s.track && typeof s.fluxAt === 'function');
}

/**
 * Plant one or more simulated bodies into layers on the common grid. Returns NEW layers; the
 * inputs are not touched.
 *
 * For each layer and each source: find the body's grid position from its track, read the layer's
 * own wavelength at that position, ask fluxAt(wave_um) for the brightness in microjansky, convert
 * to surface brightness (889 uJy per MJy/sr per native pixel, scaled to the grid pixel area) and
 * add a pixel-integrated Gaussian. A source that falls off the grid in a layer (the parallax hop
 * is often larger than the field) simply is not in that layer.
 *
 * @param {Array<object>} layers  Layer[] of the contract
 * @param {{ n: number, scale: number, ra0: number, dec0: number }} grid
 * @param {{ track?: Array<object>, fluxAt?: (wave_um: number) => number,
 *           sources?: Array<{ track: Array<object>, fluxAt: (wave_um: number) => number, id?: any }>,
 *           fwhmArcsec?: number, nativePixArcsec?: number }} opts
 *   track: planTrack() output (sky positions per date) or entries with pixel positions { x, y };
 *   fwhmArcsec: PSF width, default 7.5;
 *   nativePixArcsec: if > 0, broaden the PSF by the native-pixel and resampling response
 *     (effectiveFwhmArcsec). Pass 6.15 for layers that came out of reproject(); default 0 plants
 *     the bare Gaussian.
 * @returns {Array<object>} new layers; each has `injected`: [{ id, x, y, ra, dec, wave, flux_uJy,
 *   onGrid, deposited }] appended to any list already there (deposited = fraction of the flux
 *   that landed on usable pixels).
 */
export function injectIntoLayers(layers, grid, opts = {}) {
  const n = grid.n;
  const fwhm = opts.fwhmArcsec > 0 ? opts.fwhmArcsec : DEFAULT_FWHM_ARCSEC;
  const eff = opts.nativePixArcsec > 0 ? effectiveFwhmArcsec(fwhm, opts.nativePixArcsec) : fwhm;
  const sigmaPix = (eff * FWHM_TO_SIGMA) / grid.scale;
  const unit = ujyPerMJySr(grid.scale);
  const sources = sourceList(opts).map((s) => ({ ...s, pos: trackOnGrid(s.track, grid, layers) }));
  const reach = 5 * sigmaPix + 1;
  return (layers || []).map((layer, i) => {
    const image = new Float32Array(layer.image);
    const injected = Array.isArray(layer.injected) ? layer.injected.slice() : [];
    for (let s = 0; s < sources.length; s++) {
      const src = sources[s];
      const p = src.pos[i];
      const rec = {
        id: src.id !== undefined ? src.id : s, x: p.x, y: p.y, ra: p.ra, dec: p.dec,
        wave: NaN, flux_uJy: 0, onGrid: p.onGrid, deposited: 0,
      };
      const near = isNum(p.x) && isNum(p.y) && p.x > -reach && p.x < n - 1 + reach && p.y > -reach && p.y < n - 1 + reach;
      if (near) {
        const wave = waveNear(layer.wave, n, n, p.x, p.y);
        const w = isNum(wave) ? wave : (layer.frame && isNum(layer.frame.waveCenter) ? layer.frame.waveCenter : NaN);
        let flux = NaN;
        if (isNum(w)) { try { flux = src.fluxAt(w); } catch { flux = NaN; } }
        if (isNum(flux) && flux !== 0) {
          rec.wave = w;
          rec.flux_uJy = flux;
          rec.deposited = addGaussian(image, n, n, p.x, p.y, sigmaPix, flux / unit, layer.mask);
        }
      }
      injected.push(rec);
    }
    return { ...layer, image, injected };
  });
}

/**
 * Plant simulated bodies into native detector frames. Returns NEW frames; inputs untouched.
 * The position comes from makeWcs(frame.wcs).skyToPix, the wavelength from the frame's own
 * per-pixel wavelength map at that position, the PSF width from opts.fwhmArcsec, else the
 * frame's psfFwhm, else 7.5 arcsec, and the pixel scale from the frame WCS. The Gaussian is
 * integrated over each native pixel, which at 6.15 arcsec per pixel matters a great deal.
 * Reprojecting the returned frames gives the most faithful doctored layers; injectIntoLayers
 * with nativePixArcsec set is the cheap equivalent.
 * @param {Array<object>} frames Frame[] of the contract
 * @param {{ track?: Array<object>, fluxAt?: Function, sources?: Array<object>, fwhmArcsec?: number }} opts
 * @returns {Array<object>} new frames with an `injected` list (x, y are native 0-based pixels)
 */
export function injectIntoFrames(frames, opts = {}) {
  const sources = sourceList(opts);
  return (frames || []).map((frame, i) => {
    const image = new Float32Array(frame.image);
    const injected = Array.isArray(frame.injected) ? frame.injected.slice() : [];
    let wcs = null;
    try { wcs = makeWcs(frame.wcs); } catch { wcs = null; }
    const nx = frame.nx, ny = frame.ny;
    const scale = wcs && wcs.pixelScale > 0 ? wcs.pixelScale : NATIVE_PIX_ARCSEC;
    const fwhm = opts.fwhmArcsec > 0 ? opts.fwhmArcsec : (frame.psfFwhm > 0 ? frame.psfFwhm : DEFAULT_FWHM_ARCSEC);
    const sigmaPix = (fwhm * FWHM_TO_SIGMA) / scale;
    const unit = ujyPerMJySr(scale);
    const reach = 5 * sigmaPix + 1;
    for (let s = 0; s < sources.length; s++) {
      const src = sources[s];
      const p = trackEntry(src.track, i, frame.mjd);
      const rec = {
        id: src.id !== undefined ? src.id : s, x: NaN, y: NaN, ra: p ? p.ra : NaN, dec: p ? p.dec : NaN,
        wave: NaN, flux_uJy: 0, onGrid: false, deposited: 0,
      };
      if (p && wcs) {
        let xy = null;
        try { xy = wcs.skyToPix(p.ra, p.dec); } catch { xy = null; }
        if (xy && isNum(xy[0]) && isNum(xy[1])) {
          const [x, y] = xy;
          rec.x = x; rec.y = y;
          rec.onGrid = x >= -0.5 && x <= nx - 0.5 && y >= -0.5 && y <= ny - 0.5;
          if (x > -reach && x < nx - 1 + reach && y > -reach && y < ny - 1 + reach) {
            const wave = waveNear(frame.wave, nx, ny, x, y);
            const w = isNum(wave) ? wave : (isNum(frame.waveCenter) ? frame.waveCenter : NaN);
            let flux = NaN;
            if (isNum(w)) { try { flux = src.fluxAt(w); } catch { flux = NaN; } }
            if (isNum(flux) && flux !== 0) {
              rec.wave = w;
              rec.flux_uJy = flux;
              rec.deposited = addGaussian(image, nx, ny, x, y, sigmaPix, flux / unit, null);
            }
          }
        }
      }
      injected.push(rec);
    }
    return { ...frame, image, injected };
  });
}

// ---- which wavelength to quote ----------------------------------------------------------------

/**
 * The wavelength at which to quote brightness for a set of layers. 4.5 um when the layers reach
 * it (detector 6), because that is where cold bodies are brightest and where the literature
 * quotes them; otherwise the middle of what the layers actually cover. A limit must be quoted
 * at a wavelength that was observed: scaling it to another band needs a spectrum nobody knows.
 * @param {Array<object>} layers
 * @param {number} [prefer] default 4.5
 * @returns {{ wave: number, min: number, max: number, preferred: boolean }} NaN fields if the
 *   layers carry no wavelengths
 */
export function referenceWave(layers, prefer = 4.5) {
  const centres = [];
  for (const layer of layers || []) {
    const wave = layer && layer.wave;
    if (!wave || !wave.length) continue;
    const n = Math.round(Math.sqrt(wave.length));
    const w = waveNear(wave, n, n, (n - 1) / 2, (n - 1) / 2);
    if (isNum(w)) centres.push(w);
  }
  if (!centres.length) return { wave: NaN, min: NaN, max: NaN, preferred: false };
  centres.sort((a, b) => a - b);
  const min = centres[0], max = centres[centres.length - 1];
  if (prefer >= min - 0.03 && prefer <= max + 0.03) return { wave: prefer, min, max, preferred: true };
  const mid = centres[centres.length >> 1];
  return { wave: Math.round(mid * 100) / 100, min, max, preferred: false };
}
