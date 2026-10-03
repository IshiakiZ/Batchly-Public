'use strict';
// A tiny HIDDEN test mode (tug of war) used to exercise the game-mode plumbing end to end.
// Not offered to the host. Deterministic.

const vm = require('vm');

const TICK = 10;          // decisions per second
const LENGTH = 30;        // seconds
const WIN_AT = 100;       // rope units

function parseDesign(text) {
  try { return { json: JSON.parse(String(text || '').replace(/^﻿/, '')) }; } catch (e) { return { error: e.message }; }
}

function makeBrain(src) {
  const ctx = vm.createContext({}, { codeGeneration: { strings: false, wasm: false } });
  try {
    new vm.Script(`${String(src || '')}\n;globalThis.__f = typeof pull === 'function' ? pull : null;`).runInContext(ctx, { timeout: 200 });
  } catch { return { ok: false, call: () => null }; }
  const run = new vm.Script('JSON.stringify(__f ? __f(JSON.parse(__in)) : null)');
  return {
    ok: true,
    call(state) {
      try { ctx.__in = JSON.stringify(state); return JSON.parse(run.runInContext(ctx, { timeout: 20 })); } catch { return null; }
    },
  };
}

const mode = {
  id: 'tug',
  hidden: true,
  name: 'Tug of War (test)',
  tagline: 'A hidden test mode for the game-mode plumbing.',
  maxRounds: 12,
  designFile: 'team.json',
  brainFile: 'pull.js',
  guideFile: 'AI_GUIDE.md',
  starter: {
    'team.json': JSON.stringify({ name: 'Rope Rookies', strength: 5, stamina: 5, colors: { primary: '#e8825c', secondary: '#ffd166' } }, null, 2) + '\n',
    'pull.js': '// Return how hard to pull this tick (0..1). Pulling hard drains stamina.\nfunction pull(s) {\n  return { effort: s.me.stamina > 30 ? 1 : 0.4 };\n}\n',
  },
  levelInfo(level) { return { level, headline: `${10 + level * 2} team points`, lines: [`strength + stamina <= ${10 + level * 2}`] }; },
  levelUnlocks(level) { return level > 1 ? [`+2 team points (now ${10 + level * 2})`] : []; },

  check(bundle, { level }) {
    const errors = [], warnings = [];
    const p = parseDesign(bundle.design);
    if (!bundle.design) errors.push('team.json is missing');
    else if (p.error) errors.push(`team.json is not valid JSON: ${p.error}`);
    const j = p.json || {};
    const strength = Math.max(0, Math.floor(Number(j.strength) || 0));
    const stamina = Math.max(0, Math.floor(Number(j.stamina) || 0));
    const cap = 10 + level * 2;
    if (strength + stamina > cap) errors.push(`strength + stamina = ${strength + stamina} is over the level ${level} cap of ${cap}`);
    if (!bundle.brain) errors.push('pull.js is missing');
    else if (!makeBrain(bundle.brain).ok) errors.push('pull.js failed to load (it must define function pull(s))');
    const name = String(j.name || 'Unnamed team').slice(0, 40);
    const colors = j.colors && typeof j.colors === 'object' ? j.colors : { primary: '#8ab4ff', secondary: '#ffffff' };
    const spec = { name, strength, stamina, colors };
    return {
      ok: errors.length === 0, errors, warnings, spec, name, colors,
      summary: `strength ${strength} · stamina ${stamina}`,
      cardLines: [`Strength ${strength}`, `Stamina ${stamina}`, `Cap ${cap}`],
      text: [`== CHECK (tug) ==`, `Team: ${name}`, `strength ${strength}, stamina ${stamina} (cap ${cap})`, errors.length ? `ERRORS:\n  ${errors.join('\n  ')}` : 'VALID'].join('\n'),
    };
  },

  simulate({ bundles, ids, labels, level }) {
    const specs = bundles.map(b => mode.check(b, { level }).spec || { name: 'Broken', strength: 0, stamina: 0, colors: {} });
    const brains = bundles.map(b => makeBrain(b.brain));
    const st = specs.map(s => ({ stamina: 100, pulled: 0 }));
    let pos = 0; // >0 = towards side 0 (side 0 winning)
    const frames = [[0, 0, 100, 100]];
    const events = [];
    let winner = null, method = 'TIME', time = LENGTH;
    for (let i = 1; i <= LENGTH * TICK; i++) {
      const force = [0, 1].map((s) => {
        const out = brains[s].call({ t: i / TICK, me: { stamina: st[s].stamina, strength: specs[s].strength }, rope: s === 0 ? pos : -pos, level }) || {};
        const effort = Math.max(0, Math.min(1, Number(out.effort) || 0));
        const eff = st[s].stamina > 0 ? effort : 0.1;
        st[s].stamina = Math.max(0, Math.min(100, st[s].stamina - eff * (3 - specs[s].stamina * 0.15) + 1.2));
        st[s].pulled += eff;
        return (1 + specs[s].strength) * eff;
      });
      pos += (force[0] - force[1]) * 0.35;
      if (i % 2 === 0) frames.push([+(i / TICK).toFixed(1), +pos.toFixed(2), Math.round(st[0].stamina), Math.round(st[1].stamina)]);
      if (Math.abs(pos) >= WIN_AT) { winner = pos > 0 ? 0 : 1; method = 'PULLED'; time = i / TICK; events.push({ t: time, k: 'win', side: winner }); break; }
    }
    if (winner === null && Math.abs(pos) > 0.5) winner = pos > 0 ? 0 : 1;
    const sides = [0, 1].map(s => ({ id: ids[s], label: labels[s], name: specs[s].name, colors: specs[s].colors }));
    const text = winner === null ? 'The rope did not move — a draw.' : `${labels[winner]}'s ${specs[winner].name} ${method === 'PULLED' ? 'pulled the rope over the line' : 'had the rope on their side at the bell'}`;
    const result = { winner, method, time, text };
    const stats = [0, 1].map(s => ({ rope: +(s === 0 ? pos : -pos).toFixed(1), stamina: Math.round(st[s].stamina), effort: +st[s].pulled.toFixed(1) }));
    return { replay: { mode: 'tug', v: 1, duration: time, sides, frames, events, result, level }, result, stats };
  },

  report({ side, result, stats, labels, round }) {
    const me = stats[side], them = stats[1 - side];
    return [`ROUND ${round} (tug of war): ${result.winner === null ? 'DRAW' : result.winner === side ? 'YOU WON' : 'YOU LOST'} — ${result.text}`,
      `Rope position (positive = your side): ${me.rope}`, `Your stamina left ${me.stamina}, total effort ${me.effort}; theirs ${them.stamina} / ${them.effort}`,
      `Opponent: ${labels[1 - side]}`].join('\n');
  },
  bots: ['steady', 'burst'],
  botBundle(name, level) {
    const cap = 10 + level * 2;
    const strength = name === 'burst' ? Math.ceil(cap * 0.7) : Math.floor(cap / 2);
    return {
      mode: 'tug', exists: true, files: {}, lib: null, notes: null, readErrors: [],
      design: JSON.stringify({ name: `${name} bot`, strength, stamina: cap - strength, colors: { primary: '#9aa4b1', secondary: '#ffffff' } }),
      brain: name === 'burst' ? 'function pull(s) { return { effort: 1 }; }' : 'function pull(s) { return { effort: s.me.stamina > 50 ? 0.8 : 0.5 }; }',
    };
  },
  resultRows(stats) { return [['Rope (own side +)', stats[0].rope, stats[1].rope, 'high'], ['Stamina left', stats[0].stamina, stats[1].stamina, 'high'], ['Total effort', stats[0].effort, stats[1].effort, 'none']]; },
  commands: { rope: { help: 'explain the tug-of-war test mode', run(args, { out }) { out('Tug of war: pull (0..1) each tick; stamina drains; first to 100 wins.'); } } },
};

module.exports = mode;
