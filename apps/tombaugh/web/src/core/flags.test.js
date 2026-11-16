// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// Tests for flags.js. Run: node --test web/src/core/flags.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FLAG_BITS, DEFAULT_BAD_MASK, describeFlags, flagMask, isBadFlag } from './flags.js';

// Straight from CONTRACT.md.
const CONTRACT_BITS = {
  0: 'TRANSIENT', 1: 'OVERFLOW', 2: 'SUR_ERROR', 6: 'NONFUNC', 7: 'DICHROIC', 9: 'MISSING_DATA',
  10: 'HOT', 11: 'COLD', 12: 'FULLSAMPLE', 14: 'PHANMISS', 15: 'NONLINEAR', 17: 'PERSIST',
  19: 'OUTLIER', 20: 'CROSSTALK', 21: 'SOURCE', 22: 'GHOST', 23: 'GHOST_FPA', 24: 'GHOST_EXT',
  25: 'STREAK', 26: 'BLOOM', 27: 'SNOWBALL', 28: 'HALO',
};
const CONTRACT_BAD = [0, 1, 2, 6, 9, 10, 11, 15, 17, 19, 25, 26, 27];

test('FLAG_BITS lists every contract bit with a name and a description', () => {
  assert.equal(FLAG_BITS.length, 22);
  const seenBits = new Set();
  const seenNames = new Set();
  let prev = -1;
  for (const f of FLAG_BITS) {
    assert.equal(CONTRACT_BITS[f.bit], f.name, `bit ${f.bit}`);
    assert.ok(typeof f.description === 'string' && f.description.length >= 8 && f.description.length <= 80);
    assert.equal(typeof f.bad, 'boolean');
    assert.equal(f.bad, CONTRACT_BAD.includes(f.bit), `bad flag of ${f.name}`);
    assert.ok(f.bit > prev, 'sorted by bit');
    prev = f.bit;
    seenBits.add(f.bit);
    seenNames.add(f.name);
  }
  assert.equal(seenBits.size, 22);
  assert.equal(seenNames.size, 22);
  assert.equal(FLAG_BITS.find((f) => f.name === 'SOURCE').bad, false, 'SOURCE is not a defect');
});

test('DEFAULT_BAD_MASK is exactly the contract bad set', () => {
  const expected = CONTRACT_BAD.reduce((m, b) => m + 2 ** b, 0);
  assert.equal(DEFAULT_BAD_MASK, expected);
  assert.equal(DEFAULT_BAD_MASK, 235572807); // 0x0E0A8E47
  assert.ok(DEFAULT_BAD_MASK > 0 && Number.isInteger(DEFAULT_BAD_MASK));
  assert.equal(DEFAULT_BAD_MASK & (1 << 21), 0, 'SOURCE is not in the bad mask');
  for (const b of [7, 12, 14, 20, 22, 23, 24, 28]) assert.equal(DEFAULT_BAD_MASK & (1 << b), 0);
  for (const b of CONTRACT_BAD) assert.notEqual(DEFAULT_BAD_MASK & (1 << b), 0);
});

test('describeFlags names the set bits', () => {
  assert.deepEqual(describeFlags(0), []);
  assert.deepEqual(describeFlags(1), ['TRANSIENT']);
  assert.deepEqual(describeFlags(1 << 21), ['SOURCE']);
  assert.deepEqual(describeFlags((1 << 21) | (1 << 10) | (1 << 27)), ['HOT', 'SOURCE', 'SNOWBALL']);
  assert.deepEqual(describeFlags(1 << 13), ['BIT13']); // undefined bit is reported, not hidden
  assert.deepEqual(describeFlags((1 << 28) | (1 << 3)), ['BIT3', 'HALO']);
  assert.equal(describeFlags(DEFAULT_BAD_MASK).length, 13);
  assert.deepEqual(describeFlags(NaN), []);
  assert.deepEqual(describeFlags(undefined), []);
  // Sign bit of an int32 does not break anything.
  assert.deepEqual(describeFlags(-2147483648), ['BIT31']);
  // Every defined flag round-trips.
  for (const f of FLAG_BITS) assert.deepEqual(describeFlags(2 ** f.bit), [f.name]);
});

test('flagMask and isBadFlag', () => {
  assert.equal(flagMask(['HOT', 'cold']), (1 << 10) | (1 << 11));
  assert.equal(flagMask([21, 'GHOST']), (1 << 21) | (1 << 22));
  assert.equal(flagMask(['NOPE']), 0);
  assert.equal(flagMask(), 0);
  assert.equal(flagMask(FLAG_BITS.filter((f) => f.bad).map((f) => f.name)), DEFAULT_BAD_MASK);
  assert.equal(isBadFlag(1 << 10), true);
  assert.equal(isBadFlag(1 << 21), false);
  assert.equal(isBadFlag((1 << 21) | (1 << 22)), false);
  assert.equal(isBadFlag(1 << 21, 1 << 21), true);
  assert.equal(isBadFlag(0), false);
});
