'use strict';
// AI Fight v4 — GODLY POWERS (level 10+). Owned by the godly agent (see SPEC4 §5).
// Fully deterministic: no randomness, no wall clock; all timing uses integer tick counters.
// Damage and heals are % of max HP; every power is telegraphed via frame()/state() (s.godfx).
// Uses ONLY the PowerAPI handed to create(api).

const FR = 24; // fighter radius (world units)

const GOD_POWERS = {
  timestop: {
    id: 'timestop', name: 'Time Stop', color: '#cfd8ff', element: 'time', cast: 0.8, cost: 100, target: 'enemy',
    range: 420, radius: 420, duration: 1.8, maxDamagePct: 6,
    blurb: 'The clocks of heaven halt. The enemy is frozen in place, then struck as time resumes.',
    effect: 'if the enemy is within 420 of the caster when it fires: frozen 1.8 s (no action, no movement, statuses paused), then 6% max HP when time resumes',
    telegraph: 'GOD_CAST flag + ts_charge dome growing from 0 to 420 around the caster during the 0.8 s windup',
    counter: 'be more than 420 away from the caster when the windup ends',
  },
  judgment: {
    id: 'judgment', name: 'Judgment', color: '#ffe27a', element: 'holy', cast: 0.4, cost: 100, target: 'point',
    radius: 110, duration: 1.7, maxDamagePct: 28,
    blurb: 'A sigil of light brands the ground; a pillar of holy fire answers.',
    effect: 'judg_mark r110 at the point for 1.0 s, then judg_beam: enemy within 110+24 takes 28% max HP and is stunned 0.8 s',
    telegraph: 'judg_mark circle (r 110) for 1.0 s before the beam',
    counter: 'walk out of the circle (centre distance > 134) before the mark ends',
  },
  blackhole: {
    id: 'blackhole', name: 'Black Hole', color: '#9a5cff', element: 'void', cast: 0.5, cost: 100, target: 'point',
    radius: 180, duration: 4.0, maxDamagePct: 22,
    blurb: 'A wound in space drags everything toward its heart, then collapses in a nova.',
    effect: 'bhole r180 for 4 s: forming 0.6 s, then pulls the enemy inside 110 u/s toward the centre and deals 3.5% max HP/s; at the end bhole_nova r120: 10% + knockback 160',
    telegraph: 'bhole circle (r 180); pull starts only after the 0.6 s forming phase',
    counter: 'leave the 180 radius during the forming phase; stay farther than 120 from the centre at the end',
  },
  meteor: {
    id: 'meteor', name: 'Meteor Storm', color: '#ff7a2a', element: 'fire', cast: 0.5, cost: 100, target: 'point',
    radius: 90, duration: 2.3, maxDamagePct: 45,
    blurb: 'Five stars fall in a burning cross.',
    effect: '5 meteors in a cross (centre + 90 ahead/behind/left/right, oriented caster->point) land at 0.8/1.05/1.3/1.55/1.8 s; each: enemy within 90+24 takes 9% max HP + knockback 60',
    telegraph: 'met_mark circles (r 90) at every landing spot from the moment it fires',
    counter: 'leave the cross; each impact point is visible 0.8-1.8 s ahead',
  },
  thunder: {
    id: 'thunder', name: 'Thunder God', color: '#7ae8ff', element: 'storm', cast: 0.4, cost: 100, target: 'enemy',
    radius: 70, duration: 2.8, maxDamagePct: 28,
    blurb: 'The sky hunts you: six bolts, each aimed where you stood.',
    effect: '6 strikes, strike k marked at the enemy position at k*0.45 s, lands 0.55 s later; enemy within 70+24: 4% max HP (6th strike: 8% + stun 0.6 s)',
    telegraph: 'bolt_mark circles (r 70) placed at your position 0.55 s before each bolt',
    counter: 'keep moving fast (> ~170 u/s clears every mark)',
  },
  avatar: {
    id: 'avatar', name: 'Avatar of War', color: '#ffb13b', element: 'might', cast: 0.6, cost: 100, target: 'self',
    radius: 110, duration: 8.0, maxDamagePct: 5,
    blurb: 'The caster becomes the war god: harder, stronger, unstoppable.',
    effect: '8 s: +30% power, +30% armor, +60% tenacity (AVATAR flag); landing slam: enemy within 110 takes 5% max HP + knockback 120',
    telegraph: 'GOD_CAST flag during the 0.6 s windup; avatar aura (r 60) on the caster while it lasts',
    counter: 'be more than 110 away when it fires; kite for 8 s',
  },
  phoenix: {
    id: 'phoenix', name: 'Phoenix Rebirth', color: '#ff5a2a', element: 'flame', cast: 0.5, cost: 100, target: 'self',
    radius: 170, duration: 15.0, maxDamagePct: 12,
    blurb: 'Death is a doorway. The caster rises from the ashes once.',
    effect: 'arms a rebirth for 15 s (PHOENIX flag): a KO is prevented -> heal 40% max HP, invulnerable 1.2 s, phoenix_nova r170: enemy takes 12% + knockback 180. Unused after 15 s: heal 8%. Once per fight',
    telegraph: 'phoenix aura (r 40) on the caster + PHOENIX flag while armed',
    counter: 'wait out the 15 s window before going for the kill, or stay > 170 away when you land it',
  },
  worldtree: {
    id: 'worldtree', name: 'World Tree', color: '#7aff8a', element: 'life', cast: 0.6, cost: 100, target: 'self',
    radius: 170, duration: 5.0, maxDamagePct: 4,
    blurb: 'Yggdrasil takes root: it mends its planter and snares the unwary.',
    effect: 'tree r170 at the caster for 5 s: heals the caster 4% max HP/s while inside (max 20%); at 0.8 s roots spring: enemy inside is rooted 1.5 s + 4% max HP, then slowed 30% while inside',
    telegraph: 'tree circle (r 170); roots spring 0.8 s after it appears (p2 0 -> 1)',
    counter: 'step out of the 170 circle within 0.8 s and stay out; drag the caster away from it',
  },
};
const IDS = Object.keys(GOD_POWERS);

const CINEMATICS = { ult: 1100, god: 1500, awaken: 900, ascend: 1500, ko: 1100, impact: 140, ulthit: 320, godhit: 420 };
const DIVINITY = { dealtPer100: 0.5, takenPer100: 0.8, perSecond: 0.8 };
const FLAGS2 = { TIMESTOPPED: 1 << 12, AVATAR: 1 << 13, PHOENIX: 1 << 14, GOD_CAST: 1 << 15 };

// ------------------------------------------------------------------ helpers
function tr(ctx) { const t = Number(ctx.api.tickRate); return t > 0 ? t : 30; }
function ticks(ctx, s) { return Math.max(1, Math.round(s * tr(ctx))); }
function num(v) { return Number.isFinite(v) ? Math.round(v) : 0; }
function r2(v) { return Math.round(v * 100) / 100; }
function fighter(ctx, side) {
  const fs = ctx.api.fighters || [];
  for (let i = 0; i < fs.length; i++) if (fs[i] && fs[i].side === side) return fs[i];
  return fs[side] || null;
}
function foeOf(ctx, f) {
  if (!f) return null;
  const e = ctx.api.enemyOf(f);
  return e || fighter(ctx, 1 - f.side);
}
function alive(f) { return !!f && !f.dead; }
function d2(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }
function within(v, x, y, rad) { return alive(v) && d2(v.x, v.y, x, y) <= rad * rad; }
function ringR(ctx) {
  const r = typeof ctx.api.ringRadius === 'function' ? ctx.api.ringRadius() : ctx.api.ringRadius;
  return Number.isFinite(r) && r > 0 ? r : Infinity;
}
function normId(id) { return typeof id === 'string' ? id.trim().toLowerCase() : ''; }

// % of the victim's max HP; returns the damage actually dealt (engine return value if numeric)
function hurt(ctx, side, v, pct, id) {
  if (!alive(v)) return 0;
  const amt = (v.maxHp || 0) * pct / 100;
  if (!(amt > 0)) return 0;
  const r = ctx.api.damage(fighter(ctx, side), v, amt, { kind: 'god', pierce: true, noCrit: true, power: id });
  return typeof r === 'number' && Number.isFinite(r) ? r : amt;
}
function mend(ctx, f, pct) { if (alive(f) && f.maxHp > 0) ctx.api.heal(f, f.maxHp * pct / 100); }
// knockback that never uses a zero-length direction (victim exactly on the source point)
function knock(ctx, v, fx, fy, dist, side) {
  if (!alive(v)) return;
  if (d2(v.x, v.y, fx, fy) < 1) {
    const a = fighter(ctx, side);
    if (a && d2(v.x, v.y, a.x, a.y) >= 1) { fx = a.x; fy = a.y; } else { fx = v.x - 1; fy = v.y; }
  }
  ctx.api.knock(v, fx, fy, dist);
}
function targetPoint(ctx, f, target) {
  let x, y;
  if (target && Number.isFinite(target.x) && Number.isFinite(target.y)) { x = target.x; y = target.y; } else {
    const e = foeOf(ctx, f) || f; x = e.x; y = e.y;
  }
  const R = ringR(ctx), d = Math.sqrt(x * x + y * y);
  if (d > R) { x = x * R / d; y = y * R / d; }
  return { x, y };
}

function spawn(ctx, o) {
  const e = Object.assign({ kind: '', id: '', owner: 0, x: 0, y: 0, r: 0, age: 0, dur: 1, p2: 0, follow: -1,
    hidden: false, done: false, tick: null, end: null }, o);
  if (e.follow >= 0) { const f = fighter(ctx, e.follow); if (f) { e.x = f.x; e.y = f.y; } }
  ctx.ents.push(e);
  return e;
}
function kill(ctx, side, kind) {
  for (const e of ctx.ents) if (e.owner === side && e.kind === kind) e.done = true;
}
function isActive(ctx, side, id) {
  const st = ctx.per[side];
  if (st.casting.some((c) => c.id === id)) return true;
  if (id === 'phoenix' && st.armed) return true;
  return ctx.ents.some((e) => !e.done && e.owner === side && e.id === id);
}

// ------------------------------------------------------------------ module API
function validate(ids, level) {
  const out = { errors: [], warnings: [], list: [] };
  if (ids === undefined || ids === null) return out;
  if (!Array.isArray(ids)) { out.errors.push('godPowers must be an array of power ids (valid: ' + IDS.join(', ') + ')'); return out; }
  if (!ids.length) return out;
  const lvl = Number(level) || 0;
  if (lvl < 10) {
    out.errors.push('godly powers unlock at level 10 (this is level ' + lvl + '); remove "godPowers" or leave it empty');
    return out;
  }
  const max = lvl >= 12 ? 2 : 1;
  const seen = {};
  for (const raw of ids) {
    const id = normId(raw);
    if (!GOD_POWERS[id]) { out.errors.push('unknown godly power "' + String(raw) + '" (valid: ' + IDS.join(', ') + ')'); continue; }
    if (seen[id]) { out.errors.push('duplicate godly power "' + id + '"'); continue; }
    seen[id] = true;
    out.list.push(id);
  }
  if (out.list.length > max) {
    out.errors.push('level ' + lvl + ' allows ' + max + ' godly power' + (max > 1 ? 's' : '') + ' (got ' + out.list.length + '; level 12 allows 2)');
    out.list = out.list.slice(0, max);
  }
  return out;
}

function create(api) {
  return { api, ents: [], clock: 0, per: [0, 1].map(() => ({ armed: false, used: false, casting: [] })) };
}

function cast(ctx, f, id, target) { // eslint-disable-line no-unused-vars
  id = normId(id);
  const P = GOD_POWERS[id];
  if (!P || !f || f.dead || !ctx.per[f.side]) return false;
  if (isActive(ctx, f.side, id)) return false;
  if (id === 'phoenix' && ctx.per[f.side].used) return false; // rebirth is once per fight
  const w = ticks(ctx, P.cast);
  // watchdog: if the engine never fires (interrupted cast) GOD_CAST is cleared 2.5 s after the windup
  ctx.per[f.side].casting.push({ id, until: ctx.clock + w + ticks(ctx, 2.5) });
  ctx.api.setFlag2(f, FLAGS2.GOD_CAST, true);
  if (id === 'timestop') spawn(ctx, { kind: 'ts_charge', id, owner: f.side, follow: f.side, r: 0, grow: 420, dur: w });
  ctx.api.cinematic('god', f.side);
  return true;
}

function fire(ctx, f, id, target) {
  id = normId(id);
  const P = GOD_POWERS[id];
  if (!P || !f || !ctx.per[f.side]) return false;
  const api = ctx.api, s = f.side, st = ctx.per[s];
  const ci = st.casting.findIndex((c) => c.id === id);
  if (ci >= 0) st.casting.splice(ci, 1);
  if (!st.casting.length) api.setFlag2(f, FLAGS2.GOD_CAST, false);
  if (id === 'timestop') kill(ctx, s, 'ts_charge');
  if (f.dead) return false;
  const v = foeOf(ctx, f);
  let pt = P.target === 'self' ? { x: f.x, y: f.y } : targetPoint(ctx, f, target);

  if (id === 'timestop') {
    pt = { x: f.x, y: f.y };
    if (within(v, f.x, f.y, 420)) {
      api.freeze(v, 1.8);
      api.setFlag2(v, FLAGS2.TIMESTOPPED, true);
      spawn(ctx, { kind: 'timestop', id, owner: s, x: f.x, y: f.y, r: 420, dur: ticks(ctx, 1.8), p2: v.side, victim: v.side,
        end: (c, e) => {
          const vv = fighter(c, e.victim);
          if (vv) c.api.setFlag2(vv, FLAGS2.TIMESTOPPED, false);
          hurt(c, e.owner, vv, 6, id);
          c.api.event({ k: 'g:resume', a: e.owner, v: e.victim });
        } });
    } else {
      spawn(ctx, { kind: 'timestop', id, owner: s, x: f.x, y: f.y, r: 420, dur: ticks(ctx, 0.5), p2: -1 });
    }
  } else if (id === 'judgment') {
    spawn(ctx, { kind: 'judg_mark', id, owner: s, x: pt.x, y: pt.y, r: 110, dur: ticks(ctx, 1.0),
      end: (c, e) => {
        spawn(c, { kind: 'judg_beam', id, owner: e.owner, x: e.x, y: e.y, r: 110, dur: ticks(c, 0.7) });
        c.api.event({ k: 'g:beam', a: e.owner, x: num(e.x), y: num(e.y) });
        const a = fighter(c, e.owner), vv = foeOf(c, a);
        if (within(vv, e.x, e.y, 110 + FR)) {
          const dmg = hurt(c, e.owner, vv, 28, id);
          c.api.stun(vv, 0.8);
          c.api.impact(a, vv, dmg, 'god');
          c.api.cinematic('godhit', e.owner);
        }
      } });
  } else if (id === 'blackhole') {
    spawn(ctx, { kind: 'bhole', id, owner: s, x: pt.x, y: pt.y, r: 180, dur: ticks(ctx, 4.0), form: ticks(ctx, 0.6),
      tick: (c, e) => {
        if (e.age <= e.form) return;
        const vv = foeOf(c, fighter(c, e.owner));
        if (!within(vv, e.x, e.y, 180)) return;
        const d = Math.sqrt(d2(vv.x, vv.y, e.x, e.y));
        if (d > 0.01) c.api.pull(vv, e.x, e.y, Math.min(110 / tr(c), d));
        if ((e.age - e.form) % 6 === 0) hurt(c, e.owner, vv, 3.5 * 6 / tr(c), id);
      },
      end: (c, e) => {
        spawn(c, { kind: 'bhole_nova', id, owner: e.owner, x: e.x, y: e.y, r: 120, dur: ticks(c, 0.5) });
        c.api.event({ k: 'g:nova', a: e.owner, id, x: num(e.x), y: num(e.y) });
        const a = fighter(c, e.owner), vv = foeOf(c, a);
        if (within(vv, e.x, e.y, 120)) {
          const dmg = hurt(c, e.owner, vv, 10, id);
          knock(c, vv, e.x, e.y, 160, e.owner);
          c.api.impact(a, vv, dmg, 'god');
        }
      } });
  } else if (id === 'meteor') {
    let ux = pt.x - f.x, uy = pt.y - f.y;
    const L = Math.sqrt(ux * ux + uy * uy);
    if (L > 1e-6) { ux /= L; uy /= L; } else { ux = 1; uy = 0; }
    const offs = [[0, 0], [90, 0], [-90, 0], [0, 90], [0, -90]];
    for (let k = 0; k < offs.length; k++) {
      const ox = offs[k][0], oy = offs[k][1];
      spawn(ctx, { kind: 'met_mark', id, owner: s, x: pt.x + ox * ux - oy * uy, y: pt.y + ox * uy + oy * ux, r: 90,
        dur: ticks(ctx, 0.8 + 0.25 * k), p2: k, k,
        end: (c, e) => {
          spawn(c, { kind: 'met_boom', id, owner: e.owner, x: e.x, y: e.y, r: 90, dur: ticks(c, 0.5), p2: e.k });
          c.api.event({ k: 'g:meteor', a: e.owner, x: num(e.x), y: num(e.y) });
          const a = fighter(c, e.owner), vv = foeOf(c, a);
          if (within(vv, e.x, e.y, 90 + FR)) {
            const dmg = hurt(c, e.owner, vv, 9, id);
            knock(c, vv, e.x, e.y, 60, e.owner);
            if (e.k === 4) c.api.impact(a, vv, dmg, 'god');
          }
        } });
    }
  } else if (id === 'thunder') {
    const at = [0, 1, 2, 3, 4, 5].map((k) => Math.round(k * 0.45 * tr(ctx)));
    const strike = (c, side, k) => {
      const a = fighter(c, side), t = foeOf(c, a) || a;
      spawn(c, { kind: 'bolt_mark', id, owner: side, x: t.x, y: t.y, r: 70, dur: ticks(c, 0.55), p2: k, k,
        end: (c2, e) => {
          spawn(c2, { kind: 'bolt', id, owner: e.owner, x: e.x, y: e.y, r: 70, dur: ticks(c2, 0.35), p2: e.k });
          c2.api.event({ k: 'g:bolt', a: e.owner, x: num(e.x), y: num(e.y) });
          const a2 = fighter(c2, e.owner), vv = foeOf(c2, a2);
          if (!within(vv, e.x, e.y, 70 + FR)) return;
          if (e.k === 5) {
            const dmg = hurt(c2, e.owner, vv, 8, id);
            c2.api.stun(vv, 0.6);
            c2.api.impact(a2, vv, dmg, 'god');
          } else hurt(c2, e.owner, vv, 4, id);
        } });
    };
    pt = v ? { x: v.x, y: v.y } : pt;
    strike(ctx, s, 0);
    // hidden controller: places strikes 1..5 (not drawn; listed in state() as 'storm')
    spawn(ctx, { kind: 'storm', id, owner: s, follow: v ? v.side : -1, x: pt.x, y: pt.y, r: 70, hidden: true, dur: at[5], at, k: 1,
      tick: (c, e) => { while (e.k < 6 && e.age >= e.at[e.k]) { strike(c, e.owner, e.k); e.k++; } } });
  } else if (id === 'avatar') {
    api.buff(f, 'power', 0.3, 8);
    api.buff(f, 'armor', 0.3, 8);
    api.buff(f, 'tenacity', 0.6, 8);
    api.setFlag2(f, FLAGS2.AVATAR, true);
    spawn(ctx, { kind: 'avatar', id, owner: s, follow: s, r: 60, dur: ticks(ctx, 8),
      end: (c, e) => { const a = fighter(c, e.owner); if (a) c.api.setFlag2(a, FLAGS2.AVATAR, false); } });
    spawn(ctx, { kind: 'avatar_slam', id, owner: s, x: f.x, y: f.y, r: 110, dur: ticks(ctx, 0.5) });
    api.event({ k: 'g:slam', a: s, x: num(f.x), y: num(f.y) });
    if (within(v, f.x, f.y, 110)) { hurt(ctx, s, v, 5, id); knock(ctx, v, f.x, f.y, 120, s); }
  } else if (id === 'phoenix') {
    st.armed = true;
    api.setFlag2(f, FLAGS2.PHOENIX, true);
    spawn(ctx, { kind: 'phoenix', id, owner: s, follow: s, r: 40, dur: ticks(ctx, 15),
      end: (c, e) => {
        const cs = c.per[e.owner];
        if (!cs.armed) return;
        cs.armed = false;
        const a = fighter(c, e.owner);
        if (!a) return;
        c.api.setFlag2(a, FLAGS2.PHOENIX, false);
        if (alive(a)) { mend(c, a, 8); c.api.event({ k: 'g:fade', a: e.owner, id: 'phoenix', x: num(a.x), y: num(a.y) }); }
      } });
  } else if (id === 'worldtree') {
    spawn(ctx, { kind: 'tree', id, owner: s, x: f.x, y: f.y, r: 170, dur: ticks(ctx, 5), spring: ticks(ctx, 0.8), p2: 0,
      tick: (c, e) => {
        const a = fighter(c, e.owner), vv = foeOf(c, a);
        if (e.age % 6 === 0 && within(a, e.x, e.y, 170)) mend(c, a, 4 * 6 / tr(c));
        if (e.age === e.spring) {
          e.p2 = 1;
          c.api.event({ k: 'g:roots', a: e.owner, x: num(e.x), y: num(e.y) });
          if (within(vv, e.x, e.y, 170)) { c.api.root(vv, 1.5); hurt(c, e.owner, vv, 4, id); }
        } else if (e.age > e.spring && e.age % 6 === 0 && within(vv, e.x, e.y, 170)) {
          c.api.slow(vv, 0.3, 0.2);
        }
      } });
  }
  api.event({ k: 'g:fire', a: s, id, x: num(pt.x), y: num(pt.y) });
  return true;
}

function step(ctx) {
  ctx.clock++;
  const list = ctx.ents.slice();
  for (const e of list) {
    if (e.done) continue;
    if (e.follow >= 0) { const f = fighter(ctx, e.follow); if (f) { e.x = f.x; e.y = f.y; } }
    e.age++;
    if (e.tick) e.tick(ctx, e);
    if (!e.done && e.age >= e.dur) { e.done = true; if (e.end) e.end(ctx, e); }
  }
  ctx.ents = ctx.ents.filter((e) => !e.done);
  for (let s = 0; s < ctx.per.length; s++) { // watchdog for casts that were never fired
    const st = ctx.per[s];
    if (!st.casting.length) continue;
    st.casting = st.casting.filter((c) => c.until >= ctx.clock);
    if (!st.casting.length) { const f = fighter(ctx, s); if (f) ctx.api.setFlag2(f, FLAGS2.GOD_CAST, false); }
  }
}

function onDamage(ctx, attacker, target, info) {} // eslint-disable-line no-unused-vars

function onKO(ctx, f) {
  if (!f || !ctx.per[f.side]) return false;
  const st = ctx.per[f.side], api = ctx.api, s = f.side;
  if (!st.armed || st.used) return false;
  st.armed = false; st.used = true;
  kill(ctx, s, 'phoenix');
  api.setFlag2(f, FLAGS2.PHOENIX, false);
  if (f.maxHp > 0) api.heal(f, f.maxHp * 0.4);
  api.invuln(f, 1.2);
  spawn(ctx, { kind: 'phoenix_nova', id: 'phoenix', owner: s, x: f.x, y: f.y, r: 170, dur: ticks(ctx, 0.8) });
  const v = foeOf(ctx, f);
  if (within(v, f.x, f.y, 170)) {
    const dmg = hurt(ctx, s, v, 12, 'phoenix');
    knock(ctx, v, f.x, f.y, 180, s);
    api.impact(f, v, dmg, 'god');
  }
  api.event({ k: 'revive', a: s, x: num(f.x), y: num(f.y) });
  api.event({ k: 'g:rebirth', a: s, x: num(f.x), y: num(f.y) });
  api.cinematic('godhit', s);
  return true;
}

function radiusOf(e) { return e.grow ? e.grow * Math.min(1, e.age / e.dur) : e.r; }
function p1Of(e) { return Math.max(0, Math.min(100, Math.round(100 * e.age / e.dur))); }

function frame(ctx) {
  const out = [];
  const t = tr(ctx);
  for (const e of ctx.ents) {
    if (e.done || e.hidden) continue;
    const p2 = e.kind === 'avatar' ? Math.max(0, Math.round((e.dur - e.age) * 10 / t)) : (e.p2 | 0);
    out.push([e.kind, num(e.x), num(e.y), num(radiusOf(e)), e.owner, p1Of(e), p2]);
  }
  return out;
}

// what each godfx kind means to a fighter: hitRadius = centre distance that gets you hit
const THREAT = {
  ts_charge: { hit: 420, pct: 6, danger: true, effect: 'freeze' },
  timestop: { hit: 420, danger: false, effect: 'freeze' },
  judg_mark: { hit: 110 + FR, pct: 28, danger: true, effect: 'stun' },
  judg_beam: { hit: 110 + FR, danger: false },
  bhole: { hit: 180, danger: true, effect: 'pull' },
  bhole_nova: { hit: 120, danger: false },
  met_mark: { hit: 90 + FR, pct: 9, danger: true, effect: 'knock' },
  met_boom: { hit: 90 + FR, danger: false },
  storm: { hit: 70 + FR, pct: 4, danger: true, effect: 'strikes' },
  bolt_mark: { hit: 70 + FR, pct: 4, danger: true },
  bolt: { hit: 70 + FR, danger: false },
  avatar: { hit: 0, danger: false, effect: 'buff' },
  avatar_slam: { hit: 110, danger: false },
  phoenix: { hit: 0, danger: false, effect: 'rebirth' },
  phoenix_nova: { hit: 170, danger: false },
  tree: { hit: 170, danger: true, effect: 'root' },
};

function state(ctx, f) {
  const out = [];
  if (!f) return out;
  const t = tr(ctx);
  for (const e of ctx.ents) {
    if (e.done) continue;
    const th = THREAT[e.kind] || { hit: e.r, danger: false };
    const mine = e.owner === f.side;
    const o = { kind: e.kind, id: e.id, x: r2(e.x), y: r2(e.y), radius: e.grow || e.r, hitRadius: th.hit, mine,
      timeLeft: r2(Math.max(0, e.dur - e.age) / t), danger: !mine && !!th.danger };
    if (th.effect) o.effect = th.effect;
    if (th.pct) o.damagePct = th.pct;
    if (e.kind === 'bolt_mark') { o.strike = e.k; if (e.k === 5) { o.damagePct = 8; o.effect = 'stun'; } }
    else if (e.kind === 'met_mark') o.meteor = e.k;
    else if (e.kind === 'timestop') o.frozen = e.p2; // victim side or -1
    else if (e.kind === 'bhole') {
      const act = Math.max(0, e.dur - Math.max(e.age, e.form)) / t;
      o.pullIn = r2(Math.max(0, e.form - e.age) / t); // s until the pull starts
      o.damagePct = r2(8 + 2.5 * act);
    } else if (e.kind === 'storm') {
      o.strikesLeft = 6 - e.k;
      o.timeLeft = r2((Math.max(0, e.dur - e.age) + ticks(ctx, 0.55)) / t);
    } else if (e.kind === 'tree') {
      if (e.age < e.spring) { o.timeLeft = r2((e.spring - e.age) / t); o.damagePct = 4; } else { o.effect = 'slow'; o.damagePct = 0; }
      o.healing = true;
    }
    out.push(o);
  }
  return out;
}

function describe() {
  const L = [];
  L.push('GODLY POWERS (level 10: 1 slot, level 12: 2 slots). fighter.json "godPowers": ["id", ...]; brain returns { god: "<id>", target? }.');
  L.push('Each costs 100 divinity; windup ("cast") in seconds; the caster shows the GOD_CAST flag2 bit during the windup.');
  L.push('All damage/heals are % of max HP (armour-piercing, never crit). Every power is telegraphed in s.godfx.');
  L.push('');
  for (const id of IDS) {
    const P = GOD_POWERS[id];
    L.push(P.name + ' [' + id + '] - ' + P.element + ', target ' + P.target + ', windup ' + P.cast + ' s, max ' + P.maxDamagePct + '% of enemy max HP. ' + P.blurb);
    L.push('    effect: ' + P.effect);
    L.push('    telegraph: ' + P.telegraph);
    L.push('    counter: ' + P.counter);
  }
  L.push('');
  L.push('DIVINITY (0-100): +' + DIVINITY.perSecond + '/s, +' + DIVINITY.dealtPer100 + ' per 100 damage dealt, +' + DIVINITY.takenPer100 + ' per 100 damage taken (focus adds +3%/pt).');
  L.push('s.godfx entries: { kind, id, x, y, radius, hitRadius (centre distance that gets you hit), mine, timeLeft (s until it hits or ends), danger, damagePct?, effect? }.');
  L.push('flags2: TIMESTOPPED ' + FLAGS2.TIMESTOPPED + ', AVATAR ' + FLAGS2.AVATAR + ', PHOENIX ' + FLAGS2.PHOENIX + ', GOD_CAST ' + FLAGS2.GOD_CAST + '.');
  return L.join('\n');
}

module.exports = { GOD_POWERS, CINEMATICS, DIVINITY, FLAGS2, validate, create, cast, fire, step, onDamage, onKO, frame, state, describe };
