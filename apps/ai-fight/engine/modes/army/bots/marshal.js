// MARSHAL - combined arms. A steady infantry line with archers behind it; the cavalry waits
// on the wings until the lines lock, then hammers flanks, rears and soft targets.
var B = require('./lib/botlib');
var home = {};

function command(s) {
  B.begin(s);
  var orders = {};
  var foes = s.enemies.filter(function (e) { return !e.routing; });
  var line = s.squads.filter(function (q) { return B.role(q) === 'melee' && !q.routing; });
  var lineX = line.length ? util.centroid(line).x : -300;
  var contact = s.squads.some(function (q) { return q.engaged.length > 0; });
  var close = foes.some(function (e) { return line.some(function (q) { return util.dist(q, e) < 300; }); });

  s.squads.forEach(function (q) {
    if (!home[q.id]) home[q.id] = { x: q.x, y: q.y };
    if (q.routing || q.general) return;
    var r = B.role(q), t;
    if (r === 'melee') {
      t = util.nearest(foes, q);
      if ((close || contact || s.time > 35) && t) B.set(orders, q, q.legendary || !q.chargeReady ? { attack: t.id } : { charge: t.id });
      else B.set(orders, q, { move: { x: -160, y: home[q.id].y } });
    } else if (r === 'ranged' || r === 'spell') {
      var k = B.kite(s, q, 110);
      var inRange = foes.some(function (e) { return util.dist(q, e) <= q.range; });
      if (k) B.set(orders, q, { move: k });
      else if (inRange) B.set(orders, q, { hold: true });
      else B.set(orders, q, { move: { x: Math.max(-620, Math.min(lineX - 110, -180)), y: home[q.id].y } });
    } else if (r === 'cav' || r === 'flyer') {
      t = B.hammerTarget(s, q);
      if (t && (contact || s.time > 40 || B.soft(t) || q.flying)) B.set(orders, q, B.approach(s, q, t));
      else B.set(orders, q, { move: { x: Math.min(-200, lineX - 20), y: home[q.id].y } });
    } else if (r === 'siege') {
      B.set(orders, q, { hold: true });
    }
    // healers: the default follows the most wounded squad
  });
  var g = util.byId(s, 99);
  if (g) B.set(orders, g, { move: B.generalSpot(s, 170) });
  B.powers(s, orders);
  return { orders: orders, say: s.time < 0.6 ? 'Steady... wait for my signal.' : undefined };
}
