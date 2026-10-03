// ─────────────────────────────────────────────────────────────────────────────
//  Godly powers + cinematics renderer plugin (installed by renderer.js).
//
//  Everything "epic" lives here: impact frames (1–3 high-contrast black/white
//  frames with radial speed lines) + hit-stop shake/flash/punch-zoom during the
//  engine's short holds (impact / ulthit / godhit / ko); in-world POWER-UPS for
//  ultimate and godly windups (rooted + exposed: rune circle filling, converging
//  energy, rising pulse, brightening sprite, name tag, release burst or fizzle);
//  awakening / ascension ignition bursts and auras (halo + wings of light);
//  ult/god ready glints and the art for every godly power entity (frame index 8,
//  entries defined by engine/powers.js). No cut-ins: the game never pauses for them.
//
//  Pure function of (replay, t, anim, hold): scrubbing works, no randomness —
//  all "noise" comes from prand(seed). Drawn with the renderer's pixel
//  primitives into its low-res buffer so it shares the pixel grid.
// ─────────────────────────────────────────────────────────────────────────────
import { whiteOf, tintOf, SIZE } from './sprites.js';
import { prand, rgba, mixHex, validHex } from './art-fx.js';

const TAU = Math.PI * 2;
const KO = 1024; // renderer flag bit for "knocked out"
export const FLAGS2 = {
  AWAKENED: 1, ASCENDED: 2, ULT_READY: 4, GOD_READY: 8, SWAPPING: 16, REVIVED: 32, MARKED: 64, WARD: 128, ULT_CAST: 256,
  TIMESTOPPED: 1 << 12, AVATAR: 1 << 13, PHOENIX: 1 << 14, GOD_CAST: 1 << 15, // powers.js bits
};
/** Fallback names/colours (the replay's fighters[i].godPowers wins when present). */
export const POWER_ART = {
  timestop: { name: 'Time Stop', color: '#cfd8ff' },
  judgment: { name: 'Judgment', color: '#ffe27a' },
  blackhole: { name: 'Black Hole', color: '#9a5cff' },
  meteor: { name: 'Meteor Storm', color: '#ff7a2a' },
  thunder: { name: 'Thunder God', color: '#7ae8ff' },
  avatar: { name: 'Avatar of War', color: '#ffb13b' },
  phoenix: { name: 'Phoenix Rebirth', color: '#ff5a2a' },
  worldtree: { name: 'World Tree', color: '#7aff8a' },
};
const IMPACT_KINDS = new Set(['impact', 'ulthit', 'godhit', 'ko']);
const DEFAULT_MS = { ult: 1100, god: 1500, awaken: 900, ascend: 1500, ko: 1100, impact: 140, ulthit: 320, godhit: 420 };

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOut3 = (k) => 1 - Math.pow(1 - clamp01(k), 3);
const easeIn2 = (k) => clamp01(k) * clamp01(k);
const hex = (c, d) => (validHex(c) ? c : d);

// ── tiny drawing helpers (buffer px) ─────────────────────────────────────────
function blit(b, img, x, y, flip, scale = 1, alpha = 1) {
  if (!img) return;
  const w = SIZE * scale;
  b.save();
  b.globalAlpha = alpha;
  if (flip) { b.translate(Math.round(x) + w, Math.round(y)); b.scale(-1, 1); b.drawImage(img, 0, 0, w, w); } else b.drawImage(img, Math.round(x), Math.round(y), w, w);
  b.restore();
}

/** Rising motes: a pure function of anim. */
function motes(r, X, Y, w, h, n, seed, anim, speed, cols, size = 1) {
  for (let j = 0; j < n; j++) {
    const ph = (anim * speed * (0.6 + prand(seed + j * 5) * 0.8) + prand(seed + j)) % 1;
    const x = X + (prand(seed + j * 3 + 1) - 0.5) * w + Math.sin(anim * 2.3 + j) * 1.5;
    const y = Y - ph * h;
    const a = ph < 0.2 ? ph / 0.2 : 1 - (ph - 0.2) / 0.8;
    r.rect(x, y, size, size, rgba(cols[j % cols.length], a));
  }
}

/** Manga focus lines: thin wedges pointing at (cx, cy). */
function focusLines(b, cx, cy, rIn, rOut, n, col, seed, anim, width = 0.03) {
  b.fillStyle = col;
  b.beginPath();
  const jit = Math.floor(anim * 24);
  for (let j = 0; j < n; j++) {
    const an = (j / n) * TAU + (prand(seed + j) - 0.5) * 0.18;
    const ri = rIn * (0.8 + prand(seed + j * 7 + jit) * 0.6);
    const w = width * (0.4 + prand(seed + j * 3) * 1.2);
    b.moveTo(cx + Math.cos(an) * ri, cy + Math.sin(an) * ri);
    b.lineTo(cx + Math.cos(an - w) * rOut, cy + Math.sin(an - w) * rOut);
    b.lineTo(cx + Math.cos(an + w) * rOut, cy + Math.sin(an + w) * rOut);
    b.closePath();
  }
  b.fill();
}

function starburst(r, X, Y, rad, col, n, seed, rot = 0) {
  for (let j = 0; j < n; j++) {
    const an = rot + (j / n) * TAU + prand(seed + j) * 0.3;
    const len = rad * (0.55 + prand(seed + j * 5) * 0.6);
    r.line(X, Y, X + Math.cos(an) * len, Y + Math.sin(an) * len, col, j % 3 ? 1 : 2);
  }
}

function ringDots(r, X, Y, rad, n, rot, col, size = 1) {
  for (let j = 0; j < n; j++) {
    const an = rot + (j / n) * TAU;
    r.rect(X + Math.cos(an) * rad - (size >> 1), Y + Math.sin(an) * rad - (size >> 1), size, size, col);
  }
}

/** A jagged lightning path from (x0,y0) to (x1,y1). */
function bolt(r, x0, y0, x1, y1, seed, glow, core, w = 3) {
  const n = Math.max(3, Math.floor(Math.hypot(x1 - x0, y1 - y0) / 9));
  let px = x0, py = y0;
  const nx = -(y1 - y0), ny = x1 - x0, nl = Math.hypot(nx, ny) || 1;
  const pts = [[x0, y0]];
  for (let j = 1; j <= n; j++) {
    const k = j / n;
    const off = j === n ? 0 : (prand(seed + j * 13) - 0.5) * 14;
    pts.push([x0 + (x1 - x0) * k + (nx / nl) * off, y0 + (y1 - y0) * k + (ny / nl) * off]);
  }
  for (let j = 1; j < pts.length; j++) { r.line(pts[j - 1][0], pts[j - 1][1], pts[j][0], pts[j][1], glow, w); }
  for (let j = 1; j < pts.length; j++) { r.line(pts[j - 1][0], pts[j - 1][1], pts[j][0], pts[j][1], core, 1); px = pts[j][0]; py = pts[j][1]; }
  return pts;
}

// ── plugin ───────────────────────────────────────────────────────────────────
export function createPowersPlugin() {
  const S = { rep: null, cins: [], sawHold: false, last: [null, null], tickRate: 30 };

  /** Per-frame cached analysis (stored on the plugin ctx object). */
  function info(ctx) {
    if (ctx._pw) return ctx._pw;
    const st = ctx.state, r = ctx.r;
    const fr = st.fr, tick = st.i;
    // effect clock: equals fr during the fight, but keeps running after the last frame, so
    // shakes, flashes and releases that started at the very end still fade out
    const efr = Number.isFinite(st.efr) ? Math.max(st.efr, fr) : fr;
    const fs = st.fighters;
    const f2 = [0, 1].map(s => { const p = st.f0 && st.f0[1 + s]; return p && typeof p[12] === 'number' ? p[12] : 0; });
    const fx = (st.f0 && Array.isArray(st.f0[8])) ? st.f0[8] : [];
    // cinematics near "now" with their effect clock τ (ms)
    const act = [];
    const hold = ctx.hold || null;
    if (ctx.hold !== undefined) S.sawHold = true; // the host passes holds (null between them)
    const cins = S.cins;
    if (cins.length && !r.mini) {
      // last cinematic with t <= fr (binary search), then walk back ~2 s
      let lo = 0, hi = cins.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (cins[m].t <= fr + 1e-6) lo = m + 1; else hi = m; }
      for (let idx = lo - 1; idx >= 0; idx--) {
        const c = cins[idx];
        if (fr - c.t > S.tickRate * 2.2) break;
        if (!IMPACT_KINDS.has(c.kind)) continue; // ult/god/awaken/ascend are in-world now (no holds, no cut-ins)
        const ms = c.ms || DEFAULT_MS[c.kind] || 300;
        let tau;
        if (hold) {
          if (idx === hold.index) tau = hold.elapsedMs;
          else if (idx > hold.index) continue;
          else tau = ms + ((efr - c.t) / S.tickRate) * 1000;
        } else if (S.sawHold) tau = ms + ((efr - c.t) / S.tickRate) * 1000;
        else tau = ((efr - c.t) / S.tickRate) * 1000;
        if (tau < ms + 1600) act.push({ c, idx, tau, ms, k: tau / ms, live: !!hold && idx === hold.index });
      }
    }
    ctx._pw = { fr, efr, tick, fs, f2, fx, act };
    return ctx._pw;
  }

  function fighterName(s) {
    const f = S.rep && S.rep.fighters && S.rep.fighters[s];
    return (f && (f.name || f.id)) || (s ? 'B' : 'A');
  }

  function powerMeta(s, id) {
    const f = S.rep && S.rep.fighters && S.rep.fighters[s];
    const gp = f && Array.isArray(f.godPowers) ? f.godPowers.find(p => p && (p.id === id || p === id)) : null;
    const base = POWER_ART[id] || {};
    return { name: (gp && gp.name) || base.name || 'Godly Power', color: hex(gp && gp.color, base.color || '#ffe27a') };
  }

  /** Charge windows (ult / godly power windups) from flags2 + events: a pure function of the replay. */
  function scanCharges(replay) {
    const out = [[], []];
    const frames = Array.isArray(replay.frames) ? replay.frames : [];
    const N = frames.length, tr = replay.tickRate || 30;
    const evs = Array.isArray(replay.events) ? replay.events : [];
    for (const side of [0, 1]) {
      for (const [kind, bit] of [['ult', FLAGS2.ULT_CAST], ['god', FLAGS2.GOD_CAST]]) {
        let start = -1;
        for (let i = 0; i <= N; i++) {
          const p = i < N && frames[i] ? frames[i][1 + side] : null;
          const on = !!(p && typeof p[12] === 'number' && (p[12] & bit));
          if (on && start < 0) start = i;
          else if (!on && start >= 0) { out[side].push({ kind, t0: start, t1: i, open: i >= N }); start = -1; }
        }
      }
      const fd = (replay.fighters && replay.fighters[side]) || {};
      for (const ch of out[side]) {
        let ev = null, intr = false;
        for (const e of evs) {
          if (e.a !== side) continue;
          if (e.k === ch.kind && e.t >= ch.t0 - 4 && e.t <= ch.t0 + 3) ev = e;
          if (e.k === 'interrupt' && e.t >= ch.t1 - 3 && e.t <= ch.t1 + 2 && (ch.kind === 'god' ? e.god !== undefined : e.god === undefined)) intr = true;
        }
        ch.interrupted = intr;
        ch.tx = ev && Number.isFinite(ev.x) ? ev.x : null;
        ch.ty = ev && Number.isFinite(ev.y) ? ev.y : null;
        if (ch.kind === 'god') {
          const m = powerMeta(side, ev && ev.id);
          ch.name = m.name; ch.col = m.color; ch.id = ev && ev.id;
          ch.dur = ev && ev.cast > 0 ? ev.cast * tr : (intr ? tr : ch.t1 - ch.t0);
        } else {
          const ab = ev && Number.isInteger(ev.ab) ? ev.ab : fd.ultIdx;
          const A = (Array.isArray(fd.abilities) && fd.abilities[ab]) || fd.ultimate || {};
          ch.name = A.name || (fd.ultimate && fd.ultimate.name) || 'Ultimate';
          ch.col = hex(A.color, hex(fd.ultimate && fd.ultimate.color, (fd.colors && fd.colors.primary) || '#ff4d6d'));
          ch.ab = ab;
          ch.dur = ev && ev.charge > 0 ? ev.charge * tr : (intr ? tr : ch.t1 - ch.t0);
        }
        ch.dur = Math.max(1, ch.dur);
      }
      out[side].sort((p, q) => p.t0 - q.t0);
    }
    return out;
  }

  /** The charge a fighter is in right now ({ch, k}) and the latest release / fizzle ({ch, q}). */
  function chargeState(P, f) {
    const list = (S.charges && S.charges[f.side]) || [];
    let cur = null, rel = null;
    const REL = 0.55 * S.tickRate;
    const over = P.efr > P.fr + 0.5; // past the last frame: the fight is over, nobody is charging
    for (const ch of list) {
      if (!over && P.fr >= ch.t0 && P.fr < ch.t1) {
        let k = (P.fr - ch.t0) / ch.dur;
        if (ch.kind === 'ult' && ch.ab !== undefined && f.castIdx === ch.ab && Number.isFinite(f.castProg)) k = f.castProg / 100;
        cur = { ch, k: clamp01(k) };
      } else if (!ch.open && P.efr >= ch.t1 && P.efr < ch.t1 + REL) rel = { ch, q: (P.efr - ch.t1) / REL };
    }
    return { cur, rel };
  }

  function impactPoint(ctx, c, P) {
    let pt = null;
    ctx.r.eventsIn(c.t - 3, c.t + 1, (e) => { if (e.k === 'impact' && (c.kind === 'ko' || e.a === c.a) && Number.isFinite(e.x)) pt = e; });
    if (pt) return { X: ctx.r.X(pt.x), Y: ctx.r.Y(pt.y) - 12, v: pt.v === 0 || pt.v === 1 ? pt.v : 1 - (c.a || 0) };
    const v = c.kind === 'ko' ? (c.a === 1 ? 1 : 0) : 1 - (c.a === 1 ? 1 : 0);
    const f = P.fs[v];
    return { X: ctx.r.X(f.x), Y: ctx.r.Y(f.y) - 6, v };
  }

  // ── fighter auras (flags2) ─────────────────────────────────────────────────
  function feet(ctx, f) { const r = ctx.r; return { X: r.X(f.x), foot: r.Y(f.y) + Math.round((r.R || 24) * 0.55 * ctx.K) }; }

  function auraUnder(ctx, P, f, fl2) {
    const r = ctx.r, anim = ctx.anim, s = f.side;
    if (f.flags & KO) return;
    const { X, foot } = feet(ctx, f);
    const img = (S.last[s] && S.last[s].img) || (f.def.px && f.def.px.frames.idle[0]);
    const flip = S.last[s] ? S.last[s].flip : false;
    if (fl2 & FLAGS2.ASCENDED) {
      // light column + wings of light behind the body
      const flick = 0.5 + 0.5 * Math.sin(anim * 5);
      r.rect(X - 14, 0, 28, foot, rgba('#fff3b0', 0.05 + 0.03 * flick));
      r.rect(X - 4, 0, 8, foot, rgba('#ffffff', 0.09 + 0.05 * flick));
      const flap = Math.sin(anim * 4) * 0.18;
      const b = ctx.b;
      b.save();
      b.globalCompositeOperation = 'lighter';
      for (const [layer, col, tip, sc] of [[0, '#b8902a', '#ffe27a', 1.35], [1, '#fff0b0', '#ffffff', 1]]) {
        for (const side of [-1, 1]) {
          for (let j = 0; j < 7; j++) {
            const an = -Math.PI / 2 + side * (0.3 + j * 0.23 + flap * (layer ? 1 : 0.7));
            const len = (15 + j * 3 - (j > 4 ? (j - 4) * 4 : 0)) * sc;
            const x0 = X + side * 3, y0 = foot - 20;
            const x1 = x0 + Math.cos(an) * len, y1 = y0 + Math.sin(an) * len * 0.8;
            r.line(x0, y0, x1, y1, rgba(col, layer ? 0.7 : 0.45), 2);
            r.rect(x1 - 1, y1 - 1, 2, 2, rgba(tip, 0.9));
          }
        }
      }
      b.restore();
      r.circleLine(X, foot, 15 + Math.round(flick * 2), rgba('#ffe27a', 0.7));
    }
    if (fl2 & FLAGS2.AWAKENED) {
      const col = awakenCol(s);
      r.ellipseFill(X, foot, 15, 5, rgba(col, 0.18));
      for (let j = 0; j < 14; j++) { // flame ring at the feet
        const an = (j / 14) * TAU + anim * 2.2;
        const h = 2 + Math.round(3 * Math.abs(Math.sin(anim * 9 + j * 1.7)));
        r.rect(X + Math.cos(an) * 14, foot + Math.sin(an) * 5 - h, 1, h, rgba(j % 2 ? col : '#ffd166', 0.8));
      }
    }
    if ((fl2 & FLAGS2.AVATAR) && img) {
      // a giant spectral war-god behind the fighter
      const pulse = 0.34 + 0.12 * Math.sin(anim * 6);
      const b = ctx.b;
      b.save();
      b.globalCompositeOperation = 'lighter'; // additive: the giant glows instead of darkening the floor
      const g = tintOf(f.def.px, img, '#ff9a1f');
      for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1]]) blit(b, g, X - SIZE + ox, foot - 2 * SIZE + 4 + oy, flip, 2, pulse * 0.6);
      blit(b, tintOf(f.def.px, img, '#b86a10'), X - SIZE, foot - 2 * SIZE + 4, flip, 2, pulse);
      b.restore();
      r.circleLine(X, foot, 20, rgba('#ffb13b', 0.6), 2);
    }
    if (fl2 & FLAGS2.PHOENIX) { ctx.b.save(); ctx.b.globalCompositeOperation = 'lighter'; phoenixWings(r, X, foot - 16, anim, 0.9, 1.5); ctx.b.restore(); }
  }

  function auraOver(ctx, P, f, fl2) {
    const r = ctx.r, anim = ctx.anim, s = f.side;
    if (f.flags & KO) return;
    const { X, foot } = feet(ctx, f);
    const img = f._img, flip = f._flip;
    if (img) S.last[s] = { img, flip };
    const outline = (col, al) => {
      if (!img) return;
      const g = tintOf(f.def.px, img, col);
      for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) blit(ctx.b, g, f._sx + ox, f._sy + oy, flip, 1, al);
      blit(ctx.b, img, f._sx, f._sy, flip, 1, 1);
    };
    if (fl2 & FLAGS2.ASCENDED) {
      if (Math.floor(anim * 10) % 4) outline('#fff3b0', 0.9);
      const hy = (f._sy || foot - 30) + 3 + Math.round(Math.sin(anim * 3));
      r.ellipseLine(X, hy - 1, 8, 2, '#ffe27a');
      r.ellipseLine(X, hy - 1, 9, 3, rgba('#fff7d0', 0.55));
      ringDots(r, X, hy + 10, 13, 12, anim * 0.8, rgba('#fff3b0', 0.55), 1);
      motes(r, X, foot, 34, 46, 14, 900 + s, anim, 0.7, ['#fff3b0', '#ffffff', '#ffe27a']);
      if (Math.floor(anim * 3) % 2) starburst(r, X, hy, 6, rgba('#ffffff', 0.5), 4, 17 + Math.floor(anim * 3), anim);
    } else if (fl2 & FLAGS2.AWAKENED) {
      const col = awakenCol(s);
      if (img) { // 2 px flame halo around the silhouette, then the crisp 1 px outline
        const g = tintOf(f.def.px, img, col), flick = Math.floor(anim * 12) % 3;
        ctx.b.save(); ctx.b.globalCompositeOperation = 'lighter';
        for (const [ox, oy] of [[-2, 0], [2, 0], [0, -2], [-1, -3 - flick], [1, -2 - flick]]) blit(ctx.b, g, f._sx + ox, f._sy + oy, flip, 1, 0.3);
        ctx.b.restore();
      }
      if (Math.floor(anim * 12) % 3) outline(col, 0.85); else if (img) blit(ctx.b, img, f._sx, f._sy, flip, 1, 1);
      motes(r, X, foot, 30, 44, 18, 700 + s, anim, 1.3, [col, '#ffd166', mixHex(col, '#ffffff', 0.4)], 2);
    }
    if (fl2 & FLAGS2.AVATAR) {
      if (Math.floor(anim * 8) % 3) outline('#ffb13b', 0.8);
      motes(r, X, foot, 40, 60, 10, 800 + s, anim, 0.9, ['#ffb13b', '#ffe27a']);
    }
    if (fl2 & FLAGS2.PHOENIX) motes(r, X, foot - 4, 22, 34, 10, 600 + s, anim, 1.6, ['#ff5a2a', '#ffd166', '#ff9a2a']);
    if (fl2 & FLAGS2.TIMESTOPPED && img) {
      blit(ctx.b, tintOf(f.def.px, img, '#aebfff'), f._sx, f._sy, flip, 1, 0.55);
      clockIcon(r, X, (f._sy || foot - 30) - 6, anim, '#dfe6ff');
    }
    // ready glints: a small twinkle over the head every second or so
    const top = (f._sy !== undefined ? f._sy : foot - 32) - 2;
    if (fl2 & FLAGS2.GOD_READY) {
      const ph = (anim * 0.8 + s * 0.37) % 1;
      if (ph < 0.35) { const k = ph / 0.35, a = 1 - k; starburst(r, X + 7, top + 2, 3 + k * 5, rgba('#ffe27a', a), 4, 3, 0.4); r.rect(X + 6, top + 1, 2, 2, rgba('#ffffff', a)); }
      ringDots(r, X, foot, 17, 6, anim * 1.8, rgba('#ffe27a', 0.75));
    }
    if (fl2 & FLAGS2.ULT_READY) {
      const ph = (anim * 1.1 + s * 0.51) % 1;
      if (ph < 0.3) { const a = 1 - ph / 0.3; r.rect(X - 8, top + 3, 1, 5, rgba(ultCol(s), a)); r.rect(X - 10, top + 5, 5, 1, rgba(ultCol(s), a)); }
      if (Math.floor(anim * 4) % 2) r.ellipseLine(X, foot, 13, 4, rgba(ultCol(s), 0.55));
    }
  }

  function awakenCol(s) { const f = S.rep && S.rep.fighters[s]; return hex(f && f.awakening && f.awakening.color, '#ff2a3a'); }
  function ultCol(s) { const f = S.rep && S.rep.fighters[s]; return hex(f && f.ultimate && f.ultimate.color, (f && f.colors && f.colors.primary) || '#ff4d6d'); }

  function magicCircle(r, X, Y, rad, col, rot, big) {
    r.circleFill(X, Y, rad, rgba(col, 0.1));
    r.circleLine(X, Y, rad, rgba(col, 0.9));
    r.circleLine(X, Y, rad - 4, rgba(col, 0.6));
    ringDots(r, X, Y, rad - 2, big ? 16 : 10, rot, rgba('#ffffff', 0.8), 1);
    const pts = [];
    for (let j = 0; j < 6; j++) { const an = -rot * 0.7 + (j / 6) * TAU; pts.push([X + Math.cos(an) * (rad - 5), Y + Math.sin(an) * (rad - 5)]); }
    for (let j = 0; j < 6; j++) { const p = pts[j], q = pts[(j + 2) % 6]; r.line(p[0], p[1], q[0], q[1], rgba(col, 0.7)); }
  }

  function clockIcon(r, X, Y, anim, col) {
    r.circleFill(X, Y, 5, 'rgba(10,14,30,0.8)');
    r.circleLine(X, Y, 5, col);
    const a1 = anim * 0.5, a2 = -Math.PI / 2; // the minute hand has stopped
    r.line(X, Y, X + Math.cos(a2) * 4, Y + Math.sin(a2) * 4, col);
    r.line(X, Y, X + Math.cos(a1) * 0 + 2, Y, col);
  }

  function phoenixWings(r, X, Y, anim, al, sc = 1) {
    const flap = Math.sin(anim * 6) * 0.25;
    for (const side of [-1, 1]) {
      for (let j = 0; j < 7; j++) {
        const an = -Math.PI / 2 + side * (0.5 + j * 0.2 + flap);
        const len = (10 + j * 2.4) * sc;
        const x1 = X + Math.cos(an) * len, y1 = Y + Math.sin(an) * len * 0.7 + j;
        const col = j < 2 ? '#ffd166' : j < 5 ? '#ff9a2a' : '#ff5a2a';
        r.line(X + side * 2, Y, x1, y1, rgba(col, al * 0.8), 2);
        if ((Math.floor(anim * 14) + j) % 3 === 0) r.rect(x1, y1 - 2, 1, 2, rgba('#ffe7a0', al));
      }
    }
  }

  // ── godly entities ────────────────────────────────────────────────────────
  // e = [kind, x, y, r, owner, p1 (progress 0–100), p2]
  function entPos(ctx, P, e) {
    const follow = e[0] === 'ts_charge' || e[0] === 'avatar' || e[0] === 'phoenix';
    const f = P.fs[e[4] === 1 ? 1 : 0];
    return follow && f ? { x: f.x, y: f.y } : { x: e[1], y: e[2] };
  }

  function ground(ctx, P, e) {
    const r = ctx.r, anim = ctx.anim, K = ctx.K;
    const { x, y } = entPos(ctx, P, e);
    const X = r.X(x), Y = r.Y(y), rr = Math.max(2, (e[3] || 0) * K), k = clamp01((e[5] || 0) / 100);
    const blink = Math.floor(anim * (4 + k * 10)) % 2 === 0;
    switch (e[0]) {
      case 'ts_charge': {
        const col = '#cfd8ff';
        r.circleFill(X, Y, rr, rgba(col, 0.05));
        r.circleLine(X, Y, rr, rgba(col, 0.85), 2);
        for (let j = 0; j < 12; j++) { const an = (j / 12) * TAU; r.line(X + Math.cos(an) * (rr - 5), Y + Math.sin(an) * (rr - 5), X + Math.cos(an) * rr, Y + Math.sin(an) * rr, col, j % 3 ? 1 : 2); }
        const hand = -Math.PI / 2 + k * TAU * 2;
        r.line(X, Y, X + Math.cos(hand) * rr * 0.9, Y + Math.sin(hand) * rr * 0.9, rgba('#ffffff', 0.8));
        r.line(X, Y, X + Math.cos(hand / 12 - Math.PI / 2) * rr * 0.5, Y + Math.sin(hand / 12 - Math.PI / 2) * rr * 0.5, rgba('#ffffff', 0.8), 2);
        break;
      }
      case 'timestop': {
        const col = '#cfd8ff';
        const a = e[6] >= 0 ? 0.6 : 0.3 * (1 - k);
        r.circleLine(X, Y, rr, rgba(col, a), 2);
        for (let j = 0; j < 12; j++) { const an = (j / 12) * TAU; r.line(X + Math.cos(an) * (rr - 8), Y + Math.sin(an) * (rr - 8), X + Math.cos(an) * rr, Y + Math.sin(an) * rr, rgba(col, a), 2); }
        const hand = -Math.PI / 2 + k * 0.4; // the hands barely move: time is stopped
        r.line(X, Y, X + Math.cos(hand) * rr * 0.8, Y + Math.sin(hand) * rr * 0.8, rgba('#ffffff', a));
        r.line(X, Y, X + Math.cos(hand + 2.1) * rr * 0.45, Y + Math.sin(hand + 2.1) * rr * 0.45, rgba('#ffffff', a), 2);
        break;
      }
      case 'judg_mark': {
        const col = '#ffe27a';
        r.circleFill(X, Y, rr, rgba(col, 0.08 + 0.1 * k));
        r.circleFill(X, Y, rr * easeOut3(k), rgba(col, 0.18));
        r.circleLine(X, Y, rr, blink ? '#ffffff' : col, 2);
        r.circleLine(X, Y, rr * 0.72, rgba(col, 0.7));
        ringDots(r, X, Y, rr * 0.86, 12, anim * 1.5, rgba('#fff7d0', 0.9), 2);
        for (let j = 0; j < 4; j++) { const an = anim * -0.8 + j * Math.PI / 2; r.line(X + Math.cos(an) * rr * 0.72, Y + Math.sin(an) * rr * 0.72, X + Math.cos(an + Math.PI) * rr * 0.72, Y + Math.sin(an + Math.PI) * rr * 0.72, rgba(col, 0.35)); }
        break;
      }
      case 'judg_beam': {
        const a = 1 - k;
        r.circleFill(X, Y, rr * (1 + 0.25 * k), rgba('#fff7d0', 0.35 * a));
        r.circleLine(X, Y, rr * (1 + 1.2 * k), rgba('#ffe27a', a), 2);
        break;
      }
      case 'bhole': {
        const col = '#9a5cff';
        const form = clamp01(k / 0.15);
        r.circleFill(X, Y, rr, rgba('#07000f', 0.35 * form));
        r.circleFill(X, Y, rr * 0.45, rgba('#1a0630', 0.45 * form));
        r.circleLine(X, Y, rr * (form < 1 ? 1.4 - 0.4 * form : 1), form < 1 ? (blink ? '#ffffff' : col) : rgba(col, 0.6), 2);
        for (let arm = 0; arm < 3; arm++) { // spiral arms of dust falling in
          for (let j = 0; j < 16; j++) {
            const q = ((j / 16) + anim * 0.35) % 1, rad = rr * (1 - q), an = arm * TAU / 3 + q * 5 + anim * 1.6;
            r.rect(X + Math.cos(an) * rad, Y + Math.sin(an) * rad, 2, 2, rgba(j % 4 ? col : '#e0c8ff', 0.35 + 0.65 * q));
          }
        }
        break;
      }
      case 'met_mark': {
        const col = '#ff7a2a';
        r.circleFill(X, Y, rr * (0.3 + 0.7 * k), rgba('#000000', 0.18 + 0.3 * k));
        r.circleLine(X, Y, rr, blink ? '#ffd166' : col, k > 0.7 ? 2 : 1);
        r.line(X - rr - 3, Y, X - rr * 0.6, Y, col); r.line(X + rr * 0.6, Y, X + rr + 3, Y, col);
        r.line(X, Y - rr - 3, X, Y - rr * 0.6, col); r.line(X, Y + rr * 0.6, X, Y + rr + 3, col);
        break;
      }
      case 'met_boom': {
        r.circleFill(X, Y, rr * 0.9, rgba('#1a0a04', 0.5 * (1 - k)));
        r.circleLine(X, Y, rr * (0.6 + 1.3 * k), rgba('#ffd166', 1 - k), 2);
        break;
      }
      case 'bolt_mark': {
        const col = '#7ae8ff';
        r.circleFill(X, Y, rr * k, rgba(col, 0.2));
        r.circleLine(X, Y, rr, blink ? '#ffffff' : col, 1);
        for (let j = 0; j < 6; j++) { const an = (j / 6) * TAU + anim * 3; r.line(X + Math.cos(an) * rr, Y + Math.sin(an) * rr, X + Math.cos(an + 0.3) * (rr - 4), Y + Math.sin(an + 0.3) * (rr - 4), '#ffffff'); }
        break;
      }
      case 'bolt': {
        r.circleFill(X, Y, rr * 0.8, rgba('#1a2a40', 0.4 * (1 - k)));
        r.circleLine(X, Y, rr * (0.5 + k), rgba('#bff4ff', 1 - k), 2);
        break;
      }
      case 'avatar_slam': {
        r.circleLine(X, Y, rr * (0.3 + 0.9 * k), rgba('#ffe27a', 1 - k), 3);
        for (let j = 0; j < 10; j++) { const an = (j / 10) * TAU + 0.2; r.line(X + Math.cos(an) * 6, Y + Math.sin(an) * 6, X + Math.cos(an) * rr * (0.4 + 0.5 * k), Y + Math.sin(an) * rr * (0.4 + 0.5 * k), rgba('#2a1a0a', 0.7 * (1 - k)), 2); }
        break;
      }
      case 'phoenix_nova': {
        r.circleFill(X, Y, rr * (0.3 + 0.7 * k), rgba('#2a0a04', 0.35 * (1 - k)));
        break;
      }
      case 'tree': {
        const col = '#7aff8a';
        const grow = clamp01(k / 0.16), sprung = e[6] === 1;
        r.circleFill(X, Y, rr, rgba('#0c2a10', 0.25 * grow));
        r.circleLine(X, Y, rr, sprung ? rgba(col, 0.9) : (blink ? '#ffffff' : col), sprung ? 2 : 1);
        ringDots(r, X, Y, rr - 3, 18, anim * 0.4, rgba('#d8ffc0', 0.8), 2);
        for (let j = 0; j < 12; j++) { // roots crawling out to the rim
          const an = (j / 12) * TAU + prand(j) * 0.4;
          let px = X, py = Y;
          const segs = 6, len = rr * grow;
          for (let q = 1; q <= segs; q++) {
            const rad = (q / segs) * len, wob = (prand(j * 31 + q) - 0.5) * 0.6;
            const nx = X + Math.cos(an + wob) * rad, ny = Y + Math.sin(an + wob) * rad;
            r.line(px, py, nx, ny, sprung ? '#6a4a24' : '#4a3418', q < 3 && sprung ? 3 : 2);
            px = nx; py = ny;
          }
          if (sprung) r.rect(px - 1, py - 3, 2, 3, '#9ae07a');
        }
        // the tree itself (behind the fighters: this is the ground layer)
        const th = Math.round(58 * easeOut3(k / 0.2));
        if (th > 2) {
          r.rect(X - 4, Y - th, 8, th, '#5a3a1c');
          r.rect(X - 4, Y - th, 2, th, '#7a5230');
          r.rect(X + 2, Y - th, 2, th, '#3e2812');
          const cy = Y - th - 6, cr = Math.round(28 * easeOut3(k / 0.2));
          r.circleFill(X, cy + 4, cr, '#1f6a2a');
          r.circleFill(X - cr * 0.45, cy + 2, cr * 0.7, '#2e8a36');
          r.circleFill(X + cr * 0.4, cy - 2, cr * 0.66, '#3aa044');
          r.circleFill(X, cy - cr * 0.35, cr * 0.6, '#58c85e');
          for (let j = 0; j < 12; j++) { // glowing fruit / light specks
            const ph = (anim * 0.9 + prand(200 + j)) % 1;
            if (ph < 0.6) r.rect(X + (prand(210 + j) - 0.5) * cr * 1.6, cy + (prand(220 + j) - 0.5) * cr * 1.2, 2, 2, rgba('#eaffb0', 1 - ph / 0.6));
          }
        }
        break;
      }
      default: break;
    }
  }

  function above(ctx, P, e) {
    const r = ctx.r, anim = ctx.anim, K = ctx.K, b = ctx.b;
    const { x, y } = entPos(ctx, P, e);
    const X = r.X(x), Y = r.Y(y), rr = Math.max(2, (e[3] || 0) * K), k = clamp01((e[5] || 0) / 100);
    switch (e[0]) {
      case 'judg_mark': { // a faint shaft announcing the pillar
        if (k > 0.35) { const a = (k - 0.35) / 0.65; r.rect(X - 1, 0, 2, Y, rgba('#fff7d0', 0.25 * a)); r.rect(X - rr * 0.2 * a, 0, rr * 0.4 * a, Y, rgba('#ffe27a', 0.06 * a)); }
        break;
      }
      case 'judg_beam': {
        const w = rr * (k < 0.12 ? 0.6 + 0.4 * easeOut3(k / 0.12) : k > 0.7 ? 1 - easeIn2((k - 0.7) / 0.3) : 1);
        const jit = Math.floor(anim * 30) % 2;
        r.rect(X - w - 2, 0, 2 * w + 4, Y + 4, rgba('#ffe27a', 0.22));
        r.rect(X - w, 0, 2 * w, Y + 3, rgba('#fff3b0', 0.45));
        r.rect(X - w * 0.45 - jit, 0, w * 0.9 + 2 * jit, Y + 2, rgba('#ffffff', 0.9));
        r.ellipseFill(X, Y, w * 1.25, Math.max(2, w * 0.4), rgba('#ffffff', 0.8));
        motes(r, X, Y, w * 2, Y, 18, 333, anim, 1.8, ['#ffffff', '#fff3b0'], 2);
        break;
      }
      case 'bhole': {
        const grow = clamp01(k / 0.15), end = k > 0.92 ? 1 - (k - 0.92) / 0.08 : 1;
        const cr = Math.max(2, Math.round((7 + 9 * grow) * end));
        const cy = Y - 14;
        r.ellipseFill(X, cy, cr * 2.2, cr * 0.55, rgba('#c9a0ff', 0.35));
        for (let j = 0; j < 20; j++) { // accretion disc
          const an = (j / 20) * TAU + anim * 3.2;
          const px = X + Math.cos(an) * cr * 2, py = cy + Math.sin(an) * cr * 0.5;
          if (Math.sin(an) < 0) r.rect(px, py, 2, 1, rgba(j % 3 ? '#9a5cff' : '#ffffff', 0.8));
        }
        r.circleFill(X, cy, cr + 2, rgba('#9a5cff', 0.6));
        r.circleFill(X, cy, cr, '#000000');
        r.circleLine(X, cy, cr + 1, rgba('#e8d4ff', 0.9));
        for (let j = 0; j < 20; j++) {
          const an = (j / 20) * TAU + anim * 3.2;
          if (Math.sin(an) >= 0) r.rect(X + Math.cos(an) * cr * 2, cy + Math.sin(an) * cr * 0.5, 2, 1, rgba(j % 3 ? '#b88aff' : '#ffffff', 0.95));
        }
        for (let j = 0; j < 12; j++) { // debris spiralling in
          const q = (anim * 0.8 + prand(500 + j)) % 1, rad = (1 - q) * rr * 0.9, an = prand(520 + j) * TAU + q * 4;
          r.rect(X + Math.cos(an) * rad, Y - 6 + Math.sin(an) * rad * 0.8, 1, 1, rgba('#e0c8ff', q));
        }
        break;
      }
      case 'bhole_nova': {
        const a = 1 - k;
        r.circleFill(X, Y - 10, rr * 0.4 * (1 - k), rgba('#ffffff', a));
        r.circleLine(X, Y - 6, rr * (0.2 + 1.1 * easeOut3(k)), rgba('#e0c8ff', a), 3);
        r.circleLine(X, Y - 6, rr * (0.1 + 0.8 * easeOut3(k)), rgba('#9a5cff', a), 2);
        starburst(r, X, Y - 8, rr * (0.5 + k), rgba('#e0c8ff', a), 12, 77, 0.2);
        break;
      }
      case 'met_mark': {
        // the meteor: a glint in the sky, then it streaks down during the last 45%
        const H = Math.max(120, Y + 40), sx = X - H * 0.55, sy = Y - H;
        if (k < 0.55) { if (Math.floor(anim * 8 + e[6]) % 2) r.rect(sx - 1, Math.max(2, sy + 30) - 1, 3, 3, '#ffd166'); break; }
        const q = easeIn2((k - 0.55) / 0.45);
        const mx = sx + (X - sx) * q, my = Math.max(-10, sy + 30) + (Y - 8 - Math.max(-10, sy + 30)) * q;
        const dx = X - sx, dy = (Y - 8) - (sy + 30), dl = Math.hypot(dx, dy) || 1;
        for (let j = 8; j >= 1; j--) { const tx = mx - (dx / dl) * j * 5, ty = my - (dy / dl) * j * 5; r.circleFill(tx, ty, Math.max(1, 6 - j * 0.6), rgba(j > 5 ? '#ff5a1f' : '#ffb347', 0.8 - j * 0.08)); }
        r.circleFill(mx, my, 7, '#ff7a2a');
        r.circleFill(mx, my, 5, '#ffd166');
        r.circleFill(mx - 1, my - 1, 3, '#ffffff');
        r.circleFill(mx + 2, my + 2, 2, '#5a2a14');
        break;
      }
      case 'met_boom': {
        const a = 1 - k, fr = rr * (0.35 + 0.75 * easeOut3(k));
        const col = k < 0.15 ? '#ffffff' : k < 0.35 ? '#ffe27a' : k < 0.6 ? '#ff9a2a' : '#c0401a';
        r.circleFill(X, Y - 6, fr * 0.9, rgba(col, 0.9 * a + 0.1));
        r.circleFill(X, Y - 6 - fr * 0.2, fr * 0.55, rgba(k < 0.4 ? '#ffffff' : '#ffd166', a));
        for (let j = 0; j < 12; j++) { // debris arcs
          const an = prand(j * 7 + e[6]) * TAU, sp = rr * (0.8 + prand(j * 3 + 1) * 0.9);
          const px = X + Math.cos(an) * sp * k, py = Y - 6 + Math.sin(an) * sp * k * 0.6 - Math.sin(k * Math.PI) * 18;
          r.rect(px, py, 2, 2, rgba(j % 2 ? '#5a3020' : '#ffb347', a));
        }
        break;
      }
      case 'bolt_mark': {
        if (Math.floor(anim * 10) % 3 === 0) bolt(r, X + 20, Math.max(0, Y - 160), X + 8, Math.max(0, Y - 120), 900 + Math.floor(anim * 20), rgba('#7ae8ff', 0.3), rgba('#ffffff', 0.5), 1);
        break;
      }
      case 'bolt': {
        if (k > 0.75) break;
        const top = Math.max(-4, Y - Math.max(140, Y));
        const seed = 40 + e[6] * 17 + Math.floor(anim * 24);
        const pts = bolt(r, X + ((e[6] % 2) ? 26 : -22), top, X, Y - 4, seed, rgba('#7ae8ff', 0.75), '#ffffff', 5);
        if (k < 0.2) r.rect(X - 3, top, 6, Y - top, rgba('#bff4ff', 0.18));
        const mid = pts[Math.floor(pts.length * 0.5)];
        if (mid) bolt(r, mid[0], mid[1], mid[0] + 18, mid[1] + 22, seed + 5, rgba('#7ae8ff', 0.5), rgba('#ffffff', 0.8), 2);
        if (k < 0.3) { r.circleFill(X, Y - 4, rr * 0.7, rgba('#ffffff', 0.8 * (1 - k / 0.3))); starburst(r, X, Y - 4, rr * 0.9, '#bff4ff', 10, seed, 0); }
        break;
      }
      case 'avatar': {
        const f = P.fs[e[4] === 1 ? 1 : 0];
        if (!f || (f.flags & KO)) break;
        const top = f._sy !== undefined ? f._sy : Y - 40;
        // a crown of light over the giant
        const cy = top - 26 + Math.round(Math.sin(anim * 3) * 1.5);
        for (let j = -2; j <= 2; j++) r.rect(X + j * 3 - 1, cy - (j % 2 ? 2 : 4), 2, j % 2 ? 3 : 5, '#ffe27a');
        r.rect(X - 7, cy, 15, 2, '#ffb13b');
        break;
      }
      case 'avatar_slam': {
        motes(r, X, Y, rr * 2, 22, 10, 404, anim, 2, ['#c8a878', '#e8d8b0'], 2);
        break;
      }
      case 'phoenix': {
        const f = P.fs[e[4] === 1 ? 1 : 0];
        if (!f || (f.flags & KO)) break;
        if (Math.floor(anim * 5) % 2) { const top = (f._sy !== undefined ? f._sy : Y - 32); r.rect(X - 1, top - 5, 2, 3, '#ffd166'); r.rect(X, top - 7, 1, 2, '#ff5a2a'); }
        break;
      }
      case 'phoenix_nova': {
        const a = 1 - k;
        r.circleLine(X, Y, rr * easeOut3(k), rgba('#ff9a2a', a), 3);
        r.circleLine(X, Y, rr * 0.8 * easeOut3(k), rgba('#ffd166', a), 2);
        // the firebird rising out of the flames
        const by = Y - 20 - k * 50, sc = 1 + k * 0.6;
        phoenixWings(r, X, by, anim * 2, a);
        r.circleFill(X, by - 2, 3 * sc, rgba('#ffd166', a));
        r.line(X, by, X, by + 14 * sc, rgba('#ff5a2a', a), 2);
        motes(r, X, Y, rr, 60, 16, 616, anim, 2.2, ['#ff5a2a', '#ffd166', '#ffffff'], 2);
        break;
      }
      case 'tree': {
        // healing sparkles over the caster while it stands in the field
        const f = P.fs[e[4] === 1 ? 1 : 0];
        if (!f || (f.flags & KO)) break;
        const fx = r.X(f.x), fy = r.Y(f.y);
        if (Math.hypot(f.x - x, f.y - y) <= (e[3] || 0)) {
          for (let j = 0; j < 5; j++) {
            const ph = (anim * 1.2 + prand(300 + j)) % 1, px = fx + (prand(310 + j) - 0.5) * 22, py = fy - ph * 30;
            r.rect(px - 1, py, 3, 1, rgba('#9dff9a', 1 - ph)); r.rect(px, py - 1, 1, 3, rgba('#9dff9a', 1 - ph));
          }
        }
        break;
      }
      default: break;
    }
  }

  // ── screen-space layers ───────────────────────────────────────────────────
  function timeStopGrade(ctx, P) {
    const e = P.fx.find(q => q[0] === 'timestop' && q[6] >= 0);
    // once the fight is over (resting on its last frame), time resumes: fade the grade out
    const lastFr = S.rep && Array.isArray(S.rep.frames) ? S.rep.frames.length - 1 : Infinity;
    if (e && P.fr >= lastFr - 1e-6 && !ctx.hold) { if (S.endAnim === null || S.endAnim === undefined) S.endAnim = ctx.anim; }
    else S.endAnim = null;
    const endFade = S.endAnim === null ? 1 : Math.max(0, 1 - (ctx.anim - S.endAnim) / 0.6);
    if (!e || endFade <= 0) return;
    const b = ctx.b, r = ctx.r, k = clamp01(e[5] / 100);
    const inv = k < 0.1 && endFade >= 1; // the "stopping" sphere: colours invert inside a growing bubble
    const caster = P.fs[e[4] === 1 ? 1 : 0];
    const CX = r.X(caster.x), CY = r.Y(caster.y) - 10;
    const fade = (k > 0.9 ? 1 - (k - 0.9) / 0.1 : 1) * endFade;
    b.save();
    b.globalCompositeOperation = 'saturation';
    b.globalAlpha = fade;
    b.fillStyle = '#808080';
    b.fillRect(0, 0, ctx.bw, ctx.bh);
    b.globalCompositeOperation = 'multiply';
    b.fillStyle = 'rgb(150,165,215)';
    b.fillRect(0, 0, ctx.bw, ctx.bh);
    if (inv) {
      b.globalCompositeOperation = 'difference';
      b.globalAlpha = 1;
      b.fillStyle = '#ffffff';
      b.beginPath();
      b.arc(CX, CY, Math.max(4, (k / 0.1) * Math.max(ctx.bw, ctx.bh) * 0.8), 0, TAU);
      b.fill();
    }
    b.restore();
    // the caster alone keeps moving in colour
    if (caster._img) blit(b, caster._img, caster._sx, caster._sy, caster._flip, 1, 1);
    const R2 = Math.max(ctx.bw, ctx.bh);
    for (let j = 0; j < 3; j++) { // slow clock ripples
      const q = ((ctx.anim * 0.35) + j / 3) % 1;
      r.circleLine(CX, CY, 20 + q * R2 * 0.6, rgba('#dfe6ff', 0.25 * (1 - q) * endFade));
    }
  }

  function impactFrame(ctx, P, a) {
    const { c, tau } = a;
    const b = ctx.b, r = ctx.r, bw = ctx.bw, bh = ctx.bh;
    const big = c.kind !== 'impact';
    // 1–3 high-contrast frames: inverted (black bg / white silhouettes), negative, then a coloured one for big hits
    const A = 45, B = 95, C = big ? 150 : 95;
    if (tau >= C) return false;
    const phase = tau < A ? 0 : tau < B ? 1 : 2;
    const pt = impactPoint(ctx, c, P);
    const bg = phase === 0 ? '#000000' : phase === 1 ? '#ffffff' : (c.kind === 'ko' ? '#2a0006' : '#0a0418');
    const fg = phase === 0 ? '#ffffff' : phase === 1 ? '#000000' : (c.kind === 'ko' ? '#ff2a3a' : c.kind === 'godhit' ? '#ffe27a' : '#ff4dd2');
    b.fillStyle = bg;
    b.fillRect(0, 0, bw, bh);
    focusLines(b, pt.X, pt.Y, big ? 26 : 18, Math.max(bw, bh) * 1.2, big ? 44 : 30, fg, 71 + c.t, ctx.anim, big ? 0.035 : 0.028);
    for (const f of P.fs) {
      if (!f._img) continue;
      const sil = phase === 1 ? tintOf(f.def.px, f._img, '#000000') : phase === 0 ? whiteOf(f.def.px, f._img) : tintOf(f.def.px, f._img, '#ffffff');
      blit(b, sil, f._sx, f._sy, f._flip, 1, 1);
    }
    // the hit point: a jagged star
    const rad = big ? 22 : 14;
    r.circleFill(pt.X, pt.Y, big ? 6 : 4, fg);
    starburst(r, pt.X, pt.Y, rad, fg, big ? 14 : 10, 13 + c.t, 0.3);
    if (phase === 1 && big) r.circleLine(pt.X, pt.Y, rad + 6, '#000000', 2);
    return true;
  }

  function impactAfter(ctx, P, a) {
    // shockwave + flash after the impact frames (world space, above fighters)
    const { c, tau, ms } = a;
    const r = ctx.r, pt = impactPoint(ctx, c, P);
    const big = c.kind !== 'impact';
    const T = big ? 520 : 300, q = (tau - (big ? 150 : 95)) / T;
    if (q < 0 || q > 1) return;
    const col = c.kind === 'godhit' ? '#ffe27a' : c.kind === 'ko' ? '#ff5a5a' : c.kind === 'ulthit' ? '#ff9aee' : '#ffffff';
    r.circleLine(pt.X, pt.Y, 8 + easeOut3(q) * (big ? 70 : 34), rgba(col, 1 - q), big ? 3 : 2);
    if (big) r.circleLine(pt.X, pt.Y, 4 + easeOut3(q) * 44, rgba('#ffffff', (1 - q) * 0.8), 1);
    starburst(r, pt.X, pt.Y, (big ? 26 : 14) * (0.6 + q), rgba(col, (1 - q) * 0.8), big ? 10 : 6, 99 + c.t, q * 0.5);
    if (tau < ms) { // still frozen: flicker a white flash on the victim
      const f = P.fs[pt.v];
      if (f && f._img && Math.floor(tau / 40) % 2 === 0) blit(ctx.b, whiteOf(f.def.px, f._img), f._sx, f._sy, f._flip, 1, 0.8);
    }
  }

  // ── power-up (ult / godly windup: rooted + exposed) ──────────────────────
  function chargeUnder(ctx, P, f, cs) {
    const r = ctx.r, anim = ctx.anim, b = ctx.b;
    const { ch, k } = cs, god = ch.kind === 'god', col = ch.col;
    const { X, foot } = feet(ctx, f);
    // growing ground rune circle; the runes spin faster as the charge fills
    const rad = Math.round((god ? 15 : 13) + (god ? 13 : 10) * easeOut3(k));
    r.circleFill(X, foot, rad + 2, rgba(col, 0.08 + 0.14 * k));
    magicCircle(r, X, foot, rad, col, anim * (1 + 6 * k), god);
    // the charge meter is the rune ring itself filling clockwise
    r.arcPixels(X, foot, rad + 3, -Math.PI / 2, -Math.PI / 2 + TAU * k, '#ffffff', 2);
    // vulnerable: a blinking red warning ring around it
    if (Math.floor(anim * 6) % 2) r.circleLine(X, foot, rad + 7, rgba('#ff3a3a', 0.55 + 0.3 * k), 1);
    // growing aura behind the body (additive)
    b.save();
    b.globalCompositeOperation = 'lighter';
    const w = Math.round(5 + 9 * k);
    if (god) r.rect(X - w, 0, 2 * w, foot, rgba(col, 0.05 + 0.1 * k)); // the heavens answer
    r.ellipseFill(X, foot - 13, 8 + 9 * k, 14 + 8 * k, rgba(col, 0.12 + 0.22 * k));
    for (let j = 0; j < 10; j++) { // flame-like tongues licking upward
      const ph = (anim * (1.5 + 2 * k) + prand(80 + j)) % 1, px = X + (prand(90 + j) - 0.5) * (14 + 10 * k);
      r.rect(px, foot - 4 - ph * (22 + 18 * k), 1, 3 + Math.round(3 * k), rgba(j % 3 ? col : '#ffffff', (1 - ph) * (0.3 + 0.5 * k)));
    }
    b.restore();
  }

  function chargeOver(ctx, P, f, cs) {
    const r = ctx.r, anim = ctx.anim, b = ctx.b;
    const { ch, k } = cs, col = ch.col;
    const { X, foot } = feet(ctx, f);
    const cy = foot - 13;
    // energy converging on the caster: more, faster and from farther as it fills
    const n = 10 + Math.round(20 * k);
    for (let j = 0; j < n; j++) {
      const ph = (anim * (1.1 + 2.4 * k) + prand(40 + j)) % 1, rad = (1 - ph) * (34 + 16 * k) + 3, an = prand(60 + j) * TAU + anim * 0.9;
      const px = X + Math.cos(an) * rad, py = cy + Math.sin(an) * rad * 0.75;
      r.line(px, py, px + Math.cos(an) * 3, py + Math.sin(an) * 2, rgba(j % 3 ? col : '#ffffff', 0.3 + 0.7 * ph), 1);
    }
    // a hum that rises in pitch: pulse rings come faster and brighter as it fills
    const period = 0.5 - 0.36 * k, q = (anim % period) / period;
    r.circleLine(X, cy, 5 + q * (18 + 12 * k), rgba(mixHex(col, '#ffffff', 0.3), (1 - q) * (0.3 + 0.55 * k)));
    // the sprite glows, then brightens and flickers near the end
    if (f._img) {
      const g = tintOf(f.def.px, f._img, mixHex(col, '#ffffff', 0.35));
      if (Math.floor(anim * 14) % 3) for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) blit(b, g, f._sx + ox, f._sy + oy, f._flip, 1, 0.45 + 0.5 * k);
      blit(b, f._img, f._sx, f._sy, f._flip, 1, 1);
      if (k > 0.55) {
        const a = (k - 0.55) / 0.45, fl = Math.floor(anim * (8 + 22 * k)) % 2;
        blit(b, whiteOf(f.def.px, f._img), f._sx, f._sy, f._flip, 1, fl ? 0.15 + 0.55 * a : 0.08 * a);
      }
    }
    // small name tag + a blinking "exposed" mark
    const top = (f._sy !== undefined ? f._sy : foot - 32) - 15;
    const name = String(ch.name).toUpperCase().slice(0, 18);
    r.text(name, X, top, { color: mixHex(col, '#ffffff', 0.25), size: 8, outline: '#000000' });
    if (Math.floor(anim * 5) % 2) {
      const ix = X + Math.round(name.length * 4) + 6, iy = top - 1;
      r.rect(ix - 3, iy - 4, 7, 9, '#000000'); r.rect(ix - 2, iy - 3, 5, 7, '#ff3a3a'); r.rect(ix, iy - 2, 1, 3, '#ffffff'); r.rect(ix, iy + 2, 1, 1, '#ffffff');
    }
  }

  function releaseFx(ctx, P, f, rs) {
    const r = ctx.r, b = ctx.b, { ch, q } = rs, col = ch.col;
    const { X, foot } = feet(ctx, f);
    const cy = foot - 13;
    if (ch.interrupted) { // fizzle: the gathered energy scatters and fades, a grey puff
      for (let j = 0; j < 12; j++) {
        const an = prand(700 + j) * TAU, d = 6 + q * (14 + prand(710 + j) * 16);
        r.rect(X + Math.cos(an) * d, cy + Math.sin(an) * d * 0.6 + q * q * 18, 2, 2, rgba(j % 2 ? col : '#9aa0b0', 1 - q));
      }
      r.circleFill(X, cy - q * 10, 6 + q * 10, rgba('#8a8f9e', 0.35 * (1 - q)));
      for (let j = 0; j < 10; j++) { // the rune ring shatters: arc shards flung outward
        const an = (j / 10) * TAU + 0.3, d = 16 + easeOut3(q) * 26;
        r.arcPixels(X + Math.cos(an) * (d - 16), foot + Math.sin(an) * (d - 16) * 0.8, 16, an - 0.22, an + 0.22, rgba(j % 2 ? col : '#c8ccd8', 1 - q), 2);
      }
      if (q < 0.6 && Math.floor(ctx.anim * 10) % 2) r.text('BROKEN', X, (f._sy !== undefined ? f._sy : foot - 32) - 15 - Math.round(q * 8), { color: '#c8ccd8', size: 8, outline: '#000000', alpha: 1 - q });
      return;
    }
    // release: flash + shock rings + sparks
    b.save();
    b.globalCompositeOperation = 'lighter';
    if (q < 0.3) {
      const a = 1 - q / 0.3;
      r.circleFill(X, cy, 8 + 26 * (q / 0.3), rgba(mixHex(col, '#ffffff', 0.6), 0.75 * a));
      if (f._img) blit(b, whiteOf(f.def.px, f._img), f._sx, f._sy, f._flip, 1, a);
    }
    b.restore();
    r.circleLine(X, foot, 8 + easeOut3(q) * 62, rgba(col, 1 - q), 3);
    r.circleLine(X, foot, 5 + easeOut3(q) * 42, rgba('#ffffff', (1 - q) * 0.8), 1);
    starburst(r, X, cy, 12 + q * 34, rgba(mixHex(col, '#ffffff', 0.5), 1 - q), 12, 7 + ch.t1, q * 0.6);
    for (let j = 0; j < 14; j++) {
      const an = prand(600 + j + ch.t1) * TAU, d = easeOut3(q) * (26 + prand(620 + j) * 30);
      r.rect(X + Math.cos(an) * d, cy + Math.sin(an) * d * 0.7, 2, 2, rgba(j % 3 ? col : '#ffffff', 1 - q));
    }
  }

  // ── awakening / ascension ignition (instant, no hold) ─────────────────────
  const AWAKE_S = 1.2;
  function awakenFx(ctx, P, f, e, age) {
    const r = ctx.r, b = ctx.b, anim = ctx.anim, q = age / AWAKE_S, s = f.side;
    const asc = e.v === 'ascend', col = asc ? '#ffe27a' : awakenCol(s);
    const { X, foot } = feet(ctx, f);
    const cy = foot - 14;
    b.save();
    b.globalCompositeOperation = 'lighter';
    // a pillar of light / fire bursting upward, narrowing as it fades
    const pw = Math.max(1, Math.round((asc ? 18 : 13) * (1 - q)));
    r.rect(X - pw, 0, pw * 2, foot, rgba(col, 0.35 * (1 - q)));
    r.rect(X - Math.max(1, pw >> 1), 0, Math.max(2, pw), foot, rgba('#ffffff', 0.45 * (1 - q)));
    if (q < 0.18) {
      const a = 1 - q / 0.18;
      r.circleFill(X, cy, 10 + 40 * (q / 0.18), rgba('#ffffff', 0.7 * a));
      if (f._img) blit(b, whiteOf(f.def.px, f._img), f._sx, f._sy, f._flip, 1, a);
    }
    b.restore();
    r.circleLine(X, foot, 10 + easeOut3(q) * (asc ? 110 : 80), rgba(col, 1 - q), 3);
    r.circleLine(X, foot, 6 + easeOut3(q) * (asc ? 76 : 54), rgba('#ffffff', 0.8 * (1 - q)), 1);
    for (let j = 0; j < 18; j++) { // flames / light shards thrown up around the ring
      const an = (j / 18) * TAU, d = 10 + easeOut3(q) * (asc ? 60 : 44);
      const h = Math.round((4 + prand(800 + j) * 6) * (1 - q));
      if (h > 0) r.rect(X + Math.cos(an) * d, foot + Math.sin(an) * d * 0.45 - h - q * 8, 1 + (j % 2), h, rgba(j % 3 ? col : '#ffffff', 1 - q));
    }
    if (asc) {
      starburst(r, X, cy, 24 + q * 40, rgba('#fff3b0', 1 - q), 16, 31, anim * 0.2);
      for (let j = 0; j < 12; j++) { // feathers of light drifting down
        const fx = X + (prand(900 + j) - 0.5) * 80 + Math.sin(anim * 2 + j) * 3, fy = cy - 50 + q * 60 + prand(910 + j) * 20;
        r.rect(fx, fy, 2, 1, rgba('#ffffff', 1 - q)); r.rect(fx + 1, fy + 1, 1, 1, rgba('#ffe27a', 1 - q));
      }
    }
    // the transformation's name, rising a little
    if (q < 0.9) {
      const fd = (S.rep && S.rep.fighters && S.rep.fighters[s]) || {};
      const name = asc ? 'ASCENSION' : String((fd.awakening && fd.awakening.name) || 'AWAKENED').toUpperCase().slice(0, 18);
      const top = (f._sy !== undefined ? f._sy : foot - 32) - 16 - Math.round(q * 6);
      r.text(name, X, top, { color: mixHex(col, '#ffffff', 0.3), size: 8, outline: '#000000', alpha: q < 0.7 ? 1 : 1 - (q - 0.7) / 0.2 });
    }
  }

  function awakenings(ctx, P, fn) {
    const lim = AWAKE_S * S.tickRate;
    ctx.r.eventsIn(P.efr - lim, P.efr, (e) => {
      if (e.k !== 'awaken' || (e.a !== 0 && e.a !== 1)) return;
      const age = (P.efr - e.t) / S.tickRate;
      if (age >= 0 && age < AWAKE_S) fn(e, age);
    });
  }

  return {
    name: 'powers',
    onReplay(replay, r) {
      S.rep = replay;
      S.tickRate = replay.tickRate || 30;
      S.cins = Array.isArray(replay.cinematics) ? replay.cinematics.filter(c => c && Number.isFinite(c.t)).slice().sort((p, q) => p.t - q.t) : [];
      S.sawHold = false;
      S.last = [null, null];
      S.charges = scanCharges(replay);
    },
    camera(ctx) {
      if (ctx.r.mini) return null;
      const P = info(ctx);
      let dx = 0, dy = 0, zoom = 1, shake = 0;
      for (const a of P.act) { // hit-stops (impact / ulthit / godhit / ko)
        const kind = a.c.kind, big = kind !== 'impact';
        if (a.tau < a.ms) {
          shake += (big ? 5 : 3) * (1 - 0.5 * a.k);
          if (big) zoom *= a.tau < 150 ? 1.5 : 1 + 0.25 * (1 - a.k);
          const v = P.fs[kind === 'ko' ? (a.c.a === 1 ? 1 : 0) : 1 - (a.c.a === 1 ? 1 : 0)], cam = ctx.r.cam || { x: 0, y: 0 };
          if (big && v) { dx += (v.x - cam.x) * 0.5; dy += (v.y - 20 - cam.y) * 0.5; }
        } else shake += (big ? 4 : 2) * Math.max(0, 1 - (a.tau - a.ms) / 260);
      }
      for (const f of P.fs) {
        const cs = chargeState(P, f);
        if (cs.cur && cs.cur.k > 0.7) shake += (cs.cur.k - 0.7) * 3; // a low rumble just before the release
        if (cs.rel && !cs.rel.ch.interrupted && cs.rel.q < 0.5) {
          const w = 1 - cs.rel.q / 0.5, ch = cs.rel.ch;
          shake += 4 * w;
          if (ch.tx !== null) { const d = Math.hypot(ch.tx - f.x, ch.ty - f.y) || 1; dx += ((ch.tx - f.x) / d) * 10 * w; dy += ((ch.ty - f.y) / d) * 10 * w; }
        }
      }
      awakenings(ctx, P, (e, age) => { if (age < 0.35) shake += (e.v === 'ascend' ? 6 : 4) * (1 - age / 0.35); });
      return { dx, dy, zoom, shake };
    },
    beforeWorld(ctx) {
      const P = info(ctx);
      for (const e of P.fx) if (Array.isArray(e)) ground(ctx, P, e);
      for (const f of P.fs) {
        auraUnder(ctx, P, f, P.f2[f.side]);
        if (f.flags & KO) continue;
        const cs = chargeState(P, f);
        if (cs.cur) chargeUnder(ctx, P, f, cs.cur);
      }
    },
    afterFighters(ctx) {
      const P = info(ctx);
      for (const e of P.fx) if (Array.isArray(e)) above(ctx, P, e);
      for (const f of P.fs) {
        auraOver(ctx, P, f, P.f2[f.side]);
        const cs = chargeState(P, f);
        if (cs.cur && !(f.flags & KO)) chargeOver(ctx, P, f, cs.cur);
        if (cs.rel) releaseFx(ctx, P, f, cs.rel);
      }
      awakenings(ctx, P, (e, age) => awakenFx(ctx, P, P.fs[e.a], e, age));
      for (const a of P.act) impactAfter(ctx, P, a);
    },
    overlay(ctx) {
      const P = info(ctx);
      if (!ctx.r.mini) timeStopGrade(ctx, P);
      if (ctx.r.mini || !P.act.length) return;
      // an impact frame replaces the whole picture for 1–3 frames
      for (const a of P.act) if (impactFrame(ctx, P, a)) return;
      // hit-stop flash while frozen on a big impact
      for (const a of P.act) {
        if (a.tau < a.ms && a.c.kind !== 'impact') {
          const q = a.tau / a.ms;
          ctx.b.fillStyle = `rgba(255,255,255,${(0.18 * (1 - q)).toFixed(3)})`;
          ctx.b.fillRect(0, 0, ctx.bw, ctx.bh);
        }
      }
    },
  };
}
