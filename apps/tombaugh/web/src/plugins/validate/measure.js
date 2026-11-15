// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// measure.js - turn what the app has loaded for one target into numbers that can be set beside
// a catalogue. Pure orchestration of the core science modules: no DOM, no network.
//
//   measureTarget(ctx)  motion, variability, spectrum summary, data quality, residual statistics
//   measureField(ctx)   the field-star tests first (fieldstars.js), then measureTarget with the
//                       field-star scatter as the error floor of the target's positions
//
// Every part is independent and tolerant: a part that cannot be measured comes back as
// { ok: false, reason } and the rest carries on. Nothing here throws on bad data. The functions
// are async and yield to the event loop between parts so that a page stays responsive.
//
// Units: proper motions mas/yr, offsets arcsec (east and north positive), dates MJD, wavelengths
// micrometres, fluxes microjansky. "Sigma" always means a difference divided by its 1-sigma error.

import {
  propagate, centroid, fitMotion, fitMotionWithParallax, matchGaia, tangentOffset, offsetBy,
  separationArcsec, maskedCoreRadius, centroidWings,
} from '../../core/astrometry.js';
import { gridSkyToPix, gridPixToSky } from '../../core/wcs.js';
import { splitPasses, medianMjd, passLabel, DETECTORS } from '../../core/frames.js';
import { stackLayers, normalizeBackground } from '../../core/stack.js';
import { fitSkyModel, residualLayer, evalModelAt } from '../../core/skymodel.js';
import { reproject } from '../../core/reproject.js';
import { extractSpectrum, lightCurve } from '../../core/photometry.js';
import { LENSES } from '../../core/lenses.js';
import { mjdToIso } from '../../core/time.js';
import {
  buildPassStacks, measureFieldStars, alignment, nullTest, median, robustSigma,
  NATIVE_PIXEL_ARCSEC, GAIA_EPOCH,
} from './fieldstars.js';

export { buildPassStacks };

const CORE = {
  propagate, centroid, fitMotion, fitMotionWithParallax, matchGaia, tangentOffset, offsetBy,
  separationArcsec, maskedCoreRadius, centroidWings, gridSkyToPix, gridPixToSky, splitPasses, medianMjd, passLabel, stackLayers,
  normalizeBackground, fitSkyModel, residualLayer, evalModelAt, extractSpectrum, lightCurve, mjdToIso,
  reproject,
};

/** Default position-error floor (arcsec) when no field-star scatter is available: 0.05 grid pixel. */
export const DEFAULT_FLOOR_ARCSEC = 0.15;
/** Fractional error added in quadrature to every pass-mean brightness: a 1 percent repeatability floor. */
export const DEFAULT_PHOT_FLOOR = 0.01;
/** The methane band used for the depth in the spectrum summary (from core/lenses.js). */
export const METHANE_BAND = (() => {
  const lens = Array.isArray(LENSES) ? LENSES.find((l) => l && l.id === 'methane') : null;
  return lens && lens.band && lens.continuum
    ? { band: lens.band, continuum: lens.continuum }
    : { band: [3.15, 3.45], continuum: [[2.9, 3.05], [3.6, 3.8]] };
})();

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const fail = (reason) => ({ ok: false, reason });
const wrap180 = (a) => ((((a + 180) % 360) + 360) % 360) - 180;

function defaultTick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function starsOf(gaia) {
  if (Array.isArray(gaia)) return gaia;
  if (gaia && Array.isArray(gaia.stars)) return gaia.stars;
  return [];
}

function layersByDetOf(ctx) {
  const map = new Map();
  const src = ctx.layersByDet;
  if (src instanceof Map) {
    for (const [det, layers] of src) if (layers && layers.length) map.set(Number(det), layers);
  } else if (src && typeof src === 'object') {
    for (const det of Object.keys(src)) if (src[det] && src[det].length) map.set(Number(det), src[det]);
  }
  if (Array.isArray(ctx.layers) && ctx.layers.length) {
    const det = isNum(ctx.det) ? ctx.det : ctx.layers[0].det;
    if (!map.has(det)) map.set(det, ctx.layers);
  }
  return map;
}

function framesByDetOf(frames) {
  const map = new Map();
  for (const f of frames || []) {
    if (!f || !isNum(f.det)) continue;
    if (!map.has(f.det)) map.set(f.det, []);
    map.get(f.det).push(f);
  }
  return map;
}

/**
 * The catalogue entry to compare the target with, in order of preference: an explicit
 * ctx.catalogue; the Gaia DR3 star at the target's position (when it does not contradict a known
 * target's motion); the target's own table values (core/targets.js); nothing.
 */
function resolveCatalogue(ctx, L, stacks, gaiaEpoch) {
  if (ctx.catalogue && isNum(ctx.catalogue.pmra) && isNum(ctx.catalogue.pmdec)) {
    return { source: 'catalogue', ...ctx.catalogue };
  }
  const t = ctx.target || {};
  const known = isNum(t.pmra) && isNum(t.pmdec) && isNum(t.epoch);
  const stars = starsOf(ctx.gaia);
  const dates = stacks.map((s) => s.mjd).filter(isNum);
  let match = null;
  if (stars.length && isNum(t.ra) && isNum(t.dec)) {
    // A known target is carried to each date; a bare position is tried as it stands.
    const tryDates = dates.length ? dates : [isNum(t.mjd) ? t.mjd : NaN];
    for (const mjd of tryDates) {
      if (!isNum(mjd)) continue;
      const at = known ? L.propagate(t, mjd) : { ra: t.ra, dec: t.dec };
      try {
        match = L.matchGaia(stars, at.ra, at.dec, mjd, 8, { epoch: gaiaEpoch });
      } catch {
        match = null;
      }
      if (match) break;
    }
  }
  if (match && known) {
    // Guard against a faint neighbour: a fast known target must be matched by a star that moves like it.
    const want = Math.hypot(t.pmra, t.pmdec);
    const got = Math.hypot((match.pmra || 0) - t.pmra, (match.pmdec || 0) - t.pmdec);
    if (want > 100 && got > Math.max(100, 0.2 * want)) match = null;
  }
  if (match && isNum(match.pmra) && isNum(match.pmdec)) {
    return {
      source: 'Gaia DR3', id: match.id != null ? String(match.id) : '', ra: match.ra, dec: match.dec,
      epoch: isNum(match.epoch) ? match.epoch : gaiaEpoch, pmra: match.pmra, pmdec: match.pmdec,
      parallax: isNum(match.parallax) ? match.parallax : null, gmag: isNum(match.gmag) ? match.gmag : null,
    };
  }
  if (known) {
    return {
      source: 'Tombaugh target table (approximate catalogue values)', id: t.id || t.name || '',
      ra: t.ra, dec: t.dec, epoch: t.epoch, pmra: t.pmra, pmdec: t.pmdec,
      parallax: isNum(t.parallax) && t.parallax > 0 ? t.parallax : null,
    };
  }
  return null;
}

// ---- (a) motion ---------------------------------------------------------------------------------

/**
 * Centroid the target in every pass stack, fit a straight-line motion, and compare with the
 * catalogue track evaluated at the same dates (which includes parallax when it is known).
 */
function measureMotion(env) {
  const { L, grid, stacks, catalogue, target, floorArcsec, det } = env;
  if (!stacks.length) return fail(`No exposures of detector ${det} are loaded`);
  const n = grid.n;
  const box = 5;
  const maxJump = 6; // grid pixels between the guess and the centroid

  const locate = (stack, x, y) => {
    if (!isNum(x) || !isNum(y)) return null;
    let c = null;
    try {
      // A saturated star has a flagged core, which the ordinary centroid cannot use: such a
      // source is located from the unsaturated light around the hole instead.
      const core = typeof L.maskedCoreRadius === 'function' ? L.maskedCoreRadius(stack.image, stack.mask, n, x, y) : 0;
      c = core > 0 && typeof L.centroidWings === 'function'
        ? L.centroidWings(stack.image, stack.mask, n, x, y)
        : L.centroid(stack.image, stack.mask, n, x, y, { box });
    } catch {
      c = null;
    }
    if (!c || !c.ok || !isNum(c.x) || !isNum(c.y)) return null;
    if (Math.hypot(c.x - x, c.y - y) > maxJump) return null;
    return c;
  };

  const found = new Array(stacks.length).fill(null);
  if (catalogue) {
    stacks.forEach((stack, i) => {
      const pred = L.propagate(catalogue, stack.mjd);
      const [x, y] = L.gridSkyToPix(grid, pred.ra, pred.dec);
      found[i] = locate(stack, x, y);
    });
  }
  // Where the catalogue gave nothing, follow the source from pass to pass, starting with the
  // pass nearest the date the target position refers to.
  const [tx, ty] = isNum(target.ra) && isNum(target.dec) ? L.gridSkyToPix(grid, target.ra, target.dec) : [NaN, NaN];
  let start = Math.floor(stacks.length / 2);
  if (isNum(target.mjd)) {
    let best = Infinity;
    stacks.forEach((s, i) => {
      const d = Math.abs(s.mjd - target.mjd);
      if (d < best) { best = d; start = i; }
    });
  }
  const anchor = found.findIndex((f) => f);
  if (anchor >= 0) start = anchor;
  if (!found[start]) found[start] = locate(stacks[start], tx, ty);
  let prev = found[start] || { x: tx, y: ty };
  for (let i = start + 1; i < stacks.length; i++) {
    if (!found[i]) found[i] = locate(stacks[i], prev.x, prev.y);
    if (found[i]) prev = found[i];
  }
  prev = found[start] || { x: tx, y: ty };
  for (let i = start - 1; i >= 0; i--) {
    if (!found[i]) found[i] = locate(stacks[i], prev.x, prev.y);
    if (found[i]) prev = found[i];
  }

  const points = [];
  stacks.forEach((stack, i) => {
    const c = found[i];
    if (!c) return;
    const [ra, dec] = L.gridPixToSky(grid, c.x, c.y);
    let statPix = Math.sqrt(((isNum(c.xErr) ? c.xErr : 0) ** 2 + (isNum(c.yErr) ? c.yErr : 0) ** 2) / 2);
    if (!(statPix > 0)) statPix = 1.5 / Math.max(c.snr || 1, 1);
    points.push({
      pass: stack.index, label: stack.label, mjd: stack.mjd, ra, dec, x: c.x, y: c.y,
      sigma: Math.hypot(statPix * grid.scale, floorArcsec), statArcsec: statPix * grid.scale,
      snr: isNum(c.snr) ? c.snr : null, flux: isNum(c.flux) ? c.flux : null,
      ...(c.method === 'wings' ? { method: 'wings' } : {}),
    });
  });
  const base = {
    det, nPasses: stacks.length, nFound: points.length, floorArcsec, points, catalogue: catalogue || null,
    saturated: points.some((p) => p.method === 'wings'),
  };
  if (points.length < 2) {
    const reason = stacks.length < 2
      ? 'Only one survey pass is loaded; a motion needs two'
      : `The target was found in ${points.length} of ${stacks.length} pass stacks; a motion needs two`;
    return { ...fail(reason), ...base };
  }

  const fit = L.fitMotion(points.map((p) => ({ mjd: p.mjd, ra: p.ra, dec: p.dec, sigma: p.sigma })));
  if (!fit || !isNum(fit.pmra) || !isNum(fit.pmdec)) return { ...fail('The motion fit did not converge'), ...base };
  const measured = {
    pmra: fit.pmra, pmdec: fit.pmdec, errPmra: fit.errPmra, errPmdec: fit.errPmdec, total: fit.total,
    errTotal: fit.errTotal, paDeg: fit.paDeg, errPaDeg: fit.errPaDeg, rmsArcsec: fit.rmsArcsec,
    chi2: fit.chi2, dof: fit.dof, ra0: fit.ra0, dec0: fit.dec0, mjd0: fit.mjd0,
  };
  const significance = fit.errTotal > 0 ? fit.total / fit.errTotal : null;
  const out = {
    ok: true, ...base, measured, significance, moving: significance !== null && significance >= 3,
    spanYears: (points[points.length - 1].mjd - points[0].mjd) / 365.25,
    expected: null, difference: null, offsetFromTrack: null, parallaxFit: null, displacement: null,
  };

  // With three or more passes the parallax can be solved for as well.
  if (points.length >= 3 && typeof L.fitMotionWithParallax === 'function') {
    try {
      const pf = L.fitMotionWithParallax(points.map((p) => ({ mjd: p.mjd, ra: p.ra, dec: p.dec, sigma: p.sigma })));
      if (pf && isNum(pf.parallax) && isNum(pf.errParallax)) {
        out.parallaxFit = {
          parallax: pf.parallax, errParallax: pf.errParallax, pmra: pf.pmra, pmdec: pf.pmdec,
          errPmra: pf.errPmra, errPmdec: pf.errPmdec, total: pf.total, errTotal: pf.errTotal,
        };
      }
    } catch {
      out.parallaxFit = null;
    }
  }

  if (catalogue) {
    // The catalogue track at the same dates, fitted the same way: apples to apples. A straight
    // line through a few passes absorbs part of the parallax swing, and so does this.
    const track = points.map((p) => ({ mjd: p.mjd, ...L.propagate(catalogue, p.mjd), sigma: p.sigma }));
    const exp = L.fitMotion(track);
    const catTotal = Math.hypot(catalogue.pmra, catalogue.pmdec);
    out.catalogue = {
      ...catalogue, total: catTotal,
      paDeg: catTotal > 0 ? ((Math.atan2(catalogue.pmra, catalogue.pmdec) * 180) / Math.PI + 360) % 360 : null,
    };
    if (exp && isNum(exp.pmra)) {
      out.expected = { pmra: exp.pmra, pmdec: exp.pmdec, total: exp.total, paDeg: exp.paDeg };
      const dPmra = fit.pmra - exp.pmra;
      const dPmdec = fit.pmdec - exp.pmdec;
      const dTotal = fit.total - exp.total;
      const dPa = wrap180(fit.paDeg - exp.paDeg);
      const paUsable = out.moving && exp.total > 0 && fit.errPaDeg > 0;
      out.difference = {
        pmra: dPmra, pmdec: dPmdec, total: dTotal, vector: Math.hypot(dPmra, dPmdec),
        sigmaPmra: fit.errPmra > 0 ? dPmra / fit.errPmra : null,
        sigmaPmdec: fit.errPmdec > 0 ? dPmdec / fit.errPmdec : null,
        sigmaTotal: fit.errTotal > 0 ? dTotal / fit.errTotal : null,
        paDeg: paUsable ? dPa : null,
        sigmaPa: paUsable ? dPa / fit.errPaDeg : null,
      };
    }
    let se = 0;
    let sn = 0;
    track.forEach((t, i) => {
      const off = L.tangentOffset(points[i].ra, points[i].dec, t.ra, t.dec);
      se += off.dEast;
      sn += off.dNorth;
    });
    out.offsetFromTrack = { dEast: se / track.length, dNorth: sn / track.length, total: Math.hypot(se, sn) / track.length };
    if (isNum(catalogue.ra) && isNum(catalogue.dec) && isNum(catalogue.epoch)) {
      const last = points[points.length - 1];
      out.displacement = {
        sinceEpoch: catalogue.epoch,
        arcsec: L.separationArcsec(catalogue.ra, catalogue.dec, last.ra, last.dec),
        pixels: L.separationArcsec(catalogue.ra, catalogue.dec, last.ra, last.dec) / NATIVE_PIXEL_ARCSEC,
      };
    }
  }
  return out;
}

/** Function mjd -> { ra, dec }: where to put an aperture on the target at any date. */
function makeTracker(env, motion) {
  const { L, catalogue, target } = env;
  if (motion && motion.points && motion.points.length) {
    const pts = motion.points;
    const pm = motion.ok && motion.moving ? motion.measured : catalogue || null;
    return (mjd) => {
      let best = pts[0];
      for (const p of pts) if (Math.abs(p.mjd - mjd) < Math.abs(best.mjd - mjd)) best = p;
      if (!pm || !isNum(mjd)) return { ra: best.ra, dec: best.dec };
      const years = (mjd - best.mjd) / 365.25;
      return L.offsetBy(best.ra, best.dec, (pm.pmra * years) / 1000, (pm.pmdec * years) / 1000);
    };
  }
  if (catalogue) return (mjd) => L.propagate(catalogue, mjd);
  return () => ({ ra: target.ra, dec: target.dec });
}

// ---- (b) variability ----------------------------------------------------------------------------

/** Weighted mean of { value, err } with the larger of the formal error and the scatter-based one. */
function robustMean(items) {
  const vals = items.map((i) => i.value);
  const med = median(vals);
  const sig = robustSigma(vals);
  const kept = items.length >= 4 && sig > 0
    ? items.filter((i) => Math.abs(i.value - med) <= 4 * Math.hypot(sig, i.err))
    : items;
  let sw = 0;
  let swx = 0;
  for (const i of kept) {
    const w = 1 / (i.err * i.err);
    sw += w;
    swx += w * i.value;
  }
  if (!(sw > 0)) return null;
  const mean = swx / sw;
  const formal = 1 / Math.sqrt(sw);
  let chi2 = 0;
  for (const i of kept) chi2 += ((i.value - mean) / i.err) ** 2;
  const inflate = kept.length > 1 ? Math.max(1, Math.sqrt(chi2 / (kept.length - 1))) : 1;
  return { mean, err: formal * inflate, n: kept.length, nRejected: items.length - kept.length };
}

/** All pairs of pass means: ratio later / earlier, its error and the significance of the change. */
function passPairs(passes) {
  const pairs = [];
  for (let i = 0; i < passes.length; i++) {
    for (let j = i + 1; j < passes.length; j++) {
      const a = passes[i];
      const b = passes[j];
      if (!(a.mean > 0) || !(b.mean > 0)) continue;
      const ratio = b.mean / a.mean;
      const err = ratio * Math.hypot(a.err / a.mean, b.err / b.mean);
      const significance = Math.abs(b.mean - a.mean) / Math.hypot(a.err, b.err);
      // A pair is blended when a background star sits in the aperture on one date and not the
      // other, or sits at a clearly different distance: its light then differs between the two.
      const ba = a.blend || null;
      const bb = b.blend || null;
      const blended = (ba || bb) && (!ba || !bb || ba.id !== bb.id || Math.abs(ba.sepArcsec - bb.sepArcsec) > 2);
      const pair = { from: a.label, to: b.label, fromIndex: a.index, toIndex: b.index, ratio, err, significance };
      if (blended) pair.blend = { ...(bb || ba), pass: bb ? b.label : a.label };
      pairs.push(pair);
    }
  }
  return pairs;
}

/** The most significant pair; pairs free of a blended background star come first. */
function largestPair(pairs) {
  let best = null;
  const clean = pairs.filter((p) => !p.blend);
  for (const p of clean.length ? clean : pairs) if (!best || p.significance > best.significance) best = p;
  return best;
}

/** A Gaia star closer than this to a moving target shares its photometric aperture. */
export const BLEND_ARCSEC = 9;

/**
 * The Gaia star (other than the target itself) nearest the target on a given date, when it lies
 * inside the aperture: a mover that drifts past a background star picks up that star's light,
 * and the change in brightness is the star's, not the target's.
 * -> { sepArcsec, gmag, id } | null
 */
export function blendAt(env, tracker, mjd) {
  const { L, stars, catalogue, gaiaEpoch } = env;
  if (!Array.isArray(stars) || !stars.length || typeof tracker !== 'function' || !isNum(mjd)) return null;
  const pos = tracker(mjd);
  if (!pos || !isNum(pos.ra) || !isNum(pos.dec)) return null;
  const own = catalogue && catalogue.source === 'Gaia DR3' ? String(catalogue.id) : null;
  let best = null;
  for (const st of stars) {
    if (!st || !isNum(st.ra) || !isNum(st.dec)) continue;
    if (own !== null && st.id != null && String(st.id) === own) continue;
    let at = st;
    if (isNum(st.pmra) && isNum(st.pmdec)) {
      try {
        at = L.propagate({ ...st, epoch: isNum(st.epoch) ? st.epoch : gaiaEpoch, parallax: 0 }, mjd);
      } catch {
        at = st;
      }
    }
    const sep = L.separationArcsec(pos.ra, pos.dec, at.ra, at.dec);
    // The target's own Gaia entry, when the reference came from somewhere else: on top of it
    // and moving with it.
    if (catalogue && sep < 3 && isNum(st.pmra) && isNum(st.pmdec) && isNum(catalogue.pmra) && isNum(catalogue.pmdec)) {
      const want = Math.hypot(catalogue.pmra, catalogue.pmdec);
      if (Math.hypot(st.pmra - catalogue.pmra, st.pmdec - catalogue.pmdec) <= Math.max(100, 0.2 * want)) continue;
    }
    if (sep <= BLEND_ARCSEC && (!best || sep < best.sepArcsec)) best = { sepArcsec: sep, gmag: isNum(st.gmag) ? st.gmag : null, id: st.id != null ? String(st.id) : '' };
  }
  return best;
}

/** Brightness per pass and detector from native aperture photometry and the light curve. */
function variabilityFromPhotometry(env, pointsByDet, tracker = null) {
  const { L } = env;
  const perDet = [];
  for (const [det, points] of [...pointsByDet.entries()].sort((a, b) => a[0] - b[0])) {
    let curve = [];
    try {
      curve = L.lightCurve(points) || [];
    } catch (err) {
      perDet.push({ det, ...fail(`Light curve failed: ${err && err.message}`) });
      continue;
    }
    const groups = L.splitPasses(curve.filter((c) => c && isNum(c.ratio) && c.err > 0));
    const passes = [];
    groups.forEach((group, index) => {
      if (group.length < 2) return;
      const m = robustMean(group.map((c) => ({ value: c.ratio, err: c.err })));
      if (!m) return;
      // Aperture photometry of an undersampled PSF is not repeatable to better than about a
      // percent from pass to pass (pixel phase, roll), whatever the photon noise says.
      const err = Math.hypot(m.err, env.photFloor * Math.abs(m.mean));
      const mjd = L.medianMjd(group);
      const blend = tracker ? blendAt(env, tracker, mjd) : null;
      passes.push({ index, label: L.passLabel(group), mjd, n: m.n, mean: m.mean, err, statErr: m.err, ...(blend ? { blend } : {}) });
    });
    if (passes.length < 2) {
      perDet.push({ det, ...fail(passes.length ? 'Usable photometry in one pass only' : 'No usable photometry (flagged, off the frame or undetected)'), nPoints: curve.length, passes });
      continue;
    }
    const pairs = passPairs(passes);
    perDet.push({ det, ok: true, nPoints: curve.length, passes, pairs, largest: largestPair(pairs) });
  }
  return perDet;
}

/** Fallback when there is no native photometry: aperture sums on the per-pass stacks. */
function variabilityFromStacks(env, tracker, stacksByDet) {
  const { L, grid } = env;
  const perDet = [];
  for (const [det, stacks] of [...stacksByDet.entries()].sort((a, b) => a[0] - b[0])) {
    const passes = [];
    for (const stack of stacks) {
      const pos = tracker(stack.mjd);
      const [x, y] = L.gridSkyToPix(grid, pos.ra, pos.dec);
      let c = null;
      try {
        c = L.centroid(stack.image, stack.mask, grid.n, x, y, { box: 5 });
      } catch {
        c = null;
      }
      if (!c || !c.ok || !(c.flux > 0) || !(c.fluxErr > 0)) continue;
      passes.push({ index: stack.index, label: stack.label, mjd: stack.mjd, n: stack.nExposures, mean: c.flux, err: c.fluxErr });
    }
    if (passes.length < 2) {
      perDet.push({ det, ...fail('The target is measurable in fewer than two pass stacks'), passes });
      continue;
    }
    const pairs = passPairs(passes);
    perDet.push({ det, ok: true, nPoints: passes.length, passes, pairs, largest: largestPair(pairs) });
  }
  return perDet;
}

function summariseVariability(perDet, method, photFloor = 0) {
  const good = perDet.filter((d) => d.ok && d.largest);
  if (!good.length) {
    const reason = perDet.length ? perDet.map((d) => `D${d.det}: ${d.reason || 'no pass pair'}`).join('; ') : 'No photometry could be made';
    return { ...fail(reason), method, perDet };
  }
  let top = null;
  const better = (a, b) => (!!a.blend !== !!b.blend ? !a.blend : a.significance > b.significance);
  for (const d of good) if (!top || better(d.largest, top)) top = { det: d.det, ...d.largest };
  return {
    ok: true, method, perDet, largest: top, varied: top.significance >= 3 && !top.blend,
    percent: (top.ratio - 1) * 100, floor: photFloor,
  };
}

// ---- (c) spectrum summary -----------------------------------------------------------------------

function weightedFlux(points, lo, hi) {
  let sw = 0;
  let swf = 0;
  let n = 0;
  for (const p of points) {
    if (!(p.wave >= lo && p.wave < hi)) continue;
    const w = 1 / (p.err_uJy * p.err_uJy);
    sw += w;
    swf += w * p.flux_uJy;
    n++;
  }
  return n ? { flux: swf / sw, err: 1 / Math.sqrt(sw), n } : null;
}

/**
 * Depth of an absorption band, 1 - band / continuum, from spectrum points. The continuum is the
 * plain mean of its windows that have data (so a window on each side interpolates across the
 * band). `covered` is false when the band or every continuum window has fewer than two points.
 */
export function bandDepth(points, def = METHANE_BAND) {
  const usable = (points || []).filter((p) => p && p.ok !== false && !p.flagged && isNum(p.flux_uJy) && p.err_uJy > 0 && isNum(p.wave));
  const band = weightedFlux(usable, def.band[0], def.band[1]);
  const windows = def.continuum.map((w) => weightedFlux(usable, w[0], w[1])).filter((w) => w && w.n >= 2);
  const out = { band: def.band, continuum: def.continuum, covered: false, measurable: false, depth: null, err: null, nBand: band ? band.n : 0, nContinuum: windows.reduce((a, w) => a + w.n, 0) };
  if (!band || band.n < 2 || !windows.length) return out;
  out.covered = true;
  const cont = windows.reduce((a, w) => a + w.flux, 0) / windows.length;
  const contErr = Math.sqrt(windows.reduce((a, w) => a + w.err * w.err, 0)) / windows.length;
  out.continuumWindowsUsed = windows.length;
  out.continuum_uJy = cont;
  out.band_uJy = band.flux;
  if (!(cont > 3 * contErr)) {
    out.reason = 'The continuum beside the band is not detected, so a depth has no meaning';
    return out;
  }
  out.measurable = true;
  out.depth = 1 - band.flux / cont;
  out.err = Math.hypot(band.err / cont, (band.flux * contErr) / (cont * cont));
  out.sigma = out.err > 0 ? out.depth / out.err : null;
  return out;
}

function summariseSpectrum(pointsByDet) {
  const all = [];
  for (const pts of pointsByDet.values()) for (const p of pts) all.push(p);
  if (!all.length) return fail('No native frames cover the target');
  const usable = all.filter((p) => p && p.ok !== false && !p.flagged && isNum(p.flux_uJy) && p.err_uJy > 0 && isNum(p.wave));
  const flagged = all.filter((p) => p && p.flagged).length;
  if (!usable.length) return { ...fail('Every exposure is flagged at the target'), nExposures: 0, nFlagged: flagged, nTotal: all.length };
  const snr = usable.map((p) => p.flux_uJy / p.err_uJy);
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of usable) {
    if (p.wave < lo) lo = p.wave;
    if (p.wave > hi) hi = p.wave;
  }
  return {
    ok: true, nExposures: usable.length, nFlagged: flagged, nTotal: all.length,
    detectors: [...pointsByDet.keys()].sort((a, b) => a - b), coverage: [lo, hi],
    medianSnr: median(snr), nDetected: snr.filter((s) => s >= 3).length,
    medianFlux_uJy: median(usable.map((p) => p.flux_uJy)),
    methane: bandDepth(usable, METHANE_BAND),
  };
}

// ---- (d) data quality ---------------------------------------------------------------------------

function measureQuality(env, tracker, pointsByDet) {
  const { L, grid, layers, stacks, frames, det } = env;
  const out = {
    ok: true, det, nLayers: layers.length, exposuresUsed: stacks.reduce((a, s) => a + s.nExposures, 0),
    passes: stacks.map((s) => ({ index: s.index, label: s.label, mjd: s.mjd, date: L.mjdToIso(s.mjd), nExposures: s.nExposures })),
    framesByDet: {}, releases: {}, versions: {}, synthetic: false, aperture: null, photometryFlagged: null,
  };
  const source = frames.length ? frames : layers.map((l) => l.frame).filter(Boolean);
  for (const f of source) {
    out.framesByDet[f.det] = (out.framesByDet[f.det] || 0) + 1;
    if (f.release) out.releases[f.release] = (out.releases[f.release] || 0) + 1;
    if (f.version) out.versions[f.version] = (out.versions[f.version] || 0) + 1;
    // Frames of the synthetic test sky (proxy/fixtures/synth.js, fakefield.js) say so in their id.
    if (/l2b-syn-|^fake\//.test(String(f.id || ''))) out.synthetic = true;
  }
  // Flagged pixels inside the photometric aperture (1.6 SPHEREx pixels), on the grid layers.
  const r = (1.6 * NATIVE_PIXEL_ARCSEC) / grid.scale;
  const n = grid.n;
  let pix = 0;
  let bad = 0;
  let covering = 0;
  let touched = 0;
  let offFrame = 0;
  for (const layer of layers) {
    const pos = tracker(layer.mjd);
    const [x, y] = L.gridSkyToPix(grid, pos.ra, pos.dec);
    if (!isNum(x) || !isNum(y)) continue;
    let lp = 0;
    let lb = 0;
    let lo = 0;
    for (let yy = Math.max(0, Math.floor(y - r)); yy <= Math.min(n - 1, Math.ceil(y + r)); yy++) {
      for (let xx = Math.max(0, Math.floor(x - r)); xx <= Math.min(n - 1, Math.ceil(x + r)); xx++) {
        if ((xx - x) ** 2 + (yy - y) ** 2 > r * r) continue;
        const i = yy * n + xx;
        lp++;
        // The wavelength map is NaN only off the frame, so it tells "flagged" from "not observed".
        if (layer.wave && !Number.isFinite(layer.wave[i])) lo++;
        else if (layer.mask && layer.mask[i]) lb++;
      }
    }
    if (!lp || lo === lp) { offFrame++; continue; }
    covering++;
    pix += lp - lo;
    bad += lb;
    if (lb > 0) touched++;
  }
  out.aperture = {
    radiusArcsec: 1.6 * NATIVE_PIXEL_ARCSEC, exposures: covering, offFrame,
    flaggedPixelFraction: pix ? bad / pix : null, exposuresWithFlags: touched,
    exposureFraction: covering ? touched / covering : null,
  };
  let total = 0;
  let flagged = 0;
  for (const pts of pointsByDet.values()) for (const p of pts) { total++; if (p.flagged) flagged++; }
  if (total) out.photometryFlagged = { exposures: total, flagged, fraction: flagged / total };
  return out;
}

// ---- (e) residual statistics --------------------------------------------------------------------

/**
 * Residual signal-to-noise statistics on blank sky for one set of layers: fit the static-sky
 * model, divide every exposure's residual by its expected sigma, and take the distribution over
 * pixels where the model sees no source (and none within two pixels).
 */
async function residualStats(L, layers, tick, signal) {
  const norm = L.normalizeBackground(layers);
  await tick();
  const model = L.fitSkyModel(norm);
  await tick();
  const n = model.n;
  const npix = n * n;
  if (!(npix > 0)) return fail('The sky model is empty');
  const ref = L.evalModelAt(model, Math.exp(model.lnw0));
  let maxUsed = 0;
  for (let i = 0; i < npix; i++) if (model.nUsed[i] > maxUsed) maxUsed = model.nUsed[i];
  const sky = [];
  for (let i = 0; i < npix; i++) if (model.nUsed[i] >= 0.5 * maxUsed && Number.isFinite(ref[i])) sky.push(ref[i]);
  if (sky.length < 100) return fail('Too few pixels with a sky model');
  // Clip to the sky: iterate median and robust sigma so that stars do not set the scale.
  let level = median(sky);
  let spread = robustSigma(sky);
  for (let round = 0; round < 4; round++) {
    const keep = sky.filter((v) => Math.abs(v - level) <= 3 * spread);
    if (keep.length < 50) break;
    level = median(keep);
    spread = robustSigma(keep);
  }
  const source = new Uint8Array(npix);
  for (let i = 0; i < npix; i++) {
    if (!(model.nUsed[i] >= 0.5 * maxUsed) || !Number.isFinite(ref[i]) || ref[i] > level + 3 * spread) source[i] = 1;
  }
  const blank = new Uint8Array(npix);
  let nBlank = 0;
  for (let y = 3; y < n - 3; y++) {
    for (let x = 3; x < n - 3; x++) {
      let clear = true;
      for (let dy = -2; dy <= 2 && clear; dy++) for (let dx = -2; dx <= 2; dx++) if (source[(y + dy) * n + x + dx]) { clear = false; break; }
      if (clear) { blank[y * n + x] = 1; nBlank++; }
    }
  }
  if (nBlank < 50) return fail('No blank sky in this field: sources everywhere');

  let count = 0;
  let sum = 0;
  let sumSq = 0;
  let beyond5 = 0;
  let beyond3 = 0;
  const sample = [];
  const stride = Math.max(1, Math.floor((nBlank * norm.length) / 60000));
  let k = 0;
  for (let l = 0; l < norm.length; l++) {
    if (signal && signal.aborted) return fail('Cancelled');
    const r = L.residualLayer(model, norm[l]);
    for (let i = 0; i < npix; i++) {
      if (!blank[i] || r.mask[i]) continue;
      const s = r.snr[i];
      if (!Number.isFinite(s)) continue;
      count++;
      sum += s;
      sumSq += s * s;
      const a = Math.abs(s);
      if (a > 5) beyond5++;
      if (a > 3) beyond3++;
      if (k++ % stride === 0) sample.push(s);
    }
    if (l % 8 === 7) await tick();
  }
  if (count < 100) return fail('Too few unflagged blank-sky pixels');
  const mean = sum / count;
  return {
    ok: true, det: model.det, nLayers: norm.length, nPixels: count, blankFraction: nBlank / npix, mean,
    std: Math.sqrt(Math.max(0, sumSq / count - mean * mean)), robustSigma: robustSigma(sample),
    fracBeyond5: beyond5 / count, nBeyond5: beyond5, fracBeyond3: beyond3 / count,
  };
}

/**
 * Noise test on blank sky, two ways.
 *
 *   as displayed  on the layers the app shows. Their variance is interpolated like the image
 *                 (core/reproject.js, on purpose: it never understates the noise of a pixel),
 *                 but bilinear resampling averages neighbouring detector pixels and so lowers
 *                 the real scatter. The standard deviation of residual / sigma therefore comes
 *                 out near 0.6, not 1: the residual view is conservative by that factor.
 *   exact         the same exposures resampled again with the exact single-pixel variance
 *                 (reproject `variance: 'propagate'`). This is the test of the noise model
 *                 itself: the standard deviation should be near 1, and about one pixel in
 *                 1.7 million should lie beyond 5 sigma. Needs the native frames.
 *
 * Returns the "as displayed" statistics at the top level and the exact ones under `exact`
 * ({ ok: false, reason } when the native frames are not available).
 */
async function measureResiduals(env) {
  const { L, layers, frames, grid, det, tick, signal } = env;
  if (layers.length < 4) return fail('Fewer than four exposures: no sky model to test');
  const shown = await residualStats(L, layers, tick, signal);
  if (!shown.ok) return shown;
  let exact = fail('The native frames are not available, so the exact-variance test was not run');
  const native = frames.filter((f) => f.det === det);
  if (native.length >= 4 && typeof L.reproject === 'function') {
    try {
      const again = [];
      for (let i = 0; i < native.length; i++) {
        if (signal && signal.aborted) break;
        again.push(L.reproject(native[i], grid, { variance: 'propagate' }));
        if (i % 8 === 7) await tick();
      }
      exact = again.length >= 4 ? await residualStats(L, again, tick, signal) : fail('Cancelled');
    } catch (err) {
      exact = fail(`Exact-variance test failed: ${err && err.message}`);
    }
  }
  const judged = exact.ok ? exact.std : null;
  let verdict;
  if (judged === null) {
    verdict = `On the layers as displayed the residuals scatter by ${shown.std.toFixed(2)} of their quoted sigma; resampling alone accounts for a value near 0.6.`;
  } else if (judged > 1.25) {
    verdict = 'The residuals scatter more than the noise model says: significances in the residual view are overstated in this field.';
  } else if (judged < 0.75) {
    verdict = 'The residuals scatter less than the noise model says: the variance is overestimated, and significances are conservative.';
  } else {
    verdict = 'The noise model matches the residuals on blank sky.';
  }
  return { ...shown, exact, expectedStd: 1, expectedBeyond5: 5.7e-7, expectedBeyond3: 0.0027, verdict };
}

// ---- orchestration ------------------------------------------------------------------------------

/**
 * Measure one target from what is loaded.
 *
 * @param {object} ctx
 *   grid         the common Grid
 *   det          the detector whose layers carry the motion and residual tests (default: the
 *                detector of ctx.layers, else the lowest loaded)
 *   layers       Layer[] of that detector, and/or
 *   layersByDet  Map<det, Layer[]> (or plain object) of every loaded detector
 *   frames       native Frame[] of all loaded detectors (for photometry); may be empty
 *   gaia         Gaia stars, as an array or as the /gaia response { epoch, stars }
 *   target       { ra, dec, name?, id?, mjd?, epoch?, pmra?, pmdec?, parallax? }; give the
 *                catalogue fields (an entry of core/targets.js) when it is a known target
 *   catalogue    optional explicit reference { ra, dec, epoch, pmra, pmdec, parallax, source }
 *   stacks       optional per-pass stacks of `det` (buildPassStacks) to avoid recomputing
 *   floorArcsec  error added in quadrature to each pass position (default 0.15 arcsec;
 *                measureField passes the field-star scatter)
 *   photFloor    fractional error added in quadrature to each pass-mean brightness (default 0.01)
 *   parts        optional subset of ['motion', 'variability', 'spectrum', 'quality', 'residuals']
 *   lib          optional overrides for the core functions (tests)
 *   signal       optional AbortSignal; onProgress({ step, done, total }); tick: () => Promise
 * @returns {Promise<object>} measurement:
 *   { kind: 'tombaugh-measurement', schema: 1, measuredAt, target, det, catalogue, passes,
 *     motion, variability, spectrum, quality, residuals, cancelled }
 */
export async function measureTarget(ctx = {}) {
  const L = { ...CORE, ...(ctx.lib || {}) };
  const tick = typeof ctx.tick === 'function' ? ctx.tick : defaultTick;
  const signal = ctx.signal || null;
  const wanted = Array.isArray(ctx.parts) && ctx.parts.length ? ctx.parts : ['motion', 'variability', 'spectrum', 'quality', 'residuals'];
  const total = wanted.length + 1;
  let done = 0;
  const progress = (step) => {
    if (typeof ctx.onProgress !== 'function') return;
    try {
      ctx.onProgress({ step, done, total });
    } catch {
      // a broken progress handler must not stop the measurement
    }
  };
  const t = ctx.target || {};
  const out = {
    kind: 'tombaugh-measurement', schema: 1, measuredAt: new Date().toISOString(),
    target: { name: t.name || '', id: t.id || '', ra: isNum(t.ra) ? t.ra : null, dec: isNum(t.dec) ? t.dec : null },
    det: null, catalogue: null, passes: [],
    motion: fail('Not measured'), variability: fail('Not measured'), spectrum: fail('Not measured'),
    quality: fail('Not measured'), residuals: fail('Not measured'), cancelled: false,
  };
  const everything = (reason) => {
    for (const key of ['motion', 'variability', 'spectrum', 'quality', 'residuals']) out[key] = fail(reason);
    return out;
  };
  if (!ctx.grid || !(ctx.grid.n > 0)) return everything('Nothing is loaded for this target');
  if (!isNum(t.ra) || !isNum(t.dec)) return everything('The target has no position');

  const byDet = layersByDetOf(ctx);
  let det = isNum(ctx.det) && byDet.has(ctx.det) ? ctx.det : null;
  if (det === null && byDet.size) det = Array.isArray(ctx.layers) && ctx.layers.length && byDet.has(ctx.layers[0].det) ? ctx.layers[0].det : Math.min(...byDet.keys());
  if (det === null) return everything('No exposures are loaded for this target');
  out.det = det;
  const layers = byDet.get(det);
  const frames = Array.isArray(ctx.frames) ? ctx.frames.filter(Boolean) : [];
  const gaiaEpoch = ctx.gaia && isNum(ctx.gaia.epoch) ? ctx.gaia.epoch : isNum(ctx.gaiaEpoch) ? ctx.gaiaEpoch : GAIA_EPOCH;

  progress('stack');
  let stacks = ctx.stacks;
  try {
    if (!stacks) stacks = buildPassStacks(layers, { lib: ctx.lib });
  } catch (err) {
    return everything(`Could not stack the passes: ${err && err.message}`);
  }
  out.passes = stacks.map((s) => ({ index: s.index, label: s.label, mjd: s.mjd, date: L.mjdToIso(s.mjd), nExposures: s.nExposures }));
  done++;
  await tick();

  let catalogue = null;
  try {
    catalogue = resolveCatalogue(ctx, L, stacks, gaiaEpoch);
  } catch {
    catalogue = null;
  }
  out.catalogue = catalogue;
  // A known target is given at its catalogue epoch; carry it to the middle of the data so that
  // the reported position and the fallback search start are where it is now.
  const dates = stacks.map((s) => s.mjd).filter(isNum);
  const refMjd = dates.length ? median(dates) : NaN;
  let here = { ra: t.ra, dec: t.dec, mjd: isNum(t.mjd) ? t.mjd : undefined };
  if (isNum(t.pmra) && isNum(t.pmdec) && isNum(t.epoch) && isNum(refMjd)) {
    try {
      const pos = L.propagate(t, refMjd);
      if (isNum(pos.ra) && isNum(pos.dec)) here = { ra: pos.ra, dec: pos.dec, mjd: refMjd };
    } catch {
      // keep the catalogue position
    }
  }
  out.target.ra = here.ra;
  out.target.dec = here.dec;
  const env = {
    L, grid: ctx.grid, det, layers, stacks, frames, catalogue, target: { ...t, ...here }, tick, signal,
    floorArcsec: isNum(ctx.floorArcsec) && ctx.floorArcsec >= 0 ? ctx.floorArcsec : DEFAULT_FLOOR_ARCSEC,
    photFloor: isNum(ctx.photFloor) && ctx.photFloor >= 0 ? ctx.photFloor : DEFAULT_PHOT_FLOOR,
    stars: starsOf(ctx.gaia), gaiaEpoch,
  };
  const cancelled = () => {
    if (signal && signal.aborted) { out.cancelled = true; return true; }
    return false;
  };
  const run = async (name, fn) => {
    if (!wanted.includes(name) || cancelled()) return;
    progress(name);
    try {
      out[name] = await fn();
    } catch (err) {
      out[name] = fail(`${name} failed: ${err && err.message ? err.message : err}`);
    }
    done++;
    await tick();
  };

  await run('motion', () => measureMotion(env));
  const tracker = makeTracker(env, out.motion);

  // Native aperture photometry of every loaded detector, following the target.
  const pointsByDet = new Map();
  let photometryError = '';
  if ((wanted.includes('variability') || wanted.includes('spectrum') || wanted.includes('quality')) && !cancelled()) {
    if (frames.length && typeof L.extractSpectrum === 'function') {
      for (const [d, list] of [...framesByDetOf(frames).entries()].sort((a, b) => a[0] - b[0])) {
        try {
          const pts = L.extractSpectrum(list, here.ra, here.dec, { track: tracker });
          if (pts && pts.length) pointsByDet.set(d, pts);
        } catch (err) {
          photometryError = `Photometry failed on detector ${d}: ${err && err.message}`;
        }
        await tick();
      }
    }
  }

  await run('variability', () => {
    if (pointsByDet.size && typeof L.lightCurve === 'function') {
      const v = summariseVariability(variabilityFromPhotometry(env, pointsByDet, tracker), 'native aperture photometry against a smooth spectrum', env.photFloor);
      if (v.ok) return v;
    }
    const stacksByDet = new Map();
    for (const [d, list] of byDet) stacksByDet.set(d, d === det ? stacks : buildPassStacks(list, { lib: ctx.lib }));
    const v = summariseVariability(variabilityFromStacks(env, tracker, stacksByDet), 'aperture sums on the per-pass stacks');
    if (!v.ok && photometryError) v.reason = `${photometryError}; ${v.reason}`;
    return v;
  });
  await run('spectrum', () => {
    if (!pointsByDet.size) return fail(photometryError || (frames.length ? 'The target is off every native frame' : 'No native frames are available for photometry'));
    return summariseSpectrum(pointsByDet);
  });
  await run('quality', () => measureQuality(env, tracker, pointsByDet));
  await run('residuals', () => measureResiduals(env));
  cancelled();
  progress('done');
  return out;
}

/**
 * The field-star tests and the target, together: what the "Measure this field" button runs.
 * Same ctx as measureTarget. The field stars are measured first; the scatter of their offsets
 * from Gaia becomes the error floor of the target's positions, so the target's error bars rest
 * on what the centroids in this very field are seen to do.
 *
 * Returns the measureTarget result with an extra `field`:
 *   { ok, reason?, det, nCatalogue, nSelected, nMeasured, rejected, floorArcsec, alignment, nullTest }
 * (alignment and nullTest as returned by fieldstars.js, with their plot points).
 */
export async function measureField(ctx = {}) {
  const tick = typeof ctx.tick === 'function' ? ctx.tick : defaultTick;
  const byDet = layersByDetOf(ctx);
  let det = isNum(ctx.det) && byDet.has(ctx.det) ? ctx.det : null;
  if (det === null && byDet.size) det = Array.isArray(ctx.layers) && ctx.layers.length && byDet.has(ctx.layers[0].det) ? ctx.layers[0].det : Math.min(...byDet.keys());
  let field = { ...fail('No exposures are loaded for this target'), alignment: alignment(null), nullTest: nullTest(null) };
  let stacks = ctx.stacks || null;
  let floorArcsec = ctx.floorArcsec;
  if (det !== null && ctx.grid) {
    try {
      if (typeof ctx.onProgress === 'function') ctx.onProgress({ step: 'field stars', done: 0, total: 1 });
    } catch {
      // ignore
    }
    try {
      if (!stacks) stacks = buildPassStacks(byDet.get(det), { lib: ctx.lib });
      await tick();
      const stats = measureFieldStars({ grid: ctx.grid, stacks, stars: ctx.gaia, epoch: ctx.gaiaEpoch }, { lib: ctx.lib, ...(ctx.fieldOptions || {}) });
      const al = alignment(stats);
      const nt = nullTest(stats);
      field = {
        ok: stats.ok, reason: stats.reason, det, nCatalogue: stats.nCatalogue, nSelected: stats.nSelected,
        nMeasured: stats.nMeasured, rejected: stats.rejected, floorArcsec: stats.floorArcsec, alignment: al, nullTest: nt,
      };
      if (!isNum(floorArcsec) && al.ok && isNum(al.sigma)) floorArcsec = Math.max(al.sigma, 0.05);
    } catch (err) {
      field = { ...fail(`Field-star test failed: ${err && err.message}`), alignment: alignment(null), nullTest: nullTest(null) };
    }
    await tick();
  }
  const m = await measureTarget({ ...ctx, det: det === null ? ctx.det : det, stacks: stacks || undefined, floorArcsec });
  m.field = field;
  return m;
}
