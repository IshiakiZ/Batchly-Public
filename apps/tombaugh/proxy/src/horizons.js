// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

// Ephemerides of solar-system bodies from JPL Horizons, for the "follow a moving body" mode.
//
// One GET to https://ssd.jpl.nasa.gov/api/horizons.api returns a text table of where a body
// was on the sky at regular times. The proxy forwards that as
//   { body, name, source: 'JPL Horizons', center: 'geocentric',
//     samples: [[mjd, ra_deg, dec_deg, deltaAU, mag | null], ...] }
// and the browser then asks the exposure index which SPHEREx exposures contained the body.
//
// GEOCENTRIC IS GOOD ENOUGH. Positions are for an observer at the centre of the Earth
// (CENTER='500@399'). SPHEREx flies in low Earth orbit, about 7,000 km from that point, so the
// true direction differs by at most 7000 km / distance: 4.8 arcsec at 2 AU, 0.3 arcsec at Pluto.
// A SPHEREx pixel is 6.15 arcsec, so beyond about 2 AU the difference is below one pixel. Inside
// 2 AU (a near-Earth asteroid, a comet at close approach) it is not, and a spacecraft-centred
// ephemeris would be needed.
//
// The request format below was verified against the live service on 2026-11-15: every value
// is wrapped in single quotes and URL-encoded; major
// bodies use numeric ids ('999' is Pluto); small bodies resolve by name, number or designation
// with a trailing semicolon ('Sedna;', '136199;', 'DES=C/2025 N1;'). When a name is unknown or
// matches several bodies the answer has no $$SOE marker and lists the matches instead.
//
// Environment-neutral: fetch, AbortController, URLSearchParams, TextEncoder only.

export const HORIZONS_URL = 'https://ssd.jpl.nasa.gov/api/horizons.api';
export const HORIZONS_SOURCE = 'JPL Horizons';
/** Largest number of ephemeris rows we ever ask for; the step is widened to stay below it. */
export const HORIZONS_MAX_STEPS = 3000;
/** Longest span we forward, in days (the SPHEREx survey is two years; this leaves room). */
export const HORIZONS_MAX_SPAN_DAYS = 3660;
/** First SPHEREx exposures (April 2025), the default start of an ephemeris. */
export const SURVEY_START_MJD = 60770;
const BODY_MAX_LENGTH = 40;
const BODY_PATTERN = /^[A-Za-z0-9 /\-=;]+$/;
const MJD_UNIX_EPOCH = 40587;

/**
 * An error with a machine-readable `code`:
 *   BAD_REQUEST  the body text or the time range is not acceptable (HTTP 400)
 *   UNSUPPORTED  a body we know cannot be followed with SPHEREx (HTTP 400)
 *   AMBIGUOUS    Horizons knows several bodies by that name; `matches` holds an excerpt (HTTP 409)
 *   NOT_FOUND    Horizons knows no such body (HTTP 404)
 *   UPSTREAM     Horizons did not answer, or answered something unreadable (HTTP 502, retryable)
 */
export class HorizonsError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'HorizonsError';
    this.code = code;
    this.status = { BAD_REQUEST: 400, UNSUPPORTED: 400, AMBIGUOUS: 409, NOT_FOUND: 404, UPSTREAM: 502 }[code] || 500;
    this.retryable = code === 'UPSTREAM';
    this.matches = extra.matches || '';
  }
}

/**
 * Friendly names -> Horizons COMMAND. Keys are lower-case with spaces, '/' and '-' removed.
 * Numbered small bodies use "<number>;" (unique, unlike a name search) except where the name
 * form is the one that was verified against the live service ('Sedna;', 'Ceres;'). Pluto is
 * the body centre 999, not the Pluto-Charon barycentre 9 (about 0.1 arcsec apart: irrelevant
 * at 6 arcsec pixels, but 999 is what the magnitude refers to).
 */
const COMMAND_TABLE = new Map([
  ['pluto', '999'],
  ['134340', '999'],
  ['134340pluto', '999'],
  ['eris', '136199;'],
  ['makemake', '136472;'],
  ['haumea', '136108;'],
  ['sedna', 'Sedna;'],
  ['90377', 'Sedna;'],
  ['gonggong', '225088;'],
  ['quaoar', '50000;'],
  ['orcus', '90482;'],
  ['ceres', 'Ceres;'],
  ['vesta', '4;'],
  ['pallas', '2;'],
  ['hygiea', '10;'],
  ['chiron', '2060;'],
  ['3i', 'DES=C/2025 N1;'],
  ['3iatlas', 'DES=C/2025 N1;'],
  ['c2025n1', 'DES=C/2025 N1;'],
  ['c2025n1atlas', 'DES=C/2025 N1;'],
  // The planets, so that a typed planet name is not sent to the asteroid index by mistake.
  ['mars', '499'],
  ['jupiter', '599'],
  ['saturn', '699'],
  ['uranus', '799'],
  ['neptune', '899'],
]);

/** Bodies we refuse, with the reason shown to the user. */
const UNSUPPORTED = new Map([
  ['triton', 'Triton is not supported: it never gets more than 17 arcsec (three SPHEREx pixels) from Neptune, which is 6 magnitudes brighter.'],
  ['charon', 'Charon is not supported: it is under one arcsec from Pluto, far inside one SPHEREx pixel. Follow Pluto instead.'],
  ['sun', 'The Sun is not supported: SPHEREx never points near it.'],
  ['moon', 'The Moon is not supported: SPHEREx avoids it, and a geocentric position would be wrong by degrees.'],
  ['earth', 'The Earth is where the telescope is.'],
]);

function tableKey(text) {
  return text.toLowerCase().replace(/[\s/-]+/g, '');
}

/**
 * Check a body name typed by a user. Only letters, digits, space, '/', '-', '=' and ';' are
 * allowed, at most 40 characters. Single quotes are forbidden because every Horizons value is
 * wrapped in them: a quote would let a caller close our value and append parameters of their
 * own, turning the proxy into an open relay for arbitrary Horizons jobs.
 * Returns the trimmed text with runs of spaces collapsed; throws HorizonsError BAD_REQUEST.
 */
export function validateBody(body) {
  if (typeof body !== 'string') throw new HorizonsError('BAD_REQUEST', 'Give the name of a body, for example "Pluto".');
  // Tested on the raw text: tabs, newlines and other control characters are not "spaces".
  if (body.trim() && !BODY_PATTERN.test(body)) {
    throw new HorizonsError('BAD_REQUEST', 'A body name can contain letters, digits, spaces and / - = ; only.');
  }
  const text = body.trim().replace(/ +/g, ' ');
  if (!text) throw new HorizonsError('BAD_REQUEST', 'Give the name of a body, for example "Pluto".');
  if (text.length > BODY_MAX_LENGTH) {
    throw new HorizonsError('BAD_REQUEST', `A body name can have at most ${BODY_MAX_LENGTH} characters.`);
  }
  return text;
}

/**
 * Friendly name or id -> the Horizons COMMAND value (without the surrounding quotes).
 *
 *   'Pluto' -> '999'            'Eris' -> '136199;'        '3I/ATLAS' -> 'DES=C/2025 N1;'
 *   '136472' -> '136472;'       a number of 1000 or more is a numbered small body
 *   '599' -> '599'              a number below 1000 is a major-body id and is passed as it is
 *   'DES=C/2025 N1;' -> itself  anything that already ends in ';' is passed as it is
 *   'Varuna' -> 'Varuna;'       any other name is looked up in the small-body index
 *
 * Throws HorizonsError (BAD_REQUEST for unacceptable text, UNSUPPORTED for Triton and friends).
 */
export function horizonsCommand(nameOrId) {
  const text = validateBody(nameOrId);
  const key = tableKey(text.replace(/;+$/, ''));
  if (UNSUPPORTED.has(key)) throw new HorizonsError('UNSUPPORTED', UNSUPPORTED.get(key));
  if (text.endsWith(';')) return text;
  if (COMMAND_TABLE.has(key)) return COMMAND_TABLE.get(key);
  if (/^-?\d+$/.test(text)) return Number(text) >= 1000 ? `${text};` : text;
  // "DES=1P;CAP" style commands carry their own semicolon inside; leave those alone too.
  if (text.includes(';')) return text;
  return `${text};`;
}

function pad2(v) {
  return v < 10 ? `0${v}` : String(v);
}

/** MJD -> 'YYYY-MM-DD' (UTC calendar date of the day that contains it). */
function mjdToDay(mjd) {
  const d = new Date(Math.floor(mjd - MJD_UNIX_EPOCH) * 86400000);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/**
 * Work out the time range and step actually sent. The range is widened to whole UTC days (the
 * verified request format uses plain dates), the step is a whole number of minutes of at least
 * one, and it is widened when the range would otherwise need more than HORIZONS_MAX_STEPS rows.
 * Returns { startMjd, endMjd, stepMinutes, stepHours, steps, start, stop, stepSize }.
 */
export function planRequest({ startMjd, endMjd, stepHours = 12 } = {}) {
  const a = Number(startMjd);
  const b = Number(endMjd);
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    throw new HorizonsError('BAD_REQUEST', 'start and end must be dates as MJD numbers.');
  }
  if (a < 15020 || b > 88069) { // 1900-01-01 .. 2100-01-01: far wider than the survey, stops nonsense
    throw new HorizonsError('BAD_REQUEST', 'start and end must lie between the years 1900 and 2100.');
  }
  if (b < a) throw new HorizonsError('BAD_REQUEST', 'end must not be earlier than start.');
  const start = Math.floor(a);
  let end = Math.ceil(b);
  if (end <= start) end = start + 1;
  if (end - start > HORIZONS_MAX_SPAN_DAYS) {
    throw new HorizonsError('BAD_REQUEST', `The time range can be at most ${HORIZONS_MAX_SPAN_DAYS} days.`);
  }
  const wanted = Number(stepHours);
  let stepMinutes = Math.max(1, Math.round((Number.isFinite(wanted) && wanted > 0 ? wanted : 12) * 60));
  const spanMinutes = (end - start) * 1440;
  if (spanMinutes / stepMinutes > HORIZONS_MAX_STEPS) {
    stepMinutes = Math.ceil(spanMinutes / HORIZONS_MAX_STEPS);
    if (stepMinutes > 60) stepMinutes = Math.ceil(stepMinutes / 60) * 60; // whole hours read better
  }
  const stepSize = stepMinutes % 1440 === 0 ? `${stepMinutes / 1440} d`
    : stepMinutes % 60 === 0 ? `${stepMinutes / 60} h` : `${stepMinutes} m`;
  return {
    startMjd: start,
    endMjd: end,
    stepMinutes,
    stepHours: stepMinutes / 60,
    steps: Math.floor(spanMinutes / stepMinutes) + 1,
    start: mjdToDay(start),
    stop: mjdToDay(end),
    stepSize,
  };
}

/**
 * The request URL, exactly in the verified form: every value in single quotes, URL-encoded.
 * QUANTITIES 1 = astrometric RA and Dec (ICRF), 9 = apparent magnitude and surface brightness
 * (total and nuclear magnitude for comets), 20 = distance from the observer and its rate.
 */
export function buildHorizonsUrl(command, plan) {
  const q = (v) => `'${v}'`;
  const params = [
    ['format', 'text'],
    ['COMMAND', q(command)],
    ['OBJ_DATA', q('NO')],
    ['MAKE_EPHEM', q('YES')],
    ['EPHEM_TYPE', q('OBSERVER')],
    ['CENTER', q('500@399')],
    ['START_TIME', q(plan.start)],
    ['STOP_TIME', q(plan.stop)],
    ['STEP_SIZE', q(plan.stepSize)],
    ['QUANTITIES', q('1,9,20')],
    ['ANG_FORMAT', q('DEG')],
    ['CSV_FORMAT', q('YES')],
    ['CAL_FORMAT', q('JD')],
  ];
  // encodeURIComponent leaves the single quote alone; encode it too so the query is plain ASCII
  // with no reserved characters at all.
  const enc = (v) => encodeURIComponent(v).replace(/'/g, '%27');
  return `${HORIZONS_URL}?${params.map(([k, v]) => `${k}=${enc(v)}`).join('&')}`;
}

function toNumber(text) {
  if (text === undefined || text === null) return null;
  const s = String(text).trim();
  if (!s || /^n\.?a\.?$/i.test(s)) return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

/** A short, tidy excerpt of a Horizons message (the list of matches, or the error line). */
function excerpt(text, maxLines = 14, maxChars = 900) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.trim() && !/^[*\s]+$/.test(l) && !/^API (VERSION|SOURCE)/i.test(l.trim()));
  let out = lines.slice(0, maxLines).join('\n');
  if (out.length > maxChars) out = `${out.slice(0, maxChars)}...`;
  return out;
}

/**
 * Parse the text answer.
 *
 * With an ephemeris: finds the rows between $$SOE and $$EOE, reads the column header line just
 * above (so a changed column order would still be read correctly; fixed positions are the
 * fallback), converts JD to MJD (JD - 2400000.5) and 'n.a.' to null.
 * Returns { name, samples: [[mjd, ra, dec, deltaAU, mag | null], ...], columns }.
 *
 * Without one: throws HorizonsError AMBIGUOUS (the text lists several matching bodies),
 * NOT_FOUND (no match) or UPSTREAM (anything else), each with `matches` = a short excerpt.
 */
export function parseHorizonsText(text) {
  const body = String(text || '');
  const soe = body.indexOf('$$SOE');
  if (soe < 0) throw classifyNoEphemeris(body);
  const eoe = body.indexOf('$$EOE', soe);
  const block = body.slice(soe + 5, eoe < 0 ? body.length : eoe);

  // Column header: the last line before $$SOE that names the date column.
  const before = body.slice(0, soe).split(/\r?\n/);
  let cols = null;
  for (let i = before.length - 1; i >= 0 && i >= before.length - 8; i--) {
    if (/JDUT|Date_/i.test(before[i]) && before[i].includes(',')) {
      cols = before[i].split(',').map((c) => c.trim());
      break;
    }
  }
  const find = (re, fallback) => {
    if (cols) {
      const i = cols.findIndex((c) => re.test(c));
      if (i >= 0) return i;
    }
    return fallback;
  };
  const iJd = find(/^Date_+JD/i, 0);
  const iRa = find(/^R\.A\./i, 3);
  const iDec = find(/^DEC/i, 4);
  const iMag = find(/^(APmag|T-mag)$/i, 5);
  const iDelta = find(/^delta$/i, 7);

  const samples = [];
  for (const line of block.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const f = line.split(',');
    const jd = toNumber(f[iJd]);
    const ra = toNumber(f[iRa]);
    const dec = toNumber(f[iDec]);
    if (jd === null || ra === null || dec === null) continue;
    if (ra < 0 || ra > 360 || dec < -90 || dec > 90) continue;
    const mjd = Math.round((jd - 2400000.5) * 1e8) / 1e8;
    samples.push([mjd, ra, dec, toNumber(f[iDelta]), toNumber(f[iMag])]);
  }
  if (!samples.length) {
    throw new HorizonsError('UPSTREAM', 'Horizons sent an ephemeris with no readable rows.', { matches: excerpt(block, 4) });
  }
  samples.sort((p, q) => p[0] - q[0]);

  const m = /Target body name:\s*(.+?)(?:\s{2,}|\s*\{|\r?\n|$)/.exec(body);
  return { name: m ? m[1].trim() : '', samples, columns: cols };
}

function classifyNoEphemeris(body) {
  const matches = excerpt(body);
  if (/No matches found/i.test(body) || /No such (object|record)|Unknown target|cannot find/i.test(body)) {
    return new HorizonsError('NOT_FOUND', 'Horizons does not know a body by that name.', { matches });
  }
  if (/Multiple major-bodies match|Matching small-bodies|Number of matches\s*=|\d+ matches\./i.test(body)) {
    // Keep the table of candidates, not the banner above it.
    const lines = body.split(/\r?\n/);
    const start = lines.findIndex((l) => /Record #|ID#/.test(l));
    const table = start >= 0 ? excerpt(lines.slice(start).join('\n'), 14) : matches;
    return new HorizonsError(
      'AMBIGUOUS',
      'Horizons knows several bodies by that name. Use a number or a designation (for example "136199" or "DES=C/2025 N1").',
      { matches: table },
    );
  }
  if (/No ephemeris for target/i.test(body)) {
    return new HorizonsError('NOT_FOUND', 'Horizons has no ephemeris for that body in this time range.', { matches });
  }
  return new HorizonsError('UPSTREAM', 'Horizons answered without an ephemeris.', { matches });
}

async function readTextLimited(response, maxBytes) {
  const text = await response.text();
  return text.length > maxBytes ? text.slice(0, maxBytes) : text;
}

/**
 * horizonsEphemeris(body, { startMjd, endMjd, stepHours = 12, fetchImpl, timeoutMs = 20000 })
 *   -> Promise<{ body, name, source: 'JPL Horizons', center: 'geocentric',
 *                samples: [[mjd, ra, dec, deltaAU, mag | null], ...],
 *                command, stepHours, startMjd, endMjd }>
 *
 * `body` is what the user typed ("Pluto", "3I/ATLAS", "136199", "DES=C/2025 N1;"); it is
 * validated strictly and mapped with horizonsCommand. startMjd defaults to the first SPHEREx
 * exposures and endMjd to today. Positions are astrometric ICRF RA/Dec in degrees seen from
 * the centre of the Earth, `deltaAU` is the distance from the Earth, `mag` the apparent
 * magnitude (total magnitude for a comet), null where Horizons says "n.a.".
 *
 * Optional `cache` ({ get(key), put(key, u8, type) } as in cache.js): answers are stored under
 * `horizons/v1/...` and reused, because the past does not change.
 *
 * Throws HorizonsError (see the codes above). Never retries by itself.
 */
export async function horizonsEphemeris(body, opts = {}) {
  const {
    startMjd = SURVEY_START_MJD,
    endMjd = Date.now() / 86400000 + MJD_UNIX_EPOCH,
    stepHours = 12,
    fetchImpl = globalThis.fetch,
    timeoutMs = 20000,
    cache = null,
  } = opts;
  const clean = validateBody(body);
  const command = horizonsCommand(clean);
  const plan = planRequest({ startMjd, endMjd, stepHours });
  const url = buildHorizonsUrl(command, plan);

  const cacheKey = `horizons/v1/${encodeURIComponent(command)}/${plan.startMjd}-${plan.endMjd}-${plan.stepMinutes}.json`;
  if (cache && typeof cache.get === 'function') {
    try {
      const hit = await cache.get(cacheKey);
      if (hit) {
        const parsed = JSON.parse(new TextDecoder().decode(hit));
        if (parsed && Array.isArray(parsed.samples) && parsed.samples.length) return { ...parsed, body: clean, cached: true };
      }
    } catch {
      // a broken cache entry only costs one request
    }
  }

  if (typeof fetchImpl !== 'function') throw new HorizonsError('UPSTREAM', 'No fetch implementation is available.');
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, Math.max(1, timeoutMs));
  let text;
  try {
    const response = await fetchImpl(url, { method: 'GET', headers: { accept: 'text/plain, */*' }, signal: controller.signal });
    if (!response || !response.ok) {
      const status = response ? response.status : 0;
      let detail = '';
      try {
        detail = excerpt(await readTextLimited(response, 4000), 3, 240);
      } catch {
        // no body
      }
      if (status === 400) {
        // Horizons answers 400 for a request it cannot interpret; that is ours to fix, not a retry.
        const err = new HorizonsError('UPSTREAM', 'Horizons rejected the request.', { matches: detail });
        err.retryable = false;
        throw err;
      }
      throw new HorizonsError('UPSTREAM', `Horizons answered ${status || 'nothing'}.`, { matches: detail });
    }
    text = await readTextLimited(response, 4 * 1024 * 1024);
  } catch (err) {
    if (err instanceof HorizonsError) throw err;
    if (timedOut) throw new HorizonsError('UPSTREAM', `Horizons did not answer within ${Math.round(timeoutMs / 1000)} seconds.`);
    throw new HorizonsError('UPSTREAM', `Horizons could not be reached: ${err && err.message ? err.message : 'network error'}.`);
  } finally {
    clearTimeout(timer);
  }

  const parsed = parseHorizonsText(text);
  const result = {
    body: clean,
    name: parsed.name || clean,
    source: HORIZONS_SOURCE,
    center: 'geocentric',
    command,
    stepHours: plan.stepHours,
    startMjd: plan.startMjd,
    endMjd: plan.endMjd,
    samples: parsed.samples,
  };
  if (cache && typeof cache.put === 'function') {
    try {
      await cache.put(cacheKey, new TextEncoder().encode(JSON.stringify(result)), 'application/json');
    } catch {
      // caching is optional
    }
  }
  return result;
}

/**
 * The whole `GET /ephemeris?body=<name>&start=<mjd>&end=<mjd>&step=<hours>` route in one call,
 * for the handler: takes the request's URLSearchParams (or a plain object) and returns
 * { status, body } where body is the JSON to send. Never throws.
 *   200 -> the ephemeris;  4xx/5xx -> { error, retryable, code, matches }.
 */
export async function ephemerisRoute(params, opts = {}) {
  const get = (k) => (params && typeof params.get === 'function' ? params.get(k) : params ? params[k] : null);
  const num = (k) => {
    const v = get(k);
    return v === null || v === undefined || v === '' ? undefined : Number(v);
  };
  try {
    const body = get('body');
    const request = { ...opts };
    const start = num('start');
    const end = num('end');
    const step = num('step');
    if (start !== undefined) request.startMjd = start;
    if (end !== undefined) request.endMjd = end;
    if (step !== undefined) request.stepHours = step;
    return { status: 200, body: await horizonsEphemeris(body === null || body === undefined ? '' : String(body), request) };
  } catch (err) {
    if (err instanceof HorizonsError) {
      return { status: err.status, body: { error: err.message, retryable: err.retryable, code: err.code, matches: err.matches } };
    }
    return { status: 500, body: { error: `The ephemeris could not be computed: ${err && err.message}`, retryable: false, code: 'INTERNAL', matches: '' } };
  }
}
