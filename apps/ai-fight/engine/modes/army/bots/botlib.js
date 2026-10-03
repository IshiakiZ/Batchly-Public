// botlib.js - shared tactics used by the sparring bots (engine/modes/army/bots/*.js).
// Loaded by the bots with require('./lib/botlib'), exactly like your own lib/*.js modules.
// Feel free to read and borrow ideas.

var B = {};

B.role = function (q) {
  if (q.general) return 'general';
  switch (q.type) {
    case 'archers': case 'archangels': return 'ranged';
    case 'mages': return 'spell';
    case 'catapult': return 'siege';
    case 'clerics': return 'healer';
    case 'cavalry': case 'knights': return 'cav';
    case 'griffins': case 'dragon': return 'flyer';
    default: return 'melee';
  }
};

B.soft = function (e) { return e.type === 'archers' || e.type === 'mages' || e.type === 'clerics' || e.type === 'catapult'; };

// Missile fire a side can put out: soldiers in archer / archangel squads, mages count double,
// catapults four times (their stones kill several at once).
B.firepower = function (list) {
  var n = 0;
  for (var i = 0; i < list.length; i++) {
    var q = list[i];
    if (q.routing || q.general) continue;
    var r = B.role(q);
    if (r === 'ranged') n += q.count || 0;
    else if (r === 'spell') n += (q.count || 0) * 2;
    else if (r === 'siege') n += (q.count || 0) * 4;
  }
  return n;
};
// True when the enemy clearly out-shoots us: waiting under their arrows only loses, so close in.
// When out-shot: the nearest enemy shooter a melee squad can reach (skipping ones deep behind braced spears).
B.shooterTarget = function (s, q) {
  var best = null, bd = 520;
  for (var i = 0; i < s.enemies.length; i++) {
    var e = s.enemies[i];
    if (e.routing || !B.soft(e)) continue;
    var d = util.dist(q, e);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
};
B.outgunned = function (s) { var mine = B.firepower(s.squads), theirs = B.firepower(s.enemies); return theirs > mine * 1.4 + 10; };

// Enemies busy fighting one of our squads: their flanks and rears are open.
B.pinned = function (s) {
  return s.enemies.filter(function (e) { return !e.routing && e.engaged && e.engaged.length > 0; });
};

// Best target for a fast "hammer" (cavalry, flyers): soft targets first, then pinned enemies,
// never a braced spear wall from the front.
B.hammerTarget = function (s, q, opts) {
  opts = opts || {};
  var best = null, bs = -Infinity;
  for (var i = 0; i < s.enemies.length; i++) {
    var e = s.enemies[i];
    if (e.routing && !opts.chase) continue;
    var d = util.dist(q, e);
    var score = -d;
    if (B.soft(e)) score += 320;
    if (e.engaged && e.engaged.length) score += 220;
    if (e.general) score += opts.hunt ? 500 : -200;
    if (e.type === 'spearmen' && !(e.engaged && e.engaged.length)) score -= q.flying ? 150 : 600;
    if (e.legendary && !q.flying) score -= 250;
    if (e.routing) score -= 250;
    if (score > bs) { bs = score; best = e; }
  }
  return best;
};

// Approach an enemy so the hit lands on its flank or rear: returns an order.
B.approach = function (s, q, e) {
  var from = util.side(e, q);
  if (from !== 'front' || (e.engaged && e.engaged.length === 0 && util.dist(q, e) < 140) || e.formation === 'square') {
    return q.chargeReady || util.dist(q, e) > 180 ? { charge: e.id } : { attack: e.id };
  }
  // circle round to the side that is closer to us
  var left = util.flank(e, -1, e.radius + q.radius + 60), right = util.flank(e, 1, e.radius + q.radius + 60);
  var p = util.dist(q, left) < util.dist(q, right) ? left : right;
  p = util.clampToField(s, p, 40);
  if (util.dist(q, p) < 30) return { charge: e.id };
  return { move: util.path(s, q, p, q.radius) };
};

// Missile troops: back off when enemy melee closes in. Returns a retreat point or null.
B.kite = function (s, q, margin) {
  margin = margin || 150;
  var th = null, bd = Infinity;
  for (var i = 0; i < s.enemies.length; i++) {
    var e = s.enemies[i];
    if (e.routing || e.range > 0) continue;
    var d = util.dist(q, e) - e.radius - q.radius;
    if (d < bd) { bd = d; th = e; }
  }
  if (!th || bd > margin || q.engaged.length) return null;
  var away = util.away(q, th);
  var p = { x: q.x + away.x * 120 - 40, y: q.y + away.y * 120 };
  if (p.x < s.field.minX + 60) p.x = s.field.minX + 60;
  return util.clampToField(s, p, 40);
};

// The biggest clump of visible enemies (for meteors): {x, y, n}
B.cluster = function (s, radius, friendsClear) {
  var best = null, bn = 0;
  for (var i = 0; i < s.enemies.length; i++) {
    var c = s.enemies[i], n = 0;
    for (var j = 0; j < s.enemies.length; j++) if (util.dist(c, s.enemies[j]) < radius) n += s.enemies[j].count * (s.enemies[j].legendary ? 12 : 1);
    var clear = true;
    for (var k = 0; k < s.squads.length && friendsClear; k++) if (util.dist(c, s.squads[k]) < radius + s.squads[k].radius + 25) { clear = false; break; }
    if (clear && n > bn) { bn = n; best = { x: c.x, y: c.y, n: n, id: c.id }; }
  }
  return best;
};

// The general's powers: rally, meteor, aegis, wrath.
B.powers = function (s, orders, style) {
  var g = util.byId(s, 99);
  if (!g) return;
  var near = util.within(s.squads, g, 300).filter(function (q) { return !q.general; });
  var rally = util.power(s, 'rally');
  if (rally && rally.ready) {
    var shaky = near.filter(function (q) { return q.routing || q.morale < 32; });
    if (shaky.length >= (style === 'eager' ? 1 : 2) || shaky.some(function (q) { return q.routing; })) { orders[99] = { ability: 'rally' }; return; }
  }
  var met = util.power(s, 'meteor');
  if (met && met.ready) {
    var c = B.cluster(s, 110, true);
    if (c && c.n >= 18 && util.dist(g, c) < 880) { orders[99] = { ability: 'meteor', target: { x: c.x, y: c.y } }; return; }
  }
  var aeg = util.power(s, 'aegis');
  if (aeg && aeg.ready && util.fighting(util.within(s.squads, g, 320)).length >= 3) { orders[99] = { ability: 'aegis' }; return; }
  var wr = util.power(s, 'wrath');
  if (wr && wr.ready && util.within(s.enemies, g, 600).filter(function (e) { return !e.routing; }).length >= 2) { orders[99] = { ability: 'wrath' }; return; }
};

// Keep the general near (but behind) the army so its morale aura helps.
B.generalSpot = function (s, back) {
  var own = s.squads.filter(function (q) { return !q.general && !q.routing; });
  if (!own.length) return { x: s.field.minX + 80, y: 0 };
  var c = util.centroid(own);
  var p = { x: c.x - (back || 170), y: c.y * 0.7 };
  var th = util.nearest(s.enemies.filter(function (e) { return !e.routing; }), p);
  if (th && util.dist(th, p) < 200) p = { x: p.x - 150, y: p.y };
  return util.clampToField(s, p, 60);
};

// Only send an order when it changes something (orders persist). Top-level variables live
// for the whole battle; `memory` would carry them into the next round, so it is not used here.
var last = {}, lastClear = 0;
B.begin = function (s) { if (s.time - lastClear >= 4) { last = {}; lastClear = s.time; } };
B.set = function (orders, q, o) {
  var key = JSON.stringify(o);
  if (last[q.id] === key) return;
  last[q.id] = key;
  orders[q.id] = o;
};

module.exports = B;
