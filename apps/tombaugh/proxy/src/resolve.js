// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

// Name resolver: a small built-in table of the five challenge targets (so the demo works when
// CDS is unreachable), then CDS Sesame, then SIMBAD TAP.

import { UpstreamError, fetchWithTimeout, httpFailure, parseCsvTable, readTextLimited, tapSyncCsv } from './irsa.js';

export const SESAME_URL = 'https://cds.unistra.fr/cgi-bin/nph-sesame/-oxp/SNV';
export const SIMBAD_TAP_URL = 'https://simbad.cds.unistra.fr/simbad/sim-tap/sync';
export const BUILTIN_SOURCE = 'builtin (approximate)';

const noLog = () => {};

function sexagesimal(h, m, s) {
  return h + m / 60 + s / 3600;
}

/**
 * The five challenge targets. Coordinates are ICRS at `epoch`; proper motions in mas/yr
 * (pmra includes cos dec); parallax in mas. Values are approximate and are only used when
 * Sesame does not answer; `null` means "not known here", not zero.
 */
export const BUILTIN_TARGETS = [
  {
    name: "Barnard's Star",
    ra: 269.452075,
    dec: 4.693391,
    epoch: 2000.0,
    pmra: -802.8,
    pmdec: 10362.5,
    parallax: 547.0,
    aliases: ['Barnards Star', 'Barnard Star', 'Barnard', 'GJ 699', 'Gl 699', 'Gliese 699', 'HIP 87937', 'V2500 Oph', 'LHS 57'],
  },
  {
    name: 'Epsilon Indi B',
    ra: 331.0438,
    dec: -56.7827,
    epoch: 2000.0,
    pmra: 3960.9,
    pmdec: -2539.2,
    parallax: 274.8,
    aliases: [
      'eps Indi B', 'eps Ind B', 'Epsilon Ind B', 'eps Indi Ba', 'eps Ind Ba', 'eps Indi Bb', 'eps Ind Bb',
      'eps Indi Ba Bb', 'eps Ind Ba Bb', 'eps Indi Bab', 'eps Ind Bab', 'eps Indi BaBb', 'Epsilon Indi Ba,Bb',
      'Epsilon Indi Ba', 'Epsilon Indi Bab',
    ],
  },
  {
    name: 'WISE 0855-0714',
    // The challenge gives 08h55m10.831s -07d14m42.53s; that position is for about 2014.3.
    ra: sexagesimal(8, 55, 10.831) * 15,
    dec: -sexagesimal(7, 14, 42.53),
    epoch: 2014.3,
    pmra: -8118,
    pmdec: 680,
    parallax: 439,
    aliases: [
      'WISE 0855', 'WISE J0855-0714', 'WISE J085510.83-071442.5', 'WISEA J085510.74-071442.5', 'W0855', 'W0855-0714',
      'WISE 0855-07', 'WISE J0855', 'WISEA 0855-0714',
    ],
  },
  {
    name: 'RW Aurigae',
    ra: 76.95642,
    dec: 30.40142,
    epoch: 2000.0,
    pmra: null,
    pmdec: null,
    parallax: null,
    aliases: ['RW Aur', 'RW Aur A', 'RW Aurigae A', 'HD 240764'],
  },
  {
    name: 'R Draconis',
    ra: 248.16763,
    dec: 66.75497,
    epoch: 2000.0,
    pmra: null,
    pmdec: null,
    parallax: null,
    aliases: ['R Dra', 'HD 149880'],
  },
];

/** Lower case, Greek epsilon and "epsilon" -> "eps", everything but letters and digits removed. */
export function normalizeName(text) {
  return String(text ?? '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[εϵ]/g, 'eps')
    .replace(/epsilon/g, 'eps')
    .replace(/[^a-z0-9]+/g, '');
}

let builtinIndex = null;

function getBuiltinIndex() {
  if (!builtinIndex) {
    builtinIndex = new Map();
    for (const target of BUILTIN_TARGETS) {
      for (const label of [target.name, ...target.aliases]) builtinIndex.set(normalizeName(label), target);
    }
  }
  return builtinIndex;
}

/** Looks a name up in the built-in table. Returns the /resolve shape or null. */
export function resolveBuiltin(name) {
  const target = getBuiltinIndex().get(normalizeName(name));
  if (!target) return null;
  return {
    name: target.name,
    ra: target.ra,
    dec: target.dec,
    epoch: target.epoch,
    pmra: target.pmra,
    pmdec: target.pmdec,
    parallax: target.parallax,
    source: BUILTIN_SOURCE,
  };
}

/** Trims, drops control characters and caps the length. Returns '' for unusable input. */
export function cleanName(name) {
  if (typeof name !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return name.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}

function tagNumber(xml, tag) {
  const m = new RegExp(`<${tag}>\\s*([-+0-9.eE]+)\\s*</${tag}>`).exec(xml);
  if (!m) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) ? v : null;
}

function decodeEntities(text) {
  return String(text)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&');
}

/**
 * Parses a Sesame XML answer. Returns { name, ra, dec, pmra, pmdec, parallax } from the first
 * resolver that has a position, or null when nothing was found. Throws UpstreamError('parse')
 * when the text is not a Sesame document.
 */
export function parseSesameXml(xml, fallbackName = '') {
  const text = String(xml || '');
  if (!/<Sesame[\s>]/.test(text)) {
    throw new UpstreamError('Sesame sent something that is not a Sesame document', { kind: 'parse' });
  }
  const blocks = text.match(/<Resolver[\s\S]*?<\/Resolver>/g) || [];
  for (const block of blocks) {
    const ra = tagNumber(block, 'jradeg');
    const dec = tagNumber(block, 'jdedeg');
    if (ra === null || dec === null || ra < 0 || ra > 360 || dec < -90 || dec > 90) continue;
    const oname = /<oname>([\s\S]*?)<\/oname>/.exec(block);
    const plx = /<plx>([\s\S]*?)<\/plx>/.exec(block);
    let name = oname ? decodeEntities(oname[1]).trim() : '';
    name = name.replace(/^NAME\s+/, '').replace(/\s+/g, ' ');
    return {
      name: name || fallbackName,
      ra,
      dec,
      pmra: tagNumber(block, 'pmRA'),
      pmdec: tagNumber(block, 'pmDE'),
      parallax: plx ? tagNumber(plx[1], 'v') : null,
    };
  }
  return null;
}

/** Parses the CSV of the SIMBAD TAP query below. Returns the same shape as parseSesameXml. */
export function parseSimbadCsv(text, fallbackName = '') {
  if (String(text || '').trimStart().startsWith('<')) {
    throw new UpstreamError('SIMBAD sent a document instead of a table', { kind: 'parse' });
  }
  const table = parseCsvTable(text);
  if (!table.columns.includes('ra') || !table.columns.includes('dec')) {
    throw new UpstreamError('SIMBAD answer has no ra/dec columns', { kind: 'parse' });
  }
  const num = (value) => {
    const t = String(value ?? '').trim();
    if (t === '') return null;
    const v = Number(t);
    return Number.isFinite(v) ? v : null;
  };
  for (const rec of table.records) {
    const ra = num(rec.ra);
    const dec = num(rec.dec);
    if (ra === null || dec === null) continue;
    const name = String(rec.main_id || '').replace(/^NAME\s+/, '').replace(/\s+/g, ' ').trim();
    return { name: name || fallbackName, ra, dec, pmra: num(rec.pmra), pmdec: num(rec.pmdec), parallax: num(rec.plx_value) };
  }
  return null;
}

/** The SIMBAD ADQL for an identifier, also trying the "NAME x" form used for proper names. */
export function buildSimbadQuery(name) {
  const quoted = name.replace(/'/g, "''");
  return (
    'SELECT TOP 1 b.main_id, b.ra, b.dec, b.pmra, b.pmdec, b.plx_value ' +
    'FROM basic AS b JOIN ident AS i ON i.oidref = b.oid ' +
    `WHERE i.id = '${quoted}' OR i.id = 'NAME ${quoted}'`
  );
}

async function querySesame(name, { fetchImpl, timeoutMs }) {
  const url = `${SESAME_URL}?${encodeURIComponent(name)}`;
  return fetchWithTimeout(
    fetchImpl,
    url,
    { method: 'GET', headers: { accept: 'text/xml, application/xml, text/plain, */*' } },
    timeoutMs,
    async (response) => {
      if (!response.ok) throw await httpFailure(response, 'Sesame');
      return parseSesameXml(await readTextLimited(response, 2 * 1024 * 1024), name);
    },
    'Sesame',
  );
}

async function querySimbad(name, { fetchImpl, timeoutMs }) {
  const text = await tapSyncCsv(SIMBAD_TAP_URL, buildSimbadQuery(name), { fetchImpl, timeoutMs, label: 'SIMBAD' });
  return parseSimbadCsv(text, name);
}

function separationArcsec(ra1, dec1, ra2, dec2) {
  const d2r = Math.PI / 180;
  const dra = (ra2 - ra1) * Math.cos(((dec1 + dec2) / 2) * d2r);
  return Math.hypot(dra, dec2 - dec1) * 3600;
}

function shape(found, source, builtin) {
  const out = {
    name: found.name,
    ra: found.ra,
    dec: found.dec,
    epoch: 2000.0,
    pmra: found.pmra,
    pmdec: found.pmdec,
    parallax: found.parallax,
    source,
  };
  if (builtin) {
    // Fill what the service left out from the built-in entry.
    if (out.pmra === null || out.pmdec === null) {
      out.pmra = out.pmra ?? builtin.pmra;
      out.pmdec = out.pmdec ?? builtin.pmdec;
    }
    if (out.parallax === null) out.parallax = builtin.parallax;
    // SIMBAD lists some fast movers at their discovery position, not propagated to 2000. When
    // the service's position agrees with a built-in one whose epoch is known, keep that epoch.
    if (builtin.epoch !== 2000.0 && separationArcsec(out.ra, out.dec, builtin.ra, builtin.dec) < 5) {
      out.epoch = builtin.epoch;
    }
  }
  return out;
}

/**
 * resolveName(name, opts) -> Promise<{ name, ra, dec, epoch, pmra, pmdec, parallax, source } | null>
 *
 * Sesame is preferred when it answers within `timeoutMs` (default 8 s); SIMBAD TAP is next;
 * the built-in table is the fallback for the challenge targets. `null` means the name is
 * unknown everywhere. If every service failed (rather than said "unknown") and there is no
 * built-in entry, the last UpstreamError is thrown so the caller can report a retryable error.
 *
 * opts: fetchImpl, timeoutMs, offline (built-in table only, never touches the network), log.
 */
export async function resolveName(name, opts = {}) {
  const { fetchImpl = globalThis.fetch, timeoutMs = 8000, offline = false, log = noLog } = opts;
  const clean = cleanName(name);
  if (!clean) return null;
  const builtin = resolveBuiltin(clean);
  if (offline) return builtin;

  let lastError = null;
  const services = [
    ['sesame', querySesame],
    ['simbad', querySimbad],
  ];
  for (const [source, query] of services) {
    const t0 = Date.now();
    try {
      const found = await query(clean, { fetchImpl, timeoutMs });
      if (found) {
        log(`resolve: ${source} knows "${clean}" (${Date.now() - t0} ms)`);
        return shape(found, source, builtin);
      }
      log(`resolve: ${source} does not know "${clean}"`);
      lastError = null;
      if (source === 'sesame') break; // a clear "not found" from Sesame already covers SIMBAD
    } catch (err) {
      lastError = err instanceof UpstreamError ? err : new UpstreamError(`${source} failed: ${err && err.message}`);
      log(`resolve: ${source} failed after ${Date.now() - t0} ms: ${lastError.message}`);
      if (builtin) break; // a challenge target: answer from the table now rather than wait again
    }
  }
  if (builtin) return builtin;
  if (lastError) throw lastError;
  return null;
}
