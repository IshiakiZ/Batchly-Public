// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// RICE_1 tile (de)compression of 32-bit integers as used by FITS tile-compressed images
// (CFITSIO fits_rcomp / fits_rdecomp with bsize 4). The SPHEREx FLAGS extension stores one tile
// per image row: 2040 int32 values, block size 32.
//
//   riceDecompressInt32(bytes, nx, blockSize = 32) -> Int32Array(nx)
//   riceCompressInt32(values, blockSize = 32)      -> Uint8Array
//
// Stream format (bits are written most significant first):
//   4 bytes   first pixel value, big-endian, not coded
//   then, for every block of `blockSize` pixels (the last block may be shorter):
//     5 bits  fs + 1, the split parameter of the block
//       0          (fs = -1) every difference in the block is zero: nothing else is stored
//       1..25      (fs = 0..24) Rice code: for every pixel, the mapped difference d is stored as
//                  (d >>> fs) zero bits, a one bit, then the low fs bits of d
//       26         (fs = fsmax = 25) escape: every mapped difference stored raw in 32 bits
//   the last byte is padded with zero bits.
//   Differences are value[i] - value[i-1] in wrapping 32-bit arithmetic (the first difference is
//   zero) mapped to unsigned by zig-zag: d >= 0 -> 2d, d < 0 -> -2d - 1.
//
// The decoder follows docs/rice-reference.js, which was verified against real FLAGS tiles; the
// tests compare the two on random data. Integer bit operations are used only where the bit
// buffer provably stays below 2^31 (see the comments); everything else is unsigned (>>> 0).

const FSBITS = 5;
const FSMAX = 25;
const BBITS = 32;

function truncated(c, len) {
  return new Error(`RICE_1 tile is truncated or corrupt (needed byte ${c} of ${len})`);
}

/**
 * Decompress one RICE_1 tile.
 * @param {Uint8Array} bytes      the compressed tile, exactly as stored in the table heap
 * @param {number} nx             number of pixels in the tile (ZTILE1; 2040 for SPHEREx)
 * @param {number} [blockSize=32] ZVAL of BLOCKSIZE
 * @returns {Int32Array}
 */
export function riceDecompressInt32(bytes, nx, blockSize = 32) {
  const len = bytes.length;
  const out = new Int32Array(nx);
  if (nx === 0) return out;
  if (!(blockSize >= 1)) throw new Error(`RICE_1: bad block size ${blockSize}`);
  if (len < 5) throw truncated(len, len);
  let lastpix = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) | 0;
  let c = 4;
  let b = bytes[c++]; // bit buffer: the low `nbits` bits are still unread
  let nbits = 8;
  for (let i = 0; i < nx; ) {
    // Split parameter: 5 bits. b holds at most 8 bits here, so at most 16 after one refill.
    nbits -= FSBITS;
    while (nbits < 0) {
      if (c >= len) throw truncated(c, len);
      b = (b << 8) | bytes[c++];
      nbits += 8;
    }
    const fs = (b >>> nbits) - 1;
    if (fs > FSMAX) throw new Error(`RICE_1 tile is corrupt (split code ${fs + 1} at pixel ${i})`);
    b &= (1 << nbits) - 1;
    const imax = Math.min(i + blockSize, nx);
    if (fs < 0) {
      // All differences zero.
      for (; i < imax; i++) out[i] = lastpix;
    } else if (fs === FSMAX) {
      // Raw 32-bit differences. b holds nbits (0..7) bits; they are the top bits of the value.
      for (; i < imax; i++) {
        if (c + 4 > len) throw truncated(c + 4, len);
        let k = BBITS - nbits;
        let diff = nbits > 0 ? (b << k) >>> 0 : 0; // k = 32 when nbits = 0: nothing pending
        for (k -= 8; k >= 0; k -= 8) {
          b = bytes[c++];
          diff = (diff | (b << k)) >>> 0;
        }
        if (nbits > 0) {
          // -k = nbits here: the top 8 - nbits bits of the next byte complete the value.
          b = bytes[c++];
          diff = (diff | (b >>> -k)) >>> 0;
          b &= (1 << nbits) - 1;
        } else {
          b = 0;
        }
        const d = diff & 1 ? ~(diff >>> 1) : diff >>> 1;
        lastpix = (d + lastpix) | 0;
        out[i] = lastpix;
      }
    } else {
      // Rice coding with fs <= 24. After the leading one bit is removed b holds at most 7
      // bits, and the refill stops as soon as fs bits are available, so b < 2^(fs + 7) <= 2^31.
      for (; i < imax; i++) {
        while (b === 0) {
          if (c >= len) throw truncated(c, len);
          nbits += 8;
          b = bytes[c++];
        }
        const nzero = nbits - (32 - Math.clz32(b)); // zero bits before the first one bit
        nbits -= nzero + 1;
        b ^= 1 << nbits; // drop that one bit
        nbits -= fs;
        while (nbits < 0) {
          if (c >= len) throw truncated(c, len);
          b = (b << 8) | bytes[c++];
          nbits += 8;
        }
        // nzero * 2^fs can pass 2^32 only for corrupt input; >>> 0 wraps it like C does.
        const diff = (nzero * (1 << fs) + (b >>> nbits)) >>> 0;
        b &= (1 << nbits) - 1;
        const d = diff & 1 ? ~(diff >>> 1) : diff >>> 1;
        lastpix = (d + lastpix) | 0;
        out[i] = lastpix;
      }
    }
  }
  return out;
}

/**
 * Compress int32 values into one RICE_1 tile: a port of CFITSIO fits_rcomp (fsbits 5, fsmax 25).
 * The split parameter of each block is chosen exactly as CFITSIO does, from the mean mapped
 * difference of the block, so the output is byte-identical to CFITSIO's for the same input.
 * @param {Int32Array|number[]} values
 * @param {number} [blockSize=32]
 * @returns {Uint8Array}
 */
export function riceCompressInt32(values, blockSize = 32) {
  const nx = values.length;
  if (nx === 0) return new Uint8Array(0);
  if (!(blockSize >= 1)) throw new Error(`RICE_1: bad block size ${blockSize}`);
  // Worst case: 4 bytes + per block 5 bits + 32 bits per pixel (the encoder never picks a Rice
  // code longer than that on average, but a single block can run to about 2 * blockSize extra
  // unary bits per pixel), so the buffer simply grows when needed.
  let buf = new Uint8Array(16 + nx * 5 + Math.ceil(nx / blockSize));
  let pos = 0;
  let acc = 0; // bits of the byte being assembled
  let free = 8; // unused bits in that byte (1..8)

  const ensure = (extra) => {
    if (pos + extra <= buf.length) return;
    const grown = new Uint8Array(Math.max(buf.length * 2, pos + extra + 64));
    grown.set(buf.subarray(0, pos));
    buf = grown;
  };
  /** Append the low n bits (0..32) of value, most significant first. */
  const putBits = (value, n) => {
    ensure((n >> 3) + 2);
    while (n > 0) {
      const take = n < free ? n : free;
      acc = (acc << take) | ((value >>> (n - take)) & ((1 << take) - 1));
      free -= take;
      n -= take;
      if (free === 0) {
        buf[pos++] = acc;
        acc = 0;
        free = 8;
      }
    }
  };
  /** Append `count` zero bits followed by a one bit. */
  const putUnary = (count) => {
    ensure((count >> 3) + 2);
    while (count >= free) {
      buf[pos++] = (acc << free) & 0xff;
      count -= free;
      acc = 0;
      free = 8;
    }
    acc = (acc << (count + 1)) | 1;
    free -= count + 1;
    if (free === 0) {
      buf[pos++] = acc;
      acc = 0;
      free = 8;
    }
  };

  const first = values[0] | 0;
  putBits(first, 32);
  let lastpix = first; // so the first difference is always zero
  const diff = new Uint32Array(blockSize);
  for (let i = 0; i < nx; i += blockSize) {
    const thisblock = Math.min(blockSize, nx - i);
    let pixelsum = 0; // a double, as in CFITSIO: up to 2^32 * blockSize
    for (let j = 0; j < thisblock; j++) {
      const nextpix = values[i + j] | 0;
      const pdiff = (nextpix - lastpix) | 0; // wraps like C int arithmetic
      const mapped = (pdiff < 0 ? ~(pdiff << 1) : pdiff << 1) >>> 0;
      diff[j] = mapped;
      pixelsum += mapped;
      lastpix = nextpix;
    }
    // fs = number of bits of half the (slightly reduced) mean mapped difference.
    let dpsum = (pixelsum - Math.floor(thisblock / 2) - 1) / thisblock;
    if (dpsum < 0) dpsum = 0;
    let psum = Math.floor(Math.floor(dpsum) / 2);
    let fs = 0;
    for (; psum > 0; fs++) psum = Math.floor(psum / 2);

    if (fs >= FSMAX) {
      putBits(FSMAX + 1, FSBITS);
      for (let j = 0; j < thisblock; j++) putBits(diff[j], BBITS);
    } else if (fs === 0 && pixelsum === 0) {
      putBits(0, FSBITS);
    } else {
      putBits(fs + 1, FSBITS);
      for (let j = 0; j < thisblock; j++) {
        const v = diff[j];
        putUnary(v >>> fs);
        if (fs > 0) putBits(v, fs);
      }
    }
  }
  if (free < 8) buf[pos++] = (acc << free) & 0xff;
  return buf.slice(0, pos);
}
