// ─────────────────────────────────────────────────────────────────────────────
//  Arena props (obstacle sprites) for the built arenas: graveyard, dojo, ship, rooftop, castle.
//  Each builder is (R, seed, kit) → kit.finish(...); see art-obstacles.js for the toolkit.
//  Size switches (the arena layouts guarantee the thresholds):
//    graveyard  R ≥ 16 stone crypt          · else a tombstone group
//    dojo       R ≥ 13 sakura tree          · else a stone lantern (tōrō)
//    ship       R ≥ 12 mast with a yard      · else barrels + crate / rope
//    rooftop    AC unit with a spinning fan
//    castle     R ≥ 16 two-tier fountain    · else a knight statue on a plinth
// ─────────────────────────────────────────────────────────────────────────────

const fr = (v) => v - Math.floor(v);
const tone6 = (I) => (I > 0.85 ? 5 : I > 0.55 ? 4 : I > 0.25 ? 3 : I > 0 ? 2 : I > -0.3 ? 1 : 0);
const tone5 = (I) => (I > 0.7 ? 4 : I > 0.38 ? 3 : I > 0.08 ? 2 : I > -0.25 ? 1 : 0);
// recolour a pixel without touching its depth (safe before depthEdges)
function paint(p, i, j, m, t) { if (p.in(i, j)) { const k = j * p.w + i; p.m[k] = m; p.t[k] = t; } }
function tuft(d, x, y, c1, c2) { d.over(x, y, c2, 1); d.over(x - 1, y - 1, c1, 1); d.over(x + 1, y - 1, c1, 1); d.over(x, y - 2, c1, 1); }

// geometry helpers bound to one buffer (all depth-correct wherever they sit on the plan)
function geo(K, p, G) {
  const { renderHF, SQ } = K;
  const { cx, cy } = G;
  // axis-aligned box centred on plan (ox, oy), half sizes ax / ay, from z0 up to z1
  const box = (ox, oy, ax, ay, z0, z1, shade, mat = 1) => renderHF(p, cx, cy,
    { x0: ox - ax - 1.5, x1: ox + ax + 1.5, y0: oy - ay - 1.5, y1: oy + ay + 1.5, z0, mat },
    (x, y) => (Math.abs(x - ox) <= ax + 0.25 && Math.abs(y - oy) <= ay ? z1 : -1), shade);
  // surface of revolution around a vertical axis: front half via side(u, z, i, j, r), top disc via cap(dx, dy, r, i, j)
  const lathe = (ox, oy, z0, z1, rz, side, cap) => {
    let rm = 0;
    for (let z = z0; z <= z1 + 1e-6; z += 0.25) rm = Math.max(rm, rz(z));
    const iA = Math.floor(cx + ox - rm) - 1, iB = Math.ceil(cx + ox + rm) + 1;
    for (let i = iA; i <= iB; i++) {
      const dx = i + 0.5 - cx - ox;
      let pj = null;
      for (let z = z0; z <= z1 + 1e-6; z += 0.25) {
        const r = rz(z);
        if (Math.abs(dx) > r + 0.25) { pj = null; continue; }
        const yy = Math.sqrt(Math.max(0, r * r - dx * dx));
        const j = Math.floor(cy + (oy + yy) * SQ - z);
        const v = side(Math.max(-1, Math.min(1, dx / Math.max(0.5, r))), z, i, j, r);
        if (v >= 0) {
          const dep = oy + yy + 0.45 * z;
          p.zput(i, j, v >> 8, v & 255, dep);
          if (pj !== null) for (let jj = j + 1; jj < pj; jj++) p.zput(i, jj, v >> 8, v & 255, dep);
        }
        pj = j;
      }
    }
    if (cap) {
      const r = rz(z1);
      for (let y = -Math.ceil(r) - 0.5; y <= r + 0.5; y += 0.5) {
        for (let i = iA; i <= iB; i++) {
          const dx = i + 0.5 - cx - ox;
          if (dx * dx + y * y > r * r + 0.5 * r) continue;
          const j = Math.floor(cy + (oy + y) * SQ - z1);
          const v = cap(dx, y, r, i, j);
          if (v >= 0) p.zput(i, j, v >> 8, v & 255, oy + y + 0.45 * z1 + 0.01);
        }
      }
    }
  };
  // sphere-swept tube through [x, y, z, r] points; shade(I, u, v, s, i, j) → (mat << 8 | tone) or -1
  const tube = (pts, shade) => {
    for (let k = 0; k + 1 < pts.length; k++) {
      const A = pts[k], B = pts[k + 1];
      const n = Math.max(1, Math.ceil(2 * Math.hypot(B[0] - A[0], (B[1] - A[1]) * SQ - (B[2] - A[2]))));
      for (let q = k ? 1 : 0; q <= n; q++) {
        const f = q / n;
        const x = A[0] + (B[0] - A[0]) * f, y = A[1] + (B[1] - A[1]) * f, z = A[2] + (B[2] - A[2]) * f, r = A[3] + (B[3] - A[3]) * f;
        const px = cx + x, py = cy + y * SQ - z, lim = r * r + 0.3 * r, s = (k + f) / (pts.length - 1);
        for (let j = Math.floor(py - r) - 1; j <= Math.ceil(py + r); j++) {
          for (let i = Math.floor(px - r) - 1; i <= Math.ceil(px + r); i++) {
            const du = i + 0.5 - px, dv = j + 0.5 - py;
            if (du * du + dv * dv > lim) continue;
            const u = du / r, v = dv / r, w = Math.sqrt(Math.max(0, 1 - u * u - v * v));
            const val = shade(-0.62 * u - 0.5 * v + 0.6 * w, u, v, s, i, j);
            if (val >= 0) p.zput(i, j, val >> 8, val & 255, y + 0.45 * z + w * r * 0.6);
          }
        }
      }
    }
  };
  return { box, lathe, tube };
}

// ═════════════════════════════════════════════════════════════════════════════
//  GRAVEYARD — a small stone crypt (big footprints) or a tombstone group
// ═════════════════════════════════════════════════════════════════════════════
function graveMats(C, pal) {
  const OL = C('#0c1011');
  return [null,
    { pal: pal('#1c2224', '#2b3335', '#414b4c', '#5d6867', '#818c87', '#a8b3ac'), ol: OL, pr: 3 },     // 1 stone
    { pal: pal('#14181e', '#20262f', '#2f3742', '#424c58', '#5a6672', '#7a8794'), ol: OL, pr: 4 },     // 2 roof slate
    { pal: pal('#16261a', '#233c22', '#36582e', '#52763c'), ol: OL, pr: 2 },                           // 3 moss
    { pal: pal('#040606', '#090e0d', '#0f1915'), ol: OL, pr: 1 },                                      // 4 dark doorway
    { pal: pal('#12352a', '#1c5c3c', '#36945a', '#78dc8c', '#ccffd2'), ol: OL, pr: 1 },                // 5 eerie glow
    { pal: pal('#0a0c0e', '#1a2025', '#303840', '#505a64'), ol: OL, pr: 5 },                           // 6 iron
    { pal: pal('#221c19', '#302722', '#42362d', '#56473a'), ol: C('#120e0c'), pr: 1 },                 // 7 soil
  ];
}
const ST = 1, ROOF = 2, MOSS = 3, DK = 4, GLOW = 5, IRON = 6, SOIL = 7;

function crypt(R, seed, K) {
  const { SQ, hash3, hrand, stream, vnoise, C, pal, rgb, lit, Pix, Dec, area, renderHF, depthEdges, outline, finish, dShadow, dPebble, dEllipse } = K;
  const rn = stream(seed, 101);
  const mats = graveMats(C, pal);
  const aP = Math.round(R * 0.94), dP = Math.round(R * 0.64), hP = Math.max(2, Math.round(R * 0.09));
  const bw = Math.round(R * 0.74), bd = Math.round(R * 0.44);
  const zE = hP + Math.round(R * 1.12), hc = Math.max(2, Math.round(R * 0.08));
  const zR = zE + hc, rw = bw + 1, rd = bd + 1, rise = Math.round(rw * 0.56);
  const ch = Math.max(6, Math.round(R * 0.44)), zA = zR + rise - 1;
  const G = area(aP + 2, zA + ch + rd * SQ + 4, dP * SQ + 3);
  const p = new Pix(G.W, G.H);
  const { cx, cy, AX } = G;
  const T = geo(K, p, G);
  const ms = hash3(seed, 101, 7);
  const dw = Math.max(2, Math.round(bw * 0.27)), dh = Math.max(dw + 4, Math.round((zE - hP) * 0.64));
  const inDoor = (x, dz) => dz >= 0 && Math.abs(x) <= dw && (dz <= dh - dw || x * x + (dz - dh + dw) * (dz - dh + dw) <= dw * dw + dw * 0.8);
  const doorPx = [];
  // plinth
  T.box(0, 0, aP, dP, 0, hP, (kind, m, x, y, z, nx, ny, nz, i, j, ft, fb) => {
    if (kind === 0) return vnoise(ms + 1, x / 2.5, y / 2) > 0.7 ? (MOSS << 8) | 3 : (ST << 8) | (y > dP - 0.6 ? 5 : 4);
    return (ST << 8) | (ft === 1 ? 3 : fb === 0 ? 1 : 2);
  }, ST);
  // body: masonry, corner pilasters, arched door with a surround, moss creeping up
  T.box(0, 0, bw, bd, hP, zE, (kind, m, x, y, z, nx, ny, nz, i, j, ft, fb) => {
    if (kind === 0) return (ST << 8) | 4;
    const dz = z - hP, ax = Math.abs(x);
    if (inDoor(x, dz)) { doorPx.push([i, j, x, dz]); return (DK << 8) | 1; }
    if (inDoor(x - 1, dz) || inDoor(x + 1, dz) || inDoor(x, dz - 1)) return (ST << 8) | (x < 0 ? 5 : 4);
    if (fb === 0) return (ST << 8) | 1;
    if (ft === 1) return (ST << 8) | 1;                                  // shadow under the cornice
    const mv = vnoise(ms, x / 3, 3);
    if (dz < 0.6 + 2.6 * mv * mv) return (MOSS << 8) | (x < 0 ? 3 : 2);
    if (ax >= bw - 1) return (ST << 8) | (x < 0 ? 4 : 2);                  // corner pilasters
    if (ax === dw + 3 || ax === dw + 4) return (ST << 8) | 4;            // door pilasters
    if (x === dw + 5) return (ST << 8) | 2;
    const row = Math.floor(dz / 4);
    if (dz - row * 4 < 1) return (ST << 8) | 2;                            // course joints
    if ((x + 64 + (row & 1) * 3) % 6 === 0) return (ST << 8) | 2;
    return (ST << 8) | (hrand(ms, i, j) < 0.07 ? 2 : 3);
  }, ST);
  // cornice
  T.box(0, 0, bw + 2, bd + 2, zE, zR, (kind, m, x, y, z, nx, ny, nz, i, j, ft) => (ST << 8) | (kind === 0 ? 5 : ft === 1 ? 4 : 2), ST);
  // pitched slate roof, gable (pediment with an oculus) facing the viewer
  const slope = rise / rw;
  const orr = Math.max(1.5, rise * 0.2), oz0 = zR + rise * 0.36;
  renderHF(p, cx, cy, { x0: -rw - 1.5, x1: rw + 1.5, y0: -rd - 1.5, y1: rd + 1.5, z0: zR, mat: ROOF },
    (x, y) => (Math.abs(x) <= rw + 0.25 && Math.abs(y) <= rd ? zR + (rw + 0.25 - Math.abs(x)) * slope : -1),
    (kind, m, x, y, z, nx, ny, nz, i, j, ft, fb) => {
      if (kind === 1) {
        const oz = z - oz0, q = x * x + oz * oz;
        if (q <= orr * orr) { doorPx.push([i, j, x, -1]); return (DK << 8) | 1; }
        if (q <= (orr + 1.1) * (orr + 1.1)) return (ST << 8) | 4;
        return (ST << 8) | (ft <= 1 ? 4 : ft === 2 ? 2 : fb === 0 ? 2 : 3);
      }
      if (Math.abs(x) < 0.6) return (ROOF << 8) | 5;
      const I = lit(nx, ny, nz);
      if (vnoise(ms + 2, x / 3.2, y / 2.4) > 0.66) return (MOSS << 8) | (I > 0.7 ? 3 : 1);
      let t = I > 0.8 ? 4 : I > 0.5 ? 3 : I > 0.2 ? 2 : 1;
      if (Math.floor(Math.abs(x)) % 3 === 0 && Math.abs(x) > 1) t = Math.max(0, t - 1);    // lead seams
      return (ROOF << 8) | t;
    });
  // stone cross on the front apex
  const crossSh = (kind, m, x, y, z, nx, ny, nz, i, j, ft) => (ST << 8) | (kind === 0 ? 5 : ft === 1 ? 4 : x <= 0 ? 4 : 2);
  const yC = rd - 1, e = Math.max(1, Math.round(ch * 0.26)), za = zA + Math.round(ch * 0.56);
  T.box(0.5, yC, 0.5, 0.75, zA - 1, zA + ch, crossSh, ST);
  T.box(0.5, yC, e + 0.49, 0.75, za, za + 2, crossSh, ST);
  depthEdges(p, 3);
  // cracks down the facade
  for (let c = 0; c < (R < 20 ? 1 : 2); c++) {
    const x = Math.round(rn.range(dw + 6, bw - 2)) * (c ? -1 : rn.sign());
    let i = AX + x, j = Math.floor(cy + bd * SQ - (zE - 1 - rn.int(0, 3)));
    const len = rn.int(4, 8);
    for (let s = 0; s < len; s++) {
      if (p.mat(i, j) !== ST || p.tone(i, j) < 2) break;
      p.setTone(i, j, 1);
      j++;
      const r = rn();
      if (r < 0.3) i--; else if (r < 0.6) i++;
    }
  }
  outline(p, mats);

  // the doorway (and the oculus) glow a faint green behind an iron gate, flickering
  const flick = [1, 0.8, 1.12, 0.9];
  const ph = seed & 3;
  const frames = [];
  for (let f = 0; f < 4; f++) {
    const q = p.clone(), fk = flick[(f + ph) & 3];
    for (const [i, j, x, dz] of doorPx) {
      if (q.mat(i, j) !== DK) continue;
      if (dz < 0) { q.setTone(i, j, fk > 1 ? 2 : 1); q.m[j * q.w + i] = fk >= 1 ? GLOW : DK; continue; }
      const v = dz / dh, u = Math.abs(x) / (dw + 0.5);
      const I = ((1 - v) * 1.05 - 0.35 * u) * fk;
      const bar = (Math.abs(x) < dw && (x & 1) === 0) || Math.abs(dz - dh * 0.5) < 0.5;
      if (bar) q.set(i, j, IRON, I > 0.55 ? 2 : 1);
      else if (I > 0.25) q.set(i, j, GLOW, I > 0.85 ? 3 : I > 0.6 ? 2 : I > 0.4 ? 1 : 0);
      else q.set(i, j, DK, v > 0.75 ? 0 : 1);
    }
    frames.push(q);
  }

  // ── floor decal: shadow, green spill before the door, grass tufts, pebbles ──
  const DG = area(R * 1.5 + 4, R * 0.9 + 4, R * 0.9 + 6);
  const d = new Dec(DG.W, DG.H);
  dShadow(d, DG.cx + R * 0.14, DG.cy + R * 0.1, R * 1.08 + 1, R * 0.56 + 1, 0.42, [2, 6, 6]);
  dEllipse(d, DG.cx, DG.cy + dP * SQ + 2.5, dw * 2 + 3, 2.6, [80, 230, 130], 0.1);
  dEllipse(d, DG.cx, DG.cy + dP * SQ + 2, dw + 2, 1.5, [80, 230, 130], 0.12);
  const g1 = rgb('#52763c'), g2 = rgb('#233c22');
  for (let t = 0; t < (R < 20 ? 3 : 5); t++) {
    const an = rn.range(0.05, 0.95) * Math.PI;
    tuft(d, Math.floor(DG.cx + Math.cos(an) * R * rn.range(0.98, 1.12)), Math.floor(DG.cy + Math.sin(an) * R * 0.6), g1, g2);
  }
  const peb = [rgb('#a8b3ac'), rgb('#818c87'), rgb('#414b4c'), rgb('#0c1011')];
  for (let q = 0; q < 2; q++) {
    const an = rn.range(0.1, 0.9) * Math.PI;
    dPebble(d, Math.round(DG.cx + Math.cos(an) * R * 1.12), Math.round(DG.cy + Math.sin(an) * R * 0.62), 3, 2, peb, rn);
  }
  return finish(frames, mats, G, d, DG, 6);
}

function tombs(R, seed, K) {
  const { SQ, hash3, hrand, stream, vnoise, C, pal, rgb, lit, Pix, Dec, area, renderHF, depthEdges, outline, finish, dShadow, dPebble } = K;
  const rn = stream(seed, 102);
  const mats = graveMats(C, pal);
  const side = rn.sign();
  const w = Math.max(3, Math.round(R * 0.46)), t = Math.max(1, R * 0.11), H = Math.round(R * 1.85), hb = 2;
  const bx = -side * Math.round(R * 0.2), by = -Math.round(R * 0.25);
  const w2 = Math.max(2, Math.round(w * 0.72)), H2 = Math.round(H * 0.58);
  const sx = side * Math.round(R * 0.52), sy = Math.round(R * 0.08);
  const G = area(R + 6, H + hb + R * SQ + 6, R * SQ + 5);
  const p = new Pix(G.W, G.H);
  const { cx, cy } = G;
  const T = geo(K, p, G);
  const ms = hash3(seed, 102, 5);
  // a slab with a rounded top and an engraving on its face
  const stone = (pix, ox, oy, sw, sh, z0, engr) => {
    const zr = z0 + sh - sw;
    renderHF(pix, cx, cy, { x0: ox - sw - 2, x1: ox + sw + 2, y0: oy - t - 1, y1: oy + t + 1, z0, mat: ST }, (x, y) => {
      const dx = x - ox;
      if (Math.abs(dx) > sw + 0.25 || Math.abs(y - oy) > t) return -1;
      return zr + Math.sqrt(Math.max(0, (sw + 0.5) * (sw + 0.5) - dx * dx));
    }, (kind, m, x, y, z, nx, ny, nz, i, j, ft, fb) => {
      const dx = x - ox;
      if (kind === 0 || ft === 1) return (ST << 8) | (dx < 1 ? 5 : 4);
      let tn = dx <= -sw + 0.5 ? 4 : dx >= sw - 0.5 ? 2 : 3;
      if (fb === 0) tn = 2;
      if (engr(dx, z - z0)) tn = 1;
      else if (engr(dx, z - z0 + 1)) tn = 4;
      return (ST << 8) | tn;
    });
  };
  const cA = Math.max(1, Math.round(w * 0.45));
  const eBig = (dx, dz) => (dx === 0 && dz >= H * 0.36 && dz < H * 0.86) || (Math.abs(dx) <= cA && dz >= H * 0.66 && dz < H * 0.66 + 1) ||
    (R >= 11 && dz >= H * 0.18 && dz < H * 0.18 + 1 && Math.abs(dx) <= w - 2 && (dx + 9) % 3 !== 2);
  const eSmall = (dx, dz) => Math.abs(dx) <= w2 - 2 && dz >= H2 * 0.5 && dz < H2 * 0.5 + 1;
  // big headstone on a low base
  T.box(bx, by, w + 1.5, t + 1.5, 0, hb, (kind, m, x, y, z, nx, ny, nz, i, j, ft) => (ST << 8) | (kind === 0 ? 4 : ft === 1 ? 3 : 2), ST);
  stone(p, bx, by, w, H, hb, eBig);
  // a smaller stone beside it, sunk into the earth and leaning
  const p2 = new Pix(G.W, G.H);
  stone(p2, sx, sy, w2, H2, 0, eSmall);
  const lean = side * 0.3, jb = Math.floor(cy + (sy + t) * SQ);
  for (let j = 0; j < p2.h; j++) {
    for (let i = 0; i < p2.w; i++) {
      const k = j * p2.w + i;
      if (p2.m[k]) p.zput(i + Math.round((jb - j) * lean), j, p2.m[k], p2.t[k], p2.d[k]);
    }
  }
  // grave mound in front of the big stone
  const my = by + t + 1.5 + R * 0.3, mrx = w * 0.95 + 0.5, mry = R * 0.3, hm = Math.max(1.5, R * 0.14);
  renderHF(p, cx, cy, { x0: bx - mrx - 1, x1: bx + mrx + 1, y0: my - mry - 1, y1: my + mry + 1, mat: SOIL }, (x, y) => {
    const u = (x - bx) / mrx, v = (y - my) / mry, q = u * u + v * v;
    if (q >= 1) return -1;
    const h = hm * Math.sqrt(1 - q) + (vnoise(ms, x / 2, y / 2) - 0.5) * 0.8;
    return h > 0.35 ? h : -1;
  }, (kind, m, x, y, z, nx, ny, nz, i, j) => {
    const I = lit(nx, ny, nz);
    if (kind === 0 && hrand(ms, i, j) < 0.12) return (MOSS << 8) | (I > 0.7 ? 3 : 2);
    return (SOIL << 8) | (kind === 1 ? 1 : I > 0.8 ? 3 : I > 0.6 ? 2 : I > 0.35 ? 1 : 0);
  });
  depthEdges(p, 2.5);
  // moss on the stone tops and feet
  for (let j = 1; j < p.h - 1; j++) {
    for (let i = 1; i < p.w - 1; i++) {
      if (p.mat(i, j) !== ST) continue;
      if (!p.mat(i, j - 1) && hrand(ms, i, j) < 0.35) paint(p, i, j, MOSS, 3);
      else if (p.mat(i, j + 1) !== ST && p.tone(i, j) <= 3 && hrand(ms, j, i) < 0.4) paint(p, i, j, MOSS, 2);
    }
  }
  outline(p, mats);

  const DG = area(R * 1.5 + 5, R * 0.9 + 5, R * 0.9 + 7);
  const d = new Dec(DG.W, DG.H);
  dShadow(d, DG.cx + R * 0.14, DG.cy + R * 0.06, R * 0.95 + 1, R * 0.45 + 1, 0.36, [2, 6, 6]);
  const g1 = rgb('#52763c'), g2 = rgb('#233c22');
  for (let q = 0; q < 3; q++) {
    const an = rn.range(0.05, 0.95) * Math.PI;
    tuft(d, Math.floor(DG.cx + Math.cos(an) * R * rn.range(0.9, 1.1)), Math.floor(DG.cy + Math.sin(an) * R * 0.58), g1, g2);
  }
  const peb = [rgb('#a8b3ac'), rgb('#818c87'), rgb('#414b4c'), rgb('#0c1011')];
  const an = rn.range(0.15, 0.85) * Math.PI;
  dPebble(d, Math.round(DG.cx + Math.cos(an) * R * 1.05), Math.round(DG.cy + Math.sin(an) * R * 0.6), 2, 2, peb, rn);
  return finish([p], mats, G, d, DG, 0);
}

// ═════════════════════════════════════════════════════════════════════════════
//  DOJO — a cherry-blossom tree (big footprints) or a stone lantern (tōrō)
// ═════════════════════════════════════════════════════════════════════════════
function sakura(R, seed, K) {
  const { SQ, TAU, clamp, len2, hash3, hrand, stream, vnoise, ringNoise, norm3, C, pal, rgb, Pix, Dec, area, renderHF, depthEdges, despeckle, outline, finish, lit } = K;
  const rn = stream(seed, 201);
  const BARK = 1, BLOS = 2, PET = 3;
  const mats = [null,
    { pal: pal('#1c1014', '#2c1a1e', '#42272a', '#5b3836', '#784c46'), ol: C('#110a0b'), pr: 1 },
    { pal: pal('#6a2645', '#983c63', '#c65a87', '#e888ad', '#f7bcd2', '#ffe8f1'), ol: C('#46162c'), pr: 2 },
    { pal: pal('#ffffff', '#ffd2e4'), ol: null, pr: 0 },
  ];
  const vis = Math.min(100, Math.round(3.4 * R + 8));
  const Rx = Math.min(R * 1.8, R + 15), Ry = Rx * 0.54;
  const zc = vis - R * SQ - Ry;
  const rt = Math.max(2.4, R * 0.25);
  const G = area(Rx + 4, vis + 4, R * SQ + 4);
  const p = new Pix(G.W, G.H);
  const { cx, cy, AX } = G;
  const T = geo(K, p, G);
  const side = rn.sign();
  // flared foot with a few roots
  const roots = [];
  const nr = rn.int(3, 4), rot = rn.range(0, TAU);
  for (let k = 0; k < nr; k++) {
    const an = rot + (k / nr) * TAU + rn.range(-0.3, 0.3);
    roots.push({ c: Math.cos(an), s: Math.sin(an), len: R * rn.range(0.45, 0.62), h: rt * rn.range(0.7, 1.0), w: Math.max(1.2, rt * 0.5) });
  }
  renderHF(p, cx, cy, { x0: -R, x1: R, y0: -R, y1: R, mat: BARK }, (x, y) => {
    const dd = len2(x, y);
    let h = dd < rt * 1.7 ? rt * 1.4 * Math.pow(1 - dd / (rt * 1.7), 2) : -1;
    for (const r of roots) {
      const along = x * r.c + y * r.s, perp = Math.abs(-x * r.s + y * r.c);
      if (along < 0 || along > r.len) continue;
      const q = r.h * Math.pow(1 - along / r.len, 1.1) - perp * (r.h / r.w) * 0.9;
      if (q > h) h = q;
    }
    return h > 0.4 ? h : -1;
  }, (kind, m, x, y, z, nx, ny, nz) => {
    const I = lit(nx, ny, nz);
    return (BARK << 8) | (kind === 1 ? 1 : I > 0.62 ? 4 : I > 0.4 ? 3 : I > 0.15 ? 2 : 1);
  });
  // gnarled trunk + two limbs reaching into the canopy (sphere-swept tubes)
  const bs = hash3(seed, 201, 3);
  const barkSh = (I, u, v, s, i, j) => { let t = tone5(I); if (t > 1 && hrand(bs, i, j >> 1) < 0.16) t--; return (BARK << 8) | t; };
  const zt = zc - Ry * 0.1, amp = R * 0.16 * side, ph = rn.range(0, 1);
  const pts = [];
  for (let k = 0; k <= 6; k++) {
    const f = k / 6;
    pts.push([amp * (Math.sin((f * 1.4 + ph) * Math.PI) - Math.sin(ph * Math.PI)), 0, zt * f, rt * (1 - 0.42 * f)]);
  }
  T.tube(pts, barkSh);
  const P = pts[4];
  for (const sg of [-1, 1]) {
    const ex = sg * Rx * rn.range(0.5, 0.7), ez = zc + Ry * rn.range(-0.15, 0.2);
    T.tube([[P[0], 0, P[2], P[3] * 0.8], [P[0] + (ex - P[0]) * 0.45, 0.5, P[2] + (ez - P[2]) * 0.3, P[3] * 0.55], [ex, 1, ez, 0.9]], barkSh);
  }
  depthEdges(p, 3);
  // blossom canopy (screen space, painter's order), drawn once into its own layer
  const oyC = cy - zc;
  const balls = [{ x: 0, y: -Ry * 0.15, r: Ry * 0.85 }];
  const nRing = Rx > 22 ? 8 : 7, r0 = rn() * TAU;
  for (let k = 0; k < nRing; k++) {
    const an = r0 + (k / nRing) * TAU + rn.range(-0.2, 0.2);
    balls.push({ x: Math.cos(an) * Rx * 0.62, y: Math.sin(an) * Ry * 0.5, r: Ry * rn.range(0.55, 0.72) });
  }
  balls.push({ x: -Rx * rn.range(0.2, 0.4), y: Ry * 0.42, r: Ry * 0.55 }, { x: Rx * rn.range(0.2, 0.4), y: Ry * 0.45, r: Ry * 0.52 });
  balls.sort((a, b) => a.y - b.y);
  const LS = norm3(-0.55, -0.62, 0.56);
  const leafN = hash3(seed, 201, 4), fs = hash3(seed, 201, 5);
  const edgeN = balls.map((b, k) => ringNoise(hash3(seed, 60 + k, 1), 9));
  const cl = new Pix(p.w, p.h);
  balls.forEach((b, bk) => {
    const bx = cx + b.x, by = oyC + b.y, r = b.r;
    for (let j = Math.floor(by - r) - 1; j <= Math.ceil(by + r) + 1; j++) {
      for (let i = Math.floor(bx - r) - 1; i <= Math.ceil(bx + r) + 1; i++) {
        const ux = (i + 0.5 - bx) / r, uy = (j + 0.5 - by) / r, qd = ux * ux + uy * uy;
        if (qd > 1) continue;
        const lim = qd < 0.8 ? 1 : 1 - 0.18 * (0.5 + 0.5 * edgeN[bk](Math.atan2(uy, ux) * 2.5));
        if (qd > lim) continue;
        const nz = Math.sqrt(Math.max(0, 1 - qd));
        let I = ux * LS[0] + uy * LS[1] + nz * LS[2];
        I -= 0.34 * clamp((j + 0.5 - oyC) / Ry, -0.3, 1);
        I += (vnoise(leafN, i / 1.5, j / 1.3) - 0.5) * 0.55;
        let t = I > 0.86 ? 5 : I > 0.62 ? 4 : I > 0.38 ? 3 : I > 0.12 ? 2 : I > -0.2 ? 1 : 0;
        if (bk > 0 && qd > lim - 0.18 && ux + uy > 0.3) t = Math.max(0, t - 1);
        cl.set(i, j, BLOS, t);
      }
    }
  });
  despeckle(cl, BLOS);
  for (let j = 1; j < cl.h - 1; j++) {
    for (let i = 1; i < cl.w - 1; i++) {
      if (cl.mat(i, j) !== BLOS) continue;
      const t = cl.tone(i, j), h = hrand(fs, i, j);
      if (t >= 4 && h < 0.08) cl.set(i, j, PET, 0);                 // white blossoms catching the light
      else if (t <= 1 && h < 0.05) cl.set(i, j, BLOS, 3);           // lit flowers in the shade
    }
  }
  // a few petals drifting under the canopy
  for (let k = 0; k < 3; k++) {
    const i = AX + Math.round(rn.range(-0.9, 0.9) * Rx), j = Math.round(oyC + Ry * rn.range(0.95, 1.5));
    if (!p.mat(i, j) && !cl.mat(i, j)) cl.set(i, j, PET, 1);
  }
  const frames = [];
  for (let f0 = 0; f0 < 2; f0++) {
    const f = (f0 + seed) & 1;                        // odd seeds sway in counter-phase
    const q = p.clone();
    for (let j = 0; j < cl.h; j++) {
      for (let i = 0; i < cl.w - 1; i++) {
        const k = j * cl.w + i;
        if (cl.m[k]) { q.m[k + f] = cl.m[k]; q.t[k + f] = cl.t[k]; }
      }
    }
    outline(q, mats);
    frames.push(q);
  }

  // ── floor decal: dappled shade + fallen petals ──
  const DG = area(Rx * 1.3 + 6, R * 0.9 + 6, R * 0.9 + 8);
  const d = new Dec(DG.W, DG.H);
  const scx = DG.cx + Rx * 0.15, scy = DG.cy + R * 0.15;
  for (let j = 0; j < DG.H; j++) {
    for (let i = 0; i < DG.W; i++) {
      const dx = (i + 0.5 - scx) / Rx, dy = (j + 0.5 - scy) / (Rx * 0.5), qd = dx * dx + dy * dy;
      if (qd > 1) continue;
      const hole = hrand(seed, (i >> 1) + 50, (j >> 1) + 50) > 0.9;
      d.over(i, j, [30, 8, 16], hole ? 0.08 : qd > 0.8 ? 0.18 : 0.28);
    }
  }
  const pc = [rgb('#f7bcd2'), rgb('#e888ad'), rgb('#ffe8f1'), rgb('#c65a87')];
  for (let k = 0; k < (R < 16 ? 8 : 12); k++) {
    const x = Math.floor(DG.cx + rn.range(-1.25, 1.25) * Rx), y = Math.floor(DG.cy + rn.range(-0.3, 1.0) * R * 0.75);
    d.over(x, y, pc[rn.int(0, 2)], 1);
    if (rn() < 0.4) d.over(x + 1, y, pc[3], 1);
  }
  return finish(frames, mats, G, d, DG, 1.5);
}

function lantern(R, seed, K) {
  const { SQ, clamp, hash3, stream, vnoise, C, pal, rgb, lit, Pix, Dec, area, renderHF, slab, octFace, cylTone, depthEdges, outline, finish, dShadow, dEllipse, dPebble } = K;
  const rn = stream(seed, 202);
  const LS = 1, GL = 2, LM = 3;
  const OL = C('#151210');
  const mats = [null,
    { pal: pal('#25221f', '#38332f', '#4f4943', '#6b645b', '#8c8478', '#b0a799'), ol: OL, pr: 2 },
    { pal: pal('#5e2408', '#b85a18', '#ee9a34', '#ffd072', '#fff3c6'), ol: OL, pr: 1 },
    { pal: pal('#2e3a1c', '#435426', '#5d7032'), ol: OL, pr: 1 },
  ];
  const faceT = [4, 4, 3, 2, 1];
  const aB = Math.max(3, Math.round(R * 0.62)), hB = Math.max(2, Math.round(R * 0.18));
  const aB2 = Math.max(2, aB - 2), hB2 = hB + Math.max(1, Math.round(R * 0.12));
  const rS = Math.max(1.6, R * 0.2), zS1 = hB2 + Math.round(R * 1.05);
  const aM = Math.max(3, Math.round(R * 0.5)), zM = zS1 + Math.max(2, Math.round(R * 0.2));
  const aL = Math.max(2, Math.round(R * 0.36)), zL = zM + Math.max(5, Math.round(R * 0.72));
  const aR = Math.max(4, Math.round(R * 0.82)), eave = Math.max(1.5, Math.round(R * 0.14)), rise = Math.max(3, Math.round(R * 0.45));
  const zRt = zL + eave + rise;
  const rF = Math.max(1.3, R * 0.15), zF = zRt + rF * 2.8;
  const G = area(aR + 3, zF + aR * SQ + 5, aB * SQ + 3);
  const p = new Pix(G.W, G.H);
  const { cx, cy } = G;
  const T = geo(K, p, G);
  const oct = (kind, m, x, y, z, nx, ny, nz, i, j, ft, fb) => {
    if (kind === 0) return (LS << 8) | 4;
    let t = faceT[octFace(x, y) + 2];
    if (ft === 1) t = Math.min(5, t + 1); else if (fb === 0) t = Math.max(0, t - 1);
    return (LS << 8) | t;
  };
  slab(p, cx, cy, 2, aB, 0, hB, oct, LS);
  slab(p, cx, cy, 2, aB2, hB, hB2, oct, LS);
  T.lathe(0, 0, hB2, zS1, (z) => rS * (1 - 0.08 * (z - hB2) / (zS1 - hB2)), (u, z) => (LS << 8) | (z < hB2 + 1 ? Math.max(1, cylTone(u) - 1) : cylTone(u)), null);
  slab(p, cx, cy, 2, aM, zS1, zM, oct, LS);
  // light box with a glowing window (lattice bar in the middle)
  const glowPx = [];
  const ww = Math.max(1, aL - 2);
  slab(p, cx, cy, 1, aL, zM, zL, (kind, m, x, y, z, nx, ny, nz, i, j, ft, fb) => {
    if (kind === 0) return (LS << 8) | 4;
    if (Math.abs(x) <= ww && z > zM + 1 && z < zL - 1) {
      if (ww >= 2 && x === 0) return (LS << 8) | 1;
      glowPx.push([i, j, x, (z - zM - 1) / Math.max(1, zL - zM - 2)]);
      return (GL << 8) | 2;
    }
    return (LS << 8) | (x <= -aL + 0.5 ? 4 : x >= aL - 0.5 ? 2 : fb === 0 ? 2 : 3);
  }, LS);
  // wide curved roof (concave octagonal pyramid) with moss
  const mz = hash3(seed, 202, 9);
  const octD = (x, y) => { const ax = Math.abs(x), ay = Math.abs(y); return Math.max(ax, ay, (ax + ay) / Math.SQRT2); };
  renderHF(p, cx, cy, { x0: -aR - 1.5, x1: aR + 1.5, y0: -aR - 1.5, y1: aR + 1.5, z0: zL, mat: LS }, (x, y) => {
    const o = octD(x, y);
    if (o > aR + 0.25) return -1;
    return zL + eave + rise * Math.pow(Math.max(0, 1 - o / (aR + 0.25)), 1.7);
  }, (kind, m, x, y, z, nx, ny, nz, i, j, ft) => {
    if (kind === 1) return (LS << 8) | (ft === 1 ? 4 : 2);
    const I = lit(nx, ny, nz);
    if (vnoise(mz, x / 2.2, y / 2) > 0.72) return (LM << 8) | (I > 0.75 ? 2 : 1);
    return (LS << 8) | (I > 0.86 ? 5 : I > 0.7 ? 4 : I > 0.45 ? 3 : I > 0.2 ? 2 : 1);
  });
  // onion finial
  T.lathe(0, 0, zRt - 1, zF, (z) => {
    const t = (z - zRt + 1) / (zF - zRt + 1);
    return t < 0.3 ? rF * 0.6 : rF * 1.05 * Math.sqrt(Math.max(0, 1 - ((t - 0.64) / 0.36) ** 2));
  }, (u, z) => (LS << 8) | Math.min(5, cylTone(u) + (z > zF - 1.5 ? 1 : 0)), null);
  depthEdges(p, 3);
  outline(p, mats);
  const fl = [0, 1, 0, -1], ph = seed & 3, frames = [];
  for (let f = 0; f < 4; f++) {
    const q = p.clone(), k = fl[(f + ph) & 3];
    for (const [i, j, x, v] of glowPx) {
      if (q.mat(i, j) !== GL) continue;
      const t = 3 - (Math.abs(x) >= ww ? 1 : 0) - (v > 0.75 ? 1 : 0) + (v < 0.4 && Math.abs(x) < ww ? 1 : 0) + k;
      q.setTone(i, j, clamp(t, 1, 4));
    }
    frames.push(q);
  }

  const DG = area(R * 1.5 + 6, R * 0.9 + 6, R * 0.9 + 8);
  const d = new Dec(DG.W, DG.H);
  for (let g = 3; g >= 1; g--) dEllipse(d, DG.cx, DG.cy + 0.5, R * 0.9 + g * 2.4, R * SQ + g * 1.4, [255, 170, 70], 0.04 + (3 - g) * 0.02);
  dShadow(d, DG.cx + R * 0.12, DG.cy + R * 0.08, aR + 1, aB * SQ + 2, 0.36, [16, 8, 2]);
  const peb = [rgb('#b0a799'), rgb('#8c8478'), rgb('#4f4943'), rgb('#151210')];
  for (let q = 0; q < 2; q++) {
    const an = rn.range(0.1, 0.9) * Math.PI;
    dPebble(d, Math.round(DG.cx + Math.cos(an) * R * 1.02), Math.round(DG.cy + Math.sin(an) * R * 0.58), 2, 2, peb, rn);
  }
  return finish(frames, mats, G, d, DG, 5);
}

// ═════════════════════════════════════════════════════════════════════════════
//  SHIP — a mast with a yard and furled sail (big footprints) or a barrel cluster
// ═════════════════════════════════════════════════════════════════════════════
function shipMats(C, pal) {
  return [null,
    { pal: pal('#26170c', '#3e2614', '#5a3a1e', '#7a522a', '#9a6c38', '#bc8a4c'), ol: C('#140c06'), pr: 2 },   // 1 wood
    { pal: pal('#16171b', '#282a30', '#42454d', '#646872'), ol: C('#0a0a0c'), pr: 3 },                         // 2 iron
    { pal: pal('#4e3b20', '#7c6036', '#a88a54', '#d2b882'), ol: null, pr: 0 },                                  // 3 rigging rope
    { pal: pal('#5e5242', '#8a7c66', '#b4a68a', '#d8ccb0', '#f2ead6'), ol: C('#2c241a'), pr: 1 },               // 4 sail
    { pal: pal('#111114', '#202026', '#34343c', '#e6e2d6'), ol: C('#060608'), pr: 4 },                          // 5 flag
    { pal: pal('#4e3b20', '#7c6036', '#a88a54', '#d2b882'), ol: C('#22160a'), pr: 1 },                          // 6 coiled rope
    { pal: pal('#3a2a14', '#5a4220', '#7c5c30', '#9c7840', '#bc9454'), ol: C('#1a1208'), pr: 2 },               // 7 crate
  ];
}
const WD = 1, IRN = 2, ROPE = 3, SAIL = 4, FLAG = 5, COIL = 6, CRATE = 7;
function ropeCoil(K, p, G, ox, oy, rc, hc) {
  const { renderHF, len2, lit } = K;
  renderHF(p, G.cx, G.cy, { x0: ox - rc - 1.5, x1: ox + rc + 1.5, y0: oy - rc - 1.5, y1: oy + rc + 1.5, mat: COIL }, (x, y) => {
    const dd = len2(x - ox, y - oy);
    if (dd > rc + 0.3 || dd < rc * 0.3) return -1;
    return hc * (0.55 + 0.45 * Math.sin(fr(dd / 1.3) * Math.PI));
  }, (kind, m, x, y, z, nx, ny, nz) => {
    if (kind === 1) return (COIL << 8) | 1;
    const g = fr(len2(x - ox, y - oy) / 1.3);
    if (g < 0.2 || g > 0.85) return (COIL << 8) | 0;
    const I = lit(nx, ny, nz);
    return (COIL << 8) | (I > 0.7 ? 3 : I > 0.4 ? 2 : 1);
  });
}

function mast(R, seed, K) {
  const { SQ, hash3, hrand, stream, C, pal, Pix, Dec, area, slab, octFace, cylTone, depthEdges, outline, finish, dShadow } = K;
  const rn = stream(seed, 301);
  const mats = shipMats(C, pal);
  const side = rn.sign();
  const vis = Math.min(100, Math.round(4.5 * R + 4));
  const rs = Math.max(2.6, R * 0.25);
  const aC = Math.round(rs + Math.max(2, R * 0.15)), hC = Math.max(3, Math.round(R * 0.22));
  const zPole = vis - R * SQ - 3;
  const zM1 = zPole - Math.max(5, Math.round(R * 0.35));
  const zY = zM1 - Math.max(6, Math.round(R * 0.5));
  const Ly = Math.min(R * 1.3, R + 8), ry = Math.max(1.3, rs * 0.42);
  const G = area(Math.max(R, Ly) + 4, vis + 4, R * SQ + 4);
  const p = new Pix(G.W, G.H);
  const { cx, cy, AX } = G;
  const T = geo(K, p, G);
  const gs = hash3(seed, 301, 1);
  // wooden collar (mast partner) with an iron band
  slab(p, cx, cy, 2, aC, 0, hC, (kind, m, x, y, z, nx, ny, nz, i, j, ft, fb) => {
    if (kind === 0) return (WD << 8) | 4;
    if (ft === 1) return (IRN << 8) | 3;
    let t = [4, 4, 3, 2, 1][octFace(x, y) + 2];
    if (fb === 0) t = Math.max(0, t - 1);
    return (WD << 8) | t;
  }, WD);
  // the mast: tapered, iron bands, grain
  const bands = [];
  const nb = Math.max(2, Math.round((zY - hC) / 13));
  for (let b = 0; b < nb; b++) bands.push(hC + 4 + ((zY - hC - 8) * b) / Math.max(1, nb - 1));
  const inBand = (z) => bands.some((bz) => z >= bz && z < bz + 2);
  T.lathe(0, 0, hC, zM1 - 2, (z) => rs * (1 - 0.2 * z / zM1) + (inBand(z) ? 0.6 : 0), (u, z, i) => {
    const t = cylTone(u);
    if (inBand(z)) return (IRN << 8) | Math.max(0, t - 2);
    return (WD << 8) | (hrand(gs, i, Math.floor(z / 5)) < 0.16 ? Math.max(1, t - 1) : t);
  }, () => (WD << 8) | 4);
  // mast head block + flag pole
  const aH = Math.max(1.5, rs * 0.8);
  T.box(0, 0, aH, aH, zM1 - 3, zM1, (kind, m, x, y, z, nx, ny, nz, i, j, ft) => (WD << 8) | (kind === 0 ? 5 : x < -aH * 0.3 ? 4 : x > aH * 0.3 ? 2 : 3), WD);
  T.tube([[0, 0, zM1, 0.55], [0, 0, zPole, 0.5]], (I) => (IRN << 8) | (I > 0.3 ? 3 : 2));
  // yard across the front of the mast with the sail furled beneath it
  const yy = rs * 0.9;
  T.tube([[-Ly, yy, zY, ry * 0.65], [-Ly * 0.5, yy, zY, ry], [0, yy, zY, ry * 1.1], [Ly * 0.5, yy, zY, ry], [Ly, yy, zY, ry * 0.65]], (I) => (WD << 8) | tone6(I));
  const Ls = Ly * 0.84, rsl = Math.max(1.8, R * 0.17), zs = zY - ry * 0.5 - rsl * 0.75;
  const sp = [];
  for (let k = 0; k <= 8; k++) {
    const f = k / 8;
    sp.push([-Ls + 2 * Ls * f, yy + 0.8, zs - Math.sin(f * Math.PI) * rsl * 0.3, rsl * (0.7 + 0.3 * Math.sin(f * Math.PI)) * (0.9 + 0.2 * hrand(gs, k, 9))]);
  }
  T.tube(sp, (I, u, v, s, i) => ((i - AX + 64) % 5 === 0 && Math.abs(u) < 0.9 ? (COIL << 8) | (I > 0.3 ? 2 : 1) : (SAIL << 8) | tone5(I)));
  // rigging: lifts from the yard arms to the mast head, shrouds + ratlines down to the deck
  const ropeSh = (I) => (ROPE << 8) | (I > 0.2 ? 3 : 2);
  for (const sg of [-1, 1]) {
    T.tube([[sg * Ly * 0.9, yy, zY, 0.45], [sg * 0.8, 0, zM1 - 1, 0.45]], ropeSh);
    const top = [sg * rs * 0.7, 0.5, zY - ry - 1], fa = [sg * R * 0.95, R * 0.28, 0.5], fb = [sg * R * 0.7, R * 0.55, 0.5];
    T.tube([[...top, 0.45], [...fa, 0.45]], ropeSh);
    T.tube([[...top, 0.45], [...fb, 0.45]], ropeSh);
    for (let z = 4; z < top[2] * 0.72; z += 4) {
      const f = (top[2] - z) / (top[2] - 0.5);
      const A = [top[0] + (fa[0] - top[0]) * f, top[1] + (fa[1] - top[1]) * f, z], B = [top[0] + (fb[0] - top[0]) * f, top[1] + (fb[1] - top[1]) * f, z];
      T.tube([[...A, 0.4], [...B, 0.4]], ropeSh);
    }
  }
  ropeCoil(K, p, G, -side * R * 0.5, R * 0.45, Math.max(2.5, R * 0.22), Math.max(1.5, R * 0.1));
  if (R >= 15) ropeCoil(K, p, G, side * R * 0.55, -R * 0.2, Math.max(2, R * 0.16), Math.max(1.2, R * 0.08));
  depthEdges(p, 3);
  // pirate pennant at the very top: two-frame flutter
  const fw = Math.max(5, Math.round(R * 0.5)), fh = Math.max(4, Math.round(R * 0.32));
  const jf = Math.floor(cy - zPole) + 1;
  const frames = [];
  for (let f0 = 0; f0 < 2; f0++) {
    const f = (f0 + seed) & 1;
    const q = p.clone();
    for (let c = 0; c < fw; c++) {
      const w = Math.sin(c * 0.8 - f * Math.PI);
      const off = Math.round(w * 0.9 * (c / fw));
      const hh = fh - Math.floor(c / (fw * 0.6)) * (c === fw - 1 ? 1 : 0);
      for (let r = 0; r < hh; r++) q.set(AX + 1 + c, jf + r + off, FLAG, w > 0.35 ? 2 : r === 0 ? 2 : 1);
    }
    if (R >= 13) {
      const sc = AX + 1 + Math.floor(fw / 2) - 1, sr = jf + Math.floor(fh / 2) - 1 + Math.round(Math.sin((fw / 2 - 1) * 0.8 - f * Math.PI) * 0.45);
      q.set(sc, sr, FLAG, 3); q.set(sc + 1, sr, FLAG, 3); q.set(sc, sr + 1, FLAG, 3); q.set(sc + 1, sr + 1, FLAG, 3);
    }
    outline(q, mats);
    frames.push(q);
  }
  const DG = area(R * 1.5 + 6, R * 0.9 + 6, R * 0.9 + 8);
  const d = new Dec(DG.W, DG.H);
  dShadow(d, DG.cx + R * 0.14, DG.cy + R * 0.08, aC + 3, aC * SQ + 2, 0.38, [14, 8, 2]);
  return finish(frames, mats, G, d, DG, 3);
}

function barrels(R, seed, K) {
  const { SQ, stream, C, pal, rgb, Pix, Dec, area, cylTone, depthEdges, outline, finish, dShadow, dPebble } = K;
  const rn = stream(seed, 302);
  const mats = shipMats(C, pal);
  const side = rn.sign();
  const hb = Math.round(R * 1.3), rb = R * 0.43;
  const three = rn() < 0.5;
  const list = [{ x: -side * R * 0.37, y: -R * 0.2, r: rb, h: hb }, { x: side * R * 0.44, y: -R * 0.3, r: rb * 0.9, h: Math.round(hb * 0.88) }];
  if (three) list.push({ x: side * R * 0.08, y: R * 0.42, r: rb * 0.78, h: Math.round(hb * 0.7) });
  const G = area(R + 5, hb + R * SQ + 6, R * SQ + 5);
  const p = new Pix(G.W, G.H);
  const T = geo(K, p, G);
  for (const o of list) {
    const { x: ox, y: oy, r, h } = o;
    const hoop = (z) => { const f = z / h; return f < 0.1 || (f > 0.22 && f < 0.22 + 1.6 / h) || (f > 0.78 - 1.6 / h && f < 0.78) || f > 0.93; };
    T.lathe(ox, oy, 0, h, (z) => r * (0.84 + 0.16 * Math.sin((Math.PI * z) / h)), (u, z) => {
      const t = cylTone(u);
      if (hoop(z)) return (IRN << 8) | Math.max(0, Math.min(3, t - 2));
      const sv = (Math.asin(u) / Math.PI + 0.5) * 7;
      return (WD << 8) | (fr(sv) < 0.2 && sv > 0.6 && sv < 6.4 ? Math.max(0, t - 2) : t);
    }, (dx, dy, rr) => {
      if (dx * dx + dy * dy > (rr - 1.1) * (rr - 1.1)) return (IRN << 8) | 2;
      if (Math.abs(dx - rr * 0.35) < 0.6 && Math.abs(dy) < 0.6) return (WD << 8) | 1;          // bung
      return (WD << 8) | ((Math.floor(dx + 100) % 3 === 0) ? 3 : dx < 0 ? 5 : 4);
    });
  }
  if (!three) {
    const a = Math.max(2.5, R * 0.28), h = Math.max(4, Math.round(R * 0.62)), ox = side * R * 0.36, oy = R * 0.4;
    T.box(ox, oy, a, a, 0, h, (kind, m, x, y, z, nx, ny, nz, i, j, ft, fb) => {
      const lx = x - ox;
      if (kind === 0) return (CRATE << 8) | (Math.abs(lx) >= a - 0.5 || Math.abs(y - oy) >= a - 0.7 ? 3 : Math.floor(y * 2) % 3 === 0 ? 2 : 4);
      if (Math.abs(lx) >= a - 0.5 || ft === 1 || fb === 0) return (CRATE << 8) | (lx < 0 ? 3 : 2);
      if (Math.abs(lx - (z - h / 2) * (a / (h / 2))) < 0.8) return (CRATE << 8) | 4;
      return (CRATE << 8) | (Math.floor(z) % 3 === 0 ? 1 : 2);
    }, CRATE);
  }
  ropeCoil(K, p, G, -side * R * 0.42, R * 0.52, Math.max(2.2, R * 0.2), Math.max(1.3, R * 0.1));
  depthEdges(p, 2.5);
  outline(p, mats);
  const DG = area(R * 1.5 + 5, R * 0.9 + 5, R * 0.9 + 7);
  const d = new Dec(DG.W, DG.H);
  dShadow(d, DG.cx + R * 0.14, DG.cy + R * 0.06, R * 0.98 + 1, R * 0.46 + 1, 0.36, [14, 8, 2]);
  const bits = [rgb('#bc8a4c'), rgb('#7a522a'), rgb('#3e2614'), rgb('#140c06')];
  const an = rn.range(0.1, 0.9) * Math.PI;
  dPebble(d, Math.round(DG.cx + Math.cos(an) * R * 1.05), Math.round(DG.cy + Math.sin(an) * R * 0.6), 3, 1, bits, rn);
  return finish([p], mats, G, d, DG, 0);
}

// ═════════════════════════════════════════════════════════════════════════════
//  ROOFTOP — a rain-slick AC / ventilation unit with a spinning fan and a blinking LED
// ═════════════════════════════════════════════════════════════════════════════
function acUnit(R, seed, K) {
  const { SQ, TAU, HF, len2, hash3, hrand, stream, ringNoise, C, pal, Pix, Dec, area, renderHF, cylTone, depthEdges, outline, finish, dShadow } = K;
  const rn = stream(seed, 401);
  const MET = 1, DKF = 2, LED = 3, NEON = 4;
  const OL = C('#08090d');
  const cyanLed = rn() < 0.5;
  const mats = [null,
    { pal: pal('#151920', '#222731', '#323946', '#48515f', '#65707f', '#8f9bab', '#c4d0dc'), ol: OL, pr: 2 },
    { pal: pal('#050608', '#0d1015', '#171b22'), ol: OL, pr: 1 },
    { pal: cyanLed ? pal('#0c2a30', '#1a8a9a', '#46f2ff', '#d4ffff') : pal('#2e0a0e', '#9a1a26', '#ff3a4a', '#ffc4c8'), ol: OL, pr: 3 },
    { pal: pal('#4a1a4e', '#9a2c96', '#e04ad0', '#ff9af0'), ol: OL, pr: 1 },
  ];
  const side = rn.sign();
  const bw = Math.round(R * 0.86), bd = Math.round(R * 0.56), zS = 2, zT = zS + Math.round(R * 0.9);
  const rf = Math.max(2.5, Math.min(bd - 1.5, bw * 0.55)), fx = Math.round(-bw * 0.22) * side, fy = -0.5;
  const rv = Math.max(1.4, R * 0.12), vx = Math.round(bw * 0.62) * side, vy = -Math.round(bd * 0.45), zV = zT + Math.max(4, Math.round(R * 0.5));
  const G = area(bw + 4, zV + bd * SQ + 6, bd * SQ + 4);
  const p = new Pix(G.W, G.H);
  const { cx, cy, AX } = G;
  const T = geo(K, p, G);
  const ds = hash3(seed, 401, 2);
  const seam = Math.max(2, Math.round(bw * 0.34));
  // skids
  for (const sy of [-1, 1]) T.box(0, sy * bd * 0.6, bw - 1, 1, 0, zS, (kind) => (MET << 8) | (kind === 0 ? 2 : 1), MET);
  // cabinet: louvred side panels, seams, wet top edge, a magenta neon rim light on the right
  T.box(0, 0, bw, bd, zS, zT, (kind, m, x, y, z, nx, ny, nz, i, j, ft, fb) => {
    if (kind === 0) {
      if (x >= bw - 0.5) return (NEON << 8) | 1;
      if (y > bd - 0.8 || x <= -bw + 0.5) return (MET << 8) | 5;
      if (hrand(ds, i, j) < 0.05 || ((i * 2 + j * 3) % 11 === 0 && hrand(ds, j, i) < 0.5)) return (MET << 8) | 6;
      return (MET << 8) | 4;
    }
    if (ft === 1) return (MET << 8) | 6;
    if (x >= bw - 0.5) return (NEON << 8) | (fb === 0 ? 0 : 1);
    if (x <= -bw + 0.5) return (MET << 8) | 4;
    if (fb === 0) return (MET << 8) | 1;
    const ax = Math.abs(x);
    if (ax === seam) return (MET << 8) | 1;
    if (ax === seam + 1) return (MET << 8) | 4;
    if (ax > seam + 1 && ax < bw - 1 && z - zS > 1.5 && z < zT - 2) return (MET << 8) | ((j & 1) ? 1 : 3);
    if (hrand(ds, i, j) < 0.05) return (MET << 8) | 5;
    return (MET << 8) | 3;
  }, MET);
  // round fan housing on top; the interior is re-shaded per frame
  const fanPx = [];
  renderHF(p, cx, cy, { x0: fx - rf - 1.5, x1: fx + rf + 1.5, y0: fy - rf - 1.5, y1: fy + rf + 1.5, z0: zT, mat: MET }, (x, y) => {
    const dd = len2(x - fx, y - fy);
    if (dd > rf + 0.3) return -1;
    if (dd > rf - 1.3) return zT + 1.5;
    HF.mat = DKF;
    return zT + 0.3;
  }, (kind, m, x, y, z, nx, ny, nz, i, j, ft) => {
    if (m === DKF) { fanPx.push([i, j, x - fx, y - fy]); return (DKF << 8) | 0; }
    if (kind === 1) return (MET << 8) | (ft === 1 ? 5 : 2);
    return (MET << 8) | (x - fx < 0 ? 6 : 5);
  });
  // vent stack with a rain cap
  T.lathe(vx, vy, zT, zV, (z) => (z > zV - 1.6 ? rv * 1.7 : rv), (u, z) => (MET << 8) | Math.min(6, cylTone(u) + (z > zV - 1.6 ? 1 : 0)), (dx) => (MET << 8) | (dx < 0 ? 6 : 5));
  depthEdges(p, 3);
  // status LED (and a little label plate) on the centre panel
  const jL = Math.floor(cy + bd * SQ - (zT - 2.5)), iL = AX + seam - 2;
  const big = R >= 14;
  for (let q = -seam + 2; q <= -seam + 4; q++) { paint(p, AX + q, jL, MET, 5); paint(p, AX + q, jL + 1, MET, 4); }
  outline(p, mats);
  const nb = 4, dir = side, frames = [];
  for (let f = 0; f < 4; f++) {
    const q = p.clone(), off = dir * (f / 4) * (TAU / nb);
    for (const [i, j, x, y] of fanPx) {
      if (q.mat(i, j) !== DKF) continue;
      const dd = len2(x, y);
      if (dd < rf * 0.3) { q.set(i, j, MET, x < 0 ? 5 : 3); continue; }
      if (Math.abs(dd - rf * 0.68) < 0.4) { q.set(i, j, MET, 2); continue; }
      const b = fr(((Math.atan2(y, x) - off) * nb) / TAU);
      if (b < 0.38) q.set(i, j, MET, b < 0.14 ? 4 : 3);
      else q.set(i, j, DKF, b < 0.55 ? 0 : 1);
    }
    const on = f === 0 || f === 1;
    q.set(iL, jL, LED, on ? 3 : 0);
    if (big) q.set(iL + 1, jL, LED, on ? 2 : 0);
    frames.push(q);
  }

  // ── floor decal: dark wet shadow + a puddle with a neon reflection ──
  const DG = area(R * 1.6 + 6, R * 0.9 + 6, R * 0.95 + 9);
  const d = new Dec(DG.W, DG.H);
  dShadow(d, DG.cx + R * 0.12, DG.cy + R * 0.08, bw + 2.5, bd * SQ + 2.5, 0.5, [4, 6, 12]);
  const pN = ringNoise(hash3(seed, 401, 5), 7);
  const px0 = DG.cx - side * R * rn.range(0.25, 0.55), py0 = DG.cy + bd * SQ + R * 0.32;
  const prx = R * rn.range(0.5, 0.7), pry = Math.max(2, prx * 0.34);
  for (let j = Math.floor(py0 - pry * 1.4); j <= py0 + pry * 1.4; j++) {
    for (let i = Math.floor(px0 - prx * 1.4); i <= px0 + prx * 1.4; i++) {
      const u = (i + 0.5 - px0) / prx, v = (j + 0.5 - py0) / pry, qd = len2(u, v) / (1 + 0.2 * pN(Math.atan2(v, u)));
      if (qd > 1) continue;
      d.over(i, j, qd > 0.78 ? [72, 82, 104] : [34, 40, 56], qd > 0.78 ? 0.6 : 0.75);
    }
  }
  const sxM = Math.floor(px0 + prx * 0.25), sxC = Math.floor(px0 - prx * 0.35);
  for (let j = Math.floor(py0 - pry * 0.7); j <= py0 + pry * 0.7; j++) {
    d.over(sxM, j, [255, 80, 220], 0.7); d.over(sxM + 1, j, [255, 80, 220], 0.3);
    if (Math.abs(j + 0.5 - py0) < pry * 0.45) d.over(sxC, j, [70, 240, 255], 0.55);
  }
  return finish(frames, mats, G, d, DG, 10);
}

// ═════════════════════════════════════════════════════════════════════════════
//  CASTLE — a two-tier stone fountain (big footprints) or a knight statue on a plinth
// ═════════════════════════════════════════════════════════════════════════════
function castleMats(C, pal) {
  const OL = C('#15130f');
  return [null,
    { pal: pal('#2a2724', '#403b36', '#5a544d', '#78716a', '#9a938a', '#c0b9ae'), ol: OL, pr: 2 },     // 1 warm limestone
    { pal: pal('#10304e', '#184870', '#246896', '#3a8cbc', '#72bade', '#c6eefa'), ol: C('#0a1828'), pr: 1 },   // 2 water
    { pal: pal('#2c3a1e', '#415428', '#5a6e34'), ol: OL, pr: 1 },                                       // 3 moss
    { pal: pal('#23252b', '#373a42', '#51555e', '#6f747d', '#92979f', '#bcc0c7'), ol: C('#101116'), pr: 3 },    // 4 statue stone
  ];
}
function fountain(R, seed, K) {
  const { SQ, TAU, HF, len2, hash3, hrand, stream, C, pal, Pix, Dec, area, renderHF, cylTone, depthEdges, outline, finish, dShadow, dEllipse } = K;
  const rn = stream(seed, 501);
  const LS = 1, WAT = 2;
  const mats = castleMats(C, pal);
  const rO = R * 0.96, rI = rO - Math.max(2, Math.round(R * 0.13)), hw = Math.max(4, Math.round(R * 0.3)), zw = hw - 1.5;
  const rPd = Math.max(2, R * 0.12);
  const zB1 = hw + Math.round(R * 0.42), hb1 = Math.max(3, Math.round(R * 0.14)), rb1 = R * 0.46;
  const zB2 = zB1 + hb1 + Math.round(R * 0.3), hb2 = Math.max(2, Math.round(R * 0.1)), rb2 = R * 0.24;
  const zSp = zB2 + hb2 + Math.max(3, Math.round(R * 0.13));
  const jh = Math.max(4, Math.round(R * 0.22)), zJ = zSp + jh;
  const G = area(R + 3, zJ + 6, R * SQ + 4);
  const p = new Pix(G.W, G.H);
  const { cx, cy, AX } = G;
  const T = geo(K, p, G);
  const nH = Math.max(5, Math.round(rO * 0.45));               // wall blocks across the front half
  const blk = (x) => Math.floor((Math.acos(Math.max(-1, Math.min(1, x / rO))) * nH) / Math.PI);
  const waterPx = [];
  renderHF(p, cx, cy, { x0: -rO - 1.5, x1: rO + 1.5, y0: -rO - 1.5, y1: rO + 1.5, mat: LS }, (x, y) => {
    const dd = len2(x, y);
    if (dd > rO + 0.3) return -1;
    if (dd >= rI) return hw;
    HF.mat = WAT;
    return zw;
  }, (kind, m, x, y, z, nx, ny, nz, i, j, ft, fb) => {
    if (m === WAT) { waterPx.push([i, j, x, y]); return (WAT << 8) | 2; }
    const dd = len2(x, y);
    if (kind === 0) return (LS << 8) | (fr((Math.atan2(y, x) / Math.PI) * nH + 0.5) < 0.1 ? 3 : dd > rO - 1 && y > 0 ? 5 : 4);
    if (dd < (rI + rO) / 2) return (LS << 8) | (ft === 1 ? 2 : 1);         // inner back wall above the water
    let t = cylTone(x / rO);
    if (ft === 1) t = Math.min(5, t + 1); else if (fb === 0) t = Math.max(1, t - 1);
    const zz = z, upper = zz > hw / 2;
    if (zz >= hw / 2 - 0.5 && zz < hw / 2 + 0.5) t = Math.max(1, t - 1);
    else if (blk(x + (upper ? rO / nH : 0)) !== blk(x + 1 + (upper ? rO / nH : 0))) t = Math.max(1, t - 1);
    return (LS << 8) | t;
  });
  const stoneSide = (u) => (LS << 8) | cylTone(u);
  const bowlPx = [];
  const bowl = (z0, hb, r0, r1, tier) => T.lathe(0, 0, z0, z0 + hb, (z) => r0 + (r1 - r0) * Math.sqrt(Math.max(0, (z - z0) / hb)),
    (u, z) => (LS << 8) | Math.min(5, cylTone(u) + (z > z0 + hb - 1 ? 1 : 0)),
    (dx, dy, r, i, j) => {
      if (dx * dx + dy * dy > (r - 1.2) * (r - 1.2)) return (LS << 8) | (dx < 0 && dy < 0 ? 5 : 4);
      bowlPx.push([i, j, dx, dy, tier]);
      return (WAT << 8) | 3;
    });
  T.lathe(0, 0, zw, zB1, (z) => (z < zw + 1.5 ? rPd * 1.5 : rPd), stoneSide, null);
  bowl(zB1, hb1, rPd * 1.1, rb1, 1);
  T.lathe(0, 0, zB1 + hb1, zB2, (z) => (z < zB1 + hb1 + 1 ? rPd * 1.1 : rPd * 0.75), stoneSide, null);
  bowl(zB2, hb2, rPd * 0.8, rb2, 2);
  T.lathe(0, 0, zB2 + hb2, zSp, (z) => (z > zSp - 1.5 ? Math.max(1.2, R * 0.07) : Math.max(0.8, R * 0.05)), stoneSide, null);
  depthEdges(p, 3);
  const ms = hash3(seed, 501, 4);
  for (let j = 1; j < p.h - 1; j++) {
    for (let i = 1; i < p.w - 1; i++) if (p.mat(i, j) === LS && p.mat(i, j + 1) !== LS && p.tone(i, j) <= 3 && hrand(ms, i, j) < 0.3) paint(p, i, j, 3, 1);
  }
  outline(p, mats);
  // overflow streams from the upper bowl and the jet, animated with the water ripples
  const streams = [];
  for (const a of [Math.PI / 2, Math.PI / 2 - 0.95, Math.PI / 2 + 0.95]) {
    const x = rb1 * 1.04 * Math.cos(a), y = rb1 * 1.04 * Math.sin(a), i = Math.floor(cx + x);
    const j0 = Math.floor(cy + y * SQ - (zB1 + hb1)) + 1, j1 = Math.floor(cy + y * SQ - zw);
    for (let j = j0; j <= j1; j++) streams.push([i, j, j - j0, j === j1]);
  }
  const jet = [];
  for (let z = zSp; z <= zJ; z += 0.5) jet.push([AX, Math.floor(cy - z), Math.floor(z - zSp)]);
  for (const sg of [-1, 1]) {
    for (let t = 0.05; t <= 1; t += 0.06) {
      const x = sg * rb2 * 0.8 * t, z = zJ - (zJ - (zB2 + hb2)) * t * t;
      jet.push([Math.floor(cx + x), Math.floor(cy - z), Math.round(jh + t * 8)]);
    }
  }
  const ws = hash3(seed, 501, 3), frames = [];
  for (let f = 0; f < 4; f++) {
    const q = p.clone();
    for (const [i, j, x, y] of waterPx) {
      if (q.mat(i, j) !== WAT) continue;
      const dd = len2(x, y);
      let t = y < 0 && dd > rI - 2.2 ? 1 : 2;
      if (fr((dd - rPd * 1.5) / 4 - f / 4) < 0.2 && dd > rPd * 1.7) t = Math.min(4, t + 1);
      if (hrand(ws, i * 7 + f, j) < 0.02) t = 5;
      q.setTone(i, j, t);
    }
    for (const [i, j, dx, dy, tier] of bowlPx) {
      if (q.mat(i, j) !== WAT) continue;
      q.setTone(i, j, fr(len2(dx, dy) / 2.5 - f / 4) < 0.25 ? 4 : hrand(ws, i + f * 5, j) < 0.04 ? 5 : 3);
    }
    for (const [i, j, k, end] of streams) q.set(i, j, WAT, end ? ((k + f) & 1 ? 5 : 4) : (k + f) % 3 === 0 ? 5 : 4);
    for (const [i, j, k] of jet) q.set(i, j, WAT, (k + 4 - f) % 4 === 0 ? 5 : 4);
    frames.push(q);
  }
  const DG = area(R * 1.4 + 5, R * 0.9 + 5, R * 0.9 + 7);
  const d = new Dec(DG.W, DG.H);
  dShadow(d, DG.cx + R * 0.12, DG.cy + R * 0.08, rO + 1.5, rO * SQ + 1.2, 0.36, [8, 10, 16]);
  dEllipse(d, DG.cx, DG.cy + 1, rO + 3, rO * SQ + 2.4, [30, 50, 80], 0.14);
  for (let k = 0; k < 5; k++) {
    const an = rn.range(0, TAU);
    d.over(Math.floor(DG.cx + Math.cos(an) * (rO + rn.range(2, 5))), Math.floor(DG.cy + Math.sin(an) * (rO * SQ + rn.range(1, 3))), [150, 200, 230], 0.55);
  }
  return finish(frames, mats, G, d, DG, 6);
}

function statue(R, seed, K) {
  const { SQ, hash3, hrand, stream, C, pal, rgb, Pix, Dec, area, depthEdges, outline, finish, dShadow, dPebble } = K;
  const rn = stream(seed, 502);
  const LS = 1, MOSS = 3, KS = 4;
  const mats = castleMats(C, pal);
  const s = R / 10.5;
  const aP1 = Math.round(R * 0.82), dP1 = Math.round(R * 0.6), hP1 = Math.max(2, Math.round(R * 0.16));
  const aP2 = aP1 - Math.max(1, Math.round(R * 0.12)), dP2 = dP1 - Math.max(1, Math.round(R * 0.12)), hP = hP1 + Math.max(3, Math.round(R * 0.36));
  const u1 = (v) => Math.max(1, Math.round(v * s));
  const zb = hP, zL1 = zb + u1(8), zT1 = zL1 - 1 + u1(7), zH0 = zT1 + 0.5, zH1 = zH0 + u1(4.5);
  const G = area(aP1 + 3, zH1 + 4 + dP1 * SQ, dP1 * SQ + 3);
  const p = new Pix(G.W, G.H);
  const T = geo(K, p, G);
  // stepped plinth with an engraved band
  T.box(0, 0, aP1, dP1, 0, hP1, (kind, m, x, y, z, nx, ny, nz, i, j, ft, fb) => (LS << 8) | (kind === 0 ? 4 : ft === 1 ? 4 : fb === 0 ? 1 : 2), LS);
  T.box(0, 0, aP2, dP2, hP1, hP, (kind, m, x, y, z, nx, ny, nz, i, j, ft, fb) => {
    if (kind === 0) return (LS << 8) | 5;
    if (ft === 1) return (LS << 8) | 4;
    if (fb === 0) return (LS << 8) | 2;
    if (Math.abs(x) <= aP2 - 2 && Math.abs(z - (hP1 + hP) / 2) < 0.6) return (LS << 8) | 1;
    return (LS << 8) | (x <= -aP2 + 0.5 ? 4 : 3);
  }, LS);
  // the knight, blocky and depth-sorted: legs, tassets, chest, helm, pauldrons, arms, sword point-down
  const part = (ox, oy, ax, ay, z0, z1, deco) => T.box(ox, oy, ax, ay, z0, z1, (kind, m, x, y, z, nx, ny, nz, i, j, ft, fb) => {
    if (kind === 0) return (KS << 8) | 5;
    const u = (x - ox) / Math.max(0.5, ax);
    let t = u < -0.45 ? 4 : u < 0.45 ? 3 : 2;
    if (ft === 1) t = Math.min(5, t + 1); else if (fb === 0) t = Math.max(1, t - 1);
    if (deco) t = deco(x - ox, z - z0, t);
    return (KS << 8) | t;
  }, KS);
  const tw = s < 1.1 ? 2.75 : 3.75;
  part(-1.5, 0, 0.75, 1.2, zb, zL1);
  part(1.5, 0, 0.75, 1.2, zb, zL1);
  part(0, 0, tw - 0.5, 1.5, zL1 - u1(2.5), zL1 + 1, (dx, dz, t) => (dz < 1 ? 1 : t));
  part(0, 0, tw, 1.6, zL1 + 1, zT1, (dx, dz, t) => (Math.abs(dx) < 0.5 && dz > 1 ? Math.max(1, t - 1) : t));
  part(0, 0, 1.75, 1.6, zH0, zH1, (dx, dz, t) => (Math.abs(dz - (zH1 - zH0) * 0.55) < 0.5 && Math.abs(dx) <= 1.2 ? 0 : dx === 0 && dz < (zH1 - zH0) * 0.45 && dz > 0.5 ? 1 : t));
  T.tube([[0, -0.5, zH1 - 0.3, 1.7 * s], [0, 0.2, zH1 - 0.3, 1.7 * s]], (I) => (KS << 8) | tone6(I + 0.1));
  const sh = (I) => (KS << 8) | tone6(I);
  const yS = Math.min(dP2 - 0.5, 4.2 * s);
  for (const sg of [-1, 1]) {
    T.tube([[sg * (tw + 0.9), 0, zT1 - 0.6, 1.8 * s], [sg * (tw + 0.9), 0.3, zT1 - 0.4, 1.8 * s]], sh);
    T.tube([[sg * (tw + 0.8), 0.6, zT1 - 1.8, 1.1 * s], [sg * 1.2, yS - 1, zL1 + u1(2), 1.05 * s]], sh);
  }
  const zG = zL1 + u1(1.5);
  part(0, yS, 0.5, 0.5, zb, zG);
  part(0, yS, 2 * s + 0.24, 0.6, zG, zG + 1);
  T.tube([[0, yS - 0.3, zG + 1.6, 1.3 * s], [0, yS - 0.3, zG + 1.9, 1.3 * s]], sh);
  T.tube([[0, yS - 0.4, zG + 3.3 * s, 0.8], [0, yS - 0.4, zG + 3.3 * s, 0.8]], sh);
  depthEdges(p, 2.5);
  const ms = hash3(seed, 502, 3);
  for (let j = 1; j < p.h - 1; j++) {
    for (let i = 1; i < p.w - 1; i++) {
      const m = p.mat(i, j);
      if (m !== LS && m !== KS) continue;
      const h = hrand(ms, i, j);
      if (m === KS && !p.mat(i, j - 1) && h < 0.12) paint(p, i, j, MOSS, 2);
      else if (m === LS && p.mat(i, j + 1) !== LS && h < 0.35) paint(p, i, j, MOSS, h < 0.15 ? 1 : 2);
    }
  }
  outline(p, mats);
  const DG = area(R * 1.5 + 5, R * 0.9 + 5, R * 0.9 + 7);
  const d = new Dec(DG.W, DG.H);
  dShadow(d, DG.cx + R * 0.14, DG.cy + R * 0.08, aP1 + 2, dP1 * SQ + 2, 0.38, [8, 8, 12]);
  const peb = [rgb('#c0b9ae'), rgb('#9a938a'), rgb('#5a544d'), rgb('#15130f')];
  const an = rn.range(0.1, 0.9) * Math.PI;
  dPebble(d, Math.round(DG.cx + Math.cos(an) * R * 1.05), Math.round(DG.cy + Math.sin(an) * R * 0.6), 2, 2, peb, rn);
  return finish([p], mats, G, d, DG, 0);
}

export const PROPS_BUILT = {
  graveyard: (R, seed, K) => (R >= 16 ? crypt(R, seed, K) : tombs(R, seed, K)),
  castle: (R, seed, K) => (R >= 16 ? fountain(R, seed, K) : statue(R, seed, K)),
  rooftop: (R, seed, K) => acUnit(R, seed, K),
  dojo: (R, seed, K) => (R >= 13 ? sakura(R, seed, K) : lantern(R, seed, K)),
  ship: (R, seed, K) => (R >= 12 ? mast(R, seed, K) : barrels(R, seed, K)),
};
