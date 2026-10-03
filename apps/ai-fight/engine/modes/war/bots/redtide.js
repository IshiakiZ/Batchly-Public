// RED TIDE - numbers. Waves of cheap riflemen, machine guns and rocket teams storm straight in and
// finish the enemy in close assault; the command post keeps rallying them.
var B = require('./lib/botlib');

function command(s) {
  var orders = B.run(s, { ground: 'steady', pace: 9, startX: -480, armour: 'with', assault: 170, powers: { eagerRally: true, bombEager: true } }, {});
  return { orders: orders, say: s.time < 0.6 ? "Forward! No step back!" : undefined };
}
