// STEEL RAIN - firepower. Infantry and snipers dig in (holding still = dug in) while howitzers,
// rocket artillery and warships pound whatever comes. Advances only late.
var B = require('./lib/botlib');

function command(s) {
  var orders = B.run(s, { ground: 'hold', holdX: -520, holdUntil: 100, armour: 'support', powers: { bombEager: true } }, {});
  return { orders: orders, say: s.time < 0.6 ? "Fire for effect!" : undefined };
}
