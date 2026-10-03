// ─────────────────────────────────────────────────────────────────────────────
//  Arena props (obstacle sprites) for crystal, factory, sky, olympus and abyss.
//  Each builder is (R, seed, kit) → kit.finish(...); see art-obstacles.js for the toolkit.
// ─────────────────────────────────────────────────────────────────────────────

// view tilt used by the sphere rasteriser (tan = SQ): a sphere looks VY× taller than wide
const VC = 0.9119, VS = 0.4104, VY = 1.0966;
const N4 = [[0, -1], [0, 1], [-1, 0], [1, 0]];
const frac = (v) => v - Math.floor(v);

// Depth-tested sphere at world (X, Y, Z). shade(nx, ny, nz, z, i, j, q) → (mat << 8 | tone) or -1,
// with the world-space surface normal, the surface height z and q = 0 (centre) … 1 (rim).
function sphere(p, cx, cy, SQ, X, Y, Z, r, shade, zMin = -1e9) {
  if (r < 0.5) r = 0.5;
  const sx = cx + X, sy = cy + Y * SQ - Z, ry = r * VY, dc = Y + 0.45 * Z;
  const j0 = Math.floor(sy - ry), j1 = Math.ceil(sy + ry), i0 = Math.floor(sx - r), i1 = Math.ceil(sx + r);
  for (let j = j0; j <= j1; j++) {
    const v = (j + 0.5 - sy) / ry;
    if (v <= -1 || v >= 1) continue;
    for (let i = i0; i <= i1; i++) {
      const u = (i + 0.5 - sx) / r, q = u * u + v * v;
      if (q > 1) continue;
      const w = Math.sqrt(1 - q);
      const nz = -v * VC + w * VS, z = Z + r * nz;
      if (z < zMin) continue;
      const val = shade(u, v * VS + w * VC, nz, z, i, j, q);
      if (val >= 0) p.zput(i, j, val >> 8, val & 255, dc + r * w * VY);
    }
  }
}

// convex faceted rock with a tilted flat top (same idea as the lava boulders)
function boulder(rn, TAU, bx, by, b, H, n) {
  const dirs = [], sl = [], bb = [];
  const rot = rn() * TAU;
  for (let k = 0; k < n; k++) {
    const an = rot + (k / n) * TAU + rn.range(-0.28, 0.28);
    dirs.push(Math.cos(an), Math.sin(an));
    const bk = b * rn.range(0.82, 1.06);
    bb.push(bk);
    sl.push((H * rn.range(1.5, 2.1)) / bk);
  }
  const tx = rn.range(-0.5, 0.5) * (H / b) * 0.3, ty = rn.range(-0.4, 0.2) * (H / b) * 0.3;
  const reach2 = (b * 1.08 + 0.5) * (b * 1.08 + 0.5) / Math.pow(Math.cos(Math.PI / n), 2);
  return (x, y) => {
    const dx = x - bx, dy = y - by;
    if (dx * dx + dy * dy > reach2) return -1;
    let v = H + tx * dx + ty * dy;
    for (let k = 0; k < n; k++) {
      const q = sl[k] * (bb[k] - (dx * dirs[2 * k] + dy * dirs[2 * k + 1]));
      if (q < v) v = q;
    }
    return v;
  };
}

// colour + depth copy (Pix.clone shares the depth buffer)
function dup(p) { const q = p.clone(); q.d = p.d.slice(); return q; }

// paint [i, j, mat, tone] pixels over a finished frame, optionally ringed with their outline colour
function stamp(q, px, ring) {
  const own = new Set();
  for (const e of px) own.add(e[1] * 4096 + e[0]);
  for (const [i, j, m, t] of px) q.set(i, j, m, t);
  if (!ring) return;
  for (const [i, j, m] of px) {
    for (const [di, dj] of N4) {
      const ii = i + di, jj = j + dj;
      if (!own.has(jj * 4096 + ii)) q.set(ii, jj, m | 128, 0);
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  shared: a marble column (sky / olympus), adapted from the colosseum column
// ═════════════════════════════════════════════════════════════════════════════
const GOLD_P = ['#5a3806', '#8e5c0e', '#c0881c', '#e8b83a', '#fadf72', '#fff8cc'];
const VOLUTE5 = ['.ooo.', 'ollmo', 'olodo', 'ommdo', '.ooo.'];
const VOLUTE4 = ['.oo.', 'olmo', 'omdo', '.oo.'];

function marbleColumn(kit, R, seed, cfg) {
  const { SQ, clamp, len2, norm3, LIGHT, hash3, hrand, C, pal, Pix, area, slab, depthEdges, outline, cylTone } = kit;
  const PL = 1, SH = 2, CA = 3, GO = 4;
  const marble = pal(...cfg.marble), OL = C(cfg.ol);
  const mats = [null, { pal: marble, ol: OL, pr: 1 }, { pal: marble, ol: OL, pr: 2 }, { pal: marble, ol: OL, pr: 3 },
    { pal: pal(...GOLD_P), ol: C(cfg.gol), pr: 4 }];
  if (cfg.mats) mats.push(...cfg.mats);
  const k = clamp((R - 10) / 38, 0, 1);
  const rs = R * (cfg.thick - 0.2 * k);
  const a1 = R, h1 = Math.max(3, Math.round(R * 0.11));
  const a2 = Math.round(R * 0.8), h2 = cfg.steps > 1 ? Math.max(2, Math.round(R * 0.08)) : 0;
  const rt = rs + Math.max(1.5, rs * 0.16), ht = Math.max(2, Math.round(rs * 0.18));
  const re = rs + Math.max(2, rs * 0.3), he = Math.max(3, Math.round(rs * 0.25));
  const aa = Math.round(re + (cfg.ionic ? 0 : 1)), ha = Math.max(2, Math.round(rs * cfg.abacus));
  const zTop = Math.round(cfg.vis - R * SQ - aa * SQ);
  const zP = h1 + h2, zS0 = zP + ht, zS1 = zTop - ha - he;
  const G = area(R + 2 + (cfg.padX || 0), zTop + aa * SQ + 2 + (cfg.up || 0), R * SQ + 2);
  const p = new Pix(G.W, G.H);
  const { cx, cy, AX } = G;
  const gs = hash3(seed, cfg.salt, 5);
  const grain = (i, j) => hrand(gs, i, j) < 0.02;
  const lh = norm3(LIGHT[0], LIGHT[1], 0);
  const inShaftShadow = (x, y) => {
    const t = -(x * lh[0] + y * lh[1]);
    if (t < 0) return false;
    const qx = x + t * lh[0], qy = y + t * lh[1];
    return qx * qx + qy * qy <= rs * rs;
  };
  const aoStep = (x, y) => h2 > 0 && y > a2 - 0.2 && y < a2 + 1.3 && Math.abs(x) <= a2 + 0.5;
  const aoTorus = (x, y) => { const d = len2(x, y); return y > -rt * 0.3 && d > rt - 0.3 && d < rt + 1.2; };
  const box = (mat, ao, trim) => (kind, m, x, y, z, nx, ny, nz, i, j, ft, fb) => {
    if (kind === 0) {
      let t = 4;
      if (ao && ao(x, y)) t = 3;
      else if (mat !== CA && mat !== GO && inShaftShadow(x, y)) t = 3;
      else if (grain(i, j)) t = 3;
      return (mat << 8) | t;
    }
    if (trim && ft <= 2) return (GO << 8) | (ft === 1 ? 5 : 2);
    return (mat << 8) | (ft === 1 ? 5 : fb === 0 ? 2 : 3);
  };
  slab(p, cx, cy, 1, a1, 0, h1, box(PL, h2 ? aoStep : aoTorus, cfg.goldTrim), PL);
  if (h2) slab(p, cx, cy, 1, a2, h1, zP, box(PL, aoTorus, cfg.goldTrim), PL);
  const TM = cfg.goldBase ? GO : PL;
  slab(p, cx, cy, 0, rt, zP, zS0, (kind, m, x, y, z, nx, ny, nz, i, j, ft, fb) => {
    if (kind === 0) return (TM << 8) | 4;
    let t = cylTone(x / rt);
    if (ft === 1) t = Math.min(5, t + 1); else if (fb === 0) t = Math.max(1, t - 1);
    return (TM << 8) | t;
  }, TM);
  // fluted shaft
  const nF = Math.max(8, Math.min(22, 2 * Math.round((Math.PI * 2 * rs) / 7)));
  const flute = new Uint8Array(G.W);
  for (let f = 0; f < nF / 2; f++) {
    const th = -Math.PI / 2 + (f + 0.5) * ((Math.PI * 2) / nF), x = rs * Math.sin(th);
    if (Math.abs(x) <= rs * 0.84) flute[AX + Math.round(x)] = 1;
  }
  const bandTop = cfg.band ? 3.5 : 0;
  slab(p, cx, cy, 0, rs, zS0, zS1, (kind, m, x, y, z, nx, ny, nz, i, j, ft, fb) => {
    if (kind === 0) return (SH << 8) | 4;
    let t = cylTone(x / rs);
    if (cfg.band && z >= zS1 - 3.5 && z < zS1 - 1.5) return (GO << 8) | clamp(t, 1, 5);
    if (cfg.goldBand0 && z >= zS0 + 1 && z < zS0 + 2) return (GO << 8) | clamp(t, 1, 5);
    const inF = z > zS0 + (cfg.goldBand0 ? 2.5 : 1.5) && z < zS1 - 3 - bandTop;
    if (flute[i] && inF) {
      const span = zS1 - zS0;
      if (cfg.goldFlutes && (z < zS0 + span * 0.2 || z > zS1 - span * 0.26)) return (GO << 8) | (x < -rs * 0.3 ? 4 : x < rs * 0.3 ? 3 : 2);
      t = Math.max(1, t - 1);
    } else if (flute[i - 1] && x < 0 && inF) t = Math.min(5, t + 1);
    if (fb === 0 || (z > zS1 - 2.5 && z <= zS1 - 1.5)) t = Math.max(1, t - 1);
    return (SH << 8) | t;
  }, SH);
  // echinus + abacus
  const CM = cfg.goldCap ? GO : CA;
  for (let s = 0; s < he; s++) {
    const f = (s + 1) / he, r = rs + (re - rs) * Math.sin((f * Math.PI) / 2);
    slab(p, cx, cy, 0, r, zS1 + s, zS1 + s + 1, (kind, m, x) => {
      let t = kind === 0 ? 4 : cylTone(x / r);
      if (kind === 1) {
        if (s === he - 1) t = Math.max(1, t - 1);
        else if (s < he - 2 || he <= 3) t = Math.min(5, t + 1);
      }
      return (CM << 8) | t;
    }, CM);
  }
  const AM = cfg.marbleAbacus ? CA : CM;
  slab(p, cx, cy, 1, aa, zTop - ha, zTop, box(AM, null, !!cfg.marbleAbacus), AM);
  const info = { p, mats, G, cx, cy, AX, zTop, rs, rt, aa, ha, h1, zP, a1, zS0, zS1 };
  if (cfg.extra) cfg.extra(p, info);
  depthEdges(p, 4);
  // ionic volutes: little scrolls hanging off both ends of the abacus
  if (cfg.ionic) {
    const pat = R >= 9 ? VOLUTE5 : VOLUTE4, n = pat.length;
    const jv = Math.floor(cy + aa * SQ - (zTop - ha) - 1e-4) - 1;
    for (const side of [-1, 1]) {
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          const ch = pat[r][side < 0 ? c : n - 1 - c];
          if (ch === '.') continue;
          const i = side < 0 ? AX - aa - 2 + c : AX + aa + 2 - (n - 1) + c;
          const j = jv + r;
          if (ch === 'o') p.set(i, j, CM | 128, 0);
          else p.set(i, j, CM, ch === 'l' ? 5 : ch === 'm' ? 4 : 2);
        }
      }
    }
  }
  outline(p, mats);
  return info;
}

// ═════════════════════════════════════════════════════════════════════════════
//  palettes
// ═════════════════════════════════════════════════════════════════════════════
const CRYSTAL_HUES = [
  { cry: ['#1e0c3e', '#3a1c7a', '#6236c0', '#9366ec', '#c8a8ff', '#f4ecff'], core: ['#7c4ee0', '#a47cff', '#dcc8ff', '#ffffff'],
    tint: ['#2a2048', '#3e2f6c', '#5a4696'], ol: '#10062a', glow: [154, 102, 255] },
  { cry: ['#3a0a30', '#72185c', '#b83494', '#e668c2', '#ffb4e6', '#fff0fa'], core: ['#cc3c9a', '#f07aca', '#ffc6ea', '#ffffff'],
    tint: ['#381c3c', '#562656', '#7e3876'], ol: '#1e0418', glow: [255, 90, 192] },
  { cry: ['#082a38', '#0c5868', '#179aa2', '#40d6cc', '#a8fcec', '#ecfffa'], core: ['#1eaaa8', '#52e6da', '#b6ffee', '#ffffff'],
    tint: ['#152e3e', '#1c4856', '#286c74'], ol: '#03161e', glow: [60, 240, 220] },
];
const CAVE_ROCK = ['#141019', '#211b2c', '#302840', '#433a58', '#5a5074'];

export const PROPS_MYSTIC = {
  // ═══════════════════════════════════════════════════════════════════════════
  //  CRYSTAL CAVERN — glowing crystal prisms bursting from a lump of cave rock
  // ═══════════════════════════════════════════════════════════════════════════
  crystal(R, seed, kit) {
    const { TAU, SQ, norm3, cross3, lit, hash3, hrand, stream, C, pal, rgb, Pix, Dec, area, renderHF, tri3,
      outline, depthEdges, despeckle, finish, dEllipse, dShadow, dPebble } = kit;
    const rn = stream(seed, 101);
    const hue = CRYSTAL_HUES[(seed >>> 0) % 3];
    const ROCK = 1, CRY = 2, CORE = 3, TINT = 4, GL = 5;
    const ROL = C('#08060c'), HOL = C(hue.ol);
    const mats = [null,
      { pal: pal(...CAVE_ROCK), ol: ROL, pr: 2 },
      { pal: pal(...hue.cry), ol: HOL, pr: 3 },
      { pal: pal(...hue.core), ol: HOL, pr: 3 },
      { pal: pal(...hue.tint), ol: ROL, pr: 2 },
      { pal: pal('#ffffff', hue.cry[4]), ol: null, pr: 0 },
    ];
    const vis = Math.min(98, Math.round(rn.range(1.62, 1.95) * 2 * R));
    const G = area(R * 1.3 + 3, vis + 4, R * SQ + 3);
    const p = new Pix(G.W, G.H);
    const { cx, cy } = G;

    // a low lump of cave rock the crystals grow out of
    const hr = Math.max(3, R * 0.42);
    const parts = [boulder(rn, TAU, rn.range(-0.08, 0.08) * R, -R * 0.04, R * 0.74, hr, rn.int(6, 8))];
    const nS = R < 11 ? 1 : R < 20 ? 2 : 3;
    const slotA = [rn.range(10, 40), rn.range(150, 180), rn.range(95, 125)];
    for (let s = 0; s < nS; s++) {
      const an = (slotA[s] * Math.PI) / 180, b = R * rn.range(0.26, 0.34), dd = Math.min(R * 0.62, R - b * 1.1);
      parts.push(boulder(rn, TAU, Math.cos(an) * dd, Math.sin(an) * dd, b, hr * rn.range(0.45, 0.75), rn.int(5, 7)));
    }
    renderHF(p, cx, cy, { x0: -R - 2, x1: R + 2, y0: -R - 2, y1: R + 2, mat: ROCK }, (x, y) => {
      let v = -1;
      for (const f of parts) { const q = f(x, y); if (q > v) v = q; }
      return v > 0.4 ? v : -1;
    }, (kind, m, x, y, z, nx, ny, nz) => {
      const I = lit(nx, ny, nz);
      return (ROCK << 8) | (I > 0.66 ? 3 : I > 0.4 ? 2 : I > 0.12 ? 1 : 0);
    });

    // crystal layout: one tall prism plus a ring of tilted smaller ones
    const rc0 = Math.max(2.6, R * 0.29);
    const zTop = vis - R * SQ * 0.4;
    const tip0 = rc0 * 1.8;
    const list = [{ P: [rn.range(-0.1, 0.1) * R, -R * 0.1, 0], dir: [rn.range(-0.14, 0.14), -0.04, 1], rc: rc0, len: zTop - tip0, tip: tip0, rot: rn() * TAU, bias: 0 }];
    const nC = R < 11 ? 3 : R < 18 ? rn.int(4, 5) : rn.int(5, 7);
    const angs = [200, -20, 140, 40, 100, 250, 290];
    const shift = rn.int(0, 1);
    for (let c = 1; c < nC; c++) {
      const an = ((angs[(c - 1 + shift) % angs.length] + rn.range(-14, 14)) * Math.PI) / 180;
      const dist = R * rn.range(0.3, 0.5);
      const tilt = rn.range(0.35, 0.7);
      const rc = rc0 * rn.range(0.52, 0.76);
      const len = (zTop - tip0) * rn.range(0.32, 0.62) * (c > 2 ? 0.8 : 1);
      const behind = Math.sin(an) < -0.2;
      list.push({ P: [Math.cos(an) * dist, Math.sin(an) * dist, 0], dir: [Math.cos(an) * tilt, Math.sin(an) * tilt * 0.8, 1], rc, len, tip: rc * rn.range(1.4, 2), rot: rn() * TAU, bias: behind ? -1 : 0 });
    }
    const toneN = (n) => { const I = lit(n[0], n[1], n[2]); return I > 0.74 ? 4 : I > 0.5 ? 3 : I > 0.2 ? 2 : I > -0.12 ? 1 : 0; };
    const prism = (c) => {
      const { P, rc, len, tip, rot, bias } = c;
      const d = norm3(c.dir[0], c.dir[1], c.dir[2]);
      const e1 = norm3(-d[2], 0, d[0]), e2 = cross3(d, e1);
      let sax = d[0], say = d[1] * SQ - d[2];
      const sl = Math.hypot(sax, say) || 1;
      sax /= sl; say /= sl;
      const coreW = rc >= 2.3 ? rc * 0.36 : -1;
      // the glowing core: a streak along the prism axis, seen through the faces
      const inCore = (X, Y, Z) => {
        const ox = X - P[0], oy = Y - P[1], oz = Z - P[2];
        const v = (ox * d[0] + oy * d[1] + oz * d[2]) / len;
        if (v < 0.07 || v > 0.93) return false;
        const sx = ox, sy = oy * SQ - oz;
        return Math.abs(sx * say - sy * sax) < coreW * (1.1 - 0.4 * v);
      };
      const r0 = [], r1 = [];
      for (let k = 0; k < 6; k++) {
        const a = rot + (k * Math.PI) / 3, ca = Math.cos(a) * rc, sa = Math.sin(a) * rc;
        const o = [e1[0] * ca + e2[0] * sa, e1[1] * ca + e2[1] * sa, e1[2] * ca + e2[2] * sa];
        r0.push([P[0] + o[0], P[1] + o[1], P[2] + o[2]]);
        r1.push([P[0] + o[0] + d[0] * len, P[1] + o[1] + d[1] * len, P[2] + o[2] + d[2] * len]);
      }
      const T = [P[0] + d[0] * (len + tip), P[1] + d[1] * (len + tip), P[2] + d[2] * (len + tip)];
      for (let k = 0; k < 6; k++) {
        const k2 = (k + 1) % 6, am = rot + ((k + 0.5) * Math.PI) / 3;
        const n = [e1[0] * Math.cos(am) + e2[0] * Math.sin(am), e1[1] * Math.cos(am) + e2[1] * Math.sin(am), e1[2] * Math.cos(am) + e2[2] * Math.sin(am)];
        if (n[1] + 0.45 * n[2] > 0.01) {
          const base = Math.max(0, toneN(n) + bias), wpx = Math.abs(r0[k2][0] - r0[k][0]);
          const A = r0[k], B = r0[k2], Q1 = r1[k2], Q2 = r1[k];
          const sh = (u, X, Y, Z) => {
            if (coreW > 0 && inCore(X, Y, Z)) return (CORE << 8) | (base >= 3 ? 1 : 0);
            let t = base;
            if (wpx >= 2.5 && u > 1 - 1.1 / wpx) t = Math.min(4, t + 1);
            return (CRY << 8) | t;
          };
          tri3(p, cx, cy, A, B, Q1, (w0, w1, w2) => sh(w1 + w2, w0 * A[0] + w1 * B[0] + w2 * Q1[0], w0 * A[1] + w1 * B[1] + w2 * Q1[1], w0 * A[2] + w1 * B[2] + w2 * Q1[2]));
          tri3(p, cx, cy, A, Q1, Q2, (w0, w1, w2) => sh(w1, w0 * A[0] + w1 * Q1[0] + w2 * Q2[0], w0 * A[1] + w1 * Q1[1] + w2 * Q2[1], w0 * A[2] + w1 * Q1[2] + w2 * Q2[2]));
        }
        let tn = cross3([r1[k2][0] - r1[k][0], r1[k2][1] - r1[k][1], r1[k2][2] - r1[k][2]], [T[0] - r1[k][0], T[1] - r1[k][1], T[2] - r1[k][2]]);
        tn = norm3(tn[0], tn[1], tn[2]);
        if (tn[0] * n[0] + tn[1] * n[1] + tn[2] * n[2] < 0) tn = [-tn[0], -tn[1], -tn[2]];
        if (tn[1] + 0.45 * tn[2] > 0.01) {
          const t = Math.max(0, Math.min(4, toneN(tn) + 1 + bias));
          tri3(p, cx, cy, r1[k], r1[k2], T, () => (CRY << 8) | t);
        }
      }
    };
    for (const c of list) prism(c);
    depthEdges(p, 4);
    despeckle(p, CRY);
    // rim light on the crystals' top-left silhouette, a lit crest on the rock
    const { w, m, t } = p;
    const rim = [];
    for (let j = 1; j < p.h - 1; j++) {
      for (let i = 1; i < w - 1; i++) {
        const k = j * w + i, mk = m[k];
        if (mk === CRY) {
          const up = m[k - w], lf = m[k - 1];
          if ((up === 0 || up === ROCK) && (lf === 0 || lf === ROCK || t[k] >= 3) && t[k] >= 2) rim.push(k, Math.min(5, t[k] + 1));
        } else if (mk === ROCK && m[k - w] === 0 && t[k] >= 1) rim.push(k, Math.min(4, t[k] + 1));
      }
    }
    for (let q = 0; q < rim.length; q += 2) t[rim[q]] = rim[q + 1];
    // crystal light spilling onto the rock around the prisms
    const tint = [];
    for (let j = 2; j < p.h - 2; j++) {
      for (let i = 2; i < w - 2; i++) {
        const k = j * w + i;
        if (m[k] !== ROCK) continue;
        let near = 0;
        for (let dj = -2; dj <= 2 && !near; dj++) {
          for (let di = -2; di <= 2; di++) {
            const mm = m[k + dj * w + di];
            if (mm === CRY || mm === CORE) { near = Math.abs(di) + Math.abs(dj) <= 2 ? 2 : 1; break; }
          }
        }
        if (near) tint.push(k, Math.min(2, t[k] + near - 1));
      }
    }
    for (let q = 0; q < tint.length; q += 2) { m[tint[q]] = TINT; t[tint[q]] = tint[q + 1]; }
    outline(p, mats);

    // glowing cores (the pulse climbs them) and a twinkle on the main prism's lit edge
    const cores = [];
    let jc0 = 1e9, jc1 = -1;
    for (let j = 0; j < p.h; j++) {
      for (let i = 0; i < w; i++) {
        if (m[j * w + i] !== CORE) continue;
        cores.push(i, j);
        if (j < jc0) jc0 = j;
        if (j > jc1) jc1 = j;
      }
    }
    const m0 = list[0], d0 = norm3(m0.dir[0], m0.dir[1], m0.dir[2]), ts = m0.len * 0.7;
    const sj = Math.floor(cy + (m0.P[1] + d0[1] * ts) * SQ - (m0.P[2] + d0[2] * ts));
    let si = Math.floor(cx + m0.P[0] + d0[0] * ts);
    while (p.mat(si - 1, sj) === CRY || p.mat(si - 1, sj) === CORE) si--;
    si -= 1;
    const phase = seed & 3;
    const frames = [];
    for (let f = 0; f < 4; f++) {
      const q = p.clone();
      const ff = (f + phase) & 3;
      const span = Math.max(1, jc1 - jc0);
      for (let c = 0; c < cores.length; c += 2) {
        const i = cores[c], j = cores[c + 1];
        const ph = frac((jc1 - j) / span * 0.9 - ff / 4);
        const boost = ph < 0.13 ? 2 : ph < 0.3 ? 1 : 0;
        if (boost) q.setTone(i, j, Math.min(3, q.tone(i, j) + boost));
      }
      const s = [0, 1, 2, 1][ff];
      if (s) {
        q.set(si, sj, GL, 0);
        for (let a = 1; a <= s; a++) {
          const tt = a === 2 ? 1 : 0;
          q.set(si + a, sj, GL, tt); q.set(si - a, sj, GL, tt); q.set(si, sj + a, GL, tt); q.set(si, sj - a, GL, tt);
        }
      }
      frames.push(q);
    }

    // ── floor decal: coloured light spill, dark contact shadow, loose shards ──
    const DG = area(R * 1.7 + 8, R * 0.9 + 8, R * 0.95 + 8);
    const d = new Dec(DG.W, DG.H);
    for (let g = 4; g >= 1; g--) dEllipse(d, DG.cx, DG.cy + 0.5, R * 1.02 + g * 2.4, R * SQ + 1 + g * 1.3, hue.glow, 0.05 + (4 - g) * 0.03);
    dShadow(d, DG.cx + R * 0.12, DG.cy + R * 0.08, R * 0.95, R * SQ + 0.8, 0.42, [6, 4, 12]);
    const chips = [rgb(hue.cry[4]), rgb(hue.cry[3]), rgb(hue.cry[1]), rgb(hue.ol)];
    const nI = R < 13 ? 2 : rn.int(2, 4);
    for (let c = 0; c < nI; c++) {
      const an = rn.range(0.1, 0.9) * Math.PI;
      const s = rn.int(1, 2);
      dPebble(d, Math.round(DG.cx + Math.cos(an) * R * rn.range(1.0, 1.25)), Math.round(DG.cy + Math.sin(an) * R * 0.62), s, s + 1, chips, rn);
    }
    for (let c = 0; c < (R < 13 ? 3 : 5); c++) {
      const an = rn.range(0, TAU), rr = rn.range(1.1, 1.45);
      d.over(Math.floor(DG.cx + Math.cos(an) * R * rr), Math.floor(DG.cy + Math.sin(an) * R * SQ * rr), rgb(hue.core[2]), 0.8);
    }
    return finish(frames, mats, G, d, DG, 5);
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  CLOCKWORK FACTORY — riveted steam engine: boiler, chimney, pipe, gauge, gear
  // ═══════════════════════════════════════════════════════════════════════════
  factory(R, seed, kit) {
    const { TAU, SQ, clamp, len2, lit, hash3, hrand, stream, C, pal, rgb, Pix, Dec, area, renderHF, slab,
      outline, depthEdges, finish, dEllipse, dShadow, dPebble, cylTone, octFace } = kit;
    const rn = stream(seed, 202);
    const IRON = 1, BRASS = 2, COP = 3, GAU = 4, STEAM = 5, FIRE = 6;
    const mats = [null,
      { pal: pal('#16181e', '#23262e', '#343842', '#4a505c', '#667080', '#8c96a6'), ol: C('#0a0b0e'), pr: 2 },
      { pal: pal('#3e2a0c', '#6c4a16', '#9c7024', '#c89a38', '#ecc660', '#fff0a8'), ol: C('#1c1204'), pr: 3 },
      { pal: pal('#3a180c', '#662c16', '#984624', '#c46a3a', '#e89a64', '#ffc89a'), ol: C('#1a0a04'), pr: 4 },
      { pal: pal('#201a16', '#c02818', '#b8b09a', '#efe8d4', '#ffffff'), ol: C('#1c1204'), pr: 5 },
      { pal: pal('#8e96a2', '#b4bcc6', '#d8dee6', '#f6f8fa'), ol: null, pr: 0 },
      { pal: pal('#5a1404', '#b8360a', '#f07818', '#ffc040', '#fff2a0'), ol: C('#0a0b0e'), pr: 1 },
    ];
    const side = rn.sign();                                            // chimney / pipe side
    const kz = Math.min(1, 100 / (R * (0.13 + 1.1 + 0.95 + 0.21 + 0.6 + 0.8 + SQ)));   // big props: squash to ~100 px
    const h0 = Math.max(2, Math.round(R * 0.13));                      // base plate
    const ab = Math.max(4, Math.round(R * 0.64)), hb = Math.max(6, Math.round(R * 1.1 * kz));
    const zB = h0 + hb;                                                // top of the machine block
    const rb = Math.max(3, R * 0.42), byo = -R * 0.12, hbo = Math.max(5, Math.round(R * 0.95 * kz));
    const zBo = zB + hbo, hd = Math.max(2, rb * 0.5);                  // boiler + brass dome
    const rch = Math.max(1.5, R * 0.11), chx = side * rb * 0.5, chy = byo - rb * 0.3;
    const zCh = zBo + hd * kz + Math.max(5, R * 0.6 * kz);                      // chimney mouth
    const puffH = Math.max(6, R * 0.8 * kz);
    const G = area(R + 3, zCh + puffH + R * 0.25 + 6, R * SQ + 3);
    const p = new Pix(G.W, G.H);
    const { cx, cy, AX } = G;
    const gsd = hash3(seed, 202, 3);
    const faceTone = [4, 4, 3, 2, 1];

    // octagonal base plate
    slab(p, cx, cy, 2, R, 0, h0, (kind, m, x, y, z, nx, ny, nz, i, j, ft, fb) => {
      if (kind === 0) {
        const ax = Math.abs(x), ay = Math.abs(y), o = Math.max(ax, ay, (ax + ay) / Math.SQRT2);
        if (o > R - 1.2) return (IRON << 8) | 4;
        return (IRON << 8) | (hrand(gsd, i, j) < 0.04 ? 2 : 3);
      }
      let t = faceTone[octFace(x, y) + 2] - 1;
      if (ft === 1) t = 4; else if (fb === 0) t = Math.max(0, t - 1);
      return (IRON << 8) | t;
    }, IRON);
    // riveted machine block with a brass top trim
    const seam = Math.round(rn.range(-0.2, 0.2) * ab);
    slab(p, cx, cy, 1, ab, h0, zB, (kind, m, x, y, z, nx, ny, nz, i, j, ft, fb) => {
      const xi = i - AX;
      if (kind === 0) {
        const e = Math.max(Math.abs(x), Math.abs(y));
        return e > ab - 1.1 ? (BRASS << 8) | 4 : (IRON << 8) | (hrand(gsd, i, j) < 0.05 ? 2 : 3);
      }
      if (ft === 1) return (BRASS << 8) | 5;
      if (ft === 2) return (BRASS << 8) | 2;
      if (fb === 0) return (IRON << 8) | 1;
      let t = xi <= -ab ? 4 : xi >= ab ? 2 : 3;
      if ((ft === 4 || fb === 2) && Math.abs(xi) < ab && (xi + ab + 1) % 3 === 0) t = 5;
      else if ((ft === 5 || fb === 1) && Math.abs(xi) < ab && (xi + ab + 1) % 3 === 0) t = 1;
      else if (xi === seam && ft > 4 && fb > 2) t = 2;
      return (IRON << 8) | t;
    }, IRON);
    // boiler drum with brass bands and a brass dome
    const bands = [Math.round(hbo * 0.22), hbo - 2];
    renderHF(p, cx, cy, { x0: -rb - 1.5, x1: rb + 1.5, y0: byo - rb - 1.5, y1: byo + rb + 1.5, z0: zB, mat: IRON }, (x, y) => {
      const q = (x * x + (y - byo) * (y - byo)) / (rb * rb);
      return q <= 1 ? zBo + hd * Math.sqrt(1 - q) : -1;
    }, (kind, m, x, y, z, nx, ny, nz, i) => {
      if (z > zBo + 0.3) {
        if (kind === 0) { const I = lit(nx, ny, nz); return (BRASS << 8) | (I > 0.8 ? 5 : I > 0.62 ? 4 : I > 0.4 ? 3 : I > 0.15 ? 2 : 1); }
        return (BRASS << 8) | Math.max(1, cylTone(x / rb) - 1);
      }
      let t = cylTone(x / rb);
      const zz = z - zB;
      for (const bz of bands) if (zz >= bz && zz < bz + 1.6) return (BRASS << 8) | t;
      for (const bz of bands) if (zz >= bz + 2 && zz < bz + 3 && (i + 1000) % 3 === 0) t = Math.min(5, t + 1);
      if (zz < 1) t = Math.max(1, t - 1);
      return (IRON << 8) | t;
    });
    // chimney with a brass lip
    renderHF(p, cx, cy, { x0: chx - rch - 1.5, x1: chx + rch + 1.5, y0: chy - rch - 1.5, y1: chy + rch + 1.5, z0: zBo, mat: IRON },
      (x, y) => ((x - chx) * (x - chx) + (y - chy) * (y - chy) <= rch * rch + 0.5 * rch ? zCh : -1), (kind, m, x, y, z) => {
        if (kind === 0) return len2(x - chx, y - chy) < rch - 0.9 ? (IRON << 8) | 0 : (BRASS << 8) | 4;
        const t = cylTone((x - chx) / rch);
        return ((z > zCh - 2 ? BRASS : IRON) << 8) | t;
      });
    // copper pipe: out of the boiler, over the block edge, down to the base plate
    const rp = Math.max(1.2, R * 0.085);
    const py = byo + rb * 0.55, pz = zB + hbo * 0.6, xo = -side * (ab + rp + 0.3);
    const path = [[-side * rb * 0.6, py, pz], [xo, py, pz], [xo, py, h0 + rp * 0.6]];
    const pipeSh = (mat) => (nx, ny, nz) => {
      const I = lit(nx, ny, nz);
      return (mat << 8) | (I > 0.78 ? 5 : I > 0.55 ? 4 : I > 0.28 ? 3 : I > 0 ? 2 : 1);
    };
    for (let s = 0; s < path.length - 1; s++) {
      const A = path[s], B = path[s + 1], L = Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]), n = Math.ceil(L / 0.4);
      for (let k = 0; k <= n; k++) {
        const f = k / n;
        sphere(p, cx, cy, SQ, A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f, A[2] + (B[2] - A[2]) * f, rp, pipeSh(COP), 0);
      }
    }
    for (const P of [path[1], path[2]]) sphere(p, cx, cy, SQ, P[0], P[1], P[2], rp * 1.5, pipeSh(BRASS), 0);
    depthEdges(p, 3);
    outline(p, mats);

    // ── animated parts, painted over each frame ──
    const F = 8, NT = 8, NS = 4;                    // 8 teeth, 4 spokes: 1/4 tooth per frame loops in 8 frames
    const Rg = clamp(R * 0.44, 3.5, 13);
    const gX = ab - Rg * 0.5, gZ = h0 + hb * 0.56;
    const gsx = cx + gX, gsy = cy + (ab + 0.5) * SQ - gZ;
    const turn = rn.sign();
    const gear = (rot) => {
      const out = [];
      const Rr = Rg - Math.max(1.3, Rg * 0.25), Rw = Rr - Math.max(1, Rg * 0.14), Rh = Math.max(1.1, Rg * 0.27);
      const pitch = TAU / NT, holes = Rg >= 5;
      for (let j = Math.floor(gsy - Rg - 1); j <= Math.ceil(gsy + Rg + 1); j++) {
        for (let i = Math.floor(gsx - Rg - 1); i <= Math.ceil(gsx + Rg + 1); i++) {
          const dx = i + 0.5 - gsx, dy = gsy - (j + 0.5), r = Math.hypot(dx, dy);
          if (r > Rg) continue;
          const th = Math.atan2(dy, dx);
          if (r > Rr) {
            const ph = frac((th - rot) / pitch);
            if (Math.abs(ph - 0.5) > 0.27 - (0.1 * (r - Rr)) / (Rg - Rr)) continue;
          }
          const L = (dx * -0.65 + dy * 0.76) / (r || 1);
          let t;
          if (r > Rw) t = L > 0.45 ? 5 : L > 0 ? 4 : L > -0.5 ? 3 : 2;
          else if (r > Rh) {
            const sp = TAU / NS, a = frac((th - rot) / sp + 0.5) - 0.5;
            const perp = Math.abs(Math.sin(a * sp)) * r;
            t = perp < 0.9 ? (L > 0 ? 4 : 3) : holes && r > Rh + 0.7 && r < Rw - 0.5 ? 0 : 2;
          } else t = r < 0.8 ? 1 : L > 0.3 ? 5 : 4;
          out.push([i, j, BRASS, t]);
        }
      }
      return out;
    };
    // pressure gauge on the boiler front
    const gauX = -side * rb * 0.3, gauY = byo + Math.sqrt(Math.max(0, rb * rb - gauX * gauX)), gauZ = zB + hbo * 0.58;
    const gcx = cx + gauX, gcy = cy + gauY * SQ - gauZ, rg = Math.max(1.8, R * 0.15);
    const gauge = (ang) => {
      const out = [];
      const ex = Math.cos(ang), ey = -Math.sin(ang), nl = rg - 0.9;
      for (let j = Math.floor(gcy - rg - 1); j <= Math.ceil(gcy + rg + 1); j++) {
        for (let i = Math.floor(gcx - rg - 1); i <= Math.ceil(gcx + rg + 1); i++) {
          const dx = i + 0.5 - gcx, dy = j + 0.5 - gcy, r = Math.hypot(dx, dy);
          if (r > rg) continue;
          if (r > rg - 0.95) { out.push([i, j, BRASS, dx - dy < 0 ? 5 : 3]); continue; }
          const al = dx * ex + dy * ey, pe = Math.abs(dx * ey - dy * ex);
          if (r < 0.6) out.push([i, j, GAU, 0]);
          else if (al > 0 && al < nl && pe < 0.6) out.push([i, j, GAU, 1]);
          else out.push([i, j, GAU, dx + dy > rg * 0.5 ? 2 : 3]);
        }
      }
      return out;
    };
    const needle = [0, 0.25, 0.1, 0.4, 0.2, 0.3, 0.05, 0.35];
    // firebox window with glowing coals, bottom of the block front
    const fbw = Math.max(3, Math.round(ab * 0.7)), fbh = Math.max(3, Math.round(hb * 0.3));
    const fx0 = side > 0 ? AX - ab + 2 : AX + ab - 1 - fbw, fz0 = h0 + 2;
    const fj1 = Math.floor(cy + ab * SQ - fz0), fj0 = fj1 - fbh + 1;
    const frames = [];
    const wind = rn.sign();
    const stx = cx + chx, sty = cy + chy * SQ - zCh - 0.5;
    for (let f = 0; f < F; f++) {
      const q = p.clone();
      // firebox
      for (let j = fj0 - 1; j <= fj1 + 1; j++) {
        for (let i = fx0 - 1; i <= fx0 + fbw; i++) {
          if (q.mat(i, j) !== IRON && q.mat(i, j) !== BRASS) continue;
          const edge = j === fj0 - 1 || j === fj1 + 1 || i === fx0 - 1 || i === fx0 + fbw;
          if (edge) { q.set(i, j, IRON, j === fj0 - 1 ? 4 : 0); continue; }
          if ((i - fx0) % 2 === 1) { q.set(i, j, IRON, 1); continue; }
          const heat = (j - fj0) / Math.max(1, fbh - 1) + (hrand(gsd, i * 7 + f, j) - 0.5) * 0.7;
          q.set(i, j, FIRE, heat > 0.75 ? 4 : heat > 0.4 ? 3 : heat > 0.1 ? 2 : 1);
        }
      }
      stamp(q, gauge(2.3 + needle[f] * side), true);
      stamp(q, gear(turn * (f * TAU) / (NT * 4)), true);
      // steam: two puffs rising from the chimney, drifting with the wind
      const puffs = [];
      for (let k = 0; k < 2; k++) {
        const ph = frac(f / F + k / 2);
        const rr = (1.2 + ph * Math.max(1.8, R * 0.22)) * (ph > 0.78 ? Math.max(0, (1 - ph) / 0.22) : 1);
        if (rr < 0.8) continue;
        const bx = stx + wind * ph * R * 0.3, by = sty - rr * 0.7 - ph * puffH;
        for (const [ox, oy, sc] of [[0, 0, 1], [-0.55, -0.35, 0.7], [0.6, -0.25, 0.65]]) {
          const r = rr * sc, px = bx + ox * rr, pyy = by + oy * rr;
          for (let j = Math.floor(pyy - r); j <= Math.ceil(pyy + r); j++) {
            for (let i = Math.floor(px - r); i <= Math.ceil(px + r); i++) {
              const dx = (i + 0.5 - px) / r, dy = (j + 0.5 - pyy) / r, qd = dx * dx + dy * dy;
              if (qd > 1) continue;
              const L = -dx * 0.65 - dy * 0.76;
              puffs.push([i, j, STEAM, qd > 0.7 && L < -0.2 ? 0 : L > 0.35 ? 3 : L > -0.3 ? 2 : 1]);
            }
          }
        }
      }
      // keep the brightest tone when puff blobs overlap
      const best = new Map();
      for (const e of puffs) { const kk = e[1] * 4096 + e[0], o = best.get(kk); if (!o || e[3] > o[3]) best.set(kk, e); }
      stamp(q, [...best.values()], false);
      frames.push(q);
    }

    // ── floor decal: oily shadow, an oil puddle with a sheen, loose bolts ──
    const DG = area(R * 1.5 + 6, R * 0.9 + 6, R * 0.95 + 8);
    const d = new Dec(DG.W, DG.H);
    dShadow(d, DG.cx + R * 0.14, DG.cy + R * 0.08, R * 1.1, R * SQ + 1.4, 0.46, [8, 8, 14]);
    const ox = DG.cx - side * R * rn.range(0.75, 0.95), oy = DG.cy + R * rn.range(0.25, 0.4);
    const orx = Math.max(2.2, R * rn.range(0.24, 0.32)), ory = Math.max(1.2, orx * 0.45);
    dEllipse(d, ox, oy, orx, ory, [12, 12, 18], 0.8);
    d.over(Math.floor(ox - orx * 0.35), Math.floor(oy - ory * 0.2), [90, 60, 130], 0.8);
    d.over(Math.floor(ox - orx * 0.35) + 1, Math.floor(oy - ory * 0.2), [50, 110, 120], 0.8);
    d.over(Math.floor(ox + orx * 0.25), Math.floor(oy + ory * 0.1), [90, 90, 110], 0.5);
    const bolt = [rgb('#8c96a6'), rgb('#4a505c'), rgb('#23262e'), rgb('#0a0b0e')];
    const nB = R < 13 ? 2 : rn.int(2, 4);
    for (let c = 0; c < nB; c++) {
      const an = rn.range(0.1, 0.9) * Math.PI;
      dPebble(d, Math.round(DG.cx + Math.cos(an) * R * rn.range(1.08, 1.3)), Math.round(DG.cy + Math.sin(an) * R * 0.62), 2, 1, bolt, rn);
    }
    return finish(frames, mats, G, d, DG, 8);
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  SKY TEMPLE — white ionic marble column, gold necking, a cloud wisp at its foot
  // ═══════════════════════════════════════════════════════════════════════════
  sky(R, seed, kit) {
    const { TAU, SQ, lit, hash3, hrand, stream, ringNoise, len2, pal, Dec, area, finish, dShadow, dPebble, rgb } = kit;
    const rn = stream(seed, 303);
    const CL = 5;
    const col = marbleColumn(kit, R, seed, {
      salt: 303, marble: ['#3e4c70', '#62749e', '#8fa3c8', '#bdcce6', '#e4ecf8', '#ffffff'], ol: '#1c2440', gol: '#3a2606',
      thick: 0.58, steps: 1, abacus: 0.1, vis: Math.min(100, Math.round(2.3 * (2 * R + 2))), padX: 3, up: 0,
      band: true, ionic: true, mats: [{ pal: pal('#9fb0cf', '#c6d3ea', '#e6eef9', '#ffffff'), ol: null, pr: 0 }],
    });
    const { p, mats, G, cx, cy, rt, h1 } = col;
    // cloud wisp spiralling around the base; puffs drift along it (seamless loop)
    const F = 4, nP = R < 11 ? 10 : 12;
    const sweep = rn.range(1.4, 1.65) * Math.PI * rn.sign(), th0 = Math.PI / 2 + rn.range(-0.15, 0.15) - sweep / 2;
    const pr0 = Math.max(2.4, R * 0.3);
    const frames = [];
    const cloudSh = (nx, ny, nz, z, i, j, q) => {
      const I = lit(nx, ny, nz);
      return (CL << 8) | (I > 0.55 ? 3 : I > 0.2 ? 2 : I > -0.15 ? 1 : 0);
    };
    for (let f = 0; f < F; f++) {
      const q = p.clone();
      q.d = p.d.slice();
      for (let k = -1; k <= nP; k++) {
        for (const layer of [0, 1]) {
          const a = (k + f / F + layer * 0.5) / nP;
          if (a < 0 || a > 1) continue;
          const env = Math.pow(Math.sin(Math.PI * a), 0.7);
          const r = pr0 * env * (layer ? 0.62 : 1);
          if (r < 0.9) continue;
          const th = th0 + sweep * a, rad = R * (0.9 - 0.3 * a) + (layer ? -0.5 : 0);
          const z = h1 * 0.4 + a * R * 0.75 + (layer ? r * 1.0 : 0);
          sphere(q, cx, cy, SQ, Math.cos(th) * rad, Math.sin(th) * rad, z, r, cloudSh, 0);
        }
      }
      frames.push(q);
    }
    // ── floor decal: a pale blue shadow and a thin, ragged cloud mist ──
    const DG = area(R * 1.7 + 6, R * 0.9 + 6, R + 8);
    const d = new Dec(DG.W, DG.H);
    dShadow(d, DG.cx + R * 0.16, DG.cy + R * 0.1, R * 1.05, R * SQ + 1, 0.3, [30, 44, 96]);
    const mN = ringNoise(hash3(seed, 31, 4), 9);
    const rx = R * 1.35, ry = R * 0.62;
    for (let j = 0; j < DG.H; j++) {
      for (let i = 0; i < DG.W; i++) {
        const dx = (i + 0.5 - DG.cx) / rx, dy = (j + 0.5 - DG.cy - R * 0.08) / ry;
        const qd = len2(dx, dy) / (1 + 0.22 * mN(Math.atan2(dy, dx)));
        if (qd > 1) continue;
        if (qd < 0.62) continue;
        d.over(i, j, [240, 246, 255], qd > 0.9 ? 0.18 : 0.32);
      }
    }
    const chips = [rgb('#ffffff'), rgb('#e4ecf8'), rgb('#8fa3c8'), rgb('#1c2440')];
    if (R >= 11 && rn() < 0.7) {
      const an = rn.range(0.15, 0.85) * Math.PI;
      dPebble(d, Math.round(DG.cx + Math.cos(an) * R * 1.12), Math.round(DG.cy + Math.sin(an) * R * 0.62), 2, 1, chips, rn);
    }
    return finish(frames, mats, G, d, DG, 3);
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  MOUNT OLYMPUS — white-and-gold column crowned by a brazier with a sacred flame
  // ═══════════════════════════════════════════════════════════════════════════
  olympus(R, seed, kit) {
    const { TAU, SQ, clamp, len2, hash3, hrand, stream, vnoise, pal, C, rgb, Dec, area, slab, finish, dEllipse, dShadow, dPebble, cylTone } = kit;
    const rn = stream(seed, 404);
    const GO = 4, FL = 5;
    const hFl = clamp(Math.round(R * 1.05), 8, 20), hBw = Math.max(3, Math.round(R * 0.26)), hSt = Math.max(2, Math.round(R * 0.16));
    const visC = Math.min(100 - hFl - hBw - hSt, Math.round(2.5 * (2 * R + 2)));
    let rbw = 3, zBowl = 0;
    const col = marbleColumn(kit, R, seed, {
      salt: 404, marble: ['#5e5c5a', '#908c86', '#bebab2', '#e2e0da', '#f6f5f1', '#ffffff'], ol: '#2a2418', gol: '#2e1c04',
      thick: 0.66, steps: 2, abacus: 0.16, vis: visC, padX: 1, up: hFl + hBw + hSt + 4,
      goldTrim: true, goldBase: true, goldCap: true, goldFlutes: true, goldBand0: false, marbleAbacus: true,
      mats: [{ pal: pal('#c04a08', '#f08c1c', '#ffc840', '#fff0a0', '#ffffff'), ol: C('#4a1404'), pr: 0 }],
      extra: (p, c) => {
        // brazier: a short stem and a flared golden bowl full of embers
        const rst = Math.max(1.2, c.rs * 0.3);
        slab(p, c.cx, c.cy, 0, rst, c.zTop, c.zTop + hSt, (kind, m, x) => (GO << 8) | (kind === 0 ? 4 : Math.max(1, cylTone(x / rst) - 1)), GO);
        rbw = Math.max(3, c.rs * 0.92);
        for (let s = 0; s < hBw; s++) {
          const f = (s + 1) / hBw, r = rst + (rbw - rst) * Math.sin((f * Math.PI) / 2);
          const top = s === hBw - 1;
          slab(p, c.cx, c.cy, 0, r, c.zTop + hSt + s, c.zTop + hSt + s + 1, (kind, m, x, y, z, nx, ny, nz, i, j) => {
            if (kind === 0) return top && len2(x, y) < r - 1.1 ? (FL << 8) | (hrand(seed, i, j) < 0.35 ? 2 : 1) : (GO << 8) | 5;
            let t = cylTone(x / r);
            if (top) t = Math.min(5, t + 1); else if (s === 0) t = Math.max(1, t - 1);
            return (GO << 8) | t;
          }, GO);
        }
        zBowl = c.zTop + hSt + hBw;
      },
    });
    const { p, mats, G, cx, cy } = col;
    // sacred flame: a white-gold teardrop whose edges flicker (loops over 4 frames)
    const FW = Math.max(2.2, rbw * 0.8), FH = hFl;
    const jb = Math.floor(cy - zBowl);
    const nsd = hash3(seed, 404, 9);
    const frames = [];
    for (let f = 0; f < 4; f++) {
      const q = p.clone();
      const ang = (TAU * ((f + seed) & 3)) / 4, ca = Math.cos(ang), sa = Math.sin(ang);
      for (let row = -1; row <= FH; row++) {
        const t = clamp(row / FH, 0, 1);
        const w1 = vnoise(nsd, 3 + ca * 1.1 + t * 2.2, 5 + sa * 1.1) - 0.5;
        const w2 = vnoise(nsd + 7, 9 + ca * 0.8 - t * 1.6, 2 + sa * 0.8) - 0.5;
        const sh = w1 * FW * 1.2 * t;
        const hw = FW * (t < 0.25 ? 0.8 + 0.8 * t : 1) * Math.pow(1 - t, 0.85) * (1 + 0.45 * w2);
        if (hw < 0.4) continue;
        const j = jb - row;
        for (let i = Math.floor(cx + sh - hw - 1); i <= Math.ceil(cx + sh + hw + 1); i++) {
          const dx = (i + 0.5 - cx - sh) / hw;
          if (Math.abs(dx) > 1) continue;
          if (j >= jb && q.mat(i, j) !== FL) continue;
          const e = Math.abs(dx) * 0.75 + t * 0.62;
          let tn = e < 0.32 ? 4 : e < 0.52 ? 3 : e < 0.74 ? 2 : e < 0.92 ? 1 : 0;
          if (Math.abs(dx) > 1 - 1 / hw) tn = Math.min(tn, 1);
          q.set(i, j, FL, tn);
        }
      }
      for (let k = 0; k < 2; k++) {
        const ph = frac(f / 4 + k / 2);
        const i = Math.floor(cx + Math.sin(ph * TAU + k * 2) * FW * 0.7), j = Math.floor(jb - FH * (0.85 + ph * 0.45));
        if (!q.mat(i, j)) q.set(i, j, FL, ph < 0.5 ? 3 : 2);
      }
      frames.push(q);
    }
    // ── floor decal: golden light spill, shadow, marble chips ──
    const DG = area(R * 1.6 + 8, R * 0.9 + 8, R * 0.95 + 8);
    const d = new Dec(DG.W, DG.H);
    for (let g = 3; g >= 1; g--) dEllipse(d, DG.cx, DG.cy + 0.5, R + 1 + g * 2.2, R * SQ + 1 + g * 1.2, [255, 214, 110], 0.06 + (3 - g) * 0.03);
    dShadow(d, DG.cx + R * 0.16, DG.cy + R * 0.1, R * 1.08, R * SQ + 1, 0.3, [60, 40, 12]);
    const chips = [rgb('#ffffff'), rgb('#e6e0d2'), rgb('#9a907e'), rgb('#2c2216')];
    const nR = R < 13 ? 1 : rn.int(1, 2);
    for (let c = 0; c < nR; c++) {
      const an = rn.range(0.12, 0.88) * Math.PI;
      dPebble(d, Math.round(DG.cx + Math.cos(an) * R * 1.12), Math.round(DG.cy + Math.sin(an) * R * 0.62), 2, 1, chips, rn);
    }
    return finish(frames, mats, G, d, DG, 8);
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  THE ABYSS — an eldritch tentacle writhing out of a glowing rift
  // ═══════════════════════════════════════════════════════════════════════════
  abyss(R, seed, kit) {
    const { TAU, SQ, clamp, len2, lit, hash3, hrand, stream, ringNoise, C, pal, Pix, Dec, area, renderHF,
      outline, depthEdges, finish, dEllipse } = kit;
    const rn = stream(seed, 505);
    const SKIN = 1, BELLY = 2, SUCK = 3, EYE = 4, SHARD = 5;
    const OLc = C('#040207');
    const mats = [null,
      { pal: pal('#0d0616', '#190b28', '#28123e', '#3a1a56', '#522672', '#6e3892'), ol: OLc, pr: 3 },
      { pal: pal('#2e1444', '#4a2266', '#6e3a8e', '#9660b6', '#bf8ede'), ol: OLc, pr: 3 },
      { pal: pal('#4a0834', '#9a1470', '#e0309e', '#ff84d0', '#ffe0f4'), ol: OLc, pr: 3 },
      { pal: pal('#0a0204', '#8a2a10', '#d8a020', '#ffe860', '#fffbd0'), ol: OLc, pr: 4 },
      { pal: pal('#120c1a', '#1e1628', '#2c223a', '#3e3250', '#54466a'), ol: OLc, pr: 2 },
    ];
    const vis = Math.min(100, Math.round(rn.range(1.75, 2.05) * 2 * R));
    const r0 = Math.max(3, R * 0.4);
    const curl = rn.sign();
    const lean = rn.range(0.04, 0.16) * -curl;
    const G = area(R * 1.4 + 4, vis + 8, R * SQ + 4);
    const base = new Pix(G.W, G.H);
    const { cx, cy } = G;
    // broken floor slabs heaved up around the rift
    const shards = [];
    for (const sx of [-1, 1]) {
      if (R < 10 && sx > 0) continue;
      const an = (sx < 0 ? rn.range(150, 175) : rn.range(5, 30)) * Math.PI / 180, dd = R * rn.range(0.62, 0.78);
      shards.push(boulder(rn, TAU, Math.cos(an) * dd, Math.sin(an) * dd, R * rn.range(0.2, 0.27), R * rn.range(0.16, 0.26), rn.int(4, 6)));
    }
    renderHF(base, cx, cy, { x0: -R - 2, x1: R + 2, y0: -R - 2, y1: R + 2, mat: SHARD }, (x, y) => {
      let v = -1;
      for (const f of shards) { const q = f(x, y); if (q > v) v = q; }
      return v > 0.4 ? v : -1;
    }, (kind, m, x, y, z, nx, ny, nz) => {
      const I = lit(nx, ny, nz);
      return (SHARD << 8) | (I > 0.66 ? 3 : I > 0.4 ? 2 : I > 0.12 ? 1 : 0);
    });
    // centreline: rises from the rift, bends, curls at the tip; ph sways the upper half
    const spine = (ph, L, x0) => {
      const pts = [];
      const n = Math.ceil(L / 0.45);
      let x = x0, z = -r0 * 0.7;
      for (let k = 0; k <= n; k++) {
        const s = k / n;
        const th = Math.PI / 2 + lean - curl * (0.14 * Math.PI * s + 1.8 * Math.PI * Math.pow(s, 6)) + 0.3 * s * s * Math.sin(TAU * ph + s * 2.2);
        const r = r0 * Math.pow(1 - s, 0.72) + 0.55;
        pts.push([x, R * 0.2 * Math.sin(s * Math.PI * 0.9), z, r, th, s]);
        x += Math.cos(th) * (L / n); z += Math.sin(th) * (L / n);
      }
      return pts;
    };
    // fit the length to the target height and centre the curl over the rift
    let L = vis * 1.1;
    const zTarget = vis - R * SQ * 0.3;
    for (let it = 0; it < 2; it++) {
      let zm = 0;
      for (const P of spine(0, L, 0)) zm = Math.max(zm, P[2] + P[3] * 0.8);
      L *= zTarget / Math.max(1, zm);
    }
    let xa = 1e9, xb = -1e9;
    for (const P of spine(0, L, 0)) { xa = Math.min(xa, P[0] - P[3]); xb = Math.max(xb, P[0] + P[3]); }
    const x0 = clamp(-(xa + xb) / 2, -R * 0.35, R * 0.35);
    // suckers along the inner (concave) side, turned a little toward the viewer
    const sucks = (pts) => {
      const out = [];
      let s = 0.13;
      const n = pts.length - 1;
      while (s < 0.92) {
        const P = pts[Math.round(s * n)];
        const [px, py, pz, r, th] = P;
        let vx = curl * Math.sin(th) * 0.8, vy = 0.62, vz = -curl * Math.cos(th) * 0.8 + 0.25;
        const vl = Math.hypot(vx, vy, vz);
        vx /= vl; vy /= vl; vz /= vl;
        out.push([px + r * vx, py + r * vy, pz + r * vz, Math.max(0.85, r * 0.4), s]);
        s += (r * 2.3) / L + 0.02;
      }
      return out;
    };
    const phase = hrand(seed, 5, 5);
    const frames = [];
    for (let f = 0; f < 4; f++) {
      const q = dup(base);
      const pts = spine(frac(f / 4 + phase), L, x0);
      const sk = sucks(pts);
      let cur = null;
      const shade = (nx, ny, nz, z) => {
        const [px, py, pz, r, th, s] = cur;
        const ncx = curl * Math.sin(th), ncz = -curl * Math.cos(th);
        const under = nx * ncx + nz * ncz;
        const I = lit(nx, ny, nz);
        if (under > 0.05) {
          const sx = px + r * nx, sy = py + r * ny, sz = pz + r * nz;
          for (const S of sk) {
            if (Math.abs(S[4] - s) > 0.08) continue;
            const dd = (sx - S[0]) ** 2 + (sy - S[1]) ** 2 + (sz - S[2]) ** 2;
            if (dd < S[3] * S[3]) return (SUCK << 8) | (dd < S[3] * S[3] * 0.3 ? 3 : 2);
          }
        }
        if (z < r0 * 0.45) return (SKIN << 8) | 0;
        if (under > 0.35) return (BELLY << 8) | (I > 0.5 ? 4 : I > 0.25 ? 3 : I > 0 ? 2 : 1);
        return (SKIN << 8) | (I > 0.62 ? 4 : I > 0.38 ? 3 : I > 0.12 ? 2 : I > -0.2 ? 1 : 0);
      };
      for (const P of pts) { cur = P; sphere(q, cx, cy, SQ, P[0], P[1], P[2], P[3], shade, 0); }
      depthEdges(q, 3);
      // violet rim light so the dark skin separates from the void
      const { w, m, t } = q;
      const rim = [];
      for (let j = 1; j < q.h - 1; j++) {
        for (let i = 1; i < w - 1; i++) {
          const k = j * w + i, mk = m[k];
          if (mk !== SKIN && mk !== BELLY) continue;
          const lf = m[k - 1], up = m[k - w], rt = m[k + 1];
          if (!lf || !up) rim.push(k, Math.min(mk === SKIN ? 5 : 4, t[k] + 2));
          else if (!rt) rim.push(k, Math.min(mk === SKIN ? 4 : 3, t[k] + 1));
        }
      }
      for (let c = 0; c < rim.length; c += 2) t[rim[c]] = rim[c + 1];
      outline(q, mats);
      // one eye near the base, on the outer side
      let E = pts[0];
      for (const P of pts) if (P[2] > r0 * 1.5) { E = P; break; }
      const ecx = cx + E[0] - curl * E[3] * 0.18, ecy = cy + E[1] * SQ - E[2];
      const ew = Math.max(3, E[3] * 0.95), eh = Math.max(1.8, E[3] * 0.52);
      const eye = [];
      for (let j = Math.floor(ecy - eh - 1); j <= Math.ceil(ecy + eh + 1); j++) {
        for (let i = Math.floor(ecx - ew - 1); i <= Math.ceil(ecx + ew + 1); i++) {
          const dx = (i + 0.5 - ecx) / ew, dy = (j + 0.5 - ecy) / eh;
          if (Math.abs(dx) + dy * dy > 1) continue;
          const px = i + 0.5 - ecx;
          let tn = dx < -0.2 && dy < 0 ? 4 : 3;
          if (Math.abs(px) < 0.6 && Math.abs(dy) < 0.75) tn = 0;
          else if (Math.abs(dx) > 0.72) tn = 2;
          else if (dy > 0.55) tn = 2;
          eye.push([i, j, EYE, tn]);
        }
      }
      stamp(q, eye, true);
      frames.push(q);
    }

    // ── floor decal: violet glow, a jagged rift with a lit far wall, glowing cracks ──
    const DG = area(R * 1.6 + 8, R * 0.9 + 8, R + 8);
    const d = new Dec(DG.W, DG.H);
    for (let g = 4; g >= 1; g--) dEllipse(d, DG.cx, DG.cy + 0.5, R * 0.95 + g * 2.4, R * 0.42 + g * 1.3, [150, 60, 255], 0.04 + (4 - g) * 0.025);
    const n1 = ringNoise(hash3(seed, 51, 3), 11), n2 = ringNoise(hash3(seed, 52, 3), 23);
    const rx = R * 0.78, ry = R * 0.3;
    const inR = (i, j) => {
      const dx = (i + 0.5 - DG.cx) / rx, dy = (j + 0.5 - DG.cy) / ry, a = Math.atan2(dy, dx);
      return len2(dx, dy) / (1 + 0.2 * n1(a) + 0.12 * n2(a) + 0.25 * Math.pow(Math.abs(Math.cos(a)), 6));
    };
    for (let j = 0; j < DG.H; j++) {
      for (let i = 0; i < DG.W; i++) {
        const qd = inR(i, j);
        if (qd > 1.25) continue;
        if (qd > 1) { d.over(i, j, [140, 50, 230], 0.35 * (1.25 - qd) / 0.25 + 0.1); continue; }
        const farWall = j + 0.5 < DG.cy && inR(i, j - 2) > 1;
        const nearLip = j + 0.5 >= DG.cy && inR(i, j + 1) > 1;
        d.over(i, j, farWall ? [200, 60, 190] : nearLip ? [90, 30, 150] : qd > 0.75 ? [22, 6, 34] : [3, 1, 6], 1);
      }
    }
    const nK = R < 12 ? 3 : rn.int(4, 5);
    for (let c = 0; c < nK; c++) {
      const an = rn.range(0, TAU);
      let x = DG.cx + Math.cos(an) * rx * 1.0, y = DG.cy + Math.sin(an) * ry * 1.0;
      const len = rn.int(3, Math.max(4, Math.round(R * 0.45)));
      let dx = Math.cos(an), dy = Math.sin(an) * 0.5;
      for (let s = 0; s < len; s++) {
        d.over(Math.floor(x), Math.floor(y), s < len * 0.5 ? [200, 90, 255] : [120, 50, 200], 0.9);
        if (rn() < 0.4) { const tt = dx; dx = dx * 0.8 - dy * 0.6 * rn.sign(); dy = dy * 0.8 + tt * 0.3; }
        const l = Math.hypot(dx, dy) || 1;
        x += dx / l; y += (dy / l) * 0.6;
      }
    }
    return finish(frames, mats, G, d, DG, 5);
  },
};
