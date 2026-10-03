// commander.js - your army's brain. command(s) runs twice per second of battle.
// You always see yourself on the LEFT, attacking toward +x. Unit ids: yours 1..n (in forces.json order),
// your command post 99; enemies 101..(100+n), their command post 199.
// Return only the orders you want to change: every order persists until you change it.
// Units WITHOUT orders advance, engage the nearest enemy they can hurt and stop at a good range.
// Full manual: WAR_GUIDE.md.   Try it:  node arena.js test <id>

function command(s) {
  var orders = {};
  var foes = s.enemies.filter(function (e) { return !e.routing; });

  s.units.forEach(function (q) {
    if (q.routing || q.hq) return;
    var t = util.nearest(foes, q);
    // machine guns cannot shoot on the move: set up once an enemy is in range, then stay put
    if (q.type === 'machinegun' && t && util.dist(q, t) < q.range * 0.95 && q.order !== 'hold') orders[q.id] = { hold: true, target: t.id };
  });

  // rally wavering troops near the command post
  var rally = util.power(s, 'rally');
  if (rally && rally.ready) {
    var shaky = s.units.filter(function (q) { return !q.hq && (q.routing || q.morale < 30); });
    if (shaky.length >= 2) orders[99] = { ability: 'rally' };
  }

  // `memory` survives between the rounds of a match (max 16 KB)
  if (s.time < 0.6) memory.battles = (memory.battles || 0) + 1;
  return { orders: orders, say: s.time < 0.6 ? 'Move out!' : undefined };
}
