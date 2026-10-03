// ─────────────────────────────────────────────────────────────────────────────
//  Arena props (obstacle sprites) for the organic arenas: swamp, jungle, beach, candy.
//  Each builder is (R, seed, kit) → kit.finish(...); see art-obstacles.js for the toolkit.
//
//    swamp  — gnarled witchwood tree: arching roots in bog water, hooked bare branches,
//             droopy olive clumps, Spanish moss (sways) and twinkling wisps
//    jungle — carved stone idol head on a plinth: mossy headdress, hanging vines,
//             glowing eyes (pulse)
//    beach  — leaning, ring-banded palm with arching pinnate fronds (sway) and coconuts
//    candy  — giant swirl lollipop on a gumdrop cluster, with a twinkling sparkle
// ─────────────────────────────────────────────────────────────────────────────

const SQv = 0.45;                                     // same as the kit's SQ (plan depth → screen rows)
// screen-space light for tubes / balls: x right, y down, z toward the viewer (from the top-left)
const LS = (() => { const l = Math.hypot(0.6, 0.55, 0.58); return [-0.6 / l, -0.55 / l, 0.58 / l]; })();

// full copy of a pixel buffer, depth included (frames that are redrawn with depth tests)
function dup(p) {
  const q = Object.create(Object.getPrototypeOf(p));
  q.w = p.w; q.h = p.h; q.m = p.m.slice(); q.t = p.t.slice(); q.d = p.d.slice();
  return q;
}

// point / radius at fraction f along a polyline (by vertex index)
function along(pts, f) {
  const t = Math.max(0, Math.min(1, f)) * (pts.length - 1), k = Math.min(pts.length - 2, Math.floor(t)), g = t - k;
  const A = pts[k], B = pts[k + 1];
  return [A[0] + (B[0] - A[0]) * g, A[1] + (B[1] - A[1]) * g, A[2] + (B[2] - A[2]) * g];
}
function alongR(rads, f) {
  const t = Math.max(0, Math.min(1, f)) * (rads.length - 1), k = Math.min(rads.length - 2, Math.floor(t)), g = t - k;
  return rads[k] + (rads[k + 1] - rads[k]) * g;
}

// Tapered tube along a 3D polyline (plan coords: x right, y toward the viewer, z up),
// rasterised as depth-tested discs. tone(I, u, s, z) → tone index or -1 to skip, where
// I = screen-space lambert, u = position across the tube (−1 … 1), s = axial position in
// screen px from the start (follows the curvature of rings), z = the pixel's height.
function tube(p, cx, cy, pts, rads, mat, tone, floorClip = true) {
  let s0 = 0;
  for (let q = 0; q < pts.length - 1; q++) {
    const A = pts[q], B = pts[q + 1];
    const ax = cx + A[0], ay = cy + A[1] * SQv - A[2], bx = cx + B[0], by = cy + B[1] * SQv - B[2];
    const L = Math.hypot(bx - ax, by - ay);
    if (L < 1e-6) continue;
    const tx = (bx - ax) / L, ty = (by - ay) / L, px = -ty, py = tx;
    const lx = px * LS[0] + py * LS[1];
    const n = Math.max(1, Math.ceil(L / 0.5));
    for (let k = 0; k <= n; k++) {
      const f = k / n, sx = ax + (bx - ax) * f, sy = ay + (by - ay) * f;
      const r = Math.max(0.55, rads[q] + (rads[q + 1] - rads[q]) * f), rr = r * r;
      const yP = A[1] + (B[1] - A[1]) * f, zP = A[2] + (B[2] - A[2]) * f, d0 = yP + 0.45 * zP, ss = s0 + L * f;
      for (let j = Math.floor(sy - r); j <= Math.floor(sy + r); j++) {
        const oy = j + 0.5 - sy;
        for (let i = Math.floor(sx - r); i <= Math.floor(sx + r); i++) {
          const ox = i + 0.5 - sx;
          if (ox * ox + oy * oy > rr) continue;
          let u = (ox * px + oy * py) / r;
          u = u < -1 ? -1 : u > 1 ? 1 : u;
          const w = Math.sqrt(1 - u * u), z = zP - oy + w * r * SQv;
          if (floorClip && z < 0) continue;
          const t = tone(u * lx + w * LS[2], u, ss + ox * tx + oy * ty - w * r * SQv * ty, z);
          if (t >= 0) p.zput(i, j, mat, t, d0 + w * r);
        }
      }
    }
    s0 += L;
  }
}

// shaded ball (screen-space sphere) with depth; tone(I, ox, oy) with ox/oy in −1 … 1
function ball(p, cx, cy, P, r, mat, tone, dBias = 0) {
  const sx = cx + P[0], sy = cy + P[1] * SQv - P[2], d0 = P[1] + 0.45 * P[2] + dBias;
  for (let j = Math.floor(sy - r); j <= Math.floor(sy + r); j++) {
    for (let i = Math.floor(sx - r); i <= Math.floor(sx + r); i++) {
      const ox = (i + 0.5 - sx) / r, oy = (j + 0.5 - sy) / r, q = ox * ox + oy * oy;
      if (q > 1) continue;
      const w = Math.sqrt(1 - q);
      const t = tone(ox * LS[0] + oy * LS[1] + w * LS[2], ox, oy);
      if (t >= 0) p.zput(i, j, mat, t, d0 + w * r);
    }
  }
}

const tone6 = (I) => (I > 0.86 ? 5 : I > 0.62 ? 4 : I > 0.32 ? 3 : I > 0.02 ? 2 : I > -0.3 ? 1 : 0);

// ═════════════════════════════════════════════════════════════════════════════
//  SWAMP — a gnarled witchwood tree standing in bog water
// ═════════════════════════════════════════════════════════════════════════════
function buildSwamp(R, seed, kit) {
  const { TAU, SQ, clamp, len2, hash3, hrand, stream, ringNoise, vnoise, C, pal, rgb, Pix, Dec, area, outline, depthEdges, finish, dEllipse } = kit;
  const rn = stream(seed, 81);
  const BARK = 1, LEAF = 2, MOSS = 3, WISP = 4;
  const mats = [null,
    { pal: pal('#1b1519', '#2a2127', '#3b3037', '#4f4249', '#66575c', '#807073'), ol: C('#0b080a'), pr: 2 },
    { pal: pal('#151e0f', '#1e2a14', '#2a391b', '#3a4c24', '#4d622f', '#667a3c'), ol: C('#0a1007'), pr: 3 },
    { pal: pal('#5a6450', '#74806a', '#909c82', '#acb69a', '#c8d0b4'), ol: null, pr: 0 },
    { pal: pal('#3e5c16', '#94c630', '#dcff6e', '#fbffd6'), ol: null, pr: 0 },
  ];
  const vis = Math.min(100, Math.round(R * rn.range(4.3, 4.6) + 6));
  const rt = clamp(R * 0.25, 2.2, 8);
  const side = rn.sign();                                        // lean direction
  const zT = (vis - R * SQ) * rn.range(0.62, 0.68);              // where the trunk splits
  const G = area(R * 1.9 + 8, vis + 8, R * SQ + 4);
  const p = new Pix(G.W, G.H);
  const { cx, cy, AX, AY } = G;
  const bn = hash3(seed, 81, 5);
  const barkTone = (I, u, s, z) => {
    let t = tone6(I);
    if (t > 0 && hrand(bn, Math.floor(u * 2.6 + 9), Math.floor(s / 3.5)) > 0.7) t--;   // furrows
    if (z < 1.5) t = Math.max(0, t - 2);                                                 // wet at the water line
    return t;
  };
  // trunk: leaning, with a crooked kink and a flared foot
  const trunk = [], trR = [];
  const kink = rn.range(0.6, 1.1) * rn.sign(), kph = rn.range(0, TAU), lean = rn.range(0.16, 0.26);
  for (let k = 0; k <= 6; k++) {
    const f = k / 6, z = zT * f;
    trunk.push([side * lean * z + kink * R * 0.09 * Math.sin(f * 4.2 + kph) * Math.min(1, f * 3), -R * 0.05 * f, z]);
    trR.push(rt * (1 - 0.4 * f) * (1 + Math.max(0, 0.2 - f) * 3.2));
  }
  tube(p, cx, cy, trunk, trR, BARK, barkTone);
  // arching roots that dip into the water
  const feet = [];
  const nr = R < 13 ? 3 : 4, rot = rn.range(0, TAU);
  for (let k = 0; k < nr; k++) {
    const an = rot + (k / nr) * TAU + rn.range(-0.3, 0.3);
    const Rr = R * rn.range(0.7, 0.92), hr = rt * rn.range(1.3, 2.1);
    const pts = [], rads = [];
    for (let s = 0; s <= 6; s++) {
      const t = s / 6, dd = rt * 0.3 + (Rr - rt * 0.3) * t;
      pts.push([trunk[0][0] + Math.cos(an) * dd, trunk[0][1] + Math.sin(an) * dd, hr * (1 - t) * (1 + 0.9 * t) + 0.2]);
      rads.push(Math.max(0.65, rt * (0.52 - 0.32 * t)));
    }
    tube(p, cx, cy, pts, rads, BARK, barkTone);
    feet.push(pts[6]);
  }
  // bare crooked branches, hooking outward and down at the ends
  const nB = R < 12 ? 2 : rn.int(2, 3);
  const branches = [];
  for (let b = 0; b < nB; b++) {
    const lead = b === nB - 1;
    const fb = lead ? 1 : rn.range(0.6, 0.86);
    const S = along(trunk, fb);
    const sd = lead ? side : b % 2 === 0 ? -side : side;
    let a = sd * (lead ? rn.range(0.05, 0.3) : rn.range(0.5, 0.85));
    const len = R * (lead ? rn.range(0.95, 1.15) : rn.range(0.8, 1.05));
    const dy = rn.range(-0.4, 0.4);
    const pts = [S], rads = [];
    const r0 = alongR(trR, fb) * (lead ? 0.92 : 0.62);
    let P = S;
    for (let k = 1; k <= 4; k++) {
      a += sd * rn.range(0.1, 0.32) + rn.range(-0.3, 0.3);
      P = [P[0] + (Math.sin(a) * len) / 4, P[1] + (dy * len) / 4, P[2] + (Math.cos(a) * len) / 4];
      pts.push(P);
    }
    for (let k = 0; k <= 4; k++) rads.push(Math.max(0.6, r0 * (1 - (0.72 * k) / 4)));
    tube(p, cx, cy, pts, rads, BARK, barkTone, false);
    branches.push({ pts, rads, lead });
  }
  // sparse, flat, lumpy foliage clumps along the branches, each trailing a ragged curtain
  const clumps = [];
  for (const br of branches) {
    const T = br.pts[4];
    clumps.push({ P: [T[0], T[1], T[2] + 1], r: R * rn.range(0.42, 0.5) * (br.lead ? 1.12 : 1) });
    if (R >= 11 && rn() < 0.75) { const M = br.pts[2]; clumps.push({ P: [M[0], M[1] + 0.3, M[2] + 1.5], r: R * rn.range(0.28, 0.36) }); }
  }
  const lfN = hash3(seed, 81, 7);
  clumps.forEach((c, ck) => {
    const sx = cx + c.P[0], sy = cy + c.P[1] * SQ - c.P[2], rx = Math.max(3, c.r), ry = Math.max(1.8, c.r * 0.46);
    const d0 = c.P[1] + 0.45 * c.P[2] + 2;
    const eN = ringNoise(hash3(seed, 90 + ck, 3), 7);
    const lobes = [[0, 0, 1], [-rx * 0.55, ry * 0.35, 0.62], [rx * 0.55, ry * 0.3, 0.6], [rn.range(-0.3, 0.3) * rx, -ry * 0.55, 0.55]];
    const bot = new Map();
    for (let j = Math.floor(sy - ry * 1.6) - 1; j <= Math.ceil(sy + ry * 1.4) + 1; j++) {
      for (let i = Math.floor(sx - rx * 1.3) - 1; i <= Math.ceil(sx + rx * 1.3) + 1; i++) {
        let best = -1, bw = 0, bux = 0, buy = 0;
        for (const [lx, ly, ls] of lobes) {
          const ux = (i + 0.5 - sx - lx) / (rx * ls), uy = (j + 0.5 - sy - ly) / (ry * ls * 1.1), q = ux * ux + uy * uy;
          const lim = 1 - 0.26 * (0.5 + 0.5 * eN(Math.atan2(uy, ux) + ls * 3));
          if (q > lim) continue;
          const w = Math.sqrt(Math.max(0, 1 - q)) * ls;
          if (w > best) { best = w; bw = w; bux = ux; buy = uy; }
        }
        if (best < 0) continue;
        let I = (bux * LS[0] + buy * LS[1]) * 0.8 + bw * LS[2] - 0.25 * clamp((j + 0.5 - sy) / (ry * 1.4), -0.5, 1);
        I += (vnoise(lfN, i / 1.5, j / 1.2) - 0.5) * 0.55;
        p.zput(i, j, LEAF, I > 0.86 ? 5 : I > 0.62 ? 4 : I > 0.38 ? 3 : I > 0.14 ? 2 : I > -0.12 ? 1 : 0, d0 + bw * rx);
        if (!(bot.get(i) >= j)) bot.set(i, j);
      }
    }
    for (const [i, jb] of bot) {                                   // the drooping curtain
      const ux = (i + 0.5 - sx) / (rx * 1.3);
      if (hrand(lfN, i, ck + 50) < 0.22) continue;
      const L = Math.round(ry * (0.4 + 2.2 * vnoise(lfN, i / 1.7 + ck * 9, 3.3)) * (1 - ux * ux * 0.7)) - (i % 3 === 0 ? 1 : 0);
      for (let s = 1; s <= L; s++) p.zput(i, jb + s, LEAF, s >= L ? 0 : s > L * 0.55 ? 1 : 2, d0 + 0.5);
    }
  });
  depthEdges(p, 3);
  // Spanish moss strands hanging from the branches
  const moss = [];
  for (const br of branches) {
    for (let k = 1; k < 4; k++) {
      for (const g of [0, 0.33, 0.66]) {
        if (rn() < 0.4) continue;
        const A = br.pts[k], B = br.pts[k + 1];
        const P = [A[0] + (B[0] - A[0]) * g, A[1] + (B[1] - A[1]) * g, A[2] + (B[2] - A[2]) * g];
        const r = br.rads[k] + (br.rads[k + 1] - br.rads[k]) * g;
        moss.push({
          i: Math.floor(cx + P[0]), j: Math.floor(cy + P[1] * SQ - P[2] + r * 0.5),
          len: rn.int(4, Math.max(5, Math.round(R * 0.95))), d: P[1] + 0.45 * P[2] + r + 0.5, s: rn.int(0, 9999), wide: rn() < 0.45,
        });
      }
    }
  }
  const drawMoss = (q, sway) => {
    for (const m of moss) {
      let i = m.i;
      for (let s = 0; s < m.len; s++) {
        if (s > 0 && s % 3 === 0 && hrand(m.s, s, 1) < 0.45) i += hrand(m.s, s, 2) < 0.5 ? -1 : 1;
        const sw = s > m.len * 0.45 ? sway : 0;
        const t = s < 2 ? 3 : s >= m.len - 1 ? 0 : s >= m.len - 3 ? 1 : hrand(m.s, s, 3) < 0.3 ? 3 : 2;
        q.zput(i + sw, m.j + s, MOSS, t, m.d);
        if (m.wide && s < m.len * 0.4) q.zput(i + 1 + sw, m.j + s, MOSS, Math.max(0, t - 1), m.d);
      }
    }
  };
  // will-o'-wisps: one skims the water, the rest drift around the crown
  const wisps = [];
  const nW = R < 12 ? 3 : R < 20 ? 4 : 5;
  for (let k = 0; k < nW; k++) {
    const low = k === 0;
    wisps.push({
      i: AX + Math.round(rn.range(0.5, 1.25) * R * rn.sign()),
      j: AY - Math.round(low ? rn.range(3, 5) : rn.range(0.35, 0.95) * (vis - R * SQ)),
      ph: rn.int(0, 3),
    });
  }
  const frames = [];
  for (let f = 0; f < 4; f++) {
    const q = dup(p);
    drawMoss(q, f >= 2 ? side : 0);
    outline(q, mats);
    for (const w of wisps) {
      const lv = [0, 1, 2, 1][(f + w.ph) & 3], j = w.j - (((f + w.ph) >> 1) & 1);
      if (lv === 0) { q.set(w.i, j, WISP, 0); continue; }
      q.set(w.i, j, WISP, lv === 2 ? 3 : 2);
      if (lv === 2) { q.set(w.i + 1, j, WISP, 1); q.set(w.i - 1, j, WISP, 1); q.set(w.i, j + 1, WISP, 1); q.set(w.i, j - 1, WISP, 1); }
      else { q.set(w.i + 1, j, WISP, 0); q.set(w.i - 1, j, WISP, 0); }
    }
    frames.push(q);
  }

  // ── floor decal: bog water with a muddy bank, glints, ripples, lily pads, reeds ──
  const DG = area(R * 1.6 + 6, R * 0.9 + 6, R * 0.95 + 8);
  const d = new Dec(DG.W, DG.H);
  const wN = ringNoise(hash3(seed, 81, 9), 9);
  const rx = R * 1.3, ry = R * 0.62, oy0 = R * 0.06;
  const MUD = rgb('#3b3d26'), W0 = rgb('#101a17'), W1 = rgb('#15231e'), W2 = rgb('#1d3027'), HI = rgb('#56786a'), HI2 = rgb('#8ab09a');
  for (let j = 0; j < DG.H; j++) {
    for (let i = 0; i < DG.W; i++) {
      const dx = (i + 0.5 - DG.cx) / rx, dy = (j + 0.5 - DG.cy - oy0) / ry;
      if (dx * dx + dy * dy > 1.5) continue;
      const q = len2(dx, dy) / (1 + 0.16 * wN(Math.atan2(dy, dx)));
      if (q > 1.12) continue;
      if (q > 1) { if (hrand(seed, i, j) < 0.8) d.over(i, j, MUD, 0.85); continue; }
      d.over(i, j, q > 0.84 ? W2 : q > 0.5 ? W1 : W0, 0.95);
      if (q > 0.9 && dy < -0.2 && hrand(seed, i, j + 200) < 0.5) d.over(i, j, HI, 0.45);          // far bank reflection
      else if (q < 0.9 && q > 0.3 && (j & 1) && hrand(seed, i >> 2, j + 400) > 0.86 && hrand(seed, i, j + 800) > 0.25) d.over(i, j, HI, 0.6);   // glints
    }
  }
  for (const F of feet) {                                        // ripple rings around the root feet
    const fx = DG.cx + F[0], fy = DG.cy + F[1] * SQ;
    for (let a = 0; a < 16; a++) {
      const an = (a / 16) * TAU;
      if (Math.sin(an) < -0.3) continue;
      d.over(Math.floor(fx + Math.cos(an) * 2.6), Math.floor(fy + Math.sin(an) * 1.2 + 0.3), HI, 0.5);
    }
  }
  d.over(Math.floor(DG.cx + trunk[0][0] - rt - 1), Math.floor(DG.cy + 1), HI2, 0.6);
  const nPad = R < 12 ? 1 : 2;
  for (let k = 0; k < nPad; k++) {                               // lily pads
    const an = rn.range(0.15, 0.85) * Math.PI * (k ? -1 : 1) + (k ? Math.PI : 0);
    const px = DG.cx + Math.cos(an) * rx * 0.72, py = DG.cy + oy0 + Math.sin(an) * ry * 0.7;
    const prx = Math.max(1.6, R * 0.16), pry = Math.max(1, prx * 0.5);
    for (let j = Math.floor(py - pry); j <= Math.ceil(py + pry); j++) {
      for (let i = Math.floor(px - prx); i <= Math.ceil(px + prx); i++) {
        const u = (i + 0.5 - px) / prx, v = (j + 0.5 - py) / pry;
        if (u * u + v * v > 1) continue;
        if (u > 0.1 && Math.abs(v) < 0.35) continue;             // the notch
        d.over(i, j, v < -0.2 ? rgb('#6a8a3a') : rgb('#46642a'), 1);
      }
    }
    if (rn() < 0.5) d.over(Math.floor(px - prx * 0.3), Math.floor(py - pry * 0.4), rgb('#f0b0d0'), 1);
  }
  const RD = rgb('#4e6428'), RL = rgb('#7e9440'), CT = rgb('#4a2c18');
  const nReed = R < 12 ? 2 : rn.int(3, 4);
  for (let k = 0; k < nReed; k++) {                              // reed tufts on the bank
    const an = rn.range(-0.1, 1.1) * Math.PI;
    const x = Math.floor(DG.cx + Math.cos(an) * rx * 0.98), y = Math.floor(DG.cy + oy0 + Math.sin(an) * ry * 0.98);
    const nb = rn.int(2, 3);
    for (let b = 0; b < nb; b++) {
      const bx = x + b * 2 - nb + 1, h = rn.int(3, Math.max(4, Math.round(R * 0.4)));
      for (let s = 0; s < h; s++) d.over(bx + (s > h * 0.6 && b !== 1 ? (b < 1 ? -1 : 1) : 0), y - s, s > h - 3 ? RL : RD, 1);
      if (b === 1 && h >= 4 && rn() < 0.7) { d.over(bx, y - h, CT, 1); d.over(bx, y - h - 1, CT, 1); }
    }
  }
  return finish(frames, mats, G, d, DG, 4);
}

// ═════════════════════════════════════════════════════════════════════════════
//  JUNGLE — a carved stone idol head on a plinth, moss and vines, glowing eyes
// ═════════════════════════════════════════════════════════════════════════════
function buildJungle(R, seed, kit) {
  const { SQ, clamp, hash3, hrand, stream, vnoise, C, pal, rgb, Pix, Dec, area, renderHF, lit, octFace, outline, depthEdges, despeckle, finish, dShadow, dPebble } = kit;
  const rn = stream(seed, 82);
  const ST = 1, MOSS = 2, VINE = 3, GLOW = 4;
  const OL = C('#101310');
  const glowPal = rn() < 0.55 ? pal('#16483c', '#249074', '#52e6b8', '#c4fff0') : pal('#4c2808', '#a8600e', '#f6b030', '#fff4b0');
  const mats = [null,
    { pal: pal('#23271f', '#343a2e', '#495041', '#606857', '#7b836c', '#999f86'), ol: OL, pr: 2 },
    { pal: pal('#1e3814', '#2a4e1a', '#3a6822', '#4e842a', '#6aa236', '#8cbe44'), ol: OL, pr: 1 },
    { pal: pal('#112a0c', '#1a4212', '#265c18', '#367a20', '#4e9a2a', '#74be3a'), ol: C('#0a1808'), pr: 3 },
    { pal: glowPal, ol: null, pr: 0 },
  ];
  const a1 = Math.max(5, Math.round(R * 0.92)), h1 = Math.max(3, Math.round(R * 0.3));
  const ax = Math.max(4, Math.round(R * 0.7)), ay = Math.max(3, Math.round(R * 0.56));
  const hc = Math.max(2, Math.round(R * 0.25));
  const hh = Math.max(9, Math.min(Math.round(R * rn.range(1.75, 1.95)), Math.round(96 - h1 - hc - 0.45 * (ay + 1 + a1))));
  const zH = h1 + hh, zTop = zH + hc, bx = ax + (R >= 12 ? 2 : 1), by = ay + 1;
  const G = area(R + 3, zTop + by * SQ + 4, R * SQ + 4);
  const p = new Pix(G.W, G.H);
  const { cx, cy, AX } = G;
  const mN = hash3(seed, 82, 3);
  const mossAt = (x, y, thr) => vnoise(mN, x / 2.6 + 20, y / 2.2 + 20) > thr;

  // ── the carved face, as a relief mask over the front wall (fx: column from the centre, r: row from the top) ──
  const Wf = ax * 2, Hf = hh;
  const mask = new Int8Array(Wf * Hf);                   // 1 recess, 2 lit lip, 3 shadow, 4 pupil, 5 tooth
  const M = (fx, r, v) => { const c = fx + ax; if (c >= 0 && c < Wf && r >= 0 && r < Hf) mask[r * Wf + c] = v; };
  const Mm = (fx, r, v) => { M(fx, r, v); M(-1 - fx, r, v); };           // mirrored pair
  const browR = Math.max(2, Math.round(Hf * 0.17));
  const ex = Math.max(2, Math.round(ax * 0.47)), ew = Math.max(1, Math.round(ax * 0.2));
  const eh = Hf >= 24 ? 3 : 2, eyeR = browR + 2;
  const angry = rn() < 0.5;
  for (let fx = 0; fx <= ex + ew; fx++) {
    const dip = angry && fx < ex - 1 ? 1 : 0;
    Mm(fx, browR + dip, 2);
    Mm(fx, browR + 1 + dip, 3);
  }
  for (let fx = ex - ew; fx < ex + ew; fx++) {
    for (let r = eyeR; r < eyeR + eh; r++) Mm(fx, r, 1);
    Mm(fx, eyeR + eh, 2);
  }
  for (let fx = ex - Math.max(1, ew >> 1); fx < ex + Math.max(1, ew >> 1) - (ew === 1 ? 0 : 0); fx++) Mm(fx, eyeR + eh - 1, 4);
  const noseR = eyeR + Math.max(3, Math.round(Hf * 0.3));
  for (let r = eyeR - 1; r <= noseR; r++) {
    const nw = r >= noseR - 1 ? 2 : 1;
    M(-nw, r, 2); M(nw - 1, r, 3);
    for (let fx = -nw + 1; fx < nw - 1; fx++) M(fx, r, 0);
  }
  M(-2, noseR, 1); M(1, noseR, 1);
  for (let fx = -2; fx < 2; fx++) M(fx, noseR + 1, 3);
  const style = rn.int(0, 2);
  const mw = Math.max(2, Math.round(ax * (style === 1 ? 0.45 : 0.62)));
  const mouthR = Math.min(Hf - 4, noseR + 3), mh = style === 1 ? 1 : Hf >= 24 ? 3 : 2;
  for (let fx = 0; fx < mw; fx++) {
    for (let r = mouthR; r < mouthR + mh; r++) Mm(fx, r, 1);
    Mm(fx, mouthR + mh, 2);
    if (style === 1) Mm(fx, mouthR - 1, 2);
  }
  if (style === 0) for (let fx = 0; fx < mw - 1; fx += 2) Mm(fx, mouthR, 5);                  // grimace with teeth
  if (style === 0) { Mm(mw, mouthR + mh - 1, 1); Mm(mw, mouthR + mh, 1); }                   // turned-down corners
  if (style === 2) { Mm(mw - 2, mouthR + mh - 1, 5); Mm(mw - 2, mouthR, 5); }                // fangs
  if (ax >= 6) for (let r = eyeR; r <= noseR; r++) Mm(ax - 2, r, 3);                         // ear grooves
  const face = (fx, r) => (fx >= -ax && fx < ax && r >= 0 && r < Hf ? mask[r * Wf + fx + ax] : 0);

  const wallT = (nx, ny) => { const I = lit(nx, ny, 0.15); return I > 0.62 ? 4 : I > 0.3 ? 3 : I > 0.05 ? 2 : I > -0.3 ? 1 : 0; };
  // plinth: an octagonal block, mossy on top
  renderHF(p, cx, cy, { x0: -a1 - 2, x1: a1 + 2, y0: -a1 - 2, y1: a1 + 2, mat: ST }, (x, y) => {
    const u = Math.abs(x), v = Math.abs(y);
    return u <= a1 + 0.25 && v <= a1 * 0.92 && u + v <= a1 * 1.55 ? h1 : -1;
  }, (kind, m, x, y, z, nx, ny, nz, i, j, ft, fb) => {
    if (kind === 0) {
      if (mossAt(x, y, 0.56)) return (MOSS << 8) | (vnoise(mN, x / 1.3, y / 1.3) > 0.5 ? 3 : 2);
      return (ST << 8) | (hrand(mN, i, j) < 0.05 ? 3 : 4);
    }
    const fce = octFace(x, y / 0.92);
    let t = [4, 4, 3, 2, 1][fce + 2];
    if (ft === 1) t = Math.min(5, t + 1); else if (fb === 0) t = Math.max(0, t - 1);
    if (ft <= 2 && mossAt(x, y, 0.56) && hrand(mN, i, 7) < 0.6) return (MOSS << 8) | 1;
    return (ST << 8) | t;
  });
  // head: a rounded block (superellipse) carrying the carved face
  const inHead = (x, y) => Math.pow(Math.abs(x) / (ax + 0.35), 4) + Math.pow(Math.abs(y) / (ay + 0.35), 4) <= 1;
  renderHF(p, cx, cy, { x0: -ax - 2, x1: ax + 2, y0: -ay - 2, y1: ay + 2, z0: h1, mat: ST }, (x, y) => (inHead(x, y) ? zH : -1),
    (kind, m, x, y, z, nx, ny, nz, i, j, ft, fb) => {
      if (kind === 0) return (ST << 8) | 3;
      const gx = Math.sign(x) * Math.pow(Math.abs(x) / ax, 3) / ax, gy = Math.sign(y) * Math.pow(Math.abs(y) / ay, 3) / ay;
      let t = wallT(gx, gy);
      if (fb === 0) t = Math.max(0, t - 1);
      if (gy > Math.abs(gx) * 1.4) {
        const code = face(i - AX, Math.floor(zH - z));
        if (code === 4) return (GLOW << 8) | 1;
        if (code === 1) t = 0;
        else if (code === 2) t = Math.min(5, t + 1);
        else if (code === 3) t = Math.max(1, t - 1);
        else if (code === 5) t = 4;
      }
      if (z < h1 + 2.5 && mossAt(x * 1.7, 9, 0.6)) return (MOSS << 8) | 1;       // moss creeping up from the plinth
      return (ST << 8) | t;
    });
  // headdress: an overhanging slab with a carved band, mossy on top
  const inCap = (x, y) => Math.pow(Math.abs(x) / (bx + 0.35), 6) + Math.pow(Math.abs(y) / (by + 0.35), 6) <= 1;
  renderHF(p, cx, cy, { x0: -bx - 2, x1: bx + 2, y0: -by - 2, y1: by + 2, z0: zH, mat: ST }, (x, y) => (inCap(x, y) ? zTop : -1),
    (kind, m, x, y, z, nx, ny, nz, i, j, ft, fb) => {
      if (kind === 0) {
        if (mossAt(x, y, 0.42)) return (MOSS << 8) | Math.min(5, (vnoise(mN, x / 1.4 + 5, y / 1.4) > 0.55 ? 4 : 3) + (x < -bx * 0.4 && y < 0 ? 1 : 0));
        return (ST << 8) | (x < -bx + 1.5 || y < -by + 1 ? 5 : 4);
      }
      if (mossAt(x, y - 0.8, 0.42) && ft <= 1 + Math.floor(hrand(mN, i, 3) * 2.6)) return (MOSS << 8) | (ft === 1 ? 3 : 1);
      const gx = Math.sign(x) * Math.pow(Math.abs(x) / bx, 5) / bx, gy = Math.sign(y) * Math.pow(Math.abs(y) / by, 5) / by;
      let t = wallT(gx, gy);
      if (ft === 1) t = Math.min(5, t + 1);
      else if (fb === 0) t = Math.max(0, t - 2);
      else if ((i - AX + 99) % 3 === 0 && hc >= 3) t = Math.max(0, t - 1);
      return (ST << 8) | t;
    });
  depthEdges(p, 4);
  despeckle(p, ST);
  // chipped corners
  const span = (j) => { let a = -1, b = -1; for (let i = 0; i < p.w; i++) if (p.mat(i, j)) { if (a < 0) a = i; b = i; } return [a, b]; };
  let jTop = 0;
  while (jTop < p.h && span(jTop)[0] < 0) jTop++;
  const [tl, tr] = span(jTop);
  if (rn() < 0.7) { p.erase(tl, jTop); if (R > 12) p.erase(tl + 1, jTop); }
  if (rn() < 0.4) p.erase(tr, jTop);

  // vines: draped along the brim and hanging down the head
  const jBrim = Math.floor(cy + by * SQ - zH - 1e-4);
  const vineAt = (i, j, t) => { if (p.mat(i, j) || p.mat(i - 1, j) || p.mat(i + 1, j)) p.set(i, j, VINE, t); };
  const hangX = [-ax + rn.int(0, 1), ax - 1 - rn.int(0, 1)];
  if (R >= 12 && rn() < 0.6) hangX.push((rn() < 0.5 ? -1 : 1) * Math.round(ax * rn.range(0.25, 0.55)));
  const sag = rn.range(0.8, 1.8);
  for (let i = AX + hangX[0]; i <= AX + hangX[1]; i++) {
    const u = (i - AX - (hangX[0] + hangX[1]) / 2) / ((hangX[1] - hangX[0]) / 2 || 1);
    const j = jBrim + Math.round(sag * (1 - u * u));
    vineAt(i, j, u < 0 ? 3 : 2);
    if (hrand(mN, i, 41) < 0.28) { vineAt(i, j + 1, 4); vineAt(i + 1, j + 1, 5); }
  }
  hangX.forEach((hx, k) => {
    const len = Math.round(hh * rn.range(0.45, 0.85) * (k === 2 ? 0.6 : 1));
    const ph = rn.range(0, 6), sd = hx < 0 ? -1 : 1;
    let lastI = AX + hx;
    for (let s = 0; s < len; s++) {
      const i = AX + hx + Math.round(Math.sin(s * 0.45 + ph) * 0.8), j = jBrim + s;
      vineAt(i, j, sd < 0 ? 3 : 2);
      if (i !== lastI) vineAt(lastI, j, sd < 0 ? 3 : 2);
      lastI = i;
      if (s > 1 && s % 3 === 1) {                                  // leaves, alternating sides
        const o = (s % 6 === 1 ? -1 : 1);
        p.set(i + o, j, VINE, sd < 0 ? 4 : 3);
        p.set(i + 2 * o, j - 1, VINE, sd < 0 ? 5 : 4);
        p.set(i + o, j - 1, VINE, sd < 0 ? 4 : 3);
      }
    }
    p.set(lastI, jBrim + len, VINE, 4);
  });
  outline(p, mats);
  // the eyes pulse
  const pupils = [];
  for (let j = 0; j < p.h; j++) for (let i = 0; i < p.w; i++) if (p.mat(i, j) === GLOW) pupils.push([i, j]);
  const phase = seed & 3;
  const frames = [];
  for (let f = 0; f < 4; f++) {
    const q = p.clone();
    const lv = [0, 1, 2, 1][(f + phase) & 3];
    for (const [i, j] of pupils) q.setTone(i, j, lv + 1);
    if (lv === 2) {
      for (const [i, j] of pupils) {
        for (const [di, dj] of [[1, 0], [-1, 0], [0, -1]]) if (q.mat(i + di, j + dj) === ST && q.tone(i + di, j + dj) === 0) q.set(i + di, j + dj, GLOW, 0);
      }
    }
    frames.push(q);
  }

  // ── floor decal: shadow, fallen leaves, pebbles ──
  const DG = area(R * 1.5 + 6, R * 0.9 + 6, R * 0.95 + 8);
  const d = new Dec(DG.W, DG.H);
  dShadow(d, DG.cx + R * 0.16, DG.cy + R * 0.1, R * 1.06 + 1, R * 0.54 + 1, 0.36, [6, 12, 4]);
  const leafC = [rgb('#6aa236'), rgb('#4e842a'), rgb('#a8a040'), rgb('#8a6a2a'), rgb('#2a4e1a')];
  const nL = R < 13 ? 3 : rn.int(4, 6);
  for (let l = 0; l < nL; l++) {
    const an = rn.range(-0.1, 1.1) * Math.PI, dist = rn.range(0.95, 1.3);
    const x = Math.floor(DG.cx + Math.cos(an) * R * dist), y = Math.floor(DG.cy + Math.sin(an) * R * 0.6 * dist);
    const c = leafC[rn.int(0, 3)], o = rn.sign();
    d.over(x, y, c, 1); d.over(x + o, y, c, 1); d.over(x + o * 2, y - 1, c, 1); d.over(x + o, y + 1, leafC[4], 1);
  }
  const rub = [rgb('#999f86'), rgb('#7b836c'), rgb('#495041'), rgb('#101310')];
  const nR = R < 13 ? rn.int(1, 2) : rn.int(2, 3);
  for (let q = 0; q < nR; q++) {
    const an = rn.range(0.1, 0.9) * Math.PI, dist = rn.range(1.05, 1.3);
    const s = R > 20 ? rn.int(2, 3) : rn.int(1, 2);
    dPebble(d, Math.round(DG.cx + Math.cos(an) * R * dist), Math.round(DG.cy + Math.sin(an) * R * 0.62 * dist), s + 1, s, rub, rn);
  }
  return finish(frames, mats, G, d, DG, 3);
}

// ═════════════════════════════════════════════════════════════════════════════
//  BEACH — a leaning palm tree with arching fronds and coconuts
// ═════════════════════════════════════════════════════════════════════════════
function buildBeach(R, seed, kit) {
  const { TAU, SQ, clamp, len2, hash3, hrand, stream, C, pal, rgb, Pix, Dec, area, renderHF, lit, outline, depthEdges, finish, dEllipse, dShadow } = kit;
  const rn = stream(seed, 83);
  const TR = 1, FR = 2, CO = 3, SAND = 4;
  const mats = [null,
    { pal: pal('#3a2418', '#553622', '#744c2e', '#96683e', '#b98a54', '#dcae70'), ol: C('#1e120a'), pr: 2 },
    { pal: pal('#15321a', '#1f4a22', '#2c6428', '#437f2e', '#65a036', '#98c24a'), ol: C('#0c1e0c'), pr: 3 },
    { pal: pal('#2a1c0e', '#443018', '#604622', '#7e602e', '#a07e40'), ol: C('#180c04'), pr: 1 },
    { pal: pal('#94704e', '#a8825c', '#ba946a', '#cca87c'), ol: null, pr: 0 },
  ];
  const vis = Math.min(100, Math.round(R * rn.range(4.1, 4.5) + 4));
  const lean = rn.sign();
  const Lf = clamp(R * rn.range(1.45, 1.65), 10, 36);            // frond length
  const zt = vis - R * SQ - Lf * 0.3;                            // crown height
  const rt0 = clamp(R * 0.18, 1.6, 6), rt1 = Math.max(1.25, rt0 * 0.72);
  const top = [lean * R * rn.range(0.5, 0.72), -R * 0.06, zt];
  const ctl = [lean * R * rn.range(0.42, 0.6), R * 0.02, zt * 0.42];
  const G = area(Math.max(R, Math.abs(top[0]) + Lf * 1.3) + 4, vis + 6, R * SQ + 4);
  const base = new Pix(G.W, G.H);
  const { cx, cy } = G;
  // sand mound around the foot
  const rm = R * 0.62, hm = Math.max(1.2, R * 0.1);
  renderHF(base, cx, cy, { x0: -rm - 1, x1: rm + 1, y0: -rm - 1, y1: rm + 1, mat: SAND }, (x, y) => {
    const q = (x * x + y * y) / (rm * rm);
    return q < 1 ? Math.max(0.35, hm * (1 - q) * (1 - q)) : -1;
  }, (kind, m, x, y, z, nx, ny, nz) => {
    const I = lit(nx, ny, nz);
    return (SAND << 8) | (I > 0.8 ? 3 : I > 0.64 ? 2 : I > 0.4 ? 1 : 0);
  });
  // trunk: a quadratic curve — leaning at the foot, rising upright under the crown — with ring bands
  const trunk = [], trR = [];
  for (let k = 0; k <= 10; k++) {
    const t = k / 10, b = 2 * t * (1 - t), c = t * t;
    trunk.push([b * ctl[0] + c * top[0], b * ctl[1] + c * top[1], b * ctl[2] + c * top[2]]);
    trR.push((rt0 + (rt1 - rt0) * t) * (1 + Math.max(0, 0.1 - t) * 5));
  }
  const period = Math.max(2.6, rt0 * 1.15);
  tube(base, cx, cy, trunk, trR, TR, (I, u, s, z) => {
    let t = I > 0.86 ? 5 : I > 0.6 ? 4 : I > 0.3 ? 3 : I > 0.0 ? 2 : I > -0.32 ? 1 : 0;
    const ph = (((s / period) % 1) + 1) % 1;
    if (ph < 0.28) t = Math.max(0, t - 2);
    else if (ph > 0.72 && t < 5) t++;
    return t;
  });
  // coconuts tucked under the crown
  const rc = clamp(R * 0.13, 1.5, 4);
  const nC = R < 11 ? 2 : rn.int(3, 4), rotC = rn.range(-0.1, 0.1);
  const nuts = [];
  for (let k = 0; k < nC; k++) {
    const an = Math.PI * (0.12 + (0.76 * (k + 0.5)) / nC + rotC);
    const dd = rt1 + rc * 0.45;
    nuts.push([top[0] + Math.cos(an) * dd, top[1] + Math.sin(an) * dd, top[2] - rc * (1.4 + (k & 1) * 0.6) - 0.5]);
  }
  const drawNuts = (q) => {                                      // drawn over the crown's leaflets (they hang in front)
    for (const P of nuts) ball(q, cx, cy, P, rc, CO, (I, ox, oy) => (ox < -0.1 && oy < -0.1 && ox > -0.7 && oy > -0.7 && I > 0.8 ? 4 : I > 0.7 ? 3 : I > 0.42 ? 2 : I > 0.1 ? 1 : 0), 8);
  };
  // fronds: some arch high, some reach out flat, all droop at the tips
  const nF = rn.int(6, 7), rot = rn.range(0, TAU);
  const fronds = [];
  for (let k = 0; k < nF; k++) fronds.push({ th: rot + (k / nF) * TAU + rn.range(-0.2, 0.2), el: rn.range(0.25, 0.95), dr: rn.range(1.35, 2.3), L: Lf * rn.range(0.8, 1.08) });
  const Wl = Math.max(2.2, Lf * 0.26);
  const C0 = [top[0], top[1], top[2] + 0.6];
  const wind = rn.sign();
  const frondPts = (F, sway, cb) => {
    const th = F.th + sway * 0.08, dr = F.dr + sway * 0.1;
    const sn = Math.sin(th), cs = Math.cos(th);
    const n = Math.ceil(F.L / 0.55);
    let P = C0;
    for (let s = 1; s <= n; s++) {
      const t = s / n, el = F.el - dr * t, ce = Math.cos(el);
      const dir = [cs * ce, sn * ce, Math.sin(el)];
      P = [P[0] + (dir[0] * F.L) / n, P[1] + (dir[1] * F.L) / n, P[2] + (dir[2] * F.L) / n];
      cb(P, t, s, dir, sn, cs);
    }
  };
  const putP = (q, P, t) => {
    if (P[2] < 0.5) return;
    q.zput(Math.floor(cx + P[0]), Math.floor(cy + P[1] * SQ - P[2]), FR, t < 0 ? 0 : t > 5 ? 5 : t, P[1] + 0.45 * P[2]);
  };
  const drawCrown = (q, sway) => {
    for (const F of fronds) {
      const back = Math.sin(F.th) < -0.35 ? 1 : 0, left = Math.cos(F.th) < -0.25 ? 1 : 0;
      frondPts(F, sway, (P, t, s, dir, sn, cs) => {
        const wl = Wl * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.04)), 0.6) * Math.min(1, t * 5);
        const stripe = (s >> 1) & 1;
        for (const sd of [-1, 1]) {
          const npx = -sn * sd, npy = cs * sd;
          const litSide = -npx - npy * SQ > 0;
          let lx = npx + dir[0] * 0.5, ly = npy + dir[1] * 0.5, lz = -0.2 + dir[2] * 0.5;
          const l = Math.hypot(lx, ly, lz); lx /= l; ly /= l; lz /= l;
          const wlen = wl - (stripe ? 0.9 : 0);
          const gap = s % 3 === 2 && t > 0.15;                       // pinnate gaps between leaflet groups
          for (let u = 0.5; u <= wlen; u += 0.5) {
            if (gap && u > 1.2) break;
            let tt = 3 + left - back - (litSide ? 0 : 1) - stripe - (t > 0.8 ? 1 : 0) + (u < 1.1 ? 1 : 0);
            if (u > wlen - 0.6 && !litSide) tt--;
            putP(q, [P[0] + lx * u, P[1] + ly * u, P[2] + lz * u], tt);
          }
        }
        putP(q, P, 4 + left - back - (t > 0.75 ? 1 : 0));
      });
    }
  };
  const frames = [];
  for (let f = 0; f < 2; f++) {
    const q = dup(base);
    drawCrown(q, ((f + seed) & 1) * wind);
    drawNuts(q);
    depthEdges(q, 2.5);
    outline(q, mats);
    frames.push(q);
  }

  // ── floor decal: sand mound, the palm's shadow, shells ──
  const DG = area(Math.abs(top[0]) + Lf * 1.1 + R * 0.4 + 6, R * 0.9 + 6, R * 1.0 + 8);
  const d = new Dec(DG.W, DG.H);
  dEllipse(d, DG.cx + 0.5, DG.cy + 0.8, R * 0.74, R * 0.34, rgb('#b89066'), 0.5);
  dEllipse(d, DG.cx - R * 0.14, DG.cy + 0.2, R * 0.46, R * 0.2, rgb('#caa47a'), 0.4);
  const mask = new Uint8Array(DG.W * DG.H);
  const mark = (x, y) => { const i = Math.floor(x), j = Math.floor(y); if (i >= 0 && j >= 0 && i < DG.W && j < DG.H) mask[j * DG.W + i] = 1; };
  const sx0 = DG.cx + top[0] * 0.75 + R * 0.3, sy0 = DG.cy + R * 0.16;
  for (const F of fronds) {
    frondPts(F, 0, (P, t, s, dir, sn, cs) => {
      const x = P[0] - top[0], y = P[1] - top[1];
      const wl = Wl * 0.8 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.04)), 0.6) * Math.min(1, t * 5);
      for (let u = -wl; u <= wl; u += 0.5) mark(sx0 + (x - sn * u) * 0.85, sy0 + (y + cs * u) * SQ * 0.85);
    });
  }
  for (let t = 0; t <= 1; t += 0.02) {
    const x = DG.cx + (sx0 - DG.cx) * t, y = DG.cy + (sy0 - DG.cy) * t, w = rt0 * (1 - 0.3 * t);
    for (let u = -w; u <= w; u += 0.5) mark(x, y + u * 0.5);
  }
  for (let k = 0; k < mask.length; k++) if (mask[k]) d.over(k % DG.W, Math.floor(k / DG.W), [74, 36, 44], 0.24);
  dShadow(d, DG.cx + 1, DG.cy + 0.5, rt0 * 2 + 2, rt0 + 1, 0.28, [60, 28, 30]);
  const nS = R < 12 ? rn.int(1, 2) : rn.int(2, 3);
  for (let k = 0; k < nS; k++) {
    const an = rn.range(0.1, 0.9) * Math.PI * (rn() < 0.3 ? -1 : 1), dist = rn.range(0.8, 1.25);
    const x = Math.floor(DG.cx + Math.cos(an) * R * dist), y = Math.floor(DG.cy + Math.sin(an) * R * 0.55 * dist);
    if (rn() < 0.3) {                                            // starfish
      const S = rgb('#e8743a'), SL = rgb('#ffa060');
      d.over(x, y, SL, 1); d.over(x - 1, y, S, 1); d.over(x + 1, y, S, 1); d.over(x, y - 1, S, 1); d.over(x - 1, y + 1, S, 1); d.over(x + 1, y + 1, S, 1);
    } else {                                                     // shell
      const pink = rn() < 0.5;
      d.over(x, y, rgb(pink ? '#f6c8c0' : '#fff2e4'), 1); d.over(x + 1, y, rgb(pink ? '#e89a90' : '#e8d4bc'), 1);
      d.over(x, y + 1, rgb(pink ? '#c87870' : '#c8ae90'), 1); d.over(x + 1, y + 1, rgb('#8a6048'), 1);
    }
  }
  return finish(frames, mats, G, d, DG, 1.6);
}

// ═════════════════════════════════════════════════════════════════════════════
//  CANDY — a giant swirl lollipop rising from a cluster of gumdrops
// ═════════════════════════════════════════════════════════════════════════════
function buildCandy(R, seed, kit) {
  const { TAU, SQ, clamp, len2, hash3, hrand, stream, C, pal, rgb, Pix, Dec, area, renderHF, HF, slab, lit, cylTone, outline, depthEdges, finish, dShadow } = kit;
  const rn = stream(seed, 84);
  const STK = 1, SA = 2, SB = 3, G1 = 4, G2 = 5, G3 = 6, SPK = 7;
  const WH = pal('#b2a4b8', '#d2c8d8', '#ebe5ef', '#faf7fb', '#ffffff');
  const SW = [
    [pal('#7a1c4c', '#b8387a', '#ea5e9e', '#ff90c2', '#ffc6e0'), WH, '#4a0c2c'],                      // strawberry
    [pal('#156052', '#23a084', '#46d4ac', '#8cf0cc', '#ccfff0'), WH, '#0a3a30'],                      // mint
    [pal('#8a360a', '#cc5e18', '#f5892a', '#ffb45e', '#ffdcac'), pal('#9a7610', '#cca820', '#f2d23c', '#fff07c', '#fffbd8'), '#4a1c06'],  // orange / lemon
    [pal('#7a0c18', '#b81c2c', '#e8363f', '#ff7676', '#ffbcbc'), WH, '#420810'],                      // cherry
    [pal('#46187a', '#7432b6', '#a45ee6', '#cc98ff', '#ecdcff'), pal('#3e7a10', '#6aae20', '#9edc40', '#d0ff80', '#f2ffd0'), '#26083e'],  // grape / lime
    [pal('#173a88', '#2c60c4', '#4c92ee', '#8cc2ff', '#d0eaff'), WH, '#0c1c48'],                      // blueberry
  ];
  const GUM = [
    pal('#5a0a18', '#a01830', '#e03848', '#ff7080', '#ffc0c8'), pal('#0e4a18', '#1c7a2a', '#34b040', '#70e070', '#c0ffc0'),
    pal('#6a2a06', '#b04a10', '#f07a20', '#ffb060', '#ffe0b0'), pal('#3a1050', '#6a2890', '#9c50d0', '#c890f0', '#f0d8ff'),
    pal('#6a5006', '#b08a10', '#f0c828', '#ffe878', '#fff8d0'), pal('#10306a', '#2058b0', '#4090f0', '#90c8ff', '#e0f4ff'),
  ];
  const sw = SW[rn.int(0, SW.length - 1)];
  const order = [0, 1, 2, 3, 4, 5];
  for (let k = 5; k > 0; k--) { const r = rn.int(0, k); const t = order[k]; order[k] = order[r]; order[r] = t; }
  const OLG = C('#2e1428');
  const mats = [null,
    { pal: pal('#8c8298', '#b0a6c0', '#d0c8dc', '#e8e3f0', '#f8f6fb', '#ffffff'), ol: C('#44385a'), pr: 1 },
    { pal: sw[0], ol: C(sw[2]), pr: 4 },
    { pal: sw[1], ol: C(sw[2]), pr: 4 },
    { pal: GUM[order[0]], ol: OLG, pr: 2 },
    { pal: GUM[order[1]], ol: OLG, pr: 2 },
    { pal: GUM[order[2]], ol: OLG, pr: 3 },
    { pal: pal('#ffffff', '#fff4c8'), ol: null, pr: 0 },
  ];
  const Rd = clamp(R * rn.range(0.98, 1.1), 5, 30);              // disc radius
  const tk = Math.max(2, Math.round(Rd * 0.2));                  // disc thickness
  const rs = clamp(R * 0.14, 1.3, 3.4);                           // stick radius
  const zc = Math.round(Math.min(R * rn.range(2.6, 2.85), 100 - Rd - R * SQ - 3));
  const G = area(Math.max(R, Rd) + 4, zc + Rd + 8, R * SQ + 4);
  const p = new Pix(G.W, G.H);
  const { cx, cy } = G;
  // stick
  slab(p, cx, cy, 0, rs, 0, zc, (kind, m, x) => (STK << 8) | (kind === 0 ? 4 : cylTone(x / rs)), STK);
  // gumdrops
  const gd = [
    { x: -R * 0.42, y: -R * 0.02, r: clamp(R * 0.5, 3, 15), m: G1 },
    { x: R * 0.42, y: -R * 0.12, r: clamp(R * 0.46, 3, 14), m: G2 },
    { x: R * 0.06, y: R * 0.38, r: clamp(R * 0.38, 2.5, 12), m: G3 },
  ];
  for (const g of gd) g.h = g.r * rn.range(0.95, 1.15);
  const gsd = hash3(seed, 84, 2);
  renderHF(p, cx, cy, { x0: -R - 2, x1: R + 2, y0: -R - 2, y1: R + 2 }, (x, y) => {
    let best = -1;
    for (const g of gd) {
      const q = len2(x - g.x, y - g.y) / g.r;
      if (q >= 1) continue;
      const h = g.h * Math.pow(1 - Math.pow(q, 2.4), 0.55);
      if (h > best) { best = h; HF.mat = g.m; }
    }
    return best > 0.3 ? best : -1;
  }, (kind, m, x, y, z, nx, ny, nz, i, j) => {
    const I = lit(nx, ny, nz);
    let t = kind === 1 ? 1 : I > 0.86 ? 4 : I > 0.64 ? 3 : I > 0.36 ? 2 : I > 0.06 ? 1 : 0;
    const h = hrand(gsd, i, j);
    if (h > 0.9 && t >= 1 && t < 4) t++;                          // sugar crystals
    else if (h < 0.06 && t > 0) t--;
    return (m << 8) | t;
  });
  depthEdges(p, 3);
  // the swirl disc, facing the viewer (always in front): rim peeking out on top, domed shading
  const dcx = cx, dcy = cy + tk * 0.5 * SQ - zc, bcy = dcy - tk * SQ;
  const kp = Rd < 9 ? 2 : Rd < 17 ? 3 : 4, nArm = kp * 2, tw = rn.range(0.8, 1.2) * rn.sign();
  const stripe = (ox, oy) => Math.floor((Math.atan2(oy, ox) / TAU + (Math.hypot(ox, oy) / Rd) * tw) * nArm + 1000) & 1;
  const R2 = (Rd + 0.3) * (Rd + 0.3);
  for (let j = Math.floor(bcy - Rd) - 1; j <= Math.ceil(dcy + Rd) + 1; j++) {
    for (let i = Math.floor(dcx - Rd) - 1; i <= Math.ceil(dcx + Rd) + 1; i++) {
      const ox = i + 0.5 - dcx, oy = j + 0.5 - dcy, oyb = j + 0.5 - bcy;
      const inF = ox * ox + oy * oy <= R2, inB = ox * ox + oyb * oyb <= R2;
      if (!inF && !inB) continue;
      if (!inF) { p.set(i, j, stripe(ox, oy) ? SB : SA, ox < Rd * 0.2 ? 3 : 2); continue; }
      const rr = Math.sqrt(ox * ox + oy * oy) / Rd;
      const nx = (ox / Rd) * 0.38, ny = (oy / Rd) * 0.38, nz = Math.sqrt(1 - nx * nx - ny * ny);
      const I = nx * LS[0] + ny * LS[1] + nz * LS[2];
      let t = I > 0.74 ? 3 : I > 0.55 ? 2 : I > 0.4 ? 1 : 0;
      if (rr > 1 - 1.3 / Rd) t = Math.max(0, t - 1);
      const an = Math.atan2(oy, ox);
      if (rr > 0.56 && rr < 0.78 && an > -2.75 && an < -1.95) { p.set(i, j, rr > 0.62 && rr < 0.72 && an > -2.6 && an < -2.1 ? SPK : SB, 4); continue; }
      p.set(i, j, stripe(ox, oy) ? SB : SA, t);
    }
  }
  outline(p, mats);
  // twinkle on the rim + a sugar glint on a gumdrop
  const sa = -2.36, si = Math.floor(dcx + Math.cos(sa) * (Rd + 1.2)), sj = Math.floor(dcy + Math.sin(sa) * (Rd + 1.2));
  const g0 = gd[0], gi = Math.floor(cx + g0.x - g0.r * 0.35), gj = Math.floor(cy + g0.y * SQ - g0.h * 0.8);
  const phase = seed & 3;
  const frames = [];
  for (let f = 0; f < 4; f++) {
    const q = p.clone();
    const s = [0, 1, 2, 1][(f + phase) & 3];
    if (s) {
      q.set(si, sj, SPK, 0);
      for (let a = 1; a <= s; a++) {
        const tt = a === 2 ? 1 : 0;
        q.set(si + a, sj, SPK, tt); q.set(si - a, sj, SPK, tt); q.set(si, sj + a, SPK, tt); q.set(si, sj - a, SPK, tt);
      }
    }
    if (s === 0 && q.mat(gi, gj) === G1) q.set(gi, gj, SPK, 0);
    frames.push(q);
  }

  // ── floor decal: soft shadow + scattered sprinkles ──
  const DG = area(R * 1.5 + 6, R * 0.9 + 6, R * 0.95 + 8);
  const d = new Dec(DG.W, DG.H);
  dShadow(d, DG.cx + R * 0.14, DG.cy + R * 0.1, R * 1.02 + 1, R * 0.52 + 1, 0.3, [70, 16, 56]);
  const SPR = ['#ff5a8a', '#ffd23c', '#5ac8ff', '#7ae05a', '#ffffff', '#c07aff'].map(rgb);
  const nSp = R < 12 ? 7 : R < 20 ? 10 : 14;
  const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
  for (let k = 0; k < nSp; k++) {
    const an = rn.range(0, TAU), dist = rn.range(0.7, 1.35);
    const x = Math.floor(DG.cx + Math.cos(an) * R * dist), y = Math.floor(DG.cy + Math.sin(an) * R * 0.55 * dist);
    const c = SPR[rn.int(0, SPR.length - 1)], dd = dirs[rn.int(0, 3)];
    d.over(x, y, c, 1); d.over(x + dd[0], y + dd[1], c, 1);
  }
  return finish(frames, mats, G, d, DG, 4);
}

export const PROPS_NATURE = { swamp: buildSwamp, jungle: buildJungle, beach: buildBeach, candy: buildCandy };
