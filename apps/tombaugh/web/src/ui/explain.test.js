// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

import test from 'node:test';
import assert from 'node:assert/strict';
import { EXPLAIN, placeNote, createExplain } from './explain.js';

test('every note is short, plain and has its own id', () => {
  const ids = new Set();
  for (const e of EXPLAIN) {
    assert.ok(!ids.has(e.id), e.id);
    ids.add(e.id);
    assert.ok(e.title.length >= 4 && e.title.length <= 28, `${e.id} title`);
    assert.ok(e.text.length >= 40 && e.text.length <= 220, `${e.id} text is ${e.text.length}`);
    assert.equal(typeof e.find, 'function');
    assert.equal(e.find({ querySelector: () => null }), null, `${e.id} copes with a page that has no such part`);
  }
});

test('a note opens under its button, stays inside the window, and flips up at the bottom', () => {
  const view = { width: 390, height: 800 };
  const size = { width: 280, height: 120 };
  assert.deepEqual(placeNote({ right: 380, bottom: 100, top: 80 }, size, view), { left: 100, top: 108 });
  assert.equal(placeNote({ right: 60, bottom: 100, top: 80 }, size, view).left, 8, 'not off the left edge');
  assert.equal(placeNote({ right: 380, bottom: 760, top: 740 }, size, view).top, 612, 'above when there is no room below');
});

test('without a page it does nothing and does not throw', () => {
  const x = createExplain({ win: null, doc: null });
  x.refresh();
  x.close();
  x.destroy();
});
