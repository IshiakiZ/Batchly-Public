// SKY COMMAND - air power. A small ground force holds its line with anti-air while helicopters,
// fighters and bombers take the battle to the enemy. The command post calls in strikes eagerly.
var B = require('./lib/botlib');

function command(s) {
  // hold the line while the air force does the work; without aircraft, advance like everyone else
  var air = s.units.some(function (q) { return q.flying; });
  var cfg = air ? { ground: 'hold', holdX: -440, holdUntil: 80, armour: 'support', powers: { bombEager: true } }
                : { ground: 'steady', pace: 6, armour: 'with', startX: -520, powers: { bombEager: true } };
  var orders = B.run(s, cfg, {});
  return { orders: orders, say: s.time < 0.6 ? "The sky is ours." : undefined };
}
