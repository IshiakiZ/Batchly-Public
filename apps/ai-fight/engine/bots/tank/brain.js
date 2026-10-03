// Stone Warden — built on the universal sparring brain: it plays any kit (weapon attack +
// every ability type), dodges projectiles and meteors, steers around obstacles, parries,
// cleanses and heals. Read it as an example of the v3 brain API.
const CFG = {"aggression":0.6,"keep":null,"say":"I do not move."};

let strafe = 1;
let wantStance = 'balanced', wantSince = 0, lastStanceAt = -10;
const lastGodUse = {};
let divFullSince = -1;
let flipAt = 0;
let lastSwapAt = -10;
let keepCache = null;   // preferred distance, decided once from the starting (main) weapon
let greeted = false;

function reachOf(s, ab) {
  if (!ab) return 0;
  const R = s.rules.fighterRadius;
  switch (ab.type) {
    case 'melee': return 2 * R + ab.range + (ab.lunge || 0);
    case 'projectile': return ab.range * 0.9;
    case 'beam': return ab.range * 0.95;
    case 'area': return ab.target === 'point' ? ab.range + ab.radius * 0.5 : ab.radius + R;
    case 'zone': return ab.follow ? ab.radius + R : ab.range + ab.radius * 0.5;
    case 'trap': return ab.range;
    case 'dash': return ab.distance + 2 * R;
    default: return 0;
  }
}

function pickDistance(s) {
  if (CFG.keep) return CFG.keep;
  if (keepCache === null) keepCache = rolePick(s);
  return keepCache;
}

// Ranged kiter or melee brawler? Judged from the main weapon + abilities, so swapping to the
// off-hand weapon never flips the plan.
function rolePick(s) {
  const me = s.me;
  const basic = util.basic(s);
  let ranged = basic && basic.type === 'projectile' ? 1 : 0;
  let melee = basic && basic.type === 'melee' ? 1 : 0;
  for (const ab of me.abilities) {
    if (ab.basic) continue;
    if (ab.type === 'projectile' || ab.type === 'beam' || (ab.type === 'area' && ab.target === 'point')) ranged += 1;
    if (ab.type === 'melee' || (ab.type === 'area' && ab.target !== 'point') || (ab.type === 'zone' && ab.follow)) melee += 1;
  }
  if (ranged > melee) {
    let r = 9999;
    for (const ab of me.abilities) if (ab.type === 'projectile' || ab.type === 'beam') r = Math.min(r, ab.range);
    return Math.max(240, Math.min(r * 0.62, 460));
  }
  return 0;
}

function brain(s) {
  const me = s.me, en = s.enemy, arena = s.arena;
  const R = s.rules.fighterRadius;
  const d = s.distance, gap = s.gap;
  const hpPct = me.hp / me.maxHp;
  const toEn = util.toward(me, en);
  const want = pickDistance(s);
  const ready = (ab) => ab && ab.ready;
  const has = (t) => me.abilities.filter(a => a.type === t && !a.basic);
  const threat = util.incoming(s, 0.45)[0];
  const los = util.lineOfSight(s, me, en, 4);

  // ── movement ──
  let move;
  if (want > 0) {
    if (d < want - 60) move = util.away(me, en);
    else if (d > want + 60 || !los) move = toEn;
    else move = util.perp(toEn, strafe);
    move = util.norm(util.add(move, util.scale(util.perp(toEn, strafe), 0.5)));
  } else {
    move = util.toward(me, util.predict(en, 0.25));
    if (gap < 8) move = util.norm(util.add(util.scale(toEn, 0.3), util.perp(toEn, strafe)));
  }
  if (util.edgeDistance(me, arena) < 85) {
    move = util.norm(util.add(move, util.scale(util.toward(me, arena.center), 1.6)));
    if (s.time > flipAt) { strafe = -strafe; flipAt = s.time + 1.4; }
  }
  let escaping = false;
  for (const z of util.dangers(s)) {
    const dz = Math.hypot(me.x - z.x, me.y - z.y);
    if (z.kind === 'meteor' && dz < z.radius + R + 8) { move = util.away(me, z); escaping = true; break; }
    if (dz < z.radius + R + 12) move = util.norm(util.add(move, util.scale(util.away(me, z), z.kind === 'zone' ? 3 : 1.8)));
  }
  if (!escaping && threat && (want > 0 || d > 170)) move = util.norm(util.add(util.scale(util.dodge(s, threat), 1.4), util.scale(move, 0.5)));
  move = util.steer(s, move, 80);

  let say;
  if (!greeted && CFG.say) { greeted = true; say = CFG.say; }

  // charging an ultimate or a godly power: keep steering it at the enemy until it's released
  const myUlt = util.ultimate(s);
  if (me.casting && myUlt && me.casting.ability === myUlt.name) {
    const aim = myUlt.type === 'projectile' ? util.lead(me, en, myUlt.speed || 900)
      : (myUlt.type === 'area' && myUlt.target === 'point') ? util.predict(en, (myUlt.delay || 0) * 0.6) : { x: en.x, y: en.y };
    return { move, target: aim, say };
  }
  if (me.godCasting) return { move, target: util.predict(en, 0.3), say };
  const act = (use, target, extra) => Object.assign({ move, use, target, say }, v4x, extra || {});
  const lead = (ab) => util.lead(me, en, ab.speed || 900);

  // ── v4: awakening, stance, weapon swap, godly powers, ultimate ──
  const v4x = {};
  const extra = v4x;
  if (me.canAwaken && (hpPct < 0.6 || en.hp / en.maxHp < 0.5 || s.time > 35)) extra.awaken = true;
  if (me.level >= 3 && me.stanceCooldown <= 0) {
    let want = 'balanced';
    if (hpPct < 0.35 || (en.casting && en.casting.type && en.ult && en.casting.ability === en.ult.name)) want = 'defensive';
    else if (en.hp / en.maxHp < 0.4 || (d < 160 && hpPct > 0.55)) want = 'aggressive';
    else if (pickDistance(s) > 0 && d < 220) want = 'swift';
    // hysteresis: only change stance when the new one has been wanted for a while
    if (want !== wantStance) { wantStance = want; wantSince = s.time; }
    if (want !== me.stance && s.time - wantSince > 1.2 && s.time - lastStanceAt > 4) { extra.stance = want; lastStanceAt = s.time; }
  }
  // off-hand: a melee fighter draws its ranged off-hand while closing in and switches back
  // up close (with hysteresis). Kiters keep their ranged weapon in hand.
  if (me.offhand && want === 0 && me.swapCooldown <= 0 && !me.casting && s.time - lastSwapAt > 2.5) {
    const ranged = (w) => !!w && ['shoot', 'gun', 'cast'].includes(w.kind);
    const nowRanged = ranged(me.weapon);
    if (nowRanged !== ranged(me.offhand)) {
      const wantRanged = nowRanged ? gap > 170 : gap > 300;
      if (wantRanged !== nowRanged) { extra.swap = true; lastSwapAt = s.time; }
    }
  }
  const act0 = (use, target) => Object.assign({ move, say }, extra, use ? { use, target } : {});
  // charge-ups (1 s, exposed) are only safe when the enemy can't stun us right now
  const enemyCanStun = en.abilities.some(a => a.ready && !a.basic && a.effects && a.effects.stun && (a.reach || 0) + 60 >= d);
  const helplessNow0 = en.stunned > 0.4 || en.rooted > 0.6 || en.frozen > 0 || (en.casting && en.casting.timeLeft > 0.6);
  const safeCharge = helplessNow0 || !enemyCanStun || d > 450 || hpPct < 0.25;
  // godly powers: alternate between them (the one used longest ago first)
  const gods = util.godPowers(s).slice().sort((a, b) => (lastGodUse[a.id] || -1) - (lastGodUse[b.id] || -1));
  const anyReady = gods.some(g => g.ready);
  if (anyReady && divFullSince < 0) divFullSince = s.time;
  if (!anyReady) divFullSince = -1;
  const impatient = divFullSince >= 0 && s.time - divFullSince > 6;
  // area powers land ~1-2 s after the charge starts: aim them at a pinned or busy enemy
  const POINT_GODS = { judgment: 1, meteor: 1, blackhole: 1 };
  for (const g of gods) {
    if (!g.ready || en.invulnerable || !safeCharge) continue;
    if (POINT_GODS[g.id]) {
      const pinned = en.stunned > 0.5 || en.rooted > 0.8 || en.frozen > 0 || (en.slowed >= 0.3 && en.slowTime > 1)
        || (en.casting && en.casting.timeLeft > 0.7) || !!en.channeling;
      if (!(pinned || d < 200 || impatient) || d > 650) continue;
      lastGodUse[g.id] = s.time;
      return Object.assign(act0(), { god: g.id, target: pinned ? { x: en.x, y: en.y } : util.predict(en, 0.6) });
    }
    // the rest: each power when it pays off (a rebirth armed at full HP is wasted)
    let go;
    if (g.id === 'phoenix') go = hpPct < 0.45 || (impatient && hpPct < 0.7);
    else if (g.id === 'worldtree') go = d < 190 || hpPct < 0.5;
    else if (g.id === 'avatar') go = d < 260 || impatient;
    else if (g.id === 'timestop') go = d < 280;   // it must still reach (420) after the charge-up
    else go = d < 520;
    if (go) {
      lastGodUse[g.id] = s.time;
      return Object.assign(act0(), { god: g.id, target: util.predict(en, 0.4) });
    }
  }
  const ult = util.ultimate(s);
  if (ult && ult.ready && !en.invulnerable && !en.countering && safeCharge) {
    const helplessNow = en.stunned > 0.2 || en.rooted > 0.2 || en.frozen > 0;
    const inReach = util.inReach(s, ult.name) || (ult.type === 'area' && ult.target === 'point' && d <= (ult.range || 0) + (ult.radius || 0) * 0.5);
    const beamOk = ult.type !== 'beam' || helplessNow || d > 260;   // a long channel roots you: start it from range
    if (inReach && beamOk && (helplessNow || ult.type !== 'area' || ult.target !== 'point' || d < 260)) {
      const tgt = ult.type === 'projectile' ? util.lead(me, en, ult.speed || 900) : (ult.type === 'area' && ult.target === 'point') ? util.predict(en, helplessNow ? 0.1 : (ult.delay || 0) * 0.5) : { x: en.x, y: en.y };
      return act0('ultimate', tgt);
    }
  }

  // ── defence first ──
  const cc = me.stunned > 0 || me.rooted > 0.25 || me.silenced > 0.25;
  const dots = (me.burning + me.poisoned + me.bleeding) > 25;
  for (const ab of has('cleanse')) if (ready(ab) && (cc || (dots && hpPct < 0.7) || (me.vulnerable && me.vulnerable.amount >= 0.2))) return act(ab.name);
  if (me.stunned > 0) return { move };
  const enCast = en.casting;
  for (const ab of has('counter')) {
    if (!ready(ab)) continue;
    const meleeSoon = enCast && !enCast.basic && ['melee', 'dash'].includes(enCast.type) && enCast.timeLeft < 0.35 && gap < 140;
    const basicSoon = enCast && enCast.basic && enCast.timeLeft < 0.25 && gap < 110;
    const shotSoon = threat && threat.time < 0.3 && threat.projectile.damage >= 40;
    if (meleeSoon || basicSoon || shotSoon) return act(ab.name);
  }
  for (const ab of has('heal')) if (ready(ab) && hpPct < (ab.duration > 0 ? 0.6 : 0.45)) return act(ab.name);
  for (const ab of has('shield')) if (ready(ab) && me.shield <= 0 && hpPct < 0.9 && (threat || (enCast && d < 280) || gap < 60)) return act(ab.name);
  for (const ab of has('buff')) {
    if (!ready(ab)) continue;
    if ((ab.stat === 'armor' || ab.stat === 'tenacity') && (gap < 90 || enCast) && hpPct < 0.95) return act(ab.name);
    if (ab.stat === 'speed' && want === 0 && d > 250) return act(ab.name);
    if (['power', 'crit', 'haste'].includes(ab.stat) && d < Math.max(200, want + 80) && me.energy > ab.energyCost + 25) return act(ab.name);
  }

  // ── mobility ──
  for (const ab of has('dash')) {
    if (!ready(ab) || en.invulnerable) continue;
    if (want === 0 && d > 150 && d < ab.distance + 2 * R && los && !en.countering) return act(ab.name, ab.teleport ? { x: en.x, y: en.y } : util.lead(me, en, s.rules.dashSpeed));
    if (want > 0 && d < 150) {
      const dir = util.norm(util.add(util.away(me, en), util.scale(util.toward(me, arena.center), 0.7)));
      return act(ab.name, util.add(me, util.scale(dir, ab.distance)));
    }
  }

  // ── offence ──
  if (en.invulnerable) return Object.assign({ move, say }, v4x);
  const helpless = en.stunned > 0.25 || en.rooted > 0.25 || (en.casting && en.casting.timeLeft > 0.3) || en.channeling;
  const offence = me.abilities.filter(a => !a.basic && ['beam', 'area', 'zone', 'trap', 'projectile', 'melee'].includes(a.type) && a.ready);
  offence.sort((a, b) => (b.damage || b.dps || 0) - (a.damage || a.dps || 0));
  for (const ab of offence) {
    if (en.countering && ['melee', 'projectile', 'trap'].includes(ab.type) && gap < 200) continue;
    switch (ab.type) {
      case 'beam':
        if (d <= ab.range * 0.9 && los && (d > 150 || helpless)) return act(ab.name, util.predict(en, 0.2));
        break;
      case 'area':
        if (ab.target === 'point') { if (d <= ab.range + ab.radius * 0.4) return act(ab.name, util.predict(en, (ab.delay || 0) * (helpless ? 0.2 : 0.6))); }
        else if (d <= ab.radius + R - 4) return act(ab.name);
        break;
      case 'zone':
        if (ab.follow) { if (d <= ab.radius + R + 20) return act(ab.name); }
        else if (d <= ab.range + ab.radius * 0.5) return act(ab.name, util.predict(en, helpless ? 0.1 : 0.5));
        break;
      case 'trap':
        if (d <= ab.range + 40 && (me.traps || 0) < 2) return act(ab.name, util.predict(en, 0.9));
        break;
      case 'projectile':
        if (d <= ab.range * 0.9 && util.lineOfSight(s, me, en, ab.radius)) return act(ab.name, lead(ab));
        break;
      case 'melee':
        if (gap <= ab.range + (ab.lunge || 0) - 4) return act(ab.name, { x: en.x, y: en.y });
        break;
      default: break;
    }
  }
  const basic = util.basic(s);
  if (ready(basic)) {
    if (basic.type === 'melee' && gap <= basic.range - 2) return act(basic.name, { x: en.x, y: en.y });
    if (basic.type === 'projectile' && d <= basic.range * 0.9 && util.lineOfSight(s, me, en, basic.radius)) return act(basic.name, lead(basic));
  }
  return Object.assign({ move, say }, v4x);
}
