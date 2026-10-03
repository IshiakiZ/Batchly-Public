// STORMRIDERS - speed. The foot soldiers advance and pin the enemy line; cavalry and flyers wait
// wide on the wings, then sweep round both flanks once the lines lock and fall on archers, mages,
// siege - and the enemy general if it is left unguarded. Exposed soft targets are hunted at once.
var B = require('./lib/botlib');
var home = {}, wing = {};

function command(s) {
  B.begin(s);
  var orders = {};
  var foes = s.enemies.filter(function (e) { return !e.routing; });
  var line = s.squads.filter(function (q) { var r = B.role(q); return r === 'melee' && !q.routing && !q.general; });
  var lineX = line.length ? util.centroid(line).x : -300;
  var contact = s.squads.some(function (q) { return !q.general && q.engaged.length > 0; });
  var close = foes.some(function (e) { return line.some(function (q) { return util.dist(q, e) < 320; }); });
  var riders = s.squads.filter(function (q) { var r = B.role(q); return r === 'cav' || r === 'flyer'; });

  riders.forEach(function (q, i) { if (wing[q.id] === undefined) wing[q.id] = q.y < 0 ? -1 : q.y > 0 ? 1 : (i % 2 === 0 ? -1 : 1); });
  s.squads.forEach(function (q) {
    if (!home[q.id]) home[q.id] = { x: q.x, y: q.y };
    if (q.routing || q.general) return;
    var r = B.role(q), t = util.nearest(foes, q);
    if (r === 'cav' || r === 'flyer') {
      var w = wing[q.id];
      var eg = util.byId(s, 199);
      var guards = eg ? util.within(foes, eg, 220).filter(function (e) { return !e.general; }).length : 9;
      var tgt = eg && guards === 0 && util.dist(q, eg) < 650 ? eg : B.hammerTarget(s, q, { hunt: false });
      // strike when the lines have locked, when a soft target is exposed, or late in the battle
      var exposed = tgt && B.soft(tgt) && !util.within(foes, tgt, 160).some(function (e) { return e.type === 'spearmen' && !e.engaged.length; });
      if (tgt && (contact || exposed || q.flying || s.time > 38 || tgt === eg)) B.set(orders, q, B.approach(s, q, tgt));
      else B.set(orders, q, { move: { x: Math.min(-150, lineX + 40), y: w * Math.max(260, Math.abs(home[q.id].y)) } });
    } else if (r === 'melee') {
      if (t && (close || contact || s.time > 32)) B.set(orders, q, q.legendary || !q.chargeReady ? { attack: t.id } : { charge: t.id });
      else B.set(orders, q, { move: { x: -150, y: home[q.id].y } });
    } else if (r === 'ranged' || r === 'spell') {
      var k = B.kite(s, q, 110);
      var inRange = foes.some(function (e) { return util.dist(q, e) <= q.range; });
      if (k) B.set(orders, q, { move: k });
      else if (inRange) B.set(orders, q, { hold: true });
      else B.set(orders, q, { move: { x: Math.max(-620, Math.min(lineX - 110, -180)), y: home[q.id].y } });
    } else if (r === 'siege') B.set(orders, q, { hold: true });
  });
  var g = util.byId(s, 99);
  if (g) B.set(orders, g, { move: B.generalSpot(s, 180) });
  B.powers(s, orders);
  return { orders: orders, say: s.time < 0.6 ? 'Ride like the wind!' : undefined };
}
