// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

// Gaia DR3 cone search with three interchangeable sources, tried in order:
// the ESA Gaia archive, VizieR at CDS, then IRSA. All speak TAP and are asked for CSV.
// Source ids are 19-digit integers, beyond what a JS number holds, so they stay strings.

import { UpstreamError, parseCsvTable, tapSyncCsv } from './irsa.js';

export const GAIA_EPOCH = 2016.0;
export const GAIA_MAX_RADIUS = 0.25;
export const GAIA_MAX_STARS = 500;
/** MJD of J2016.0 (JD 2457389.0), the reference epoch of Gaia DR3 positions. */
export const GAIA_EPOCH_MJD = 57388.5;

const noLog = () => {};

function fixed(value, digits) {
  let text = Number(value).toFixed(digits);
  if (text.includes('.')) text = text.replace(/0+$/, '').replace(/\.$/, '');
  return text === '-0' ? '0' : text;
}

function cone(ra, dec, radius) {
  return `CIRCLE('ICRS', ${fixed(ra, 7)}, ${fixed(dec, 7)}, ${fixed(radius, 6)})`;
}

/**
 * The services, in the order they are asked. `columns` maps our field names to the CSV column names of that service
 * (lower case). `timeoutMs` is the default per-service timeout.
 */
export const GAIA_PROVIDERS = [
  {
    name: 'esa',
    endpoint: 'https://gea.esac.esa.int/tap-server/tap/sync',
    timeoutMs: 12000,
    columns: { id: 'source_id', ra: 'ra', dec: 'dec', pmra: 'pmra', pmdec: 'pmdec', parallax: 'parallax', gmag: 'phot_g_mean_mag' },
    query: (ra, dec, radius, limit) =>
      `SELECT TOP ${limit} source_id, ra, dec, pmra, pmdec, parallax, phot_g_mean_mag ` +
      'FROM gaiadr3.gaia_source ' +
      `WHERE 1 = CONTAINS(POINT('ICRS', ra, dec), ${cone(ra, dec, radius)}) AND phot_g_mean_mag IS NOT NULL ` +
      'ORDER BY phot_g_mean_mag',
  },
  {
    // GAVO's "lite" copy of DR3 (Heidelberg). It answered in 2.5 s on a night when ESA, VizieR
    // and IRSA were all down.
    name: 'gavo',
    endpoint: 'https://dc.g-vo.org/tap/sync',
    timeoutMs: 15000,
    columns: { id: 'source_id', ra: 'ra', dec: 'dec', pmra: 'pmra', pmdec: 'pmdec', parallax: 'parallax', gmag: 'phot_g_mean_mag' },
    query: (ra, dec, radius, limit) =>
      `SELECT TOP ${limit} source_id, ra, dec, pmra, pmdec, parallax, phot_g_mean_mag ` +
      'FROM gaia.dr3lite ' +
      `WHERE 1 = CONTAINS(POINT('ICRS', ra, dec), ${cone(ra, dec, radius)}) AND phot_g_mean_mag IS NOT NULL ` +
      'ORDER BY phot_g_mean_mag',
  },
  {
    name: 'vizier',
    endpoint: 'https://tapvizier.cds.unistra.fr/TAPVizieR/tap/sync',
    timeoutMs: 12000,
    columns: { id: 'source', ra: 'ra_icrs', dec: 'de_icrs', pmra: 'pmra', pmdec: 'pmde', parallax: 'plx', gmag: 'gmag' },
    query: (ra, dec, radius, limit) =>
      `SELECT TOP ${limit} Source, RA_ICRS, DE_ICRS, pmRA, pmDE, Plx, Gmag ` +
      'FROM "I/355/gaiadr3" ' +
      `WHERE 1 = CONTAINS(POINT('ICRS', RA_ICRS, DE_ICRS), ${cone(ra, dec, radius)}) AND Gmag IS NOT NULL ` +
      'ORDER BY Gmag',
  },
  {
    name: 'irsa',
    endpoint: 'https://irsa.ipac.caltech.edu/TAP/sync',
    timeoutMs: 25000,
    columns: { id: 'source_id', ra: 'ra', dec: 'dec', pmra: 'pmra', pmdec: 'pmdec', parallax: 'parallax', gmag: 'phot_g_mean_mag' },
    query: (ra, dec, radius, limit) =>
      `SELECT TOP ${limit} source_id, ra, dec, pmra, pmdec, parallax, phot_g_mean_mag ` +
      'FROM gaia_dr3_source ' +
      `WHERE CONTAINS(POINT('ICRS', ra, dec), ${cone(ra, dec, radius)}) = 1 AND phot_g_mean_mag IS NOT NULL ` +
      'ORDER BY phot_g_mean_mag',
  },
];

function numberOrNull(text) {
  if (text === undefined || text === null) return null;
  const t = String(text).trim();
  if (t === '' || /^(nan|null|none|-+)$/i.test(t)) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

function idString(text) {
  // Never pass through Number(): 19 digits do not survive a float64.
  const t = String(text ?? '').trim().replace(/^"+|"+$/g, '');
  return /^\d{1,25}$/.test(t) ? t : null;
}

function byBrightness(a, b) {
  if (a.gmag === null && b.gmag === null) return 0;
  if (a.gmag === null) return 1;
  if (b.gmag === null) return -1;
  return a.gmag - b.gmag;
}

/**
 * Parses one service's CSV into stars (brightest first, at most `limit`). Rows without an id or
 * a position are dropped. Throws UpstreamError('parse') if the expected columns are absent.
 */
export function parseGaiaCsv(text, columns, limit = GAIA_MAX_STARS) {
  const trimmed = String(text || '').trimStart();
  if (trimmed.startsWith('<')) {
    throw new UpstreamError('Gaia service sent a document instead of a table', { kind: 'parse' });
  }
  const table = parseCsvTable(text);
  for (const field of ['id', 'ra', 'dec']) {
    if (!table.columns.includes(columns[field])) {
      throw new UpstreamError(`Gaia answer has no ${columns[field]} column`, { kind: 'parse' });
    }
  }
  const stars = [];
  for (const rec of table.records) {
    const id = idString(rec[columns.id]);
    const ra = numberOrNull(rec[columns.ra]);
    const dec = numberOrNull(rec[columns.dec]);
    if (id === null || ra === null || dec === null) continue;
    stars.push({
      id,
      ra,
      dec,
      pmra: numberOrNull(rec[columns.pmra]),
      pmdec: numberOrNull(rec[columns.pmdec]),
      parallax: numberOrNull(rec[columns.parallax]),
      gmag: numberOrNull(rec[columns.gmag]),
    });
  }
  stars.sort(byBrightness);
  return stars.slice(0, limit);
}

/**
 * gaiaCone(ra, dec, radius, opts) -> Promise<{ epoch: 2016.0, stars, source }>
 * radius is clamped to (0, 0.25] deg. opts: fetchImpl, timeoutMs (overrides every service's
 * own timeout), limit (<= 500), providers (defaults to GAIA_PROVIDERS), log.
 * Throws the last UpstreamError when every service fails.
 */
export async function gaiaCone(ra, dec, radius, opts = {}) {
  const { fetchImpl = globalThis.fetch, timeoutMs, providers = GAIA_PROVIDERS, log = noLog } = opts;
  if (!Number.isFinite(ra) || !Number.isFinite(dec) || ra < 0 || ra > 360 || dec < -90 || dec > 90) {
    throw new UpstreamError('ra must be within 0..360 and dec within -90..90 degrees', { kind: 'input', status: 400, retryable: false });
  }
  const r = Math.min(GAIA_MAX_RADIUS, Math.max(0.0005, Number.isFinite(radius) ? radius : 0.1));
  const limit = Math.max(1, Math.min(GAIA_MAX_STARS, Math.floor(opts.limit || GAIA_MAX_STARS)));
  // A staggered race: the next service is asked as soon as the previous one fails, or after
  // `hedgeMs` without an answer (default 3 s), and the first good answer wins. One dead archive
  // then costs three seconds, not its whole timeout.
  const hedgeMs = Number.isFinite(opts.hedgeMs) ? Math.max(0, opts.hedgeMs) : 3000;
  let lastError = null;
  const ask = async (provider) => {
    const t0 = Date.now();
    try {
      const text = await tapSyncCsv(provider.endpoint, provider.query(ra, dec, r, limit), {
        fetchImpl,
        timeoutMs: timeoutMs || provider.timeoutMs,
        label: `Gaia (${provider.name})`,
      });
      const stars = parseGaiaCsv(text, provider.columns, limit);
      log(`gaia: ${provider.name} gave ${stars.length} stars in ${Date.now() - t0} ms`);
      return { epoch: GAIA_EPOCH, stars, source: provider.name };
    } catch (err) {
      lastError = err instanceof UpstreamError ? err : new UpstreamError(`Gaia (${provider.name}) failed: ${err && err.message}`);
      log(`gaia: ${provider.name} failed after ${Date.now() - t0} ms: ${lastError.message}`);
      return null;
    }
  };
  const answer = await new Promise((resolve) => {
    let next = 0;
    let pending = 0;
    let settled = false;
    let timer = null;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(value);
    };
    const start = () => {
      if (settled || next >= providers.length) return;
      const provider = providers[next++];
      pending += 1;
      if (timer) clearTimeout(timer);
      timer = next < providers.length ? setTimeout(start, hedgeMs) : null;
      ask(provider).then((result) => {
        pending -= 1;
        if (result) finish(result);
        else if (next < providers.length) start();
        else if (pending === 0) finish(null);
      });
    };
    if (providers.length === 0) finish(null);
    else start();
  });
  if (answer) return answer;
  if (lastError && lastError.kind !== 'timeout') {
    throw new UpstreamError(`No Gaia service answered (last: ${lastError.message})`, { kind: lastError.kind, status: 502 });
  }
  throw lastError || new UpstreamError('No Gaia service is configured', { retryable: false });
}

function separationDeg(ra1, dec1, ra2, dec2) {
  const d2r = Math.PI / 180;
  const s1 = Math.sin(((dec2 - dec1) * d2r) / 2);
  const s2 = Math.sin(((ra2 - ra1) * d2r) / 2);
  const a = s1 * s1 + Math.cos(dec1 * d2r) * Math.cos(dec2 * d2r) * s2 * s2;
  return (2 * Math.asin(Math.min(1, Math.sqrt(a)))) / d2r;
}

function firstNumber(obj, names) {
  for (const name of names) {
    const v = obj[name];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
}

/**
 * The /gaia answer for the synthetic backend: the catalogue of the fake sky, cut to the cone.
 * `sky` is what syntheticSky(ra, dec) returns. Its own gaia() is used when it has one (stars
 * already shaped like the /gaia response); otherwise the list is derived from
 * sky.sourcesAt(J2016.0), with made-up but stable ids and null for what a source does not say.
 */
export function gaiaFromSynthetic(sky, ra, dec, radius, limit = GAIA_MAX_STARS) {
  const r = Math.min(GAIA_MAX_RADIUS, Math.max(0.0005, Number.isFinite(radius) ? radius : 0.1));
  let candidates = [];
  if (sky && typeof sky.gaia === 'function') {
    const catalogue = sky.gaia();
    candidates = (catalogue && Array.isArray(catalogue.stars) ? catalogue.stars : []).map((star) => ({
      id: String(star.id),
      ra: star.ra,
      dec: star.dec,
      pmra: firstNumber(star, ['pmra']),
      pmdec: firstNumber(star, ['pmdec']),
      parallax: firstNumber(star, ['parallax']),
      gmag: firstNumber(star, ['gmag']),
    }));
  } else if (sky && typeof sky.sourcesAt === 'function') {
    const sources = sky.sourcesAt(GAIA_EPOCH_MJD) || [];
    for (let i = 0; i < sources.length; i++) {
      const src = sources[i];
      if (!src || typeof src !== 'object') continue;
      // Sources the catalogue would not know (a new mover, a cold dwarf) are left out.
      if (src.gaia === false || src.inGaia === false || src.catalog === false) continue;
      candidates.push({
        id: `99${String(1e6 + i).slice(1)}${String(src.id ?? '').replace(/\D/g, '').slice(0, 8)}`,
        ra: src.ra,
        dec: src.dec,
        pmra: firstNumber(src, ['pmra']),
        pmdec: firstNumber(src, ['pmdec']),
        parallax: firstNumber(src, ['parallax']),
        gmag: firstNumber(src, ['gmag']),
      });
    }
  }
  const stars = candidates.filter(
    (star) => Number.isFinite(star.ra) && Number.isFinite(star.dec) && separationDeg(ra, dec, star.ra, star.dec) <= r,
  );
  stars.sort(byBrightness);
  return { epoch: GAIA_EPOCH, stars: stars.slice(0, limit), source: 'synthetic' };
}
