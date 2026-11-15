// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// backdrop.js: the ground the console sits on, and the glass that floats over it.
//
// One WebGL canvas behind the page draws a dark field with slow contour lines and two pools of
// colour. For every element named as glass it then draws that element's shape again as a lens:
// the same field seen through a slab with a rounded edge, so the lines bend at the rim, with a
// highlight on the side facing the light. The field is a formula, not a picture, so a lens costs
// only the pixels it covers and nothing has to be read back from the page. That is what lets every
// card and every button refract while the photos keep playing.
//
//   createBackdrop({ canvas, kinds, root, source, fps, maxScale, reducedMotion })
//       -> { refresh, sourceDrawn, status, destroy } | null
//     kinds   [{ selector, bevel, bend, frost, tint, gain }] in paint order (cards before their buttons)
//     root    where to look for the glass elements (default: the whole document)
//     source  leave out for the ground above. On the sky page it is { canvases: () => [...] }: the
//             sky's own canvases. They are copied into a texture each time the sky is drawn
//             (call sourceDrawn() right after), and the lenses bend that picture instead; the
//             canvas is then clear everywhere else and sits between the sky and the controls.
//
// Elements are found again a few times a second and measured on every drawn frame, so the glass
// follows scrolling, folding and resizing without being told.

/** The glass shapes of the page, largest first: a child is drawn over its parent. */
export const SKY_GLASS_KINDS = [
  // Clear glass (frost 0): the sky stays sharp behind it, so the bend at the edge is plain to see.
  { name: 'card', selector: '.skyhome-card, .skyhome-inputwrap', bevel: 9, bend: 1, frost: 0.1, tint: 0.05, gain: 0.85 },
  { name: 'button', selector: '.skyhome-chip, .skyhome-mode, .skyhome-zoom-btn', bevel: 6, bend: 1, frost: 0, tint: 0.055, gain: 0.85 },
  { name: 'hint', selector: '.skyhome-hint', bevel: 6, bend: 1, frost: 0, tint: 0.055, gain: 0.85, fades: true },
  // Last, so an open list covers whatever glass lies under it.
  { name: 'panel', selector: '.skyhome-menu, .picklist', bevel: 12, bend: 1, frost: 0.7, tint: 0.075, gain: 0.5 },
];

export const GLASS_KINDS = [
  { name: 'bar', selector: '.topbar', bevel: 13, bend: 1, frost: 0.2, tint: 0.035 },
  { name: 'card', selector: '.simple-card, .controls, .glass-panel, html[data-mode="advanced"] .side', bevel: 14, bend: 1, frost: 0.25, tint: 0.03 },
  { name: 'field', selector: '.search-input', bevel: 7, bend: 1, frost: 0.3, tint: -0.012 },
  { name: 'button', selector: '.btn:not(.btn-solid), .seg, .simple-change, .chip, .tool-group, select.select', bevel: 5, bend: 1, frost: 0.1, tint: 0.05 },
];

/** A corner radius in px from a computed style value ("12px", "50%", "999px"), limited to the box. Pure. */
export function cornerRadius(value, width, height) {
  const text = String(value || '').trim().split(/\s+/)[0] || '0';
  const n = parseFloat(text);
  const cap = Math.max(0, Math.min(width, height) / 2);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const px = text.endsWith('%') ? (n / 100) * Math.min(width, height) : n;
  return Math.min(px, cap);
}

/** A rectangle moved so that (ox, oy) becomes the corner. */
function moved(r, ox, oy) {
  if (!ox && !oy) return r;
  return { left: r.left - ox, top: r.top - oy, right: r.right - ox, bottom: r.bottom - oy, width: r.width, height: r.height };
}

/**
 * What to draw for one element: its box, clipped against the box it scrolls in. Pure.
 * rect and clip are { left, top, right, bottom } in CSS px; view is { width, height }.
 * -> { x, y, w, h, clip: [x0, y0, x1, y1] } or null when nothing of it is on screen.
 */
export function visibleBox(rect, clip, view) {
  if (!rect) return null;
  const w = rect.right - rect.left;
  const h = rect.bottom - rect.top;
  if (!(w >= 6) || !(h >= 6)) return null;
  const c = [0, 0, view.width, view.height];
  if (clip) {
    c[0] = Math.max(c[0], clip.left);
    c[1] = Math.max(c[1], clip.top);
    c[2] = Math.min(c[2], clip.right);
    c[3] = Math.min(c[3], clip.bottom);
  }
  if (rect.right <= c[0] || rect.left >= c[2] || rect.bottom <= c[1] || rect.top >= c[3]) return null;
  return { x: rect.left, y: rect.top, w, h, clip: c };
}

/** The drawing scale to try next when frames come too slowly (or null to stay). Pure. */
export function nextScale(scale, meanFrameMs) {
  if (!(meanFrameMs > 45)) return null;
  if (scale > 1) return 1;
  if (scale > 0.7) return 0.66;
  return null;
}

const FIELD = `
uniform vec2 uRes;      // viewport in CSS px
uniform float uTime;    // seconds
float fieldAt(vec2 q, float t) {
  vec2 w = q * 1.5;
  w += 0.36 * vec2(sin(w.y * 1.7 + t * 0.13), cos(w.x * 1.3 - t * 0.11));
  w += 0.2 * vec2(sin(w.y * 3.1 - t * 0.09 + 1.3), cos(w.x * 2.7 + t * 0.07 + 2.1));
  return sin(w.x * 1.9 + t * 0.08) + sin(w.y * 2.3 - t * 0.06) + 0.6 * sin((w.x + w.y) * 1.4 + t * 0.05);
}
// The ground at p (CSS px, y down). soft 0..1 is how frosted the view is: lines widen and fade.
vec3 ground(vec2 p, float soft) {
  vec2 q = p / uRes.y;
  float t = uTime;
  float ar = uRes.x / uRes.y;
  float f = fieldAt(q, t);
  vec2 a = vec2(ar * (0.84 + 0.05 * sin(t * 0.06)), 0.0 + 0.06 * cos(t * 0.05));
  vec2 b = vec2(ar * (0.04 + 0.05 * cos(t * 0.055)), 1.0 + 0.05 * sin(t * 0.06));
  vec2 c = vec2(ar * (0.5 + 0.2 * sin(t * 0.03)), 0.5 + 0.2 * cos(t * 0.037));
  vec3 col = vec3(0.036, 0.037, 0.046);
  col += vec3(0.90, 0.26, 0.17) * 0.085 * exp(-dot(q - a, q - a) * 1.3);
  col += vec3(0.25, 0.40, 0.80) * 0.17 * exp(-dot(q - b, q - b) * 1.2);
  col += vec3(0.97, 0.95, 0.91) * 0.03 * exp(-dot(q - c, q - c) * 2.4);
  col += vec3(0.97, 0.95, 0.91) * 0.03 * smoothstep(-0.6, 2.4, f);
  float n = f * 2.4;
  float fw = max(fwidth(n), 0.0005);
  float d = abs(fract(n - 0.5) - 0.5);
  float line = 1.0 - smoothstep(0.0, fw * (0.9 + soft * 7.0), d);
  float major = 1.0 - smoothstep(0.0, fw * (1.4 + soft * 7.0), abs(fract(n * 0.25 - 0.5) - 0.5) * 4.0);
  col += vec3(0.97, 0.95, 0.91) * (0.06 * line + 0.06 * major) * (1.0 - 0.72 * soft);
  return col;
}
float grain(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453) - 0.5; }
`;

// The same job for the sky page: the "ground" is the sky's own picture, softened by a few taps.
const PICTURE = `
uniform sampler2D uTex;
uniform vec2 uRes;
uniform float uTime;
vec3 texAt(vec2 p) {
  vec2 uv = clamp(p / uRes, 0.0, 1.0);
  return texture2D(uTex, vec2(uv.x, 1.0 - uv.y)).rgb;
}
float grain(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453) - 0.5; }
// Eight taps on two rings, turned by a different angle at every pixel: a star behind the glass
// becomes a soft glow with a fine frosted grain instead of eight sharp copies.
vec3 ground(vec2 p, float soft) {
  if (soft < 0.02) return texAt(p);              // clear glass: the view stays sharp
  float r = 1.0 + soft * 12.0;
  float a = (grain(floor(p * 2.0)) + 0.5) * 6.2832;
  vec2 u = vec2(cos(a), sin(a)) * r;
  vec2 v = vec2(-u.y, u.x);
  vec3 c = texAt(p) * 0.16;
  c += (texAt(p + u) + texAt(p - u) + texAt(p + v) + texAt(p - v)) * 0.09;
  c += (texAt(p + (u + v) * 0.38) + texAt(p - (u + v) * 0.38) + texAt(p + (u - v) * 0.38) + texAt(p - (u - v) * 0.38)) * 0.12;
  return c;
}
`;

const VERT = `
attribute vec2 aPos;
uniform vec4 uQuad;     // clip-space x0, y0, x1, y1
void main() {
  vec2 u = aPos * 0.5 + 0.5;
  gl_Position = vec4(mix(uQuad.xy, uQuad.zw, u), 0.0, 1.0);
}`;

const HEAD = `#extension GL_OES_standard_derivatives : enable
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform float uScale;   // canvas px per CSS px
uniform float uHeight;  // canvas height in px
`;

const FRAG_GROUND = `${HEAD}${FIELD}
void main() {
  vec2 p = vec2(gl_FragCoord.x, uHeight - gl_FragCoord.y) / uScale;
  vec3 col = ground(p, 0.0);
  col += grain(gl_FragCoord.xy) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}`;

const fragGlass = (sampler) => `${HEAD}${sampler}
uniform float uGain;    // how much of the view behind comes through
uniform float uFade;    // 1 = fully there
uniform vec4 uRect;     // x, y, w, h in CSS px
uniform float uRadius;
uniform vec4 uOpt;      // bevel px, bend, frost, tint
uniform vec4 uClip;     // x0, y0, x1, y1 in CSS px
float sdRound(vec2 p, vec2 hs, float r) {
  vec2 q = abs(p) - hs + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
void main() {
  vec2 p = vec2(gl_FragCoord.x, uHeight - gl_FragCoord.y) / uScale;
  if (p.x < uClip.x || p.y < uClip.y || p.x > uClip.z || p.y > uClip.w) discard;
  vec2 hs = 0.5 * uRect.zw;
  vec2 o = p - (uRect.xy + hs);
  float d = sdRound(o, hs, uRadius);
  float aa = clamp(0.5 - d * uScale, 0.0, 1.0);
  if (aa <= 0.0) discard;
  vec2 e = vec2(0.75, 0.0);
  vec2 g = vec2(sdRound(o + e.xy, hs, uRadius) - sdRound(o - e.xy, hs, uRadius), sdRound(o + e.yx, hs, uRadius) - sdRound(o - e.yx, hs, uRadius));
  vec2 n = g / max(length(g), 0.0001);          // points out of the glass
  float bevel = max(1.0, min(uOpt.x, min(hs.x, hs.y)));
  float k = 1.0 - clamp(-d / bevel, 0.0, 1.0);   // 1 at the rim, 0 on the flat face
  // The glass is a low dome: its face bends the view a little, its round edge bends it hard.
  // The bend reaches further in than the bevel you can see, as it does in a real lens.
  float zone = max(1.0, min(bevel * 2.4, min(hs.x, hs.y)));
  float s = 1.0 - clamp(-d / zone, 0.0, 1.0);    // 1 at the rim, 0 where the face is flat
  float slope = s * s * s / sqrt(1.0 - 0.96 * s * s);
  // The edge shows what lies further in, squeezed: a line behind the glass breaks at the rim.
  vec2 off = -n * slope * zone * uOpt.y * 0.32;
  // No branch here: the three samples meet where the edge ends, so no seam shows. Red and blue
  // bend by different amounts, so a star near the rim grows a thin colour fringe.
  vec3 col = vec3(ground(p + off * 1.2, uOpt.z).r, ground(p + off, uOpt.z).g, ground(p + off * 0.8, uOpt.z).b);
  col = col * uGain * (1.0 + 0.35 * min(slope, 2.0)) + uOpt.w;
  col += vec3(0.022) * (0.5 - o.y / max(hs.y, 1.0) * 0.5); // the face catches a little more light at the top
  vec2 L = normalize(vec2(-0.55, -0.83));        // toward the light: up and to the left
  float lit = max(dot(n, L), 0.0);
  float back = max(dot(n, -L), 0.0);
  col += vec3(1.0, 0.98, 0.95) * ((0.46 * lit + 0.20 * back) * pow(k, 5.0) + (0.09 * lit + 0.03) * pow(k, 2.0));
  col += vec3(0.035) * pow(k, 4.0);
  col -= vec3(0.03) * back * k * (1.0 - k) * 4.0; // a thin shade inside the far edge
  col += grain(gl_FragCoord.xy) / 255.0;
  gl_FragColor = vec4(col * aa, aa) * uFade;
}`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`backdrop shader: ${log}`);
  }
  return shader;
}

function program(gl, frag, names) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, frag));
  gl.bindAttribLocation(p, 0, 'aPos');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`backdrop program: ${gl.getProgramInfoLog(p)}`);
  const u = {};
  for (const name of names) u[name] = gl.getUniformLocation(p, name);
  return { p, u };
}

export function createBackdrop(opts = {}) {
  const canvas = opts.canvas;
  if (!canvas || typeof canvas.getContext !== 'function') return null;
  const win = canvas.ownerDocument.defaultView;
  const doc = canvas.ownerDocument;
  const source = opts.source && typeof opts.source.canvases === 'function' ? opts.source : null;
  const scope = opts.root || doc;
  const kinds = opts.kinds || (source ? SKY_GLASS_KINDS : GLASS_KINDS);
  const frameMs = 1000 / (opts.fps || 30);
  const still = !!opts.reducedMotion;
  let gl = null;
  let ground = null;
  let glass = null;
  let tex = null;
  let small = null;      // the sky, copied small (sky page only)
  let small2d = null;
  let pictureAt = -1;    // when the copy was last taken, -1 = never
  let pictureNew = false;

  function setup() {
    gl = canvas.getContext('webgl', { alpha: !!source, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power', preserveDrawingBuffer: false });
    if (!gl) return false;
    if (!gl.getExtension('OES_standard_derivatives')) return false;
    ground = source ? null : program(gl, FRAG_GROUND, ['uQuad', 'uScale', 'uHeight', 'uRes', 'uTime']);
    glass = program(gl, fragGlass(source ? PICTURE : FIELD), ['uQuad', 'uScale', 'uHeight', 'uRes', 'uTime', 'uRect', 'uRadius', 'uOpt', 'uClip', 'uGain', 'uFade', 'uTex']);
    if (source) {
      tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
      gl.clearColor(0, 0, 0, 0);
      pictureNew = pictureAt >= 0;
    }
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.disable(gl.DEPTH_TEST);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    return true;
  }

  try {
    if (!setup()) return null;
  } catch (err) {
    console.warn('[tombaugh] backdrop unavailable', err);
    return null;
  }

  let scale = Math.min(win.devicePixelRatio || 1, opts.maxScale || 1.5);
  let items = [];        // [{ el, kind, clipEl, radius }]
  let itemsAt = -Infinity;
  let drawn = 0;
  let lastDraw = -Infinity;
  let dirty = true;
  let raf = 0;
  let lost = false;
  let dead = false;
  const t0 = win.performance.now();
  // Slow frames lower the drawing scale once or twice; nothing raises it again.
  let slowSum = 0;
  let slowN = 0;
  let lastTick = 0;

  /** The nearest ancestor that clips what scrolls inside it, or null. */
  function clipOf(el) {
    for (let p = el.parentElement; p && p !== doc.body && p !== doc.documentElement; p = p.parentElement) {
      const cs = win.getComputedStyle(p);
      if (/(auto|scroll|hidden|clip)/.test(`${cs.overflowY} ${cs.overflowX}`)) return p;
    }
    return null;
  }

  function collect(now) {
    itemsAt = now;
    const next = [];
    const seen = new Set();
    for (const kind of kinds) {
      for (const el of scope.querySelectorAll(kind.selector)) {
        if (seen.has(el)) continue;
        seen.add(el);
        const shown = typeof el.checkVisibility === 'function' ? el.checkVisibility({ checkVisibilityCSS: true, visibilityProperty: true }) : el.offsetParent !== null;
        if (!shown) continue;
        const cs = win.getComputedStyle(el);
        next.push({ el, kind, clipEl: clipOf(el), radiusText: cs.borderTopLeftRadius, fades: !!kind.fades });
      }
    }
    items = next;
  }

  function draw(now) {
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    if (!cw || !ch) return false; // hidden (the sky page, an embed)
    const pw = Math.max(1, Math.round(cw * scale));
    const ph = Math.max(1, Math.round(ch * scale));
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    if (now - itemsAt > 350) collect(now);
    const sx = pw / cw;
    const time = still ? 40 : (now - t0) / 1000 + 40;
    gl.viewport(0, 0, pw, ph);
    gl.disable(gl.BLEND);
    if (source) {
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (pictureAt < 0) return true; // nothing to bend yet
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      if (pictureNew) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, small);
        pictureNew = false;
      }
    } else {
      gl.useProgram(ground.p);
      gl.uniform4f(ground.u.uQuad, -1, -1, 1, 1);
      gl.uniform1f(ground.u.uScale, sx);
      gl.uniform1f(ground.u.uHeight, ph);
      gl.uniform2f(ground.u.uRes, cw, ch);
      gl.uniform1f(ground.u.uTime, time);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    gl.enable(gl.BLEND);
    gl.useProgram(glass.p);
    if (source) gl.uniform1i(glass.u.uTex, 0);
    gl.uniform1f(glass.u.uScale, sx);
    gl.uniform1f(glass.u.uHeight, ph);
    gl.uniform2f(glass.u.uRes, cw, ch);
    gl.uniform1f(glass.u.uTime, time);
    const view = { width: cw, height: ch };
    // The page-wide canvas starts at the window's corner; the sky's own canvas may not.
    const at = source ? canvas.getBoundingClientRect() : null;
    const ox = at ? at.left : 0;
    const oy = at ? at.top : 0;
    let count = 0;
    for (const it of items) {
      if (!it.el.isConnected) continue;
      const box = visibleBox(moved(it.el.getBoundingClientRect(), ox, oy), it.clipEl ? moved(it.clipEl.getBoundingClientRect(), ox, oy) : null, view);
      if (!box) continue;
      // A piece that is fading out (the hint on the sky page) takes its glass with it.
      const fade = it.fades ? Number(win.getComputedStyle(it.el).opacity) : 1;
      if (!(fade > 0.01)) continue;
      const pad = 1.5;
      const x0 = ((box.x - pad) / cw) * 2 - 1;
      const x1 = ((box.x + box.w + pad) / cw) * 2 - 1;
      const y1 = 1 - ((box.y - pad) / ch) * 2;
      const y0 = 1 - ((box.y + box.h + pad) / ch) * 2;
      gl.uniform4f(glass.u.uQuad, x0, y0, x1, y1);
      gl.uniform4f(glass.u.uRect, box.x, box.y, box.w, box.h);
      gl.uniform1f(glass.u.uRadius, cornerRadius(it.radiusText, box.w, box.h));
      gl.uniform4f(glass.u.uOpt, it.kind.bevel, it.kind.bend, it.kind.frost, it.kind.tint);
      gl.uniform1f(glass.u.uGain, it.kind.gain || 1.05);
      gl.uniform1f(glass.u.uFade, fade);
      gl.uniform4f(glass.u.uClip, box.clip[0], box.clip[1], box.clip[2], box.clip[3]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      count += 1;
    }
    drawn = count;
    return true;
  }

  function tick(now) {
    raf = 0;
    if (dead) return;
    raf = win.requestAnimationFrame(tick);
    if (lost) return;
    // Watch how fast frames really come while the canvas is being drawn.
    if (lastTick && canvas.clientWidth) {
      const dt = now - lastTick;
      if (dt < 400) {
        slowSum += dt;
        slowN += 1;
        if (slowN >= 90) {
          const lower = nextScale(scale, slowSum / slowN);
          if (lower) scale = lower;
          slowSum = 0;
          slowN = 0;
        }
      }
    }
    lastTick = now;
    // The sky's glass only changes when the sky or a control does: it rests in between.
    const rest = source ? now > busyUntil : still;
    const due = rest ? now - lastDraw >= 250 : now - lastDraw >= frameMs - 2;
    if (!dirty && !due) return;
    try {
      if (draw(now)) lastDraw = now;
    } catch (err) {
      console.warn('[tombaugh] backdrop', err);
      dead = true;
    }
    dirty = false;
  }

  const markDirty = () => {
    dirty = true;
  };
  let busyUntil = 0;
  // A press, a hover or an opening list moves or adds glass: follow it closely for a moment.
  const markBusy = () => {
    busyUntil = win.performance.now() + 500;
    itemsAt = 0; // look for the pieces again on the next frame
    dirty = true;
  };

  /** The sky was just drawn (same task): copy it small and draw the lenses over it now. */
  function sourceDrawn() {
    if (!source || dead || lost) return;
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    if (!cw || !ch) return;
    try {
      // One texture pixel per CSS pixel: sharp enough for clear glass, cheap enough to copy every frame.
      const w = Math.max(2, Math.min(2048, Math.round(cw)));
      const hgt = Math.max(2, Math.round((ch * w) / cw));
      if (!small) {
        small = doc.createElement('canvas');
        small2d = small.getContext('2d');
      }
      if (small.width !== w || small.height !== hgt) {
        small.width = w;
        small.height = hgt;
      }
      small2d.fillStyle = opts.source.ground || '#05060a';
      small2d.fillRect(0, 0, w, hgt);
      for (const c of source.canvases()) if (c && c.width && c.height) small2d.drawImage(c, 0, 0, w, hgt);
      const now = win.performance.now();
      pictureAt = now;
      pictureNew = true;
      if (draw(now)) lastDraw = now;
      dirty = false;
    } catch (err) {
      console.warn('[tombaugh] sky glass', err);
      dead = true;
    }
  }
  const onLost = (ev) => {
    ev.preventDefault();
    lost = true;
  };
  const onRestored = () => {
    try {
      lost = !setup();
      dirty = true;
    } catch {
      dead = true;
    }
  };
  win.addEventListener('scroll', markDirty, { capture: true, passive: true });
  win.addEventListener('resize', markDirty, { passive: true });
  const busyEvents = ['pointerdown', 'pointerup', 'pointerover', 'pointerout', 'focusin', 'focusout', 'input', 'click', 'keydown'];
  if (source && scope.addEventListener) for (const name of busyEvents) scope.addEventListener(name, markBusy, { passive: true });
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);
  raf = win.requestAnimationFrame(tick);

  return {
    /** Look for the glass elements again now (after the page was rebuilt). */
    refresh() {
      itemsAt = -Infinity;
      dirty = true;
    },
    sourceDrawn,
    status: () => ({ shapes: drawn, found: items.length, scale, still, lost, dead, picture: pictureAt >= 0 }),
    destroy() {
      dead = true;
      if (raf) win.cancelAnimationFrame(raf);
      win.removeEventListener('scroll', markDirty, { capture: true });
      win.removeEventListener('resize', markDirty);
      if (source && scope.removeEventListener) for (const name of busyEvents) scope.removeEventListener(name, markBusy);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
    },
  };
}
