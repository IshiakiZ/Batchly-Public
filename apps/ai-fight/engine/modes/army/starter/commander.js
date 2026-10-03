// commander.js - your army's brain. command(s) runs twice per second of battle.
// You always see yourself on the LEFT (x < 0), attacking toward +x. Squad ids: yours 1..n
// (army.json order), your general 99; enemies 101..(100+n), their general 199.
// Return orders only for squads you want to change: orders persist until you change them.
// Squads without orders follow the default: advance and engage the nearest visible enemy
// (missile troops stop to shoot as soon as something is in range).
// See ARMY_GUIDE.md for every field and order.

memory.battles = (memory.battles || 0) + 1;   // `memory` survives between rounds

function command(s) {
  const orders = {};
  const enemies = s.enemies.filter(e => !e.routing);
  // Attack once they come close - or after a short wait, so nobody stares at each other forever.
  const go = s.time > 12 || enemies.some(e => e.x < 80);

  for (const q of s.squads) {
    if (q.general || q.routing) continue;
    if (q.type === 'archers') {
      // Walk up behind the infantry; once the fight is on, the default behaviour
      // walks them into range and shoots the nearest enemy.
      if (s.time < 1) orders[q.id] = { move: { x: -240, y: q.y } };
      else if (go && q.order !== 'auto') orders[q.id] = { auto: true };
      continue;
    }
    // Infantry: form a line, then attack the nearest enemy.
    const near = util.nearest(enemies, q);
    if (go && near) {
      if (q.orderTarget !== near.id) orders[q.id] = { attack: near.id };
    } else if (s.time < 1) {
      orders[q.id] = { move: { x: -140, y: q.y } };
    }
  }

  // The general stays behind the line by default; rally squads that waver near it.
  const g = util.byId(s, 99);
  const shaky = s.squads.filter(q => !q.general && (q.routing || q.morale < 30) && util.dist(q, g) < 300);
  if (shaky.length >= 1 && util.power(s, 'rally').ready) orders[99] = { ability: 'rally' };

  return { orders, say: s.time < 0.6 ? 'For glory!' : undefined };
}
