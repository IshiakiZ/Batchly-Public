// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// gif.js: a dependency-free animated GIF89a encoder. Pure: no DOM, imports in Node unchanged.
//
//   encodeGif({ width, height, frames: [{ indices: Uint8Array, delayMs }], palette, loop = 0 })
//       -> Uint8Array     palette = Uint8Array(3 * n) of r, g, b with 1 <= n <= 256
//   createGifEncoder({ width, height, palette, loop = 0 })
//       -> { addFrame(indices, delayMs), finish() -> Uint8Array, frameCount, byteLength }
//       the same thing one frame at a time, so a page can encode in slices and stay responsive
//   rgbaFramesToGif(frames, { maxColors = 128, dither = false, loop = 0 }) -> Uint8Array
//       frames = [{ data: Uint8ClampedArray(w*h*4), width, height, delayMs }]; quantises every
//       frame against ONE shared palette (quantize.js) so a blink movie does not shimmer
//   lzwCompress(indices, minCodeSize) -> Uint8Array   the raw LZW code stream (no sub-blocks)
//
// What is written:
//   header "GIF89a", logical screen descriptor, global colour table padded to a power of two
//   (at least 2 entries), the NETSCAPE2.0 loop extension (loop = 0 repeats forever, n > 0 repeats
//   n times, null or a negative number omits the extension so the movie plays once), then for
//   every frame a graphic control extension (delay in centiseconds, disposal "leave in place"),
//   an image descriptor covering the whole screen, the LZW minimum code size, the LZW stream cut
//   into sub-blocks of at most 255 bytes, a block terminator, and finally the trailer 0x3B.
//
// LZW as GIF wants it: codes start at minCodeSize + 1 bits, are packed least significant bit
// first, begin with a clear code, grow by one bit when the next free code no longer fits, and the
// dictionary is reset with another clear code when all 4096 codes are used.

import { createPaletteBuilder, createMapper, mapPixels } from './quantize.js';

export const GIF_MAX_DIMENSION = 65535;
export const GIF_MIN_DELAY_MS = 20; // browsers play anything shorter at 100 ms

// ---------------------------------------------------------------------------------------------
// A growable byte buffer

function createWriter(initial = 4096) {
  let buf = new Uint8Array(Math.max(16, initial));
  let len = 0;
  function reserve(extra) {
    if (len + extra <= buf.length) return;
    let size = buf.length * 2;
    while (size < len + extra) size *= 2;
    const next = new Uint8Array(size);
    next.set(buf.subarray(0, len));
    buf = next;
  }
  return {
    get length() {
      return len;
    },
    byte(v) {
      reserve(1);
      buf[len++] = v & 255;
    },
    u16(v) {
      reserve(2);
      buf[len++] = v & 255;
      buf[len++] = (v >> 8) & 255;
    },
    bytes(arr) {
      reserve(arr.length);
      buf.set(arr, len);
      len += arr.length;
    },
    ascii(text) {
      reserve(text.length);
      for (let i = 0; i < text.length; i++) buf[len++] = text.charCodeAt(i) & 255;
    },
    /** A copy of exactly the bytes written so far. */
    toUint8Array() {
      return buf.slice(0, len);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// LZW

const HASH_BITS = 13;
const HASH_SIZE = 1 << HASH_BITS; // 8192 slots for at most 4096 - 258 entries: load below 0.5
const HASH_MASK = HASH_SIZE - 1;
const hashKeys = new Int32Array(HASH_SIZE);
const hashVals = new Int16Array(HASH_SIZE);

/**
 * GIF-flavoured LZW. `indices` are palette indices, all below 2 ** minCodeSize (the caller
 * checks). Returns the packed code stream without sub-block framing.
 */
export function lzwCompress(indices, minCodeSize) {
  const n = indices.length;
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  // Worst case is one 12-bit code per pixel; start smaller and grow.
  let out = new Uint8Array(Math.max(64, (n >> 1) + 16));
  let pos = 0;
  let acc = 0; // bit accumulator, least significant bit first
  let accBits = 0;
  let codeSize = minCodeSize + 1;
  let nextCode = eoiCode + 1;

  function emit(code) {
    acc |= code << accBits;
    accBits += codeSize;
    while (accBits >= 8) {
      if (pos === out.length) {
        const bigger = new Uint8Array(out.length * 2);
        bigger.set(out);
        out = bigger;
      }
      out[pos++] = acc & 255;
      acc >>>= 8;
      accBits -= 8;
    }
  }

  hashKeys.fill(-1);
  emit(clearCode);
  if (n > 0) {
    let prefix = indices[0];
    for (let i = 1; i < n; i++) {
      const k = indices[i];
      const key = (prefix << 8) | k; // prefix < 4096, k < 256: 20 bits
      let slot = (Math.imul(key, 0x9e3779b1) >>> (32 - HASH_BITS)) & HASH_MASK;
      let found = -1;
      while (hashKeys[slot] !== -1) {
        if (hashKeys[slot] === key) {
          found = hashVals[slot];
          break;
        }
        slot = (slot + 1) & HASH_MASK;
      }
      if (found !== -1) {
        prefix = found;
        continue;
      }
      emit(prefix);
      if (nextCode === 4096) {
        // Dictionary full: tell the decoder to start over.
        emit(clearCode);
        hashKeys.fill(-1);
        codeSize = minCodeSize + 1;
        nextCode = eoiCode + 1;
      } else {
        // The decoder is one entry behind and widens its codes when its own next free code
        // reaches 2 ** codeSize, which is exactly when ours is about to be assigned that value.
        if (nextCode >= 1 << codeSize) codeSize++;
        hashKeys[slot] = key;
        hashVals[slot] = nextCode++;
      }
      prefix = k;
    }
    emit(prefix);
    // Emitting that last code makes the decoder add one more entry (it cannot know the data
    // ended), so its code width may grow before it reads the end code. Follow it.
    if (nextCode < 4096 && nextCode >= 1 << codeSize) codeSize++;
  }
  emit(eoiCode);
  if (accBits > 0) {
    if (pos === out.length) {
      const bigger = new Uint8Array(out.length + 1);
      bigger.set(out);
      out = bigger;
    }
    out[pos++] = acc & 255;
  }
  return out.slice(0, pos);
}

// ---------------------------------------------------------------------------------------------
// Container

function colourTableBits(nColours) {
  let bits = 1;
  while (1 << bits < nColours) bits++;
  return bits; // 1..8, table holds 2 ** bits entries
}

function checkDimension(v, name) {
  if (!Number.isInteger(v) || v < 1 || v > GIF_MAX_DIMENSION) {
    throw new RangeError(`GIF ${name} must be an integer from 1 to ${GIF_MAX_DIMENSION}, got ${v}`);
  }
}

/** Delay in centiseconds as stored in the file. */
export function delayToCentiseconds(delayMs) {
  const ms = Number.isFinite(delayMs) && delayMs > 0 ? delayMs : 100;
  return Math.min(65535, Math.max(GIF_MIN_DELAY_MS / 10, Math.round(ms / 10)));
}

/**
 * Incremental encoder. Frames are full-screen and opaque; every frame replaces the previous one.
 */
export function createGifEncoder({ width, height, palette, loop = 0 } = {}) {
  checkDimension(width, 'width');
  checkDimension(height, 'height');
  if (!palette || palette.length < 3 || palette.length % 3 !== 0 || palette.length > 768) {
    throw new RangeError('GIF palette must hold 1 to 256 colours as r, g, b bytes');
  }
  const nColours = palette.length / 3;
  const bits = colourTableBits(nColours);
  const tableSize = 1 << bits;
  const minCodeSize = Math.max(2, bits);
  const pixels = width * height;
  const w = createWriter(1024 + tableSize * 3);
  let frameCount = 0;
  let finished = null;

  w.ascii('GIF89a');
  w.u16(width);
  w.u16(height);
  w.byte(0x80 | ((bits - 1) << 4) | (bits - 1)); // global table present, colour resolution, table size
  w.byte(0); // background colour index
  w.byte(0); // pixel aspect ratio: not given
  const table = new Uint8Array(tableSize * 3);
  table.set(palette);
  w.bytes(table);

  if (loop !== null && loop !== undefined && loop >= 0) {
    const count = Math.min(65535, Math.round(Number(loop)) || 0);
    w.byte(0x21);
    w.byte(0xff);
    w.byte(11);
    w.ascii('NETSCAPE2.0');
    w.byte(3);
    w.byte(1);
    w.u16(count);
    w.byte(0);
  }

  function addFrame(indices, delayMs) {
    if (finished) throw new Error('GIF encoder already finished');
    if (!indices || indices.length !== pixels) {
      throw new RangeError(`GIF frame must hold ${pixels} indices, got ${indices ? indices.length : 0}`);
    }
    for (let i = 0; i < pixels; i++) {
      if (indices[i] >= nColours) throw new RangeError(`GIF frame uses colour index ${indices[i]} but the palette has ${nColours} colours`);
    }
    // Graphic control extension
    w.byte(0x21);
    w.byte(0xf9);
    w.byte(4);
    w.byte(1 << 2); // disposal 1: leave in place; no transparency
    w.u16(delayToCentiseconds(delayMs));
    w.byte(0); // transparent colour index (unused)
    w.byte(0);
    // Image descriptor
    w.byte(0x2c);
    w.u16(0);
    w.u16(0);
    w.u16(width);
    w.u16(height);
    w.byte(0); // no local colour table, not interlaced
    // Image data
    w.byte(minCodeSize);
    const stream = lzwCompress(indices, minCodeSize);
    for (let at = 0; at < stream.length; at += 255) {
      const size = Math.min(255, stream.length - at);
      w.byte(size);
      w.bytes(stream.subarray(at, at + size));
    }
    w.byte(0); // block terminator
    frameCount++;
  }

  function finish() {
    if (!finished) {
      if (frameCount === 0) throw new Error('GIF needs at least one frame');
      w.byte(0x3b);
      finished = w.toUint8Array();
    }
    return finished;
  }

  return {
    addFrame,
    finish,
    get frameCount() {
      return frameCount;
    },
    get byteLength() {
      return finished ? finished.length : w.length;
    },
  };
}

/** One-shot encoder for frames that are already palette indices. */
export function encodeGif({ width, height, frames, palette, loop = 0 } = {}) {
  if (!Array.isArray(frames) || frames.length === 0) throw new Error('GIF needs at least one frame');
  const enc = createGifEncoder({ width, height, palette, loop });
  for (const f of frames) enc.addFrame(f.indices, f.delayMs);
  return enc.finish();
}

/**
 * RGBA frames -> animated GIF with one palette shared by every frame. Alpha is ignored (frames
 * are treated as opaque). All frames must have the same size.
 */
export function rgbaFramesToGif(frames, { maxColors = 128, dither = false, loop = 0 } = {}) {
  if (!Array.isArray(frames) || frames.length === 0) throw new Error('GIF needs at least one frame');
  const { width, height } = frames[0];
  checkDimension(width, 'width');
  checkDimension(height, 'height');
  for (const f of frames) {
    if (f.width !== width || f.height !== height) throw new RangeError('All GIF frames must have the same size');
    if (!f.data || f.data.length !== width * height * 4) throw new RangeError('GIF frame data must be width * height * 4 RGBA bytes');
  }
  const builder = createPaletteBuilder();
  for (const f of frames) builder.add(f.data);
  const palette = builder.build(maxColors);
  const mapper = createMapper(palette);
  const enc = createGifEncoder({ width, height, palette, loop });
  const indices = new Uint8Array(width * height);
  for (const f of frames) {
    mapPixels(f.data, width, height, mapper, { dither, out: indices });
    enc.addFrame(indices, f.delayMs);
  }
  return enc.finish();
}
