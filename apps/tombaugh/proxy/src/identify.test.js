// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

// Tests for identify.js. No network: every request goes to a fake fetch that answers with
// hand-written samples shaped like SIMBAD's TAP CSV output.

import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  IDENTIFY_DEFAULT_RADIUS,
  OTYPE_LABELS,
  SIMBAD_TAP_SYNC,
  buildIdentifyQuery,
  clampRadius,
  displayName,
  identifyCone,
  resetSimbadBreaker,
  identifyFromSynthetic,
  otypeLabel,
  parseCsv,
  parseIdentifyCsv,
  separationArcsec,
  simbadUrl,
  buildMoversQuery, matchMovers, MOVER_MIN_PM,
} from './identify.js';

// Barnard's star and two neighbours, as SIMBAD writes CSV: strings quoted, empty cells bare.
const RA = 269.4520825;
const DEC = 4.6933649;
const BASIC_CSV =
  'main_id,otype,ra,dec,pmra,pmdec,plx_value,sp_type,dist\r\n' +
  '"NAME Barnard\'s star","PM*",269.45207695878,4.69336496657667,-801.551,10362.394,546.9759,"M4V",0.0000055\r\n' +
  '"2MASS J17574849+0441405","IR",269.4520458,4.6945833,,,,"",0.00121\r\n' +
  '"[KW97] 46-22","Rad",269.4560,4.6960,,,,,0.00471\r\n';

const EXTENDED_CSV =
  'main_id,otype,ra,dec,pmra,pmdec,plx_value,sp_type,dist,vmag,kmag,ids\n' +
  '"[KW97] 46-22","Rad",269.4560,4.6960,,,,,0.00471,,,"[KW97] 46-22"\n' +
  '"NAME Barnard\'s star","PM*",269.45207695878,4.69336496657667,-801.551,10362.394,546.9759,"M4V",0.0000055,9.511,4.524,' +
  '"NAME Barnard\'s star|GJ 699|HIP 87937|V* V2500 Oph|Gaia DR3 4472832130942575872|LHS 57"\n';

const VOTABLE_ERROR =
  '<?xml version="1.0" encoding="UTF-8"?>\n<VOTABLE version="1.4"><RESOURCE type="results">' +
  '<INFO name="QUERY_STATUS" value="ERROR">Incorrect ADQL query: unknown table "allfluxes"</INFO></RESOURCE></VOTABLE>';

function response(body, { status = 200, contentType = 'text/csv' } = {}) {
  return new Response(body, { status, headers: { 'content-type': contentType } });
}

/** A fetch that records calls and answers from a queue of functions or Responses. */
// Every test starts with Strasbourg assumed reachable.
beforeEach(() => resetSimbadBreaker());

function fakeFetch(...answers) {
  const calls = [];
  const fn = async (url, init) => {
    const params = new URLSearchParams(init && init.body ? String(init.body) : '');
    calls.push({ url: String(url), init, params, query: params.get('QUERY') || '' });
    const next = answers.length > 1 ? answers.shift() : answers[0];
    return typeof next === 'function' ? next(url, init) : next.clone();
  };
  fn.calls = calls;
  return fn;
}

test('parseCsv handles quotes, doubled quotes, embedded commas and line breaks', () => {
  const rows = parseCsv('﻿a,b,c\r\n"x, y","say ""hi""",3\n\n"line\nbreak",,\n  padded  ,"  kept  ",z');
  assert.deepEqual(rows, [
    ['a', 'b', 'c'],
    ['x, y', 'say "hi"', '3'],
    ['line\nbreak', '', ''],
    ['padded', '  kept  ', 'z'],
  ]);
  assert.deepEqual(parseCsv(''), []);
  assert.deepEqual(parseCsv(null), []);
  assert.deepEqual(parseCsv('only\n'), [['only']]);
  assert.deepEqual(parseCsv('"unterminated, field'), [['unterminated, field']]);
  assert.deepEqual(parseCsv('a,""\n'), [['a', '']]);
});

test('object types are given in plain words', () => {
  const expected = {
    '*': 'star',
    'PM*': 'high proper-motion star',
    'BD*': 'brown dwarf',
    'BrownD*': 'brown dwarf',
    'LP*': 'long-period variable',
    'Mi*': 'Mira variable',
    'TT*': 'T Tauri star',
    'V*': 'variable star',
    'G': 'galaxy',
    'QSO': 'quasar',
    'AGN': 'active galactic nucleus',
    'GlC': 'globular cluster',
    'PN': 'planetary nebula',
    'SB*': 'spectroscopic binary',
    '**': 'double or multiple star',
    'WD*': 'white dwarf',
    'Y*O': 'young stellar object',
    'RR*': 'RR Lyrae variable',
    'Ce*': 'Cepheid variable',
    'C*': 'carbon star',
    'Em*': 'emission-line star',
    'X': 'X-ray source',
    'IR': 'infrared source',
    'Rad': 'radio source',
    'ISM': 'interstellar matter',
  };
  for (const [code, label] of Object.entries(expected)) assert.equal(otypeLabel(code), label, code);
  for (const code of ['Or*', 'AB*', 'HB*', 'HII']) assert.ok(OTYPE_LABELS[code], code);
  assert.match(otypeLabel('Or*'), /young/);
  assert.match(otypeLabel('AB*'), /AGB/);
  assert.match(otypeLabel('HB*'), /horizontal-branch/);
  assert.match(otypeLabel('HII'), /H II/);
  // Unknown codes still say something true, and never throw.
  assert.equal(otypeLabel('Zz*'), 'star (SIMBAD type Zz*)');
  assert.equal(otypeLabel('zzz'), 'catalogued object (SIMBAD type zzz)');
  assert.equal(otypeLabel('HB?'), 'horizontal-branch star candidate');
  assert.equal(otypeLabel(''), 'catalogued object, type not given');
  assert.equal(otypeLabel(null), 'catalogued object, type not given');
  assert.equal(otypeLabel('constructor'), 'catalogued object (SIMBAD type constructor)');
  for (const label of Object.values(OTYPE_LABELS)) assert.ok(!/!/.test(label));
});

test('query text follows the contract and clamps the radius', () => {
  const q = buildIdentifyQuery(RA, DEC, 12 / 3600);
  assert.equal(
    q,
    'SELECT TOP 20 main_id, otype, ra, dec, pmra, pmdec, plx_value, sp_type, ' +
      "DISTANCE(POINT('ICRS', ra, dec), POINT('ICRS', 269.4520825, 4.6933649)) AS dist FROM basic " +
      "WHERE CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', 269.4520825, 4.6933649, 0.003333)) = 1 ORDER BY dist",
  );
  assert.match(buildIdentifyQuery(10, -20, 5), /CIRCLE\('ICRS', 10, -20, 0\.1\)/);
  assert.match(buildIdentifyQuery(10, -20, 1e-9), /CIRCLE\('ICRS', 10, -20, 0\.001\)/);
  assert.match(buildIdentifyQuery(1e-9, -1e-9, 0.01), /POINT\('ICRS', 0, 0\)\)/); // no exponent notation
  const ext = buildIdentifyQuery(RA, DEC, 0.01, { extended: true });
  assert.match(ext, /LEFT JOIN allfluxes ON basic\.oid = allfluxes\.oidref/);
  assert.match(ext, /allfluxes\.V AS vmag, allfluxes\.K AS kmag, ids\.ids AS ids/);
  assert.equal(clampRadius(0.5), 0.1);
  assert.equal(clampRadius(0.0001), 0.001);
  assert.equal(clampRadius('0.02'), 0.02);
  for (const bad of [NaN, undefined, null, 'abc', -1, 0, Infinity, {}]) assert.equal(clampRadius(bad), IDENTIFY_DEFAULT_RADIUS);
  for (const [ra, dec] of [[NaN, 0], [0, NaN], [-1, 0], [361, 0], [0, 91], [0, -91], ['10', 0], [null, 0]]) {
    assert.throws(() => buildIdentifyQuery(ra, dec, 0.01), (err) => err.name === 'UpstreamError' && err.status === 400 && err.retryable === false);
  }
});

test('parseIdentifyCsv shapes, cleans and sorts the objects', () => {
  const objects = parseIdentifyCsv(EXTENDED_CSV, RA, DEC);
  assert.equal(objects.length, 2);
  const [star, radio] = objects; // sorted by separation although the CSV was not
  assert.equal(star.name, "Barnard's star");
  assert.equal(star.type, 'PM*');
  assert.equal(star.typeLabel, 'high proper-motion star');
  assert.ok(Math.abs(star.ra - 269.45207696) < 1e-7 && Math.abs(star.dec - 4.69336497) < 1e-7);
  assert.ok(star.sepArcsec < 0.05);
  assert.equal(star.pmra, -801.551);
  assert.equal(star.pmdec, 10362.394);
  assert.equal(star.parallax, 546.9759);
  assert.equal(star.spType, 'M4V');
  assert.equal(star.vmag, 9.511);
  assert.equal(star.kmag, 4.524);
  assert.deepEqual(star.ids, ['GJ 699', 'HIP 87937', 'V* V2500 Oph', 'Gaia DR3 4472832130942575872', 'LHS 57']);
  assert.equal(star.url, "https://simbad.cds.unistra.fr/simbad/sim-id?Ident=NAME%20Barnard's%20star");
  assert.equal(radio.name, '[KW97] 46-22');
  assert.equal(radio.typeLabel, 'radio source');
  assert.equal(radio.pmra, null);
  assert.equal(radio.parallax, null);
  assert.equal(radio.spType, null);
  assert.equal(radio.vmag, null);
  assert.deepEqual(radio.ids, []);
  assert.ok(Math.abs(radio.sepArcsec - separationArcsec(RA, DEC, 269.456, 4.696)) < 0.01);
  assert.ok(radio.sepArcsec > star.sepArcsec);
  assert.deepEqual(Object.keys(star), ['name', 'type', 'typeLabel', 'ra', 'dec', 'sepArcsec', 'pmra', 'pmdec', 'parallax', 'spType', 'vmag', 'kmag', 'ids', 'url']);
});

test('parseIdentifyCsv tolerates odd rows and refuses non-tables', () => {
  const csv =
    'MAIN_ID, OTYPE ,RA,DEC,pmra\n' +
    '"A",,10.0,20.0,NaN\n' +
    '"A",,10.0,20.0,5\n' + // duplicate name from a join
    ',"*",10.0,20.0,1\n' + // no name
    '"B","*",,20.0,1\n' + // no position
    '"C","*",10.001,95,1\n' + // impossible declination
    '"D","zz",10.0005,20.0,\n';
  const objects = parseIdentifyCsv(csv, 10, 20);
  assert.deepEqual(objects.map((o) => o.name), ['A', 'D']);
  assert.equal(objects[0].type, '');
  assert.equal(objects[0].typeLabel, 'catalogued object, type not given');
  assert.equal(objects[0].pmra, null);
  assert.equal(objects[1].typeLabel, 'catalogued object (SIMBAD type zz)');
  assert.deepEqual(parseIdentifyCsv('main_id,otype,ra,dec,pmra,pmdec,plx_value,sp_type,dist\n', 1, 2), []);
  assert.throws(() => parseIdentifyCsv(VOTABLE_ERROR, 1, 2), /unknown table/);
  assert.throws(() => parseIdentifyCsv('<html><title>502 Proxy Error</title></html>', 1, 2), /502 Proxy Error/);
  assert.throws(() => parseIdentifyCsv('', 1, 2), /empty/);
  assert.throws(() => parseIdentifyCsv('foo,bar\n1,2\n', 1, 2), /main_id/);
  assert.equal(displayName('NAME  Proxima   Centauri'), 'Proxima Centauri');
  assert.equal(displayName('V* RR Lyr'), 'V* RR Lyr');
  assert.equal(simbadUrl('* alf Lyr'), 'https://simbad.cds.unistra.fr/simbad/sim-id?Ident=*%20alf%20Lyr');
  assert.equal(simbadUrl('2MASS J17574849+0441405'), 'https://simbad.cds.unistra.fr/simbad/sim-id?Ident=2MASS%20J17574849%2B0441405');
});

test('identifyCone posts ADQL to SIMBAD and returns objects nearest first', async () => {
  const fetchImpl = fakeFetch(response(EXTENDED_CSV));
  const out = await identifyCone(RA, DEC, 0.01, { movers: false, fetchImpl });
  assert.equal(out.source, 'simbad');
  assert.deepEqual(out.objects.map((o) => o.name), ["Barnard's star", '[KW97] 46-22']);
  assert.equal(fetchImpl.calls.length, 1);
  const call = fetchImpl.calls[0];
  assert.equal(call.url, SIMBAD_TAP_SYNC);
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers['content-type'], 'application/x-www-form-urlencoded');
  assert.equal(call.params.get('REQUEST'), 'doQuery');
  assert.equal(call.params.get('LANG'), 'ADQL');
  assert.equal(call.params.get('FORMAT'), 'csv');
  assert.match(call.query, /^SELECT TOP 20 /);
  assert.match(call.query, /CIRCLE\('ICRS', 269\.4520825, 4\.6933649, 0\.01\)\) = 1 ORDER BY dist$/);
  assert.ok(call.init.signal instanceof AbortSignal);
});

test('identifyCone falls back to the plain query when SIMBAD refuses the joins', async () => {
  for (const refusal of [response(VOTABLE_ERROR, { status: 400, contentType: 'text/xml' }), response(VOTABLE_ERROR, { contentType: 'text/xml' })]) {
    const fetchImpl = fakeFetch(refusal, response(BASIC_CSV));
    const out = await identifyCone(RA, DEC, 0.01, { movers: false, fetchImpl });
    assert.equal(fetchImpl.calls.length, 2);
    assert.match(fetchImpl.calls[0].query, /allfluxes/);
    assert.equal(fetchImpl.calls[1].query, buildIdentifyQuery(RA, DEC, 0.01));
    assert.deepEqual(out.objects.map((o) => o.name), ["Barnard's star", '2MASS J17574849+0441405', '[KW97] 46-22']);
    assert.equal(out.objects[0].vmag, null);
    assert.deepEqual(out.objects[0].ids, []);
    assert.equal(out.objects[1].typeLabel, 'infrared source');
    assert.equal(out.objects[1].spType, null);
  }
  // extended: false goes straight to the contract's query.
  const direct = fakeFetch(response(BASIC_CSV));
  await identifyCone(RA, DEC, 0.01, { movers: false, fetchImpl: direct, extended: false });
  assert.equal(direct.calls.length, 1);
  assert.equal(direct.calls[0].query, buildIdentifyQuery(RA, DEC, 0.01));
});

test('identifyCone returns an empty list for empty sky and honours the radius', async () => {
  const empty = fakeFetch(response('main_id,otype,ra,dec,pmra,pmdec,plx_value,sp_type,dist,vmag,kmag,ids\n'));
  assert.deepEqual(await identifyCone(10, 20, undefined, { movers: false, fetchImpl: empty }), { objects: [], source: 'simbad' });
  assert.match(empty.calls[0].query, /CIRCLE\('ICRS', 10, 20, 0\.003333\)/);
  // A service that ignores the cone is still cut to it: only the first two are within 12 arcsec.
  const out = await identifyCone(RA, DEC, 12 / 3600, { movers: false, fetchImpl: fakeFetch(response(BASIC_CSV)) });
  assert.deepEqual(out.objects.map((o) => o.name), ["Barnard's star", '2MASS J17574849+0441405']);
});

test('identifyCone reports clear errors with a retryable flag', async () => {
  const fails = async (promise, check) => {
    await assert.rejects(promise, (err) => {
      assert.equal(err.name, 'UpstreamError');
      assert.equal(typeof err.retryable, 'boolean');
      check(err);
      return true;
    });
  };
  // Bad input never reaches the network.
  const never = fakeFetch(() => {
    throw new Error('should not be called');
  });
  for (const [ra, dec] of [[NaN, 1], [400, 1], [1, -100], ['1', 1], [undefined, undefined]]) {
    await fails(identifyCone(ra, dec, 0.01, { movers: false, fetchImpl: never }), (err) => {
      assert.equal(err.status, 400);
      assert.equal(err.retryable, false);
    });
  }
  assert.equal(never.calls.length, 0);
  // Upstream 5xx: retryable; Strasbourg and then the CfA mirror are tried once each.
  const down = fakeFetch(response('<html><head><title>502 Proxy Error</title></head></html>', { status: 502, contentType: 'text/html' }));
  await fails(identifyCone(RA, DEC, 0.01, { movers: false, fetchImpl: down }), (err) => {
    assert.equal(err.status, 502);
    assert.equal(err.retryable, true);
    assert.match(err.message, /SIMBAD answered HTTP 502: 502 Proxy Error/);
  });
  assert.equal(down.calls.length, 2);
  resetSimbadBreaker();
  // Refused twice: not retryable.
  const refused = fakeFetch(response(VOTABLE_ERROR, { status: 400, contentType: 'text/xml' }));
  await fails(identifyCone(RA, DEC, 0.01, { movers: false, fetchImpl: refused }), (err) => {
    assert.equal(err.status, 502);
    assert.equal(err.retryable, false);
    assert.match(err.message, /unknown table/);
  });
  assert.equal(refused.calls.length, 2);
  // Network failure.
  const offline = fakeFetch(() => {
    throw new TypeError('fetch failed');
  });
  await fails(identifyCone(RA, DEC, 0.01, { movers: false, fetchImpl: offline }), (err) => {
    assert.equal(err.status, 502);
    assert.equal(err.retryable, true);
    assert.match(err.message, /SIMBAD request failed: fetch failed/);
  });
  // Garbage twice.
  await fails(identifyCone(RA, DEC, 0.01, { movers: false, fetchImpl: fakeFetch(response('hello')) }), (err) => {
    assert.equal(err.kind, 'parse');
  });
  await fails(identifyCone(RA, DEC, 0.01, { movers: false, fetchImpl: null }), (err) => assert.equal(err.retryable, false));
});

test('identifyCone times out, aborts the request and says so', async () => {
  let aborted = false;
  const hanging = (url, init) =>
    new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        aborted = true;
        reject(new DOMException('The operation was aborted', 'AbortError'));
      });
    });
  const t0 = Date.now();
  await assert.rejects(identifyCone(RA, DEC, 0.01, { movers: false, fetchImpl: hanging, timeoutMs: 30 }), (err) => {
    assert.equal(err.name, 'UpstreamError');
    assert.equal(err.kind, 'timeout');
    assert.equal(err.status, 504);
    assert.equal(err.retryable, true);
    assert.match(err.message, /SIMBAD did not answer within 0 s|did not answer within/);
    return true;
  });
  assert.ok(aborted);
  assert.ok(Date.now() - t0 < 2000);
  // A fetch that ignores the signal, and a body that never arrives, are bounded too.
  const deaf = () => new Promise(() => {});
  await assert.rejects(identifyCone(RA, DEC, 0.01, { movers: false, fetchImpl: deaf, timeoutMs: 20 }), /did not answer/);
  const slowBody = async () => ({ ok: true, status: 200, text: () => new Promise(() => {}) });
  await assert.rejects(identifyCone(RA, DEC, 0.01, { movers: false, fetchImpl: slowBody, timeoutMs: 20 }), /did not answer/);
});

test('identifyFromSynthetic answers from a fake sky and hides what no catalogue knows', () => {
  const sky = {
    frameRefs: [{ mjd: 60850 }, { mjd: 61030 }, { mjd: 61210 }],
    objects: [
      { id: 'mover', kind: 'mover', pmE: -0.8, pmN: 10.37 },
      { id: 'methane', kind: 'methane', inGaia: false },
      { id: 'star01', kind: 'star', pmE: 0.01, pmN: -0.02 },
    ],
    sourcesAt(mjd) {
      assert.equal(mjd, 61030);
      return [
        { id: 'mover', kind: 'mover', ra: 100.0005, dec: 20.0 },
        { id: 'methane', kind: 'methane', ra: 100.0, dec: 20.0002 },
        { id: 'star01', kind: 'star', ra: 100.002, dec: 20.001 },
        { id: 'star02', kind: 'star', ra: 100.2, dec: 20.2 },
      ];
    },
  };
  const out = identifyFromSynthetic(sky, 100, 20, 0.01);
  assert.equal(out.source, 'synthetic');
  assert.deepEqual(out.objects.map((o) => o.type), ['PM*', '*']);
  assert.equal(out.objects[0].typeLabel, 'high proper-motion star');
  assert.equal(out.objects[0].pmdec, 10370);
  assert.ok(out.objects[0].sepArcsec < out.objects[1].sepArcsec);
  assert.equal(out.objects[0].name, 'Synthetic high proper-motion star');
  assert.equal(out.objects[1].name, 'Synthetic field star star01');
  assert.equal(out.objects[1].pmdec, -20);
  assert.equal(out.objects[0].url, null);
  assert.deepEqual(identifyFromSynthetic(null, 100, 20, 0.01), { objects: [], source: 'synthetic' });
  assert.deepEqual(identifyFromSynthetic({ sourcesAt() { throw new Error('x'); } }, 100, 20, 0.01).objects, []);
});


// ---- fast movers --------------------------------------------------------------------------------

test('buildMoversQuery asks for fast movers in a wide cone', () => {
  const q = buildMoversQuery(133.7598, -7.2422);
  assert.match(q, /^SELECT TOP 60 main_id, otype, ra, dec, pmra, pmdec, plx_value, sp_type, /);
  assert.match(q, /CIRCLE\('ICRS', 133\.7598, -7\.2422, 0\.1\)\) = 1 AND pmra \* pmra \+ pmdec \* pmdec > 90000 ORDER BY dist$/);
  assert.equal(MOVER_MIN_PM, 300);
  assert.throws(() => buildMoversQuery(400, 0), /ra/i);
});

test('matchMovers: the track of a fast mover passes through the clicked position', () => {
  // WISE 0855-0714 as SIMBAD lists it (where WISE saw it in 2010), and where SPHEREx saw it in
  // November 2025, 127 arcsec to the west.
  const w0855 = { name: 'WISE J085510.83-071442.5', ra: 133.795129, dec: -7.245147, pmra: -8118, pmdec: 680 };
  // Barnard's Star at epoch 2000, and where it was in August 2025 (266 arcsec north).
  const barnard = { name: "Barnard's star", ra: 269.452075, dec: 4.693391, pmra: -802.8, pmdec: 10362.5 };
  // A fast star whose track misses the position, and one going the other way.
  const miss = { name: 'miss', ra: 133.77, dec: -7.26, pmra: 600, pmdec: 0 };
  const away = { name: 'away', ra: 133.7598 - 0.02, dec: -7.2422, pmra: -3000, pmdec: 0 };
  const slow = { name: 'slow', ra: 133.7598, dec: -7.2422, pmra: 0, pmdec: 0 };

  const hits = matchMovers([w0855, barnard, miss, away, slow], 133.759803, -7.242169, { year: 2026.9 });
  assert.deepEqual(hits.map((o) => o.name), ['WISE J085510.83-071442.5']);
  const h = hits[0];
  assert.ok(h.sepArcsec < 1.5, `distance from the track: ${h.sepArcsec}`);
  assert.ok(Math.abs(h.mover.catalogueSepArcsec - 126.6) < 1.5, `catalogue position is ${h.mover.catalogueSepArcsec} arcsec away`);
  assert.ok(Math.abs(h.mover.years - 15.5) < 0.3, `years of motion: ${h.mover.years}`);
  assert.ok(Math.abs(h.mover.epoch - 2011.4) < 0.4, `implied catalogue date: ${h.mover.epoch}`);
  assert.ok(Math.abs(h.mover.pm - 8146.4) < 1);

  const b = matchMovers([w0855, barnard], 269.44597, 4.76711, { year: 2026.9 });
  assert.deepEqual(b.map((o) => o.name), ["Barnard's star"]);
  assert.ok(Math.abs(b[0].mover.years - 25.6) < 0.4, `Barnard: ${b[0].mover.years} years from 2000`);
  // Not on the track: beyond where the star can have got to since 1990, or off to the side.
  assert.deepEqual(matchMovers([barnard], 269.44, 4.9), []);
  assert.deepEqual(matchMovers([barnard], 269.46, 4.76711, { year: 2026.9 }), []);
  assert.deepEqual(matchMovers(null, 1, 2), []);
});

test('identifyCone adds a fast mover that the small cone cannot see', async () => {
  const MOVERS_CSV = 'main_id,otype,ra,dec,pmra,pmdec,plx_value,sp_type,dist\n'
    + 'WISE J085510.83-071442.5,BD*,133.795129,-7.245147,-8118,680,439,Y4,0.0352\n'
    + 'LP 1-2,PM*,133.80,-7.30,400,-300,20,M3,0.07\n';
  const EMPTY = 'main_id,otype,ra,dec,pmra,pmdec,plx_value,sp_type,dist,vmag,kmag,ids\n';
  const calls = [];
  const fetchImpl = async (url, init) => {
    const query = new URLSearchParams(init.body).get('QUERY');
    calls.push(query);
    const body = /pmra \* pmra/.test(query) ? MOVERS_CSV : EMPTY;
    return new Response(body, { status: 200, headers: { 'content-type': 'text/csv' } });
  };
  const out = await identifyCone(133.759803, -7.242169, 12 / 3600, { fetchImpl, year: 2026.9 });
  assert.equal(calls.length, 2);
  assert.deepEqual(out.objects.map((o) => o.name), ['WISE J085510.83-071442.5']);
  assert.ok(out.objects[0].mover.catalogueSepArcsec > 120);
  assert.equal(out.objects[0].typeLabel.length > 0, true);

  // The second question failing leaves the first answer standing.
  const flaky = async (url, init) => {
    const query = new URLSearchParams(init.body).get('QUERY');
    if (/pmra \* pmra/.test(query)) return new Response('boom', { status: 500 });
    return new Response(EMPTY, { status: 200, headers: { 'content-type': 'text/csv' } });
  };
  assert.deepEqual(await identifyCone(133.759803, -7.242169, 12 / 3600, { fetchImpl: flaky }), { objects: [], source: 'simbad' });
});
