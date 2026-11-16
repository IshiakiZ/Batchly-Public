// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  HORIZONS_MAX_STEPS,
  HORIZONS_URL,
  HorizonsError,
  buildHorizonsUrl,
  ephemerisRoute,
  horizonsCommand,
  horizonsEphemeris,
  parseHorizonsText,
  planRequest,
  validateBody,
} from './horizons.js';

// ---- sample answers, built from the format measured on the live service -----------------------

const STARS = '*******************************************************************************';

function ephemerisText({ target, header, rows }) {
  return [
    'API VERSION: 1.2',
    'API SOURCE: NASA/JPL Horizons API',
    '',
    STARS,
    ' Ephemeris / API_USER Sun Nov 15 07:12:03 2026 Pasadena, USA      / Horizons',
    STARS,
    `Target body name: ${target}`,
    'Center body name: Earth (399)                     {source: DE441}',
    'Center-site name: GEOCENTRIC',
    STARS,
    'Start time      : A.D. 2025-Aug-01 00:00:00.0000 UT',
    'Stop  time      : A.D. 2025-Aug-03 00:00:00.0000 UT',
    'Step-size       : 720 minutes',
    STARS,
    header,
    '**************************************************************************************************',
    '$$SOE',
    ...rows,
    '$$EOE',
    '**************************************************************************************************',
    'Column meaning:',
    '',
    "  'R.A._(ICRF), DEC_(ICRF)' = Astrometric right ascension and declination of the target center.",
    "  'delta,     deldot' = Apparent range (\"delta\", light-time aberrated) and range-rate.",
    STARS,
  ].join('\n');
}

const PLUTO_HEADER = ' Date_________JDUT, , , R.A._(ICRF), DEC_(ICRF),    APmag,  S-brt,             delta,     deldot,';
const PLUTO_TEXT = ephemerisText({
  target: 'Pluto (999)                       {source: plu060l_merged}',
  header: PLUTO_HEADER,
  rows: [
    '2460888.500000000, , ,   305.24572,  -23.36170,   14.426,  9.064,  34.3097620607833,  4.7550001,',
    '2460889.000000000, , ,   305.23295,  -23.36452,   14.426,  9.064,  34.3111427195021,  4.8103172,',
    '2460889.500000000, , ,   305.22020,  -23.36733,   14.427,  9.064,  34.3125398512846,  4.8658930,',
    '2460890.000000000, , ,   305.20746,  -23.37014,   14.427,  9.064,  34.3139529402214,  4.9212045,',
    '2460890.500000000, , ,   305.19473,  -23.37295,   14.427,  9.064,  34.3153823866310,  4.9767603,',
  ],
});

// A comet: Horizons prints total and nuclear magnitudes instead of APmag and S-brt, and "n.a."
// where it has no magnitude model.
const ATLAS_TEXT = ephemerisText({
  target: 'ATLAS (C/2025 N1)                 {source: JPL#32}',
  header: ' Date_________JDUT, , , R.A._(ICRF), DEC_(ICRF),    T-mag,   N-mag,             delta,     deldot,',
  rows: [
    '2460897.500000000, , ,   246.71065,  -16.78818,   17.750,    n.a.,  2.70500000000000, -45.1000000,',
    '2460898.000000000,*,m,   246.43310,  -16.71201,    n.a.,    n.a.,  2.69201000000000, -44.9000000,',
    '2460898.500000000, , ,   246.15700,  -16.63622,   17.702,    n.a.,  2.67905000000000, -44.7000000,',
  ],
});

const AMBIGUOUS_MAJOR = [
  'API VERSION: 1.2',
  'API SOURCE: NASA/JPL Horizons API',
  '',
  STARS,
  ' Multiple major-bodies match string "PLUTO*"',
  '',
  '  ID#      Name                               Designation  IAU/aliases/other',
  '  -------  ---------------------------------- -----------  -------------------',
  '        9  Pluto Barycenter',
  '      999  Pluto                                           134340',
  '',
  '   Number of matches =  2. Use ID# to make unique selection.',
  STARS,
].join('\n');

const AMBIGUOUS_SMALL = [
  'API VERSION: 1.2',
  'API SOURCE: NASA/JPL Horizons API',
  '',
  STARS,
  'JPL/DASTCOM            Small-body Index Search Results     2026-Nov-15 07:13:11',
  '',
  ' Comet AND asteroid index search:',
  '',
  '    NAME = ATLAS*',
  '',
  ' Matching small-bodies:',
  '',
  '    Record #  Epoch-yr  >MATCH DESIG<  Primary Desig  Name',
  '    --------  --------  -------------  -------------  -------------------------',
  '    90004481    2020    C/2019 Y4      C/2019 Y4       ATLAS',
  '    90004523    2021    C/2020 R4      C/2020 R4       ATLAS',
  '    90004812    2025    C/2024 G3      C/2024 G3       ATLAS',
  '    90004901    2025    C/2025 N1      C/2025 N1       ATLAS',
  '',
  ' (4 matches. To SELECT, enter record # (integer), followed by semi-colon.)',
  STARS,
].join('\n');

const NOT_FOUND_TEXT = [
  'API VERSION: 1.2',
  'API SOURCE: NASA/JPL Horizons API',
  '',
  STARS,
  'JPL/DASTCOM            Small-body Index Search Results     2026-Nov-15 07:13:40',
  '',
  ' Comet AND asteroid index search:',
  '',
  '    NAME = NIBIRU;',
  '',
  ' Matching small-bodies:',
  '    No matches found.',
  STARS,
].join('\n');

function fakeFetch(text, { status = 200, calls = [] } = {}) {
  return async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(text, { status, headers: { 'content-type': 'text/plain' } });
  };
}

// ---- body validation and command mapping ------------------------------------------------------

test('validateBody accepts names, numbers and designations and tidies spaces', () => {
  assert.equal(validateBody('  Pluto '), 'Pluto');
  assert.equal(validateBody('3I/ATLAS'), '3I/ATLAS');
  assert.equal(validateBody('DES=C/2025   N1;'), 'DES=C/2025 N1;');
  assert.equal(validateBody('2003 VB12'), '2003 VB12');
  assert.equal(validateBody('136199;'), '136199;');
});

test('validateBody rejects quotes, other punctuation, empty and long text', () => {
  const bad = [
    "Pluto'", "999'&CENTER='500@10", 'Pluto"', 'a&b', 'a?b', 'a%27b', 'Pluto\n999', 'a*', 'a(b)', 'a.b',
    'a,b', 'a+b', 'a#b', 'a:b', '', '   ', 'x'.repeat(41),
  ];
  for (const text of bad) {
    assert.throws(() => validateBody(text), (err) => err instanceof HorizonsError && err.code === 'BAD_REQUEST' && err.status === 400, JSON.stringify(text));
  }
  for (const notText of [null, undefined, 42, {}, ['Pluto']]) {
    assert.throws(() => validateBody(notText), (err) => err.code === 'BAD_REQUEST');
  }
  assert.equal(validateBody('x'.repeat(40)).length, 40);
});

test('horizonsCommand maps the built-in table', () => {
  const expected = {
    Pluto: '999',
    pluto: '999',
    Eris: '136199;',
    Makemake: '136472;',
    Haumea: '136108;',
    Sedna: 'Sedna;',
    Gonggong: '225088;',
    Quaoar: '50000;',
    Orcus: '90482;',
    Ceres: 'Ceres;',
    Vesta: '4;',
    Pallas: '2;',
    Hygiea: '10;',
    Chiron: '2060;',
    '3I/ATLAS': 'DES=C/2025 N1;',
    '3I': 'DES=C/2025 N1;',
    '3i atlas': 'DES=C/2025 N1;',
    'C/2025 N1': 'DES=C/2025 N1;',
    Neptune: '899',
  };
  for (const [name, command] of Object.entries(expected)) assert.equal(horizonsCommand(name), command, name);
});

test('horizonsCommand: numbers, ready-made commands and other names', () => {
  assert.equal(horizonsCommand('999'), '999');          // major-body id
  assert.equal(horizonsCommand('599'), '599');
  assert.equal(horizonsCommand('136199'), '136199;');   // numbered small body
  assert.equal(horizonsCommand('136199;'), '136199;');
  assert.equal(horizonsCommand('DES=C/2025 N1;'), 'DES=C/2025 N1;');
  assert.equal(horizonsCommand('Varuna'), 'Varuna;');
  assert.equal(horizonsCommand('2003 VB12'), '2003 VB12;');
  assert.equal(horizonsCommand('DES=1P;CAP'), 'DES=1P;CAP');
  assert.equal(horizonsCommand('Eris;'), 'Eris;');
});

test('horizonsCommand refuses Triton with a reason', () => {
  assert.throws(() => horizonsCommand('Triton'), (err) => err.code === 'UNSUPPORTED' && err.status === 400 && /Neptune/.test(err.message));
  assert.throws(() => horizonsCommand('triton;'), (err) => err.code === 'UNSUPPORTED');
  assert.throws(() => horizonsCommand("Pluto'"), (err) => err.code === 'BAD_REQUEST');
});

// ---- request planning -------------------------------------------------------------------------

test('planRequest rounds to whole days and keeps the verified step format', () => {
  const plan = planRequest({ startMjd: 60888, endMjd: 60890, stepHours: 12 });
  assert.equal(plan.start, '2025-08-01');
  assert.equal(plan.stop, '2025-08-03');
  assert.equal(plan.stepSize, '12 h');
  assert.equal(plan.steps, 5);
  const frac = planRequest({ startMjd: 60888.7, endMjd: 60889.2, stepHours: 0.5 });
  assert.equal(frac.start, '2025-08-01');
  assert.equal(frac.stop, '2025-08-03');
  assert.equal(frac.stepSize, '30 m');
  assert.equal(planRequest({ startMjd: 60888, endMjd: 60988, stepHours: 24 }).stepSize, '1 d');
  assert.equal(planRequest({ startMjd: 60888, endMjd: 60888, stepHours: 6 }).stop, '2025-08-02');
});

test('planRequest widens the step so that at most 3000 rows are requested', () => {
  const plan = planRequest({ startMjd: 60770, endMjd: 61370, stepHours: 1 });
  assert.ok(plan.steps <= HORIZONS_MAX_STEPS + 1, `steps ${plan.steps}`);
  assert.ok(plan.stepHours >= 4.8, `step ${plan.stepHours}`);
  assert.equal(plan.stepMinutes % 60, 0);
  assert.match(plan.stepSize, /^\d+ h$/);
  // the survey span at the default step needs no widening
  const normal = planRequest({ startMjd: 60770, endMjd: 61370, stepHours: 12 });
  assert.equal(normal.stepSize, '12 h');
  assert.equal(normal.steps, 1201);
  // nonsense steps fall back to something sane
  assert.equal(planRequest({ startMjd: 60770, endMjd: 60780, stepHours: -3 }).stepSize, '12 h');
  assert.equal(planRequest({ startMjd: 60770, endMjd: 60780, stepHours: NaN }).stepSize, '12 h');
});

test('planRequest rejects bad ranges', () => {
  for (const range of [
    { startMjd: NaN, endMjd: 60780 },
    { startMjd: 60780, endMjd: 60770 },
    { startMjd: 60770, endMjd: 60770 + 5000 },
    { startMjd: 100, endMjd: 200 },
    { startMjd: 60770, endMjd: 2460888.5 },
  ]) {
    assert.throws(() => planRequest(range), (err) => err.code === 'BAD_REQUEST', JSON.stringify(range));
  }
});

test('buildHorizonsUrl produces exactly the verified query', () => {
  const url = buildHorizonsUrl('999', planRequest({ startMjd: 60888, endMjd: 60890, stepHours: 12 }));
  assert.ok(url.startsWith(`${HORIZONS_URL}?format=text&`));
  const params = new URL(url).searchParams;
  const expected = {
    format: 'text',
    COMMAND: "'999'",
    OBJ_DATA: "'NO'",
    MAKE_EPHEM: "'YES'",
    EPHEM_TYPE: "'OBSERVER'",
    CENTER: "'500@399'",
    START_TIME: "'2025-08-01'",
    STOP_TIME: "'2025-08-03'",
    STEP_SIZE: "'12 h'",
    QUANTITIES: "'1,9,20'",
    ANG_FORMAT: "'DEG'",
    CSV_FORMAT: "'YES'",
    CAL_FORMAT: "'JD'",
  };
  assert.deepEqual(Object.fromEntries(params.entries()), expected);
  // quotes, spaces, '@', ';', '=' and '/' are percent-encoded: nothing can leak into the query
  const raw = buildHorizonsUrl('DES=C/2025 N1;', planRequest({ startMjd: 60888, endMjd: 60890 }));
  const query = raw.slice(raw.indexOf('?') + 1);
  assert.ok(!/['\s;@]/.test(query), query);
  assert.ok(query.includes('COMMAND=%27DES%3DC%2F2025%20N1%3B%27'), query);
});

// ---- parsing ----------------------------------------------------------------------------------

test('parseHorizonsText reads the verified Pluto rows', () => {
  const out = parseHorizonsText(PLUTO_TEXT);
  assert.equal(out.name, 'Pluto (999)');
  assert.equal(out.samples.length, 5);
  assert.deepEqual(out.samples[0], [60888, 305.24572, -23.3617, 34.3097620607833, 14.426]);
  assert.equal(out.samples[1][0], 60888.5);
  assert.equal(out.samples[4][0], 60890);
  for (const s of out.samples) assert.equal(s.length, 5);
});

test('parseHorizonsText turns n.a. magnitudes into null and keeps flagged rows', () => {
  const out = parseHorizonsText(ATLAS_TEXT);
  assert.equal(out.name, 'ATLAS (C/2025 N1)');
  assert.equal(out.samples.length, 3);
  assert.deepEqual(out.samples[0], [60897, 246.71065, -16.78818, 2.705, 17.75]);
  assert.equal(out.samples[1][4], null);      // n.a. total magnitude
  assert.equal(out.samples[1][1], 246.4331);  // the row with daylight/moon flags is still read
  assert.equal(out.samples[2][4], 17.702);
});

test('parseHorizonsText is robust to CRLF, blank lines, junk rows and a missing header', () => {
  const crlf = PLUTO_TEXT.replace(/\n/g, '\r\n').replace('$$SOE\r\n', () => '$$SOE\r\n\r\n>..... Daylight Cut-off Requested .....<\r\n');
  assert.equal(parseHorizonsText(crlf).samples.length, 5);
  // no column header at all: fixed positions are used
  const bare = '$$SOE\n2460888.500000000, , ,   305.24572,  -23.36170,   n.a.,  n.a.,  34.3097620607833,  4.7550001,\n$$EOE\n';
  const out = parseHorizonsText(bare);
  assert.deepEqual(out.samples, [[60888, 305.24572, -23.3617, 34.3097620607833, null]]);
  assert.equal(out.name, '');
  // a different column order is followed through the header line
  const swapped = ephemerisText({
    target: 'Pluto (999)',
    header: ' Date_________JDUT, , ,             delta,     deldot, R.A._(ICRF), DEC_(ICRF),    APmag,  S-brt,',
    rows: ['2460888.500000000, , ,  34.3097620607833,  4.7550001,   305.24572,  -23.36170,   14.426,  9.064,'],
  });
  assert.deepEqual(parseHorizonsText(swapped).samples[0], [60888, 305.24572, -23.3617, 34.3097620607833, 14.426]);
  // no $$EOE (truncated answer): rows so far are kept
  const cut = PLUTO_TEXT.slice(0, PLUTO_TEXT.indexOf('$$EOE'));
  assert.equal(parseHorizonsText(cut).samples.length, 5);
});

test('parseHorizonsText: several matches give AMBIGUOUS with the table of candidates', () => {
  assert.throws(() => parseHorizonsText(AMBIGUOUS_MAJOR), (err) => {
    assert.equal(err.code, 'AMBIGUOUS');
    assert.equal(err.status, 409);
    assert.equal(err.retryable, false);
    assert.match(err.matches, /Pluto Barycenter/);
    assert.match(err.matches, /999\s+Pluto/);
    assert.ok(!err.matches.includes('API VERSION'));
    assert.ok(err.matches.length <= 903);
    return true;
  });
  assert.throws(() => parseHorizonsText(AMBIGUOUS_SMALL), (err) => {
    assert.equal(err.code, 'AMBIGUOUS');
    assert.match(err.matches, /^\s*Record #/);
    assert.match(err.matches, /C\/2025 N1/);
    return true;
  });
});

test('parseHorizonsText: no match gives NOT_FOUND; anything else gives UPSTREAM', () => {
  assert.throws(() => parseHorizonsText(NOT_FOUND_TEXT), (err) => err.code === 'NOT_FOUND' && err.status === 404 && /No matches found/.test(err.matches));
  assert.throws(() => parseHorizonsText('<html><body>502 Bad Gateway</body></html>'), (err) => err.code === 'UPSTREAM' && err.retryable === true);
  assert.throws(() => parseHorizonsText(''), (err) => err.code === 'UPSTREAM');
  assert.throws(() => parseHorizonsText('$$SOE\nnot, a, row\n$$EOE'), (err) => err.code === 'UPSTREAM');
});

// ---- the whole call, with a fake fetch --------------------------------------------------------

test('horizonsEphemeris returns the contract shape and sends the verified query', async () => {
  const calls = [];
  const out = await horizonsEphemeris('Pluto', { startMjd: 60888, endMjd: 60890, stepHours: 12, fetchImpl: fakeFetch(PLUTO_TEXT, { calls }) });
  assert.equal(out.body, 'Pluto');
  assert.equal(out.name, 'Pluto (999)');
  assert.equal(out.source, 'JPL Horizons');
  assert.equal(out.center, 'geocentric');
  assert.equal(out.command, '999');
  assert.equal(out.samples.length, 5);
  assert.deepEqual(out.samples[0], [60888, 305.24572, -23.3617, 34.3097620607833, 14.426]);
  assert.equal(calls.length, 1);
  const params = new URL(calls[0].url).searchParams;
  assert.equal(params.get('COMMAND'), "'999'");
  assert.equal(params.get('START_TIME'), "'2025-08-01'");
  assert.equal(params.get('STOP_TIME'), "'2025-08-03'");
  assert.equal(params.get('STEP_SIZE'), "'12 h'");
  assert.equal(calls[0].init.method, 'GET');
  assert.ok(calls[0].init.signal instanceof AbortSignal);
  JSON.stringify(out); // serialisable
});

test('horizonsEphemeris handles the interstellar comet with n.a. magnitudes', async () => {
  const calls = [];
  const out = await horizonsEphemeris('3I/ATLAS', { startMjd: 60897, endMjd: 60898, fetchImpl: fakeFetch(ATLAS_TEXT, { calls }) });
  assert.equal(out.name, 'ATLAS (C/2025 N1)');
  assert.equal(out.command, 'DES=C/2025 N1;');
  assert.equal(new URL(calls[0].url).searchParams.get('COMMAND'), "'DES=C/2025 N1;'");
  assert.deepEqual(out.samples.map((s) => s[4]), [17.75, null, 17.702]);
  assert.equal(out.samples[0][3], 2.705);
});

test('horizonsEphemeris defaults to the survey span up to today', async () => {
  const calls = [];
  await horizonsEphemeris('Eris', { fetchImpl: fakeFetch(PLUTO_TEXT, { calls }) });
  const params = new URL(calls[0].url).searchParams;
  assert.equal(params.get('START_TIME'), "'2025-04-05'"); // MJD 60770
  assert.match(params.get('STOP_TIME'), /^'20\d\d-\d\d-\d\d'$/);
  assert.equal(params.get('COMMAND'), "'136199;'");
});

test('horizonsEphemeris reports ambiguous and unknown names without retrying', async () => {
  const calls = [];
  await assert.rejects(
    horizonsEphemeris('ATLAS', { startMjd: 60888, endMjd: 60890, fetchImpl: fakeFetch(AMBIGUOUS_SMALL, { calls }) }),
    (err) => err instanceof HorizonsError && err.code === 'AMBIGUOUS' && /C\/2019 Y4/.test(err.matches),
  );
  assert.equal(calls.length, 1);
  await assert.rejects(
    horizonsEphemeris('Nibiru', { startMjd: 60888, endMjd: 60890, fetchImpl: fakeFetch(NOT_FOUND_TEXT) }),
    (err) => err.code === 'NOT_FOUND',
  );
});

test('horizonsEphemeris never calls the network for a bad body or range', async () => {
  const calls = [];
  const fetchImpl = fakeFetch(PLUTO_TEXT, { calls });
  await assert.rejects(horizonsEphemeris("999'&COMMAND='10", { fetchImpl }), (err) => err.code === 'BAD_REQUEST');
  await assert.rejects(horizonsEphemeris('Triton', { fetchImpl }), (err) => err.code === 'UNSUPPORTED');
  await assert.rejects(horizonsEphemeris('Pluto', { startMjd: 61000, endMjd: 60000, fetchImpl }), (err) => err.code === 'BAD_REQUEST');
  assert.equal(calls.length, 0);
});

test('horizonsEphemeris maps HTTP failures, network failures and timeouts to UPSTREAM', async () => {
  await assert.rejects(
    horizonsEphemeris('Pluto', { startMjd: 60888, endMjd: 60890, fetchImpl: fakeFetch('Service Unavailable', { status: 503 }) }),
    (err) => err.code === 'UPSTREAM' && err.retryable === true && err.status === 502 && /503/.test(err.message),
  );
  await assert.rejects(
    horizonsEphemeris('Pluto', { startMjd: 60888, endMjd: 60890, fetchImpl: fakeFetch('{"message":"bad"}', { status: 400 }) }),
    (err) => err.code === 'UPSTREAM' && err.retryable === false,
  );
  await assert.rejects(
    horizonsEphemeris('Pluto', { startMjd: 60888, endMjd: 60890, fetchImpl: async () => { throw new TypeError('fetch failed'); } }),
    (err) => err.code === 'UPSTREAM' && /fetch failed/.test(err.message),
  );
  const hanging = (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  await assert.rejects(
    horizonsEphemeris('Pluto', { startMjd: 60888, endMjd: 60890, fetchImpl: hanging, timeoutMs: 20 }),
    (err) => err.code === 'UPSTREAM' && /did not answer/.test(err.message),
  );
});

test('horizonsEphemeris uses an optional cache', async () => {
  const store = new Map();
  const cache = {
    get: async (key) => store.get(key) || null,
    put: async (key, bytes) => { store.set(key, bytes); return true; },
  };
  const calls = [];
  const fetchImpl = fakeFetch(PLUTO_TEXT, { calls });
  const a = await horizonsEphemeris('Pluto', { startMjd: 60888, endMjd: 60890, fetchImpl, cache });
  const b = await horizonsEphemeris('pluto', { startMjd: 60888.2, endMjd: 60889.9, fetchImpl, cache });
  assert.equal(calls.length, 1);
  assert.equal(b.cached, true);
  assert.equal(b.body, 'pluto');
  assert.deepEqual(b.samples, a.samples);
  assert.ok([...store.keys()][0].startsWith('horizons/v1/'));
  // a different step is a different entry; a throwing cache is ignored
  await horizonsEphemeris('Pluto', { startMjd: 60888, endMjd: 60890, stepHours: 6, fetchImpl, cache });
  assert.equal(calls.length, 2);
  const broken = { get: async () => { throw new Error('down'); }, put: async () => { throw new Error('down'); } };
  const c = await horizonsEphemeris('Pluto', { startMjd: 60888, endMjd: 60890, fetchImpl, cache: broken });
  assert.equal(c.samples.length, 5);
});

test('ephemerisRoute turns query parameters into a status and a JSON body', async () => {
  const calls = [];
  const fetchImpl = fakeFetch(PLUTO_TEXT, { calls });
  const ok = await ephemerisRoute(new URLSearchParams('body=Pluto&start=60888&end=60890&step=12'), { fetchImpl });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.samples.length, 5);
  assert.equal(new URL(calls[0].url).searchParams.get('STEP_SIZE'), "'12 h'");

  const plain = await ephemerisRoute({ body: 'Pluto', start: '60888', end: '60890' }, { fetchImpl });
  assert.equal(plain.status, 200);

  const missing = await ephemerisRoute(new URLSearchParams(''), { fetchImpl });
  assert.equal(missing.status, 400);
  assert.equal(missing.body.code, 'BAD_REQUEST');
  assert.equal(typeof missing.body.error, 'string');
  assert.equal(missing.body.retryable, false);

  const badStart = await ephemerisRoute(new URLSearchParams('body=Pluto&start=abc'), { fetchImpl });
  assert.equal(badStart.status, 400);

  const ambiguous = await ephemerisRoute(new URLSearchParams('body=ATLAS'), { fetchImpl: fakeFetch(AMBIGUOUS_SMALL) });
  assert.equal(ambiguous.status, 409);
  assert.equal(ambiguous.body.code, 'AMBIGUOUS');
  assert.match(ambiguous.body.matches, /C\/2025 N1/);

  const unknown = await ephemerisRoute(new URLSearchParams('body=Nibiru'), { fetchImpl: fakeFetch(NOT_FOUND_TEXT) });
  assert.equal(unknown.status, 404);

  const down = await ephemerisRoute(new URLSearchParams('body=Pluto'), { fetchImpl: fakeFetch('oops', { status: 502 }) });
  assert.equal(down.status, 502);
  assert.equal(down.body.retryable, true);
});
