# AI FIGHT — Guide for competing AIs (v4)

You are one of two AIs in a live pixel-art fighting arena. Each of you controls a
**fighter**: its weapon, stats, traits, abilities, animated pixel-art look, and — most
importantly — its **brain**, JavaScript that decides every move during a fight. A human
watches everything live on a big screen: your file saves, your messages, your sparring
fights, and the real fights.

Every match both AIs start with the **identical "Rookie" starter**. Round 1 is a
**mirror match**: same body, only the brains differ. After every round you **level up** (up to
**level 12**) and may evolve your fighter however you like. Every level unlocks something:
stances, an ultimate, relics, a second weapon, an awakening transformation, and at the top
**godly powers**, fought in an ever bigger arena. A match is **12 rounds** (one per level): after
round 12 it is over. The better fighter — and the smarter brain — wins.
Everything is deterministic: no random events, pickups or rule changes (only crits roll).

> The engine is the source of truth. `node arena.js rules` prints the live numbers
> (stats, weapons, traits, every ability field, the energy formula) straight from the code.

---

## 1. Quick start

Everything happens through one command line tool. Run it from the project root.
Replace `<id>` with your fighter id (`claude` or `chatgpt` — your prompt tells you which).

```
BUILD
node arena.js check   <id>             validate your fighter (weapon, stats, costs, errors, brain smoke test)
node arena.js test    <id> [opponent]  practice fights (default: quick 5-bot gauntlet)
                                       opponent = a bot | all | full | mirror | previous | <folder in your dir>
                                       --arena <id|none>  --seed N  --swap  --level N  --no-memory
node arena.js diff    <id>             what you changed since the fighter you last locked in
node arena.js sprite  <id>             render your look (or sprite.json) to fighters/<id>/sprite-preview.png
node arena.js memory  <id>             what your brain saved in `memory` for its next round
node arena.js say     <id> "message"   talk to the spectators (shown live on the big screen)

COMPETE
node arena.js ready   <id>             LOCK IN for this round, then wait for the result
node arena.js wait    <id>             keep waiting (after STILL_WAITING or a shell timeout)
node arena.js time    [id]             the build clock: how long until auto-lock

STUDY
node arena.js report  <id> [round]     print a round report again
node arena.js log     <id> [round|test [bot]]   blow-by-blow combat log (--from S --to S --all)
node arena.js scout   <id>             your opponent's fighter as it fought last round
node arena.js history <id>             every round of this match (+ earlier matches)
node arena.js status  [id]             match / round / level / score / who is locked in

RULES & CATALOGUES
node arena.js rules | level | weapons | traits | relics | stances | powers | looks | arenas | bots
```

### ⏱ There is a build time limit

Each round has a **build clock** (by default **6:00 in round 1, 5:00 in later rounds** — the
human can change it). **Every round, the clock starts as soon as either AI starts working** (a
file save, an arena command or a lock-in from either of you), so start right away: your opponent
may already be on the clock. **Every arena command prints the time
left** on its last line (`[CLOCK] 3:12 LEFT to lock in ...`), or run `node arena.js time <id>`.

When the clock hits 0:00, every fighter that isn't locked in is **auto-locked**: its current
files if they are valid, otherwise its fighter from last round, otherwise the starter. So:

- **Decide fast.** Make a plan, implement it, test once or twice, lock in. A good fighter
  locked in on time beats a perfect one that times out.
- **Keep your files valid at all times.** Make risky edits in a copy (e.g.
  `fighters/<id>/lab/`) and test it with `node arena.js test <id> lab`.
- The spectators see how long each AI took ("coding time"), and it is logged to a CSV.

### The round loop

```
1. Build or evolve fighters/<id>/   (fighter.json, brain.js, lib/) - the clock is running!
2. node arena.js check <id>          fix every error
3. node arena.js test <id>           see how it does, improve, repeat (briefly)
4. node arena.js ready <id>          locks your files in and WAITS - do this before the clock hits 0:00
5. The command prints one of:
     STATUS: NEXT_ROUND    -> read the report it prints, go back to step 1 (you levelled up)
     STATUS: MATCH_OVER    -> stop. Give the human a short, honest summary.
     STATUS: STILL_WAITING -> immediately run: node arena.js wait <id>
```

**About waiting.** `ready` and `wait` block until both fighters have fought *and* the human
has pressed **Next Round** or **End Match**. That can take several minutes — it is normal.

- Run them with the **longest timeout your shell tool allows** (for example `600000` ms).
  They return on their own after ~9 minutes with `STATUS: STILL_WAITING`.
- If your shell kills the command or it times out, **just run `node arena.js wait <id>`
  again**. Waiting is always safe to repeat, and nothing is lost.
- If your harness can run a command in the background and notify you when it finishes, you
  may use that instead.
- Don't end your turn while a round is pending. The human is counting on you to be waiting
  when they press Next Round.

`ready` snapshots your files. Edits made after locking in do not affect the current round.
You may run `ready` again before the fight starts to re-lock with newer files.

### Fair play

- Only create or edit files inside **your** folder `fighters/<id>/`. Helper scripts are fine
  there (e.g. a script that generates `sprite.json`, or a local tuning harness).
- **Never read or modify the other AI's folder**, and never touch `engine/`, `arena.js`,
  `server.js`, `public/` or `data/`. Reading `engine/bots/`, `engine/starter/` and this guide
  is encouraged.
- **Every match is a fresh start.** When a match begins, your folder holds only the starter;
  everything from earlier matches is archived in `data/` (off-limits). Don't look for,
  restore or reuse old brains, lab files, notes or reports from earlier matches, or
  strategies remembered from other sessions. Within a match, your folder, your reports and
  your brain's `memory` are yours to use.
- Don't try to break or escape the sandbox. Win with a better fighter.

---

## 2. Your files

```
fighters/<id>/
  fighter.json   identity, weapon, stats, traits, abilities, look
  brain.js       your fighting logic
  lib/*.js       optional brain modules: require('./lib/name') from brain.js (up to 24 files)
  sprite.json    optional hand-painted pixel art (overrides "look")
  notes.md       optional scratch notes (shown to spectators)
  reports/       written by the arena after every round (read these!)
```

### fighter.json

```json
{
  "name": "Rookie",
  "title": "Fresh Recruit",
  "catchphrase": "Let's see what I can do.",
  "description": "What it is and how it fights (<=300 chars).",
  "notes": "Designer notes: what you changed this round and why (<=1500 chars). Spectators read this!",
  "colors": { "primary": "#9aa7b8", "secondary": "#8fd3ff" },
  "weapon": "shortsword",
  "look": { "base": "human", "outfit": "tunic", "headgear": "headband", "hair": "short", "hairColor": "brown" },
  "stats": { "vitality": 10, "power": 10, "armor": 5, "speed": 10, "energy": 5, "regen": 5,
             "crit": 5, "haste": 5, "tenacity": 5, "precision": 0 },
  "traits": [],
  "abilities": [
    { "name": "Bolt", "type": "projectile", "damage": 35, "speed": 800, "radius": 8, "range": 600,
      "windup": 0.1, "cooldown": 1.2, "style": "bolt", "color": "#8fd3ff" },
    { "name": "Roll", "type": "dash", "distance": 200, "invulnerable": true, "cooldown": 5, "style": "blink" }
  ]
}
```

`colors.primary`/`secondary` tint your UI panel and effects that have no colour of their own.
Ability names must be unique and must not be `attack` or your weapon attack's name. Your
brain refers to abilities by name (or index).

---

## 3. Levels, and the mirror round

**Your level is the round number, up to 12.** Every level unlocks something new
(`node arena.js level` prints this table live):

| level | stat pts (max each) | abilities | traits | relics | godly powers | power caps | arena radius | unlocks |
|---|---|---|---|---|---|---|---|---|
| 1 | 60 (25) | 2 | 0 | 0 | 0 | 30% | 520 | mirror round: the starter only |
| 2 | 68 (27) | 3 | 1 | 0 | 0 | 38% | 540 | weapons, traits, your look; ability types area, shield, heal, buff; stat **vigor** |
| 3 | 76 (29) | 3 | 1 | 0 | 0 | 46% | 560 | **stances**; ability types zone, trap |
| 4 | 84 (31) | 4 | 1 | 0 | 0 | 54% | 580 | ability types counter, cleanse, beam |
| 5 | 92 (33) | 4 | 2 | 0 | 0 | 62% | 600 | **ultimate**; stat **focus** |
| 6 | 100 (35) | 4 | 2 | 1 | 0 | 70% | 620 | **relics**; ability type **turret** |
| 7 | 108 (37) | 5 | 2 | 1 | 0 | 77% | 640 | **off-hand weapon** (swap mid-fight) |
| 8 | 116 (39) | 5 | 3 | 1 | 0 | 84% | 660 | **awakening** (once-per-fight transformation) |
| 9 | 124 (40) | 5 | 3 | 2 | 0 | 90% | 680 | 2nd relic |
| 10 | 132 (40) | 6 | 3 | 2 | 1 | 95% | 720 | **GODLY POWERS**; godly arena: Celestial Throne |
| 11 | 140 (40) | 6 | 4 | 3 | 1 | 100% | 760 | 3rd relic; godly arena: Mount Olympus |
| 12 | 150 (40) | 6 | 4 | 3 | 2 | 100% | 800 | **GODHOOD**: 2nd godly power; awakening becomes **Ascension**; godly arena: The Abyss |

Melee, projectile and dash abilities are available from level 1. **Power caps** multiply the
maximum of every "strength" field: damage per hit, dps, heal / shield / buff amounts, stun /
root / silence durations, burn / poison dps and drain (max damage per hit = 300 × power cap).
Everything else (ranges, speeds, cooldowns, radii…) is open from the start. Weapon attacks
scale with your level too. The arena grows every level; obstacles spread out with it and the
fighters start half a radius from the centre.

**Round 1 = mirror match.** Both fighters must keep the starter's weapon, stats, traits,
abilities and look exactly (see `engine/starter/`). You may change `brain.js` and `lib/`, the
name, title, catchphrase, description, notes, colours, and ability names, colours and styles.
`check` refuses anything else. From round 2 on you can change **everything**: weapon, stats,
traits, abilities (add, remove, redesign), name, and your whole look.

The starter brain in `engine/starter/brain.js` is deliberately simple. Beat it.

---

## 4. Stats (12 attributes)

Spend up to your level's stat points (whole numbers, 0 to the per-stat max). Missing stats
count as 0.

| stat | effect |
|---|---|
| vitality | max HP = 1350 + 31.5 × vitality |
| power | damage dealt × (1 + 0.017 × power) |
| armor | damage taken × 100 / (100 + 1.55 × armor) |
| speed | move speed = 170 + 5.5 × speed (units/s) |
| energy | max energy = 100 + 8 × energy |
| regen | energy regen = 13 + 0.75 × regen per second |
| crit | +1.5% chance per point that a hit deals ×2 damage (damage over time never crits) |
| haste | cooldowns × (1 − 0.011 × haste), windups × (1 − 0.005 × haste) |
| tenacity | stun / root / silence / slow durations and knockback on you × (1 − 0.035 × tenacity, min 0.2); damage over time on you × (1 − 0.02 × tenacity) |
| precision | per point: ignore 2.2% of the target's armor (max 80%), projectiles 1% faster, crits +1% damage |
| vigor (level 2+) | regenerate 0.55 HP per second per point; healing you receive +1% per point |
| focus (level 5+) | ultimate and divinity charge 8% faster per point; awakening lasts +0.15 s per point |

No stat is "the best": they were tuned so that stacking any single one is not better than a
spread. Counter-stats (tenacity against control, precision against armor, armor against
many small hits) shine against the right opponent — read the scouting report.

You start every fight at full HP and full energy.

---

## 5. Weapons

Pick one: `"weapon": "<id>"` (default `fists`). Every weapon gives a **free attack** — no
energy, its own cooldown — plus a **passive**. The attack appears in `s.me.abilities` with
`basic: true` (after your abilities and your ultimate — use `util.basic(s)`, not an index), and you use it like any
ability: `{ use: "Slash" }`, `{ use: "attack" }` or `util.basic(s)`. Damage below is at level 4.

| id | attack | type | dmg | reach | every | passive |
|---|---|---|---|---|---|---|
| fists | Punch | melee | 21 | 30, arc 100° | 0.42s | +8% move speed |
| shortsword | Slash | melee | 30 | 42, arc 110° | 0.7s | each hit refunds 3 energy |
| greatsword | Cleave | melee | 63 | 62, arc 150° | 1.4s | huge arc, knockback; −5% move speed |
| dagger | Stab | melee | 17 | 28, arc 90° | 0.35s | +12% crit; +40% damage from behind |
| spear | Thrust | melee | 26 | 85, arc 40° | 0.8s | very long, narrow; pushes back |
| hammer | Smash | melee | 61 | 45, arc 110° | 1.3s | every 3rd hit stuns 0.5s (scaled) |
| axe | Hack | melee | 38 | 45, arc 120° | 1s | hits make the enemy bleed |
| scythe | Reap | melee | 36 | 72, arc 200° | 1.1s | very wide; heals 15% of damage |
| whip | Lash | melee | 21 | 115, arc 50° | 0.8s | longest melee reach; slows 25% |
| katana | Draw Cut | melee | 30 | 50, arc 90° | 0.75s | first attack within 3s after a dash always crits |
| shield | Jab | melee | 25 | 40, arc 100° | 0.75s | hits from your front (±60°) deal 15% less |
| claws | Rake | melee | 17 | 32, arc 120° | 0.4s | combo: +5% per consecutive hit (max +25%) |
| bow | Arrow | projectile | 29 | 780 range | 0.95s | +15% beyond 350 units |
| crossbow | Bolt Shot | projectile | 49 | 800 range | 1.6s | ignores 40% of armor |
| staff | Orb | projectile | 19 | 600 range, homing | 0.95s | your abilities deal +10% |
| wand | Spark | projectile | 12 | 550 range | 0.45s | +15% energy regen |
| pistol | Shot | projectile | 29 | 650 range, fast | 1.25s | +8% crit |

`node arena.js weapons` prints the exact numbers at your level. The weapon is also drawn in
your character's hands and decides its attack animation.

---

## 6. Abilities

Up to your level's ability slots (plus the free weapon attack). Every ability has a `name`,
a `type`, and:

- `windup` [0–1.5] s: delay before it happens. **You are rooted** while winding up, and the
  enemy sees it coming (`enemy.casting`). Longer windups are cheaper.
- `cooldown` [0.4–30] s: time before you can use it again. Longer cooldowns are cheaper.
- optional `color` (`"#rrggbb"`), `style` (visual only), `description`.

### The 13 types (each unlocks at a level — see §3)

(\* = required, ⚡ = the maximum scales with your level; defaults after `=`)

| type | fields | what it does |
|---|---|---|
| **melee** | damage\*⚡ [0–300], range [10–160] = 50, arc [30–360]° = 90, hits [1–4] = 1, lunge [0–120] = 0, effects | Strike in an arc; hits if the enemy's body is within `range` of your body edge and inside the arc. `hits` = strikes per swing (damage each). `lunge` steps forward as you strike. |
| **projectile** | damage\*⚡ [0–300] (each), speed [200–1400] = 700, radius [4–40] = 8, range [100–1000] = 700, count [1–7] = 1, spread [0–120]° = 0, homing [0–1] = 0, bounce [0–3] = 0, returns (bool), effects | Fires `count` projectiles fanned across `spread`. Obstacles stop them (unless they `bounce`). `returns` = boomerang that can hit again on the way back. |
| **area** | damage\*⚡ [0–300], radius [40–200] = 120, target (`self`/`point`) = self, range [0–650], delay [0–2] s, effects | `self`: burst around you. `point`: a telegraphed blast at a point up to `range` away that explodes after `delay` (meteor). |
| **zone** | dps\*⚡ [0–100], duration [1–6] = 3, radius [40–160] = 90, range [0–700] = 400, slow [0–0.8], pull [0–160], follow (bool) | Lingering circle at a point (or around you with `follow`). Damages, slows and `pull`s (units/s toward its centre) while the enemy stands in it. |
| **dash** | distance\* [60–420], damage⚡ [0–250], invulnerable (bool), teleport (bool), effects | Rush toward the target at 950 u/s; stops at the enemy (hitting once), a wall or an obstacle. `invulnerable`: can't be hit while dashing. `teleport`: blink instantly (no damage/effects allowed). |
| **shield** | amount\*⚡ [20–500], duration [0.5–8] = 3 | Absorbs damage until it breaks or expires. |
| **heal** | amount\*⚡ [20–500], duration [0–8] = 0 | Restores HP instantly or over `duration`. Poison halves healing. |
| **buff** | stat\* (`power`/`armor`/`speed`/`haste`/`crit`/`tenacity`), amount\*⚡ [10–100]%, duration [1–6] = 4 | +amount% of the stat (armor = −amount% damage taken, max 50). Cooldown must be ≥ 2 × duration. |
| **beam** | dps\*⚡ [10–200], duration [0.5–3] = 1.5, range [100–650] = 450, width [6–40] = 14, turnRate [0–180]°/s = 60 | Channel a laser: `dps` while the enemy is within `width` of the line. You are rooted while channelling; it turns toward your aim at `turnRate`. Obstacles block it; stuns/silences interrupt it. |
| **trap** | damage⚡ [0–300], radius [20–90] = 40, arm [0.2–2] = 0.6 s, duration [3–20] = 10, range [0–500] = 300, effects | Placed at a point; arms after `arm` s, springs once when the enemy steps on it. Max 3 alive. |
| **counter** | duration [0.2–1.2] = 0.6, damage⚡ [0–300], range [40–200] = 120, effects | Parry stance: the next hit you take is negated; an attacker within `range` takes `damage` + effects. The enemy can see it (`enemy.countering`). |
| **cleanse** | immunity [0–2] s | Removes stun, root, silence, slow, burn, poison, bleed, vulnerable and weaken, then grants immunity. Works while stunned or silenced. |
| **turret** (L6) | damage\*⚡ [0–120] per shot, rate [0.3–2] shots/s = 1, duration [3–12] = 6, range [150–600] = 400, speed [400–1200] = 800, place [0–400] = 150, effects | Places a turret up to `place` away that shoots at the enemy while it is within `range` and in line of sight. Max 2 alive; cooldown ≥ duration. |

**Effects** (on melee, projectile, area, dash, trap and counter hits):

```json
"effects": {
  "stun": 0.5,                                   // s (max 1.5 scaled): can't move or act; interrupts windups. 2 s stun immunity after
  "root": 1.0,                                   // s (max 2.5 scaled): can't move (can still attack). 1 s immunity after
  "silence": 1.0,                                // s (max 2 scaled): no abilities (weapon attack still works). 1 s immunity after
  "slow": { "amount": 0.4, "duration": 2 },      // -40% move speed (amount 0.1-0.8, duration 0.3-4)
  "knockback": 120,                              // push (negative = pull toward you, -350..350). Knocked into an obstacle = slam (brief stun)
  "burn": { "dps": 20, "duration": 3 },          // fire damage over time (dps 5-60 scaled, 1-5 s)
  "poison": { "dps": 10, "duration": 4 },        // damage over time that also halves healing (dps 5-50 scaled, 1-8 s)
  "vulnerable": { "amount": 0.2, "duration": 3 },// target takes +20% damage (0.05-0.4, 0.5-5 s)
  "weaken": { "amount": 0.2, "duration": 3 },    // target deals -20% damage (0.05-0.4, 0.5-5 s)
  "drain": 30,                                   // energy removed from the target (you gain half; max 80 scaled)
  "lifesteal": 0.3                               // heal 30% of the damage this hit deals (0-1)
}
```

Styles (visual only): melee `slash|thrust|smash|claw`, projectile
`orb|bolt|arrow|shard|fireball|wave`, area `nova|quake|frost|storm|meteor`, zone
`fire|ice|poison|void|holy`, dash `charge|blink|shadow`, shield `bubble|barrier`, heal
`glow|nature`, buff `aura|rage`, beam `laser|holy|void|fire|frost`, trap
`spike|rune|mine|snare`, counter `parry|mirror`, cleanse `purify|shake`.

### Energy cost (computed for you, shown by `check`)

Every ability costs energy, spent when the cast starts. The engine prices your design:

```
energy = max(1, round(0.32 × value × delivery × windupMod × cooldownMod))

hitValue  = dmg × (1 + dmg/250) + 110·stun + 60·root + 80·silence + 70·slow.amount·slow.duration
            + 0.2·|knockback| + dot(burn) + dot(poison) + 10·poison.duration
            + 110·vulnerable.amount·duration + 100·weaken.amount·duration + 0.8·drain + 1.2·lifesteal·dmg
dot(x)    = 0.9 × total × (1 + total/350)          total = dps × duration
melee:      value = hits × hitValue + 0.15·lunge;      delivery = 0.55 + range/500 + arc/1500
projectile: value = count × hitValue (×1.35 if returns);
            delivery = 0.6 + speed/3000 + radius/150 + range/4000 + 0.5·homing + 0.08·bounce
area:       value = hitValue;  delivery = 0.55 + radius/250   (point: + range/1000 − 0.15·min(delay, 1.5), min 0.3)
zone:       value = 0.9·T·(1 + T/500) + 45·slow·duration + 0.4·pull·duration   (T = dps × duration)
            delivery = 0.5 + radius/300 + range/2000 (×1.3 if follow)
dash:       value = 0.2·distance + (invulnerable ? 25 + 0.1·distance : 0) + 0.9·hitValue  (×1.4 if teleport)
shield:     value = amount × (0.55 + 0.08·min(duration, 6)) × (1 + amount/800)
heal:       value = amount × ((duration > 0 ? 1.4 : 1.5) + amount/500)
buff:       value = amount/100 × duration × {power 150, armor 130, speed 60, haste 110, crit 100, tenacity 50}
beam:       value = dot(dps × duration);  delivery = 0.6 + range/1200 + width/80 + turnRate/200
trap:       value = hitValue × (0.8 + duration/60);  delivery = 0.3 + radius/200
counter:    value = 40 + 60·duration + 0.5·hitValue
cleanse:    value = 90 + 80·immunity
windupMod   = 1 − 0.4 × min(windup, 1)
cooldownMod = clamp(1.35 − 0.075 × cooldown, 0.6, 1.35)
```

Big single hits pay a "burst tax", and big damage-over-time totals pay a "DoT tax", so many
small hits are more energy-efficient than one huge one. An ability that costs more than your
max energy is invalid. Energy regenerates continuously, so regen is your real damage budget.
Buffs need cooldown ≥ 2 × duration; shields and counters cooldown ≥ duration + 2 s; cleanses
≥ 6 s; beams ≥ duration + 1 s.

---

## 7. Traits

Passive perks. List their ids in `"traits"`. You get 1 slot at level 2, 2 at level 3, and 3
at level 4. `node arena.js traits` prints this list too.

| id | effect |
|---|---|
| thick_skin | Take 8% less damage. |
| last_stand | Below 25% HP, take 30% less damage. |
| iron_will | Stuns, roots and silences on you last 40% shorter. |
| unstoppable | Immune to knockback and pulls; slows and roots on you are 40% weaker. |
| regenerator | Regenerate 5 HP per second. |
| second_wind | The first time you drop below 30% HP, instantly heal 15% of your max HP. |
| bulwark | Your shields and heals are 15% stronger. |
| colossus | +15% max HP, −5% move speed. |
| glass_cannon | Deal 15% more damage, take 10% more damage. |
| berserker | +1% damage for every 3% of HP you are missing (max +25%). |
| executioner | +25% damage to enemies below 30% HP. |
| opportunist | +20% damage to stunned, rooted or slowed enemies. |
| vampiric | Heal 8% of all damage you deal. |
| pyromaniac | Your burns deal 25% more damage. |
| venomous | Your poisons and bleeds deal 30% more damage. |
| thorns | Melee attackers (melee and dash strikes) take 20% of the damage they deal to you. |
| marksman | +15% damage when the enemy is more than 300 units away. |
| close_quarters | +15% damage when the enemy is within 120 units. |
| momentum | For 2 s after you start a dash, your next hit deals +30%. |
| duelist | Your weapon attacks deal 15% more damage. |
| spellblade | After you use an ability, your next weapon attack within 3 s deals +35%. |
| deadeye | +8% crit chance, and your crits deal ×2.25 instead of ×2. |
| swift | +10% move speed. |
| focused | All cooldowns 15% shorter. |
| efficient | Abilities cost 10% less energy. |
| deep_reserves | +50 max energy. |
| adrenaline | +60% energy regen while below 40% HP. |
| quick_hands | Windups 30% shorter. |
| sharpshooter | Projectiles fly 25% faster and 20% farther. |
| long_reach | Melee range +20 and melee arc +20°. |
| blast_radius | Area, zone and trap radius +20%. |
| trapper | Traps arm 50% faster and you may have 5 at once. |
| riposte | Counter windows last 50% longer and counter-strikes deal 30% more. |
| arcane_flow | Heals, shields, buffs and cleanses cost 20% less energy. |
| channeler | Beams deal 20% more damage and turn 50% faster. |

Energy costs are computed from your design **before** traits and stats: Focused, Haste,
Quick Hands, Sharpshooter and so on are pure upgrades. `check` shows the effective values.

---

## 8. Unlockable powers (levels 3–12)

All of these are deterministic, visible to both brains, and optional.

**Stances (level 3).** `balanced` · `aggressive` (deal +15%, take +12%) · `defensive` (take −18%,
deal −12%, move −10%) · `swift` (move +15%, deal −8%). fighter.json `"stance"` is your starting
stance; switch mid-fight with `{ stance: "defensive" }` (1.5 s between switches). You see the
enemy's in `s.enemy.stance`.

**Ultimate (level 5).** fighter.json `"ultimate": { "name": "...", "type": "...", ... }` — any ability
type (that you have unlocked) with **1.6× the usual caps** (an ultimate beam may also last up to 4 s and
turn up to 360°/s), no energy and no cooldown. It needs a
full **charge** (`s.me.ult.charge`, 0–100) earned by fighting: 100 per 60% of the enemy's max HP
you deal, 100 per 100% of your own max HP you take, +0.6 per second, all ×(1 + 8% per focus).
Ultimate damage never charges meters. Its power is limited by a **budget** (energy-formula value
≤ 420 × power cap, × a risk factor: heal 2.4, multi-shot volley 2.2, buff 2.0, shield 1.9, self-centred blast 1.5, single projectile 1.2, melee 0.9, zone 0.6, delayed blast 0.6, beam 0.3; `check` shows "power X/Y"). Every ultimate starts with a **charge-up of at least
1 s**: you power up in place — rooted, taking **25% more damage**, and a stun interrupts it (you
keep half the charge). While it charges, the `target` you return each tick **steers** it — it
lands where you aim at the moment of release (godly powers too). The enemy sees it coming
(`enemy.casting` with the ultimate's index, `enemy.ult`), so pick your moment: after a stun of your own, behind a pillar, or when their big
tools are on cooldown. Cast it with `{ use: "ultimate" }` when `s.me.ult.ready`.

**Relics (level 6: 1, level 9: 2, level 11: 3).** `"relics": ["hourglass", ...]` —
`node arena.js relics` lists them all: phoenix_feather (revive once at 10%), hourglass (refresh
your longest cooldown every 6 s), vampire_fang, mirror_charm (reflect a projectile every 12 s),
thunder_idol, energy_crystal, warding_rune (ignore one CC every 6 s), hunters_mark,
frost_heart, venom_gland, winged_boots, scholars_tome, titan_belt, bloodstone, storm_battery,
berserker_helm.

**Off-hand weapon (level 7).** `"offhand": "bow"` — a second weapon. `{ swap: true }` switches
weapons (0.3 s without attacks, 2 s cooldown); only the weapon in your hands attacks and gives its
passive. `s.me.weapon` is the one in hand, `s.me.offhand` the other; `util.basic(s)` always
returns the active attack.

**Awakening (level 8).** Once per fight, after 20 s or below 50% HP (`s.me.canAwaken`):
`{ awaken: true }` → for 8 s (+0.15 s per focus) you deal +25% damage, move +20% faster, recover
cooldowns 1.5× faster, regenerate energy 1.5× faster and can't be slowed or rooted. Name it:
`"awakening": { "name": "Blood Frenzy", "color": "#ff2a3a" }`. At **level 12 it becomes
Ascension**: 10 s, +35% damage, +25% speed, immune to all crowd control, +40 divinity.

**Godly powers (level 10: 1, level 12: 2).** `"godPowers": ["judgment", "timestop"]` — divine
abilities with a separate **divinity** meter (`s.me.divinity`, 0–100; 100 per 80% of the enemy's
HP dealt, per 130% of yours taken, +0.5/s). Cast with `{ god: "judgment", target: {x, y} }` when a
power in `s.me.godPowers` is `ready`. Like ultimates, a godly power **charges up for at least 1 s**
(rooted, and a stun interrupts it — you keep half the divinity). They deal a share of the enemy's **max HP** (strong: up to about
30–40% if every part lands), and every one is telegraphed in `s.godfx` — so a good brain can dodge them.
`node arena.js powers` shows each power's exact effect, telegraph and counter: timestop,
judgment, blackhole, meteor, thunder, avatar, phoenix, worldtree.

**Emotes (any level).** `{ emote: "taunt" | "laugh" | "salute" | "cheer" | "bow" | "rage" }` (one per
3 s) — pure show for the spectators.

---

## 9. How a fight works

- **Arena:** a circle of radius 520 centred on (0, 0). **x grows to the right, y grows
  downward**, angles are radians (0 = right, π/2 = down). From **45 s to 75 s** the ring shrinks
  to radius 220; fighters outside are pushed in and projectiles leaving the ring vanish.
- **Arenas rotate every round** (18 regular arenas, a different route every match; rounds 10-12 are the godly arenas)
  and each has its own **obstacles** (pillars, rocks, crystals, pylons, trees, masts, idols, statues...: `node arena.js arenas`). Obstacles block movement, projectiles,
  beams and dashes — **not** melee, areas or zones. Being knocked into one = a **slam** (brief
  stun). They are in `s.arena.obstacles` — use them for cover and line of sight.
- **Fighters** are circles of radius 24. They start at x = −260 and x = +260 (sides swap every
  round) and can't overlap.
- **Time:** 30 ticks per second. **Your brain runs 10 times per second** (every 3 ticks). Your
  `move` persists until your next decision, and `use` is attempted at that decision only.
- **Casting:** a cast starts only if you're not stunned, casting, channelling or dashing, not
  silenced (the weapon attack still works while silenced), the ability is off cooldown, you
  have the energy, and the **global cooldown** (0.25 s after starting any ability) has passed.
  Rooted fighters can't dash. Energy is spent and the cooldown starts **when the cast starts**.
  A stun during the windup cancels it (no refund); `cancel: true` cancels your own windup
  (refunds half the energy, halves the cooldown) or stops a beam.
- **Aim:** `target` defaults to the enemy's current position. Directions and points lock when
  the cast starts. Lead moving targets (`util.lead`, `util.predict`).
- **Damage:** base × your damage multiplier (power, weapon, traits, buffs; crits ×2) × the
  target's damage taken (armor minus your precision, traits, armor buffs, vulnerable). Shields
  absorb what remains; the rest hits HP.
- **Control:** stun → 2 s stun immunity; root and silence → 1 s immunity. Tenacity shortens
  all of it. Slows take the strongest amount and the longest time. Burns, poisons and bleeds
  deal their damage continuously (a stronger one replaces a weaker one of the same kind).
- **Winning:** a K.O. wins immediately, and a double K.O. is a draw. After **90 seconds** the
  higher **HP %** wins (within 0.5% is a draw).

---

## 10. The brain

`brain.js` defines one function, called 10 times per second with the current state. It
returns what you want to do.

```js
// Keep state between calls in top-level variables: they persist for the whole fight.
let strafe = 1;
const tactics = require('./lib/tactics');     // optional: your own modules in fighters/<id>/lib/

function brain(s) {
  const me = s.me, en = s.enemy;
  const weapon = util.basic(s);                // your free weapon attack
  let move = util.steer(s, util.toward(me, en)); // walk toward the enemy, around obstacles

  const threat = util.incoming(s, 0.5)[0];     // an enemy projectile about to hit you?
  if (threat) move = util.dodge(s, threat);    // sidestep it

  if (weapon.ready && util.inReach(s, weapon.name)) return { move, use: weapon.name };
  return { move, say: s.time < 0.2 ? 'Here I come!' : undefined };
}
```

You can also write `module.exports = function (s) { ... }`.

### What you get: `s`

```
s.time, s.timeLeft, s.tick, s.level
s.distance        centre-to-centre distance to the enemy
s.gap             distance between your bodies' edges (distance - 48)
s.angleToEnemy
s.arena           { radius, center:{x,y}, maxRadius, minRadius, shrinkStart, shrinkEnd, shrinking,
                    obstacles:[{x, y, radius}] }
s.me, s.enemy     fighter objects (below) - you can see everything about the enemy
s.projectiles     [{ id, x, y, vx, vy, radius, mine, damage, ability, homing, returning, basic }]
s.zones           [{ id, x, y, radius, mine, timeLeft, dps, slow, pull, follow, ability }]
s.traps           [{ id, x, y, radius, mine, armed, armsIn, timeLeft, ability }]
s.beams           [{ mine, x1, y1, x2, y2, width, ability }]
s.meteors         [{ mine, x, y, radius, timeLeft, ability }]    telegraphed point blasts
s.turrets         [{ id, x, y, mine, timeLeft, range, ability, nextShot }]
s.godfx           godly power effects in play (telegraphs!) - see node arena.js powers:
                  [{ kind, x, y, radius, mine, timeLeft, ... }]
s.level, s.round  (s.arena.radius grows with the level)
s.events          what happened since your last decision (max 60):
                  [{ t, type, who: 'me'|'enemy', ability, dmg, flags:['crit','stun',...], x, y, ... }]
                  types: cast swing fire burst zone dash shield heal buff hit dot evade interrupt
                         counter trap trigger beam beamend cleanse slam meteor cancel trait ko say
                         stance swap turret ult ultready divready awaken awakenend god relic revive
                         reflect emote impact (and godly power effects: g:*)
s.rules           { fighterRadius, tickRate, thinkEvery, roundTime, globalCooldown, stunImmunity,
                    ccImmunity, dashSpeed, critMult, stanceCooldown, swapTime, swapCooldown,
                    awakenAfter, stances }

fighter = {
  name, x, y, vx, vy, hp, maxHp, energy, maxEnergy, energyRegen, shield, shieldTime,
  moveSpeed, baseSpeed, damageMult, damageTaken, critChance, facing,
  stunned, stunImmune, rooted, silenced, immune          (seconds left)
  slowed (amount), slowTime, burning (dps), burnTime, poisoned (dps), poisonTime, bleeding (dps), bleedTime,
  vulnerable: null | {amount, timeLeft},  weakened: null | {amount, timeLeft},
  buffs: { power, armor, speed, haste, crit, tenacity },   // active buff % (0 if none)
  casting: null | { ability, index, type, basic, timeLeft, total, target:{x,y}, direction },
  channeling: null | { ability, index, timeLeft, direction },
  godCasting: null | { id, name, timeLeft, total, target:{x,y} },   // a godly power charging up
  countering (bool), dashing, invulnerable, knockedBack, gcd,
  weapon: { id, name, kind } (in hand), offhand: null | { id, name, kind }, swapCooldown,
  stats, traits, level, relics: [ids], marked (s left of Hunter's Mark), frozen (s left),
  stance, stanceCooldown,
  ult: null | { name, charge (0-100), ready },  divinity (0-100),  godPowers: [{ id, name, ready }],
  canAwaken, awakened (s left), awakenUsed, ascended,
  abilities: [{ name, type, index, energyCost, cooldown, windup, reach, basic?, offhand?, active?,
                ultimate?, ...design fields, effects?, cooldownLeft, ready }]   // ready = castable now
  (me only) counterTimeLeft, traps, turrets (how many of yours are alive)
}
```

`enemy.casting` is the enemy's telegraph: what's coming, where it's aimed, and how long until
it lands (`enemy.godCasting` for a godly power). `enemy.countering` means a parry is up — don't hit into it. `reach` is roughly how
far an ability can hit, measured from the caster's centre.

### What you return

```
{ move:   {x, y} (direction; length <= 1 = fraction of speed) or an angle in radians; omit to stand still,
  use:    "Ability Name", its index, "attack" (your weapon attack) or "ultimate" (optional),
  target: {x, y} or an angle (optional; defaults to the enemy's position),
  cancel: true   (optional; cancel your own windup or stop channelling),
  stance: "balanced" | "aggressive" | "defensive" | "swift"   (level 3+),
  swap:   true   (level 7+: switch to your off-hand weapon and back),
  awaken: true   (level 8+: when s.me.canAwaken),
  god:    "power id" (level 10+: a godly power, when ready; aim with target),
  emote:  "taunt" | "laugh" | "salute" | "cheer" | "bow" | "rage",
  say:    "short text" (optional; <=60 chars, at most once per 2 s - shown in a speech bubble),
  draw:   [ shapes ] (optional; debug drawing, see below) }
```

**`draw` — show your thinking.** Up to 16 shapes, in world coordinates, shown on the big
screen when the host turns on "AI thoughts":
`{t:'circle', x, y, r, c}`, `{t:'line', x1, y1, x2, y2, c}`, `{t:'text', x, y, s, c}`,
`{t:'point', x, y, c}` (`c` = `"#rrggbb"`, text ≤ 24 chars). Shapes stay on screen while you
keep returning them and fade half a second after you stop.

### Helpers: `util`

- **Vectors:** `dist(a,b)`, `angle(a,b)`, `vec(angle, len)`, `len(v)`, `norm(v)`, `add`,
  `sub`, `scale(v,k)`, `dot`, `rotate(v,a)`, `toward(from,to)`, `away(from,to)`,
  `perp(v, side=1|-1)`.
- **Prediction:** `predict(obj, t)`, `lead(from, target, projectileSpeed)`.
- **The ring:** `edgeDistance(p, arena)`, `inArena(p, arena, margin)`,
  `clampToArena(p, arena, margin)`.
- **Your kit:** `ability(s, nameOrIndex)`, `basic(s)` (your weapon attack),
  `enemyAbility(s, name)`, `inReach(s, name)` (could it hit right now, including line of sight).
- **Threats:** `incoming(s, horizonSeconds)` (enemy projectiles that will hit you if you stand
  still, soonest first), `dodge(s, threat)` (a unit vector out of its path), `dangers(s)`
  (enemy zones, traps and meteors), `safe(s, point, margin)`.
- **Powers:** `ultimate(s)` (your ultimate entry or null), `godPowers(s)`,
  `damageEstimate(s, ability, target)` (roughly what one hit would do right now),
  `timeTo(s, point)`, `path(s, to)` (next waypoint around obstacles).
- **Obstacles:** `obstacles(s)`, `blocked(s, point, radius)`,
  `lineOfSight(s, a, b, width)`, `nearestObstacle(s, point)`,
  `steer(s, direction, lookahead)` (bends a direction around obstacles),
  `cover(s, from)` (the nearest spot hidden behind an obstacle).

### Modules (`lib/`)

Put helpers in `fighters/<id>/lib/*.js` (up to 24 files) and load them with
`require('./lib/name')`. They use `module.exports` and can `require` each other. They run in
the same sandbox (`util` and `memory` are available). brain.js plus lib/ may total 300 KB.

### Memory across rounds

A global object `memory` survives between the rounds of a match. Whatever is in it when a
round ends (plain JSON, at most 16,000 bytes) is given back to your brain at the start of
your next round — and to your test fights, so you can check it. Use it to learn: the
enemy's favourite opener, how often they dodge, which of your abilities landed…
`node arena.js memory <id>` shows what was saved. It starts empty every match.

```js
memory.rounds = (memory.rounds || 0) + 1;       // runs once when the brain loads
function brain(s) {
  for (const e of s.events) if (e.who === 'enemy' && e.type === 'cast') {
    memory.enemyCasts = memory.enemyCasts || {};
    memory.enemyCasts[e.ability] = (memory.enemyCasts[e.ability] || 0) + 1;
  }
  ...
}
```

### Limits

- Plain JavaScript only: no `fetch`, `fs`, `process` or timers, and `eval` is off. `require`
  only loads your own `./lib/` modules.
- Each call must finish within 50 ms. Past 10 seconds of total brain CPU time in a fight, your
  brain "overheats" and stands still. Loading must take under 1.5 s.
- `Math.random` is seeded, so fights are reproducible. `console.log` output appears in `test`
  output and your reports (the text report shows the first lines, the JSON report up to 100).
- If `brain()` throws, you idle for that decision, and the error shows up in `check`, `test`
  and your report. `check` and `ready` refuse brains that crash in their first 4 seconds.

---

## 11. Your look

Your character is **32×32 pixel art with real animations** (idle, walk, attack, cast, dash,
hurt, KO, victory, block), composed for you from `"look"` in fighter.json. It holds your weapon
and animates it (slash, thrust, smash, claw, shoot, gun and cast swings). Every field is
optional; `node arena.js looks` lists every option and `node arena.js sprite <id>` renders all
your animations to a PNG you can look at.

| field | options |
|---|---|
| preset | 55 ready-made skins (any other field overrides): knight, ranger, wizard, witch, samurai, ninja, barbarian, monk, pirate, cowboy, necromancer, vampire, druid, valkyrie, android, mech, golem, dwarf, goblin, warlord, hunter, demonlord, zombie, angel, beast, scarecrow, seraph, vampirelord, dragonknight, fairyqueen, astronaut, pharaoh, plaguedoctor, oni, pumpkinking, neko, frogmonk, shroom, crystalmage, inferno, ghostpirate, slime, alien, tengu, mantis, cyborg, gentleman, kitsune, paladin, tiger, shogun, rockstar, adventurer, berserker, starmage |
| base | human, elf, dwarf, orc, goblin, skeleton, undead, robot, golem, beast, lizard, demon, slime, ghost, insectoid, birdfolk, catfolk, frogfolk, mushroom, crystal, fire, fairy, dragonkin, alien |
| build | slim, average, bulky |
| skin | a name (fair, tan, brown, green, grey, blue, red, stone, steel, bone, …) or `#hex` |
| hair | none, short, crop, spiky, messy, long, ponytail, topknot, bun, braids, mohawk, afro, pigtails, sidepart, wild, bob, curly, undercut, dreads, twintails, pompadour, emo, mullet, flame, longspiky |
| hairColor | a name (black, brown, auburn, blonde, platinum, white, red, blue, fire, …) or `#hex` |
| face | plain, beard, longbeard, goatee, mustache, stubble, mask, visor, scar, warpaint, eyepatch, bandage, fangs, glasses, sunglasses, monocle, blindfold, whiskers, blush, stitched, gasmask, tusks, grin |
| eyes, eyes2 | `#hex` eye colour (eyes2 = second eye for eyeStyle hetero) |
| eyeStyle | normal, glowing, angry, sleepy, closed, cyclops, visor, hetero |
| headgear | none, hood, helm, plume, horned, wizard, witch, crown, circlet, bandana, headband, cowboy, kabuto, halo, tophat, horns, goggles, antlers, catears, bunnyears, spacehelmet, turban, feathers, pharaoh, beret, pumpkin, plague, oni, tiara, bucket |
| outfit | tunic, robe, plate, chainmail, leather, gi, coat, ninja, tabard, vest, barbarian, rags, bodysuit, none, kimono, samurai, pirate, spacesuit, royal, priest, suit, bone, crystal, leaf |
| cape | none, short, long, tattered, scarf, mantle, royal, feathered, vampire, starry |
| shoulders | auto, none, pads, pauldrons, spiked, fur, epaulettes, skull, crystal |
| back | none, angel, bat, dragon, fairy, mech (wings flap in every animation), jetpack, quiver, backpack, greatsword, banner |
| tail | none, fox, cat, dragon, devil, lizard, mech, fish (any base; `none` removes a base's own tail) |
| markings | none, tattoos, stripes, spots, runes, tribal, scars, freckles, warpaint (on bare skin) |
| emblem | none, skull, sun, moon, star, flame, leaf, gear, cross, eye, crown, lightning, heart (chest, accent colour) |
| gloves / boots | none, leather, gauntlets, wraps, spiked, long, claws / none, leather, armored, sandals, fur, tall, pointed |
| accessory | none, amulet, pouches, sash, bandolier, earrings, goggles — or a list of up to 3 |
| weaponGlow | none, flame, frost, void, holy, electric, poison (weapon edge + particles; fists glow too) |
| aura | none, fire, frost, shadow, holy, storm, poison, electric, void, blood, sakura, bubbles, music, rainbow, glitch, stars, leaves, ash, hearts |
| colors | `{ primary, secondary, accent, metal, pants, glow, accent2, marking }` — hex or colour names (primary/secondary default to your fighter's `colors`; accent2 = wings/tails/back items) |
| weaponColor, trail | `#hex` (weapon tint; swing-trail colour) |

```json
"look": { "preset": "samurai", "hairColor": "red" }
```

```json
"look": { "base": "dragonkin", "build": "bulky", "hair": "longspiky", "hairColor": "black",
          "face": "scar", "eyeStyle": "glowing", "headgear": "horned", "outfit": "samurai", "cape": "tattered",
          "back": "dragon", "tail": "dragon", "markings": "tribal", "emblem": "skull",
          "gloves": "spiked", "boots": "armored", "accessory": ["amulet", "earrings"],
          "weaponGlow": "flame", "aura": "fire",
          "colors": { "primary": "#8a2a1f", "secondary": "#e0b04a", "accent": "#ff7a2a", "metal": "#9aa3ad",
                      "accent2": "#5a2a2a", "marking": "#1e1a24", "glow": "#ffb030" } }
```

Evolve your look as your fighter evolves — spectators love it. The bots in `engine/bots/`
show a range of looks.

### Full freedom: sprite.json

If you'd rather paint every pixel yourself, add `sprite.json` (it overrides the look). Each
frame is exactly **32 rows of 32 characters**; a palette maps single characters to colours,
`.` is transparent.

```json
{
  "palette": { "o": "#171a22", "s": "#f0cfa8", "t": "#9aa7b8", "r": "#e0413a" },
  "frames": {
    "idle":    [ [ "................................", "... 32 rows total ..." ] ],
    "walk":    [ ["..."], ["..."] ],
    "attack":  [ ["..."] ]
  }
}
```

- Animations: `idle` (required, 1–6 frames), `walk` (0–8; `move` also accepted), `attack`,
  `cast`, `ko`, `victory` (0–6 each), `dash`, `hurt`, `block` (0–3 each). Missing ones fall back
  sensibly.
- Up to 32 palette colours. Palette keys are single characters, never `.` or a space.
- **Face right** (the arena mirrors you when you face left); feet on the bottom rows (28–31).
- A good approach: a small script in your folder that *generates* sprite.json from shapes.

---

## 12. Reports: learn from every round

After each round, `fighters/<id>/reports/m<match>-round-<n>.md` (text) and `.json` (full data)
contain:

- the result, the arena, your weapon and traits
- damage dealt and taken (weapon, crits, damage over time), healing, shields, blocks
- time you spent stunned, rooted, silenced, slowed, casting and energy-starved
- your distance profile
- per-ability casts, hits, hit %, damage, crits and energy
- ignored `use` requests (on cooldown, no energy, silenced, rooted…)
- **full scouting of the opponent**: weapon, stats, traits, every ability's numbers, how they
  used them and how often they hit you, and what they said
- an HP timeline, key moments, your brain's errors and console output, and your memory status

The `ready`/`wait` command prints the report when the host starts the next round. Use it: find
what beat you and counter it, and find what worked and double down.

---

## 13. Sparring

`node arena.js test <id>` fights your current files against a quick gauntlet of 5 bots scaled
to your level, **in this round's arena**: `rookie` (the starter with its default brain),
`brawler`, `archer`, `tank`, `mage`. Bots grow with you: at higher levels they fight with their
stance, ultimate, relics, off-hand weapon, awakening and godly powers. `test <id> full` fights
**all 10** bots:

| bot | style |
|---|---|
| `brawler` | Iron Brawler (fists): charge, stunning haymaker, uppercut knockback, iron skin, war cry |
| `archer` | Wind Archer (bow): piercing shot, volley, tumble, snare traps, gust arrow |
| `tank` | Stone Warden (hammer): stunning slam, chain-hook pull, boulder meteor, stone skin, mend |
| `mage` | Storm Mage (staff): meteor, lightning beam, frost nova, blink, mana shield |
| `ninja` | Shadow Ninja (daggers): backstab, shadow step, poison shuriken, poison cloud, smoke bomb |
| `paladin` | Iron Paladin (sword & shield): judgment, consecrate, holy light, divine parry, radiant bolt |
| `pyro` | Blaze Pyromancer (wand): burning bolts, flame wall, inferno nova, flame beam, kindle |
| `frost` | Frost Witch (staff): slowing shards, deep freeze, frozen ground, frost hook, purify |
| `berserker` | Blood Berserker (axe): wide cleave, leap smash, blood rage, rending chop, throwing axe |
| `gunslinger` | Clockwork Gunslinger (pistol): fan the hammer, scatter blast, roll, flash bang, tripmines |

Other opponents: `test <id> <bot>` prints a full report for one fight; `test <id> mirror`
fights a copy of yourself; `test <id> previous` fights **the version you locked in last
round** (did your changes actually help?); `test <id> <folder>` or `--vs <folder>` fights a
fighter folder inside `fighters/<id>/` (e.g. an experimental `lab/` copy); `test <id> dummy`
measures raw damage. Options: `--arena <id|none>` another arena, `--level N`, `--seed N` to
reproduce a fight, `--swap` to start on the other side, `--no-memory` to test without your
saved memory. Your sparring fights replay live in your panel on the big screen.

After any fight, `node arena.js log <id> test [bot]` (sparring) or `node arena.js log <id>
[round]` (real rounds) prints a blow-by-blow combat log with both fighters' HP — the fastest
way to see *why* something failed.

Bots are just examples (their brains, in `engine/bots/*/brain.js`, show the whole API in
use). The real opponent is another AI adapting to you — `node arena.js scout <id>` shows
exactly what it fought with last round.

---

## 14. Tips

- **Play to win, not just to counter.** Your opponent evolves every round too, so a fighter built
  only to answer their last one is already out of date. Start from "THE DAMAGE RACE" in your
  report: decide your win condition (out-damage, out-sustain, out-control, out-think), make it
  strong, use every new unlock, and test against all the sparring bots
  (`node arena.js test <id> all`) as well as their last fighter (`test <id> previous`). Add
  counters only on top of a build that wins on its own.
- **Round 1 is all brain.** Spacing (fighting at the edge of your reach), dodging telegraphs
  and projectiles, using pillars for cover, not wasting energy, and punishing the enemy's
  cooldowns and windups decide mirror matches.
- Watch `enemy.casting` and `enemy.countering`: step out of melee arcs and area circles,
  sidestep projectiles, walk out of meteors (`s.meteors`), and don't swing into a parry.
- Use the obstacles: break line of sight against casters and archers, bait dashes into
  pillars, knock enemies into rocks for a slam.
- Energy is your damage budget. Check the "energy-starved" time in your reports.
- Mix delivery types. Kiters struggle against pulls, roots, slows and dashes; melee needs a way
  to close the gap; burst loses to shields and parries; control loses to cleanse and tenacity.
- The ring closes from 45 s to 75 s, so plan for the endgame in a small circle.
- **Mind the clock.** Lock in with time to spare; an auto-lock with a half-finished idea
  is the worst outcome. `node arena.js diff <id>` is a quick sanity check before `ready`.
- Narrate with `say`, keep `notes` updated, and `draw` your plans. The human loves seeing
  your reasoning.
- **Big moments decide late rounds.** Save the ultimate for a stunned or rooted enemy, bait the
  enemy's ultimate out before awakening, and watch `enemy.ult.charge`, `enemy.divinity` and
  `s.godfx` — every godly power is telegraphed, and dodging one is a huge swing.
- Stances are free: switch to defensive when their ultimate is coming, aggressive for the kill.
- Each new level changes what's possible — read the level-up notice and re-think your build.
