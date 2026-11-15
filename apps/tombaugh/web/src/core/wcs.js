// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// World coordinate systems: FITS TAN-SIP for native SPHEREx frames, plus the common
// north-up "Grid" everything is resampled to, coordinate parsing and formatting.
//
// CONVENTIONS (read these before touching anything)
// -------------------------------------------------
// * All angles are degrees unless the name says otherwise. All maths is in doubles.
// * JS pixel coordinates are 0-based: x = column (FITS axis 1), y = row (FITS axis 2),
//   array index = y * nx + x, and the CENTRE of the first pixel is (0, 0).
//   FITS pixels are 1-based: fitsPixel = jsPixel + 1. `wcs.crpix` is the FITS (1-based) CRPIX.
// * TAN-SIP forward transform (pixel -> sky), exactly as in the SIP convention
//   (Shupe et al. 2005) and FITS WCS paper II:
//       u = x_fits - CRPIX1,  v = y_fits - CRPIX2            (x_fits = x + 1)
//       f = u + sum A_p_q u^p v^q,   g = v + sum B_p_q u^p v^q   (ALL terms, incl. order 0 and 1)
//       (xi, eta) = diag(CDELT) * PC * (f, g)                [degrees, "intermediate world coords"]
//       (ra, dec) = gnomonic deprojection of (xi, eta) about CRVAL, LONPOLE = 180,
//   so xi points to increasing RA (east) and eta to increasing Dec (north) at the tangent point.
// * Inverse (sky -> pixel): gnomonic projection, inverse linear matrix giving (U, V), then
//   u = U + sum AP_p_q U^p V^q, v = V + sum BP_p_q U^p V^q as a first guess, refined by Newton
//   iterations on the forward polynomial (the AP/BP in real headers are only approximations,
//   good to about 1e-3 pixel). Without AP/BP it is Newton from a first-order guess.
// * In SPHEREx cutouts CRPIX is the detector centre, hundreds of pixels outside the array, so
//   u and v are large and the SIP zeroth/first order terms are significant (about 1 pixel).
// * Grid = { ra0, dec0, n, scale }: n x n pixels, `scale` arcsec per pixel, tangent point
//   (ra0, dec0) at the centre. Grid pixel (x, y) centre:
//       xi_arcsec  = -(x - (n - 1) / 2) * scale     (east is +xi, so x DEcreases toward east)
//       eta_arcsec =  (y - (n - 1) / 2) * scale     (y increases toward north; row 0 = south)
//   The viewer flips y for display so north is up and east is left.

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const ARCSEC_PER_DEG = 3600;

/** Wrap an angle into [0, 360). Non-finite input is returned unchanged. */
export function normRa(ra) {
  let r = ra % 360;
  if (r < 0) r += 360;
  if (r >= 360) r = 0;
  return r;
}

/** Difference a - b wrapped into [-180, 180]. */
function wrapDelta(d) {
  if (d > 180) d -= 360 * Math.ceil((d - 180) / 360);
  else if (d < -180) d += 360 * Math.ceil((-d - 180) / 360);
  return d;
}

/**
 * Gnomonic (TAN) projection of (ra, dec) about the tangent point (ra0, dec0).
 * Returns standard coordinates in DEGREES: xi toward east (increasing RA), eta toward north.
 * Points 90 degrees or more from the tangent point have no projection: [NaN, NaN].
 */
export function tanProject(ra, dec, ra0, dec0) {
  const d0 = dec0 * D2R;
  const d = dec * D2R;
  const da = wrapDelta(ra - ra0) * D2R;
  const sd0 = Math.sin(d0);
  const cd0 = Math.cos(d0);
  const sd = Math.sin(d);
  const cd = Math.cos(d);
  const cosc = sd0 * sd + cd0 * cd * Math.cos(da);
  if (!(cosc > 1e-12)) return [NaN, NaN];
  const h = Math.sin(da / 2);
  const xi = (cd * Math.sin(da)) / cosc;
  // cos d0 sin d - sin d0 cos d cos da, rewritten to avoid cancellation for tiny offsets.
  const eta = (Math.sin((dec - dec0) * D2R) + 2 * sd0 * cd * h * h) / cosc;
  return [xi * R2D, eta * R2D];
}

/**
 * Inverse gnomonic projection: standard coordinates (degrees) -> [ra, dec] in degrees,
 * ra in [0, 360). Uses atan2 throughout, so it is well behaved at the poles.
 */
export function tanDeproject(xiDeg, etaDeg, ra0, dec0) {
  const xi = xiDeg * D2R;
  const eta = etaDeg * D2R;
  const d0 = dec0 * D2R;
  const sd0 = Math.sin(d0);
  const cd0 = Math.cos(d0);
  const den = cd0 - eta * sd0;
  const ra = ra0 + Math.atan2(xi, den) * R2D;
  const dec = Math.atan2(sd0 + eta * cd0, Math.hypot(xi, den)) * R2D;
  return [normRa(ra), dec];
}

/**
 * Angular separation in degrees (Vincenty form: accurate from micro-arcseconds to 180 deg).
 */
export function angSep(ra1, dec1, ra2, dec2) {
  const d1 = dec1 * D2R;
  const d2 = dec2 * D2R;
  const dl = wrapDelta(ra2 - ra1) * D2R;
  const sd1 = Math.sin(d1);
  const cd1 = Math.cos(d1);
  const sd2 = Math.sin(d2);
  const cd2 = Math.cos(d2);
  const cdl = Math.cos(dl);
  const h = Math.sin(dl / 2);
  const a = cd2 * Math.sin(dl);
  const b = Math.sin((dec2 - dec1) * D2R) + 2 * sd1 * cd2 * h * h;
  const c = sd1 * sd2 + cd1 * cd2 * cdl;
  return Math.atan2(Math.hypot(a, b), c) * R2D;
}

/**
 * Orthonormal basis of the tangent plane at (ra0, dec0) as a Float64Array(9):
 * [Ex, Ey, Ez, Nx, Ny, Nz, Cx, Cy, Cz] with E = unit vector toward east, N = toward north,
 * C = toward the tangent point. A point with standard coordinates (xi, eta) in RADIANS lies
 * along C + xi * E + eta * N, which lets tangent planes be mapped onto each other without
 * any per-point trigonometry (used by reproject.js).
 */
export function tangentBasis(ra0, dec0) {
  const a = ra0 * D2R;
  const d = dec0 * D2R;
  const sa = Math.sin(a);
  const ca = Math.cos(a);
  const sd = Math.sin(d);
  const cd = Math.cos(d);
  return Float64Array.of(-sa, ca, 0, -sd * ca, -sd * sa, cd, cd * ca, cd * sa, sd);
}

// ---------------------------------------------------------------------------------------------
// SIP polynomials
// ---------------------------------------------------------------------------------------------

/** Turn a { "p_q": coeff } map into flat typed arrays. Returns null when there are no terms. */
function compilePoly(map) {
  if (!map || typeof map !== 'object') return null;
  const ps = [];
  const qs = [];
  const cs = [];
  let order = 0;
  for (const key of Object.keys(map)) {
    const m = /(\d+)_(\d+)$/.exec(key);
    if (!m) continue;
    const c = Number(map[key]);
    if (!Number.isFinite(c) || c === 0) continue;
    const p = parseInt(m[1], 10);
    const q = parseInt(m[2], 10);
    ps.push(p);
    qs.push(q);
    cs.push(c);
    if (p > order) order = p;
    if (q > order) order = q;
  }
  if (cs.length === 0) return null;
  return { n: cs.length, p: Int32Array.from(ps), q: Int32Array.from(qs), c: Float64Array.from(cs), order };
}

/**
 * Build a TAN-SIP transform from the TBF1 `wcs` object
 * `{ crpix: [c1, c2] (FITS 1-based), crval: [ra, dec], pc: [[..],[..]], cdelt: [d1, d2], sip }`.
 * `sip` may be null; otherwise `{ a, b, ap, bp }` are maps keyed "p_q". A `cd` matrix, if present,
 * is used instead of diag(cdelt) * pc.
 *
 * Returned object (0-based JS pixels everywhere):
 *   pixToSky(x, y) -> [ra, dec]          skyToPix(ra, dec) -> [x, y]
 * plus extras that do not allocate, used by reproject.js:
 *   pixToPlane(x, y, out)   -> out = [xi_deg, eta_deg] in this frame's own tangent plane
 *   planeToPix(xi, eta, out) -> out = [x, y]
 *   crval, crpix, hasSip, pixelScale (arcsec per pixel, from the linear matrix), parity (+1/-1).
 */
export function makeWcs(wcs) {
  if (!wcs || !wcs.crpix || !wcs.crval || !(wcs.crpix.length >= 2) || !(wcs.crval.length >= 2)) {
    throw new TypeError('makeWcs: wcs needs crpix and crval');
  }
  const crpix1 = Number(wcs.crpix[0]);
  const crpix2 = Number(wcs.crpix[1]);
  const ra0 = Number(wcs.crval[0]);
  const dec0 = Number(wcs.crval[1]);

  // Linear matrix M = diag(CDELT) * PC, degrees per pixel.
  let m11;
  let m12;
  let m21;
  let m22;
  if (Array.isArray(wcs.cd)) {
    m11 = Number(wcs.cd[0][0]);
    m12 = Number(wcs.cd[0][1]);
    m21 = Number(wcs.cd[1][0]);
    m22 = Number(wcs.cd[1][1]);
  } else {
    const cdelt1 = wcs.cdelt ? Number(wcs.cdelt[0]) : 1;
    const cdelt2 = wcs.cdelt ? Number(wcs.cdelt[1]) : 1;
    const pc = wcs.pc || [[1, 0], [0, 1]];
    m11 = cdelt1 * Number(pc[0][0]);
    m12 = cdelt1 * Number(pc[0][1]);
    m21 = cdelt2 * Number(pc[1][0]);
    m22 = cdelt2 * Number(pc[1][1]);
  }
  const det = m11 * m22 - m12 * m21;
  const invertible = Number.isFinite(det) && det !== 0;
  const i11 = invertible ? m22 / det : NaN;
  const i12 = invertible ? -m12 / det : NaN;
  const i21 = invertible ? -m21 / det : NaN;
  const i22 = invertible ? m11 / det : NaN;

  const sip = wcs.sip || null;
  const A = sip ? compilePoly(sip.a) : null;
  const B = sip ? compilePoly(sip.b) : null;
  const AP = sip ? compilePoly(sip.ap) : null;
  const BP = sip ? compilePoly(sip.bp) : null;
  const hasSip = !!(A || B);
  const maxOrder = Math.max(A ? A.order : 0, B ? B.order : 0, AP ? AP.order : 0, BP ? BP.order : 0);
  // Scratch tables of powers, filled per call: pu[k] = u^k, dpu[k] = k u^(k-1) (same for v).
  // Everything in the hot paths below lives in locals and typed arrays so that the optimiser
  // keeps it unboxed.
  const pu = new Float64Array(maxOrder + 2);
  const pv = new Float64Array(maxOrder + 2);
  const dpu = new Float64Array(maxOrder + 2);
  const dpv = new Float64Array(maxOrder + 2);
  const EMPTY_I = new Int32Array(0);
  const EMPTY_F = new Float64Array(0);
  const aN = A ? A.n : 0;
  const aP = A ? A.p : EMPTY_I;
  const aQ = A ? A.q : EMPTY_I;
  const aC = A ? A.c : EMPTY_F;
  const bN = B ? B.n : 0;
  const bP = B ? B.p : EMPTY_I;
  const bQ = B ? B.q : EMPTY_I;
  const bC = B ? B.c : EMPTY_F;
  const apN = AP ? AP.n : 0;
  const apP = AP ? AP.p : EMPTY_I;
  const apQ = AP ? AP.q : EMPTY_I;
  const apC = AP ? AP.c : EMPTY_F;
  const bpN = BP ? BP.n : 0;
  const bpP = BP ? BP.p : EMPTY_I;
  const bpQ = BP ? BP.q : EMPTY_I;
  const bpC = BP ? BP.c : EMPTY_F;
  const hasInverse = apN > 0 || bpN > 0;

  // Newton stops once a step is below 1e-7 pixel. Convergence is quadratic (error after a step
  // ~ |second-order SIP coefficient| * step^2), so the remaining error is far below 1e-12 pixel.
  const NEWTON_TOL = 1e-7;
  const NEWTON_MAX = 12;

  function pixToPlane(x, y, out) {
    const u = x + 1 - crpix1;
    const v = y + 1 - crpix2;
    let f = u;
    let g = v;
    if (hasSip) {
      pu[0] = 1;
      pv[0] = 1;
      for (let k = 1; k <= maxOrder; k++) {
        pu[k] = pu[k - 1] * u;
        pv[k] = pv[k - 1] * v;
      }
      for (let i = 0; i < aN; i++) f += aC[i] * pu[aP[i]] * pv[aQ[i]];
      for (let i = 0; i < bN; i++) g += bC[i] * pu[bP[i]] * pv[bQ[i]];
    }
    out[0] = m11 * f + m12 * g;
    out[1] = m21 * f + m22 * g;
    return out;
  }

  function planeToPix(xi, eta, out) {
    // (U, V): pixel offsets from CRPIX that the linear part alone would give ("f, g" above).
    const U = i11 * xi + i12 * eta;
    const V = i21 * xi + i22 * eta;
    let u = U;
    let v = V;
    if (hasSip && U - U === 0 && V - V === 0) {
      // First guess from AP/BP, or to first order from A/B when there is no inverse polynomial.
      pu[0] = 1;
      pv[0] = 1;
      for (let k = 1; k <= maxOrder; k++) {
        pu[k] = pu[k - 1] * U;
        pv[k] = pv[k - 1] * V;
      }
      if (hasInverse) {
        for (let i = 0; i < apN; i++) u += apC[i] * pu[apP[i]] * pv[apQ[i]];
        for (let i = 0; i < bpN; i++) v += bpC[i] * pu[bpP[i]] * pv[bpQ[i]];
      } else {
        for (let i = 0; i < aN; i++) u -= aC[i] * pu[aP[i]] * pv[aQ[i]];
        for (let i = 0; i < bN; i++) v -= bC[i] * pu[bP[i]] * pv[bQ[i]];
      }
      // Newton on F(u, v) = (u + A(u, v) - U, v + B(u, v) - V).
      for (let it = 0; it < NEWTON_MAX; it++) {
        pu[0] = 1;
        pv[0] = 1;
        dpu[0] = 0;
        dpv[0] = 0;
        for (let k = 1; k <= maxOrder; k++) {
          dpu[k] = k * pu[k - 1];
          dpv[k] = k * pv[k - 1];
          pu[k] = pu[k - 1] * u;
          pv[k] = pv[k - 1] * v;
        }
        let F = u - U;
        let ja = 1;
        let jb = 0;
        for (let i = 0; i < aN; i++) {
          const p = aP[i];
          const q = aQ[i];
          const c = aC[i];
          F += c * pu[p] * pv[q];
          ja += c * dpu[p] * pv[q];
          jb += c * pu[p] * dpv[q];
        }
        let G = v - V;
        let jc = 0;
        let jd = 1;
        for (let i = 0; i < bN; i++) {
          const p = bP[i];
          const q = bQ[i];
          const c = bC[i];
          G += c * pu[p] * pv[q];
          jc += c * dpu[p] * pv[q];
          jd += c * pu[p] * dpv[q];
        }
        const jdet = ja * jd - jb * jc;
        if (!(Math.abs(jdet) > 1e-12)) break;
        const du = (jd * F - jb * G) / jdet;
        const dv = (ja * G - jc * F) / jdet;
        u -= du;
        v -= dv;
        if (!(Math.abs(du) > NEWTON_TOL || Math.abs(dv) > NEWTON_TOL)) break;
      }
    }
    out[0] = u + crpix1 - 1;
    out[1] = v + crpix2 - 1;
    return out;
  }

  const tmp = new Float64Array(2);

  function pixToSky(x, y) {
    pixToPlane(x, y, tmp);
    return tanDeproject(tmp[0], tmp[1], ra0, dec0);
  }

  function skyToPix(ra, dec) {
    const p = tanProject(ra, dec, ra0, dec0);
    planeToPix(p[0], p[1], tmp);
    return [tmp[0], tmp[1]];
  }

  return {
    pixToSky,
    skyToPix,
    pixToPlane,
    planeToPix,
    crval: [ra0, dec0],
    crpix: [crpix1, crpix2],
    hasSip,
    hasInverseSip: hasInverse,
    pixelScale: Math.sqrt(Math.abs(det)) * ARCSEC_PER_DEG,
    parity: det < 0 ? -1 : 1, // -1 is the usual sky parity (east left when north is up)
  };
}

// ---------------------------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------------------------

/**
 * Make the common north-up grid: at least `fovArcmin` across, `scaleArcsec` per pixel.
 * Returns { ra0, dec0, n, scale }.
 */
export function makeGrid(ra0, dec0, fovArcmin, scaleArcsec = 3.075) {
  const scale = scaleArcsec > 0 ? scaleArcsec : 3.075;
  const fov = fovArcmin > 0 ? fovArcmin : 4;
  const n = Math.max(1, Math.ceil((fov * 60) / scale - 1e-9));
  return { ra0: normRa(ra0), dec0: Math.max(-90, Math.min(90, dec0)), n, scale };
}

/** Sky position -> grid pixel (fractional, 0-based; integer values are pixel centres). */
export function gridSkyToPix(grid, ra, dec) {
  const p = tanProject(ra, dec, grid.ra0, grid.dec0);
  const c = (grid.n - 1) / 2;
  const k = ARCSEC_PER_DEG / grid.scale;
  return [c - p[0] * k, c + p[1] * k];
}

/** Grid pixel (fractional, 0-based) -> [ra, dec]. */
export function gridPixToSky(grid, x, y) {
  const c = (grid.n - 1) / 2;
  const k = grid.scale / ARCSEC_PER_DEG;
  return tanDeproject(-(x - c) * k, (y - c) * k, grid.ra0, grid.dec0);
}

// ---------------------------------------------------------------------------------------------
// Coordinate parsing and formatting
// ---------------------------------------------------------------------------------------------

const UNIT_CANON = {
  h: 'h', hr: 'h', hrs: 'h', hour: 'h', hours: 'h',
  d: 'd', deg: 'd', degs: 'd', degree: 'd', degrees: 'd', '°': 'd',
  m: 'm', min: 'm', mins: 'm', minute: 'm', minutes: 'm', "'": 'm',
  s: 's', sec: 's', secs: 's', second: 's', seconds: 's', '"': 's',
  ':': ':',
};
const NUM_RE = /^(\d+(?:\.\d*)?|\.\d+)/;
const SEP_RE = /^\s*(hours?|hrs?|h|degrees?|degs?|d|°|minutes?|mins?|m|'|seconds?|secs?|s|"|:)?\s*/i;

/**
 * Parse one angle. Returns { deg, count } or null. `count` is the number of numeric fields.
 * Sexagesimal with ':' or blanks means hours for RA and degrees for Dec.
 */
function parseAngle(text, isRa) {
  let s = text.trim();
  if (!s) return null;
  let sign = 1;
  if (s[0] === '+' || s[0] === '-') {
    if (s[0] === '-') sign = -1;
    s = s.slice(1).trim();
    if (!s) return null;
  }
  const nums = [];
  const ints = [];
  const seps = [];
  while (s.length) {
    const m = NUM_RE.exec(s);
    if (!m) return null;
    nums.push(parseFloat(m[1]));
    ints.push(m[1].indexOf('.') < 0);
    s = s.slice(m[0].length);
    const sm = SEP_RE.exec(s);
    if (sm[0].length === 0 && s.length) return null;
    seps.push(sm[1] ? UNIT_CANON[sm[1].toLowerCase()] : '');
    s = s.slice(sm[0].length);
    if (nums.length > 3) return null;
  }
  const n = nums.length;
  let hours = false;
  let value;
  if (n === 1) {
    if (seps[0] === 'h') hours = true;
    else if (seps[0] !== '' && seps[0] !== 'd') return null;
    value = nums[0];
  } else {
    if (seps[0] === 'h') hours = true;
    else if (seps[0] === ':' || seps[0] === '') hours = isRa;
    else if (seps[0] !== 'd') return null;
    if (n === 2) {
      if (seps[1] !== 'm' && seps[1] !== '') return null;
    } else {
      if (seps[1] !== 'm' && seps[1] !== ':' && seps[1] !== '') return null;
      if (seps[2] !== 's' && seps[2] !== '') return null;
    }
    for (let i = 0; i < n - 1; i++) if (!ints[i]) return null;
    if (nums[1] >= 60 || (n === 3 && nums[2] >= 60)) return null;
    value = nums[0] + nums[1] / 60 + (n === 3 ? nums[2] / 3600 : 0);
  }
  if (hours) {
    if (!isRa) return null;
    value *= 15;
  }
  if (!Number.isFinite(value)) return null;
  return { deg: sign * value, count: n };
}

function checkedPair(a, b) {
  if (!a || !b) return null;
  let ra = a.deg;
  const dec = b.deg;
  if (!(ra >= 0 && ra <= 360) || !(dec >= -90 && dec <= 90)) return null;
  if (ra === 360) ra = 0;
  return { ra: ra + 0, dec: dec + 0, balanced: a.count === b.count };
}

/**
 * Parse a coordinate pair typed by a person. Returns { ra, dec } in degrees or null.
 * Accepted: "269.45 4.69", "269.45, 4.69", "17h57m48.5s +04d41m36s", "17:57:48.5 +04:41:36",
 * "17 57 48.5 +04 41 36", "08h55m10.831s -7d14m42.53s", "J085510.83-071442.5", degree and
 * prime symbols, and "ra=... dec=..." labels. RA is read as hours when written with h, or as
 * sexagesimal with colons or blanks; a single decimal number is degrees. RA must lie in
 * [0, 360] and Dec in [-90, 90]; anything else returns null.
 */
export function parseCoord(text) {
  if (typeof text !== 'string') return null;
  let s = text
    .replace(/[−‒–—]/g, '-')
    .replace(/[′’ʹ]/g, "'")
    .replace(/[″”ʺ]/g, '"')
    .replace(/''/g, '"')
    .replace(/[º˚]/g, '°')
    .replace(/[αδ]/g, ' ')
    .replace(/\b(?:ra|decl?)\b\s*[=:]?/gi, ' ')
    .replace(/[()[\]]/g, ' ')
    .replace(/[\s ]+/g, ' ')
    .trim();
  if (!s || s.length > 80) return null;

  // Compact IAU style: J085510.83-071442.5
  const cm = /^J?(\d\d)(\d\d)(\d\d(?:\.\d+)?) ?([+-])(\d\d)(\d\d)(\d\d(?:\.\d+)?)$/i.exec(s);
  if (cm) {
    const res = checkedPair(
      parseAngle(`${cm[1]}h${cm[2]}m${cm[3]}s`, true),
      parseAngle(`${cm[4]}${cm[5]}d${cm[6]}m${cm[7]}s`, false),
    );
    if (res) return { ra: res.ra, dec: res.dec };
  }

  const cands = [];
  const parts = s.split(',');
  if (parts.length > 2) return null;
  if (parts.length === 2) {
    cands.push([parts[0], parts[1]]);
  } else {
    let idx = -1;
    for (let i = 1; i < s.length; i++) {
      if (s[i] === '+' || s[i] === '-') {
        idx = i;
        break;
      }
    }
    if (idx > 0) {
      cands.push([s.slice(0, idx), s.slice(idx)]);
    } else {
      for (let i = 1; i < s.length - 1; i++) {
        if (s[i] === ' ') cands.push([s.slice(0, i), s.slice(i + 1)]);
      }
    }
  }
  const valid = [];
  for (const [l, r] of cands) {
    const res = checkedPair(parseAngle(l, true), parseAngle(r, false));
    if (res) valid.push(res);
  }
  let pick = null;
  if (valid.length === 1) {
    pick = valid[0];
  } else if (valid.length > 1) {
    const balanced = valid.filter((v) => v.balanced);
    if (balanced.length === 1) pick = balanced[0];
  }
  return pick ? { ra: pick.ra, dec: pick.dec } : null;
}

function pad(v, width) {
  let s = String(v);
  while (s.length < width) s = `0${s}`;
  return s;
}

/**
 * Format a position. Returns
 *   hms: "17h57m48.50s"   (RA, 0.01 s of time)
 *   dms: "+04d41m36.0s"   (Dec, 0.1 arcsec)
 *   deg: "269.45208 +4.69333"
 * Both sexagesimal strings parse back with parseCoord(hms + ' ' + dms).
 */
export function formatCoord(ra, dec) {
  if (!Number.isFinite(ra) || !Number.isFinite(dec)) return { hms: '--', dms: '--', deg: '--' };
  const r = normRa(ra);
  const d = Math.max(-90, Math.min(90, dec));

  // RA in hundredths of a second of time; 24 h = 8 640 000 units.
  let t = Math.round((r / 15) * 360000);
  if (t >= 8640000) t -= 8640000;
  const hh = Math.floor(t / 360000);
  const mm = Math.floor((t - hh * 360000) / 6000);
  const ss = (t - hh * 360000 - mm * 6000) / 100;
  const hms = `${pad(hh, 2)}h${pad(mm, 2)}m${pad(ss.toFixed(2), 5)}s`;

  // Dec in tenths of an arcsecond.
  const a = Math.round(Math.abs(d) * 36000);
  const dd = Math.floor(a / 36000);
  const dm = Math.floor((a - dd * 36000) / 600);
  const ds = (a - dd * 36000 - dm * 600) / 10;
  const sign = d < 0 && a > 0 ? '-' : '+';
  const dms = `${sign}${pad(dd, 2)}d${pad(dm, 2)}m${pad(ds.toFixed(1), 4)}s`;

  let rs = r.toFixed(5);
  if (rs === '360.00000') rs = '0.00000';
  const dv = Number(d.toFixed(5));
  const deg = `${rs} ${dv < 0 ? '-' : '+'}${Math.abs(dv).toFixed(5)}`;
  return { hms, dms, deg };
}
