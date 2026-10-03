// IRON FIST - armour. Tanks and APCs lead the thrust; infantry and rocket teams follow to clear
// towns; anti-air rides behind the tanks. EMP and airstrikes break the enemy line.
var B = require('./lib/botlib');

function command(s) {
  var orders = B.run(s, { ground: 'steady', pace: 11, armour: 'lead', startX: -480, powers: {} }, {});
  return { orders: orders, say: s.time < 0.6 ? "Panzer vor!" : undefined };
}
