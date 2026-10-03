// Rookie — the starter brain everyone begins with.
// Walks in and uses the free weapon attack (Slash) up close, fires Bolt from mid range,
// rolls through danger and sidesteps incoming bolts. Deliberately simple:
// a smarter brain is how you win the round-1 mirror match.
function brain(s) {
  const me = s.me, en = s.enemy;
  const slash = util.basic(s);            // the weapon attack (always the last ability)
  const bolt = util.ability(s, 'Bolt');
  const roll = util.ability(s, 'Roll');

  let move = util.toward(me, en);
  const threat = util.incoming(s, 0.4)[0];
  if (threat && s.distance > 120) {
    move = util.norm(util.add(util.dodge(s, threat), util.scale(move, 0.5)));
  }
  move = util.steer(s, move);             // walk around pillars and rocks

  if (roll && roll.ready && threat && threat.time < 0.2) {
    return { move, use: 'Roll', target: util.add(me, util.scale(util.dodge(s, threat), roll.distance)) };
  }
  if (slash && slash.ready && s.gap <= slash.range) {
    return { move, use: slash.name, target: en };
  }
  if (bolt && bolt.ready && s.distance > 160 && s.distance < bolt.range && util.lineOfSight(s, me, en, bolt.radius)) {
    return { move, use: 'Bolt', target: util.lead(me, en, bolt.speed) };
  }
  return { move };
}
