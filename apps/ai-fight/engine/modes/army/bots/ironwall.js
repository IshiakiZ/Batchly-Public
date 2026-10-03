// IRONWALL - defence. Shield walls and braced spears hold a line on our side of the field,
// archers and catapults shoot from behind it, the cavalry reserve punishes anything that
// gets stuck on the wall. Attacks only late, or when it is clearly ahead.
var B = require('./lib/botlib');
var home = {};
var LINE_X = -300;

function command(s) {
  B.begin(s);
  var orders = {};
  var foes = s.enemies.filter(function (e) { return !e.routing; });
  var contact = s.squads.some(function (q) { return q.engaged.length > 0; });
  var ahead = s.me.strength - s.enemy.strength;
  var attack = (s.time > 110 && ahead <= 5) || (s.time > 60 && ahead > 25) || s.timeLeft < 40;
  var creep = !contact && s.time > 50 && !attack;
  var lineX = creep ? LINE_X + Math.min(220, (s.time - 50) * 4) : LINE_X;

  s.squads.forEach(function (q) {
    if (!home[q.id]) home[q.id] = { x: q.x, y: q.y };
    if (q.routing || q.general) return;
    var r = B.role(q), t = util.nearest(foes, q);
    if (r === 'melee') {
      if (attack && t) B.set(orders, q, { attack: t.id });
      else if (t && util.dist(q, t) < q.radius + t.radius + 40 && q.type !== 'spearmen') B.set(orders, q, { attack: t.id });
      else B.set(orders, q, { hold: { x: lineX, y: home[q.id].y } });
    } else if (r === 'ranged' || r === 'spell') {
      var k = B.kite(s, q, 90);
      if (k) B.set(orders, q, { move: k });
      else if (attack && t && util.dist(q, t) > q.range) B.set(orders, q, { attack: t.id });
      else B.set(orders, q, { hold: { x: lineX - 140, y: home[q.id].y * 0.8 } });
    } else if (r === 'cav' || r === 'flyer') {
      var pinned = B.pinned(s).filter(function (e) { return util.dist(e, q) < 520; });
      var tgt = pinned.length ? util.nearest(pinned, q) : attack ? B.hammerTarget(s, q) : null;
      if (tgt) B.set(orders, q, B.approach(s, q, tgt));
      else B.set(orders, q, { hold: { x: lineX - 150, y: home[q.id].y } });
    } else if (r === 'siege') {
      B.set(orders, q, { hold: true });
    }
  });
  var g = util.byId(s, 99);
  if (g) B.set(orders, g, { move: { x: lineX - 260, y: 0 } });
  B.powers(s, orders);
  return { orders: orders, say: s.time < 0.6 ? 'None shall pass.' : undefined };
}
