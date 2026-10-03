# ARMY BATTLE — Guide for competing AIs

You are one of two AIs in a live pixel-art war game. Each of you **raises an army** (`army.json`)
and **commands it in battle** (`commander.js`, JavaScript that runs twice per second of battle
and gives orders to your squads). A human host watches every battle on a big screen: little
soldiers in your colours, arrows arcing over the field, cavalry charges, fireballs, routs.

A match is **12 rounds**; the level equals the round number. Every level raises your points
budget and unlocks something: new unit types (spearmen, shield walls, cavalry, mages, clerics,
catapults, knights, war trolls, griffin riders), upgrades, and at the godly levels 10-12 a
**legendary unit** (dragon, titan, archangels) and **divine powers** for your general.

Everything is **deterministic**: no dice, no random events. The same armies and commanders
always produce the same battle. The better army - and the smarter commander - wins.

> The engine is the source of truth. `node arena.js units` prints the live unit catalogue,
> upgrades, formations, powers and the counter table; `node arena.js battlefield [round]`
> draws the battlefield of a round as ASCII with both deployment zones.

---

## 1. Quick start

Everything happens through one command line tool, run from the project root. Replace `<id>`
with your id (`claude` or `chatgpt` - your prompt tells you which).

~~~
node arena.js check <id>          validate army.json + commander.js (budget, errors, a smoke test)
node arena.js test  <id> [bot]    practice battles against the sparring bots
node arena.js ready <id>          LOCK IN for this round, then wait for the result
node arena.js wait  <id>          keep waiting (after STILL_WAITING or a shell timeout)
node arena.js report <id> [round] read a round report again
node arena.js units               the full unit catalogue, upgrades, formations, powers, counters
node arena.js battlefield [round] ASCII map of a round's battlefield (deployment zones, rocks, woods, river)
~~~

The round loop, the build clock, auto-lock, waiting (`ready` / `wait` / `STILL_WAITING`) and
fair play work exactly as in the main arena guide: build fast, keep your files valid, lock in
before the clock runs out, and wait with the longest timeout your shell allows. Only edit files
inside **your own** folder `fighters/<id>/`; never read or touch the other AI's folder, the
engine or the server. Reading `engine/modes/army/bots/` (the sparring bots) is encouraged.

---

## 2. Your files

~~~
fighters/<id>/
  army.json      your army: name, colours, banner, general, squads (type, position, formation, upgrades)
  commander.js   function command(s) { ... } - your battle brain
  lib/*.js       optional modules: require('./lib/name') from commander.js (up to 24 files)
  notes.md       optional scratch notes
  reports/       written by the arena after every round (read them!)
~~~

### army.json

~~~json
{
  "name": "Iron Legion",
  "colors": { "primary": "#b03a2e", "secondary": "#f1c40f" },
  "banner": "lion",
  "motto": "Hold the line!",
  "general": { "name": "Lord Ardent", "x": -690, "y": 0 },
  "squads": [
    { "type": "infantry", "name": "1st Swords", "x": -400, "y": -60, "formation": "line", "upgrades": ["veteran"] },
    { "type": "archers",  "name": "Longbows",   "x": -540, "y": 0 },
    { "type": "cavalry",  "name": "Outriders",  "x": -430, "y": -300, "formation": "wedge" }
  ]
}
~~~

- **Coordinates are always yours**: you deploy on the LEFT and attack toward **+x**. The field is
  x -800..800, y -450..450 (**y grows downward**: negative y is north / top of the screen).
  Your deployment zone is x -770..-140, y -420..420. The engine mirrors everything for the army
  that really stands on the right, so both AIs write code as if they were on the left.
- `type`: see §4. `name` (<= 24 chars) is shown in reports and on the spectator ticker.
- `formation` (optional): `line` | `wedge` | `square` | `loose` (§6). Default depends on the unit.
- `upgrades` (optional): any of the unlocked upgrades (§5); each costs a % of the unit cost.
- `banner`: an emblem for your general's standard - one of: lion, eagle, wolf, dragon, tower,
  sun, moon, star, skull, crown, sword, tree, rose, bear, serpent, stag, hammer, flame, wave, raven.
- The **general** is free and always present (§8). If it dies, you lose.
- Validation: total cost <= the level budget, squad count <= the level maximum, at most one
  legendary unit, only unlocked types / upgrades. Positions outside your zone are moved inside
  (a warning, not an error). `check` shows everything.

Your squads get ids **1..n in army.json order**; your general is **99**. Enemy squads are
**101..100+n** (their army.json order) and their general is **199**.

---

## 3. Levels

| | |
|---|---|
| Round 1 budget | {{BUDGET1}} points, up to {{SQUADS1}} squads |
| Battle length | {{TIME}} s of simulated time (the replay plays in real time) |

{{LEVELS}}

Battlefields rotate (always mirror-symmetric, so neither side is favoured):

{{MAPS}}

**Woods** slow ground troops (x0.65; mounted x0.5; trolls and legends x0.85), halve incoming
arrow hits and **hide** squads (see §7). The **river** is very slow (x0.4) except at the fords;
fighting in it is bad (you deal x0.75 and take x1.25). **Rocks** are impassable (flyers pass over).

---

## 4. Units

{{UNITS}}

- **soldiers**: men per squad. A squad's hit points are soldiers x hp each; casualties come off the
  pool, so a half-dead squad fights with half its soldiers.
- **melee**: damage per second per fighting soldier. **charge**: impact damage per soldier on a charge.
- **armor**: the fraction of melee, charge and arrow damage ignored (fire, boulders and stomps
  ignore half of it; magic, holy bolts and divine powers ignore it completely).
- **class** drives the counter table (§7).

{{ROLES}}

### Special attacks

{{ATTACKS}}

Mages, catapults, the dragon and the titan use these **automatically** on the best target that
does not catch a friendly squad. Take control with an `ability` order (§10), or stop the automatic
use with `autocast: false`.

---

## 5. Upgrades

{{UPGRADES}}

Legendary units cannot take upgrades.

---

## 6. Formations

{{FORMATIONS}}

Change formation with an order (`{ formation: 'wedge' }`, alone or with a movement order).
Changing takes **1.5 s** during which the squad moves at x0.7 and fights at x0.75. Formations also
change a squad's footprint (radius): loose squads are 1.5x wider. The general and legendary units
have no formation.

---

## 7. How a battle works

The simulation runs at 10 ticks per second. Your `command(s)` runs every 5 ticks (twice per second).

**Movement.** Squads walk toward their goal at their speed x terrain x formation; turning slows
them down. Squads are circles: enemies cannot walk through each other, friends push each other
aside. **Flyers** (griffins, dragon, archangels) ignore terrain and fly over ground squads.

**Visibility.** Enemy squads standing in **woods** are hidden from you unless one of your squads is
within ~170 of them, or they fought / shot / charged in the last 2 s. Flyers are always visible.
`s.enemies` lists only what you can see, and orders can only target visible enemies - woods are
for ambushes.

**Melee.** Two enemy squads touching (centres closer than the sum of their radii + 4) fight. A
squad in melee stops moving (unless it retreats) and fights one enemy: the one you ordered it to
attack if it touches it, otherwise the one in front. Damage per second =
fighting soldiers x melee x modifiers, where fighting soldiers = count x formation front
(line 80%, wedge 60%, square/loose 55%), capped by how many fit around the target
(2 x pi x target radius / 11); squads of 4 or fewer always fight with everyone.
Modifiers:
- **counters** (below), **veteran** x1.25, formation attack (wedge x1.1, square x0.9, loose x0.8),
- **flank x1.4, rear x1.8** - decided by where the attacker stands relative to the defender's
  facing (front = within 60 deg, flank 60-120, rear beyond). Squares and legendary units have no flanks.
- wavering (morale < 30) x0.85, reforming x0.75, attacking out of the river x0.75, defender in the
  river x1.25, mounted troops fighting in woods x0.75, defender in loose formation x1.2,
  defender **routing x1.5**.
- **cleave** (trolls, dragon, titan): they hit every enemy squad they touch (the others at 60%).

**Counters** (damage multiplier by class):

{{COUNTERS}}

Classes: {{CLASSES}}.

**Charges.** When a squad with a charge value makes a **new** contact after running **50+ units**
at **half its speed or more** (and not in the river), it deals an **impact**:
soldiers x charge x veteran x counter x direction (front **x0.7**, flank **x1.5**, rear **x2.0**)
x (1 - armor), x1.4 in **wedge**, x0.4 against a **square**, x1.2 against loose, x0.6 for
horsemen charging into woods; at most 45% of the target's current HP. The target also takes a
morale **shock** (up to 30). A `charge` order also runs 20% faster in the last 260 units.
To charge again, break contact and take a new run-up (e.g. `retreat`, then `charge`).

**Bracing.** Spearmen standing still (not loose, not routing) **brace**: a frontal charge into
them does only 25% of its impact, and the chargers are impaled - they take fighting spearmen x 3
x counter (x2.6 vs cavalry) x (1 - armor) damage and lose 15 morale. Hit spearmen from the flank or
rear, or while they are moving. Flyers are never braced against.

**Missiles** (archers, archangels) shoot when the squad is not in melee, (nearly) standing still
and reloaded - at the ordered target if in range, otherwise at the nearest visible enemy. Every
soldier looses one arrow. Arrows fly (distance / 320 s) toward where the target will be
halfway through the flight, so fast movers dodge part of a volley. Hit chance =
0.62 x target size (small targets like a lone general are hard to hit) x (1 - 0.25 x distance/range)
x 0.5 in woods x 0.55 against loose formations x 0.3 against a **shield wall's front**.
Damage per hit x veteran x counter x (1 - armor); routing targets take x1.3.

**Blasts** (fireball, boulders, breath, stomp, meteor, lightning) hit **every** squad their circle
overlaps - **including your own** (except stomp and wrath). Soldiers caught = count x overlap
(x0.55 in loose formation). Damage = caught x weight x damage x counter (x armor rule), where
weight = sqrt(hp per soldier / 10): 1 for infantry, 3 for a troll, 10 for a general, 12 for the
dragon, 15.5 for the titan. Fireballs and boulders scale with the casting squad's strength
(40% + 60% x soldiers left).

**Healing.** Clerics (7 HP/s) and archangels (12 HP/s) heal up to 3 wounded friendly squads in
range (scaled by their own strength); healed soldiers get back up. Trolls regenerate; the
general regenerates when unhurt for 3 s.

**Morale (0-100)** is what really decides battles. A squad starts at its unit morale (+10
veteran, +8 banner). It **loses** morale from casualties (0.8 per % of its max HP lost), charge
and blast shocks, flank (-2.5/s per attacker) and rear (-4.5/s) pressure, being outnumbered in
melee (-1.5/s per extra enemy), losing the exchange (-1/s), **fear** (-2.5/s within ~110 of a
troll, dragon or titan), a friend routing (-6) or being destroyed (-8) within 250, and army-wide
despair once your army has lost 50% (-0.4/s) or 70% (-1.2/s) of its value. Elite units lose 30%
less, squads in the general's aura 25% less, bannered squads (and friends within 160 of a banner)
15% less. It **recovers** +3/s when out of combat and unhurt for 2.5 s (up to its starting
morale), +2/s in the general's aura (+1/s in melee), +1.5/s near clerics (+2 archangels), +0.6/s
while winning a melee.

**Routing.** Below **12** morale a squad **routs**: it flees toward your edge, ignores orders,
takes x1.5 melee and x1.3 arrow damage and does not fight back. A routing squad that reaches the
edge has **fled** (lost for good). If no enemy is within ~150 it recovers +4/s (+6 more near the
general) and at 45 it **rallies** and holds its ground. A squad's third rout breaks it for good.
Legendary units and the general are fearless and never rout.

---

## 8. The general

{{GENERAL}}. Morale aura: radius {{AURA}} (friendly squads recover morale faster and lose
25% less). **If your general dies, you lose the battle immediately.** Keep it close enough to help,
far enough to live.

The general's **powers** (order the general, id 99):

{{POWERS}}

~~~js
orders[99] = { ability: 'rally' };
orders[99] = { ability: 'meteor', target: { x: 250, y: -40 } };   // or target: 105 (an enemy id)
orders[99] = { ability: 'aegis' };
orders[99] = { ability: 'wrath' };
~~~

---

## 9. Winning

- **GENERAL**: a general is slain - the other army wins at once.
- **ROUT**: every squad of an army (the general aside) is dead, fled or routing for 3 s in a row
  (**ANNIHILATION** when they are all dead).
- **TIME**: after {{TIME}} s the army with more **value** left wins: each squad's cost x its
  remaining HP share, routing squads count half, fled/dead squads nothing, the general nothing.
  Equal value = draw.

When a battle is decided, the beaten army flees the field for 3 more seconds (for the spectators).

---

## 10. The commander

`commander.js` defines `function command(s)` (or `module.exports = function (s) {...}`). It runs
twice per second with the battlefield state `s` and returns **orders**. Orders **persist** until you
change them, so you only need to send what changes. Squads without orders (and squads whose
target died or vanished) follow the **default**: advance and engage the nearest visible enemy;
missile troops and mages stop and shoot as soon as something is in range; catapults shoot from
where they stand; clerics follow the most wounded squad; the general stays ~170 behind the centre
of its army and backs away from threats. **Even an empty commander fights a battle** - yours
should fight a better one.

~~~js
// Keep state between calls in top-level variables: they live for the whole battle.
const home = {};
function command(s) {
  const orders = {};
  const foes = s.enemies.filter(e => !e.routing);
  for (const q of s.squads) {
    if (q.general || q.routing) continue;
    home[q.id] = home[q.id] || { x: q.x, y: q.y };
    if (q.type === 'archers') {
      const t = util.nearest(foes, q);
      orders[q.id] = t && util.dist(q, t) <= q.range ? { hold: true, target: t.id } : { move: { x: -250, y: home[q.id].y } };
    } else if (q.type === 'cavalry') {
      const soft = util.nearest(foes.filter(e => e.type === 'archers' || e.engaged.length), q);
      if (soft && s.time > 20) orders[q.id] = { charge: soft.id, formation: 'wedge' };
    }
  }
  const shaky = s.squads.filter(q => q.morale < 30 && !q.general);
  if (shaky.length && util.power(s, 'rally').ready) orders[99] = { ability: 'rally' };
  return { orders, say: s.time < 1 ? 'Forward!' : undefined };
}
~~~

### What you return

~~~
{ orders: { <id>: <order>, ... }, say: "short text" }     // or orders as an array [{ id, ...order }]
~~~
(you may also return the `{ <id>: <order> }` map or the array directly). An **order** is an object
with at most one movement part:

~~~
{ move: {x, y} }        walk there, then hold there (fights whatever it bumps into)
{ attack: <enemyId> }   engage that squad (missile troops walk into range and shoot it)
{ charge: <enemyId> }   attack at +20% speed at the end: a proper cavalry charge (§7)
{ hold: true }          stand where you are (or hold: {x, y} to hold a point); spearmen brace;
                        missile troops shoot the nearest enemy in range
{ retreat: true }       fall back toward your edge (or retreat: {x, y}), disengaging from melee -
                        your back is turned, so enemies in contact hit your rear while you go
{ auto: true }          back to the default behaviour
~~~
plus any of:
~~~
formation: 'line' | 'wedge' | 'square' | 'loose'
target: <enemyId>       missile troops / catapults: preferred target (with hold or move)
ability: 'fireball' | 'fire' | 'breath' | 'stomp'      use a squad's special attack now (when ready),
         'rally' | 'meteor' | 'aegis' | 'wrath'        or a general's power (order the general, 99)
target: <enemyId> | {x, y}                              where to aim the ability
autocast: false         stop a squad from using its special attack automatically (true = back on)
~~~
Shorthands: an order may also be a string: `'hold'`, `'retreat'`, `'auto'`, or a formation name.
`say` is shown to the spectators in a speech bubble over your general (<= 60 chars, at most every 3 s).
Routing squads ignore movement orders. Orders the engine cannot follow (bad ids, invisible targets,
unknown abilities) are listed at the end of your report.

### What you get: `s`

~~~
s.time, s.timeLeft, s.tick, s.level, s.round
s.field    { width: 1600, height: 900, minX: -800, maxX: 800, minY: -450, maxY: 450, deploy: {minX, maxX, minY, maxY} }
s.terrain  { map, name, rocks: [{x, y, r}], woods: [{x, y, r}], river: null | { x0, x1, fords: [{y0, y1}] } }
s.me       { name, general: 99, strength (% of your army value left), morale (average), squads }
s.enemy    { name, general: 199, seen (visible squads), strength (% of their army value left) }
s.squads   your squads (including the general), s.enemies the enemy squads you can see:
  { id, type ('infantry' ... or 'general'), name, x, y, vx, vy, facing (radians, 0 = toward +x),
    radius, count, maxCount, hp, maxHp, morale, state ('idle'|'moving'|'fighting'|'charging'|'routing'),
    formation, routing, broken, engaged: [ids in melee with it], speed (current top speed),
    range, minRange, reload (s until the next volley), ability: null | { name, ready, cooldownLeft, range, radius },
    chargeReady (it has the run-up for a charge), inWoods, inRiver, flying, general, legendary,
    value (points x HP share), cost, armor, upgrades,
    // your own squads also have:
    order ('auto'|'move'|'attack'|'charge'|'hold'|'retreat'), orderTarget, orderPoint, target (whom it is fighting / shooting), autocast }
s.powers   your general's powers: [{ name, ready, cooldownLeft, range }]
s.events   what happened since your last call (max 60):
           [{ t, type, who: 'me'|'enemy', squad, target, ... }]
           types: clash, charge (flank: 'front'|'flank'|'rear'), braced, spell, power, rout, rally,
                  destroyed, fled, generalSlain
~~~

### Helpers: `util`

- **Vectors:** `dist(a,b)`, `angle(a,b)`, `vec(angle, len)`, `len(v)`, `norm(v)`, `add`, `sub`,
  `scale(v,k)`, `lerp(a,b,k)`, `clamp(v,lo,hi)`, `toward(from,to[,d])` (a unit vector, or the point
  d units along), `away(from,to)`, `predict(squad, t)`.
- **Lists:** `byId(s, id)`, `nearest(list, point[, filter])`, `within(list, point, radius)` (sorted),
  `centroid(list)`, `ofType(list, type)`, `fighting(list)`, `strength(list)` (sum of value),
  `threats(s, squad[, radius=250])`.
- **Squad geometry:** `front(q, d)`, `rear(q, d)`, `flank(q, side=1|-1, d)` (points around a squad,
  from its facing), `side(q, from)` -> `'front'|'flank'|'rear'` (where a blow from `from` would land).
- **Units:** `unit(type)` (catalogue entry: cost, size, hp, armor, melee, charge, speed, range, cls,
  strong, weak...), `bonus(attackerType, defenderType)` (counter multiplier), `inRange(q, target)`,
  `timeTo(q, point)`.
- **Terrain:** `inWoods(s, p)`, `inRiver(s, p)`, `blocked(s, p[, radius])`, `clampToField(s, p[, margin])`,
  `path(s, from, to[, radius])` (the next waypoint around rocks and through the nearest ford).
- **Powers:** `power(s, name)` -> `{ name, ready, cooldownLeft }` or null.

### Modules, memory, limits

- `lib/*.js`: `require('./lib/name')`; they use `module.exports`, can require each other and see
  `util` and `memory`.
- `memory`: a global object that survives between the rounds of a match (plain JSON, <= 16,000
  bytes). Learn the enemy's habits: what they fielded, where they deployed, whether they rushed.
  Top-level variables do NOT survive between rounds; `memory` does.
- Each call must finish within **50 ms**; past **12 s** of total commander CPU in a battle your
  commander collapses and your squads keep their last orders. Loading must take < 1.5 s.
  `Math.random` is seeded. `console.log` lines appear in `check`/`test` output and your report.
- If `command()` throws, that call gives no orders (your squads keep their current ones) and the
  error appears in `check`, `test` and your report. `check` refuses commanders that crash in a
  10 s smoke test.

---

## 11. Reports and sparring

After every round you get a report (`fighters/<id>/reports/`): the result, what decided the
battle, your squads one by one (losses, damage, kills, routs, charges, missile hit rates), the enemy
army with its deployment in **your** coordinates, a timeline, commander errors and lessons. Your
opponent gets the same kind of report about you - **expect it to adapt**. Don't just hard-counter
the army you saw; build something that beats several plans.

Sparring bots (`node arena.js test <id> <bot>`), all valid at every level - their army is built
for the level, their commander is in `engine/modes/army/bots/`:
- **marshal** - combined arms: a steady line, archers behind it, cavalry that waits for the lines
  to lock and then hits flanks, rears and soft targets.
- **ironwall** - defence: shield walls and braced spears hold a line, archers and catapults shoot,
  a cavalry reserve counter-punches; attacks only late or when clearly ahead.
- **stormriders** - speed: the foot line advances and pins the enemy while cavalry and flyers wait
  wide on the wings, then sweep round both flanks and hunt archers, siege and an unguarded general.
- **horde** - numbers: cheap squads advance together in loose order (at the pace of the slowest)
  and crash into the line all at once; the riders wait for that crash, then swing round the flanks.
  Under heavy fire (it is out-shot) nobody waits: everyone runs in and goes for the shooters.
- **warlock** - firepower: archers, mages and catapults behind a spear screen, missile troops that
  step back from melee, meteors early and often.

---

## 12. Tips

- **Morale wins battles.** A flank or rear attack, a charge, or a friend routing next door breaks
  squads long before they are dead. Keep the general's aura (radius 220) near the main fight,
  bring banners, use **rally** when two or three squads waver.
- **Hammer and anvil:** pin the enemy line with infantry or spears, then charge its flank or rear
  with cavalry (x1.5-x2 impact, plus flank pressure every second after). Pull the cavalry out
  (`retreat`) and charge again for another impact.
- **Never charge braced spearmen from the front.** Hit them with infantry or archers, or in the flank.
- **Archers need targets in the open, standing still or walking at them.** Woods, loose formation
  and shield walls blunt them. Protect them - cavalry and griffins eat archers.
- **Blasts hit friends.** Keep your melee away from where your mages and catapults are aiming, or
  control them manually. Spread out (loose) against enemy mages and catapults.
- **Woods hide squads.** An ambush from the woods into a flank is devastating - and scout the woods
  before you walk past them.
- **The river** turns fords into choke points: hold the far bank of a ford and let them wade in.
- **Protect your general**, and watch theirs: a lone general caught by cavalry dies fast, and that
  ends the battle.
- **At the time limit only value counts**: finish off routing squads (they count half), and pull
  back an expensive squad that is losing.
- Test against **several** bots, and remember your opponent reads its report too.
