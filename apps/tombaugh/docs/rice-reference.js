// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// REFERENCE ONLY (not imported by the app). This exact RICE_1 decoder was run in a browser on
// Nov 15 2026 against the real file
//   qr3/level2/2026W25_2A/l2b-v27-2026-273/2/level2_2026W25_2A_0279_1D2_spx_l2b-v27-2026-273.fits
// (FLAGS tiles for image rows 510, 539 and 568, 1-based). Each tile was consumed to its last byte
// (5744 of 5744 for row 539) and the decoded pixels x = 1647..1705 matched, value for value, the
// uncompressed FLAGS extension of IRSA's own cutout of the same file (center 210.80227, 54.34895,
// size 0.1 deg, 59 x 59). Typical values there: 2097152 (bit 21, SOURCE) and 270532608 (bits 28 + 21).
// It uses plain Number arithmetic so the bit buffer can never go negative.
export function riceReference(bytes, nx, nblock = 32) {
  const out = new Int32Array(nx);
  const fsbits = 5, fsmax = 25, bbits = 32;
  let lastpix = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) | 0;
  let c = 4;
  let b = bytes[c++];
  let nbits = 8;
  for (let i = 0; i < nx;) {
    nbits -= fsbits;
    while (nbits < 0) { b = b * 256 + bytes[c++]; nbits += 8; }
    const fs = Math.floor(b / 2 ** nbits) - 1;
    b = b % 2 ** nbits;
    const imax = Math.min(i + nblock, nx);
    if (fs < 0) {
      for (; i < imax; i++) out[i] = lastpix;
    } else if (fs === fsmax) {
      for (; i < imax; i++) {
        let k = bbits - nbits;
        let diff = b * 2 ** k;
        for (k -= 8; k >= 0; k -= 8) { b = bytes[c++]; diff += b * 2 ** k; }
        if (nbits > 0) { b = bytes[c++]; diff += Math.floor(b / 2 ** (-k)); b = b % 2 ** nbits; } else b = 0;
        diff = diff % 4294967296;
        const d = (diff % 2) ? ~Math.floor(diff / 2) : Math.floor(diff / 2);
        lastpix = (d + lastpix) | 0;
        out[i] = lastpix;
      }
    } else {
      for (; i < imax; i++) {
        while (b === 0) { nbits += 8; b = bytes[c++]; }
        const hb = 32 - Math.clz32(b);
        const nzero = nbits - hb;
        nbits -= nzero + 1;
        b = b - 2 ** nbits;
        nbits -= fs;
        while (nbits < 0) { b = b * 256 + bytes[c++]; nbits += 8; }
        const diff = nzero * 2 ** fs + Math.floor(b / 2 ** nbits);
        b = b % 2 ** nbits;
        const d = (diff % 2) ? ~Math.floor(diff / 2) : Math.floor(diff / 2);
        lastpix = (d + lastpix) | 0;
        out[i] = lastpix;
      }
    }
  }
  return { out, used: c };
}
