// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// quantize.js: colour quantisation for the GIF export. Pure: no DOM, imports in Node unchanged.
//
//   createPaletteBuilder() -> { add(rgba, stride = 1), build(maxColors = 128) -> Uint8Array(3*n),
//                               pixels, colours, isGray }
//       Feed it every frame of a movie, then build ONE palette for all of them.
//   buildPalette(rgbaOrList, maxColors = 128) -> Uint8Array(3*n)      one-call version
//   createMapper(palette) -> { nearest(r, g, b) -> index, palette, size, isGray }
//   mapPixels(rgba, width, height, mapperOrPalette, { dither = false, out }) -> Uint8Array(w*h)
//   quantizeFrames(frames, { maxColors = 128, dither = false }) -> { palette, indexed: Uint8Array[] }
//
// How the palette is chosen:
//   * If the pixels hold no more distinct colours than maxColors, the palette is exactly those
//     colours and the mapping is lossless.
//   * Grayscale fast path: if every pixel has r = g = b (an ordinary Tombaugh frame), the palette
//     is an even ramp of grays between the darkest and brightest level present, and mapping is a
//     256-entry table lookup.
//   * Otherwise median cut: all colours start in one box; the box with the largest squared error
//     is cut in two along its longest (highest variance) axis, at the point that leaves the least
//     error on both sides, until there are maxColors boxes. Each palette entry is the mean colour
//     of its box. Cutting by error rather than by pixel count keeps a few bright stars from being
//     swallowed by a great many dark sky pixels.
//   Palettes are sorted from dark to light, so index 0 is the darkest colour.
//
// Alpha is ignored everywhere: pixels are treated as opaque.

const TABLE_BITS = 17;
const TABLE_SIZE = 1 << TABLE_BITS; // slots in the colour histogram
const TABLE_MASK = TABLE_SIZE - 1;
const TABLE_LIMIT = 49152; // distinct entries kept before colours are binned more coarsely

function clampColors(maxColors) {
  const m = Math.round(Number(maxColors));
  if (!Number.isFinite(m)) return 128;
  return Math.min(256, Math.max(2, m));
}

function luma(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Sort a flat r, g, b palette from dark to light (stable for equal luminance). */
function sortPalette(colours) {
  colours.sort((a, b) => luma(a[0], a[1], a[2]) - luma(b[0], b[1], b[2]) || a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  const out = new Uint8Array(colours.length * 3);
  for (let i = 0; i < colours.length; i++) {
    out[i * 3] = colours[i][0];
    out[i * 3 + 1] = colours[i][1];
    out[i * 3 + 2] = colours[i][2];
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Histogram of colours: an open-addressing hash table keyed by (r, g, b) >> shift. It starts
// exact (shift 0) and only bins more coarsely if an image has a very large number of colours.

function createHistogram() {
  let keys = new Int32Array(TABLE_SIZE).fill(-1);
  let count = new Float64Array(TABLE_SIZE);
  let sumR = new Float64Array(TABLE_SIZE);
  let sumG = new Float64Array(TABLE_SIZE);
  let sumB = new Float64Array(TABLE_SIZE);
  let used = 0;
  let shift = 0;

  function slotFor(key) {
    let slot = (Math.imul(key, 0x9e3779b1) >>> (32 - TABLE_BITS)) & TABLE_MASK;
    while (keys[slot] !== -1 && keys[slot] !== key) slot = (slot + 1) & TABLE_MASK;
    return slot;
  }

  /** Halve the colour resolution and merge entries that now share a key. */
  function coarsen() {
    const oldKeys = keys;
    const oldCount = count;
    const oldR = sumR;
    const oldG = sumG;
    const oldB = sumB;
    keys = new Int32Array(TABLE_SIZE).fill(-1);
    count = new Float64Array(TABLE_SIZE);
    sumR = new Float64Array(TABLE_SIZE);
    sumG = new Float64Array(TABLE_SIZE);
    sumB = new Float64Array(TABLE_SIZE);
    used = 0;
    shift++;
    for (let s = 0; s < TABLE_SIZE; s++) {
      if (oldKeys[s] === -1) continue;
      const c = oldCount[s];
      const key = (((oldR[s] / c) >> shift) << 16) | (((oldG[s] / c) >> shift) << 8) | ((oldB[s] / c) >> shift);
      const slot = slotFor(key);
      if (keys[slot] === -1) {
        keys[slot] = key;
        used++;
      }
      count[slot] += c;
      sumR[slot] += oldR[s];
      sumG[slot] += oldG[s];
      sumB[slot] += oldB[s];
    }
    if (used > TABLE_LIMIT && shift < 7) coarsen();
  }

  function add(r, g, b, weight) {
    const key = ((r >> shift) << 16) | ((g >> shift) << 8) | (b >> shift);
    const slot = slotFor(key);
    if (keys[slot] === -1) {
      keys[slot] = key;
      used++;
    }
    count[slot] += weight;
    sumR[slot] += r * weight;
    sumG[slot] += g * weight;
    sumB[slot] += b * weight;
    if (used > TABLE_LIMIT && shift < 7) coarsen();
  }

  /** Entries as parallel arrays: weight and mean colour. */
  function entries() {
    const w = new Float64Array(used);
    const r = new Float64Array(used);
    const g = new Float64Array(used);
    const b = new Float64Array(used);
    let m = 0;
    for (let s = 0; s < TABLE_SIZE; s++) {
      if (keys[s] === -1) continue;
      const c = count[s];
      w[m] = c;
      r[m] = sumR[s] / c;
      g[m] = sumG[s] / c;
      b[m] = sumB[s] / c;
      m++;
    }
    return { n: m, w, r, g, b };
  }

  return {
    add,
    entries,
    get used() {
      return used;
    },
    get exact() {
      return shift === 0;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Median cut over histogram entries

function medianCut(ent, maxColors) {
  const { n, w, r, g, b } = ent;
  const chan = [r, g, b];
  const order = new Int32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;

  function makeBox(start, end) {
    let sw = 0;
    const s = [0, 0, 0];
    const q = [0, 0, 0];
    for (let i = start; i < end; i++) {
      const e = order[i];
      const we = w[e];
      sw += we;
      for (let c = 0; c < 3; c++) {
        const v = chan[c][e];
        s[c] += we * v;
        q[c] += we * v * v;
      }
    }
    const mean = [s[0] / sw, s[1] / sw, s[2] / sw];
    const varc = [0, 0, 0];
    let sse = 0;
    for (let c = 0; c < 3; c++) {
      varc[c] = Math.max(0, q[c] - sw * mean[c] * mean[c]); // weighted squared error on this axis
      sse += varc[c];
    }
    return { start, end, weight: sw, mean, varc, sse, dead: end - start < 2 || !(sse > 1e-9) };
  }

  const binW = new Float64Array(256);
  const binS = new Float64Array(256);

  /** Cut a box in two on its best axis. Returns [left, right] or null if it cannot be cut. */
  function split(box) {
    const axes = [0, 1, 2].sort((a, c) => box.varc[c] - box.varc[a]);
    for (const axis of axes) {
      if (!(box.varc[axis] > 1e-9)) break;
      const v = chan[axis];
      binW.fill(0);
      binS.fill(0);
      let lo = 255;
      let hi = 0;
      for (let i = box.start; i < box.end; i++) {
        const e = order[i];
        const k = Math.min(255, Math.max(0, Math.round(v[e])));
        binW[k] += w[e];
        binS[k] += w[e] * v[e];
        if (k < lo) lo = k;
        if (k > hi) hi = k;
      }
      if (hi === lo) continue; // everything lands on one level of this axis: try another
      // Threshold t (left = levels <= t) that maximises the separation between the two means.
      let totalS = 0;
      for (let k = lo; k <= hi; k++) totalS += binS[k];
      let wl = 0;
      let sl = 0;
      let best = -1;
      let bestT = lo;
      for (let t = lo; t < hi; t++) {
        wl += binW[t];
        sl += binS[t];
        const wr = box.weight - wl;
        if (!(wl > 0) || !(wr > 0)) continue;
        const d = sl / wl - (totalS - sl) / wr;
        const score = (wl * wr * d * d) / box.weight;
        if (score > best) {
          best = score;
          bestT = t;
        }
      }
      if (best < 0) continue;
      // Partition order[start..end) in place.
      let i = box.start;
      let j = box.end - 1;
      while (i <= j) {
        if (Math.min(255, Math.max(0, Math.round(v[order[i]]))) <= bestT) i++;
        else {
          const tmp = order[i];
          order[i] = order[j];
          order[j] = tmp;
          j--;
        }
      }
      if (i === box.start || i === box.end) continue;
      return [makeBox(box.start, i), makeBox(i, box.end)];
    }
    return null;
  }

  const boxes = [makeBox(0, n)];
  while (boxes.length < maxColors) {
    let pick = -1;
    for (let i = 0; i < boxes.length; i++) {
      if (!boxes[i].dead && (pick < 0 || boxes[i].sse > boxes[pick].sse)) pick = i;
    }
    if (pick < 0) break;
    const parts = split(boxes[pick]);
    if (!parts) {
      boxes[pick].dead = true;
      continue;
    }
    boxes[pick] = parts[0];
    boxes.push(parts[1]);
  }
  return boxes.map((box) => box.mean.map((v) => Math.min(255, Math.max(0, Math.round(v)))));
}

// ---------------------------------------------------------------------------------------------
// Palette builder

export function createPaletteBuilder() {
  let hist = null; // created on the first coloured pixel
  const grayCount = new Float64Array(256);
  let isGray = true;
  let pixels = 0;

  /** Move what the gray histogram holds into the colour histogram (once, when colour appears). */
  function leaveGrayPath() {
    hist = createHistogram();
    for (let v = 0; v < 256; v++) if (grayCount[v] > 0) hist.add(v, v, v, grayCount[v]);
    isGray = false;
  }

  /** Count the pixels of one RGBA buffer. `stride` > 1 samples every stride-th pixel. */
  function add(rgba, stride = 1) {
    if (!rgba || !rgba.length) return;
    const step = Math.max(1, Math.round(stride) || 1) * 4;
    const len = rgba.length - (rgba.length % 4);
    let i = 0;
    if (isGray) {
      for (; i < len; i += step) {
        const r = rgba[i];
        if (r !== rgba[i + 1] || r !== rgba[i + 2]) break;
        grayCount[r]++;
        pixels++;
      }
      if (i >= len) return;
      leaveGrayPath();
    }
    // Runs of one colour are common (nearest-neighbour upscaled frames): count each run once.
    let runR = -1;
    let runG = -1;
    let runB = -1;
    let run = 0;
    for (; i < len; i += step) {
      const r = rgba[i];
      const g = rgba[i + 1];
      const b = rgba[i + 2];
      pixels++;
      if (r === runR && g === runG && b === runB) {
        run++;
        continue;
      }
      if (run > 0) hist.add(runR, runG, runB, run);
      runR = r;
      runG = g;
      runB = b;
      run = 1;
    }
    if (run > 0) hist.add(runR, runG, runB, run);
  }

  function build(maxColors = 128) {
    const max = clampColors(maxColors);
    if (isGray) {
      const levels = [];
      for (let v = 0; v < 256; v++) if (grayCount[v] > 0) levels.push(v);
      if (levels.length === 0) return new Uint8Array([0, 0, 0]);
      let grays = levels;
      if (levels.length > max) {
        const lo = levels[0];
        const hi = levels[levels.length - 1];
        grays = [];
        for (let i = 0; i < max; i++) grays.push(Math.round(lo + ((hi - lo) * i) / (max - 1)));
      }
      const out = new Uint8Array(grays.length * 3);
      for (let i = 0; i < grays.length; i++) out[i * 3] = out[i * 3 + 1] = out[i * 3 + 2] = grays[i];
      return out;
    }
    const ent = hist.entries();
    if (hist.exact && ent.n <= max) {
      const colours = [];
      for (let i = 0; i < ent.n; i++) colours.push([ent.r[i], ent.g[i], ent.b[i]]);
      return sortPalette(colours);
    }
    return sortPalette(medianCut(ent, max));
  }

  return {
    add,
    build,
    /** True while every pixel seen so far had r = g = b. */
    get isGray() {
      return isGray;
    },
    /** Distinct colours seen (after any coarse binning). */
    get colours() {
      if (!isGray) return hist.used;
      let m = 0;
      for (let v = 0; v < 256; v++) if (grayCount[v] > 0) m++;
      return m;
    },
    get pixels() {
      return pixels;
    },
  };
}

/** One palette for one RGBA buffer or a list of them (or of { data } frames). */
export function buildPalette(rgbaOrList, maxColors = 128) {
  const builder = createPaletteBuilder();
  const list = Array.isArray(rgbaOrList) ? rgbaOrList : [rgbaOrList];
  for (const item of list) builder.add(item && item.data ? item.data : item);
  return builder.build(maxColors);
}

// ---------------------------------------------------------------------------------------------
// Nearest-colour mapping

const CACHE_BITS = 16;
const CACHE_SIZE = 1 << CACHE_BITS;

/**
 * Nearest palette entry by squared distance in RGB, with a small direct-mapped cache keyed by
 * the exact colour (so a cache hit is always the true nearest entry).
 */
export function createMapper(palette) {
  if (!palette || palette.length < 3 || palette.length % 3 !== 0 || palette.length > 768) {
    throw new RangeError('Palette must hold 1 to 256 colours as r, g, b bytes');
  }
  const size = palette.length / 3;
  let isGray = true;
  for (let i = 0; i < size && isGray; i++) {
    if (palette[i * 3] !== palette[i * 3 + 1] || palette[i * 3] !== palette[i * 3 + 2]) isGray = false;
  }

  function search(r, g, b) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0, p = 0; i < size; i++, p += 3) {
      const dr = r - palette[p];
      const dg = g - palette[p + 1];
      const db = b - palette[p + 2];
      const d = dr * dr + dg * dg + db * db;
      if (d < bestD) {
        bestD = d;
        best = i;
        if (d === 0) break;
      }
    }
    return best;
  }

  // Gray pixels against a gray palette: one table.
  let grayLut = null;
  if (isGray) {
    grayLut = new Uint8Array(256);
    for (let v = 0; v < 256; v++) grayLut[v] = search(v, v, v);
  }

  const cacheKeys = new Int32Array(CACHE_SIZE).fill(-1);
  const cacheVals = new Uint8Array(CACHE_SIZE);

  function nearest(r, g, b) {
    if (grayLut && r === g && g === b) return grayLut[r];
    const key = (r << 16) | (g << 8) | b;
    const slot = Math.imul(key, 0x9e3779b1) >>> (32 - CACHE_BITS);
    if (cacheKeys[slot] === key) return cacheVals[slot];
    const idx = search(r, g, b);
    cacheKeys[slot] = key;
    cacheVals[slot] = idx;
    return idx;
  }

  return { nearest, palette, size, isGray, grayLut };
}

function clampByte(v) {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

/**
 * Map RGBA pixels to palette indices. With dither: true, Floyd-Steinberg error diffusion in a
 * serpentine scan (useful for a single smooth image; off by default because the noise pattern
 * changes from frame to frame and makes a blink movie shimmer).
 */
export function mapPixels(rgba, width, height, mapperOrPalette, { dither = false, out = null } = {}) {
  const mapper = mapperOrPalette && typeof mapperOrPalette.nearest === 'function' ? mapperOrPalette : createMapper(mapperOrPalette);
  const total = width * height;
  if (!rgba || rgba.length < total * 4) throw new RangeError('mapPixels needs width * height * 4 RGBA bytes');
  const indices = out && out.length === total ? out : new Uint8Array(total);
  const { nearest, palette } = mapper;

  if (!dither) {
    const lut = mapper.grayLut;
    // Reuse the previous answer along runs of one colour.
    let pr = -1;
    let pg = -1;
    let pb = -1;
    let pidx = 0;
    for (let i = 0, p = 0; i < total; i++, p += 4) {
      const r = rgba[p];
      const g = rgba[p + 1];
      const b = rgba[p + 2];
      if (r !== pr || g !== pg || b !== pb) {
        pidx = lut && r === g && g === b ? lut[r] : nearest(r, g, b);
        pr = r;
        pg = g;
        pb = b;
      }
      indices[i] = pidx;
    }
    return indices;
  }

  // Floyd-Steinberg: error rows hold r, g, b per pixel with one pixel of padding on each side.
  let cur = new Float32Array((width + 2) * 3);
  let next = new Float32Array((width + 2) * 3);
  for (let y = 0; y < height; y++) {
    const leftToRight = (y & 1) === 0;
    const dir = leftToRight ? 1 : -1;
    for (let k = 0; k < width; k++) {
      const x = leftToRight ? k : width - 1 - k;
      const p = (y * width + x) * 4;
      const e = (x + 1) * 3;
      const r = clampByte(rgba[p] + cur[e]);
      const g = clampByte(rgba[p + 1] + cur[e + 1]);
      const b = clampByte(rgba[p + 2] + cur[e + 2]);
      const idx = nearest(r, g, b);
      indices[y * width + x] = idx;
      const er = r - palette[idx * 3];
      const eg = g - palette[idx * 3 + 1];
      const eb = b - palette[idx * 3 + 2];
      if (er === 0 && eg === 0 && eb === 0) continue;
      const ahead = e + dir * 3;
      const behind = e - dir * 3;
      cur[ahead] += er * 0.4375; // 7/16 to the next pixel in scan order
      cur[ahead + 1] += eg * 0.4375;
      cur[ahead + 2] += eb * 0.4375;
      next[behind] += er * 0.1875; // 3/16 below and behind
      next[behind + 1] += eg * 0.1875;
      next[behind + 2] += eb * 0.1875;
      next[e] += er * 0.3125; // 5/16 straight below
      next[e + 1] += eg * 0.3125;
      next[e + 2] += eb * 0.3125;
      next[ahead] += er * 0.0625; // 1/16 below and ahead
      next[ahead + 1] += eg * 0.0625;
      next[ahead + 2] += eb * 0.0625;
    }
    const swap = cur;
    cur = next;
    next = swap;
    next.fill(0);
  }
  return indices;
}

/**
 * Quantise a whole movie against one shared palette.
 * frames = [{ data: RGBA, width, height }] -> { palette, indexed: Uint8Array[] }
 */
export function quantizeFrames(frames, { maxColors = 128, dither = false } = {}) {
  const builder = createPaletteBuilder();
  for (const f of frames) builder.add(f.data);
  const palette = builder.build(maxColors);
  const mapper = createMapper(palette);
  const indexed = frames.map((f) => mapPixels(f.data, f.width, f.height, mapper, { dither }));
  return { palette, indexed };
}
