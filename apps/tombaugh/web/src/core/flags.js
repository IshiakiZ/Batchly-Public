// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// SPHEREx Level-2 FLAGS extension bit definitions.
//
// CONVENTIONS
// * The FLAGS image is int32; bit `b` is set when (value & (1 << b)) !== 0. Header keywords
//   name them MSKN<name>. Bit indices below were read from real Level-2 headers (see CONTRACT.md).
// * `bad: true` marks bits that make a pixel unusable for science by default. SOURCE (bit 21)
//   means "this pixel belongs to a known catalogue source" and is NOT a defect, so it is never
//   in the bad mask. Ghost, crosstalk and halo bits are advisory: the pixel value is real sky
//   plus a possible artefact, so they are kept but can be shown as an overlay.
// * All defined bits are below 31, so masks are ordinary non-negative JS integers and the
//   bitwise operators (which work on int32) are safe.

/** @type {Array<{ bit: number, name: string, description: string, bad: boolean }>} */
export const FLAG_BITS = [
  { bit: 0, name: 'TRANSIENT', description: 'Transient event during the exposure, usually a cosmic-ray hit', bad: true },
  { bit: 1, name: 'OVERFLOW', description: 'Signal overflowed the on-board accumulator', bad: true },
  { bit: 2, name: 'SUR_ERROR', description: 'Sample-up-the-ramp fit failed on board', bad: true },
  { bit: 6, name: 'NONFUNC', description: 'Non-functional detector pixel', bad: true },
  { bit: 7, name: 'DICHROIC', description: 'Affected by the dichroic beam-splitter edge', bad: false },
  { bit: 9, name: 'MISSING_DATA', description: 'No data received for this pixel', bad: true },
  { bit: 10, name: 'HOT', description: 'Hot pixel (high dark current)', bad: true },
  { bit: 11, name: 'COLD', description: 'Cold pixel (low response)', bad: true },
  { bit: 12, name: 'FULLSAMPLE', description: 'Full sample data available for this pixel (informational)', bad: false },
  { bit: 14, name: 'PHANMISS', description: 'Phantom-pixel correction unavailable', bad: false },
  { bit: 15, name: 'NONLINEAR', description: 'Beyond the range of the non-linearity correction', bad: true },
  { bit: 17, name: 'PERSIST', description: 'Persistence left by an earlier bright exposure', bad: true },
  { bit: 19, name: 'OUTLIER', description: 'Statistical outlier against repeat coverage', bad: true },
  { bit: 20, name: 'CROSSTALK', description: 'Possible electrical crosstalk from a bright pixel', bad: false },
  { bit: 21, name: 'SOURCE', description: 'Pixel mapped to a known catalogue source (not a defect)', bad: false },
  { bit: 22, name: 'GHOST', description: 'Possible optical ghost of a bright star', bad: false },
  { bit: 23, name: 'GHOST_FPA', description: 'Possible ghost from a focal-plane reflection', bad: false },
  { bit: 24, name: 'GHOST_EXT', description: 'Possible extended ghost', bad: false },
  { bit: 25, name: 'STREAK', description: 'Satellite or other streak', bad: true },
  { bit: 26, name: 'BLOOM', description: 'Charge bloomed from a saturated neighbour', bad: true },
  { bit: 27, name: 'SNOWBALL', description: 'Snowball (large cosmic-ray event)', bad: true },
  { bit: 28, name: 'HALO', description: 'Halo around a snowball or bright source', bad: false },
];

/** Build a bit mask from a list of flag names or bit indices. Unknown names are ignored. */
export function flagMask(namesOrBits) {
  let mask = 0;
  for (const item of namesOrBits || []) {
    if (typeof item === 'number') {
      if (item >= 0 && item < 31) mask |= 1 << item;
      continue;
    }
    const f = FLAG_BITS.find((b) => b.name === String(item).toUpperCase());
    if (f) mask |= 1 << f.bit;
  }
  return mask;
}

/** Default "bad pixel" mask for science: bits 0, 1, 2, 6, 9, 10, 11, 15, 17, 19, 25, 26, 27. */
export const DEFAULT_BAD_MASK = FLAG_BITS.reduce((m, f) => (f.bad ? m | (1 << f.bit) : m), 0);

/**
 * Names of the bits set in a FLAGS value, lowest bit first. Bits without a definition are
 * reported as "BIT<n>" rather than dropped. Non-finite input gives [].
 */
export function describeFlags(value) {
  const out = [];
  if (!Number.isFinite(value)) return out;
  const v = value | 0;
  if (v === 0) return out;
  for (let bit = 0; bit < 32; bit++) {
    if (((v >>> bit) & 1) === 0) continue;
    const f = FLAG_BITS.find((b) => b.bit === bit);
    out.push(f ? f.name : `BIT${bit}`);
  }
  return out;
}

/** True when the value has any bit of `mask` set (default: the science bad mask). */
export function isBadFlag(value, mask = DEFAULT_BAD_MASK) {
  return ((value | 0) & mask) !== 0;
}
