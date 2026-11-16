// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

// Combining layers (frames already resampled to the common grid) into deeper images.
//
// Conventions: a layer is { image, variance, mask, ... } with Float32Array(n*n) data and
// mask 1 = unusable. Non-finite values are treated as missing. Output pixels with no usable
// input have mask 1 and NaN data, so they can never be mistaken for a measurement.

const MAD_TO_SIGMA = 1.4826; // sigma of a Gaussian = 1.4826 * median absolute deviation

/**
 * k-th smallest of a[0..n-1] (0-based k). Hoare/Wirth quickselect, in place: on return a[k]
 * holds the answer, everything left of it is <= a[k] and everything right of it is >= a[k].
 * O(n) on average, no allocation. Values must be finite.
 */
export function selectKth(a, n, k) {
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const pivot = a[k];
    let i = lo;
    let j = hi;
    do {
      while (a[i] < pivot) i++;
      while (pivot < a[j]) j--;
      if (i <= j) {
        const t = a[i]; a[i] = a[j]; a[j] = t;
        i++; j--;
      }
    } while (i <= j);
    if (j < k) lo = i;
    if (k < i) hi = j;
  }
  return a[k];
}

/** Median of a[0..n-1]; reorders the array. Returns NaN when n is 0. */
export function medianInPlace(a, n) {
  if (n <= 0) return NaN;
  const k = n >> 1;
  const upper = selectKth(a, n, k);
  if (n & 1) return upper;
  let lower = a[0]; // for even n the lower middle is the largest value left of position k
  for (let i = 1; i < k; i++) if (a[i] > lower) lower = a[i];
  return 0.5 * (lower + upper);
}

/**
 * Stack layers pixel by pixel.
 *
 *   'wmean'   inverse-variance weighted mean, sigma-clipped (default)
 *   'median'  plain median of the usable samples (robust on its own, so no clipping)
 *   'sum'     sum of the usable samples that survive clipping (check `count`: coverage varies)
 *
 * Sigma clipping, per pixel: take the median of the samples and a robust scatter (1.4826 * MAD).
 * Whatever scatter is left after removing the mean pipeline variance is "excess" (in SPHEREx
 * every exposure sees a different wavelength, so real sources legitimately scatter more than
 * the noise). A sample is rejected if it lies more than `clip` sigma from the median, where
 * sigma^2 = its own variance + excess. Repeat until nothing is rejected (at most 3 rounds).
 * Using the median and MAD rather than the mean and rms means one wild value cannot hide by
 * inflating the scatter. Pass clip = 0 to disable.
 *
 * Returns { image, variance, count, mask }: `variance` is the propagated pipeline variance of
 * the result, `count` the number of samples used, mask = 1 where count is 0.
 * Layers without a variance array are given unit variance (unweighted mean).
 */
export function stackLayers(layers, { method = 'wmean', clip = 3 } = {}) {
  const L = layers ? layers.length : 0;
  const len = L ? layers[0].image.length : 0;
  const image = new Float32Array(len);
  const variance = new Float32Array(len);
  const count = new Uint16Array(len);
  const mask = new Uint8Array(len);
  if (!L) return { image, variance, count, mask };

  const imgs = layers.map((l) => l.image);
  const vars = layers.map((l) => l.variance || null);
  const masks = layers.map((l) => l.mask || null);
  const v = new Float64Array(L);   // usable values of the current pixel
  const s2 = new Float64Array(L);  // their variances
  const buf = new Float64Array(L); // scratch for medians
  const doClip = method !== 'median' && clip > 0 && Number.isFinite(clip);
  const clip2 = clip * clip;

  for (let i = 0; i < len; i++) {
    // Gather the usable samples of this pixel.
    let n = 0;
    for (let l = 0; l < L; l++) {
      const m = masks[l];
      if (m !== null && m[i] !== 0) continue;
      const x = imgs[l][i];
      if (x - x !== 0) continue; // NaN or infinite
      const vr = vars[l] !== null ? vars[l][i] : 1;
      if (!(vr > 0) || vr === Infinity) continue;
      v[n] = x;
      s2[n] = vr;
      n++;
    }

    if (doClip && n >= 3) {
      for (let round = 0; round < 3; round++) {
        let sumVar = 0;
        for (let j = 0; j < n; j++) { buf[j] = v[j]; sumVar += s2[j]; }
        const med = medianInPlace(buf, n);
        for (let j = 0; j < n; j++) buf[j] = Math.abs(v[j] - med);
        const sigma = MAD_TO_SIGMA * medianInPlace(buf, n);
        const excess = Math.max(0, sigma * sigma - sumVar / n);
        let kept = 0;
        for (let j = 0; j < n; j++) {
          const d = v[j] - med;
          if (d * d <= clip2 * (s2[j] + excess)) { v[kept] = v[j]; s2[kept] = s2[j]; kept++; }
        }
        if (kept === n) break;
        n = kept;
        if (n < 3) break;
      }
    }

    if (n === 0) {
      image[i] = NaN;
      variance[i] = NaN;
      mask[i] = 1;
      continue;
    }
    count[i] = n;
    if (method === 'median') {
      let sumVar = 0;
      for (let j = 0; j < n; j++) { buf[j] = v[j]; sumVar += s2[j]; }
      image[i] = medianInPlace(buf, n);
      // The median of n Gaussian samples has variance (pi/2) sigma^2 / n for large n.
      variance[i] = (n > 2 ? Math.PI / 2 : 1) * (sumVar / n) / n;
    } else if (method === 'sum') {
      let s = 0;
      let sv = 0;
      for (let j = 0; j < n; j++) { s += v[j]; sv += s2[j]; }
      image[i] = s;
      variance[i] = sv;
    } else {
      let sw = 0;
      let swx = 0;
      for (let j = 0; j < n; j++) { const w = 1 / s2[j]; sw += w; swx += w * v[j]; }
      image[i] = swx / sw;
      variance[i] = 1 / sw;
    }
  }
  return { image, variance, count, mask };
}

/**
 * Robust sky level of one layer in MJy/sr: the median of the unmasked pixels after iteratively
 * clipping everything more than 2.5 sigma (MAD-based) from the median, which removes stars and
 * galaxies. Zodi-subtracted frames still carry small offsets; this measures them.
 * Large layers are sampled on a regular stride (about 10,000 pixels) to keep it fast.
 * Returns 0 when the layer has no usable pixel, so subtracting it is always safe.
 */
export function backgroundLevel(layer) {
  const img = layer && layer.image;
  if (!img || !img.length) return 0;
  const mask = layer.mask || null;
  const step = Math.max(1, Math.floor(img.length / 10000));
  const vals = new Float64Array(Math.ceil(img.length / step));
  const buf = new Float64Array(vals.length);
  let n = 0;
  for (let i = 0; i < img.length; i += step) {
    const x = img[i];
    if ((mask !== null && mask[i] !== 0) || x - x !== 0) continue;
    vals[n++] = x;
  }
  if (n === 0) return 0;
  let med = 0;
  for (let round = 0; round < 6; round++) {
    for (let j = 0; j < n; j++) buf[j] = vals[j];
    med = medianInPlace(buf, n);
    for (let j = 0; j < n; j++) buf[j] = Math.abs(vals[j] - med);
    const lim = 2.5 * MAD_TO_SIGMA * medianInPlace(buf, n);
    if (!(lim > 0)) break;
    let kept = 0;
    for (let j = 0; j < n; j++) if (Math.abs(vals[j] - med) <= lim) vals[kept++] = vals[j];
    if (kept === n || kept < 8) break;
    n = kept;
  }
  return med;
}

/**
 * Subtract each layer's own sky level. Returns new layer objects (same fields, new `image`,
 * plus `background` = the level removed); the inputs are not modified. Use this before blinking,
 * stacking or model fitting so that frame-to-frame sky offsets do not flicker.
 */
export function normalizeBackground(layers) {
  return (layers || []).map((layer) => {
    const background = backgroundLevel(layer);
    const src = layer.image;
    const image = new Float32Array(src.length);
    for (let i = 0; i < src.length; i++) image[i] = src[i] - background;
    return { ...layer, image, background };
  });
}

/**
 * Pixel-wise difference a - b. Each argument is either a typed array or an object with `image`
 * and optional `mask` / `variance` (a layer or a stack). The result is masked (and NaN) where
 * either input is masked or non-finite. If both inputs carry a variance, the summed variance is
 * returned too.
 */
export function subtractImages(a, b) {
  const ia = a && a.image ? a.image : a;
  const ib = b && b.image ? b.image : b;
  const ma = a && a.image && a.mask ? a.mask : null;
  const mb = b && b.image && b.mask ? b.mask : null;
  const va = a && a.image && a.variance ? a.variance : null;
  const vb = b && b.image && b.variance ? b.variance : null;
  const len = Math.min(ia ? ia.length : 0, ib ? ib.length : 0);
  const image = new Float32Array(len);
  const mask = new Uint8Array(len);
  const variance = va && vb ? new Float32Array(len) : null;
  for (let i = 0; i < len; i++) {
    const d = ia[i] - ib[i];
    if ((ma !== null && ma[i] !== 0) || (mb !== null && mb[i] !== 0) || d - d !== 0) {
      image[i] = NaN;
      mask[i] = 1;
      if (variance) variance[i] = NaN;
    } else {
      image[i] = d;
      if (variance) variance[i] = va[i] + vb[i];
    }
  }
  return variance ? { image, mask, variance } : { image, mask };
}
