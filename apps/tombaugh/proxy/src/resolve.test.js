// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  BUILTIN_SOURCE,
  BUILTIN_TARGETS,
  buildSimbadQuery,
  cleanName,
  normalizeName,
  parseSesameXml,
  parseSimbadCsv,
  resolveBuiltin,
  resolveName,
  resetResolveBreaker,
} from './resolve.js';
import { UpstreamError } from './irsa.js';

// Every test starts with Strasbourg assumed reachable.
beforeEach(() => resetResolveBreaker());

// Hand-written in the layout Sesame returns for "-oxp/SNV".
const SESAME_BARNARD = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Sesame xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://vizier.u-strasbg.fr/xml/sesame_4x.xsd">
<Target option="SNV">
  <name>Barnard's star</name>
  <!-- Q13534599 #1 -->
  <Resolver name="S=Simbad (CDS, via client/server)"><!--delay: 34ms [1] -->
    <otype>PM*</otype>
    <jpos>17:57:48.49 +04:41:36.1</jpos>
    <jradeg>269.4520769</jradeg>
    <jdedeg>4.6933649</jdedeg>
    <refPos>2020yCat.1350....0G</refPos>
    <errRAmas>0.0260</errRAmas><errDEmas>0.0290</errDEmas>
    <pm><v>10393.3</v><e>0.04</e><q>A</q><r>2020yCat.1350....0G</r><pa>356</pa>
      <pmRA>-801.551</pmRA><epmRA>0.032</epmRA>
      <pmDE>10362.394</pmDE><epmDE>0.036</epmDE></pm>
    <Vel><v>-110.47</v><e>0.13</e><q>A</q><r>2018A&amp;A...616A...7S</r></Vel>
    <plx><v>546.9759</v><e>0.0401</e><q>A</q><r>2020yCat.1350....0G</r></plx>
    <MType>M4V</MType>
    <oname>NAME Barnard's star</oname>
  </Resolver>
</Target>
</Sesame>`;

const SESAME_NOTHING = `<?xml version="1.0" encoding="UTF-8"?>
<Sesame>
<Target option="SNV">
  <name>zzzz qqqq</name>
  <Resolver name="S=Simbad (CDS, via client/server)">
    <INFO>*** Nothing found ***</INFO>
  </Resolver>
  <Resolver name="N=NED (NASA/IPAC Extragalactic Database)">
    <INFO>*** Nothing found ***</INFO>
  </Resolver>
  <Resolver name="V=VizieR (CDS)">
    <INFO>*** Nothing found ***</INFO>
  </Resolver>
</Target>
</Sesame>`;

const SESAME_NED_ONLY = `<?xml version="1.0"?>
<Sesame>
<Target option="SNV">
  <name>M 101</name>
  <Resolver name="S=Simbad"><INFO>*** Nothing found ***</INFO></Resolver>
  <Resolver name="N=NED">
    <otype>G</otype>
    <jradeg>210.80227</jradeg>
    <jdedeg>+54.34895</jdedeg>
    <oname>MESSIER 101</oname>
  </Resolver>
</Target>
</Sesame>`;

const SESAME_WISE = `<?xml version="1.0"?>
<Sesame><Target option="SNV"><name>WISE 0855-0714</name>
  <Resolver name="S=Simbad">
    <jradeg>133.7951292</jradeg><jdedeg>-7.2451472</jdedeg>
    <pm><pmRA>-8123.7</pmRA><pmDE>673.2</pmDE></pm>
    <oname>WISEA J085510.74-071442.5</oname>
  </Resolver></Target></Sesame>`;

const SIMBAD_CSV = 'main_id,ra,dec,pmra,pmdec,plx_value\n"NAME Barnard\'s star",269.45207695833,4.69336496944,-801.551,10362.394,546.9759\n';

function fetchByHost(routes) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const host = new URL(url).hostname;
    calls.push({ url: String(url), host, init });
    const route = routes[host];
    if (!route) throw new TypeError(`no fake for ${host}`);
    return route(url, init);
  };
  return { fetchImpl, calls };
}
const xml = (body, status = 200) => () => new Response(body, { status, headers: { 'content-type': 'text/xml' } });
const hang = (url, init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));

test('normalizeName ignores case, punctuation, spacing and spells epsilon one way', () => {
  assert.equal(normalizeName("Barnard's Star"), 'barnardsstar');
  assert.equal(normalizeName('  BARNARDS   star '), 'barnardsstar');
  assert.equal(normalizeName('ε Indi B'), 'epsindib');
  assert.equal(normalizeName('Epsilon Indi B'), 'epsindib');
  assert.equal(normalizeName('WISE 0855−0714'), 'wise08550714');
  assert.equal(cleanName('  a\tb\u0000c  '), 'a b c');
  assert.equal(cleanName(42), '');
  assert.equal(cleanName('x'.repeat(200)).length, 80);
});

test('the built-in table knows the five challenge targets and their aliases', () => {
  assert.equal(BUILTIN_TARGETS.length, 5);
  const barnard = resolveBuiltin("barnard's star");
  assert.deepEqual(barnard, {
    name: "Barnard's Star",
    ra: 269.452075,
    dec: 4.693391,
    epoch: 2000.0,
    pmra: -802.8,
    pmdec: 10362.5,
    parallax: 547.0,
    source: BUILTIN_SOURCE,
  });
  assert.equal(BUILTIN_SOURCE, 'builtin (approximate)');
  for (const alias of ['Barnards Star', 'GJ 699', 'gj699', 'BARNARD']) assert.equal(resolveBuiltin(alias).name, "Barnard's Star", alias);
  for (const alias of ['Epsilon Indi B', 'eps Indi Ba Bb', 'ε Indi Bab', 'eps Ind B', 'epsilon indi ba,bb']) {
    const t = resolveBuiltin(alias);
    assert.equal(t.name, 'Epsilon Indi B', alias);
    assert.equal(t.ra, 331.0438);
    assert.equal(t.dec, -56.7827);
    assert.equal(t.pmra, 3960.9);
    assert.equal(t.pmdec, -2539.2);
    assert.equal(t.parallax, 274.8);
  }
  for (const alias of ['WISE 0855-0714', 'wise0855', 'WISE J085510.83-071442.5', 'W0855', 'WISE 0855−0714']) {
    const t = resolveBuiltin(alias);
    assert.equal(t.name, 'WISE 0855-0714', alias);
    // 08h55m10.831s -07d14m42.53s
    assert.ok(Math.abs(t.ra - 133.7951292) < 1e-6);
    assert.ok(Math.abs(t.dec - -7.2451472) < 1e-6);
    assert.equal(t.epoch, 2014.3);
    assert.equal(t.pmra, -8118);
    assert.equal(t.pmdec, 680);
    assert.equal(t.parallax, 439);
  }
  const rw = resolveBuiltin('rw aur');
  assert.deepEqual([rw.ra, rw.dec, rw.pmra], [76.95642, 30.40142, null]);
  const rdra = resolveBuiltin('R Draconis');
  assert.deepEqual([rdra.ra, rdra.dec, rdra.epoch], [248.16763, 66.75497, 2000.0]);
  assert.equal(resolveBuiltin('Vega'), null);
  assert.equal(resolveBuiltin(''), null);
});

test('parseSesameXml reads position, proper motion, parallax and name', () => {
  assert.deepEqual(parseSesameXml(SESAME_BARNARD), {
    name: "Barnard's star",
    ra: 269.4520769,
    dec: 4.6933649,
    pmra: -801.551,
    pmdec: 10362.394,
    parallax: 546.9759,
  });
  assert.deepEqual(parseSesameXml(SESAME_NED_ONLY, 'M 101'), { name: 'MESSIER 101', ra: 210.80227, dec: 54.34895, pmra: null, pmdec: null, parallax: null });
  assert.equal(parseSesameXml(SESAME_NOTHING), null);
  assert.throws(() => parseSesameXml('<html><title>503</title></html>'), (e) => e instanceof UpstreamError && e.kind === 'parse');
  assert.throws(() => parseSesameXml(''), (e) => e.kind === 'parse');
});

test('parseSimbadCsv and buildSimbadQuery', () => {
  assert.deepEqual(parseSimbadCsv(SIMBAD_CSV), {
    name: "Barnard's star",
    ra: 269.45207695833,
    dec: 4.69336496944,
    pmra: -801.551,
    pmdec: 10362.394,
    parallax: 546.9759,
  });
  assert.equal(parseSimbadCsv('main_id,ra,dec,pmra,pmdec,plx_value\n'), null);
  assert.deepEqual(parseSimbadCsv('main_id,ra,dec,pmra,pmdec,plx_value\n"* alf Lyr",279.2347,38.7837,,,\n', 'Vega'), {
    name: '* alf Lyr',
    ra: 279.2347,
    dec: 38.7837,
    pmra: null,
    pmdec: null,
    parallax: null,
  });
  assert.throws(() => parseSimbadCsv('<VOTABLE/>'), (e) => e.kind === 'parse');
  const q = buildSimbadQuery("Barnard's Star");
  assert.match(q, /WHERE i\.id = 'Barnard''s Star' OR i\.id = 'NAME Barnard''s Star'$/);
});

test('resolveName prefers Sesame and reports its values at epoch 2000', async () => {
  const { fetchImpl, calls } = fetchByHost({ 'cds.unistra.fr': xml(SESAME_BARNARD) });
  const r = await resolveName("Barnard's Star", { fetchImpl });
  assert.deepEqual(r, {
    name: "Barnard's star",
    ra: 269.4520769,
    dec: 4.6933649,
    epoch: 2000.0,
    pmra: -801.551,
    pmdec: 10362.394,
    parallax: 546.9759,
    source: 'sesame',
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://cds.unistra.fr/cgi-bin/nph-sesame/-oxp/SNV?Barnard's%20Star");
});

test('resolveName falls back to the built-in table when Sesame is down or slow', async () => {
  const down = fetchByHost({ 'cds.unistra.fr': xml('<html>Service unavailable</html>', 503) });
  const a = await resolveName('barnards star', { fetchImpl: down.fetchImpl });
  assert.equal(a.source, 'builtin (approximate)');
  assert.equal(a.ra, 269.452075);
  // Sesame answered with an error page: SIMBAD and then its CfA mirror are tried before the table.
  assert.deepEqual(down.calls.map((c) => new URL(c.url).hostname), ['cds.unistra.fr', 'simbad.cds.unistra.fr', 'simbad.harvard.edu']);
  // While Strasbourg is marked as down, the next name goes straight to the mirror.
  const next = fetchByHost({ 'simbad.harvard.edu': () => new Response('main_id,ra,dec,pmra,pmdec,plx_value\n"* alf Lyr",279.23473479,38.78368896,200.94,286.23,130.23\n', { status: 200 }) });
  const vega = await resolveName('Vega', { fetchImpl: next.fetchImpl });
  assert.equal(vega.source, 'simbad (CfA mirror)');
  assert.equal(next.calls.length, 1);
  resetResolveBreaker();

  const slow = fetchByHost({ 'cds.unistra.fr': hang });
  const b = await resolveName('WISE 0855-0714', { fetchImpl: slow.fetchImpl, timeoutMs: 20 });
  assert.equal(b.source, 'builtin (approximate)');
  assert.equal(b.epoch, 2014.3);
});

test('resolveName merges Sesame with the built-in entry: missing values and the known epoch', async () => {
  const { fetchImpl } = fetchByHost({ 'cds.unistra.fr': xml(SESAME_WISE) });
  const r = await resolveName('WISE 0855-0714', { fetchImpl });
  assert.equal(r.source, 'sesame');
  assert.equal(r.pmra, -8123.7);
  assert.equal(r.parallax, 439); // Sesame gave none
  assert.equal(r.epoch, 2014.3); // same position as the built-in entry, whose epoch is known
});

test('resolveName uses SIMBAD TAP when Sesame fails for a name that is not built in', async () => {
  const { fetchImpl, calls } = fetchByHost({
    'cds.unistra.fr': xml('oops', 500),
    'simbad.cds.unistra.fr': () => new Response('main_id,ra,dec,pmra,pmdec,plx_value\n"* alf Lyr",279.23473479,38.78368896,200.94,286.23,130.23\n', { status: 200 }),
  });
  const r = await resolveName('Vega', { fetchImpl });
  assert.deepEqual(r, { name: '* alf Lyr', ra: 279.23473479, dec: 38.78368896, epoch: 2000.0, pmra: 200.94, pmdec: 286.23, parallax: 130.23, source: 'simbad' });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, 'https://simbad.cds.unistra.fr/simbad/sim-tap/sync');
  assert.match(new URLSearchParams(calls[1].init.body).get('QUERY'), /i\.id = 'Vega'/);
});

test('resolveName returns null for unknown names and throws when the services are unreachable', async () => {
  const unknown = fetchByHost({ 'cds.unistra.fr': xml(SESAME_NOTHING) });
  assert.equal(await resolveName('zzzz qqqq', { fetchImpl: unknown.fetchImpl }), null);
  assert.equal(unknown.calls.length, 1);

  const dead = fetchByHost({});
  await assert.rejects(resolveName('Vega', { fetchImpl: dead.fetchImpl }), (e) => e instanceof UpstreamError && e.retryable === true);
  assert.equal(dead.calls.length, 2); // Sesame gave no answer at all, so straight to the CfA mirror

  assert.equal(await resolveName('', { fetchImpl: dead.fetchImpl }), null);
  assert.equal(await resolveName('   ', { fetchImpl: dead.fetchImpl }), null);
});

test('resolveName offline answers from the table only and never calls fetch', async () => {
  let called = 0;
  const fetchImpl = async () => {
    called++;
    throw new Error('network is off limits');
  };
  assert.equal((await resolveName('R Dra', { fetchImpl, offline: true })).name, 'R Draconis');
  assert.equal(await resolveName('Vega', { fetchImpl, offline: true }), null);
  assert.equal(called, 0);
});
