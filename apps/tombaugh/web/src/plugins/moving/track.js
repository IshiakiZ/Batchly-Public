// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

// Ephemeris handling for the "follow a moving body" mode. Pure functions, no DOM.
//
// An ephemeris is a table of where a body was on the sky at regular times (from JPL Horizons
// through the proxy, or computed locally for a hypothetical body). SPHEREx exposures happen at
// arbitrary times, so the table is interpolated; from it we also get how fast the body moves,
// which says whether it trails during one 113-second exposure, and a plain-language plan of
// which exposures contained it.
//
// Interpolation works on unit vectors, not on RA and Dec, so it has no trouble at RA 0/360 or
// near the poles. Between two samples it uses a cubic Hermite curve whose end slopes come from
// the neighbouring samples (Catmull-Rom); with 12-hour samples that follows the curvature of a
// comet's path or of a parallax loop to a small fraction of a SPHEREx pixel, where a straight
// chord would not.

import { splitPasses } from '../../core/frames.js';

/** SPHEREx pixel size in arcsec and the length of one exposure in seconds (contract values). */
export const PIXEL_ARCSEC = 6.15;
export const EXPOSURE_SECONDS = 113.58;
/** Exposures exist from April 2025 (MJD 60770). */
export const SURVEY_START_MJD = 60770;
/** A new visit starts when two exposures containing the body are more than this far apart. */
export const VISIT_GAP_DAYS = 20;
/** Smear, in pixels per exposure, from which trailing is worth telling the user about. */
export const TRAIL_WARN_PIXELS = 0.5;

const DEG = Math.PI / 180;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MJD_UNIX_EPOCH = 40587;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Median of the finite numbers in a list; NaN when there are none. */
export function medianOf(values) {
  const a = [];
  for (const v of values || []) if (isNum(v)) a.push(v);
  if (!a.length) return NaN;
  a.sort((p, q) => p - q);
  const k = a.length >> 1;
  return a.length & 1 ? a[k] : 0.5 * (a[k - 1] + a[k]);
}

/** MJD -> 'Aug 2025' (UTC). */
export function monthLabel(mjd) {
  if (!isNum(mjd)) return '';
  const d = new Date(Math.round((mjd - MJD_UNIX_EPOCH) * 86400000));
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** MJD -> '2025 Aug 12' (UTC). */
export function dayLabel(mjd) {
  if (!isNum(mjd)) return '';
  const d = new Date(Math.round((mjd - MJD_UNIX_EPOCH) * 86400000));
  return `${d.getUTCFullYear()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** 'Aug 2025' for one month, '2025 Aug 12 to Sep 3' style range text for captions. */
export function dateRangeLabel(mjdA, mjdB) {
  if (!isNum(mjdA) || !isNum(mjdB)) return dayLabel(isNum(mjdA) ? mjdA : mjdB);
  const a = dayLabel(mjdA);
  const b = dayLabel(mjdB);
  if (a === b) return a;
  const [ya, ma] = a.split(' ');
  const [yb, mb, db] = b.split(' ');
  if (ya === yb && ma === mb) return `${a} to ${db}`;
  if (ya === yb) return `${a} to ${mb} ${db}`;
  return `${a} to ${b}`;
}

/**
 * Build an ephemeris from whatever we were given:
 *   the proxy's answer { name, samples: [[mjd, ra, dec, deltaAU, mag], ...] },
 *   a bare array of such rows, or
 *   an array of objects { mjd, ra, dec, delta | deltaAU | distGeoAU, mag } (core/distance.js tracks).
 * Rows with a non-finite time or position are dropped, the rest sorted by time, duplicates in
 * time removed.
 *
 * Returns { n, mjd, ra, dec, delta, mag, ux, uy, uz (Float64Array each; delta and mag hold NaN
 * where unknown), mjdMin, mjdMax, name, source, center }.
 */
export function makeEphemeris(input) {
  const rows = Array.isArray(input) ? input : input && Array.isArray(input.samples) ? input.samples : [];
  const list = [];
  for (const r of rows) {
    if (!r) continue;
    let mjd;
    let ra;
    let dec;
    let delta;
    let mag;
    if (Array.isArray(r) || ArrayBuffer.isView(r)) {
      [mjd, ra, dec, delta, mag] = r;
    } else {
      mjd = r.mjd;
      ra = r.ra;
      dec = r.dec;
      delta = isNum(r.delta) ? r.delta : isNum(r.deltaAU) ? r.deltaAU : r.distGeoAU;
      mag = r.mag;
    }
    if (!isNum(mjd) || !isNum(ra) || !isNum(dec) || dec < -90 || dec > 90) continue;
    list.push([mjd, ((ra % 360) + 360) % 360, dec, isNum(delta) ? delta : NaN, isNum(mag) ? mag : NaN]);
  }
  list.sort((a, b) => a[0] - b[0]);
  const kept = [];
  for (const r of list) if (!kept.length || r[0] > kept[kept.length - 1][0]) kept.push(r);
  const n = kept.length;
  const eph = {
    n,
    mjd: new Float64Array(n),
    ra: new Float64Array(n),
    dec: new Float64Array(n),
    delta: new Float64Array(n),
    mag: new Float64Array(n),
    ux: new Float64Array(n),
    uy: new Float64Array(n),
    uz: new Float64Array(n),
    mjdMin: n ? kept[0][0] : NaN,
    mjdMax: n ? kept[n - 1][0] : NaN,
    name: input && !Array.isArray(input) && typeof input.name === 'string' ? input.name : '',
    source: input && !Array.isArray(input) && typeof input.source === 'string' ? input.source : '',
    center: input && !Array.isArray(input) && typeof input.center === 'string' ? input.center : '',
  };
  for (let i = 0; i < n; i++) {
    const [mjd, ra, dec, delta, mag] = kept[i];
    eph.mjd[i] = mjd;
    eph.ra[i] = ra;
    eph.dec[i] = dec;
    eph.delta[i] = delta;
    eph.mag[i] = mag;
    const cd = Math.cos(dec * DEG);
    eph.ux[i] = cd * Math.cos(ra * DEG);
    eph.uy[i] = cd * Math.sin(ra * DEG);
    eph.uz[i] = Math.sin(dec * DEG);
  }
  return eph;
}

/** Index i of the interval [mjd[i], mjd[i+1]] that contains t (clamped to the table). */
function findInterval(eph, t) {
  let lo = 0;
  let hi = eph.n - 1;
  if (t <= eph.mjd[0]) return 0;
  if (t >= eph.mjd[hi]) return Math.max(0, hi - 1);
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (eph.mjd[mid] <= t) lo = mid;
    else hi = mid;
  }
  return lo;
}

function lerpMaybe(a, b, s) {
  if (isNum(a) && isNum(b)) return a + (b - a) * s;
  return isNum(a) ? a : isNum(b) ? b : NaN;
}

/**
 * Where the body was at `mjd`: { ra, dec, delta, mag, inside }.
 *
 * Cubic Hermite interpolation of the unit vectors (see the top of this file), renormalised.
 * `inside` is false when mjd lies outside the table; the position is then that of the nearest
 * end (never extrapolated: a guess could be degrees off). delta (AU from the Earth) and mag
 * are interpolated linearly and are NaN where the table has none. An empty table gives NaN.
 */
export function positionAt(eph, mjd) {
  if (!eph || !(eph.n > 0) || !isNum(mjd)) return { ra: NaN, dec: NaN, delta: NaN, mag: NaN, inside: false };
  const n = eph.n;
  const inside = mjd >= eph.mjdMin && mjd <= eph.mjdMax;
  if (n === 1) return { ra: eph.ra[0], dec: eph.dec[0], delta: eph.delta[0], mag: eph.mag[0], inside };
  const t = Math.min(eph.mjdMax, Math.max(eph.mjdMin, mjd));
  const i = findInterval(eph, t);
  const j = i + 1;
  const h = eph.mjd[j] - eph.mjd[i];
  const s = h > 0 ? (t - eph.mjd[i]) / h : 0;

  // End slopes (per day) from the neighbours; one-sided at the ends of the table.
  const ia = i > 0 ? i - 1 : i;
  const jb = j < n - 1 ? j + 1 : j;
  const di = eph.mjd[j] - eph.mjd[ia];
  const dj = eph.mjd[jb] - eph.mjd[i];
  const s2 = s * s;
  const s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1;
  const h10 = (s3 - 2 * s2 + s) * h;
  const h01 = -2 * s3 + 3 * s2;
  const h11 = (s3 - s2) * h;
  const comp = (u) => {
    const mi = di > 0 ? (u[j] - u[ia]) / di : 0;
    const mj = dj > 0 ? (u[jb] - u[i]) / dj : 0;
    return h00 * u[i] + h10 * mi + h01 * u[j] + h11 * mj;
  };
  const x = comp(eph.ux);
  const y = comp(eph.uy);
  const z = comp(eph.uz);
  const r = Math.hypot(x, y, z);
  if (!(r > 0)) return { ra: eph.ra[i], dec: eph.dec[i], delta: eph.delta[i], mag: eph.mag[i], inside };
  let ra = Math.atan2(y, x) / DEG;
  if (ra < 0) ra += 360;
  return {
    ra,
    dec: Math.asin(Math.max(-1, Math.min(1, z / r))) / DEG,
    delta: lerpMaybe(eph.delta[i], eph.delta[j], s),
    mag: lerpMaybe(eph.mag[i], eph.mag[j], s),
    inside,
  };
}

/** Tangent-plane offset (east, north) in arcsec of (ra, dec) from (ra0, dec0); exact gnomonic. */
function offsetArcsec(ra, dec, ra0, dec0) {
  const d = dec * DEG;
  const d0 = dec0 * DEG;
  const da = (ra - ra0) * DEG;
  const cosc = Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(da);
  if (!(cosc > 0)) return [NaN, NaN];
  const xi = (Math.cos(d) * Math.sin(da)) / cosc;
  const eta = (Math.cos(d0) * Math.sin(d) - Math.sin(d0) * Math.cos(d) * Math.cos(da)) / cosc;
  return [(xi / DEG) * 3600, (eta / DEG) * 3600];
}

/**
 * Apparent motion at `mjd` from a central difference over `spanHours` (default 2 hours, clamped
 * to the table): { arcsecPerHour, paDeg, east, north }.
 * east and north are the rate components in arcsec per hour (east = increasing RA); paDeg is the
 * direction of motion as a position angle, degrees east of north, 0..360. NaN for an empty or
 * single-row table.
 */
export function apparentRate(eph, mjd, spanHours = 2) {
  const none = { arcsecPerHour: NaN, paDeg: NaN, east: NaN, north: NaN };
  if (!eph || !(eph.n > 1) || !isNum(mjd)) return none;
  const half = Math.max(1e-4, spanHours / 48);
  const t0 = Math.max(eph.mjdMin, Math.min(eph.mjdMax, mjd - half));
  const t1 = Math.max(eph.mjdMin, Math.min(eph.mjdMax, mjd + half));
  const hours = (t1 - t0) * 24;
  if (!(hours > 0)) return none;
  const a = positionAt(eph, t0);
  const b = positionAt(eph, t1);
  const [dE, dN] = offsetArcsec(b.ra, b.dec, a.ra, a.dec);
  if (!isNum(dE) || !isNum(dN)) return none;
  const east = dE / hours;
  const north = dN / hours;
  let pa = Math.atan2(east, north) / DEG;
  if (pa < 0) pa += 360;
  return { arcsecPerHour: Math.hypot(east, north), paDeg: pa, east, north };
}

/**
 * How far the body moves during one exposure: { arcsec, pixels, trails }.
 * `trails` is true from half a pixel: the body is then visibly elongated in single exposures
 * and aperture fluxes lose light.
 */
export function exposureSmear(arcsecPerHour, exptimeSec = EXPOSURE_SECONDS) {
  if (!isNum(arcsecPerHour)) return { arcsec: NaN, pixels: NaN, trails: false };
  const arcsec = (Math.abs(arcsecPerHour) * exptimeSec) / 3600;
  const pixels = arcsec / PIXEL_ARCSEC;
  return { arcsec, pixels, trails: pixels >= TRAIL_WARN_PIXELS };
}

/**
 * Split exposures (anything with a numeric .mjd) into visits: sorted by time, a new visit
 * wherever the gap exceeds `gapDays` (default 20). SPHEREx comes back to a body roughly every
 * six months, and each visit lasts days to a couple of weeks.
 */
export function splitVisits(items, gapDays = VISIT_GAP_DAYS) {
  return splitPasses(items || [], gapDays);
}

/**
 * Give every exposure reference the body's position at its own time.
 * Input frames are the proxy's /track rows { id, det, mjd, ra?, dec?, ... }. The position from
 * our ephemeris wins when the exposure time lies inside the table (the same cubic interpolation
 * everywhere); otherwise the proxy's own ra/dec are kept; a frame with neither is dropped.
 * Returns { frames: [{ ...frame, ra, dec, delta, mag }], dropped }, sorted by time.
 */
export function attachPositions(frames, eph) {
  const out = [];
  let dropped = 0;
  for (const f of frames || []) {
    if (!f || !isNum(f.mjd)) { dropped++; continue; }
    const p = positionAt(eph, f.mjd);
    if (p.inside && isNum(p.ra) && isNum(p.dec)) {
      out.push({ ...f, ra: p.ra, dec: p.dec, delta: p.delta, mag: p.mag });
    } else if (isNum(f.ra) && isNum(f.dec)) {
      out.push({ ...f, delta: NaN, mag: NaN });
    } else {
      dropped++;
    }
  }
  out.sort((a, b) => a.mjd - b.mjd);
  return { frames: out, dropped };
}

function countByDet(frames) {
  const perDet = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  for (const f of frames) if (f.det >= 1 && f.det <= 6) perDet[f.det]++;
  return perDet;
}

/**
 * Summary statistics of the exposures that contained the body.
 *
 * Returns {
 *   total, perDet: { 1: n, ..., 6: n }, mjdStart, mjdEnd,
 *   visits: [{ index, label ('Aug 2025'), mjdStart, mjdEnd, mjdMid, n, perDet, ra, dec (at mjdMid),
 *              delta, mag (medians), arcsecPerHour, paDeg, smearPixels }],
 *   medianDelta (AU), medianMag, arcsecPerHour (median over exposures), maxArcsecPerHour,
 *   smearPixels (median), maxSmearPixels, trails (any exposure smeared by half a pixel or more) }
 * Values that cannot be known (no magnitude, a single-row ephemeris) are NaN.
 */
export function summarizeTrack(eph, frames, { gapDays = VISIT_GAP_DAYS, exptimeSec = EXPOSURE_SECONDS } = {}) {
  const list = (frames || []).filter((f) => f && isNum(f.mjd)).slice().sort((a, b) => a.mjd - b.mjd);
  const rates = list.map((f) => apparentRate(eph, f.mjd).arcsecPerHour);
  const deltas = list.map((f) => (isNum(f.delta) ? f.delta : positionAt(eph, f.mjd).delta));
  const mags = list.map((f) => (isNum(f.mag) ? f.mag : positionAt(eph, f.mjd).mag));
  const rateOf = new Map(list.map((f, i) => [f, rates[i]]));
  const deltaOf = new Map(list.map((f, i) => [f, deltas[i]]));
  const magOf = new Map(list.map((f, i) => [f, mags[i]]));
  const visits = splitVisits(list, gapDays).map((items, index) => {
    const mjdStart = items[0].mjd;
    const mjdEnd = items[items.length - 1].mjd;
    const mjdMid = medianOf(items.map((f) => f.mjd));
    const pos = positionAt(eph, mjdMid);
    const midRate = apparentRate(eph, mjdMid);
    const rate = medianOf(items.map((f) => rateOf.get(f)));
    return {
      index,
      label: monthLabel(mjdMid),
      mjdStart,
      mjdEnd,
      mjdMid,
      n: items.length,
      perDet: countByDet(items),
      ra: isNum(pos.ra) ? pos.ra : items[0].ra,
      dec: isNum(pos.dec) ? pos.dec : items[0].dec,
      delta: medianOf(items.map((f) => deltaOf.get(f))),
      mag: medianOf(items.map((f) => magOf.get(f))),
      arcsecPerHour: rate,
      paDeg: midRate.paDeg,
      smearPixels: exposureSmear(rate, exptimeSec).pixels,
    };
  });
  const finiteRates = rates.filter(isNum);
  const rate = medianOf(finiteRates);
  const maxRate = finiteRates.length ? Math.max(...finiteRates) : NaN;
  const maxSmear = exposureSmear(maxRate, exptimeSec);
  return {
    total: list.length,
    perDet: countByDet(list),
    mjdStart: list.length ? list[0].mjd : NaN,
    mjdEnd: list.length ? list[list.length - 1].mjd : NaN,
    visits,
    medianDelta: medianOf(deltas),
    medianMag: medianOf(mags),
    arcsecPerHour: rate,
    maxArcsecPerHour: maxRate,
    smearPixels: exposureSmear(rate, exptimeSec).pixels,
    maxSmearPixels: maxSmear.pixels,
    trails: maxSmear.trails,
  };
}

function fmtRate(v) {
  if (!isNum(v)) return '';
  if (v >= 100) return v.toFixed(0);
  if (v >= 1) return v.toFixed(1);
  return v.toFixed(2);
}

function fmtSmear(v) {
  if (!isNum(v)) return '';
  if (v >= 10) return v.toFixed(0);
  if (v >= 1) return v.toFixed(1);
  if (v >= 0.01) return v.toFixed(2);
  return 'under 0.01';
}

/**
 * The plan in one or two sentences, shown before anything is downloaded, for example
 *   "Pluto was inside 212 exposures across 3 visits: Aug 2025, Feb 2026, Aug 2026. It moved
 *    3.1 arcsec per hour, 0.02 pixel during one exposure."
 * With no exposures: "No SPHEREx exposure contained Pluto."
 */
export function planSentence(name, summary) {
  const who = name || 'This body';
  if (!summary || !(summary.total > 0)) return `No SPHEREx exposure contained ${name || 'this body'}.`;
  const nv = summary.visits.length;
  const labels = summary.visits.map((v) => v.label);
  const shown = labels.length > 6 ? `${labels.slice(0, 5).join(', ')} and ${labels.length - 5} more` : labels.join(', ');
  let text = `${who} was inside ${summary.total} ${summary.total === 1 ? 'exposure' : 'exposures'} `
    + `${nv === 1 ? 'in 1 visit' : `across ${nv} visits`}: ${shown}.`;
  if (isNum(summary.arcsecPerHour)) {
    const px = fmtSmear(summary.smearPixels);
    text += ` It moved ${fmtRate(summary.arcsecPerHour)} arcsec per hour, ${px} ${summary.smearPixels >= 1.5 ? 'pixels' : 'pixel'} during one exposure.`;
    if (summary.trails) {
      text += summary.smearPixels >= TRAIL_WARN_PIXELS
        ? ' That is enough to trail: single exposures show a short streak, and aperture fluxes run low.'
        : ` At its fastest (${fmtRate(summary.maxArcsecPerHour)} arcsec per hour) it trailed by ${fmtSmear(summary.maxSmearPixels)} pixel in one exposure.`;
    }
  }
  return text;
}

/**
 * Rows for the proxy's POST /track: [[mjd, ra, dec], ...], rounded (1e-5 day is under a second,
 * 1e-6 deg is 0.004 arcsec) and thinned evenly to at most `max` rows.
 */
export function trackSamples(eph, { max = 3000 } = {}) {
  if (!eph || !(eph.n > 0)) return [];
  const step = Math.max(1, Math.ceil(eph.n / Math.max(2, max)));
  const out = [];
  const push = (i) => out.push([
    Math.round(eph.mjd[i] * 1e5) / 1e5,
    Math.round(eph.ra[i] * 1e6) / 1e6,
    Math.round(eph.dec[i] * 1e6) / 1e6,
  ]);
  for (let i = 0; i < eph.n; i += step) push(i);
  if ((eph.n - 1) % step !== 0) push(eph.n - 1);
  return out;
}

/**
 * The body's path over the survey for the small sky-track preview.
 *
 * Returns { points: [{ mjd, ra, dec, x, y }], ra0, dec0, xMin, xMax, yMin, yMax, cosDec } where
 * x, y are degrees on a simple local chart: y = Dec, x = (RA - ra0) cos(dec0) with RA unwrapped
 * along the path so that crossing 0/360 does not tear it. x grows with RA; the drawing code
 * puts larger x on the LEFT, as on the sky. At most `maxPoints` points, evenly thinned.
 */
export function skyPath(eph, { maxPoints = 240 } = {}) {
  const empty = { points: [], ra0: NaN, dec0: NaN, xMin: 0, xMax: 0, yMin: 0, yMax: 0, cosDec: 1 };
  if (!eph || !(eph.n > 0)) return empty;
  const step = Math.max(1, Math.ceil(eph.n / maxPoints));
  const idx = [];
  for (let i = 0; i < eph.n; i += step) idx.push(i);
  if (idx[idx.length - 1] !== eph.n - 1) idx.push(eph.n - 1);
  // unwrap RA
  const ras = [];
  let prev = eph.ra[idx[0]];
  let offset = 0;
  for (const i of idx) {
    const ra = eph.ra[i];
    if (ra - prev > 180) offset -= 360;
    else if (ra - prev < -180) offset += 360;
    prev = ra;
    ras.push(ra + offset);
  }
  const ra0 = 0.5 * (Math.min(...ras) + Math.max(...ras));
  const decs = idx.map((i) => eph.dec[i]);
  const dec0 = 0.5 * (Math.min(...decs) + Math.max(...decs));
  const cosDec = Math.max(0.05, Math.cos(dec0 * DEG));
  const points = idx.map((i, k) => ({ mjd: eph.mjd[i], ra: eph.ra[i], dec: eph.dec[i], x: (ras[k] - ra0) * cosDec, y: eph.dec[i] }));
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return { points, ra0, dec0, xMin: Math.min(...xs), xMax: Math.max(...xs), yMin: Math.min(...ys), yMax: Math.max(...ys), cosDec };
}

/** Chart coordinates (as in skyPath) of an arbitrary time on the path. */
export function pathPointAt(eph, path, mjd) {
  const p = positionAt(eph, mjd);
  if (!isNum(p.ra) || !path || !isNum(path.ra0)) return null;
  let dra = p.ra - (((path.ra0 % 360) + 360) % 360);
  if (dra > 180) dra -= 360;
  if (dra < -180) dra += 360;
  return { mjd, ra: p.ra, dec: p.dec, x: dra * path.cosDec, y: p.dec };
}
