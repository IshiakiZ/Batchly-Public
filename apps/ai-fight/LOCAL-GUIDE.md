# AI FIGHT

Two AIs (for example Claude and ChatGPT) each control a pixel-art fighter and battle it out
while you watch live in your browser.

- Every match, **both AIs start with the identical "Rookie"**. Round 1 is a **mirror match**:
  same body, and only their fighting code (the "brain") differs.
- Each round has a **build time limit** (default 6:00 for round 1, 5:00 afterwards). The clock
  starts as soon as **either** AI starts working, every round. When it runs out, whatever each AI has is
  auto-locked, so nobody can think forever.
- Fights last up to **1:30** in **21 arenas** with **obstacles** (pillars, rocks, crystals,
  pylons, trees, ruins, masts, gravestones...); the ring shrinks from 0:45 to 1:15. Each match
  walks a different route through the 18 regular arenas, and rounds 10-12 are fought in the
  godly arenas. A match is **12 rounds**, each unlocking new powers up
  to godly ones (see Levels below); after round 12 the match ends by itself with the final statistics.
- After each round you press **Next Round**. Both AIs **level up** and evolve their fighters
  however they like:
  - **17 weapons**, each with a free attack and a passive;
  - **12 stats**: vitality, power, armor, speed, energy, regen, crit, haste, tenacity, precision,
    vigor and focus;
  - **13 ability types** (melee, projectile, area/meteor, zone, dash/teleport, shield, heal,
    buff, beam, trap, counter, cleanse, turret) with dozens of parameters and 11 on-hit effects;
  - **36 passive traits**;
  - an **animated character**: 24 body types (slime, ghost, dragonkin, alien…), hair, faces, eye styles,
    headgear, outfits, capes, wings and back items, tails, markings, chest emblems, gloves, boots,
    accessories, weapon glows, 18 auras, 8 colour slots and 55 presets. There are 9 animations
    (idle, walk, attack, cast, dash, hurt, KO, victory, block) drawn for whatever weapon they hold, or they can hand-paint every pixel.
- Brains can use **modules** (`lib/`), a **memory** that carries over between rounds, obstacle
  helpers, and **draw their plans** on screen (press `B` for "AI thoughts").
- Press **End Match** to see the final statistics: win/loss, damage, accuracy, crits,
  **coding time**, HP timelines, how each fighter evolved, your prediction record and all-time
  records.
- Every round is logged to **`results/rounds.csv`** and every match to **`results/matches.csv`**.

Everything runs locally. Only Node.js is needed (no `npm install`).

## Start

1. Double-click **`start.bat`** (or run `npm start`). This opens <http://localhost:3000>.
2. Open **☰ Menu → Setup & prompts**. It shows one prompt per AI with a copy button.
   The same prompts are saved in `prompts/claude.txt` and `prompts/chatgpt.txt`.
3. Open two coding agents **in this folder** and send the prompts at the same time:
   - **Claude Code** gets the Claude prompt.
   - **Codex** (ChatGPT) gets the ChatGPT prompt.
4. Watch. The page has four tabs:
   - **Live**: one card per AI, with sub-tabs Overview · Abilities · Brain · Sparring · Activity.
     The centre card shows the round, the build clock, lock-ins and your prediction. The fight
     starts automatically once both AIs have run `node arena.js ready …` (or when the clock
     runs out).
   - **Fighters**: every detail of a fighter — all its animations, weapon, stats, ability
     costs, brain code and its version history this match.
   - **Stats**: Overview · Rounds · Charts · Evolution · All-time, plus the CSV downloads.
   - **Replays**: every round of this and earlier matches, and exhibitions.
5. After every round:
   - **NEXT ROUND** (key `N`): each AI gets a detailed fight report, levels up and evolves.
   - **END MATCH** (key `E`): the final statistics.
   - **REPLAY** (key `R`): watch the round again.

## Game modes

**New match** asks which game to play. The AIs work the same way in every mode: they write a
design file and a brain, test against sparring bots, lock in with `node arena.js ready ...`,
read their report and improve for 12 rounds.

| mode | the AIs build | their files | rulebook |
|---|---|---|---|
| **Fighter Duel** | a pixel-art fighter and its fighting brain | `fighter.json` + `brain.js` | `AI_GUIDE.md` |
| **Army Battle** | an army (squads, formations, a general) and a commander that steers it in battle | `army.json` + `commander.js` | `ARMY_GUIDE.md` |
| **Modern Warfare** | a modern army - infantry, tanks, artillery, helicopters, jets, warships - with a command post and support powers, plus the commander that fights it | `forces.json` + `commander.js` | `WAR_GUIDE.md` |
| **Business Tycoon** | a company that competes for the same customers for a year; the biggest net worth wins | `company.json` + `strategy.js` | `BUSINESS_GUIDE.md` |

The prompts in **Setup & prompts** follow the chosen mode, so paste them again (in new chats)
after starting a match in a different mode. Every mode has its own rounds CSV
(`results/army-rounds.csv`, `results/war-rounds.csv`, `results/business-rounds.csv`).

## Things to press

| key | what |
|---|---|
| `L` / `I` / `S` / `W` | Live / Fighters / Stats / Replays tab (`[` `]` previous / next tab) |
| `N` / `E` / `R` | next round / end match / replay the last round |
| `P` / `T` | start–pause–resume the build clock / give both AIs +1 minute |
| `1` / `2` | predict the winner while the AIs build (scored in the stats and the CSV) |
| `X` | exhibition match: any two fighters — sparring bots or the AIs' current fighters |
| `F` | force start with whatever both AIs have right now |
| `B` / `D` | show the AIs' thoughts (their `draw` shapes) / detail panels in the arena |
| `G` | arena log drawer |
| `M` / `C` | mute / CRT scanlines |
| `?` | all shortcuts |

**☰ Menu** holds Exhibition, Setup & prompts, the arena log, Settings (time limits, sound,
music) and the shortcut list.

Tips:

- The AIs wait for your decision inside a command. If a card shows **not listening** after
  a round, tell that AI: *"run `node arena.js wait claude`"* (or `chatgpt`).
- **New match** (on the match-over card or the Stats tab) resets the score and gives both AIs
  the Rookie again. Everything in their folders (old brains, lab copies, reports) is moved to
  `data/archive/<time>/`, so nothing from an earlier match carries over.
- For a truly fresh match, also start **new chats** for both AIs. An AI that continues an
  old conversation still remembers the last match.

## Levels

Matches go up to **level 12** (level = round). Every level unlocks something, and the arena
grows from radius 520 to 800:

| level | unlocks |
|---|---|
| 1 | mirror round (identical starter) |
| 2 | weapons, traits, looks, more ability types, stat vigor |
| 3 | stances; zone + trap abilities |
| 4 | counter, cleanse, beam abilities |
| 5 | **ultimate** (charge meter); stat focus |
| 6 | **relics**; turret abilities |
| 7 | **off-hand weapon** (swap mid-fight) |
| 8 | **awakening** transformation |
| 9 | 2nd relic |
| 10 | **GODLY POWERS** (divinity meter); godly arenas: Celestial Throne (10), Mount Olympus (11), The Abyss (12) |
| 11 | 3rd relic |
| 12 | **GODHOOD**: 2nd godly power, awakening becomes **Ascension** |

Ultimates and godly powers power up in the arena first (the caster glows and is rooted for about a
second, and a stun interrupts it), then land with impact frames and a short hit-stop. The game never
pauses for a banner.

## Files

```
start.bat / package.json   start the arena (node server.js --open)
server.js                  the arena server, round state machine and build clock
arena.js                   the command line the AIs use (check, test, ready, wait, time, scout, log, weapons, looks, ...)
AI_GUIDE.md                the full rulebook the AIs read (Fighter Duel)
ARMY_GUIDE.md, WAR_GUIDE.md, BUSINESS_GUIDE.md   the rulebooks for the other game modes
engine/                    rules, simulation, sandboxed brains, look composer, reports, CSV, starter + 11 sparring bots
engine/modes/              the other game modes (army, war, business): rules, simulation, bots, reports
public/                    the spectator web page (procedural spectator artwork; silent edition)
fighters/claude/           Claude's fighter (fighter.json, brain.js, lib/, reports/)
fighters/chatgpt/          ChatGPT's fighter
results/                   rounds.csv + matches.csv (+ <mode>-rounds.csv); open in Excel / Google Sheets
data/                      match state, replays, brain memory, history (delete it to reset everything)
config.json                port, fighter ids, labels, colours, mirrorFirstRound, time limits
```

`config.json` accepts `"firstRoundLimitSec"` and `"roundLimitSec"` (0 = no limit) as defaults
for a fresh arena; once you change the limits in Settings, those are kept (in `data/`).

To pit other AIs against each other, change the ids and labels in `config.json` (for example
`gemini`). The prompts and folders follow automatically.

## How the AIs talk to the arena

The AIs never need network access. `arena.js` exchanges small files with the server through
`data/`. `ready` and `wait` block until the round is fought **and** you choose Next Round or
End Match. If an AI's shell times out, it just runs `wait` again. Brains run in time-limited Node VM contexts. Only run code from trusted local agents;
Node VM is not a security boundary for untrusted code. Fights are deterministic and replayable.

"Coding time" is measured from an AI's first file save or arena command in a round until it
locks in (the AIs' reading/thinking before their first action isn't visible to the arena).

This source edition contains no audio files or bundled fonts.
