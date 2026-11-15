// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAdapter, displayUrl, formatMotion } from './adapter.js';
import { frameRect, splitKeys, BAND_UNITS } from './captions.js';
import { skyToClient, ringForSky, lerpRect, easeOutCubic } from './spotlight.js';
import { readStoryParams, formatLength, meta } from './index.js';
import { TARGETS } from '../../core/targets.js';

/** The parts of the plugin `app` object the adapter uses, with no DOM behind them. */
function fakeApp({ withSelectAt = true } = {}) {
  let state = { ra: null, dec: null, name: '', fov: 4, det: 3, view: 'passes', gaia: true, flags: false, lens: 'methane', t: 0 };
  const listeners = new Map();
  const calls = [];
  let frames = [];
  let index = 0;
  let playing = false;
  let selection = null;
  const emit = (event, payload) => {
    for (const f of listeners.get(event) || []) f(payload);
  };
  const app = {
    calls,
    emit,
    store: {
      get: () => state,
      set(patch) {
        calls.push(['set', patch]);
        state = { ...state, ...patch };
      },
    },
    target: () => (Number.isFinite(state.ra) ? { ra: state.ra, dec: state.dec, name: state.name } : null),
    goTo(t) {
      calls.push(['goTo', t]);
      state = { ...state, ra: t.ra, dec: t.dec, name: t.name || '', t: 0 };
      frames = [];
      selection = null;
      emit('target', t);
    },
    movie: () => ({ frames, index, playing, view: state.view }),
    /** Test helper: the movie for the current target and view arrives. */
    deliver(mjds = [60830, 61010, 61200]) {
      frames = mjds.map((mjd) => ({ mjd, id: 'x' }));
      index = 0;
      emit('frames', { det: state.det, complete: true });
      emit('movie', { view: state.view, frames });
    },
    setFrameIndex(i) {
      calls.push(['frame', i]);
      index = i;
      playing = false;
    },
    play() {
      calls.push(['play']);
      playing = true;
    },
    pause() {
      calls.push(['pause']);
      playing = false;
    },
    selection: () => selection,
    measure(sel) {
      selection = sel;
      emit('select', sel);
    },
    explain(topic) {
      calls.push(['explain', topic]);
      return topic === 'flicker';
    },
    frames: () => frames,
    on(event, f) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(f);
      return () => listeners.get(event).delete(f);
    },
    listenerCount: () => [...listeners.values()].reduce((n, s) => n + s.size, 0),
  };
  if (withSelectAt) {
    app.selectAt = (pos) => {
      calls.push(['selectAt', pos]);
      app.measure({ ...pos, spectrum: [{ wave: 2 }], motion: { measured: { total: 10310, errTotal: 420 }, gaia: { total: 10393 } } });
    };
  }
  return app;
}

const quiet = { log: () => {}, doc: null, win: null };

test('goTo opens a catalogue target at its position today, with its suggested detector', () => {
  const app = fakeApp();
  const adapter = createAdapter(app, { ...quiet, nowMs: () => Date.UTC(2026, 10, 15) });
  assert.equal(adapter.perform({ type: 'goTo', target: 'barnard', state: { view: 'exposures', gaia: false } }), true);
  const [first, second] = app.calls;
  assert.equal(first[0], 'goTo');
  assert.equal(first[1].name, "Barnard's Star");
  const cat = TARGETS.find((t) => t.id === 'barnard');
  assert.ok(Math.abs(first[1].ra - cat.ra) < 0.02);
  assert.ok(first[1].dec > cat.dec + 0.07 && first[1].dec < cat.dec + 0.08, 'carried 26.9 years north at 10.4 arcsec a year');
  assert.deepEqual(second, ['set', { view: 'exposures', gaia: false, det: 3, fov: 4 }]);
});

test('goTo the same target twice does not reload it, even later in the day', () => {
  const app = fakeApp();
  let now = Date.UTC(2026, 10, 15);
  const adapter = createAdapter(app, { ...quiet, nowMs: () => now });
  adapter.perform({ type: 'goTo', target: 'barnard' });
  now += 6 * 3600 * 1000;
  adapter.perform({ type: 'goTo', target: 'barnard', state: { view: 'residual' } });
  assert.equal(app.calls.filter((c) => c[0] === 'goTo').length, 1);
  assert.deepEqual(app.calls.at(-1), ['set', { view: 'residual', det: 3, fov: 4 }]);
});

test('goTo accepts raw coordinates and refuses an unknown name', () => {
  const app = fakeApp();
  const adapter = createAdapter(app, quiet);
  assert.equal(adapter.perform({ type: 'goTo', target: { ra: 10.5, dec: -20.25, name: 'Somewhere' } }), true);
  assert.deepEqual(app.calls[0], ['goTo', { ra: 10.5, dec: -20.25, name: 'Somewhere' }]);
  assert.equal(adapter.perform({ type: 'goTo', target: 'planet-x' }), false);
});

test('the frames condition needs a movie for this target and this view', () => {
  const app = fakeApp();
  const adapter = createAdapter(app, quiet);
  assert.equal(adapter.check('frames'), false);
  adapter.perform({ type: 'goTo', target: 'barnard', state: { view: 'passes' } });
  assert.equal(adapter.check('frames'), false);
  app.deliver();
  assert.equal(adapter.check('frames'), true);
  adapter.perform({ type: 'set', state: { view: 'residual' } });
  assert.equal(adapter.check('frames'), false, 'the old movie does not count for the new view');
  app.emit('movie', { view: 'residual' });
  assert.equal(adapter.check('frames'), true);
  adapter.perform({ type: 'set', state: { gaia: false } });
  assert.equal(adapter.check('frames'), true, 'an overlay toggle does not rebuild the movie');
  adapter.perform({ type: 'goTo', target: 'eps-indi-b' });
  assert.equal(adapter.check('frames'), false);
  assert.equal(adapter.check('nonsense'), false);
});

test('the loaded condition waits for the detector to finish, or for quiet', () => {
  const app = fakeApp();
  let now = 1000;
  const adapter = createAdapter(app, { ...quiet, nowMs: () => now });
  adapter.perform({ type: 'goTo', target: { ra: 1, dec: 2 } });
  app.emit('frames', { det: 3, complete: false });
  app.emit('movie', { view: 'passes' });
  // A movie object exists but it has no frames yet.
  assert.equal(adapter.check('loaded'), false);
  app.deliver();
  assert.equal(adapter.check('loaded'), true);
  // An app that never says "complete": fall back to 1.5 s without news.
  adapter.perform({ type: 'set', state: { det: 5 } });
  app.emit('movie', { view: 'passes' });
  assert.equal(adapter.check('frames'), true);
  assert.equal(adapter.check('loaded'), false);
  now += 1600;
  assert.equal(adapter.check('loaded'), true);
});

test('an adapter created on an app that already shows a movie accepts it', () => {
  const app = fakeApp();
  app.goTo({ ra: 5, dec: 5 });
  app.deliver();
  const adapter = createAdapter(app, quiet);
  assert.equal(adapter.check('frames'), true);
});

test('frame understands first, last, next, prev and clamps numbers', () => {
  const app = fakeApp();
  const adapter = createAdapter(app, quiet);
  assert.equal(adapter.perform({ type: 'frame', index: 'last' }), false, 'no movie yet');
  app.goTo({ ra: 5, dec: 5 });
  app.deliver();
  for (const index of ['last', 'next', 'prev', 'first', 99]) adapter.perform({ type: 'frame', index });
  assert.deepEqual(app.calls.filter((c) => c[0] === 'frame').map((c) => c[1]), [2, 0, 2, 0, 2]);
});

test('select uses app.selectAt at the target position for the frame on screen', () => {
  const app = fakeApp();
  const adapter = createAdapter(app, quiet);
  adapter.perform({ type: 'goTo', target: 'barnard' });
  app.deliver([60830, 61200]);
  adapter.perform({ type: 'frame', index: 'first' });
  assert.equal(adapter.check('selection'), false);
  assert.equal(adapter.perform({ type: 'select', where: 'target' }), true);
  const early = app.calls.at(-1)[1];
  adapter.perform({ type: 'frame', index: 'last' });
  adapter.perform({ type: 'select', where: 'target' });
  const late = app.calls.at(-1)[1];
  const stepArcsec = (late.dec - early.dec) * 3600;
  assert.ok(stepArcsec > 9 && stepArcsec < 12, `the star moved ${stepArcsec.toFixed(1)} arcsec north in a year`);
  assert.equal(adapter.check('selection'), true);
  assert.equal(adapter.resolve('motion'), '10.31 ± 0.42');
  assert.equal(adapter.resolve('gaiaMotion'), '10.39');
  assert.equal(adapter.resolve('target'), "Barnard's Star");
  assert.equal(adapter.resolve('whatever'), null);
});

test('a stale selection does not satisfy the condition or fill a caption', () => {
  const app = fakeApp({ withSelectAt: false });
  const adapter = createAdapter(app, quiet);
  adapter.perform({ type: 'goTo', target: { ra: 5, dec: 5 } });
  app.deliver();
  app.measure({ ra: 5, dec: 5, spectrum: [{ wave: 1 }], motion: { measured: { total: 50 } } });
  assert.equal(adapter.check('selection'), true, 'a selection the user made counts when the story has not asked for one');
  // Without app.selectAt and without a canvas there is no way to click: the action is skipped.
  assert.equal(adapter.perform({ type: 'select', where: { ra: 5, dec: 5 } }), false);
  app.selectAt = () => {}; // an app that accepts the request but measures later
  assert.equal(adapter.perform({ type: 'select', where: { ra: 5, dec: 5 } }), true);
  assert.equal(adapter.check('selection'), false, 'the old measurement is not the new one');
  assert.equal(adapter.resolve('motion'), null);
  app.measure({ ra: 5, dec: 5, spectrum: [{ wave: 1 }], motion: { measured: { total: 60 }, gaia: null } });
  assert.equal(adapter.check('selection'), true);
  assert.equal(adapter.resolve('motion'), '0.06');
  assert.equal(adapter.resolve('gaiaMotion'), null);
});

test('skyTarget gives the middle of the track and how far the target travels', () => {
  const app = fakeApp();
  const adapter = createAdapter(app, quiet);
  assert.equal(adapter.skyTarget(), null);
  adapter.perform({ type: 'goTo', target: 'barnard' });
  const before = adapter.skyTarget();
  assert.equal(before.spanArcsec, 0);
  app.deliver([60830, 61195.25]);
  const mid = adapter.skyTarget('mid');
  assert.ok(mid.spanArcsec > 9.5 && mid.spanArcsec < 11.5, `span ${mid.spanArcsec}`);
  const raw = createAdapter(fakeApp(), quiet);
  raw.perform({ type: 'goTo', target: { ra: 12, dec: 34 } });
  assert.deepEqual(raw.skyTarget(), { ra: 12, dec: 34, spanArcsec: 0 });
});

test('play, pause, explain; and actions the app cannot do are skipped with one note', () => {
  const app = fakeApp();
  const notes = [];
  const adapter = createAdapter(app, { ...quiet, log: (m) => notes.push(m) });
  assert.equal(adapter.perform({ type: 'play' }), true);
  assert.equal(adapter.perform({ type: 'pause' }), true);
  assert.equal(adapter.perform({ type: 'explain', topic: 'flicker' }), true);
  assert.equal(adapter.perform({ type: 'explain', topic: 'unknown-topic' }), false);
  assert.equal(adapter.perform({ type: 'zoom', level: 2 }), false);
  assert.equal(adapter.perform({ type: 'zoom', level: 3 }), false);
  assert.equal(adapter.perform({ type: 'fog' }), false);
  assert.equal(adapter.perform({ type: 'panel', id: 'motion' }), false);
  assert.equal(adapter.perform({ type: 'url' }), false);
  assert.equal(adapter.perform({ type: 'teleport' }), false);
  assert.equal(notes.filter((n) => /setView/.test(n)).length, 1, 'said once, not every time');
  assert.ok(notes.every((n) => /skipped/.test(n)));

  const bare = createAdapter({}, { ...quiet, log: (m) => notes.push(m) });
  for (const action of [{ type: 'goTo', target: 'barnard' }, { type: 'set', state: { view: 'passes' } }, { type: 'play' }, { type: 'pause' }, { type: 'frame', index: 0 }, { type: 'select', where: 'target' }]) {
    assert.equal(bare.perform(action), false, action.type);
  }
  assert.equal(bare.check('frames'), false);
  assert.equal(bare.check('selection'), false);
  assert.equal(bare.resolve('motion'), null);
  assert.deepEqual(bare.snapshot(), { state: {}, view: null, target: null });
});

test('optional hooks are used when the app has them', () => {
  const app = fakeApp();
  const seen = [];
  app.showPanel = (id) => seen.push(['panel', id]);
  app.openSkyMap = () => seen.push(['open']);
  app.closeSkyMap = () => seen.push(['close']);
  app.viewer = { setView: (v) => seen.push(['view', v]), resetView: () => seen.push(['reset']), getView: () => ({ zoom: 2, cx: 10, cy: 12 }) };
  const urls = [];
  const adapter = createAdapter(app, { ...quiet, ui: { url: (t) => urls.push(t), afterAction: (a) => seen.push(['after', a.type]) } });
  adapter.perform({ type: 'panel', id: 'motion' });
  adapter.perform({ type: 'fog' });
  adapter.perform({ type: 'zoom', level: 1 });
  adapter.perform({ type: 'zoom', level: 3, at: { ra: 1, dec: 2 } });
  adapter.perform({ type: 'goTo', target: { ra: 30, dec: 40, name: 'Field' } });
  adapter.perform({ type: 'set', state: { view: 'lens', lens: 'water', det: 4 } });
  adapter.perform({ type: 'url' });
  adapter.perform({ type: 'url', show: false });
  assert.deepEqual(seen.filter((s) => s[0] !== 'after'), [['panel', 'motion'], ['open'], ['reset'], ['view', { zoom: 3, ra: 1, dec: 2 }]]);
  assert.equal(seen.filter((s) => s[0] === 'after').length, 8);
  assert.deepEqual(urls, ['?name=Field&fov=4&det=4&view=lens&lens=water', null]);
  adapter.cleanup();
  assert.deepEqual(seen.at(-1), ['close'], 'a sky map the story opened is closed again');
});

test('snapshot and restore put the view, detector and target back', () => {
  const app = fakeApp();
  app.goTo({ ra: 100, dec: 20, name: 'Mine' });
  app.store.set({ view: 'diff', det: 5, gaia: false });
  app.viewer = { getView: () => ({ zoom: 2, cx: 10, cy: 12, ra: 0, dec: 0 }), setView() {}, resetView: () => app.calls.push(['reset']) };
  const adapter = createAdapter(app, quiet);
  const snap = adapter.snapshot();
  assert.deepEqual(snap.view, { zoom: 2, cx: 10, cy: 12 });
  adapter.perform({ type: 'goTo', target: 'eps-indi-b', state: { view: 'lens', gaia: true } });
  adapter.perform({ type: 'play' });
  app.calls.length = 0;
  adapter.restore(snap);
  assert.deepEqual(app.calls[0], ['pause']);
  const restored = app.store.get();
  assert.deepEqual(
    { ra: restored.ra, dec: restored.dec, name: restored.name, view: restored.view, det: restored.det, gaia: restored.gaia, fov: restored.fov },
    { ra: 100, dec: 20, name: 'Mine', view: 'diff', det: 5, gaia: false, fov: 4 },
  );
  assert.deepEqual(app.calls.at(-1), ['reset'], 'a different field: the zoom is reset rather than restored');
});

test('restore returns to the start page when the story began there', () => {
  const app = fakeApp();
  const adapter = createAdapter(app, quiet);
  const snap = adapter.snapshot();
  adapter.perform({ type: 'goTo', target: 'barnard' });
  adapter.restore(snap);
  assert.equal(app.store.get().ra, null);
  assert.equal(app.target(), null);
});

test('isSynthetic recognises frames from the synthetic development sky', () => {
  const app = fakeApp();
  const adapter = createAdapter(app, quiet);
  assert.equal(adapter.isSynthetic(), false);
  app.frames = () => [{ id: 'ibe/data/spherex/qr3/level2/2026W25_2A/l2b-v27-2026-273/2/level2_x.fits' }];
  assert.equal(adapter.isSynthetic(), false);
  app.frames = () => [{ id: 'ibe/data/spherex/qr3/level2/2026W25_2A/l2b-syn-r026945208-dp0473942/3/level2_x.fits' }];
  assert.equal(adapter.isSynthetic(), true);
});

test('onChange fires on app events, and dispose unsubscribes', () => {
  const app = fakeApp();
  const adapter = createAdapter(app, quiet);
  let n = 0;
  adapter.onChange(() => (n += 1));
  app.emit('movie', { view: 'passes' });
  app.emit('select', {});
  assert.equal(n, 2);
  assert.equal(app.listenerCount(), 4);
  adapter.dispose();
  assert.equal(app.listenerCount(), 0);
  app.emit('movie', { view: 'passes' });
  assert.equal(n, 2);
});

// ---- pure helpers -----------------------------------------------------------------------------

test('formatMotion prints arcsec a year the way the motion meter does', () => {
  assert.equal(formatMotion(10393), '10.39');
  assert.equal(formatMotion(10310.4, 421), '10.31 ± 0.42');
  assert.equal(formatMotion(10310, 0), '10.31');
  assert.equal(formatMotion(NaN), null);
  assert.equal(formatMotion(undefined), null);
});

test('displayUrl drops the scheme, index.html and the story parameters', () => {
  assert.equal(displayUrl('https://tombaugh.example/?name=Barnard%27s%20Star&view=residual&story=demo&record=1&guide=1'), "tombaugh.example/?name=Barnard's Star&view=residual");
  assert.equal(displayUrl('https://tombaugh.example/index.html?story=demo'), 'tombaugh.example/');
  assert.equal(displayUrl('https://tombaugh.example/app/index.html?story=demo&record=1', { query: false }), 'tombaugh.example/app/');
  assert.equal(displayUrl('https://tombaugh.example/?story=demo', { query: false }), 'tombaugh.example');
  assert.equal(displayUrl('about:srcdoc'), '');
  assert.equal(displayUrl('not a url'), '');
});

test('frameRect: a 16:9 frame in recording mode, the whole window otherwise', () => {
  assert.deepEqual(frameRect(1280, 720, { recording: true }), { x: 0, y: 0, w: 1280, h: 720, u: 12.8 });
  assert.deepEqual(frameRect(1920, 1080, { recording: true }), { x: 0, y: 0, w: 1920, h: 1080, u: 19.2 });
  const tall = frameRect(1000, 1000, { recording: true });
  assert.deepEqual([tall.x, tall.y, tall.w, tall.h], [0, 219, 1000, 562]);
  const wide = frameRect(2000, 720, { recording: true });
  assert.deepEqual([wide.x, wide.y, wide.w, wide.h], [360, 0, 1280, 720]);
  const page = frameRect(1280, 800);
  assert.deepEqual([page.x, page.y, page.w, page.h], [0, 0, 1280, 800]);
  assert.ok(page.u > 5.5 && page.u < 8.5);
  assert.equal(frameRect(360, 640).u, 5.6);
  assert.equal(frameRect(0, 0, { recording: true }).u, 0);
  // Caption text is 2.8 units: at least 27 px in a 720p frame, as the demo script asks.
  assert.ok(frameRect(1280, 720, { recording: true }).u * 2.8 >= 27);
  assert.ok(BAND_UNITS * 12.8 < 720 / 3, 'the band stays inside the lower third');
});

test('splitKeys marks key names for <kbd> styling', () => {
  assert.deepEqual(splitKeys('Ready. Press Space to start recording'), [{ text: 'Ready. Press ' }, { key: 'Space' }, { text: ' to start recording' }]);
  assert.deepEqual(splitKeys('Esc'), [{ key: 'Esc' }]);
  assert.deepEqual(splitKeys('nothing here'), [{ text: 'nothing here' }]);
  assert.deepEqual(splitKeys(null), []);
});

test('skyToClient puts the grid centre in the middle, north up and east left', () => {
  const grid = { ra0: 269.45, dec0: 4.74, n: 79, scale: 3.075 };
  const box = { left: 100, top: 50, width: 480, height: 480 };
  const c = skyToClient(grid, null, box, 269.45, 4.74);
  assert.ok(Math.abs(c.x - 340) < 1e-6 && Math.abs(c.y - 290) < 1e-6);
  assert.equal(c.inside, true);
  assert.ok(Math.abs(c.pxPerArcsec - 480 / 79 / 3.075) < 1e-9);
  const north = skyToClient(grid, null, box, 269.45, 4.74 + 30 / 3600);
  assert.ok(Math.abs(north.x - 340) < 0.01);
  assert.ok(Math.abs(c.y - north.y - 30 * c.pxPerArcsec) < 0.01, 'north is up');
  const east = skyToClient(grid, null, box, 269.45 + 30 / 3600 / Math.cos((4.74 * Math.PI) / 180), 4.74);
  assert.ok(Math.abs(c.x - east.x - 30 * c.pxPerArcsec) < 0.01, 'east is left');
  // Zoomed in two times about a point: that point is in the middle.
  const zoomed = skyToClient(grid, { zoom: 2, cx: 30, cy: 50 }, box, 269.45, 4.74);
  assert.ok(Math.abs(zoomed.x - (340 + (39 - 30) * 2 * (480 / 79))) < 1e-6);
  assert.ok(Math.abs(zoomed.y - (290 - (39 - 50) * 2 * (480 / 79))) < 1e-6);
  // A letterboxed viewer: the square is centred in the wider box.
  const wide = skyToClient(grid, null, { left: 0, top: 0, width: 800, height: 480 }, 269.45, 4.74);
  assert.equal(wide.x, 400);
  assert.equal(skyToClient(grid, null, box, 269.45, 4.74 + 1).inside, false);
  assert.equal(skyToClient(null, null, box, 1, 2), null);
  assert.equal(skyToClient(grid, null, { left: 0, top: 0, width: 0, height: 0 }, 1, 2), null);
  assert.equal(skyToClient(grid, null, box, NaN, 2), null);
});

test('ringForSky is wide enough to hold the whole track', () => {
  const point = { x: 300, y: 200, pxPerArcsec: 2 };
  const still = ringForSky(point, 0, 12.8);
  assert.ok(Math.abs(still.w - 2 * 12.8 * 2.6) < 1e-9);
  assert.ok(Math.abs(still.x + still.w / 2 - 300) < 1e-9 && Math.abs(still.y + still.h / 2 - 200) < 1e-9);
  const moving = ringForSky(point, 40, 12.8);
  assert.ok(moving.w / 2 > 40, 'radius exceeds half the 80 px track');
});

test('lerpRect and easeOutCubic', () => {
  assert.deepEqual(lerpRect({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 20, w: 30, h: 50 }, 0.5), { x: 5, y: 10, w: 20, h: 30 });
  assert.equal(easeOutCubic(0), 0);
  assert.equal(easeOutCubic(1), 1);
  assert.equal(easeOutCubic(5), 1);
  assert.ok(easeOutCubic(0.5) > 0.5);
});

test('readStoryParams reads the story parameters from a query string', () => {
  assert.deepEqual(readStoryParams('?story=demo&record=1'), { story: 'demo', record: true, guide: false, speed: 1 });
  assert.deepEqual(readStoryParams('?name=Barnard%27s%20Star&story=TOUR&guide=1&speed=2'), { story: 'tour', record: false, guide: true, speed: 2 });
  assert.deepEqual(readStoryParams('?speed=1000&record=yes'), { story: '', record: false, guide: false, speed: 1 });
  assert.deepEqual(readStoryParams(''), { story: '', record: false, guide: false, speed: 1 });
  assert.deepEqual(readStoryParams(undefined), { story: '', record: false, guide: false, speed: 1 });
});

test('formatLength and plugin meta', () => {
  assert.equal(formatLength(29), '29 s');
  assert.equal(formatLength(92), 'about 1.5 min');
  assert.equal(formatLength(NaN), '');
  assert.equal(meta.id, 'story');
  assert.ok(meta.title && meta.description);
});
