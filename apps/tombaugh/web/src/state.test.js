// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createStore,
  parseQuery,
  stateToQuery,
  readUrlState,
  writeUrlState,
  shareUrl,
  DEFAULT_STATE,
  URL_DEFAULTS,
  VIEWS,
  SIMPLE_VIEWS,
  initialMode,
} from './state.js';

test('store: get, set, subscribe, unsubscribe', () => {
  const store = createStore({ a: 1, b: 2 });
  const calls = [];
  const off = store.subscribe((state, changed, prev) => calls.push({ state, changed, prev }));
  store.set({ a: 1 });
  assert.equal(calls.length, 0, 'no notification when nothing changed');
  store.set({ a: 5, b: 2, c: 3 });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].changed, ['a', 'c']);
  assert.equal(calls[0].prev.a, 1);
  assert.deepEqual(store.get(), { a: 5, b: 2, c: 3 });
  off();
  store.set({ a: 6 });
  assert.equal(calls.length, 1);
});

test('store: a throwing subscriber does not stop the others', () => {
  const store = createStore({ a: 1 });
  let seen = 0;
  const realError = console.error;
  console.error = () => {};
  try {
    store.subscribe(() => {
      throw new Error('boom');
    });
    store.subscribe(() => {
      seen += 1;
    });
    store.set({ a: 2 });
  } finally {
    console.error = realError;
  }
  assert.equal(seen, 1);
});

test('store: NaN and Infinity compare as unchanged', () => {
  const store = createStore({ d: Infinity, n: NaN });
  let n = 0;
  store.subscribe(() => n++);
  store.set({ d: Infinity, n: NaN });
  assert.equal(n, 0);
});

test('parseQuery reads every contract key', () => {
  const s = parseQuery(
    '?ra=269.45&dec=4.69&name=Barnard%27s%20Star&fov=6&det=2&view=residual&ch=3&lens=water&dist=550&t=7&stretch=log&gaia=0&flags=1&embed=1',
  );
  assert.deepEqual(s, {
    ra: 269.45,
    dec: 4.69,
    name: "Barnard's Star",
    fov: 6,
    det: 2,
    view: 'residual',
    ch: 3,
    lens: 'water',
    dist: 550,
    t: 7,
    stretch: 'log',
    gaia: false,
    flags: true,
    embed: true,
  });
});

test('parseQuery rejects out-of-range and malformed values', () => {
  const s = parseQuery('?ra=abc&dec=4&fov=5&det=9&view=No%20pe&ch=17&dist=-3&t=-1&stretch=cubic');
  assert.deepEqual(s, {});
  assert.deepEqual(parseQuery('?ra=10&dec=95'), {});
  assert.equal(parseQuery('?view=sonify').view, 'sonify', 'plugin view ids pass through');
  assert.deepEqual(parseQuery('?ra=10'), {});
  assert.deepEqual(parseQuery(''), {});
  assert.deepEqual(parseQuery('?ra=&dec='), {});
});

test('parseQuery wraps RA and accepts dist=inf', () => {
  assert.equal(parseQuery('?ra=-10&dec=0').ra, 350);
  assert.equal(parseQuery('?ra=370&dec=0').ra, 10);
  assert.equal(parseQuery('?dist=inf').dist, Infinity);
});

test('stateToQuery omits defaults and round-trips', () => {
  assert.equal(stateToQuery(DEFAULT_STATE), '');
  const state = {
    ...DEFAULT_STATE,
    ra: 133.795129,
    dec: -7.245147,
    name: 'WISE 0855-0714',
    fov: 10,
    det: 5,
    view: 'distance',
    ch: 2,
    lens: 'co2',
    dist: 730,
    t: 4,
    stretch: 'sqrt',
    gaia: false,
    flags: true,
    embed: true,
    mode: 'advanced',
  };
  const query = stateToQuery(state);
  const back = parseQuery(`?${query}`);
  assert.equal(back.ra, 133.79513);
  assert.equal(back.dec, -7.24515);
  for (const key of Object.keys(URL_DEFAULTS)) {
    if (key === 'ra' || key === 'dec') continue;
    assert.deepEqual(back[key], state[key], key);
  }
});

test('stateToQuery keeps unknown parameters such as api, drops stale known ones', () => {
  const q = stateToQuery({ ...DEFAULT_STATE, ra: 1, dec: 2 }, '?api=http%3A%2F%2Fx%2Fapi&view=diff&ra=9');
  const p = new URLSearchParams(q);
  assert.equal(p.get('api'), 'http://x/api');
  assert.equal(p.get('ra'), '1');
  assert.equal(p.has('view'), false);
});

test('readUrlState / writeUrlState survive a missing or hostile environment', async () => {
  const saved = { location: globalThis.location, history: globalThis.history };
  try {
    delete globalThis.location;
    delete globalThis.history;
    assert.deepEqual(readUrlState(), {});
    writeUrlState({ ...DEFAULT_STATE, ra: 1, dec: 2 }, 1);
    await new Promise((r) => setTimeout(r, 10));

    let written = null;
    globalThis.location = { search: '?ra=10&dec=20&api=/x', pathname: '/index.html', hash: '', origin: 'http://localhost:8787' };
    globalThis.history = {
      replaceState(_a, _b, url) {
        written = url;
      },
    };
    assert.deepEqual(readUrlState(), { ra: 10, dec: 20 });
    writeUrlState({ ...DEFAULT_STATE, ra: 11, dec: 21, view: 'diff' }, 1);
    writeUrlState({ ...DEFAULT_STATE, ra: 12, dec: 22, view: 'diff' }, 1);
    await new Promise((r) => setTimeout(r, 15));
    assert.equal(written, '/index.html?ra=12&dec=22&view=diff&api=%2Fx', 'debounced: last write wins');
    assert.equal(shareUrl({ ...DEFAULT_STATE, ra: 1, dec: 2 }), 'http://localhost:8787/index.html?ra=1&dec=2&api=%2Fx');

    globalThis.history = {
      replaceState() {
        throw new Error('SecurityError');
      },
    };
    writeUrlState({ ...DEFAULT_STATE, ra: 13, dec: 23 }, 1);
    await new Promise((r) => setTimeout(r, 10));
  } finally {
    if (saved.location === undefined) delete globalThis.location;
    else globalThis.location = saved.location;
    if (saved.history === undefined) delete globalThis.history;
    else globalThis.history = saved.history;
  }
});

test('mode: simple is the default and stays out of the address; advanced is written and read back', () => {
  assert.equal(DEFAULT_STATE.mode, 'simple');
  assert.equal(stateToQuery({ ...DEFAULT_STATE, mode: 'simple' }), '');
  assert.equal(stateToQuery({ ...DEFAULT_STATE, mode: 'advanced' }), 'mode=advanced');
  assert.equal(parseQuery('?mode=advanced').mode, 'advanced');
  assert.equal(parseQuery('?mode=simple').mode, 'simple');
  assert.equal(parseQuery('?mode=expert').mode, undefined);
  assert.equal(parseQuery('?ra=1&dec=2').mode, undefined);
});

test('initialMode: the link wins, then what only Advanced shows, then the remembered choice', () => {
  const at = (search, stored = null) => initialMode(parseQuery(search), search, stored);
  // A first visit, and a plain link to a place, open Simple.
  assert.equal(at(''), 'simple');
  assert.equal(at('?ra=269.45&dec=4.69&det=6&fov=6&name=Barnard'), 'simple');
  assert.equal(at('?ra=269.45&dec=4.69&view=residual&t=2'), 'simple');
  // The address says which.
  assert.equal(at('?mode=advanced'), 'advanced');
  assert.equal(at('?mode=simple', 'advanced'), 'simple');
  assert.equal(at('?mode=simple&view=lens'), 'simple');
  // Links made for the full console keep working.
  assert.equal(at('?ra=1&dec=2&view=lens'), 'advanced');
  assert.equal(at('?ra=1&dec=2&view=distance&dist=500'), 'advanced');
  assert.equal(at('?body=pluto'), 'advanced');
  assert.equal(at('?ra=1&dec=2&embed=1'), 'advanced');
  assert.equal(at('?ra=1&dec=2&lens=co2'), 'advanced');
  assert.equal(at('?story=film'), 'advanced');
  // The visitor's last choice, when the link does not say.
  assert.equal(at('', 'advanced'), 'advanced');
  assert.equal(at('?ra=1&dec=2', 'advanced'), 'advanced');
  assert.equal(at('?ra=1&dec=2', 'simple'), 'simple');
  assert.equal(at('?ra=1&dec=2', 'nonsense'), 'simple');
  // No arguments at all.
  assert.equal(initialMode(), 'simple');
});

test('SIMPLE_VIEWS are real views', () => {
  for (const v of SIMPLE_VIEWS) assert.ok(VIEWS.includes(v), v);
});
