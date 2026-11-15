// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTION_TYPES,
  countWords,
  createFakeClock,
  createRunner,
  normalizeCondition,
  planTimeline,
  resolveCaption,
  sequenceActions,
  stateBefore,
  validateAction,
} from './runner.js';

/** An adapter that records what it is asked to do and answers conditions from a table. */
function fakeAdapter(clock, { conditions = {}, values = {}, unsupported = [], throws = [] } = {}) {
  const log = [];
  return {
    log,
    conditions,
    values,
    perform(action) {
      if (throws.includes(action.type)) throw new Error(`${action.type} exploded`);
      log.push({ t: clock.now(), ...action });
      return unsupported.includes(action.type) ? false : true;
    },
    check(cond) {
      const v = conditions[cond];
      return typeof v === 'function' ? v() : !!v;
    },
    resolve(name) {
      return values[name] ?? null;
    },
    types: () => log.map((a) => a.type),
  };
}

/** Record every event a runner emits, with the wall time it happened at. */
function record(runner, clock) {
  const events = [];
  runner.on('*', (e) => events.push({ at: clock.now(), ...e }));
  events.of = (type) => events.filter((e) => e.type === type);
  return events;
}

const simple = (extra = {}) => ({
  id: 'simple',
  steps: [
    { id: 'a', at: 0, duration: 1, caption: { title: 'A', text: 'first' }, do: [{ type: 'play' }] },
    { id: 'b', at: 1, duration: 2, caption: { title: 'B', text: 'second' }, do: [{ type: 'pause' }, { type: 'set', state: { view: 'residual' } }] },
    { id: 'c', after: 0.5, duration: 1.5, caption: { title: 'C', text: 'third' }, do: [{ type: 'frame', index: 'last' }] },
  ],
  ...extra,
});

// ---- planning ---------------------------------------------------------------------------------

test('planTimeline lays steps out from at / after / duration', () => {
  const plan = planTimeline(simple());
  assert.equal(plan.ok, true, plan.errors.join('; '));
  assert.deepEqual(plan.steps.map((s) => [s.id, s.start, s.end]), [['a', 0, 1], ['b', 1, 3], ['c', 3.5, 5]]);
  assert.equal(plan.total, 5);
  assert.equal(plan.totalMs, 5000);
});

test('planTimeline: a step without at or after follows the previous one', () => {
  const plan = planTimeline({ id: 's', steps: [{ duration: 2 }, { duration: 3 }, { duration: 0.25 }] });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.steps.map((s) => s.start), [0, 2, 5]);
  assert.deepEqual(plan.steps.map((s) => s.id), ['step-1', 'step-2', 'step-3']);
  assert.equal(plan.total, 5.25);
});

test('planTimeline rejects a story longer than maxSeconds, and accepts one that fits exactly', () => {
  const steps = [{ id: 'a', duration: 20 }, { id: 'b', duration: 10 }];
  assert.equal(planTimeline({ id: 'fits', maxSeconds: 30, steps }).ok, true);
  const long = planTimeline({ id: 'long', maxSeconds: 30, steps: [...steps, { id: 'c', duration: 0.1 }] });
  assert.equal(long.ok, false);
  assert.match(long.errors.join(' '), /longer than its limit of 30 s/);
});

test('planTimeline reports overlaps, bad durations, duplicate ids and bad actions', () => {
  const plan = planTimeline({
    id: 'bad',
    steps: [
      { id: 'a', at: 0, duration: 2 },
      { id: 'a', at: 1, duration: 1 },
      { id: 'c', duration: 0 },
      { id: 'd', duration: 1, do: [{ type: 'teleport' }, { type: 'blink', times: 0, periodMs: 100 }, { type: 'goTo' }] },
      { id: 'e', duration: 1, waitFor: 'moon' },
    ],
  });
  assert.equal(plan.ok, false);
  const all = plan.errors.join(' | ');
  assert.match(all, /before the previous step ends/);
  assert.match(all, /duplicate id/);
  assert.match(all, /duration must be a positive/);
  assert.match(all, /unknown action type "teleport"/);
  assert.match(all, /blink needs times/);
  assert.match(all, /goTo needs target/);
  assert.match(all, /unknown condition/);
});

test('planTimeline: a timed story may not wait for a key or hold the clock', () => {
  const plan = planTimeline({
    id: 'film',
    maxSeconds: 10,
    steps: [
      { id: 'a', duration: 1, key: true },
      { id: 'b', duration: 1, waitFor: { cond: 'frames', hold: true } },
      { id: 'c', duration: 1, waitFor: { cond: 'frames' } },
    ],
  });
  assert.equal(plan.ok, false);
  assert.equal(plan.errors.length, 2);
  assert.match(plan.errors[0], /cannot wait for a key/);
  assert.match(plan.errors[1], /cannot hold the clock/);
});

test('planTimeline warns about long captions and actions that overrun their step', () => {
  const plan = planTimeline({
    id: 'w',
    maxCaptionWords: 4,
    steps: [
      { id: 'a', duration: 1, caption: { title: 'T', text: 'one two three four five' }, do: [{ type: 'blink', times: 4, periodMs: 500 }] },
      { id: 'b', duration: 1, caption: { title: 'T', text: 'value {x} here' } },
    ],
  });
  assert.equal(plan.ok, true);
  const all = plan.warnings.join(' | ');
  assert.match(all, /5 words \(limit 4\)/);
  assert.match(all, /longer than the step/);
  assert.match(all, /placeholder but no fallback/);
});

test('planTimeline validates preload items', () => {
  const ok = planTimeline({ id: 'p', preload: { label: 'Preparing', ready: 'Ready', items: [{ label: 'x', do: [{ type: 'goTo', target: 'barnard' }], waitFor: 'frames' }] }, steps: [{ duration: 1 }] });
  assert.equal(ok.ok, true);
  assert.equal(ok.preload.items.length, 1);
  assert.equal(ok.preload.items[0].waitFor.cond, 'frames');
  const bad = planTimeline({ id: 'p', preload: { items: [{ do: [{ type: 'nope' }], waitFor: 'x' }] }, steps: [{ duration: 1 }] });
  assert.equal(bad.ok, false);
  assert.equal(planTimeline({ id: 'p', preload: {}, steps: [{ duration: 1 }] }).ok, false);
});

test('planTimeline refuses things that are not stories', () => {
  assert.equal(planTimeline(null).ok, false);
  assert.equal(planTimeline({ id: 'x' }).ok, false);
  assert.equal(planTimeline({ id: 'x', steps: [] }).ok, false);
  assert.equal(planTimeline({ steps: [{ duration: 1 }] }).ok, false);
  assert.throws(() => createRunner({ story: { id: 'x', steps: [] } }), /not valid/);
});

test('validateAction knows every action type', () => {
  const good = {
    goTo: { target: 'barnard' },
    set: { state: { view: 'passes' } },
    play: {},
    pause: {},
    frame: { index: 'next' },
    blink: { times: 3, periodMs: 400 },
    select: { where: 'target' },
    panel: { id: 'motion' },
    explain: { topic: 'flicker' },
    zoom: { level: 2 },
    fog: {},
    url: {},
    wait: { ms: 100 },
  };
  for (const type of ACTION_TYPES) assert.deepEqual(validateAction({ type, ...good[type] }), [], type);
  assert.deepEqual(validateAction({ type: 'goTo', target: { ra: 10, dec: -5 } }), []);
  assert.deepEqual(validateAction({ type: 'select', where: { ra: 10, dec: -5 } }), []);
  assert.deepEqual(validateAction({ type: 'frame', index: 3 }), []);
  assert.deepEqual(validateAction({ type: 'explain', topic: null }), []);
  assert.equal(validateAction({ type: 'frame', index: -1 }).length, 1);
  assert.equal(validateAction({ type: 'set' }).length, 1);
  assert.equal(validateAction({ type: 'zoom', level: 0 }).length, 1);
  assert.equal(validateAction({ type: 'wait', ms: -1 }).length, 1);
  assert.equal(validateAction('play').length, 1);
});

test('normalizeCondition fills defaults', () => {
  assert.deepEqual(normalizeCondition('frames'), { cond: 'frames', timeoutMs: 1500, settleMs: 0, hold: false });
  assert.deepEqual(normalizeCondition({ cond: 'selection', timeoutMs: 200, settleMs: 50, hold: true }), { cond: 'selection', timeoutMs: 200, settleMs: 50, hold: true });
  assert.equal(normalizeCondition('nonsense'), null);
  assert.equal(normalizeCondition(42), null);
});

test('sequenceActions expands waits and blinks into offsets', () => {
  const seq = sequenceActions([{ type: 'pause' }, { type: 'wait', ms: 200 }, { type: 'blink', times: 4, periodMs: 500 }, { type: 'play' }]);
  assert.deepEqual(seq.errors, []);
  assert.equal(seq.durationMs, 2200);
  assert.deepEqual(
    seq.items.map((i) => [i.offsetMs, i.action.type, i.action.index]),
    [[0, 'pause', undefined], [200, 'frame', 'first'], [700, 'frame', 'last'], [1200, 'frame', 'first'], [1700, 'frame', 'last'], [2200, 'play', undefined]],
  );
  const custom = sequenceActions([{ type: 'blink', times: 2, periodMs: 100, a: 0, b: 2 }]);
  assert.deepEqual(custom.items.map((i) => i.action.index), [0, 2]);
});

test('countWords', () => {
  assert.equal(countWords(''), 0);
  assert.equal(countWords('  one   two\nthree '), 3);
  assert.equal(countWords('Tombaugh: {motion} arcsec/yr.'), 3);
});

// ---- captions ---------------------------------------------------------------------------------

test('resolveCaption fills placeholders and falls back when one is missing', () => {
  const caption = { title: 'Measure it', text: 'Tombaugh: {motion} arcsec/yr. Gaia: {gaia} arcsec/yr.', fallback: { text: 'Measured against Gaia, in the open.' } };
  const full = resolveCaption(caption, (n) => ({ motion: '10.31', gaia: '10.39' })[n]);
  assert.equal(full.text, 'Tombaugh: 10.31 arcsec/yr. Gaia: 10.39 arcsec/yr.');
  assert.equal(full.usedFallback, false);
  assert.equal('fallback' in full, false);
  const part = resolveCaption(caption, (n) => ({ motion: '10.31' })[n]);
  assert.equal(part.text, 'Measured against Gaia, in the open.');
  assert.equal(part.title, 'Measure it');
  assert.equal(part.usedFallback, true);
  const forced = resolveCaption(caption, (n) => ({ motion: '10.31', gaia: '10.39' })[n], { forceFallback: true });
  assert.equal(forced.text, 'Measured against Gaia, in the open.');
  assert.equal(resolveCaption(null), null);
});

test('resolveCaption drops card lines and urls it cannot fill, and survives a throwing resolver', () => {
  const card = { card: 'end', title: 'TOMBAUGH', text: 'x', url: '{url}', lines: ['Data: NASA SPHEREx via IRSA', 'Team {team}', 'Missing Mass'] };
  const none = resolveCaption(card, () => null);
  assert.equal(none.url, '');
  assert.deepEqual(none.lines, ['Data: NASA SPHEREx via IRSA', 'Missing Mass']);
  const some = resolveCaption(card, (n) => (n === 'url' ? 'tombaugh.example' : null));
  assert.equal(some.url, 'tombaugh.example');
  const thrown = resolveCaption({ title: 'T', text: 'a {b} c' }, () => {
    throw new Error('no');
  });
  assert.equal(thrown.text, 'a c');
});

// ---- running ----------------------------------------------------------------------------------

test('steps run in order at their scheduled times and the story ends on time', () => {
  const clock = createFakeClock(1000);
  const adapter = fakeAdapter(clock);
  const runner = createRunner({ story: simple(), adapter, clock });
  const events = record(runner, clock);
  assert.equal(runner.state(), 'idle');
  runner.start();
  assert.equal(runner.state(), 'running');
  clock.advance(10000);
  assert.equal(runner.state(), 'done');

  assert.deepEqual(events.of('step').map((e) => [e.id, e.at - 1000]), [['a', 0], ['b', 1000], ['c', 3500]]);
  assert.deepEqual(adapter.log.map((a) => [a.type, a.t - 1000]), [['play', 0], ['pause', 1000], ['set', 1000], ['frame', 3500]]);
  const done = events.of('done');
  assert.equal(done.length, 1);
  assert.equal(done[0].at - 1000, 5000);
  assert.equal(done[0].wallMs, 5000);
  assert.equal(done[0].storyMs, 5000);
  assert.equal(clock.pending(), 0, 'no timers left behind');
});

test('captions follow the steps, and a gap between steps clears the caption', () => {
  const clock = createFakeClock();
  const runner = createRunner({ story: simple(), adapter: fakeAdapter(clock), clock });
  const events = record(runner, clock);
  runner.start();
  clock.advance(6000);
  assert.deepEqual(
    events.of('caption').map((e) => [e.at, e.caption ? e.caption.text : null]),
    [[0, 'first'], [1000, 'second'], [3000, null], [3500, 'third']],
  );
});

test('time() and index() report progress', () => {
  const clock = createFakeClock();
  const runner = createRunner({ story: simple(), adapter: fakeAdapter(clock), clock });
  assert.equal(runner.index(), -1);
  runner.start();
  clock.advance(1500);
  assert.equal(runner.time(), 1.5);
  assert.equal(runner.index(), 1);
  assert.equal(runner.step().id, 'b');
});

test('wait and blink inside a step are timed on the story clock', () => {
  const clock = createFakeClock();
  const adapter = fakeAdapter(clock);
  const story = { id: 'b', steps: [{ id: 'x', duration: 3, do: [{ type: 'pause' }, { type: 'wait', ms: 250 }, { type: 'blink', times: 4, periodMs: 500 }, { type: 'play' }] }] };
  const runner = createRunner({ story, adapter, clock });
  runner.start();
  clock.advance(3000);
  assert.deepEqual(
    adapter.log.map((a) => [a.t, a.type, a.index]),
    [[0, 'pause', undefined], [250, 'frame', 'first'], [750, 'frame', 'last'], [1250, 'frame', 'first'], [1750, 'frame', 'last'], [2250, 'play', undefined]],
  );
});

test('blink flips that do not fit in the step are cut at its end', () => {
  const clock = createFakeClock();
  const adapter = fakeAdapter(clock);
  const story = {
    id: 'cut',
    steps: [
      { id: 'x', duration: 1, do: [{ type: 'blink', times: 10, periodMs: 300 }] },
      { id: 'y', duration: 1, do: [{ type: 'play' }] },
    ],
  };
  const runner = createRunner({ story, adapter, clock });
  runner.start();
  clock.advance(5000);
  assert.deepEqual(adapter.log.map((a) => [a.t, a.type]), [[0, 'frame'], [300, 'frame'], [600, 'frame'], [900, 'frame'], [1000, 'play']]);
  assert.equal(runner.state(), 'done');
});

test('waitFor: "then" runs as soon as the condition holds', () => {
  const clock = createFakeClock();
  const adapter = fakeAdapter(clock, { conditions: { frames: false } });
  const story = {
    id: 'w',
    steps: [{ id: 'x', duration: 4, do: [{ type: 'set', state: { view: 'passes' } }], waitFor: { cond: 'frames', timeoutMs: 2000 }, then: [{ type: 'blink', times: 2, periodMs: 400 }] }],
  };
  const runner = createRunner({ story, adapter, clock, pollMs: 50 });
  const events = record(runner, clock);
  runner.start();
  clock.advance(620);
  assert.deepEqual(adapter.types(), ['set']);
  adapter.conditions.frames = true;
  clock.advance(100);
  assert.deepEqual(adapter.log.map((a) => [a.t, a.type]), [[0, 'set'], [650, 'frame']]);
  clock.advance(4000);
  assert.deepEqual(adapter.log.map((a) => [a.t, a.type, a.index]), [[0, 'set', undefined], [650, 'frame', 'first'], [1050, 'frame', 'last']]);
  assert.equal(events.of('skipped').length, 0);
  assert.equal(events.of('done')[0].at, 4000, 'waiting does not stretch a story that does not hold');
});

test('waitFor: a condition that already holds does not wait at all', () => {
  const clock = createFakeClock();
  const adapter = fakeAdapter(clock, { conditions: { frames: true } });
  const story = { id: 'w', steps: [{ id: 'x', duration: 1, waitFor: 'frames', then: [{ type: 'play' }] }] };
  const runner = createRunner({ story, adapter, clock });
  const events = record(runner, clock);
  runner.start();
  assert.deepEqual(adapter.log.map((a) => [a.t, a.type]), [[0, 'play']]);
  assert.equal(events.of('waiting').length, 0);
});

test('waitFor: timeout skips "then", reports it, uses the fallback caption and keeps time', () => {
  const clock = createFakeClock();
  const adapter = fakeAdapter(clock, { conditions: { selection: false } });
  const story = {
    id: 'w',
    steps: [
      {
        id: 'x',
        duration: 3,
        caption: { title: 'Measure it', text: 'Here it is.', fallback: { text: 'Measured in the open.' } },
        do: [{ type: 'select', where: 'target' }],
        waitFor: { cond: 'selection', timeoutMs: 1000 },
        then: [{ type: 'panel', id: 'motion' }],
      },
      { id: 'y', duration: 1, do: [{ type: 'play' }] },
    ],
  };
  const runner = createRunner({ story, adapter, clock });
  const events = record(runner, clock);
  runner.start();
  clock.advance(5000);
  assert.deepEqual(adapter.types(), ['select', 'play']);
  const skipped = events.of('skipped');
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].reason, 'timeout');
  assert.equal(skipped[0].cond, 'selection');
  assert.equal(skipped[0].at, 1000);
  assert.deepEqual(events.of('caption').map((e) => [e.at, e.caption ? e.caption.text : null]), [[0, 'Here it is.'], [1000, 'Measured in the open.'], [3000, null]]);
  assert.equal(events.of('done')[0].at, 4000);
});

test('waitFor without hold gives up when its step ends, even if the timeout is longer', () => {
  const clock = createFakeClock();
  const adapter = fakeAdapter(clock, { conditions: { frames: false } });
  const story = {
    id: 'w',
    maxSeconds: 3,
    steps: [
      { id: 'x', duration: 1, waitFor: { cond: 'frames', timeoutMs: 60000 }, then: [{ type: 'play' }] },
      { id: 'y', duration: 2, do: [{ type: 'pause' }] },
    ],
  };
  const runner = createRunner({ story, adapter, clock });
  const events = record(runner, clock);
  runner.start();
  clock.advance(3000);
  assert.deepEqual(adapter.log.map((a) => [a.t, a.type]), [[1000, 'pause']]);
  assert.equal(events.of('skipped')[0].at, 1000);
  assert.equal(events.of('done')[0].at, 3000);
  assert.equal(clock.pending(), 0);
});

test('waitFor with hold freezes the story clock until the condition holds', () => {
  const clock = createFakeClock();
  const adapter = fakeAdapter(clock, { conditions: { frames: false } });
  const story = {
    id: 'tour',
    steps: [
      { id: 'x', duration: 2, do: [{ type: 'goTo', target: 'barnard' }], waitFor: { cond: 'frames', timeoutMs: 30000, hold: true }, then: [{ type: 'play' }] },
      { id: 'y', duration: 1, do: [{ type: 'pause' }] },
    ],
  };
  const runner = createRunner({ story, adapter, clock });
  const events = record(runner, clock);
  runner.start();
  assert.equal(runner.state(), 'waiting');
  clock.advance(7000);
  assert.equal(runner.time(), 0, 'story time stands still while loading');
  adapter.conditions.frames = true;
  clock.advance(50);
  assert.equal(runner.state(), 'running');
  clock.advance(5000);
  assert.deepEqual(adapter.log.map((a) => [a.t, a.type]), [[0, 'goTo'], [7050, 'play'], [9050, 'pause']]);
  assert.equal(events.of('done')[0].at, 10050);
});

test('waitFor with hold and a timeout moves on gracefully', () => {
  const clock = createFakeClock();
  const adapter = fakeAdapter(clock, { conditions: { frames: false } });
  const story = { id: 'tour', steps: [{ id: 'x', duration: 2, waitFor: { cond: 'frames', timeoutMs: 3000, hold: true }, then: [{ type: 'play' }] }] };
  const runner = createRunner({ story, adapter, clock });
  const events = record(runner, clock);
  runner.start();
  clock.advance(10000);
  assert.deepEqual(adapter.types(), []);
  assert.equal(events.of('skipped')[0].at, 3000);
  assert.equal(events.of('done')[0].at, 5000);
});

test('settleMs: the condition must stay true before the wait ends', () => {
  const clock = createFakeClock();
  let ok = false;
  const adapter = fakeAdapter(clock, { conditions: { loaded: () => ok } });
  const story = { id: 's', steps: [{ id: 'x', duration: 5, waitFor: { cond: 'loaded', timeoutMs: 4000, settleMs: 300 }, then: [{ type: 'play' }] }] };
  const runner = createRunner({ story, adapter, clock, pollMs: 50 });
  runner.start();
  ok = true;
  clock.advance(200);
  ok = false; // flickers off before it has settled
  clock.advance(200);
  ok = true;
  clock.advance(200);
  assert.deepEqual(adapter.types(), []);
  clock.advance(200);
  assert.deepEqual(adapter.types(), ['play']);
  assert.ok(adapter.log[0].t >= 700 && adapter.log[0].t <= 760, `settled at ${adapter.log[0].t}`);
});

test('poke() checks a pending condition at once', () => {
  const clock = createFakeClock();
  const adapter = fakeAdapter(clock, { conditions: { frames: false } });
  const story = { id: 'p', steps: [{ id: 'x', duration: 5, waitFor: { cond: 'frames', timeoutMs: 4000 }, then: [{ type: 'play' }] }] };
  const runner = createRunner({ story, adapter, clock, pollMs: 1000 });
  runner.start();
  clock.advance(10);
  adapter.conditions.frames = true;
  runner.poke();
  assert.deepEqual(adapter.log.map((a) => [a.t, a.type]), [[10, 'play']]);
});

test('pause freezes everything and resume carries on with nothing lost', () => {
  const clock = createFakeClock();
  const adapter = fakeAdapter(clock);
  const runner = createRunner({ story: simple(), adapter, clock });
  const events = record(runner, clock);
  runner.start();
  clock.advance(1500);
  assert.equal(runner.pause(), true);
  assert.equal(runner.state(), 'paused');
  assert.equal(runner.pause(), false, 'pausing twice does nothing');
  clock.advance(60000);
  assert.equal(runner.time(), 1.5);
  assert.deepEqual(adapter.types(), ['play', 'pause', 'set']);
  assert.equal(runner.resume(), true);
  clock.advance(1999);
  assert.deepEqual(adapter.types(), ['play', 'pause', 'set']);
  clock.advance(1);
  assert.deepEqual(adapter.types(), ['play', 'pause', 'set', 'frame']);
  clock.advance(5000);
  assert.equal(events.of('done')[0].at, 65000);
  assert.equal(events.of('done')[0].wallMs, 65000);
  assert.deepEqual([events.of('pause').length, events.of('resume').length], [1, 1]);
});

test('pause also stops the stopwatch of a pending condition', () => {
  const clock = createFakeClock();
  const adapter = fakeAdapter(clock, { conditions: { frames: false } });
  const story = { id: 'p', steps: [{ id: 'x', duration: 10, waitFor: { cond: 'frames', timeoutMs: 1000 }, then: [{ type: 'play' }] }] };
  const runner = createRunner({ story, adapter, clock });
  const events = record(runner, clock);
  runner.start();
  clock.advance(600);
  runner.pause();
  clock.advance(5000);
  assert.equal(events.of('skipped').length, 0, 'no timeout while paused');
  runner.resume();
  clock.advance(300);
  assert.equal(events.of('skipped').length, 0);
  adapter.conditions.frames = true;
  clock.advance(60);
  assert.deepEqual(adapter.types(), ['play']);
});

test('toggle() starts, pauses and resumes', () => {
  const clock = createFakeClock();
  const runner = createRunner({ story: simple(), adapter: fakeAdapter(clock), clock });
  runner.toggle();
  assert.equal(runner.state(), 'running');
  runner.toggle();
  assert.equal(runner.state(), 'paused');
  runner.toggle();
  assert.equal(runner.state(), 'running');
});

test('a step with key: true waits for the user at its end', () => {
  const clock = createFakeClock();
  const adapter = fakeAdapter(clock);
  const story = {
    id: 'tour',
    steps: [
      { id: 'a', duration: 2, key: true, caption: { title: 'A', text: 'try it' } },
      { id: 'b', duration: 1, do: [{ type: 'play' }] },
    ],
  };
  const runner = createRunner({ story, adapter, clock });
  const events = record(runner, clock);
  runner.start();
  clock.advance(30000);
  assert.equal(runner.state(), 'waiting');
  assert.deepEqual(events.of('waiting').map((e) => [e.reason, e.at]), [['key', 2000]]);
  assert.deepEqual(adapter.types(), []);
  runner.toggle(); // Space
  assert.equal(runner.state(), 'running');
  assert.deepEqual(adapter.log.map((a) => [a.t, a.type]), [[30000, 'play']]);
  clock.advance(1000);
  assert.equal(runner.state(), 'done');
  assert.equal(events.of('done')[0].at, 31000);
});

test('stop cancels everything and nothing fires afterwards', () => {
  const clock = createFakeClock();
  const adapter = fakeAdapter(clock);
  const runner = createRunner({ story: simple(), adapter, clock });
  const events = record(runner, clock);
  runner.start();
  clock.advance(500);
  assert.equal(runner.stop('user'), true);
  assert.equal(runner.state(), 'stopped');
  assert.equal(clock.pending(), 0);
  clock.advance(10000);
  assert.deepEqual(adapter.types(), ['play']);
  assert.equal(events.of('done').length, 0);
  assert.deepEqual(events.of('stop').map((e) => e.reason), ['user']);
  assert.equal(runner.stop(), false, 'stopping twice does nothing');
});

test('seek jumps to a step, replays the state before it, and keeps time from there', () => {
  const clock = createFakeClock();
  const adapter = fakeAdapter(clock);
  const story = {
    id: 'seek',
    steps: [
      { id: 'a', duration: 2, do: [{ type: 'goTo', target: 'barnard', state: { view: 'exposures', gaia: false } }, { type: 'play' }] },
      { id: 'b', duration: 2, do: [{ type: 'set', state: { view: 'passes', gaia: true } }, { type: 'fog' }] },
      { id: 'c', duration: 2, do: [{ type: 'set', state: { view: 'residual' } }, { type: 'panel', id: 'motion' }] },
      { id: 'd', duration: 2, do: [{ type: 'frame', index: 'last' }] },
    ],
  };
  const runner = createRunner({ story, adapter, clock });
  const events = record(runner, clock);
  runner.start();
  clock.advance(500);
  adapter.log.length = 0;
  assert.equal(runner.seek('d'), true);
  assert.equal(runner.index(), 3);
  assert.equal(runner.time(), 6);
  assert.deepEqual(adapter.log.map((a) => a.type), ['fog', 'goTo', 'panel', 'frame']);
  assert.equal(adapter.log[0].close, true, 'a sky map left open by an earlier step is closed');
  assert.deepEqual(adapter.log[1].state, { view: 'residual', gaia: true });
  assert.equal(adapter.log[2].id, 'motion');
  clock.advance(2000);
  assert.equal(runner.state(), 'done');
  assert.equal(events.of('done')[0].at, 2500);
  assert.equal(runner.seek(0), false, 'cannot seek once done');
});

test('next and prev step through the story', () => {
  const clock = createFakeClock();
  const adapter = fakeAdapter(clock);
  const runner = createRunner({ story: simple(), adapter, clock });
  const events = record(runner, clock);
  runner.start();
  clock.advance(200);
  runner.next();
  assert.equal(runner.step().id, 'b');
  runner.next();
  assert.equal(runner.step().id, 'c');
  runner.prev();
  assert.equal(runner.step().id, 'b', 'early in a step, prev goes to the one before');
  clock.advance(1800);
  runner.prev();
  assert.equal(runner.step().id, 'b', 'late in a step, prev restarts it');
  assert.equal(runner.time(), 1);
  runner.next();
  runner.next();
  assert.equal(runner.state(), 'done', 'next on the last step finishes');
  assert.equal(events.of('done').length, 1);
});

test('seeking while paused resumes from the new step', () => {
  const clock = createFakeClock();
  const runner = createRunner({ story: simple(), adapter: fakeAdapter(clock), clock });
  runner.start();
  clock.advance(100);
  runner.pause();
  runner.seek(2);
  assert.equal(runner.state(), 'running');
  clock.advance(1500);
  assert.equal(runner.state(), 'done');
});

test('restart plays the story again from the top', () => {
  const clock = createFakeClock();
  const adapter = fakeAdapter(clock);
  const runner = createRunner({ story: simple(), adapter, clock });
  const events = record(runner, clock);
  runner.start();
  clock.advance(2000);
  runner.restart();
  assert.equal(runner.time(), 0);
  clock.advance(5000);
  assert.equal(events.of('done').length, 1);
  assert.equal(events.of('done')[0].at, 7000);
  assert.equal(events.of('done')[0].wallMs, 5000);
  assert.deepEqual(adapter.types(), ['play', 'pause', 'set', 'play', 'pause', 'set', 'frame']);
  // ...and again after it has finished.
  runner.restart();
  clock.advance(5000);
  assert.equal(events.of('done').length, 2);
});

test('speed scales the whole schedule, and can change on the way', () => {
  const clock = createFakeClock();
  const adapter = fakeAdapter(clock);
  const runner = createRunner({ story: simple(), adapter, clock, speed: 2 });
  const events = record(runner, clock);
  runner.start();
  clock.advance(500);
  assert.equal(runner.time(), 1);
  assert.deepEqual(adapter.types(), ['play', 'pause', 'set']);
  runner.setSpeed(0.5); // story time 1 s; 4 s of story left = 8 s of wall
  assert.equal(runner.speed(), 0.5);
  clock.advance(7999);
  assert.equal(runner.state(), 'running');
  clock.advance(1);
  assert.equal(runner.state(), 'done');
  assert.equal(events.of('done')[0].at, 8500);
});

test('an unsupported action is reported and the story goes on', () => {
  const clock = createFakeClock();
  const adapter = fakeAdapter(clock, { unsupported: ['fog'], throws: ['explain'] });
  const story = { id: 'u', steps: [{ id: 'x', duration: 1, do: [{ type: 'fog' }, { type: 'explain', topic: 'flicker' }, { type: 'play' }] }] };
  const runner = createRunner({ story, adapter, clock });
  const events = record(runner, clock);
  runner.start();
  clock.advance(1000);
  assert.deepEqual(events.of('skipped').map((e) => [e.reason, e.action.type]), [['unsupported', 'fog'], ['error', 'explain']]);
  assert.deepEqual(adapter.types(), ['fog', 'play']);
  assert.equal(runner.state(), 'done');
});

test('a runner with no adapter at all still keeps time', () => {
  const clock = createFakeClock();
  const runner = createRunner({ story: simple(), clock });
  const events = record(runner, clock);
  runner.start();
  clock.advance(5000);
  assert.equal(runner.state(), 'done');
  assert.equal(events.of('skipped').length, 4);
});

test('a listener that throws does not stop the story', () => {
  const clock = createFakeClock();
  const runner = createRunner({ story: simple(), adapter: fakeAdapter(clock), clock });
  const original = console.error;
  console.error = () => {};
  try {
    runner.on('step', () => {
      throw new Error('listener bug');
    });
    runner.start();
    clock.advance(5000);
  } finally {
    console.error = original;
  }
  assert.equal(runner.state(), 'done');
});

test('captions with placeholders refresh when the value arrives', () => {
  const clock = createFakeClock();
  const adapter = fakeAdapter(clock, { conditions: { selection: false }, values: {} });
  const story = {
    id: 'c',
    steps: [{ id: 'x', duration: 3, caption: { title: 'Measure it', text: 'Tombaugh: {motion} arcsec/yr.', fallback: { text: 'Measured in the open.' } }, do: [{ type: 'select', where: 'target' }], waitFor: { cond: 'selection', timeoutMs: 2000 } }],
  };
  const runner = createRunner({ story, adapter, clock });
  const events = record(runner, clock);
  runner.start();
  clock.advance(400);
  adapter.values.motion = '10.31';
  adapter.conditions.selection = true;
  runner.poke();
  runner.refreshCaption();
  runner.refreshCaption();
  assert.deepEqual(events.of('caption').map((e) => [e.at, e.caption.text, e.caption.usedFallback]), [[0, 'Measured in the open.', true], [400, 'Tombaugh: 10.31 arcsec/yr.', false]]);
});

test('spotlight events follow the steps', () => {
  const clock = createFakeClock();
  const story = { id: 's', steps: [{ id: 'a', duration: 1, spotlight: { sky: 'target', label: 'Star' } }, { id: 'b', duration: 1 }] };
  const runner = createRunner({ story, adapter: fakeAdapter(clock), clock });
  const events = record(runner, clock);
  runner.start();
  clock.advance(2000);
  assert.deepEqual(events.of('spotlight').map((e) => [e.at, e.spotlight ? e.spotlight.label : null]), [[0, 'Star'], [1000, null]]);
});

// ---- preload ----------------------------------------------------------------------------------

const withPreload = () => ({
  id: 'film',
  maxSeconds: 5,
  startOnKey: true,
  preload: {
    label: 'Preparing the demonstration',
    ready: 'Ready. Press Space to start recording',
    items: [
      { label: 'one', do: [{ type: 'goTo', target: 'barnard' }], waitFor: { cond: 'loaded', timeoutMs: 5000 } },
      { label: 'two', do: [{ type: 'fog' }, { type: 'wait', ms: 400 }, { type: 'fog', close: true }] },
      { label: 'three', do: [{ type: 'set', state: { view: 'residual' } }], waitFor: { cond: 'frames', timeoutMs: 1000 } },
    ],
  },
  steps: [{ id: 'a', at: 0, duration: 2, do: [{ type: 'play' }] }, { id: 'b', at: 2, duration: 3, do: [{ type: 'pause' }] }],
});

test('preload runs before the clock, reports progress, then waits for the start key', async () => {
  const clock = createFakeClock();
  const adapter = fakeAdapter(clock, { conditions: { loaded: false, frames: false } });
  const runner = createRunner({ story: withPreload(), adapter, clock });
  const events = record(runner, clock);
  const ready = runner.prepare();
  assert.equal(runner.state(), 'preparing');
  assert.equal(runner.start(), false, 'cannot start while preparing');
  clock.advance(1200);
  adapter.conditions.loaded = true;
  clock.advance(100); // item one done at 1250
  clock.advance(400); // item two takes 400 ms
  clock.advance(1100); // item three times out after 1000 ms
  assert.equal(runner.state(), 'ready');
  await ready;
  assert.deepEqual(events.of('preload').map((e) => [e.done, e.total, e.label]), [[0, 3, 'one'], [1, 3, 'two'], [2, 3, 'three'], [3, 3, '']]);
  assert.deepEqual(adapter.log.map((a) => [a.t, a.type]), [[0, 'goTo'], [1250, 'fog'], [1650, 'fog'], [1650, 'set']]);
  const skipped = events.of('skipped');
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].label, 'three');
  assert.equal(events.of('ready').length, 1);
  assert.equal(events.of('start').length, 0, 'the clock has not started');
  assert.equal(runner.time(), 0);

  clock.advance(60000); // the owner takes his time
  adapter.log.length = 0;
  const pressed = clock.now();
  runner.toggle(); // Space
  clock.advance(5000);
  assert.equal(runner.state(), 'done');
  assert.deepEqual(adapter.log.map((a) => [a.t - pressed, a.type]), [[0, 'play'], [2000, 'pause']]);
  assert.equal(events.of('done')[0].wallMs, 5000, 'the film lasts exactly its length after the keypress');
});

test('a story without preload is ready at once', async () => {
  const clock = createFakeClock();
  const runner = createRunner({ story: simple(), adapter: fakeAdapter(clock), clock });
  const events = record(runner, clock);
  await runner.prepare();
  assert.equal(runner.state(), 'ready');
  assert.equal(events.of('ready').length, 1);
  assert.equal(events.of('preload').length, 0);
});

test('stop during preload ends it cleanly', async () => {
  const clock = createFakeClock();
  const adapter = fakeAdapter(clock, { conditions: { loaded: false } });
  const runner = createRunner({ story: withPreload(), adapter, clock });
  const events = record(runner, clock);
  const ready = runner.prepare();
  clock.advance(300);
  runner.stop('user');
  await ready;
  assert.equal(runner.state(), 'stopped');
  assert.equal(clock.pending(), 0);
  clock.advance(20000);
  assert.deepEqual(adapter.types(), ['goTo']);
  assert.equal(events.of('ready').length, 0);
});

// ---- stateBefore ------------------------------------------------------------------------------

test('stateBefore collapses earlier steps into the state to restore', () => {
  const plan = planTimeline({
    id: 's',
    steps: [
      { id: 'a', duration: 1, do: [{ type: 'set', state: { gaia: false } }] },
      { id: 'b', duration: 1, do: [{ type: 'explain', topic: 'flicker' }], waitFor: 'frames', then: [{ type: 'set', state: { det: 4 } }] },
      { id: 'c', duration: 1, do: [{ type: 'explain', topic: null }, { type: 'goTo', target: 'eps-indi-b', state: { view: 'lens' } }] },
      { id: 'd', duration: 1 },
    ],
  });
  assert.deepEqual(stateBefore(plan, 0), []);
  assert.deepEqual(stateBefore(plan, 1), [{ type: 'set', state: { gaia: false } }]);
  assert.deepEqual(stateBefore(plan, 2), [{ type: 'explain', topic: null }, { type: 'set', state: { gaia: false, det: 4 } }]);
  assert.deepEqual(stateBefore(plan, 3), [{ type: 'goTo', target: 'eps-indi-b', state: { gaia: false, det: 4, view: 'lens' } }]);
});

// ---- the fake clock itself --------------------------------------------------------------------

test('createFakeClock fires timers in time order and lets them schedule more', () => {
  const clock = createFakeClock(10);
  const seen = [];
  clock.setTimeout(() => seen.push(['b', clock.now()]), 200);
  clock.setTimeout(() => {
    seen.push(['a', clock.now()]);
    clock.setTimeout(() => seen.push(['c', clock.now()]), 50);
  }, 100);
  const cancelled = clock.setTimeout(() => seen.push(['never']), 120);
  clock.clearTimeout(cancelled);
  clock.advance(1000);
  assert.deepEqual(seen, [['a', 110], ['c', 160], ['b', 210]]);
  assert.equal(clock.now(), 1010);
  assert.equal(clock.pending(), 0);
});
