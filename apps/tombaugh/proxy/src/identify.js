// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

// "What is this?": catalogued objects around a clicked position, from SIMBAD's TAP service.
// Web-standard APIs only (fetch, AbortController, URLSearchParams); imports unchanged in Node,
// Deno and browsers. The handler route GET /identify?ra&dec&radius calls identifyCone().
//
//   identifyCone(ra, dec, radiusDeg, { fetchImpl, timeoutMs = 8000 })
//     -> Promise<{ objects: IdentifiedObject[], source: 'simbad' }>      sorted by separation
//   IdentifiedObject = { name, type, typeLabel, ra, dec, sepArcsec, pmra, pmdec, parallax,
//                        spType, vmag, kmag, ids, url }
//     name       display name (SIMBAD main_id without its "NAME " prefix)
//     type       SIMBAD object-type code ('PM*', 'BD*', 'G', ...), '' when SIMBAD has none
//     typeLabel  the same in plain words ('high proper-motion star')
//     ra, dec    degrees, ICRS, as SIMBAD lists them (epoch J2000 for moving stars)
//     pmra       mu_alpha* (includes cos dec) and pmdec, mas/yr; parallax in mas
//     ids        other designations (may be empty); url = the object's SIMBAD page
//   Missing values are null. Failures reject with UpstreamError (name, message, status, retryable).

import { UpstreamError } from './irsa.js';

export const SIMBAD_TAP_SYNC = 'https://simbad.cds.unistra.fr/simbad/sim-tap/sync';
// The CfA mirror of SIMBAD. Used when Strasbourg is unreachable (it was, for hours, on the
// night this was written: HTTP 404 "Page unavailable" from every CDS service).
export const SIMBAD_TAP_MIRROR = 'https://simbad.harvard.edu/simbad/sim-tap/sync';
export const SIMBAD_PAGE = 'https://simbad.cds.unistra.fr/simbad/sim-id';
export const IDENTIFY_MIN_RADIUS = 0.001;
export const IDENTIFY_MAX_RADIUS = 0.1;
/** 12 arcsec: two SPHEREx pixels, the reach of one click. */
export const IDENTIFY_DEFAULT_RADIUS = 12 / 3600;
export const IDENTIFY_MAX_OBJECTS = 20;
const MAX_ANSWER_CHARS = 2 * 1024 * 1024;

/**
 * SIMBAD object-type codes in plain words. Both the current codes (2022 onwards) and the older
 * ones still found in cached answers and papers are listed. Unknown codes fall back to a
 * generic label through otypeLabel(); this table only has to cover what people actually meet.
 */
export const OTYPE_LABELS = Object.freeze({
  // stars
  '*': 'star',
  'PM*': 'high proper-motion star',
  'HV*': 'high-velocity star',
  'MS*': 'main-sequence star',
  'Ma*': 'massive star',
  'Pe*': 'chemically peculiar star',
  'Be*': 'Be star',
  'BS*': 'blue straggler',
  'RG*': 'red giant',
  'HB*': 'horizontal-branch star',
  'RC*': 'red clump star',
  'AB*': 'asymptotic giant branch (AGB) star',
  'pA*': 'post-AGB star',
  'C*': 'carbon star',
  'S*': 'S-type star',
  'OH*': 'OH/IR star',
  'sg*': 'supergiant',
  's*r': 'red supergiant',
  's*y': 'yellow supergiant',
  's*b': 'blue supergiant',
  'WR*': 'Wolf-Rayet star',
  'WD*': 'white dwarf',
  'WD?': 'white dwarf candidate',
  'N*': 'neutron star',
  'Psr': 'pulsar',
  'HS*': 'hot subdwarf',
  'LM*': 'low-mass star',
  'LM?': 'low-mass star candidate',
  'BD*': 'brown dwarf',
  'BD?': 'brown dwarf candidate',
  'BrownD*': 'brown dwarf',
  'Pl': 'planet',
  'Pl?': 'planet candidate',
  'Em*': 'emission-line star',
  'Ae*': 'Herbig Ae/Be star',
  // young objects
  'Y*O': 'young stellar object',
  'Y*?': 'young stellar object candidate',
  'Or*': 'Orion-type variable (young star)',
  'TT*': 'T Tauri star',
  'TT?': 'T Tauri star candidate',
  'pr*': 'pre-main-sequence star',
  'HH': 'Herbig-Haro object',
  // variables
  'V*': 'variable star',
  'V*?': 'variable star candidate',
  'Ir*': 'irregular variable',
  'Er*': 'eruptive variable',
  'Ro*': 'rotating variable',
  'RS*': 'RS CVn variable',
  'BY*': 'BY Draconis variable',
  'Pu*': 'pulsating variable',
  'LP*': 'long-period variable',
  'LP?': 'long-period variable candidate',
  'Mi*': 'Mira variable',
  'Mi?': 'Mira variable candidate',
  'sr*': 'semi-regular variable',
  'RR*': 'RR Lyrae variable',
  'RR?': 'RR Lyrae candidate',
  'Ce*': 'Cepheid variable',
  'Ce?': 'Cepheid candidate',
  'cC*': 'classical Cepheid',
  'WV*': 'W Virginis variable',
  'RV*': 'RV Tauri variable',
  'dS*': 'delta Scuti variable',
  'gD*': 'gamma Doradus variable',
  'bC*': 'beta Cephei variable',
  'Fl*': 'flare star',
  'El*': 'ellipsoidal variable',
  'CV*': 'cataclysmic variable',
  'No*': 'nova',
  'SN*': 'supernova',
  'SN?': 'supernova candidate',
  'Sy*': 'symbiotic star',
  // binaries and multiples
  '**': 'double or multiple star',
  'SB*': 'spectroscopic binary',
  'EB*': 'eclipsing binary',
  'Al*': 'eclipsing binary (Algol type)',
  'bL*': 'eclipsing binary (beta Lyrae type)',
  'WU*': 'eclipsing binary (W UMa type)',
  'XB*': 'X-ray binary',
  'LXB': 'low-mass X-ray binary',
  'HXB': 'high-mass X-ray binary',
  // clusters and associations
  'Cl*': 'star cluster',
  'GlC': 'globular cluster',
  'OpC': 'open cluster',
  'As*': 'stellar association',
  'St*': 'stellar stream',
  'MGr': 'moving group',
  // interstellar matter
  'ISM': 'interstellar matter',
  'Cld': 'interstellar cloud',
  'MoC': 'molecular cloud',
  'DNe': 'dark nebula',
  'RNe': 'reflection nebula',
  'HII': 'H II region (ionised gas)',
  'PN': 'planetary nebula',
  'PN?': 'planetary nebula candidate',
  'SNR': 'supernova remnant',
  'SFR': 'star-forming region',
  'GNe': 'nebula',
  'glb': 'globule',
  'cor': 'dense core',
  'bub': 'bubble',
  'sh': 'interstellar shell',
  'HVC': 'high-velocity cloud',
  'CGb': 'cometary globule',
  'of?': 'outflow candidate',
  'out': 'outflow',
  // galaxies
  'G': 'galaxy',
  'G?': 'galaxy candidate',
  'LSB': 'low surface brightness galaxy',
  'bCG': 'blue compact galaxy',
  'SBG': 'starburst galaxy',
  'H2G': 'H II galaxy',
  'EmG': 'emission-line galaxy',
  'AGN': 'active galactic nucleus',
  'AG?': 'active galactic nucleus candidate',
  'SyG': 'Seyfert galaxy',
  'Sy1': 'Seyfert 1 galaxy',
  'Sy2': 'Seyfert 2 galaxy',
  'LIN': 'LINER galaxy',
  'rG': 'radio galaxy',
  'QSO': 'quasar',
  'Q?': 'quasar candidate',
  'Bla': 'blazar',
  'BLL': 'BL Lac object',
  'GiG': 'galaxy in a group',
  'GiC': 'galaxy in a cluster',
  'GiP': 'galaxy in a pair',
  'BiC': 'brightest cluster galaxy',
  'IG': 'interacting galaxies',
  'PaG': 'pair of galaxies',
  'GrG': 'group of galaxies',
  'CGG': 'compact group of galaxies',
  'ClG': 'cluster of galaxies',
  'SCG': 'supercluster of galaxies',
  'PoG': 'part of a galaxy',
  'vid': 'cosmic void',
  // sources known only by wavelength
  'X': 'X-ray source',
  'ULX': 'ultra-luminous X-ray source',
  'gam': 'gamma-ray source',
  'gB': 'gamma-ray burst',
  'UV': 'ultraviolet source',
  'Opt': 'optical source',
  'NIR': 'near-infrared source',
  'MIR': 'mid-infrared source',
  'FIR': 'far-infrared source',
  'IR': 'infrared source',
  'smm': 'sub-millimetre source',
  'mm': 'millimetre source',
  'cm': 'centimetre radio source',
  'Rad': 'radio source',
  'Mas': 'maser',
  'HI': 'neutral hydrogen (21 cm) source',
  'mR': 'metric radio source',
  'grv': 'gravitational-wave event',
  'Lev': 'microlensing event',
  'LeI': 'gravitationally lensed image',
  'LeG': 'gravitationally lensed galaxy',
  'LeQ': 'gravitationally lensed quasar',
  'gLe': 'gravitational lens',
  // the rest
  'err': 'catalogue entry now thought to be an error',
  'PoC': 'part of a cloud',
  'reg': 'region of the sky',
  'mul': 'blend of several sources',
  'Unknown': 'object of unknown nature',
  '?': 'object of unknown nature',
});

/** Plain words for a SIMBAD object-type code. Never throws; unknown codes say so. */
export function otypeLabel(code) {
  const c = String(code ?? '').trim();
  if (c === '') return 'catalogued object, type not given';
  if (Object.prototype.hasOwnProperty.call(OTYPE_LABELS, c)) return OTYPE_LABELS[c];
  // "XX?" is SIMBAD's way of writing "candidate XX".
  if (c.length > 1 && c.endsWith('?')) {
    const base = c.slice(0, -1);
    for (const key of [`${base}*`, base]) {
      if (Object.prototype.hasOwnProperty.call(OTYPE_LABELS, key)) return `${OTYPE_LABELS[key]} candidate`;
    }
  }
  if (c.endsWith('*')) return `star (SIMBAD type ${c})`;
  return `catalogued object (SIMBAD type ${c})`;
}

/** The SIMBAD page of an object, from its main identifier exactly as SIMBAD wrote it. */
export function simbadUrl(mainId) {
  return `${SIMBAD_PAGE}?Ident=${encodeURIComponent(String(mainId ?? '').trim())}`;
}

function fixed(value, digits) {
  let text = Number(value).toFixed(digits);
  if (text.includes('.')) text = text.replace(/0+$/, '').replace(/\.$/, '');
  return text === '-0' ? '0' : text;
}

function inputError(message) {
  return new UpstreamError(message, { kind: 'input', status: 400, retryable: false });
}

/** Radius in degrees, clamped to [0.001, 0.1]; anything unusable becomes 12 arcsec. */
export function clampRadius(radiusDeg) {
  const r = typeof radiusDeg === 'string' && radiusDeg.trim() !== '' ? Number(radiusDeg) : radiusDeg;
  if (typeof r !== 'number' || !Number.isFinite(r) || r <= 0) return IDENTIFY_DEFAULT_RADIUS;
  return Math.min(IDENTIFY_MAX_RADIUS, Math.max(IDENTIFY_MIN_RADIUS, r));
}

function checkPosition(ra, dec) {
  if (typeof ra !== 'number' || typeof dec !== 'number' || !Number.isFinite(ra) || !Number.isFinite(dec)) {
    throw inputError('ra and dec must be numbers in degrees');
  }
  if (ra < 0 || ra > 360 || dec < -90 || dec > 90) {
    throw inputError('ra must be within 0..360 and dec within -90..90 degrees');
  }
}

/**
 * The ADQL sent to SIMBAD. Only numbers formatted here ever reach the query text, so there is
 * nothing to inject. `extended` adds V and K magnitudes and the list of other names through two
 * outer joins; the plain form is the fallback if SIMBAD ever refuses the joins.
 */
export function buildIdentifyQuery(ra, dec, radiusDeg, { extended = false, top = IDENTIFY_MAX_OBJECTS } = {}) {
  checkPosition(ra, dec);
  const r = fixed(clampRadius(radiusDeg), 6);
  const a = fixed(ra, 7);
  const d = fixed(dec, 7);
  const n = Math.max(1, Math.min(200, Math.floor(top) || IDENTIFY_MAX_OBJECTS));
  if (!extended) {
    return (
      `SELECT TOP ${n} main_id, otype, ra, dec, pmra, pmdec, plx_value, sp_type, ` +
      `DISTANCE(POINT('ICRS', ra, dec), POINT('ICRS', ${a}, ${d})) AS dist ` +
      'FROM basic ' +
      `WHERE CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', ${a}, ${d}, ${r})) = 1 ` +
      'ORDER BY dist'
    );
  }
  return (
    `SELECT TOP ${n} basic.main_id, basic.otype, basic.ra, basic.dec, basic.pmra, basic.pmdec, ` +
    'basic.plx_value, basic.sp_type, ' +
    `DISTANCE(POINT('ICRS', basic.ra, basic.dec), POINT('ICRS', ${a}, ${d})) AS dist, ` +
    'allfluxes.V AS vmag, allfluxes.K AS kmag, ids.ids AS ids ' +
    'FROM basic LEFT JOIN allfluxes ON basic.oid = allfluxes.oidref LEFT JOIN ids ON basic.oid = ids.oidref ' +
    `WHERE CONTAINS(POINT('ICRS', basic.ra, basic.dec), CIRCLE('ICRS', ${a}, ${d}, ${r})) = 1 ` +
    'ORDER BY dist'
  );
}

/** Fast movers are looked for this far from the position (degrees): 6 arcmin. */
export const MOVER_SEARCH_RADIUS = 0.1;
/** ... and count as fast above this proper motion (mas/yr). */
export const MOVER_MIN_PM = 300;
/** A click this close to a fast mover's track (arcsec) is taken to be on it. */
export const MOVER_TOLERANCE_ARCSEC = 15;

/**
 * The ADQL for catalogued fast movers around a position. A star that moves several arcseconds
 * a year is nowhere near its catalogue coordinates by now (Barnard's Star: 4.6 arcmin since
 * 2000), so a small cone around where it is today finds nothing. This asks for every object
 * within `radiusDeg` whose proper motion exceeds `minPm`; matchMovers() then keeps the ones
 * whose track passes through the position.
 */
export function buildMoversQuery(ra, dec, { radiusDeg = MOVER_SEARCH_RADIUS, minPm = MOVER_MIN_PM, top = 60 } = {}) {
  checkPosition(ra, dec);
  const r = fixed(Math.max(0.01, Math.min(0.5, Number(radiusDeg) || MOVER_SEARCH_RADIUS)), 6);
  const a = fixed(ra, 7);
  const d = fixed(dec, 7);
  const n = Math.max(1, Math.min(200, Math.floor(top) || 60));
  const pm2 = Math.round(Math.max(1, Number(minPm) || MOVER_MIN_PM) ** 2);
  return (
    `SELECT TOP ${n} main_id, otype, ra, dec, pmra, pmdec, plx_value, sp_type, ` +
    `DISTANCE(POINT('ICRS', ra, dec), POINT('ICRS', ${a}, ${d})) AS dist ` +
    'FROM basic ' +
    `WHERE CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', ${a}, ${d}, ${r})) = 1 ` +
    `AND pmra * pmra + pmdec * pmdec > ${pm2} ` +
    'ORDER BY dist'
  );
}

/**
 * Of a list of catalogued fast movers, those whose track passes through (ra, dec).
 *
 * The catalogue position of a mover is where it was at some earlier date, and that date is
 * not always the same: most stars are listed at epoch 2000, but a brown dwarf found by WISE
 * may be listed where WISE saw it in 2010. So instead of carrying each object to one assumed
 * date, the whole path from the catalogue position along the proper motion is considered, for
 * up to (current year - 1990) years, and the object matches when the position lies within
 * `tolArcsec` of that path. Small-angle geometry: fine over the few arcminutes involved.
 *
 * Each match is returned with sepArcsec = its distance from the path, and
 *   mover: { catalogueSepArcsec, pm (mas/yr), years (of motion from the catalogue position to
 *            the point of the path nearest the position), epoch (current year - years) }.
 */
export function matchMovers(objects, ra, dec, { year = new Date().getUTCFullYear() + 0.5, tolArcsec = MOVER_TOLERANCE_ARCSEC } = {}) {
  const out = [];
  const maxYears = Math.max(1, year - 1990);
  const cosd = Math.cos((dec * Math.PI) / 180);
  for (const o of objects || []) {
    if (!o || !Number.isFinite(o.pmra) || !Number.isFinite(o.pmdec) || !Number.isFinite(o.ra) || !Number.isFinite(o.dec)) continue;
    const pm = Math.hypot(o.pmra, o.pmdec);
    if (!(pm >= 1)) continue;
    let dRa = ra - o.ra;
    if (dRa > 180) dRa -= 360;
    if (dRa < -180) dRa += 360;
    const dE = dRa * cosd * 3600;
    const dN = (dec - o.dec) * 3600;
    const ux = o.pmra / pm;
    const uy = o.pmdec / pm;
    const along = dE * ux + dN * uy;
    const perp = Math.abs(dE * uy - dN * ux);
    const length = (pm / 1000) * maxYears;
    const clamped = Math.max(0, Math.min(length, along));
    const dist = Math.hypot(perp, along - clamped);
    if (dist > tolArcsec) continue;
    const years = clamped / (pm / 1000);
    out.push({
      ...o,
      sepArcsec: Math.round(dist * 100) / 100,
      mover: {
        catalogueSepArcsec: Math.round(Math.hypot(dE, dN) * 10) / 10,
        pm: Math.round(pm * 10) / 10,
        years: Math.round(years * 10) / 10,
        epoch: Math.round((year - years) * 10) / 10,
      },
    });
  }
  out.sort((p, q) => p.sepArcsec - q.sepArcsec);
  return out;
}

/**
 * CSV to rows of strings. Handles quoted fields, doubled quotes, commas and line breaks inside
 * quotes, CRLF or LF, a byte-order mark, and skips blank lines. Never throws.
 */
export function parseCsv(text) {
  const rows = [];
  if (typeof text !== 'string' || text.length === 0) return rows;
  const n = text.length;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let row = [];
  let field = '';
  let inQuotes = false;
  let wasQuoted = false;
  const endField = () => {
    row.push(wasQuoted ? field : field.trim());
    field = '';
    wasQuoted = false;
  };
  const endRow = () => {
    const quotedLast = wasQuoted;
    endField();
    if (row.length > 1 || row[0] !== '' || quotedLast) rows.push(row);
    row = [];
  };
  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        field += c;
        i++;
      }
      continue;
    }
    if (c === '"' && field.trim() === '' && !wasQuoted) {
      field = '';
      inQuotes = true;
      wasQuoted = true;
    } else if (c === ',') {
      endField();
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      endRow();
    } else if (!wasQuoted) {
      field += c;
    }
    // Characters after a closing quote and before the next comma are dropped.
    i++;
  }
  if (inQuotes || wasQuoted || field !== '' || row.length > 0) endRow();
  return rows;
}

function numberOrNull(text) {
  if (text === undefined || text === null) return null;
  const t = String(text).trim();
  if (t === '' || /^(nan|null|none|-+|inf(inity)?|[+-]inf(inity)?)$/i.test(t)) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

function textOrNull(text) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  return t === '' || /^(null|none|nan)$/i.test(t) ? null : t;
}

/** Great-circle separation in arcseconds (haversine; exact at the small angles used here). */
export function separationArcsec(ra1, dec1, ra2, dec2) {
  const d2r = Math.PI / 180;
  const s1 = Math.sin(((dec2 - dec1) * d2r) / 2);
  const s2 = Math.sin(((ra2 - ra1) * d2r) / 2);
  const a = s1 * s1 + Math.cos(dec1 * d2r) * Math.cos(dec2 * d2r) * s2 * s2;
  return ((2 * Math.asin(Math.min(1, Math.sqrt(a)))) / d2r) * 3600;
}

/** "NAME Barnard's star" -> "Barnard's star"; other SIMBAD prefixes ("V* RR Lyr") are kept. */
export function displayName(mainId) {
  const t = String(mainId ?? '').replace(/\s+/g, ' ').trim();
  return t.replace(/^NAME\s+/i, '') || t;
}

function splitIds(text, mainId) {
  const raw = textOrNull(text);
  if (!raw) return [];
  const seen = new Set([String(mainId).replace(/\s+/g, ' ').trim()]);
  const out = [];
  for (const part of raw.split('|')) {
    const id = part.replace(/\s+/g, ' ').trim();
    if (id === '' || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= 40) break;
  }
  return out;
}

function errorDocumentText(text) {
  const body = String(text || '');
  const info = /<INFO[^>]*name="QUERY_STATUS"[^>]*value="ERROR"[^>]*>([\s\S]*?)<\/INFO>/i.exec(body);
  const title = info || /<title[^>]*>([\s\S]*?)<\/title>/i.exec(body);
  const picked = title ? title[1] : body.replace(/<[^>]*>/g, ' ');
  return picked.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
}

/**
 * SIMBAD's CSV answer -> IdentifiedObject[] sorted by separation from (ra, dec).
 * Rows without a name or a position are dropped; duplicate names (a join can repeat a row) are
 * merged. Throws UpstreamError('parse') when the text is not the expected table.
 */
export function parseIdentifyCsv(text, ra, dec) {
  const body = typeof text === 'string' ? text : '';
  const head = body.slice(0, 400).trimStart();
  if (head.startsWith('<')) {
    const detail = errorDocumentText(body);
    throw new UpstreamError(`SIMBAD sent a document instead of a table${detail ? `: ${detail}` : ''}`, { kind: 'parse' });
  }
  const rows = parseCsv(body);
  if (rows.length === 0) throw new UpstreamError('SIMBAD sent an empty answer', { kind: 'parse' });
  const columns = rows[0].map((name) => name.trim().toLowerCase());
  const col = (name) => columns.indexOf(name);
  const iName = col('main_id');
  const iRa = col('ra');
  const iDec = col('dec');
  if (iName < 0 || iRa < 0 || iDec < 0) {
    throw new UpstreamError('SIMBAD answer has no main_id, ra and dec columns', { kind: 'parse' });
  }
  const at = (row, name) => {
    const i = col(name);
    return i < 0 ? undefined : row[i];
  };
  const byName = new Map();
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const mainId = textOrNull(row[iName]);
    const ora = numberOrNull(row[iRa]);
    const odec = numberOrNull(row[iDec]);
    if (!mainId || ora === null || odec === null || odec < -90 || odec > 90) continue;
    if (byName.has(mainId)) continue;
    const type = textOrNull(at(row, 'otype')) || '';
    let sep = separationArcsec(ra, dec, ora, odec);
    if (!Number.isFinite(sep)) {
      const dist = numberOrNull(at(row, 'dist'));
      sep = dist === null ? NaN : dist * 3600;
    }
    byName.set(mainId, {
      name: displayName(mainId),
      type,
      typeLabel: otypeLabel(type),
      ra: ora,
      dec: odec,
      sepArcsec: Number.isFinite(sep) ? Math.round(sep * 100) / 100 : null,
      pmra: numberOrNull(at(row, 'pmra')),
      pmdec: numberOrNull(at(row, 'pmdec')),
      parallax: numberOrNull(at(row, 'plx_value')),
      spType: textOrNull(at(row, 'sp_type')),
      vmag: numberOrNull(at(row, 'vmag')),
      kmag: numberOrNull(at(row, 'kmag')),
      ids: splitIds(at(row, 'ids'), mainId),
      url: simbadUrl(mainId),
    });
  }
  const objects = [...byName.values()];
  objects.sort((p, q) => (p.sepArcsec ?? Infinity) - (q.sepArcsec ?? Infinity) || (p.name < q.name ? -1 : p.name > q.name ? 1 : 0));
  return objects.slice(0, IDENTIFY_MAX_OBJECTS);
}

function tapBody(query) {
  const form = new URLSearchParams();
  form.set('REQUEST', 'doQuery');
  form.set('LANG', 'ADQL');
  form.set('FORMAT', 'csv');
  form.set('QUERY', query);
  return form.toString();
}

async function readText(response) {
  const text = await response.text();
  if (text.length > MAX_ANSWER_CHARS) throw new UpstreamError('SIMBAD answer is too large', { kind: 'parse', retryable: false });
  return text;
}

// When Strasbourg failed (rather than refused the query), go straight to the mirror for a while.
let cdsDownUntil = 0;
const CDS_BREAKER_MS = 10 * 60 * 1000;

/** True when the failure says "this server is down or missing", not "this query is wrong". */
function serverTrouble(err) {
  if (!(err instanceof UpstreamError)) return true;
  if (err.kind === 'timeout' || err.kind === 'network') return true;
  if (err.kind !== 'http') return false;
  const status = err.upstreamStatus;
  return status >= 500 || status === 404 || status === 403 || status === 408 || status === 429;
}

/** SIMBAD at Strasbourg, then its CfA mirror when Strasbourg is in trouble. */
async function simbadCsv(query, fetchImpl, timeoutMs) {
  if (Date.now() >= cdsDownUntil) {
    try {
      return await simbadCsvAt(SIMBAD_TAP_SYNC, query, fetchImpl, timeoutMs);
    } catch (err) {
      if (!serverTrouble(err)) throw err;
      cdsDownUntil = Date.now() + CDS_BREAKER_MS;
    }
  }
  try {
    return await simbadCsvAt(SIMBAD_TAP_MIRROR, query, fetchImpl, timeoutMs);
  } catch (err) {
    // The mirror failing too must not hide Strasbourg for ten minutes.
    if (serverTrouble(err)) cdsDownUntil = 0;
    throw err;
  }
}

/** For tests: forget that Strasbourg was down. */
export function resetSimbadBreaker() {
  cdsDownUntil = 0;
}

/** One POST to a SIMBAD TAP endpoint under one timeout that covers the headers and the body. */
async function simbadCsvAt(endpoint, query, fetchImpl, timeoutMs) {
  const ms = Math.max(1, Number.isFinite(timeoutMs) ? timeoutMs : 8000);
  const controller = new AbortController();
  let timer = null;
  let timedOut = false;
  // The race also covers a fetch implementation that ignores the abort signal.
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      try {
        controller.abort();
      } catch {
        // nothing to cancel
      }
      reject(new UpstreamError(`SIMBAD did not answer within ${Math.round(ms / 100) / 10} s`, { kind: 'timeout', status: 504 }));
    }, ms);
  });
  const work = (async () => {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'text/csv, text/plain, */*' },
      body: tapBody(query),
      signal: controller.signal,
    });
    if (!response || typeof response.status !== 'number') {
      throw new UpstreamError('SIMBAD request failed: no response', { kind: 'network' });
    }
    if (!response.ok) {
      let detail = '';
      try {
        detail = errorDocumentText(await readText(response));
      } catch {
        detail = '';
      }
      const status = response.status;
      throw new UpstreamError(`SIMBAD answered HTTP ${status}${detail ? `: ${detail}` : ''}`, {
        kind: 'http',
        status: 502,
        retryable: status >= 500 || status === 408 || status === 429,
        upstreamStatus: status,
      });
    }
    return readText(response);
  })();
  work.catch(() => {}); // a late rejection after the deadline must not go unhandled
  try {
    return await Promise.race([work, deadline]);
  } catch (err) {
    if (err instanceof UpstreamError) throw err;
    if (timedOut) {
      throw new UpstreamError(`SIMBAD did not answer within ${Math.round(ms / 100) / 10} s`, { kind: 'timeout', status: 504 });
    }
    throw new UpstreamError(`SIMBAD request failed: ${err && err.message ? err.message : String(err)}`, { kind: 'network' });
  } finally {
    clearTimeout(timer);
  }
}

/** True when SIMBAD refused the query itself (as opposed to being down or slow). */
function queryRefused(err) {
  if (!(err instanceof UpstreamError)) return false;
  if (err.kind === 'parse') return true;
  return err.kind === 'http' && err.upstreamStatus >= 400 && err.upstreamStatus < 500 && ![403, 404, 408, 429].includes(err.upstreamStatus);
}

/**
 * identifyCone(ra, dec, radiusDeg, { fetchImpl, timeoutMs = 8000 })
 *   -> Promise<{ objects: IdentifiedObject[], source: 'simbad' }>
 * Catalogued objects within radiusDeg (clamped to 0.001..0.1 deg, default 12 arcsec) of the
 * position, nearest first, at most 20. `timeoutMs` bounds each request to SIMBAD. The first
 * request also asks for magnitudes and other names; if SIMBAD refuses that query, the plain
 * one is sent once. Rejects with UpstreamError: status 400 (bad input, not retryable),
 * 502 (SIMBAD failed) or 504 (timeout); `retryable` says whether trying again can help.
 */
export async function identifyCone(ra, dec, radiusDeg, { fetchImpl = globalThis.fetch, timeoutMs = 8000, extended = true, movers = true, year = NaN } = {}) {
  checkPosition(ra, dec);
  if (typeof fetchImpl !== 'function') {
    throw new UpstreamError('No fetch implementation is available', { kind: 'network', retryable: false });
  }
  const radius = clampRadius(radiusDeg);
  // Asked at the same time as the cone, so the answer is not held up by it.
  const moversPromise = movers ? simbadCsv(buildMoversQuery(ra, dec), fetchImpl, timeoutMs).catch(() => null) : null;
  let text = null;
  let usedExtended = false;
  if (extended) {
    try {
      text = await simbadCsv(buildIdentifyQuery(ra, dec, radius, { extended: true }), fetchImpl, timeoutMs);
      parseIdentifyCsv(text, ra, dec); // a table we cannot read counts as a refusal
      usedExtended = true;
    } catch (err) {
      if (!queryRefused(err)) throw err;
      text = null;
    }
  }
  if (!usedExtended) text = await simbadCsv(buildIdentifyQuery(ra, dec, radius), fetchImpl, timeoutMs);
  // SIMBAD's CIRCLE is exact, but keep the promise of the radius on our side as well.
  const limit = radius * 3600 * 1.001 + 0.01;
  const objects = parseIdentifyCsv(text, ra, dec).filter((o) => o.sepArcsec === null || o.sepArcsec <= limit);
  // Fast movers whose catalogue position is arcminutes away but whose track passes through
  // here. Extra information: a failure of this second question never fails the first.
  const moversText = moversPromise ? await moversPromise : null;
  if (moversText) {
    try {
      const found = matchMovers(parseIdentifyCsv(moversText, ra, dec), ra, dec, Number.isFinite(year) ? { year } : {});
      const known = new Set(objects.map((o) => o.name));
      for (const m of found) {
        if (known.has(m.name)) {
          const same = objects.find((o) => o.name === m.name);
          if (same) same.mover = m.mover;
        } else {
          objects.push(m);
        }
      }
      objects.sort((p, q) => (p.sepArcsec ?? Infinity) - (q.sepArcsec ?? Infinity));
    } catch {
      // the plain cone answer stands
    }
  }
  return { objects: objects.slice(0, IDENTIFY_MAX_OBJECTS), source: 'simbad' };
}

const SYNTHETIC_KINDS = {
  mover: { type: 'PM*', spType: 'M4V', name: 'Synthetic high proper-motion star' },
  variable: { type: 'LP*', spType: 'M7e', name: 'Synthetic long-period variable' },
  star: { type: '*', spType: null, name: 'Synthetic field star' },
};

/**
 * The /identify answer for the synthetic backend, so the dev server works offline: the fake
 * sky's sources near the position, shaped like identifyCone()'s result. `sky` is what
 * proxy/fixtures/synth.js syntheticSky(ra, dec) returns. Sources the fake catalogue does not
 * know (inGaia === false, such as the methane dwarf) are left out on purpose, so the page's
 * "nothing catalogued" state can be seen. `mjd` picks the epoch of the positions (default: the
 * middle exposure of the fake survey, so a fast mover is found where the images show it).
 */
export function identifyFromSynthetic(sky, ra, dec, radiusDeg, { mjd } = {}) {
  checkPosition(ra, dec);
  const limit = clampRadius(radiusDeg) * 3600;
  const objects = [];
  let sources = [];
  let epoch = mjd;
  if (!Number.isFinite(epoch)) {
    const refs = sky && Array.isArray(sky.frameRefs) ? sky.frameRefs : [];
    const mid = refs.length ? refs[Math.floor(refs.length / 2)] : null;
    epoch = mid && Number.isFinite(mid.mjd) ? mid.mjd : 61000;
  }
  try {
    sources = sky && typeof sky.sourcesAt === 'function' ? sky.sourcesAt(epoch) || [] : [];
  } catch {
    sources = [];
  }
  const meta = new Map();
  for (const o of (sky && Array.isArray(sky.objects) ? sky.objects : [])) {
    if (o && o.id !== undefined) meta.set(String(o.id), o);
  }
  for (const src of sources) {
    if (!src || !Number.isFinite(src.ra) || !Number.isFinite(src.dec)) continue;
    const more = meta.get(String(src.id)) || {};
    if (src.inGaia === false || more.inGaia === false || src.catalog === false) continue;
    const kind = SYNTHETIC_KINDS[src.kind] || SYNTHETIC_KINDS.star;
    const sep = separationArcsec(ra, dec, src.ra, src.dec);
    if (!(sep <= limit)) continue;
    const mas = (v) => (Number.isFinite(v) ? Math.round(v * 1e6) / 1000 : null); // arcsec/yr -> mas/yr
    const pmE = mas(more.pmE);
    const pmN = mas(more.pmN);
    objects.push({
      name: kind === SYNTHETIC_KINDS.star ? `${kind.name} ${String(src.id ?? '')}`.trim() : kind.name,
      type: kind.type,
      typeLabel: otypeLabel(kind.type),
      ra: src.ra,
      dec: src.dec,
      sepArcsec: Math.round(sep * 100) / 100,
      pmra: pmE,
      pmdec: pmN,
      parallax: null,
      spType: kind.spType,
      vmag: null,
      kmag: null,
      ids: [],
      url: null, // invented objects have no SIMBAD page; the panel shows the name without a link
    });
  }
  objects.sort((p, q) => p.sepArcsec - q.sepArcsec);
  return { objects: objects.slice(0, IDENTIFY_MAX_OBJECTS), source: 'synthetic' };
}
