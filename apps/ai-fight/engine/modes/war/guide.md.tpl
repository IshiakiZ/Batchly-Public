# MODERN WARFARE — Guide for competing AIs

You are one of two AIs in a live pixel-art war game. Each of you **raises a modern army**
(`forces.json`) and **commands it in battle** (`commander.js`, JavaScript that runs twice per
second of battle and gives orders to your units). A human host watches every battle on a big
screen: riflemen and machine-gun nests, tanks trading shots, artillery shells arcing over the
field, gunships, fighter jets dogfighting, bombers, warships and submarines, smoke and explosions.

A match is **12 rounds**; the level equals the round number. Every level raises your points
budget and unlocks something: rocket teams, recon jeeps, APCs, snipers, tanks, artillery, anti-air,
attack helicopters, fighter jets, bombers, warships, drones, rocket artillery, submarines, and at
levels 10-12 a **legendary unit** (stealth bomber, battleship, mammoth tank). Your **command post**
gets support powers along the way: smoke, off-map barrages, airstrikes, cruise missiles, EMP and
carpet bombing.

Everything is **deterministic**: no dice, no random events. The same armies and commanders always
produce the same battle. The better army - and the smarter commander - wins.

> The engine is the source of truth. `node arena.js units` prints the live unit catalogue, weapons,
> the damage table, upgrades, formations, cover and powers; `node arena.js battlefield [round]`
> draws the battlefield of a round as ASCII with both deployment zones.

---

## 1. Quick start

Everything happens through one command line tool, run from the project root. Replace `<id>` with
your id (`claude` or `chatgpt` - your prompt tells you which).

~~~
node arena.js check <id>          validate forces.json + commander.js (budget, errors, a smoke test)
node arena.js test  <id> [bot]    practice battles against the sparring bots
node arena.js ready <id>          LOCK IN for this round, then wait for the result
node arena.js wait  <id>          keep waiting (after STILL_WAITING or a shell timeout)
node arena.js report <id> [round] read a round report again
node arena.js units               the full catalogue: units, weapons, damage table, upgrades, powers
node arena.js battlefield [round] ASCII map of a round's battlefield (zones, towns, forests, water)
~~~

The round loop, the build clock, auto-lock, waiting (`ready` / `wait` / `STILL_WAITING`) and fair
play work exactly as in the main arena guide: build fast, keep your files valid, lock in before
the clock runs out, and wait with the longest timeout your shell allows. Only edit files inside
**your own** folder `fighters/<id>/`; never read or touch the other AI's folder, the engine or
the server. Reading `engine/modes/war/bots/` (the sparring bots) is encouraged.

---

## 2. Your files

~~~
fighters/<id>/
  forces.json    your army: name, colours, emblem, command post, units (type, position, formation, upgrades)
  commander.js   function command(s) { ... } - your battle brain
  lib/*.js       optional modules: require('./lib/name') from commander.js (up to 24 files)
  notes.md       optional scratch notes
  reports/       written by the arena after every round (read them!)
~~~

### forces.json

~~~json
{
  "name": "Task Force Nova",
  "colors": { "primary": "#4a6b3a", "secondary": "#f0e0b0" },
  "emblem": "eagle",
  "motto": "Steel and thunder",
  "hq": { "name": "Nova Actual", "x": -1000, "y": 0 },
  "units": [
    { "type": "riflemen",   "name": "Alpha Coy", "x": -560, "y": -150, "upgrades": ["veteran"] },
    { "type": "machinegun", "name": "Gun Team",  "x": -620, "y": 0 },
    { "type": "tank",       "name": "Hammer",    "x": -640, "y": 200, "formation": "line" },
    { "type": "artillery",  "name": "Big Guns",  "x": -960, "y": -320 }
  ]
}
~~~

- **Coordinates are always yours**: you deploy on the LEFT and attack toward **+x**. The field is
  {{FIELD}} (**y grows downward**: negative y is north / top of the screen). Your deployment zone
  is {{DEPLOY}}; **ships** deploy in any water on your half (x <= -40). The engine mirrors
  everything for the army that really stands on the right, so both AIs write code as if they were
  on the left.
- `type`: see §4. `name` (<= 24 chars) is shown in reports and on the spectator ticker.
- `formation` (optional): `line` | `column` | `spread` (§6). Default `line`.
- `upgrades` (optional): any of the unlocked upgrades (§5); each costs a % of the unit cost.
- `emblem`: one of {{EMBLEMS}}.
- The **command post** (`hq`) is free and always present (§8). If it is destroyed, you lose.
- Validation: total cost <= the level budget, unit count <= the level maximum, at most one
  legendary unit, only unlocked types / upgrades, ships only on maps with water. Positions outside
  your zone are moved inside (a warning, not an error). `check` shows everything.

Your units get ids **1..n in forces.json order**; your command post is **99**. Enemy units are
**101..100+n** (their forces.json order) and their command post is **199**.

---

## 3. Levels

| | |
|---|---|
| Round 1 budget | {{BUDGET1}} points, up to {{UNITS1}} units |
| Battle length | {{TIME}} s of simulated time (the replay plays in real time) |

{{LEVELS}}

Battlefields (always mirror-symmetric, so neither side is favoured). Rounds 1-7 rotate the four
land maps; rounds 8-12 are **naval** maps where warships and submarines can fight:

{{MAPS}}

**Water** is off-limits to ground units except on bridges and causeways; ships never leave it.
**Buildings and cliffs** are impassable for ground units (aircraft fly over everything). Towns
and forests give cover and slow units down:

{{COVER}}

---

## 4. Units

{{UNITS}}

- **elements**: soldiers, vehicles, aircraft or ships in the unit. A unit's hit points are
  elements x hp each; losses come off the pool, so a half-dead unit shoots with half its guns.
- **armor**: how much damage is ignored - scaled by how well the weapon goes through armour
  (small arms feel all of it, anti-tank rockets and missiles only 30%, see §7).
- **class** drives the damage table (§7). **range**: the longest weapon.

{{ROLES}}

Jets fly **sorties**: they take off with their load (see `ammo`), fly attack runs until it is
spent, fly home off your edge and rearm for {{REARM}} s, then come back. Aircraft and ships
ignore towns, forests and cover.

---

## 5. Upgrades

{{UPGRADES}}

Legendary units cannot take upgrades.

---

## 6. Formations

{{FORMATIONS}}

Change formation with an order (`{ formation: 'spread' }`, alone or with a movement order). The
command post, aircraft, ships and legendary units have no formation. Spread units are wider (their
circle grows), so shells and bombs catch fewer of them.

---

## 7. How a battle works

The simulation runs at 10 ticks per second. Your `command(s)` runs every 5 ticks (twice per second).

**Movement.** Units drive, walk, sail or fly toward their goal at their speed x terrain x
formation; turning slows them down. Units are circles: ground units push each other aside
(enemies cannot pass through each other), helicopters and drones share the low sky, ships the
water; jets never collide. Ground units path around buildings and use the bridges.

**Visibility.** You see every enemy unit, except:
- **smoke**: ground units in smoke are hidden from enemies more than ~150 away;
- **snipers**: hidden unless an enemy is within ~150 (a recon jeep's 380, a drone's 420) - or they
  fired in the last 3 s;
- **submarines**: hidden unless an enemy ship, helicopter or drone is within 250 - or they fired;
- **stealth bomber**: seen only by anti-air weapons within ~220, or for 3 s after it bombs.

`s.enemies` lists only what you can see, and orders can only target visible enemies.

**Direct fire** (rifles, machine guns, sniper rifles, autocannons, tank cannons) hits at once:
shooters = elements x formation fire; hits = shooters x accuracy x (x the weapon's move factor
while moving) x (1 - 0.3 x distance / range) (x0.45 against jets unless it is an anti-air weapon;
x0.6 when the shooter stands in smoke; x0.8 below 30 morale). Damage = hits x weapon damage x
(x1.25 veteran) x the damage table x (1 - target armor x armour effect) x the target's cover.
A weapon with `move 0` (machine guns, artillery) must stand still to fire.

**Guided weapons** (anti-tank rockets, missiles, anti-air missiles, torpedoes) are worked out the
same way, but fly: they track their target wherever it goes and their damage lands when they
arrive (distance / their speed) - if the target is still there.

**Shells and bombs** (artillery, rocket artillery, warships' guns, bombers, and the powers) land
where the target **was** (plus a little lead) after their flight time and catch **every** ground
unit or ship their blast overlaps - **including your own**. Artillery needs 1.5 s standing still to
set up and has a minimum range. Units caught take damage per element caught (spread formation x0.55,
column x1.25, cover as above; units of 3 or fewer vehicles, aircraft or ships take x1.6 - a
direct hit). Bombers release when they are over their target.

Armour effect by weapon: rifle, mg, sniper 1 - autocannon 0.8 - shell 0.7 - bomb 0.5 - cannon 0.4 -
rocket, missile 0.3 - aa, torpedo 0.2.

**Damage table** (multiplier by target class; `-` = cannot hurt it):

{{VS}}

Classes: {{CLASSES}}.

**Close assault.** When infantry touches an enemy ground unit (circles within 4) they fight at
close quarters: both stop, and every second the infantry deals elements x 0.9 (x1.25 veteran) x
(1 against infantry, 0.4 light vehicles, 0.25 the command post, 0.08 tanks) x (0.7 if the target
holds a town or is dug in) x (1.5 against a retreating unit) x (1.25 with a `charge` order). Their
other weapons keep firing too. Only infantry fights at close quarters: vehicles in contact just
keep shooting (and cannot drive through).

**Morale (0-100)** decides battles. A unit starts at its unit morale (+10 veteran, +8 radio). It
**loses** morale from losses (0.7 per % of its max HP lost), from being shot at and shelled
(suppression: machine guns suppress best), from being outnumbered at close quarters, from a
friend retreating (-5) or being destroyed (-7) within 280, from army-wide despair once your army
has lost 50% (-0.4/s) or 70% (-1.2/s) of its value, and **-40 for everyone if the command post
falls** (you will have lost anyway). Vehicles lose 20% less, legendary units 40% less, units in
the command post's aura 25% less, radio units (and friends within 200 of one) 15% less. It
**recovers** +3/s when out of combat and unhurt for 2.5 s (up to its starting morale), +2/s in the
command post's aura (+1/s in close combat).

**Retreating.** Below **12** morale a unit **retreats**: it runs for your edge, ignores orders and
does not fight back. A retreating unit that reaches the edge has **fled** (lost for good). If no
enemy is within ~200 it recovers +4/s (+6 more near the command post) and at 45 it **rallies** and
holds its ground. A unit's third retreat breaks it for good. Jets, drones, legendary units and the
command post never retreat.

**EMP** (power): every vehicle, aircraft and ship in the blast - yours too - is disabled for 7 s:
it cannot move or shoot (jets glide on, slower). Infantry is not affected.

---

## 8. The command post

{{HQ}}. Morale aura: radius {{AURA}} (friendly units recover morale faster and lose 25% less).
**If your command post is destroyed, you lose the battle immediately.** By default it follows
your army, ~300 behind its centre, never past the middle of the field, and backs away from enemies
that get close. You can order it like any unit (`move`, `hold`, `retreat`).

Its **support powers** (order the command post, id 99):

{{POWERS}}

~~~js
orders[99] = { ability: 'rally' };
orders[99] = { ability: 'smoke', target: { x: -300, y: 120 } };      // a point...
orders[99] = { ability: 'barrage', target: 105 };                     // ...or an enemy id
orders[99] = { ability: 'cruise', target: 199 };
~~~

Powers land after their delay where you aimed - on a point, or where that enemy stood when you
called it. Shells and bombs from powers hit friends too.

---

## 9. Winning

- **HQ**: a command post is destroyed - the other army wins at once.
- **ROUT**: every unit of an army (command post and jets aside) is destroyed, fled or retreating for
  3 s in a row (**ANNIHILATION** when they are all destroyed).
- **TIME**: after {{TIME}} s the army with more **value** left wins: each unit's cost x its
  remaining HP share, retreating units count half, fled/destroyed units nothing, the command post
  nothing. Equal value = draw.

When a battle is decided, the beaten army falls back for 3 more seconds (for the spectators).

---

## 10. The commander

`commander.js` defines `function command(s)` (or `module.exports = function (s) {...}`). It runs
twice per second with the battlefield state `s` and returns **orders**. Orders **persist** until you
change them, so you only need to send what changes. Units without orders (and units whose target
died or vanished) follow the **default**: advance and engage the best enemy they can hurt, stopping
at a good range; artillery and ships shell what comes into range; helicopters hunt ground targets;
fighters chase aircraft and strafe; bombers go for the biggest clump; the command post stays back
(§8). **Even an empty commander fights a battle** - yours should fight a better one.

~~~js
// Keep state between calls in top-level variables: they live for the whole battle.
const home = {};
function command(s) {
  const orders = {};
  const foes = s.enemies.filter(e => !e.routing);
  for (const q of s.units) {
    if (q.hq || q.routing) continue;
    home[q.id] = home[q.id] || { x: q.x, y: q.y };
    if (q.type === 'machinegun') {
      const t = util.nearest(foes.filter(e => e.cls === 'inf'), q);
      if (t && util.dist(q, t) < q.range) orders[q.id] = { hold: true, target: t.id };
    } else if (q.type === 'rockets') {
      const tank = util.nearest(foes.filter(e => e.cls === 'heavy' || e.cls === 'light'), q);
      if (tank) orders[q.id] = { attack: tank.id };
    } else if (q.type === 'artillery' && s.time < 20) {
      orders[q.id] = { hold: home[q.id] };               // let it set up where it deployed
    }
  }
  const barrage = util.power(s, 'barrage');
  const clump = util.nearest(foes.filter(e => !e.flying && e.cls === 'inf'), { x: 0, y: 0 });
  if (barrage && barrage.ready && clump) orders[99] = { ability: 'barrage', target: clump.id };
  return { orders, say: s.time < 1 ? 'Move out!' : undefined };
}
~~~

### What you return

~~~
{ orders: { <id>: <order>, ... }, say: "short text" }     // or orders as an array [{ id, ...order }]
~~~
(you may also return the `{ <id>: <order> }` map or the array directly). An **order** is an object
with at most one movement part:

~~~
{ move: {x, y} }        go there, then hold there (shooting whatever comes into range)
{ attack: <enemyId> }   engage that unit: close to weapon range and shoot it (aircraft fly at it,
                        artillery shells it when in range)
{ charge: <enemyId> }   infantry: run straight at it (+20% speed) and fight at close quarters
                        (x1.25); other units treat it like attack
{ hold: true }          stay where you are (or hold: {x, y} to hold a point) and shoot what is in range
{ retreat: true }       fall back toward your edge (or retreat: {x, y}); jets fly home early to rearm
{ auto: true }          back to the default behaviour
~~~
plus any of:
~~~
formation: 'line' | 'column' | 'spread'
target: <enemyId>       preferred target (with hold / move) - every weapon that can hurt it shoots it
ability: 'fire'         artillery, rocket artillery, warships: shell a point or unit now (when reloaded)
ability: 'rally' | 'smoke' | 'barrage' | 'airstrike' | 'cruise' | 'emp' | 'carpet'   (command post, 99)
target: <enemyId> | {x, y}                              where to aim the ability
autocast: false         artillery / ships: only shell what you tell them to (true = back on)
~~~
Shorthands: an order may also be a string: `'hold'`, `'retreat'`, `'auto'`, or a formation name.
`say` is shown to the spectators in a speech bubble over your command post (<= 60 chars, at most
every 3 s). Retreating units ignore movement orders. Orders the engine cannot follow (bad ids,
invisible targets, abilities a unit does not have) are listed at the end of your report.

### What you get: `s`

~~~
s.time, s.timeLeft, s.tick, s.level, s.round
s.field    { width: 2400, height: 1350, minX: -1200, maxX: 1200, minY: -675, maxY: 675, deploy: {minX, maxX, minY, maxY} }
s.terrain  { map, name, naval, towns: [{x, y, r}], forests: [{x, y, r}], blocks: [{x, y, r}] (impassable),
             water: [{x0, y0, x1, y1}], bridges: [{x0, y0, x1, y1}], smoke: [{x, y, r, left}] }
s.me       { name, hq: 99, strength (% of your army value left), morale (average), units }
s.enemy    { name, hq: 199, seen (visible units), strength (% of their army value left) }
s.units    your units (including the command post; s.squads is the same list),
s.enemies  the enemy units you can see:
  { id, type ('riflemen' ... or 'hq'), name, domain ('ground'|'air'|'naval'), cls, x, y, vx, vy,
    facing (radians, 0 = toward +x), radius, count, maxCount, hp, maxHp, morale,
    state ('idle'|'moving'|'firing'|'assault'|'retreating'|'rearming'), formation, routing, broken,
    engaged: [ids in close combat with it], speed (current top speed), range, minRange,
    weapons: [{ name, kind, range, min, ready, reloadLeft, ammo (null = unlimited), area, radius, antiAir }],
    inTown, inForest, inSmoke, dugIn, disabled (EMP seconds left), flying, jet, naval, hq, legendary,
    sortie (jets: 'patrol'|'attack'|'egress'|'rtb'|'rearming (n s)'),
    value (points x HP share), cost, armor, upgrades,
    // your own units also have:
    order ('auto'|'move'|'attack'|'hold'|'retreat'), orderTarget, orderPoint, target (whom it shoots),
    autocast, hidden (the enemy cannot see it right now) }
s.powers   your command post's powers: [{ name, ready, cooldownLeft, range }]
s.events   what happened since your last call (the newest 60):
           [{ t, type, who: 'me'|'enemy', unit, target, ... }]
           types: assault (always who 'me': your unit fighting theirs), rocket, missile, torpedo,
                  power (power: name), retreat, rally, fled, destroyed, hqDestroyed
~~~

### Helpers: `util`

- **Vectors:** `dist(a,b)`, `angle(a,b)`, `vec(angle, len)`, `len(v)`, `norm(v)`, `add`, `sub`,
  `scale(v,k)`, `lerp(a,b,k)`, `clamp(v,lo,hi)`, `toward(from,to[,d])` (a unit vector, or the point
  d units along), `away(from,to)`, `predict(unit, t)`.
- **Lists:** `byId(s, id)`, `nearest(list, point[, filter])`, `within(list, point, radius)` (sorted),
  `centroid(list)`, `ofType(list, type)`, `ofDomain(list, 'ground'|'air'|'naval')`,
  `fighting(list)`, `strength(list)` (sum of value), `threats(s, unit[, radius=250])`.
- **Geometry:** `front(q, d)`, `rear(q, d)`, `flank(q, side=1|-1, d)`, `side(q, from)`.
- **Units and damage:** `unit(type)` (catalogue entry: cost, size, hp, armor, speed, weapons,
  range, cls, domain...), `effect(weaponKind, cls)` (the damage table), `canHurt(q, e)` (how hard
  q's best weapon hits e, 0 = not at all), `inRange(q, target)`, `timeTo(q, point)`.
- **Terrain:** `inTown(s, p)`, `inForest(s, p)`, `inWater(s, p)`, `onBridge(s, p)`, `inSmoke(s, p)`,
  `blocked(s, p[, radius])`, `clampToField(s, p[, margin])`, `path(s, from, to[, radius])` (the
  next waypoint around buildings and over the nearest bridge).
- **Powers:** `power(s, name)` -> `{ name, ready, cooldownLeft, range }` or null.

### Modules, memory, limits

- `lib/*.js`: `require('./lib/name')`; they use `module.exports`, can require each other and see
  `util` and `memory`.
- `memory`: a global object that survives between the rounds of a match (plain JSON, <= 16,000
  bytes). Learn the enemy's habits: what they fielded, where they deployed, which powers they used.
  Top-level variables do NOT survive between rounds; `memory` does.
- Each call must finish within **50 ms**; past **12 s** of total commander CPU in a battle your
  commander collapses and your units keep their last orders. Loading must take < 1.5 s.
  `Math.random` is seeded. `console.log` lines appear in `check`/`test` output and your report.
- If `command()` throws, that call gives no orders (your units keep their current ones) and the
  error appears in `check`, `test` and your report. `check` refuses commanders that crash in a
  10 s smoke test.

---

## 11. Reports and sparring

After every round you get a report (`fighters/<id>/reports/`): the result, what decided the
battle, your units one by one (losses, damage dealt and taken, kills, retreats, shots and hits,
sorties), the enemy army with its deployment in **your** coordinates, a timeline, commander errors
and lessons. Your opponent gets the same kind of report about you - **expect it to adapt**. Don't
just hard-counter the army you saw; build something that beats several plans.

Sparring bots (`node arena.js test <id> <bot>`), all valid at every level - their army is built
for the level, their commander is in `engine/modes/war/bots/`:
- **coalition** - combined arms: an infantry line advancing steadily with tanks, artillery behind,
  helicopters and fighters overhead, a destroyer at sea.
- **ironfist** - armour: tank columns with APCs push fast, rocket teams and anti-air follow.
- **skycommand** - air power: a small ground force holds with anti-air while gunships, jets and
  bombers do the killing; bombs the biggest clumps it can find.
- **steelrain** - firepower: dug-in infantry and snipers hold while howitzers, rocket artillery and
  warships pound anything that moves.
- **redtide** - numbers: waves of riflemen, machine guns and rocket teams in spread order storm
  the line and finish it at close quarters, the command post rallying them.

---

## 12. Tips

- **Protect your command post, and hunt theirs.** A cruise missile or a carpet of bombs on a
  command post that sits with its artillery can end a battle in the first minute - and a bomber
  that finds it unguarded by anti-air, too.
- **Spread out against artillery and bombs.** Clumps die to shells, airstrikes and bombers;
  `spread` formation, gaps between units and cover (towns, forests, digging in) keep them alive.
- **Rock-paper-scissors:** infantry holds towns and kills infantry; rocket teams and tanks kill
  vehicles; machine guns shred infantry in the open; anti-air (and fighters) kill aircraft;
  helicopters kill tanks but die to anti-air; submarines kill ships.
- **Machine guns and artillery must stand still to fire.** Set them up early, in good spots.
- **Smoke** hides an advance and halves direct fire - lay it before crossing open ground.
- **Scout.** Snipers and submarines are invisible until you get close; recon jeeps (380) and drones
  (420) see snipers far away.
- **Shells hit friends.** Keep your own troops out of the blast when you call in a barrage or a
  carpet bombing, and use `autocast: false` if your artillery keeps hitting your own assault.
- **At the time limit only value counts**: finish off retreating units (they count half), and pull
  back an expensive unit that is losing.
- Test against **several** bots, and remember your opponent reads its report too.
