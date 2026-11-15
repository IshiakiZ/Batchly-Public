// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// globe.js: the 360-degree sky. You stand in the middle of the sphere; drag to look around,
// scroll or pinch to zoom, click a star to pick it.
//
//   createSkyGlobe(host, { stars, figures, targets, layers, onSelect, reducedMotion })
//     -> { setView, getView, flyTo, zoomBy, select, setLayers, resize, destroy, el, status() }
//
// Two stacked canvases: a WebGL one draws real sky pictures (HiPS tiles, sharper ones loading as
// you zoom in, each fading in over the blurrier one beneath it), and a 2D one on top draws the
// bright stars, the constellation figures, names and the selection ring. With no WebGL or no
// network the star layer alone still works.
//
// DEPTH. Each catalogue star has a real distance (stardata.js). At rest every star is drawn
// exactly at its catalogue position. While the view is moving, the camera leans a few parsecs
// away from the Sun (sideways when you turn, forward when you zoom in), and each star is drawn
// where it would appear from there, so near stars slide against far ones. The lean eases back to
// zero when the motion stops. It is a display effect only: a click always returns the true
// position. Until the first touch the view also drifts and sways slowly, so the depth shows.
//
// The pure functions at the top (projection, level of detail, picking) are exported for tests.

import { pixelsInDisc, pixelBounds, tileMesh, gridIndices, tilePath, radecToVec, vecToRadec } from './healpix.js';

const DEG = Math.PI / 180;
export const MIN_FOV = 0.12;
export const MAX_FOV = 120;

/** Sky pictures the view can show. All are served by IRSA with open cross-origin access. */
export const SKY_SURVEYS = Object.freeze({
  spherex: {
    id: 'spherex',
    base: 'https://irsa.ipac.caltech.edu/data/hips/SPHEREx/spherex_allsky_cube',
    ext: 'png',
    minOrder: 3,
    maxOrder: 5,
    gray: false,
    credit: 'SPHEREx all-sky map (NASA/JPL-Caltech, IPAC)',
  },
  twomass: {
    id: 'twomass',
    base: 'https://irsa.ipac.caltech.edu/data/hips/CDS/2MASS/Color',
    ext: 'jpg',
    minOrder: 3,
    maxOrder: 9,
    gray: false,
    credit: '2MASS (UMass, IPAC/Caltech, NASA, NSF)',
  },
});

/** Camera axes for a view centred on ra, dec (degrees), north up: { e (east), n (north), f (forward) }. */
export function viewBasis(ra, dec) {
  const a = ra * DEG;
  const d = dec * DEG;
  return {
    e: [-Math.sin(a), Math.cos(a), 0],
    n: [-Math.sin(d) * Math.cos(a), -Math.sin(d) * Math.sin(a), Math.cos(d)],
    f: [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)],
  };
}

/** Pixels per unit of the stereographic plane, for a field of view `fov` degrees across `minDim` pixels. */
export function planeScale(fov, minDim) {
  return minDim / 2 / (2 * Math.tan((fov * DEG) / 4));
}

/** Unit vector -> { x, y, z }: pixel position (east to the left, north up) and z = cosine of the angle from the centre. */
export function project(v, basis, scale, cx, cy) {
  const z = v[0] * basis.f[0] + v[1] * basis.f[1] + v[2] * basis.f[2];
  const k = 2 / (1 + Math.max(z, -0.999));
  const sx = -(v[0] * basis.e[0] + v[1] * basis.e[1] + v[2] * basis.e[2]);
  const sy = v[0] * basis.n[0] + v[1] * basis.n[1] + v[2] * basis.n[2];
  return { x: cx + sx * k * scale, y: cy - sy * k * scale, z };
}

/** Pixel position -> unit vector on the sky. */
export function unproject(x, y, basis, scale, cx, cy) {
  const X = (x - cx) / scale;
  const Y = (cy - y) / scale;
  const r2 = X * X + Y * Y;
  const z = (4 - r2) / (4 + r2);
  const k = (4 + r2) / 4;
  const sx = X / k;
  const sy = Y / k;
  return [
    -sx * basis.e[0] + sy * basis.n[0] + z * basis.f[0],
    -sx * basis.e[1] + sy * basis.n[1] + z * basis.f[1],
    -sx * basis.e[2] + sy * basis.n[2] + z * basis.f[2],
  ];
}

/** Angle in radians from the centre of the view to its farthest corner. */
export function viewRadius(width, height, scale) {
  const r = Math.hypot(width, height) / 2 / scale;
  return Math.min(Math.PI, 2 * Math.atan(r / 2) + 0.02);
}

/** Degrees of sky per pixel at the centre of the view. */
export function degPerPixel(scale) {
  return 1 / scale / DEG;
}

const TILE_SPAN = 58.6323; // degrees across a base HEALPix pixel
const ATLAS_RES = TILE_SPAN / 8 / 64; // degrees per texel of the order-3 "Allsky" overview

/**
 * Which tile order to show. null = the one-picture overview is sharp enough.
 * A tile of order k has 512 texels across 58.63 / 2^k degrees.
 */
export function orderForView(dpp, minOrder = 3, maxOrder = 9) {
  if (!(dpp > 0)) return null;
  if (ATLAS_RES / dpp <= 2.2) return null;
  const k = Math.ceil(Math.log2(TILE_SPAN / (512 * 1.3 * dpp)));
  return Math.max(minOrder, Math.min(maxOrder, k));
}

/** Faintest catalogue star drawn at this field of view. */
export function magLimit(fov) {
  if (fov >= 100) return 4.6;
  if (fov <= 45) return 6.5;
  return 6.5 - ((fov - 45) / 55) * 1.9;
}

/** Faintest named star that gets its name written at this field of view. */
export function labelLimit(fov) {
  if (fov >= 90) return 1.2;
  if (fov >= 50) return 2.0;
  if (fov >= 25) return 3.2;
  if (fov >= 12) return 4.5;
  return 99;
}

/** How strongly the catalogue dots are drawn: they hand over to the real stars in the photos. */
export function dotAlpha(fov, havePhotos) {
  if (!havePhotos) return 1;
  if (fov >= 30) return 1;
  if (fov <= 10) return 0;
  return (fov - 10) / 20;
}

/** A star's dot colour from its B-V colour index (blue-white to orange). */
export function starColor(bv) {
  const t = Math.max(0, Math.min(1, (bv + 0.3) / 2.0));
  const r = Math.round(190 + 65 * Math.min(1, t * 1.6));
  const g = Math.round(214 + 26 * (1 - Math.abs(t - 0.35) * 1.6));
  const b = Math.round(255 - 150 * t);
  return `rgb(${r},${Math.max(150, Math.min(255, g))},${b})`;
}

/**
 * The entry of `points` ([{ x, y, ... }]) nearest to x, y within `reach` pixels, or null.
 * Entries with a smaller `rank` win ties inside the reach (targets before stars).
 */
export function nearestPoint(points, x, y, reach = 16) {
  let best = null;
  let bestScore = Infinity;
  for (const p of points) {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d > reach) continue;
    const score = d + (p.rank || 0) * 4;
    if (score < bestScore) {
      best = p;
      bestScore = score;
    }
  }
  return best;
}

/** Keep a view inside its limits: { ra in 0..360, dec in -89.5..89.5, fov in MIN..MAX }. */
export function clampView(v) {
  return {
    ra: (((v.ra % 360) + 360) % 360),
    dec: Math.max(-89.5, Math.min(89.5, v.dec)),
    fov: Math.max(MIN_FOV, Math.min(MAX_FOV, v.fov)),
  };
}

/** Farthest the camera leans from the Sun, in parsecs, at the widest view. */
export const DEPTH_REACH = 3;

/** How far the camera may lean at this field of view (parsecs): the effect looks the same at every zoom. */
export function depthReach(fov) {
  return DEPTH_REACH * Math.max(0, Math.min(1, fov / MAX_FOV));
}

/** The most one star may shift, in radians: `share` of the view (about 5 percent while you move it). */
export function depthLimit(fov, share = 0.05) {
  return share * fov * DEG;
}

/**
 * Where a star appears from a camera that has moved away from the Sun.
 *   u      unit vector to the star as seen from the Sun
 *   d      its distance in parsecs (0, NaN or negative = unknown: it does not move)
 *   c      camera position in parsecs, same axes as u
 *   limit  the largest shift allowed, radians; larger shifts are squeezed smoothly (tanh) under it
 * Returns a unit vector (u itself when nothing moves).
 */
export function parallaxDir(u, d, c, limit = Infinity) {
  if (!(d > 0) || !c || (c[0] === 0 && c[1] === 0 && c[2] === 0)) return u;
  const x = d * u[0] - c[0];
  const y = d * u[1] - c[1];
  const z = d * u[2] - c[2];
  const len = Math.hypot(x, y, z);
  if (!(len > 1e-9)) return u;
  const wx = x / len;
  const wy = y / len;
  const wz = z / len;
  if (!(limit < Infinity)) return [wx, wy, wz];
  if (!(limit > 0)) return u;
  const dot = Math.max(-1, Math.min(1, u[0] * wx + u[1] * wy + u[2] * wz));
  const tx = wx - dot * u[0];
  const ty = wy - dot * u[1];
  const tz = wz - dot * u[2];
  const tl = Math.hypot(tx, ty, tz);
  if (tl < 1e-12) return u;
  const shift = limit * Math.tanh(Math.atan2(tl, dot) / limit);
  const cs = Math.cos(shift);
  const sn = Math.sin(shift) / tl;
  return [u[0] * cs + tx * sn, u[1] * cs + ty * sn, u[2] * cs + tz * sn];
}

/**
 * Where the camera leans for a given motion of the view (parsecs, sky axes).
 *   basis    viewBasis() of the current view
 *   vE, vN   how fast the centre of the view moves east and north, in view-widths per second
 *   vIn      how fast it zooms in, in e-folds of the field of view per second (negative = out)
 *   toward   unit vector the zoom is aimed at (null = the centre of the view)
 * Turning leans the camera sideways the way the view turns; zooming in leans it forward.
 * The length never exceeds depthReach(fov).
 */
export function leanTarget(basis, vE, vN, vIn, toward, fov) {
  const reach = depthReach(fov);
  const speed = Math.hypot(vE, vN);
  const side = speed > 1e-9 ? Math.tanh(speed / 0.6) / speed : 0;
  const ahead = Math.tanh(vIn / 1.2);
  const a = toward || basis.f;
  const out = [0, 0, 0];
  for (let i = 0; i < 3; i += 1) out[i] = (vE * basis.e[i] + vN * basis.n[i]) * side + a[i] * ahead;
  const len = Math.hypot(out[0], out[1], out[2]);
  const k = len > 1 ? reach / len : reach;
  return [out[0] * k, out[1] * k, out[2] * k];
}

/** Which of the eight glow colours a star with B-V colour index `bv` uses (0 = blue-white, 7 = orange). */
export function glowBucket(bv) {
  const t = Math.max(0, Math.min(1, ((Number.isFinite(bv) ? bv : 0.6) + 0.3) / 2.0));
  return Math.round(t * 7);
}

/** The B-V colour index at the middle of a glow bucket. */
export const bucketBv = (bucket) => (bucket / 7) * 2.0 - 0.3;

/** Radius in pixels of a star's soft glow (0 = too faint for one), from its dot radius and magnitude. */
export function glowRadius(r, mag) {
  if (!(mag < 3.6)) return 0;
  return r * (3.4 + (3.6 - mag) * 1.4);
}

const VERT = `
attribute vec3 aPos;
attribute vec2 aUv;
uniform mat3 uView;
uniform vec2 uScale;
varying vec2 vUv;
varying float vZ;
void main() {
  vec3 s = uView * aPos;
  float k = 2.0 / (1.0 + max(s.z, -0.9));
  gl_Position = vec4(s.x * k * uScale.x, s.y * k * uScale.y, 0.0, 1.0);
  vUv = aUv;
  vZ = s.z;
}`;

const FRAG = `
precision mediump float;
uniform sampler2D uTex;
uniform float uAlpha;
uniform float uGray;
uniform float uGain;
varying vec2 vUv;
varying float vZ;
void main() {
  if (vZ < -0.8) discard;
  vec4 c = texture2D(uTex, vUv);
  vec3 rgb = c.rgb * uGain;
  float l = dot(rgb, vec3(0.34, 0.33, 0.33));
  rgb = mix(rgb, vec3(l), uGray);
  gl_FragColor = vec4(rgb, c.a * uAlpha);
}`;

const IDLE_DRIFT = 0.0000045; // view-widths per millisecond: a full turn of a wide view takes minutes
const IDLE_SWAY = 0.25; // share of the camera's reach used by the sway before the first touch
const IDLE_LIMIT = 0.02; // and the most a star may shift then, as a share of the view

const meshN = (order) => (order <= 3 ? 8 : order <= 5 ? 4 : 2);
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * @param {HTMLElement} host an element with a size; the canvases fill it
 * @param {object} opts
 * @param {Array<{ra,dec,mag,bv,dist,name}>} opts.stars brightest first; dist in parsecs (0 = unknown) gives depth
 * @param {boolean} [opts.idle] false = no slow drift and sway before the first touch (default: on, off with reducedMotion)
 * @param {Array<number[]>} [opts.figures] constellation lines, RA/Dec pairs in hundredths of a degree
 * @param {Array<{name,ra,dec,dist?}>} [opts.targets] places to mark with a ring and a name; dist (parsecs) is optional
 * @param {Array<{survey: string, upTo: number, gray?: boolean}>} [opts.layers] which pictures to show up to which tile order
 * @param {(sel: object|null) => void} [opts.onSelect]
 * @param {(view: {ra,dec,fov}) => void} [opts.onView]
 */
export function createSkyGlobe(host, opts = {}) {
  const doc = host.ownerDocument;
  const win = doc.defaultView;
  const stars = Array.isArray(opts.stars) ? opts.stars : [];
  const figures = Array.isArray(opts.figures) ? opts.figures : [];
  let targets = Array.isArray(opts.targets) ? opts.targets : [];
  const reduced = !!opts.reducedMotion;
  const tint = opts.colors || {};
  const INK = tint.ink || '#f3ecdc';
  const ACCENT = tint.accent || '#e8402a';

  const root = doc.createElement('div');
  root.className = 'skyglobe';
  root.tabIndex = 0;
  root.setAttribute('role', 'application');
  root.setAttribute('aria-label', 'The whole sky. Drag to look around, scroll to zoom, click a star to pick it.');
  const glCanvas = doc.createElement('canvas');
  glCanvas.className = 'skyglobe-photo';
  const topCanvas = doc.createElement('canvas');
  topCanvas.className = 'skyglobe-stars';
  root.append(glCanvas, topCanvas);
  host.append(root);
  const ctx = topCanvas.getContext('2d');

  // Star vectors and colours, computed once.
  const starVec = stars.map((s) => radecToVec(s.ra, s.dec));
  const starTint = stars.map((s) => starColor(Number.isFinite(s.bv) ? s.bv : 0.6));
  const figureVec = figures.map((line) => {
    const pts = [];
    for (let i = 0; i + 1 < line.length; i += 2) pts.push(radecToVec(line[i] / 100, line[i + 1] / 100));
    return pts;
  });
  let targetVec = targets.map((t) => radecToVec(t.ra, t.dec));

  // Depth: who is how far away. A place or a figure corner that sits on a catalogue star moves with it.
  const COS_SAME = Math.cos(0.06 * DEG);
  function starAt(vec) {
    let best = -1;
    let bestDot = COS_SAME;
    for (let i = 0; i < starVec.length; i += 1) {
      const v = starVec[i];
      const dot = v[0] * vec[0] + v[1] * vec[1] + v[2] * vec[2];
      if (dot > bestDot) {
        bestDot = dot;
        best = i;
      }
    }
    return best;
  }
  const starDist = stars.map((s) => (s.dist > 0 ? s.dist : 0));
  const starIndexByName = new Map();
  stars.forEach((s, i) => {
    if (s.name && !starIndexByName.has(s.name.toLowerCase())) starIndexByName.set(s.name.toLowerCase(), i);
  });
  const figureDist = figureVec.map((line) =>
    line.map((v) => {
      const i = starAt(v);
      return i >= 0 ? starDist[i] : 0;
    }),
  );
  function distOfPlace(t, vec) {
    if (!t) return 0;
    if (t.dist > 0) return t.dist;
    if (t.target && t.target.dist > 0) return t.target.dist;
    const byName = t.name ? starIndexByName.get(String(t.name).toLowerCase()) : undefined;
    if (byName !== undefined) return starDist[byName];
    const i = starAt(vec);
    return i >= 0 ? starDist[i] : 0;
  }
  let targetDist = targets.map((t, i) => distOfPlace(t, targetVec[i]));
  let selectionDist = 0;

  // The camera's lean away from the Sun, in parsecs (see DEPTH in the header).
  let cam = [0, 0, 0]; // what is drawn
  let camSoft = [0, 0, 0]; // first smoothing stage
  let camOn = false;
  let limitShare = 0.05; // eases between the idle and the moving limit, so nothing jumps
  let prevView = null; // the view and time of the last frame, for the speed of the motion
  let idle = !reduced && opts.idle !== false ? { t0: now() } : null;
  function wake() {
    idle = null;
  }

  // Soft round glows, one per colour, drawn once and stamped per star.
  const glowSprites = new Map();
  function glowSprite(bucket) {
    let c = glowSprites.get(bucket);
    if (c) return c;
    const size = 64;
    c = doc.createElement('canvas');
    c.width = size;
    c.height = size;
    const g = c.getContext('2d');
    const m = /(\d+),\s*(\d+),\s*(\d+)/.exec(starColor(bucketBv(bucket))) || [0, 255, 255, 255];
    const rgb = `${m[1]},${m[2]},${m[3]}`;
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, `rgba(${rgb},0.95)`);
    grad.addColorStop(0.1, `rgba(${rgb},0.6)`);
    grad.addColorStop(0.3, `rgba(${rgb},0.2)`);
    grad.addColorStop(0.6, `rgba(${rgb},0.05)`);
    grad.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    glowSprites.set(bucket, c);
    return c;
  }
  const starBucket = stars.map((s) => glowBucket(s.bv));

  let view = clampView({ ra: opts.ra ?? 84, dec: opts.dec ?? 2, fov: opts.fov ?? 95 });
  let goalFov = view.fov;
  let anchor = null; // { x, y, vec } kept under the cursor while zooming
  let width = 1;
  let height = 1;
  let ratio = 1;
  let selection = null;
  let fly = null;
  let spin = null; // inertia: { vra, vdec } degrees per ms
  let frame = 0;
  let last = now();
  let destroyed = false;
  let hits = []; // what can be clicked this frame: [{ x, y, rank, ...sel }]
  let layers = Array.isArray(opts.layers) && opts.layers.length ? opts.layers : [{ survey: 'spherex', upTo: 5 }, { survey: 'twomass', upTo: 9, gray: true }];
  const orient = Number.isInteger(opts.orient) ? opts.orient : 0;

  // ---- WebGL -----------------------------------------------------------------------------------
  let gl = null;
  let prog = null;
  let loc = null;
  const indexBuffers = new Map(); // n -> { buf, count }
  const tiles = new Map(); // key -> { state, tex, vbo, n, born, used, order, ipix, survey }
  const atlases = new Map(); // survey id -> { state, tex, vbo, born }
  let atlasIndex = null;
  let active = 0;
  let frameNo = 0;
  let photosReady = false;
  let failed = 0;

  function reorient(mesh) {
    if (!orient) return mesh;
    for (let i = 0; i < mesh.length; i += 5) {
      let u = mesh[i + 3];
      let v = mesh[i + 4];
      if (orient & 1) [u, v] = [v, u];
      if (orient & 2) u = 1 - u;
      if (orient & 4) v = 1 - v;
      mesh[i + 3] = u;
      mesh[i + 4] = v;
    }
    return mesh;
  }

  function initGL() {
    try {
      gl = glCanvas.getContext('webgl', { alpha: false, antialias: true, powerPreference: 'high-performance' }) || glCanvas.getContext('experimental-webgl');
    } catch {
      gl = null;
    }
    if (!gl) return;
    const compile = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) || 'shader');
      return sh;
    };
    try {
      prog = gl.createProgram();
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || 'link');
    } catch (err) {
      console.warn('[tombaugh] sky view: WebGL unavailable, showing stars only', err);
      gl = null;
      return;
    }
    gl.useProgram(prog);
    loc = {
      pos: gl.getAttribLocation(prog, 'aPos'),
      uv: gl.getAttribLocation(prog, 'aUv'),
      view: gl.getUniformLocation(prog, 'uView'),
      scale: gl.getUniformLocation(prog, 'uScale'),
      tex: gl.getUniformLocation(prog, 'uTex'),
      alpha: gl.getUniformLocation(prog, 'uAlpha'),
      gray: gl.getUniformLocation(prog, 'uGray'),
      gain: gl.getUniformLocation(prog, 'uGain'),
    };
    gl.enableVertexAttribArray(loc.pos);
    gl.enableVertexAttribArray(loc.uv);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    indexBuffers.clear();
    tiles.clear();
    atlases.clear();
    atlasIndex = gl.createBuffer();
  }

  function indexBuffer(n) {
    let ib = indexBuffers.get(n);
    if (ib) return ib;
    const data = new Uint16Array(gridIndices(n));
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data, gl.STATIC_DRAW);
    ib = { buf, count: data.length };
    indexBuffers.set(n, ib);
    return ib;
  }

  function makeTexture(img, mip) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const pot = (v) => v > 0 && (v & (v - 1)) === 0;
    if (mip && pot(img.width) && pot(img.height)) {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }
    return tex;
  }

  function loadImage(url, done) {
    const img = new win.Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => done(img);
    img.onerror = () => done(null);
    img.src = url;
    return img;
  }

  /** The one-picture overview of a survey: all 768 order-3 tiles as 64-pixel thumbnails. */
  function atlasFor(surveyId) {
    let a = atlases.get(surveyId);
    if (a || !gl) return a;
    const survey = SKY_SURVEYS[surveyId];
    a = { state: 'loading', tex: null, vbo: null, born: 0 };
    atlases.set(surveyId, a);
    loadImage(`${survey.base}/Norder3/Allsky.${survey.ext}`, (img) => {
      if (destroyed || !gl) return;
      if (!img) {
        a.state = 'error';
        failed += 1;
        invalidate();
        return;
      }
      const cols = 27;
      const cell = Math.floor(img.width / cols);
      const n = 4;
      const per = 5 * (n + 1) * (n + 1);
      const data = new Float32Array(768 * per);
      for (let p = 0; p < 768; p += 1) {
        const col = p % cols;
        const row = Math.floor(p / cols);
        const u0 = (col * cell + 0.5) / img.width;
        const v0 = (row * cell + 0.5) / img.height;
        data.set(reorientAtlas(tileMesh(3, p, n), u0, v0, (cell - 1) / img.width, (cell - 1) / img.height), p * per);
      }
      try {
        a.tex = makeTexture(img, false);
        a.vbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, a.vbo);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        a.state = 'ready';
        a.born = now();
        photosReady = true;
      } catch (err) {
        console.warn('[tombaugh] sky view: overview picture could not be used', err);
        a.state = 'error';
      }
      invalidate();
    });
    return a;
  }

  /** A unit-square tile mesh (after any debug re-orientation) mapped into its cell of the overview picture. */
  function reorientAtlas(mesh, u0, v0, du, dv) {
    reorient(mesh);
    for (let i = 0; i < mesh.length; i += 5) {
      mesh[i + 3] = u0 + mesh[i + 3] * du;
      mesh[i + 4] = v0 + mesh[i + 4] * dv;
    }
    return mesh;
  }

  const tileKey = (surveyId, order, ipix) => `${surveyId}/${order}/${ipix}`;
  const layerFor = (order) => layers.find((l) => order <= l.upTo) || layers[layers.length - 1];
  const topOrder = () => layers[layers.length - 1].upTo;

  function requestTile(surveyId, order, ipix) {
    const key = tileKey(surveyId, order, ipix);
    let t = tiles.get(key);
    if (t) return t;
    t = { state: 'queued', tex: null, vbo: null, n: meshN(order), born: 0, used: frameNo, order, ipix, survey: surveyId, tried: 0 };
    tiles.set(key, t);
    return t;
  }

  function startTile(t) {
    const survey = SKY_SURVEYS[t.survey];
    t.state = 'loading';
    active += 1;
    loadImage(`${survey.base}/${tilePath(t.order, t.ipix)}.${survey.ext}`, (img) => {
      active -= 1;
      if (destroyed || !gl) return;
      if (!img) {
        t.state = 'error';
        t.tried = now();
        invalidate();
        return;
      }
      try {
        t.tex = makeTexture(img, true);
        t.vbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, t.vbo);
        gl.bufferData(gl.ARRAY_BUFFER, reorient(tileMesh(t.order, t.ipix, t.n)), gl.STATIC_DRAW);
        t.state = 'ready';
        t.born = now();
        photosReady = true;
      } catch (err) {
        console.warn('[tombaugh] sky view: a picture tile could not be used', err);
        t.state = 'error';
        t.tried = now();
      }
      invalidate();
    });
  }

  function evict() {
    if (tiles.size <= 220) return;
    const old = [...tiles.entries()].filter(([, t]) => t.state !== 'loading').sort((a, b) => a[1].used - b[1].used);
    for (const [key, t] of old.slice(0, tiles.size - 180)) {
      if (t.used >= frameNo - 1) break;
      if (t.tex) gl.deleteTexture(t.tex);
      if (t.vbo) gl.deleteBuffer(t.vbo);
      tiles.delete(key);
    }
  }

  function bindMesh(vbo) {
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.vertexAttribPointer(loc.pos, 3, gl.FLOAT, false, 20, 0);
    gl.vertexAttribPointer(loc.uv, 2, gl.FLOAT, false, 20, 12);
  }

  /** Draw the photo layer. Returns true while something is still loading or fading in. */
  function drawPhotos(basis, scale, t) {
    if (!gl) return false;
    frameNo += 1;
    let busy = false;
    gl.viewport(0, 0, glCanvas.width, glCanvas.height);
    gl.clearColor(0.016, 0.018, 0.03, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(prog);
    // Column-major: uView * v = (-e.v, n.v, f.v).
    gl.uniformMatrix3fv(loc.view, false, new Float32Array([-basis.e[0], basis.n[0], basis.f[0], -basis.e[1], basis.n[1], basis.f[1], -basis.e[2], basis.n[2], basis.f[2]]));
    gl.uniform2f(loc.scale, (2 * scale) / width, (2 * scale) / height);
    gl.uniform1i(loc.tex, 0);
    gl.activeTexture(gl.TEXTURE0);

    const radius = viewRadius(width, height, scale);
    const fadeMs = reduced ? 1 : 420;

    // 1. The overview picture of the base survey, under everything.
    const base = layers[0];
    const atlas = atlasFor(base.survey);
    if (atlas && atlas.state === 'loading') busy = true;
    if (atlas && atlas.state === 'ready') {
      const visible = pixelsInDisc(3, basis.f, radius);
      const idx = new Uint16Array(visible.length * 96);
      let at = 0;
      for (const p of visible) {
        const baseVertex = p * 25;
        for (let j = 0; j < 4; j += 1) {
          for (let i = 0; i < 4; i += 1) {
            const a = baseVertex + j * 5 + i;
            idx[at] = a;
            idx[at + 1] = a + 1;
            idx[at + 2] = a + 5;
            idx[at + 3] = a + 1;
            idx[at + 4] = a + 6;
            idx[at + 5] = a + 5;
            at += 6;
          }
        }
      }
      const alpha = Math.min(1, (t - atlas.born) / (fadeMs * 1.6));
      if (alpha < 1) busy = true;
      bindMesh(atlas.vbo);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, atlasIndex);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.DYNAMIC_DRAW);
      gl.bindTexture(gl.TEXTURE_2D, atlas.tex);
      gl.uniform1f(loc.alpha, alpha);
      gl.uniform1f(loc.gray, base.gray ? 1 : 0);
      gl.uniform1f(loc.gain, base.gain || 1);
      gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_SHORT, 0);
    }

    // 2. Sharper tiles for this zoom, each over the best loaded picture beneath it.
    const order = orderForView(degPerPixel(scale), 3, topOrder());
    if (order !== null) {
      const wanted = pixelsInDisc(order, basis.f, radius, 600);
      const draw = new Map();
      const queue = [];
      const layer = layerFor(order);
      for (const ipix of wanted) {
        const tile = requestTile(layer.survey, order, ipix);
        tile.used = frameNo;
        if (tile.state === 'queued' || (tile.state === 'error' && layer.retry && t - tile.tried > 30000)) queue.push(tile);
        const fading = tile.state === 'ready' && t - tile.born < fadeMs;
        if (tile.state === 'ready') draw.set(tileKey(tile.survey, order, ipix), tile);
        if (tile.state !== 'ready' || fading) {
          if (tile.state !== 'error') busy = true;
          // Walk up to the nearest loaded parent so there is never a hole.
          let o = order - 1;
          let p = Math.floor(ipix / 4);
          while (o >= 3) {
            const parentLayer = layerFor(o);
            const parent = tiles.get(tileKey(parentLayer.survey, o, p));
            if (parent && parent.state === 'ready') {
              parent.used = frameNo;
              draw.set(tileKey(parent.survey, o, p), parent);
              if (t - parent.born >= fadeMs) break;
            }
            o -= 1;
            p = Math.floor(p / 4);
          }
        }
      }
      // Nearest the centre first, a few at a time.
      if (queue.length && active < 8) {
        const dist = (tile) => {
          const b = pixelBounds(tile.order, tile.ipix).center;
          return -(b[0] * basis.f[0] + b[1] * basis.f[1] + b[2] * basis.f[2]);
        };
        queue.sort((a, b) => dist(a) - dist(b));
        for (const tile of queue) {
          if (active >= 8) break;
          if (tile.state === 'error') tile.state = 'queued';
          startTile(tile);
        }
      }
      if (queue.length) busy = true;
      const list = [...draw.values()].sort((a, b) => a.order - b.order);
      for (const tile of list) {
        const tileLayer = layerFor(tile.order);
        const ib = indexBuffer(tile.n);
        bindMesh(tile.vbo);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib.buf);
        gl.bindTexture(gl.TEXTURE_2D, tile.tex);
        gl.uniform1f(loc.alpha, Math.min(1, (t - tile.born) / fadeMs));
        gl.uniform1f(loc.gray, tileLayer.gray ? 1 : 0);
        gl.uniform1f(loc.gain, tileLayer.gain || 1);
        gl.drawElements(gl.TRIANGLES, ib.count, gl.UNSIGNED_SHORT, 0);
      }
      evict();
    }
    return busy;
  }

  // ---- the star layer --------------------------------------------------------------------------
  function drawStars(basis, scale) {
    const w = width;
    const h = height;
    const cx = w / 2;
    const cy = h / 2;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!gl) {
      ctx.fillStyle = '#05060a';
      ctx.fillRect(0, 0, w, h);
    }
    const radius = viewRadius(w, h, scale);
    const minZ = Math.cos(Math.min(Math.PI, radius));
    const fov = view.fov;
    hits = [];
    // Depth: where each thing appears from the leaning camera (null = everything in its true place).
    const lean = camOn ? cam : null;
    const reachLimit = depthLimit(fov, limitShare);
    const seen = (vec, dist) => (lean && dist > 0 ? parallaxDir(vec, dist, lean, reachLimit) : vec);

    // Constellation figures: faint, and gone once you are zoomed in among the real stars.
    const figAlpha = fov >= 40 ? 0.22 : fov <= 12 ? 0 : (0.22 * (fov - 12)) / 28;
    if (figAlpha > 0.01) {
      ctx.strokeStyle = INK;
      ctx.globalAlpha = figAlpha;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let li = 0; li < figureVec.length; li += 1) {
        const line = figureVec[li];
        const far = figureDist[li];
        let prev = null;
        for (let vi = 0; vi < line.length; vi += 1) {
          const p = project(seen(line[vi], far[vi]), basis, scale, cx, cy);
          const ok = p.z > minZ - 0.15;
          if (ok && prev) {
            ctx.moveTo(prev.x, prev.y);
            ctx.lineTo(p.x, p.y);
          }
          prev = ok ? p : null;
        }
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    const limit = magLimit(fov);
    const names = labelLimit(fov);
    const dots = dotAlpha(fov, photosReady);
    const boost = Math.max(0.85, Math.min(1.9, (70 / fov) ** 0.3));
    const labels = [];
    let selectionLabelled = false;
    // Pass 1: where every star in view is, and the soft glow of the bright ones (light adds up).
    const shown = [];
    if (dots > 0.01) ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < stars.length; i += 1) {
      const s = stars[i];
      if (s.mag > limit) break; // brightest first
      const p = project(seen(starVec[i], starDist[i]), basis, scale, cx, cy);
      if (p.z < minZ || p.x < -40 || p.y < -40 || p.x > w + 40 || p.y > h + 40) continue;
      const r = Math.max(0.55, (6.8 - s.mag) * 0.36 * boost);
      shown.push(i, p.x, p.y, r);
      if (dots > 0.01) {
        const halo = glowRadius(r, s.mag);
        if (halo > 0) {
          ctx.globalAlpha = dots * Math.min(1, 0.4 + (3.6 - s.mag) * 0.16);
          ctx.drawImage(glowSprite(starBucket[i]), p.x - halo, p.y - halo, halo * 2, halo * 2);
        }
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    // Pass 2: the crisp dot of each star, what can be clicked, and the names.
    for (let k = 0; k < shown.length; k += 4) {
      const i = shown[k];
      const s = stars[i];
      const x = shown[k + 1];
      const y = shown[k + 2];
      const r = shown[k + 3];
      if (dots > 0.01) {
        ctx.globalAlpha = dots * (s.mag > 5 ? 0.75 : 1);
        ctx.fillStyle = starTint[i];
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        if (s.mag < 2) {
          // A white-hot centre on the brightest.
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(x, y, r * 0.55, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      hits.push({ x, y, rank: 1, kind: 'star', name: s.name || '', ra: s.ra, dec: s.dec, mag: s.mag });
      if (s.name && s.mag <= names) {
        labels.push({ x, y, r, text: s.name });
        if (selection && selection.name === s.name) selectionLabelled = true;
      }
    }
    ctx.globalAlpha = 1;

    // Names.
    ctx.font = '500 12.5px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = INK;
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur = 4;
    ctx.globalAlpha = 0.86;
    // Brightest first; a name that would sit on top of one already written is left out.
    const boxes = [];
    for (const l of labels) {
      const x0 = l.x + l.r + 6;
      const box = { x0: x0 - 4, y0: l.y - 9, x1: x0 + ctx.measureText(l.text).width + 4, y1: l.y + 9 };
      if (boxes.some((b) => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0)) continue;
      boxes.push(box);
      ctx.fillText(l.text, x0, l.y);
    }
    ctx.globalAlpha = 1;

    // Our own places: a ring and a name, always.
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = ACCENT;
    ctx.fillStyle = INK;
    ctx.font = '600 13px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    for (let i = 0; i < targets.length; i += 1) {
      const p = project(seen(targetVec[i], targetDist[i]), basis, scale, cx, cy);
      if (p.z < minZ || p.x < -40 || p.y < -40 || p.x > w + 40 || p.y > h + 40) continue;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillText(targets[i].name, p.x + 14, p.y);
      hits.push({ x: p.x, y: p.y, rank: 0, kind: 'target', name: targets[i].name, ra: targets[i].ra, dec: targets[i].dec, target: targets[i] });
    }

    // The selection.
    if (selection) {
      const p = project(seen(radecToVec(selection.ra, selection.dec), selectionDist), basis, scale, cx, cy);
      if (p.z > minZ) {
        ctx.strokeStyle = INK;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 15, 0, Math.PI * 2);
        ctx.stroke();
        if (selection.name && selection.kind !== 'target' && !selectionLabelled) ctx.fillText(selection.name, p.x + 22, p.y);
      }
    }
    ctx.shadowBlur = 0;
  }

  // ---- the loop --------------------------------------------------------------------------------
  function invalidate() {
    if (destroyed || frame) return;
    frame = win.requestAnimationFrame(tick);
  }

  function basisNow() {
    return viewBasis(view.ra, view.dec);
  }
  const scaleNow = () => planeScale(view.fov, Math.min(width, height));

  /** Move the centre so that sky direction `vec` sits under pixel x, y. */
  function pin(vec, x, y) {
    for (let i = 0; i < 2; i += 1) {
      const p = project(vec, basisNow(), scaleNow(), width / 2, height / 2);
      const dpp = degPerPixel(scaleNow());
      const cosd = Math.max(0.05, Math.cos(view.dec * DEG));
      view = clampView({ ra: view.ra + ((x - p.x) * dpp) / cosd, dec: view.dec + (y - p.y) * dpp, fov: view.fov });
    }
  }

  function tick(t) {
    frame = 0;
    if (destroyed) return;
    const dt = Math.min(64, Math.max(0, t - last));
    last = t;
    let moving = false;

    if (fly) {
      const u = Math.min(1, (t - fly.t0) / fly.ms);
      const e = u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2;
      let dra = fly.to.ra - fly.from.ra;
      if (dra > 180) dra -= 360;
      if (dra < -180) dra += 360;
      // Pull back a little mid-flight when the hop is long, like a camera move.
      const far = Math.min(1, Math.hypot(dra * Math.cos(fly.to.dec * DEG), fly.to.dec - fly.from.dec) / 60);
      const lift = 1 + far * 1.4 * Math.sin(Math.PI * u);
      const fov = Math.exp(Math.log(fly.from.fov) + (Math.log(fly.to.fov) - Math.log(fly.from.fov)) * e) * lift;
      view = clampView({ ra: fly.from.ra + dra * e, dec: fly.from.dec + (fly.to.dec - fly.from.dec) * e, fov });
      goalFov = view.fov;
      if (u >= 1) {
        view = clampView(fly.to);
        goalFov = view.fov;
        fly = null;
      } else moving = true;
    }

    if (spin) {
      const cosd = Math.max(0.05, Math.cos(view.dec * DEG));
      view = clampView({ ra: view.ra + (spin.vx * dt) / cosd, dec: view.dec + spin.vy * dt, fov: view.fov });
      const decay = Math.exp(-dt / 320);
      spin.vx *= decay;
      spin.vy *= decay;
      if (Math.hypot(spin.vx, spin.vy) * 1000 < view.fov * 0.004) spin = null;
      else moving = true;
    }

    // Before the first touch: a slow drift, so the sky is alive.
    if (idle && !fly && !drag && !pinch) {
      const cosd = Math.max(0.05, Math.cos(view.dec * DEG));
      view = clampView({ ra: view.ra + (IDLE_DRIFT * view.fov * dt) / cosd, dec: view.dec, fov: view.fov });
      moving = true;
    }

    if (Math.abs(Math.log(goalFov / view.fov)) > 0.0015) {
      const k = reduced ? 1 : 1 - Math.exp(-dt / 85);
      view = clampView({ ...view, fov: Math.exp(Math.log(view.fov) + (Math.log(goalFov) - Math.log(view.fov)) * k) });
      if (anchor) pin(anchor.vec, anchor.x, anchor.y);
      moving = true;
    } else if (view.fov !== goalFov && !fly) {
      view = clampView({ ...view, fov: goalFov });
      if (anchor) pin(anchor.vec, anchor.x, anchor.y);
      anchor = null;
    }

    const basis = basisNow();
    const scale = scaleNow();
    if (updateLean(basis, t, dt)) moving = true;
    // Hidden (the start page is not on screen): draw nothing and let the loop rest.
    if (root.offsetParent === null && width <= 1) return;
    const busy = drawPhotos(basis, scale, t);
    drawStars(basis, scale);
    if (typeof opts.onView === 'function') opts.onView({ ...view });
    if (moving || busy) invalidate();
  }

  /**
   * Move the camera's lean toward what the current motion asks for. Returns true while it is
   * still leaning (another frame is needed).
   */
  function updateLean(basis, t, dt) {
    const prev = prevView;
    prevView = { ra: view.ra, dec: view.dec, fov: view.fov, t };
    // Once the photos carry the stars (zoomed in), everything stays pinned to them.
    const gain = reduced ? 0 : dotAlpha(view.fov, photosReady);
    let goal = [0, 0, 0];
    if (gain > 0 && prev) {
      const secs = Math.max(8, Math.min(200, t - prev.t)) / 1000;
      let dra = view.ra - prev.ra;
      if (dra > 180) dra -= 360;
      if (dra < -180) dra += 360;
      const vIn = -Math.log(view.fov / prev.fov) / secs;
      // A zoom held under the cursor also slides the centre; that is not a turn.
      const zoomOnly = !!anchor && !drag && !spin && !fly;
      const vE = zoomOnly ? 0 : (dra * Math.cos(view.dec * DEG)) / view.fov / secs;
      const vN = zoomOnly ? 0 : (view.dec - prev.dec) / view.fov / secs;
      goal = leanTarget(basis, vE, vN, vIn, anchor ? anchor.vec : null, view.fov);
      if (idle) {
        // A slow sway from side to side, so near stars drift against far ones.
        const reach = depthReach(view.fov) * IDLE_SWAY;
        const a = (t - idle.t0) / 2200;
        const sx = Math.sin(a);
        const sy = 0.35 * Math.sin(a * 0.71 + 1);
        for (let i = 0; i < 3; i += 1) goal[i] += reach * (sx * basis.e[i] + sy * basis.n[i]);
      }
      for (let i = 0; i < 3; i += 1) goal[i] *= gain;
    }
    const k1 = 1 - Math.exp(-dt / 90);
    const k2 = 1 - Math.exp(-dt / 110);
    limitShare = prev ? limitShare + ((idle ? IDLE_LIMIT : 0.05) - limitShare) * k2 : idle ? IDLE_LIMIT : 0.05;
    let size = 0;
    for (let i = 0; i < 3; i += 1) {
      camSoft[i] += (goal[i] - camSoft[i]) * k1;
      cam[i] += (camSoft[i] - cam[i]) * k2;
      size = Math.max(size, Math.abs(cam[i]), Math.abs(camSoft[i]));
    }
    const still = goal[0] === 0 && goal[1] === 0 && goal[2] === 0;
    if (still && size < depthReach(view.fov) * 0.003 + 1e-6) {
      cam = [0, 0, 0];
      camSoft = [0, 0, 0];
      camOn = false;
      return false;
    }
    camOn = size > 0;
    return camOn || !still;
  }

  // ---- size ------------------------------------------------------------------------------------
  function resize() {
    const rect = root.getBoundingClientRect();
    width = Math.max(1, Math.round(rect.width));
    height = Math.max(1, Math.round(rect.height));
    ratio = Math.min(2, win.devicePixelRatio || 1);
    for (const c of [glCanvas, topCanvas]) {
      c.width = Math.round(width * ratio);
      c.height = Math.round(height * ratio);
    }
    invalidate();
  }

  // ---- input -----------------------------------------------------------------------------------
  const pointers = new Map();
  let drag = null;
  let pinch = null;
  const local = (ev) => {
    const rect = root.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  };
  const skyAt = (x, y) => unproject(x, y, basisNow(), scaleNow(), width / 2, height / 2);

  function onDown(ev) {
    if (ev.button > 0) return;
    const p = local(ev);
    pointers.set(ev.pointerId, p);
    try {
      root.setPointerCapture(ev.pointerId);
    } catch {
      // not fatal
    }
    wake();
    fly = null;
    spin = null;
    anchor = null;
    goalFov = view.fov;
    if (pointers.size === 1) {
      drag = { x: p.x, y: p.y, x0: p.x, y0: p.y, t: now(), t0: now(), moved: 0, vx: 0, vy: 0 };
      pinch = null;
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, fov: view.fov };
      drag = null;
    }
    root.classList.add('is-dragging');
  }

  function onMove(ev) {
    if (!pointers.has(ev.pointerId)) return;
    const p = local(ev);
    pointers.set(ev.pointerId, p);
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const vec = skyAt(mid.x, mid.y);
      view = clampView({ ...view, fov: (pinch.fov * pinch.dist) / dist });
      goalFov = view.fov;
      pin(vec, mid.x, mid.y);
      invalidate();
      return;
    }
    if (!drag) return;
    const dx = p.x - drag.x;
    const dy = p.y - drag.y;
    const t = now();
    const dt = Math.max(1, t - drag.t);
    drag.moved += Math.hypot(dx, dy);
    const dpp = degPerPixel(scaleNow());
    const cosd = Math.max(0.05, Math.cos(view.dec * DEG));
    view = clampView({ ra: view.ra + (dx * dpp) / cosd, dec: view.dec + dy * dpp, fov: view.fov });
    // Smoothed speed in degrees per millisecond, for the glide after release.
    drag.vx = drag.vx * 0.6 + ((dx * dpp) / dt) * 0.4;
    drag.vy = drag.vy * 0.6 + ((dy * dpp) / dt) * 0.4;
    drag.x = p.x;
    drag.y = p.y;
    drag.t = t;
    invalidate();
  }

  function onUp(ev) {
    if (!pointers.has(ev.pointerId)) return;
    pointers.delete(ev.pointerId);
    const p = local(ev);
    if (drag && pointers.size === 0) {
      const t = now();
      if (drag.moved < 6 && t - drag.t0 < 700) pick(p.x, p.y);
      else if (!reduced && t - drag.t < 90 && Math.hypot(drag.vx, drag.vy) * 1000 > view.fov * 0.02) {
        // A flick glides on, but never more than about half a screen.
        const speed = Math.hypot(drag.vx, drag.vy);
        const cap = Math.min(1, (view.fov * 0.5) / 320 / speed);
        spin = { vx: drag.vx * cap, vy: drag.vy * cap };
        invalidate();
      }
    }
    drag = null;
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) root.classList.remove('is-dragging');
  }

  function onWheel(ev) {
    ev.preventDefault();
    const p = local(ev);
    const step = ev.deltaMode === 1 ? ev.deltaY * 32 : ev.deltaY;
    wake();
    fly = null;
    spin = null;
    if (!anchor || Math.hypot(anchor.x - p.x, anchor.y - p.y) > 3) anchor = { x: p.x, y: p.y, vec: skyAt(p.x, p.y) };
    goalFov = Math.max(MIN_FOV, Math.min(MAX_FOV, goalFov * Math.exp(Math.max(-240, Math.min(240, step)) * 0.003)));
    invalidate();
  }

  function onDouble(ev) {
    const p = local(ev);
    wake();
    anchor = { x: p.x, y: p.y, vec: skyAt(p.x, p.y) };
    goalFov = Math.max(MIN_FOV, goalFov * 0.4);
    invalidate();
  }

  function onKey(ev) {
    const step = view.fov * 0.12;
    const cosd = Math.max(0.05, Math.cos(view.dec * DEG));
    let used = true;
    if (ev.key === 'ArrowLeft') view = clampView({ ...view, ra: view.ra + step / cosd });
    else if (ev.key === 'ArrowRight') view = clampView({ ...view, ra: view.ra - step / cosd });
    else if (ev.key === 'ArrowUp') view = clampView({ ...view, dec: view.dec + step });
    else if (ev.key === 'ArrowDown') view = clampView({ ...view, dec: view.dec - step });
    else if (ev.key === '+' || ev.key === '=') zoomBy(0.6);
    else if (ev.key === '-' || ev.key === '_') zoomBy(1 / 0.6);
    else used = false;
    if (used) {
      wake();
      ev.preventDefault();
      invalidate();
    }
  }

  function pick(x, y) {
    const hit = nearestPoint(hits, x, y, 16);
    let sel;
    if (hit) sel = { kind: hit.kind, name: hit.name, ra: hit.ra, dec: hit.dec, mag: hit.mag, target: hit.target || null };
    else {
      const p = vecToRadec(skyAt(x, y));
      sel = { kind: 'point', name: '', ra: p.ra, dec: p.dec };
    }
    select(sel);
    if (typeof opts.onSelect === 'function') opts.onSelect(sel);
  }

  function select(sel) {
    selection = sel && Number.isFinite(sel.ra) && Number.isFinite(sel.dec) ? sel : null;
    selectionDist = selection ? distOfPlace(selection, radecToVec(selection.ra, selection.dec)) : 0;
    invalidate();
  }

  function zoomBy(factor) {
    wake();
    anchor = null;
    fly = null;
    goalFov = Math.max(MIN_FOV, Math.min(MAX_FOV, goalFov * factor));
    invalidate();
  }

  function flyTo(ra, dec, fov) {
    const to = clampView({ ra, dec, fov: Number.isFinite(fov) ? fov : view.fov });
    wake();
    spin = null;
    anchor = null;
    if (reduced) {
      view = to;
      goalFov = to.fov;
      fly = null;
    } else fly = { from: { ...view }, to, t0: now(), ms: 1300 };
    last = now();
    invalidate();
  }

  root.addEventListener('pointerdown', onDown);
  root.addEventListener('pointermove', onMove);
  root.addEventListener('pointerup', onUp);
  root.addEventListener('pointercancel', onUp);
  root.addEventListener('wheel', onWheel, { passive: false });
  root.addEventListener('dblclick', onDouble);
  root.addEventListener('keydown', onKey);
  const lost = (ev) => {
    ev.preventDefault();
    gl = null;
  };
  const restored = () => {
    initGL();
    invalidate();
  };
  glCanvas.addEventListener('webglcontextlost', lost);
  glCanvas.addEventListener('webglcontextrestored', restored);

  let observer = null;
  if (typeof win.ResizeObserver === 'function') {
    observer = new win.ResizeObserver(() => resize());
    observer.observe(root);
  } else win.addEventListener('resize', resize);

  if (opts.photos !== false) initGL();
  resize();

  return {
    el: root,
    resize,
    getView: () => ({ ...view }),
    setView(v) {
      view = clampView({ ...view, ...v });
      goalFov = view.fov;
      fly = null;
      spin = null;
      prevView = null; // a jump is not a motion: no lean
      wake();
      invalidate();
    },
    flyTo,
    zoomBy,
    select,
    setTargets(list) {
      targets = Array.isArray(list) ? list : [];
      targetVec = targets.map((t) => radecToVec(t.ra, t.dec));
      targetDist = targets.map((t, i) => distOfPlace(t, targetVec[i]));
      invalidate();
    },
    setLayers(next) {
      if (Array.isArray(next) && next.length) layers = next;
      invalidate();
    },
    /** For tests and the credit line: what is on screen. */
    status() {
      const order = orderForView(degPerPixel(scaleNow()), 3, topOrder());
      const layer = order === null ? layers[0] : layerFor(order);
      let ready = 0;
      let loading = 0;
      let errors = 0;
      for (const t of tiles.values()) {
        if (t.state === 'ready') ready += 1;
        else if (t.state === 'error') errors += 1;
        else loading += 1;
      }
      return { webgl: !!gl, photos: photosReady, order, survey: layer.survey, tiles: ready, loading, errors, failed, clickable: hits.length, lean: Math.hypot(cam[0], cam[1], cam[2]), idle: !!idle };
    },
    destroy() {
      destroyed = true;
      if (frame) win.cancelAnimationFrame(frame);
      if (observer) observer.disconnect();
      else win.removeEventListener('resize', resize);
      root.remove();
      if (gl) {
        for (const t of tiles.values()) {
          if (t.tex) gl.deleteTexture(t.tex);
          if (t.vbo) gl.deleteBuffer(t.vbo);
        }
        const ext = gl.getExtension('WEBGL_lose_context');
        if (ext) ext.loseContext();
      }
      tiles.clear();
    },
  };
}
