'use strict';
// Runs one fight (a real round or an exhibition) off the server's main thread.
const { parentPort, workerData } = require('worker_threads');
const { bundleFromSnapshot } = require('./loader');
const { runFight } = require('./match');

try {
  if (workerData.mode && workerData.mode !== 'fighter') {
    // another game mode (engine/modes/<id>): the adapter simulates the round
    const modes = require('./modes');
    const m = modes.get(workerData.mode);
    if (!m) throw new Error(`game mode "${workerData.mode}" could not be loaded`);
    const { snapshots, ids, labels, seed, round, level, theme, memories } = workerData;
    const r = m.simulate({ bundles: snapshots.map(modes.bundleFromSnapshot), ids, labels, seed, level, round, theme, memories });
    parentPort.postMessage({ ok: true, replay: r.replay, result: r.result, stats: r.stats || [{}, {}], memories: r.memories || null, brainErrors: r.brainErrors || null });
    return;
  }
  const { snapshots, ids, labels, seed, round, level, swapStart, kind, theme, memories } = workerData;
  const bundles = snapshots.map(bundleFromSnapshot);
  const { sim, specs, replay, memories: memOut } = runFight({ bundles, ids, labels, seed, kind: kind || 'round', round, level, swapStart, theme, memories });
  parentPort.postMessage({
    ok: true,
    replay,
    specs,
    memories: memOut,
    sim: { result: sim.result, stats: sim.stats, brainStats: sim.brainStats, timeline: sim.timeline, events: sim.events, obstacles: sim.obstacles, level: sim.level },
  });
} catch (e) {
  parentPort.postMessage({ ok: false, error: String((e && e.stack) || e) });
}
