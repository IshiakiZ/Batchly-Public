// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

import test from 'node:test';
import assert from 'node:assert/strict';
import { filterPicks, exactPick } from './picklist.js';

const items = ['Vega', 'Alpha Vegae', 'Barnard\'s Star', 'Navega', 'Sirius', 'Luhman 16'].map((name) => ({ name }));

test('an empty box lists everything in the order given', () => {
  assert.deepEqual(filterPicks(items, '').map((i) => i.name), items.map((i) => i.name));
  assert.deepEqual(filterPicks(items, '   ').length, items.length);
});

test('typing narrows the list: names that start with it, then words, then anywhere', () => {
  assert.deepEqual(filterPicks(items, 'veg').map((i) => i.name), ['Vega', 'Alpha Vegae', 'Navega']);
  assert.deepEqual(filterPicks(items, 'STAR').map((i) => i.name), ['Barnard\'s Star']);
  assert.deepEqual(filterPicks(items, '16').map((i) => i.name), ['Luhman 16']);
  assert.deepEqual(filterPicks(items, 'zzz'), []);
});

test('exactPick matches a whole name whatever the case', () => {
  assert.equal(exactPick(items, ' sirius ').name, 'Sirius');
  assert.equal(exactPick(items, 'siri'), null);
  assert.equal(exactPick(items, ''), null);
});
