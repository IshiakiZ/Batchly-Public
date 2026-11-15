// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

import test from 'node:test';
import assert from 'node:assert/strict';
import { pickItems, selectionTitle } from './home.js';
import { TARGETS } from '../core/targets.js';
import { starList } from '../sky/stardata.js';

test('the pick-list offers our places first, then every named star once, A to Z', () => {
  const items = pickItems(TARGETS, starList());
  const featured = items.filter((i) => i.group);
  assert.equal(featured.length, TARGETS.length);
  assert.deepEqual(featured.map((i) => i.name), TARGETS.map((t) => t.name));
  for (const i of featured) assert.equal(i.target.name, i.name);
  const rest = items.slice(featured.length);
  assert.ok(rest.length > 400);
  assert.deepEqual(rest.map((i) => i.name), rest.map((i) => i.name).sort((a, b) => a.localeCompare(b)));
  assert.equal(new Set(items.map((i) => i.name.toLowerCase())).size, items.length);
  for (const i of items) assert.ok(Number.isFinite(i.ra) && Number.isFinite(i.dec), i.name);
  assert.ok(rest.some((i) => i.name === 'Vega'));
  assert.ok(rest.some((i) => i.name === 'Betelgeuse'));
});

test('selectionTitle names what was picked in plain words', () => {
  assert.equal(selectionTitle({ kind: 'star', name: 'Vega' }), 'Vega');
  assert.equal(selectionTitle({ kind: 'star', name: '' }), 'A star with no name');
  assert.equal(selectionTitle({ kind: 'point', name: '' }), 'This spot');
  assert.equal(selectionTitle(null), '');
});

test('the solar system bodies sit between the targets and the stars, and carry their id', async () => {
  const { plainKind } = await import('./home.js');
  const { BODIES } = await import('../plugins/moving/bodies.js');
  const items = pickItems(TARGETS, starList(), BODIES);
  const firstBody = items.findIndex((i) => i.group === 'Solar system');
  const firstStar = items.findIndex((i) => !i.group);
  assert.ok(firstBody > 0 && firstBody < firstStar);
  const pluto = items.find((i) => i.name === 'Pluto');
  assert.equal(pluto.body, 'pluto');
  assert.equal(pluto.ra, undefined);
  // Every kind in the list has plain words.
  for (const b of BODIES) assert.ok(plainKind(b.kind).length > 3, b.kind);
});
