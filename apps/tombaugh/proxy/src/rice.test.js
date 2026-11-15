// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

import test from 'node:test';
import assert from 'node:assert/strict';

import { riceCompressInt32, riceDecompressInt32 } from './rice.js';
// The decoder that was verified against real FLAGS tiles (kept in docs/ for reference).
import { riceReference } from '../../docs/rice-reference.js';

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join(' ');

/** Round trip through our codec and check the verified reference decoder agrees, byte for byte. */
function roundTrip(values, blockSize = 32) {
  const input = Int32Array.from(values);
  const packed = riceCompressInt32(input, blockSize);
  const back = riceDecompressInt32(packed, input.length, blockSize);
  assert.deepEqual(back, input);
  const ref = riceReference(packed, input.length, blockSize);
  assert.deepEqual(ref.out, input, 'reference decoder disagrees');
  assert.equal(ref.used, packed.length, 'reference decoder did not consume the tile exactly');
  return packed;
}

/** Sparse flag-like row: mostly zero, runs of SOURCE (bit 21), some HALO (28), rare others. */
function flagRow(rand, n = 2040) {
  const row = new Int32Array(n);
  for (let i = 0; i < n; ) {
    const r = rand();
    if (r < 0.9) {
      i += 1 + Math.floor(rand() * 40);
    } else {
      const len = 1 + Math.floor(rand() * 9);
      let v = 1 << 21;
      if (rand() < 0.3) v |= 1 << 28;
      if (rand() < 0.1) v |= 1 << Math.floor(rand() * 31);
      if (rand() < 0.02) v |= 1 << 31; // negative as int32
      for (let j = 0; j < len && i < n; j++, i++) row[i] = v;
    }
  }
  return row;
}

test('hand-computed vector: constant block is the raw value plus the 5-bit "all zero" code', () => {
  const packed = riceCompressInt32([5, 5, 5, 5]);
  assert.equal(hex(packed), '00 00 00 05 00');
  assert.deepEqual(riceDecompressInt32(packed, 4), Int32Array.from([5, 5, 5, 5]));
});

test('hand-computed vector: fs = 0 Rice block', () => {
  // diffs 0, +1 -> mapped 0, 2; sum 2; dpsum = (2 - 1 - 1) / 2 = 0 -> fs = 0, code 00001;
  // then "1" (top 0) and "001" (top 2): 00001 1 001 -> 0000 1100 1000 0000
  const packed = riceCompressInt32([0, 1]);
  assert.equal(hex(packed), '00 00 00 00 0c 80');
  assert.deepEqual(riceDecompressInt32(packed, 2), Int32Array.from([0, 1]));
});

test('hand-computed vector: fs = 2 Rice block', () => {
  // values 10 12 9 15 -> diffs 0 +2 -3 +6 -> mapped 0 4 5 12; sum 21;
  // dpsum = (21 - 2 - 1) / 4 = 4.5 -> psum = 4 >> 1 = 2 -> fs = 2, code 00011;
  // 0 -> "1" "00"; 4 -> "01" "00"; 5 -> "01" "01"; 12 -> "0001" "00"
  // 00011 100 0100 0101 000100 (+2 pad) = 00011100 01000101 00010000
  const packed = riceCompressInt32([10, 12, 9, 15]);
  assert.equal(hex(packed), '00 00 00 0a 1c 45 10');
  assert.deepEqual(riceDecompressInt32(packed, 4), Int32Array.from([10, 12, 9, 15]));
});

test('hand-computed vector: raw escape (fs = fsmax) for an extreme jump', () => {
  // values 0, -2^31 -> mapped 0, 0xffffffff -> fs >= 25 -> code 11010 then two raw 32-bit words:
  // 11010 + 32 zeros + 32 ones + 3 pad bits
  const packed = riceCompressInt32([0, -2147483648]);
  assert.equal(hex(packed), '00 00 00 00 d0 00 00 00 07 ff ff ff f8');
  assert.deepEqual(riceDecompressInt32(packed, 2), Int32Array.from([0, -2147483648]));
});

test('hand-computed vector: negative first value and a short second block', () => {
  // first value -2 = fe ff ff fe (big-endian two's complement); block size 2 -> two blocks:
  // block 1 (-2, -2): all zero -> 00000; block 2 (-1, -1): diffs +1, 0 -> mapped 2, 0, sum 2,
  // dpsum = 0 -> fs 0 -> 00001, "001", "1": 00000 00001 001 1 = 00000000 01001100
  const packed = riceCompressInt32([-2, -2, -1, -1], 2);
  assert.equal(hex(packed), 'ff ff ff fe 00 4c');
  assert.deepEqual(riceDecompressInt32(packed, 4, 2), Int32Array.from([-2, -2, -1, -1]));
});

test('round trip: flag-like sparse bitmasks with high bits, 2040 pixels', () => {
  const rand = mulberry32(20261115);
  let total = 0;
  for (let k = 0; k < 60; k++) {
    const row = flagRow(rand);
    total += roundTrip(row).length;
  }
  assert.ok(total < 60 * 2040 * 4, 'sparse flags must compress');
});

test('round trip: constant rows compress to a handful of bytes', () => {
  for (const v of [0, 1, -1, 1 << 21, (1 << 28) | (1 << 21), -2147483648, 2147483647]) {
    const packed = roundTrip(new Int32Array(2040).fill(v));
    // 4 bytes + 64 blocks * 5 bits = 4 + 40 bytes
    assert.equal(packed.length, 44);
  }
});

test('round trip: alternating extremes force the raw escape in every block', () => {
  // Differences of +-2^31 (which wrap to the same thing) map to 0xffffffff.
  const row = new Int32Array(2040);
  for (let i = 0; i < row.length; i++) row[i] = i % 2 ? 1073741824 : -1073741824;
  const packed = roundTrip(row);
  // 4 bytes + 63 full blocks of (5 + 32 * 32) bits + one block of 24 pixels
  const bits = 63 * (5 + 32 * 32) + (5 + 24 * 32);
  assert.equal(packed.length, 4 + Math.ceil(bits / 8));
  assert.equal(packed[4] >>> 3, 26, 'first block must use the escape code');
});

test('round trip: INT_MIN / INT_MAX alternation wraps to differences of +-1', () => {
  const row = new Int32Array(2040);
  for (let i = 0; i < row.length; i++) row[i] = i % 2 ? 2147483647 : -2147483648;
  const packed = roundTrip(row);
  assert.ok(packed.length < 2040, `wrapped differences are small, got ${packed.length} bytes`);
});

test('round trip: uniform random int32 (high entropy) and small-range noise', () => {
  const rand = mulberry32(7);
  for (let k = 0; k < 20; k++) {
    const row = new Int32Array(2040);
    for (let i = 0; i < row.length; i++) row[i] = (rand() * 4294967296) | 0;
    roundTrip(row);
  }
  for (const bitsWide of [1, 3, 8, 13, 20, 24, 27, 30]) {
    const row = new Int32Array(2040);
    for (let i = 0; i < row.length; i++) row[i] = Math.floor(rand() * 2 ** bitsWide) - 2 ** (bitsWide - 1);
    roundTrip(row);
  }
});

test('round trip: isolated spikes (long unary runs), all lengths 1..70, several block sizes', () => {
  const rand = mulberry32(99);
  for (let n = 1; n <= 70; n++) {
    const row = new Int32Array(n);
    for (let i = 0; i < n; i++) row[i] = rand() < 0.1 ? (1 << Math.floor(rand() * 31)) : 0;
    roundTrip(row);
    roundTrip(row, 16);
    roundTrip(row, 32);
  }
  const spike = new Int32Array(2040);
  spike[700] = 1 << 28;
  spike[701] = 1 << 28;
  spike[1500] = -(1 << 30);
  roundTrip(spike);
});

test('every split parameter 0..24 and the escape are produced and decode correctly', () => {
  const rand = mulberry32(5);
  const seen = new Set();
  for (let step = 0; step <= 27 * 4; step++) {
    const amplitude = 2 ** (step / 4);
    const row = new Int32Array(32 * 6);
    let v = 0;
    for (let i = 0; i < row.length; i++) {
      v = (v + Math.round((rand() - 0.5) * 2 * amplitude)) | 0;
      row[i] = v;
    }
    const packed = roundTrip(row);
    // the code of the first block is the 5 bits after the 4 raw bytes
    seen.add(packed[4] >>> 3);
  }
  for (let code = 1; code <= 26; code++) assert.ok(seen.has(code), `split code ${code} was never produced`);
});

test('truncated or empty tiles throw instead of returning garbage', () => {
  const rand = mulberry32(3);
  const packed = riceCompressInt32(flagRow(rand));
  assert.throws(() => riceDecompressInt32(packed.subarray(0, packed.length - 3), 2040), /truncated/);
  assert.throws(() => riceDecompressInt32(new Uint8Array(0), 2040), /truncated/);
  assert.deepEqual(riceDecompressInt32(new Uint8Array(0), 0), new Int32Array(0));
  assert.deepEqual(riceCompressInt32([]), new Uint8Array(0));
});

test('decoder speed: 59 rows of 2040 pixels in well under 50 ms', () => {
  const rand = mulberry32(11);
  const tiles = [];
  for (let k = 0; k < 59; k++) tiles.push(riceCompressInt32(flagRow(rand)));
  for (const t of tiles) riceDecompressInt32(t, 2040); // warm up
  const t0 = performance.now();
  for (const t of tiles) riceDecompressInt32(t, 2040);
  const ms = performance.now() - t0;
  assert.ok(ms < 50, `decoding took ${ms.toFixed(1)} ms`);
});
