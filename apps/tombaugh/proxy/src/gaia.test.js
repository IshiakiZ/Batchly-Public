// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

import test from 'node:test';
import assert from 'node:assert/strict';

import { GAIA_PROVIDERS, gaiaCone, gaiaFromSynthetic, parseGaiaCsv } from './gaia.js';
import { UpstreamError } from './irsa.js';

const [ESA, VIZIER, IRSA] = GAIA_PROVIDERS;

// Hand-written samples in the layout each service returns.
const ESA_CSV = [
  'source_id,ra,dec,pmra,pmdec,parallax,phot_g_mean_mag',
  '4472832130942575872,269.44850252543836,4.739420051112412,-801.5509783684709,10362.394206546573,546.975939730948,8.193974',
  '4472832027863359488,269.4601,4.7012,,,,20.512',
  '4472832062223064064,269.4399,4.7101,-1.25,-3.5,0.41,15.02',
  '',
].join('\n');

const VIZIER_CSV = [
  'Source,RA_ICRS,DE_ICRS,pmRA,pmDE,Plx,Gmag',
  '4472832062223064064,269.43990000000,4.71010000000,-1.250,-3.500,0.4100,15.020000',
  '4472832130942575872,269.44850252544,4.73942005111,-801.551,10362.394,546.9759,8.193974',
  '4472832027863359488,269.46010000000,4.70120000000,,,,20.512000',
].join('\r\n');

const IRSA_CSV = [
  'source_id,ra,dec,pmra,pmdec,parallax,phot_g_mean_mag',
  '4472832130942575872,269.448502525,4.739420051,-801.551,10362.394,546.976,8.194',
  '4472832027863359488,269.4601,4.7012,null,null,null,20.512',
].join('\n');

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

test('parseGaiaCsv keeps ids as strings, maps empty cells to null and sorts by brightness', () => {
  const stars = parseGaiaCsv(ESA_CSV, ESA.columns);
  assert.equal(stars.length, 3);
  assert.deepEqual(stars[0], {
    id: '4472832130942575872',
    ra: 269.44850252543836,
    dec: 4.739420051112412,
    pmra: -801.5509783684709,
    pmdec: 10362.394206546573,
    parallax: 546.975939730948,
    gmag: 8.193974,
  });
  assert.equal(typeof stars[0].id, 'string');
  assert.deepEqual(stars.map((s) => s.gmag), [8.193974, 15.02, 20.512]);
  assert.deepEqual(stars[2], { id: '4472832027863359488', ra: 269.4601, dec: 4.7012, pmra: null, pmdec: null, parallax: null, gmag: 20.512 });
});

test('parseGaiaCsv reads the VizieR and IRSA column layouts', () => {
  const viz = parseGaiaCsv(VIZIER_CSV, VIZIER.columns);
  assert.equal(viz.length, 3);
  assert.equal(viz[0].id, '4472832130942575872');
  assert.equal(viz[0].pmdec, 10362.394);
  assert.equal(viz[0].parallax, 546.9759);
  assert.equal(viz[2].pmra, null);
  const irsa = parseGaiaCsv(IRSA_CSV, IRSA.columns);
  assert.equal(irsa.length, 2);
  assert.equal(irsa[1].parallax, null);
});

test('parseGaiaCsv applies the limit, drops rows without id or position, and rejects non-tables', () => {
  assert.equal(parseGaiaCsv(ESA_CSV, ESA.columns, 2).length, 2);
  const messy = 'source_id,ra,dec,pmra,pmdec,parallax,phot_g_mean_mag\n,1,2,,,,5\nabc,1,2,,,,5\n123,,2,,,,5\n456,1,2,,,,\n';
  assert.deepEqual(parseGaiaCsv(messy, ESA.columns), [{ id: '456', ra: 1, dec: 2, pmra: null, pmdec: null, parallax: null, gmag: null }]);
  assert.deepEqual(parseGaiaCsv('source_id,ra,dec,pmra,pmdec,parallax,phot_g_mean_mag\n', ESA.columns), []);
  assert.throws(() => parseGaiaCsv('<VOTABLE></VOTABLE>', ESA.columns), (e) => e instanceof UpstreamError && e.kind === 'parse');
  assert.throws(() => parseGaiaCsv('a,b\n1,2\n', ESA.columns), (e) => e.kind === 'parse');
});

test('the three queries name the right tables and columns', () => {
  const esa = ESA.query(269.45, 4.69, 0.1, 500);
  assert.match(esa, /^SELECT TOP 500 source_id, ra, dec, pmra, pmdec, parallax, phot_g_mean_mag FROM gaiadr3\.gaia_source WHERE/);
  assert.match(esa, /CIRCLE\('ICRS', 269\.45, 4\.69, 0\.1\)/);
  assert.match(esa, /ORDER BY phot_g_mean_mag$/);
  const viz = VIZIER.query(269.45, -4.69, 0.25, 500);
  assert.match(viz, /^SELECT TOP 500 Source, RA_ICRS, DE_ICRS, pmRA, pmDE, Plx, Gmag FROM "I\/355\/gaiadr3" WHERE/);
  assert.match(viz, /CIRCLE\('ICRS', 269\.45, -4\.69, 0\.25\)/);
  assert.match(IRSA.query(1, 2, 0.1, 500), /FROM gaia_dr3_source WHERE/);
  assert.deepEqual(GAIA_PROVIDERS.map((p) => p.endpoint), [
    'https://gea.esac.esa.int/tap-server/tap/sync',
    'https://tapvizier.cds.unistra.fr/TAPVizieR/tap/sync',
    'https://irsa.ipac.caltech.edu/TAP/sync',
  ]);
});

test('gaiaCone uses the ESA archive first and posts a CSV TAP query', async () => {
  const { fetchImpl, calls } = fetchByHost({ 'gea.esac.esa.int': () => new Response(ESA_CSV, { status: 200, headers: { 'content-type': 'text/csv' } }) });
  const result = await gaiaCone(269.45, 4.69, 0.1, { fetchImpl });
  assert.equal(result.epoch, 2016.0);
  assert.equal(result.source, 'esa');
  assert.equal(result.stars.length, 3);
  assert.equal(calls.length, 1);
  const form = new URLSearchParams(calls[0].init.body);
  assert.equal(form.get('FORMAT'), 'csv');
  assert.equal(form.get('LANG'), 'ADQL');
  assert.equal(form.get('REQUEST'), 'doQuery');
  assert.match(form.get('QUERY'), /gaiadr3\.gaia_source/);
});

test('gaiaCone falls back ESA -> VizieR -> IRSA', async () => {
  const hang = (url, init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
  const a = fetchByHost({
    'gea.esac.esa.int': () => new Response('<html><title>Maintenance</title></html>', { status: 503, headers: { 'content-type': 'text/html' } }),
    'tapvizier.cds.unistra.fr': () => new Response(VIZIER_CSV, { status: 200 }),
  });
  const viaVizier = await gaiaCone(269.45, 4.69, 0.1, { fetchImpl: a.fetchImpl });
  assert.equal(viaVizier.source, 'vizier');
  assert.equal(viaVizier.stars[0].id, '4472832130942575872');
  assert.deepEqual(a.calls.map((c) => c.host), ['gea.esac.esa.int', 'tapvizier.cds.unistra.fr']);

  const b = fetchByHost({
    'gea.esac.esa.int': hang,
    'tapvizier.cds.unistra.fr': () => new Response('<VOTABLE><INFO name="QUERY_STATUS" value="ERROR">x</INFO></VOTABLE>', { status: 200 }),
    'irsa.ipac.caltech.edu': () => new Response(IRSA_CSV, { status: 200 }),
  });
  const viaIrsa = await gaiaCone(269.45, 4.69, 0.1, { fetchImpl: b.fetchImpl, timeoutMs: 20 });
  assert.equal(viaIrsa.source, 'irsa');
  assert.equal(viaIrsa.stars.length, 2);
  assert.equal(b.calls.length, 3);
});

test('gaiaCone throws a retryable upstream error when every service fails', async () => {
  const { fetchImpl, calls } = fetchByHost({});
  await assert.rejects(gaiaCone(1, 2, 0.1, { fetchImpl }), (e) => e instanceof UpstreamError && e.status === 502 && e.retryable === true && /No Gaia service answered/.test(e.message));
  assert.equal(calls.length, 3);
});

test('gaiaCone clamps the radius to 0.25 deg and validates the position', async () => {
  const { fetchImpl, calls } = fetchByHost({ 'gea.esac.esa.int': () => new Response(ESA_CSV, { status: 200 }) });
  await gaiaCone(10, 20, 5, { fetchImpl });
  assert.match(new URLSearchParams(calls[0].init.body).get('QUERY'), /CIRCLE\('ICRS', 10, 20, 0\.25\)/);
  await assert.rejects(gaiaCone(10, 120, 0.1, { fetchImpl }), (e) => e.status === 400);
  assert.equal(calls.length, 1);
});

test('gaiaFromSynthetic cuts the catalogue of the fake sky to the cone', () => {
  const sky = {
    gaia: () => ({
      epoch: 2016.0,
      stars: [
        { id: '990000000001001', ra: 10.0, dec: 20.0, pmra: 5, pmdec: -3, parallax: null, gmag: 12.5 },
        { id: '990000000002002', ra: 10.01, dec: 20.01, pmra: 0.1, pmdec: 0.2, parallax: null, gmag: 9.1 },
        { id: '990000000003003', ra: 11.0, dec: 20.0, pmra: 0, pmdec: 0, parallax: null, gmag: 5 },
      ],
    }),
    sourcesAt: () => {
      throw new Error('not used when gaia() exists');
    },
  };
  const { epoch, stars, source } = gaiaFromSynthetic(sky, 10, 20, 0.05);
  assert.equal(epoch, 2016.0);
  assert.equal(source, 'synthetic');
  assert.deepEqual(stars.map((s) => s.id), ['990000000002002', '990000000001001']);
  assert.equal(stars[1].pmra, 5);
  assert.equal(stars[1].parallax, null);
  assert.equal(gaiaFromSynthetic(sky, 10, 20, 0.05, 1).stars.length, 1);
});

test('gaiaFromSynthetic derives stars from sourcesAt when the sky has no catalogue', () => {
  let askedMjd = 0;
  const sky = {
    sourcesAt: (mjd) => {
      askedMjd = mjd;
      return [
        { id: 'star01', ra: 10.0, dec: 20.0, gmag: 12.5 },
        { id: 'star02', ra: 10.01, dec: 20.01 },
        { id: 'far', ra: 11.0, dec: 20.0 },
        { id: 'methane', ra: 10.0, dec: 20.002, inGaia: false },
        null,
        { ra: 'x', dec: 20 },
      ];
    },
  };
  const { stars } = gaiaFromSynthetic(sky, 10, 20, 0.05);
  assert.equal(askedMjd, 57388.5); // J2016.0
  assert.equal(stars.length, 2);
  assert.ok(stars.every((s) => typeof s.id === 'string' && /^\d+$/.test(s.id)));
  assert.notEqual(stars[0].id, stars[1].id);
  assert.equal(stars[0].gmag, 12.5); // known magnitudes first
  assert.deepEqual({ pmra: stars[1].pmra, parallax: stars[1].parallax, gmag: stars[1].gmag }, { pmra: null, parallax: null, gmag: null });
  assert.deepEqual(gaiaFromSynthetic(null, 10, 20, 0.05).stars, []);
});
