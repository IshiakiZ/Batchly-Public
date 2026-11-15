// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STORIES, TARGET_STORY_IDS, getStory, storyTargets } from './script.js';
import { countWords, createFakeClock, createRunner, planTimeline } from './runner.js';
import { TARGETS, CHALLENGE_TARGET_IDS } from '../../core/targets.js';

// URL state as CONTRACT.md defines it.
const STATE_KEYS = ['ra', 'dec', 'name', 'fov', 'det', 'view', 'ch', 'lens', 'dist', 't', 'stretch', 'gaia', 'flags', 'embed'];
const VIEWS = ['passes', 'exposures', 'matched', 'residual', 'diff', 'lens', 'distance'];
const LENSES = ['methane', 'water', 'co2', 'co', 'rgb'];
const PANELS = ['spectrum', 'lightcurve', 'motion', 'candidates', 'about'];
const HYPE = /\b(amazing|incredible|revolutionary|stunning|powerful|seamless|game.?chang|cutting.edge|unleash|supercharge|magic|awesome|blazing|world.class)\b/i;

const allActions = (story) => {
  const out = [];
  for (const step of story.steps) out.push(...(step.do || []), ...(step.then || []));
  if (story.preload) for (const item of story.preload.items) out.push(...(item.do || []));
  return out;
};

const captionTexts = (story) => {
  const out = [];
  for (const step of story.steps) {
    const c = step.caption;
    if (!c) continue;
    out.push(c.title || '', c.text || '', ...(c.lines || []));
    if (c.fallback) out.push(c.fallback.title || '', c.fallback.text || '');
    if (step.spotlight && step.spotlight.label) out.push(step.spotlight.label);
  }
  if (story.preload) out.push(story.preload.label, story.preload.ready);
  return out;
};

test('every story validates', () => {
  assert.ok(STORIES.length >= 7);
  const ids = new Set();
  for (const story of STORIES) {
    const plan = planTimeline(story);
    assert.equal(plan.ok, true, `${story.id}: ${plan.errors.join('; ')}`);
    assert.deepEqual(plan.warnings, [], `${story.id} has warnings`);
    assert.ok(story.title && story.description, `${story.id} needs a title and a description`);
    assert.equal(ids.has(story.id), false, `duplicate story id ${story.id}`);
    ids.add(story.id);
  }
});

test('stories only use targets, state keys, views, lenses and panels that exist', () => {
  const targetIds = new Set(TARGETS.map((t) => t.id));
  for (const story of STORIES) {
    for (const id of storyTargets(story)) assert.ok(targetIds.has(id), `${story.id}: unknown target ${id}`);
    for (const a of allActions(story)) {
      const state = a.type === 'set' ? a.state : a.type === 'goTo' ? a.state || {} : null;
      if (state) {
        for (const [k, v] of Object.entries(state)) {
          assert.ok(STATE_KEYS.includes(k), `${story.id}: "${k}" is not a URL-state key`);
          if (k === 'view') assert.ok(VIEWS.includes(v), `${story.id}: unknown view ${v}`);
          if (k === 'lens') assert.ok(LENSES.includes(v), `${story.id}: unknown lens ${v}`);
          if (k === 'fov') assert.ok([2, 4, 6, 10].includes(v), `${story.id}: bad fov ${v}`);
          if (k === 'det') assert.ok(Number.isInteger(v) && v >= 1 && v <= 6, `${story.id}: bad det ${v}`);
          if (k === 'gaia' || k === 'flags') assert.equal(typeof v, 'boolean');
        }
      }
      if (a.type === 'panel') assert.ok(PANELS.includes(a.id), `${story.id}: unknown panel ${a.id}`);
    }
  }
});

test('the team voice: no exclamation marks, no hype, every caption ends its sentence', () => {
  for (const story of STORIES) {
    for (const text of captionTexts(story)) {
      assert.equal(text.includes('!'), false, `${story.id}: "${text}" has an exclamation mark`);
      assert.equal(HYPE.test(text), false, `${story.id}: "${text}" sounds like an advert`);
    }
    for (const step of story.steps) {
      const c = step.caption;
      if (!c || c.card) continue;
      assert.match(c.text, /[.?]$/, `${story.id}/${step.id}: caption should end with a full stop`);
      assert.ok(c.title, `${story.id}/${step.id}: caption needs a title`);
    }
  }
});

test('getStory finds stories by id, whatever the case', () => {
  assert.equal(getStory('demo').id, 'demo');
  assert.equal(getStory(' TOUR ').id, 'tour');
  assert.equal(getStory('Eps-Indi-B').id, 'eps-indi-b');
  assert.equal(getStory('nope'), null);
  assert.equal(getStory(''), null);
  assert.equal(getStory(null), null);
});

// ---- the film ---------------------------------------------------------------------------------

test('demo: at most 29 seconds, with no gaps, and marked to fit', () => {
  const demo = getStory('demo');
  const plan = planTimeline(demo);
  assert.equal(demo.maxSeconds, 29);
  assert.ok(plan.total <= 29, `the film runs ${plan.total} s`);
  assert.equal(plan.total, 29);
  for (let i = 1; i < plan.steps.length; i++) assert.equal(plan.steps[i].startMs, plan.steps[i - 1].endMs, `gap before ${plan.steps[i].id}`);
  assert.equal(plan.steps[0].startMs, 0);
});

test('demo: a one-second title card and a two-second end card', () => {
  const plan = planTimeline(getStory('demo'));
  const first = plan.steps[0];
  assert.equal(first.caption.card, 'title');
  assert.equal(first.duration, 1);
  assert.equal(`${first.caption.title}: ${first.caption.text}`, 'TOMBAUGH: a blink comparator for the 102-color sky');
  const last = plan.steps.at(-1);
  assert.equal(last.caption.card, 'end');
  assert.equal(last.duration, 2);
  assert.equal(last.caption.url, '{url}');
  assert.deepEqual(last.caption.lines, ['Data: NASA SPHEREx via IRSA', 'Missing Mass']);
});

test('demo: captions are short and stay up long enough to read', () => {
  const demo = getStory('demo');
  for (const step of planTimeline(demo).steps) {
    if (step.caption.card) continue;
    const words = countWords(step.caption.text);
    assert.ok(words <= 9, `${step.id}: ${words} words`);
    assert.ok(step.duration >= 2.5, `${step.id}: on screen for only ${step.duration} s`);
    if (step.caption.fallback) assert.ok(countWords(step.caption.fallback.text) <= 9);
  }
});

test('demo: follows the shot list (see it, measure it, know it, the link and the map)', () => {
  const demo = getStory('demo');
  const byId = Object.fromEntries(demo.steps.map((s) => [s.id, s]));
  assert.deepEqual(demo.steps.map((s) => s.id), ['title', 'flicker', 'passes', 'residual', 'motion', 'spectrum', 'lens', 'link', 'map', 'end']);
  assert.deepEqual(demo.steps.filter((s) => !s.caption.card).map((s) => s.caption.title), ['See it', 'See it', 'Measure it', 'Measure it', 'Know it', 'Know it', 'Share it', 'Your turn']);

  // Shot 1: Barnard's Star, exposure by exposure, playing, Gaia rings off.
  const open = byId.title.do.find((a) => a.type === 'goTo');
  assert.equal(open.target, 'barnard');
  assert.deepEqual({ view: open.state.view, det: open.state.det, fov: open.state.fov, gaia: open.state.gaia }, { view: 'exposures', det: 3, fov: 4, gaia: false });
  assert.ok(byId.flicker.do.some((a) => a.type === 'play'));
  assert.match(byId.flicker.caption.text, /different colour/);
  // Shot 2: per-pass stacks with Gaia rings, blinked first against last.
  assert.deepEqual(byId.passes.do.find((a) => a.type === 'set').state, { view: 'passes', gaia: true });
  assert.ok(byId.passes.then.some((a) => a.type === 'blink' && a.times >= 3));
  assert.equal(byId.passes.waitFor.cond, 'frames');
  assert.match(byId.passes.caption.text, /Gaia ring/);
  // Shot 3: predicted-sky subtraction.
  assert.equal(byId.residual.do.find((a) => a.type === 'set').state.view, 'residual');
  // Shot 4: the motion meter, with the number read off the tool and an honest fallback.
  assert.ok(byId.motion.do.some((a) => a.type === 'select' && a.where === 'target'));
  assert.ok(byId.motion.do.some((a) => a.type === 'panel' && a.id === 'motion'));
  assert.match(byId.motion.caption.text, /\{motion\}.*\{gaiaMotion\}/);
  assert.equal(byId.motion.caption.fallback.text, 'Measured against Gaia, in the open.');
  // Shot 5: the click spectrum.
  assert.ok(byId.spectrum.do.some((a) => a.type === 'panel' && a.id === 'spectrum'));
  // Shot 6: the methane lens on a cold brown dwarf.
  const lens = byId.lens.do.find((a) => a.type === 'goTo');
  assert.equal(lens.target, 'eps-indi-b');
  assert.deepEqual({ view: lens.state.view, lens: lens.state.lens }, { view: 'lens', lens: 'methane' });
  // Shot 7: the link, then the map; the end card closes the map.
  assert.ok(byId.link.do.some((a) => a.type === 'url'));
  assert.ok(byId.map.do.some((a) => a.type === 'fog' && !a.close));
  assert.ok(byId.end.do.some((a) => a.type === 'fog' && a.close));
});

test('demo: the preload opens everything the film shows, and ends on the first shot', () => {
  const demo = getStory('demo');
  assert.equal(demo.startOnKey, true);
  assert.equal(demo.preload.label, 'Preparing the demonstration');
  assert.equal(demo.preload.ready, 'Ready. Press Space to start recording');

  const visits = (lists) => {
    const seen = new Set();
    let target = '';
    let view = '';
    for (const actions of lists) {
      for (const a of actions) {
        if (a.type === 'goTo') target = a.target;
        const state = a.type === 'goTo' ? a.state : a.type === 'set' ? a.state : null;
        if (state && state.view) view = state.view;
        if (target && view) seen.add(`${target}/${view}`);
      }
    }
    return seen;
  };
  const filmed = visits(demo.steps.map((s) => [...(s.do || []), ...(s.then || [])]));
  const prepared = visits(demo.preload.items.map((i) => i.do));
  for (const v of filmed) assert.ok(prepared.has(v), `the film shows ${v} but the preload never opens it`);
  assert.ok(demo.preload.items.some((i) => i.do.some((a) => a.type === 'select')), 'the preload measures the star once');
  assert.ok(demo.preload.items.some((i) => i.do.some((a) => a.type === 'fog')), 'the preload opens the sky map once');

  const lastPrep = demo.preload.items.at(-1).do.find((a) => a.type === 'goTo');
  const firstShot = demo.steps[0].do.find((a) => a.type === 'goTo');
  assert.equal(lastPrep.target, firstShot.target);
  assert.deepEqual(lastPrep.state, firstShot.state);
});

/** A stand-in app: every action works, movies and selections appear after a delay. */
function slowApp(clock, { movieDelay = 300, selectDelay = 200 } = {}) {
  const log = [];
  let movieAt = Infinity;
  let selectionAt = Infinity;
  return {
    log,
    perform(action) {
      log.push({ t: clock.now(), ...action });
      if (action.type === 'goTo' || (action.type === 'set' && 'view' in action.state)) movieAt = clock.now() + movieDelay;
      if (action.type === 'select') selectionAt = clock.now() + selectDelay;
      return true;
    },
    check(cond) {
      if (cond === 'frames' || cond === 'loaded') return clock.now() >= movieAt;
      if (cond === 'selection') return clock.now() >= selectionAt;
      return false;
    },
    resolve(name) {
      if (clock.now() < selectionAt) return name === 'url' ? 'tombaugh.example' : null;
      return { motion: '10.31 ± 0.42', gaiaMotion: '10.39', url: 'tombaugh.example' }[name] ?? null;
    },
  };
}

test('demo: plays in exactly 29 seconds after the keypress, every caption appears in order', async () => {
  const clock = createFakeClock(5000);
  const app = slowApp(clock);
  const demo = getStory('demo');
  const runner = createRunner({ story: demo, adapter: app, clock });
  const captions = [];
  const skipped = [];
  let done = null;
  runner.on('caption', (e) => captions.push({ at: clock.now(), id: e.id, caption: e.caption }));
  runner.on('skipped', (e) => skipped.push(e));
  runner.on('done', (e) => (done = { at: clock.now(), ...e }));

  const ready = runner.prepare();
  clock.advance(20000);
  await ready;
  assert.equal(runner.state(), 'ready');
  assert.equal(skipped.length, 0, 'nothing in the preload timed out');
  assert.equal(captions.length, 0, 'no caption before the clock starts');

  const pressed = clock.now();
  app.log.length = 0;
  runner.toggle();
  clock.advance(40000);
  assert.equal(runner.state(), 'done');
  assert.equal(done.at - pressed, 29000);
  assert.equal(done.wallMs, 29000);
  assert.equal(skipped.length, 0);

  const shown = captions.filter((c) => c.caption);
  assert.deepEqual([...new Set(shown.map((c) => c.id))], demo.steps.map((s) => s.id));
  const plan = planTimeline(demo);
  for (const step of plan.steps) {
    const first = shown.find((c) => c.id === step.id);
    assert.equal(first.at - pressed, step.startMs, `${step.id} appears on time`);
  }
  const motion = shown.filter((c) => c.id === 'motion').at(-1);
  assert.equal(motion.caption.text, 'Tombaugh: 10.31 ± 0.42 arcsec/yr. Gaia: 10.39 arcsec/yr.');
  assert.ok(countWords(motion.caption.text) <= 9);
  const end = shown.find((c) => c.id === 'end');
  assert.equal(end.caption.url, 'tombaugh.example');

  // The blinks happen inside their shots.
  const flips = app.log.filter((a) => a.type === 'frame' && a.blink);
  assert.ok(flips.length >= 8, `${flips.length} blink flips`);
  for (const f of flips) assert.ok(f.t - pressed >= 4500 && f.t - pressed < 12500, `flip at ${f.t - pressed}`);
});

test('demo: still exactly 29 seconds when nothing loads and nothing is supported', () => {
  const clock = createFakeClock();
  const demo = getStory('demo');
  const runner = createRunner({ story: demo, adapter: { perform: () => false, check: () => false, resolve: () => null }, clock });
  const captions = [];
  let done = null;
  runner.on('caption', (e) => captions.push(e));
  runner.on('done', (e) => (done = { at: clock.now(), ...e }));
  runner.start(); // straight to the film, no preload
  clock.advance(60000);
  assert.equal(done.at, 29000);
  const motion = captions.filter((c) => c.id === 'motion').at(-1);
  assert.equal(motion.caption.text, 'Measured against Gaia, in the open.', 'no number is quoted that the tool did not show');
  const end = captions.find((c) => c.id === 'end');
  assert.equal(end.caption.url, '', 'no address is invented');
});

// ---- the tour and the target stories ----------------------------------------------------------

test('tour: about 90 seconds, explains the controls, waits for the visitor', () => {
  const tour = getStory('tour');
  const plan = planTimeline(tour);
  assert.ok(plan.total >= 80 && plan.total <= 100, `the tour runs ${plan.total} s`);
  assert.equal(tour.maxSeconds, undefined, 'the tour may wait, so it has no hard limit');
  assert.ok(plan.steps.filter((s) => s.key).length >= 2, 'at least two "press Space to continue" stops');
  assert.ok(plan.steps.some((s) => s.waitFor && s.waitFor.hold), 'it holds while frames load');
  for (const step of plan.steps) assert.ok(step.caption && step.caption.text, `${step.id} has a caption`);
  const spots = plan.steps.map((s) => s.spotlight && s.spotlight.element).filter(Boolean);
  for (const el of ['player', 'view-seg', 'controls', 'panel-spectrum', 'panel-motion']) assert.ok(spots.includes(el), `the tour points at ${el}`);
  const views = allActions(tour).filter((a) => a.state && a.state.view).map((a) => a.state.view);
  for (const v of ['passes', 'exposures', 'residual', 'lens']) assert.ok(views.includes(v), `the tour shows the ${v} view`);
});

test('tour: runs to the end with a fake app, stopping where it asks for a key', () => {
  const clock = createFakeClock();
  const app = slowApp(clock, { movieDelay: 800 });
  const runner = createRunner({ story: getStory('tour'), adapter: app, clock });
  let keys = 0;
  runner.on('waiting', (e) => {
    if (e.reason === 'key') keys += 1;
  });
  runner.start();
  for (let i = 0; i < 400 && runner.state() !== 'done'; i++) {
    clock.advance(1000);
    if (runner.state() === 'waiting') runner.toggle();
  }
  assert.equal(runner.state(), 'done');
  assert.equal(keys, 2);
});

test('one short story per challenge target', () => {
  assert.deepEqual([...TARGET_STORY_IDS], ['barnard', 'eps-indi-b', 'wise0855', 'rw-aur', 'r-dra']);
  assert.deepEqual([...TARGET_STORY_IDS].sort(), [...CHALLENGE_TARGET_IDS].sort());
  for (const id of TARGET_STORY_IDS) {
    const story = getStory(id);
    assert.ok(story, `no story for ${id}`);
    assert.equal(story.kind, 'target');
    const plan = planTimeline(story);
    assert.ok(plan.total >= 10 && plan.total <= 30, `${id} runs ${plan.total} s`);
    assert.ok(plan.steps.length >= 3);
    const first = story.steps[0].do[0];
    assert.equal(first.type, 'goTo');
    assert.equal(first.target, id);
    assert.deepEqual(storyTargets(story), [id]);
    const target = TARGETS.find((t) => t.id === id);
    assert.equal(first.state.det, target.det, `${id} opens on the detector core/targets.js suggests`);
    for (const step of story.steps) assert.ok(countWords(step.caption.text) <= 16, `${id}/${step.id} is too long`);
  }
});
