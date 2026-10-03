// COALITION - combined arms. The infantry line advances steadily with the armour, machine guns set
// up in range, rocket teams hunt vehicles, helicopters strike where there is no anti-air, artillery
// and fighters cover from behind.
var B = require('./lib/botlib');

function command(s) {
  var orders = B.run(s, { ground: 'steady', pace: 7, armour: 'with', startX: -520, powers: {} }, {});
  return { orders: orders, say: s.time < 0.6 ? "Advance on all fronts." : undefined };
}
