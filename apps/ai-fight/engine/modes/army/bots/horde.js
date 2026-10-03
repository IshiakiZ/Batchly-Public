// HORDE - numbers and fury. As many cheap squads as the budget allows, advancing together in loose
// order to blunt the arrows, closing into a line for the crash, and never stopping. The wave moves
// at the pace of its slowest squad so it hits all at once; the riders wait for that crash, then
// swing round the flanks. Out-shot (massed archers, catapults), nobody waits: everyone runs in
// and goes for the shooters. The general rides close behind to keep them from breaking.
var B = require('./lib/botlib');

function command(s) {
  B.begin(s);
  var orders = {};
  var foes = s.enemies.filter(function (e) { return !e.routing; });
  var wave = s.squads.filter(function (q) { return B.role(q) === 'melee' && !q.routing && !q.general && !q.legendary; });
  var contact = s.squads.some(function (q) { return !q.general && q.engaged.length > 0; });
  var outgunned = B.outgunned(s);   // under heavy fire (catapults, massed archers): no waiting, everyone runs in
  // the wave line: just ahead of the rearmost foot squad, so the fast ones wait for the slow ones
  var waveX = wave.length ? Math.min.apply(null, wave.map(function (q) { return q.x; })) + 90 : 0;
  s.squads.forEach(function (q) {
    if (q.routing || q.general) return;
    var r = B.role(q), t = (r === 'melee' && !q.engaged.length && outgunned && B.shooterTarget(s, q)) || util.nearest(foes, q);
    if (r === 'melee') {
      if (!t) { B.set(orders, q, { move: { x: 500, y: q.y > 0 ? 100 : -100 }, formation: q.legendary ? undefined : 'loose' }); return; }
      var d = util.dist(q, t);
      if (!q.legendary && !contact && !outgunned && d > 260 && q.x > waveX) { B.set(orders, q, { hold: { x: waveX, y: q.y }, formation: 'loose' }); return; }
      var form = q.legendary ? undefined : d > 200 && !q.engaged.length ? 'loose' : 'line';
      var o = q.chargeReady && d < 260 ? { charge: t.id } : { attack: t.id };
      if (form && form !== q.formation) o.formation = form;
      B.set(orders, q, o);
    } else if (r === 'cav' || r === 'flyer') {
      var h = B.hammerTarget(s, q, { chase: true });
      if (h && (contact || s.time > 30)) {   // the riders never ride out alone: they wait for the wave to hit
        var a = B.approach(s, q, h);
        if (!q.legendary && q.formation !== 'wedge') a.formation = 'wedge';
        B.set(orders, q, a);
      } else B.set(orders, q, { move: { x: Math.max(-700, waveX - 20), y: q.y < 0 ? -300 : 300 } });
    } else if (r === 'ranged' || r === 'spell') {
      if (t && util.dist(q, t) <= q.range) B.set(orders, q, { hold: true });
      else if (t) B.set(orders, q, { attack: t.id });
    }
  });
  var g = util.byId(s, 99);
  if (g) B.set(orders, g, { move: B.generalSpot(s, 120) });
  B.powers(s, orders, 'eager');
  return { orders: orders, say: s.time < 0.6 ? 'WAAAGH! Charge!' : undefined };
}
