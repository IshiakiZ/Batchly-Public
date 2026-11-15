// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

// Predicted-sky subtraction: the signature feature of Tombaugh.
//
// THE PROBLEM. SPHEREx images the sky through linear variable filters, so every exposure sees a
// given sky position at a different wavelength. Blink two exposures and every star changes
// brightness, simply because it has a colour. Real changes drown in that flicker.
//
// THE IDEA. A sky position is visited about 84 times per detector. For each pixel of the common
// grid, those visits sample the spectrum of whatever is there. Stars and galaxies have smooth
// spectra within one detector's wavelength range, so we fit, per pixel, a low-order polynomial
//
//     brightness(t) = c0 + c1 t + c2 t^2,     t = ln(wavelength) - lnw0
//
// to all visits. That polynomial is a model of the static sky that can be evaluated at any
// wavelength. For each exposure we evaluate it at that exposure's own per-pixel wavelengths and
// subtract. What is left is noise, plus anything that was not there (or not that bright) in the
// other visits: things that moved and things that varied.
//
// MAKING IT HONEST. A least-squares fit would be dragged upward by the very objects we want to
// find, leaving a diluted signal and a negative "ghost" in the other passes. So the fit is
// robust at two levels (details at fitSkyModel):
//   1. per sample: Huber weights and sigma clipping around a median/MAD estimate, which removes
//      cosmic rays, satellites and anything bright enough to stand out in a single exposure;
//   2. per survey pass: a whole pass whose mean residual at a pixel disagrees with the median
//      of the passes is down-weighted or dropped at that pixel. This catches a mover or a
//      variable epoch that is too faint to be an outlier in any single exposure but is
//      significant in the average of a pass.
// The significance of a residual accounts for the pipeline variance, for the uncertainty of the
// model itself, for any excess exposure-to-exposure scatter at that pixel (SPHEREx is
// undersampled, so bright star cores jitter from exposure to exposure; that must not look like
// a discovery), and for a 3% systematic allowance proportional to the source brightness.

import { DETECTORS, splitPasses, passLabel, medianMjd } from './frames.js';
import { stackLayers, medianInPlace } from './stack.js';

const HUBER_K = 1.345;       // Huber tuning constant: 95% efficiency for Gaussian noise
const MAD_TO_SIGMA = 1.4826;
const TILE = 64;             // pixels gathered into cache-friendly scratch rows at a time

/** Names for the `kind` codes returned by changeMap and findCandidates. */
export const CHANGE_KINDS = ['none', 'varies', 'moved'];

/**
 * Fit the static-sky model to the layers of ONE detector, all on the same grid.
 *
 * Per pixel, weighted least squares of brightness against t = ln(wave) - lnw0 with weights
 * 1/variance, using each layer's per-pixel wavelength (it varies across a frame). The order is
 * chosen per pixel from the samples that carry weight:
 *     order 2  if >= 8 samples spanning at least a third of the detector's ln-wavelength range
 *     order 1  if >= 4 samples
 *     order 0  if >= 2 samples
 *     no model (coefficients NaN, nUsed 0) otherwise
 * and never above `order`. A small ridge term (`ridge` times the summed weight, on the slope
 * and curvature only, so the level is not biased) keeps badly conditioned pixels stable.
 *
 * Robust iteration, up to `iterations` rounds after the first plain fit:
 *   - normalised residuals z = (data - model) / sigma;
 *   - a centre and a scale S >= 1 for them. First round: centre = median(z) and
 *     S = 1.4826 MAD(z), because the plain fit may be badly biased. Later rounds: centre 0 and
 *     S = rms of z over the samples the previous round kept. S > 1 means the pixel scatters more
 *     than its noise (an undersampled star core) and earns a proportionally wider tolerance;
 *   - sample weight factor (Huber, with a hard cut): 1 if |z - centre| <= 1.345 S, falling as
 *     1.345 S / |z - centre| beyond, and 0 beyond `clip` S;
 *   - pass weight factor (needs >= 3 passes with >= 2 surviving samples each): the same
 *     function applied to d = (mean z of the pass - median of the pass means) / standard error;
 *   - refit with weights (1/variance) x sample factor x pass factor.
 * Sample factors are recomputed from the new residuals each round, so a sample rejected early
 * can come back. The loop stops early once the set of rejected samples and passes no longer
 * changes. Layers without a finite `mjd` are counted with the first pass.
 *
 * Options: order (2), clip (3.5), iterations (3), ridge (1e-4), passAware (true: use the pass
 * weight factor), gapDays (45: gap that separates passes), sysFrac (0.03, see `floor`).
 *
 * Returns the SkyModel of the contract { n, order, det, lnw0, coeffs, rms, nUsed } where
 * coeffs[p*(order+1) + k] multiplies t^k (zero-padded for lower-order pixels), rms is the rms
 * residual of the samples used (MJy/sr) and nUsed their number, plus:
 *   scatter     Float32Array, >= 1: factor by which the exposures at this pixel scatter more
 *               (in variance) than the pipeline variance says. It is the reduced chi-square of
 *               the residuals about a straight line fitted to each pass separately, so it
 *               measures exposure-to-exposure jitter and is blind to a real change between
 *               passes. Sky pixels have about 1, undersampled star cores can have 100.
 *   floor       Float32Array, variance to add to a single exposure's variance when judging its
 *               residual: (scatter - 1) x mean variance   (the jitter)
 *                       + scatter x variance of the fitted level   (model error)
 *                       + (sysFrac x model brightness)^2   (a 3% allowance for flat-field, PSF
 *                         and pixel-phase effects that scale with the source)
 *   stackFloor  Float32Array, what does not average down when the residuals of a whole pass
 *               are averaged: model error (of the model averaged over wavelength) + the
 *               systematic allowance. The variance of a pass-averaged residual is
 *               scatter x (variance of the mean) + stackFloor.
 *   tMin, tMax  range of t covered by the data (predictions are clamped just outside it)
 *   nLayers, nPasses
 *
 * The solver supports order 0..2; a higher `order` is clamped to 2.
 */
export function fitSkyModel(layers, opts = {}) {
  const {
    order = 2, clip = 3.5, iterations = 3, ridge = 1e-4, passAware = true, gapDays = 45,
    sysFrac = 0.03,
  } = opts;
  const L = layers ? layers.length : 0;
  const npix = L ? layers[0].image.length : 0;
  const maxOrder = Math.max(0, Math.min(2, Math.floor(order) || 0));
  const K = maxOrder + 1;
  const model = {
    n: Math.round(Math.sqrt(npix)),
    order: maxOrder,
    det: L ? layers[0].det : 0,
    lnw0: 0,
    coeffs: new Float32Array(npix * K),
    rms: new Float32Array(npix),
    nUsed: new Uint16Array(npix),
    scatter: new Float32Array(npix).fill(1),
    floor: new Float32Array(npix),
    stackFloor: new Float32Array(npix),
    tMin: 0,
    tMax: 0,
    nLayers: L,
    nPasses: 0,
  };
  if (!L || !npix) return model;

  const imgs = layers.map((l) => l.image);
  const vars = layers.map((l) => l.variance);
  const waves = layers.map((l) => l.wave);
  const masks = layers.map((l) => l.mask || null);

  // ---- Reference wavelength and the range covered -------------------------------------------
  // lnw0 is the mean over layers of ln(mean wavelength of the layer), which equals the mean
  // ln-wavelength of the samples to well within the width of one channel. Any value near the
  // middle of the detector would do: it only centres the polynomial.
  const layerMeanWave = new Float64Array(L).fill(1);
  const layerLnMean = new Float64Array(L);
  let lnSum = 0;
  let lnCount = 0;
  let wMin = Infinity;
  let wMax = -Infinity;
  for (let l = 0; l < L; l++) {
    const wv = waves[l];
    const mk = masks[l];
    let s = 0;
    let k = 0;
    for (let i = 0; i < npix; i++) {
      const w = wv[i];
      if (!(w > 0) || w === Infinity || (mk !== null && mk[i] !== 0)) continue;
      s += w;
      k++;
      if (w < wMin) wMin = w;
      if (w > wMax) wMax = w;
    }
    if (k) {
      const mean = s / k;
      layerMeanWave[l] = mean;
      layerLnMean[l] = Math.log(mean);
      lnSum += layerLnMean[l];
      lnCount++;
    }
  }
  if (!lnCount) {
    model.coeffs.fill(NaN);
    model.rms.fill(NaN);
    model.floor.fill(NaN);
    model.stackFloor.fill(NaN);
    return model;
  }
  const lnw0 = lnSum / lnCount;
  const tMin = Math.log(wMin) - lnw0;
  const tMax = Math.log(wMax) - lnw0;
  model.lnw0 = lnw0;
  model.tMin = tMin;
  model.tMax = tMax;

  // Internally the fit runs in u = t / uScale, which lies in [-1, 1]: that keeps the normal
  // equations well conditioned and gives the ridge term a scale-free meaning.
  const uScale = Math.max(Math.abs(tMin), Math.abs(tMax)) > 1e-9 ? Math.max(Math.abs(tMin), Math.abs(tMax)) : 1;
  const invScale = 1 / uScale;
  const detInfo = DETECTORS.find((d) => d.det === model.det);
  const detSpan = detInfo ? Math.log(detInfo.max / detInfo.min) : tMax - tMin;
  const spreadMinU = (detSpan / 3) * invScale; // order 2 needs at least this spread in u

  // ---- Which survey pass each layer belongs to ------------------------------------------------
  const passOf = new Int32Array(L);
  let P = 1;
  if (passAware) {
    const passes = splitPasses(layers.map((l, idx) => ({ mjd: l.mjd, idx })), gapDays);
    passes.forEach((pass, p) => { for (const it of pass) passOf[it.idx] = p; });
    P = Math.max(1, passes.length);
  }
  model.nPasses = P;
  const passN = new Float64Array(P);
  const passSum = new Float64Array(P);
  const passMean = new Float64Array(P);
  const passG = new Float64Array(P).fill(1);
  const passBuf = new Float64Array(P);
  // Per-pass sums for the straight-line detrend in the final statistics.
  const passU = new Float64Array(P);
  const passUU = new Float64Array(P);
  const passUZ = new Float64Array(P);
  const passZZ = new Float64Array(P);

  // ---- Scratch: one contiguous row of samples per pixel of the current tile ------------------
  const Y = new Float64Array(TILE * L);   // brightness
  const W = new Float64Array(TILE * L);   // 1 / variance, 0 = sample unusable
  const SW = new Float64Array(TILE * L);  // 1 / sigma
  const U = new Float64Array(TILE * L);   // scaled ln-wavelength
  const Z = new Float64Array(L);          // normalised residuals of the current pixel
  const G = new Float64Array(L);          // robust weight factors of the current pixel
  const buf = new Float64Array(L);        // scratch for medians
  const sub = new Float64Array(L);        // subsample of Z used for the median and MAD
  const sol = new Float64Array(5);        // a0, a1, a2, variance of a0, order used
  const robust = iterations > 0 && clip > 0 && Number.isFinite(clip);
  const rounds = robust ? Math.floor(iterations) : 0;

  for (let p0 = 0; p0 < npix; p0 += TILE) {
    const m = Math.min(TILE, npix - p0);

    // Gather the tile, layer by layer (sequential reads), into per-pixel rows.
    for (let l = 0; l < L; l++) {
      const img = imgs[l];
      const vr = vars[l];
      const wv = waves[l];
      const mk = masks[l];
      const invMean = 1 / layerMeanWave[l];
      const lnOffset = layerLnMean[l] - lnw0;
      for (let c = 0; c < m; c++) {
        const i = p0 + c;
        const o = c * L + l;
        const y = img[i];
        const s2 = vr[i];
        const w = wv[i];
        if ((mk !== null && mk[i] !== 0) || y - y !== 0 || !(s2 > 0) || s2 === Infinity
          || !(w > 0) || w === Infinity) {
          W[o] = 0;
          continue;
        }
        const iw = 1 / s2;
        Y[o] = y;
        W[o] = iw;
        SW[o] = Math.sqrt(iw);
        // ln(w) = ln(layer mean) + ln(1 + d). Within one layer the wavelength varies by a
        // percent or so, so a five-term series is exact to 1e-8 and far cheaper than Math.log.
        const d = w * invMean - 1;
        const t = d < 0.06 && d > -0.06
          ? lnOffset + d * (1 - d * (0.5 - d * (1 / 3 - d * (0.25 - d * 0.2))))
          : Math.log(w) - lnw0;
        U[o] = t * invScale;
      }
    }

    // Fit each pixel of the tile from its own row.
    for (let c = 0; c < m; c++) {
      const i = p0 + c;
      const base = c * L;
      let nAll = 0;
      for (let l = 0; l < L; l++) {
        if (W[base + l] > 0) { G[l] = 1; nAll++; } else G[l] = 0;
      }
      if (nAll < 2) {
        model.coeffs[i * K] = NaN;
        model.rms[i] = NaN;
        model.floor[i] = NaN;
        model.stackFloor[i] = NaN;
        continue;
      }

      // Round 0 is plain inverse-variance least squares (all G = 1); each later round first
      // recomputes the robust weight factors G from the residuals of the previous fit.
      let a0 = 0, a1 = 0, a2 = 0;
      let lastRound = rounds;
      let lastCut = 0;      // which samples the previous round rejected outright (a checksum)
      let lastCutPasses = 0; // and which passes
      for (let round = 0; round <= lastRound; round++) {
        // Normal equations. For a polynomial they only involve the moments
        // m_k = sum w u^k (k = 0..4) and b_k = sum w y u^k (k = 0..2).
        let m0 = 0, m1 = 0, m2 = 0, m3 = 0, m4 = 0, b0 = 0, b1 = 0, b2 = 0;
        let cnt = 0, uLo = Infinity, uHi = -Infinity;
        for (let l = 0; l < L; l++) {
          const g = G[l];
          if (g > 0) {
            const o = base + l;
            const w = W[o] * g;
            const u = U[o];
            const y = Y[o];
            const wu = w * u;
            const wu2 = wu * u;
            m0 += w; m1 += wu; m2 += wu2; m3 += wu2 * u; m4 += wu2 * u * u;
            b0 += w * y; b1 += wu * y; b2 += wu2 * y;
            cnt++;
            if (u < uLo) uLo = u;
            if (u > uHi) uHi = u;
          }
        }
        if (cnt < 2) {
          // Almost everything was rejected (a tiny, inconsistent sample): keep the plain fit.
          for (let l = 0; l < L; l++) G[l] = W[base + l] > 0 ? 1 : 0;
          lastRound = round + 1;
          continue;
        }
        let ord = cnt >= 8 && uHi - uLo >= spreadMinU ? 2 : cnt >= 4 ? 1 : 0;
        if (ord > maxOrder) ord = maxOrder;
        solveMoments(m0, m1, m2, m3, m4, b0, b1, b2, ord, ridge * m0, sol);
        a0 = sol[0]; a1 = sol[1]; a2 = sol[2];
        if (round >= lastRound) break;

        // Normalised residuals z of every usable sample, their centre and their scale S >= 1
        // (in units of the pipeline sigma, so S > 1 means "this pixel scatters more than its
        // noise").
        let centre = 0;
        let S = 1;
        if (round === 0) {
          // The plain fit may be badly biased by contamination, so start from the most robust
          // estimates there are: the median and the median absolute deviation. With many
          // samples, every 2nd or 3rd one (about 32 to 48 in all) estimates both well enough
          // to set this round's weights, at a fraction of the cost.
          const stride = nAll > 48 ? Math.floor(nAll / 32) : 1;
          let skip = 0;
          let k = 0;
          for (let l = 0; l < L; l++) {
            const o = base + l;
            if (W[o] > 0) {
              const u = U[o];
              const z = (Y[o] - (a0 + u * (a1 + u * a2))) * SW[o];
              Z[l] = z;
              if (skip === 0) { buf[k] = z; sub[k] = z; k++; skip = stride; }
              skip--;
            }
          }
          centre = medianInPlace(buf, k);
          for (let j = 0; j < k; j++) buf[j] = Math.abs(sub[j] - centre);
          S = Math.max(1, MAD_TO_SIGMA * medianInPlace(buf, k));
        } else {
          // The previous round already set the outliers aside, so the rms of the samples it
          // kept is a good (and much cheaper) scale, and the fit itself is the centre.
          let sz2 = 0;
          let k = 0;
          for (let l = 0; l < L; l++) {
            const o = base + l;
            if (W[o] > 0) {
              const u = U[o];
              const z = (Y[o] - (a0 + u * (a1 + u * a2))) * SW[o];
              Z[l] = z;
              if (G[l] > 0) { sz2 += z * z; k++; }
            }
          }
          S = Math.max(1, Math.sqrt(sz2 / Math.max(1, k - (sol[4] + 1))));
        }
        const invS = 1 / S;

        // Sample factor: Huber weight with a hard cut at `clip`. While at it, sum the
        // residuals of the surviving samples per pass.
        for (let p = 0; p < P; p++) { passN[p] = 0; passSum[p] = 0; passG[p] = 1; }
        let cut = 0;
        let cutPasses = 0;
        for (let l = 0; l < L; l++) {
          if (W[base + l] > 0) {
            const d = Z[l] - centre;
            const t = Math.abs(d) * invS;
            if (t > clip) {
              G[l] = 0;
              cut += (l + 1) * (l + 3);
            } else {
              G[l] = t <= HUBER_K ? 1 : HUBER_K / t;
              const p = passOf[l];
              passN[p]++;
              passSum[p] += d;
            }
          }
        }

        // Pass factor: does one pass sit apart from the others at this pixel? Compare each
        // pass mean with the median of the pass means, in units of its standard error.
        if (P >= 3) {
          let nValid = 0;
          let nTotal = 0;
          for (let p = 0; p < P; p++) {
            if (passN[p] >= 2) {
              passMean[p] = passSum[p] / passN[p];
              passBuf[nValid++] = passMean[p];
              nTotal += passN[p];
            }
          }
          if (nValid >= 3) {
            const ref = medianInPlace(passBuf, nValid);
            const nRef = nTotal / nValid;
            let changed = false;
            for (let p = 0; p < P; p++) {
              if (passN[p] < 2) continue;
              const d = Math.abs(passMean[p] - ref) / (S * Math.sqrt(1 / passN[p] + 1 / nRef));
              if (d > HUBER_K) {
                changed = true;
                if (d > clip) { passG[p] = 0; cutPasses += (p + 1) * (p + 3); } else passG[p] = HUBER_K / d;
              }
            }
            if (changed) for (let l = 0; l < L; l++) G[l] *= passG[passOf[l]];
          }
        }

        // Converged: the same samples and passes are rejected as in the previous round, so
        // another refit would only shuffle Huber weights by amounts far below the noise.
        if (round > 0 && cut === lastCut && cutPasses === lastCutPasses) break;
        lastCut = cut;
        lastCutPasses = cutPasses;
      }

      // Residual statistics of the samples that carried weight in the final fit.
      for (let p = 0; p < P; p++) {
        passN[p] = 0; passSum[p] = 0; passU[p] = 0; passUU[p] = 0; passUZ[p] = 0; passZZ[p] = 0;
      }
      let nu = 0, sr2 = 0, sz2 = 0, sv = 0, sw = 0;
      for (let l = 0; l < L; l++) {
        if (G[l] > 0) {
          const o = base + l;
          const w0 = W[o];
          const u = U[o];
          const r = Y[o] - (a0 + u * (a1 + u * a2));
          const z = r * SW[o];
          const p = passOf[l];
          nu++;
          sr2 += r * r;
          sz2 += z * z;
          sv += 1 / w0;
          sw += w0;
          passN[p]++; passSum[p] += z; passU[p] += u; passUU[p] += u * u; passUZ[p] += u * z; passZZ[p] += z * z;
        }
      }
      // Scatter factor: reduced chi-square of the residuals about a straight line fitted to
      // each pass separately. That is exposure-to-exposure scatter, blind to any offset or
      // tilt of a whole pass (a pass in which the source was brighter is signal, not scatter).
      let ss = 0;
      let dof = 0;
      for (let p = 0; p < P; p++) {
        const np = passN[p];
        if (np < 3) continue;
        const szz = passZZ[p] - passSum[p] * passSum[p] / np;
        const suu = passUU[p] - passU[p] * passU[p] / np;
        const suz = passUZ[p] - passU[p] * passSum[p] / np;
        ss += suu > 1e-12 ? szz - suz * suz / suu : szz;
        dof += np - 2;
      }
      if (dof < 1) { ss = sz2; dof = Math.max(1, nu - (sol[4] + 1)); } // too few samples per pass
      const scatter = Math.max(1, ss / dof);
      const systematic = sysFrac * sysFrac * a0 * a0;

      const ci = i * K;
      model.coeffs[ci] = a0;
      if (K > 1) model.coeffs[ci + 1] = a1 * invScale;
      if (K > 2) model.coeffs[ci + 2] = a2 * invScale * invScale;
      model.nUsed[i] = nu;
      model.rms[i] = Math.sqrt(sr2 / nu);
      model.scatter[i] = scatter;
      model.floor[i] = (scatter - 1) * (sv / nu) + scatter * sol[3] + systematic;
      model.stackFloor[i] = scatter / sw + systematic;
    }
  }
  return model;
}

/**
 * Solve the weighted polynomial normal equations from their moments
 *     m_k = sum w u^k (k = 0..4),   b_k = sum w y u^k (k = 0..2)
 * for order `ord` (0, 1 or 2), with ridge `lam` added to the slope and curvature diagonal.
 * Writes [a0, a1, a2, variance of a0, order actually used] into `out`; a numerically singular
 * system falls back to the next lower order. Results go through a typed array (not captured
 * variables) so that the hot loop in fitSkyModel never allocates.
 */
function solveMoments(m0, m1, m2, m3, m4, b0, b1, b2, ord, lam, out) {
  if (ord === 2) {
    // Symmetric 3x3 system [[m0 m1 m2] [m1 m2+lam m3] [m2 m3 m4+lam]], inverted by cofactors.
    const A11 = m2 + lam;
    const A22 = m4 + lam;
    const c00 = A11 * A22 - m3 * m3;
    const c01 = m2 * m3 - m1 * A22;
    const c02 = m1 * m3 - m2 * A11;
    const det = m0 * c00 + m1 * c01 + m2 * c02;
    if (det > 0 && det !== Infinity) {
      const c11 = m0 * A22 - m2 * m2;
      const c12 = m1 * m2 - m0 * m3;
      const c22 = m0 * A11 - m1 * m1;
      out[0] = (c00 * b0 + c01 * b1 + c02 * b2) / det;
      out[1] = (c01 * b0 + c11 * b1 + c12 * b2) / det;
      out[2] = (c02 * b0 + c12 * b1 + c22 * b2) / det;
      out[3] = c00 / det;
      out[4] = 2;
      return;
    }
    ord = 1;
  }
  if (ord === 1) {
    const A11 = m2 + lam;
    const det = m0 * A11 - m1 * m1;
    if (det > 0 && det !== Infinity) {
      out[0] = (A11 * b0 - m1 * b1) / det;
      out[1] = (m0 * b1 - m1 * b0) / det;
      out[2] = 0;
      out[3] = A11 / det;
      out[4] = 1;
      return;
    }
  }
  out[0] = b0 / m0;
  out[1] = 0;
  out[2] = 0;
  out[3] = 1 / m0;
  out[4] = 0;
}

/** Clamp range for t: predictions are not extrapolated more than 10% beyond the data. */
function tLimits(model) {
  if (!(model.tMax > model.tMin)) return [-Infinity, Infinity];
  const pad = 0.1 * (model.tMax - model.tMin);
  return [model.tMin - pad, model.tMax + pad];
}

/**
 * Predict into `out` (Float32Array) the model at a layer's per-pixel wavelengths.
 * ln(wavelength) is computed as ln(layer mean) + ln(1 + d) with a short series for the small
 * relative offset d (exact to 1e-8 for |d| < 6%), falling back to Math.log otherwise.
 */
function predictInto(model, layer, out) {
  const npix = model.n * model.n;
  const K = model.order + 1;
  const c = model.coeffs;
  const lnw0 = model.lnw0;
  const [lo, hi] = tLimits(model);
  const wave = layer.wave;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < npix; i++) {
    const w = wave[i];
    if (w > 0 && w !== Infinity) { sum += w; count++; }
  }
  const mean = count ? sum / count : 1;
  const invMean = 1 / mean;
  const lnOffset = Math.log(mean) - lnw0;
  for (let i = 0; i < npix; i++) {
    const w = wave[i];
    if (!(w > 0)) { out[i] = NaN; continue; }
    const d = w * invMean - 1;
    let t = d < 0.06 && d > -0.06
      ? lnOffset + d * (1 - d * (0.5 - d * (1 / 3 - d * (0.25 - d * 0.2))))
      : Math.log(w) - lnw0;
    if (t < lo) t = lo; else if (t > hi) t = hi;
    const ci = i * K;
    let v = c[ci + K - 1];
    for (let k = K - 2; k >= 0; k--) v = v * t + c[ci + k];
    out[i] = v;
  }
  return out;
}

/**
 * Predicted static-sky image for one layer: the model evaluated at that layer's own per-pixel
 * wavelengths. NaN where the pixel has no model or the layer has no wavelength.
 */
export function predictLayer(model, layer) {
  return predictInto(model, layer, new Float32Array(model.n * model.n));
}

/**
 * Residual of one layer against the static-sky model.
 *   image  layer.image - prediction (MJy/sr)
 *   snr    residual / sqrt(variance + floor), floor = model.floor (exposure-to-exposure
 *          jitter, model error and a small allowance for systematics, see fitSkyModel)
 *   mask   1 where the layer is masked, the model is missing, or the result is not finite
 * Masked pixels hold NaN in `image` and `snr`.
 */
export function residualLayer(model, layer) {
  const npix = model.n * model.n;
  const image = predictInto(model, layer, new Float32Array(npix)); // prediction, then residual in place
  const img = layer.image;
  const vr = layer.variance;
  const mk = layer.mask || null;
  const floor = model.floor || null;
  const snr = new Float32Array(npix);
  const mask = new Uint8Array(npix);
  for (let i = 0; i < npix; i++) {
    const r = img[i] - image[i];
    if ((mk !== null && mk[i] !== 0) || r - r !== 0) {
      image[i] = NaN;
      snr[i] = NaN;
      mask[i] = 1;
      continue;
    }
    image[i] = r;
    const s2 = (vr ? vr[i] : 0) + (floor !== null ? floor[i] : 0);
    snr[i] = s2 > 0 && s2 !== Infinity ? r / Math.sqrt(s2) : 0;
  }
  return { image, snr, mask };
}

/** Monochromatic static-sky image: the model evaluated at one wavelength (um) everywhere. */
export function evalModelAt(model, wave) {
  const npix = model.n * model.n;
  const K = model.order + 1;
  const c = model.coeffs;
  const out = new Float32Array(npix);
  if (!(wave > 0)) return out.fill(NaN);
  const [lo, hi] = tLimits(model);
  const t = Math.min(hi, Math.max(lo, Math.log(wave) - model.lnw0));
  for (let i = 0; i < npix; i++) {
    const ci = i * K;
    let v = c[ci + K - 1];
    for (let k = K - 2; k >= 0; k--) v = v * t + c[ci + k];
    out[i] = v;
  }
  return out;
}

/**
 * One stacked residual image per survey pass: what the UI animates in the "residual" view.
 *
 * Each layer's residual (image - prediction) is computed, then the residuals of a pass are
 * combined with a sigma-clipped inverse-variance mean (stackLayers), so a cosmic ray in one
 * exposure does not survive. The significance is
 *     snr = mean residual / sqrt(scatter x variance of the mean + stackFloor)
 * with the model's per-pixel `scatter` and `stackFloor` (see fitSkyModel): jitter between
 * exposures averages down over the pass, the model's own error and the systematic allowance do
 * not. For a pass that took part in the fit this is conservative (its residual and the model
 * share noise, so pure noise has an rms of about 0.7); for a pass the fit rejected at that
 * pixel, which is the case that matters, it is the correct significance.
 *
 * Returns [{ label, mjd, image, snr, mask, count, variance, passIndex }] in time order;
 * `label` is like "Jun 2025", `mjd` the median MJD, `variance` the full variance used for snr.
 */
export function residualPassStacks(model, layers, { clip = 4, gapDays = 45 } = {}) {
  const npix = model.n * model.n;
  const floor = model.stackFloor || null;
  const scatter = model.scatter || null;
  return splitPasses(layers, gapDays).map((pass, passIndex) => {
    const residuals = pass.map((layer) => {
      // Residual only (no per-exposure snr needed here): prediction, then subtract in place.
      const image = predictInto(model, layer, new Float32Array(npix));
      const mask = new Uint8Array(npix);
      const img = layer.image;
      const mk = layer.mask || null;
      for (let i = 0; i < npix; i++) {
        const r = img[i] - image[i];
        if ((mk !== null && mk[i] !== 0) || r - r !== 0) { image[i] = NaN; mask[i] = 1; } else image[i] = r;
      }
      return { image, variance: layer.variance, mask };
    });
    const st = stackLayers(residuals, { method: 'wmean', clip });
    const snr = new Float32Array(npix);
    const variance = new Float32Array(npix);
    for (let i = 0; i < npix; i++) {
      const s2 = st.variance[i] * (scatter !== null ? scatter[i] : 1) + (floor !== null ? floor[i] : 0);
      if (st.mask[i] !== 0 || !(s2 > 0) || s2 === Infinity) {
        st.mask[i] = 1;
        st.image[i] = NaN;
        snr[i] = NaN;
        variance[i] = NaN;
        continue;
      }
      variance[i] = s2;
      snr[i] = st.image[i] / Math.sqrt(s2);
    }
    return {
      label: passLabel(pass),
      mjd: medianMjd(pass),
      image: st.image,
      snr,
      mask: st.mask,
      count: st.count,
      variance,
      passIndex,
    };
  });
}

// ---- Change detection ---------------------------------------------------------------------------

/**
 * Significant blobs in the pass residual stacks.
 *
 * Per pass and per sign, pixels with |snr| >= `low` (60% of the threshold, at least 3) are
 * grouped into 8-connected regions. A region is a blob if its strongest pixel reaches the
 * threshold and it has at least three pixels (the PSF spans several grid pixels, so a real
 * source is never a lone pixel). Working with regions rather than local maxima matters because
 * the significance map of a bright source is not smooth: its core can be less significant than
 * its wings (the core jitters more), and each lump would otherwise be reported separately.
 *
 * Each blob gets the centroid of its residual flux (x, y), its most significant pixel (px, py)
 * and that pixel's signed snr.
 */
function findBlobs(stacks, n, threshold) {
  const npix = n * n;
  const low = Math.max(3, 0.6 * threshold);
  const seen = new Uint8Array(npix);
  const queue = new Int32Array(npix);
  const blobs = [];
  stacks.forEach((st, passIndex) => {
    const s = st.snr;
    const img = st.image;
    const mk = st.mask;
    for (const sign of [1, -1]) {
      seen.fill(0);
      for (let start = 0; start < npix; start++) {
        if (seen[start] !== 0 || mk[start] !== 0 || !(sign * s[start] >= low)) continue;
        // Flood fill of one region.
        let head = 0;
        let tail = 0;
        queue[tail++] = start;
        seen[start] = 1;
        let peak = 0;
        let peakAt = start;
        let sw = 0, sx = 0, sy = 0;
        while (head < tail) {
          const i = queue[head++];
          const x = i % n;
          const y = (i - x) / n;
          const v = sign * s[i];
          if (v > peak) { peak = v; peakAt = i; }
          const w = Math.max(0, sign * img[i]);
          sw += w; sx += w * x; sy += w * y;
          for (let dy = -1; dy <= 1; dy++) {
            const yy = y + dy;
            if (yy < 0 || yy >= n) continue;
            for (let dx = -1; dx <= 1; dx++) {
              const xx = x + dx;
              if (xx < 0 || xx >= n) continue;
              const j = yy * n + xx;
              if (seen[j] === 0 && mk[j] === 0 && sign * s[j] >= low) { seen[j] = 1; queue[tail++] = j; }
            }
          }
        }
        if (peak >= threshold && tail >= 3) {
          const px = peakAt % n;
          const py = (peakAt - px) / n;
          blobs.push({
            x: sw > 0 ? sx / sw : px,
            y: sw > 0 ? sy / sw : py,
            px,
            py,
            snr: sign * peak,
            passIndex,
            sign,
            kind: 1,
            npix: tail,
            pixels: queue.slice(0, tail),
          });
        }
      }
    }
  });
  blobs.sort((p, q) => Math.abs(q.snr) - Math.abs(p.snr));
  return blobs.length > 400 ? blobs.slice(0, 400) : blobs; // bound the pairing cost
}

/**
 * Decide for every blob whether it looks like motion (kind 2) or a change in place (kind 1).
 *
 * Heuristic, deliberately simple and conservative. Relative to the static model, something that
 * MOVED leaves displaced blobs: a positive blob where it is in this pass, and either a negative
 * blob nearby in the same pass (where the model still remembers it: a dipole) or blobs at a
 * neighbouring position in the other passes. Something that VARIES leaves blobs that sit on top
 * of each other in every pass. So a blob is "moved" when another blob's centroid lies between
 * `minSep` and `radius` grid pixels from its own, unless that other blob is in the same pass
 * with the same sign (two lumps of one source, or two unrelated neighbours, are not motion).
 * Every other blob is "varies": a variable, a transient, or a mover too fast to pair up within
 * `radius`.
 */
function classifyBlobs(blobs, radius, minSep) {
  for (let i = 0; i < blobs.length; i++) {
    const a = blobs[i];
    for (let j = i + 1; j < blobs.length; j++) {
      const b = blobs[j];
      if (a.passIndex === b.passIndex && a.sign === b.sign) continue;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d >= minSep && d <= radius) { a.kind = 2; b.kind = 2; }
    }
  }
  return blobs;
}

/** Equivalent Gaussian sigma of a chi-square value with k degrees of freedom (Wilson-Hilferty). */
function chi2ToSigma(chi2, k) {
  const c = 2 / (9 * k);
  return (Math.cbrt(chi2 / k) - (1 - c)) / Math.sqrt(c);
}

/**
 * Per-pixel map of change between survey passes.
 *
 *   score  significance that the pass-averaged residuals are not all zero: chi2 = sum over
 *          passes of snr^2, converted to an equivalent Gaussian sigma (>= 0). Usable directly
 *          as an overlay; about 5 and above is worth a look.
 *   kind   0 none, 1 varies (changed in place), 2 moved (displaced blobs, see classifyBlobs),
 *          set on all pixels of each significant blob (see findBlobs).
 *
 * Also returns the residual pass `stacks` it used and the `blobs` it found.
 * Options: threshold (peak |snr| of a blob, default 5), radius (pairing distance in grid
 * pixels, default 4), minSep (default 1.5), stacks (a residualPassStacks result, to avoid
 * recomputing it).
 */
export function changeMap(model, layers, opts = {}) {
  const { threshold = 5, radius = 4, minSep = 1.5 } = opts;
  const n = model.n;
  const npix = n * n;
  const stacks = opts.stacks || residualPassStacks(model, layers, opts);
  const score = new Float32Array(npix);
  const kind = new Uint8Array(npix);
  const P = stacks.length;
  if (!P) return { score, kind, stacks, blobs: [] };

  // The fitted passes share the model, so their mean residuals are not independent: P - 1
  // degrees of freedom.
  const dof = Math.max(1, P - 1);
  for (let i = 0; i < npix; i++) {
    let chi2 = 0;
    let k = 0;
    for (let p = 0; p < P; p++) {
      if (stacks[p].mask[i] !== 0) continue;
      const s = stacks[p].snr[i];
      chi2 += s * s;
      k++;
    }
    score[i] = k ? Math.max(0, chi2ToSigma(chi2, dof)) : 0;
  }

  const blobs = classifyBlobs(findBlobs(stacks, n, threshold), radius, minSep);
  for (const blob of blobs) {
    for (const j of blob.pixels) if (blob.kind > kind[j]) kind[j] = blob.kind;
  }
  return { score, kind, stacks, blobs };
}

/**
 * The strongest changes, for the candidate list: one entry per significant residual blob.
 * Returns up to `max` entries { x, y, snr, kind, passIndex, label, mjd, px, py, npix },
 * strongest first:
 *   x, y       centroid of the blob's residual flux in grid pixels (0-based, fractional;
 *              convert with gridPixToSky)
 *   snr        signed significance of its strongest pixel in the pass residual stack
 *              (negative = fainter than the static model)
 *   kind       1 varies, 2 moved (CHANGE_KINDS)
 *   passIndex, label, mjd   the pass in which it was seen
 *   px, py     its most significant pixel; npix its size
 * A blob within `minSep` pixels of a stronger one from another pass is the same place seen
 * again (a variable in a second pass, the other sign of a two-pass change) and is not listed
 * twice.
 *
 * Options: minSnr (default 5), max (default 20), radius, minSep, stacks (as for changeMap).
 */
export function findCandidates(model, layers, opts = {}) {
  const { minSnr = 5, max = 20, radius = 4, minSep = 1.5 } = opts;
  const stacks = opts.stacks || residualPassStacks(model, layers, opts);
  const blobs = classifyBlobs(findBlobs(stacks, model.n, minSnr), radius, minSep);
  const out = [];
  for (const b of blobs) { // already sorted by |snr|, strongest first
    if (out.length >= max) break;
    if (out.some((c) => Math.hypot(c.x - b.x, c.y - b.y) < minSep)) continue;
    out.push({
      x: b.x,
      y: b.y,
      snr: b.snr,
      kind: b.kind,
      passIndex: b.passIndex,
      label: stacks[b.passIndex].label,
      mjd: stacks[b.passIndex].mjd,
      px: b.px,
      py: b.py,
      npix: b.npix,
    });
  }
  return out;
}
