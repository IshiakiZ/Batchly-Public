// WARLOCK - firepower. Archers, battle mages and catapults behind a spear screen. Missile
// troops step back from anything that closes in; riders guard the shooters; the general
// calls down the heavens on the thickest enemy blob.
var B = require('./lib/botlib');
var home = {};

function command(s) {
  B.begin(s);
  var orders = {};
  var foes = s.enemies.filter(function (e) { return !e.routing; });
  var shooters = s.squads.filter(function (q) { var r = B.role(q); return r === 'ranged' || r === 'spell' || r === 'siege'; });
  var sc = shooters.length ? util.centroid(shooters) : { x: -450, y: 0 };
  s.squads.forEach(function (q) {
    if (!home[q.id]) home[q.id] = { x: q.x, y: q.y };
    if (q.routing || q.general) return;
    var r = B.role(q), t = util.nearest(foes, q);
    if (r === 'ranged' || r === 'spell') {
      var k = B.kite(s, q, 170);
      if (k) B.set(orders, q, { move: k });
      else if (t && util.dist(q, t) <= q.range) B.set(orders, q, { hold: true });
      else if (s.time > 70 && t) B.set(orders, q, { attack: t.id });
      else B.set(orders, q, { move: { x: -330, y: home[q.id].y * 0.8 } });
    } else if (r === 'siege') {
      B.set(orders, q, { hold: true });
    } else if (r === 'melee') {
      if (t && (util.dist(q, t) < 170 || s.time > 100)) B.set(orders, q, { attack: t.id });
      else B.set(orders, q, { hold: { x: -200, y: home[q.id].y } });
    } else if (r === 'cav' || r === 'flyer') {
      var threat = util.nearest(foes, sc);
      if (threat && util.dist(threat, sc) < 300) B.set(orders, q, B.approach(s, q, threat));
      else if (s.time > 60) { var h = B.hammerTarget(s, q); if (h) B.set(orders, q, B.approach(s, q, h)); }
      else B.set(orders, q, { hold: { x: -380, y: home[q.id].y } });
    }
  });
  var g = util.byId(s, 99);
  if (g) B.set(orders, g, { move: { x: Math.min(-480, sc.x - 120), y: sc.y * 0.5 } });
  B.powers(s, orders, 'eager');
  return { orders: orders, say: s.time < 0.6 ? 'Let the skies burn.' : undefined };
}
