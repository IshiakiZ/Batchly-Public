// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

// classify.js: cautious, plain-language hints about a clicked source, from what the tool has
// already measured for it. Pure: no DOM, no network, imports nothing; runs in Node for tests.
//
//   classify({ binned, lightCurve, motion, gaia, size }) -> { hints, measures, disclaimer }
//     binned      [{ wave (um), flux_uJy, err_uJy }]   the binned spectrum (flux density, F_nu)
//     lightCurve  [{ mjd, ratio, err }]                brightness relative to the smooth spectrum
//     motion      fitMotion() result { pmra, pmdec, total, errTotal, n } in mas/yr, or the
//                 pipeline's { measured, gaia, track } wrapper
//     gaia        the Gaia star taken to be this source: a star, a nearestGaia() result, or
//                 null for "looked, nothing there". Leave undefined when Gaia was not checked.
//     size        { fwhmArcsec, psfArcsec } if a size estimate exists
//   hint = { id, title, text, confidence }   confidence: 'tentative' | 'likely' | 'strong'
//
// Every hint names the measurement behind it. None is a classification: a dip at 3.3 um is a
// dip at 3.3 um, and several kinds of object produce one. The wording keeps that distinction.

export const DISCLAIMER =
  'These hints are produced automatically from the measurements above. They are a place to start, not a classification.';

export const CONFIDENCE_WORDS = Object.freeze(['tentative', 'likely', 'strong']);

/** Wavelength windows in micrometres. `left` and `right` are the continuum on either side. */
export const BANDS = Object.freeze({
  ch4: { id: 'ch4', center: 3.3, band: [3.15, 3.45], left: [2.9, 3.05], right: [3.6, 3.8] },
  co2: { id: 'co2', center: 4.27, band: [4.2, 4.34], left: [4.02, 4.15], right: [4.4, 4.52] },
  co: { id: 'co', center: 4.67, band: [4.6, 4.74], left: [4.44, 4.56], right: [4.8, 4.96] },
  /** The 4.5 um window where a cold methane atmosphere is brightest. */
  peak45: [4.4, 4.62],
});

/** A Gaia star further than this from the source is somebody else. Arcsec (about one PSF). */
export const GAIA_MATCH_ARCSEC = 8;
export const GAIA_EPOCH_MJD = 57388.5; // J2016.0

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// ---------------------------------------------------------------------------------------------
// Spectrum measurements

/** Points with a finite wavelength and flux, not flagged, sorted by wavelength. */
export function usablePoints(points) {
  const out = [];
  if (!Array.isArray(points)) return out;
  for (const p of points) {
    if (!p || !isNum(p.wave) || !isNum(p.flux_uJy)) continue;
    if (p.ok === false || p.flagged === true) continue;
    out.push({ wave: p.wave, flux: p.flux_uJy, err: isNum(p.err_uJy) && p.err_uJy > 0 ? p.err_uJy : null });
  }
  out.sort((a, b) => a.wave - b.wave);
  return out;
}

function median(values) {
  const v = values.filter(isNum).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : 0.5 * (v[m - 1] + v[m]);
}

/**
 * Drops isolated one-point spikes, up or down: a point far from the median of its four
 * nearest neighbours while those neighbours agree with each other. A source that varies
 * between survey passes produces such points (a channel seen only in the bright pass), and
 * they would otherwise read as peaks or dips. A band several channels wide is kept, because
 * its points disagree with their neighbours together; a band one channel wide is not, which
 * is why classify() applies this only to sources whose light curve shows a change.
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

/**
 * Honest error bars for a spectrum. Compares each point with the mean of its two neighbours:
 * if the points jump about more than their quoted errors allow, every error is scaled up to
 * match (never down); points that came without an error get the scatter measured this way.
 * A robust median is used, so real narrow features do not count as noise.
 * Takes and returns usablePoints() output; `scale` is the factor applied to quoted errors.
 */
export function calibrateErrors(pts) {
  if (!Array.isArray(pts) || pts.length < 8) return { points: pts || [], scale: 1 };
  const z = [];
  const jumps = [];
  for (let i = 1; i < pts.length - 1; i++) {
    const d = pts[i].flux - 0.5 * (pts[i - 1].flux + pts[i + 1].flux);
    jumps.push(Math.abs(d));
    const a = pts[i - 1].err;
    const b = pts[i].err;
    const c = pts[i + 1].err;
    if (a !== null && b !== null && c !== null) z.push(Math.abs(d) / Math.sqrt(b * b + 0.25 * (a * a + c * c)));
  }
  const scale = z.length >= 6 ? Math.max(1, 1.4826 * median(z)) : 1;
  const fallback = (1.4826 * median(jumps)) / Math.sqrt(1.5);
  const points = pts.map((p) => ({ ...p, err: p.err !== null ? p.err * scale : fallback > 0 ? fallback : null }));
  return { points, scale };
}

/**
 * Mean flux in a wavelength window: inverse-variance weighted with its formal error when
 * every point has an error; otherwise a plain mean whose error is the scatter of the points
 * (three or more needed). -> { flux, err, wave, n } | null
 */
export function bandFlux(points, lo, hi) {
  const pts = (points && points.length && 'flux' in points[0] ? points : usablePoints(points)).filter((p) => p.wave >= lo && p.wave <= hi);
  if (!pts.length) return null;
  const weighted = pts.every((p) => p.err !== null);
  let sw = 0;
  let swf = 0;
  let swl = 0;
  for (const p of pts) {
    const w = weighted ? 1 / (p.err * p.err) : 1;
    sw += w;
    swf += w * p.flux;
    swl += w * p.wave;
  }
  const flux = swf / sw;
  let err = weighted ? Math.sqrt(1 / sw) : NaN;
  if (!weighted && pts.length >= 3) {
    let ss = 0;
    for (const p of pts) ss += (p.flux - flux) ** 2;
    err = Math.sqrt(ss / (pts.length - 1) / pts.length);
  }
  return { flux, err: isNum(err) && err > 0 ? err : null, wave: swl / sw, n: pts.length };
}

/**
 * Depth of a band against the continuum on both sides: 1 - band / continuum, with the
 * continuum interpolated linearly in wavelength to the band centre. One side alone is used if
 * the other has no data. -> { depth, err, sigma, band, continuum, sides } | null
 * null means the measurement cannot be made (no data, or a continuum too faint to divide by).
 */
export function bandDepth(points, def) {
  const pts = points && points.length && 'flux' in points[0] ? points : usablePoints(points);
  const b = bandFlux(pts, def.band[0], def.band[1]);
  const l = def.left ? bandFlux(pts, def.left[0], def.left[1]) : null;
  const r = def.right ? bandFlux(pts, def.right[0], def.right[1]) : null;
  if (!b || (!l && !r)) return null;
  let cont;
  let contErr;
  if (l && r && r.wave > l.wave) {
    const t = clamp((b.wave - l.wave) / (r.wave - l.wave), 0, 1);
    cont = l.flux + (r.flux - l.flux) * t;
    contErr = Math.hypot((1 - t) * (l.err ?? 0), t * (r.err ?? 0));
  } else {
    const side = l || r;
    cont = side.flux;
    contErr = side.err ?? 0;
  }
  // A continuum that is not clearly above zero cannot be divided by.
  if (!(cont > 0) || (contErr > 0 && cont < 3 * contErr)) return null;
  const depth = 1 - b.flux / cont;
  const err = Math.hypot((b.err ?? 0) / cont, (b.flux * contErr) / (cont * cont));
  return {
    depth,
    err: err > 0 ? err : null,
    sigma: err > 0 ? depth / err : depth > 0 ? Infinity : 0,
    band: b,
    continuum: cont,
    sides: (l ? 1 : 0) + (r ? 1 : 0),
  };
}

/**
 * Power-law slope of flux density against wavelength, F_nu ~ wave^alpha, from a weighted
 * straight-line fit in log-log space over whatever part of 0.75 to 5 um is covered. A very hot
 * surface gives alpha = -2, a 6000 K star about -1.1, a 3000 K star about 0 (it peaks inside
 * the range), and alpha > 0 means brighter towards the red. -> { alpha, err, n, span, peakWave } | null
 */
export function spectralSlope(points) {
  const pts = (points && points.length && 'flux' in points[0] ? points : usablePoints(points)).filter(
    (p) => p.flux > 0 && p.wave > 0 && (p.err === null || p.flux / p.err >= 2),
  );
  if (pts.length < 6) return null;
  const span = pts[pts.length - 1].wave / pts[0].wave;
  if (span < 1.5) return null;
  let sw = 0;
  let sx = 0;
  let sy = 0;
  const rows = pts.map((p) => {
    // sigma(ln F) = err / F; the cap keeps a few very bright points from deciding everything.
    const snr = p.err === null ? 10 : Math.min(50, p.flux / p.err);
    const w = snr * snr;
    const x = Math.log(p.wave);
    const y = Math.log(p.flux);
    sw += w;
    sx += w * x;
    sy += w * y;
    return { w, x, y };
  });
  const xm = sx / sw;
  const ym = sy / sw;
  let sxx = 0;
  let sxy = 0;
  for (const q of rows) {
    sxx += q.w * (q.x - xm) ** 2;
    sxy += q.w * (q.x - xm) * (q.y - ym);
  }
  if (!(sxx > 0)) return null;
  const alpha = sxy / sxx;
  let chi2 = 0;
  for (const q of rows) chi2 += q.w * (q.y - ym - alpha * (q.x - xm)) ** 2;
  const scale = Math.sqrt(Math.max(1, chi2 / (rows.length - 2)));
  const err = scale / Math.sqrt(sxx);
  let peak = pts[0];
  for (const p of pts) if (p.flux > peak.flux) peak = p;
  return { alpha, err, n: pts.length, span, peakWave: peak.wave };
}

// ---------------------------------------------------------------------------------------------
// Light curve

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "June 2025" for an MJD (UTC). Pure arithmetic, no Date object, so it is the same everywhere. */
export function monthYear(mjd) {
  if (!isNum(mjd)) return '';
  // Fliegel and Van Flandern, from the Julian day number.
  const jdn = Math.floor(mjd + 2400000.5 + 0.5);
  const a = jdn + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor((146097 * b) / 4);
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * d) / 4);
  const m = Math.floor((5 * e + 2) / 153);
  const month = m + 3 - 12 * Math.floor(m / 10);
  const year = 100 * b + d - 4800 + Math.floor(m / 10);
  return `${MONTHS[month - 1]} ${year}`;
}

/**
 * Collapses a light curve into one value per survey pass (points closer than gapDays belong
 * together) and finds the most significant change between two passes.
 * -> { passes: [{ mjd, ratio, err, n }], change, sigma, bright, faint } | null
 *    change = bright.ratio / faint.ratio - 1 for the pair of passes that differ most clearly.
 */
export function summarizeLightCurve(lightCurve, gapDays = 45) {
  if (!Array.isArray(lightCurve)) return null;
  const pts = lightCurve
    .filter((p) => p && isNum(p.mjd) && isNum(p.ratio))
    .map((p) => ({ mjd: p.mjd, ratio: p.ratio, err: isNum(p.err) && p.err > 0 ? p.err : null }))
    .sort((a, b) => a.mjd - b.mjd);
  if (!pts.length) return null;
  const groups = [[pts[0]]];
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].mjd - pts[i - 1].mjd > gapDays) groups.push([]);
    groups[groups.length - 1].push(pts[i]);
  }
  const passes = groups.map((all) => {
    // Clip points far from the pass median first (robust scatter from the MAD), so one cosmic
    // ray neither hides nor fakes a change.
    let g = all;
    if (all.length >= 4) {
      const mid = median(all.map((p) => p.ratio));
      const mad = 1.4826 * median(all.map((p) => Math.abs(p.ratio - mid)));
      const kept = all.filter((p) => Math.abs(p.ratio - mid) <= 5 * Math.max(mad, p.err ?? 0, 1e-9));
      if (kept.length >= Math.ceil(all.length / 2)) g = kept;
    }
    const weighted = g.every((p) => p.err !== null);
    let sw = 0;
    let swr = 0;
    let swt = 0;
    for (const p of g) {
      const w = weighted ? 1 / (p.err * p.err) : 1;
      sw += w;
      swr += w * p.ratio;
      swt += w * p.mjd;
    }
    const ratio = swr / sw;
    let err = weighted ? Math.sqrt(1 / sw) : NaN;
    if (g.length >= 3) {
      const mid = median(g.map((p) => p.ratio));
      const sem = (1.4826 * median(g.map((p) => Math.abs(p.ratio - mid)))) / Math.sqrt(g.length);
      err = isNum(err) ? Math.max(err, sem) : sem;
    }
    return { mjd: swt / sw, ratio, err: isNum(err) && err > 0 ? err : null, n: g.length };
  });
  let best = null;
  for (let i = 0; i < passes.length; i++) {
    for (let j = i + 1; j < passes.length; j++) {
      const a = passes[i];
      const b = passes[j];
      if (a.err === null || b.err === null) continue;
      const sigma = Math.abs(a.ratio - b.ratio) / Math.hypot(a.err, b.err);
      if (!best || sigma > best.sigma) {
        const [bright, faint] = a.ratio >= b.ratio ? [a, b] : [b, a];
        best = { sigma, bright, faint, change: faint.ratio > 0 ? bright.ratio / faint.ratio - 1 : Infinity };
      }
    }
  }
  return { passes, change: best ? best.change : null, sigma: best ? best.sigma : null, bright: best ? best.bright : null, faint: best ? best.faint : null };
}

// ---------------------------------------------------------------------------------------------
// Motion and Gaia

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

/** Compass word for a motion with components east (pmra, includes cos dec) and north (pmdec). */
export function compass(pmra, pmdec) {
  if (!isNum(pmra) || !isNum(pmdec) || (pmra === 0 && pmdec === 0)) return '';
  const pa = ((Math.atan2(pmra, pmdec) * 180) / Math.PI + 360) % 360;
  return COMPASS[Math.round(pa / 45) % 8];
}

/** "10.4 arcsec/yr" or "85 mas/yr": arcseconds once the number reaches 1000 mas. */
export function formatMotion(masPerYear) {
  if (!isNum(masPerYear)) return '';
  const v = Math.abs(masPerYear);
  if (v >= 1000) return `${(v / 1000).toFixed(v >= 10000 ? 1 : 2)} arcsec/yr`;
  return `${v >= 100 ? Math.round(v) : v >= 10 ? v.toFixed(0) : v.toFixed(1)} mas/yr`;
}

/** "10.44 ± 0.18 arcsec/yr" or "242 ± 30 mas/yr": a value and its error in one unit. */
export function formatMotionWithError(masPerYear, errMasPerYear) {
  if (!isNum(masPerYear)) return '';
  if (!isNum(errMasPerYear)) return formatMotion(masPerYear);
  const v = Math.abs(masPerYear);
  const e = Math.abs(errMasPerYear);
  if (v >= 1000) {
    const digits = e >= 100 ? 1 : 2;
    return `${(v / 1000).toFixed(digits)} ± ${(e / 1000).toFixed(digits)} arcsec/yr`;
  }
  const digits = e >= 10 ? 0 : 1;
  return `${v.toFixed(digits)} ± ${e.toFixed(digits)} mas/yr`;
}

/** Great-circle separation in arcseconds. */
export function sepArcsec(ra1, dec1, ra2, dec2) {
  const d2r = Math.PI / 180;
  const s1 = Math.sin(((dec2 - dec1) * d2r) / 2);
  const s2 = Math.sin(((ra2 - ra1) * d2r) / 2);
  const a = s1 * s1 + Math.cos(dec1 * d2r) * Math.cos(dec2 * d2r) * s2 * s2;
  return ((2 * Math.asin(Math.min(1, Math.sqrt(a)))) / d2r) * 3600;
}

/** Where a Gaia star is at `mjd`, by its proper motion alone (parallax is far below a pixel). */
export function gaiaPositionAt(star, mjd, epochMjd = GAIA_EPOCH_MJD) {
  if (!star || !isNum(star.ra) || !isNum(star.dec)) return null;
  const years = isNum(mjd) ? (mjd - epochMjd) / 365.25 : 0;
  const pmra = isNum(star.pmra) ? star.pmra : 0;
  const pmdec = isNum(star.pmdec) ? star.pmdec : 0;
  const dec = clamp(star.dec + (pmdec * years) / 3.6e6, -90, 90);
  const cosd = Math.max(1e-6, Math.cos((star.dec * Math.PI) / 180));
  const ra = (((star.ra + (pmra * years) / 3.6e6 / cosd) % 360) + 360) % 360;
  return { ra, dec };
}

/**
 * The Gaia star nearest to (ra, dec) once every star has been moved to `mjd`.
 * -> { star, ra, dec, sepArcsec, pmTotal, direction } | null     (ra, dec at mjd; pmTotal mas/yr or null)
 */
export function nearestGaia(stars, ra, dec, mjd) {
  if (!Array.isArray(stars) || !isNum(ra) || !isNum(dec)) return null;
  let best = null;
  for (const star of stars) {
    const pos = gaiaPositionAt(star, mjd);
    if (!pos) continue;
    const sep = sepArcsec(ra, dec, pos.ra, pos.dec);
    if (!isNum(sep)) continue;
    if (!best || sep < best.sepArcsec) best = { star, ra: pos.ra, dec: pos.dec, sepArcsec: sep };
  }
  if (!best) return null;
  const { pmra, pmdec } = best.star;
  const known = isNum(pmra) && isNum(pmdec);
  best.pmTotal = known ? Math.hypot(pmra, pmdec) : null;
  best.direction = known ? compass(pmra, pmdec) : '';
  return best;
}

function normaliseMotion(motion) {
  if (!motion || typeof motion !== 'object') return { measured: null, gaiaStar: undefined };
  const m = motion.measured && typeof motion.measured === 'object' ? motion.measured : isNum(motion.pmra) && isNum(motion.pmdec) ? motion : null;
  let gaiaStar;
  if (motion.gaia === null) gaiaStar = undefined; // the pipeline's "no match" is not a statement that Gaia was searched
  else if (motion.gaia && typeof motion.gaia === 'object') gaiaStar = motion.gaia.star || motion.gaia;
  if (!m || !isNum(m.pmra) || !isNum(m.pmdec)) return { measured: null, gaiaStar };
  const total = isNum(m.total) ? m.total : Math.hypot(m.pmra, m.pmdec);
  return { measured: { pmra: m.pmra, pmdec: m.pmdec, total, errTotal: isNum(m.errTotal) && m.errTotal > 0 ? m.errTotal : null, n: isNum(m.n) ? m.n : null }, gaiaStar };
}

function normaliseGaia(gaia) {
  if (gaia === undefined) return { checked: false, star: null, sep: null };
  if (gaia === null) return { checked: true, star: null, sep: null };
  const star = gaia.star && typeof gaia.star === 'object' ? gaia.star : gaia;
  const sep = isNum(gaia.sepArcsec) ? gaia.sepArcsec : null;
  if (sep !== null && sep > GAIA_MATCH_ARCSEC) return { checked: true, star: null, sep, far: true };
  return { checked: true, star, sep };
}

// ---------------------------------------------------------------------------------------------
// The hints

const pct = (fraction) => {
  const v = Math.abs(fraction) * 100;
  return String(v >= 20 ? Math.round(v / 5) * 5 : Math.round(v));
};
const um = (v) => `${v} µm`;
const sig = (s) => (s >= 20 ? 'more than 20' : s >= 10 ? String(Math.round(s)) : s.toFixed(1));

function spectrumHints(raw, hints, measures) {
  if (raw.length < 4) return;
  // Single-channel outliers are set aside only when the light curve says the source varies:
  // then a channel seen in one pass alone is not comparable with its neighbours. Otherwise
  // they stay, because CO and CO2 bands can be a single SPHEREx channel wide.
  const lc = measures.lightCurve;
  const varies = Boolean(lc && lc.sigma !== null && lc.sigma >= 3 && lc.change >= 0.1);
  const { points: pts, scale } = calibrateErrors(varies ? despike(raw) : raw);
  measures.spikesDropped = raw.length - pts.length;
  measures.errorScale = scale;
  const snrs = pts.filter((p) => p.err !== null).map((p) => p.flux / p.err);
  const medianSnr = snrs.length ? median(snrs) : null;
  measures.medianSnr = medianSnr;
  measures.nPoints = pts.length;
  if (medianSnr !== null && medianSnr < 3) {
    hints.push({
      id: 'faint',
      rank: 95,
      title: 'Faint: read the rest with care',
      text: `Half of the ${pts.length} spectrum points are within ${medianSnr < 1 ? 'one' : medianSnr.toFixed(1)} sigma of zero. Slopes and dips measured this close to the noise can be chance.`,
      confidence: 'likely',
    });
  }

  // Slope.
  const slope = spectralSlope(pts);
  measures.slope = slope;
  if (slope && isNum(slope.err) && slope.err > 0) {
    const s = Math.abs(slope.alpha) / slope.err;
    const a = Math.abs(slope.alpha) < 0.05 ? '0.0' : `${slope.alpha > 0 ? '+' : '−'}${Math.abs(slope.alpha).toFixed(1)}`;
    if (slope.alpha >= 0.5 && s >= 3) {
      hints.push({
        id: 'slope-red',
        rank: 50,
        title: 'Brighter towards the red: cool or dusty',
        text: `Flux rises with wavelength (power-law slope ${a}; a Sun-like star gives about −1). Very cool objects do this, and so do sources seen through dust or warmed by it.`,
        confidence: slope.alpha >= 1 && s >= 5 ? 'likely' : 'tentative',
      });
    } else if (slope.alpha <= -0.8 && s >= 3) {
      hints.push({
        id: 'slope-blue',
        rank: 55,
        title: 'Fainter towards the red: looks like a warm star',
        text: `Flux falls with wavelength (power-law slope ${a}; a Sun-like star gives about −1, a very hot one −2). Ordinary stars warmer than about 4500 K look like this.`,
        confidence: slope.alpha <= -1 && s >= 5 ? 'likely' : 'tentative',
      });
    } else if (slope.n >= 12 && slope.peakWave > pts[0].wave * 1.15 && slope.peakWave < pts[pts.length - 1].wave * 0.8) {
      hints.push({
        id: 'slope-flat',
        rank: 60,
        title: 'Peaks inside the SPHEREx range: perhaps a cool star',
        text: `Neither steadily rising nor falling (slope ${a}); brightest near ${um(slope.peakWave.toFixed(1))}. Stars of roughly 2500 to 4500 K peak here. So can a mix of two sources in one pixel.`,
        confidence: 'tentative',
      });
    }
  }

  // The 3.3 um band and the 4.5 um peak.
  const ch4 = bandDepth(pts, BANDS.ch4);
  measures.ch4 = ch4;
  const f33 = ch4 ? ch4.band : bandFlux(pts, BANDS.ch4.band[0], BANDS.ch4.band[1]);
  const f45 = bandFlux(pts, BANDS.peak45[0], BANDS.peak45[1]);
  let ratio45 = null;
  if (f33 && f45 && f45.flux > 0 && (f45.err === null || f45.flux >= 3 * f45.err)) {
    // A band consistent with zero gives a lower limit: divide by twice its error instead.
    const floor = f33.err !== null ? 2 * f33.err : 0;
    const denom = Math.max(f33.flux, floor);
    if (denom > 0) ratio45 = { value: f45.flux / denom, limit: f33.flux < floor };
  }
  measures.ratio45to33 = ratio45;
  const dipped = ch4 && ch4.depth >= 0.15 && ch4.sigma >= 3;
  if (dipped) {
    hints.push({
      id: 'band-3.3',
      rank: 40,
      title: `A dip near ${um('3.3')}: methane or water ice`,
      text: `Between 3.15 and 3.45 µm the flux is ${pct(ch4.depth)} percent below the level on either side (${sig(ch4.sigma)} sigma). Methane gas absorbs here, and so does water ice on dust grains.`,
      confidence: ch4.depth >= 0.5 && ch4.sigma >= 8 ? 'strong' : ch4.depth >= 0.3 && ch4.sigma >= 5 ? 'likely' : 'tentative',
    });
  }
  if (ratio45 && ratio45.value >= 2 && ch4 && ch4.depth >= 0.2 && ch4.sigma >= 3) {
    const times = `${ratio45.limit ? 'at least ' : ''}${ratio45.value >= 10 ? Math.round(ratio45.value) : ratio45.value.toFixed(1)} times`;
    hints.push({
      id: 'cold-atmosphere',
      rank: 10,
      title: 'May be a methane-rich cold atmosphere, like a T or Y dwarf',
      text: `It is ${times} brighter at 4.5 µm than at 3.3 µm, and the 3.3 µm dip is ${pct(ch4.depth)} percent deep. Methane in a cold atmosphere carves exactly that shape. Dust-buried young stars and icy sight lines can imitate it, so check for motion.`,
      confidence: ratio45.value >= 5 && ch4.depth >= 0.6 && ch4.sigma >= 5 ? 'strong' : ratio45.value >= 3 && ch4.depth >= 0.4 ? 'likely' : 'tentative',
    });
  }

  // Carbon dioxide and carbon monoxide.
  const narrow = [
    { def: BANDS.co2, id: 'band-co2', rank: 42, name: 'carbon dioxide', where: '4.27', why: 'CO₂ ice on dust grains along the line of sight absorbs here, and so does CO₂ gas in a cool atmosphere.' },
    { def: BANDS.co, id: 'band-co', rank: 44, name: 'carbon monoxide', where: '4.67', why: 'CO ice in dense clouds absorbs here, and so does CO gas in the atmospheres of cool stars and brown dwarfs.' },
  ];
  for (const item of narrow) {
    const d = bandDepth(pts, item.def);
    measures[item.def.id] = d;
    if (!d || !(d.depth >= 0.1 && d.sigma >= 3)) continue;
    hints.push({
      id: item.id,
      rank: item.rank,
      title: `A dip at ${um(item.where)}: ${item.name}, in ice or a cool atmosphere`,
      text: `The flux at ${item.where} µm is ${pct(d.depth)} percent below its surroundings (${sig(d.sigma)} sigma${d.sides < 2 ? ', continuum on one side only' : ''}). ${item.why}`,
      confidence: d.depth >= 0.25 && d.sigma >= 5 && d.sides === 2 ? 'likely' : 'tentative',
    });
  }
}

function lightCurveHints(lightCurve, hints, measures) {
  const lc = summarizeLightCurve(lightCurve);
  measures.lightCurve = lc;
  if (!lc || lc.passes.length < 2 || lc.sigma === null) return;
  if (lc.sigma >= 3 && lc.change >= 0.1) {
    const factor = 1 + lc.change;
    const amount = !isNum(factor) ? 'much brighter' : factor >= 1.95 ? `${factor.toFixed(1)} times brighter` : `${pct(lc.change)} percent brighter`;
    const when = [monthYear(lc.bright.mjd), monthYear(lc.faint.mjd)];
    const dates = when[0] && when[1] && when[0] !== when[1] ? ` in ${when[0]} than in ${when[1]}` : ' in one pass than in another';
    hints.push({
      id: 'variable',
      rank: 20,
      title: 'Variable: the brightness changed between passes',
      text: `About ${amount}${dates} (${sig(lc.sigma)} sigma). Pulsating giants, eclipsing pairs, young stars and active galaxies all do this; a neighbour drifting into the aperture can fake it.`,
      confidence: lc.sigma >= 8 && lc.change >= 0.5 ? 'strong' : lc.sigma >= 5 && lc.change >= 0.2 ? 'likely' : 'tentative',
    });
    return;
  }
  // Upper limit: three times the largest pass error, as a fraction of the mean level.
  const level = median(lc.passes.map((p) => p.ratio));
  const worst = Math.max(...lc.passes.map((p) => p.err ?? 0));
  const limit = level > 0 ? Math.max(lc.change ?? 0, (3 * Math.SQRT2 * worst) / level) : null;
  if (limit !== null && limit <= 0.3) {
    hints.push({
      id: 'steady',
      rank: 80,
      title: 'Steady between passes',
      text: `No brightness change larger than about ${Math.max(1, Math.round(limit * 100))} percent across ${lc.passes.length} survey passes. Slow or small variations would not show.`,
      confidence: limit <= 0.1 ? 'likely' : 'tentative',
    });
  }
}

function motionHints(motion, gaiaInput, hints, measures) {
  const { measured, gaiaStar } = normaliseMotion(motion);
  let g = normaliseGaia(gaiaInput);
  if (gaiaStar && !g.star) g = { checked: true, star: gaiaStar, sep: null };
  measures.motion = measured;
  measures.gaia = g;
  const gHasPm = g.star && isNum(g.star.pmra) && isNum(g.star.pmdec);
  const gTotal = gHasPm ? Math.hypot(g.star.pmra, g.star.pmdec) : null;
  const near = g.sep === null ? '' : g.sep < 0.05 ? ' at this position' : ` ${g.sep < 1 ? g.sep.toFixed(1) : Math.round(g.sep)} arcsec away`;

  let moving = false;
  let s = null;
  if (measured) {
    if (measured.errTotal !== null) {
      s = measured.total / measured.errTotal;
      moving = s >= 3 && measured.total >= 30;
    } else {
      moving = measured.total >= 500; // no error bar: only a large motion is worth a word
    }
  }
  measures.moving = moving;
  const how = measured ? formatMotionWithError(measured.total, measured.errTotal) : '';
  const dir = measured ? compass(measured.pmra, measured.pmdec) : '';
  const towards = dir ? ` towards the ${dir}` : '';
  const sText = s !== null ? ` (${sig(s)} sigma)` : '';

  if (moving && g.checked && !g.star) {
    hints.push({
      id: 'unknown-mover',
      rank: 5,
      title: 'Not in Gaia and moving: worth a careful look',
      text: `It moves ${how}${towards}${sText}, and no Gaia DR3 star lies within ${GAIA_MATCH_ARCSEC} arcsec. Cold brown dwarfs and bodies of the outer solar system are too faint or too red for Gaia. Rule out image artefacts and blended neighbours first.`,
      confidence: s !== null && s >= 5 ? 'likely' : 'tentative',
    });
    return;
  }
  if (moving && gHasPm) {
    const diff = Math.hypot(measured.pmra - g.star.pmra, measured.pmdec - g.star.pmdec);
    const tol = Math.max(3 * (measured.errTotal ?? 0), 0.3 * Math.max(measured.total, gTotal));
    if (diff <= tol) {
      hints.push({
        id: 'moving',
        rank: 25,
        title: 'Moving, as Gaia predicts',
        text: `Measured ${how}${towards}${sText}. Gaia lists ${formatMotion(gTotal)} for the star${near}, so this is very probably that star: a nearby one, to move this fast.`,
        confidence: s !== null && s >= 5 ? 'strong' : 'likely',
      });
    } else {
      const excess = measured.errTotal !== null ? diff / measured.errTotal : null;
      hints.push({
        id: 'moving-unexpected',
        rank: 15,
        title: 'Moving differently from the nearest Gaia star',
        text: `Measured ${how}${towards}${sText}, but the Gaia star${near} should move ${formatMotion(gTotal)}${compass(g.star.pmra, g.star.pmdec) ? ` towards the ${compass(g.star.pmra, g.star.pmdec)}` : ''}. Either this is a different object, or a neighbour is pulling the measured position.`,
        confidence: excess !== null && excess >= 6 ? 'likely' : 'tentative',
      });
    }
    return;
  }
  if (moving) {
    hints.push({
      id: 'moving',
      rank: 25,
      title: 'Moving',
      text: `Measured ${how}${towards}${sText}${g.star ? '. The nearest Gaia star has no proper motion listed to compare with' : ''}. Anything that shifts between passes is close by: a nearby star, a brown dwarf or a solar-system body.`,
      confidence: s !== null && s >= 5 ? 'likely' : 'tentative',
    });
    return;
  }
  if (measured && measured.errTotal !== null) {
    const limit = formatMotion(3 * measured.errTotal);
    if (gHasPm && gTotal >= 3 * measured.errTotal && gTotal >= 100) {
      hints.push({
        id: 'gaia-motion-unseen',
        rank: 30,
        title: 'Gaia expects motion that the images do not show',
        text: `The Gaia star${near} should move ${formatMotion(gTotal)}, but the measured motion is below ${limit}. The clicked source may not be that star.`,
        confidence: 'tentative',
      });
    } else {
      hints.push({
        id: 'still',
        rank: 85,
        title: 'No motion detected',
        text: `Any motion is below about ${limit} (3 sigma)${gHasPm ? `, in line with the ${formatMotion(gTotal)} Gaia lists for the star${near}` : ''}. Distant stars and galaxies stay put at this precision.`,
        confidence: 'likely',
      });
    }
  }
  if (g.checked && !g.star) {
    hints.push({
      id: 'not-in-gaia',
      rank: 35,
      title: 'No Gaia counterpart',
      text: `No Gaia DR3 star within ${GAIA_MATCH_ARCSEC} arcsec. Gaia works in visible light down to about magnitude 21, so this source is faint or very red there: a galaxy, a dust-hidden star, a cold dwarf, or an artefact in the images.`,
      confidence: 'tentative',
    });
  }
}

/**
 * The brightness is measured at the clicked position. A source that moves a good part of a
 * pixel between passes leaves that position, so its "light curve" changes without the source
 * changing at all. When motion explains the change, the variable hint is replaced by one
 * that says so.
 */
function explainFadingByMotion(hints, measures) {
  const i = hints.findIndex((h) => h.id === 'variable');
  const lc = measures.lightCurve;
  const m = measures.motion;
  if (i < 0 || !measures.moving || !m || !lc || lc.passes.length < 2) return;
  const years = (lc.passes[lc.passes.length - 1].mjd - lc.passes[0].mjd) / 365.25;
  const shift = (m.total / 1000) * years;
  if (!(shift >= 3)) return; // arcsec: half a SPHEREx pixel
  hints[i] = {
    id: 'faded-by-motion',
    rank: 70,
    title: 'Brightness changed at this spot, because the source moved',
    text: `The brightness is measured at the clicked position, and the source moved about ${shift < 10 ? shift.toFixed(1) : Math.round(shift)} arcsec while the light curve was taken (a SPHEREx pixel is 6 arcsec). The change says where the source was, not that it varies.`,
    confidence: 'likely',
  };
}

function sizeHints(size, hints, measures) {
  if (!size || typeof size !== 'object') return;
  const fwhm = isNum(size.fwhmArcsec) ? size.fwhmArcsec : isNum(size.sizeArcsec) ? size.sizeArcsec : null;
  const psf = isNum(size.psfArcsec) ? size.psfArcsec : isNum(size.psfFwhmArcsec) ? size.psfFwhmArcsec : null;
  if (fwhm === null || psf === null || !(psf > 0) || !(fwhm > 0)) return;
  const ratio = fwhm / psf;
  measures.sizeRatio = ratio;
  if (ratio >= 1.4) {
    hints.push({
      id: 'extended',
      rank: 45,
      title: 'Extended: wider than a single star',
      text: `About ${fwhm.toFixed(0)} arcsec across, where a star in the same frames measures ${psf.toFixed(0)}. Galaxies, nebulae and close groups of stars look like this.`,
      confidence: ratio >= 1.8 ? 'likely' : 'tentative',
    });
  } else if (ratio <= 1.15) {
    hints.push({
      id: 'point-like',
      rank: 75,
      title: 'Point-like',
      text: `As narrow as a star at SPHEREx's 6 arcsec pixels (${fwhm.toFixed(0)} against ${psf.toFixed(0)} arcsec). A small, distant galaxy would look the same.`,
      confidence: 'tentative',
    });
  }
}

/**
 * classify(input) -> { hints, measures, disclaimer }. See the top of the file for the input.
 * Hints are ordered with the most consequential first. Never throws: a part of the input that
 * cannot be read simply contributes no hint.
 */
export function classify(input = {}) {
  const hints = [];
  const measures = {};
  const steps = [
    () => lightCurveHints(input && input.lightCurve, hints, measures), // first: the spectrum step asks whether it varies
    () => spectrumHints(usablePoints(input && input.binned), hints, measures),
    () => motionHints(input && input.motion, input ? input.gaia : undefined, hints, measures),
    () => sizeHints(input && input.size, hints, measures),
  ];
  for (const step of steps) {
    try {
      step();
    } catch {
      // one unreadable measurement must not cost the user the other hints
    }
  }
  try {
    explainFadingByMotion(hints, measures);
  } catch {
    // keep the hints as they are
  }
  hints.sort((a, b) => a.rank - b.rank);
  return {
    hints: hints.map(({ id, title, text, confidence }) => ({ id, title, text, confidence })),
    measures,
    disclaimer: DISCLAIMER,
  };
}
