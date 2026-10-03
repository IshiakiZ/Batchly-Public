// botlib.js - shared tactics of the Modern Warfare sparring bots (engine/modes/war/bots/*.js).
// Loaded by the bots with require('./lib/botlib'), exactly like your own lib/*.js modules.
// Feel free to read and borrow ideas.

var B = {};

B.role = function (q) {
  if (q.hq) return 'hq';
  switch (q.type) {
    case 'riflemen': return 'inf';
    case 'machinegun': return 'mg';
    case 'rockets': return 'at';
    case 'snipers': return 'sniper';
    case 'jeep': return 'recon';
    case 'apc': return 'ifv';
    case 'tank': case 'mammoth': return 'tank';
    case 'artillery': case 'mlrs': return 'arty';
    case 'antiair': return 'aa';
    case 'helicopter': case 'drone': return 'heli';
    case 'fighter': return 'fighter';
    case 'bomber': case 'stealthbomber': return 'bomber';
    case 'patrolboat': case 'destroyer': case 'battleship': return 'ship';
    case 'submarine': return 'sub';
    default: return 'inf';
  }
};

B.isVehicle = function (e) { return e.cls === 'light' || e.cls === 'heavy' || e.cls === 'hq'; };

// Only send an order when it changes something (orders persist). Top-level variables live for the
// whole battle; `memory` would carry them into the next round, so it is not used here.
var last = {}, lastClear = 0;
B.begin = function (s) { if (s.time - lastClear >= 4) { last = {}; lastClear = s.time; } };
B.set = function (orders, q, o) {
  var key = JSON.stringify(o);
  if (last[q.id] === key) return;
  last[q.id] = key;
  orders[q.id] = o;
};

// Enemy anti-air cover at a point: how much fire a helicopter would face there.
B.aaThreat = function (s, p) {
  var n = 0;
  s.enemies.forEach(function (e) {
    if (e.routing) return;
    e.weapons.forEach(function (w) {
      if ((w.antiAir || w.kind === 'autocannon') && util.dist(e, p) < w.range + 80) n += w.kind === 'aa' ? 2 : 1;
    });
  });
  return n;
};

// The enemy that unit q hurts most, worth the most, nearest (optionally filtered / within a distance).
B.best = function (s, q, filter, maxDist) {
  var best = null, bs = -Infinity;
  s.enemies.forEach(function (e) {
    if (e.routing || e.state === 'rearming') return;
    if (filter && !filter(e)) return;
    var d = util.dist(q, e);
    if (maxDist && d > maxDist) return;
    var k = util.canHurt(q, e);
    if (k <= 0) return;
    var sc = k * (e.value + 20) / (200 + d);
    if (e.hq) sc *= 1.4;
    if (sc > bs) { bs = sc; best = e; }
  });
  return best;
};

// The biggest clump of enemies on the ground / water (for bombs and barrages): {x, y, n}
B.cluster = function (s, radius, friendsClear) {
  var best = null, bn = 0;
  s.enemies.forEach(function (c) {
    if (c.flying || c.routing) return;
    var n = 0;
    s.enemies.forEach(function (e) { if (!e.flying && util.dist(c, e) < radius) n += Math.min(e.count, 8) * (e.cls === 'inf' ? 1 : 3); });
    if (c.hq) n += 12;
    if (friendsClear) for (var i = 0; i < s.units.length; i++) { var f = s.units[i]; if (!f.flying && util.dist(c, f) < radius + f.radius + 40) return; }
    if (n > bn) { bn = n; best = { x: c.x, y: c.y, n: n, id: c.id }; }
  });
  return best;
};

// Where our ground line stands (centroid of the foot soldiers and armour).
B.lineX = function (s) {
  var own = s.units.filter(function (q) { return !q.hq && !q.flying && !q.naval && !q.routing; });
  return own.length ? util.centroid(own).x : -500;
};

// The support powers of the command post.
B.powers = function (s, orders, style) {
  style = style || {};
  var hq = util.byId(s, 99);
  if (!hq) return;
  var P = function (n) { var p = util.power(s, n); return p && p.ready ? p : null; };
  var near = s.units.filter(function (q) { return !q.hq && util.dist(q, hq) < 350; });
  var shaky = near.filter(function (q) { return q.routing || q.morale < 30; });
  if (P('rally') && (shaky.length >= (style.eagerRally ? 1 : 2) || shaky.some(function (q) { return q.routing; }))) { orders[99] = { ability: 'rally' }; return; }
  var eh = util.byId(s, 199);
  if (P('cruise') && eh) { orders[99] = { ability: 'cruise', target: { x: eh.x, y: eh.y } }; return; }
  if (P('emp')) {
    var armour = s.enemies.filter(function (e) { return B.isVehicle(e) || e.flying || e.naval; });
    var bestE = null, bn = 0;
    armour.forEach(function (c) {
      if (util.dist(c, hq) > 1000) return;
      var n = armour.filter(function (e) { return util.dist(c, e) < 240; }).length;
      var mine = s.units.filter(function (f) { return f.cls !== 'inf' && util.dist(c, f) < 260; }).length;
      if (n - mine > bn) { bn = n - mine; bestE = c; }
    });
    if (bestE && bn >= 3) { orders[99] = { ability: 'emp', target: { x: bestE.x, y: bestE.y } }; return; }
  }
  var big = ['carpet', 'airstrike', 'barrage'];
  for (var i = 0; i < big.length; i++) {
    var p = P(big[i]);
    if (!p) continue;
    var c = B.cluster(s, 110, true);
    if (c && c.n >= (style.bombEager ? 10 : 16) && util.dist(hq, c) < p.range) { orders[99] = { ability: big[i], target: { x: c.x, y: c.y } }; return; }
  }
  if (P('smoke')) {
    // smoke our own front-line troops that are taking a beating
    var hurt = s.units.filter(function (q) { return !q.hq && !q.flying && !q.naval && !q.inSmoke && q.morale < 45 && util.threats(s, q, 400).length >= 2; });
    if (hurt.length && util.dist(hq, hurt[0]) < 880) { orders[99] = { ability: 'smoke', target: { x: hurt[0].x, y: hurt[0].y } }; return; }
  }
};

// A whole army following a doctrine.
//   cfg.ground: 'steady' | 'hold' | 'rush'   how the foot soldiers and armour advance
//   cfg.holdX: where a holding line waits (own coordinates)
//   cfg.pace: units per second the steady line moves forward
//   cfg.armour: 'lead' | 'with' | 'support'   tanks ahead of, with or behind the infantry
//   cfg.assault: infantry charges when the enemy is this close (0 = never)
//   'wave' ground: the foot soldiers cross together (the front waits for the slowest), under smoke,
//   and only break into a run once the enemy is close
B.run = function (s, cfg, orders) {
  cfg = cfg || {};
  B.begin(s);
  var foes = s.enemies.filter(function (e) { return !e.routing; });
  var ground = foes.filter(function (e) { return !e.flying; });
  var contact = ground.some(function (e) { return s.units.some(function (q) { return !q.flying && !q.naval && !q.hq && util.dist(q, e) < 520; }); });
  var line = B.lineX(s);
  var steadyX = Math.min(400, (cfg.startX || -520) + s.time * (cfg.pace || 7));
  var holding = cfg.ground === 'hold' && !contact && s.time < (cfg.holdUntil || 70);
  var wave = cfg.ground === 'wave' ? B.wave(s, ground) : null;

  s.units.forEach(function (q) {
    if (q.routing || q.hq) return;
    var r = B.role(q);
    var t, d;
    if (r === 'inf' || r === 'mg' || r === 'at' || r === 'sniper') {
      if (r === 'at') {
        t = B.best(s, q, B.isVehicle, 520);
        if (t) { B.set(orders, q, { attack: t.id }); return; }
      }
      if (r === 'sniper') {
        t = B.best(s, q, function (e) { return e.cls === 'inf'; }, q.range);
        if (t) { B.set(orders, q, { hold: true, target: t.id }); return; }
        B.set(orders, q, { move: { x: Math.min(line - 90, -250), y: q.y } });
        return;
      }
      t = util.nearest(ground, q);
      d = t ? util.dist(q, t) : Infinity;
      if (r === 'mg' && t && d < q.range * 0.95) { B.set(orders, q, { hold: true, target: t.id }); return; }
      if (cfg.assault && t && d < cfg.assault && t.cls === 'inf' && r === 'inf') { B.set(orders, q, { charge: t.id }); return; }
      if (holding) { B.set(orders, q, { hold: { x: cfg.holdX || -420, y: q.y } }); return; }
      if (wave && !wave.close) {
        if (q.x > wave.x + 30) B.set(orders, q, { hold: true });
        else B.set(orders, q, { move: { x: wave.x + 60, y: q.y } });
        return;
      }
      if (cfg.ground === 'steady' && !contact) { B.set(orders, q, { move: { x: steadyX, y: q.y } }); return; }
      B.set(orders, q, { auto: true });
    } else if (r === 'recon') {
      t = B.best(s, q, function (e) { return e.cls === 'inf' || e.type === 'artillery' || e.type === 'mlrs'; }, 700);
      if (t && !s.enemies.some(function (e) { return (e.type === 'tank' || e.type === 'rockets') && util.dist(e, t) < 260; })) { B.set(orders, q, { attack: t.id }); return; }
      B.set(orders, q, { move: { x: Math.min(line + 200, 500), y: q.y < 0 ? -520 : 520 } });
    } else if (r === 'tank' || r === 'ifv') {
      t = B.best(s, q, null, 900);
      if (holding && cfg.armour !== 'lead') { B.set(orders, q, { hold: { x: (cfg.holdX || -420) - 60, y: q.y } }); return; }
      if (cfg.armour === 'support' && !contact) { B.set(orders, q, { move: { x: steadyX - 120, y: q.y } }); return; }
      if (t) { B.set(orders, q, { attack: t.id }); return; }
      B.set(orders, q, { move: { x: cfg.armour === 'lead' ? Math.min(steadyX + 150, 600) : steadyX, y: q.y } });
    } else if (r === 'arty') {
      B.set(orders, q, { hold: { x: Math.min(q.x, -700), y: q.y } });
    } else if (r === 'aa') {
      B.set(orders, q, { move: { x: Math.min(line - 110, 300), y: q.y * 0.8 } });
    } else if (r === 'heli') {
      t = B.best(s, q, function (e) { return !e.flying && B.aaThreat(s, e) < (q.type === 'drone' ? 3 : 2); }, 1400);
      if (t) B.set(orders, q, { attack: t.id });
      else B.set(orders, q, { move: { x: Math.min(line - 60, 200), y: q.y } });
    } else if (r === 'fighter') {
      t = util.nearest(foes.filter(function (e) { return e.flying; }), q);
      if (t) B.set(orders, q, { attack: t.id }); else B.set(orders, q, { auto: true });
    } else if (r === 'bomber') {
      var c = null, bs = -1;
      foes.forEach(function (e) {
        if (e.flying) return;
        var aa = B.aaThreat(s, e);
        var n = foes.filter(function (o) { return !o.flying && util.dist(o, e) < 110; }).reduce(function (a, o) { return a + Math.min(o.count, 8) * (o.cls === 'inf' ? 1 : 3); }, 0);
        if (e.hq) n += 10;
        if (e.type === 'artillery' || e.type === 'mlrs') n += 6;
        var near = s.units.some(function (f) { return !f.flying && util.dist(f, e) < 130; });
        if (near) return;
        var sc = n / (1 + aa * (q.type === 'stealthbomber' ? 0.2 : 0.8));
        if (sc > bs) { bs = sc; c = e; }
      });
      if (c) B.set(orders, q, { attack: c.id }); else B.set(orders, q, { auto: true });
    } else if (r === 'ship') {
      t = B.best(s, q, null, q.range);
      if (t) B.set(orders, q, { attack: t.id });
      else B.set(orders, q, { move: { x: Math.min(q.x + 220, cfg.navalX || 200), y: q.y } });
    } else if (r === 'sub') {
      t = B.best(s, q, function (e) { return e.naval; }, 1400);
      if (t) B.set(orders, q, { attack: t.id }); else B.set(orders, q, { move: { x: Math.min(q.x + 200, 300), y: q.y } });
    }
  });
  B.powers(s, orders, cfg.powers);
  if (wave && !wave.close && wave.smokeAt) B.smokeWave(s, orders, wave);
  return orders;
};

// Where a wave of foot soldiers stands: x = just ahead of the slowest, close = the enemy is near.
B.wave = function (s, ground) {
  var foot = s.units.filter(function (q) { return q.cls === 'inf' && !q.hq && !q.routing && q.type !== 'snipers'; });
  if (!foot.length) return null;
  var back = Math.min.apply(null, foot.map(function (q) { return q.x; }));
  var front = Math.max.apply(null, foot.map(function (q) { return q.x; }));
  var gap = Infinity;
  foot.forEach(function (q) { ground.forEach(function (e) { gap = Math.min(gap, util.dist(q, e)); }); });
  var c = util.centroid(foot);
  return { x: back + 70, front: front, close: gap < 380, smokeAt: gap < 760 ? { x: c.x + 110, y: c.y } : null };
};

// Cover the wave's crossing with a smoke screen just ahead of it.
B.smokeWave = function (s, orders, wave) {
  var p = util.power(s, 'smoke'), hq = util.byId(s, 99);
  if (!p || !p.ready || !hq || orders[99]) return;
  if (util.dist(hq, wave.smokeAt) > p.range) return;
  if (s.terrain.smoke.some(function (m) { return util.dist(m, wave.smokeAt) < m.r && m.left > 3; })) return;
  orders[99] = { ability: 'smoke', target: { x: wave.smokeAt.x, y: wave.smokeAt.y } };
};

module.exports = B;
