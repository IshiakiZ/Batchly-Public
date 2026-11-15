// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

import test from 'node:test';
import assert from 'node:assert/strict';
import { GLASS_KINDS, SKY_GLASS_KINDS, cornerRadius, visibleBox, nextScale, createBackdrop } from './backdrop.js';

test('a corner radius is read in pixels and never exceeds half the short side', () => {
  assert.equal(cornerRadius('26px', 400, 200), 26);
  assert.equal(cornerRadius('999px', 120, 38), 19);
  assert.equal(cornerRadius('12px 4px', 100, 100), 12);
  assert.equal(cornerRadius('50%', 80, 40), 20);
  assert.equal(cornerRadius('', 80, 40), 0);
  assert.equal(cornerRadius('none', 80, 40), 0);
  assert.equal(cornerRadius('-4px', 80, 40), 0);
});

test('a box on screen is drawn whole, clipped to the window', () => {
  const box = visibleBox({ left: 10, top: 20, right: 210, bottom: 120 }, null, { width: 800, height: 600 });
  assert.deepEqual(box, { x: 10, y: 20, w: 200, h: 100, clip: [0, 0, 800, 600] });
});

test('a box inside a scroller is clipped to the scroller', () => {
  const box = visibleBox({ left: 10, top: 380, right: 210, bottom: 480 }, { left: 0, top: 100, right: 300, bottom: 400 }, { width: 800, height: 600 });
  assert.deepEqual(box.clip, [0, 100, 300, 400]);
  assert.equal(box.h, 100);
});

test('a box that is off screen, scrolled away or tiny is not drawn', () => {
  const view = { width: 800, height: 600 };
  assert.equal(visibleBox(null, null, view), null);
  assert.equal(visibleBox({ left: 900, top: 0, right: 1000, bottom: 50 }, null, view), null);
  assert.equal(visibleBox({ left: 10, top: 420, right: 210, bottom: 480 }, { left: 0, top: 100, right: 300, bottom: 400 }, view), null);
  assert.equal(visibleBox({ left: 10, top: 10, right: 14, bottom: 60 }, null, view), null);
});

test('the drawing scale steps down only when frames are slow, and stops at the floor', () => {
  assert.equal(nextScale(1.5, 16), null);
  assert.equal(nextScale(1.5, 45), null);
  assert.equal(nextScale(1.5, 60), 1);
  assert.equal(nextScale(1, 60), 0.66);
  assert.equal(nextScale(0.66, 200), null);
});

test('every kind of glass names its pieces and has a low, positive edge', () => {
  for (const kind of [...GLASS_KINDS, ...SKY_GLASS_KINDS]) {
    assert.ok(kind.name && kind.selector, 'named and selected');
    assert.ok(kind.bevel > 0 && kind.bevel <= 16, `${kind.name} edge`);
    assert.ok(kind.frost >= 0 && kind.frost <= 1, `${kind.name} frost`);
  }
  // Buttons carry a lower edge than the cards they sit on.
  const edge = (list, name) => list.find((k) => k.name === name).bevel;
  assert.ok(edge(GLASS_KINDS, 'button') < edge(GLASS_KINDS, 'card'));
  assert.ok(edge(SKY_GLASS_KINDS, 'button') < edge(SKY_GLASS_KINDS, 'card'));
  // An open list is drawn last, so it covers the glass under it.
  assert.equal(SKY_GLASS_KINDS[SKY_GLASS_KINDS.length - 1].name, 'panel');
});

test('without a canvas there is no backdrop, and nothing throws', () => {
  assert.equal(createBackdrop(), null);
  assert.equal(createBackdrop({ canvas: {} }), null);
});
