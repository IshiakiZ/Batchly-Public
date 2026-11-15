// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// Tests for gif.js. A minimal, independent GIF decoder lives in this file so the encoder is
// checked by round trip, and one test loads a produced GIF in headless Chromium (skipped when
// Playwright is not installed). No network: the browser only sees a data: URL.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';

import { encodeGif, createGifEncoder, rgbaFramesToGif, lzwCompress, delayToCentiseconds } from './gif.js';

// ---------------------------------------------------------------------------------------------
// Helpers

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomPalette(n, rand) {
  const p = new Uint8Array(n * 3);
  for (let i = 0; i < p.length; i++) p[i] = Math.floor(rand() * 256);
  return p;
}

function randomIndices(count, nColours, rand) {
  const out = new Uint8Array(count);
  for (let i = 0; i < count; i++) out[i] = Math.floor(rand() * nColours);
  return out;
}

/** GIF LZW decoder, written from the specification (not from the encoder). */
function lzwDecode(data, minCodeSize, pixelCount) {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  const prefix = new Int32Array(4096);
  const suffix = new Uint8Array(4096);
  const length = new Int32Array(4096);
  for (let i = 0; i < clear; i++) {
    prefix[i] = -1;
    suffix[i] = i;
    length[i] = 1;
  }
  const out = new Uint8Array(pixelCount);
  let outPos = 0;
  let codeSize = minCodeSize + 1;
  let next = eoi + 1;
  let prev = -1;
  let bitPos = 0;
  let sawEoi = false;
  let clears = 0;
  let maxCodeSize = codeSize;

  function firstOf(code) {
    let c = code;
    while (prefix[c] !== -1) c = prefix[c];
    return suffix[c];
  }
  function write(code) {
    const len = length[code];
    assert.ok(outPos + len <= pixelCount, 'LZW stream holds more pixels than the image');
    let c = code;
    for (let i = len - 1; i >= 0; i--) {
      out[outPos + i] = suffix[c];
      c = prefix[c];
    }
    outPos += len;
  }

  while (bitPos + codeSize <= data.length * 8) {
    let code = 0;
    for (let i = 0; i < codeSize; i++) {
      const bit = (data[(bitPos + i) >> 3] >> ((bitPos + i) & 7)) & 1;
      code |= bit << i;
    }
    bitPos += codeSize;
    if (code === clear) {
      codeSize = minCodeSize + 1;
      next = eoi + 1;
      prev = -1;
      clears++;
      continue;
    }
    if (code === eoi) {
      sawEoi = true;
      break;
    }
    if (prev === -1) {
      assert.ok(code < clear, 'first code after a clear must be a literal');
      write(code);
      prev = code;
      continue;
    }
    let first;
    if (code < next) first = firstOf(code);
    else {
      assert.equal(code, next, 'code beyond the dictionary');
      first = firstOf(prev);
    }
    if (next < 4096) {
      prefix[next] = prev;
      suffix[next] = first;
      length[next] = length[prev] + 1;
      next++;
      if (next === 1 << codeSize && codeSize < 12) codeSize++;
    }
    assert.ok(code < next, 'code not in dictionary');
    write(code);
    prev = code;
    if (codeSize > maxCodeSize) maxCodeSize = codeSize;
  }
  assert.ok(sawEoi, 'LZW stream must end with the end-of-information code');
  assert.equal(outPos, pixelCount, 'LZW stream must hold exactly the image');
  // Whatever follows the end code must be padding inside the last byte.
  assert.ok(data.length * 8 - bitPos < 8, 'no stray bytes after the end code');
  return { pixels: out, clears, maxCodeSize };
}

/** Parse a whole GIF file. Strict about structure; throws on anything unexpected. */
function decodeGif(u8) {
  const ascii = (a, b) => String.fromCharCode(...u8.subarray(a, b));
  const u16 = (o) => u8[o] | (u8[o + 1] << 8);
  assert.equal(ascii(0, 6), 'GIF89a');
  const width = u16(6);
  const height = u16(8);
  const packed = u8[10];
  assert.ok(packed & 0x80, 'global colour table flag');
  const tableSize = 1 << ((packed & 7) + 1);
  const background = u8[11];
  let pos = 13;
  const palette = u8.slice(pos, pos + tableSize * 3);
  pos += tableSize * 3;
  const frames = [];
  let loop = null;
  let gce = null;
  let subBlockMax = 0;
  let subBlockCount = 0;
  let sawTrailer = false;

  function readSubBlocks() {
    const parts = [];
    let total = 0;
    for (;;) {
      const size = u8[pos++];
      assert.ok(size !== undefined, 'file ended inside sub-blocks');
      if (size === 0) break;
      subBlockCount++;
      if (size > subBlockMax) subBlockMax = size;
      parts.push(u8.subarray(pos, pos + size));
      total += size;
      pos += size;
    }
    const all = new Uint8Array(total);
    let at = 0;
    for (const p of parts) {
      all.set(p, at);
      at += p.length;
    }
    return all;
  }

  while (pos < u8.length) {
    const marker = u8[pos++];
    if (marker === 0x3b) {
      sawTrailer = true;
      break;
    }
    if (marker === 0x21) {
      const label = u8[pos++];
      if (label === 0xf9) {
        assert.equal(u8[pos], 4, 'graphic control block size');
        gce = { packed: u8[pos + 1], delay: u16(pos + 2), transparent: u8[pos + 4] };
        assert.equal(u8[pos + 5], 0, 'graphic control terminator');
        pos += 6;
      } else if (label === 0xff) {
        assert.equal(u8[pos], 11, 'application block size');
        const id = ascii(pos + 1, pos + 12);
        pos += 12;
        const data = readSubBlocks();
        if (id === 'NETSCAPE2.0') {
          assert.equal(data.length, 3);
          assert.equal(data[0], 1);
          loop = data[1] | (data[2] << 8);
        }
      } else {
        readSubBlocks();
      }
      continue;
    }
    assert.equal(marker, 0x2c, `unexpected block 0x${marker.toString(16)} at ${pos - 1}`);
    const left = u16(pos);
    const top = u16(pos + 2);
    const w = u16(pos + 4);
    const h = u16(pos + 6);
    const ipacked = u8[pos + 8];
    pos += 9;
    assert.equal(ipacked & 0x80, 0, 'no local colour table expected');
    assert.equal(ipacked & 0x40, 0, 'not interlaced');
    const minCodeSize = u8[pos++];
    const data = readSubBlocks();
    const { pixels, clears, maxCodeSize } = lzwDecode(data, minCodeSize, w * h);
    frames.push({ left, top, width: w, height: h, minCodeSize, pixels, gce, clears, maxCodeSize, lzwBytes: data.length });
    gce = null;
  }
  assert.ok(sawTrailer, 'trailer');
  assert.equal(pos, u8.length, 'nothing after the trailer');
  return { width, height, tableSize, palette, background, loop, frames, subBlockMax, subBlockCount, packed };
}

function assertRoundTrip(width, height, palette, frames, loop = 0) {
  const bytes = encodeGif({ width, height, palette, frames, loop });
  const gif = decodeGif(bytes);
  assert.equal(gif.width, width);
  assert.equal(gif.height, height);
  assert.equal(gif.frames.length, frames.length);
  assert.ok(gif.subBlockMax <= 255);
  const n = palette.length / 3;
  assert.ok(gif.tableSize >= Math.max(2, n) && gif.tableSize < Math.max(2, n) * 2, 'table is the next power of two');
  assert.deepEqual([...gif.palette.subarray(0, palette.length)], [...palette]);
  for (let i = palette.length; i < gif.palette.length; i++) assert.equal(gif.palette[i], 0, 'padding is zero');
  for (let f = 0; f < frames.length; f++) {
    const got = gif.frames[f];
    assert.equal(got.width, width);
    assert.equal(got.height, height);
    assert.equal(got.left, 0);
    assert.equal(got.top, 0);
    assert.equal(Buffer.compare(Buffer.from(got.pixels), Buffer.from(frames[f].indices)), 0, `frame ${f} pixels (${width}x${height}, ${n} colours)`);
  }
  return { bytes, gif };
}

// ---------------------------------------------------------------------------------------------
// Structure

test('header, logical screen, colour table, loop extension, trailer', () => {
  const palette = new Uint8Array([0, 0, 0, 255, 255, 255, 229, 60, 39]);
  const indices = new Uint8Array([0, 1, 2, 1, 0, 2]);
  const bytes = encodeGif({ width: 3, height: 2, palette, frames: [{ indices, delayMs: 250 }] });
  assert.equal(String.fromCharCode(...bytes.subarray(0, 6)), 'GIF89a');
  assert.deepEqual([...bytes.subarray(6, 10)], [3, 0, 2, 0]); // width, height little-endian
  assert.equal(bytes[10], 0x80 | (1 << 4) | 1); // global table, 2 bits per primary, 4 entries
  assert.equal(bytes[11], 0);
  assert.equal(bytes[12], 0);
  // 3 colours are padded to 4
  assert.deepEqual([...bytes.subarray(13, 25)], [0, 0, 0, 255, 255, 255, 229, 60, 39, 0, 0, 0]);
  // NETSCAPE2.0, loop forever
  assert.deepEqual([...bytes.subarray(25, 28)], [0x21, 0xff, 11]);
  assert.equal(String.fromCharCode(...bytes.subarray(28, 39)), 'NETSCAPE2.0');
  assert.deepEqual([...bytes.subarray(39, 44)], [3, 1, 0, 0, 0]);
  // graphic control extension: delay 25 centiseconds
  assert.deepEqual([...bytes.subarray(44, 52)], [0x21, 0xf9, 4, 4, 25, 0, 0, 0]);
  // image descriptor
  assert.deepEqual([...bytes.subarray(52, 62)], [0x2c, 0, 0, 0, 0, 3, 0, 2, 0, 0]);
  assert.equal(bytes[62], 2); // LZW minimum code size
  assert.equal(bytes[bytes.length - 1], 0x3b);
  assert.equal(bytes[bytes.length - 2], 0); // block terminator before the trailer
});

test('loop count: forever, n times, or no extension at all', () => {
  const palette = new Uint8Array([0, 0, 0, 255, 255, 255]);
  const frames = [{ indices: new Uint8Array([0, 1, 1, 0]), delayMs: 100 }];
  assert.equal(decodeGif(encodeGif({ width: 2, height: 2, palette, frames })).loop, 0);
  assert.equal(decodeGif(encodeGif({ width: 2, height: 2, palette, frames, loop: 3 })).loop, 3);
  assert.equal(decodeGif(encodeGif({ width: 2, height: 2, palette, frames, loop: 700 })).loop, 700);
  assert.equal(decodeGif(encodeGif({ width: 2, height: 2, palette, frames, loop: null })).loop, null);
  assert.equal(decodeGif(encodeGif({ width: 2, height: 2, palette, frames, loop: -1 })).loop, null);
});

test('per-frame delays in centiseconds, disposal "leave in place", no transparency', () => {
  const palette = new Uint8Array([0, 0, 0, 255, 255, 255]);
  const mk = (delayMs) => ({ indices: new Uint8Array([0, 1, 1, 0]), delayMs });
  const gif = decodeGif(encodeGif({ width: 2, height: 2, palette, frames: [mk(500), mk(125), mk(40), mk(1), mk(undefined), mk(1e9)] }));
  assert.deepEqual(gif.frames.map((f) => f.gce.delay), [50, 13, 4, 2, 10, 65535]);
  for (const f of gif.frames) {
    assert.equal((f.gce.packed >> 2) & 7, 1);
    assert.equal(f.gce.packed & 1, 0);
  }
  assert.equal(delayToCentiseconds(250), 25);
  assert.equal(delayToCentiseconds(0), 10);
  assert.equal(delayToCentiseconds(NaN), 10);
});

test('colour table is padded to a power of two with at least two entries', () => {
  const rand = mulberry32(5);
  for (const n of [1, 2, 3, 4, 5, 8, 9, 16, 17, 31, 32, 33, 64, 100, 128, 129, 200, 255, 256]) {
    const palette = randomPalette(n, rand);
    const indices = randomIndices(20, n, rand);
    const { gif, bytes } = assertRoundTrip(5, 4, palette, [{ indices, delayMs: 100 }]);
    let expect = 2;
    while (expect < n) expect *= 2;
    assert.equal(gif.tableSize, expect, `${n} colours`);
    assert.equal(gif.frames[0].minCodeSize, Math.max(2, Math.log2(expect)));
    assert.equal(bytes[10] & 7, Math.log2(expect) - 1);
  }
});

// ---------------------------------------------------------------------------------------------
// LZW round trips

test('round trip: random images, several sizes and palette sizes', () => {
  const rand = mulberry32(20261115);
  const sizes = [[1, 1], [1, 7], [13, 1], [2, 2], [3, 5], [17, 9], [64, 64], [59, 59], [256, 256], [300, 200]];
  const colours = [1, 2, 3, 4, 5, 16, 17, 64, 128, 200, 255, 256];
  for (const [w, h] of sizes) {
    for (const n of colours) {
      const palette = randomPalette(n, rand);
      assertRoundTrip(w, h, palette, [{ indices: randomIndices(w * h, n, rand), delayMs: 100 }]);
    }
  }
});

test('round trip: structured images (flat, stripes, checker, gradient, repeats)', () => {
  const rand = mulberry32(7);
  for (const [w, h] of [[1, 1], [8, 8], [31, 17], [128, 96], [384, 384]]) {
    for (const n of [2, 4, 7, 128, 256]) {
      const palette = randomPalette(n, rand);
      const total = w * h;
      const flat0 = new Uint8Array(total);
      const flatTop = new Uint8Array(total).fill(n - 1);
      const vstripes = new Uint8Array(total);
      const hstripes = new Uint8Array(total);
      const checker = new Uint8Array(total);
      const gradient = new Uint8Array(total);
      const blocks = new Uint8Array(total);
      const period3 = new Uint8Array(total);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          vstripes[i] = x % n;
          hstripes[i] = y % n;
          checker[i] = (x + y) % 2 ? n - 1 : 0;
          gradient[i] = Math.floor((x / w) * n);
          blocks[i] = (Math.floor(x / 6) * 7 + Math.floor(y / 6) * 13) % n; // like a nearest-neighbour upscale
          period3[i] = i % 3 === 0 ? 0 : n - 1;
        }
      }
      for (const indices of [flat0, flatTop, vstripes, hstripes, checker, gradient, blocks, period3]) {
        assertRoundTrip(w, h, palette, [{ indices, delayMs: 100 }]);
      }
    }
  }
});

test('long flat runs compress hard and exercise the code-equals-next case', () => {
  const palette = new Uint8Array([10, 10, 10, 240, 240, 240]);
  const indices = new Uint8Array(512 * 512); // one colour
  const { bytes, gif } = assertRoundTrip(512, 512, palette, [{ indices, delayMs: 100 }]);
  assert.ok(bytes.length < 2000, `flat 512x512 frame should be tiny, got ${bytes.length} bytes`);
  assert.ok(gif.frames[0].maxCodeSize >= 9, 'codes grew');
});

test('dictionary fills up: code size reaches 12 bits and clear codes are sent again', () => {
  const rand = mulberry32(99);
  const palette = randomPalette(256, rand);
  const w = 320;
  const h = 240;
  const indices = randomIndices(w * h, 256, rand);
  const { gif } = assertRoundTrip(w, h, palette, [{ indices, delayMs: 100 }]);
  assert.equal(gif.frames[0].maxCodeSize, 12);
  assert.ok(gif.frames[0].clears > 5, `expected several clear codes, got ${gif.frames[0].clears}`);
  assert.equal(gif.subBlockMax, 255);
  assert.ok(gif.subBlockCount > 100);
});

test('image lengths around every code-size boundary round trip (end code width)', () => {
  // Incompressible-ish data with 4 colours: the code size steps up after 4, 12, 28, ... new codes,
  // so sweeping the length puts the end code just before and just after each step.
  const rand = mulberry32(3);
  const palette = randomPalette(4, rand);
  for (let len = 1; len <= 600; len++) {
    const indices = randomIndices(len, 4, rand);
    assertRoundTrip(len, 1, palette, [{ indices, delayMs: 100 }]);
  }
  // And near the 4096 limit, where the dictionary resets.
  const p256 = randomPalette(256, rand);
  for (let len = 3830; len <= 3850; len++) {
    assertRoundTrip(len, 1, p256, [{ indices: randomIndices(len, 256, rand), delayMs: 100 }]);
  }
  const de = mulberry32(8);
  // De Bruijn-like stream that never repeats a pair early: one new code per pixel.
  for (const len of [4094, 4095, 4096, 4097, 4098, 8190, 8191, 8192, 8193]) {
    assertRoundTrip(len, 1, p256, [{ indices: randomIndices(len, 256, de), delayMs: 100 }]);
  }
});

test('lzwCompress: empty input is clear + end, single pixel is clear + literal + end', () => {
  // min code size 2: clear = 4 (100), end = 5 (101), 3-bit codes, least significant bit first.
  assert.deepEqual([...lzwCompress(new Uint8Array(0), 2)], [0b101100]);
  assert.deepEqual([...lzwCompress(new Uint8Array([1]), 2)], [0b01001100, 0b1]);
  // The classic 10-pixel example checks against a hand-built decode.
  const data = new Uint8Array([1, 1, 1, 1, 1, 2, 2, 2, 2, 2]);
  assert.deepEqual([...lzwDecode(lzwCompress(data, 2), 2, 10).pixels], [...data]);
});

test('multi-frame animation: every frame survives, frames are independent', () => {
  const rand = mulberry32(42);
  const palette = randomPalette(128, rand);
  const w = 96;
  const h = 96;
  const frames = [];
  for (let f = 0; f < 12; f++) frames.push({ indices: randomIndices(w * h, 128, rand), delayMs: 80 + f * 10 });
  const { gif } = assertRoundTrip(w, h, palette, frames);
  assert.deepEqual(gif.frames.map((f) => f.gce.delay), frames.map((f) => Math.round(f.delayMs / 10)));
});

test('incremental encoder gives the same bytes as the one-shot encoder', () => {
  const rand = mulberry32(11);
  const palette = randomPalette(16, rand);
  const frames = [0, 1, 2].map(() => ({ indices: randomIndices(40 * 30, 16, rand), delayMs: 200 }));
  const enc = createGifEncoder({ width: 40, height: 30, palette, loop: 0 });
  for (const f of frames) enc.addFrame(f.indices, f.delayMs);
  assert.equal(enc.frameCount, 3);
  const a = enc.finish();
  const b = encodeGif({ width: 40, height: 30, palette, frames });
  assert.equal(Buffer.compare(Buffer.from(a), Buffer.from(b)), 0);
  assert.equal(enc.byteLength, a.length);
  assert.equal(enc.finish(), a, 'finish is idempotent');
  assert.throws(() => enc.addFrame(frames[0].indices, 100), /finished/);
});

test('bad input is rejected with a clear error', () => {
  const palette = new Uint8Array([0, 0, 0, 255, 255, 255]);
  const ok = { indices: new Uint8Array(4), delayMs: 100 };
  assert.throws(() => encodeGif({ width: 0, height: 2, palette, frames: [ok] }), /width/);
  assert.throws(() => encodeGif({ width: 2, height: 70000, palette, frames: [ok] }), /height/);
  assert.throws(() => encodeGif({ width: 2.5, height: 2, palette, frames: [ok] }), /width/);
  assert.throws(() => encodeGif({ width: 2, height: 2, palette: new Uint8Array(4), frames: [ok] }), /palette/);
  assert.throws(() => encodeGif({ width: 2, height: 2, palette: new Uint8Array(771), frames: [ok] }), /palette/);
  assert.throws(() => encodeGif({ width: 2, height: 2, palette, frames: [] }), /at least one frame/);
  assert.throws(() => encodeGif({ width: 2, height: 2, palette, frames: [{ indices: new Uint8Array(5), delayMs: 1 }] }), /4 indices/);
  assert.throws(() => encodeGif({ width: 2, height: 2, palette, frames: [{ indices: new Uint8Array([0, 1, 2, 0]), delayMs: 1 }] }), /colour index 2/);
  assert.throws(() => rgbaFramesToGif([]), /at least one frame/);
  assert.throws(() => rgbaFramesToGif([{ data: new Uint8ClampedArray(16), width: 2, height: 2 }, { data: new Uint8ClampedArray(4), width: 1, height: 1 }]), /same size/);
  assert.throws(() => rgbaFramesToGif([{ data: new Uint8ClampedArray(15), width: 2, height: 2 }]), /RGBA/);
});

test('encoder does not modify its inputs', () => {
  const rand = mulberry32(1);
  const palette = randomPalette(5, rand);
  const indices = randomIndices(50, 5, rand);
  const p0 = palette.slice();
  const i0 = indices.slice();
  encodeGif({ width: 10, height: 5, palette, frames: [{ indices, delayMs: 100 }] });
  assert.deepEqual(palette, p0);
  assert.deepEqual(indices, i0);
});

// ---------------------------------------------------------------------------------------------
// RGBA -> GIF

/** A synthetic sky movie: gray star field with one mover, n x n upscaled by `zoom`. */
function skyMovie({ n = 32, zoom = 4, frames = 6, colour = false, seed = 1 } = {}) {
  const rand = mulberry32(seed);
  const stars = [];
  for (let i = 0; i < 12; i++) stars.push({ x: rand() * n, y: rand() * n, f: 60 + rand() * 400 });
  const size = n * zoom;
  const out = [];
  for (let f = 0; f < frames; f++) {
    const small = new Float32Array(n * n);
    for (let i = 0; i < small.length; i++) small[i] = 12 + rand() * 10;
    const all = stars.concat([{ x: 4 + f * 3, y: 20 - f, f: 300 }]);
    for (const s of all) {
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const d2 = (x - s.x) ** 2 + (y - s.y) ** 2;
          if (d2 < 16) small[y * n + x] += s.f * Math.exp(-d2 / 1.6);
        }
      }
    }
    const data = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const v = small[Math.floor(y / zoom) * n + Math.floor(x / zoom)];
        const o = (y * size + x) * 4;
        data[o] = v;
        data[o + 1] = colour ? v * 0.8 : v;
        data[o + 2] = colour ? v * 0.5 + 20 : v;
        data[o + 3] = 255;
      }
    }
    out.push({ data, width: size, height: size, delayMs: 250 });
  }
  return out;
}

function decodedRgb(gif, frame, i) {
  const idx = gif.frames[frame].pixels[i];
  return [gif.palette[idx * 3], gif.palette[idx * 3 + 1], gif.palette[idx * 3 + 2]];
}

test('rgbaFramesToGif: few colours are reproduced exactly', () => {
  const colours = [[23, 23, 21], [247, 242, 231], [229, 60, 39], [119, 118, 110]];
  const w = 20;
  const h = 10;
  const frames = [0, 1, 2].map((f) => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const c = colours[(i * 7 + f * 3 + Math.floor(i / w)) % colours.length];
      data.set([c[0], c[1], c[2], 255], i * 4);
    }
    return { data, width: w, height: h, delayMs: 500 };
  });
  const gif = decodeGif(rgbaFramesToGif(frames));
  assert.equal(gif.frames.length, 3);
  assert.equal(gif.tableSize, 4);
  for (let f = 0; f < 3; f++) {
    for (let i = 0; i < w * h; i++) {
      assert.deepEqual(decodedRgb(gif, f, i), [...frames[f].data.subarray(i * 4, i * 4 + 3)]);
    }
  }
});

test('rgbaFramesToGif: gray sky movie stays within one gray step of the original', () => {
  const frames = skyMovie({ n: 32, zoom: 4, frames: 6 });
  const bytes = rgbaFramesToGif(frames, { maxColors: 128 });
  const gif = decodeGif(bytes);
  assert.equal(gif.width, 128);
  assert.equal(gif.frames.length, 6);
  assert.equal(gif.tableSize, 128);
  let worst = 0;
  for (let f = 0; f < frames.length; f++) {
    for (let i = 0; i < 128 * 128; i++) {
      const [r, g, b] = decodedRgb(gif, f, i);
      assert.equal(r, g);
      assert.equal(g, b);
      worst = Math.max(worst, Math.abs(r - frames[f].data[i * 4]));
    }
  }
  assert.ok(worst <= 1, `worst gray error ${worst}`);
});

test('rgbaFramesToGif: one shared palette, so an unchanged pixel keeps its exact colour in every frame', () => {
  const frames = skyMovie({ n: 24, zoom: 3, frames: 5, colour: true, seed: 9 });
  // Paint the same patch into every frame.
  for (const f of frames) {
    for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) f.data.set([90 + x * 3, 70 + y * 5, 40, 255], (y * f.width + x) * 4);
  }
  const gif = decodeGif(rgbaFramesToGif(frames, { maxColors: 64 }));
  assert.ok(gif.tableSize <= 64);
  for (let i = 0; i < 9; i++) {
    const first = decodedRgb(gif, 0, i * frames[0].width + i);
    for (let f = 1; f < frames.length; f++) assert.deepEqual(decodedRgb(gif, f, i * frames[0].width + i), first);
  }
  // And the colour error is modest.
  let sum = 0;
  let count = 0;
  for (let f = 0; f < frames.length; f++) {
    for (let i = 0; i < frames[f].width * frames[f].height; i += 7) {
      const [r, g, b] = decodedRgb(gif, f, i);
      const d = frames[f].data;
      sum += (r - d[i * 4]) ** 2 + (g - d[i * 4 + 1]) ** 2 + (b - d[i * 4 + 2]) ** 2;
      count++;
    }
  }
  assert.ok(Math.sqrt(sum / count) < 8, `rms colour error ${Math.sqrt(sum / count).toFixed(2)}`);
});

test('rgbaFramesToGif: maxColors is honoured and dithering still decodes', () => {
  const frames = skyMovie({ n: 20, zoom: 2, frames: 3, colour: true, seed: 4 });
  for (const maxColors of [2, 5, 16, 256]) {
    for (const dither of [false, true]) {
      const gif = decodeGif(rgbaFramesToGif(frames, { maxColors, dither }));
      assert.ok(gif.tableSize <= Math.max(2, 2 ** Math.ceil(Math.log2(maxColors))));
      let top = 0;
      for (const f of gif.frames) for (const v of f.pixels) if (v > top) top = v;
      assert.ok(top < maxColors, `indices stay below ${maxColors}`);
    }
  }
});

test('an upscaled sky frame compresses well below one byte per pixel', () => {
  const frames = skyMovie({ n: 64, zoom: 6, frames: 2 });
  const bytes = rgbaFramesToGif(frames);
  const perPixel = bytes.length / (2 * 384 * 384);
  assert.ok(perPixel < 0.5, `${perPixel.toFixed(3)} bytes per pixel`);
});

// ---------------------------------------------------------------------------------------------
// A real browser must accept the file

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    // not resolvable from here: try the global install locations
  }
  const require = createRequire(import.meta.url);
  const candidates = [];
  for (const dir of (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean)) candidates.push(path.join(dir, 'playwright'));
  candidates.push(path.resolve(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'playwright'));
  candidates.push('/usr/local/lib/node_modules/playwright', '/usr/lib/node_modules/playwright');
  for (const c of candidates) {
    try {
      return require(c);
    } catch {
      // next candidate
    }
  }
  return null;
}

test('headless Chromium decodes the GIF from a data: URL (size, pixels, every frame)', async (t) => {
  const pw = await loadPlaywright();
  if (!pw || !pw.chromium) {
    t.skip('Playwright is not installed');
    return;
  }
  let browser;
  try {
    browser = await pw.chromium.launch();
  } catch (err) {
    t.skip(`Chromium could not start: ${String(err.message).split('\n')[0]}`);
    return;
  }
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    // A made-up https origin answered from here (no network): WebCodecs' ImageDecoder, used below
    // to check every frame, only exists in a secure context.
    await page.route('https://tombaugh.test/**', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>gif</title><body></body>' }));
    await page.goto('https://tombaugh.test/');

    const cases = [];
    // 1. A gray movie through the whole RGBA pipeline, non-square.
    {
      const w = 150;
      const h = 100;
      const frames = [];
      const rand = mulberry32(77);
      for (let f = 0; f < 5; f++) {
        const data = new Uint8ClampedArray(w * h * 4);
        for (let i = 0; i < w * h; i++) {
          const v = Math.floor(rand() * 256) & 0xfe; // even levels: 128 distinct grays, exact palette
          data.set([v, v, v, 255], i * 4);
        }
        frames.push({ data, width: w, height: h, delayMs: 200 });
      }
      cases.push({ name: 'gray', w, h, frames, bytes: rgbaFramesToGif(frames, { maxColors: 128 }), delays: [200, 200, 200, 200, 200] });
    }
    // 2. 256 random colours, large enough to reset the dictionary many times.
    {
      const rand = mulberry32(5);
      const palette = randomPalette(256, rand);
      const w = 384;
      const h = 384;
      const idxFrames = [0, 1, 2].map((f) => ({ indices: randomIndices(w * h, 256, rand), delayMs: 100 + f * 150 }));
      const frames = idxFrames.map((fr) => {
        const data = new Uint8ClampedArray(w * h * 4);
        for (let i = 0; i < w * h; i++) data.set([palette[fr.indices[i] * 3], palette[fr.indices[i] * 3 + 1], palette[fr.indices[i] * 3 + 2], 255], i * 4);
        return { data, width: w, height: h };
      });
      cases.push({ name: 'random256', w, h, frames, bytes: encodeGif({ width: w, height: h, palette, frames: idxFrames }), delays: [100, 250, 400] });
    }
    // 3. Three colours (table padded to four), tiny.
    {
      const palette = new Uint8Array([23, 23, 21, 247, 242, 231, 229, 60, 39]);
      const w = 7;
      const h = 3;
      const idxFrames = [0, 1].map((f) => ({ indices: Uint8Array.from({ length: w * h }, (_, i) => (i + f) % 3), delayMs: 500 }));
      const frames = idxFrames.map((fr) => {
        const data = new Uint8ClampedArray(w * h * 4);
        for (let i = 0; i < w * h; i++) data.set([palette[fr.indices[i] * 3], palette[fr.indices[i] * 3 + 1], palette[fr.indices[i] * 3 + 2], 255], i * 4);
        return { data, width: w, height: h };
      });
      cases.push({ name: 'three', w, h, frames, bytes: encodeGif({ width: w, height: h, palette, frames: idxFrames }), delays: [500, 500] });
    }

    for (const c of cases) {
      const b64 = Buffer.from(c.bytes).toString('base64');
      // The expected pixels travel as base64 and are compared inside the page (much faster than
      // sending millions of numbers back).
      const expected = c.frames.map((f) => Buffer.from(f.data.buffer, f.data.byteOffset, f.data.length).toString('base64'));
      const result = await page.evaluate(async ({ b64, w, h, expected }) => {
        const bytesOf = (text) => {
          const bin = atob(text);
          const u8 = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
          return u8;
        };
        const want = expected.map(bytesOf);
        const mismatches = (got, exp) => {
          if (got.length !== exp.length) return -1;
          let bad = 0;
          for (let i = 0; i < exp.length; i++) if (got[i] !== exp[i]) bad++;
          return bad;
        };
        const img = new Image();
        const loaded = new Promise((resolve, reject) => {
          img.onload = () => resolve(true);
          img.onerror = () => reject(new Error('img error event'));
        });
        img.src = `data:image/gif;base64,${b64}`;
        await loaded;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        const out = {
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
          firstBad: mismatches(ctx.getImageData(0, 0, w, h).data, want[0]),
          frameBad: null,
          durations: null,
          repetitions: null,
        };
        if (typeof ImageDecoder === 'function') {
          const dec = new ImageDecoder({ data: bytesOf(b64), type: 'image/gif' });
          await dec.tracks.ready;
          await dec.completed;
          const track = dec.tracks.selectedTrack;
          out.repetitions = String(track.repetitionCount);
          out.frameBad = [];
          out.durations = [];
          for (let i = 0; i < track.frameCount; i++) {
            const { image } = await dec.decode({ frameIndex: i });
            out.durations.push(image.duration / 1000);
            ctx.clearRect(0, 0, w, h);
            ctx.drawImage(image, 0, 0);
            image.close();
            out.frameBad.push(i < want.length ? mismatches(ctx.getImageData(0, 0, w, h).data, want[i]) : -1);
          }
        }
        return out;
      }, { b64, w: c.w, h: c.h, expected });

      assert.equal(result.naturalWidth, c.w, `${c.name} naturalWidth`);
      assert.equal(result.naturalHeight, c.h, `${c.name} naturalHeight`);
      assert.equal(result.firstBad, 0, `${c.name}: first frame pixels as drawn from <img>`);
      t.diagnostic(`${c.name}: ${c.bytes.length} bytes, <img> ${result.naturalWidth}x${result.naturalHeight}, ImageDecoder ${result.frameBad ? `checked ${result.frameBad.length} frames` : 'not available'}`);
      if (result.frameBad) {
        assert.deepEqual(result.frameBad, c.frames.map(() => 0), `${c.name}: every frame decodes to the original pixels`);
        assert.deepEqual(result.durations, c.delays, `${c.name} frame durations (ms)`);
        assert.equal(result.repetitions, 'Infinity', `${c.name} loops forever`);
      }
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
