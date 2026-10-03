# Game modes — the adapter contract

AI Fight runs one **mode** per match. The original mode is `fighter` (one fighter each, built in
`fighters/<id>/fighter.json` + `brain.js`). Other modes plug into the same match flow:

    New Match (host picks a mode) → building (AIs edit files, the clock runs) → both AIs lock in
    (`node arena.js ready <id>`) → countdown → the battle is simulated in a worker thread and
    played back on the spectator page → result → the host presses Next Round (level up) or the
    match ends (12 rounds, level = round number).

The server, the CLI (`arena.js`), the lock-in/wait/notice plumbing, the build clock, the feed,
the scoreboard, CSV logging and the spectator page shell are shared. A mode supplies the rest
through two modules:

- `engine/modes/<id>/index.js` — rules, validation, simulation, reports, bots, CLI extras (Node,
  CommonJS, no npm dependencies, **fully deterministic**: no `Math.random`, no wall clock inside
  the simulation — the host explicitly does not want random outcomes).
- `public/js/modes/<id>/view.js` — the spectator renderer (browser ES module, canvas 2D,
  pixel-art style matching the rest of the site).

Each AI's working folder is still `fighters/<id>/` (e.g. `fighters/claude/`). On New Match the
server archives whatever is there and installs the mode's starter files.

## `engine/modes/<id>/index.js`

```js
module.exports = {
  id: 'army',                         // folder name
  name: 'Army Battle',                // shown to the host
  tagline: 'Each AI raises and commands an army.',
  maxRounds: 12,                      // the match ends after this round (level = round number)
  designFile: 'army.json',            // the JSON design the AI edits in fighters/<id>/
  brainFile: 'commander.js',          // the JS brain the AI edits (optional lib/*.js modules allowed)
  guideFile: 'ARMY_GUIDE.md',         // at the project root: the complete manual for the competing AIs
  starter: { 'army.json': '…', 'commander.js': '…' },   // file name -> text, installed at New Match

  // Level (1..maxRounds) info for the host UI and the level-up notices.
  levelInfo(level) -> { level, headline: 'Budget 300 · 6 squads', lines: ['…', '…'] },
  levelUnlocks(level) -> ['cavalry squads unlocked', …],   // what is NEW at this level

  // Validate what an AI has written. NEVER throws. bundle = { design: string|null (raw file text),
  // brain: string|null, lib: { 'name.js': source } }.
  // spec   = the validated, normalised design (JSON-serialisable) that simulate() will use
  // name   = display name of the AI's creation (army / company name)
  // summary= one line for the spectator card; cardLines = a few short lines for the card;
  // text   = the full multi-line CLI output of `node arena.js check <id>`.
  check(bundle, { level }) -> { ok, errors: [], warnings: [], spec, name, colors: { primary, secondary },
                                summary, cardLines: [], text },

  // Simulate one round (runs inside a worker thread; may take a few seconds at most).
  // memories: optional per-side JSON strings carried over from the previous round (like the
  // fighter mode's `memory`); return the new ones in `memories` (or omit).
  simulate({ bundles: [a, b], ids: [idA, idB], labels: ['Claude', 'ChatGPT'], seed, level, round,
             theme, memories }) ->
    { replay,            // JSON-serialisable; MUST include { mode: '<id>', v: 1, duration: <seconds>,
                         //   sides: [{ id, label, name, colors: { primary, secondary } }, …], result }
      result: { winner: 0 | 1 | null, method: 'ROUT' | 'TIME' | …, time: <seconds>,
                text: "Claude's legion routed ChatGPT's army at 1:12" },
      stats: [objA, objB],        // flat { key: number } per side, used for reports, CSV and the result table
      memories: [jsonA, jsonB],   // optional
      brainErrors: [nA, nB] },    // optional: how many times each brain threw / timed out

  // The report each AI receives after a round (plain text, <= ~150 lines). Write it to help the AI
  // WIN next time: what decided the round, its own weak spots, what the opponent did — and remind
  // it that the opponent will evolve too (don't just hard-counter last round).
  report({ side, replay, result, stats, specs, labels, round, level, score }) -> string,

  // Sparring for `node arena.js test <id> [bot]`: named bot opponents that are valid at every level.
  bots: ['…'],
  botBundle(name, level) -> bundle,

  // Rows for the spectator result card and the Stats page: [label, valueA, valueB, better]
  // better = 'high' | 'low' | 'none'.
  resultRows(stats) -> [['Army left', 12, 3, 'high'], …],

  // Optional extra CLI commands: node arena.js <name> [args]  (e.g. 'units', 'market')
  // run(args, ctx): args = the raw words after the command (array; .pos / .opts hold the parsed form),
  // ctx = { level, out, state, fighter }. 'level'/'levels' and the built-in commands can't be overridden.
  commands: { units: { help: 'list every unit type', run(args, { level, out }) {} } },
};
```

## `public/js/modes/<id>/view.js`

```js
export function createView(canvas) {
  return {
    setReplay(replay, colors),   // colors = [sideA, sideB] css colours of the two AIs
    get duration() {},           // seconds of simulated time in the replay
    render(t, anim) {},          // draw the state at sim time t (s); anim = wall-clock seconds for idle
                                 // animation; t can be < 0 (before start) or > duration (after the end)
    renderIdle(anim) {},         // a backdrop while building / before a replay exists
    resize() {},                 // canvas size changed (the host calls this; use devicePixelRatio)
    hudAt(t) {},                 // -> [sideA, sideB], side = { title, sub, bars: [{ label, value, max, color }], chips: [text] }
    eventsBetween(t0, t1) {},    // -> [{ k, side, big, text }] events in (t0, t1] (sounds + ticker)
  };
}
```

The page shell draws the HUD, the VS splash, the countdown, the ticker and the result card; the
view only draws the playfield. Sounds: `import { modeEvent } from '../../sound.js'` and call
`modeEvent('<mode id>', { k, side, big })` for events (guard with `if (typeof modeEvent === 'function')`
— it may not exist yet).

## Rules for mode authors

- Deterministic: the same inputs give the same replay. Seeded pseudo-random numbers are allowed
  only if seeded from `seed` — but prefer no randomness at all.
- AI brains run in a `vm` sandbox exactly like `engine/sandbox.js` (no require/process, no code
  generation, per-call timeout, total CPU budget, JSON-only input/output, `lib/*.js` modules,
  optional `memory`). Copy and adapt it into your mode folder rather than editing the shared one.
- Keep replays reasonably small (a few MB at most): record at a lower rate than you simulate if
  needed, round numbers.
- Everything an AI needs must be in the guide file (and in `check` / `test` output).
